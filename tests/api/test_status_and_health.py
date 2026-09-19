"""API tests for core status/health/feature-detection endpoints.

These endpoints are read-only and safe to exercise against the app's
default (server-not-running) state.
"""


def test_root_serves_html(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]


def test_status_when_nothing_running(client):
    resp = client.get("/api/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["running"] is False
    assert body["config"] is None
    assert resp.headers["cache-control"] == "no-cache"


def test_status_reflects_running_container(client, fake_container_manager):
    fake_container_manager._running = True
    import vllm_playground.app as app_module

    app_module.current_run_mode = None  # force the "reconnect after restart" path

    resp = client.get("/api/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["running"] is True
    assert body["config"]["run_mode"] == "container"


def test_features_endpoint_shape(client):
    resp = client.get("/api/features")
    assert resp.status_code == 200
    body = resp.json()
    for key in ("version", "vllm_installed", "guidellm", "mcp", "container_mode"):
        assert key in body


def test_features_reports_container_runtime_when_available(client, fake_container_manager):
    resp = client.get("/api/features")
    body = resp.json()
    assert body["container_mode"] is True
    assert body["container_runtime"] == "podman"


def test_hardware_capabilities_returns_200(client):
    resp = client.get("/api/hardware-capabilities")
    assert resp.status_code == 200
    assert isinstance(resp.json(), dict)


def test_gpu_status_returns_200(client):
    resp = client.get("/api/gpu-status")
    assert resp.status_code == 200


def test_debug_connection_without_config(client):
    resp = client.get("/api/debug/connection")
    assert resp.status_code == 200
    body = resp.json()
    assert body["current_run_mode"] is None
    assert "config" not in body
