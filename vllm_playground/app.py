"""
vLLM Playground - A web interface for managing and interacting with vLLM
CONTAINERIZED VERSION - Uses Podman to run vLLM in containers
"""

import asyncio
import json
import logging
import os
import sys
import subprocess
import tempfile
import shutil
import time
from datetime import datetime
from typing import Optional, List, Dict, Any, Literal, Union
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import uvicorn
import struct
import signal
import aiohttp

# Setup logging (must be before imports that use logger)
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Import container manager (optional - only needed for container mode)
container_manager = None  # Initialize as None for when import fails
CONTAINER_MODE_AVAILABLE = False
try:
    from .container_manager import container_manager

    # container_manager will be None if no runtime (podman/docker) is available
    CONTAINER_MODE_AVAILABLE = container_manager is not None
    if not CONTAINER_MODE_AVAILABLE:
        logger.warning("No container runtime (podman/docker) found - container mode will be disabled")
except ImportError:
    CONTAINER_MODE_AVAILABLE = False
    logger.warning("container_manager not available - container mode will be disabled")

app = FastAPI(title="vLLM Playground", version="1.0.0")


@app.on_event("shutdown")
async def shutdown_event():
    """Clean up MCP connections on shutdown"""
    logger.info("Shutting down - cleaning up MCP connections...")
    try:
        # Check if MCP is available (these are defined later in the file)
        if "get_mcp_manager" in globals() and get_mcp_manager is not None:
            manager = get_mcp_manager()
            # Disconnect all connected servers
            for name in list(manager.connections.keys()):
                try:
                    await manager.disconnect(name)
                except Exception as e:
                    logger.debug(f"Error disconnecting MCP server '{name}': {e}")
    except Exception as e:
        logger.debug(f"Error during MCP cleanup: {e}")
    logger.info("MCP cleanup complete")


# Get base directory
BASE_DIR = Path(__file__).parent

# Mount static files (must be before routes)
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
app.mount("/assets", StaticFiles(directory=str(BASE_DIR / "assets")), name="assets")

# Global state
container_id: Optional[str] = None  # Container ID (for container mode)
vllm_process: Optional[asyncio.subprocess.Process] = None  # Process (for subprocess mode)
vllm_running: bool = False
current_run_mode: Optional[str] = None  # Track current run mode
log_queue: asyncio.Queue = asyncio.Queue()
websocket_connections: List[WebSocket] = []
latest_vllm_metrics: Dict[str, Any] = {}  # Store latest metrics from logs
metrics_timestamp: Optional[datetime] = None  # Track when metrics were last updated
current_model_identifier: Optional[str] = None  # Track the actual model identifier passed to vLLM
current_served_model_name: Optional[str] = None  # Track the served model name alias (for API calls)

# vLLM-Omni global state (separate from vLLM)
omni_process: Optional[asyncio.subprocess.Process] = None  # For subprocess mode
omni_container_id: Optional[str] = None  # For container mode
omni_running: bool = False
omni_run_mode: Optional[str] = None  # "subprocess", "container", or "inprocess"
omni_config: Optional["OmniConfig"] = None
omni_start_time: Optional[datetime] = None
omni_log_queue: asyncio.Queue = asyncio.Queue()
omni_websocket_connections: List[WebSocket] = []

# In-process model for Stable Audio (bypasses broken vLLM-Omni serving layer)
omni_inprocess_model: Optional[Any] = None  # Holds the Omni model when using in-process mode


def get_model_name_for_api() -> Optional[str]:
    """
    Get the model name to use in API calls.

    Uses served_model_name if set (required when --served-model-name is used),
    otherwise falls back to current_model_identifier or current_config.model.

    Returns None if no model name is available.
    """
    if current_served_model_name:
        return current_served_model_name
    if current_model_identifier:
        return current_model_identifier
    if current_config:
        return current_config.model
    return None


class VLLMConfig(BaseModel):
    """Configuration for vLLM server"""

    model: str = "TinyLlama/TinyLlama-1.1B-Chat-v1.0"  # CPU-friendly default
    host: str = "0.0.0.0"
    port: int = 8000
    tensor_parallel_size: int = 1
    gpu_memory_utilization: float = 0.9
    max_model_len: Optional[int] = None
    dtype: str = "auto"
    trust_remote_code: bool = False
    download_dir: Optional[str] = None
    load_format: str = "auto"
    disable_log_stats: bool = False
    enable_prefix_caching: bool = False
    # HuggingFace token for gated models (Llama, Gemma, etc.)
    # Get token from https://huggingface.co/settings/tokens
    hf_token: Optional[str] = None
    # CPU-specific options
    use_cpu: bool = False
    cpu_kvcache_space: int = 4  # GB for CPU KV cache (reduced default for stability)
    cpu_omp_threads_bind: str = "auto"  # CPU thread binding
    # Custom chat template and stop tokens (optional - overrides auto-detection)
    custom_chat_template: Optional[str] = None
    custom_stop_tokens: Optional[List[str]] = None
    # Internal flag to track if model has built-in template
    model_has_builtin_template: bool = False
    # Local model support - for pre-downloaded models
    # If specified, takes precedence over 'model' parameter
    local_model_path: Optional[str] = None
    # Run mode: subprocess, container, or remote
    run_mode: Literal["subprocess", "container", "remote"] = "subprocess"
    # Remote vLLM instance URL (for remote mode)
    # Full base URL of a running vLLM instance, e.g. http://gpu-server:8000
    remote_url: Optional[str] = None
    # Optional API key for authenticated remote vLLM endpoints
    remote_api_key: Optional[str] = None
    # GPU device selection for subprocess mode (e.g., "0", "1", "0,1" for multi-GPU)
    gpu_device: Optional[str] = None
    # GPU accelerator type for container mode - determines which image and device flags to use
    # Options: nvidia (CUDA), amd (ROCm), tpu (Google Cloud TPU)
    accelerator: Literal["nvidia", "amd", "tpu"] = "nvidia"
    # Tool calling support - enables function calling with compatible models
    # Requires vLLM server to be started with --enable-auto-tool-choice and --tool-call-parser
    enable_tool_calling: bool = False  # Disabled by default (can cause issues with some models)
    # Tool call parser: auto-detects based on model name, or specify explicitly
    # Options: llama3_json (Llama 3.x), mistral (Mistral), hermes (NousResearch Hermes),
    #          internlm (InternLM), granite-20b-fc (IBM Granite), pythonic (experimental)
    tool_call_parser: Optional[str] = None  # None = auto-detect based on model name
    # ModelScope support - for users in China who can't access HuggingFace
    # When enabled, vLLM will download models from modelscope.cn instead of huggingface.co
    use_modelscope: bool = False
    # ModelScope SDK token for accessing gated models
    # Get token from https://www.modelscope.cn/my/myaccesstoken
    modelscope_token: Optional[str] = None
    # Served model name - alias for the model used in API calls
    # Required for Claude Code integration (model names with '/' don't work)
    # When set, all API calls will use this name instead of the model path
    served_model_name: Optional[str] = None
    # Compute mode: cpu, gpu, or metal (Apple Silicon GPU)
    compute_mode: Literal["cpu", "gpu", "metal"] = "cpu"
    # Custom virtual environment path for subprocess mode
    # Allows using specific vLLM installations (e.g., vllm-metal)
    venv_path: Optional[str] = None


# =============================================================================
# Helper functions for vLLM server URL and status
# =============================================================================


def get_vllm_base_url() -> str:
    """Get the base URL for the running vLLM instance based on current mode.

    Centralizes URL construction logic that was previously duplicated across
    8+ endpoints. Handles remote, Kubernetes, container, and subprocess modes.
    """
    global current_config, current_run_mode

    if current_run_mode == "remote" and current_config and current_config.remote_url:
        return current_config.remote_url.rstrip("/")

    is_kubernetes = os.path.exists("/var/run/secrets/kubernetes.io/serviceaccount/token")

    if current_run_mode == "container" and is_kubernetes and container_manager:
        service_name = getattr(container_manager, "SERVICE_NAME", "vllm-service")
        namespace = getattr(container_manager, "namespace", os.getenv("KUBERNETES_NAMESPACE", "default"))
        return f"http://{service_name}.{namespace}.svc.cluster.local:{current_config.port}"
    elif current_run_mode == "container":
        return f"http://localhost:{current_config.port}"
    else:
        return f"http://{current_config.host}:{current_config.port}"


def get_vllm_auth_headers() -> dict:
    """Get authorization headers for proxied requests to vLLM.

    Returns a dict with Bearer token header if remote_api_key is configured,
    otherwise returns an empty dict.
    """
    global current_config
    if current_config and current_config.remote_api_key:
        return {"Authorization": f"Bearer {current_config.remote_api_key}"}
    return {}


async def check_vllm_server_running() -> bool:
    """Check if the vLLM server is currently running based on the active mode.

    Returns True if the server is confirmed running, False otherwise.
    Handles remote, container, and subprocess modes.
    """
    global current_run_mode, vllm_running, vllm_process

    if current_run_mode == "remote":
        return vllm_running

    if current_run_mode == "container":
        if CONTAINER_MODE_AVAILABLE and container_manager:
            status = await container_manager.get_container_status()
            return status.get("running", False)
        return False

    if current_run_mode == "subprocess":
        if vllm_process is not None:
            return vllm_process.returncode is None
        return False

    return False


# =============================================================================
# vLLM-Omni Configuration (Separate from VLLMConfig)
# =============================================================================


class OmniConfig(BaseModel):
    """Configuration for vLLM-Omni server (separate from VLLMConfig for omni-modality generation)"""

    model: str = "Tongyi-MAI/Z-Image-Turbo"  # Default image generation model
    host: str = "0.0.0.0"
    port: int = 8091  # Different default port from vLLM (8000)
    model_type: Literal["image", "omni", "video", "tts", "audio"] = "image"

    # Image generation defaults
    default_height: int = 1024
    default_width: int = 1024
    num_inference_steps: int = 50
    guidance_scale: float = 4.0

    # GPU settings (same pattern as VLLMConfig)
    tensor_parallel_size: int = 1
    gpu_memory_utilization: float = 0.9
    gpu_device: Optional[str] = None
    accelerator: Literal["nvidia", "amd"] = "nvidia"  # GPU accelerator type

    # Memory optimization
    # Enable CPU offloading to reduce GPU memory usage (increases latency)
    enable_cpu_offload: bool = False

    # Enable torch.compile for faster inference (but slower startup and more memory)
    # When False, uses --enforce-eager mode which is faster to start and uses less memory
    enable_torch_compile: bool = False

    # Run mode: subprocess (CLI), container, or remote (same as vLLM Server)
    run_mode: Literal["subprocess", "container", "remote"] = "subprocess"
    venv_path: Optional[str] = None  # Path to vLLM-Omni venv (for subprocess mode)
    # Remote vLLM-Omni instance URL (for remote mode)
    remote_url: Optional[str] = None
    # Optional API key for authenticated remote endpoints
    remote_api_key: Optional[str] = None

    # HuggingFace token for gated models
    hf_token: Optional[str] = None

    # Model source option
    # ModelScope support - for users in China who can't access HuggingFace
    # When enabled, models are downloaded from modelscope.cn instead of huggingface.co
    use_modelscope: bool = False

    # Trust remote code (required for some models)
    trust_remote_code: bool = False


# =============================================================================
# Helper functions for vLLM-Omni server URL and status
# =============================================================================


def get_omni_base_url() -> str:
    """Get the base URL for the running vLLM-Omni instance based on current mode.

    Centralizes URL construction for all Omni endpoints.
    """
    global omni_config, omni_run_mode

    if omni_run_mode == "remote" and omni_config and omni_config.remote_url:
        return omni_config.remote_url.rstrip("/")

    if omni_config:
        return f"http://localhost:{omni_config.port}"

    return "http://localhost:8091"  # fallback default


def get_omni_auth_headers() -> dict:
    """Get authorization headers for proxied requests to vLLM-Omni.

    Returns a dict with Bearer token header if remote_api_key is configured,
    otherwise returns an empty dict.
    """
    global omni_config
    if omni_config and omni_config.remote_api_key:
        return {"Authorization": f"Bearer {omni_config.remote_api_key}"}
    return {}


# Image-Edit models that support image-to-image generation
# Text-to-image models (like Z-Image-Turbo) do NOT support input images
IMAGE_EDIT_MODELS = {
    "Qwen/Qwen-Image-Edit",
    "Qwen/Qwen-Image-Edit-2509",
    "Qwen/Qwen-Image-Edit-2511",
    "meituan-longcat/LongCat-Image-Edit",
}


def is_image_edit_model(model_id: str) -> bool:
    """Check if a model supports image-to-image editing.

    Only image-edit models (like Qwen-Image-Edit) support input images.
    Text-to-image models (like Z-Image-Turbo) will ignore input images.
    """
    return model_id in IMAGE_EDIT_MODELS


class ImageGenerationRequest(BaseModel):
    """Request for image generation via vLLM-Omni"""

    prompt: str
    negative_prompt: Optional[str] = None
    height: int = 1024
    width: int = 1024
    num_inference_steps: int = 50
    guidance_scale: float = 4.0
    seed: Optional[int] = None
    input_image: Optional[str] = None  # Base64 image for image-to-image generation


class ImageGenerationResponse(BaseModel):
    """Response from image generation"""

    success: bool
    image_base64: Optional[str] = None
    error: Optional[str] = None
    generation_time: Optional[float] = None


class VideoGenerationRequest(BaseModel):
    """Request for video generation via vLLM-Omni"""

    prompt: str
    negative_prompt: Optional[str] = None
    duration: int = 4  # Duration in seconds
    fps: int = 16  # Frames per second (default 16 for lower memory)
    height: int = 480  # Video height (default 480 for lower memory)
    width: int = 640  # Video width (default 640 for lower memory)
    num_inference_steps: int = 30
    guidance_scale: float = 4.0
    seed: Optional[int] = None


class VideoGenerationResponse(BaseModel):
    """Response from video generation"""

    success: bool
    video_base64: Optional[str] = None
    duration: Optional[float] = None
    error: Optional[str] = None
    generation_time: Optional[float] = None


class TTSGenerationRequest(BaseModel):
    """Request for TTS (Text-to-Speech) generation via vLLM-Omni.

    Uses Qwen3-TTS models via /v1/audio/speech endpoint.

    Reference:
    - Qwen3-TTS: https://docs.vllm.ai/projects/vllm-omni/en/latest/user_guide/examples/online_serving/qwen3_tts/
    """

    text: str
    voice: Optional[str] = "Vivian"  # Voice ID: Vivian, Serena, Ono_Anna, Sohee, Ryan, Aiden, Dylan, Eric, Uncle_Fu
    speed: float = 1.0  # Speech speed (0.25-4.0)
    instructions: Optional[str] = None  # Voice style/emotion instructions


class AudioGenerationRequest(BaseModel):
    """Request for audio (music/SFX) generation via vLLM-Omni.

    Uses Stable Audio models via /v1/chat/completions endpoint (diffusion-based).

    Reference:
    - Stable Audio: Uses diffusion API like image generation
    """

    text: str
    audio_duration: Optional[float] = 10.0  # Duration in seconds (max 47s)
    num_inference_steps: Optional[int] = 50  # Quality vs speed (20-200)
    guidance_scale: Optional[float] = 7.0  # Prompt adherence (1-15)
    negative_prompt: Optional[str] = "low quality, average quality"
    seed: Optional[int] = None


class AudioGenerationResponse(BaseModel):
    """Response from audio generation"""

    success: bool
    audio_base64: Optional[str] = None
    audio_format: Optional[str] = None  # MIME type like "audio/wav", "audio/flac", "audio/mp3"
    duration: Optional[float] = None
    error: Optional[str] = None
    generation_time: Optional[float] = None


class OmniChatRequest(BaseModel):
    """Chat request for Omni models (Qwen-Omni with text/audio)"""

    messages: List[Dict[str, Any]]  # Simple dict format for chat messages
    temperature: float = 0.7
    max_tokens: int = 512
    stream: bool = True


class OmniServerStatus(BaseModel):
    """vLLM-Omni server status"""

    running: bool
    ready: bool = False  # True when API endpoint is actually responding
    model: Optional[str] = None
    model_type: Optional[str] = None
    port: Optional[int] = None
    run_mode: Optional[str] = None
    uptime: Optional[str] = None


def detect_tool_call_parser(model_name: str) -> Optional[str]:
    """
    Auto-detect the appropriate tool call parser based on model name.

    Returns the parser name or None if no suitable parser is detected.
    In that case, tool calling will be disabled.
    """
    model_lower = model_name.lower()

    # Llama 3.x models (Meta)
    if any(x in model_lower for x in ["llama-3", "llama3", "llama_3"]):
        return "llama3_json"

    # Mistral models
    if "mistral" in model_lower:
        return "mistral"

    # NousResearch Hermes models
    if "hermes" in model_lower:
        return "hermes"

    # InternLM models
    if "internlm" in model_lower:
        return "internlm"

    # IBM Granite models
    if "granite" in model_lower:
        return "granite-20b-fc"

    # Qwen models
    if "qwen" in model_lower:
        return "hermes"  # Qwen typically uses Hermes-style tool calling

    # Default: return None (tool calling won't be enabled for unknown models)
    # User can explicitly set tool_call_parser in config
    return None


def normalize_tool_call(tool_call_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Normalize tool call data from various model formats to the standard format.

    Different models output tool calls in different formats:
    - Standard: {"name": "func", "arguments": {...}}
    - Llama 3.2: {"function": "func", "parameters": {...}}
    - Some models: {"function_name": "func", "args": {...}}

    This function normalizes all formats to the standard format.

    Returns:
        Normalized tool call dict or None if invalid
    """
    if not tool_call_data or not isinstance(tool_call_data, dict):
        return None

    # Try to extract function name from various possible fields
    name = None
    for name_field in ["name", "function", "function_name", "func", "tool"]:
        if name_field in tool_call_data and isinstance(tool_call_data[name_field], str):
            name = tool_call_data[name_field]
            break

    # Try to extract arguments from various possible fields
    arguments = None
    for args_field in ["arguments", "parameters", "params", "args", "input"]:
        if args_field in tool_call_data:
            args_value = tool_call_data[args_field]
            if isinstance(args_value, dict):
                arguments = args_value
                break
            elif isinstance(args_value, str):
                # Try to parse as JSON
                try:
                    arguments = json.loads(args_value)
                    break
                except:
                    arguments = {"raw": args_value}
                    break

    if not name:
        logger.warning(f"Could not extract function name from tool call: {tool_call_data}")
        return None

    # Build normalized tool call
    normalized = {
        "id": tool_call_data.get("id", f"call_{hash(name) % 10000}"),
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(arguments) if arguments else "{}"},
    }

    logger.info(f"🔧 Normalized tool call: {tool_call_data} -> {normalized}")
    return normalized


class ToolFunction(BaseModel):
    """Function definition within a tool"""

    name: str
    description: Optional[str] = None
    parameters: Optional[Dict[str, Any]] = None  # JSON Schema for parameters


class Tool(BaseModel):
    """Tool definition for function calling (OpenAI-compatible)"""

    type: str = "function"  # Currently only "function" is supported
    function: ToolFunction


class ToolCall(BaseModel):
    """Tool call made by the assistant"""

    id: str
    type: str = "function"
    function: Dict[str, str]  # {"name": "...", "arguments": "..."}


class ChatMessage(BaseModel):
    """Chat message structure with tool calling and VLM (vision) support"""

    role: str  # "system", "user", "assistant", or "tool"
    # Content can be a string (text-only) or a list of content parts (multimodal/VLM).
    # List format follows the OpenAI Vision API:
    #   [{"type": "image_url", "image_url": {"url": "data:image/...;base64,..."}},
    #    {"type": "text", "text": "Describe this image."}]
    content: Optional[Union[str, List[Dict[str, Any]]]] = None
    # For assistant messages with tool calls
    tool_calls: Optional[List[ToolCall]] = None
    # For tool response messages
    tool_call_id: Optional[str] = None  # Required when role="tool"
    # Optional name field (used in some contexts)
    name: Optional[str] = None


class ChatRequest(BaseModel):
    """Chat request structure"""

    messages: List[ChatMessage]
    temperature: float = 0.7
    max_tokens: int = 256
    stream: bool = True


class ServerStatus(BaseModel):
    """Server status information"""

    running: bool
    uptime: Optional[str] = None
    config: Optional[VLLMConfig] = None


class BenchmarkConfig(BaseModel):
    """Benchmark configuration"""

    total_requests: int = 100
    request_rate: float = 5.0
    prompt_tokens: int = 100
    output_tokens: int = 100
    use_guidellm: bool = False  # Toggle between built-in and GuideLLM


class BenchmarkResults(BaseModel):
    """Benchmark results"""

    throughput: float  # requests per second
    avg_latency: float  # milliseconds
    p50_latency: float  # milliseconds
    p95_latency: float  # milliseconds
    p99_latency: float  # milliseconds
    tokens_per_second: float
    total_tokens: int
    success_rate: float  # percentage
    completed: bool = False
    raw_output: Optional[str] = None  # Raw guidellm output for display
    json_output: Optional[str] = None  # JSON output from guidellm


current_config: Optional[VLLMConfig] = None
server_start_time: Optional[datetime] = None
benchmark_task: Optional[asyncio.Task] = None
benchmark_results: Optional[BenchmarkResults] = None


def get_chat_template_for_model(model_name: str) -> str:
    """
    Get a reference chat template for a specific model.

    NOTE: This is now primarily used for documentation/reference purposes.
    vLLM automatically detects and uses chat templates from tokenizer_config.json.
    These templates are shown to match the model's actual tokenizer configuration.

    Supported models: Llama 2/3/3.1/3.2, Mistral/Mixtral, Gemma, TinyLlama, CodeLlama
    """
    model_lower = model_name.lower()

    # Llama 3/3.1/3.2 models (use new format with special tokens)
    # Reference: Meta's official Llama 3 tokenizer_config.json
    if "llama-3" in model_lower and (
        "llama-3.1" in model_lower or "llama-3.2" in model_lower or "llama-3-" in model_lower
    ):
        return (
            "{{- bos_token }}"
            "{% for message in messages %}"
            "{% if message['role'] == 'system' %}"
            "{{- '<|start_header_id|>system<|end_header_id|>\\n\\n' + message['content'] + '<|eot_id|>' }}"
            "{% elif message['role'] == 'user' %}"
            "{{- '<|start_header_id|>user<|end_header_id|>\\n\\n' + message['content'] + '<|eot_id|>' }}"
            "{% elif message['role'] == 'assistant' %}"
            "{{- '<|start_header_id|>assistant<|end_header_id|>\\n\\n' + message['content'] + '<|eot_id|>' }}"
            "{% endif %}"
            "{% endfor %}"
            "{% if add_generation_prompt %}"
            "{{- '<|start_header_id|>assistant<|end_header_id|>\\n\\n' }}"
            "{% endif %}"
        )

    # Llama 2 models (older [INST] format with <<SYS>>)
    # Reference: Meta's official Llama 2 tokenizer_config.json
    elif "llama-2" in model_lower or "llama2" in model_lower:
        return (
            "{% if messages[0]['role'] == 'system' %}"
            "{% set loop_messages = messages[1:] %}"
            "{% set system_message = messages[0]['content'] %}"
            "{% else %}"
            "{% set loop_messages = messages %}"
            "{% set system_message = false %}"
            "{% endif %}"
            "{% for message in loop_messages %}"
            "{% if loop.index0 == 0 and system_message != false %}"
            "{{- '<s>[INST] <<SYS>>\\n' + system_message + '\\n<</SYS>>\\n\\n' + message['content'] + ' [/INST]' }}"
            "{% elif message['role'] == 'user' %}"
            "{{- '<s>[INST] ' + message['content'] + ' [/INST]' }}"
            "{% elif message['role'] == 'assistant' %}"
            "{{- ' ' + message['content'] + ' </s>' }}"
            "{% endif %}"
            "{% endfor %}"
        )

    # Mistral/Mixtral models (similar to Llama 2 but simpler)
    # Reference: Mistral AI's official tokenizer_config.json
    elif "mistral" in model_lower or "mixtral" in model_lower:
        return (
            "{{ bos_token }}"
            "{% for message in messages %}"
            "{% if (message['role'] == 'user') != (loop.index0 % 2 == 0) %}"
            "{{- raise_exception('Conversation roles must alternate user/assistant/user/assistant/...') }}"
            "{% endif %}"
            "{% if message['role'] == 'user' %}"
            "{{- '[INST] ' + message['content'] + ' [/INST]' }}"
            "{% elif message['role'] == 'assistant' %}"
            "{{- message['content'] + eos_token }}"
            "{% else %}"
            "{{- raise_exception('Only user and assistant roles are supported!') }}"
            "{% endif %}"
            "{% endfor %}"
        )

    # Gemma models (Google)
    # Reference: Google's official Gemma tokenizer_config.json
    elif "gemma" in model_lower:
        return (
            "{{ bos_token }}"
            "{% if messages[0]['role'] == 'system' %}"
            "{{- raise_exception('System role not supported') }}"
            "{% endif %}"
            "{% for message in messages %}"
            "{% if (message['role'] == 'user') != (loop.index0 % 2 == 0) %}"
            "{{- raise_exception('Conversation roles must alternate user/assistant/user/assistant/...') }}"
            "{% endif %}"
            "{% if message['role'] == 'user' %}"
            "{{- '<start_of_turn>user\\n' + message['content'] | trim + '<end_of_turn>\\n' }}"
            "{% elif message['role'] == 'assistant' %}"
            "{{- '<start_of_turn>model\\n' + message['content'] | trim + '<end_of_turn>\\n' }}"
            "{% endif %}"
            "{% endfor %}"
            "{% if add_generation_prompt %}"
            "{{- '<start_of_turn>model\\n' }}"
            "{% endif %}"
        )

    # TinyLlama (use ChatML format)
    # Reference: TinyLlama's official tokenizer_config.json
    elif "tinyllama" in model_lower or "tiny-llama" in model_lower:
        return (
            "{% for message in messages %}\\n"
            "{% if message['role'] == 'user' %}\\n"
            "{{- '<|user|>\\n' + message['content'] + eos_token }}\\n"
            "{% elif message['role'] == 'system' %}\\n"
            "{{- '<|system|>\\n' + message['content'] + eos_token }}\\n"
            "{% elif message['role'] == 'assistant' %}\\n"
            "{{- '<|assistant|>\\n'  + message['content'] + eos_token }}\\n"
            "{% endif %}\\n"
            "{% if loop.last and add_generation_prompt %}\\n"
            "{{- '<|assistant|>' }}\\n"
            "{% endif %}\\n"
            "{% endfor %}"
        )

    # CodeLlama (uses Llama 2 format)
    # Reference: Meta's CodeLlama tokenizer_config.json
    elif "codellama" in model_lower or "code-llama" in model_lower:
        return (
            "{% if messages[0]['role'] == 'system' %}"
            "{% set loop_messages = messages[1:] %}"
            "{% set system_message = messages[0]['content'] %}"
            "{% else %}"
            "{% set loop_messages = messages %}"
            "{% set system_message = false %}"
            "{% endif %}"
            "{% for message in loop_messages %}"
            "{% if loop.index0 == 0 and system_message != false %}"
            "{{- '<s>[INST] <<SYS>>\\n' + system_message + '\\n<</SYS>>\\n\\n' + message['content'] + ' [/INST]' }}"
            "{% elif message['role'] == 'user' %}"
            "{{- '<s>[INST] ' + message['content'] + ' [/INST]' }}"
            "{% elif message['role'] == 'assistant' %}"
            "{{- ' ' + message['content'] + ' </s>' }}"
            "{% endif %}"
            "{% endfor %}"
        )

    # Default generic template for unknown models
    else:
        logger.info(f"Using generic chat template for model: {model_name}")
        return (
            "{% for message in messages %}"
            "{% if message['role'] == 'system' %}"
            "{{- message['content'] + '\\n' }}"
            "{% elif message['role'] == 'user' %}"
            "{{- 'User: ' + message['content'] + '\\n' }}"
            "{% elif message['role'] == 'assistant' %}"
            "{{- 'Assistant: ' + message['content'] + '\\n' }}"
            "{% endif %}"
            "{% endfor %}"
            "{% if add_generation_prompt %}"
            "{{- 'Assistant:' }}"
            "{% endif %}"
        )


def get_stop_tokens_for_model(model_name: str) -> List[str]:
    """
    Get reference stop tokens for a specific model.

    NOTE: This is now primarily used for documentation/reference purposes.
    vLLM automatically handles stop tokens from the model's tokenizer.
    These are only used if user explicitly provides custom stop tokens.

    Supported models: Llama 2/3/3.1/3.2, Mistral/Mixtral, Gemma, TinyLlama, CodeLlama
    """
    model_lower = model_name.lower()

    # Llama 3/3.1/3.2 models - use special tokens
    if "llama-3" in model_lower and (
        "llama-3.1" in model_lower or "llama-3.2" in model_lower or "llama-3-" in model_lower
    ):
        return ["<|eot_id|>", "<|end_of_text|>"]

    # Llama 2 models - use special tokens
    elif "llama-2" in model_lower or "llama2" in model_lower:
        return ["</s>", "[INST]"]

    # Mistral/Mixtral models - use special tokens
    elif "mistral" in model_lower or "mixtral" in model_lower:
        return ["</s>", "[INST]"]

    # Gemma models - use special tokens
    elif "gemma" in model_lower:
        return ["<end_of_turn>", "<start_of_turn>"]

    # TinyLlama - use ChatML special tokens
    elif "tinyllama" in model_lower or "tiny-llama" in model_lower:
        return ["</s>", "<|user|>", "<|system|>", "<|assistant|>"]

    # CodeLlama - use Llama 2 tokens
    elif "codellama" in model_lower or "code-llama" in model_lower:
        return ["</s>", "[INST]"]

    # Default generic stop tokens for unknown models
    else:
        return ["\n\nUser:", "\n\nAssistant:"]


def validate_local_model_path(model_path: str) -> Dict[str, Any]:
    """
    Validate that a local model path exists and contains required files.
    Supports ~ for home directory expansion.

    Returns:
        dict with keys: 'valid' (bool), 'error' (str if invalid), 'info' (dict with model info)
    """
    result = {"valid": False, "error": None, "info": {}}

    try:
        # Expand ~ to home directory and resolve to absolute path
        path = Path(model_path).expanduser().resolve()

        # Check if path exists
        if not path.exists():
            result["error"] = f"Path does not exist: {model_path} (expanded to: {path})"
            return result

        # Check if it's a directory
        if not path.is_dir():
            result["error"] = f"Path is not a directory: {model_path}"
            return result

        # Check for required files
        required_files = {
            "config.json": False,
            "tokenizer_config.json": False,
        }

        # Check for model weight files (at least one should exist)
        weight_patterns = [
            "*.safetensors",
            "*.bin",
            "pytorch_model*.bin",
            "model*.safetensors",
        ]

        has_weights = False
        for pattern in weight_patterns:
            if list(path.glob(pattern)):
                has_weights = True
                result["info"]["weight_format"] = pattern
                break

        # Check required files
        for req_file in required_files.keys():
            file_path = path / req_file
            if file_path.exists():
                required_files[req_file] = True

        # Validation results
        missing_files = [f for f, exists in required_files.items() if not exists]

        if missing_files:
            result["error"] = f"Missing required files: {', '.join(missing_files)}"
            return result

        if not has_weights:
            result["error"] = "No model weight files found (*.safetensors or *.bin)"
            return result

        # Try to read model config for additional info
        try:
            import json

            config_path = path / "config.json"
            with open(config_path, "r") as f:
                config = json.load(f)
                result["info"]["model_type"] = config.get("model_type", "unknown")
                result["info"]["architectures"] = config.get("architectures", [])
                # Try to get model name from config
                if "_name_or_path" in config:
                    result["info"]["_name_or_path"] = config["_name_or_path"]
        except Exception as e:
            logger.warning(f"Could not read config.json: {e}")

        # Calculate directory size
        total_size = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
        result["info"]["size_mb"] = round(total_size / (1024 * 1024), 2)
        result["info"]["path"] = str(path.resolve())

        # Extract and add the display name
        result["info"]["model_name"] = extract_model_name_from_path(str(path.resolve()), result["info"])

        result["valid"] = True
        return result

    except Exception as e:
        result["error"] = f"Error validating path: {str(e)}"
        return result


def extract_model_name_from_path(model_path: str, info: Dict[str, Any]) -> str:
    """
    Extract a meaningful model name from the local path.
    Handles HuggingFace cache directory structure and other cases.

    Args:
        model_path: Absolute path to the model directory
        info: Model info dict from validation

    Returns:
        A human-readable model name
    """
    path = Path(model_path)

    # Try to get name from config.json (_name_or_path field)
    if "_name_or_path" in info:
        name_or_path = info["_name_or_path"]
        # If it's a HF model path like "TinyLlama/TinyLlama-1.1B-Chat-v1.0", use that
        if "/" in name_or_path and not name_or_path.startswith("/"):
            return name_or_path

    # Check if this is a HuggingFace cache directory
    # Structure: .../hub/models--Org--ModelName/snapshots/<hash>/...
    path_parts = path.parts

    for i, part in enumerate(path_parts):
        if part.startswith("models--"):
            # Found HF cache structure
            # Extract model name from "models--Org--ModelName"
            model_cache_name = part.replace("models--", "", 1)
            # Replace -- with /
            model_name = model_cache_name.replace("--", "/")
            logger.info(f"Extracted model name from HF cache: {model_name}")
            return model_name

    # If not HF cache, check for common compressed model naming patterns
    # e.g., "compressed_TinyLlama_w8a8_20240101_120000"
    dir_name = path.name

    if dir_name.startswith("compressed_"):
        # Try to extract original model name
        # Remove 'compressed_' prefix and any suffix after the last underscore
        cleaned = dir_name.replace("compressed_", "", 1)
        # If it has timestamp pattern at end, remove it
        import re

        # Remove patterns like _w8a8_20240101_120000 or _w8a8
        cleaned = re.sub(r"_[wW]\d+[aA]\d+(_\d{8}_\d{6})?$", "", cleaned)
        if cleaned:
            return cleaned

    # Last resort: use directory name
    return dir_name


@app.get("/", response_class=HTMLResponse)
async def read_root():
    """Serve the main HTML page"""
    html_path = Path(__file__).parent / "index.html"
    # Fix Windows Unicode decoding issue by specifying utf-8 encoding
    try:
        with open(html_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    except UnicodeDecodeError:
        # Fallback to latin-1 encoding if utf-8 fails
        with open(html_path, "r", encoding="latin-1") as f:
            return HTMLResponse(content=f.read())


@app.get("/api/status")
async def get_status():
    """Get current server status.

    Returns with no-cache headers to ensure fresh state after backend restart.
    """
    global vllm_running, current_config, server_start_time, current_run_mode, container_id, vllm_process

    # Check status based on run mode
    running = await check_vllm_server_running()

    if not running and current_run_mode is None:
        # If run mode is not set (e.g., after restart), check if container exists
        # This handles the case where Web UI restarts but vLLM pod is still running
        if CONTAINER_MODE_AVAILABLE and container_manager:
            status = await container_manager.get_container_status()
            if status.get("running", False):
                running = True
                current_run_mode = "container"  # Reconnect to existing container
                # Restore minimal config so chat can work
                if current_config is None:
                    # Create a minimal config based on service defaults
                    current_config = VLLMConfig(
                        model="unknown",  # Can't retrieve from pod
                        host="vllm-service",  # Kubernetes service name
                        port=8000,
                        run_mode="container",
                    )
                logger.info("Reconnected to existing vLLM container after restart")

    vllm_running = running  # Update global state

    uptime = None
    if running and server_start_time:
        elapsed = datetime.now() - server_start_time
        hours, remainder = divmod(int(elapsed.total_seconds()), 3600)
        minutes, seconds = divmod(remainder, 60)
        uptime = f"{hours:02d}:{minutes:02d}:{seconds:02d}"

    server_status = ServerStatus(running=running, uptime=uptime, config=current_config)

    # Return with no-cache header - allows 304 responses but ensures validation
    return JSONResponse(content=server_status.model_dump(), headers={"Cache-Control": "no-cache"})


@app.get("/api/debug/connection")
async def debug_connection():
    """Debug endpoint to show connection configuration"""
    global current_config, current_run_mode

    is_kubernetes = os.path.exists("/var/run/secrets/kubernetes.io/serviceaccount/token")

    debug_info = {
        "current_run_mode": current_run_mode,
        "is_kubernetes": is_kubernetes,
        "container_mode_available": CONTAINER_MODE_AVAILABLE,
    }

    if current_config:
        debug_info["config"] = {
            "host": current_config.host,
            "port": current_config.port,
        }

        # Show what URL would be used
        base_url = get_vllm_base_url()
        url = f"{base_url}/v1/chat/completions"
        debug_info["url_would_use"] = url
        if current_run_mode == "remote":
            debug_info["connection_mode"] = "remote"
        elif current_run_mode == "container" and is_kubernetes:
            debug_info["connection_mode"] = "kubernetes_service"
        else:
            debug_info["connection_mode"] = "localhost"

    if is_kubernetes and container_manager and hasattr(container_manager, "namespace"):
        debug_info["kubernetes"] = {
            "service_name": getattr(container_manager, "SERVICE_NAME", "N/A"),
            "namespace": container_manager.namespace,
        }

    return debug_info


@app.get("/api/debug/test-vllm-connection")
async def test_vllm_connection():
    """Test if we can reach the vLLM service"""
    global current_config, current_run_mode

    if not current_config:
        return {"error": "No server configuration available"}

    base_url = get_vllm_base_url()

    health_url = f"{base_url}/health"

    try:
        import aiohttp

        timeout = aiohttp.ClientTimeout(total=5)
        auth_headers = get_vllm_auth_headers()
        async with aiohttp.ClientSession(timeout=timeout, headers=auth_headers) as session:
            async with session.get(health_url) as response:
                status = response.status
                text = await response.text()
                return {
                    "success": True,
                    "status_code": status,
                    "url_tested": health_url,
                    "response": text[:500],  # Limit response size
                }
    except Exception as e:
        return {"success": False, "error": str(e), "error_type": type(e).__name__, "url_tested": health_url}


@app.get("/api/features")
async def get_features():
    """Check which optional features are available.

    Returns with no-cache headers to ensure fresh data after backend restart.
    """
    # Get version from package or local file
    version = None

    # Try 1: Import from installed package
    try:
        from vllm_playground import __version__

        version = __version__
    except ImportError:
        pass

    # Try 2: Read from local vllm_playground/__init__.py (when running from source)
    if not version:
        try:
            init_file = BASE_DIR / "vllm_playground" / "__init__.py"
            if init_file.exists():
                import re

                content = init_file.read_text()
                match = re.search(r'__version__\s*=\s*["\']([^"\']+)["\']', content)
                if match:
                    version = match.group(1)
        except Exception:
            pass

    # Fallback
    if not version:
        version = "dev"

    features = {
        "version": version,
        "vllm_installed": False,  # Whether vLLM is installed (for subprocess mode)
        "vllm_version": None,
        "vllm_omni_installed": False,  # Whether vLLM-Omni is installed
        "vllm_omni_version": None,
        "guidellm": False,
        "mcp": False,
        "modelscope_installed": False,  # Whether modelscope SDK is installed
        "modelscope_version": None,
        "container_runtime": None,  # Will be 'podman', 'docker', or None
        "container_mode": CONTAINER_MODE_AVAILABLE,
    }

    # Check vLLM installation (required for subprocess mode)
    try:
        import vllm

        features["vllm_installed"] = True

        # Try to get vLLM version
        vllm_ver = getattr(vllm, "__version__", None)
        if vllm_ver is None:
            try:
                from importlib.metadata import version

                vllm_ver = version("vllm")
            except Exception:
                pass

        features["vllm_version"] = vllm_ver

        if vllm_ver:
            logger.info(f"vLLM v{vllm_ver} detected")
        else:
            logger.info("vLLM installed (version unknown)")
    except ImportError:
        features["vllm_installed"] = False
        logger.info("vLLM not installed")

    # Check guidellm
    try:
        import guidellm

        features["guidellm"] = True
    except ImportError:
        pass

    # Check vLLM-Omni installation (for omni-modality generation)
    try:
        import vllm_omni

        features["vllm_omni_installed"] = True

        # Try to get vLLM-Omni version
        omni_ver = getattr(vllm_omni, "__version__", None)
        if omni_ver is None:
            try:
                from importlib.metadata import version

                omni_ver = version("vllm-omni")
            except Exception:
                pass

        features["vllm_omni_version"] = omni_ver

        if omni_ver:
            logger.info(f"vLLM-Omni v{omni_ver} detected")
        else:
            logger.info("vLLM-Omni installed (version unknown)")
    except ImportError:
        features["vllm_omni_installed"] = False
        logger.debug("vLLM-Omni not installed")

    # Check modelscope SDK (required for ModelScope model source)
    try:
        import modelscope

        features["modelscope_installed"] = True
        modelscope_ver = getattr(modelscope, "__version__", None)
        if not modelscope_ver:
            try:
                from importlib.metadata import version

                modelscope_ver = version("modelscope")
            except Exception:
                pass
        features["modelscope_version"] = modelscope_ver
    except ImportError:
        pass

    # Check MCP - available if mcp_client module loaded successfully and mcp SDK installed
    features["mcp"] = MCP_AVAILABLE

    # Check container runtime
    if CONTAINER_MODE_AVAILABLE and container_manager:
        features["container_runtime"] = container_manager.runtime

    # Return with no-cache header - allows 304 responses but ensures validation
    return JSONResponse(content=features, headers={"Cache-Control": "no-cache"})


# =============================================================================
# MCP (Model Context Protocol) API Endpoints
# =============================================================================

# Import MCP from mcp_client module (renamed to avoid conflict with mcp PyPI package)
MCP_AVAILABLE = False
MCP_VERSION = None
get_mcp_manager = None
MCPServerConfig = None
MCPTransport = None
MCP_PRESETS = []

try:
    from .mcp_client import MCP_AVAILABLE, MCP_VERSION

    if MCP_AVAILABLE:
        from .mcp_client.manager import get_mcp_manager
        from .mcp_client.config import MCPServerConfig, MCPTransport, MCP_PRESETS

        logger.info(f"MCP enabled: version {MCP_VERSION}")
except ImportError as e:
    logger.warning(f"MCP client module not available: {e}")


class MCPServerConfigRequest(BaseModel):
    """Request model for creating/updating MCP server configuration"""

    name: str
    transport: str = "stdio"  # "stdio" or "sse"
    command: Optional[str] = None
    args: Optional[List[str]] = None
    url: Optional[str] = None
    env: Optional[Dict[str, str]] = None
    enabled: bool = True
    auto_connect: bool = False
    description: Optional[str] = None


class MCPToolCallRequest(BaseModel):
    """Request model for calling an MCP tool"""

    tool_name: str
    arguments: Dict[str, Any] = {}


@app.get("/api/mcp/status")
async def mcp_status():
    """Get MCP availability and overall status"""
    if not MCP_AVAILABLE:
        return {
            "available": False,
            "message": "MCP not installed. Run: pip install vllm-playground[mcp]",
            "version": None,
            "servers": [],
        }

    manager = get_mcp_manager()
    statuses = manager.get_status()

    return {
        "available": True,
        "version": MCP_VERSION,
        "message": "MCP is available",
        "servers": [s.model_dump() for s in statuses],
    }


@app.get("/api/mcp/configs")
async def mcp_list_configs():
    """List all MCP server configurations"""
    if not MCP_AVAILABLE:
        return {"configs": [], "error": "MCP not installed"}

    manager = get_mcp_manager()
    configs = manager.list_configs()
    statuses = {s.name: s for s in manager.get_status()}

    result = []
    for config in configs:
        config_dict = config.model_dump()
        status = statuses.get(config.name)
        if status:
            config_dict["connected"] = status.connected
            config_dict["tools_count"] = status.tools_count
            config_dict["error"] = status.error
        else:
            config_dict["connected"] = False
            config_dict["tools_count"] = 0
            config_dict["error"] = None
        result.append(config_dict)

    return {"configs": result}


@app.post("/api/mcp/configs")
async def mcp_save_config(request: MCPServerConfigRequest):
    """Create or update an MCP server configuration"""
    if not MCP_AVAILABLE:
        raise HTTPException(status_code=400, detail="MCP not installed. Run: pip install vllm-playground[mcp]")

    try:
        config = MCPServerConfig(
            name=request.name,
            transport=MCPTransport(request.transport),
            command=request.command,
            args=request.args,
            url=request.url,
            env=request.env,
            enabled=request.enabled,
            auto_connect=request.auto_connect,
            description=request.description,
        )

        manager = get_mcp_manager()
        manager.save_config(config)

        return {"success": True, "config": config.model_dump()}
    except Exception as e:
        logger.error(f"Failed to save MCP config: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/api/mcp/configs/{name}")
async def mcp_delete_config(name: str):
    """Delete an MCP server configuration"""
    if not MCP_AVAILABLE:
        raise HTTPException(status_code=400, detail="MCP not installed")

    manager = get_mcp_manager()

    # Disconnect if connected
    if name in manager.connections:
        await manager.disconnect(name)

    success = manager.delete_config(name)
    if not success:
        raise HTTPException(status_code=404, detail=f"Server '{name}' not found")

    return {"success": True, "message": f"Server '{name}' deleted"}


@app.post("/api/mcp/connect/{name}")
async def mcp_connect(name: str):
    """Connect to an MCP server"""
    if not MCP_AVAILABLE:
        raise HTTPException(status_code=400, detail="MCP not installed")

    manager = get_mcp_manager()
    success = await manager.connect(name)

    if success:
        status = manager.get_status(name)[0]
        return {"success": True, "message": f"Connected to '{name}'", "status": status.model_dump()}
    else:
        status = manager.get_status(name)
        error = status[0].error if status else "Unknown error"
        raise HTTPException(status_code=400, detail=f"Failed to connect: {error}")


@app.post("/api/mcp/disconnect/{name}")
async def mcp_disconnect(name: str):
    """Disconnect from an MCP server"""
    if not MCP_AVAILABLE:
        raise HTTPException(status_code=400, detail="MCP not installed")

    manager = get_mcp_manager()
    success = await manager.disconnect(name)

    if success:
        return {"success": True, "message": f"Disconnected from '{name}'"}
    else:
        raise HTTPException(status_code=404, detail=f"Server '{name}' not connected")


@app.get("/api/mcp/tools")
async def mcp_get_tools(servers: Optional[str] = None):
    """
    Get tools from connected MCP servers in OpenAI format.

    Query params:
        servers: Comma-separated list of server names (optional, defaults to all)
    """
    if not MCP_AVAILABLE:
        return {"tools": [], "error": "MCP not installed"}

    manager = get_mcp_manager()
    server_list = servers.split(",") if servers else None
    tools = manager.get_tools(server_list)

    return {"tools": tools, "count": len(tools)}


@app.get("/api/mcp/servers/{name}/details")
async def mcp_get_server_details(name: str):
    """
    Get detailed information about a connected MCP server.
    Returns tools, resources, and prompts with full schemas.
    """
    if not MCP_AVAILABLE:
        raise HTTPException(status_code=400, detail="MCP not installed")

    manager = get_mcp_manager()

    if name not in manager.connections:
        raise HTTPException(status_code=404, detail=f"Server '{name}' not connected")

    connection = manager.connections[name]

    return {
        "name": name,
        "connected": connection.connected,
        "tools": connection.tools,
        "resources": connection.resources,
        "prompts": connection.prompts,
        "error": connection.error,
    }


@app.post("/api/mcp/call")
async def mcp_call_tool(request: MCPToolCallRequest):
    """Execute a tool call on an MCP server"""
    if not MCP_AVAILABLE:
        raise HTTPException(status_code=400, detail="MCP not installed")

    manager = get_mcp_manager()

    if not manager.is_mcp_tool(request.tool_name):
        raise HTTPException(status_code=404, detail=f"Tool '{request.tool_name}' not found")

    try:
        result = await manager.call_tool(request.tool_name, request.arguments)
        return {"success": True, "result": result}
    except Exception as e:
        logger.error(f"MCP tool call failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/mcp/presets")
async def mcp_get_presets():
    """Get built-in MCP server presets"""
    # MCP_PRESETS is defined at module level (empty list if MCP not available)
    return {"presets": MCP_PRESETS}


@app.get("/api/hardware-capabilities")
async def get_hardware_capabilities():
    """
    Check GPU availability and detect accelerator type

    This endpoint checks if GPU hardware is available in the cluster.
    For Kubernetes/OpenShift: Checks node resources for nvidia.com/gpu or amd.com/gpu
    For local/container: Falls back to nvidia-smi or amd-smi check

    Returns:
        gpu_available: bool - Whether any GPU is detected
        detection_method: str - How GPU was detected (nvidia-smi, amd-smi, kubernetes, none)
        accelerator: str - Detected accelerator type (nvidia, amd, or null if none)
    """
    gpu_available = False
    detection_method = "none"
    accelerator = None  # Will be "nvidia" or "amd" if detected

    # First, try Kubernetes API if we're in a K8s environment
    if os.getenv("KUBERNETES_NAMESPACE"):
        try:
            from kubernetes import client, config

            # Load in-cluster config
            config.load_incluster_config()
            v1 = client.CoreV1Api()

            # List all nodes and check for GPU resources
            nodes = v1.list_node()
            for node in nodes.items:
                if node.status and node.status.capacity:
                    # Check for NVIDIA GPUs
                    nvidia_capacity = node.status.capacity.get("nvidia.com/gpu", "0")
                    if nvidia_capacity and int(nvidia_capacity) > 0:
                        gpu_available = True
                        detection_method = "kubernetes"
                        accelerator = "nvidia"
                        logger.info(
                            f"NVIDIA GPU detected via Kubernetes API: {node.metadata.name} has {nvidia_capacity} GPUs"
                        )
                        break

                    # Check for AMD GPUs
                    amd_capacity = node.status.capacity.get("amd.com/gpu", "0")
                    if amd_capacity and int(amd_capacity) > 0:
                        gpu_available = True
                        detection_method = "kubernetes"
                        accelerator = "amd"
                        logger.info(
                            f"AMD GPU detected via Kubernetes API: {node.metadata.name} has {amd_capacity} GPUs"
                        )
                        break

                    # Check for Google Cloud TPUs
                    tpu_capacity = node.status.capacity.get("google.com/tpu", "0")
                    if tpu_capacity and int(tpu_capacity) > 0:
                        gpu_available = True
                        detection_method = "kubernetes"
                        accelerator = "tpu"
                        logger.info(f"TPU detected via Kubernetes API: {node.metadata.name} has {tpu_capacity} TPUs")
                        break

                # Also check node labels for GPU indicators
                if node.metadata and node.metadata.labels:
                    labels = node.metadata.labels
                    if any("nvidia" in k.lower() for k in labels.keys()):
                        if node.status and node.status.capacity:
                            gpu_capacity = node.status.capacity.get("nvidia.com/gpu", "0")
                            if gpu_capacity and int(gpu_capacity) > 0:
                                gpu_available = True
                                detection_method = "kubernetes"
                                accelerator = "nvidia"
                                logger.info(f"NVIDIA GPU detected via node labels: {node.metadata.name}")
                                break
                    if any("amd" in k.lower() for k in labels.keys()):
                        if node.status and node.status.capacity:
                            gpu_capacity = node.status.capacity.get("amd.com/gpu", "0")
                            if gpu_capacity and int(gpu_capacity) > 0:
                                gpu_available = True
                                detection_method = "kubernetes"
                                accelerator = "amd"
                                logger.info(f"AMD GPU detected via node labels: {node.metadata.name}")
                                break
                    if any("tpu" in k.lower() or "cloud.google.com/gke-tpu" in k for k in labels.keys()):
                        if node.status and node.status.capacity:
                            tpu_capacity = node.status.capacity.get("google.com/tpu", "0")
                            if tpu_capacity and int(tpu_capacity) > 0:
                                gpu_available = True
                                detection_method = "kubernetes"
                                accelerator = "tpu"
                                logger.info(f"TPU detected via node labels: {node.metadata.name}")
                                break

            if not gpu_available:
                logger.info("No GPUs found in Kubernetes cluster nodes")

        except ImportError:
            logger.info("Kubernetes client not available - skipping K8s GPU check")
        except Exception as e:
            logger.warning(f"Error checking GPU via Kubernetes API: {e}")

    # Fallback: Try nvidia-smi for NVIDIA GPUs (local/container environments)
    if not gpu_available and not os.getenv("KUBERNETES_NAMESPACE"):
        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"], capture_output=True, text=True, timeout=2
            )
            if result.returncode == 0 and bool(result.stdout.strip()):
                gpu_available = True
                detection_method = "nvidia-smi"
                accelerator = "nvidia"
                logger.info(f"NVIDIA GPU detected via nvidia-smi: {result.stdout.strip()}")
        except FileNotFoundError:
            logger.debug("nvidia-smi not found - checking for AMD GPU")
        except subprocess.TimeoutExpired:
            logger.warning("nvidia-smi timeout")
        except Exception as e:
            logger.warning(f"Error checking GPU via nvidia-smi: {e}")

    # Fallback: Try amd-smi for AMD GPUs (local/container environments)
    if not gpu_available and not os.getenv("KUBERNETES_NAMESPACE"):
        try:
            result = subprocess.run(["amd-smi", "list"], capture_output=True, text=True, timeout=2)
            # amd-smi list returns 0 and shows GPU info if AMD GPUs are present
            if result.returncode == 0 and "GPU" in result.stdout:
                gpu_available = True
                detection_method = "amd-smi"
                accelerator = "amd"
                # Extract GPU name from output (first line after GPU:)
                lines = result.stdout.strip().split("\n")
                gpu_info = next((l for l in lines if "BDF" in l or "GPU" in l), "AMD GPU")
                logger.info(f"AMD GPU detected via amd-smi: {gpu_info}")
        except FileNotFoundError:
            logger.debug("amd-smi not found - no AMD GPU detected")
        except subprocess.TimeoutExpired:
            logger.warning("amd-smi timeout")
        except Exception as e:
            logger.warning(f"Error checking GPU via amd-smi: {e}")

    # Fallback: Try tpu-info for Google Cloud TPUs (local/container environments)
    if not gpu_available and not os.getenv("KUBERNETES_NAMESPACE"):
        try:
            result = subprocess.run(["tpu-info"], capture_output=True, text=True, timeout=5)
            # tpu-info returns 0 and shows TPU info if TPUs are present
            if result.returncode == 0 and ("TPU" in result.stdout or "chip" in result.stdout.lower()):
                gpu_available = True
                detection_method = "tpu-info"
                accelerator = "tpu"
                logger.info(f"TPU detected via tpu-info")
        except FileNotFoundError:
            # Fallback: Check for /dev/accel* devices (TPU device nodes)
            import glob

            accel_devices = glob.glob("/dev/accel*")
            if accel_devices:
                gpu_available = True
                detection_method = "dev-accel"
                accelerator = "tpu"
                logger.info(f"TPU detected via /dev/accel* devices: {accel_devices}")
            else:
                logger.debug("tpu-info not found and no /dev/accel* devices - no TPU detected")
        except subprocess.TimeoutExpired:
            logger.warning("tpu-info timeout")
        except Exception as e:
            logger.warning(f"Error checking TPU via tpu-info: {e}")

    logger.info(f"Final GPU availability: {gpu_available} (method: {detection_method}, accelerator: {accelerator})")
    return {
        "gpu_available": gpu_available,
        "detection_method": detection_method,
        "accelerator": accelerator,  # "nvidia", "amd", "tpu", or None
    }


def safe_int(value, default=0):
    """Safely convert value to int, handling N/A, [N/A], empty strings, etc."""
    if value is None:
        return default
    # Remove brackets and whitespace
    cleaned = str(value).strip().replace("[", "").replace("]", "")
    # Handle N/A, Not Supported, etc.
    if not cleaned or cleaned.upper() in ("N/A", "NOT SUPPORTED", "UNKNOWN", "-"):
        return default
    try:
        return int(cleaned)
    except (ValueError, TypeError):
        return default


def get_jetson_unified_memory():
    """
    Get unified memory info for Jetson devices from /proc/meminfo.
    Jetson uses unified memory shared between CPU and GPU.
    Returns (memory_used_mb, memory_total_mb, memory_free_mb) or None if not available.
    """
    try:
        with open("/proc/meminfo", "r") as f:
            meminfo = {}
            for line in f:
                parts = line.split()
                if len(parts) >= 2:
                    key = parts[0].rstrip(":")
                    # Values are in kB
                    value = int(parts[1])
                    meminfo[key] = value

            mem_total_kb = meminfo.get("MemTotal", 0)
            mem_available_kb = meminfo.get("MemAvailable", meminfo.get("MemFree", 0))
            mem_used_kb = mem_total_kb - mem_available_kb

            # Convert to MB for consistency with nvidia-smi output
            return (mem_used_kb // 1024, mem_total_kb // 1024, mem_available_kb // 1024)
    except Exception as e:
        logger.warning(f"Failed to read /proc/meminfo for Jetson memory: {e}")
        return None


def is_jetson_device(gpu_name: str) -> bool:
    """Check if the GPU is a Jetson device based on name."""
    jetson_keywords = ["thor", "orin", "xavier", "nano", "tx1", "tx2", "agx", "jetson"]
    name_lower = gpu_name.lower()
    return any(keyword in name_lower for keyword in jetson_keywords)


def get_jetson_temperature():
    """
    Get temperature for Jetson devices from thermal zones.
    Jetson uses Linux thermal zones instead of nvidia-smi for temperature.

    Priority order:
    1. tj-thermal (Thermal Junction - most accurate)
    2. gpu-thermal
    3. Any available thermal zone

    Returns temperature in Celsius or None if not available.
    """
    thermal_base = "/sys/devices/virtual/thermal"
    preferred_zones = ["tj-thermal", "gpu-thermal"]

    try:
        import os

        # First, try preferred thermal zones
        for zone_name in preferred_zones:
            for zone_dir in os.listdir(thermal_base):
                if zone_dir.startswith("thermal_zone"):
                    zone_path = os.path.join(thermal_base, zone_dir)
                    type_path = os.path.join(zone_path, "type")
                    temp_path = os.path.join(zone_path, "temp")

                    try:
                        with open(type_path, "r") as f:
                            zone_type = f.read().strip()

                        if zone_type == zone_name:
                            with open(temp_path, "r") as f:
                                # Temperature is in milli-Celsius
                                temp_mc = int(f.read().strip())
                                temp_c = temp_mc // 1000
                                logger.debug(f"Jetson temperature from {zone_name}: {temp_c}°C")
                                return temp_c
                    except (IOError, ValueError):
                        continue

        # Fallback: try any thermal zone with 'gpu' in name
        for zone_dir in os.listdir(thermal_base):
            if zone_dir.startswith("thermal_zone"):
                zone_path = os.path.join(thermal_base, zone_dir)
                type_path = os.path.join(zone_path, "type")
                temp_path = os.path.join(zone_path, "temp")

                try:
                    with open(type_path, "r") as f:
                        zone_type = f.read().strip()

                    if "gpu" in zone_type.lower() or "tj" in zone_type.lower():
                        with open(temp_path, "r") as f:
                            temp_mc = int(f.read().strip())
                            temp_c = temp_mc // 1000
                            logger.debug(f"Jetson temperature from {zone_type}: {temp_c}°C")
                            return temp_c
                except (IOError, ValueError):
                    continue

    except Exception as e:
        logger.warning(f"Failed to read Jetson temperature: {e}")

    return None


@app.get("/api/gpu-status")
async def get_gpu_status():
    """
    Get detailed GPU status information including memory usage and utilization.
    Supports:
    - NVIDIA desktop GPUs (4090, etc.) via nvidia-smi
    - NVIDIA Jetson devices (Thor, Orin, etc.) with unified memory
    - AMD GPUs via amd-smi

    For Jetson devices with unified memory, memory info is read from /proc/meminfo
    since nvidia-smi returns [N/A] for memory fields.
    """
    gpu_info = []
    accelerator_type = None

    # First, try nvidia-smi for NVIDIA GPUs
    nvidia_found = False
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=index,name,memory.used,memory.total,memory.free,utilization.gpu,temperature.gpu",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )

        if result.returncode == 0 and result.stdout.strip():
            nvidia_found = True
            accelerator_type = "nvidia"
            lines = result.stdout.strip().split("\n")
            for line in lines:
                parts = [p.strip() for p in line.split(",")]
                if len(parts) >= 7:
                    gpu_name = parts[1]
                    memory_used = safe_int(parts[2], 0)
                    memory_total = safe_int(parts[3], 0)
                    memory_free = safe_int(parts[4], 0)

                    # Check if this is a Jetson device with unified memory
                    is_jetson = is_jetson_device(gpu_name)
                    temperature = safe_int(parts[6], 0)

                    if is_jetson:
                        # Jetson uses unified memory, get from /proc/meminfo
                        if memory_total == 0:
                            unified_mem = get_jetson_unified_memory()
                            if unified_mem:
                                memory_used, memory_total, memory_free = unified_mem
                                logger.info(
                                    f"Jetson unified memory: {memory_used}MB used, {memory_total}MB total, {memory_free}MB free"
                                )

                        # Jetson temperature from thermal zones (nvidia-smi returns [N/A])
                        if temperature == 0:
                            jetson_temp = get_jetson_temperature()
                            if jetson_temp is not None:
                                temperature = jetson_temp
                                logger.info(f"Jetson temperature from thermal zone: {temperature}°C")

                    gpu_info.append(
                        {
                            "index": safe_int(parts[0], 0),
                            "name": gpu_name,
                            "memory_used": memory_used,
                            "memory_total": memory_total,
                            "memory_free": memory_free,
                            "utilization": safe_int(parts[5], 0),
                            "temperature": temperature,
                            "is_jetson": is_jetson,
                            "unified_memory": is_jetson,
                            "accelerator": "nvidia",
                        }
                    )
    except FileNotFoundError:
        logger.debug("nvidia-smi not found - checking for AMD GPU")
    except subprocess.TimeoutExpired:
        logger.warning("nvidia-smi timeout")
    except Exception as e:
        logger.warning(f"Error getting NVIDIA GPU status: {e}")

    # If no NVIDIA GPUs found, try amd-smi for AMD GPUs
    if not nvidia_found:
        try:
            # Use amd-smi metric to get GPU metrics in JSON format
            result = subprocess.run(["amd-smi", "metric", "--json"], capture_output=True, text=True, timeout=5)

            if result.returncode == 0 and result.stdout.strip():
                import json as json_module

                try:
                    amd_data = json_module.loads(result.stdout)
                    accelerator_type = "amd"

                    # amd-smi returns a list of GPU metrics
                    if isinstance(amd_data, list):
                        for idx, gpu_data in enumerate(amd_data):
                            # Extract metrics from AMD SMI output
                            # Structure may vary by version, handle gracefully
                            gpu_name = gpu_data.get("asic", {}).get("name", f"AMD GPU {idx}")
                            if not gpu_name or gpu_name == f"AMD GPU {idx}":
                                gpu_name = gpu_data.get("gpu", f"AMD GPU {idx}")

                            # Memory info (in MB)
                            memory = gpu_data.get("vram", {})
                            if not memory:
                                memory = gpu_data.get("memory", {})
                            memory_total = safe_int(memory.get("total", {}).get("value", 0), 0)
                            memory_used = safe_int(memory.get("used", {}).get("value", 0), 0)
                            memory_free = memory_total - memory_used if memory_total > 0 else 0

                            # Utilization
                            usage = gpu_data.get("usage", {})
                            utilization = safe_int(usage.get("gfx_activity", {}).get("value", 0), 0)
                            if utilization == 0:
                                utilization = safe_int(gpu_data.get("gfx_activity", {}).get("value", 0), 0)

                            # Temperature
                            temp_data = gpu_data.get("temperature", {})
                            temperature = safe_int(temp_data.get("hotspot", {}).get("value", 0), 0)
                            if temperature == 0:
                                temperature = safe_int(temp_data.get("edge", {}).get("value", 0), 0)

                            gpu_info.append(
                                {
                                    "index": idx,
                                    "name": str(gpu_name),
                                    "memory_used": memory_used,
                                    "memory_total": memory_total,
                                    "memory_free": memory_free,
                                    "utilization": utilization,
                                    "temperature": temperature,
                                    "is_jetson": False,
                                    "unified_memory": False,
                                    "accelerator": "amd",
                                }
                            )

                    logger.info(f"AMD GPU status retrieved: {len(gpu_info)} GPUs found")
                except json_module.JSONDecodeError:
                    logger.warning("Failed to parse amd-smi JSON output")

        except FileNotFoundError:
            logger.debug("amd-smi not found - no AMD GPU status available")
        except subprocess.TimeoutExpired:
            logger.warning("amd-smi timeout")
        except Exception as e:
            logger.warning(f"Error getting AMD GPU status: {e}")

    return {
        "gpu_available": len(gpu_info) > 0,
        "gpu_count": len(gpu_info),
        "gpus": gpu_info,
        "accelerator": accelerator_type,
    }


@app.post("/api/start")
async def start_server(config: VLLMConfig):
    """Start the vLLM server in subprocess, container, or remote mode"""
    global \
        container_id, \
        vllm_process, \
        vllm_running, \
        current_config, \
        server_start_time, \
        current_model_identifier, \
        current_served_model_name, \
        current_run_mode

    # Check if server is already running
    if await check_vllm_server_running():
        raise HTTPException(status_code=400, detail="Server is already running")

    # =========================================================================
    # Remote mode - connect to an existing vLLM instance
    # =========================================================================
    if config.run_mode == "remote":
        if not config.remote_url:
            raise HTTPException(
                status_code=400,
                detail="Remote URL is required for remote mode. Provide the base URL of a running vLLM instance (e.g., http://gpu-server:8000)."
            )

        # Basic URL validation
        remote_url = config.remote_url.rstrip("/")
        if not remote_url.startswith(("http://", "https://")):
            raise HTTPException(
                status_code=400,
                detail="Remote URL must start with http:// or https://"
            )

        await broadcast_log(f"[WEBUI] Run mode: REMOTE")
        await broadcast_log(f"[WEBUI] Connecting to remote vLLM instance at {remote_url}...")

        # Build auth headers if API key provided
        auth_headers = {}
        if config.remote_api_key:
            auth_headers["Authorization"] = f"Bearer {config.remote_api_key}"
            await broadcast_log("[WEBUI] Using API key for authentication")

        try:
            import aiohttp

            timeout = aiohttp.ClientTimeout(total=10)
            async with aiohttp.ClientSession(timeout=timeout, headers=auth_headers) as session:
                # Probe health endpoint
                health_url = f"{remote_url}/health"
                await broadcast_log(f"[WEBUI] Checking health: {health_url}")
                health_ok = False
                try:
                    async with session.get(health_url) as response:
                        if response.status == 200:
                            health_ok = True
                            await broadcast_log("[WEBUI] ✓ Remote server is healthy")
                        else:
                            text = await response.text()
                            await broadcast_log(f"[WEBUI] ⚠ Health check returned status {response.status}: {text[:200]}")
                except aiohttp.ClientError as e:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Cannot connect to remote vLLM instance at {remote_url}: {str(e)}"
                    )

                # Probe /v1/models to discover served models and their details
                models_url = f"{remote_url}/v1/models"
                await broadcast_log(f"[WEBUI] Discovering models: {models_url}")
                discovered_model = None
                discovered_models_list = []
                try:
                    async with session.get(models_url) as response:
                        if response.status == 200:
                            data = await response.json()
                            models = data.get("data", [])
                            if models:
                                discovered_model = models[0].get("id", None)
                                discovered_models_list = [
                                    {
                                        "id": m.get("id", "unknown"),
                                        "owned_by": m.get("owned_by", ""),
                                        "max_model_len": m.get("max_model_len"),
                                        "root": m.get("root", ""),
                                    }
                                    for m in models
                                ]
                                model_list = ", ".join(m.get("id", "unknown") for m in models)
                                await broadcast_log(f"[WEBUI] ✓ Available models: {model_list}")
                                # Log extra details if available
                                first_model = models[0]
                                if first_model.get("max_model_len"):
                                    await broadcast_log(f"[WEBUI] ✓ Max context length: {first_model['max_model_len']}")
                            else:
                                await broadcast_log("[WEBUI] ⚠ No models found on remote server")
                        else:
                            await broadcast_log(f"[WEBUI] ⚠ Could not list models (status {response.status})")
                except aiohttp.ClientError as e:
                    await broadcast_log(f"[WEBUI] ⚠ Could not discover models: {str(e)}")

            # Set global state
            current_run_mode = "remote"
            current_config = config
            vllm_running = True
            server_start_time = datetime.now()

            # Use discovered model or served_model_name or config.model
            if config.served_model_name:
                current_model_identifier = config.served_model_name
                current_served_model_name = config.served_model_name
            elif discovered_model:
                current_model_identifier = discovered_model
                current_served_model_name = None
            else:
                current_model_identifier = config.model or "unknown"
                current_served_model_name = None

            await broadcast_log(f"[WEBUI] ✓ Connected to remote vLLM instance")
            await broadcast_log(f"[WEBUI] Model: {current_model_identifier}")
            await broadcast_log(f"[WEBUI] URL: {remote_url}")

            return {
                "status": "connected",
                "mode": "remote",
                "remote_url": remote_url,
                "model": current_model_identifier,
                "health": health_ok,
                "models": discovered_models_list,
            }

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to connect to remote vLLM: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to connect to remote vLLM instance: {str(e)}"
            )

    # =========================================================================
    # Subprocess / Container mode - launch a local vLLM instance
    # =========================================================================

    # Determine if using local model or HuggingFace Hub
    # Local model path takes precedence
    model_source = None
    model_display_name = None

    if config.local_model_path:
        # Using local model - validate with comprehensive validation
        await broadcast_log("[WEBUI] Validating local model path...")

        validation_result = validate_local_model_path(config.local_model_path)

        if not validation_result["valid"]:
            error_msg = validation_result.get("error", "Invalid local model path")
            await broadcast_log(f"[WEBUI] ERROR: {error_msg}")
            raise HTTPException(status_code=400, detail=error_msg)

        # Use resolved absolute path
        info = validation_result["info"]
        model_source = info["path"]

        # Extract meaningful model name
        model_display_name = extract_model_name_from_path(model_source, info)

        # Log detailed validation info
        await broadcast_log(f"[WEBUI] ✓ Local model validated successfully")
        await broadcast_log(f"[WEBUI] Model name: {model_display_name}")
        await broadcast_log(f"[WEBUI] Path: {model_source}")
        await broadcast_log(f"[WEBUI] Size: {info.get('size_mb', 'unknown')} MB")
        if info.get("model_type"):
            await broadcast_log(f"[WEBUI] Model type: {info['model_type']}")
        if info.get("weight_format"):
            await broadcast_log(f"[WEBUI] Weight format: {info['weight_format']}")
    else:
        # Using HuggingFace Hub model
        model_source = config.model
        model_display_name = config.model

        # Check if gated model requires HF token
        # Meta Llama models (official and RedHatAI) are gated in our supported list
        model_lower = config.model.lower()
        is_gated = "meta-llama/" in model_lower or "redhatai/llama" in model_lower

        if is_gated and not config.hf_token:
            raise HTTPException(
                status_code=400,
                detail=f"This model ({config.model}) is gated and requires a HuggingFace token. Please provide your HF token.",
            )
        await broadcast_log(f"[WEBUI] Using HuggingFace Hub model: {model_source}")

    try:
        # Set run mode
        current_run_mode = config.run_mode

        # Validate container mode is available if selected
        if config.run_mode == "container" and (not CONTAINER_MODE_AVAILABLE or not container_manager):
            raise HTTPException(
                status_code=400, detail="Container mode is not available. container_manager module not found."
            )

        await broadcast_log(f"[WEBUI] Run mode: {config.run_mode.upper()}")

        # Validate and configure custom virtual environment if provided
        python_executable = sys.executable  # Default to current Python
        if config.venv_path and config.run_mode == "subprocess":
            await broadcast_log("[WEBUI] Validating custom virtual environment...")

            try:
                # Expand and resolve path (security: prevent path traversal)
                venv_path = Path(config.venv_path).expanduser().resolve(strict=False)

                # Verify path exists
                if not venv_path.exists():
                    raise HTTPException(
                        status_code=400, detail=f"Virtual environment path does not exist: {config.venv_path}"
                    )

                # Verify it's a directory
                if not venv_path.is_dir():
                    raise HTTPException(
                        status_code=400, detail=f"Virtual environment path is not a directory: {config.venv_path}"
                    )

                # Find Python executable (platform-specific)
                import platform

                if platform.system() == "Windows":
                    python_path = venv_path / "Scripts" / "python.exe"
                else:
                    python_path = venv_path / "bin" / "python"

                # Verify Python executable exists
                if not python_path.exists():
                    raise HTTPException(
                        status_code=400, detail=f"Python executable not found in virtual environment: {python_path}"
                    )

                # Verify it's actually a valid Python executable
                try:
                    result = subprocess.run([str(python_path), "--version"], capture_output=True, text=True, timeout=5)
                    if result.returncode != 0:
                        raise HTTPException(status_code=400, detail=f"Invalid Python executable: {python_path}")
                    python_version = result.stdout.strip()
                    await broadcast_log(f"[WEBUI] Found Python: {python_version}")
                except subprocess.TimeoutExpired:
                    raise HTTPException(status_code=400, detail=f"Python executable timed out: {python_path}")
                except Exception as e:
                    raise HTTPException(status_code=400, detail=f"Failed to verify Python executable: {e}")

                # Check for vLLM installation using multiple methods
                vllm_found = False
                vllm_version = None
                detection_method = None

                # Method 1: Try direct Python import
                try:
                    result = subprocess.run(
                        [str(python_path), "-c", "import vllm; print(vllm.__version__)"],
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                    if result.returncode == 0 and result.stdout.strip():
                        vllm_found = True
                        vllm_version = result.stdout.strip()
                        detection_method = "Python import"
                except Exception:
                    pass

                # Method 2: Try pip list
                if not vllm_found:
                    try:
                        pip_path = python_path.parent / ("pip.exe" if platform.system() == "Windows" else "pip")
                        result = subprocess.run(
                            [str(pip_path), "list", "--format=freeze"], capture_output=True, text=True, timeout=10
                        )
                        if result.returncode == 0:
                            for line in result.stdout.split("\n"):
                                if line.startswith("vllm=="):
                                    vllm_found = True
                                    vllm_version = line.split("==")[1]
                                    detection_method = "pip list"
                                    break
                    except Exception:
                        pass

                # Method 3: Try uv pip list (fallback for vllm-metal installations)
                if not vllm_found:
                    try:
                        result = subprocess.run(
                            ["uv", "pip", "list", "--python", str(python_path)],
                            capture_output=True,
                            text=True,
                            timeout=10,
                        )
                        if result.returncode == 0:
                            for line in result.stdout.split("\n"):
                                if "vllm" in line.lower():
                                    vllm_found = True
                                    # Extract version from "vllm 0.13.0" format
                                    parts = line.split()
                                    if len(parts) >= 2:
                                        vllm_version = parts[1]
                                    detection_method = "uv pip list"
                                    break
                    except FileNotFoundError:
                        # uv not installed, skip this method
                        pass
                    except Exception:
                        pass

                # Error if vLLM not found by any method
                if not vllm_found:
                    raise HTTPException(
                        status_code=400,
                        detail=f"vLLM not found in virtual environment: {venv_path}\n"
                        f"Tried: Python import, pip list, uv pip list\n"
                        f"Please ensure vLLM is installed in this environment.",
                    )

                # Success - use this Python executable
                python_executable = str(python_path)
                await broadcast_log(f"[WEBUI] ✓ vLLM detected via {detection_method}: v{vllm_version}")
                await broadcast_log(f"[WEBUI] Using Python from: {python_executable}")

            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"Error validating virtual environment: {e}")
                raise HTTPException(status_code=400, detail=f"Error validating virtual environment: {str(e)}")

        # Convert compute_mode to use_cpu for backend compatibility
        # compute_mode: "cpu" | "gpu" | "metal"
        # Metal mode uses GPU settings (not CPU)
        if config.compute_mode == "cpu":
            config.use_cpu = True
            logger.info("CPU mode selected via compute_mode")
            await broadcast_log("[WEBUI] Compute Mode: CPU")
        elif config.compute_mode == "metal":
            config.use_cpu = False  # Metal uses GPU settings
            logger.info("Metal mode selected via compute_mode")
            await broadcast_log("[WEBUI] Compute Mode: Metal (Apple Silicon GPU)")
        else:  # gpu
            config.use_cpu = False
            logger.info("GPU mode selected via compute_mode")
            await broadcast_log("[WEBUI] Compute Mode: GPU")

        # Set environment variables for CPU mode
        env = os.environ.copy()

        # Set HuggingFace token if provided (for gated models like Llama, Gemma)
        if config.hf_token:
            env["HF_TOKEN"] = config.hf_token
            env["HUGGING_FACE_HUB_TOKEN"] = config.hf_token  # Alternative name
            await broadcast_log("[WEBUI] HuggingFace token configured for gated models")
        elif os.environ.get("HF_TOKEN"):
            await broadcast_log("[WEBUI] Using HF_TOKEN from environment")

        # Set GPU device selection for subprocess mode
        if not config.use_cpu and config.gpu_device and config.run_mode == "subprocess":
            env["CUDA_VISIBLE_DEVICES"] = config.gpu_device
            logger.info(f"GPU Device Selection - CUDA_VISIBLE_DEVICES={config.gpu_device}")
            await broadcast_log(f"[WEBUI] GPU Device Selection - CUDA_VISIBLE_DEVICES={config.gpu_device}")

        # Set ModelScope environment variables if using ModelScope as model source
        if config.use_modelscope:
            env["VLLM_USE_MODELSCOPE"] = "True"
            await broadcast_log("[WEBUI] Using ModelScope as model source (modelscope.cn)")
            if config.modelscope_token:
                env["MODELSCOPE_SDK_TOKEN"] = config.modelscope_token
                await broadcast_log("[WEBUI] ModelScope token configured")
            elif os.environ.get("MODELSCOPE_SDK_TOKEN"):
                await broadcast_log("[WEBUI] Using MODELSCOPE_SDK_TOKEN from environment")

        if config.use_cpu:
            env["VLLM_CPU_KVCACHE_SPACE"] = str(config.cpu_kvcache_space)
            env["VLLM_CPU_OMP_THREADS_BIND"] = config.cpu_omp_threads_bind
            # Disable problematic CPU optimizations on Apple Silicon
            env["VLLM_CPU_MOE_PREPACK"] = "0"
            env["VLLM_CPU_SGL_KERNEL"] = "0"
            # Force CPU target device
            env["VLLM_TARGET_DEVICE"] = "cpu"
            # Enable V1 engine (required to be set explicitly in vLLM 0.11.0+)
            env["VLLM_USE_V1"] = "1"
            logger.info(
                f"CPU Mode - VLLM_CPU_KVCACHE_SPACE={config.cpu_kvcache_space}, VLLM_CPU_OMP_THREADS_BIND={config.cpu_omp_threads_bind}"
            )
            await broadcast_log(
                f"[WEBUI] CPU Settings - KV Cache: {config.cpu_kvcache_space}GB, Thread Binding: {config.cpu_omp_threads_bind}"
            )
            await broadcast_log(f"[WEBUI] CPU Optimizations disabled for Apple Silicon compatibility")
            await broadcast_log(f"[WEBUI] Using V1 engine for CPU mode")
        elif config.compute_mode == "metal":
            # Metal GPU mode (Apple Silicon)
            env["VLLM_TARGET_DEVICE"] = "metal"
            env["VLLM_USE_V1"] = "1"
            logger.info("Metal Mode - VLLM_TARGET_DEVICE=metal, VLLM_USE_V1=1")
            await broadcast_log(f"[WEBUI] Metal Settings - Target Device: metal, V1 Engine: enabled")
            await broadcast_log(f"[WEBUI] Using Apple Silicon GPU acceleration")
        else:
            await broadcast_log("[WEBUI] Using GPU mode")

        # Build command
        cmd = [
            python_executable,
            "-m",
            "vllm.entrypoints.openai.api_server",
            "--model",
            model_source,  # Use model_source (local path or HF model name)
            "--host",
            config.host,
            "--port",
            str(config.port),
        ]

        # Add served-model-name if specified (required for Claude Code integration)
        # This sets an alias for the model that doesn't contain '/'
        if config.served_model_name:
            cmd.extend(["--served-model-name", config.served_model_name])
            await broadcast_log(f"[WEBUI] Served model name: {config.served_model_name}")

        # Add GPU-specific parameters only if not using CPU
        # Note: vLLM auto-detects CPU platform, no --device flag needed
        if not config.use_cpu:
            cmd.extend(
                [
                    "--tensor-parallel-size",
                    str(config.tensor_parallel_size),
                    "--gpu-memory-utilization",
                    str(config.gpu_memory_utilization),
                ]
            )
        else:
            await broadcast_log("[WEBUI] CPU mode - vLLM will auto-detect CPU backend")

        # Set dtype (use bfloat16 for CPU as recommended)
        if config.use_cpu and config.dtype == "auto":
            cmd.extend(["--dtype", "bfloat16"])
            await broadcast_log("[WEBUI] Using dtype=bfloat16 (recommended for CPU)")
        else:
            cmd.extend(["--dtype", config.dtype])

        # Add load-format only if not using CPU
        if not config.use_cpu:
            cmd.extend(["--load-format", config.load_format])

        # Handle max_model_len and max_num_batched_tokens
        # ALWAYS set both to prevent vLLM from auto-detecting large values
        if config.max_model_len:
            # User explicitly specified a value
            max_len = config.max_model_len
            cmd.extend(["--max-model-len", str(max_len)])
            cmd.extend(["--max-num-batched-tokens", str(max_len)])
            await broadcast_log(f"[WEBUI] Using user-specified max-model-len: {max_len}")
        elif config.compute_mode in ["cpu", "metal"]:
            # CPU/Metal mode: Use conservative defaults (2048)
            # Metal has less memory than desktop GPUs, so use same as CPU
            max_len = 2048
            cmd.extend(["--max-model-len", str(max_len)])
            cmd.extend(["--max-num-batched-tokens", str(max_len)])
            await broadcast_log(f"[WEBUI] Using default max-model-len for {config.compute_mode.upper()}: {max_len}")
        else:
            # GPU mode: Use reasonable default (8192) instead of letting vLLM auto-detect
            max_len = 8192
            cmd.extend(["--max-model-len", str(max_len)])
            cmd.extend(["--max-num-batched-tokens", str(max_len)])
            await broadcast_log(f"[WEBUI] Using default max-model-len for GPU: {max_len}")

        if config.trust_remote_code:
            cmd.append("--trust-remote-code")

        if config.download_dir:
            cmd.extend(["--download-dir", config.download_dir])

        if config.disable_log_stats:
            cmd.append("--disable-log-stats")

        if config.enable_prefix_caching:
            cmd.append("--enable-prefix-caching")

        # Chat template handling:
        # Trust vLLM to auto-detect chat templates from tokenizer_config.json
        # Modern models (2023+) all have built-in templates, vLLM will use them automatically
        # Only pass --chat-template if user explicitly provides a custom override
        if config.custom_chat_template:
            # User provided custom template - write it to a temp file and pass to vLLM
            import tempfile

            with tempfile.NamedTemporaryFile(mode="w", suffix=".jinja", delete=False) as f:
                f.write(config.custom_chat_template)
                template_file = f.name
            cmd.extend(["--chat-template", template_file])
            config.model_has_builtin_template = False  # Using custom override
            await broadcast_log(f"[WEBUI] Using custom chat template from config (overrides model's built-in template)")
        else:
            # Let vLLM auto-detect and use the model's built-in chat template
            # vLLM will read it from tokenizer_config.json automatically
            config.model_has_builtin_template = True  # Assume model has template (modern models do)
            await broadcast_log(f"[WEBUI] Trusting vLLM to auto-detect chat template from tokenizer_config.json")
            await broadcast_log(f"[WEBUI] vLLM will use model's built-in chat template automatically")

        # Tool calling support
        # Add --enable-auto-tool-choice and --tool-call-parser for function calling
        if config.enable_tool_calling:
            # Determine the tool call parser
            tool_parser = config.tool_call_parser
            if not tool_parser:
                # Auto-detect based on model name
                tool_parser = detect_tool_call_parser(model_source)

            if tool_parser:
                cmd.append("--enable-auto-tool-choice")
                cmd.extend(["--tool-call-parser", tool_parser])
                await broadcast_log(f"[WEBUI] 🔧 Tool calling enabled with parser: {tool_parser}")
            else:
                await broadcast_log(f"[WEBUI] ⚠️ Tool calling requested but no parser detected for model")
                await broadcast_log(
                    f"[WEBUI] Set tool_call_parser explicitly or use a supported model (Llama 3.x, Mistral, etc.)"
                )
        else:
            await broadcast_log(f"[WEBUI] Tool calling disabled")

        # Start server based on mode
        if config.run_mode == "container":
            await broadcast_log(f"[WEBUI] Starting vLLM container...")

            # Prepare config dict for container manager
            vllm_config_dict = {
                "model": config.model,
                "model_source": model_source,
                "host": config.host,
                "port": config.port,
                "tensor_parallel_size": config.tensor_parallel_size,
                "gpu_memory_utilization": config.gpu_memory_utilization,
                "max_model_len": config.max_model_len,
                "dtype": config.dtype,
                "trust_remote_code": config.trust_remote_code,
                "download_dir": config.download_dir,
                "load_format": config.load_format,
                "disable_log_stats": config.disable_log_stats,
                "enable_prefix_caching": config.enable_prefix_caching,
                "hf_token": config.hf_token,
                "use_cpu": config.use_cpu,
                "cpu_kvcache_space": config.cpu_kvcache_space,
                "cpu_omp_threads_bind": config.cpu_omp_threads_bind,
                "custom_chat_template": config.custom_chat_template,
                "local_model_path": config.local_model_path,
                "enable_tool_calling": config.enable_tool_calling,
                "tool_call_parser": config.tool_call_parser,
                "accelerator": config.accelerator,  # GPU accelerator type (nvidia/amd)
                "served_model_name": config.served_model_name,  # Model alias (for Claude Code)
            }

            logger.info(
                f"Container config: enable_tool_calling={config.enable_tool_calling}, tool_call_parser={config.tool_call_parser}"
            )

            # Start container
            container_info = await container_manager.start_container(vllm_config_dict)

            container_id = container_info["id"]
            vllm_running = True
            current_config = config
            server_start_time = datetime.now()

            # Store the actual model identifier for use in API calls
            current_model_identifier = model_source
            current_served_model_name = config.served_model_name  # May be None

            # Start log reader task
            asyncio.create_task(read_logs_container())

            # Show if container was reused or created new
            if container_info.get("reused", False):
                await broadcast_log(f"[WEBUI] ⚡ Restarted existing container: {container_id[:12]} (fast!)")
            else:
                await broadcast_log(f"[WEBUI] vLLM container created: {container_id[:12]}")

            await broadcast_log(f"[WEBUI] Container: {container_info['name']}")
            await broadcast_log(f"[WEBUI] Image: {container_info.get('image', 'N/A')}")
            await broadcast_log(f"[WEBUI] Model: {model_display_name}")
            if config.local_model_path:
                await broadcast_log(f"[WEBUI] Model Source: Local ({model_source})")
            elif config.use_modelscope:
                await broadcast_log(f"[WEBUI] Model Source: ModelScope (modelscope.cn)")
            else:
                await broadcast_log(f"[WEBUI] Model Source: HuggingFace Hub")
            if config.use_cpu:
                await broadcast_log(f"[WEBUI] Mode: CPU (KV Cache: {config.cpu_kvcache_space}GB)")
            else:
                await broadcast_log(f"[WEBUI] Mode: GPU (Memory: {int(config.gpu_memory_utilization * 100)}%)")

            # Wait for vLLM to be ready
            await broadcast_log(f"[WEBUI] ⏳ Waiting for vLLM to initialize and become ready...")
            await broadcast_log(f"[WEBUI] This may take 30-120 seconds depending on model size...")

            readiness = await container_manager.wait_for_ready(port=config.port, timeout=180)

            if readiness.get("ready"):
                await broadcast_log(f"[WEBUI] ✅ vLLM is ready! (took {readiness['elapsed_time']}s)")
                return {
                    "status": "ready",
                    "container_id": container_id[:12],
                    "mode": "container",
                    "ready": True,
                    "startup_time": readiness["elapsed_time"],
                }
            else:
                error_msg = readiness.get("error", "unknown")
                elapsed = readiness.get("elapsed_time", 0)

                if error_msg == "timeout":
                    await broadcast_log(f"[WEBUI] ⚠️ Warning: vLLM did not become ready within {elapsed}s")
                    await broadcast_log(f"[WEBUI] Container is running but may still be initializing...")
                    await broadcast_log(f"[WEBUI] Check the logs above for model download/loading progress")
                    await broadcast_log(
                        f"[WEBUI] You can try sending requests - they may work once initialization completes"
                    )
                elif error_msg == "container_stopped":
                    await broadcast_log(f"[WEBUI] ❌ Error: Container stopped unexpectedly after {elapsed}s")
                    await broadcast_log(f"[WEBUI] Check the logs above for errors")
                    raise HTTPException(status_code=500, detail="Container stopped during startup")
                else:
                    await broadcast_log(f"[WEBUI] ⚠️ Warning: Could not verify readiness: {error_msg}")
                    await broadcast_log(f"[WEBUI] Container may still be working - check logs for details")

                return {
                    "status": "started",
                    "container_id": container_id[:12],
                    "mode": "container",
                    "ready": False,
                    "warning": error_msg,
                }

        else:  # subprocess mode
            await broadcast_log(f"[WEBUI] Starting vLLM subprocess...")
            await broadcast_log(f"[WEBUI] Command: {' '.join(cmd)}")

            # Start subprocess
            vllm_process = await asyncio.create_subprocess_exec(
                *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, env=env
            )

            vllm_running = True
            current_config = config
            server_start_time = datetime.now()

            # Store the actual model identifier for use in API calls
            current_model_identifier = model_source
            current_served_model_name = config.served_model_name  # May be None

            # Start log reader task
            asyncio.create_task(read_logs_subprocess())

            await broadcast_log(f"[WEBUI] vLLM subprocess started (PID: {vllm_process.pid})")
            await broadcast_log(f"[WEBUI] Model: {model_display_name}")
            if config.local_model_path:
                await broadcast_log(f"[WEBUI] Model Source: Local ({model_source})")
            elif config.use_modelscope:
                await broadcast_log(f"[WEBUI] Model Source: ModelScope (modelscope.cn)")
            else:
                await broadcast_log(f"[WEBUI] Model Source: HuggingFace Hub")
            if config.use_cpu:
                await broadcast_log(f"[WEBUI] Mode: CPU (KV Cache: {config.cpu_kvcache_space}GB)")
            else:
                await broadcast_log(f"[WEBUI] Mode: GPU (Memory: {int(config.gpu_memory_utilization * 100)}%)")

            return {"status": "started", "pid": vllm_process.pid, "mode": "subprocess"}

    except Exception as e:
        logger.error(f"Failed to start server: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/stop")
async def stop_server():
    """Stop the vLLM server (container, subprocess, or disconnect from remote)"""
    global \
        container_id, \
        vllm_process, \
        vllm_running, \
        server_start_time, \
        current_model_identifier, \
        current_served_model_name, \
        current_run_mode

    # Check if server is running
    if not await check_vllm_server_running():
        raise HTTPException(status_code=400, detail="Server is not running")

    try:
        if current_run_mode == "remote":
            remote_url = current_config.remote_url if current_config else "unknown"
            await broadcast_log(f"[WEBUI] Disconnecting from remote vLLM instance ({remote_url})...")
            await broadcast_log("[WEBUI] ✓ Disconnected from remote vLLM instance")

        elif current_run_mode == "container":
            await broadcast_log("[WEBUI] Stopping vLLM container...")

            # Stop container
            result = await container_manager.stop_container()

            container_id = None
            await broadcast_log("[WEBUI] vLLM container stopped")

        else:  # subprocess mode
            await broadcast_log("[WEBUI] Stopping vLLM subprocess...")

            # Terminate subprocess
            vllm_process.terminate()

            try:
                # Wait for process to terminate (with timeout)
                await asyncio.wait_for(vllm_process.wait(), timeout=10.0)
                await broadcast_log("[WEBUI] vLLM subprocess terminated gracefully")
            except asyncio.TimeoutError:
                # Force kill if not terminated
                vllm_process.kill()
                await vllm_process.wait()
                await broadcast_log("[WEBUI] vLLM subprocess killed (forced)")

            vllm_process = None
            await broadcast_log("[WEBUI] vLLM subprocess stopped")

        vllm_running = False
        server_start_time = None
        current_model_identifier = None
        current_served_model_name = None
        current_run_mode = None

        return {"status": "stopped"}

    except Exception as e:
        logger.error(f"Failed to stop server: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def read_logs_container():
    """Read logs from vLLM container"""
    global vllm_running

    if not container_manager:
        logger.error("read_logs_container called but container_manager is not available")
        return

    try:
        await broadcast_log("[WEBUI] Starting log stream from container...")

        # Stream logs from container
        async for log_line in container_manager.stream_logs():
            if log_line:
                line = log_line.strip()
                if line:  # Only send non-empty lines
                    await broadcast_log(line)
                    logger.debug(f"vLLM: {line}")

            # Check if container is still running
            if not vllm_running:
                break

            await asyncio.sleep(0.01)  # Small delay to prevent busy loop

        await broadcast_log("[WEBUI] Container log stream ended")

    except Exception as e:
        logger.error(f"Error reading container logs: {e}")
        await broadcast_log(f"[WEBUI] Error reading logs: {e}")


async def read_logs_subprocess():
    """Read logs from vLLM subprocess"""
    global vllm_running, vllm_process

    try:
        await broadcast_log("[WEBUI] Starting log stream from subprocess...")

        # Stream logs from subprocess stdout
        while vllm_process and vllm_process.returncode is None:
            try:
                line = await asyncio.wait_for(vllm_process.stdout.readline(), timeout=1.0)

                if line:
                    decoded_line = line.decode().strip()
                    if decoded_line:  # Only send non-empty lines
                        await broadcast_log(decoded_line)
                        logger.debug(f"vLLM: {decoded_line}")
                else:
                    # No more output
                    break

            except asyncio.TimeoutError:
                # No output in this interval, check if still running
                if not vllm_running or vllm_process.returncode is not None:
                    break
                continue

            except Exception as e:
                logger.error(f"Error reading line: {e}")
                break

        await broadcast_log("[WEBUI] Subprocess log stream ended")

    except Exception as e:
        logger.error(f"Error reading subprocess logs: {e}")
        await broadcast_log(f"[WEBUI] Error reading logs: {e}")


async def broadcast_log(message: str):
    """Broadcast log message to all connected websockets"""
    global latest_vllm_metrics, metrics_timestamp

    if not message:
        return

    # Parse metrics from log messages with more flexible patterns
    import re

    metrics_updated = False  # Track if we updated any metrics in this log line

    # Try various patterns for KV cache usage
    # Examples: "GPU KV cache usage: 0.3%", "KV cache usage: 0.3%", "cache usage: 0.3%"
    if "cache usage" in message.lower() and "%" in message:
        # More flexible pattern - match any number before %
        match = re.search(r"cache usage[:\s]+([\d.]+)\s*%", message, re.IGNORECASE)
        if match:
            cache_usage = float(match.group(1))
            latest_vllm_metrics["kv_cache_usage_perc"] = cache_usage
            metrics_updated = True
            logger.info(f"✓ Captured KV cache usage: {cache_usage}% from: {message[:100]}")
        else:
            logger.debug(f"Failed to parse cache usage from: {message[:100]}")

    # Try various patterns for prefix cache hit rate
    # Examples: "Prefix cache hit rate: 36.1%", "hit rate: 36.1%", "cache hit rate: 36.1%"
    if "hit rate" in message.lower() and "%" in message:
        # More flexible pattern
        match = re.search(r"hit rate[:\s]+([\d.]+)\s*%", message, re.IGNORECASE)
        if match:
            hit_rate = float(match.group(1))
            latest_vllm_metrics["prefix_cache_hit_rate"] = hit_rate
            metrics_updated = True
            logger.info(f"✓ Captured prefix cache hit rate: {hit_rate}% from: {message[:100]}")
        else:
            logger.debug(f"Failed to parse hit rate from: {message[:100]}")

    # Try to parse avg prompt throughput
    if "prompt throughput" in message.lower():
        match = re.search(r"prompt throughput[:\s]+([\d.]+)", message, re.IGNORECASE)
        if match:
            prompt_throughput = float(match.group(1))
            latest_vllm_metrics["avg_prompt_throughput"] = prompt_throughput
            metrics_updated = True
            logger.info(f"✓ Captured prompt throughput: {prompt_throughput}")

    # Try to parse avg generation throughput
    if "generation throughput" in message.lower():
        match = re.search(r"generation throughput[:\s]+([\d.]+)", message, re.IGNORECASE)
        if match:
            generation_throughput = float(match.group(1))
            latest_vllm_metrics["avg_generation_throughput"] = generation_throughput
            metrics_updated = True
            logger.info(f"✓ Captured generation throughput: {generation_throughput}")

    # Update timestamp if we captured any metrics
    if metrics_updated:
        metrics_timestamp = datetime.now()
        latest_vllm_metrics["timestamp"] = metrics_timestamp.isoformat()
        logger.info(f"📊 Metrics updated at: {metrics_timestamp.strftime('%H:%M:%S')}")

    disconnected = []
    for ws in websocket_connections:
        try:
            await ws.send_text(message)
        except Exception as e:
            logger.error(f"Error sending to websocket: {e}")
            disconnected.append(ws)

    # Remove disconnected websockets
    for ws in disconnected:
        websocket_connections.remove(ws)


@app.websocket("/ws/logs")
async def websocket_logs(websocket: WebSocket):
    """WebSocket endpoint for streaming logs"""
    await websocket.accept()
    websocket_connections.append(websocket)

    try:
        await websocket.send_text("[WEBUI] Connected to log stream")

        # Keep connection alive
        while True:
            try:
                # Wait for messages (ping/pong)
                await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
            except asyncio.TimeoutError:
                # Send ping to keep connection alive
                await websocket.send_text("")

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        if websocket in websocket_connections:
            websocket_connections.remove(websocket)


# =============================================================================
# vLLM-Omni WebSocket and Log Streaming
# =============================================================================


async def broadcast_omni_log(message: str):
    """Broadcast log message to all connected omni websockets"""
    global omni_websocket_connections

    if not message:
        return

    disconnected = []
    for ws in omni_websocket_connections:
        try:
            await ws.send_text(message)
        except Exception as e:
            logger.error(f"Error sending to omni websocket: {e}")
            disconnected.append(ws)

    # Remove disconnected websockets
    for ws in disconnected:
        omni_websocket_connections.remove(ws)


@app.websocket("/ws/omni/logs")
async def websocket_omni_logs(websocket: WebSocket):
    """WebSocket endpoint for streaming vLLM-Omni logs"""
    await websocket.accept()
    omni_websocket_connections.append(websocket)

    try:
        await websocket.send_text("[OMNI] Connected to vLLM-Omni log stream")

        # Keep connection alive
        while True:
            try:
                # Wait for messages (ping/pong)
                await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
            except asyncio.TimeoutError:
                # Send ping to keep connection alive
                await websocket.send_text("")

    except WebSocketDisconnect:
        logger.info("Omni WebSocket disconnected")
    except Exception as e:
        logger.error(f"Omni WebSocket error: {e}")
    finally:
        if websocket in omni_websocket_connections:
            omni_websocket_connections.remove(websocket)


async def read_omni_logs_container():
    """Read logs from vLLM-Omni container"""
    global omni_running, omni_container_id

    if not container_manager:
        logger.error("read_omni_logs_container called but container_manager is not available")
        return

    try:
        # Wait a moment for container to be fully started before streaming logs
        await asyncio.sleep(1)

        await broadcast_omni_log("[OMNI] Starting log stream from container...")

        # Stream logs from container using container_manager
        # We need to use the omni container name
        async for log_line in container_manager.stream_logs(container_name="vllm-omni-service"):
            if log_line:
                line = log_line.strip()
                if line:  # Only send non-empty lines
                    await broadcast_omni_log(line)

            # Check if container is still running
            if not omni_running:
                break

            await asyncio.sleep(0.01)  # Small delay to prevent busy loop

        await broadcast_omni_log("[OMNI] Container log stream ended")

    except Exception as e:
        logger.error(f"Error reading omni container logs: {e}")
        await broadcast_omni_log(f"[OMNI] Error reading logs: {e}")


class ToolChoice(BaseModel):
    """Specific tool choice when tool_choice is an object"""

    type: str = "function"
    function: Dict[str, str]  # {"name": "function_name"}


class StructuredOutputs(BaseModel):
    """Structured outputs configuration for guided decoding"""

    choice: Optional[List[str]] = None  # List of allowed choices
    regex: Optional[str] = None  # Regex pattern to match
    grammar: Optional[str] = None  # EBNF grammar


class JsonSchema(BaseModel):
    """JSON Schema definition for response_format"""

    name: str = "response"
    schema_: Dict[str, Any] = Field(default_factory=dict, alias="schema")
    strict: Optional[bool] = None

    class Config:
        populate_by_name = True


class ResponseFormat(BaseModel):
    """Response format configuration (OpenAI-compatible)"""

    type: str  # "json_schema" or "json_object"
    json_schema: Optional[JsonSchema] = None


class ChatRequestWithStopTokens(BaseModel):
    """Chat request structure with optional stop tokens override and tool calling support"""

    messages: List[ChatMessage]
    temperature: float = 0.7
    max_tokens: int = 256
    stream: bool = True
    stop_tokens: Optional[List[str]] = None  # Allow overriding stop tokens per request

    # Tool/Function Calling Support (OpenAI-compatible)
    # See: https://platform.openai.com/docs/guides/function-calling
    tools: Optional[List[Tool]] = None  # List of available tools/functions
    tool_choice: Optional[Union[str, ToolChoice]] = None  # "auto", "none", "required", or specific tool
    parallel_tool_calls: Optional[bool] = None  # Allow multiple tool calls in one response

    # Structured Outputs Support (vLLM guided decoding)
    # See: https://docs.vllm.ai/en/latest/features/structured_outputs.html
    structured_outputs: Optional[StructuredOutputs] = None  # For choice, regex, grammar
    response_format: Optional[ResponseFormat] = None  # For JSON schema (OpenAI-compatible)


@app.post("/api/chat")
async def chat(request: ChatRequestWithStopTokens):
    """Proxy chat requests to vLLM server using OpenAI-compatible /v1/chat/completions endpoint"""
    global current_config, current_model_identifier, vllm_running, current_run_mode

    # Check server status based on mode
    if not await check_vllm_server_running():
        raise HTTPException(status_code=400, detail="vLLM server is not running")

    if current_config is None:
        raise HTTPException(status_code=400, detail="Server configuration not available")

    try:
        import aiohttp

        # Use centralized URL construction
        base_url = get_vllm_base_url()
        url = f"{base_url}/v1/chat/completions"

        logger.info(f"=== CHAT ENDPOINT ROUTING DEBUG ===")
        logger.info(f"current_run_mode: {current_run_mode}")
        logger.info(f"✓ Using URL: {url}")
        logger.info(f"=====================================")

        # Convert messages to OpenAI format with full tool calling support
        messages_dict = []
        for m in request.messages:
            msg = {"role": m.role}

            # Content can be None for assistant messages with tool_calls
            if m.content is not None:
                msg["content"] = m.content

            # Include tool_calls for assistant messages
            if m.tool_calls:
                msg["tool_calls"] = [{"id": tc.id, "type": tc.type, "function": tc.function} for tc in m.tool_calls]

            # Include tool_call_id for tool response messages
            if m.tool_call_id:
                msg["tool_call_id"] = m.tool_call_id

            # Include name if provided
            if m.name:
                msg["name"] = m.name

            messages_dict.append(msg)

        # Build payload for OpenAI-compatible endpoint
        # Use get_model_name_for_api() to get the correct model name
        # (served_model_name if set, otherwise model identifier)
        payload = {
            "model": get_model_name_for_api(),
            "messages": messages_dict,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "stream": request.stream,
        }

        # Tool/Function Calling Support
        # Add tools if provided
        if request.tools:
            payload["tools"] = [
                {
                    "type": tool.type,
                    "function": {
                        "name": tool.function.name,
                        "description": tool.function.description,
                        "parameters": tool.function.parameters or {"type": "object", "properties": {}},
                    },
                }
                for tool in request.tools
            ]
            logger.info(f"🔧 Tools enabled: {[t.function.name for t in request.tools]}")

            # Add format guidance to help models generate correct tool call JSON
            # This helps models that use different formats (function vs name, parameters vs arguments)
            tool_format_hint = (
                "\n\nWhen calling a function, respond with JSON in this exact format: "
                '{"name": "<function_name>", "arguments": {<parameters>}}'
            )
            # Inject hint into the last system message or first user message
            for i, msg in enumerate(messages_dict):
                if msg.get("role") == "system":
                    messages_dict[i]["content"] = msg["content"] + tool_format_hint
                    logger.info("🔧 Added tool format hint to system message")
                    break
            else:
                # No system message found, add as a new system message at the beginning
                messages_dict.insert(
                    0, {"role": "system", "content": f"You are a helpful assistant.{tool_format_hint}"}
                )
                logger.info("🔧 Added system message with tool format hint")

        # Add tool_choice if provided
        if request.tool_choice is not None:
            # Validate: tool_choice requires tools to be defined
            if not request.tools or len(request.tools) == 0:
                logger.warning(f"⚠️ tool_choice '{request.tool_choice}' provided but no tools defined - ignoring")
            else:
                if isinstance(request.tool_choice, str):
                    # String values: "auto", "none"
                    # Note: "required" is disabled as it can crash vLLM servers
                    if request.tool_choice == "required":
                        logger.warning(
                            f"⚠️ tool_choice 'required' is disabled (can crash server) - using 'auto' instead"
                        )
                        payload["tool_choice"] = "auto"
                    else:
                        payload["tool_choice"] = request.tool_choice
                    logger.info(f"🔧 Tool choice: {payload.get('tool_choice', request.tool_choice)}")
                else:
                    # Specific tool choice object
                    payload["tool_choice"] = {
                        "type": request.tool_choice.type,
                        "function": request.tool_choice.function,
                    }
                    logger.info(f"🔧 Tool choice: specific function - {request.tool_choice.function}")

        # Add parallel_tool_calls if provided
        if request.parallel_tool_calls is not None:
            payload["parallel_tool_calls"] = request.parallel_tool_calls
            logger.info(f"🔧 Parallel tool calls: {request.parallel_tool_calls}")

        # Structured Outputs Support
        # See: https://docs.vllm.ai/en/latest/features/structured_outputs/
        #
        # vLLM v0.12+ removed the legacy guided_* fields (guided_choice,
        # guided_regex, guided_grammar, guided_json) and now expects a
        # top-level "structured_outputs" dict with the constraint type.
        # The OpenAI-standard "response_format" for JSON schema is still
        # supported as-is.
        if request.response_format:
            # JSON Schema mode (OpenAI-compatible response_format)
            if request.response_format.type == "json_schema" and request.response_format.json_schema:
                payload["response_format"] = {
                    "type": "json_schema",
                    "json_schema": {
                        "name": request.response_format.json_schema.name,
                        "schema": request.response_format.json_schema.schema_,
                    },
                }
                if request.response_format.json_schema.strict is not None:
                    payload["response_format"]["json_schema"]["strict"] = request.response_format.json_schema.strict
                logger.info(f"📋 JSON Schema structured output enabled: {request.response_format.json_schema.name}")
            elif request.response_format.type == "json_object":
                payload["response_format"] = {"type": "json_object"}
                logger.info(f"📋 JSON Object mode enabled")
        elif request.structured_outputs:
            # vLLM structured_outputs format (v0.12+)
            # Sent as a top-level "structured_outputs" dict in the request body
            so_body = {}
            if request.structured_outputs.choice:
                so_body["choice"] = request.structured_outputs.choice
                logger.info(f"📋 Structured output (choice) enabled: {request.structured_outputs.choice}")
            elif request.structured_outputs.regex:
                so_body["regex"] = request.structured_outputs.regex
                logger.info(f"📋 Structured output (regex) enabled: {request.structured_outputs.regex}")
            elif request.structured_outputs.grammar:
                so_body["grammar"] = request.structured_outputs.grammar
                logger.info(f"📋 Structured output (grammar) enabled")

            if so_body:
                payload["structured_outputs"] = so_body

        # Stop tokens handling:
        # By default, trust vLLM to use appropriate stop tokens from the model's tokenizer
        # Only override if user explicitly provides custom tokens in the server config
        if current_config.custom_stop_tokens:
            # User configured custom stop tokens in server config
            payload["stop"] = current_config.custom_stop_tokens
            logger.info(f"Using custom stop tokens from server config: {current_config.custom_stop_tokens}")
        elif request.stop_tokens:
            # User provided stop tokens in this specific request (not recommended)
            payload["stop"] = request.stop_tokens
            logger.warning(f"Using stop tokens from request (not recommended): {request.stop_tokens}")
        else:
            # Let vLLM handle stop tokens automatically from model's tokenizer (RECOMMENDED)
            logger.info(f"✓ Letting vLLM handle stop tokens automatically (recommended for /v1/chat/completions)")

        # Log the request payload being sent to vLLM
        # Truncate base64 image data in logs to avoid flooding
        def _truncate_for_log(obj, max_str_len=200):
            if isinstance(obj, str):
                if len(obj) > max_str_len and ("base64," in obj or obj.startswith("data:")):
                    return obj[:80] + f"...[{len(obj)} chars truncated]"
                return obj if len(obj) <= max_str_len else obj[:max_str_len] + "..."
            if isinstance(obj, list):
                return [_truncate_for_log(item, max_str_len) for item in obj]
            if isinstance(obj, dict):
                return {k: _truncate_for_log(v, max_str_len) for k, v in obj.items()}
            return obj

        logger.info(f"=== vLLM REQUEST ===")
        logger.info(f"URL: {url}")
        logger.info(f"Payload keys: {list(payload.keys())}")
        logger.info(f"Messages ({len(messages_dict)}): {_truncate_for_log(messages_dict)}")
        logger.info(f"==================")

        async def generate_stream():
            """Generator for streaming responses"""
            full_response_text = ""  # Accumulate response for logging
            buffer = ""  # Buffer for incomplete lines
            try:
                # Set reasonable timeout to prevent hanging
                # sock_read=120 is needed for VLM models that may take longer
                # to process images before producing the first token
                timeout = aiohttp.ClientTimeout(total=300, connect=10, sock_read=120)
                auth_headers = get_vllm_auth_headers()
                async with aiohttp.ClientSession(timeout=timeout, headers=auth_headers) as session:
                    async with session.post(url, json=payload) as response:
                        if response.status != 200:
                            text = await response.text()
                            logger.error(f"=== vLLM ERROR RESPONSE ===")
                            logger.error(f"Status: {response.status}")
                            logger.error(f"Error: {text}")
                            logger.error(f"==========================")
                            yield f"data: {{'error': '{text}'}}\n\n"
                            return

                        logger.info(f"=== vLLM STREAMING RESPONSE START ===")
                        # Stream the response chunk by chunk
                        # OpenAI-compatible chat completions format
                        try:
                            async for chunk in response.content.iter_any():
                                if chunk:
                                    # Decode the chunk and add to buffer
                                    buffer += chunk.decode("utf-8")

                                    # Process complete lines from buffer
                                    while "\n" in buffer:
                                        line, buffer = buffer.split("\n", 1)
                                        line = line.strip()

                                        if line:
                                            # Log each chunk received
                                            if line != "data: [DONE]":
                                                logger.debug(f"vLLM chunk: {line}")
                                            # Try to extract content from SSE data
                                            import json

                                            if line.startswith("data: "):
                                                try:
                                                    data_str = line[6:].strip()
                                                    if data_str and data_str != "[DONE]":
                                                        data = json.loads(data_str)
                                                        if "choices" in data and len(data["choices"]) > 0:
                                                            choice = data["choices"][0]
                                                            delta = choice.get("delta", {})
                                                            content = delta.get("content", "")
                                                            finish_reason = choice.get("finish_reason")

                                                            if content:
                                                                full_response_text += content

                                                            # Log tool calls if present
                                                            if delta.get("tool_calls"):
                                                                logger.info(
                                                                    f"🔧 Streaming tool_calls in delta: {delta['tool_calls']}"
                                                                )

                                                            # Log finish reason for debugging
                                                            if finish_reason:
                                                                logger.info(f"🏁 Finish reason: {finish_reason}")
                                                                if finish_reason == "tool_calls" and not delta.get(
                                                                    "tool_calls"
                                                                ):
                                                                    logger.warning(
                                                                        f"⚠️ finish_reason is 'tool_calls' but no tool_calls data in delta!"
                                                                    )
                                                                    logger.warning(f"⚠️ Full chunk data: {data}")
                                                except Exception as parse_err:
                                                    logger.debug(f"Failed to parse SSE data: {parse_err}")
                                            # Pass through the SSE formatted data
                                            yield line + "\n"

                            # Process any remaining data in buffer
                            if buffer.strip():
                                logger.debug(f"vLLM final chunk: {buffer.strip()}")
                                yield buffer

                        except (aiohttp.ClientError, aiohttp.ClientPayloadError, asyncio.TimeoutError) as e:
                            # Connection error during streaming (e.g., server stopped)
                            logger.warning(f"Stream interrupted: {type(e).__name__}: {e}")
                            # Send a final error message to the client
                            yield f"data: {{'error': 'Stream interrupted: server may have stopped'}}\n\n"
                            yield "data: [DONE]\n\n"
                            return

                        # Log the complete response
                        logger.info(f"=== vLLM COMPLETE RESPONSE ===")
                        logger.info(f"Full text: {full_response_text}")
                        logger.info(f"Length: {len(full_response_text)} chars")
                        logger.info(f"===============================")

            except (aiohttp.ClientError, aiohttp.ClientPayloadError, asyncio.TimeoutError) as e:
                # Connection error before streaming started
                logger.error(f"Failed to connect to vLLM: {type(e).__name__}: {e}")
                yield f"data: {{'error': 'Failed to connect to vLLM server'}}\n\n"
            except Exception as e:
                # Unexpected error
                logger.error(f"Unexpected error in streaming: {type(e).__name__}: {e}")
                import traceback

                logger.error(traceback.format_exc())
                yield f"data: {{'error': 'Internal error during streaming'}}\n\n"

        if request.stream:
            # Return streaming response using SSE
            return StreamingResponse(
                generate_stream(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                },
            )
        else:
            # Non-streaming response
            # Set reasonable timeout - VLM image processing may need extra time
            timeout = aiohttp.ClientTimeout(total=120, connect=10)
            auth_headers = get_vllm_auth_headers()
            async with aiohttp.ClientSession(timeout=timeout, headers=auth_headers) as session:
                async with session.post(url, json=payload) as response:
                    if response.status != 200:
                        text = await response.text()
                        logger.error(f"=== vLLM ERROR RESPONSE (non-streaming) ===")
                        logger.error(f"Status: {response.status}")
                        logger.error(f"Error: {text}")
                        logger.error(f"===========================================")
                        # Provide meaningful error message even if vLLM returns empty body
                        error_detail = text.strip() if text.strip() else f"vLLM server returned HTTP {response.status}"
                        raise HTTPException(status_code=response.status, detail=error_detail)

                    data = await response.json()
                    # Log the complete response
                    logger.info(f"=== vLLM RESPONSE (non-streaming) ===")
                    logger.info(f"Full response: {data}")
                    if "choices" in data and len(data["choices"]) > 0:
                        message = data["choices"][0].get("message", {})
                        content = message.get("content", "")
                        tool_calls = message.get("tool_calls", [])

                        if content:
                            logger.info(f"Response text: {content}")
                            logger.info(f"Length: {len(content)} chars")

                        if tool_calls:
                            logger.info(f"🔧 Tool calls detected: {len(tool_calls)}")
                            for tc in tool_calls:
                                func = tc.get("function", {})
                                logger.info(f"  - {func.get('name', 'unknown')}: {func.get('arguments', '{}')}")
                    logger.info(f"=====================================")
                    return data

    except HTTPException:
        # Re-raise HTTPExceptions as-is (they already have proper status and detail)
        raise
    except aiohttp.ClientError as e:
        # Handle aiohttp client errors (connection issues, timeouts, etc.)
        error_msg = f"Connection error to vLLM server: {type(e).__name__}: {str(e) or 'Unknown error'}"
        logger.error(f"Chat error: {error_msg}")
        raise HTTPException(status_code=503, detail=error_msg)
    except Exception as e:
        # Handle all other errors with detailed logging
        import traceback

        error_msg = str(e) if str(e) else f"{type(e).__name__}: Unknown error"
        logger.error(f"Chat error: {error_msg}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=error_msg)


class CompletionRequest(BaseModel):
    """Completion request structure for non-chat models"""

    prompt: str
    temperature: float = 0.7
    max_tokens: int = 256


class ToolValidationRequest(BaseModel):
    """Request to validate a tool definition"""

    tools: List[Tool]


@app.post("/api/tools/validate")
async def validate_tools(request: ToolValidationRequest):
    """
    Validate tool definitions for correctness.

    Checks:
    - Tool type is "function"
    - Function name is valid (alphanumeric + underscore)
    - Parameters follow JSON Schema format

    Returns validation results with any errors found.
    """
    import re

    results = []
    valid_name_pattern = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")

    for tool in request.tools:
        tool_result = {"name": tool.function.name, "valid": True, "errors": [], "warnings": []}

        # Check tool type
        if tool.type != "function":
            tool_result["errors"].append(f"Invalid tool type: '{tool.type}'. Only 'function' is supported.")
            tool_result["valid"] = False

        # Check function name
        if not valid_name_pattern.match(tool.function.name):
            tool_result["errors"].append(
                f"Invalid function name: '{tool.function.name}'. Must start with letter/underscore and contain only alphanumeric characters."
            )
            tool_result["valid"] = False

        # Check for description
        if not tool.function.description:
            tool_result["warnings"].append(
                "Missing function description. Models perform better with clear descriptions."
            )

        # Check parameters schema
        if tool.function.parameters:
            params = tool.function.parameters

            # Check for type field
            if "type" not in params:
                tool_result["warnings"].append("Parameters schema missing 'type' field. Should be 'object'.")
            elif params["type"] != "object":
                tool_result["warnings"].append(f"Parameters type is '{params['type']}'. Usually should be 'object'.")

            # Check for properties
            if params.get("type") == "object" and "properties" not in params:
                tool_result["warnings"].append("Parameters schema missing 'properties' field.")

            # Check required fields
            if "required" in params:
                required = params["required"]
                properties = params.get("properties", {})
                for req_field in required:
                    if req_field not in properties:
                        tool_result["errors"].append(f"Required field '{req_field}' not found in properties.")
                        tool_result["valid"] = False

        results.append(tool_result)

    all_valid = all(r["valid"] for r in results)

    return {"valid": all_valid, "tool_count": len(request.tools), "results": results}


@app.get("/api/tools/presets")
async def get_tool_presets():
    """
    Get predefined tool presets for common use cases.

    These presets provide ready-to-use tool definitions that can be
    loaded directly into the chat interface.
    """
    presets = {
        "weather": {
            "name": "Weather Tools",
            "description": "Get weather information for locations",
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "get_current_weather",
                        "description": "Get the current weather in a given location",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "location": {
                                    "type": "string",
                                    "description": "The city and state, e.g. San Francisco, CA",
                                },
                                "unit": {
                                    "type": "string",
                                    "enum": ["celsius", "fahrenheit"],
                                    "description": "Temperature unit",
                                },
                            },
                            "required": ["location"],
                        },
                    },
                }
            ],
        },
        "calculator": {
            "name": "Calculator Tools",
            "description": "Perform mathematical calculations",
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "calculate",
                        "description": "Evaluate a mathematical expression",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "expression": {
                                    "type": "string",
                                    "description": "The mathematical expression to evaluate, e.g. '2 + 2 * 3'",
                                }
                            },
                            "required": ["expression"],
                        },
                    },
                }
            ],
        },
        "search": {
            "name": "Search Tools",
            "description": "Search for information",
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "web_search",
                        "description": "Search the web for information",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "query": {"type": "string", "description": "The search query"},
                                "num_results": {
                                    "type": "integer",
                                    "description": "Number of results to return",
                                    "default": 5,
                                },
                            },
                            "required": ["query"],
                        },
                    },
                },
                {
                    "type": "function",
                    "function": {
                        "name": "get_page_content",
                        "description": "Get the content of a web page",
                        "parameters": {
                            "type": "object",
                            "properties": {"url": {"type": "string", "description": "The URL to fetch"}},
                            "required": ["url"],
                        },
                    },
                },
            ],
        },
        "code_execution": {
            "name": "Code Execution Tools",
            "description": "Execute code in various languages",
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "execute_python",
                        "description": "Execute Python code and return the output",
                        "parameters": {
                            "type": "object",
                            "properties": {"code": {"type": "string", "description": "The Python code to execute"}},
                            "required": ["code"],
                        },
                    },
                }
            ],
        },
        "database": {
            "name": "Database Tools",
            "description": "Query and manipulate database records",
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "query_database",
                        "description": "Execute a SQL query on the database",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "query": {"type": "string", "description": "The SQL query to execute"},
                                "database": {"type": "string", "description": "The database name to query"},
                            },
                            "required": ["query"],
                        },
                    },
                }
            ],
        },
    }

    return {"presets": presets, "count": len(presets)}


@app.get("/api/tools/info")
async def get_tools_info():
    """
    Get information about tool calling support.

    Returns:
    - Models known to support tool calling well
    - Required vLLM version
    - Usage tips
    """
    return {
        "supported": True,
        "vllm_version_required": "0.4.0+",
        "openai_compatible": True,
        "recommended_models": [
            {
                "name": "Llama 3.1/3.2",
                "model_ids": [
                    "meta-llama/Llama-3.1-8B-Instruct",
                    "meta-llama/Llama-3.1-70B-Instruct",
                    "meta-llama/Llama-3.2-1B-Instruct",
                    "meta-llama/Llama-3.2-3B-Instruct",
                ],
                "notes": "Excellent native tool calling support with <|python_tag|> format",
            },
            {
                "name": "Mistral/Mixtral",
                "model_ids": ["mistralai/Mistral-7B-Instruct-v0.3", "mistralai/Mixtral-8x7B-Instruct-v0.1"],
                "notes": "Good tool calling with [TOOL_CALLS] format",
            },
            {
                "name": "Qwen 2.5",
                "model_ids": ["Qwen/Qwen2.5-7B-Instruct", "Qwen/Qwen2.5-72B-Instruct"],
                "notes": "Strong tool calling and code generation",
            },
            {
                "name": "Hermes 2 Pro",
                "model_ids": ["NousResearch/Hermes-2-Pro-Llama-3-8B", "NousResearch/Hermes-2-Pro-Mistral-7B"],
                "notes": "Fine-tuned specifically for function calling",
            },
        ],
        "usage_tips": [
            "Use 'tool_choice': 'auto' to let the model decide when to use tools",
            "Use 'tool_choice': 'required' to force tool usage",
            "Use 'tool_choice': 'none' to disable tool usage for a request",
            "Provide clear, detailed descriptions for better tool selection",
            "Include parameter descriptions for more accurate argument generation",
            "For multi-step tasks, set 'parallel_tool_calls': true",
        ],
    }


@app.post("/api/completion")
async def completion(request: CompletionRequest):
    """Proxy completion requests to vLLM server for base models"""
    global current_config, current_model_identifier, current_run_mode

    # Check server status based on mode
    if not await check_vllm_server_running():
        raise HTTPException(status_code=400, detail="vLLM server is not running")

    if current_config is None:
        raise HTTPException(status_code=400, detail="Server configuration not available")

    try:
        import aiohttp

        # Use centralized URL construction
        base_url = get_vllm_base_url()
        url = f"{base_url}/v1/completions"
        logger.info(f"Using URL: {url}")

        payload = {
            "model": get_model_name_for_api(),
            "prompt": request.prompt,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
        }

        auth_headers = get_vllm_auth_headers()
        async with aiohttp.ClientSession(headers=auth_headers) as session:
            async with session.post(url, json=payload) as response:
                if response.status != 200:
                    text = await response.text()
                    raise HTTPException(status_code=response.status, detail=text)

                data = await response.json()
                return data

    except Exception as e:
        logger.error(f"Completion error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/models")
async def list_models():
    """Get list of common models"""
    common_models = [
        # CPU-optimized models (recommended for macOS)
        {
            "name": "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
            "size": "1.1B",
            "description": "Compact chat model (CPU-friendly)",
            "cpu_friendly": True,
        },
        {
            "name": "meta-llama/Llama-3.2-1B-Instruct",
            "size": "1B",
            "description": "Llama 3.2 1B Instruct (CPU-friendly, gated)",
            "cpu_friendly": True,
            "gated": True,
        },
        # Larger models (may be slow on CPU)
        {
            "name": "Qwen/Qwen2.5-3B-Instruct",
            "size": "3B",
            "description": "Qwen 2.5 3B Instruct (GPU-optimized)",
            "cpu_friendly": False,
        },
        {
            "name": "mistralai/Mistral-7B-Instruct-v0.2",
            "size": "7B",
            "description": "Mistral Instruct (slow on CPU)",
            "cpu_friendly": False,
        },
        {
            "name": "RedHatAI/Llama-3.2-1B-Instruct-FP8",
            "size": "1B",
            "description": "Llama 3.2 1B Instruct FP8 (GPU-optimized, gated)",
            "cpu_friendly": False,
            "gated": True,
        },
        {
            "name": "RedHatAI/Llama-3.1-8B-Instruct",
            "size": "8B",
            "description": "Llama 3.1 8B Instruct (gated)",
            "cpu_friendly": False,
            "gated": True,
        },
    ]

    return {"models": common_models}


@app.get("/api/recipes")
async def get_recipes():
    """
    Get the vLLM community recipes catalog.

    Returns recipes organized by model family (DeepSeek, Qwen, Llama, etc.)
    with optimized configurations for each model.

    Source: https://github.com/vllm-project/recipes
    """
    recipes_file = BASE_DIR / "recipes" / "recipes_catalog.json"

    if not recipes_file.exists():
        return JSONResponse(
            status_code=404,
            content={
                "error": "Recipes catalog not found",
                "message": "Run 'python recipes/sync_recipes.py' to fetch recipes",
            },
        )

    try:
        with open(recipes_file, "r") as f:
            catalog = json.load(f)
        return catalog
    except Exception as e:
        logger.error(f"Error loading recipes catalog: {e}")
        return JSONResponse(status_code=500, content={"error": f"Failed to load recipes: {str(e)}"})


@app.get("/api/recipes/{category_id}")
async def get_recipes_by_category(category_id: str):
    """
    Get recipes for a specific model family/category.

    Args:
        category_id: Category identifier (e.g., 'qwen', 'llama', 'deepseek')
    """
    recipes_file = BASE_DIR / "recipes" / "recipes_catalog.json"

    if not recipes_file.exists():
        return JSONResponse(status_code=404, content={"error": "Recipes catalog not found"})

    try:
        with open(recipes_file, "r") as f:
            catalog = json.load(f)

        for category in catalog.get("categories", []):
            if category["id"] == category_id:
                return category

        return JSONResponse(status_code=404, content={"error": f"Category '{category_id}' not found"})
    except Exception as e:
        logger.error(f"Error loading recipes: {e}")
        return JSONResponse(status_code=500, content={"error": f"Failed to load recipes: {str(e)}"})


@app.get("/api/recipes/{category_id}/{recipe_id}")
async def get_recipe_config(category_id: str, recipe_id: str):
    """
    Get the configuration for a specific recipe.

    Args:
        category_id: Category identifier (e.g., 'qwen', 'llama')
        recipe_id: Recipe identifier (e.g., 'qwen3-8b', 'llama3.1-8b')

    Returns:
        Recipe configuration ready to be loaded into the playground
    """
    recipes_file = BASE_DIR / "recipes" / "recipes_catalog.json"

    if not recipes_file.exists():
        return JSONResponse(status_code=404, content={"error": "Recipes catalog not found"})

    try:
        with open(recipes_file, "r") as f:
            catalog = json.load(f)

        for category in catalog.get("categories", []):
            if category["id"] == category_id:
                for recipe in category.get("recipes", []):
                    if recipe["id"] == recipe_id:
                        return {"recipe": recipe, "category": {"id": category["id"], "name": category["name"]}}

        return JSONResponse(
            status_code=404, content={"error": f"Recipe '{recipe_id}' not found in category '{category_id}'"}
        )
    except Exception as e:
        logger.error(f"Error loading recipe: {e}")
        return JSONResponse(status_code=500, content={"error": f"Failed to load recipe: {str(e)}"})


@app.post("/api/recipes/sync")
async def sync_recipes(request: Optional[dict] = None):
    """
    Sync recipes from the vLLM recipes GitHub repository.

    This endpoint runs the sync_recipes.py script to fetch the latest
    recipes and update the local catalog.

    Request body (optional):
        {"github_token": "ghp_xxxxx"}  - GitHub token for higher rate limits

    Returns:
        Dictionary with sync status and any discovered updates
    """
    import subprocess
    import sys

    # Get GitHub token from request body if provided
    github_token = None
    if request and isinstance(request, dict):
        github_token = request.get("github_token")

    sync_script = BASE_DIR / "recipes" / "sync_recipes.py"

    if not sync_script.exists():
        return JSONResponse(
            status_code=404,
            content={
                "success": False,
                "error": "Sync script not found",
                "message": "recipes/sync_recipes.py is missing",
            },
        )

    try:
        # Check if requests is installed
        try:
            import requests
        except ImportError:
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": "Missing dependency",
                    "message": "The 'requests' package is required. Install with: pip install requests",
                },
            )

        # Run the sync script
        logger.info("Starting recipes sync from GitHub...")

        # Prepare environment with optional GitHub token
        env = os.environ.copy()
        if github_token:
            env["GITHUB_TOKEN"] = github_token
            logger.info("Using provided GitHub token for higher rate limits")

        result = subprocess.run(
            [sys.executable, str(sync_script)],
            capture_output=True,
            text=True,
            timeout=60,  # 60 second timeout
            cwd=str(BASE_DIR),
            env=env,
        )

        if result.returncode == 0:
            # Parse output for summary
            output_lines = result.stdout.strip().split("\n")

            # Reload the catalog to get updated data
            recipes_file = BASE_DIR / "recipes" / "recipes_catalog.json"
            catalog_info = {}
            if recipes_file.exists():
                with open(recipes_file, "r") as f:
                    catalog = json.load(f)
                    catalog_info = {
                        "categories": len(catalog.get("categories", [])),
                        "last_updated": catalog.get("metadata", {}).get("last_updated", "unknown"),
                        "total_recipes": sum(len(cat.get("recipes", [])) for cat in catalog.get("categories", [])),
                    }

            logger.info(f"Recipes sync completed successfully: {catalog_info}")

            return {
                "success": True,
                "message": "Recipes synced successfully from GitHub",
                "catalog": catalog_info,
                "output": result.stdout[-2000:] if len(result.stdout) > 2000 else result.stdout,  # Limit output size
            }
        else:
            # Combine stdout and stderr for better error reporting
            error_output = result.stderr or result.stdout or "Unknown error (no output)"
            logger.error(f"Recipes sync failed: {error_output}")
            return JSONResponse(
                status_code=500,
                content={
                    "success": False,
                    "error": "Sync failed",
                    "message": error_output[-1000:] if len(error_output) > 1000 else error_output,
                    "return_code": result.returncode,
                },
            )

    except subprocess.TimeoutExpired:
        logger.error("Recipes sync timed out")
        return JSONResponse(
            status_code=504,
            content={
                "success": False,
                "error": "Timeout",
                "message": "Sync operation timed out. GitHub may be slow or rate-limited.",
            },
        )
    except Exception as e:
        logger.error(f"Error syncing recipes: {e}")
        return JSONResponse(
            status_code=500, content={"success": False, "error": str(type(e).__name__), "message": str(e)}
        )


@app.post("/api/recipes/save")
async def save_recipe(request: dict):
    """
    Save (add or update) a recipe in the catalog.

    Request body:
    {
        "category_id": "deepseek",
        "recipe": { ... recipe data ... },
        "is_new": true/false,
        "original_recipe_id": "old-id" (if editing),
        "original_category_id": "old-category" (if moving),
        "new_category_name": "New Category" (if creating new category)
    }
    """
    try:
        recipes_file = BASE_DIR / "recipes" / "recipes_catalog.json"

        if not recipes_file.exists():
            return JSONResponse(status_code=404, content={"success": False, "error": "Recipes catalog not found"})

        # Load current catalog
        with open(recipes_file, "r") as f:
            catalog = json.load(f)

        category_id = request.get("category_id")
        recipe_data = request.get("recipe")
        is_new = request.get("is_new", True)
        original_recipe_id = request.get("original_recipe_id")
        original_category_id = request.get("original_category_id")
        new_category_name = request.get("new_category_name")

        if not category_id or not recipe_data:
            return JSONResponse(
                status_code=400, content={"success": False, "error": "Missing category_id or recipe data"}
            )

        # Find or create category
        category = None
        for cat in catalog.get("categories", []):
            if cat["id"] == category_id:
                category = cat
                break

        if not category:
            # Create new category
            category = {
                "id": category_id,
                "name": new_category_name or category_id.replace("-", " ").title(),
                "description": f"{new_category_name or category_id} models",
                "recipes": [],
            }
            catalog["categories"].append(category)
            logger.info(f"Created new category: {category_id}")

        # If editing (not new) and moving from different category, remove from old
        if not is_new and original_category_id and original_category_id != category_id:
            for cat in catalog.get("categories", []):
                if cat["id"] == original_category_id:
                    cat["recipes"] = [r for r in cat.get("recipes", []) if r["id"] != original_recipe_id]
                    logger.info(f"Removed recipe {original_recipe_id} from {original_category_id}")
                    break

        # Add or update recipe in target category
        if is_new:
            # Check for duplicate ID
            existing_ids = {r["id"] for r in category.get("recipes", [])}
            if recipe_data["id"] in existing_ids:
                # Generate unique ID
                base_id = recipe_data["id"]
                counter = 1
                while f"{base_id}-{counter}" in existing_ids:
                    counter += 1
                recipe_data["id"] = f"{base_id}-{counter}"

            category.setdefault("recipes", []).append(recipe_data)
            logger.info(f"Added new recipe: {recipe_data['id']} to {category_id}")
        else:
            # Update existing recipe
            recipe_found = False
            for i, r in enumerate(category.get("recipes", [])):
                if r["id"] == (original_recipe_id or recipe_data["id"]):
                    category["recipes"][i] = recipe_data
                    recipe_found = True
                    logger.info(f"Updated recipe: {recipe_data['id']} in {category_id}")
                    break

            if not recipe_found:
                # Recipe not found in target category, add it
                category.setdefault("recipes", []).append(recipe_data)
                logger.info(f"Added recipe (update-as-new): {recipe_data['id']} to {category_id}")

        # Update metadata
        from datetime import datetime

        catalog.setdefault("metadata", {})["last_updated"] = datetime.now().strftime("%Y-%m-%d")

        # Save catalog
        with open(recipes_file, "w") as f:
            json.dump(catalog, f, indent=2)

        return {
            "success": True,
            "message": f"Recipe {'added' if is_new else 'updated'} successfully",
            "recipe_id": recipe_data["id"],
            "category_id": category_id,
        }

    except Exception as e:
        logger.error(f"Error saving recipe: {e}")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})


@app.post("/api/recipes/delete")
async def delete_recipe(request: dict):
    """
    Delete a recipe from the catalog.

    Request body:
    {
        "category_id": "deepseek",
        "recipe_id": "deepseek-r1"
    }
    """
    try:
        recipes_file = BASE_DIR / "recipes" / "recipes_catalog.json"

        if not recipes_file.exists():
            return JSONResponse(status_code=404, content={"success": False, "error": "Recipes catalog not found"})

        category_id = request.get("category_id")
        recipe_id = request.get("recipe_id")

        if not category_id or not recipe_id:
            return JSONResponse(
                status_code=400, content={"success": False, "error": "Missing category_id or recipe_id"}
            )

        # Load current catalog
        with open(recipes_file, "r") as f:
            catalog = json.load(f)

        # Find category and remove recipe
        recipe_deleted = False
        for cat in catalog.get("categories", []):
            if cat["id"] == category_id:
                original_count = len(cat.get("recipes", []))
                cat["recipes"] = [r for r in cat.get("recipes", []) if r["id"] != recipe_id]
                if len(cat["recipes"]) < original_count:
                    recipe_deleted = True
                    logger.info(f"Deleted recipe: {recipe_id} from {category_id}")
                break

        if not recipe_deleted:
            return JSONResponse(status_code=404, content={"success": False, "error": "Recipe not found"})

        # Update metadata
        from datetime import datetime

        catalog.setdefault("metadata", {})["last_updated"] = datetime.now().strftime("%Y-%m-%d")

        # Save catalog
        with open(recipes_file, "w") as f:
            json.dump(catalog, f, indent=2)

        return {
            "success": True,
            "message": "Recipe deleted successfully",
            "recipe_id": recipe_id,
            "category_id": category_id,
        }

    except Exception as e:
        logger.error(f"Error deleting recipe: {e}")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})


@app.post("/api/models/validate-local")
async def validate_local_model(request: dict):
    """
    Validate a local model path

    Request body: {"path": "/path/to/model"}
    Response: {"valid": bool, "error": str, "info": dict}
    """
    model_path = request.get("path", "")

    if not model_path:
        return JSONResponse(status_code=400, content={"valid": False, "error": "No path provided"})

    result = validate_local_model_path(model_path)

    if result["valid"]:
        return result
    else:
        return JSONResponse(status_code=400, content=result)


@app.post("/api/browse-directories")
async def browse_directories(request: dict):
    """
    Browse directories on the server for folder selection

    Request body: {"path": "/path/to/directory"}
    Response: {"directories": [...], "current_path": "..."}
    """
    try:
        import os
        from pathlib import Path

        requested_path = request.get("path", "~")

        # Expand ~ to home directory
        if requested_path == "~":
            requested_path = str(Path.home())

        path = Path(requested_path).expanduser().resolve()

        # Security check: ensure path exists and is a directory
        if not path.exists():
            # Try parent directory
            path = path.parent
            if not path.exists():
                path = Path.home()

        if not path.is_dir():
            path = path.parent

        # List only directories (not files)
        directories = []

        try:
            # Add parent directory option (except for root)
            if path.parent != path:
                directories.append({"name": "..", "path": str(path.parent)})

            # List subdirectories
            for item in sorted(path.iterdir()):
                if item.is_dir() and not item.name.startswith("."):
                    # Check if it might be a model directory (has config.json)
                    is_model_dir = (item / "config.json").exists()
                    directories.append({"name": item.name + (" 🤖" if is_model_dir else ""), "path": str(item)})
        except PermissionError:
            logger.warning(f"Permission denied accessing directory: {path}")

        return {
            "directories": directories[:100],  # Limit to 100 directories
            "current_path": str(path),
        }

    except Exception as e:
        logger.error(f"Error browsing directories: {e}")
        return JSONResponse(status_code=500, content={"error": f"Failed to browse directories: {str(e)}"})


class LocalModelValidationRequest(BaseModel):
    """Request to validate a local model path"""

    path: str


class LocalModelValidationResponse(BaseModel):
    """Response for local model path validation"""

    valid: bool
    message: str
    model_name: Optional[str] = None
    model_type: Optional[str] = None
    has_tokenizer: bool = False
    has_config: bool = False
    estimated_size_mb: Optional[float] = None


@app.post("/api/models/validate-local")
async def validate_local_model(request: LocalModelValidationRequest) -> LocalModelValidationResponse:
    """Validate a local model directory"""
    try:
        model_path = Path(request.path)

        # Check if path exists
        if not model_path.exists():
            return LocalModelValidationResponse(valid=False, message=f"Path does not exist: {request.path}")

        # Check if it's a directory
        if not model_path.is_dir():
            return LocalModelValidationResponse(valid=False, message=f"Path must be a directory, not a file")

        # Check for required files
        config_file = model_path / "config.json"
        tokenizer_config = model_path / "tokenizer_config.json"
        has_config = config_file.exists()
        has_tokenizer = tokenizer_config.exists()

        if not has_config:
            return LocalModelValidationResponse(
                valid=False,
                message=f"Invalid model directory: missing config.json",
                has_config=has_config,
                has_tokenizer=has_tokenizer,
            )

        # Try to read model info from config.json
        model_type = None
        model_name = model_path.name
        try:
            import json

            with open(config_file, "r") as f:
                config_data = json.load(f)
                model_type = config_data.get("model_type", "unknown")
                # Try to get architectures
                architectures = config_data.get("architectures", [])
                if architectures:
                    model_type = architectures[0]
        except Exception as e:
            logger.warning(f"Could not read config.json: {e}")

        # Estimate directory size
        estimated_size_mb = None
        try:
            total_size = sum(f.stat().st_size for f in model_path.rglob("*") if f.is_file())
            estimated_size_mb = total_size / (1024 * 1024)  # Convert to MB
        except Exception as e:
            logger.warning(f"Could not estimate model size: {e}")

        return LocalModelValidationResponse(
            valid=True,
            message=f"Valid model directory",
            model_name=model_name,
            model_type=model_type,
            has_config=has_config,
            has_tokenizer=has_tokenizer,
            estimated_size_mb=round(estimated_size_mb, 2) if estimated_size_mb else None,
        )

    except Exception as e:
        logger.error(f"Error validating local model: {e}")
        return LocalModelValidationResponse(valid=False, message=f"Error validating path: {str(e)}")


@app.get("/api/chat/template")
async def get_chat_template():
    """
    Get information about the chat template being used by the currently loaded model.
    vLLM auto-detects templates from tokenizer_config.json - this endpoint provides reference info.
    """
    global current_config

    if current_config is None:
        raise HTTPException(status_code=400, detail="No model configuration available")

    if current_config.custom_chat_template:
        # User is using a custom template
        return {
            "source": "custom (user-provided)",
            "model": current_config.model,
            "template": current_config.custom_chat_template,
            "stop_tokens": current_config.custom_stop_tokens or [],
            "note": "Using custom chat template provided by user (overrides model's built-in template)",
        }
    else:
        # vLLM is auto-detecting from model's tokenizer_config.json
        # We provide reference templates for documentation purposes
        return {
            "source": "auto-detected by vLLM",
            "model": current_config.model,
            "template": get_chat_template_for_model(current_config.model),
            "stop_tokens": get_stop_tokens_for_model(current_config.model),
            "note": "vLLM automatically uses the chat template from the model's tokenizer_config.json. The template shown here is a reference/fallback for documentation purposes only.",
        }


@app.get("/api/vllm/health")
async def check_vllm_health():
    """Check if the vLLM server is healthy and ready to serve requests"""
    global current_config, vllm_process, current_run_mode

    # Check if server is running
    if not await check_vllm_server_running():
        return {"success": False, "status_code": 503, "error": "Server not running"}

    if current_config is None:
        return {"success": False, "status_code": 503, "error": "No configuration"}

    # Try to call vLLM's health endpoint
    try:
        import aiohttp

        base_url = get_vllm_base_url()
        health_url = f"{base_url}/health"
        auth_headers = get_vllm_auth_headers()

        timeout = aiohttp.ClientTimeout(total=3)
        async with aiohttp.ClientSession(timeout=timeout, headers=auth_headers) as session:
            async with session.get(health_url) as response:
                if response.status == 200:
                    return {"success": True, "status_code": 200, "message": "Server is healthy"}
                else:
                    return {"success": False, "status_code": response.status, "error": "Health check failed"}
    except Exception as e:
        return {"success": False, "status_code": 503, "error": str(e)}


@app.get("/api/vllm/metrics")
async def get_vllm_metrics():
    """Get vLLM server metrics including KV cache and prefix cache stats"""
    global current_config, latest_vllm_metrics, metrics_timestamp, current_run_mode

    # Check server status based on mode
    if not await check_vllm_server_running():
        return JSONResponse(status_code=400, content={"error": "vLLM server is not running"})

    # Calculate how fresh the metrics are
    metrics_age_seconds = None
    if metrics_timestamp:
        metrics_age_seconds = (datetime.now() - metrics_timestamp).total_seconds()
        logger.info(f"Returning metrics (age: {metrics_age_seconds:.1f}s): {latest_vllm_metrics}")
    else:
        logger.info(f"Returning metrics (no timestamp): {latest_vllm_metrics}")

    # Return metrics parsed from logs with freshness indicator
    if latest_vllm_metrics:
        result = latest_vllm_metrics.copy()
        if metrics_age_seconds is not None:
            result["metrics_age_seconds"] = round(metrics_age_seconds, 1)
        return result

    # If no metrics captured yet from logs, try the metrics endpoint
    if current_config is None:
        return {}

    try:
        import aiohttp

        # Use centralized URL construction
        base_url = get_vllm_base_url()
        metrics_url = f"{base_url}/metrics"
        auth_headers = get_vllm_auth_headers()

        async with aiohttp.ClientSession(headers=auth_headers) as session:
            try:
                async with session.get(metrics_url, timeout=aiohttp.ClientTimeout(total=2)) as response:
                    if response.status == 200:
                        text = await response.text()

                        # Parse Prometheus-style metrics
                        metrics = {}

                        # Look for KV cache usage
                        for line in text.split("\n"):
                            if "vllm:gpu_cache_usage_perc" in line and not line.startswith("#"):
                                try:
                                    value = float(line.split()[-1])
                                    metrics["gpu_cache_usage_perc"] = value
                                except:
                                    pass
                            elif "vllm:cpu_cache_usage_perc" in line and not line.startswith("#"):
                                try:
                                    value = float(line.split()[-1])
                                    metrics["cpu_cache_usage_perc"] = value
                                except:
                                    pass
                            elif "vllm:avg_prompt_throughput_toks_per_s" in line and not line.startswith("#"):
                                try:
                                    value = float(line.split()[-1])
                                    metrics["avg_prompt_throughput"] = value
                                except:
                                    pass
                            elif "vllm:avg_generation_throughput_toks_per_s" in line and not line.startswith("#"):
                                try:
                                    value = float(line.split()[-1])
                                    metrics["avg_generation_throughput"] = value
                                except:
                                    pass

                        return metrics
                    else:
                        return {}
            except asyncio.TimeoutError:
                return {}
            except Exception as e:
                logger.debug(f"Error fetching metrics endpoint: {e}")
                return {}

    except Exception as e:
        logger.debug(f"Error in get_vllm_metrics: {e}")
        return {}


@app.post("/api/benchmark/start")
async def start_benchmark(config: BenchmarkConfig):
    """Start a benchmark test using either built-in or GuideLLM"""
    global current_config, benchmark_task, benchmark_results, current_run_mode

    # Check server status based on mode
    if not await check_vllm_server_running():
        raise HTTPException(status_code=400, detail="vLLM server is not running")

    if benchmark_task is not None and not benchmark_task.done():
        raise HTTPException(status_code=400, detail="Benchmark is already running")

    try:
        # Reset results
        benchmark_results = None

        # Choose benchmark method
        if config.use_guidellm:
            # Start GuideLLM benchmark task
            benchmark_task = asyncio.create_task(run_guidellm_benchmark(config, current_config))
            await broadcast_log("[BENCHMARK] Starting GuideLLM benchmark...")
        else:
            # Start built-in benchmark task
            benchmark_task = asyncio.create_task(run_benchmark(config, current_config))
            await broadcast_log("[BENCHMARK] Starting built-in benchmark...")

        return {"status": "started", "message": "Benchmark started"}

    except Exception as e:
        logger.error(f"Failed to start benchmark: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/benchmark/status")
async def get_benchmark_status():
    """Get current benchmark status"""
    global benchmark_task, benchmark_results

    if benchmark_task is None:
        return {"running": False, "results": None}

    if benchmark_task.done():
        if benchmark_results:
            results_dict = benchmark_results.dict()
            logger.info(f"[BENCHMARK DEBUG] Returning results: {results_dict}")
            return {"running": False, "results": results_dict}
        else:
            return {"running": False, "results": None, "error": "Benchmark failed"}

    return {"running": True, "results": None}


@app.post("/api/benchmark/stop")
async def stop_benchmark():
    """Stop the running benchmark"""
    global benchmark_task

    if benchmark_task is None or benchmark_task.done():
        raise HTTPException(status_code=400, detail="No benchmark is running")

    try:
        benchmark_task.cancel()
        await broadcast_log("[BENCHMARK] Benchmark stopped by user")
        return {"status": "stopped"}
    except Exception as e:
        logger.error(f"Failed to stop benchmark: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def run_benchmark(config: BenchmarkConfig, server_config: VLLMConfig):
    """Run a simple benchmark test"""
    global benchmark_results, current_model_identifier, current_run_mode

    try:
        import aiohttp
        import time
        import random
        import numpy as np

        await broadcast_log(
            f"[BENCHMARK] Configuration: {config.total_requests} requests at {config.request_rate} req/s"
        )

        # Use centralized URL construction
        base_url = get_vllm_base_url()
        url = f"{base_url}/v1/chat/completions"
        logger.info(f"Using URL for benchmark: {url}")

        # Generate a sample prompt of specified length
        prompt_text = " ".join(["benchmark" for _ in range(config.prompt_tokens // 10)])

        results = []
        successful = 0
        failed = 0
        start_time = time.time()

        # Create session
        auth_headers = get_vllm_auth_headers()
        async with aiohttp.ClientSession(headers=auth_headers) as session:
            # Send requests
            for i in range(config.total_requests):
                request_start = time.time()

                try:
                    payload = {
                        "model": get_model_name_for_api(),
                        "messages": [{"role": "user", "content": prompt_text}],
                        "max_tokens": config.output_tokens,
                        "temperature": 0.7,
                    }

                    # Add stop tokens only if user configured custom ones
                    # Otherwise let vLLM handle stop tokens automatically
                    if server_config.custom_stop_tokens:
                        payload["stop"] = server_config.custom_stop_tokens

                    async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=60)) as response:
                        if response.status == 200:
                            data = await response.json()
                            request_end = time.time()
                            latency = (request_end - request_start) * 1000  # ms

                            # Extract token counts
                            usage = data.get("usage", {})
                            completion_tokens = usage.get("completion_tokens", config.output_tokens)

                            # Debug: Log token extraction for first few requests
                            if i < 3:
                                logger.info(f"[BENCHMARK DEBUG] Request {i + 1} usage: {usage}")
                                logger.info(f"[BENCHMARK DEBUG] Request {i + 1} completion_tokens: {completion_tokens}")

                            results.append({"latency": latency, "tokens": completion_tokens})
                            successful += 1
                        else:
                            failed += 1
                            logger.warning(f"Request {i + 1} failed with status {response.status}")

                except Exception as e:
                    failed += 1
                    logger.error(f"Request {i + 1} error: {e}")

                # Progress update
                if (i + 1) % max(1, config.total_requests // 10) == 0:
                    progress = ((i + 1) / config.total_requests) * 100
                    await broadcast_log(
                        f"[BENCHMARK] Progress: {progress:.0f}% ({i + 1}/{config.total_requests} requests)"
                    )

                # Rate limiting
                if config.request_rate > 0:
                    await asyncio.sleep(1.0 / config.request_rate)

        end_time = time.time()
        duration = end_time - start_time

        # Calculate metrics
        if results:
            latencies = [r["latency"] for r in results]
            tokens = [r["tokens"] for r in results]

            throughput = len(results) / duration
            avg_latency = np.mean(latencies)
            p50_latency = np.percentile(latencies, 50)
            p95_latency = np.percentile(latencies, 95)
            p99_latency = np.percentile(latencies, 99)
            tokens_per_second = sum(tokens) / duration
            total_tokens = sum(tokens) + (len(results) * config.prompt_tokens)
            success_rate = (successful / config.total_requests) * 100

            # Debug logging
            logger.info(f"[BENCHMARK DEBUG] Total output tokens: {sum(tokens)}")
            logger.info(f"[BENCHMARK DEBUG] Total prompt tokens: {len(results) * config.prompt_tokens}")
            logger.info(f"[BENCHMARK DEBUG] Duration: {duration:.2f}s")
            logger.info(f"[BENCHMARK DEBUG] tokens_per_second: {tokens_per_second:.2f}")
            logger.info(f"[BENCHMARK DEBUG] total_tokens: {int(total_tokens)}")

            benchmark_results = BenchmarkResults(
                throughput=round(throughput, 2),
                avg_latency=round(avg_latency, 2),
                p50_latency=round(p50_latency, 2),
                p95_latency=round(p95_latency, 2),
                p99_latency=round(p99_latency, 2),
                tokens_per_second=round(tokens_per_second, 2),
                total_tokens=int(total_tokens),
                success_rate=round(success_rate, 2),
                completed=True,
            )

            await broadcast_log(
                f"[BENCHMARK] Completed! Throughput: {throughput:.2f} req/s, Avg Latency: {avg_latency:.2f}ms"
            )
            await broadcast_log(
                f"[BENCHMARK] Token Throughput: {tokens_per_second:.2f} tok/s, Total Tokens: {int(total_tokens)}"
            )
        else:
            await broadcast_log(f"[BENCHMARK] Failed - No successful requests")
            benchmark_results = None

    except asyncio.CancelledError:
        await broadcast_log("[BENCHMARK] Benchmark cancelled")
        raise
    except Exception as e:
        logger.error(f"Benchmark error: {e}")
        await broadcast_log(f"[BENCHMARK] Error: {e}")
        benchmark_results = None


async def run_guidellm_benchmark(config: BenchmarkConfig, server_config: VLLMConfig):
    """Run a benchmark using GuideLLM"""
    global benchmark_results

    try:
        await broadcast_log(
            f"[GUIDELLM] Configuration: {config.total_requests} requests at {config.request_rate} req/s"
        )

        # Check if GuideLLM is installed
        try:
            import guidellm

            # Don't import internal modules - we'll use the CLI
            await broadcast_log(
                f"[GUIDELLM] Package found: {guidellm.__version__ if hasattr(guidellm, '__version__') else 'version unknown'}"
            )
        except ImportError as e:
            error_msg = f"GuideLLM not installed: {str(e)}"
            logger.error(error_msg)
            await broadcast_log(f"[GUIDELLM] ERROR: {error_msg}")
            await broadcast_log(f"[GUIDELLM] Python executable: {sys.executable}")
            await broadcast_log(f"[GUIDELLM] Python path: {sys.path}")
            await broadcast_log(f"[GUIDELLM] Run: pip install guidellm")
            benchmark_results = None
            return

        # Setup target URL
        target_url = f"{get_vllm_base_url()}/v1"
        await broadcast_log(f"[GUIDELLM] Target: {target_url}")

        # Run GuideLLM benchmark using subprocess (since GuideLLM CLI is simpler)
        import json
        import subprocess

        # Use the same Python executable that's running this application
        # Since guidellm was successfully imported above, it must be in the same environment
        python_exec = sys.executable
        await broadcast_log(f"[GUIDELLM] Using Python executable: {python_exec}")

        # Get the path to the guidellm module for informational purposes
        guidellm_location = guidellm.__file__
        await broadcast_log(f"[GUIDELLM] Module location: {guidellm_location}")

        # Verify guidellm is accessible from this Python
        # Note: This check is optional - if it fails or times out, we'll still attempt to run
        try:
            check_result = subprocess.run(
                [python_exec, "-m", "guidellm", "--help"],
                capture_output=True,
                timeout=30,  # Increased timeout for OpenShift compatibility
            )
            if check_result.returncode != 0:
                # Current python_exec doesn't have guidellm, try finding it in PATH
                await broadcast_log(f"[GUIDELLM] WARNING: guidellm CLI not accessible from {python_exec}")
                await broadcast_log(f"[GUIDELLM] stderr: {check_result.stderr.decode()}")
                # Try to find guidellm in PATH
                which_result = subprocess.run(["which", "guidellm"], capture_output=True, text=True)
                if which_result.returncode == 0:
                    guidellm_bin = which_result.stdout.strip()
                    await broadcast_log(f"[GUIDELLM] Found guidellm binary at: {guidellm_bin}")
                    # Use guidellm directly instead of python -m
                    python_exec = None  # Will use guidellm command directly
                else:
                    await broadcast_log(
                        f"[GUIDELLM] WARNING: GuideLLM CLI verification failed, will attempt to run anyway"
                    )
                    await broadcast_log(
                        f"[GUIDELLM] If benchmark fails, ensure GuideLLM is properly installed: pip install guidellm"
                    )
            else:
                await broadcast_log(f"[GUIDELLM] CLI verified: {python_exec}")
        except subprocess.TimeoutExpired:
            # Don't fail - just warn and continue
            await broadcast_log(f"[GUIDELLM] WARNING: CLI check timed out (30s), will attempt to run benchmark anyway")
            await broadcast_log(
                f"[GUIDELLM] If you encounter issues, ensure GuideLLM is installed in your venv: pip install guidellm"
            )
        except Exception as e:
            # Don't fail - just warn and continue
            await broadcast_log(f"[GUIDELLM] WARNING: Error checking GuideLLM installation: {e}")
            await broadcast_log(
                f"[GUIDELLM] Will attempt to run benchmark anyway. Ensure GuideLLM is installed: pip install guidellm"
            )

        # Create a temporary JSON file for results
        result_file = tempfile.NamedTemporaryFile(mode="w+", suffix=".json", delete=False)
        result_file.close()

        # Build GuideLLM command
        # GuideLLM structure: guidellm benchmark [OPTIONS]
        # Example: guidellm benchmark --target "url" --rate-type sweep --max-seconds 30 --data "prompt_tokens=256,output_tokens=128"

        if python_exec:
            cmd = [
                python_exec,
                "-m",
                "guidellm",
                "benchmark",
                "--target",
                target_url,
            ]
        else:
            cmd = [
                "guidellm",
                "benchmark",
                "--target",
                target_url,
            ]

        # Add rate configuration
        # If rate is specified, use constant rate, otherwise use sweep
        if config.request_rate > 0:
            cmd.extend(["--rate-type", "constant"])
            cmd.extend(["--rate", str(config.request_rate)])
        else:
            cmd.extend(["--rate-type", "sweep"])

        # Add request limit
        cmd.extend(["--max-requests", str(config.total_requests)])

        # Add token configuration in guidellm's data format
        data_str = f"prompt_tokens={config.prompt_tokens},output_tokens={config.output_tokens}"
        cmd.extend(["--data", data_str])

        # Add output path to save JSON results
        cmd.extend(["--output-path", result_file.name])

        await broadcast_log(f"[GUIDELLM] Running: {' '.join(cmd)}")
        await broadcast_log(f"[GUIDELLM] JSON output will be saved to: {result_file.name}")

        # Run GuideLLM process and capture ALL output.
        # IMPORTANT: Read stdout and stderr concurrently to avoid deadlock.
        # GuideLLM writes progress/status to stderr; if we only read stdout
        # the stderr pipe buffer fills up, blocking the process, which in
        # turn blocks our stdout readline -- classic subprocess deadlock.
        process = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )

        # Collect all output lines for parsing
        output_lines = []
        stderr_lines = []

        async def _drain_stdout():
            while True:
                line = await process.stdout.readline()
                if not line:
                    break
                decoded = line.decode().strip()
                if decoded:
                    output_lines.append(decoded)
                    await broadcast_log(f"[GUIDELLM] {decoded}")

        async def _drain_stderr():
            while True:
                line = await process.stderr.readline()
                if not line:
                    break
                decoded = line.decode().strip()
                if decoded:
                    stderr_lines.append(decoded)
                    # Log stderr too (contains progress info)
                    await broadcast_log(f"[GUIDELLM] {decoded}")

        # Read both streams concurrently, then wait for exit
        await asyncio.gather(_drain_stdout(), _drain_stderr())
        await process.wait()

        if process.returncode != 0:
            error_msg = "\n".join(stderr_lines) if stderr_lines else "Unknown error"
            await broadcast_log(f"[GUIDELLM] Error (exit code {process.returncode}): {error_msg}")
            benchmark_results = None
            return

        # Join all output for raw display
        raw_output = "\n".join(output_lines)
        if stderr_lines:
            raw_output += "\n--- stderr ---\n" + "\n".join(stderr_lines)

        # Try to read JSON output file
        json_output = None
        try:
            # Check if file exists and has content
            if os.path.exists(result_file.name):
                file_size = os.path.getsize(result_file.name)
                await broadcast_log(f"[GUIDELLM] 📄 JSON file found: {result_file.name} (size: {file_size} bytes)")

                with open(result_file.name, "r") as f:
                    json_output = f.read()

                if json_output:
                    await broadcast_log(
                        f"[GUIDELLM] ✅ JSON output loaded successfully ({len(json_output)} characters)"
                    )
                    # Validate it's valid JSON
                    try:
                        import json as json_module

                        json_module.loads(json_output)
                        await broadcast_log(f"[GUIDELLM] ✅ JSON is valid")
                    except Exception as json_err:
                        await broadcast_log(f"[GUIDELLM] ⚠️ JSON validation failed: {json_err}")
                else:
                    await broadcast_log(f"[GUIDELLM] ⚠️ JSON file is empty")
            else:
                await broadcast_log(f"[GUIDELLM] ⚠️ JSON output file not found at {result_file.name}")
                await broadcast_log(f"[GUIDELLM] Checking if guidellm created a file in current directory...")
                # Sometimes guidellm creates files with different names
                import glob

                json_files = glob.glob("*.json")
                if json_files:
                    await broadcast_log(f"[GUIDELLM] Found JSON files in current directory: {json_files}")
        except Exception as e:
            await broadcast_log(f"[GUIDELLM] ⚠️ Failed to read JSON output: {e}")
            logger.exception("Error reading GuideLLM JSON output")

        # Parse results from text output
        try:
            # Extract metrics from the "Benchmarks Stats" table
            # Example line: constant@5.00| 0.57| 9.43| 57.3| 115.1| 16.45| 16.08| ...

            throughput = 0.0
            tokens_per_second = 0.0
            avg_latency = 0.0
            p50_latency = 0.0
            p99_latency = 0.0

            # Find the stats line (after "Benchmark| Per Second|")
            for i, line in enumerate(output_lines):
                # Look for the data line with benchmark name and metrics
                if "constant@" in line or "sweep@" in line:
                    # Check if this is the stats line (contains numeric data)
                    parts = [p.strip() for p in line.split("|") if p.strip()]
                    if len(parts) >= 7:
                        try:
                            # Parse the data
                            # Format: Benchmark| Per Second| Concurrency| Out Tok/sec| Tot Tok/sec| Req Latency mean| median| p99| ...
                            throughput = float(parts[1])  # Per Second
                            tokens_per_second = float(parts[3])  # Out Tok/sec
                            # total_tok_per_sec = float(parts[4])  # Tot Tok/sec
                            avg_latency = float(parts[5]) * 1000  # Convert seconds to ms
                            p50_latency = float(parts[6]) * 1000  # median
                            if len(parts) >= 8:
                                p99_latency = float(parts[7]) * 1000  # p99

                            await broadcast_log(f"[GUIDELLM] 📊 Parsed metrics from output")
                            break
                        except (ValueError, IndexError) as e:
                            await broadcast_log(f"[GUIDELLM] Debug: Failed to parse line: {line}")
                            await broadcast_log(f"[GUIDELLM] Debug: Parts: {parts}")
                            continue

            benchmark_results = BenchmarkResults(
                throughput=float(throughput),
                avg_latency=float(avg_latency),
                p50_latency=float(p50_latency),
                p95_latency=float(p50_latency * 1.2),  # Estimate if not available
                p99_latency=float(p99_latency),
                tokens_per_second=float(tokens_per_second),
                total_tokens=int(config.total_requests * config.output_tokens),  # Estimate
                success_rate=100.0,  # Assume success if completed
                completed=True,
                raw_output=raw_output,  # Store raw output for display
                json_output=json_output,  # Store JSON output for display
            )

            await broadcast_log(f"[GUIDELLM] ✅ Completed!")
            await broadcast_log(f"[GUIDELLM] 📊 Throughput: {benchmark_results.throughput:.2f} req/s")
            await broadcast_log(f"[GUIDELLM] ⚡ Token Throughput: {benchmark_results.tokens_per_second:.2f} tok/s")
            await broadcast_log(f"[GUIDELLM] ⏱️  Avg Latency: {benchmark_results.avg_latency:.2f} ms")
            await broadcast_log(f"[GUIDELLM] 📈 P99 Latency: {benchmark_results.p99_latency:.2f} ms")

        except Exception as e:
            logger.error(f"Failed to parse GuideLLM results: {e}")
            await broadcast_log(f"[GUIDELLM] Error parsing results: {e}")
            # Still create result with raw output
            benchmark_results = BenchmarkResults(
                throughput=0.0,
                avg_latency=0.0,
                p50_latency=0.0,
                p95_latency=0.0,
                p99_latency=0.0,
                tokens_per_second=0.0,
                total_tokens=0,
                success_rate=0.0,
                completed=True,
                raw_output=raw_output if "raw_output" in locals() else "Error capturing output",
                json_output=json_output if "json_output" in locals() else None,
            )
        finally:
            # Clean up temp file
            try:
                os.unlink(result_file.name)
            except:
                pass

    except asyncio.CancelledError:
        await broadcast_log("[GUIDELLM] Benchmark cancelled")
        raise
    except Exception as e:
        logger.error(f"GuideLLM benchmark error: {e}")
        await broadcast_log(f"[GUIDELLM] Error: {e}")
        benchmark_results = None


# =============================================================================
# vLLM-Omni API Endpoints
# =============================================================================


@app.get("/api/omni/health")
async def check_omni_health():
    """Check if the vLLM-Omni server is healthy and ready to serve requests"""
    global omni_running, omni_config, omni_run_mode, omni_inprocess_model

    if not omni_running or not omni_config:
        return {"success": False, "ready": False, "error": "Server not running"}

    # In-process mode: check if model is loaded
    if omni_run_mode == "inprocess":
        if omni_inprocess_model is not None:
            return {"success": True, "ready": True, "message": "In-process model is ready"}
        else:
            return {"success": False, "ready": False, "error": "In-process model not loaded"}

    # API server modes: try to call vLLM-Omni's health endpoint
    try:
        import aiohttp

        base_url = get_omni_base_url()
        health_url = f"{base_url}/health"
        headers = get_omni_auth_headers()

        timeout = aiohttp.ClientTimeout(total=3)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(health_url, headers=headers) as response:
                if response.status == 200:
                    return {"success": True, "ready": True, "message": "Server is healthy"}
                else:
                    return {"success": False, "ready": False, "error": f"Health check returned {response.status}"}
    except Exception as e:
        return {"success": False, "ready": False, "error": str(e)}


@app.get("/api/omni/status")
async def get_omni_status():
    """Get vLLM-Omni server status.

    Returns with no-cache headers to ensure fresh state after backend restart.
    """
    global omni_running, omni_config, omni_start_time, omni_run_mode

    uptime = None
    ready = False

    if omni_running and omni_start_time:
        delta = datetime.now() - omni_start_time
        hours, remainder = divmod(int(delta.total_seconds()), 3600)
        minutes, seconds = divmod(remainder, 60)
        uptime = f"{hours}h {minutes}m {seconds}s"

        # Check if server is actually ready
        health_result = await check_omni_health()
        ready = health_result.get("ready", False)

    status = OmniServerStatus(
        running=omni_running,
        ready=ready,
        model=omni_config.model if omni_config else None,
        model_type=omni_config.model_type if omni_config else None,
        port=omni_config.port if omni_config else None,
        run_mode=omni_run_mode,
        uptime=uptime,
    )

    # Return with no-cache header - allows 304 responses but ensures validation
    return JSONResponse(content=status.model_dump(), headers={"Cache-Control": "no-cache"})


@app.post("/api/omni/check-venv")
async def check_omni_venv(request: dict):
    """Check if vLLM-Omni is installed in the specified virtual environment.

    Uses multiple detection methods (like main vLLM Server):
    1. Python import
    2. pip list
    3. uv pip list (for vllm-metal style installations)
    """
    venv_path = request.get("venv_path")

    if not venv_path:
        return {"vllm_omni_installed": False, "vllm_omni_version": None, "error": "No venv path provided"}

    try:
        # Expand and resolve path
        venv_path = Path(venv_path).expanduser().resolve(strict=False)

        if not venv_path.exists():
            return {
                "vllm_omni_installed": False,
                "vllm_omni_version": None,
                "error": f"Path does not exist: {venv_path}",
            }

        if not venv_path.is_dir():
            return {
                "vllm_omni_installed": False,
                "vllm_omni_version": None,
                "error": f"Path is not a directory: {venv_path}",
            }

        # Find Python executable
        import platform

        if platform.system() == "Windows":
            python_path = venv_path / "Scripts" / "python.exe"
        else:
            python_path = venv_path / "bin" / "python"

        if not python_path.exists():
            return {
                "vllm_omni_installed": False,
                "vllm_omni_version": None,
                "error": f"Python executable not found: {python_path}",
            }

        omni_found = False
        omni_version = None
        detection_method = None

        # Method 1: Try direct Python import
        try:
            result = subprocess.run(
                [str(python_path), "-c", "import vllm_omni; print(getattr(vllm_omni, '__version__', 'unknown'))"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode == 0:
                omni_found = True
                version_output = result.stdout.strip()
                if version_output and version_output != "unknown":
                    omni_version = version_output
                detection_method = "python import"
        except Exception:
            pass

        # Method 2: Try pip list
        if not omni_found:
            try:
                result = subprocess.run(
                    [str(python_path), "-m", "pip", "list", "--format=freeze"],
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                if result.returncode == 0:
                    for line in result.stdout.split("\n"):
                        if line.lower().startswith("vllm-omni==") or line.lower().startswith("vllm_omni=="):
                            omni_found = True
                            parts = line.split("==")
                            if len(parts) >= 2:
                                omni_version = parts[1]
                            detection_method = "pip list"
                            break
            except Exception:
                pass

        # Method 3: Try uv pip list (for vllm-metal style installations)
        if not omni_found:
            try:
                result = subprocess.run(
                    ["uv", "pip", "list", "--python", str(python_path)],
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                if result.returncode == 0:
                    for line in result.stdout.split("\n"):
                        lower_line = line.lower()
                        if "vllm-omni" in lower_line or "vllm_omni" in lower_line:
                            omni_found = True
                            parts = line.split()
                            if len(parts) >= 2:
                                omni_version = parts[1]
                            detection_method = "uv pip list"
                            break
            except FileNotFoundError:
                # uv not installed, skip
                pass
            except Exception:
                pass

        if omni_found:
            logger.info(f"vLLM-Omni detected via {detection_method}: v{omni_version}")
        else:
            logger.debug(f"vLLM-Omni not found in venv: {venv_path}")

        return {
            "vllm_omni_installed": omni_found,
            "vllm_omni_version": omni_version,
            "detection_method": detection_method,
        }

    except Exception as e:
        logger.error(f"Error checking vLLM-Omni in venv: {e}")
        return {"vllm_omni_installed": False, "vllm_omni_version": None, "error": str(e)}


@app.post("/api/omni/start")
async def start_omni_server(config: OmniConfig):
    """Start vLLM-Omni server with --omni flag"""
    global omni_process, omni_container_id, omni_running, omni_config, omni_start_time, omni_run_mode
    global omni_inprocess_model

    # Check if already running
    if omni_running:
        raise HTTPException(status_code=400, detail="vLLM-Omni server is already running")

    try:
        omni_config = config

        # ═══════════════════════════════════════════════════════════════════════
        # In-process mode for Stable Audio (bypasses broken vLLM-Omni serving)
        # The vLLM-Omni serving layer has a bug where it doesn't serialize audio
        # output. Using offline inference directly works around this issue.
        # ═══════════════════════════════════════════════════════════════════════
        if "stable-audio" in config.model.lower() and config.run_mode == "subprocess":
            logger.info("Detected Stable Audio model - using in-process mode (bypasses serving bug)")
            await broadcast_omni_log("[OMNI] Detected Stable Audio model")
            await broadcast_omni_log("[OMNI] Using in-process mode (bypasses vLLM-Omni serving bug)")

            omni_run_mode = "inprocess"

            # Set environment for GPU selection
            if config.gpu_device:
                os.environ["CUDA_VISIBLE_DEVICES"] = config.gpu_device
            if config.hf_token:
                os.environ["HF_TOKEN"] = config.hf_token

            await broadcast_omni_log(f"[OMNI] Loading model: {config.model}")
            await broadcast_omni_log("[OMNI] This may take a minute...")

            import queue as thread_queue

            # Thread-safe queue for capturing vllm_omni logs
            shared_log_queue = thread_queue.Queue()

            # Load the model in a thread pool to avoid blocking
            def load_stable_audio_model():
                import logging

                # Custom handler to capture vllm_omni logs
                class QueueHandler(logging.Handler):
                    def emit(self, record):
                        try:
                            msg = self.format(record)
                            shared_log_queue.put(msg)
                        except Exception:
                            pass

                # Add handler to capture vllm/vllm_omni logs
                queue_handler = QueueHandler()
                queue_handler.setFormatter(logging.Formatter("[OMNI] %(message)s"))
                queue_handler.setLevel(logging.INFO)

                loggers_to_capture = ["vllm", "vllm_omni"]
                for logger_name in loggers_to_capture:
                    try:
                        log = logging.getLogger(logger_name)
                        log.addHandler(queue_handler)
                    except Exception:
                        pass

                try:
                    import torch
                    from vllm_omni.entrypoints.omni import Omni

                    # Create the Omni model
                    model = Omni(
                        model=config.model,
                        gpu_memory_utilization=config.gpu_memory_utilization,
                        enforce_eager=not config.enable_torch_compile,
                        trust_remote_code=config.trust_remote_code,
                    )
                    return model
                except Exception as e:
                    logger.error(f"Failed to load Stable Audio model: {e}")
                    raise
                finally:
                    # Remove handler after loading
                    for logger_name in loggers_to_capture:
                        try:
                            log = logging.getLogger(logger_name)
                            log.removeHandler(queue_handler)
                        except Exception:
                            pass

            import concurrent.futures

            # Start model loading in background thread
            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(load_stable_audio_model)

                # Stream logs while model is loading
                while not future.done():
                    # Drain log queue
                    while True:
                        try:
                            msg = shared_log_queue.get_nowait()
                            if msg:
                                await broadcast_omni_log(msg)
                        except thread_queue.Empty:
                            break
                    await asyncio.sleep(0.1)

                # Get result (raises if there was an error)
                omni_inprocess_model = future.result()

                # Drain any remaining logs
                while True:
                    try:
                        msg = shared_log_queue.get_nowait()
                        if msg:
                            await broadcast_omni_log(msg)
                    except thread_queue.Empty:
                        break

            omni_running = True
            omni_start_time = datetime.now()

            await broadcast_omni_log("[OMNI] ✅ Stable Audio model loaded successfully")
            await broadcast_omni_log(f"[OMNI] Model: {config.model}")
            await broadcast_omni_log("[OMNI] Ready for audio generation")

            return {
                "status": "started",
                "mode": "inprocess",
                "model": config.model,
                "message": "Stable Audio loaded in-process (bypasses serving bug)",
            }

        # ═══════════════════════════════════════════════════════════════════════
        # Remote mode: connect to an existing remote vLLM-Omni instance
        # ═══════════════════════════════════════════════════════════════════════
        if config.run_mode == "remote":
            if not config.remote_url:
                raise HTTPException(status_code=400, detail="Remote URL is required for remote mode")

            omni_run_mode = "remote"
            remote_base = config.remote_url.rstrip("/")
            await broadcast_omni_log(f"[OMNI] Connecting to remote vLLM-Omni instance: {remote_base}")

            # Probe health endpoint
            import aiohttp

            try:
                headers = get_omni_auth_headers()
                timeout = aiohttp.ClientTimeout(total=10)
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    # Try /health first
                    health_ok = False
                    try:
                        async with session.get(f"{remote_base}/health", headers=headers) as resp:
                            if resp.status == 200:
                                health_ok = True
                                await broadcast_omni_log("[OMNI] ✅ Remote health check passed")
                            else:
                                await broadcast_omni_log(f"[OMNI] ⚠️  Health endpoint returned {resp.status}")
                    except Exception as he:
                        await broadcast_omni_log(f"[OMNI] ⚠️  Health endpoint not available: {he}")

                    # Try /v1/models to confirm it's a vLLM instance and get details
                    discovered_models_list = []
                    try:
                        async with session.get(f"{remote_base}/v1/models", headers=headers) as resp:
                            if resp.status == 200:
                                models_data = await resp.json()
                                models_raw = models_data.get("data", [])
                                model_ids = [m.get("id", "unknown") for m in models_raw]
                                discovered_models_list = [
                                    {
                                        "id": m.get("id", "unknown"),
                                        "owned_by": m.get("owned_by", ""),
                                        "max_model_len": m.get("max_model_len"),
                                        "root": m.get("root", ""),
                                    }
                                    for m in models_raw
                                ]
                                await broadcast_omni_log(f"[OMNI] ✅ Remote models: {', '.join(model_ids)}")
                                if models_raw and models_raw[0].get("max_model_len"):
                                    await broadcast_omni_log(f"[OMNI] ✅ Max context length: {models_raw[0]['max_model_len']}")
                                if model_ids:
                                    # Auto-set model name if available
                                    config.model = model_ids[0]
                            else:
                                await broadcast_omni_log(f"[OMNI] ⚠️  Models endpoint returned {resp.status}")
                    except Exception as me:
                        await broadcast_omni_log(f"[OMNI] ⚠️  Models endpoint not available: {me}")

                    if not health_ok:
                        await broadcast_omni_log("[OMNI] ⚠️  Proceeding without confirmed health check")

            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot reach remote vLLM-Omni at {remote_base}: {str(e)}",
                )

            omni_running = True
            omni_start_time = datetime.now()

            await broadcast_omni_log(f"[OMNI] ✅ Connected to remote instance at {remote_base}")
            await broadcast_omni_log(f"[OMNI] Model: {config.model}")

            return {
                "status": "started",
                "mode": "remote",
                "model": config.model,
                "message": f"Connected to remote vLLM-Omni at {remote_base}",
                "health": health_ok,
                "models": discovered_models_list,
            }

        # ═══════════════════════════════════════════════════════════════════════
        # Standard subprocess mode for other models
        # ═══════════════════════════════════════════════════════════════════════
        omni_run_mode = config.run_mode

        if config.run_mode == "subprocess":
            # Build command for subprocess mode
            if config.venv_path:
                # Use custom venv
                venv_python = Path(config.venv_path).expanduser() / "bin" / "python"
                cmd = [
                    str(venv_python),
                    "-m",
                    "vllm.entrypoints.openai.api_server",
                    "--model",
                    config.model,
                    "--port",
                    str(config.port),
                    "--omni",
                ]
            else:
                # Use system vllm
                cmd = [
                    "vllm",
                    "serve",
                    config.model,
                    "--port",
                    str(config.port),
                    "--omni",
                ]

            # Add GPU settings
            if config.tensor_parallel_size > 1:
                cmd.extend(["--tensor-parallel-size", str(config.tensor_parallel_size)])
            if config.gpu_memory_utilization != 0.9:
                cmd.extend(["--gpu-memory-utilization", str(config.gpu_memory_utilization)])
            if config.trust_remote_code:
                cmd.append("--trust-remote-code")
            if config.enable_cpu_offload:
                cmd.append("--enable-cpu-offload")
            if not config.enable_torch_compile:
                # Disable torch.compile for faster startup and lower memory usage
                cmd.append("--enforce-eager")

            # Add stage configs for Stable Audio (configures audio output type)
            if "stable-audio" in config.model.lower():
                stage_config_path = Path(__file__).parent / "config" / "stable_audio.yaml"
                if stage_config_path.exists():
                    cmd.extend(["--stage-configs-path", str(stage_config_path)])
                    logger.info(f"Using Stable Audio stage config: {stage_config_path}")

            # Set environment
            env = os.environ.copy()
            if config.gpu_device:
                env["CUDA_VISIBLE_DEVICES"] = config.gpu_device
            if config.hf_token:
                env["HF_TOKEN"] = config.hf_token

            logger.info(f"Starting vLLM-Omni subprocess: {' '.join(cmd)}")

            omni_process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env=env,
            )

            omni_running = True
            omni_start_time = datetime.now()

            # Start log reader task
            asyncio.create_task(read_omni_logs_subprocess())

            return {
                "status": "started",
                "mode": "subprocess",
                "model": config.model,
                "port": config.port,
                "pid": omni_process.pid,
            }

        elif config.run_mode == "container":
            # Container mode - use container_manager
            if not CONTAINER_MODE_AVAILABLE or not container_manager:
                raise HTTPException(
                    status_code=400, detail="Container mode is not available. No container runtime found."
                )

            # Build container config for omni
            container_config = {
                "model": config.model,
                "port": config.port,
                "enable_omni": True,
                "accelerator": config.accelerator,
                "tensor_parallel_size": config.tensor_parallel_size,
                "gpu_memory_utilization": config.gpu_memory_utilization,
                "gpu_device": config.gpu_device,
                "enable_cpu_offload": config.enable_cpu_offload,
                "trust_remote_code": config.trust_remote_code,
                "hf_token": config.hf_token,
            }

            result = await container_manager.start_omni_container(container_config)
            omni_container_id = result["id"]
            omni_running = True
            omni_start_time = datetime.now()

            # Start log reader task for container (with exception handling)
            task = asyncio.create_task(read_omni_logs_container())
            task.add_done_callback(
                lambda t: logger.error(f"Omni log task failed: {t.exception()}") if t.exception() else None
            )

            # Broadcast initial status
            await broadcast_omni_log(f"[OMNI] Container started: {omni_container_id[:12]}")
            await broadcast_omni_log(f"[OMNI] Model: {config.model}")
            await broadcast_omni_log(f"[OMNI] Port: {config.port}")
            await broadcast_omni_log(f"[OMNI] Waiting for model to load...")

            return {
                "status": "started",
                "mode": "container",
                "model": config.model,
                "port": config.port,
                "container_id": omni_container_id[:12] if omni_container_id else None,
            }

    except Exception as e:
        logger.error(f"Failed to start vLLM-Omni: {e}")
        omni_running = False
        omni_config = None
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/omni/stop")
async def stop_omni_server():
    """Stop vLLM-Omni server"""
    global omni_process, omni_container_id, omni_running, omni_config, omni_start_time, omni_run_mode
    global omni_inprocess_model

    if not omni_running:
        raise HTTPException(status_code=400, detail="vLLM-Omni server is not running")

    try:
        stopped_something = False

        # Handle in-process mode (Stable Audio)
        if omni_run_mode == "inprocess" and omni_inprocess_model:
            logger.info("Stopping in-process Stable Audio model...")
            await broadcast_omni_log("[OMNI] Stopping Stable Audio model...")

            # Unload model and release GPU memory
            def unload_model():
                global omni_inprocess_model
                try:
                    import torch

                    del omni_inprocess_model
                    omni_inprocess_model = None

                    # Clear CUDA cache to release GPU memory
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                        torch.cuda.synchronize()

                    import gc

                    gc.collect()
                    logger.info("Stable Audio model unloaded, GPU memory released")
                except Exception as e:
                    logger.error(f"Error unloading model: {e}")

            import concurrent.futures

            loop = asyncio.get_event_loop()
            with concurrent.futures.ThreadPoolExecutor() as pool:
                await loop.run_in_executor(pool, unload_model)

            omni_inprocess_model = None
            stopped_something = True
            await broadcast_omni_log("[OMNI] ✅ Stable Audio model stopped, GPU memory released")

        elif omni_run_mode == "subprocess" and omni_process:
            # Terminate subprocess
            omni_process.terminate()
            try:
                await asyncio.wait_for(omni_process.wait(), timeout=10)
            except asyncio.TimeoutError:
                omni_process.kill()
                await omni_process.wait()

            omni_process = None
            stopped_something = True
            logger.info("vLLM-Omni subprocess stopped")

        elif omni_run_mode == "container" and omni_container_id:
            # Stop container
            if container_manager:
                await container_manager.stop_omni_container(omni_container_id)
            omni_container_id = None
            stopped_something = True
            logger.info("vLLM-Omni container stopped")

        elif omni_run_mode == "remote":
            # Remote mode: just disconnect (nothing to kill)
            await broadcast_omni_log("[OMNI] Disconnecting from remote vLLM-Omni instance...")
            stopped_something = True
            logger.info("Disconnected from remote vLLM-Omni instance")
            await broadcast_omni_log("[OMNI] ✅ Disconnected from remote instance")

        # Handle inconsistent state - omni_running is True but nothing to stop
        if not stopped_something:
            logger.warning(
                f"vLLM-Omni state inconsistent: running={omni_running}, mode={omni_run_mode}, "
                f"process={omni_process is not None}, container={omni_container_id is not None}"
            )
            logger.info("Resetting vLLM-Omni state")

        # Always reset state
        omni_running = False
        omni_config = None
        omni_start_time = None
        omni_run_mode = None
        omni_process = None
        omni_container_id = None

        return {"status": "stopped"}

    except Exception as e:
        # Reset state even on error to allow recovery
        omni_running = False
        omni_config = None
        omni_start_time = None
        omni_run_mode = None
        omni_process = None
        omni_container_id = None

        error_msg = str(e) if str(e) else "Unknown error during stop"
        logger.error(f"Failed to stop vLLM-Omni: {error_msg}")
        raise HTTPException(status_code=500, detail=error_msg)


@app.post("/api/omni/generate")
async def generate_omni_image(request: ImageGenerationRequest):
    """Generate image using vLLM-Omni"""
    global omni_running, omni_config

    if not omni_running:
        raise HTTPException(status_code=400, detail="vLLM-Omni server is not running")

    if not omni_config:
        raise HTTPException(status_code=400, detail="vLLM-Omni configuration not available")

    # Validate image-to-image is only used with image-edit models
    if request.input_image and not is_image_edit_model(omni_config.model):
        return ImageGenerationResponse(
            success=False,
            error=f"Image-to-image not supported by {omni_config.model}. "
            f"Use an image-edit model like Qwen/Qwen-Image-Edit instead.",
        )

    try:
        import time

        start_time = time.time()

        # Build request to vLLM-Omni's /v1/chat/completions endpoint
        omni_url = f"{get_omni_base_url()}/v1/chat/completions"
        omni_headers = get_omni_auth_headers()

        # Build message content - supports both text-to-image and image-to-image
        if request.input_image:
            # Image-to-image: multimodal message with image + text
            # Handle both data URL format and raw base64
            if request.input_image.startswith("data:"):
                image_url = request.input_image
            else:
                image_url = f"data:image/png;base64,{request.input_image}"

            message_content = [
                {"type": "image_url", "image_url": {"url": image_url}},
                {"type": "text", "text": request.prompt},
            ]
            logger.info("Using image-to-image mode with uploaded image")
        else:
            # Text-to-image: simple text message
            message_content = request.prompt

        payload = {
            "model": omni_config.model,
            "messages": [{"role": "user", "content": message_content}],
            "extra_body": {
                "height": request.height,
                "width": request.width,
                "num_inference_steps": request.num_inference_steps,
                "guidance_scale": request.guidance_scale,
            },
        }

        if request.seed is not None:
            payload["extra_body"]["seed"] = request.seed

        if request.negative_prompt:
            payload["extra_body"]["negative_prompt"] = request.negative_prompt

        logger.info(f"Sending image generation request to vLLM-Omni: {omni_url}")

        async with aiohttp.ClientSession() as session:
            async with session.post(omni_url, json=payload, headers=omni_headers, timeout=aiohttp.ClientTimeout(total=300)) as response:
                if response.status != 200:
                    error_text = await response.text()
                    logger.error(f"vLLM-Omni error: {error_text}")
                    return ImageGenerationResponse(success=False, error=error_text)

                result = await response.json()

                # Extract base64 image from response
                # vLLM-Omni returns: choices[0].message.content[0].image_url.url (data:image/png;base64,...)
                try:
                    content = result["choices"][0]["message"]["content"]
                    if isinstance(content, list) and len(content) > 0:
                        image_url = content[0].get("image_url", {}).get("url", "")
                        if image_url.startswith("data:image"):
                            # Extract base64 part after the comma
                            base64_data = image_url.split(",", 1)[1] if "," in image_url else image_url
                        else:
                            base64_data = image_url
                    else:
                        # Fallback for different response formats
                        base64_data = str(content)

                    generation_time = time.time() - start_time
                    logger.info(f"Image generated in {generation_time:.2f}s")

                    return ImageGenerationResponse(
                        success=True, image_base64=base64_data, generation_time=generation_time
                    )

                except (KeyError, IndexError, TypeError) as e:
                    logger.error(f"Failed to parse vLLM-Omni response: {e}")
                    logger.error(f"Response: {result}")
                    return ImageGenerationResponse(success=False, error=f"Failed to parse response: {e}")

    except aiohttp.ClientError as e:
        logger.error(f"Connection error to vLLM-Omni: {e}")
        return ImageGenerationResponse(success=False, error=f"Connection error: {e}")
    except Exception as e:
        logger.error(f"Image generation error: {e}")
        return ImageGenerationResponse(success=False, error=str(e))


@app.post("/api/omni/generate-video")
async def generate_video(request: VideoGenerationRequest) -> VideoGenerationResponse:
    """Generate a video using vLLM-Omni (Text-to-Video models like Wan2.2)"""
    global omni_running, omni_config

    if not omni_running:
        return VideoGenerationResponse(success=False, error="vLLM-Omni server is not running")

    if not omni_config:
        return VideoGenerationResponse(success=False, error="vLLM-Omni configuration not available")

    # Build request to vLLM-Omni's /v1/chat/completions endpoint
    # Video models typically use a chat completions format with specific parameters
    omni_url = f"{get_omni_base_url()}/v1/chat/completions"
    omni_headers = get_omni_auth_headers()

    # Calculate number of frames based on duration and fps
    num_frames = request.duration * request.fps

    # Build the message with video generation parameters
    messages = [
        {
            "role": "user",
            "content": request.prompt,
        }
    ]

    payload = {
        "model": omni_config.model,
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": 1024,
        "extra_body": {
            "modality": "video",
            "num_frames": num_frames,
            "height": request.height,
            "width": request.width,
            "fps": request.fps,
            "num_inference_steps": request.num_inference_steps,
            "guidance_scale": request.guidance_scale,
        },
    }

    if request.negative_prompt:
        payload["extra_body"]["negative_prompt"] = request.negative_prompt

    if request.seed is not None:
        payload["extra_body"]["seed"] = request.seed

    if request.negative_prompt:
        payload["extra_body"]["negative_prompt"] = request.negative_prompt

    logger.info(f"Generating video with vLLM-Omni: {request.prompt[:50]}... ({request.duration}s @ {request.fps}fps)")

    start_time = time.time()

    try:
        timeout = aiohttp.ClientTimeout(total=600)  # 10 minutes for video generation
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(omni_url, json=payload, headers=omni_headers) as response:
                if response.status != 200:
                    error_text = await response.text()
                    logger.error(f"vLLM-Omni error: {error_text}")
                    return VideoGenerationResponse(success=False, error=f"vLLM-Omni error: {error_text}")

                result = await response.json()

                try:
                    # Parse the response to extract video data
                    choices = result.get("choices", [])
                    if not choices:
                        return VideoGenerationResponse(success=False, error="No choices in response")

                    message = choices[0].get("message", {})
                    content = message.get("content", [])

                    # Handle different response formats
                    base64_data = None
                    if isinstance(content, list):
                        for item in content:
                            if item.get("type") == "video":
                                video_url = item.get("video_url", {}).get("url", "")
                                if video_url.startswith("data:video"):
                                    base64_data = video_url.split(",", 1)[1] if "," in video_url else video_url
                                else:
                                    base64_data = video_url
                                break
                    elif isinstance(content, str):
                        # Some models return base64 directly
                        base64_data = content

                    if not base64_data:
                        return VideoGenerationResponse(success=False, error="No video data in response")

                    generation_time = time.time() - start_time
                    logger.info(f"Video generated in {generation_time:.2f}s")

                    return VideoGenerationResponse(
                        success=True,
                        video_base64=base64_data,
                        duration=request.duration,
                        generation_time=generation_time,
                    )

                except (KeyError, IndexError, TypeError) as e:
                    logger.error(f"Failed to parse vLLM-Omni video response: {e}")
                    logger.error(f"Response: {result}")
                    return VideoGenerationResponse(success=False, error=f"Failed to parse response: {e}")

    except aiohttp.ClientError as e:
        logger.error(f"Connection error to vLLM-Omni: {e}")
        return VideoGenerationResponse(success=False, error=f"Connection error: {e}")
    except Exception as e:
        logger.error(f"Video generation error: {e}")
        return VideoGenerationResponse(success=False, error=str(e))


@app.post("/api/omni/generate-tts")
async def generate_tts(request: TTSGenerationRequest) -> AudioGenerationResponse:
    """Generate speech using TTS models (Qwen3-TTS).

    Uses /v1/audio/speech endpoint for text-to-speech synthesis.

    Reference:
    - Qwen3-TTS: https://docs.vllm.ai/projects/vllm-omni/en/latest/user_guide/examples/online_serving/qwen3_tts/
    """
    global omni_running, omni_config

    if not omni_running:
        return AudioGenerationResponse(success=False, error="vLLM-Omni server is not running")

    if not omni_config:
        return AudioGenerationResponse(success=False, error="vLLM-Omni configuration not available")

    omni_url = f"{get_omni_base_url()}/v1/audio/speech"
    omni_headers = get_omni_auth_headers()

    payload = {
        "model": omni_config.model,
        "input": request.text,
        "voice": request.voice or "Vivian",
        "response_format": "wav",
    }

    if request.speed and request.speed != 1.0:
        payload["speed"] = request.speed

    if request.instructions:
        payload["instructions"] = request.instructions

    logger.info(f"Generating TTS audio: {request.text[:50]}... (voice: {request.voice}, speed: {request.speed}x)")

    start_time = time.time()

    try:
        timeout = aiohttp.ClientTimeout(total=300)  # 5 minutes for audio generation
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(omni_url, json=payload, headers=omni_headers) as response:
                content_type = response.headers.get("Content-Type", "")

                if response.status != 200:
                    error_text = await response.text()
                    logger.error(f"vLLM-Omni TTS error: {error_text}")
                    return AudioGenerationResponse(success=False, error=f"vLLM-Omni error: {error_text}")

                # TTS returns raw audio bytes
                if "audio" in content_type or "application/octet-stream" in content_type:
                    audio_bytes = await response.read()

                    if not audio_bytes:
                        return AudioGenerationResponse(success=False, error="No audio data returned")

                    import base64

                    base64_data = base64.b64encode(audio_bytes).decode("utf-8")

                    # Determine format from content type
                    if "wav" in content_type:
                        audio_format = "audio/wav"
                    elif "mp3" in content_type or "mpeg" in content_type:
                        audio_format = "audio/mpeg"
                    elif "flac" in content_type:
                        audio_format = "audio/flac"
                    else:
                        audio_format = "audio/wav"

                    generation_time = time.time() - start_time
                    logger.info(f"TTS audio generated in {generation_time:.2f}s")

                    return AudioGenerationResponse(
                        success=True,
                        audio_base64=base64_data,
                        audio_format=audio_format,
                        duration=None,
                        generation_time=generation_time,
                    )
                else:
                    # Unexpected response format
                    error_text = await response.text()
                    return AudioGenerationResponse(
                        success=False,
                        error=f"Unexpected response format: {content_type}. Response: {error_text[:500]}",
                    )

    except asyncio.TimeoutError:
        return AudioGenerationResponse(success=False, error="TTS generation timed out (5 minute limit)")
    except Exception as e:
        logger.error(f"TTS generation error: {e}")
        return AudioGenerationResponse(success=False, error=str(e))


@app.post("/api/omni/generate-audio")
async def generate_audio(request: AudioGenerationRequest) -> AudioGenerationResponse:
    """Generate audio (music/SFX) using Stable Audio models.

    Uses in-process mode for Stable Audio (bypasses broken vLLM-Omni serving),
    or falls back to API mode for other models.

    Reference:
    - Stable Audio: Uses offline inference via vllm_omni.entrypoints.omni.Omni
    """
    global omni_running, omni_config, omni_run_mode, omni_inprocess_model

    if not omni_running:
        return AudioGenerationResponse(success=False, error="vLLM-Omni server is not running")

    if not omni_config:
        return AudioGenerationResponse(success=False, error="vLLM-Omni configuration not available")

    # ═══════════════════════════════════════════════════════════════════════════
    # In-process mode for Stable Audio (bypasses broken vLLM-Omni serving layer)
    # ═══════════════════════════════════════════════════════════════════════════
    if omni_run_mode == "inprocess" and omni_inprocess_model is not None:
        duration_str = f"{request.audio_duration}s" if request.audio_duration else "10s"
        steps_str = f"{request.num_inference_steps} steps" if request.num_inference_steps else "100 steps"
        guidance_str = f"guidance: {request.guidance_scale}" if request.guidance_scale else "guidance: 7.0"
        logger.info(
            f"Generating Stable Audio (in-process): {request.text[:50]}... ({duration_str}, {steps_str}, {guidance_str})"
        )

        start_time = time.time()

        try:
            # Run generation in thread pool to avoid blocking
            def generate_audio_inprocess():
                import torch
                import base64
                import io
                import numpy as np
                from vllm_omni.inputs.data import OmniDiffusionSamplingParams

                # Set up generator for reproducibility
                generator = None
                if request.seed is not None:
                    generator = torch.Generator(device="cuda").manual_seed(request.seed)

                # Build sampling params (matches vLLM-Omni example API)
                # Ref: https://github.com/vllm-project/vllm-omni/blob/main/examples/offline_inference/text_to_audio/text_to_audio.py
                sampling_params = OmniDiffusionSamplingParams(
                    generator=generator,
                    guidance_scale=request.guidance_scale if request.guidance_scale else 7.0,
                    num_inference_steps=request.num_inference_steps if request.num_inference_steps else 100,
                    num_outputs_per_prompt=1,
                    extra_args={
                        "audio_start_in_s": 0.0,
                        "audio_end_in_s": request.audio_duration if request.audio_duration else 10.0,
                    },
                )

                # Generate audio using offline inference
                # API: omni.generate({"prompt": ..., "negative_prompt": ...}, OmniDiffusionSamplingParams)
                outputs = omni_inprocess_model.generate(
                    {
                        "prompt": request.text,
                        "negative_prompt": request.negative_prompt or "Low quality.",
                    },
                    sampling_params,
                )

                # Extract audio from output
                # Output structure: outputs[0].request_output[0].multimodal_output["audio"]
                output = outputs[0]
                request_output = output.request_output[0]
                audio_tensor = request_output.multimodal_output.get("audio")

                if audio_tensor is None:
                    raise ValueError("No audio output found in response")

                # Convert to numpy: [samples, channels] for soundfile
                if isinstance(audio_tensor, torch.Tensor):
                    audio_tensor = audio_tensor.cpu().float().numpy()

                # Handle different output shapes
                if audio_tensor.ndim == 3:
                    # [batch, channels, samples] -> take first batch
                    audio_np = audio_tensor[0].T  # [samples, channels]
                elif audio_tensor.ndim == 2:
                    # [channels, samples]
                    audio_np = audio_tensor.T  # [samples, channels]
                else:
                    # [samples] - mono
                    audio_np = audio_tensor

                # Normalize audio
                max_val = np.max(np.abs(audio_np))
                if max_val > 0:
                    audio_np = audio_np / max_val

                # Convert to int16 for WAV
                audio_int16 = (audio_np * 32767).astype(np.int16)

                # Write to WAV bytes using soundfile or scipy
                try:
                    import soundfile as sf

                    wav_buffer = io.BytesIO()
                    sf.write(wav_buffer, audio_int16, 44100, format="WAV")
                    wav_bytes = wav_buffer.getvalue()
                except ImportError:
                    # Fallback to scipy
                    from scipy.io import wavfile

                    wav_buffer = io.BytesIO()
                    wavfile.write(wav_buffer, 44100, audio_int16)
                    wav_bytes = wav_buffer.getvalue()

                # Encode to base64
                audio_base64 = base64.b64encode(wav_bytes).decode("utf-8")
                return audio_base64

            import concurrent.futures

            loop = asyncio.get_event_loop()
            with concurrent.futures.ThreadPoolExecutor() as pool:
                audio_base64 = await loop.run_in_executor(pool, generate_audio_inprocess)

            generation_time = time.time() - start_time
            logger.info(f"Stable Audio generated in {generation_time:.2f}s (in-process mode)")

            return AudioGenerationResponse(
                success=True,
                audio_base64=audio_base64,
                audio_format="audio/wav",
                duration=request.audio_duration,
                generation_time=generation_time,
            )

        except Exception as e:
            logger.error(f"In-process audio generation error: {e}")
            import traceback

            traceback.print_exc()
            return AudioGenerationResponse(success=False, error=f"Audio generation failed: {str(e)}")

    # ═══════════════════════════════════════════════════════════════════════════
    # API mode for other models (fallback, has bug for Stable Audio)
    # ═══════════════════════════════════════════════════════════════════════════
    omni_url = f"{get_omni_base_url()}/v1/images/generations"
    omni_headers = get_omni_auth_headers()

    # Build payload for images/generations endpoint
    payload = {
        "model": omni_config.model,
        "prompt": request.text,
        "n": 1,
        "response_format": "b64_json",  # Request base64 encoded output
    }

    # Add Stable Audio specific parameters at top level
    if request.audio_duration is not None:
        payload["audio_end_in_s"] = request.audio_duration
        payload["audio_start_in_s"] = 0.0

    if request.num_inference_steps is not None:
        payload["num_inference_steps"] = request.num_inference_steps

    if request.guidance_scale is not None:
        payload["guidance_scale"] = request.guidance_scale

    if request.negative_prompt:
        payload["negative_prompt"] = request.negative_prompt

    if request.seed is not None:
        payload["seed"] = request.seed

    duration_str = f"{request.audio_duration}s" if request.audio_duration else "default"
    steps_str = f"{request.num_inference_steps} steps" if request.num_inference_steps else "default"
    logger.info(f"Generating Stable Audio: {request.text[:50]}... ({duration_str}, {steps_str})")

    start_time = time.time()

    try:
        timeout = aiohttp.ClientTimeout(total=300)  # 5 minutes for audio generation
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(omni_url, json=payload, headers=omni_headers) as response:
                content_type = response.headers.get("Content-Type", "")

                if response.status != 200:
                    error_text = await response.text()
                    logger.error(f"vLLM-Omni audio error: {error_text}")
                    return AudioGenerationResponse(success=False, error=f"vLLM-Omni error: {error_text}")

                # Diffusion returns JSON with audio data
                result = await response.json()

                # Debug: Log the full response structure to understand the format
                logger.info(f"Audio response keys: {list(result.keys())}")
                logger.info(f"Full audio response: {str(result)[:1000]}...")

                # Check for error in response
                if "error" in result:
                    error_msg = result["error"]
                    if isinstance(error_msg, dict):
                        error_msg = error_msg.get("message", str(error_msg))
                    return AudioGenerationResponse(success=False, error=f"Generation failed: {error_msg}")

                base64_data = None
                audio_format = "audio/wav"

                # ═══════════════════════════════════════════════════════════════
                # Format 1: /v1/images/generations response format
                # { "data": [{"url": "data:audio/wav;base64,..."} or {"b64_json": "..."}] }
                # ═══════════════════════════════════════════════════════════════
                if "data" in result and result["data"]:
                    logger.info(f"Found 'data' array with {len(result['data'])} items")
                    for item in result["data"]:
                        # Check for b64_json format
                        if "b64_json" in item:
                            base64_data = item["b64_json"]
                            logger.info("Extracted audio from b64_json field")
                            break
                        # Check for url format (data URL)
                        if "url" in item:
                            url = item["url"]
                            logger.info(f"Found URL field, prefix: {url[:50] if url else 'empty'}...")
                            if url.startswith("data:audio"):
                                try:
                                    mime_part = url.split(";")[0]
                                    audio_format = mime_part.replace("data:", "")
                                except (IndexError, ValueError):
                                    audio_format = "audio/wav"
                                base64_data = url.split(",", 1)[1] if "," in url else url
                                logger.info(f"Extracted audio from URL, format: {audio_format}")
                                break
                            elif url.startswith("data:"):
                                # Some other data format, try to extract
                                base64_data = url.split(",", 1)[1] if "," in url else url
                                logger.info("Extracted data from URL (non-audio mime type)")
                                break

                # ═══════════════════════════════════════════════════════════════
                # Format 2: /v1/chat/completions response format (fallback)
                # ═══════════════════════════════════════════════════════════════
                if not base64_data and "choices" in result and result["choices"]:
                    msg = result["choices"][0].get("message", {})
                    logger.info(f"Message keys: {list(msg.keys())}")

                    # Check message.audio (Qwen3-Omni format)
                    audio_obj = msg.get("audio")
                    if audio_obj:
                        if isinstance(audio_obj, dict):
                            base64_data = audio_obj.get("data")
                            audio_format = f"audio/{audio_obj.get('format', 'wav')}"
                        elif isinstance(audio_obj, str):
                            base64_data = audio_obj

                    # Check content list
                    if not base64_data:
                        content = msg.get("content", [])
                        logger.info(
                            f"Content type: {type(content)}, content: {str(content)[:200] if content else 'empty'}..."
                        )
                        if isinstance(content, list):
                            for item in content:
                                if isinstance(item, dict):
                                    item_type = item.get("type", "")
                                    logger.info(f"Content item type: {item_type}")
                                    # Check for audio_url type (used when final_output_type: audio)
                                    if item_type == "audio_url":
                                        audio_url = item.get("audio_url", {}).get("url", "")
                                        logger.info(f"Found audio_url: {audio_url[:50] if audio_url else 'empty'}...")
                                        if audio_url:
                                            if audio_url.startswith("data:audio"):
                                                try:
                                                    mime_part = audio_url.split(";")[0]
                                                    audio_format = mime_part.replace("data:", "")
                                                except (IndexError, ValueError):
                                                    audio_format = "audio/wav"
                                                base64_data = (
                                                    audio_url.split(",", 1)[1] if "," in audio_url else audio_url
                                                )
                                                logger.info(f"Extracted audio from audio_url, format: {audio_format}")
                                                break
                                            else:
                                                # Raw base64 data
                                                base64_data = (
                                                    audio_url.split(",", 1)[1] if "," in audio_url else audio_url
                                                )
                                                logger.info("Extracted raw base64 from audio_url")
                                                break
                                    # Check for image_url type (fallback for diffusion models)
                                    elif item_type == "image_url":
                                        image_url = item.get("image_url", {}).get("url", "")
                                        if image_url:
                                            if image_url.startswith("data:audio"):
                                                try:
                                                    mime_part = image_url.split(";")[0]
                                                    audio_format = mime_part.replace("data:", "")
                                                except (IndexError, ValueError):
                                                    audio_format = "audio/wav"
                                                base64_data = (
                                                    image_url.split(",", 1)[1] if "," in image_url else image_url
                                                )
                                                break
                                            elif not image_url.startswith("data:image"):
                                                base64_data = (
                                                    image_url.split(",", 1)[1] if "," in image_url else image_url
                                                )
                                                break
                        elif isinstance(content, str) and content:
                            base64_data = content

                # Also check for audio at the response level (some models return it there)
                if not base64_data and "audio" in result:
                    audio_data = result["audio"]
                    if isinstance(audio_data, dict):
                        base64_data = audio_data.get("data") or audio_data.get("url")
                        audio_format = f"audio/{audio_data.get('format', 'wav')}"
                    elif isinstance(audio_data, str):
                        base64_data = audio_data

                if not base64_data:
                    # Log the full response for debugging
                    logger.error(f"No audio data found. Full response: {result}")
                    return AudioGenerationResponse(
                        success=False,
                        error="No audio data in response - generation may have failed (check server logs for OOM errors)",
                    )

                generation_time = time.time() - start_time
                logger.info(f"Diffusion audio generated in {generation_time:.2f}s, format: {audio_format}")

                return AudioGenerationResponse(
                    success=True,
                    audio_base64=base64_data,
                    audio_format=audio_format,
                    duration=None,
                    generation_time=generation_time,
                )

    except aiohttp.ClientError as e:
        logger.error(f"Connection error to vLLM-Omni: {e}")
        return AudioGenerationResponse(success=False, error=f"Connection error: {e}")
    except Exception as e:
        logger.error(f"Audio generation error: {e}")
        return AudioGenerationResponse(success=False, error=str(e))


@app.post("/api/omni/chat")
async def omni_chat(request: OmniChatRequest):
    """Chat with vLLM-Omni models (Qwen-Omni) with streaming support"""
    global omni_running, omni_config

    if not omni_running:
        raise HTTPException(status_code=400, detail="vLLM-Omni server is not running")

    if not omni_config:
        raise HTTPException(status_code=400, detail="vLLM-Omni configuration not available")

    # Build request to vLLM-Omni's /v1/chat/completions endpoint
    omni_url = f"{get_omni_base_url()}/v1/chat/completions"
    omni_headers = get_omni_auth_headers()

    payload = {
        "model": omni_config.model,
        "messages": request.messages,
        "temperature": request.temperature,
        "max_tokens": request.max_tokens,
        "stream": request.stream,
    }

    logger.info(f"Sending chat request to vLLM-Omni: {omni_url}")

    async def generate_stream():
        """Generator for streaming responses"""
        full_text = ""
        audio_data = None

        try:
            timeout = aiohttp.ClientTimeout(total=120)  # 2 minutes for audio generation
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(omni_url, json=payload, headers=omni_headers) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        logger.error(f"vLLM-Omni error: {error_text}")
                        yield f"data: {json.dumps({'error': error_text})}\n\n"
                        return

                    if request.stream:
                        # Stream the response
                        async for line in response.content:
                            line_text = line.decode("utf-8", errors="replace").strip()
                            if not line_text:
                                continue

                            if line_text.startswith("data: "):
                                data = line_text[6:]
                                if data == "[DONE]":
                                    yield "data: [DONE]\n\n"
                                    continue

                                try:
                                    parsed = json.loads(data)
                                    choices = parsed.get("choices", [])
                                    if choices:
                                        delta = choices[0].get("delta", {})
                                        content = delta.get("content", "")

                                        # Handle text content
                                        if isinstance(content, str) and content:
                                            full_text += content
                                            yield f"data: {json.dumps({'text': content})}\n\n"

                                        # Handle multimodal content (list format)
                                        elif isinstance(content, list):
                                            for item in content:
                                                if item.get("type") == "text":
                                                    text = item.get("text", "")
                                                    full_text += text
                                                    yield f"data: {json.dumps({'text': text})}\n\n"
                                                elif item.get("type") == "audio":
                                                    audio_url = item.get("audio_url", {}).get("url", "")
                                                    if audio_url.startswith("data:audio"):
                                                        # Extract audio format from data URL
                                                        audio_format = "audio/wav"
                                                        try:
                                                            mime_part = audio_url.split(";")[0]
                                                            audio_format = mime_part.replace("data:", "")
                                                        except (IndexError, ValueError):
                                                            pass
                                                        audio_data = (
                                                            audio_url.split(",", 1)[1]
                                                            if "," in audio_url
                                                            else audio_url
                                                        )
                                                        yield f"data: {json.dumps({'audio': audio_data, 'audio_format': audio_format})}\n\n"

                                except json.JSONDecodeError:
                                    continue

                    else:
                        # Non-streaming response
                        result = await response.json()
                        try:
                            choices = result.get("choices", [])
                            if choices:
                                message = choices[0].get("message", {})
                                content = message.get("content", "")

                                # Handle string content
                                if isinstance(content, str):
                                    yield f"data: {json.dumps({'text': content})}\n\n"

                                # Handle multimodal content (list format)
                                elif isinstance(content, list):
                                    for item in content:
                                        if item.get("type") == "text":
                                            yield f"data: {json.dumps({'text': item.get('text', '')})}\n\n"
                                        elif item.get("type") == "audio":
                                            audio_url = item.get("audio_url", {}).get("url", "")
                                            if audio_url.startswith("data:audio"):
                                                # Extract audio format from data URL
                                                audio_format = "audio/wav"
                                                try:
                                                    mime_part = audio_url.split(";")[0]
                                                    audio_format = mime_part.replace("data:", "")
                                                except (IndexError, ValueError):
                                                    pass
                                                audio_data = (
                                                    audio_url.split(",", 1)[1] if "," in audio_url else audio_url
                                                )
                                                yield f"data: {json.dumps({'audio': audio_data, 'audio_format': audio_format})}\n\n"

                        except (KeyError, IndexError, TypeError) as e:
                            logger.error(f"Failed to parse vLLM-Omni response: {e}")
                            yield f"data: {json.dumps({'error': str(e)})}\n\n"

                        yield "data: [DONE]\n\n"

        except aiohttp.ClientError as e:
            logger.error(f"Connection error to vLLM-Omni: {e}")
            yield f"data: {json.dumps({'error': f'Connection error: {e}'})}\n\n"
        except Exception as e:
            logger.error(f"Omni chat error: {e}")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@app.get("/api/omni/models")
async def list_omni_models():
    """List all vLLM-Omni supported models by category (from official docs)

    Source: https://docs.vllm.ai/projects/vllm-omni/en/latest/models/supported_models/
    """
    return {
        "image": [
            # Qwen Image Models (Text-to-Image) - require >48GB VRAM
            {
                "id": "Qwen/Qwen-Image",
                "name": "Qwen Image",
                "vram": ">48GB",
                "description": "High quality text-to-image",
                "supports_image_edit": False,
            },
            {
                "id": "Qwen/Qwen-Image-2512",
                "name": "Qwen Image 2512",
                "vram": ">48GB",
                "description": "Higher resolution (2512px)",
                "supports_image_edit": False,
            },
            # Qwen Image-Edit Models (Image-to-Image) - require >48GB VRAM
            {
                "id": "Qwen/Qwen-Image-Edit",
                "name": "Qwen Image Edit",
                "vram": ">48GB",
                "description": "Image editing (supports image-to-image)",
                "supports_image_edit": True,
            },
            {
                "id": "Qwen/Qwen-Image-Edit-2509",
                "name": "Qwen Image Edit 2509",
                "vram": ">48GB",
                "description": "Advanced image editing (supports image-to-image)",
                "supports_image_edit": True,
            },
            {
                "id": "Qwen/Qwen-Image-Edit-2511",
                "name": "Qwen Image Edit 2511",
                "vram": ">48GB",
                "description": "Latest image editing (supports image-to-image)",
                "supports_image_edit": True,
            },
            {
                "id": "Qwen/Qwen-Image-Layered",
                "name": "Qwen Image Layered",
                "vram": ">48GB",
                "description": "Layered image generation",
                "supports_image_edit": False,
            },
            # Z-Image (Text-to-Image)
            {
                "id": "Tongyi-MAI/Z-Image-Turbo",
                "name": "Z-Image Turbo",
                "vram": "16GB",
                "description": "Fast text-to-image generation",
                "supports_image_edit": False,
            },
            # BAGEL
            {
                "id": "ByteDance-Seed/BAGEL-7B-MoT",
                "name": "BAGEL 7B MoT",
                "vram": "16GB",
                "description": "ByteDance DiT model",
                "supports_image_edit": False,
            },
            # Ovis
            {
                "id": "OvisAI/Ovis-Image",
                "name": "Ovis Image",
                "vram": "16GB",
                "description": "Ovis image generation",
                "supports_image_edit": False,
            },
            # LongCat
            {
                "id": "meituan-longcat/LongCat-Image",
                "name": "LongCat Image",
                "vram": "16GB",
                "description": "Meituan image generation",
                "supports_image_edit": False,
            },
            {
                "id": "meituan-longcat/LongCat-Image-Edit",
                "name": "LongCat Image Edit",
                "vram": "16GB",
                "description": "Meituan image editing (supports image-to-image)",
                "supports_image_edit": True,
            },
            # Stable Diffusion (Text-to-Image)
            {
                "id": "stabilityai/stable-diffusion-3.5-medium",
                "name": "Stable Diffusion 3.5",
                "vram": "16GB",
                "description": "SD3.5 medium model",
                "supports_image_edit": False,
            },
            # FLUX (Text-to-Image)
            {
                "id": "black-forest-labs/FLUX.2-klein-4B",
                "name": "FLUX.2 Klein 4B",
                "vram": "12GB",
                "description": "Compact FLUX model",
                "supports_image_edit": False,
            },
            {
                "id": "black-forest-labs/FLUX.2-klein-9B",
                "name": "FLUX.2 Klein 9B",
                "vram": "24GB",
                "description": "Larger FLUX model",
                "supports_image_edit": False,
            },
        ],
        "omni": [
            # Qwen Omni Models (Text + Audio I/O)
            # Note: Qwen2.5-Omni models removed - they require 2+ GPUs for multi-stage pipeline
            {
                "id": "Qwen/Qwen3-Omni-30B-A3B-Instruct",
                "name": "Qwen3 Omni 30B",
                "vram": "48GB",
                "description": "Advanced omni model (MoE)",
            },
        ],
        "video": [
            # Wan Video Models
            {
                "id": "Wan-AI/Wan2.2-T2V-A14B-Diffusers",
                "name": "Wan2.2 T2V 14B",
                "vram": "24GB+",
                "description": "Text-to-video generation",
            },
            {
                "id": "Wan-AI/Wan2.2-TI2V-5B-Diffusers",
                "name": "Wan2.2 TI2V 5B",
                "vram": "16GB",
                "description": "Text+Image to video",
            },
            {
                "id": "Wan-AI/Wan2.2-I2V-A14B-Diffusers",
                "name": "Wan2.2 I2V 14B",
                "vram": "24GB+",
                "description": "Image-to-video generation",
            },
        ],
        "tts": [
            # Qwen TTS Models (uses /v1/audio/speech)
            {
                "id": "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
                "name": "Qwen3 TTS Base",
                "vram": "12GB",
                "description": "Lightweight TTS model (0.6B params)",
            },
            {
                "id": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
                "name": "Qwen3 TTS Voice Design",
                "vram": "24GB+",
                "description": "TTS with voice design capabilities (1.7B params)",
            },
            {
                "id": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
                "name": "Qwen3 TTS Custom Voice",
                "vram": "24GB+",
                "description": "TTS with custom voice cloning (1.7B params)",
            },
        ],
        "audio": [
            # Stable Audio (diffusion-based, uses /v1/chat/completions)
            {
                "id": "stabilityai/stable-audio-open-1.0",
                "name": "Stable Audio Open",
                "vram": "32GB+",
                "description": "Text-to-audio/music generation (diffusion model, up to 47s)",
            },
        ],
    }


async def read_omni_logs_subprocess():
    """Read logs from vLLM-Omni subprocess"""
    global omni_process, omni_running

    if not omni_process or not omni_process.stdout:
        return

    try:
        while omni_running and omni_process:
            line = await omni_process.stdout.readline()
            if not line:
                break

            log_line = line.decode("utf-8", errors="replace").strip()
            if log_line:
                # Broadcast to omni websocket connections with [OMNI] prefix
                await broadcast_omni_log(f"[OMNI] {log_line}")

    except Exception as e:
        logger.error(f"Error reading omni logs: {e}")

    # Check if process ended
    if omni_process and omni_process.returncode is not None:
        omni_running = False
        await broadcast_omni_log(f"[OMNI] Process ended with code {omni_process.returncode}")


# ============================================
# Claude Code Integration
# ============================================

# Global state for ttyd process
ttyd_process: Optional[subprocess.Popen] = None
ttyd_port: Optional[int] = None


def is_ttyd_installed() -> bool:
    """Check if ttyd is installed on the system"""
    return shutil.which("ttyd") is not None


def find_available_port(start_port: int = 7681, max_attempts: int = 100) -> int:
    """Find an available port starting from start_port"""
    import socket

    for port in range(start_port, start_port + max_attempts):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", port))
                return port
        except OSError:
            continue
    raise RuntimeError(f"Could not find available port in range {start_port}-{start_port + max_attempts}")


def start_ttyd_for_claude(env_config: Dict[str, str], model_name: str) -> Dict[str, Any]:
    """Start ttyd process running Claude Code with the given environment

    Args:
        env_config: Environment variables for Claude Code (ANTHROPIC_BASE_URL, etc.)
        model_name: The model name to pass to Claude Code

    Returns:
        Dict with success status, port, and websocket URL
    """
    global ttyd_process, ttyd_port

    # Check if ttyd is already running
    if ttyd_process is not None and ttyd_process.poll() is None:
        return {"success": True, "already_running": True, "port": ttyd_port, "ws_url": f"ws://127.0.0.1:{ttyd_port}/ws"}

    # Check if ttyd is installed
    if not is_ttyd_installed():
        return {
            "success": False,
            "error": "ttyd is not installed",
            "install_instructions": {
                "macos": "brew install ttyd",
                "ubuntu": "sudo apt install ttyd",
                "fedora": "sudo dnf install ttyd",
            },
        }

    # Find Claude command
    claude_path = find_claude_command()
    if not claude_path:
        return {"success": False, "error": "Claude Code CLI is not installed"}

    # Find available port
    try:
        port = find_available_port()
    except RuntimeError as e:
        return {"success": False, "error": str(e)}

    # Build environment
    env = os.environ.copy()
    env.update(env_config)

    # Ensure HOME is set so Claude Code can find ~/.claude.json config
    if "HOME" not in env:
        env["HOME"] = os.path.expanduser("~")

    # Set terminal environment variables for proper TUI rendering
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"
    env["FORCE_COLOR"] = "1"
    env["NO_COLOR"] = ""
    env["CLICOLOR"] = "1"
    env["CLICOLOR_FORCE"] = "1"
    env["FORCE_TTY"] = "1"
    env["NODE_NO_READLINE"] = "0"
    env["LANG"] = env.get("LANG", "en_US.UTF-8")
    env["LC_ALL"] = env.get("LC_ALL", "en_US.UTF-8")

    # Build ttyd command
    # ttyd --port PORT --interface 127.0.0.1 --once claude --model MODEL
    ttyd_cmd = [
        "ttyd",
        "--port",
        str(port),
        "--interface",
        "127.0.0.1",
        "--once",  # Exit after client disconnects
        "--writable",  # Allow input
        claude_path,
        "--model",
        model_name,
    ]

    logger.info(f"Starting ttyd: {' '.join(ttyd_cmd)}")
    logger.info(f"Environment: ANTHROPIC_BASE_URL={env.get('ANTHROPIC_BASE_URL')}, MODEL={model_name}")

    try:
        # Capture stderr to see any ttyd errors
        ttyd_process = subprocess.Popen(ttyd_cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        ttyd_port = port

        # Give ttyd a moment to start
        import time

        time.sleep(1.5)  # Increased wait time for ttyd to bind port

        # Check if process is still running
        if ttyd_process.poll() is not None:
            exit_code = ttyd_process.returncode
            # Try to get stderr output
            _, stderr_output = ttyd_process.communicate(timeout=1)
            stderr_str = stderr_output.decode("utf-8", errors="replace") if stderr_output else "No error output"
            logger.error(f"ttyd exited with code {exit_code}: {stderr_str}")
            ttyd_process = None
            ttyd_port = None
            return {"success": False, "error": f"ttyd exited with code {exit_code}: {stderr_str}"}

        # Verify ttyd is actually listening on the port
        import socket

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            result = sock.connect_ex(("127.0.0.1", port))
            if result != 0:
                logger.error(f"ttyd started but not listening on port {port}")
                # Kill the process since it's not working
                ttyd_process.terminate()
                ttyd_process = None
                ttyd_port = None
                return {"success": False, "error": f"ttyd started but failed to listen on port {port}"}
        finally:
            sock.close()

        logger.info(f"ttyd started on port {port}, pid: {ttyd_process.pid}")
        logger.info(f"ttyd WebSocket URL: ws://127.0.0.1:{port}/ws")

        return {
            "success": True,
            "already_running": False,
            "port": port,
            "ws_url": f"ws://127.0.0.1:{port}/ws",
            "pid": ttyd_process.pid,
        }

    except Exception as e:
        logger.error(f"Failed to start ttyd: {e}")
        import traceback

        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


def stop_ttyd() -> Dict[str, Any]:
    """Stop the ttyd process if running"""
    global ttyd_process, ttyd_port

    if ttyd_process is None:
        return {"success": True, "message": "ttyd was not running"}

    if ttyd_process.poll() is not None:
        # Process already exited
        ttyd_process = None
        ttyd_port = None
        return {"success": True, "message": "ttyd had already exited"}

    try:
        pid = ttyd_process.pid
        ttyd_process.terminate()

        # Wait for graceful shutdown
        try:
            ttyd_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            ttyd_process.kill()
            ttyd_process.wait()

        ttyd_process = None
        ttyd_port = None

        logger.info(f"ttyd stopped (pid: {pid})")

        return {"success": True, "message": f"ttyd stopped (pid: {pid})"}

    except Exception as e:
        logger.error(f"Error stopping ttyd: {e}")
        return {"success": False, "error": str(e)}


def find_claude_command() -> Optional[str]:
    """Find the claude command on the system"""
    # Check common locations for claude CLI
    possible_commands = ["claude", "claude-code"]

    for cmd in possible_commands:
        result = shutil.which(cmd)
        if result:
            return result

    # Check npm global bin
    try:
        npm_bin = subprocess.run(["npm", "bin", "-g"], capture_output=True, text=True)
        if npm_bin.returncode == 0:
            npm_path = Path(npm_bin.stdout.strip()) / "claude"
            if npm_path.exists():
                return str(npm_path)
    except Exception:
        pass

    return None


def is_claude_installed() -> Dict[str, Any]:
    """Check if Claude Code CLI is installed"""
    claude_path = find_claude_command()

    if claude_path:
        # Try to get version
        try:
            result = subprocess.run([claude_path, "--version"], capture_output=True, text=True, timeout=5)
            version = result.stdout.strip() if result.returncode == 0 else "unknown"
            return {"installed": True, "path": claude_path, "version": version}
        except Exception as e:
            return {"installed": True, "path": claude_path, "version": "unknown", "error": str(e)}

    return {"installed": False, "path": None, "version": None}


@app.get("/api/claude-code/status")
async def claude_code_status():
    """Get Claude Code availability and installation status"""
    claude_info = is_claude_installed()
    ttyd_available = is_ttyd_installed()

    return {
        "ttyd_available": ttyd_available,
        "claude_installed": claude_info["installed"],
        "claude_path": claude_info.get("path"),
        "claude_version": claude_info.get("version"),
        "vllm_running": vllm_running,
        "ttyd_running": ttyd_process is not None and ttyd_process.poll() is None,
        "ttyd_port": ttyd_port,
        "message": "Ready" if (ttyd_available and claude_info["installed"] and vllm_running) else "Not ready",
    }


@app.get("/api/claude-code/config")
async def claude_code_config():
    """Get the environment configuration for Claude Code to connect to vLLM"""
    global current_config, current_model_identifier, current_served_model_name, vllm_running

    if not vllm_running or not current_config:
        return {
            "available": False,
            "message": "vLLM server is not running. Start the server first.",
            "env": {},
            "needs_served_model_name": False,
        }

    # Get the model name to use
    # Use served_model_name if set (required for Claude Code as model names with '/' don't work)
    is_remote = current_run_mode == "remote"
    if current_served_model_name:
        model_name = current_served_model_name
    else:
        model_name = current_model_identifier or current_config.model
        # Check if model name contains '/' which won't work with Claude Code.
        # Skip this check in remote mode -- the remote server's model name is
        # what it is; the user can't change --served-model-name on a server
        # they don't control, and vLLM will route the request correctly.
        if "/" in model_name and not is_remote:
            return {
                "available": False,
                "message": "Model name contains '/'. Set a 'Served Model Name' in vLLM server configuration for Claude Code to work.",
                "env": {},
                "needs_served_model_name": True,
                "current_model": model_name,
            }

    # Check if tool calling is enabled (required for Claude Code)
    # In remote mode, we can't know, so assume it's available
    tool_calling_enabled = True if is_remote else current_config.enable_tool_calling

    # Build the base URL for vLLM's Anthropic-compatible endpoint
    # Per vLLM docs: ANTHROPIC_BASE_URL should be the server root (e.g. http://localhost:8000)
    # Claude Code/Anthropic SDK appends /v1/messages to this base URL
    # Use get_vllm_base_url() to support local, container, and remote modes
    base_url = get_vllm_base_url()
    # Claude Code runs as an external CLI process; 0.0.0.0 (bind-all) isn't a
    # valid connect address on every platform, so normalise to localhost.
    base_url = base_url.replace("://0.0.0.0:", "://localhost:")

    # Use remote API key if configured, otherwise use a placeholder
    # (vLLM doesn't require auth by default for local mode)
    api_key = "vllm-playground"
    auth_headers = get_vllm_auth_headers()
    if auth_headers and "Authorization" in auth_headers:
        # Extract Bearer token value
        api_key = auth_headers["Authorization"].replace("Bearer ", "")

    env_config = {
        "ANTHROPIC_BASE_URL": base_url,
        "ANTHROPIC_API_KEY": api_key,
        # ANTHROPIC_AUTH_TOKEN is required by Claude Code to skip the login
        # prompt.  It can be any non-empty value when using a custom endpoint.
        # See: https://docs.vllm.ai/en/latest/serving/integrations/claude_code/
        "ANTHROPIC_AUTH_TOKEN": api_key,
        "ANTHROPIC_DEFAULT_OPUS_MODEL": model_name,
        "ANTHROPIC_DEFAULT_SONNET_MODEL": model_name,
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": model_name,
    }

    return {
        "available": True,
        "message": "Connected to remote vLLM instance — ready for Claude Code"
        if is_remote
        else "vLLM server is running and ready for Claude Code",
        "tool_calling_enabled": tool_calling_enabled,
        "tool_calling_warning": None
        if tool_calling_enabled
        else "Tool calling is not enabled. Claude Code may not work properly.",
        "env": env_config,
        "model": model_name,
        "base_url": base_url,
    }


@app.post("/api/claude-code/install")
async def claude_code_install(method: str = "npm"):
    """Install Claude Code CLI"""
    try:
        if method == "npm":
            # Install via npm globally
            process = await asyncio.create_subprocess_exec(
                "npm",
                "install",
                "-g",
                "@anthropic-ai/claude-code",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await process.communicate()

            if process.returncode == 0:
                return {
                    "success": True,
                    "message": "Claude Code installed successfully via npm",
                    "output": stdout.decode(),
                }
            else:
                return {"success": False, "message": "Failed to install Claude Code", "error": stderr.decode()}
        else:
            return {"success": False, "message": f"Unknown installation method: {method}", "supported_methods": ["npm"]}
    except FileNotFoundError:
        return {
            "success": False,
            "message": "npm not found. Please install Node.js first.",
            "error": "npm command not available",
        }
    except Exception as e:
        return {"success": False, "message": f"Installation failed: {str(e)}", "error": str(e)}


@app.post("/api/claude-code/start-terminal")
async def start_claude_terminal():
    """Start ttyd terminal for Claude Code"""
    # Check if ttyd is installed
    if not is_ttyd_installed():
        return {
            "success": False,
            "error": "ttyd is not installed. Please install it first.",
            "install_instructions": {
                "macos": "brew install ttyd",
                "ubuntu": "sudo apt install ttyd",
                "fedora": "sudo dnf install ttyd",
            },
        }

    # Check if Claude Code is installed
    claude_info = is_claude_installed()
    if not claude_info["installed"]:
        return {
            "success": False,
            "error": "Claude Code CLI is not installed. Install with: npm install -g @anthropic-ai/claude-code",
        }

    # Get vLLM config for Claude Code environment
    config_response = await claude_code_config()
    if not config_response["available"]:
        return {
            "success": False,
            "error": config_response["message"],
            "needs_served_model_name": config_response.get("needs_served_model_name", False),
        }

    # Start ttyd
    result = start_ttyd_for_claude(env_config=config_response["env"], model_name=config_response["model"])

    # Return our proxy WebSocket URL instead of direct ttyd URL
    # This allows cloud deployment to work (browser connects to our server, we proxy to ttyd)
    if result.get("success"):
        result["ws_url"] = "/ws/ttyd"  # Use our proxy endpoint

    return result


@app.websocket("/ws/ttyd")
async def websocket_ttyd_proxy(websocket: WebSocket):
    """WebSocket proxy to ttyd - allows cloud deployment to work"""
    await websocket.accept()

    global ttyd_port

    if ttyd_port is None:
        await websocket.close(code=1011, reason="ttyd not running")
        return

    # Connect to ttyd's WebSocket using websockets library
    import websockets

    ttyd_ws_url = f"ws://127.0.0.1:{ttyd_port}/ws"

    try:
        # Connect with tty subprotocol
        async with websockets.connect(
            ttyd_ws_url,
            subprotocols=["tty"],
            ping_interval=None,  # Disable ping to avoid interference
            close_timeout=1,
        ) as ttyd_ws:
            logger.info(f"Connected to ttyd WebSocket at {ttyd_ws_url}, protocol: {ttyd_ws.subprotocol}")

            async def forward_to_client():
                """Forward messages from ttyd to browser"""
                try:
                    async for message in ttyd_ws:
                        if isinstance(message, bytes):
                            logger.info(f"ttyd->client: {len(message)} bytes")
                            await websocket.send_bytes(message)
                        else:
                            logger.info(f"ttyd->client: {len(message)} chars text")
                            await websocket.send_text(message)
                except websockets.exceptions.ConnectionClosed as e:
                    logger.info(f"ttyd connection closed: {e}")
                except Exception as e:
                    logger.info(f"ttyd->client forward ended: {e}")

            async def forward_to_ttyd():
                """Forward messages from browser to ttyd"""
                try:
                    while True:
                        data = await websocket.receive()
                        if data["type"] == "websocket.receive":
                            if "bytes" in data:
                                logger.info(f"client->ttyd: {len(data['bytes'])} bytes")
                                await ttyd_ws.send(data["bytes"])
                            elif "text" in data:
                                logger.info(f"client->ttyd: {len(data['text'])} chars text")
                                await ttyd_ws.send(data["text"])
                        elif data["type"] == "websocket.disconnect":
                            logger.info("Client disconnected from proxy")
                            break
                except websockets.exceptions.ConnectionClosed as e:
                    logger.info(f"ttyd connection closed while forwarding: {e}")
                except Exception as e:
                    logger.info(f"client->ttyd forward ended: {e}")

            # Run both forwarding tasks concurrently
            await asyncio.gather(forward_to_client(), forward_to_ttyd(), return_exceptions=True)

    except Exception as e:
        logger.error(f"ttyd proxy error: {e}")
        import traceback

        logger.error(traceback.format_exc())
        try:
            await websocket.close(code=1011, reason=str(e))
        except:
            pass


@app.post("/api/claude-code/stop-terminal")
async def stop_claude_terminal():
    """Stop the ttyd terminal"""
    return stop_ttyd()


@app.get("/api/claude-code/terminal-status")
async def claude_terminal_status():
    """Get the status of the ttyd terminal"""
    is_running = ttyd_process is not None and ttyd_process.poll() is None

    return {
        "running": is_running,
        "port": ttyd_port if is_running else None,
        "ws_url": f"ws://127.0.0.1:{ttyd_port}/ws" if is_running else None,
    }


def main(host: str = None, port: int = None, reload: bool = False):
    """Main entry point"""
    logger.info("Starting vLLM Playground...")

    # Get host/port from arguments, environment, or use defaults
    webui_host = host or os.environ.get("WEBUI_HOST", "0.0.0.0")
    webui_port = port or int(os.environ.get("WEBUI_PORT", "7860"))

    uvicorn.run(app, host=webui_host, port=webui_port, reload=reload, log_level="info")


if __name__ == "__main__":
    main()
