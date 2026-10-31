"""Grundtests: Einrichten, Anlegen, Einlösen, Löschen, Sensoren, Kalender."""
from datetime import date, timedelta

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

DOMAIN = "gutscheine"


async def _setup(hass: HomeAssistant) -> MockConfigEntry:
    await async_setup_component(hass, "http", {})
    entry = MockConfigEntry(domain=DOMAIN, title="Gutscheine", data={})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def _call(hass, service, **data):
    return await hass.services.async_call(
        DOMAIN, service, data, blocking=True, return_response=service != "remove"
    )


async def test_lifecycle(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass)
    assert hass.states.get("sensor.gutscheine_gesamtwert").state == "0.0"

    soon = (date.today() + timedelta(days=10)).isoformat()
    r = await _call(hass, "add", shop="Media Markt", value=30, code="5303452585670", expires=soon, owner="S+N")
    mm = r["voucher"]
    await _call(hass, "add", shop="Media Markt", value=15)
    await _call(hass, "add", shop="Bauhaus", value=7, expires="2020-05-20")
    await _call(hass, "add", shop="Conrad")
    await hass.async_block_till_done()

    s = hass.states.get("sensor.gutschein_media_markt")
    assert float(s.state) == 30
    assert s.attributes["status"] == "bald"
    assert s.attributes["code"] == "5303452585670"
    assert hass.states.get("sensor.gutschein_media_markt_2").state == "15.0"
    assert hass.states.get("sensor.gutschein_conrad").state == "unknown"

    total = hass.states.get("sensor.gutscheine_gesamtwert")
    assert float(total.state) == 45  # Bauhaus abgelaufen, Conrad ohne Betrag
    assert total.attributes["anzahl"] == 3
    assert total.attributes["naechster_ablauf"] == soon
    assert hass.states.get("sensor.gutscheine_laufen_bald_ab").state == "1"

    cal = hass.states.get("calendar.gutscheine_ablauf")
    assert cal.state == "off"
    assert "Media Markt" in cal.attributes["message"]

    # Teilweise einlösen per Entitäts-ID
    r = await _call(hass, "redeem", voucher="sensor.gutschein_media_markt", amount=12.5, note="Kabel")
    assert r["voucher"]["balance"] == 17.5
    await hass.async_block_till_done()
    assert float(hass.states.get("sensor.gutschein_media_markt").state) == 17.5

    # Ganz einlösen → Sensor verschwindet
    await _call(hass, "redeem", voucher=mm["id"])
    await hass.async_block_till_done()
    assert hass.states.get("sensor.gutschein_media_markt") is None
    assert er.async_get(hass).async_get("sensor.gutschein_media_markt") is None
    assert float(hass.states.get("sensor.gutscheine_gesamtwert").state) == 15

    # Wieder öffnen über Websocket
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "gutscheine/list"})
    res = await ws.receive_json()
    assert len(res["result"]["vouchers"]) == 4

    await ws.send_json({"id": 2, "type": "gutscheine/save", "voucher": mm["id"], "redeemed": False})
    res = await ws.receive_json()
    assert res["success"] and res["result"]["voucher"]["redeemed"] is False
    await hass.async_block_till_done()
    assert hass.states.get("sensor.gutschein_media_markt") is not None
    await ws.send_json({"id": 3, "type": "gutscheine/redeem", "voucher": mm["id"]})
    assert (await ws.receive_json())["success"]
    await ws.send_json({"id": 4, "type": "gutscheine/save", "redeemed": False})
    assert (await ws.receive_json())["success"] is False  # neu ohne Geschäft

    # Löschen
    await _call(hass, "remove", voucher="sensor.gutschein_conrad")
    await hass.async_block_till_done()
    assert hass.states.get("sensor.gutschein_conrad") is None

    # Kalender-Events
    events = await hass.services.async_call(
        "calendar", "get_events",
        {"entity_id": "calendar.gutscheine_ablauf", "start_date_time": "2020-01-01 00:00:00", "end_date_time": "2030-01-01 00:00:00"},
        blocking=True, return_response=True,
    )
    summaries = [e["summary"] for e in events["calendar.gutscheine_ablauf"]["events"]]
    assert summaries == ["Gutschein Bauhaus läuft ab (7,00 €)"]


async def test_reload_keeps_data(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    await _call(hass, "add", shop="dm", value=28.92, owner="Sarah")
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert float(hass.states.get("sensor.gutschein_dm").state) == 28.92
    r = await _call(hass, "list")
    assert r["vouchers"][0]["owner"] == "Sarah"
