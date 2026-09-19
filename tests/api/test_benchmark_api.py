"""API tests for /api/benchmark/* (GuideLLM / built-in load testing)."""

import asyncio

import vllm_playground.app as app_module


def test_benchmark_status_idle_by_default(client):
    resp = client.get("/api/benchmark/status")
    assert resp.status_code == 200
    assert resp.json() == {"running": False, "results": None}


def test_benchmark_start_fails_when_no_server_running_and_no_instance(client):
    resp = client.post(
        "/api/benchmark/start",
        json={"total_requests": 10, "request_rate": 1.0, "prompt_tokens": 16, "output_tokens": 16},
    )
    assert resp.status_code == 400
    assert "not running" in resp.json()["detail"].lower()


def test_benchmark_start_unknown_instance_id_returns_404(client, instance_registry):
    resp = client.post(
        "/api/benchmark/start",
        json={"total_requests": 10, "request_rate": 1.0, "instance_id": "does-not-exist"},
    )
    assert resp.status_code == 404


def test_benchmark_start_rejects_unhealthy_instance(client, instance_registry):
    from vllm_playground.backend_registry import InstanceEntry

    asyncio.run(
        instance_registry.add(
            InstanceEntry(id="be-1", name="Down", url="http://example.com:8000", health="unreachable")
        )
    )

    resp = client.post("/api/benchmark/start", json={"total_requests": 10, "instance_id": "be-1"})
    assert resp.status_code == 400
    assert "not running" in resp.json()["detail"].lower()


def test_benchmark_start_succeeds_against_running_local_server(client, monkeypatch):
    app_module.current_run_mode = "subprocess"

    async def fake_check_running():
        return True

    async def fake_benchmark_task(*args, **kwargs):
        return None

    monkeypatch.setattr(app_module, "check_vllm_server_running", fake_check_running)
    monkeypatch.setattr(app_module, "current_config", app_module.VLLMConfig(model="tiny-model"))
    monkeypatch.setattr(app_module, "run_benchmark", fake_benchmark_task)

    resp = client.post(
        "/api/benchmark/start",
        json={"total_requests": 5, "request_rate": 1.0, "prompt_tokens": 8, "output_tokens": 8},
    )
    assert resp.status_code == 200
    assert resp.json() == {"status": "started", "message": "Benchmark started"}


def test_benchmark_start_rejects_concurrent_run(client, monkeypatch):
    # NOTE: TestClient spins up a brand-new event loop per request when not
    # used as a context manager, so a real `asyncio.create_task(...)`
    # started during one request wouldn't survive into the next request's
    # loop for `.done()` to observe. A minimal duck-typed stand-in exercises
    # the same "is a benchmark already running?" guard deterministically.
    class _NeverDoneTask:
        def done(self):
            return False

    async def fake_check_running():
        return True

    monkeypatch.setattr(app_module, "check_vllm_server_running", fake_check_running)
    monkeypatch.setattr(app_module, "current_config", app_module.VLLMConfig(model="tiny-model"))
    monkeypatch.setattr(app_module, "benchmark_task", _NeverDoneTask())

    resp = client.post("/api/benchmark/start", json={"total_requests": 5})
    assert resp.status_code == 400
    assert "already running" in resp.json()["detail"].lower()


def test_benchmark_stop_without_running_benchmark_returns_400(client):
    resp = client.post("/api/benchmark/stop")
    assert resp.status_code == 400
