"""Einrichtung der Gutscheine (ohne Eingaben)."""
from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import DOMAIN


class GutscheineConfigFlow(ConfigFlow, domain=DOMAIN):
    """Legt den einzigen Eintrag an."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if user_input is None:
            return self.async_show_form(step_id="user")
        return self.async_create_entry(title="Gutscheine", data={})
