"""API tests for the Decision Models (Experimental) endpoints.

Focus on the /api/decision/server/start routing between "container" and
"remote" modes. The decision_models backend lifecycle itself is covered in
tests/unit/test_decision_models.py; here we only assert the FastAPI layer
dispatches to the right backend call with the right arguments.
"""

import vllm_playground.app as app_module
import vllm_playground.decision_models as decision_models


def test_start_remote_mode_dispatches_to_connect(client, monkeypatch):
    calls = {}

    async def fake_connect(url, model_id=None, api_key=None):
        calls["url"] = url
        calls["model_id"] = model_id
        calls["api_key"] = api_key
        return {"phase": "ready", "ready": True, "connection": "remote", "remote_url": url}

    monkeypatch.setattr(decision_models, "connect_remote_decision_server", fake_connect)

    resp = client.post(
        "/api/decision/server/start",
        json={
            "mode": "remote",
            "remote_url": "https://jev.example.com",
            "model_id": "google/diffusiongemma-26B-A4B-it",
            "remote_api_key": "secret",
        },
    )

    assert resp.status_code == 200
    assert resp.json()["connection"] == "remote"
    assert calls == {
        "url": "https://jev.example.com",
        "model_id": "google/diffusiongemma-26B-A4B-it",
        "api_key": "secret",
    }


def test_start_container_mode_dispatches_to_start_server(client, monkeypatch):
    calls = {}

    async def fake_start(model_id=None, image_tag=None, canvas_length=None, gpu_device=None):
        calls["model_id"] = model_id
        return {"phase": "ready", "ready": True, "connection": "managed"}

    # Must not be reached in container mode.
    async def fail_connect(*a, **k):
        raise AssertionError("connect_remote_decision_server should not be called in container mode")

    monkeypatch.setattr(decision_models, "start_decision_server", fake_start)
    monkeypatch.setattr(decision_models, "connect_remote_decision_server", fail_connect)

    resp = client.post("/api/decision/server/start", json={"mode": "container"})

    assert resp.status_code == 200
    assert resp.json()["connection"] == "managed"
    assert "model_id" in calls


def test_start_remote_mode_maps_value_error_to_422(client, monkeypatch):
    async def fake_connect(url, model_id=None, api_key=None):
        raise ValueError("remote_url is required to connect to a remote Decision endpoint.")

    monkeypatch.setattr(decision_models, "connect_remote_decision_server", fake_connect)

    resp = client.post("/api/decision/server/start", json={"mode": "remote", "remote_url": ""})

    assert resp.status_code == 422


def test_settings_rejects_non_http_decision_remote_url(client):
    resp = client.post("/api/settings", json={"decision_remote_url": "ftp://nope"})
    assert resp.status_code == 400


def test_settings_accepts_decision_remote_url(client, monkeypatch):
    captured = {}

    def fake_update(data):
        captured.update(data)
        return {**app_module.settings_store.get(), **data}

    monkeypatch.setattr(app_module.settings_store, "update", fake_update)

    resp = client.post("/api/settings", json={"decision_remote_url": "https://jev.example.com"})
    assert resp.status_code == 200
    assert captured["decision_remote_url"] == "https://jev.example.com"


def test_decision_server_status_defaults_include_remote_model_id(client):
    resp = client.get("/api/decision/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "defaults" in data
    assert data["defaults"]["remote_model_id"] == "jev-latest"
    assert data["defaults"]["model_id"] != data["defaults"]["remote_model_id"]
