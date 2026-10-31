"""Speicher für Gutscheine in /config/.storage/gutscheine."""
from __future__ import annotations

import asyncio
from datetime import date
import uuid
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import DOMAIN, SIGNAL_CHANGED, SOON_DAYS, STORAGE_VERSION

EDITABLE = (
    "shop", "value", "balance", "expires", "owner", "code", "code_type", "pin", "note", "kind",
)
CODE_TYPES = ("barcode", "qr", "text")


def _money(v: Any) -> float | None:
    if v is None or v == "":
        return None
    return round(float(v), 2)


def _date(v: Any) -> str | None:
    if v is None or v == "":
        return None
    if isinstance(v, date):
        return v.isoformat()
    return date.fromisoformat(str(v)[:10]).isoformat()


def days_left(voucher: dict[str, Any], today: date | None = None) -> int | None:
    if not voucher.get("expires"):
        return None
    today = today or dt_util.now().date()
    return (date.fromisoformat(voucher["expires"]) - today).days


def status(voucher: dict[str, Any], today: date | None = None) -> str:
    """aktiv | bald | abgelaufen | eingeloest"""
    if voucher.get("redeemed"):
        return "eingeloest"
    d = days_left(voucher, today)
    if d is None:
        return "aktiv"
    if d < 0:
        return "abgelaufen"
    if d <= SOON_DAYS:
        return "bald"
    return "aktiv"


class VoucherStore:
    """Alle Gutscheine; jede Änderung wird gespeichert und gemeldet."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(
            hass, STORAGE_VERSION, DOMAIN, private=True, atomic_writes=True
        )
        self.lock = asyncio.Lock()
        self.vouchers: dict[str, dict[str, Any]] = {}

    async def async_load(self) -> None:
        data = await self._store.async_load()
        if data:
            self.vouchers = data.get("vouchers", {})

    async def _commit(self) -> None:
        await self._store.async_save({"vouchers": self.vouchers})
        async_dispatcher_send(self.hass, SIGNAL_CHANGED)

    @staticmethod
    def _clean(fields: dict[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for key in EDITABLE:
            if key not in fields:
                continue
            val = fields[key]
            if key in ("value", "balance"):
                val = _money(val)
            elif key == "expires":
                val = _date(val)
            elif isinstance(val, str):
                val = val.strip() or None
            out[key] = val
        return out

    async def async_add(self, fields: dict[str, Any]) -> dict[str, Any]:
        data = self._clean(fields)
        if not data.get("shop"):
            raise ValueError("Geschäft fehlt")
        async with self.lock:
            vid = uuid.uuid4().hex[:8]
            voucher = {k: None for k in EDITABLE}
            voucher.update(data)
            if voucher["balance"] is None:
                voucher["balance"] = voucher["value"]
            voucher.update(
                id=vid,
                created=dt_util.now().date().isoformat(),
                redeemed=False,
                history=[],
            )
            self.vouchers[vid] = voucher
            await self._commit()
        return voucher

    async def async_update(self, vid: str, fields: dict[str, Any]) -> dict[str, Any]:
        async with self.lock:
            voucher = self._get(vid)
            voucher.update(self._clean(fields))
            if "redeemed" in fields:
                voucher["redeemed"] = bool(fields["redeemed"])
            await self._commit()
        return voucher

    async def async_redeem(
        self, vid: str, amount: float | None = None, note: str | None = None
    ) -> dict[str, Any]:
        """Ganz (amount=None) oder teilweise einlösen."""
        async with self.lock:
            voucher = self._get(vid)
            entry: dict[str, Any] = {"date": dt_util.now().date().isoformat()}
            balance = voucher.get("balance")
            if amount is None:
                entry["amount"] = balance
                if balance is not None:
                    voucher["balance"] = 0.0
                voucher["redeemed"] = True
            else:
                amount = round(float(amount), 2)
                entry["amount"] = amount
                if balance is not None:
                    voucher["balance"] = max(0.0, round(balance - amount, 2))
                    if voucher["balance"] == 0:
                        voucher["redeemed"] = True
            if note:
                entry["note"] = note
            voucher.setdefault("history", []).append(entry)
            await self._commit()
        return voucher

    async def async_remove(self, vid: str) -> None:
        async with self.lock:
            self._get(vid)
            del self.vouchers[vid]
            await self._commit()

    def _get(self, vid: str) -> dict[str, Any]:
        if vid not in self.vouchers:
            raise KeyError(f"Gutschein {vid} nicht gefunden")
        return self.vouchers[vid]

    def find(self, ref: str) -> str:
        """ID oder Entitäts-ID (sensor.gutschein_<id>) → ID."""
        ref = ref.strip()
        if ref in self.vouchers:
            return ref
        if ref.startswith("sensor."):
            from homeassistant.helpers import entity_registry as er

            ent = er.async_get(self.hass).async_get(ref)
            if ent and ent.platform == DOMAIN and ent.unique_id.startswith("voucher_"):
                vid = ent.unique_id.removeprefix("voucher_")
                if vid in self.vouchers:
                    return vid
        raise KeyError(f"Gutschein {ref} nicht gefunden")

    def open_vouchers(self) -> list[dict[str, Any]]:
        today = dt_util.now().date()
        return [v for v in self.vouchers.values() if status(v, today) in ("aktiv", "bald")]
