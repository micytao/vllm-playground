"""Unit tests for vllm_playground.decision_models.

Covers the use-case catalog, the mock evaluator (including ask_if skip
behavior), the evaluate() live/mock dispatcher, and the Decision Server
start/stop lifecycle state machine -- with container_manager and the
sidecar process fully mocked, so these never touch podman/docker or spawn
a real subprocess.
"""

import asyncio

import pytest

from vllm_playground import decision_models

# ---------------------------------------------------------------------------
# Use case catalog
# ---------------------------------------------------------------------------


def test_list_use_cases_has_unique_ids_and_required_fields():
    use_cases = decision_models.list_use_cases()
    assert len(use_cases) == 7
    ids = [uc["id"] for uc in use_cases]
    assert len(ids) == len(set(ids))
    for uc in use_cases:
        assert uc["title"]
        assert uc["questions"]


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

    async def start_container(self, vllm_config, image=None, wait_ready=False, container_name=None):
        self.start_calls.append({"vllm_config": vllm_config, "image": image, "container_name": container_name})
        if self.raise_on_start:
            raise self.raise_on_start
        return {"id": "fake123", "name": container_name, "status": "started", "image": image, "reused": False}

    async def wait_for_ready(self, port=8000, timeout=120):
        return {"ready": self.ready, "elapsed_time": 1.0} if self.ready else {"ready": False, "error": "timeout"}

    async def stop_container(self, remove=False, container_name=None):
        self.stop_calls.append({"remove": remove, "container_name": container_name})
        return {"status": "stopped_and_removed"}

    async def get_container_logs_snapshot(self, container_name, tail=200):
        return "fake container crashed: some diagnostic line\n"


@pytest.fixture(autouse=True)
def _reset_decision_server_state():
    """Every test starts from a clean, stopped state regardless of execution order."""
    decision_models._state.phase = "stopped"
    decision_models._state.message = "Decision Server is stopped."
    decision_models._state.model_id = None
    decision_models._state.image_tag = None
    decision_models._state.last_error = None
    decision_models._state.sidecar_process = None
    decision_models._state.log_buffer.clear()
    yield
    decision_models._state.phase = "stopped"


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
