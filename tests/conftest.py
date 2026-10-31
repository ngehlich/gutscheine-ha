from pathlib import Path

import pytest

import custom_components

# Das Test-Plugin bringt ein eigenes custom_components-Paket mit; unseres ergänzen.
_OURS = str(Path(__file__).parents[1] / "custom_components")
if _OURS not in custom_components.__path__:
    custom_components.__path__.append(_OURS)


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield
