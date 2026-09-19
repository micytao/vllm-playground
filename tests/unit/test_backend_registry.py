"""Unit tests for vllm_playground.backend_registry.InstanceRegistry.

Covers CRUD, active-pointer semantics, port allocation, save/unsave
persistence, legacy backends.json migration, and startup recovery -- all
without needing a real vLLM process, container, or Kubernetes cluster.
"""

import json
import socket

import pytest

from vllm_playground.backend_registry import InstanceEntry, InstanceRegistry


def make_entry(id_="be-1", **overrides):
    defaults = dict(
        id=id_,
        name="Test Instance",
        model="TinyLlama/TinyLlama-1.1B-Chat-v1.0",
        url="http://localhost:8000",
        port=8000,
        run_mode="subprocess",
    )
    defaults.update(overrides)
    return InstanceEntry(**defaults)


@pytest.fixture()
def registry(tmp_path):
    return InstanceRegistry(state_path=tmp_path / "instances.json")


# ---------------------------------------------------------------------------
# CRUD + active pointer
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_add_get_list(registry):
    entry = make_entry()
    await registry.add(entry)

    fetched = await registry.get("be-1")
    assert fetched is entry

    all_entries = await registry.list_all()
    assert all_entries == [entry]


@pytest.mark.asyncio
async def test_set_active_and_active_property(registry):
    entry = make_entry()
    await registry.add(entry)
    await registry.set_active("be-1")

    assert registry.active_id == "be-1"
    assert registry.active is entry


@pytest.mark.asyncio
async def test_set_active_unknown_id_raises(registry):
    with pytest.raises(ValueError):
        await registry.set_active("does-not-exist")


@pytest.mark.asyncio
async def test_remove_clears_active_pointer(registry):
    entry = make_entry()
    await registry.add(entry)
    await registry.set_active("be-1")

    removed = await registry.remove("be-1")
    assert removed is entry
    assert registry.active_id is None
    assert await registry.get("be-1") is None


@pytest.mark.asyncio
async def test_update_merges_fields(registry):
    await registry.add(make_entry())
    updated = await registry.update("be-1", health="healthy", pid=1234)
    assert updated.health == "healthy"
    assert updated.pid == 1234


@pytest.mark.asyncio
async def test_update_unknown_id_returns_none(registry):
    assert await registry.update("nope", health="healthy") is None


# ---------------------------------------------------------------------------
# Port allocation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_allocate_port_prefers_requested_when_free(registry):
    port = registry.allocate_port(preferred=8123)
    assert port == 8123


@pytest.mark.asyncio
async def test_allocate_port_skips_ports_already_in_use_by_registry(registry):
    await registry.add(make_entry(port=8000))
    port = registry.allocate_port(preferred=8000)
    assert port != 8000


@pytest.mark.asyncio
async def test_allocate_port_skips_os_level_bound_port(registry):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    bound_port = sock.getsockname()[1]
    try:
        port = registry.allocate_port(preferred=bound_port)
        assert port != bound_port
    finally:
        sock.close()


# ---------------------------------------------------------------------------
# Save / unsave + persistence round-trip
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_only_saved_instances_are_persisted(tmp_path):
    state_path = tmp_path / "instances.json"
    registry = InstanceRegistry(state_path=state_path)

    await registry.add(make_entry(id_="be-1", saved=False))
    await registry.add(make_entry(id_="be-2", saved=True))

    on_disk = json.loads(state_path.read_text())
    assert list(on_disk["instances"].keys()) == ["be-2"]


@pytest.mark.asyncio
async def test_save_instance_persists_it(tmp_path):
    state_path = tmp_path / "instances.json"
    registry = InstanceRegistry(state_path=state_path)
    await registry.add(make_entry())

    await registry.save_instance("be-1")

    on_disk = json.loads(state_path.read_text())
    assert "be-1" in on_disk["instances"]


@pytest.mark.asyncio
async def test_unsave_instance_removes_it_from_disk(tmp_path):
    state_path = tmp_path / "instances.json"
    registry = InstanceRegistry(state_path=state_path)
    await registry.add(make_entry(saved=True))

    await registry.unsave_instance("be-1")

    on_disk = json.loads(state_path.read_text())
    assert "be-1" not in on_disk["instances"]
    # Still present in memory.
    assert await registry.get("be-1") is not None


@pytest.mark.asyncio
async def test_load_round_trips_saved_instances(tmp_path):
    state_path = tmp_path / "instances.json"
    registry = InstanceRegistry(state_path=state_path)
    await registry.add(make_entry(saved=True))
    await registry.set_active("be-1")

    reloaded = InstanceRegistry(state_path=state_path)
    reloaded.load()

    entries = await reloaded.list_all()
    assert len(entries) == 1
    assert entries[0].id == "be-1"
    assert entries[0].saved is True
    assert reloaded.active_id == "be-1"


def test_load_migrates_legacy_backends_json(tmp_path):
    legacy_path = tmp_path / "backends.json"
    legacy_path.write_text(
        json.dumps(
            {
                "version": 1,
                "active_id": "be-1",
                "next_id": 2,
                "backends": {
                    "be-1": {
                        "id": "be-1",
                        "name": "Legacy Instance",
                        "url": "http://localhost:8000",
                        "port": 8000,
                        "run_mode": "subprocess",
                    }
                },
            }
        )
    )
    state_path = tmp_path / "instances.json"
    registry = InstanceRegistry(state_path=state_path)
    registry._legacy_path = legacy_path

    registry.load()

    assert registry.active_id == "be-1"
    # Migration should have written the new instances.json.
    assert state_path.exists()
    migrated = json.loads(state_path.read_text())
    assert "be-1" in migrated["instances"]


def test_load_with_missing_file_starts_empty(tmp_path):
    registry = InstanceRegistry(state_path=tmp_path / "does-not-exist.json")
    registry.load()
    assert registry._instances == {}
    assert registry.active_id is None


def test_load_with_corrupted_file_starts_fresh(tmp_path):
    state_path = tmp_path / "instances.json"
    state_path.write_text("{not valid json")
    registry = InstanceRegistry(state_path=state_path)
    registry.load()
    assert registry._instances == {}


def test_load_clears_dangling_active_id(tmp_path):
    state_path = tmp_path / "instances.json"
    state_path.write_text(json.dumps({"version": 2, "active_id": "ghost", "next_id": 1, "instances": {}}))
    registry = InstanceRegistry(state_path=state_path)
    registry.load()
    assert registry.active_id is None


# ---------------------------------------------------------------------------
# Model lookup
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_find_by_model_only_returns_healthy_matches(registry):
    await registry.add(make_entry(id_="be-1", model="model-a", health="healthy"))
    await registry.add(make_entry(id_="be-2", model="model-a", health="unreachable"))
    await registry.add(make_entry(id_="be-3", model="model-b", health="healthy"))

    matches = registry.find_by_model("model-a")
    assert [e.id for e in matches] == ["be-1"]


# ---------------------------------------------------------------------------
# Health checking (network mocked)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_check_health_remote_healthy(registry, fake_aiohttp):
    await registry.add(make_entry(url="http://example.com:8000", run_mode="remote"))
    fake_aiohttp.add("GET", "/v1/models", json_data={"data": []}, status=200)

    health = await registry.check_health("be-1")

    assert health == "healthy"
    entry = await registry.get("be-1")
    assert entry.health == "healthy"
    assert entry.health_checked_at is not None


@pytest.mark.asyncio
async def test_check_health_unreachable_on_connection_error(registry, fake_aiohttp):
    await registry.add(make_entry(url="http://example.com:8000", run_mode="remote"))
    fake_aiohttp.add("GET", "/v1/models", exception=ConnectionError("boom"))

    health = await registry.check_health("be-1")

    assert health == "unreachable"


@pytest.mark.asyncio
async def test_check_health_stopped_instance_short_circuits(registry):
    await registry.add(make_entry(health="stopped"))
    health = await registry.check_health("be-1")
    assert health == "stopped"


@pytest.mark.asyncio
async def test_check_health_unknown_instance(registry):
    assert await registry.check_health("nope") == "unknown"


# ---------------------------------------------------------------------------
# Startup recovery
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_recover_on_startup_marks_dead_subprocess_as_stopped(registry, monkeypatch):
    await registry.add(make_entry(managed=True, run_mode="subprocess", pid=999999, saved=True))

    monkeypatch.setattr(InstanceRegistry, "_is_pid_alive", staticmethod(lambda pid: False))

    await registry.recover_on_startup()

    entry = await registry.get("be-1")
    assert entry.health == "stopped"
    assert entry.pid is None


@pytest.mark.asyncio
async def test_recover_on_startup_keeps_alive_subprocess_running(registry, monkeypatch):
    await registry.add(make_entry(managed=True, run_mode="subprocess", pid=1, port=18123, saved=True))

    monkeypatch.setattr(InstanceRegistry, "_is_pid_alive", staticmethod(lambda pid: True))
    monkeypatch.setattr(InstanceRegistry, "_is_port_responding", staticmethod(lambda port: True))
    monkeypatch.setattr(InstanceRegistry, "start_health_loop", lambda self, iid, interval=15.0: None)

    await registry.recover_on_startup()

    entry = await registry.get("be-1")
    assert entry.health != "stopped"


@pytest.mark.asyncio
async def test_recover_on_startup_marks_remote_as_stopped_pending_reconnect(registry, monkeypatch):
    await registry.add(make_entry(run_mode="remote", managed=False, saved=True))
    monkeypatch.setattr(InstanceRegistry, "start_health_loop", lambda self, iid, interval=15.0: None)

    await registry.recover_on_startup()

    entry = await registry.get("be-1")
    assert entry.health == "stopped"
