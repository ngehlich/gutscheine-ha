"""Gutscheine: Gutscheine und Guthabenkarten in Home Assistant verwalten.

Die Daten liegen in /config/.storage/gutscheine (Teil jeder HA-Sicherung).
Dazu gibt es Sensoren je Gutschein, einen Gesamtwert, einen Kalender mit den
Ablaufdaten, Aktionen zum Anlegen und Einlösen und eine App in der Seitenleiste.
"""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import frontend, panel_custom, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
    callback,
)
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import (
    async_dispatcher_connect,
    async_dispatcher_send,
)
from homeassistant.helpers.event import async_track_time_change

from .const import (
    DOMAIN,
    PANEL_FILE,
    PANEL_URL,
    REGISTERED,
    SCANNER_DIR,
    SCANNER_URL,
    SIGNAL_CHANGED,
    STATIC_URL,
    VERSION,
)
from .store import CODE_TYPES, VoucherStore

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SENSOR, Platform.CALENDAR]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

_money = vol.Any(None, vol.All(vol.Coerce(float), vol.Range(min=0)))
_text = vol.Any(None, vol.All(cv.string, vol.Length(max=500)))
_date = vol.Any(None, "", cv.date)

FIELDS = {
    vol.Optional("value"): _money,
    vol.Optional("balance"): _money,
    vol.Optional("expires"): _date,
    vol.Optional("issued"): _date,
    vol.Optional("owner"): _text,
    vol.Optional("code"): _text,
    vol.Optional("code_type"): vol.Any(None, vol.In(CODE_TYPES)),
    vol.Optional("pin"): _text,
    vol.Optional("note"): _text,
    vol.Optional("kind"): _text,
}

ADD_SCHEMA = vol.Schema({vol.Required("shop"): cv.string, **FIELDS})
UPDATE_SCHEMA = vol.Schema(
    {
        vol.Required("voucher"): cv.string,
        vol.Optional("shop"): cv.string,
        vol.Optional("redeemed"): cv.boolean,
        **FIELDS,
    }
)
REDEEM_SCHEMA = vol.Schema(
    {
        vol.Required("voucher"): cv.string,
        vol.Optional("amount"): vol.All(vol.Coerce(float), vol.Range(min=0)),
        vol.Optional("note"): cv.string,
    }
)
REMOVE_SCHEMA = vol.Schema({vol.Required("voucher"): cv.string})


def _store(hass: HomeAssistant) -> VoucherStore:
    store: VoucherStore | None = hass.data.get(DOMAIN)
    if store is None:
        raise ServiceValidationError("Gutscheine ist nicht eingerichtet")
    return store


def _resolve(store: VoucherStore, ref: str) -> str:
    try:
        return store.find(ref)
    except KeyError as err:
        raise ServiceValidationError(str(err)) from err


async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    """Aktionen registrieren (einmalig)."""

    async def add(call: ServiceCall) -> ServiceResponse:
        try:
            v = await _store(hass).async_add(dict(call.data))
        except ValueError as err:
            raise ServiceValidationError(str(err)) from err
        return {"voucher": v}

    async def update(call: ServiceCall) -> ServiceResponse:
        store = _store(hass)
        data = dict(call.data)
        vid = _resolve(store, data.pop("voucher"))
        return {"voucher": await store.async_update(vid, data)}

    async def redeem(call: ServiceCall) -> ServiceResponse:
        store = _store(hass)
        vid = _resolve(store, call.data["voucher"])
        v = await store.async_redeem(vid, call.data.get("amount"), call.data.get("note"))
        return {"voucher": v}

    async def remove(call: ServiceCall) -> None:
        store = _store(hass)
        await store.async_remove(_resolve(store, call.data["voucher"]))

    async def list_all(call: ServiceCall) -> ServiceResponse:
        return {"vouchers": list(_store(hass).vouchers.values())}

    opt = SupportsResponse.OPTIONAL
    hass.services.async_register(DOMAIN, "add", add, ADD_SCHEMA, supports_response=opt)
    hass.services.async_register(DOMAIN, "update", update, UPDATE_SCHEMA, supports_response=opt)
    hass.services.async_register(DOMAIN, "redeem", redeem, REDEEM_SCHEMA, supports_response=opt)
    hass.services.async_register(DOMAIN, "remove", remove, REMOVE_SCHEMA)
    hass.services.async_register(
        DOMAIN, "list", list_all, vol.Schema({}), supports_response=SupportsResponse.ONLY
    )
    return True


# --- Websocket für die Seitenleisten-App -----------------------------------


def _ws_store(hass: HomeAssistant, connection, msg) -> VoucherStore | None:
    store = hass.data.get(DOMAIN)
    if store is None:
        connection.send_error(msg["id"], "not_loaded", "Gutscheine ist nicht eingerichtet")
    return store


@websocket_api.websocket_command({vol.Required("type"): "gutscheine/list"})
@callback
def ws_list(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg) -> None:
    if (store := _ws_store(hass, connection, msg)) is None:
        return
    connection.send_result(msg["id"], {"vouchers": list(store.vouchers.values())})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "gutscheine/save",
        vol.Optional("voucher"): cv.string,
        vol.Optional("shop"): cv.string,
        vol.Optional("redeemed"): cv.boolean,
        **FIELDS,
    }
)
@websocket_api.async_response
async def ws_save(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg) -> None:
    if (store := _ws_store(hass, connection, msg)) is None:
        return
    data = {k: v for k, v in msg.items() if k not in ("type", "id", "voucher")}
    try:
        if msg.get("voucher"):
            v = await store.async_update(msg["voucher"], data)
        else:
            v = await store.async_add(data)
    except (KeyError, ValueError) as err:
        connection.send_error(msg["id"], "invalid", str(err))
        return
    connection.send_result(msg["id"], {"voucher": v})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "gutscheine/redeem",
        vol.Required("voucher"): cv.string,
        vol.Optional("amount"): vol.Any(None, vol.All(vol.Coerce(float), vol.Range(min=0))),
        vol.Optional("note"): vol.Any(None, cv.string),
    }
)
@websocket_api.async_response
async def ws_redeem(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg) -> None:
    if (store := _ws_store(hass, connection, msg)) is None:
        return
    try:
        v = await store.async_redeem(msg["voucher"], msg.get("amount"), msg.get("note"))
    except KeyError as err:
        connection.send_error(msg["id"], "not_found", str(err))
        return
    connection.send_result(msg["id"], {"voucher": v})


@websocket_api.websocket_command(
    {vol.Required("type"): "gutscheine/remove", vol.Required("voucher"): cv.string}
)
@websocket_api.async_response
async def ws_remove(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg) -> None:
    if (store := _ws_store(hass, connection, msg)) is None:
        return
    try:
        await store.async_remove(msg["voucher"])
    except KeyError as err:
        connection.send_error(msg["id"], "not_found", str(err))
        return
    connection.send_result(msg["id"])


@websocket_api.websocket_command({vol.Required("type"): "gutscheine/subscribe"})
@callback
def ws_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg) -> None:
    @callback
    def forward() -> None:
        connection.send_message(websocket_api.event_message(msg["id"], {}))

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(hass, SIGNAL_CHANGED, forward)
    connection.send_result(msg["id"])


# --- Einrichtung ------------------------------------------------------------


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    store = VoucherStore(hass)
    await store.async_load()
    hass.data[DOMAIN] = store

    if not hass.data.get(REGISTERED):
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(STATIC_URL, str(PANEL_FILE), False),
                StaticPathConfig(SCANNER_URL, str(SCANNER_DIR), True),
            ]
        )
        for cmd in (ws_list, ws_save, ws_redeem, ws_remove, ws_subscribe):
            websocket_api.async_register_command(hass, cmd)
        hass.data[REGISTERED] = True

    await panel_custom.async_register_panel(
        hass,
        webcomponent_name="gutscheine-panel",
        frontend_url_path=PANEL_URL,
        module_url=f"{STATIC_URL}?v={VERSION}",
        sidebar_title="Gutscheine",
        sidebar_icon="mdi:ticket-percent-outline",
        embed_iframe=False,
        require_admin=False,
        config={"version": VERSION},
    )

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Täglich kurz nach Mitternacht "Tage bis Ablauf" neu berechnen.
    @callback
    def _midnight(_now) -> None:
        async_dispatcher_send(hass, SIGNAL_CHANGED)

    entry.async_on_unload(async_track_time_change(hass, _midnight, hour=0, minute=0, second=5))
    _LOGGER.debug("Gutscheine geladen: %s Einträge", len(store.vouchers))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        frontend.async_remove_panel(hass, PANEL_URL)
        hass.data.pop(DOMAIN, None)
    return ok
