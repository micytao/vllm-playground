"""Status parsing for `docker`/`podman ps`.

Docker CLI 20.10 prints the literal word "json" for `ps --format json`.
Docker CLI 23+ and `ps --format '{{json .}}'` print one JSON object per line.
Podman `--format json` prints a JSON array. All three must report a running
container, and a non-JSON probe must not be treated as "container stopped".
"""

import asyncio
import json
from subprocess import CompletedProcess

import pytest

from vllm_playground.container_manager import VLLMContainerManager


def _completed(stdout: str, returncode: int = 0) -> CompletedProcess:
    return CompletedProcess(args=["ps"], returncode=returncode, stdout=stdout, stderr="")


def _install_ps(monkeypatch, manager, stdout: str):
    calls = []

    async def fake_run(*args, **kwargs):
        calls.append(args)
        return _completed(stdout)

    monkeypatch.setattr(manager, "_run_podman_cmd_async", fake_run)
    return calls


@pytest.mark.asyncio
async def test_docker_requests_go_json_template_and_parses_one_object(monkeypatch):
    manager = VLLMContainerManager(container_runtime="docker", use_sudo=False)
    payload = json.dumps(
        {"ID": "abcdef1234567890", "Names": "vllm-service", "State": "running", "Status": "Up 3 seconds"}
    )
    calls = _install_ps(monkeypatch, manager, payload + "\n")

    status = await manager.get_container_status(container_name="vllm-service")

    assert calls[0][calls[0].index("--format") + 1] == "{{json .}}"
    assert status["running"] is True
    assert status["status"] == "running"
    assert status["id"] == "abcdef123456"
    assert status["name"] == "vllm-service"


@pytest.mark.asyncio
async def test_docker_parses_newline_separated_objects(monkeypatch):
    """Docker CLI 23+ `--format json` and `{{json .}}` both emit one object per line."""
    manager = VLLMContainerManager(container_runtime="docker", use_sudo=False)
    lines = "\n".join(
        [
            json.dumps({"ID": "111111111111aaaa", "Names": "other", "State": "running"}),
            json.dumps({"ID": "222222222222bbbb", "Names": "/vllm-service", "State": "running"}),
        ]
    )
    _install_ps(monkeypatch, manager, lines + "\n")

    status = await manager.get_container_status(container_name="vllm-service")

    assert status["running"] is True
    assert status["id"] == "111111111111"
    assert status["name"] == "other"


@pytest.mark.asyncio
async def test_docker_still_parses_a_json_array(monkeypatch):
    manager = VLLMContainerManager(container_runtime="docker", use_sudo=False)
    payload = json.dumps([{"Id": "abcdef1234567890", "Names": ["vllm-service"], "State": "running"}])
    _install_ps(monkeypatch, manager, payload)

    status = await manager.get_container_status(container_name="vllm-service")

    assert status["running"] is True
    assert status["id"] == "abcdef123456"
    assert status["name"] == "vllm-service"


@pytest.mark.asyncio
async def test_podman_keeps_json_keyword_and_parses_array(monkeypatch):
    manager = VLLMContainerManager(container_runtime="podman", use_sudo=False)
    payload = json.dumps([{"Id": "abcdef1234567890", "Names": ["vllm-service"], "State": "running"}])
    calls = _install_ps(monkeypatch, manager, payload)

    status = await manager.get_container_status(container_name="vllm-service")

    assert calls[0][calls[0].index("--format") + 1] == "json"
    assert status["running"] is True
    assert status["status"] == "running"
    assert status["name"] == "vllm-service"


@pytest.mark.asyncio
async def test_podman_parses_newline_separated_objects(monkeypatch):
    manager = VLLMContainerManager(container_runtime="podman", use_sudo=False)
    payload = json.dumps({"Id": "abcdef1234567890", "Names": ["vllm-service"], "State": "running"})
    _install_ps(monkeypatch, manager, payload + "\n")

    status = await manager.get_container_status(container_name="vllm-service")

    assert status["running"] is True
    assert status["id"] == "abcdef123456"


@pytest.mark.asyncio
async def test_literal_json_word_is_a_probe_error(monkeypatch):
    """Docker CLI 20.10's response to `--format json` must not raise or look running."""
    manager = VLLMContainerManager(container_runtime="docker", use_sudo=False)
    _install_ps(monkeypatch, manager, "json\n")

    status = await manager.get_container_status(container_name="vllm-service")

    assert status["running"] is False
    assert status["status"] == "error"
    assert "not JSON" in status["error"]


@pytest.mark.asyncio
async def test_empty_ps_output_is_not_found(monkeypatch):
    manager = VLLMContainerManager(container_runtime="podman", use_sudo=False)
    _install_ps(monkeypatch, manager, "\n")

    status = await manager.get_container_status(container_name="vllm-service")

    assert status == {"running": False, "status": "not_found"}


@pytest.mark.asyncio
async def test_wait_for_ready_retries_status_probe_errors(monkeypatch):
    manager = VLLMContainerManager(container_runtime="docker", use_sudo=False)

    async def fake_status(container_name=None):
        return {"running": False, "status": "error", "error": "container ps output was not JSON"}

    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr(manager, "get_container_status", fake_status)
    monkeypatch.setattr(asyncio, "sleep", no_sleep)

    result = await manager.wait_for_ready(port=9, timeout=0.05)

    assert result["ready"] is False
    assert result["error"] == "timeout"
    assert "not JSON" in result["last_error"]


@pytest.mark.asyncio
async def test_wait_for_ready_still_reports_container_stopped(monkeypatch):
    manager = VLLMContainerManager(container_runtime="podman", use_sudo=False)

    async def fake_status(container_name=None):
        return {"running": False, "status": "not_found"}

    monkeypatch.setattr(manager, "get_container_status", fake_status)

    result = await manager.wait_for_ready(port=9, timeout=5)

    assert result["ready"] is False
    assert result["error"] == "container_stopped"
