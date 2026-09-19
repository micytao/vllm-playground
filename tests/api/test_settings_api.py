"""API tests for /api/settings and /api/settings/image-catalog.

Covers the recently-added Settings > Container Images feature
(image_catalog.py + settings_store.py wiring inside app.py).
"""

import vllm_playground.app as app_module
from vllm_playground import image_catalog


def test_get_settings_returns_defaults(client, tmp_path, monkeypatch):
    from vllm_playground.settings_store import SettingsStore

    monkeypatch.setattr(app_module, "settings_store", SettingsStore(config_path=tmp_path / "settings.json"))

    resp = client.get("/api/settings")
    assert resp.status_code == 200
    assert resp.json()["theme"] == "dark"


def test_post_settings_persists_update(client, tmp_path, monkeypatch):
    from vllm_playground.settings_store import SettingsStore

    monkeypatch.setattr(app_module, "settings_store", SettingsStore(config_path=tmp_path / "settings.json"))

    resp = client.post("/api/settings", json={"theme": "light"})
    assert resp.status_code == 200
    assert resp.json()["theme"] == "light"

    # Persisted -- a second GET reflects it too.
    assert client.get("/api/settings").json()["theme"] == "light"


def test_post_settings_rejects_invalid_custom_image_tag(client, tmp_path, monkeypatch):
    from vllm_playground.settings_store import SettingsStore

    monkeypatch.setattr(app_module, "settings_store", SettingsStore(config_path=tmp_path / "settings.json"))

    resp = client.post("/api/settings", json={"image_override_cpu": "v0.29.0; rm -rf /"})
    assert resp.status_code == 400
    assert "Invalid image reference" in resp.json()["detail"]


def test_post_settings_accepts_valid_custom_image_tag(client, tmp_path, monkeypatch):
    from vllm_playground.settings_store import SettingsStore

    monkeypatch.setattr(app_module, "settings_store", SettingsStore(config_path=tmp_path / "settings.json"))

    resp = client.post("/api/settings", json={"image_override_cpu": "docker.io/vllm/vllm-openai-cpu:v0.30.0"})
    assert resp.status_code == 200
    assert resp.json()["image_override_cpu"] == "docker.io/vllm/vllm-openai-cpu:v0.30.0"


def test_image_catalog_endpoint_merges_overrides(client, tmp_path, monkeypatch, fake_aiohttp):
    from vllm_playground.settings_store import SettingsStore

    store = SettingsStore(config_path=tmp_path / "settings.json")
    store.update({"image_override_cpu": "docker.io/vllm/vllm-openai-cpu:v0.30.0"})
    monkeypatch.setattr(app_module, "settings_store", store)

    for entry in image_catalog.IMAGE_REPOS.values():
        url = image_catalog.DOCKER_HUB_TAGS_URL.format(repo=entry["repo"])
        fake_aiohttp.add("GET", url, json_data={"results": [{"name": entry["default_tag"]}]})
    image_catalog._cache.clear()

    resp = client.get("/api/settings/image-catalog")
    assert resp.status_code == 200
    body = resp.json()

    assert body["image_override_cpu"]["current_override"] == "docker.io/vllm/vllm-openai-cpu:v0.30.0"
    assert body["image_override_gpu_nvidia"]["current_override"] == ""
    assert set(body.keys()) == set(image_catalog.IMAGE_REPOS.keys())
