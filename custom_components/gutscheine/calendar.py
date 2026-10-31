"""Kalender mit den Ablaufdaten der Gutscheine."""
from __future__ import annotations

from datetime import date, datetime, timedelta

from homeassistant.components.calendar import CalendarEntity, CalendarEvent
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import DOMAIN, SIGNAL_CHANGED
from .sensor import _device
from .store import VoucherStore, status


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([ExpiryCalendar(hass.data[DOMAIN], entry)])


def _fmt(v: float | None) -> str:
    return "Betrag unbekannt" if v is None else f"{v:.2f} €".replace(".", ",")


class ExpiryCalendar(CalendarEntity):
    """Ganztägiger Termin am Ablaufdatum jedes offenen Gutscheins."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_name = "Ablauf"
    _attr_icon = "mdi:calendar-alert"

    def __init__(self, store: VoucherStore, entry: ConfigEntry) -> None:
        self.store = store
        self._attr_unique_id = f"{entry.entry_id}_calendar"
        self._attr_device_info = _device(entry)

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            async_dispatcher_connect(self.hass, SIGNAL_CHANGED, self.async_write_ha_state)
        )

    def _events(self) -> list[CalendarEvent]:
        out = []
        for v in self.store.vouchers.values():
            if not v.get("expires") or v.get("redeemed"):
                continue
            day = date.fromisoformat(v["expires"])
            desc = [f"Restwert: {_fmt(v.get('balance'))}"]
            if v.get("owner"):
                desc.append(f"Besitzer: {v['owner']}")
            out.append(
                CalendarEvent(
                    start=day,
                    end=day + timedelta(days=1),
                    summary=f"Gutschein {v['shop']} läuft ab ({_fmt(v.get('balance'))})",
                    description="\n".join(desc),
                    uid=f"gutschein-{v['id']}",
                )
            )
        return sorted(out, key=lambda e: e.start)

    @property
    def event(self) -> CalendarEvent | None:
        today = dt_util.now().date()
        for ev in self._events():
            if ev.start >= today:
                return ev
        return None

    async def async_get_events(
        self, hass: HomeAssistant, start_date: datetime, end_date: datetime
    ) -> list[CalendarEvent]:
        s, e = start_date.date(), end_date.date()
        return [ev for ev in self._events() if ev.start <= e and ev.end > s]
