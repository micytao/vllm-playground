"""Unit tests for vllm_playground.settings_store.SettingsStore.

Pure filesystem-backed logic, no mocks needed beyond a tmp_path config file.
"""

import json

import pytest

from vllm_playground.settings_store import DEFAULTS, SettingsStore


@pytest.fixture()
def store_path(tmp_path):
    return tmp_path / "settings.json"


def test_get_returns_defaults_when_no_file(store_path):
    store = SettingsStore(config_path=store_path)
    assert store.get() == DEFAULTS
    # No file should have been created just by reading defaults.
    assert not store_path.exists()


def test_update_persists_known_keys(store_path):
    store = SettingsStore(config_path=store_path)
    result = store.update({"theme": "light", "locale": "fr"})

    assert result["theme"] == "light"
    assert result["locale"] == "fr"
    # Unrelated defaults remain untouched.
    assert result["vllm_run_mode"] == DEFAULTS["vllm_run_mode"]

    assert store_path.exists()
    on_disk = json.loads(store_path.read_text())
    assert on_disk["theme"] == "light"


def test_update_ignores_unknown_keys(store_path):
    store = SettingsStore(config_path=store_path)
    result = store.update({"theme": "light", "totally_unknown_key": "sneaky"})

    assert "totally_unknown_key" not in result
    on_disk = json.loads(store_path.read_text())
    assert "totally_unknown_key" not in on_disk


def test_settings_round_trip_across_instances(store_path):
    SettingsStore(config_path=store_path).update({"theme": "light"})

    # A fresh SettingsStore instance pointed at the same file should load
    # the persisted value back.
    reloaded = SettingsStore(config_path=store_path)
    assert reloaded.get()["theme"] == "light"


def test_corrupted_settings_file_falls_back_to_defaults(store_path):
    store_path.write_text("{not valid json::")

    store = SettingsStore(config_path=store_path)
    assert store.get() == DEFAULTS

    # A .json.bak backup of the corrupted file should have been created.
    backup_path = store_path.with_suffix(".json.bak")
    assert backup_path.exists()
    assert backup_path.read_text() == "{not valid json::"


def test_non_dict_json_is_ignored(store_path):
    store_path.write_text(json.dumps(["not", "a", "dict"]))

    store = SettingsStore(config_path=store_path)
    assert store.get() == DEFAULTS


def test_image_override_keys_round_trip(store_path):
    store = SettingsStore(config_path=store_path)
    result = store.update({"image_override_cpu": "docker.io/vllm/vllm-openai-cpu:v0.30.0"})
    assert result["image_override_cpu"] == "docker.io/vllm/vllm-openai-cpu:v0.30.0"


def test_default_config_path_uses_home(isolated_home):
    """When no config_path is given, SettingsStore should use ~/.vllm-playground/settings.json."""
    store = SettingsStore()
    expected = isolated_home / ".vllm-playground" / "settings.json"
    assert store.config_path == expected
    assert (isolated_home / ".vllm-playground").is_dir()
