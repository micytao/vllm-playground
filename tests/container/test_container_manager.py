"""Tests for vllm_playground.container_manager.VLLMContainerManager.

Split into two tiers:
1. Pure/offline tests of image selection, tool-parser auto-detection, and
   podman/docker CLI-argument construction -- no container runtime needed.
2. Real (but lightweight) lifecycle tests against an actual `podman`/`docker`
   install, using a throwaway `busybox` container instead of a multi-GB vLLM
   image, to validate the manager's status-parsing and stop/start command
   construction against a real daemon. Skipped automatically when neither
   runtime is available (e.g. a minimal CI runner image).
"""

import shutil
import subprocess

import pytest

from vllm_playground.container_manager import VLLMContainerManager, detect_container_runtime

RUNTIME = detect_container_runtime()


def _runtime_daemon_is_up(runtime):
    """The CLI binary can be installed (satisfying detect_container_runtime())
    while the actual daemon/VM isn't running (e.g. `podman machine` never
    started on macOS dev laptops) -- `info` is a cheap way to tell them apart
    so these tests skip cleanly instead of failing on unrelated dev-machine
    setup issues. CI runners (ubuntu-latest with podman) have a live daemon."""
    if runtime is None:
        return False
    try:
        result = subprocess.run([runtime, "info"], capture_output=True, timeout=5)
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


RUNTIME_DAEMON_UP = _runtime_daemon_is_up(RUNTIME)
requires_runtime = pytest.mark.skipif(
    not RUNTIME_DAEMON_UP, reason="No working podman/docker daemon available (binary present but daemon not running?)"
)


# ---------------------------------------------------------------------------
# Pure / offline logic
# ---------------------------------------------------------------------------


def test_detect_container_runtime_matches_shutil_which():
    if shutil.which("podman"):
        assert detect_container_runtime() == "podman"
    elif shutil.which("docker"):
        assert detect_container_runtime() == "docker"
    else:
        assert detect_container_runtime() is None


@pytest.mark.parametrize(
    "model_name,expected_parser",
    [
        ("meta-llama/Llama-3.1-8B-Instruct", "llama3_json"),
        ("meta-llama/Llama-3.2-1B-Instruct", "llama3_json"),
        ("mistralai/Mistral-7B-Instruct-v0.3", "mistral"),
        # Contains "llama-3" as a substring, so the llama3 check (checked
        # first) wins over the "hermes" name match -- documenting actual
        # (if perhaps surprising) precedence in _detect_tool_call_parser().
        ("NousResearch/Hermes-2-Pro-Llama-3-8B", "llama3_json"),
        ("NousResearch/Hermes-2-Pro-Mistral-7B", "mistral"),
        ("Qwen/Qwen2.5-7B-Instruct", "hermes"),
        ("internlm/internlm2-chat-7b", "internlm"),
        ("ibm-granite/granite-20b-fc", "granite-20b-fc"),
        ("some-org/totally-unknown-model", None),
    ],
)
def test_detect_tool_call_parser(model_name, expected_parser):
    manager = VLLMContainerManager(container_runtime="podman")
    assert manager._detect_tool_call_parser(model_name) == expected_parser


def test_get_default_image_cpu():
    manager = VLLMContainerManager(container_runtime="podman")
    assert manager.get_default_image(use_cpu=True) == manager.DEFAULT_IMAGE_CPU


@pytest.mark.parametrize(
    "accelerator,expected_attr",
    [
        ("nvidia", "DEFAULT_IMAGE_GPU_NVIDIA"),
        ("amd", "DEFAULT_IMAGE_GPU_AMD"),
        ("tpu", "DEFAULT_IMAGE_GPU_TPU"),
    ],
)
def test_get_default_image_gpu(accelerator, expected_attr):
    manager = VLLMContainerManager(container_runtime="podman")
    assert manager.get_default_image(use_cpu=False, accelerator=accelerator) == getattr(manager, expected_attr)


def test_sudo_default_is_platform_dependent(monkeypatch):
    monkeypatch.delenv("VLLM_USE_SUDO", raising=False)
    monkeypatch.setattr("vllm_playground.container_manager.platform.system", lambda: "Darwin")
    assert VLLMContainerManager(container_runtime="podman").use_sudo is False

    monkeypatch.setattr("vllm_playground.container_manager.platform.system", lambda: "Linux")
    assert VLLMContainerManager(container_runtime="podman").use_sudo is True


@pytest.mark.parametrize(
    "env_value,expected", [("false", False), ("0", False), ("no", False), ("true", True), ("1", True)]
)
def test_use_sudo_env_override(monkeypatch, env_value, expected):
    monkeypatch.setenv("VLLM_USE_SUDO", env_value)
    assert VLLMContainerManager(container_runtime="podman").use_sudo is expected


def test_build_container_config_cpu_mode(monkeypatch, tmp_path):
    monkeypatch.setattr("os.path.expanduser", lambda p: str(tmp_path) if p == "~/.cache/huggingface" else p)
    manager = VLLMContainerManager(container_runtime="podman")

    config = manager.build_container_config(
        {"model": "TinyLlama/TinyLlama-1.1B-Chat-v1.0", "port": 8123, "use_cpu": True}
    )

    assert "-e" in config["environment"]
    assert "VLLM_MODEL=TinyLlama/TinyLlama-1.1B-Chat-v1.0" in config["environment"]
    assert "VLLM_TARGET_DEVICE=cpu" in config["environment"]
    assert config["ports"] == ["-p", "8123:8000"]
    assert "--model" in config["vllm_args"]
    assert "TinyLlama/TinyLlama-1.1B-Chat-v1.0" in config["vllm_args"]
    assert "--dtype" in config["vllm_args"]
    assert "bfloat16" in config["vllm_args"]


def test_build_container_config_enables_tool_calling_with_auto_detected_parser(monkeypatch, tmp_path):
    monkeypatch.setattr("os.path.expanduser", lambda p: str(tmp_path) if p == "~/.cache/huggingface" else p)
    manager = VLLMContainerManager(container_runtime="podman")

    config = manager.build_container_config(
        {
            "model": "mistralai/Mistral-7B-Instruct-v0.3",
            "enable_tool_calling": True,
            "use_cpu": True,
        }
    )

    assert "VLLM_ENABLE_AUTO_TOOL_CHOICE=true" in config["environment"]
    assert "VLLM_TOOL_CALL_PARSER=mistral" in config["environment"]
    assert "--enable-auto-tool-choice" in config["vllm_args"]
    assert "mistral" in config["vllm_args"]


def test_build_container_config_served_model_name(monkeypatch, tmp_path):
    monkeypatch.setattr("os.path.expanduser", lambda p: str(tmp_path) if p == "~/.cache/huggingface" else p)
    manager = VLLMContainerManager(container_runtime="podman")

    config = manager.build_container_config(
        {"model": "meta-llama/Llama-3.1-8B-Instruct", "served_model_name": "my-alias"}
    )

    assert "--served-model-name" in config["vllm_args"]
    assert "my-alias" in config["vllm_args"]


# ---------------------------------------------------------------------------
# Real (lightweight) podman/docker lifecycle
# ---------------------------------------------------------------------------


@requires_runtime
class TestRealContainerLifecycle:
    """Exercises get_container_status()/stop_container() against a REAL
    daemon using a throwaway busybox container, so the JSON-parsing and
    stop/remove command construction is validated end-to-end without ever
    pulling a multi-GB vLLM image."""

    CONTAINER_NAME = "vllm-playground-test-container"

    @pytest.fixture(autouse=True)
    def _cleanup(self):
        subprocess.run([RUNTIME, "rm", "-f", self.CONTAINER_NAME], capture_output=True)
        yield
        subprocess.run([RUNTIME, "rm", "-f", self.CONTAINER_NAME], capture_output=True)

    @pytest.fixture()
    def manager(self):
        return VLLMContainerManager(container_runtime=RUNTIME, use_sudo=False)

    @pytest.mark.asyncio
    async def test_status_reports_not_found_when_container_absent(self, manager):
        status = await manager.get_container_status(container_name=self.CONTAINER_NAME)
        assert status["running"] is False

    @pytest.mark.asyncio
    async def test_stop_container_when_absent_is_a_noop(self, manager):
        result = await manager.stop_container(remove=True, container_name=self.CONTAINER_NAME)
        assert result["status"] == "not_running"

    @pytest.mark.asyncio
    async def test_status_and_stop_against_a_real_running_container(self, manager):
        started = subprocess.run(
            [
                RUNTIME,
                "run",
                "-d",
                "--name",
                self.CONTAINER_NAME,
                "docker.io/library/busybox:latest",
                "sleep",
                "300",
            ],
            capture_output=True,
            text=True,
        )
        assert started.returncode == 0, started.stderr

        status = await manager.get_container_status(container_name=self.CONTAINER_NAME)
        assert status["running"] is True
        assert status["name"].lstrip("/") == self.CONTAINER_NAME
        assert status["id"]

        stop_result = await manager.stop_container(remove=True, container_name=self.CONTAINER_NAME)
        assert stop_result["status"] == "stopped_and_removed"

        status_after = await manager.get_container_status(container_name=self.CONTAINER_NAME)
        assert status_after["running"] is False
