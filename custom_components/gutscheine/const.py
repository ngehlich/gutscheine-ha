"""Konstanten der Gutscheine-Integration."""
from __future__ import annotations

from pathlib import Path

DOMAIN = "gutscheine"
VERSION = "0.4.2"
STORAGE_VERSION = 1

SIGNAL_CHANGED = f"{DOMAIN}_changed"
REGISTERED = f"{DOMAIN}_registered"

PANEL_URL = "gutscheine"
STATIC_URL = "/gutscheine_static/gutscheine-panel.js"
PANEL_FILE = Path(__file__).parent / "gutscheine-panel.js"
SCANNER_URL = "/gutscheine_static/scanner"
SCANNER_DIR = Path(__file__).parent / "scanner"

# Ab so vielen Tagen vor Ablauf gilt ein Gutschein als "läuft bald ab".
SOON_DAYS = 30
