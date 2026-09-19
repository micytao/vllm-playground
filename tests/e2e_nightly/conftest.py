"""Fixtures for the real, nightly-only CPU end-to-end test.

Boots the real FastAPI app (``vllm_playground.app.app``) with an actual
uvicorn server in a background thread, exactly as a real user's browser
would talk to it. Unlike ``tests/api`` (which mocks out subprocess/aiohttp),
this test suite intentionally makes no attempt to mock anything -- it wants
to catch real regressions in "start a CPU model, then chat with it" that
only show up when the actual ``vllm`` package is installed and a real
subprocess is spawned, started, and proxied through.

Requires the real ``vllm`` (CPU build) package to be installed -- these
tests are skipped entirely otherwise (see the ``pytest.importorskip`` in
``test_cpu_chat_e2e.py``). This whole directory is excluded from the normal
CI test run (`ci.yml` never points pytest at it) and is only ever invoked by
`.github/workflows/nightly.yml`.
"""

import socket
import threading
import time

import pytest
import uvicorn

import vllm_playground.app as app_module


def free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture(scope="session")
def live_server_url():
    """Serve the real app on a background thread for the whole test session."""
    port = free_port()
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
