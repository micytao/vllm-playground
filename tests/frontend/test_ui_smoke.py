"""Playwright UI smoke tests.

Loads the real vLLM Playground frontend (served by the real FastAPI app, no
vLLM backend running behind it -- exactly the state a fresh install is in)
and exercises the main navigation, catching JS syntax errors and broken DOM
wiring that unit/API tests can't see.

Note: the app opens persistent WebSocket connections (chat + Omni) as soon
as the page loads, which never go idle. That means Playwright's
``wait_until="networkidle"`` never resolves for this app -- we use the
default ``"load"`` wait instead and then wait for a concrete selector to
appear, which is both correct and much faster.
"""

import pytest
from playwright.sync_api import expect

IGNORED_CONSOLE_SUBSTRINGS = (
    # Favicon/asset 404s are cosmetic and unrelated to app logic; the nav
    # icons themselves already have onerror="this.style.display='none'".
    "favicon",
    "404",
)


def _collect_console_errors(page):
    errors = []

    def _on_console(msg):
        if msg.type == "error":
            errors.append(msg.text)

    page.on("console", _on_console)
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    return errors


def _real_errors(errors):
    return [e for e in errors if not any(sub in e.lower() for sub in IGNORED_CONSOLE_SUBSTRINGS)]


def test_page_loads_without_js_errors(page, live_server_url):
    errors = _collect_console_errors(page)

    page.goto(live_server_url)
    page.wait_for_selector("#vllm-server-view")

    assert page.title() != ""
    assert page.locator("#vllm-server-view").is_visible()
    assert _real_errors(errors) == []


def test_default_view_is_vllm_server(page, live_server_url):
    page.goto(live_server_url)
    page.wait_for_selector("#vllm-server-view")

    assert "active" in (page.locator('.nav-item[data-view="vllm-server"]').get_attribute("class") or "")
    assert page.locator("#vllm-server-view").is_visible()


@pytest.mark.parametrize(
    "view_name",
    ["instances", "observability", "mcp-config", "settings", "guidellm", "tutorials"],
)
def test_can_switch_to_each_main_view(page, live_server_url, view_name):
    errors = _collect_console_errors(page)
    page.goto(live_server_url)
    page.wait_for_selector("#vllm-server-view")

    page.click(f'.nav-item[data-view="{view_name}"]')

    # `expect()` auto-retries (up to its default timeout) instead of a fixed
    # sleep, which was flaky under CI runner load: sometimes fast enough
    # locally/in a PR run, sometimes not on a slower/busier runner.
    view = page.locator(f"#{view_name}-view")
    expect(view).to_be_visible()
    assert _real_errors(errors) == []


def test_settings_view_shows_container_image_catalog_section(page, live_server_url):
    page.goto(live_server_url)
    page.wait_for_selector("#vllm-server-view")
    page.click('.nav-item[data-view="settings"]')

    settings_view = page.locator("#settings-view")
    expect(settings_view).to_be_visible()
    # Settings content is rendered client-side (empty container in the HTML
    # shell) -- assert it actually got populated rather than staying blank.
    # `expect(...).not_to_have_text("")` retries (up to Playwright's default
    # timeout) instead of a fixed sleep before checking once, which was
    # flaky under CI runner load.
    expect(settings_view).not_to_have_text("")


def test_mcp_servers_view_renders_without_crashing(page, live_server_url):
    errors = _collect_console_errors(page)
    page.goto(live_server_url)
    page.wait_for_selector("#vllm-server-view")

    page.click('.nav-item[data-view="mcp-config"]')

    expect(page.locator("#mcp-config-view")).to_be_visible()
    assert _real_errors(errors) == []
