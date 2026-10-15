"""Unit tests for vllm_playground.decision_models.

Covers the use-case catalog, the mock evaluator (including ask_if skip
behavior), the evaluate() live/mock dispatcher, and the Decision Server
start/stop lifecycle state machine -- with container_manager and the
sidecar process fully mocked, so these never touch podman/docker or spawn
a real subprocess.
"""

import asyncio
from unittest.mock import AsyncMock

import pytest

from vllm_playground import decision_models

# ---------------------------------------------------------------------------
# Use case catalog
# ---------------------------------------------------------------------------


def test_list_use_cases_has_unique_ids_and_required_fields():
    use_cases = decision_models.list_use_cases()
    assert len(use_cases) == 12
    ids = [uc["id"] for uc in use_cases]
    assert len(ids) == len(set(ids))
    for uc in use_cases:
        assert uc["title"]
        assert uc["questions"]
        assert "category" in uc, f"use case {uc['id']} missing 'category' field"
        assert uc["category"] in decision_models.CATEGORY_ORDER, (
            f"use case {uc['id']} has unknown category {uc['category']!r}"
        )


def test_get_use_case_found_and_missing():
    assert decision_models.get_use_case("ticket-routing") is not None
    assert decision_models.get_use_case("does-not-exist") is None


# ---------------------------------------------------------------------------
# Mock evaluator
# ---------------------------------------------------------------------------


def test_mock_evaluate_noul():
    result = decision_models.mock_evaluate("some state", {"q": {"type": "noul", "instructions": "yes?"}})
    assert result["source"] == "mock"
    assert 0.0 <= result["answers"]["q"]["noul"] <= 1.0


def test_mock_evaluate_choice_picks_argmax():
    questions = {
        "q": {
            "type": "choice",
            "instructions": "pick one",
            "criteria": {"a": "desc a", "b": "desc b"},
        }
    }
    result = decision_models.mock_evaluate("state", questions)
    answer = result["answers"]["q"]
    assert answer["choice"] in ("a", "b")
    assert abs(sum(answer["probabilities"].values()) - 1.0) < 1e-6
    assert answer["confidence"] == max(answer["probabilities"].values())


def test_mock_evaluate_score_expected_value_in_range():
    questions = {"q": {"type": "score", "instructions": "rate it", "criteria": ["low", "mid", "high"]}}
    result = decision_models.mock_evaluate("state", questions)
    answer = result["answers"]["q"]
    assert 0.0 <= answer["score"] <= 2.0
    assert answer["legend"] == {"0": "low", "1": "mid", "2": "high"}


def test_mock_evaluate_respects_ask_if_skip():
    questions = {
        "team": {
            "type": "choice",
            "instructions": "which team?",
            "criteria": {"Billing": None, "Technical": None},
        },
        "dup": {
            "type": "noul",
            "instructions": "duplicate charge?",
            "ask_if": {"team": ["NoSuchTeam"]},  # never matches -> always skipped
        },
    }
    result = decision_models.mock_evaluate("state", questions)
    assert result["answers"]["dup"] is None


def test_mock_evaluate_rejects_empty_questions():
    with pytest.raises(ValueError):
        decision_models.mock_evaluate("state", {})


def test_mock_evaluate_rejects_unknown_type():
    with pytest.raises(ValueError):
        decision_models.mock_evaluate("state", {"q": {"type": "bogus", "instructions": "x"}})


def test_mock_evaluate_is_deterministic_for_same_inputs():
    questions = {"q": {"type": "noul", "instructions": "same every time?"}}
    r1 = decision_models.mock_evaluate("state", questions)
    r2 = decision_models.mock_evaluate("state", questions)
    assert r1["answers"]["q"]["noul"] == r2["answers"]["q"]["noul"]


# ---------------------------------------------------------------------------
# evaluate() live/mock dispatch
# ---------------------------------------------------------------------------


def test_evaluate_uses_mock_when_not_ready():
    decision_models._state.phase = "stopped"
    result = asyncio.run(decision_models.evaluate("state", {"q": {"type": "noul", "instructions": "x"}}))
    assert result["source"] == "mock"


def test_evaluate_uses_live_when_ready(monkeypatch):
    decision_models._state.phase = "ready"

    async def fake_live(state, questions):
        return {
            "answers": {"q": {"type": "noul", "noul": 0.9}},
            "source": "live",
            "note": None,
            "timing": {"total_ms": 12.3},
        }

    monkeypatch.setattr(decision_models, "_evaluate_live", fake_live)
    try:
        result = asyncio.run(decision_models.evaluate("state", {"q": {"type": "noul", "instructions": "x"}}))
        assert result["source"] == "live"
    finally:
        decision_models._state.phase = "stopped"


def test_evaluate_falls_back_to_mock_on_live_failure(monkeypatch):
    decision_models._state.phase = "ready"

    async def failing_live(state, questions):
        raise RuntimeError("sidecar unreachable")

    monkeypatch.setattr(decision_models, "_evaluate_live", failing_live)
    try:
        result = asyncio.run(decision_models.evaluate("state", {"q": {"type": "noul", "instructions": "x"}}))
        assert result["source"] == "mock"
        assert "sidecar unreachable" in result["note"]
    finally:
        decision_models._state.phase = "stopped"


# ---------------------------------------------------------------------------
# Decision Server lifecycle (container_manager + sidecar fully mocked)
# ---------------------------------------------------------------------------


class _FakeContainerManager:
    def __init__(self, ready=True, raise_on_start=None):
        self.ready = ready
        self.raise_on_start = raise_on_start
        self.start_calls = []
        self.stop_calls = []
        self.wait_for_ready_calls = []

    async def start_container(self, vllm_config, image=None, wait_ready=False, container_name=None):
        self.start_calls.append({"vllm_config": vllm_config, "image": image, "container_name": container_name})
        if self.raise_on_start:
            raise self.raise_on_start
        return {"id": "fake123", "name": container_name, "status": "started", "image": image, "reused": False}

    async def wait_for_ready(self, port=8000, timeout=120, container_name=None):
        self.wait_for_ready_calls.append({"port": port, "timeout": timeout, "container_name": container_name})
        return {"ready": self.ready, "elapsed_time": 1.0} if self.ready else {"ready": False, "error": "timeout"}

    async def stop_container(self, remove=False, container_name=None):
        self.stop_calls.append({"remove": remove, "container_name": container_name})
        return {"status": "stopped_and_removed"}

    async def get_container_logs_snapshot(self, container_name, tail=200):
        return "fake container crashed: some diagnostic line\n"

    async def get_container_exit_state(self, container_name):
        return {"status": "exited", "exit_code": 1, "error": "fake exit error"}


@pytest.fixture(autouse=True)
def _reset_decision_server_state():
    """Every test starts from a clean, stopped state regardless of execution order."""
    decision_models._state.phase = "stopped"
    decision_models._state.message = "Decision Server is stopped."
    decision_models._state.model_id = None
    decision_models._state.image_tag = None
    decision_models._state.last_error = None
    decision_models._state.sidecar_process = None
    decision_models._state.connection = "managed"
    decision_models._state.remote_url = None
    decision_models._state.remote_api_key = None
    decision_models._state.log_buffer.clear()
    yield
    decision_models._state.phase = "stopped"
    decision_models._state.connection = "managed"
    decision_models._state.remote_url = None
    decision_models._state.remote_api_key = None


def test_get_server_status_defaults_include_remote_model_id():
    """get_server_status() must expose the remote default model so the
    frontend can pre-fill the correct value when Remote mode is selected."""
    status = decision_models.get_server_status()
    assert "defaults" in status
    assert status["defaults"]["model_id"] == decision_models.DEFAULT_MODEL_ID
    assert status["defaults"]["remote_model_id"] == decision_models.DEFAULT_REMOTE_MODEL_ID
    assert status["defaults"]["remote_model_id"] == "jev-latest"


def test_start_decision_server_requires_container_runtime(monkeypatch):
    monkeypatch.setattr(decision_models, "container_manager", None)
    with pytest.raises(RuntimeError, match="container runtime"):
        asyncio.run(decision_models.start_decision_server())
    assert decision_models.get_server_status()["phase"] == "stopped"


def test_start_decision_server_rejects_invalid_canvas_length(monkeypatch):
    monkeypatch.setattr(decision_models, "container_manager", _FakeContainerManager())
    with pytest.raises(ValueError, match="canvas_length"):
        asyncio.run(decision_models.start_decision_server(canvas_length=50))


def test_start_decision_server_builds_extra_args_and_container_name(monkeypatch):
    fake_cm = _FakeContainerManager(ready=True)
    monkeypatch.setattr(decision_models, "container_manager", fake_cm)

    async def fake_sidecar(model_id, canvas_length):
        return None

    monkeypatch.setattr(decision_models, "_start_sidecar", fake_sidecar)

    status = asyncio.run(decision_models.start_decision_server(canvas_length=32))

    assert status["phase"] == "ready"
    assert status["ready"] is True
    assert len(fake_cm.start_calls) == 1
    call = fake_cm.start_calls[0]
    assert call["container_name"] == decision_models.DECISION_CONTAINER_NAME
    assert call["vllm_config"]["port"] == decision_models.DECISION_CONTAINER_PORT
    assert "--diffusion-config" in call["vllm_config"]["extra_args"]
    assert "--enable-prefix-caching" in call["vllm_config"]["extra_args"]
    # Regression guard: wait_for_ready() defaults to polling CONTAINER_NAME
    # ("vllm-service", the *main* vLLM container) when no container_name is
    # passed. Without this, its "is it still running?" check targets an
    # unrelated container and can report false-positive "container_stopped"
    # for a perfectly healthy, still-starting Decision Server -- which then
    # gets killed by our own rollback. Confirmed live on a real GPU VM.
    assert len(fake_cm.wait_for_ready_calls) == 1
    assert fake_cm.wait_for_ready_calls[0]["container_name"] == decision_models.DECISION_CONTAINER_NAME


def test_start_decision_server_rolls_back_container_on_health_failure(monkeypatch):
    fake_cm = _FakeContainerManager(ready=False)
    monkeypatch.setattr(decision_models, "container_manager", fake_cm)

    with pytest.raises(RuntimeError, match="did not become healthy"):
        asyncio.run(decision_models.start_decision_server())

    status = decision_models.get_server_status()
    assert status["phase"] == "error"
    assert status["last_error"]
    # A failed launch shouldn't leave stale config behind for prefill to pick up.
    assert status["model_id"] is None
    assert status["image_tag"] is None
    # Rollback should have stopped the container it just started.
    assert len(fake_cm.stop_calls) == 1
    assert fake_cm.stop_calls[0]["container_name"] == decision_models.DECISION_CONTAINER_NAME
    # The container's own logs must be captured into our buffer *before*
    # rollback removes them -- otherwise a fast-crashing container's actual
    # error is lost forever once `podman rm` runs.
    logs = decision_models.get_server_logs()
    assert any("fake container crashed" in line for line in logs)


def test_start_decision_server_falls_back_to_exit_state_when_no_logs(monkeypatch):
    """A container that fails before its entrypoint ever runs (e.g. a GPU
    device-injection/CDI error) produces no stdout/stderr at all -- in that
    case we should still surface *something* via `podman inspect`'s exit
    state rather than just "(no logs)" and nothing else."""
    fake_cm = _FakeContainerManager(ready=False)
    fake_cm.get_container_logs_snapshot = AsyncMock(return_value="")
    monkeypatch.setattr(decision_models, "container_manager", fake_cm)

    with pytest.raises(RuntimeError, match="did not become healthy"):
        asyncio.run(decision_models.start_decision_server())

    logs = decision_models.get_server_logs()
    assert any("checking exit state instead" in line for line in logs)
    assert any("fake exit error" in line for line in logs)


def test_start_decision_server_rejects_concurrent_start(monkeypatch):
    monkeypatch.setattr(decision_models, "container_manager", _FakeContainerManager())
    decision_models._state.phase = "starting_vllm"
    with pytest.raises(RuntimeError, match="already starting"):
        asyncio.run(decision_models.start_decision_server())


def test_start_decision_server_rejects_when_already_ready(monkeypatch):
    monkeypatch.setattr(decision_models, "container_manager", _FakeContainerManager())
    decision_models._state.phase = "ready"
    with pytest.raises(RuntimeError, match="already running"):
        asyncio.run(decision_models.start_decision_server())


def test_stop_decision_server_resets_state(monkeypatch):
    fake_cm = _FakeContainerManager()
    monkeypatch.setattr(decision_models, "container_manager", fake_cm)
    decision_models._state.phase = "ready"
    decision_models._state.model_id = "some/model"

    status = asyncio.run(decision_models.stop_decision_server())

    assert status["phase"] == "stopped"
    assert status["model_id"] is None
    assert len(fake_cm.stop_calls) == 1


def test_get_server_logs_returns_buffered_lines():
    decision_models._log("line one")
    decision_models._log("line two")
    logs = decision_models.get_server_logs()
    assert logs[-2:] == ["line one", "line two"]


# ---------------------------------------------------------------------------
# Remote Jev endpoint connection
# ---------------------------------------------------------------------------


def test_connect_remote_decision_server_success(fake_aiohttp):
    fake_aiohttp.add("GET", "/health", json_data={"status": "ok"}, status=200)
    fake_aiohttp.add(
        "POST", "/v1/systemone", json_data={"answers": {"_probe": {"type": "noul", "noul": 0.99}}}, status=200
    )

    status = asyncio.run(
        decision_models.connect_remote_decision_server(
            url="https://jev.example.com:8801/v1",
            model_id="google/diffusiongemma-26B-A4B-it",
            api_key="secret",
        )
    )

    assert status["phase"] == "ready"
    assert status["ready"] is True
    assert status["connection"] == "remote"
    # Trailing /v1 is normalized off the stored root.
    assert status["remote_url"] == "https://jev.example.com:8801"
    # The API key is never surfaced in status.
    assert "remote_api_key" not in status
    # /health was probed with a bearer header.
    assert ("GET", "https://jev.example.com:8801/health") in fake_aiohttp.requests
    # Credentials were validated via a probe POST.
    assert ("POST", "https://jev.example.com:8801/v1/systemone") in fake_aiohttp.requests


def test_connect_remote_uses_jev_latest_default(fake_aiohttp):
    """When no model_id is supplied, remote mode should default to jev-latest
    (the official Jev API model alias), not the local DiffusionGemma HF id."""
    fake_aiohttp.add("GET", "/health", json_data={"status": "ok"}, status=200)
    fake_aiohttp.add(
        "POST", "/v1/systemone", json_data={"answers": {"_probe": {"type": "noul", "noul": 0.99}}}, status=200
    )

    status = asyncio.run(
        decision_models.connect_remote_decision_server(
            url="https://api.typesafe.ai",
        )
    )

    assert status["model_id"] == "jev-latest"
    assert status["phase"] == "ready"


def test_connect_remote_rejects_empty_url():
    with pytest.raises(ValueError, match="remote_url is required"):
        asyncio.run(decision_models.connect_remote_decision_server(url=""))
    assert decision_models.get_server_status()["phase"] == "stopped"


def test_connect_remote_rejects_non_http_url():
    with pytest.raises(ValueError, match="http"):
        asyncio.run(decision_models.connect_remote_decision_server(url="ftp://nope"))


def test_connect_remote_rejects_invalid_model():
    with pytest.raises(ValueError, match="Invalid model"):
        asyncio.run(decision_models.connect_remote_decision_server(url="https://jev.example.com", model_id="bad name!"))


def test_connect_remote_unreachable_sets_error_and_resets(fake_aiohttp):
    fake_aiohttp.add("GET", "/health", exception=ConnectionError("dns fail"))

    with pytest.raises(RuntimeError, match="Could not reach"):
        asyncio.run(decision_models.connect_remote_decision_server(url="https://jev.example.com"))

    status = decision_models.get_server_status()
    assert status["phase"] == "error"
    assert status["last_error"]
    # A failed connect must not leave a half-set remote connection behind.
    assert status["connection"] == "managed"
    assert status["remote_url"] is None
    assert status["model_id"] is None


def test_connect_remote_tolerates_missing_health_endpoint(fake_aiohttp):
    # Some deployments don't expose /health; any HTTP response proves the host
    # is reachable, so a 404 should still connect successfully.
    fake_aiohttp.add("GET", "/health", json_data={"error": "not found"}, status=404)
    fake_aiohttp.add(
        "POST", "/v1/systemone", json_data={"answers": {"_probe": {"type": "noul", "noul": 0.99}}}, status=200
    )

    status = asyncio.run(decision_models.connect_remote_decision_server(url="https://jev.example.com"))
    assert status["phase"] == "ready"
    assert status["connection"] == "remote"


def test_connect_remote_rejects_invalid_api_key(fake_aiohttp):
    """A 401 from the probe request should fail the connection with a clear
    authentication error, not silently show 'connected'."""
    fake_aiohttp.add("GET", "/health", json_data={"status": "ok"}, status=200)
    fake_aiohttp.add("POST", "/v1/systemone", json_data={"error": "invalid api key"}, status=401)

    with pytest.raises(RuntimeError, match="Authentication failed"):
        asyncio.run(
            decision_models.connect_remote_decision_server(
                url="https://jev.example.com",
                api_key="bad-key",
            )
        )

    status = decision_models.get_server_status()
    assert status["phase"] == "error"
    assert status["connection"] == "managed"


def test_evaluate_live_remote_posts_to_systemone(fake_aiohttp):
    decision_models._state.phase = "ready"
    decision_models._state.connection = "remote"
    decision_models._state.remote_url = "https://jev.example.com"
    decision_models._state.remote_api_key = "secret"
    decision_models._state.model_id = "google/diffusiongemma-26B-A4B-it"

    fake_aiohttp.add(
        "POST",
        "/v1/systemone",
        json_data={"answers": {"q": {"type": "noul", "noul": 0.8}}},
        status=200,
    )
    try:
        result = asyncio.run(decision_models.evaluate("state", {"q": {"type": "noul", "instructions": "x"}}))
        assert result["source"] == "live"
        assert result["answers"]["q"]["noul"] == 0.8
        assert ("POST", "https://jev.example.com/v1/systemone") in fake_aiohttp.requests
    finally:
        decision_models._state.phase = "stopped"
        decision_models._state.connection = "managed"
        decision_models._state.remote_url = None
        decision_models._state.remote_api_key = None


def test_evaluate_remote_falls_back_to_mock_on_failure(fake_aiohttp):
    decision_models._state.phase = "ready"
    decision_models._state.connection = "remote"
    decision_models._state.remote_url = "https://jev.example.com"

    fake_aiohttp.add("POST", "/v1/systemone", exception=ConnectionError("remote down"))
    try:
        result = asyncio.run(decision_models.evaluate("state", {"q": {"type": "noul", "instructions": "x"}}))
        assert result["source"] == "mock"
        assert "remote down" in result["note"]
    finally:
        decision_models._state.phase = "stopped"
        decision_models._state.connection = "managed"
        decision_models._state.remote_url = None


def test_stop_remote_resets_without_container(monkeypatch):
    fake_cm = _FakeContainerManager()
    monkeypatch.setattr(decision_models, "container_manager", fake_cm)
    decision_models._state.phase = "ready"
    decision_models._state.connection = "remote"
    decision_models._state.remote_url = "https://jev.example.com"
    decision_models._state.model_id = "some/model"

    status = asyncio.run(decision_models.stop_decision_server())

    assert status["phase"] == "stopped"
    assert status["connection"] == "managed"
    assert status["remote_url"] is None
    assert status["model_id"] is None
    # Remote disconnect must not touch the container runtime at all.
    assert len(fake_cm.stop_calls) == 0
