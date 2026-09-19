"""API tests for the Observability Dashboard's metrics endpoints
(/api/vllm/metrics*, simulate/history), plus the token-counter proxy.
"""

from types import SimpleNamespace

import vllm_playground.app as app_module


def test_metrics_all_empty_by_default(client):
    resp = client.get("/api/vllm/metrics/all")
    assert resp.status_code == 200
    body = resp.json()
    assert body["metrics"] == {}
    assert body["metric_count"] == 0
    assert body["source"] == "none"


def test_metrics_legacy_endpoint_empty_by_default(client):
    resp = client.get("/api/vllm/metrics")
    assert resp.status_code == 200
    assert resp.json() == {}


def test_metrics_history_empty_by_default(client):
    resp = client.get("/api/vllm/metrics/history")
    assert resp.status_code == 200
    assert resp.json() == []


def test_metrics_history_summary_empty_by_default(client):
    resp = client.get("/api/vllm/metrics/history/summary")
    assert resp.status_code == 200
    assert resp.json()["total"] == 0


def test_simulate_metrics_populates_all_endpoints(client):
    resp = client.post(
        "/api/vllm/metrics/simulate",
        json={"kv_cache_usage_perc": 42.0, "num_requests_running": 3},
    )
    assert resp.status_code == 200

    all_resp = client.get("/api/vllm/metrics/all").json()
    assert all_resp["metric_count"] > 0
    assert all_resp["source"] == "simulated"
    assert all_resp["metrics"]["vllm:kv_cache_usage_perc"]["value"] == 0.42

    legacy_resp = client.get("/api/vllm/metrics").json()
    assert legacy_resp["kv_cache_usage_perc"] == 42.0

    # /simulate synthesizes 30s of wiggly history around the base values so
    # the observability charts have something realistic to render.
    history_resp = client.get("/api/vllm/metrics/history").json()
    assert len(history_resp) == 30
    assert all("vllm:kv_cache_usage_perc" in snap for snap in history_resp)

    summary_resp = client.get("/api/vllm/metrics/history/summary").json()
    assert summary_resp["total"] == 30


def test_simulate_metrics_reset_clears_state(client):
    client.post("/api/vllm/metrics/simulate", json={"kv_cache_usage_perc": 10.0})
    assert client.get("/api/vllm/metrics/all").json()["metric_count"] > 0

    resp = client.post("/api/vllm/metrics/simulate/reset")
    assert resp.status_code == 200


def test_tokenize_when_server_not_running(client):
    resp = client.post("/api/tokenize", json={"text": "hello world"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] is None
    assert "error" in body


def test_tokenize_proxies_to_running_server(client, fake_aiohttp, monkeypatch):
    app_module.current_run_mode = "subprocess"
    app_module.vllm_process = SimpleNamespace(returncode=None)

    async def fake_check_running():
        return True

    monkeypatch.setattr(app_module, "check_vllm_server_running", fake_check_running)
    monkeypatch.setattr(app_module, "current_config", app_module.VLLMConfig(model="tiny-model"))
    fake_aiohttp.add("POST", "/tokenize", json_data={"count": 4, "tokens": [1, 2, 3, 4]}, status=200)

    resp = client.post("/api/tokenize", json={"text": "hello world"})
    assert resp.status_code == 200
    assert resp.json() == {"count": 4}
