"""
Decision Models (Experimental)

Backend for the "Decision Models" tab: a sandbox for exploring vLLM's native
structured-read decision capability -- seeding a diffusion model's canvas
with an answer template and reading calibrated per-slot probabilities from a
single denoise step, instead of generating free text. See:
  - vLLM PR #57250 (structured-read / diffusion canvas reads)
  - https://docs.vllm.ai/en/latest/examples/features/structured_diffusion/
  - https://developers.redhat.com/articles/2026/09/28/run-decision-model-vllm-and-red-hat-ai

This module is intentionally standalone (no dependency on app.py globals) so
it can be unit tested in isolation, following the same pattern as
image_catalog.py.

Phase 1 (current): USE_CASES catalog + a deterministic-but-randomized MOCK
evaluator, so the tab's gallery and question/result UI can be built and
reviewed without a GPU or a nightly vLLM build. Every mock response is
tagged ``"source": "mock"`` and carries a human-readable note, mirroring the
existing Observability dashboard's "SIMULATED" badge pattern -- never a
silent fake result.

Later phases wire evaluate() to a real locally-managed vLLM nightly
DiffusionGemma instance + vendored structured_server.py sidecar; this module
is where that real proxy call will be added, behind the same function
signature, so the frontend contract never has to change.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import random
import subprocess
import sys
import time
from collections import deque
from pathlib import Path
from typing import Any, Dict, List, Optional

from .container_manager import container_manager

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Use case catalog
# ---------------------------------------------------------------------------
# Each use case is a self-contained "System One"-shaped example: a sample
# ``state`` and a map of named ``questions`` (choice / noul / score), plus
# display metadata for the gallery card. The ``state``/``questions`` shape
# matches vLLM's example structured_server.py's /v1/systemone contract so
# the exact same payload can later be sent to a real sidecar unchanged.

USE_CASES: List[Dict[str, Any]] = [
    {
        "id": "ticket-routing",
        "title": "Support Ticket Routing",
        "subtitle": "Choice",
        "description": (
            "Pick which team should handle an incoming support message -- "
            "the canonical 'choose 1 of N labeled options' decision."
        ),
        "tags": ["choice", "beginner"],
        "state": "My subscription was charged twice. Please refund the duplicate charge.",
        "questions": {
            "team": {
                "type": "choice",
                "instructions": "Which team should handle this message?",
                "criteria": {
                    "Billing": "Charges, invoices, and refunds",
                    "Technical": "Product bugs and outages",
                    "Account": "Login, passwords, and account access",
                },
            }
        },
    },
    {
        "id": "billing-dispute-gate",
        "title": "Billing Dispute Gate",
        "subtitle": "Noul",
        "description": (
            "A yes/no gate with a calibrated probability -- threshold it to "
            "auto-approve confident cases and escalate uncertain ones."
        ),
        "tags": ["noul", "beginner"],
        "state": "My subscription was charged twice. Please refund the duplicate charge.",
        "questions": {
            "is_billing_issue": {
                "type": "noul",
                "instructions": "Does the customer report a billing or payment problem?",
            }
        },
    },
    {
        "id": "urgency-scoring",
        "title": "Urgency Scoring",
        "subtitle": "Score",
        "description": (
            "Place a request on an ordered severity scale for queue "
            "prioritization -- the response is an expected value, not just "
            "an argmax."
        ),
        "tags": ["score", "beginner"],
        "state": "Everything is down and we have a customer demo at noon.",
        "questions": {
            "urgency": {
                "type": "score",
                "instructions": "How urgently does this request need a reply?",
                "criteria": ["can_wait", "this_week", "today", "immediate"],
            }
        },
    },
    {
        "id": "chained-triage",
        "title": "Chained Multi-Question Triage",
        "subtitle": "Choice -> conditional Noul",
        "description": (
            "Route to a team, then only ask a follow-up question when the "
            "route matches a condition -- exercises the structured_server.py "
            "depends_on / ask_if extensions for multi-stage reads."
        ),
        "tags": ["choice", "noul", "intermediate", "depends_on"],
        "state": "My subscription was charged twice. Please refund the duplicate charge.",
        "questions": {
            "team": {
                "type": "choice",
                "instructions": "Which team should handle this message?",
                "criteria": {
                    "Billing": "Charges, invoices, and refunds",
                    "Technical": "Product bugs and outages",
                    "Account": "Login, passwords, and account access",
                },
            },
            "duplicate_charge": {
                "type": "noul",
                "instructions": "Does the customer explicitly mention a duplicate or repeated charge?",
                "ask_if": {"team": ["Billing"]},
            },
        },
    },
    {
        "id": "mcp-tool-routing",
        "title": "Agent Tool Selection",
        "subtitle": "Choice (dynamic candidates)",
        "description": (
            "Pick which connected MCP tool should handle a request -- a "
            "decision model acting as a cheap pre-router in front of full "
            "agentic tool-calling. Candidates are pulled live from the MCP "
            "tab's connected tools when available, falling back to this "
            "illustrative set."
        ),
        "tags": ["choice", "agentic", "mcp"],
        "state": "What's the weather like in Tokyo right now, and can you save that to a file?",
        "questions": {
            "next_tool": {
                "type": "choice",
                "instructions": "Which available tool should be called next?",
                "criteria": {
                    "get_weather": "Look up current weather for a location",
                    "write_file": "Write text content to a local file",
                    "none": "No tool call is needed yet",
                },
            }
        },
    },
    {
        "id": "race-lane-decider",
        "title": "Race Lane Decider",
        "subtitle": "Choice + Noul (interactive)",
        "description": (
            "A live control-loop demo: every tick, the game compresses lane "
            "obstacles into state and asks for the safest lane plus a hazard "
            "probability in one batched call. Modeled on the community "
            "'Jev Road Decider' pattern."
        ),
        "tags": ["choice", "noul", "interactive", "game"],
        "interactive": "race",
        "state": {"current_lane": "center", "left": "clear", "center": "clear", "right": "obstacle_row_2"},
        "questions": {
            "lane": {
                "type": "choice",
                "instructions": (
                    "Pick the safest lane for the road ahead; row 1 is most urgent "
                    "and prefer the current lane when equally safe."
                ),
                "criteria": {
                    "left": "Left lane",
                    "center": "Center lane (current)",
                    "right": "Right lane",
                },
            },
            "hazard": {
                "type": "noul",
                "instructions": "Is a collision likely within the next few rows?",
            },
        },
    },
    {
        "id": "rubric-grading",
        "title": "Rubric Grading Puzzle",
        "subtitle": "N x Score, one shared state (interactive)",
        "description": (
            "Grade an entire rubric in a single request: the submission and "
            "rubric are sent once as shared state, and each criterion becomes "
            "one Score question. Modeled on AutoRubric's 'decision-model "
            "judge' batching pattern."
        ),
        "tags": ["score", "interactive", "batching"],
        "interactive": "rubric",
        "state": {
            "submission": (
                "Thanks for reaching out. I've issued a refund for the duplicate "
                "charge -- it should land in 3-5 business days. Sorry for the hassle!"
            ),
            "rubric": "Grade this support reply for clarity, correctness, and tone.",
        },
        "questions": {
            "clarity": {
                "type": "score",
                "instructions": "How clear and easy to understand is this reply?",
                "criteria": ["poor", "fair", "good", "excellent"],
            },
            "correctness": {
                "type": "score",
                "instructions": "Does this reply correctly resolve the customer's issue?",
                "criteria": ["poor", "fair", "good", "excellent"],
            },
            "tone": {
                "type": "score",
                "instructions": "How appropriate is the tone of this reply?",
                "criteria": ["poor", "fair", "good", "excellent"],
            },
        },
    },
]

_USE_CASES_BY_ID: Dict[str, Dict[str, Any]] = {uc["id"]: uc for uc in USE_CASES}


def list_use_cases() -> List[Dict[str, Any]]:
    """Return the use-case catalog for GET /api/decision/examples."""
    return USE_CASES


def get_use_case(use_case_id: str) -> Optional[Dict[str, Any]]:
    return _USE_CASES_BY_ID.get(use_case_id)


# ---------------------------------------------------------------------------
# Decision Server lifecycle (real vLLM nightly container + vendored sidecar)
# ---------------------------------------------------------------------------
# Fully isolated from the main Server Config / Instances flow:
#   - Its own container name ("vllm-decision-server") and dedicated ports,
#     so starting/stopping it can never collide with or interrupt the main
#     vLLM instance (or anything in backend_registry.py).
#   - Its own in-process state object below -- never touches app.py's global
#     vllm_process/current_config, and is deliberately NOT registered in
#     backend_registry.py (see the plan's resolved "Start/stop lifecycle").
#   - Container launch reuses container_manager.start_container() (GPU
#     passthrough, image pulling, health polling) with a custom
#     container_name + an "extra_args" passthrough for --diffusion-config.

DECISION_CONTAINER_NAME = "vllm-decision-server"
DECISION_CONTAINER_PORT = 8800  # host port for the dedicated vLLM container
SIDECAR_PORT = 8801  # structured_server.py sidecar, fronts the container above

DEFAULT_MODEL_ID = "google/diffusiongemma-26B-A4B-it"
# Known-good nightly tag referenced in the Red Hat DiffusionGemma guide
# (2026-09-28). Nightly tags drift fast; if the pull/start fails, check
# https://hub.docker.com/r/vllm/vllm-openai/tags for a newer nightly-<sha>
# and paste it into the Image Tag field.
DEFAULT_NIGHTLY_IMAGE_TAG = "vllm/vllm-openai:nightly-e9757321527ca1ecd514c07c1418dd2c53da3d19"
DEFAULT_CANVAS_LENGTH = 64

VENDOR_DIR = Path(__file__).resolve().parent / "vendor"
STRUCTURED_SERVER_SCRIPT = VENDOR_DIR / "structured_server.py"

_LOG_BUFFER_MAX = 400
_VALID_PHASES = (
    "stopped",
    "pulling",
    "starting_vllm",
    "waiting_health",
    "starting_sidecar",
    "ready",
    "stopping",
    "error",
)


class _ServerState:
    """Process-local state for the Decision Server. One instance per app
    process; intentionally simple (no persistence) since the server is
    meant to be launched fresh each playground session."""

    def __init__(self) -> None:
        self.phase: str = "stopped"
        self.message: str = "Decision Server is stopped."
        self.model_id: Optional[str] = None
        self.image_tag: Optional[str] = None
        self.canvas_length: int = DEFAULT_CANVAS_LENGTH
        self.last_error: Optional[str] = None
        self.sidecar_process: Optional[subprocess.Popen] = None
        self.log_buffer: "deque[str]" = deque(maxlen=_LOG_BUFFER_MAX)
        self.lock = asyncio.Lock()


_state = _ServerState()


def _log(line: str) -> None:
    logger.info(f"[decision-server] {line}")
    _state.log_buffer.append(line)


def get_server_status() -> Dict[str, Any]:
    """Report real Decision Server lifecycle status for GET /api/decision/status."""
    return {
        "phase": _state.phase,
        "ready": _state.phase == "ready",
        "message": _state.message,
        "model_id": _state.model_id,
        "image_tag": _state.image_tag,
        "canvas_length": _state.canvas_length,
        "last_error": _state.last_error,
        # Always included so the frontend's launch form can prefill sensible
        # values without duplicating these constants in JS.
        "defaults": {
            "model_id": DEFAULT_MODEL_ID,
            "image_tag": DEFAULT_NIGHTLY_IMAGE_TAG,
            "canvas_length": DEFAULT_CANVAS_LENGTH,
        },
    }


def get_server_logs(limit: int = 200) -> List[str]:
    """Return the most recent buffered log lines for the log panel to poll."""
    buffered = list(_state.log_buffer)
    return buffered[-limit:] if limit else buffered


async def start_decision_server(
    model_id: Optional[str] = None,
    image_tag: Optional[str] = None,
    canvas_length: Optional[int] = None,
    gpu_device: Optional[str] = None,
) -> Dict[str, Any]:
    """Launch the dedicated DiffusionGemma vLLM nightly container, then the
    vendored structured_server.py sidecar in front of it. Raises on failure
    (with _state left in phase="error" and a human-readable message)."""
    if container_manager is None:
        raise RuntimeError(
            "No container runtime (podman/docker) was detected. The Decision "
            "Server currently requires Container mode -- see the main Server "
            "Config tab for runtime setup."
        )

    async with _state.lock:
        if _state.phase in ("pulling", "starting_vllm", "waiting_health", "starting_sidecar"):
            raise RuntimeError(f"Decision Server is already starting (phase={_state.phase}).")
        if _state.phase == "ready":
            raise RuntimeError("Decision Server is already running. Stop it first to relaunch with different settings.")

        model_id = (model_id or DEFAULT_MODEL_ID).strip()
        image_tag = (image_tag or DEFAULT_NIGHTLY_IMAGE_TAG).strip()
        canvas_length = int(canvas_length or DEFAULT_CANVAS_LENGTH)
        if canvas_length < 16 or canvas_length > 512 or canvas_length % 16 != 0:
            raise ValueError("canvas_length must be a multiple of 16 between 16 and 512")

        _state.phase = "pulling"
        _state.model_id = model_id
        _state.image_tag = image_tag
        _state.canvas_length = canvas_length
        _state.last_error = None
        _state.message = f"Starting Decision Server ({model_id})..."
        _state.log_buffer.clear()
        _log(f"Starting Decision Server: model={model_id} image={image_tag} canvas={canvas_length}")

        started_container = False
        try:
            vllm_config: Dict[str, Any] = {
                "model": model_id,
                "use_cpu": False,
                "accelerator": "nvidia",
                "port": DECISION_CONTAINER_PORT,
                "dtype": "auto",
                "trust_remote_code": False,
                "tensor_parallel_size": 1,
                "gpu_memory_utilization": 0.9,
                "gpu_device": gpu_device,
                "extra_args": [
                    "--diffusion-config",
                    json.dumps({"canvas_length": canvas_length}),
                    "--max-logprobs",
                    "32",
                    "--enable-prefix-caching",
                ],
            }

            _state.phase = "starting_vllm"
            _state.message = f"Pulling image and starting container '{DECISION_CONTAINER_NAME}'..."
            _log(f"Starting container on port {DECISION_CONTAINER_PORT} with image {image_tag}")
            result = await container_manager.start_container(
                vllm_config,
                image=image_tag,
                wait_ready=False,
                container_name=DECISION_CONTAINER_NAME,
            )
            started_container = True
            _log(f"Container started: {result}")

            _state.phase = "waiting_health"
            _state.message = (
                "Waiting for vLLM health check (nightly DiffusionGemma startup can take several minutes)..."
            )
            _log("Waiting for vLLM /health ...")
            readiness = await container_manager.wait_for_ready(port=DECISION_CONTAINER_PORT, timeout=900)
            if not readiness.get("ready"):
                raise RuntimeError(f"vLLM did not become healthy: {readiness.get('error', 'unknown error')}")
            _log(f"vLLM is healthy (took {readiness.get('elapsed_time')}s)")

            _state.phase = "starting_sidecar"
            _state.message = "Starting the structured_server.py decision sidecar..."
            await _start_sidecar(model_id, canvas_length)

            _state.phase = "ready"
            _state.message = f"Decision Server ready -- {model_id} via {image_tag}, canvas={canvas_length}."
            _log("Decision Server ready.")
            return get_server_status()

        except Exception as e:
            _state.phase = "error"
            _state.last_error = str(e)
            _state.message = f"Failed to start Decision Server: {e}"
            _log(f"ERROR: {e}")
            if started_container:
                # Best-effort rollback so a half-started attempt doesn't leave
                # a GPU container silently running in the background.
                try:
                    await container_manager.stop_container(remove=True, container_name=DECISION_CONTAINER_NAME)
                    _log("Rolled back: stopped container after startup failure.")
                except Exception as cleanup_err:
                    _log(f"Rollback warning: failed to stop container cleanly: {cleanup_err}")
            raise


async def _start_sidecar(model_id: str, canvas_length: int) -> None:
    if not STRUCTURED_SERVER_SCRIPT.exists():
        raise RuntimeError(
            f"Vendored structured_server.py not found at {STRUCTURED_SERVER_SCRIPT}. "
            "Expected it under vllm_playground/vendor/."
        )

    try:
        import transformers  # noqa: F401
    except ImportError as e:
        raise RuntimeError(
            "The 'transformers' package is required for the Decision Server's sidecar "
            "(used to resolve answer-template token slots). Install it with: "
            "pip install 'vllm-playground[decision-models]'"
        ) from e

    cmd = [
        sys.executable,
        str(STRUCTURED_SERVER_SCRIPT),
        "--upstream",
        f"http://127.0.0.1:{DECISION_CONTAINER_PORT}",
        "--tokenizer",
        model_id,
        "--canvas",
        str(canvas_length),
        "--port",
        str(SIDECAR_PORT),
    ]
    _log(f"Starting sidecar: {' '.join(cmd)}")
    _state.sidecar_process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    asyncio.create_task(_drain_sidecar_output())

    import aiohttp

    deadline = time.monotonic() + 60
    async with aiohttp.ClientSession() as session:
        while time.monotonic() < deadline:
            if _state.sidecar_process.poll() is not None:
                raise RuntimeError("Sidecar process exited before becoming healthy -- check the Decision Server logs.")
            try:
                async with session.get(
                    f"http://127.0.0.1:{SIDECAR_PORT}/health", timeout=aiohttp.ClientTimeout(total=2)
                ) as resp:
                    if resp.status == 200:
                        _log("Sidecar is healthy.")
                        return
            except (OSError, asyncio.TimeoutError):
                pass
            await asyncio.sleep(1)
    raise RuntimeError("Timed out waiting for the structured_server.py sidecar to become healthy.")


async def _drain_sidecar_output() -> None:
    process = _state.sidecar_process
    if process is None or process.stdout is None:
        return
    loop = asyncio.get_event_loop()
    while True:
        line = await loop.run_in_executor(None, process.stdout.readline)
        if not line:
            break
        _log(f"[sidecar] {line.rstrip()}")


async def stop_decision_server() -> Dict[str, Any]:
    """Stop the sidecar process and the dedicated container, if running."""
    async with _state.lock:
        _state.phase = "stopping"
        _state.message = "Stopping Decision Server..."
        _log("Stopping Decision Server...")

        if _state.sidecar_process is not None:
            proc = _state.sidecar_process
            try:
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
            except Exception as e:
                _log(f"Sidecar stop warning: {e}")
            _state.sidecar_process = None
            _log("Sidecar stopped.")

        if container_manager is not None:
            result = await container_manager.stop_container(remove=True, container_name=DECISION_CONTAINER_NAME)
            _log(f"Container stop result: {result}")

        _state.phase = "stopped"
        _state.message = "Decision Server is stopped."
        _state.model_id = None
        _state.image_tag = None
        _state.last_error = None
        _log("Decision Server stopped.")
        return get_server_status()


# ---------------------------------------------------------------------------
# Mock evaluation
# ---------------------------------------------------------------------------
# Produces a plausible-looking, *stable* (seeded by state+questions content)
# typed response in the same shape a real structured_server.py /v1/systemone
# call would return, so the UI/visualizations can be built and reviewed
# before any live backend exists.


def _seeded_rng(state: Any, question_id: str, instructions: str) -> random.Random:
    key = f"{state!r}|{question_id}|{instructions}".encode("utf-8", errors="ignore")
    digest = hashlib.sha256(key).hexdigest()
    return random.Random(int(digest[:16], 16))


def _mock_distribution(rng: random.Random, n: int, peak_strength: float = 2.6) -> List[float]:
    """A random-but-plausible probability distribution over ``n`` options:
    one option is favored (softmax of randomized logits with one boosted
    logit), rather than uniform noise, so demo results look like a real
    calibrated decision instead of random static."""
    favored = rng.randrange(n)
    logits = [rng.uniform(-1.0, 1.0) for _ in range(n)]
    logits[favored] += peak_strength
    mx = max(logits)
    exps = [math.exp(v - mx) for v in logits]
    total = sum(exps)
    return [v / total for v in exps]


def _evaluate_question(state: Any, question_id: str, question: Dict[str, Any]) -> Dict[str, Any]:
    qtype = question.get("type")
    instructions = str(question.get("instructions", ""))
    rng = _seeded_rng(state, question_id, instructions)

    if qtype == "noul":
        # Beta(2.5, 1.6) skews mildly toward "yes" so demo results read as a
        # calibrated decision rather than a coin flip, while still varying
        # per state/instructions via the seeded RNG.
        p_yes = min(0.97, max(0.03, rng.betavariate(2.5, 1.6)))
        return {"type": "noul", "noul": round(p_yes, 4)}

    if qtype == "choice":
        criteria = question.get("criteria") or {}
        names = list(criteria.keys())
        if not names:
            raise ValueError(f"question {question_id!r}: choice needs at least one option in 'criteria'")
        probs = _mock_distribution(rng, len(names))
        top_idx = max(range(len(names)), key=lambda i: probs[i])
        return {
            "type": "choice",
            "choice": names[top_idx],
            "probabilities": {name: round(p, 4) for name, p in zip(names, probs)},
            "confidence": round(probs[top_idx], 4),
        }

    if qtype == "score":
        levels = question.get("criteria") or []
        if len(levels) < 2:
            raise ValueError(f"question {question_id!r}: score needs at least two ordered levels")
        probs = _mock_distribution(rng, len(levels))
        expected = sum(i * p for i, p in enumerate(probs))
        top_idx = max(range(len(levels)), key=lambda i: probs[i])
        return {
            "type": "score",
            "score": round(expected, 4),
            "legend": {str(i): name for i, name in enumerate(levels)},
            "probabilities": {str(i): round(p, 4) for i, p in enumerate(probs)},
            "confidence": round(probs[top_idx], 4),
        }

    raise ValueError(f"question {question_id!r}: unknown type {qtype!r}")


async def evaluate(state: Any, questions: Dict[str, Any]) -> Dict[str, Any]:
    """Evaluate a System One-shaped request.

    Returns ``{"answers": {...}, "source": "mock"|"live", "note": str|None,
    "timing": {"total_ms": float}}``. Calls the real structured_server.py
    sidecar when the Decision Server is ready; otherwise (or on a live-call
    failure) falls back to the deterministic mock evaluator, always clearly
    tagged via "source" and "note" -- never a silent fake result.
    """
    if not isinstance(questions, dict) or not questions:
        raise ValueError("questions: needs a non-empty map of id -> question")

    if _state.phase == "ready":
        try:
            return await _evaluate_live(state, questions)
        except Exception as e:
            logger.warning(f"Live Decision Server call failed, falling back to mock: {e}")
            result = mock_evaluate(state, questions)
            result["note"] = f"Live Decision Server call failed ({e}) -- showing a simulated result instead."
            return result

    return mock_evaluate(state, questions)


async def _evaluate_live(state: Any, questions: Dict[str, Any]) -> Dict[str, Any]:
    """Proxy a {state, questions} request to the structured_server.py sidecar's
    /v1/systemone endpoint. Its Jev-shaped per-question answers (noul/choice/
    score) already match this module's mock_evaluate() output shape, so no
    answer translation is needed -- only envelope wrapping."""
    import aiohttp

    started = time.perf_counter()
    url = f"http://127.0.0.1:{SIDECAR_PORT}/v1/systemone"
    async with aiohttp.ClientSession() as session:
        async with session.post(
            url,
            json={"model": _state.model_id or DEFAULT_MODEL_ID, "state": state, "questions": questions},
            timeout=aiohttp.ClientTimeout(total=45),
        ) as resp:
            body = await resp.json(content_type=None)
            if resp.status != 200:
                detail = body.get("error", {}).get("message") if isinstance(body, dict) else None
                raise RuntimeError(detail or f"sidecar returned HTTP {resp.status}")

    elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
    return {
        "answers": body.get("answers", {}),
        "source": "live",
        "note": None,
        "timing": {"total_ms": elapsed_ms},
    }


def mock_evaluate(state: Any, questions: Dict[str, Any]) -> Dict[str, Any]:
    """Deterministic-but-randomized mock evaluator (Phase 1 behavior, and the
    fallback path for Phase 2+ when the live Decision Server isn't ready)."""
    if not isinstance(questions, dict) or not questions:
        raise ValueError("questions: needs a non-empty map of id -> question")

    answers: Dict[str, Any] = {}

    # Respect declared ask_if dependencies even in mock mode, so the chained
    # triage use case demonstrates a skipped question rather than always
    # answering everything.
    for qid, question in questions.items():
        ask_if = question.get("ask_if") if isinstance(question, dict) else None
        if ask_if:
            skip = False
            for dep_id, allowed in ask_if.items():
                dep_answer = answers.get(dep_id)
                dep_value = dep_answer.get("choice") if dep_answer else None
                if dep_value not in (allowed or []):
                    skip = True
                    break
            if skip:
                answers[qid] = None
                continue
        answers[qid] = _evaluate_question(state, qid, question)

    # Simulate a plausible structured-read latency (real reads are ~70-500ms).
    rng = _seeded_rng(state, "__latency__", "")
    simulated_ms = round(rng.uniform(60, 420), 1)

    return {
        "answers": answers,
        "source": "mock",
        "note": (
            "Simulated response -- the Decision Server isn't running yet. "
            "Probabilities are randomized for demonstration, not a real model."
        ),
        "timing": {"total_ms": simulated_ms},
    }
