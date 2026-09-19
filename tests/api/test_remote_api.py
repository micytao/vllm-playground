"""API tests for /api/remote/* (Remote Server + LiteLLM/MaaS support)."""

import vllm_playground.app as app_module


def _activate_remote(remote_url="http://example.com:8000"):
    app_module.current_run_mode = "remote"
    app_module.vllm_running = True
    app_module.current_config = app_module.VLLMConfig(
        model="my-model",
        run_mode="remote",
        remote_url=remote_url,
    )


def test_remote_models_requires_active_remote_connection(client):
    resp = client.get("/api/remote/models")
    assert resp.status_code == 400


def test_remote_models_lists_discovered_models(client, fake_aiohttp):
    _activate_remote()
    fake_aiohttp.add(
        "GET",
        "/v1/models",
        json_data={"data": [{"id": "model-a"}, {"id": "model-b"}]},
        status=200,
    )

    resp = client.get("/api/remote/models")
    assert resp.status_code == 200
    ids = [m["id"] for m in resp.json()["models"]]
    assert ids == ["model-a", "model-b"]


def test_remote_models_propagates_upstream_error(client, fake_aiohttp):
    _activate_remote()
    fake_aiohttp.add("GET", "/v1/models", exception=ConnectionError("dns fail"))

    resp = client.get("/api/remote/models")
    assert resp.status_code == 502


def test_select_model_requires_active_remote(client):
    resp = client.post("/api/remote/select-model", json={"model": "model-a"})
    assert resp.status_code == 400


def test_select_model_rejects_empty_model(client):
    _activate_remote()
    resp = client.post("/api/remote/select-model", json={"model": "  "})
    assert resp.status_code == 400


def test_select_model_rejects_model_outside_cached_catalog(client):
    _activate_remote()
    app_module.remote_discovered_model_ids = ["model-a", "model-b"]

    resp = client.post("/api/remote/select-model", json={"model": "model-z"})
    assert resp.status_code == 400
    assert "not in the cached remote catalog" in resp.json()["detail"]


def test_select_model_success_updates_current_config(client):
    _activate_remote()
    app_module.remote_discovered_model_ids = ["model-a", "model-b"]

    resp = client.post("/api/remote/select-model", json={"model": "model-b"})
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "model": "model-b"}
    assert app_module.current_model_identifier == "model-b"
    assert app_module.current_config.model == "model-b"
