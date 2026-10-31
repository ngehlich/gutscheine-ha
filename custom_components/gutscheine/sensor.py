"""Sensoren: ein Sensor je Gutschein plus Gesamtwert und "läuft bald ab"."""
from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, SIGNAL_CHANGED, SOON_DAYS
from .store import VoucherStore, days_left, status

CURRENCY = "EUR"


def _device(entry: ConfigEntry) -> DeviceInfo:
    return DeviceInfo(
        identifiers={(DOMAIN, entry.entry_id)},
        name="Gutscheine",
        entry_type=DeviceEntryType.SERVICE,
    )


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    store: VoucherStore = hass.data[DOMAIN]
    voucher_entities: dict[str, VoucherSensor] = {}

    async_add_entities([TotalSensor(store, entry), SoonSensor(store, entry)])

    @callback
    def sync() -> None:
        wanted = {vid for vid, v in store.vouchers.items() if not v.get("redeemed")}
        new = [VoucherSensor(store, entry, vid) for vid in wanted - voucher_entities.keys()]
        for ent in new:
            voucher_entities[ent.vid] = ent
        if new:
            async_add_entities(new)
        reg = er.async_get(hass)
        for vid in set(voucher_entities) - wanted:
            ent = voucher_entities.pop(vid)
            if ent.entity_id and reg.async_get(ent.entity_id):
                reg.async_remove(ent.entity_id)
            else:
                hass.async_create_task(ent.async_remove())

    # Verwaiste Registry-Einträge (z. B. nach Löschen bei ausgeschaltetem HA) aufräumen.
    reg = er.async_get(hass)
    for ent in er.async_entries_for_config_entry(reg, entry.entry_id):
        if ent.domain == "sensor" and ent.unique_id.startswith("voucher_"):
            vid = ent.unique_id.removeprefix("voucher_")
            v = store.vouchers.get(vid)
            if v is None or v.get("redeemed"):
                reg.async_remove(ent.entity_id)

    sync()
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_CHANGED, sync))


class _Base(SensorEntity):
    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, store: VoucherStore, entry: ConfigEntry) -> None:
        self.store = store
        self._attr_device_info = _device(entry)

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            async_dispatcher_connect(self.hass, SIGNAL_CHANGED, self.async_write_ha_state)
        )


class VoucherSensor(_Base):
    """Restwert eines Gutscheins."""

    _attr_device_class = SensorDeviceClass.MONETARY
    _attr_native_unit_of_measurement = CURRENCY
    _attr_suggested_display_precision = 2

    def __init__(self, store: VoucherStore, entry: ConfigEntry, vid: str) -> None:
        super().__init__(store, entry)
        self.vid = vid
        self._attr_unique_id = f"voucher_{vid}"
        v = store.vouchers[vid]
        self._attr_name = v.get("shop") or vid
        # Feste, lesbare Entitäts-ID beim ersten Anlegen: sensor.gutschein_<geschäft>
        self.entity_id = f"sensor.gutschein_{_slug(v.get('shop') or vid)}"

    @property
    def _v(self) -> dict[str, Any]:
        return self.store.vouchers.get(self.vid, {})

    @property
    def available(self) -> bool:
        return self.vid in self.store.vouchers

    @property
    def name(self) -> str:
        return self._v.get("shop") or self.vid

    @property
    def native_value(self) -> float | None:
        return self._v.get("balance")

    @property
    def icon(self) -> str:
        return {
            "abgelaufen": "mdi:ticket-outline",
            "bald": "mdi:ticket-confirmation-outline",
        }.get(status(self._v), "mdi:ticket-percent-outline")

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        v = self._v
        return {
            "gutschein_id": self.vid,
            "geschaeft": v.get("shop"),
            "status": status(v),
            "ursprungswert": v.get("value"),
            "ablaufdatum": v.get("expires"),
            "tage_bis_ablauf": days_left(v),
            "besitzer": v.get("owner"),
            "code": v.get("code"),
            "code_typ": v.get("code_type"),
            "pin": v.get("pin"),
            "art": v.get("kind"),
            "notiz": v.get("note"),
        }


class TotalSensor(_Base):
    """Summe aller offenen, nicht abgelaufenen Gutscheine."""

    _attr_device_class = SensorDeviceClass.MONETARY
    _attr_native_unit_of_measurement = CURRENCY
    _attr_suggested_display_precision = 2
    _attr_icon = "mdi:wallet-giftcard"

    def __init__(self, store: VoucherStore, entry: ConfigEntry) -> None:
        super().__init__(store, entry)
        self._attr_unique_id = f"{entry.entry_id}_total"
        self._attr_name = "Gesamtwert"

    @property
    def native_value(self) -> float:
        return round(float(sum(v.get("balance") or 0 for v in self.store.open_vouchers())), 2)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        opened = self.store.open_vouchers()
        dated = sorted((v for v in opened if v.get("expires")), key=lambda v: v["expires"])
        nxt = dated[0] if dated else None
        return {
            "anzahl": len(opened),
            "ohne_betrag": sum(1 for v in opened if v.get("balance") is None),
            "naechster_ablauf": nxt["expires"] if nxt else None,
            "naechster_ablauf_geschaeft": nxt["shop"] if nxt else None,
        }


class SoonSensor(_Base):
    """Anzahl Gutscheine, die in den nächsten 30 Tagen ablaufen."""

    _attr_icon = "mdi:timer-sand"
    _attr_native_unit_of_measurement = "Gutscheine"

    def __init__(self, store: VoucherStore, entry: ConfigEntry) -> None:
        super().__init__(store, entry)
        self._attr_unique_id = f"{entry.entry_id}_soon"
        self._attr_name = "Laufen bald ab"

    def _soon(self) -> list[dict[str, Any]]:
        return [v for v in self.store.vouchers.values() if status(v) == "bald"]

    @property
    def native_value(self) -> int:
        return len(self._soon())

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            "tage": SOON_DAYS,
            "gutscheine": [
                {"geschaeft": v["shop"], "ablaufdatum": v["expires"], "restwert": v.get("balance")}
                for v in sorted(self._soon(), key=lambda v: v["expires"])
            ],
        }


def _slug(text: str) -> str:
    from homeassistant.util import slugify

    return slugify(text) or "gutschein"
