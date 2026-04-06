"""
Instance Registry for Multi-Instance vLLM Support

Tracks all known vLLM instances (subprocess, container, remote) with an
"active pointer" model.  The existing app.py globals remain untouched;
activating an instance re-points them to the selected one.

Two-tier persistence:
  - Transient instances (saved=False): in-memory only, lost on restart.
  - Saved instances (saved=True):  written to ~/.vllm-playground/backends.json
    and recovered on startup.

Persistence file: ~/.vllm-playground/instances.json
"""

import asyncio
import json
import logging
import os
import signal
import socket
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_PERSISTENCE_VERSION = 2
_PORT_RANGE_START = 8000
_PORT_RANGE_END = 8100


def _normalize_remote_root_url(url: str) -> str:
    """Match app.py ``normalize_vllm_remote_root_url`` (avoid importing app here)."""
    u = (url or "").strip().rstrip("/")
    if len(u) >= 3 and u.lower().endswith("/v1"):
        return u[:-3].rstrip("/")
    return u


@dataclass
class InstanceEntry:
    """Represents a single vLLM instance (running or stopped)."""

    id: str
    name: str
    model: Optional[str] = None
    url: str = "http://localhost:8000"
    port: int = 8000
    api_key: Optional[str] = None
    run_mode: Optional[str] = None
    managed: bool = False
    pid: Optional[int] = None
    container_name: Optional[str] = None
    gpu_devices: Optional[List[int]] = None
    config: Optional[Dict[str, Any]] = None
    health: str = "unknown"
    health_checked_at: Optional[str] = None
    created_at: Optional[str] = None
    saved: bool = False

    # In-memory only (not persisted) -- subprocess process handle
    _process: Optional[Any] = field(default=None, repr=False, compare=False)

    def to_dict(self) -> Dict[str, Any]:
        """Serialize for JSON persistence. Excludes in-memory-only fields."""
        return {f.name: getattr(self, f.name) for f in self.__dataclass_fields__.values() if f.name != "_process"}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "InstanceEntry":
        data.pop("_process", None)
        known_fields = {f.name for f in cls.__dataclass_fields__.values() if f.name != "_process"}
        filtered = {k: v for k, v in data.items() if k in known_fields}
        entry = cls(**filtered)
        if entry.run_mode == "remote" and entry.url:
            entry.url = _normalize_remote_root_url(entry.url)
        return entry


# Keep old name as alias so existing imports still work during migration
BackendEntry = InstanceEntry


class InstanceRegistry:
    """
    Registry of all vLLM instances.

    Thread-safety: all mutating operations acquire ``_lock``.
    The lock is async-only (this class is designed for the FastAPI event loop).
    """

    def __init__(self, state_path: Optional[Path] = None):
        self._instances: Dict[str, InstanceEntry] = {}
        self._active_id: Optional[str] = None
        self._lock = asyncio.Lock()
        self._next_id = 1
        self._health_tasks: Dict[str, asyncio.Task] = {}

        if state_path is None:
            config_dir = Path.home() / ".vllm-playground"
            config_dir.mkdir(parents=True, exist_ok=True)
            self._state_path = config_dir / "instances.json"
            self._legacy_path = config_dir / "backends.json"
        else:
            self._state_path = state_path
            self._legacy_path = None

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    async def add(self, entry: InstanceEntry) -> InstanceEntry:
        async with self._lock:
            self._instances[entry.id] = entry
            self._save()
        return entry

    async def get(self, instance_id: str) -> Optional[InstanceEntry]:
        return self._instances.get(instance_id)

    async def list_all(self) -> List[InstanceEntry]:
        return list(self._instances.values())

    async def update(self, instance_id: str, **kwargs: Any) -> Optional[InstanceEntry]:
        async with self._lock:
            entry = self._instances.get(instance_id)
            if entry is None:
                return None
            for key, value in kwargs.items():
                if key == "_process":
                    entry._process = value
                elif hasattr(entry, key):
                    setattr(entry, key, value)
            self._save()
        return entry

    async def remove(self, instance_id: str) -> Optional[InstanceEntry]:
        async with self._lock:
            entry = self._instances.pop(instance_id, None)
            if entry is not None:
                if self._active_id == instance_id:
                    self._active_id = None
                self._save()
            health_task = self._health_tasks.pop(instance_id, None)
            if health_task and not health_task.done():
                health_task.cancel()
        return entry

    # ------------------------------------------------------------------
    # Active pointer
    # ------------------------------------------------------------------

    @property
    def active_id(self) -> Optional[str]:
        return self._active_id

    @property
    def active(self) -> Optional[InstanceEntry]:
        if self._active_id:
            return self._instances.get(self._active_id)
        return None

    async def set_active(self, instance_id: Optional[str]) -> None:
        async with self._lock:
            if instance_id is not None and instance_id not in self._instances:
                raise ValueError(f"Instance {instance_id} not found")
            self._active_id = instance_id
            self._save()

    # ------------------------------------------------------------------
    # Save / unsave (explicit persistence)
    # ------------------------------------------------------------------

    async def save_instance(self, instance_id: str) -> Optional[InstanceEntry]:
        """Mark an instance as saved so it persists to disk."""
        async with self._lock:
            entry = self._instances.get(instance_id)
            if entry is None:
                return None
            entry.saved = True
            self._save()
        return entry

    async def unsave_instance(self, instance_id: str) -> Optional[InstanceEntry]:
        """Remove the saved flag; the instance stays in-memory but is removed from disk."""
        async with self._lock:
            entry = self._instances.get(instance_id)
            if entry is None:
                return None
            entry.saved = False
            self._save()
        return entry

    # ------------------------------------------------------------------
    # ID generation
    # ------------------------------------------------------------------

    def _generate_id(self) -> str:
        while True:
            candidate = f"be-{self._next_id}"
            self._next_id += 1
            if candidate not in self._instances:
                return candidate

    # ------------------------------------------------------------------
    # Port allocation
    # ------------------------------------------------------------------

    def allocate_port(self, preferred: Optional[int] = None) -> int:
        """Find a free port, preferring *preferred* if given and available."""
        used_ports = {e.port for e in self._instances.values()}

        if preferred and preferred not in used_ports and self._is_port_free(preferred):
            return preferred

        for port in range(_PORT_RANGE_START, _PORT_RANGE_END):
            if port not in used_ports and self._is_port_free(port):
                return port

        raise RuntimeError(f"No free ports in range {_PORT_RANGE_START}-{_PORT_RANGE_END}")

    @staticmethod
    def _is_port_free(port: int) -> bool:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", port))
                return True
        except OSError:
            return False

    # ------------------------------------------------------------------
    # Health checking
    # ------------------------------------------------------------------

    async def check_health(self, instance_id: str) -> str:
        entry = self._instances.get(instance_id)
        if entry is None:
            return "unknown"

        if entry.health == "stopped":
            return "stopped"

        root = _normalize_remote_root_url(entry.url)
        health_url = f"{root}/health"
        health = "unreachable"
        try:
            import aiohttp

            headers = {}
            if entry.api_key:
                headers["Authorization"] = f"Bearer {entry.api_key}"

            timeout = aiohttp.ClientTimeout(total=5)
            async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
                async with session.get(health_url) as response:
                    if response.status == 200:
                        health = "healthy"
                    elif entry.run_mode == "remote":
                        # LiteLLM / some ingresses do not expose /health; OpenAI /v1/models often works.
                        async with session.get(f"{root}/v1/models", headers=headers) as r2:
                            health = "healthy" if r2.status == 200 else "unhealthy"
                    else:
                        health = "unhealthy"
        except Exception:
            health = "unreachable"

        await self.update(
            instance_id,
            health=health,
            health_checked_at=datetime.now().isoformat(),
        )
        return health

    async def check_all_health(self) -> Dict[str, str]:
        results = {}
        tasks = []
        for iid in list(self._instances.keys()):
            tasks.append((iid, self.check_health(iid)))
        for iid, coro in tasks:
            results[iid] = await coro
        return results

    def start_health_loop(self, instance_id: str, interval: float = 15.0) -> None:
        """Start a periodic health check for an instance."""
        if instance_id in self._health_tasks:
            task = self._health_tasks[instance_id]
            if not task.done():
                return

        async def _loop() -> None:
            while instance_id in self._instances:
                try:
                    await self.check_health(instance_id)
                except Exception as e:
                    logger.debug(f"Health check error for {instance_id}: {e}")
                await asyncio.sleep(interval)

        self._health_tasks[instance_id] = asyncio.create_task(_loop())

    def stop_health_loop(self, instance_id: str) -> None:
        task = self._health_tasks.pop(instance_id, None)
        if task and not task.done():
            task.cancel()

    # ------------------------------------------------------------------
    # Lifecycle: launch / stop (independent of app.py globals)
    # ------------------------------------------------------------------

    async def launch_subprocess(
        self,
        name: str,
        vllm_cmd: List[str],
        env: Optional[Dict[str, str]] = None,
        port: Optional[int] = None,
        gpu_devices: Optional[List[int]] = None,
        config: Optional[Dict[str, Any]] = None,
        model: Optional[str] = None,
    ) -> InstanceEntry:
        """
        Launch a vLLM subprocess independently of app.py globals.

        *vllm_cmd* should be the fully-built command list (same format as
        what ``start_server`` constructs). The caller is responsible for
        building the command; this method just executes it.
        """
        allocated_port = self.allocate_port(preferred=port)
        entry_id = self._generate_id()

        proc_env = os.environ.copy()
        if env:
            proc_env.update(env)
        if gpu_devices is not None:
            proc_env["CUDA_VISIBLE_DEVICES"] = ",".join(str(d) for d in gpu_devices)

        process = await asyncio.create_subprocess_exec(
            *vllm_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=proc_env,
        )

        entry = InstanceEntry(
            id=entry_id,
            name=name,
            model=model,
            url=f"http://localhost:{allocated_port}",
            port=allocated_port,
            run_mode="subprocess",
            managed=True,
            pid=process.pid,
            gpu_devices=gpu_devices,
            config=config,
            health="unknown",
            created_at=datetime.now().isoformat(),
        )
        entry._process = process

        await self.add(entry)
        self.start_health_loop(entry_id)
        logger.info(f"Launched subprocess instance {entry_id} (PID {process.pid}) on port {allocated_port}")
        return entry

    async def launch_container(
        self,
        name: str,
        container_manager: Any,
        vllm_config: Dict[str, Any],
        port: Optional[int] = None,
        gpu_devices: Optional[List[int]] = None,
        config: Optional[Dict[str, Any]] = None,
        model: Optional[str] = None,
    ) -> InstanceEntry:
        """
        Launch a vLLM container independently of app.py globals.

        Delegates to container_manager.start_container() with a unique
        container name and port mapping.
        """
        allocated_port = self.allocate_port(preferred=port)
        entry_id = self._generate_id()
        cname = f"vllm-service-{entry_id}"

        vllm_config_copy = dict(vllm_config)
        vllm_config_copy["port"] = allocated_port
        if gpu_devices is not None:
            vllm_config_copy["gpu_device"] = ",".join(str(d) for d in gpu_devices)

        container_info = await container_manager.start_container(
            vllm_config_copy,
            container_name=cname,
        )

        entry = InstanceEntry(
            id=entry_id,
            name=name,
            model=model,
            url=f"http://localhost:{allocated_port}",
            port=allocated_port,
            run_mode="container",
            managed=True,
            container_name=cname,
            gpu_devices=gpu_devices,
            config=config,
            health="unknown",
            created_at=datetime.now().isoformat(),
        )

        await self.add(entry)
        self.start_health_loop(entry_id)
        logger.info(f"Launched container instance {entry_id} ({cname}) on port {allocated_port}")
        return entry

    async def add_remote(
        self,
        name: str,
        url: str,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
    ) -> InstanceEntry:
        """Register an externally-managed remote vLLM server."""
        entry_id = self._generate_id()

        norm_url = _normalize_remote_root_url(url)
        parsed_port = 8000
        try:
            from urllib.parse import urlparse

            parsed = urlparse(norm_url)
            if parsed.port:
                parsed_port = parsed.port
        except Exception:
            pass

        entry = InstanceEntry(
            id=entry_id,
            name=name,
            model=model,
            url=norm_url,
            port=parsed_port,
            api_key=api_key,
            run_mode="remote",
            managed=False,
            health="unknown",
            created_at=datetime.now().isoformat(),
        )

        await self.add(entry)
        self.start_health_loop(entry_id)
        logger.info(f"Registered remote instance {entry_id} at {url}")
        return entry

    async def stop_instance(self, instance_id: str) -> bool:
        """Stop a managed instance (subprocess or container). Returns True if stopped."""
        entry = self._instances.get(instance_id)
        if entry is None:
            return False

        self.stop_health_loop(instance_id)

        if entry.managed and entry.run_mode == "subprocess":
            await self._stop_subprocess(entry)
        elif entry.managed and entry.run_mode == "container":
            await self._stop_container(entry)

        await self.update(instance_id, health="stopped", pid=None)
        return True

    # Keep old name as alias for callers that haven't been updated yet
    async def stop_backend(self, instance_id: str) -> bool:
        return await self.stop_instance(instance_id)

    async def _stop_subprocess(self, entry: InstanceEntry) -> None:
        process = entry._process
        if process and process.returncode is None:
            try:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), timeout=10)
                except asyncio.TimeoutError:
                    process.kill()
                    await process.wait()
                logger.info(f"Stopped subprocess {entry.id} (PID {entry.pid})")
            except Exception as e:
                logger.error(f"Error stopping subprocess {entry.id}: {e}")
        elif entry.pid:
            try:
                os.kill(entry.pid, signal.SIGTERM)
                logger.info(f"Sent SIGTERM to PID {entry.pid} for instance {entry.id}")
            except ProcessLookupError:
                logger.debug(f"PID {entry.pid} already gone for instance {entry.id}")
            except Exception as e:
                logger.error(f"Error killing PID {entry.pid}: {e}")
        entry._process = None

    async def _stop_container(self, entry: InstanceEntry) -> None:
        if not entry.container_name:
            return
        try:
            from . import container_manager as cm_module

            if hasattr(cm_module, "container_manager") and cm_module.container_manager:
                await cm_module.container_manager.stop_container(
                    remove=False,
                    container_name=entry.container_name,
                )
                logger.info(f"Stopped container {entry.container_name} for instance {entry.id}")
        except Exception as e:
            logger.error(f"Error stopping container for {entry.id}: {e}")

    # ------------------------------------------------------------------
    # Model lookup (for /v1/ proxy routing)
    # ------------------------------------------------------------------

    def find_by_model(self, model_name: str) -> List[InstanceEntry]:
        return [e for e in self._instances.values() if e.model == model_name and e.health == "healthy"]

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def _save(self) -> None:
        """Persist registry state to disk.  Caller must hold _lock.

        Only entries with ``saved=True`` are written.  The active_id is only
        persisted when it points to a saved entry (avoids dangling pointers).
        """
        try:
            self._state_path.parent.mkdir(parents=True, exist_ok=True)

            saved_entries = {iid: entry.to_dict() for iid, entry in self._instances.items() if entry.saved}

            persisted_active = self._active_id if self._active_id and self._active_id in saved_entries else None

            payload = {
                "version": _PERSISTENCE_VERSION,
                "active_id": persisted_active,
                "next_id": self._next_id,
                "instances": saved_entries,
            }
            tmp_path = self._state_path.with_suffix(".json.tmp")
            with open(tmp_path, "w") as f:
                json.dump(payload, f, indent=2)
            tmp_path.replace(self._state_path)
        except Exception as e:
            logger.error(f"Failed to save instance registry: {e}")

    def load(self) -> None:
        """Load registry state from disk.  Called once at startup.

        Tries ``instances.json`` first.  Falls back to the legacy
        ``backends.json`` for migration from older versions.
        """
        load_path = None
        if self._state_path.exists():
            load_path = self._state_path
        elif self._legacy_path and self._legacy_path.exists():
            load_path = self._legacy_path
            logger.info(f"Migrating from legacy {self._legacy_path.name}")

        if load_path is None:
            logger.info("No instances.json found, starting with empty registry")
            return

        try:
            with open(load_path, "r") as f:
                data = json.load(f)

            if not isinstance(data, dict):
                logger.warning(f"{load_path.name} is not a dict, starting fresh")
                return

            version = data.get("version", 1)
            if version not in (1, 2):
                logger.warning(f"{load_path.name} has unsupported version {version}, starting fresh")
                return

            self._active_id = data.get("active_id")
            self._next_id = data.get("next_id", 1)

            # Support both old ("backends") and new ("instances") keys
            raw_entries = data.get("instances") or data.get("backends") or {}

            for iid, entry_data in raw_entries.items():
                try:
                    entry = InstanceEntry.from_dict(entry_data)
                    entry.saved = True  # everything on disk is considered saved
                    self._instances[iid] = entry
                except Exception as e:
                    logger.warning(f"Skipping corrupted instance entry {iid}: {e}")

            # Validate active_id
            if self._active_id and self._active_id not in self._instances:
                logger.warning(f"active_id '{self._active_id}' not found in loaded instances, clearing")
                self._active_id = None

            logger.info(f"Loaded {len(self._instances)} instance(s) from {load_path}")

            # If we migrated from legacy, persist to the new path immediately
            if load_path != self._state_path and self._instances:
                self._save()
                logger.info(f"Migrated registry to {self._state_path.name}")
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning(f"Corrupted {load_path.name}, starting fresh: {e}")
        except Exception as e:
            logger.error(f"Failed to load {load_path.name}: {e}")

    async def recover_on_startup(self) -> None:
        """
        Probe each loaded (saved) instance to see if it's still alive.

        - Alive: keep as running, start health loop.
        - Dead:  keep as ``stopped`` (do NOT remove saved instances).
        - Remote: start health loop to probe.
        """
        for iid, entry in list(self._instances.items()):
            if entry.managed and entry.run_mode == "subprocess":
                alive = self._is_pid_alive(entry.pid) if entry.pid else False
                if alive and self._is_port_responding(entry.port):
                    logger.info(f"Recovered subprocess instance {iid} (PID {entry.pid})")
                    self.start_health_loop(iid)
                else:
                    logger.info(f"Subprocess instance {iid} is gone, marking as stopped")
                    entry.health = "stopped"
                    entry.pid = None
                    entry._process = None

            elif entry.managed and entry.run_mode == "container":
                running = await self._is_container_running(entry.container_name)
                if running:
                    logger.info(f"Recovered container instance {iid} ({entry.container_name})")
                    self.start_health_loop(iid)
                else:
                    logger.info(f"Container instance {iid} is gone, marking as stopped")
                    entry.health = "stopped"

            elif entry.run_mode == "remote":
                logger.info(f"Remote instance {iid} marked as stopped until user reconnects")
                entry.health = "stopped"

        self._save()

    @staticmethod
    def _is_pid_alive(pid: int) -> bool:
        try:
            os.kill(pid, 0)
            return True
        except (ProcessLookupError, PermissionError):
            return False

    @staticmethod
    def _is_port_responding(port: int) -> bool:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(2)
                s.connect(("127.0.0.1", port))
                return True
        except (ConnectionRefusedError, OSError):
            return False

    @staticmethod
    async def _is_container_running(container_name: Optional[str]) -> bool:
        if not container_name:
            return False
        try:
            from . import container_manager as cm_module

            if hasattr(cm_module, "container_manager") and cm_module.container_manager:
                status = await cm_module.container_manager.get_container_status(container_name=container_name)
                return status.get("running", False)
        except Exception:
            pass
        return False

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------

    async def shutdown(self) -> None:
        """Stop all health loops and managed instances. Called on app shutdown."""
        for iid in list(self._health_tasks.keys()):
            self.stop_health_loop(iid)

        for iid, entry in list(self._instances.items()):
            if entry.managed:
                try:
                    await self.stop_instance(iid)
                except Exception as e:
                    logger.error(f"Error stopping instance {iid} during shutdown: {e}")

        self._save()


# Keep old names as aliases for backward compatibility
BackendRegistry = InstanceRegistry

# Module-level singleton (initialized by app.py on startup)
backend_registry: Optional[InstanceRegistry] = None
instance_registry: Optional[InstanceRegistry] = None
