"""API tests for the multi-instance registry endpoints (/api/instances/*).

Covers the "Multi-instance backends" major use case: listing, adding a
remote instance, activating, saving/unsaving, deleting, and port allocation.
"""


def test_list_instances_empty_without_registry(client):
    resp = client.get("/api/instances")
    assert resp.status_code == 200
    assert resp.json() == {"instances": [], "active_id": None}


def test_list_instances_returns_registered_entries(client, instance_registry):
    import asyncio

    from vllm_playground.backend_registry import InstanceEntry

    asyncio.run(instance_registry.add(InstanceEntry(id="be-1", name="Local vLLM", url="http://localhost:8000")))

    resp = client.get("/api/instances")
    assert resp.status_code == 200
    body = resp.json()
    assert body["active_id"] is None
    assert len(body["instances"]) == 1
    assert body["instances"][0]["id"] == "be-1"


def test_next_port_without_registry_defaults_to_8000(client):
    resp = client.get("/api/instances/next-port")
    assert resp.status_code == 200
    assert resp.json() == {"port": 8000}


def test_next_port_with_registry_allocates_free_port(client, instance_registry):
    resp = client.get("/api/instances/next-port")
    assert resp.status_code == 200
    assert 8000 <= resp.json()["port"] <= 8100


def test_create_remote_instance_requires_url(client, instance_registry):
    resp = client.post("/api/instances", json={"run_mode": "remote", "name": "My Remote"})
    assert resp.status_code == 400
    assert "URL is required" in resp.json()["detail"]


def test_create_remote_instance_success(client, instance_registry, fake_aiohttp):
    fake_aiohttp.add("GET", "/v1/models", json_data={"data": []}, status=200)

    resp = client.post(
        "/api/instances",
        json={"run_mode": "remote", "name": "My Remote", "url": "http://example.com:8000", "model": "my-model"},
    )
    assert resp.status_code == 200
    backend = resp.json()["backend"]
    assert backend["name"] == "My Remote"
    assert backend["run_mode"] == "remote"
    assert backend["url"] == "http://example.com:8000"


def test_create_managed_instance_not_supported_via_this_endpoint(client, instance_registry):
    resp = client.post("/api/instances", json={"run_mode": "subprocess", "name": "Local"})
    assert resp.status_code == 400
    assert "/api/start" in resp.json()["detail"]


def test_create_instance_without_registry_returns_503(client):
    resp = client.post("/api/instances", json={"run_mode": "remote", "name": "x", "url": "http://x:8000"})
    assert resp.status_code == 503


def test_delete_unknown_instance_returns_404(client, instance_registry):
    resp = client.delete("/api/instances/does-not-exist")
    assert resp.status_code == 404


def test_delete_instance_removes_it(client, instance_registry):
    resp = client.post(
        "/api/instances", json={"run_mode": "remote", "name": "Removable", "url": "http://example.com:9000"}
    )
    backend_id = resp.json()["backend"]["id"]

    del_resp = client.delete(f"/api/instances/{backend_id}")
    assert del_resp.status_code == 200
    assert del_resp.json() == {"status": "removed", "backend_id": backend_id}

    assert client.get("/api/instances").json()["instances"] == []


def test_activate_instance_switches_active_pointer(client, instance_registry):
    create_resp = client.post(
        "/api/instances", json={"run_mode": "remote", "name": "Target", "url": "http://example.com:9100"}
    )
    backend_id = create_resp.json()["backend"]["id"]

    activate_resp = client.post(f"/api/instances/{backend_id}/activate")
    assert activate_resp.status_code == 200

    assert client.get("/api/instances").json()["active_id"] == backend_id


def test_save_and_unsave_instance(client, instance_registry, tmp_path):
    create_resp = client.post(
        "/api/instances", json={"run_mode": "remote", "name": "Saveable", "url": "http://example.com:9200"}
    )
    backend_id = create_resp.json()["backend"]["id"]

    save_resp = client.post(f"/api/instances/{backend_id}/save")
    assert save_resp.status_code == 200

    import json

    on_disk = json.loads((tmp_path / "instances.json").read_text())
    assert backend_id in on_disk["instances"]

    unsave_resp = client.post(f"/api/instances/{backend_id}/unsave")
    assert unsave_resp.status_code == 200

    on_disk = json.loads((tmp_path / "instances.json").read_text())
    assert backend_id not in on_disk["instances"]


def test_instance_logs_empty_by_default(client):
    resp = client.get("/api/instances/some-id/logs")
    assert resp.status_code == 200
    assert resp.json() == {"instance_id": "some-id", "logs": []}
