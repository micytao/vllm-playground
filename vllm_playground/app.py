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
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
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
        if 'get_mcp_manager' in globals() and get_mcp_manager is not None:
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
    # Run mode: subprocess or container
    run_mode: Literal["subprocess", "container"] = "subprocess"
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


def detect_tool_call_parser(model_name: str) -> Optional[str]:
    """
    Auto-detect the appropriate tool call parser based on model name.
    
    Returns the parser name or None if no suitable parser is detected.
    In that case, tool calling will be disabled.
    """
    model_lower = model_name.lower()
    
    # Llama 3.x models (Meta)
    if any(x in model_lower for x in ['llama-3', 'llama3', 'llama_3']):
        return 'llama3_json'
    
    # Mistral models
    if 'mistral' in model_lower:
        return 'mistral'
    
    # NousResearch Hermes models
    if 'hermes' in model_lower:
        return 'hermes'
    
    # InternLM models
    if 'internlm' in model_lower:
        return 'internlm'
    
    # IBM Granite models
    if 'granite' in model_lower:
        return 'granite-20b-fc'
    
    # Qwen models
    if 'qwen' in model_lower:
        return 'hermes'  # Qwen typically uses Hermes-style tool calling
    
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
    for name_field in ['name', 'function', 'function_name', 'func', 'tool']:
        if name_field in tool_call_data and isinstance(tool_call_data[name_field], str):
            name = tool_call_data[name_field]
            break
    
    # Try to extract arguments from various possible fields
    arguments = None
    for args_field in ['arguments', 'parameters', 'params', 'args', 'input']:
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
        "function": {
            "name": name,
            "arguments": json.dumps(arguments) if arguments else "{}"
        }
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
    """Chat message structure with tool calling support"""
    role: str  # "system", "user", "assistant", or "tool"
    content: Optional[str] = None  # Can be None when assistant makes tool calls
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
    if 'llama-3' in model_lower and ('llama-3.1' in model_lower or 'llama-3.2' in model_lower or 'llama-3-' in model_lower):
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
    elif 'llama-2' in model_lower or 'llama2' in model_lower:
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
    elif 'mistral' in model_lower or 'mixtral' in model_lower:
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
    elif 'gemma' in model_lower:
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
    elif 'tinyllama' in model_lower or 'tiny-llama' in model_lower:
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
    elif 'codellama' in model_lower or 'code-llama' in model_lower:
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
    if 'llama-3' in model_lower and ('llama-3.1' in model_lower or 'llama-3.2' in model_lower or 'llama-3-' in model_lower):
        return ["<|eot_id|>", "<|end_of_text|>"]
    
    # Llama 2 models - use special tokens
    elif 'llama-2' in model_lower or 'llama2' in model_lower:
        return ["</s>", "[INST]"]
    
    # Mistral/Mixtral models - use special tokens
    elif 'mistral' in model_lower or 'mixtral' in model_lower:
        return ["</s>", "[INST]"]
    
    # Gemma models - use special tokens
    elif 'gemma' in model_lower:
        return ["<end_of_turn>", "<start_of_turn>"]
    
    # TinyLlama - use ChatML special tokens
    elif 'tinyllama' in model_lower or 'tiny-llama' in model_lower:
        return ["</s>", "<|user|>", "<|system|>", "<|assistant|>"]
    
    # CodeLlama - use Llama 2 tokens
    elif 'codellama' in model_lower or 'code-llama' in model_lower:
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
    result = {
        'valid': False,
        'error': None,
        'info': {}
    }
    
    try:
        # Expand ~ to home directory and resolve to absolute path
        path = Path(model_path).expanduser().resolve()
        
        # Check if path exists
        if not path.exists():
            result['error'] = f"Path does not exist: {model_path} (expanded to: {path})"
            return result
        
        # Check if it's a directory
        if not path.is_dir():
            result['error'] = f"Path is not a directory: {model_path}"
            return result
        
        # Check for required files
        required_files = {
            'config.json': False,
            'tokenizer_config.json': False,
        }
        
        # Check for model weight files (at least one should exist)
        weight_patterns = [
            '*.safetensors',
            '*.bin',
            'pytorch_model*.bin',
            'model*.safetensors',
        ]
        
        has_weights = False
        for pattern in weight_patterns:
            if list(path.glob(pattern)):
                has_weights = True
                result['info']['weight_format'] = pattern
                break
        
        # Check required files
        for req_file in required_files.keys():
            file_path = path / req_file
            if file_path.exists():
                required_files[req_file] = True
        
        # Validation results
        missing_files = [f for f, exists in required_files.items() if not exists]
        
        if missing_files:
            result['error'] = f"Missing required files: {', '.join(missing_files)}"
            return result
        
        if not has_weights:
            result['error'] = "No model weight files found (*.safetensors or *.bin)"
            return result
        
        # Try to read model config for additional info
        try:
            import json
            config_path = path / 'config.json'
            with open(config_path, 'r') as f:
                config = json.load(f)
                result['info']['model_type'] = config.get('model_type', 'unknown')
                result['info']['architectures'] = config.get('architectures', [])
                # Try to get model name from config
                if '_name_or_path' in config:
                    result['info']['_name_or_path'] = config['_name_or_path']
        except Exception as e:
            logger.warning(f"Could not read config.json: {e}")
        
        # Calculate directory size
        total_size = sum(f.stat().st_size for f in path.rglob('*') if f.is_file())
        result['info']['size_mb'] = round(total_size / (1024 * 1024), 2)
        result['info']['path'] = str(path.resolve())
        
        # Extract and add the display name
        result['info']['model_name'] = extract_model_name_from_path(str(path.resolve()), result['info'])
        
        result['valid'] = True
        return result
        
    except Exception as e:
        result['error'] = f"Error validating path: {str(e)}"
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
    if '_name_or_path' in info:
        name_or_path = info['_name_or_path']
        # If it's a HF model path like "TinyLlama/TinyLlama-1.1B-Chat-v1.0", use that
        if '/' in name_or_path and not name_or_path.startswith('/'):
            return name_or_path
    
    # Check if this is a HuggingFace cache directory
    # Structure: .../hub/models--Org--ModelName/snapshots/<hash>/...
    path_parts = path.parts
    
    for i, part in enumerate(path_parts):
        if part.startswith('models--'):
            # Found HF cache structure
            # Extract model name from "models--Org--ModelName"
            model_cache_name = part.replace('models--', '', 1)
            # Replace -- with /
            model_name = model_cache_name.replace('--', '/')
            logger.info(f"Extracted model name from HF cache: {model_name}")
            return model_name
    
    # If not HF cache, check for common compressed model naming patterns
    # e.g., "compressed_TinyLlama_w8a8_20240101_120000"
    dir_name = path.name
    
    if dir_name.startswith('compressed_'):
        # Try to extract original model name
        # Remove 'compressed_' prefix and any suffix after the last underscore
        cleaned = dir_name.replace('compressed_', '', 1)
        # If it has timestamp pattern at end, remove it
        import re
        # Remove patterns like _w8a8_20240101_120000 or _w8a8
        cleaned = re.sub(r'_[wW]\d+[aA]\d+(_\d{8}_\d{6})?$', '', cleaned)
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
async def get_status() -> ServerStatus:
    """Get current server status"""
    global vllm_running, current_config, server_start_time, current_run_mode, container_id, vllm_process
    
    # Check status based on run mode
    running = False
    
    if current_run_mode == "container":
        # Check container status
        if container_manager is not None:
            status = await container_manager.get_container_status()
            running = status.get('running', False)
        else:
            running = False
    elif current_run_mode == "subprocess":
        # Check subprocess status
        if vllm_process is not None:
            running = vllm_process.returncode is None
        else:
            running = False
    else:
        # If run mode is not set (e.g., after restart), check if container exists
        # This handles the case where Web UI restarts but vLLM pod is still running
        if CONTAINER_MODE_AVAILABLE and container_manager:
            status = await container_manager.get_container_status()
            if status.get('running', False):
                running = True
                current_run_mode = "container"  # Reconnect to existing container
                # Restore minimal config so chat can work
                if current_config is None:
                    # Create a minimal config based on service defaults
                    current_config = VLLMConfig(
                        model="unknown",  # Can't retrieve from pod
                        host="vllm-service",  # Kubernetes service name
                        port=8000,
                        run_mode="container"
                    )
                logger.info("Reconnected to existing vLLM container after restart")
    
    vllm_running = running  # Update global state
    
    uptime = None
    if running and server_start_time:
        elapsed = datetime.now() - server_start_time
        hours, remainder = divmod(int(elapsed.total_seconds()), 3600)
        minutes, seconds = divmod(remainder, 60)
        uptime = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    
    return ServerStatus(
        running=running,
        uptime=uptime,
        config=current_config
    )


@app.get("/api/debug/connection")
async def debug_connection():
    """Debug endpoint to show connection configuration"""
    global current_config, current_run_mode
    
    is_kubernetes = os.path.exists('/var/run/secrets/kubernetes.io/serviceaccount/token')
    
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
        if current_run_mode == "container" and is_kubernetes and container_manager:
            service_name = getattr(container_manager, 'SERVICE_NAME', 'vllm-service')
            namespace = getattr(container_manager, 'namespace', os.getenv('KUBERNETES_NAMESPACE', 'default'))
            url = f"http://{service_name}.{namespace}.svc.cluster.local:{current_config.port}/v1/chat/completions"
            debug_info["url_would_use"] = url
            debug_info["connection_mode"] = "kubernetes_service"
        else:
            # Use localhost for container mode since 0.0.0.0 is a bind address, not a valid destination
            if current_run_mode == "container":
                url = f"http://localhost:{current_config.port}/v1/chat/completions"
            else:
                url = f"http://{current_config.host}:{current_config.port}/v1/chat/completions"
            debug_info["url_would_use"] = url
            debug_info["connection_mode"] = "localhost"
    
    if is_kubernetes and container_manager and hasattr(container_manager, 'namespace'):
        debug_info["kubernetes"] = {
            "service_name": getattr(container_manager, 'SERVICE_NAME', 'N/A'),
            "namespace": container_manager.namespace,
        }
    
    return debug_info


@app.get("/api/debug/test-vllm-connection")
async def test_vllm_connection():
    """Test if we can reach the vLLM service"""
    global current_config, current_run_mode
    
    if not current_config:
        return {"error": "No server configuration available"}
    
    is_kubernetes = os.path.exists('/var/run/secrets/kubernetes.io/serviceaccount/token')
    
    # Determine URL to use
    if current_run_mode == "container" and is_kubernetes and container_manager:
        service_name = getattr(container_manager, 'SERVICE_NAME', 'vllm-service')
        namespace = getattr(container_manager, 'namespace', os.getenv('KUBERNETES_NAMESPACE', 'default'))
        base_url = f"http://{service_name}.{namespace}.svc.cluster.local:{current_config.port}"
    else:
        # Use localhost for container mode since 0.0.0.0 is a bind address, not a valid destination
        if current_run_mode == "container":
            base_url = f"http://localhost:{current_config.port}"
        else:
            base_url = f"http://{current_config.host}:{current_config.port}"
    
    health_url = f"{base_url}/health"
    
    try:
        import aiohttp
        timeout = aiohttp.ClientTimeout(total=5)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(health_url) as response:
                status = response.status
                text = await response.text()
                return {
                    "success": True,
                    "status_code": status,
                    "url_tested": health_url,
                    "response": text[:500]  # Limit response size
                }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "error_type": type(e).__name__,
            "url_tested": health_url
        }


@app.get("/api/features")
async def get_features():
    """Check which optional features are available"""
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
        "guidellm": False,
        "mcp": False,
        "modelscope_installed": False,  # Whether modelscope SDK is installed
        "modelscope_version": None,
        "container_runtime": None,  # Will be 'podman', 'docker', or None
        "container_mode": CONTAINER_MODE_AVAILABLE
    }
    
    # Check vLLM installation (required for subprocess mode)
    try:
        import vllm
        features["vllm_installed"] = True

        # Try to get vLLM version
        vllm_ver = getattr(vllm, '__version__', None)
        if vllm_ver is None:
            try:
                from importlib.metadata import version
                vllm_ver = version('vllm')
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
    
    # Check modelscope SDK (required for ModelScope model source)
    try:
        import modelscope
        features["modelscope_installed"] = True
        modelscope_ver = getattr(modelscope, '__version__', None)
        if not modelscope_ver:
            try:
                from importlib.metadata import version
                modelscope_ver = version('modelscope')
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
    
    return features


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
            "servers": []
        }
    
    manager = get_mcp_manager()
    statuses = manager.get_status()
    
    return {
        "available": True,
        "version": MCP_VERSION,
        "message": "MCP is available",
        "servers": [s.model_dump() for s in statuses]
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
            description=request.description
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
        return {
            "success": True,
            "message": f"Connected to '{name}'",
            "status": status.model_dump()
        }
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
        "error": connection.error
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
    if os.getenv('KUBERNETES_NAMESPACE'):
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
                    nvidia_capacity = node.status.capacity.get('nvidia.com/gpu', '0')
                    if nvidia_capacity and int(nvidia_capacity) > 0:
                        gpu_available = True
                        detection_method = "kubernetes"
                        accelerator = "nvidia"
                        logger.info(f"NVIDIA GPU detected via Kubernetes API: {node.metadata.name} has {nvidia_capacity} GPUs")
                        break
                    
                    # Check for AMD GPUs
                    amd_capacity = node.status.capacity.get('amd.com/gpu', '0')
                    if amd_capacity and int(amd_capacity) > 0:
                        gpu_available = True
                        detection_method = "kubernetes"
                        accelerator = "amd"
                        logger.info(f"AMD GPU detected via Kubernetes API: {node.metadata.name} has {amd_capacity} GPUs")
                        break
                    
                    # Check for Google Cloud TPUs
                    tpu_capacity = node.status.capacity.get('google.com/tpu', '0')
                    if tpu_capacity and int(tpu_capacity) > 0:
                        gpu_available = True
                        detection_method = "kubernetes"
                        accelerator = "tpu"
                        logger.info(f"TPU detected via Kubernetes API: {node.metadata.name} has {tpu_capacity} TPUs")
                        break
                
                # Also check node labels for GPU indicators
                if node.metadata and node.metadata.labels:
                    labels = node.metadata.labels
                    if any('nvidia' in k.lower() for k in labels.keys()):
                        if node.status and node.status.capacity:
                            gpu_capacity = node.status.capacity.get('nvidia.com/gpu', '0')
                            if gpu_capacity and int(gpu_capacity) > 0:
                                gpu_available = True
                                detection_method = "kubernetes"
                                accelerator = "nvidia"
                                logger.info(f"NVIDIA GPU detected via node labels: {node.metadata.name}")
                                break
                    if any('amd' in k.lower() for k in labels.keys()):
                        if node.status and node.status.capacity:
                            gpu_capacity = node.status.capacity.get('amd.com/gpu', '0')
                            if gpu_capacity and int(gpu_capacity) > 0:
                                gpu_available = True
                                detection_method = "kubernetes"
                                accelerator = "amd"
                                logger.info(f"AMD GPU detected via node labels: {node.metadata.name}")
                                break
                    if any('tpu' in k.lower() or 'cloud.google.com/gke-tpu' in k for k in labels.keys()):
                        if node.status and node.status.capacity:
                            tpu_capacity = node.status.capacity.get('google.com/tpu', '0')
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
    if not gpu_available and not os.getenv('KUBERNETES_NAMESPACE'):
        try:
            result = subprocess.run(
                ['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'],
                capture_output=True,
                text=True,
                timeout=2
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
    if not gpu_available and not os.getenv('KUBERNETES_NAMESPACE'):
        try:
            result = subprocess.run(
                ['amd-smi', 'list'],
                capture_output=True,
                text=True,
                timeout=2
            )
            # amd-smi list returns 0 and shows GPU info if AMD GPUs are present
            if result.returncode == 0 and 'GPU' in result.stdout:
                gpu_available = True
                detection_method = "amd-smi"
                accelerator = "amd"
                # Extract GPU name from output (first line after GPU:)
                lines = result.stdout.strip().split('\n')
                gpu_info = next((l for l in lines if 'BDF' in l or 'GPU' in l), 'AMD GPU')
                logger.info(f"AMD GPU detected via amd-smi: {gpu_info}")
        except FileNotFoundError:
            logger.debug("amd-smi not found - no AMD GPU detected")
        except subprocess.TimeoutExpired:
            logger.warning("amd-smi timeout")
        except Exception as e:
            logger.warning(f"Error checking GPU via amd-smi: {e}")
    
    # Fallback: Try tpu-info for Google Cloud TPUs (local/container environments)
    if not gpu_available and not os.getenv('KUBERNETES_NAMESPACE'):
        try:
            result = subprocess.run(
                ['tpu-info'],
                capture_output=True,
                text=True,
                timeout=5
            )
            # tpu-info returns 0 and shows TPU info if TPUs are present
            if result.returncode == 0 and ('TPU' in result.stdout or 'chip' in result.stdout.lower()):
                gpu_available = True
                detection_method = "tpu-info"
                accelerator = "tpu"
                logger.info(f"TPU detected via tpu-info")
        except FileNotFoundError:
            # Fallback: Check for /dev/accel* devices (TPU device nodes)
            import glob
            accel_devices = glob.glob('/dev/accel*')
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
        "accelerator": accelerator  # "nvidia", "amd", "tpu", or None
    }


def safe_int(value, default=0):
    """Safely convert value to int, handling N/A, [N/A], empty strings, etc."""
    if value is None:
        return default
    # Remove brackets and whitespace
    cleaned = str(value).strip().replace('[', '').replace(']', '')
    # Handle N/A, Not Supported, etc.
    if not cleaned or cleaned.upper() in ('N/A', 'NOT SUPPORTED', 'UNKNOWN', '-'):
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
        with open('/proc/meminfo', 'r') as f:
            meminfo = {}
            for line in f:
                parts = line.split()
                if len(parts) >= 2:
                    key = parts[0].rstrip(':')
                    # Values are in kB
                    value = int(parts[1])
                    meminfo[key] = value
            
            mem_total_kb = meminfo.get('MemTotal', 0)
            mem_available_kb = meminfo.get('MemAvailable', meminfo.get('MemFree', 0))
            mem_used_kb = mem_total_kb - mem_available_kb
            
            # Convert to MB for consistency with nvidia-smi output
            return (
                mem_used_kb // 1024,
                mem_total_kb // 1024,
                mem_available_kb // 1024
            )
    except Exception as e:
        logger.warning(f"Failed to read /proc/meminfo for Jetson memory: {e}")
        return None


def is_jetson_device(gpu_name: str) -> bool:
    """Check if the GPU is a Jetson device based on name."""
    jetson_keywords = ['thor', 'orin', 'xavier', 'nano', 'tx1', 'tx2', 'agx', 'jetson']
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
    thermal_base = '/sys/devices/virtual/thermal'
    preferred_zones = ['tj-thermal', 'gpu-thermal']
    
    try:
        import os
        
        # First, try preferred thermal zones
        for zone_name in preferred_zones:
            for zone_dir in os.listdir(thermal_base):
                if zone_dir.startswith('thermal_zone'):
                    zone_path = os.path.join(thermal_base, zone_dir)
                    type_path = os.path.join(zone_path, 'type')
                    temp_path = os.path.join(zone_path, 'temp')
                    
                    try:
                        with open(type_path, 'r') as f:
                            zone_type = f.read().strip()
                        
                        if zone_type == zone_name:
                            with open(temp_path, 'r') as f:
                                # Temperature is in milli-Celsius
                                temp_mc = int(f.read().strip())
                                temp_c = temp_mc // 1000
                                logger.debug(f"Jetson temperature from {zone_name}: {temp_c}°C")
                                return temp_c
                    except (IOError, ValueError):
                        continue
        
        # Fallback: try any thermal zone with 'gpu' in name
        for zone_dir in os.listdir(thermal_base):
            if zone_dir.startswith('thermal_zone'):
                zone_path = os.path.join(thermal_base, zone_dir)
                type_path = os.path.join(zone_path, 'type')
                temp_path = os.path.join(zone_path, 'temp')
                
                try:
                    with open(type_path, 'r') as f:
                        zone_type = f.read().strip()
                    
                    if 'gpu' in zone_type.lower() or 'tj' in zone_type.lower():
                        with open(temp_path, 'r') as f:
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
        result = subprocess.run([
            'nvidia-smi', 
            '--query-gpu=index,name,memory.used,memory.total,memory.free,utilization.gpu,temperature.gpu',
            '--format=csv,noheader,nounits'
        ], capture_output=True, text=True, timeout=5)
        
        if result.returncode == 0 and result.stdout.strip():
            nvidia_found = True
            accelerator_type = "nvidia"
            lines = result.stdout.strip().split('\n')
            for line in lines:
                parts = [p.strip() for p in line.split(',')]
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
                                logger.info(f"Jetson unified memory: {memory_used}MB used, {memory_total}MB total, {memory_free}MB free")
                        
                        # Jetson temperature from thermal zones (nvidia-smi returns [N/A])
                        if temperature == 0:
                            jetson_temp = get_jetson_temperature()
                            if jetson_temp is not None:
                                temperature = jetson_temp
                                logger.info(f"Jetson temperature from thermal zone: {temperature}°C")
                    
                    gpu_info.append({
                        "index": safe_int(parts[0], 0),
                        "name": gpu_name,
                        "memory_used": memory_used,
                        "memory_total": memory_total,
                        "memory_free": memory_free,
                        "utilization": safe_int(parts[5], 0),
                        "temperature": temperature,
                        "is_jetson": is_jetson,
                        "unified_memory": is_jetson,
                        "accelerator": "nvidia"
                    })
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
            result = subprocess.run(
                ['amd-smi', 'metric', '--json'],
                capture_output=True,
                text=True,
                timeout=5
            )
            
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
                            gpu_name = gpu_data.get('asic', {}).get('name', f'AMD GPU {idx}')
                            if not gpu_name or gpu_name == f'AMD GPU {idx}':
                                gpu_name = gpu_data.get('gpu', f'AMD GPU {idx}')
                            
                            # Memory info (in MB)
                            memory = gpu_data.get('vram', {})
                            if not memory:
                                memory = gpu_data.get('memory', {})
                            memory_total = safe_int(memory.get('total', {}).get('value', 0), 0)
                            memory_used = safe_int(memory.get('used', {}).get('value', 0), 0)
                            memory_free = memory_total - memory_used if memory_total > 0 else 0
                            
                            # Utilization
                            usage = gpu_data.get('usage', {})
                            utilization = safe_int(usage.get('gfx_activity', {}).get('value', 0), 0)
                            if utilization == 0:
                                utilization = safe_int(gpu_data.get('gfx_activity', {}).get('value', 0), 0)
                            
                            # Temperature
                            temp_data = gpu_data.get('temperature', {})
                            temperature = safe_int(temp_data.get('hotspot', {}).get('value', 0), 0)
                            if temperature == 0:
                                temperature = safe_int(temp_data.get('edge', {}).get('value', 0), 0)
                            
                            gpu_info.append({
                                "index": idx,
                                "name": str(gpu_name),
                                "memory_used": memory_used,
                                "memory_total": memory_total,
                                "memory_free": memory_free,
                                "utilization": utilization,
                                "temperature": temperature,
                                "is_jetson": False,
                                "unified_memory": False,
                                "accelerator": "amd"
                            })
                            
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
        "accelerator": accelerator_type
    }


@app.post("/api/start")
async def start_server(config: VLLMConfig):
    """Start the vLLM server in subprocess or container mode"""
    global container_id, vllm_process, vllm_running, current_config, server_start_time, current_model_identifier, current_served_model_name, current_run_mode
    
    # Check if server is already running
    if current_run_mode == "container" and CONTAINER_MODE_AVAILABLE and container_manager:
        status = await container_manager.get_container_status()
        if status.get('running', False):
            raise HTTPException(status_code=400, detail="Server is already running")
    elif current_run_mode == "subprocess":
        if vllm_process is not None and vllm_process.returncode is None:
            raise HTTPException(status_code=400, detail="Server is already running")
    
    # Determine if using local model or HuggingFace Hub
    # Local model path takes precedence
    model_source = None
    model_display_name = None
    
    if config.local_model_path:
        # Using local model - validate with comprehensive validation
        await broadcast_log("[WEBUI] Validating local model path...")
        
        validation_result = validate_local_model_path(config.local_model_path)
        
        if not validation_result['valid']:
            error_msg = validation_result.get('error', 'Invalid local model path')
            await broadcast_log(f"[WEBUI] ERROR: {error_msg}")
            raise HTTPException(status_code=400, detail=error_msg)
        
        # Use resolved absolute path
        info = validation_result['info']
        model_source = info['path']
        
        # Extract meaningful model name
        model_display_name = extract_model_name_from_path(model_source, info)
        
        # Log detailed validation info
        await broadcast_log(f"[WEBUI] ✓ Local model validated successfully")
        await broadcast_log(f"[WEBUI] Model name: {model_display_name}")
        await broadcast_log(f"[WEBUI] Path: {model_source}")
        await broadcast_log(f"[WEBUI] Size: {info.get('size_mb', 'unknown')} MB")
        if info.get('model_type'):
            await broadcast_log(f"[WEBUI] Model type: {info['model_type']}")
        if info.get('weight_format'):
            await broadcast_log(f"[WEBUI] Weight format: {info['weight_format']}")
    else:
        # Using HuggingFace Hub model
        model_source = config.model
        model_display_name = config.model
        
        # Check if gated model requires HF token
        # Meta Llama models (official and RedHatAI) are gated in our supported list
        model_lower = config.model.lower()
        is_gated = 'meta-llama/' in model_lower or 'redhatai/llama' in model_lower
        
        if is_gated and not config.hf_token:
            raise HTTPException(
                status_code=400, 
                detail=f"This model ({config.model}) is gated and requires a HuggingFace token. Please provide your HF token."
            )
        await broadcast_log(f"[WEBUI] Using HuggingFace Hub model: {model_source}")
    
    try:
        # Set run mode
        current_run_mode = config.run_mode
        
        # Validate container mode is available if selected
        if config.run_mode == "container" and (not CONTAINER_MODE_AVAILABLE or not container_manager):
            raise HTTPException(
                status_code=400,
                detail="Container mode is not available. container_manager module not found."
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
                        status_code=400,
                        detail=f"Virtual environment path does not exist: {config.venv_path}"
                    )

                # Verify it's a directory
                if not venv_path.is_dir():
                    raise HTTPException(
                        status_code=400,
                        detail=f"Virtual environment path is not a directory: {config.venv_path}"
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
                        status_code=400,
                        detail=f"Python executable not found in virtual environment: {python_path}"
                    )

                # Verify it's actually a valid Python executable
                try:
                    result = subprocess.run(
                        [str(python_path), "--version"],
                        capture_output=True,
                        text=True,
                        timeout=5
                    )
                    if result.returncode != 0:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Invalid Python executable: {python_path}"
                        )
                    python_version = result.stdout.strip()
                    await broadcast_log(f"[WEBUI] Found Python: {python_version}")
                except subprocess.TimeoutExpired:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Python executable timed out: {python_path}"
                    )
                except Exception as e:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Failed to verify Python executable: {e}"
                    )

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
                        timeout=10
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
                            [str(pip_path), "list", "--format=freeze"],
                            capture_output=True,
                            text=True,
                            timeout=10
                        )
                        if result.returncode == 0:
                            for line in result.stdout.split('\n'):
                                if line.startswith('vllm=='):
                                    vllm_found = True
                                    vllm_version = line.split('==')[1]
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
                            timeout=10
                        )
                        if result.returncode == 0:
                            for line in result.stdout.split('\n'):
                                if 'vllm' in line.lower():
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
                                f"Please ensure vLLM is installed in this environment."
                    )

                # Success - use this Python executable
                python_executable = str(python_path)
                await broadcast_log(f"[WEBUI] ✓ vLLM detected via {detection_method}: v{vllm_version}")
                await broadcast_log(f"[WEBUI] Using Python from: {python_executable}")

            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"Error validating virtual environment: {e}")
                raise HTTPException(
                    status_code=400,
                    detail=f"Error validating virtual environment: {str(e)}"
                )

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
            env['HF_TOKEN'] = config.hf_token
            env['HUGGING_FACE_HUB_TOKEN'] = config.hf_token  # Alternative name
            await broadcast_log("[WEBUI] HuggingFace token configured for gated models")
        elif os.environ.get('HF_TOKEN'):
            await broadcast_log("[WEBUI] Using HF_TOKEN from environment")
        
        # Set GPU device selection for subprocess mode
        if not config.use_cpu and config.gpu_device and config.run_mode == "subprocess":
            env['CUDA_VISIBLE_DEVICES'] = config.gpu_device
            logger.info(f"GPU Device Selection - CUDA_VISIBLE_DEVICES={config.gpu_device}")
            await broadcast_log(f"[WEBUI] GPU Device Selection - CUDA_VISIBLE_DEVICES={config.gpu_device}")
        
        # Set ModelScope environment variables if using ModelScope as model source
        if config.use_modelscope:
            env['VLLM_USE_MODELSCOPE'] = 'True'
            await broadcast_log("[WEBUI] Using ModelScope as model source (modelscope.cn)")
            if config.modelscope_token:
                env['MODELSCOPE_SDK_TOKEN'] = config.modelscope_token
                await broadcast_log("[WEBUI] ModelScope token configured")
            elif os.environ.get('MODELSCOPE_SDK_TOKEN'):
                await broadcast_log("[WEBUI] Using MODELSCOPE_SDK_TOKEN from environment")
        
        if config.use_cpu:
            env['VLLM_CPU_KVCACHE_SPACE'] = str(config.cpu_kvcache_space)
            env['VLLM_CPU_OMP_THREADS_BIND'] = config.cpu_omp_threads_bind
            # Disable problematic CPU optimizations on Apple Silicon
            env['VLLM_CPU_MOE_PREPACK'] = '0'
            env['VLLM_CPU_SGL_KERNEL'] = '0'
            # Force CPU target device
            env['VLLM_TARGET_DEVICE'] = 'cpu'
            # Enable V1 engine (required to be set explicitly in vLLM 0.11.0+)
            env['VLLM_USE_V1'] = '1'
            logger.info(f"CPU Mode - VLLM_CPU_KVCACHE_SPACE={config.cpu_kvcache_space}, VLLM_CPU_OMP_THREADS_BIND={config.cpu_omp_threads_bind}")
            await broadcast_log(f"[WEBUI] CPU Settings - KV Cache: {config.cpu_kvcache_space}GB, Thread Binding: {config.cpu_omp_threads_bind}")
            await broadcast_log(f"[WEBUI] CPU Optimizations disabled for Apple Silicon compatibility")
            await broadcast_log(f"[WEBUI] Using V1 engine for CPU mode")
        elif config.compute_mode == "metal":
            # Metal GPU mode (Apple Silicon)
            env['VLLM_TARGET_DEVICE'] = 'metal'
            env['VLLM_USE_V1'] = '1'
            logger.info("Metal Mode - VLLM_TARGET_DEVICE=metal, VLLM_USE_V1=1")
            await broadcast_log(f"[WEBUI] Metal Settings - Target Device: metal, V1 Engine: enabled")
            await broadcast_log(f"[WEBUI] Using Apple Silicon GPU acceleration")
        else:
            await broadcast_log("[WEBUI] Using GPU mode")
        
        # Build command
        cmd = [
            python_executable,
            "-m", "vllm.entrypoints.openai.api_server",
            "--model", model_source,  # Use model_source (local path or HF model name)
            "--host", config.host,
            "--port", str(config.port),
        ]
        
        # Add served-model-name if specified (required for Claude Code integration)
        # This sets an alias for the model that doesn't contain '/'
        if config.served_model_name:
            cmd.extend(["--served-model-name", config.served_model_name])
            await broadcast_log(f"[WEBUI] Served model name: {config.served_model_name}")
        
        # Add GPU-specific parameters only if not using CPU
        # Note: vLLM auto-detects CPU platform, no --device flag needed
        if not config.use_cpu:
            cmd.extend([
                "--tensor-parallel-size", str(config.tensor_parallel_size),
                "--gpu-memory-utilization", str(config.gpu_memory_utilization),
            ])
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
            with tempfile.NamedTemporaryFile(mode='w', suffix='.jinja', delete=False) as f:
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
                await broadcast_log(f"[WEBUI] Set tool_call_parser explicitly or use a supported model (Llama 3.x, Mistral, etc.)")
        else:
            await broadcast_log(f"[WEBUI] Tool calling disabled")
        
        # Start server based on mode
        if config.run_mode == "container":
            await broadcast_log(f"[WEBUI] Starting vLLM container...")
            
            # Prepare config dict for container manager
            vllm_config_dict = {
                'model': config.model,
                'model_source': model_source,
                'host': config.host,
                'port': config.port,
                'tensor_parallel_size': config.tensor_parallel_size,
                'gpu_memory_utilization': config.gpu_memory_utilization,
                'max_model_len': config.max_model_len,
                'dtype': config.dtype,
                'trust_remote_code': config.trust_remote_code,
                'download_dir': config.download_dir,
                'load_format': config.load_format,
                'disable_log_stats': config.disable_log_stats,
                'enable_prefix_caching': config.enable_prefix_caching,
                'hf_token': config.hf_token,
                'use_cpu': config.use_cpu,
                'cpu_kvcache_space': config.cpu_kvcache_space,
                'cpu_omp_threads_bind': config.cpu_omp_threads_bind,
                'custom_chat_template': config.custom_chat_template,
                'local_model_path': config.local_model_path,
                'enable_tool_calling': config.enable_tool_calling,
                'tool_call_parser': config.tool_call_parser,
                'accelerator': config.accelerator,  # GPU accelerator type (nvidia/amd)
                'served_model_name': config.served_model_name  # Model alias (for Claude Code)
            }
            
            logger.info(f"Container config: enable_tool_calling={config.enable_tool_calling}, tool_call_parser={config.tool_call_parser}")
            
            # Start container
            container_info = await container_manager.start_container(vllm_config_dict)
            
            container_id = container_info['id']
            vllm_running = True
            current_config = config
            server_start_time = datetime.now()
            
            # Store the actual model identifier for use in API calls
            current_model_identifier = model_source
            current_served_model_name = config.served_model_name  # May be None
            
            # Start log reader task
            asyncio.create_task(read_logs_container())
            
            # Show if container was reused or created new
            if container_info.get('reused', False):
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
            
            if readiness.get('ready'):
                await broadcast_log(f"[WEBUI] ✅ vLLM is ready! (took {readiness['elapsed_time']}s)")
                return {
                    "status": "ready",
                    "container_id": container_id[:12],
                    "mode": "container",
                    "ready": True,
                    "startup_time": readiness['elapsed_time']
                }
            else:
                error_msg = readiness.get('error', 'unknown')
                elapsed = readiness.get('elapsed_time', 0)
                
                if error_msg == 'timeout':
                    await broadcast_log(f"[WEBUI] ⚠️ Warning: vLLM did not become ready within {elapsed}s")
                    await broadcast_log(f"[WEBUI] Container is running but may still be initializing...")
                    await broadcast_log(f"[WEBUI] Check the logs above for model download/loading progress")
                    await broadcast_log(f"[WEBUI] You can try sending requests - they may work once initialization completes")
                elif error_msg == 'container_stopped':
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
                    "warning": error_msg
                }
        
        else:  # subprocess mode
            await broadcast_log(f"[WEBUI] Starting vLLM subprocess...")
            await broadcast_log(f"[WEBUI] Command: {' '.join(cmd)}")
            
            # Start subprocess
            vllm_process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env=env
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
    """Stop the vLLM server (container or subprocess)"""
    global container_id, vllm_process, vllm_running, server_start_time, current_model_identifier, current_served_model_name, current_run_mode
    
    # Check if server is running based on mode
    if current_run_mode == "container" and CONTAINER_MODE_AVAILABLE and container_manager:
        status = await container_manager.get_container_status()
        if not status.get('running', False):
            raise HTTPException(status_code=400, detail="Server is not running")
    elif current_run_mode == "subprocess":
        if vllm_process is None or vllm_process.returncode is not None:
            raise HTTPException(status_code=400, detail="Server is not running")
    else:
        raise HTTPException(status_code=400, detail="Server is not running")
    
    try:
        if current_run_mode == "container":
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
                line = await asyncio.wait_for(
                    vllm_process.stdout.readline(),
                    timeout=1.0
                )
                
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
        match = re.search(r'cache usage[:\s]+([\d.]+)\s*%', message, re.IGNORECASE)
        if match:
            cache_usage = float(match.group(1))
            latest_vllm_metrics['kv_cache_usage_perc'] = cache_usage
            metrics_updated = True
            logger.info(f"✓ Captured KV cache usage: {cache_usage}% from: {message[:100]}")
        else:
            logger.debug(f"Failed to parse cache usage from: {message[:100]}")
    
    # Try various patterns for prefix cache hit rate
    # Examples: "Prefix cache hit rate: 36.1%", "hit rate: 36.1%", "cache hit rate: 36.1%"
    if "hit rate" in message.lower() and "%" in message:
        # More flexible pattern
        match = re.search(r'hit rate[:\s]+([\d.]+)\s*%', message, re.IGNORECASE)
        if match:
            hit_rate = float(match.group(1))
            latest_vllm_metrics['prefix_cache_hit_rate'] = hit_rate
            metrics_updated = True
            logger.info(f"✓ Captured prefix cache hit rate: {hit_rate}% from: {message[:100]}")
        else:
            logger.debug(f"Failed to parse hit rate from: {message[:100]}")
    
    # Try to parse avg prompt throughput
    if "prompt throughput" in message.lower():
        match = re.search(r'prompt throughput[:\s]+([\d.]+)', message, re.IGNORECASE)
        if match:
            prompt_throughput = float(match.group(1))
            latest_vllm_metrics['avg_prompt_throughput'] = prompt_throughput
            metrics_updated = True
            logger.info(f"✓ Captured prompt throughput: {prompt_throughput}")
    
    # Try to parse avg generation throughput
    if "generation throughput" in message.lower():
        match = re.search(r'generation throughput[:\s]+([\d.]+)', message, re.IGNORECASE)
        if match:
            generation_throughput = float(match.group(1))
            latest_vllm_metrics['avg_generation_throughput'] = generation_throughput
            metrics_updated = True
            logger.info(f"✓ Captured generation throughput: {generation_throughput}")
    
    # Update timestamp if we captured any metrics
    if metrics_updated:
        metrics_timestamp = datetime.now()
        latest_vllm_metrics['timestamp'] = metrics_timestamp.isoformat()
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
    if current_run_mode == "container" and CONTAINER_MODE_AVAILABLE and container_manager:
        status = await container_manager.get_container_status()
        if not status.get('running', False):
            raise HTTPException(status_code=400, detail="vLLM server is not running")
    elif current_run_mode == "subprocess":
        if vllm_process is None or vllm_process.returncode is not None:
            raise HTTPException(status_code=400, detail="vLLM server is not running")
    else:
        raise HTTPException(status_code=400, detail="vLLM server is not running")
    
    if current_config is None:
        raise HTTPException(status_code=400, detail="Server configuration not available")
    
    try:
        import aiohttp
        
        # Use OpenAI-compatible chat completions endpoint
        # vLLM will automatically handle chat template formatting using the model's tokenizer config
        # In Kubernetes mode, use the service endpoint instead of host:port
        # Check if we're in Kubernetes by looking for service account token
        is_kubernetes = os.path.exists('/var/run/secrets/kubernetes.io/serviceaccount/token')
        
        logger.info(f"=== CHAT ENDPOINT ROUTING DEBUG ===")
        logger.info(f"current_run_mode: {current_run_mode}")
        logger.info(f"is_kubernetes: {is_kubernetes}")
        logger.info(f"CONTAINER_MODE_AVAILABLE: {CONTAINER_MODE_AVAILABLE}")
        
        if current_run_mode == "container" and is_kubernetes:
            # Kubernetes mode - connect to vLLM service
            # Use SERVICE_NAME from container_manager if available
            service_name = getattr(container_manager, 'SERVICE_NAME', 'vllm-service')
            namespace = getattr(container_manager, 'namespace', os.getenv('KUBERNETES_NAMESPACE', 'default'))
            url = f"http://{service_name}.{namespace}.svc.cluster.local:{current_config.port}/v1/chat/completions"
            logger.info(f"✓ Using Kubernetes service URL: {url}")
            logger.info(f"  Service Name: {service_name}")
            logger.info(f"  Namespace: {namespace}")
            logger.info(f"  Port: {current_config.port}")
        else:
            # Subprocess mode or local container mode - connect to localhost
            # Use localhost for container mode since 0.0.0.0 is a bind address, not a valid destination
            if current_run_mode == "container":
                url = f"http://localhost:{current_config.port}/v1/chat/completions"
            else:
                url = f"http://{current_config.host}:{current_config.port}/v1/chat/completions"
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
                msg["tool_calls"] = [
                    {
                        "id": tc.id,
                        "type": tc.type,
                        "function": tc.function
                    }
                    for tc in m.tool_calls
                ]
            
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
                        "parameters": tool.function.parameters or {"type": "object", "properties": {}}
                    }
                }
                for tool in request.tools
            ]
            logger.info(f"🔧 Tools enabled: {[t.function.name for t in request.tools]}")
            
            # Add format guidance to help models generate correct tool call JSON
            # This helps models that use different formats (function vs name, parameters vs arguments)
            tool_format_hint = (
                '\n\nWhen calling a function, respond with JSON in this exact format: '
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
                messages_dict.insert(0, {"role": "system", "content": f"You are a helpful assistant.{tool_format_hint}"})
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
                        logger.warning(f"⚠️ tool_choice 'required' is disabled (can crash server) - using 'auto' instead")
                        payload["tool_choice"] = "auto"
                    else:
                        payload["tool_choice"] = request.tool_choice
                    logger.info(f"🔧 Tool choice: {payload.get('tool_choice', request.tool_choice)}")
                else:
                    # Specific tool choice object
                    payload["tool_choice"] = {
                        "type": request.tool_choice.type,
                        "function": request.tool_choice.function
                    }
                    logger.info(f"🔧 Tool choice: specific function - {request.tool_choice.function}")
        
        # Add parallel_tool_calls if provided
        if request.parallel_tool_calls is not None:
            payload["parallel_tool_calls"] = request.parallel_tool_calls
            logger.info(f"🔧 Parallel tool calls: {request.parallel_tool_calls}")
        
        # Structured Outputs Support (vLLM guided decoding)
        # See: https://docs.vllm.ai/en/latest/features/structured_outputs.html
        if request.response_format:
            # JSON Schema mode (OpenAI-compatible response_format)
            if request.response_format.type == "json_schema" and request.response_format.json_schema:
                payload["response_format"] = {
                    "type": "json_schema",
                    "json_schema": {
                        "name": request.response_format.json_schema.name,
                        "schema": request.response_format.json_schema.schema_
                    }
                }
                if request.response_format.json_schema.strict is not None:
                    payload["response_format"]["json_schema"]["strict"] = request.response_format.json_schema.strict
                logger.info(f"📋 JSON Schema structured output enabled: {request.response_format.json_schema.name}")
            elif request.response_format.type == "json_object":
                payload["response_format"] = {"type": "json_object"}
                logger.info(f"📋 JSON Object mode enabled")
        elif request.structured_outputs:
            # vLLM-specific guided decoding via extra_body
            extra_body = {}
            if request.structured_outputs.choice:
                extra_body["guided_choice"] = request.structured_outputs.choice
                logger.info(f"📋 Guided choice enabled: {request.structured_outputs.choice}")
            elif request.structured_outputs.regex:
                extra_body["guided_regex"] = request.structured_outputs.regex
                logger.info(f"📋 Guided regex enabled: {request.structured_outputs.regex}")
            elif request.structured_outputs.grammar:
                extra_body["guided_grammar"] = request.structured_outputs.grammar
                logger.info(f"📋 Guided grammar enabled")
            
            if extra_body:
                # vLLM accepts these parameters directly in the request body
                payload.update(extra_body)
        
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
        logger.info(f"=== vLLM REQUEST ===")
        logger.info(f"URL: {url}")
        logger.info(f"Payload: {payload}")
        logger.info(f"Messages ({len(messages_dict)}): {messages_dict}")
        logger.info(f"==================")
        
        async def generate_stream():
            """Generator for streaming responses"""
            full_response_text = ""  # Accumulate response for logging
            buffer = ""  # Buffer for incomplete lines
            try:
                # Set reasonable timeout to prevent hanging
                timeout = aiohttp.ClientTimeout(total=300, connect=10, sock_read=30)
                async with aiohttp.ClientSession(timeout=timeout) as session:
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
                                    buffer += chunk.decode('utf-8')
                                    
                                    # Process complete lines from buffer
                                    while '\n' in buffer:
                                        line, buffer = buffer.split('\n', 1)
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
                                                        if 'choices' in data and len(data['choices']) > 0:
                                                            choice = data['choices'][0]
                                                            delta = choice.get('delta', {})
                                                            content = delta.get('content', '')
                                                            finish_reason = choice.get('finish_reason')
                                                            
                                                            if content:
                                                                full_response_text += content
                                                            
                                                            # Log tool calls if present
                                                            if delta.get('tool_calls'):
                                                                logger.info(f"🔧 Streaming tool_calls in delta: {delta['tool_calls']}")
                                                            
                                                            # Log finish reason for debugging
                                                            if finish_reason:
                                                                logger.info(f"🏁 Finish reason: {finish_reason}")
                                                                if finish_reason == 'tool_calls' and not delta.get('tool_calls'):
                                                                    logger.warning(f"⚠️ finish_reason is 'tool_calls' but no tool_calls data in delta!")
                                                                    logger.warning(f"⚠️ Full chunk data: {data}")
                                                except Exception as parse_err:
                                                    logger.debug(f"Failed to parse SSE data: {parse_err}")
                                            # Pass through the SSE formatted data
                                            yield line + '\n'
                            
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
                }
            )
        else:
            # Non-streaming response
            # Set reasonable timeout to prevent hanging
            timeout = aiohttp.ClientTimeout(total=60, connect=10)
            async with aiohttp.ClientSession(timeout=timeout) as session:
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
                    if 'choices' in data and len(data['choices']) > 0:
                        message = data['choices'][0].get('message', {})
                        content = message.get('content', '')
                        tool_calls = message.get('tool_calls', [])
                        
                        if content:
                            logger.info(f"Response text: {content}")
                            logger.info(f"Length: {len(content)} chars")
                        
                        if tool_calls:
                            logger.info(f"🔧 Tool calls detected: {len(tool_calls)}")
                            for tc in tool_calls:
                                func = tc.get('function', {})
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
    valid_name_pattern = re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]*$')
    
    for tool in request.tools:
        tool_result = {
            "name": tool.function.name,
            "valid": True,
            "errors": [],
            "warnings": []
        }
        
        # Check tool type
        if tool.type != "function":
            tool_result["errors"].append(f"Invalid tool type: '{tool.type}'. Only 'function' is supported.")
            tool_result["valid"] = False
        
        # Check function name
        if not valid_name_pattern.match(tool.function.name):
            tool_result["errors"].append(f"Invalid function name: '{tool.function.name}'. Must start with letter/underscore and contain only alphanumeric characters.")
            tool_result["valid"] = False
        
        # Check for description
        if not tool.function.description:
            tool_result["warnings"].append("Missing function description. Models perform better with clear descriptions.")
        
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
    
    return {
        "valid": all_valid,
        "tool_count": len(request.tools),
        "results": results
    }


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
                                    "description": "The city and state, e.g. San Francisco, CA"
                                },
                                "unit": {
                                    "type": "string",
                                    "enum": ["celsius", "fahrenheit"],
                                    "description": "Temperature unit"
                                }
                            },
                            "required": ["location"]
                        }
                    }
                }
            ]
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
                                    "description": "The mathematical expression to evaluate, e.g. '2 + 2 * 3'"
                                }
                            },
                            "required": ["expression"]
                        }
                    }
                }
            ]
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
                                "query": {
                                    "type": "string",
                                    "description": "The search query"
                                },
                                "num_results": {
                                    "type": "integer",
                                    "description": "Number of results to return",
                                    "default": 5
                                }
                            },
                            "required": ["query"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "get_page_content",
                        "description": "Get the content of a web page",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "url": {
                                    "type": "string",
                                    "description": "The URL to fetch"
                                }
                            },
                            "required": ["url"]
                        }
                    }
                }
            ]
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
                            "properties": {
                                "code": {
                                    "type": "string",
                                    "description": "The Python code to execute"
                                }
                            },
                            "required": ["code"]
                        }
                    }
                }
            ]
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
                                "query": {
                                    "type": "string",
                                    "description": "The SQL query to execute"
                                },
                                "database": {
                                    "type": "string",
                                    "description": "The database name to query"
                                }
                            },
                            "required": ["query"]
                        }
                    }
                }
            ]
        }
    }
    
    return {
        "presets": presets,
        "count": len(presets)
    }


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
                    "meta-llama/Llama-3.2-3B-Instruct"
                ],
                "notes": "Excellent native tool calling support with <|python_tag|> format"
            },
            {
                "name": "Mistral/Mixtral",
                "model_ids": [
                    "mistralai/Mistral-7B-Instruct-v0.3",
                    "mistralai/Mixtral-8x7B-Instruct-v0.1"
                ],
                "notes": "Good tool calling with [TOOL_CALLS] format"
            },
            {
                "name": "Qwen 2.5",
                "model_ids": [
                    "Qwen/Qwen2.5-7B-Instruct",
                    "Qwen/Qwen2.5-72B-Instruct"
                ],
                "notes": "Strong tool calling and code generation"
            },
            {
                "name": "Hermes 2 Pro",
                "model_ids": [
                    "NousResearch/Hermes-2-Pro-Llama-3-8B",
                    "NousResearch/Hermes-2-Pro-Mistral-7B"
                ],
                "notes": "Fine-tuned specifically for function calling"
            }
        ],
        "usage_tips": [
            "Use 'tool_choice': 'auto' to let the model decide when to use tools",
            "Use 'tool_choice': 'required' to force tool usage",
            "Use 'tool_choice': 'none' to disable tool usage for a request",
            "Provide clear, detailed descriptions for better tool selection",
            "Include parameter descriptions for more accurate argument generation",
            "For multi-step tasks, set 'parallel_tool_calls': true"
        ]
    }


@app.post("/api/completion")
async def completion(request: CompletionRequest):
    """Proxy completion requests to vLLM server for base models"""
    global current_config, current_model_identifier, current_run_mode
    
    # Check server status based on mode
    if current_run_mode == "container" and CONTAINER_MODE_AVAILABLE and container_manager:
        status = await container_manager.get_container_status()
        if not status.get('running', False):
            raise HTTPException(status_code=400, detail="vLLM server is not running")
    elif current_run_mode == "subprocess":
        if vllm_process is None or vllm_process.returncode is not None:
            raise HTTPException(status_code=400, detail="vLLM server is not running")
    else:
        raise HTTPException(status_code=400, detail="vLLM server is not running")
    
    if current_config is None:
        raise HTTPException(status_code=400, detail="Server configuration not available")
    
    try:
        import aiohttp
        
        # In Kubernetes mode, use the service endpoint instead of host:port
        # Check if we're in Kubernetes by looking for service account token
        is_kubernetes = os.path.exists('/var/run/secrets/kubernetes.io/serviceaccount/token')
        
        if current_run_mode == "container" and is_kubernetes:
            # Kubernetes mode - connect to vLLM service
            service_name = getattr(container_manager, 'SERVICE_NAME', 'vllm-service')
            namespace = getattr(container_manager, 'namespace', os.getenv('KUBERNETES_NAMESPACE', 'default'))
            url = f"http://{service_name}.{namespace}.svc.cluster.local:{current_config.port}/v1/completions"
            logger.info(f"Using Kubernetes service URL: {url}")
        else:
            # Subprocess mode or local container mode - connect to localhost
            # Use localhost for container mode since 0.0.0.0 is a bind address, not a valid destination
            if current_run_mode == "container":
                url = f"http://localhost:{current_config.port}/v1/completions"
            else:
                url = f"http://{current_config.host}:{current_config.port}/v1/completions"
            logger.info(f"Using URL: {url}")
        
        payload = {
            "model": get_model_name_for_api(),
            "prompt": request.prompt,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens
        }
        
        async with aiohttp.ClientSession() as session:
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
        {"name": "TinyLlama/TinyLlama-1.1B-Chat-v1.0", "size": "1.1B", "description": "Compact chat model (CPU-friendly)", "cpu_friendly": True},
        {"name": "meta-llama/Llama-3.2-1B-Instruct", "size": "1B", "description": "Llama 3.2 1B Instruct (CPU-friendly, gated)", "cpu_friendly": True, "gated": True},
        
        # Larger models (may be slow on CPU)
        {"name": "Qwen/Qwen2.5-3B-Instruct", "size": "3B", "description": "Qwen 2.5 3B Instruct (GPU-optimized)", "cpu_friendly": False},
        {"name": "mistralai/Mistral-7B-Instruct-v0.2", "size": "7B", "description": "Mistral Instruct (slow on CPU)", "cpu_friendly": False},
        {"name": "RedHatAI/Llama-3.2-1B-Instruct-FP8", "size": "1B", "description": "Llama 3.2 1B Instruct FP8 (GPU-optimized, gated)", "cpu_friendly": False, "gated": True},
        {"name": "RedHatAI/Llama-3.1-8B-Instruct", "size": "8B", "description": "Llama 3.1 8B Instruct (gated)", "cpu_friendly": False, "gated": True},
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
                "message": "Run 'python recipes/sync_recipes.py' to fetch recipes"
            }
        )
    
    try:
        with open(recipes_file, "r") as f:
            catalog = json.load(f)
        return catalog
    except Exception as e:
        logger.error(f"Error loading recipes catalog: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": f"Failed to load recipes: {str(e)}"}
        )


@app.get("/api/recipes/{category_id}")
async def get_recipes_by_category(category_id: str):
    """
    Get recipes for a specific model family/category.
    
    Args:
        category_id: Category identifier (e.g., 'qwen', 'llama', 'deepseek')
    """
    recipes_file = BASE_DIR / "recipes" / "recipes_catalog.json"
    
    if not recipes_file.exists():
        return JSONResponse(
            status_code=404,
            content={"error": "Recipes catalog not found"}
        )
    
    try:
        with open(recipes_file, "r") as f:
            catalog = json.load(f)
        
        for category in catalog.get("categories", []):
            if category["id"] == category_id:
                return category
        
        return JSONResponse(
            status_code=404,
            content={"error": f"Category '{category_id}' not found"}
        )
    except Exception as e:
        logger.error(f"Error loading recipes: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": f"Failed to load recipes: {str(e)}"}
        )


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
        return JSONResponse(
            status_code=404,
            content={"error": "Recipes catalog not found"}
        )
    
    try:
        with open(recipes_file, "r") as f:
            catalog = json.load(f)
        
        for category in catalog.get("categories", []):
            if category["id"] == category_id:
                for recipe in category.get("recipes", []):
                    if recipe["id"] == recipe_id:
                        return {
                            "recipe": recipe,
                            "category": {
                                "id": category["id"],
                                "name": category["name"]
                            }
                        }
        
        return JSONResponse(
            status_code=404,
            content={"error": f"Recipe '{recipe_id}' not found in category '{category_id}'"}
        )
    except Exception as e:
        logger.error(f"Error loading recipe: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": f"Failed to load recipe: {str(e)}"}
        )


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
        github_token = request.get('github_token')
    
    sync_script = BASE_DIR / "recipes" / "sync_recipes.py"
    
    if not sync_script.exists():
        return JSONResponse(
            status_code=404,
            content={
                "success": False,
                "error": "Sync script not found",
                "message": "recipes/sync_recipes.py is missing"
            }
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
                    "message": "The 'requests' package is required. Install with: pip install requests"
                }
            )
        
        # Run the sync script
        logger.info("Starting recipes sync from GitHub...")
        
        # Prepare environment with optional GitHub token
        env = os.environ.copy()
        if github_token:
            env['GITHUB_TOKEN'] = github_token
            logger.info("Using provided GitHub token for higher rate limits")
        
        result = subprocess.run(
            [sys.executable, str(sync_script)],
            capture_output=True,
            text=True,
            timeout=60,  # 60 second timeout
            cwd=str(BASE_DIR),
            env=env
        )
        
        if result.returncode == 0:
            # Parse output for summary
            output_lines = result.stdout.strip().split('\n')
            
            # Reload the catalog to get updated data
            recipes_file = BASE_DIR / "recipes" / "recipes_catalog.json"
            catalog_info = {}
            if recipes_file.exists():
                with open(recipes_file, "r") as f:
                    catalog = json.load(f)
                    catalog_info = {
                        "categories": len(catalog.get("categories", [])),
                        "last_updated": catalog.get("metadata", {}).get("last_updated", "unknown"),
                        "total_recipes": sum(
                            len(cat.get("recipes", [])) 
                            for cat in catalog.get("categories", [])
                        )
                    }
            
            logger.info(f"Recipes sync completed successfully: {catalog_info}")
            
            return {
                "success": True,
                "message": "Recipes synced successfully from GitHub",
                "catalog": catalog_info,
                "output": result.stdout[-2000:] if len(result.stdout) > 2000 else result.stdout  # Limit output size
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
                    "return_code": result.returncode
                }
            )
            
    except subprocess.TimeoutExpired:
        logger.error("Recipes sync timed out")
        return JSONResponse(
            status_code=504,
            content={
                "success": False,
                "error": "Timeout",
                "message": "Sync operation timed out. GitHub may be slow or rate-limited."
            }
        )
    except Exception as e:
        logger.error(f"Error syncing recipes: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(type(e).__name__),
                "message": str(e)
            }
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
            return JSONResponse(
                status_code=404,
                content={"success": False, "error": "Recipes catalog not found"}
            )
        
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
                status_code=400,
                content={"success": False, "error": "Missing category_id or recipe data"}
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
                "recipes": []
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
            "category_id": category_id
        }
        
    except Exception as e:
        logger.error(f"Error saving recipe: {e}")
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": str(e)}
        )


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
            return JSONResponse(
                status_code=404,
                content={"success": False, "error": "Recipes catalog not found"}
            )
        
        category_id = request.get("category_id")
        recipe_id = request.get("recipe_id")
        
        if not category_id or not recipe_id:
            return JSONResponse(
                status_code=400,
                content={"success": False, "error": "Missing category_id or recipe_id"}
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
            return JSONResponse(
                status_code=404,
                content={"success": False, "error": "Recipe not found"}
            )
        
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
            "category_id": category_id
        }
        
    except Exception as e:
        logger.error(f"Error deleting recipe: {e}")
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": str(e)}
        )


@app.post("/api/models/validate-local")
async def validate_local_model(request: dict):
    """
    Validate a local model path
    
    Request body: {"path": "/path/to/model"}
    Response: {"valid": bool, "error": str, "info": dict}
    """
    model_path = request.get('path', '')
    
    if not model_path:
        return JSONResponse(
            status_code=400,
            content={"valid": False, "error": "No path provided"}
        )
    
    result = validate_local_model_path(model_path)
    
    if result['valid']:
        return result
    else:
        return JSONResponse(
            status_code=400,
            content=result
        )


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
        
        requested_path = request.get('path', '~')
        
        # Expand ~ to home directory
        if requested_path == '~':
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
                directories.append({
                    'name': '..',
                    'path': str(path.parent)
                })
            
            # List subdirectories
            for item in sorted(path.iterdir()):
                if item.is_dir() and not item.name.startswith('.'):
                    # Check if it might be a model directory (has config.json)
                    is_model_dir = (item / 'config.json').exists()
                    directories.append({
                        'name': item.name + (' 🤖' if is_model_dir else ''),
                        'path': str(item)
                    })
        except PermissionError:
            logger.warning(f"Permission denied accessing directory: {path}")
        
        return {
            "directories": directories[:100],  # Limit to 100 directories
            "current_path": str(path)
        }
    
    except Exception as e:
        logger.error(f"Error browsing directories: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": f"Failed to browse directories: {str(e)}"}
        )


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
            return LocalModelValidationResponse(
                valid=False,
                message=f"Path does not exist: {request.path}"
            )
        
        # Check if it's a directory
        if not model_path.is_dir():
            return LocalModelValidationResponse(
                valid=False,
                message=f"Path must be a directory, not a file"
            )
        
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
                has_tokenizer=has_tokenizer
            )
        
        # Try to read model info from config.json
        model_type = None
        model_name = model_path.name
        try:
            import json
            with open(config_file, 'r') as f:
                config_data = json.load(f)
                model_type = config_data.get('model_type', 'unknown')
                # Try to get architectures
                architectures = config_data.get('architectures', [])
                if architectures:
                    model_type = architectures[0]
        except Exception as e:
            logger.warning(f"Could not read config.json: {e}")
        
        # Estimate directory size
        estimated_size_mb = None
        try:
            total_size = sum(f.stat().st_size for f in model_path.rglob('*') if f.is_file())
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
            estimated_size_mb=round(estimated_size_mb, 2) if estimated_size_mb else None
        )
    
    except Exception as e:
        logger.error(f"Error validating local model: {e}")
        return LocalModelValidationResponse(
            valid=False,
            message=f"Error validating path: {str(e)}"
        )


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
            "note": "Using custom chat template provided by user (overrides model's built-in template)"
        }
    else:
        # vLLM is auto-detecting from model's tokenizer_config.json
        # We provide reference templates for documentation purposes
        return {
            "source": "auto-detected by vLLM",
            "model": current_config.model,
            "template": get_chat_template_for_model(current_config.model),
            "stop_tokens": get_stop_tokens_for_model(current_config.model),
            "note": "vLLM automatically uses the chat template from the model's tokenizer_config.json. The template shown here is a reference/fallback for documentation purposes only."
        }


@app.get("/api/vllm/health")
async def check_vllm_health():
    """Check if the vLLM server is healthy and ready to serve requests"""
    global current_config, vllm_process, current_run_mode
    
    # Check if server is running
    if current_run_mode == "container" and CONTAINER_MODE_AVAILABLE and container_manager:
        status = await container_manager.get_container_status()
        if not status.get('running', False):
            return {"success": False, "status_code": 503, "error": "Server not running"}
    elif current_run_mode == "subprocess":
        if vllm_process is None or vllm_process.returncode is not None:
            return {"success": False, "status_code": 503, "error": "Server not running"}
    
    if current_config is None:
        return {"success": False, "status_code": 503, "error": "No configuration"}
    
    # Try to call vLLM's health endpoint
    try:
        import aiohttp
        
        if current_run_mode == "container":
            base_url = f"http://localhost:{current_config.port}"
        else:
            base_url = f"http://{current_config.host}:{current_config.port}"
        
        health_url = f"{base_url}/health"
        
        timeout = aiohttp.ClientTimeout(total=3)
        async with aiohttp.ClientSession(timeout=timeout) as session:
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
    if current_run_mode == "container" and CONTAINER_MODE_AVAILABLE and container_manager:
        status = await container_manager.get_container_status()
        if not status.get('running', False):
            return JSONResponse(
                status_code=400, 
                content={"error": "vLLM server is not running"}
            )
    elif current_run_mode == "subprocess":
        if vllm_process is None or vllm_process.returncode is not None:
            return JSONResponse(
                status_code=400, 
                content={"error": "vLLM server is not running"}
            )
    else:
        return JSONResponse(
            status_code=400, 
            content={"error": "vLLM server is not running"}
        )
    
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
            result['metrics_age_seconds'] = round(metrics_age_seconds, 1)
        return result
    
    # If no metrics captured yet from logs, try the metrics endpoint
    if current_config is None:
        return {}
    
    try:
        import aiohttp
        
        # Try to fetch metrics from vLLM's metrics endpoint
        # In Kubernetes mode, use the service endpoint instead of host:port
        # Check if we're in Kubernetes by looking for service account token
        is_kubernetes = os.path.exists('/var/run/secrets/kubernetes.io/serviceaccount/token')
        
        if current_run_mode == "container" and is_kubernetes:
            # Kubernetes mode - connect to vLLM service
            service_name = getattr(container_manager, 'SERVICE_NAME', 'vllm-service')
            namespace = getattr(container_manager, 'namespace', os.getenv('KUBERNETES_NAMESPACE', 'default'))
            metrics_url = f"http://{service_name}.{namespace}.svc.cluster.local:{current_config.port}/metrics"
        else:
            # Subprocess mode or local container mode - connect to localhost
            # Use localhost for container mode since 0.0.0.0 is a bind address, not a valid destination
            if current_run_mode == "container":
                metrics_url = f"http://localhost:{current_config.port}/metrics"
            else:
                metrics_url = f"http://{current_config.host}:{current_config.port}/metrics"
        
        async with aiohttp.ClientSession() as session:
            try:
                async with session.get(metrics_url, timeout=aiohttp.ClientTimeout(total=2)) as response:
                    if response.status == 200:
                        text = await response.text()
                        
                        # Parse Prometheus-style metrics
                        metrics = {}
                        
                        # Look for KV cache usage
                        for line in text.split('\n'):
                            if 'vllm:gpu_cache_usage_perc' in line and not line.startswith('#'):
                                try:
                                    value = float(line.split()[-1])
                                    metrics['gpu_cache_usage_perc'] = value
                                except:
                                    pass
                            elif 'vllm:cpu_cache_usage_perc' in line and not line.startswith('#'):
                                try:
                                    value = float(line.split()[-1])
                                    metrics['cpu_cache_usage_perc'] = value
                                except:
                                    pass
                            elif 'vllm:avg_prompt_throughput_toks_per_s' in line and not line.startswith('#'):
                                try:
                                    value = float(line.split()[-1])
                                    metrics['avg_prompt_throughput'] = value
                                except:
                                    pass
                            elif 'vllm:avg_generation_throughput_toks_per_s' in line and not line.startswith('#'):
                                try:
                                    value = float(line.split()[-1])
                                    metrics['avg_generation_throughput'] = value
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
    if current_run_mode == "container" and CONTAINER_MODE_AVAILABLE and container_manager:
        status = await container_manager.get_container_status()
        if not status.get('running', False):
            raise HTTPException(status_code=400, detail="vLLM server is not running")
    elif current_run_mode == "subprocess":
        if vllm_process is None or vllm_process.returncode is not None:
            raise HTTPException(status_code=400, detail="vLLM server is not running")
    else:
        raise HTTPException(status_code=400, detail="vLLM server is not running")
    
    if benchmark_task is not None and not benchmark_task.done():
        raise HTTPException(status_code=400, detail="Benchmark is already running")
    
    try:
        # Reset results
        benchmark_results = None
        
        # Choose benchmark method
        if config.use_guidellm:
            # Start GuideLLM benchmark task
            benchmark_task = asyncio.create_task(
                run_guidellm_benchmark(config, current_config)
            )
            await broadcast_log("[BENCHMARK] Starting GuideLLM benchmark...")
        else:
            # Start built-in benchmark task
            benchmark_task = asyncio.create_task(
                run_benchmark(config, current_config)
            )
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
        
        await broadcast_log(f"[BENCHMARK] Configuration: {config.total_requests} requests at {config.request_rate} req/s")
        
        # In Kubernetes mode, use the service endpoint instead of host:port
        # Check if we're in Kubernetes by looking for service account token
        is_kubernetes = os.path.exists('/var/run/secrets/kubernetes.io/serviceaccount/token')
        
        if current_run_mode == "container" and is_kubernetes:
            # Kubernetes mode - connect to vLLM service
            service_name = getattr(container_manager, 'SERVICE_NAME', 'vllm-service')
            namespace = getattr(container_manager, 'namespace', os.getenv('KUBERNETES_NAMESPACE', 'default'))
            url = f"http://{service_name}.{namespace}.svc.cluster.local:{server_config.port}/v1/chat/completions"
            logger.info(f"Using Kubernetes service URL for benchmark: {url}")
        else:
            # Subprocess mode or local container mode - connect to localhost
            # Use localhost for container mode since 0.0.0.0 is a bind address, not a valid destination
            if current_run_mode == "container":
                url = f"http://localhost:{server_config.port}/v1/chat/completions"
            else:
                url = f"http://{server_config.host}:{server_config.port}/v1/chat/completions"
            logger.info(f"Using URL for benchmark: {url}")
        
        # Generate a sample prompt of specified length
        prompt_text = " ".join(["benchmark" for _ in range(config.prompt_tokens // 10)])
        
        results = []
        successful = 0
        failed = 0
        start_time = time.time()
        
        # Create session
        async with aiohttp.ClientSession() as session:
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
                            usage = data.get('usage', {})
                            completion_tokens = usage.get('completion_tokens', config.output_tokens)
                            
                            # Debug: Log token extraction for first few requests
                            if i < 3:
                                logger.info(f"[BENCHMARK DEBUG] Request {i+1} usage: {usage}")
                                logger.info(f"[BENCHMARK DEBUG] Request {i+1} completion_tokens: {completion_tokens}")
                            
                            results.append({
                                'latency': latency,
                                'tokens': completion_tokens
                            })
                            successful += 1
                        else:
                            failed += 1
                            logger.warning(f"Request {i+1} failed with status {response.status}")
                
                except Exception as e:
                    failed += 1
                    logger.error(f"Request {i+1} error: {e}")
                
                # Progress update
                if (i + 1) % max(1, config.total_requests // 10) == 0:
                    progress = ((i + 1) / config.total_requests) * 100
                    await broadcast_log(f"[BENCHMARK] Progress: {progress:.0f}% ({i+1}/{config.total_requests} requests)")
                
                # Rate limiting
                if config.request_rate > 0:
                    await asyncio.sleep(1.0 / config.request_rate)
        
        end_time = time.time()
        duration = end_time - start_time
        
        # Calculate metrics
        if results:
            latencies = [r['latency'] for r in results]
            tokens = [r['tokens'] for r in results]
            
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
                completed=True
            )
            
            await broadcast_log(f"[BENCHMARK] Completed! Throughput: {throughput:.2f} req/s, Avg Latency: {avg_latency:.2f}ms")
            await broadcast_log(f"[BENCHMARK] Token Throughput: {tokens_per_second:.2f} tok/s, Total Tokens: {int(total_tokens)}")
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
        await broadcast_log(f"[GUIDELLM] Configuration: {config.total_requests} requests at {config.request_rate} req/s")
        
        # Check if GuideLLM is installed
        try:
            import guidellm
            # Don't import internal modules - we'll use the CLI
            await broadcast_log(f"[GUIDELLM] Package found: {guidellm.__version__ if hasattr(guidellm, '__version__') else 'version unknown'}")
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
        target_url = f"http://{server_config.host}:{server_config.port}/v1"
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
                timeout=30  # Increased timeout for OpenShift compatibility
            )
            if check_result.returncode != 0:
                # Current python_exec doesn't have guidellm, try finding it in PATH
                await broadcast_log(f"[GUIDELLM] WARNING: guidellm CLI not accessible from {python_exec}")
                await broadcast_log(f"[GUIDELLM] stderr: {check_result.stderr.decode()}")
                # Try to find guidellm in PATH
                which_result = subprocess.run(
                    ["which", "guidellm"],
                    capture_output=True,
                    text=True
                )
                if which_result.returncode == 0:
                    guidellm_bin = which_result.stdout.strip()
                    await broadcast_log(f"[GUIDELLM] Found guidellm binary at: {guidellm_bin}")
                    # Use guidellm directly instead of python -m
                    python_exec = None  # Will use guidellm command directly
                else:
                    await broadcast_log(f"[GUIDELLM] WARNING: GuideLLM CLI verification failed, will attempt to run anyway")
                    await broadcast_log(f"[GUIDELLM] If benchmark fails, ensure GuideLLM is properly installed: pip install guidellm")
            else:
                await broadcast_log(f"[GUIDELLM] CLI verified: {python_exec}")
        except subprocess.TimeoutExpired:
            # Don't fail - just warn and continue
            await broadcast_log(f"[GUIDELLM] WARNING: CLI check timed out (30s), will attempt to run benchmark anyway")
            await broadcast_log(f"[GUIDELLM] If you encounter issues, ensure GuideLLM is installed in your venv: pip install guidellm")
        except Exception as e:
            # Don't fail - just warn and continue
            await broadcast_log(f"[GUIDELLM] WARNING: Error checking GuideLLM installation: {e}")
            await broadcast_log(f"[GUIDELLM] Will attempt to run benchmark anyway. Ensure GuideLLM is installed: pip install guidellm")
        
        # Create a temporary JSON file for results
        result_file = tempfile.NamedTemporaryFile(mode='w+', suffix='.json', delete=False)
        result_file.close()
        
        # Build GuideLLM command
        # GuideLLM structure: guidellm benchmark [OPTIONS]
        # Example: guidellm benchmark --target "url" --rate-type sweep --max-seconds 30 --data "prompt_tokens=256,output_tokens=128"
        
        if python_exec:
            cmd = [
                python_exec, "-m", "guidellm",
                "benchmark",
                "--target", target_url,
            ]
        else:
            cmd = [
                "guidellm",
                "benchmark",
                "--target", target_url,
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
        
        # Run GuideLLM process and capture ALL output
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        # Collect all output lines for parsing
        output_lines = []
        
        # Stream output
        while True:
            line = await process.stdout.readline()
            if not line:
                break
            decoded = line.decode().strip()
            if decoded:
                output_lines.append(decoded)
                await broadcast_log(f"[GUIDELLM] {decoded}")
        
        # Wait for completion
        await process.wait()
        
        if process.returncode != 0:
            stderr = await process.stderr.read()
            error_msg = stderr.decode().strip()
            await broadcast_log(f"[GUIDELLM] Error: {error_msg}")
            benchmark_results = None
            return
        
        # Join all output for raw display
        raw_output = "\n".join(output_lines)
        
        # Try to read JSON output file
        json_output = None
        try:
            # Check if file exists and has content
            if os.path.exists(result_file.name):
                file_size = os.path.getsize(result_file.name)
                await broadcast_log(f"[GUIDELLM] 📄 JSON file found: {result_file.name} (size: {file_size} bytes)")
                
                with open(result_file.name, 'r') as f:
                    json_output = f.read()
                
                if json_output:
                    await broadcast_log(f"[GUIDELLM] ✅ JSON output loaded successfully ({len(json_output)} characters)")
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
                if 'constant@' in line or 'sweep@' in line:
                    # Check if this is the stats line (contains numeric data)
                    parts = [p.strip() for p in line.split('|') if p.strip()]
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
                json_output=json_output  # Store JSON output for display
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
                raw_output=raw_output if 'raw_output' in locals() else "Error capturing output",
                json_output=json_output if 'json_output' in locals() else None
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
                s.bind(('127.0.0.1', port))
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
        return {
            "success": True,
            "already_running": True,
            "port": ttyd_port,
            "ws_url": f"ws://127.0.0.1:{ttyd_port}/ws"
        }
    
    # Check if ttyd is installed
    if not is_ttyd_installed():
        return {
            "success": False,
            "error": "ttyd is not installed",
            "install_instructions": {
                "macos": "brew install ttyd",
                "ubuntu": "sudo apt install ttyd",
                "fedora": "sudo dnf install ttyd"
            }
        }
    
    # Find Claude command
    claude_path = find_claude_command()
    if not claude_path:
        return {
            "success": False,
            "error": "Claude Code CLI is not installed"
        }
    
    # Find available port
    try:
        port = find_available_port()
    except RuntimeError as e:
        return {
            "success": False,
            "error": str(e)
        }
    
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
        "--port", str(port),
        "--interface", "127.0.0.1",
        "--once",  # Exit after client disconnects
        "--writable",  # Allow input
        claude_path,
        "--model", model_name
    ]
    
    logger.info(f"Starting ttyd: {' '.join(ttyd_cmd)}")
    logger.info(f"Environment: ANTHROPIC_BASE_URL={env.get('ANTHROPIC_BASE_URL')}, MODEL={model_name}")
    
    try:
        # Capture stderr to see any ttyd errors
        ttyd_process = subprocess.Popen(
            ttyd_cmd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        ttyd_port = port
        
        # Give ttyd a moment to start
        import time
        time.sleep(1.5)  # Increased wait time for ttyd to bind port
        
        # Check if process is still running
        if ttyd_process.poll() is not None:
            exit_code = ttyd_process.returncode
            # Try to get stderr output
            _, stderr_output = ttyd_process.communicate(timeout=1)
            stderr_str = stderr_output.decode('utf-8', errors='replace') if stderr_output else "No error output"
            logger.error(f"ttyd exited with code {exit_code}: {stderr_str}")
            ttyd_process = None
            ttyd_port = None
            return {
                "success": False,
                "error": f"ttyd exited with code {exit_code}: {stderr_str}"
            }
        
        # Verify ttyd is actually listening on the port
        import socket
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            result = sock.connect_ex(('127.0.0.1', port))
            if result != 0:
                logger.error(f"ttyd started but not listening on port {port}")
                # Kill the process since it's not working
                ttyd_process.terminate()
                ttyd_process = None
                ttyd_port = None
                return {
                    "success": False,
                    "error": f"ttyd started but failed to listen on port {port}"
                }
        finally:
            sock.close()
        
        logger.info(f"ttyd started on port {port}, pid: {ttyd_process.pid}")
        logger.info(f"ttyd WebSocket URL: ws://127.0.0.1:{port}/ws")
        
        return {
            "success": True,
            "already_running": False,
            "port": port,
            "ws_url": f"ws://127.0.0.1:{port}/ws",
            "pid": ttyd_process.pid
        }
        
    except Exception as e:
        logger.error(f"Failed to start ttyd: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            "success": False,
            "error": str(e)
        }


def stop_ttyd() -> Dict[str, Any]:
    """Stop the ttyd process if running"""
    global ttyd_process, ttyd_port
    
    if ttyd_process is None:
        return {
            "success": True,
            "message": "ttyd was not running"
        }
    
    if ttyd_process.poll() is not None:
        # Process already exited
        ttyd_process = None
        ttyd_port = None
        return {
            "success": True,
            "message": "ttyd had already exited"
        }
    
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
        
        return {
            "success": True,
            "message": f"ttyd stopped (pid: {pid})"
        }
        
    except Exception as e:
        logger.error(f"Error stopping ttyd: {e}")
        return {
            "success": False,
            "error": str(e)
        }


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
            return {
                "installed": True,
                "path": claude_path,
                "version": version
            }
        except Exception as e:
            return {
                "installed": True,
                "path": claude_path,
                "version": "unknown",
                "error": str(e)
            }
    
    return {
        "installed": False,
        "path": None,
        "version": None
    }


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
        "message": "Ready" if (ttyd_available and claude_info["installed"] and vllm_running) else "Not ready"
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
            "needs_served_model_name": False
        }
    
    # Get the model name to use
    # Use served_model_name if set (required for Claude Code as model names with '/' don't work)
    if current_served_model_name:
        model_name = current_served_model_name
    else:
        model_name = current_model_identifier or current_config.model
        # Check if model name contains '/' which won't work with Claude Code
        if '/' in model_name:
            return {
                "available": False,
                "message": "Model name contains '/'. Set a 'Served Model Name' in vLLM server configuration for Claude Code to work.",
                "env": {},
                "needs_served_model_name": True,
                "current_model": model_name
            }
    
    # Check if tool calling is enabled (required for Claude Code)
    tool_calling_enabled = current_config.enable_tool_calling
    
    # Build the base URL for vLLM's Anthropic-compatible endpoint
    # Use localhost since Claude Code runs on the same machine
    # Per vLLM docs: ANTHROPIC_BASE_URL should be the server root (e.g. http://localhost:8000)
    # Claude Code/Anthropic SDK appends /v1/messages to this base URL
    port = current_config.port
    base_url = f"http://localhost:{port}"
    
    env_config = {
        "ANTHROPIC_BASE_URL": base_url,
        "ANTHROPIC_API_KEY": "vllm-playground",  # vLLM doesn't require auth by default
        "ANTHROPIC_DEFAULT_OPUS_MODEL": model_name,
        "ANTHROPIC_DEFAULT_SONNET_MODEL": model_name,
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": model_name,
    }
    
    return {
        "available": True,
        "message": "vLLM server is running and ready for Claude Code",
        "tool_calling_enabled": tool_calling_enabled,
        "tool_calling_warning": None if tool_calling_enabled else "Tool calling is not enabled. Claude Code may not work properly.",
        "env": env_config,
        "model": model_name,
        "port": port
    }


@app.post("/api/claude-code/install")
async def claude_code_install(method: str = "npm"):
    """Install Claude Code CLI"""
    try:
        if method == "npm":
            # Install via npm globally
            process = await asyncio.create_subprocess_exec(
                "npm", "install", "-g", "@anthropic-ai/claude-code",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await process.communicate()
            
            if process.returncode == 0:
                return {
                    "success": True,
                    "message": "Claude Code installed successfully via npm",
                    "output": stdout.decode()
                }
            else:
                return {
                    "success": False,
                    "message": "Failed to install Claude Code",
                    "error": stderr.decode()
                }
        else:
            return {
                "success": False,
                "message": f"Unknown installation method: {method}",
                "supported_methods": ["npm"]
            }
    except FileNotFoundError:
        return {
            "success": False,
            "message": "npm not found. Please install Node.js first.",
            "error": "npm command not available"
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"Installation failed: {str(e)}",
            "error": str(e)
        }


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
                "fedora": "sudo dnf install ttyd"
            }
        }
    
    # Check if Claude Code is installed
    claude_info = is_claude_installed()
    if not claude_info["installed"]:
        return {
            "success": False,
            "error": "Claude Code CLI is not installed. Install with: npm install -g @anthropic-ai/claude-code"
        }
    
    # Get vLLM config for Claude Code environment
    config_response = await claude_code_config()
    if not config_response["available"]:
        return {
            "success": False,
            "error": config_response["message"],
            "needs_served_model_name": config_response.get("needs_served_model_name", False)
        }
    
    # Start ttyd
    result = start_ttyd_for_claude(
        env_config=config_response["env"],
        model_name=config_response["model"]
    )
    
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
            subprotocols=['tty'],
            ping_interval=None,  # Disable ping to avoid interference
            close_timeout=1
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
            await asyncio.gather(
                forward_to_client(),
                forward_to_ttyd(),
                return_exceptions=True
            )
            
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
        "ws_url": f"ws://127.0.0.1:{ttyd_port}/ws" if is_running else None
    }


def main(host: str = None, port: int = None, reload: bool = False):
    """Main entry point"""
    logger.info("Starting vLLM Playground...")
    
    # Get host/port from arguments, environment, or use defaults
    webui_host = host or os.environ.get("WEBUI_HOST", "0.0.0.0")
    webui_port = port or int(os.environ.get("WEBUI_PORT", "7860"))
    
    uvicorn.run(
        app,
        host=webui_host,
        port=webui_port,
        reload=reload,
        log_level="info"
    )


if __name__ == "__main__":
    main()

