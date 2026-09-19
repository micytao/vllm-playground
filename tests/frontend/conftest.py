"""Fixtures for Playwright-based UI smoke tests.

Boots the real FastAPI app (vllm_playground.app.app) with a real uvicorn
server in a background thread on an ephemeral port -- Playwright drives an
actual browser and needs a real HTTP server to navigate to (unlike the
httpx-based ASGI TestClient used by tests/api). No real vLLM backend is
ever started; the server sits in its natural "not running" default state,
which is exactly what the UI sees on a fresh install before anyone has
started a model.
"""

import socket
import threading
import time

import pytest
import uvicorn
from _pytest.monkeypatch import MonkeyPatch

import vllm_playground.app as app_module
import vllm_playground.image_catalog as image_catalog_module


@pytest.fixture(scope="session", autouse=True)
def _no_live_docker_hub_calls():
    """Force the Settings tab's image-catalog fetch onto its fallback path.

    The Settings view triggers GET /api/settings/image-catalog on render,
    which fetches live from Docker Hub for 5 image repos concurrently (real
    network, up to a genuine 10s total timeout each -- see
    image_catalog._fetch_tags_from_docker_hub). On a shared GitHub Actions
    runner that call can be slow or rate-limited, which previously made
    test_settings_view_shows_container_image_catalog_section flaky: it
    retried for Playwright's default 5s and still saw an empty view because
    Docker Hub hadn't answered (or timed out) yet.

    These are UI smoke tests ("does the view render"), not a test of Docker
    Hub reachability -- that's already covered by
    tests/unit/test_image_catalog.py with proper mocking. Making the fetch
    fail immediately forces the fast, deterministic fallback-list path
    every time, regardless of the CI runner's real-world network to
    Docker Hub.
    """
    mp = MonkeyPatch()

    async def _always_unreachable(repo):
        raise RuntimeError("network disabled for frontend smoke tests")

    mp.setattr(image_catalog_module, "_fetch_tags_from_docker_hub", _always_unreachable)
    yield
    mp.undo()


def _free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture(scope="session")
def live_server_url():
    """Serve the real app on a background thread for the whole test session.

    Uses ``app_module.app`` directly (no ``uvicorn.run``'s own signal
    handling) so it can be torn down cleanly. Lifespan startup is skipped by
    using ``uvicorn.Server`` with the default lifespan="on" -- that's fine
    here since the UI smoke tests want the app in its normal boot state.
    """
    port = _free_port()
    config = uvicorn.Config(app_module.app, host="127.0.0.1", port=port, log_level="warning", lifespan="off")
    server = uvicorn.Server(config)

    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    deadline = time.time() + 10
    while not getattr(server, "started", False) and time.time() < deadline:
        time.sleep(0.05)

    yield f"http://127.0.0.1:{port}"

    server.should_exit = True
    thread.join(timeout=5)
