"""Real, nightly-only CPU end-to-end test: the one test that proves "the
whole stack works".

Starts the real FastAPI app, launches a *real* tiny model as a real
``vllm.entrypoints.openai.api_server`` subprocess (CPU-only, no mocks
anywhere), waits for it to become healthy, and then exercises
``/v1/chat/completions`` and ``/v1/completions`` through the actual app --
exactly the request path a real user's browser/API client takes.

This is deliberately NOT part of the fast PR-gating ``ci.yml`` suite: model
download + CPU inference startup takes minutes, which is too slow/flaky to
block every PR. It runs nightly (and on-demand) via
``.github/workflows/nightly.yml`` instead, which does ``pip install vllm``
before invoking pytest here.

Skipped automatically (via ``pytest.importorskip``) if the real ``vllm``
package isn't installed -- e.g. on a normal dev laptop or in the fast CI
jobs that never install it.
"""

import time

import pytest
import requests

pytest.importorskip("vllm", reason="Real CPU E2E test requires the actual vllm package to be installed")

# facebook/opt-125m: ~250MB, no gating/token required, fast enough to load
# on a CPU-only GitHub Actions runner within a few minutes.
MODEL = "facebook/opt-125m"

START_TIMEOUT_S = 600  # model download + CPU load can take a while on a cold cache
HEALTH_POLL_INTERVAL_S = 5


@pytest.fixture(scope="module")
def running_model(live_server_url):
    """Start the real vLLM CPU subprocess through the app and wait for it
    to report healthy in the backend registry, then tear it down."""
    start_resp = requests.post(
        f"{live_server_url}/api/start",
        json={
            "model": MODEL,
            "run_mode": "subprocess",
            "use_cpu": True,
            "port": 18000,
            "max_model_len": 256,
            "dtype": "auto",
        },
        timeout=30,
    )
    assert start_resp.status_code == 200, start_resp.text
    assert start_resp.json().get("mode") == "subprocess"

    backend_id = None
    deadline = time.time() + START_TIMEOUT_S
    last_health = None
    while time.time() < deadline:
        instances = requests.get(f"{live_server_url}/api/instances", timeout=10).json()["instances"]
        entry = next((e for e in instances if e.get("model") == MODEL), None)
        if entry is not None:
            backend_id = entry["id"]
            health_resp = requests.post(f"{live_server_url}/api/instances/{backend_id}/health", timeout=10)
            last_health = health_resp.json().get("health")
            if last_health == "healthy":
                break
        time.sleep(HEALTH_POLL_INTERVAL_S)
    else:
        pytest.fail(
            f"vLLM subprocess for {MODEL} never became healthy within {START_TIMEOUT_S}s "
            f"(last observed health: {last_health!r})"
        )

    yield {"base_url": live_server_url, "backend_id": backend_id, "model": MODEL}

    requests.post(f"{live_server_url}/api/stop", timeout=30)


def test_chat_completions_end_to_end(running_model):
    resp = requests.post(
        f"{running_model['base_url']}/v1/chat/completions",
        json={
            "model": running_model["model"],
            "messages": [{"role": "user", "content": "Reply with the single word: hello"}],
            "max_tokens": 16,
            "temperature": 0,
        },
        timeout=120,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["choices"], body
    content = body["choices"][0]["message"]["content"]
    assert isinstance(content, str) and content.strip() != ""


def test_chat_completions_streaming_end_to_end(running_model):
    resp = requests.post(
        f"{running_model['base_url']}/v1/chat/completions",
        json={
            "model": running_model["model"],
            "messages": [{"role": "user", "content": "Count from 1 to 3."}],
            "max_tokens": 16,
            "stream": True,
        },
        timeout=120,
        stream=True,
    )
    assert resp.status_code == 200
    chunks = [line for line in resp.iter_lines() if line]
    assert chunks, "expected at least one SSE chunk from the streaming response"


def test_text_completions_end_to_end(running_model):
    resp = requests.post(
        f"{running_model['base_url']}/v1/completions",
        json={
            "model": running_model["model"],
            "prompt": "The capital of France is",
            "max_tokens": 8,
            "temperature": 0,
        },
        timeout=120,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["choices"], body
    assert isinstance(body["choices"][0]["text"], str)
