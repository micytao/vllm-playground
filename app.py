"""
vLLM Playground - A web interface for managing and interacting with vLLM
"""
import asyncio
import logging
import os
import subprocess
import sys
import tempfile
import shutil
from datetime import datetime
from typing import Optional, List, Dict, Any, Literal
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import uvicorn

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(title="vLLM Playground", version="1.0.0")

# Get base directory
BASE_DIR = Path(__file__).parent

# Mount static files (must be before routes)
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
app.mount("/assets", StaticFiles(directory=str(BASE_DIR / "assets")), name="assets")

# Global state
vllm_process: Optional[subprocess.Popen] = None
log_queue: asyncio.Queue = asyncio.Queue()
websocket_connections: List[WebSocket] = []
latest_vllm_metrics: Dict[str, Any] = {}  # Store latest metrics from logs
metrics_timestamp: Optional[datetime] = None  # Track when metrics were last updated


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


class ChatMessage(BaseModel):
    """Chat message structure"""
    role: str
    content: str


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


# ============ Compression Models ============

class CompressionConfig(BaseModel):
    """Configuration for model compression"""
    model: str
    output_dir: str = Field(default_factory=lambda: tempfile.mkdtemp(prefix="compressed_"))
    
    # Quantization format
    quantization_format: Literal[
        "W8A8_INT8", "W8A8_FP8", "W4A16", "W8A16", "FP4_W4A16", "FP4_W4A4", "W4A4"
    ] = "W8A8_INT8"
    
    # Algorithm selection
    algorithm: Literal["PTQ", "GPTQ", "AWQ", "SmoothQuant", "SparseGPT"] = "GPTQ"
    
    # Dataset configuration
    dataset: str = "open_platypus"
    num_calibration_samples: int = 512
    max_seq_length: int = 2048
    
    # Advanced options
    smoothing_strength: float = 0.8  # For SmoothQuant
    target_layers: Optional[str] = "Linear"  # Comma-separated
    ignore_layers: Optional[str] = "lm_head"  # Comma-separated
    
    # Additional parameters
    hf_token: Optional[str] = None


class CompressionStatus(BaseModel):
    """Compression task status"""
    running: bool
    progress: float = 0.0  # 0-100
    stage: str = "idle"  # idle, loading, calibrating, quantizing, saving, complete, error
    message: str = ""
    output_dir: Optional[str] = None
    original_size_mb: Optional[float] = None
    compressed_size_mb: Optional[float] = None
    compression_ratio: Optional[float] = None
    error: Optional[str] = None


class CompressionPreset(BaseModel):
    """Preset compression configuration"""
    name: str
    description: str
    quantization_format: str
    algorithm: str
    emoji: str
    expected_speedup: str
    size_reduction: str


current_config: Optional[VLLMConfig] = None
server_start_time: Optional[datetime] = None
benchmark_task: Optional[asyncio.Task] = None
benchmark_results: Optional[BenchmarkResults] = None

# Compression state
compression_task: Optional[asyncio.Task] = None
compression_status: CompressionStatus = CompressionStatus(running=False)
compression_output_dir: Optional[Path] = None


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


@app.get("/", response_class=HTMLResponse)
async def read_root():
    """Serve the main HTML page"""
    html_path = Path(__file__).parent / "index.html"
    with open(html_path, "r") as f:
        return HTMLResponse(content=f.read())


@app.get("/api/status")
async def get_status() -> ServerStatus:
    """Get current server status"""
    global vllm_process, current_config, server_start_time
    
    running = vllm_process is not None and vllm_process.poll() is None
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


@app.post("/api/start")
async def start_server(config: VLLMConfig):
    """Start the vLLM server"""
    global vllm_process, current_config, server_start_time
    
    if vllm_process is not None and vllm_process.poll() is None:
        raise HTTPException(status_code=400, detail="Server is already running")
    
    # Check if gated model requires HF token
    # Meta Llama models (official and RedHatAI) are gated in our supported list
    model_lower = config.model.lower()
    is_gated = 'meta-llama/' in model_lower or 'redhatai/llama' in model_lower
    
    if is_gated and not config.hf_token:
        raise HTTPException(
            status_code=400, 
            detail=f"This model ({config.model}) is gated and requires a HuggingFace token. Please provide your HF token."
        )
    
    try:
        # Check if user manually selected CPU mode (takes precedence)
        if config.use_cpu:
            logger.info("CPU mode manually selected by user")
            await broadcast_log("[WEBUI] Using CPU mode (manual selection)")
        else:
            # Auto-detect macOS and enable CPU mode
            import platform
            is_macos = platform.system() == "Darwin"
            
            if is_macos:
                config.use_cpu = True
                logger.info("Detected macOS - enabling CPU mode")
                await broadcast_log("[WEBUI] Detected macOS - using CPU mode")
        
        # Set environment variables for CPU mode
        env = os.environ.copy()
        
        # Set HuggingFace token if provided (for gated models like Llama, Gemma)
        if config.hf_token:
            env['HF_TOKEN'] = config.hf_token
            env['HUGGING_FACE_HUB_TOKEN'] = config.hf_token  # Alternative name
            await broadcast_log("[WEBUI] HuggingFace token configured for gated models")
        elif os.environ.get('HF_TOKEN'):
            await broadcast_log("[WEBUI] Using HF_TOKEN from environment")
        
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
        else:
            await broadcast_log("[WEBUI] Using GPU mode")
        
        # Build command
        cmd = [
            sys.executable,
            "-m", "vllm.entrypoints.openai.api_server",
            "--model", config.model,
            "--host", config.host,
            "--port", str(config.port),
        ]
        
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
        elif config.use_cpu:
            # CPU mode: Use conservative defaults (2048)
            max_len = 2048
            cmd.extend(["--max-model-len", str(max_len)])
            cmd.extend(["--max-num-batched-tokens", str(max_len)])
            await broadcast_log(f"[WEBUI] Using default max-model-len for CPU: {max_len}")
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
        
        logger.info(f"Starting vLLM with command: {' '.join(cmd)}")
        await broadcast_log(f"[WEBUI] Command: {' '.join(cmd)}")
        
        # Start process with environment variables
        # Use line buffering (bufsize=1) and ensure output is captured
        vllm_process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1,  # Line buffered
            env=env
        )
        
        current_config = config
        server_start_time = datetime.now()
        
        # Start log reader task
        asyncio.create_task(read_logs())
        
        await broadcast_log(f"[WEBUI] vLLM server starting with PID: {vllm_process.pid}")
        await broadcast_log(f"[WEBUI] Model: {config.model}")
        if config.use_cpu:
            await broadcast_log(f"[WEBUI] Mode: CPU (KV Cache: {config.cpu_kvcache_space}GB)")
        else:
            await broadcast_log(f"[WEBUI] Mode: GPU (Memory: {int(config.gpu_memory_utilization * 100)}%)")
        
        return {"status": "started", "pid": vllm_process.pid}
    
    except Exception as e:
        logger.error(f"Failed to start server: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/stop")
async def stop_server():
    """Stop the vLLM server"""
    global vllm_process, server_start_time
    
    if vllm_process is None:
        raise HTTPException(status_code=400, detail="Server is not running")
    
    try:
        await broadcast_log("[WEBUI] Stopping vLLM server...")
        vllm_process.terminate()
        
        # Wait for process to terminate
        try:
            vllm_process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            vllm_process.kill()
            await broadcast_log("[WEBUI] Force killed vLLM server")
        
        vllm_process = None
        server_start_time = None
        await broadcast_log("[WEBUI] vLLM server stopped")
        
        return {"status": "stopped"}
    
    except Exception as e:
        logger.error(f"Failed to stop server: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def read_logs():
    """Read logs from vLLM process"""
    global vllm_process
    
    if vllm_process is None:
        return
    
    try:
        # Use a loop to continuously read output
        loop = asyncio.get_event_loop()
        
        while vllm_process is not None and vllm_process.poll() is None:
            # Read line in a non-blocking way
            try:
                line = await loop.run_in_executor(None, vllm_process.stdout.readline)
                if line:
                    # Strip whitespace and send to clients
                    line = line.strip()
                    if line:  # Only send non-empty lines
                        await broadcast_log(line)
                        logger.debug(f"vLLM: {line}")
                else:
                    # No data, small sleep to prevent busy waiting
                    await asyncio.sleep(0.1)
            except Exception as e:
                logger.error(f"Error reading line: {e}")
                await asyncio.sleep(0.1)
        
        # Process has ended - read any remaining output
        if vllm_process is not None:
            remaining_output = vllm_process.stdout.read()
            if remaining_output:
                for line in remaining_output.splitlines():
                    line = line.strip()
                    if line:
                        await broadcast_log(line)
            
            # Log process exit
            return_code = vllm_process.returncode
            if return_code == 0:
                await broadcast_log(f"[WEBUI] vLLM process ended normally (exit code: {return_code})")
            else:
                await broadcast_log(f"[WEBUI] vLLM process ended with code: {return_code}")
    
    except Exception as e:
        logger.error(f"Error reading logs: {e}")
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


class ChatRequestWithStopTokens(BaseModel):
    """Chat request structure with optional stop tokens override"""
    messages: List[ChatMessage]
    temperature: float = 0.7
    max_tokens: int = 256
    stream: bool = True
    stop_tokens: Optional[List[str]] = None  # Allow overriding stop tokens per request


@app.post("/api/chat")
async def chat(request: ChatRequestWithStopTokens):
    """Proxy chat requests to vLLM server using OpenAI-compatible /v1/chat/completions endpoint"""
    global current_config
    
    if vllm_process is None or vllm_process.poll() is not None:
        raise HTTPException(status_code=400, detail="vLLM server is not running")
    
    if current_config is None:
        raise HTTPException(status_code=400, detail="Server configuration not available")
    
    try:
        import aiohttp
        
        # Use OpenAI-compatible chat completions endpoint
        # vLLM will automatically handle chat template formatting using the model's tokenizer config
        url = f"http://{current_config.host}:{current_config.port}/v1/chat/completions"
        
        # Convert messages to OpenAI format
        messages_dict = [{"role": m.role, "content": m.content} for m in request.messages]
        
        # Build payload for OpenAI-compatible endpoint
        payload = {
            "model": current_config.model,
            "messages": messages_dict,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "stream": request.stream,
        }
        
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
            async with aiohttp.ClientSession() as session:
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
                    # Stream the response line by line
                    # OpenAI-compatible chat completions format
                    async for line in response.content:
                        if line:
                            decoded_line = line.decode('utf-8')
                            # Log each chunk received
                            if decoded_line.strip() and decoded_line.strip() != "data: [DONE]":
                                logger.debug(f"vLLM chunk: {decoded_line.strip()}")
                                # Try to extract content from SSE data
                                import json
                                if decoded_line.startswith("data: "):
                                    try:
                                        data_str = decoded_line[6:].strip()
                                        if data_str and data_str != "[DONE]":
                                            data = json.loads(data_str)
                                            if 'choices' in data and len(data['choices']) > 0:
                                                delta = data['choices'][0].get('delta', {})
                                                content = delta.get('content', '')
                                                if content:
                                                    full_response_text += content
                                    except:
                                        pass
                            # Pass through the SSE formatted data
                            if decoded_line.strip():
                                yield decoded_line
                    
                    # Log the complete response
                    logger.info(f"=== vLLM COMPLETE RESPONSE ===")
                    logger.info(f"Full text: {full_response_text}")
                    logger.info(f"Length: {len(full_response_text)} chars")
                    logger.info(f"===============================")
        
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
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload) as response:
                    if response.status != 200:
                        text = await response.text()
                        logger.error(f"=== vLLM ERROR RESPONSE (non-streaming) ===")
                        logger.error(f"Status: {response.status}")
                        logger.error(f"Error: {text}")
                        logger.error(f"===========================================")
                        raise HTTPException(status_code=response.status, detail=text)
                    
                    data = await response.json()
                    # Log the complete response
                    logger.info(f"=== vLLM RESPONSE (non-streaming) ===")
                    logger.info(f"Full response: {data}")
                    if 'choices' in data and len(data['choices']) > 0:
                        message = data['choices'][0].get('message', {})
                        content = message.get('content', '')
                        logger.info(f"Response text: {content}")
                        logger.info(f"Length: {len(content)} chars")
                    logger.info(f"=====================================")
                    return data
    
    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class CompletionRequest(BaseModel):
    """Completion request structure for non-chat models"""
    prompt: str
    temperature: float = 0.7
    max_tokens: int = 256


@app.post("/api/completion")
async def completion(request: CompletionRequest):
    """Proxy completion requests to vLLM server for base models"""
    global current_config
    
    if vllm_process is None or vllm_process.poll() is not None:
        raise HTTPException(status_code=400, detail="vLLM server is not running")
    
    if current_config is None:
        raise HTTPException(status_code=400, detail="Server configuration not available")
    
    try:
        import aiohttp
        
        url = f"http://{current_config.host}:{current_config.port}/v1/completions"
        
        payload = {
            "model": current_config.model,
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
        {"name": "meta-llama/Llama-3.2-1B", "size": "1B", "description": "Llama 3.2 1B (CPU-friendly, gated)", "cpu_friendly": True, "gated": True},
        
        # Larger models (may be slow on CPU)
        {"name": "mistralai/Mistral-7B-Instruct-v0.2", "size": "7B", "description": "Mistral Instruct (slow on CPU)", "cpu_friendly": False},
        {"name": "RedHatAI/Llama-3.2-1B-Instruct-FP8", "size": "1B", "description": "Llama 3.2 1B Instruct FP8 (GPU-optimized, gated)", "cpu_friendly": False, "gated": True},
        {"name": "RedHatAI/Llama-3.1-8B-Instruct", "size": "8B", "description": "Llama 3.1 8B Instruct (gated)", "cpu_friendly": False, "gated": True},
    ]
    
    return {"models": common_models}


@app.get("/api/chat/template")
async def get_chat_template():
    """
    Get information about the chat template being used by the currently loaded model.
    vLLM auto-detects templates from tokenizer_config.json - this endpoint provides reference info.
    """
    global current_config, vllm_process
    
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


@app.get("/api/vllm/metrics")
async def get_vllm_metrics():
    """Get vLLM server metrics including KV cache and prefix cache stats"""
    global current_config, vllm_process, latest_vllm_metrics, metrics_timestamp
    
    if vllm_process is None or vllm_process.poll() is not None:
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
    """Start a benchmark test using simple load testing"""
    global vllm_process, current_config, benchmark_task, benchmark_results
    
    if vllm_process is None or vllm_process.poll() is not None:
        raise HTTPException(status_code=400, detail="vLLM server is not running")
    
    if benchmark_task is not None and not benchmark_task.done():
        raise HTTPException(status_code=400, detail="Benchmark is already running")
    
    try:
        # Reset results
        benchmark_results = None
        
        # Start benchmark task
        benchmark_task = asyncio.create_task(
            run_benchmark(config, current_config)
        )
        
        await broadcast_log("[BENCHMARK] Starting performance benchmark...")
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
            return {"running": False, "results": benchmark_results.dict()}
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
    global benchmark_results
    
    try:
        import aiohttp
        import time
        import random
        import numpy as np
        
        await broadcast_log(f"[BENCHMARK] Configuration: {config.total_requests} requests at {config.request_rate} req/s")
        
        url = f"http://{server_config.host}:{server_config.port}/v1/chat/completions"
        
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
                        "model": server_config.model,
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


# ============ Compression Endpoints ============

@app.get("/api/compress/presets")
async def get_compression_presets() -> Dict[str, List[CompressionPreset]]:
    """Get predefined compression presets"""
    presets = [
        CompressionPreset(
            name="Quick INT8",
            description="Fast W8A8 quantization with GPTQ - great balance of speed and quality",
            quantization_format="W8A8_INT8",
            algorithm="GPTQ",
            emoji="⚡",
            expected_speedup="2-3x faster",
            size_reduction="~50% smaller"
        ),
        CompressionPreset(
            name="Compact INT4",
            description="W4A16 quantization with AWQ - maximum compression with good quality",
            quantization_format="W4A16",
            algorithm="AWQ",
            emoji="📦",
            expected_speedup="1.5-2x faster",
            size_reduction="~75% smaller"
        ),
        CompressionPreset(
            name="Production FP8",
            description="FP8 activation quantization - production-grade performance",
            quantization_format="W8A8_FP8",
            algorithm="GPTQ",
            emoji="🚀",
            expected_speedup="3-4x faster",
            size_reduction="~50% smaller"
        ),
        CompressionPreset(
            name="Maximum Compression",
            description="W4A4 FP4 quantization - highest compression ratio",
            quantization_format="FP4_W4A4",
            algorithm="GPTQ",
            emoji="🎯",
            expected_speedup="4-5x faster",
            size_reduction="~85% smaller"
        ),
        CompressionPreset(
            name="Smooth Quantization",
            description="W8A8 with SmoothQuant - best for accuracy-sensitive tasks",
            quantization_format="W8A8_INT8",
            algorithm="SmoothQuant",
            emoji="✨",
            expected_speedup="2-3x faster",
            size_reduction="~50% smaller"
        ),
    ]
    
    return {"presets": presets}


@app.post("/api/compress/start")
async def start_compression(config: CompressionConfig):
    """Start model compression task"""
    global compression_task, compression_status, compression_output_dir
    
    if compression_task is not None and not compression_task.done():
        raise HTTPException(status_code=400, detail="Compression task already running")
    
    try:
        # Reset status
        compression_status = CompressionStatus(
            running=True,
            progress=0.0,
            stage="initializing",
            message="Starting compression..."
        )
        
        # Create output directory
        compression_output_dir = Path(config.output_dir)
        compression_output_dir.mkdir(parents=True, exist_ok=True)
        
        # Start compression task
        compression_task = asyncio.create_task(
            run_compression(config)
        )
        
        await broadcast_log("[COMPRESSION] Starting model compression...")
        await broadcast_log(f"[COMPRESSION] Model: {config.model}")
        await broadcast_log(f"[COMPRESSION] Format: {config.quantization_format}")
        await broadcast_log(f"[COMPRESSION] Algorithm: {config.algorithm}")
        
        return {"status": "started", "message": "Compression task started"}
    
    except Exception as e:
        logger.error(f"Failed to start compression: {e}")
        compression_status.running = False
        compression_status.stage = "error"
        compression_status.error = str(e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/compress/status")
async def get_compression_status() -> CompressionStatus:
    """Get current compression task status"""
    global compression_status
    return compression_status


@app.post("/api/compress/stop")
async def stop_compression():
    """Stop the running compression task"""
    global compression_task, compression_status
    
    if compression_task is None or compression_task.done():
        raise HTTPException(status_code=400, detail="No compression task is running")
    
    try:
        compression_task.cancel()
        compression_status.running = False
        compression_status.stage = "cancelled"
        compression_status.message = "Compression cancelled by user"
        
        await broadcast_log("[COMPRESSION] Compression task cancelled")
        return {"status": "cancelled"}
    
    except Exception as e:
        logger.error(f"Failed to stop compression: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/compress/download")
async def download_compressed_model():
    """Download the compressed model"""
    global compression_output_dir
    
    if compression_output_dir is None or not compression_output_dir.exists():
        raise HTTPException(status_code=404, detail="No compressed model available")
    
    # Create a tar.gz archive of the output directory
    import tarfile
    
    archive_path = compression_output_dir.parent / f"{compression_output_dir.name}.tar.gz"
    
    try:
        with tarfile.open(archive_path, "w:gz") as tar:
            tar.add(compression_output_dir, arcname=compression_output_dir.name)
        
        return FileResponse(
            path=archive_path,
            media_type="application/gzip",
            filename=f"{compression_output_dir.name}.tar.gz"
        )
    
    except Exception as e:
        logger.error(f"Failed to create archive: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def run_compression(config: CompressionConfig):
    """Run the compression task"""
    global compression_status
    
    try:
        # Set HF token if provided
        env = os.environ.copy()
        if config.hf_token:
            env['HF_TOKEN'] = config.hf_token
            env['HUGGING_FACE_HUB_TOKEN'] = config.hf_token
        
        compression_status.stage = "loading"
        compression_status.progress = 10.0
        compression_status.message = "Loading model and preparing for compression..."
        await broadcast_log(f"[COMPRESSION] Loading model: {config.model}")
        
        # Get original model size
        try:
            # Try to estimate model size from HF
            compression_status.original_size_mb = await estimate_model_size(config.model)
        except Exception as e:
            logger.warning(f"Could not estimate model size: {e}")
        
        compression_status.stage = "preparing"
        compression_status.progress = 20.0
        compression_status.message = "Preparing quantization recipe..."
        await broadcast_log(f"[COMPRESSION] Preparing {config.algorithm} recipe...")
        
        # Build the recipe based on configuration
        recipe = build_compression_recipe(config)
        
        compression_status.stage = "calibrating"
        compression_status.progress = 30.0
        compression_status.message = "Loading calibration dataset..."
        await broadcast_log(f"[COMPRESSION] Loading dataset: {config.dataset}")
        
        # Import llmcompressor here to avoid issues if not installed
        try:
            from llmcompressor import oneshot
        except ImportError:
            raise Exception("llmcompressor not installed. Run: pip install llmcompressor")
        
        compression_status.progress = 40.0
        compression_status.message = "Applying compression..."
        await broadcast_log(f"[COMPRESSION] Applying {config.quantization_format} quantization...")
        
        # Simulate progress during compression since llmcompressor doesn't provide callbacks
        # We'll update progress incrementally during the long-running operation
        async def run_with_progress():
            loop = asyncio.get_event_loop()
            
            # Start the compression in a background thread
            compression_future = loop.run_in_executor(
                None,
                lambda: oneshot(
                    model=config.model,
                    dataset=config.dataset,
                    recipe=recipe,
                    output_dir=config.output_dir,
                    max_seq_length=config.max_seq_length,
                    num_calibration_samples=config.num_calibration_samples,
                )
            )
            
            # Simulate progress updates while compression is running
            # Progress from 40% to 85% over the compression duration
            progress_steps = [
                (5, "Calibrating model layers..."),
                (10, "Processing attention layers..."),
                (15, "Quantizing weights..."),
                (20, "Optimizing activations..."),
                (25, "Applying compression recipe..."),
                (30, "Processing remaining layers..."),
                (35, "Finalizing quantization..."),
                (40, "Validating compressed model..."),
            ]
            
            step_idx = 0
            while not compression_future.done():
                await asyncio.sleep(5)  # Update every 5 seconds
                
                if step_idx < len(progress_steps):
                    progress_increment, message = progress_steps[step_idx]
                    compression_status.progress = min(40.0 + progress_increment, 85.0)
                    compression_status.message = message
                    await broadcast_log(f"[COMPRESSION] {message}")
                    step_idx += 1
                else:
                    # Keep incrementing slowly after all steps
                    compression_status.progress = min(compression_status.progress + 1, 85.0)
            
            # Wait for compression to complete
            return await compression_future
        
        await run_with_progress()
        
        compression_status.stage = "saving"
        compression_status.progress = 90.0
        compression_status.message = "Saving compressed model..."
        await broadcast_log(f"[COMPRESSION] 💾 Saving compressed model...")
        await broadcast_log(f"[COMPRESSION] Output directory: {config.output_dir}")
        
        # Get compressed model size
        compressed_size = get_directory_size(Path(config.output_dir))
        compression_status.compressed_size_mb = compressed_size
        
        if compression_status.original_size_mb:
            compression_status.compression_ratio = (
                compression_status.original_size_mb / compressed_size
            )
        
        compression_status.stage = "complete"
        compression_status.progress = 100.0
        compression_status.message = f"Compression complete! Saved to: {config.output_dir}"
        compression_status.output_dir = config.output_dir
        compression_status.running = False
        
        await broadcast_log(f"[COMPRESSION] ✅ Compression complete!")
        await broadcast_log(f"[COMPRESSION] " + "="*60)
        await broadcast_log(f"[COMPRESSION] 📁 SAVED TO: {config.output_dir}")
        await broadcast_log(f"[COMPRESSION] " + "="*60)
        if compression_status.original_size_mb and compression_status.compressed_size_mb:
            await broadcast_log(
                f"[COMPRESSION] Size: {compression_status.original_size_mb:.1f}MB → "
                f"{compression_status.compressed_size_mb:.1f}MB "
                f"({compression_status.compression_ratio:.2f}x reduction)"
            )
        # Also log the absolute path for clarity
        abs_path = Path(config.output_dir).resolve()
        await broadcast_log(f"[COMPRESSION] Absolute path: {abs_path}")
    
    except asyncio.CancelledError:
        compression_status.running = False
        compression_status.stage = "cancelled"
        compression_status.message = "Compression cancelled"
        await broadcast_log("[COMPRESSION] Task cancelled")
        raise
    
    except Exception as e:
        logger.error(f"Compression error: {e}", exc_info=True)
        compression_status.running = False
        compression_status.stage = "error"
        compression_status.error = str(e)
        compression_status.message = f"Error: {str(e)}"
        await broadcast_log(f"[COMPRESSION] ❌ Error: {str(e)}")


def build_compression_recipe(config: CompressionConfig) -> List:
    """Build compression recipe based on configuration"""
    recipe = []
    
    try:
        from llmcompressor.modifiers.smoothquant import SmoothQuantModifier
        from llmcompressor.modifiers.quantization import GPTQModifier, QuantizationModifier
    except ImportError:
        # Provide helpful error if llmcompressor not installed
        raise Exception("llmcompressor not installed. Run: pip install llmcompressor")
    
    # Parse target and ignore layers
    targets = config.target_layers or "Linear"
    ignore = [layer.strip() for layer in (config.ignore_layers or "lm_head").split(",")]
    
    # Build scheme based on quantization format
    scheme_map = {
        "W8A8_INT8": "W8A8",
        "W8A8_FP8": "W8A8_FP8",
        "W4A16": "W4A16",
        "W8A16": "W8A16",
        "FP4_W4A16": "W4A16",  # FP4 is handled by vLLM
        "FP4_W4A4": "W4A4",
        "W4A4": "W4A4",
    }
    
    scheme = scheme_map.get(config.quantization_format, "W8A8")
    
    # Add SmoothQuant if specified
    if config.algorithm == "SmoothQuant":
        recipe.append(
            SmoothQuantModifier(smoothing_strength=config.smoothing_strength)
        )
    
    # Add quantization modifier based on algorithm
    if config.algorithm in ["GPTQ", "SmoothQuant", "PTQ"]:
        recipe.append(
            GPTQModifier(
                scheme=scheme,
                targets=targets,
                ignore=ignore
            )
        )
    elif config.algorithm == "AWQ":
        # AWQ uses similar interface to GPTQ
        recipe.append(
            GPTQModifier(
                scheme=scheme,
                targets=targets,
                ignore=ignore
            )
        )
    
    return recipe


async def estimate_model_size(model_name: str) -> float:
    """Estimate model size in MB from HuggingFace"""
    # This is a rough estimate - in production you'd want to query HF API
    # For now, use simple heuristics based on model name
    
    model_lower = model_name.lower()
    
    # Extract model size from name (e.g., "7b", "1.1b", "8b")
    import re
    size_match = re.search(r'(\d+\.?\d*)\s*b', model_lower)
    
    if size_match:
        size_b = float(size_match.group(1))
        # Rough estimate: ~2 bytes per parameter (fp16)
        return size_b * 1024 * 2  # Convert to MB
    
    # Default estimates for common models
    if 'tinyllama' in model_lower or '1b' in model_lower:
        return 2200.0  # ~1.1B * 2 bytes
    elif '7b' in model_lower:
        return 14000.0  # ~7B * 2 bytes
    elif '8b' in model_lower:
        return 16000.0  # ~8B * 2 bytes
    elif '13b' in model_lower:
        return 26000.0  # ~13B * 2 bytes
    
    return 5000.0  # Default estimate


def get_directory_size(directory: Path) -> float:
    """Get total size of directory in MB"""
    total_size = 0
    for item in directory.rglob('*'):
        if item.is_file():
            total_size += item.stat().st_size
    return total_size / (1024 * 1024)  # Convert to MB


def main():
    """Main entry point"""
    logger.info("Starting vLLM Playground...")
    
    # Get port from environment or use default
    webui_port = int(os.environ.get("WEBUI_PORT", "7860"))
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=webui_port,
        log_level="info"
    )


if __name__ == "__main__":
    main()

