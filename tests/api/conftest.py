"""Shared fixtures for FastAPI endpoint tests.

These tests exercise the real ``vllm_playground.app`` FastAPI application
through Starlette's ``TestClient``, but deliberately do **not** enter it as a
context manager -- that would trigger the real ``@app.on_event("startup")``
handler, which starts a background Prometheus-scrape loop and MCP cleanup
task we don't want running during unit-speed API tests. Individual tests
instead opt into exactly the module-level singletons they need
(``instance_registry``, ``container_manager``, ...) via the fixtures below.
"""

import pytest
from fastapi.testclient import TestClient

import vllm_playground.app as app_module
import vllm_playground.backend_registry as backend_registry_module
from vllm_playground.backend_registry import InstanceRegistry

# Every module-level mutable global in app.py that request handlers read
# and/or write, mapped to its true "fresh app" default (mirroring the
# literal initializers in app.py itself). Snapshotting + restoring these
# around each test prevents state leaking between tests (this app was
# written as a singleton service, not with testability in mind, so globals
# are unavoidable).
_APP_GLOBAL_DEFAULTS = {
    "vllm_running": False,
    "current_config": None,
    "server_start_time": None,
    "current_run_mode": None,
    "container_id": None,
    "vllm_process": None,
    "current_model_identifier": None,
    "current_served_model_name": None,
    "current_api_model_id": None,
    "remote_discovered_model_ids": [],
    "remote_model_base_urls": {},
    "benchmark_task": None,
    "benchmark_results": None,
    "latest_vllm_metrics": {},
    "metrics_timestamp": None,
    "_globals_version": 0,
}


@pytest.fixture()
def client():
    """A plain TestClient against the real app, with lifespan NOT triggered."""
    return TestClient(app_module.app)


@pytest.fixture(autouse=True)
def _reset_app_state():
    """Reset app.py globals, the instance registry, and MetricStore state
    before AND after every API test so tests are order-independent."""

    def _reset():
        for key, default in _APP_GLOBAL_DEFAULTS.items():
            # Use a fresh mutable instance each time so tests can't leak
            # references to each other via the same list/dict object.
            fresh_default = (
                list(default)
                if isinstance(default, list)
                else (dict(default) if isinstance(default, dict) else default)
            )
            setattr(app_module, key, fresh_default)
        app_module.metrics_history.clear()
        app_module.metric_store.latest = {}
        app_module.metric_store.history.clear()
        app_module.metric_store.last_scrape = None
        app_module.metric_store.last_simulated = None
        backend_registry_module.instance_registry = None

    _reset()
    yield
    _reset()


@pytest.fixture()
def instance_registry(tmp_path):
    """Install a fresh, isolated InstanceRegistry as the singleton that
    app.py's endpoints read via ``_ir_mod.instance_registry``."""
    registry = InstanceRegistry(state_path=tmp_path / "instances.json")
    backend_registry_module.instance_registry = registry
    yield registry
    backend_registry_module.instance_registry = None


class FakeContainerManager:
    """Minimal stand-in for vllm_playground.container_manager.VLLMContainerManager."""

    def __init__(self):
        self.runtime = "podman"
        self._running = False
        self.started_with = None
        self.stopped = False

    async def get_container_status(self, container_name=None):
        return {
            "running": self._running,
            "status": "running" if self._running else "not_found",
            "id": "fake123" if self._running else None,
            "name": container_name or "vllm-service",
        }

    async def start_container(self, vllm_config, image=None, wait_ready=False, container_name=None):
        self._running = True
        self.started_with = vllm_config
        return {"id": "fake123", "name": container_name or "vllm-service", "status": "started", "image": image}

    async def stop_container(self, remove=False, container_name=None):
        self._running = False
        self.stopped = True
        return {"status": "stopped_and_removed" if remove else "stopped"}


@pytest.fixture()
def fake_container_manager(monkeypatch):
    """Patch vllm_playground.app.container_manager with an in-memory fake and
    mark container mode as available, without needing real Podman/Docker."""
    fake = FakeContainerManager()
    monkeypatch.setattr(app_module, "container_manager", fake)
    monkeypatch.setattr(app_module, "CONTAINER_MODE_AVAILABLE", True)
    return fake
