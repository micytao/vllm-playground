"""
vLLM Playground - A web interface for managing and interacting with vLLM
CONTAINERIZED VERSION - Uses Podman to run vLLM in containers
"""
import asyncio
import logging
import os
import sys
import subprocess
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

# Setup logging (must be before imports that use logger)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Import container manager (optional - only needed for container mode)
try:
    from container_manager import container_manager
    CONTAINER_MODE_AVAILABLE = True
except ImportError:
    CONTAINER_MODE_AVAILABLE = False
    logger.warning("container_manager not available - container mode will be disabled")

app = FastAPI(title="vLLM Playground", version="1.0.0")

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
    with open(html_path, "r") as f:
        return HTMLResponse(content=f.read())


@app.get("/api/status")
async def get_status() -> ServerStatus:
    """Get current server status"""
    global vllm_running, current_config, server_start_time, current_run_mode, container_id, vllm_process
    
    # Check status based on run mode
    running = False
    
    if current_run_mode == "container":
        # Check container status
        status = await container_manager.get_container_status()
        running = status.get('running', False)
    elif current_run_mode == "subprocess":
        # Check subprocess status
        if vllm_process is not None:
            running = vllm_process.returncode is None
        else:
            running = False
    else:
        # If run mode is not set (e.g., after restart), check if container exists
        # This handles the case where Web UI restarts but vLLM pod is still running
        if CONTAINER_MODE_AVAILABLE:
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
        if current_run_mode == "container" and is_kubernetes:
            service_name = getattr(container_manager, 'SERVICE_NAME', 'vllm-service')
            namespace = getattr(container_manager, 'namespace', os.getenv('KUBERNETES_NAMESPACE', 'default'))
            url = f"http://{service_name}.{namespace}.svc.cluster.local:{current_config.port}/v1/chat/completions"
            debug_info["url_would_use"] = url
            debug_info["connection_mode"] = "kubernetes_service"
        else:
            url = f"http://{current_config.host}:{current_config.port}/v1/chat/completions"
            debug_info["url_would_use"] = url
            debug_info["connection_mode"] = "localhost"
    
    if is_kubernetes and hasattr(container_manager, 'namespace'):
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
    if current_run_mode == "container" and is_kubernetes:
        service_name = getattr(container_manager, 'SERVICE_NAME', 'vllm-service')
        namespace = getattr(container_manager, 'namespace', os.getenv('KUBERNETES_NAMESPACE', 'default'))
        base_url = f"http://{service_name}.{namespace}.svc.cluster.local:{current_config.port}"
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
    features = {
        "vllm": True,  # Always available since it's core
        "guidellm": False
    }
    
    # Check guidellm
    try:
        import guidellm
        features["guidellm"] = True
    except ImportError:
        pass
    
    return features


@app.get("/api/hardware-capabilities")
async def get_hardware_capabilities():
    """
    Check GPU availability
    
    This endpoint checks if GPU hardware is available in the cluster.
    For Kubernetes/OpenShift: Checks node resources for nvidia.com/gpu
    For local/container: Falls back to nvidia-smi check
    """
    gpu_available = False
    detection_method = "none"
    
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
                # Check node capacity for nvidia.com/gpu
                if node.status and node.status.capacity:
                    gpu_capacity = node.status.capacity.get('nvidia.com/gpu', '0')
                    if gpu_capacity and int(gpu_capacity) > 0:
                        gpu_available = True
                        detection_method = "kubernetes"
                        logger.info(f"GPU detected via Kubernetes API: {node.metadata.name} has {gpu_capacity} GPUs")
                        break
                
                # Also check node labels for GPU indicators
                if node.metadata and node.metadata.labels:
                    labels = node.metadata.labels
                    if any('gpu' in k.lower() or 'nvidia' in k.lower() for k in labels.keys()):
                        # Double-check with capacity to avoid false positives
                        if node.status and node.status.capacity:
                            gpu_capacity = node.status.capacity.get('nvidia.com/gpu', '0')
                            if gpu_capacity and int(gpu_capacity) > 0:
                                gpu_available = True
                                detection_method = "kubernetes"
                                logger.info(f"GPU detected via node labels: {node.metadata.name}")
                                break
            
            if not gpu_available:
                logger.info("No GPUs found in Kubernetes cluster nodes")
                
        except ImportError:
            logger.info("Kubernetes client not available - skipping K8s GPU check")
        except Exception as e:
            logger.warning(f"Error checking GPU via Kubernetes API: {e}")
    
    # Fallback: Try nvidia-smi for local/container environments
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
                logger.info(f"GPU detected via nvidia-smi: {result.stdout.strip()}")
        except FileNotFoundError:
            logger.info("nvidia-smi not found - no local GPU detected")
        except subprocess.TimeoutExpired:
            logger.warning("nvidia-smi timeout")
        except Exception as e:
            logger.warning(f"Error checking GPU via nvidia-smi: {e}")
    
    logger.info(f"Final GPU availability: {gpu_available} (method: {detection_method})")
    return {
        "gpu_available": gpu_available,
        "detection_method": detection_method
    }


@app.get("/api/gpu-status")
async def get_gpu_status():
    """
    Get detailed GPU status information including memory usage and utilization
    """
    gpu_info = []
    
    try:
        # Use nvidia-smi to get detailed GPU information
        result = subprocess.run([
            'nvidia-smi', 
            '--query-gpu=index,name,memory.used,memory.total,memory.free,utilization.gpu,temperature.gpu',
            '--format=csv,noheader,nounits'
        ], capture_output=True, text=True, timeout=5)
        
        if result.returncode == 0 and result.stdout.strip():
            lines = result.stdout.strip().split('\n')
            for line in lines:
                parts = [p.strip() for p in line.split(',')]
                if len(parts) >= 7:
                    gpu_info.append({
                        "index": int(parts[0]),
                        "name": parts[1],
                        "memory_used": int(parts[2]),
                        "memory_total": int(parts[3]),
                        "memory_free": int(parts[4]),
                        "utilization": int(parts[5]),
                        "temperature": int(parts[6])
                    })
        
        return {
            "gpu_available": len(gpu_info) > 0,
            "gpu_count": len(gpu_info),
            "gpus": gpu_info
        }
        
    except FileNotFoundError:
        logger.info("nvidia-smi not found - no GPU status available")
        return {
            "gpu_available": False,
            "gpu_count": 0,
            "gpus": []
        }
    except subprocess.TimeoutExpired:
        logger.warning("nvidia-smi timeout")
        return {
            "gpu_available": False,
            "gpu_count": 0,
            "gpus": [],
            "error": "GPU query timeout"
        }
    except Exception as e:
        logger.warning(f"Error getting GPU status: {e}")
        return {
            "gpu_available": False,
            "gpu_count": 0,
            "gpus": [],
            "error": str(e)
        }


@app.post("/api/start")
async def start_server(config: VLLMConfig):
    """Start the vLLM server in subprocess or container mode"""
    global container_id, vllm_process, vllm_running, current_config, server_start_time, current_model_identifier, current_run_mode
    
    # Check if server is already running
    if current_run_mode == "container":
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
        if config.run_mode == "container" and not CONTAINER_MODE_AVAILABLE:
            raise HTTPException(
                status_code=400,
                detail="Container mode is not available. container_manager module not found."
            )
        
        await broadcast_log(f"[WEBUI] Run mode: {config.run_mode.upper()}")
        
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
        
        # Set GPU device selection for subprocess mode
        if not config.use_cpu and config.gpu_device and config.run_mode == "subprocess":
            env['CUDA_VISIBLE_DEVICES'] = config.gpu_device
            logger.info(f"GPU Device Selection - CUDA_VISIBLE_DEVICES={config.gpu_device}")
            await broadcast_log(f"[WEBUI] GPU Device Selection - CUDA_VISIBLE_DEVICES={config.gpu_device}")
        
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
            "--model", model_source,  # Use model_source (local path or HF model name)
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
                'local_model_path': config.local_model_path
            }
            
            # Start container
            container_info = await container_manager.start_container(vllm_config_dict)
            
            container_id = container_info['id']
            vllm_running = True
            current_config = config
            server_start_time = datetime.now()
            
            # Store the actual model identifier for use in API calls
            current_model_identifier = model_source
            
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
            
            # Start log reader task
            asyncio.create_task(read_logs_subprocess())
            
            await broadcast_log(f"[WEBUI] vLLM subprocess started (PID: {vllm_process.pid})")
            await broadcast_log(f"[WEBUI] Model: {model_display_name}")
            if config.local_model_path:
                await broadcast_log(f"[WEBUI] Model Source: Local ({model_source})")
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
    global container_id, vllm_process, vllm_running, server_start_time, current_model_identifier, current_run_mode
    
    # Check if server is running based on mode
    if current_run_mode == "container":
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
        current_run_mode = None
        
        return {"status": "stopped"}
    
    except Exception as e:
        logger.error(f"Failed to stop server: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def read_logs_container():
    """Read logs from vLLM container"""
    global vllm_running
    
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
    global current_config, current_model_identifier, vllm_running, current_run_mode
    
    # Check server status based on mode
    if current_run_mode == "container":
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
            url = f"http://{current_config.host}:{current_config.port}/v1/chat/completions"
            logger.info(f"✓ Using localhost URL: {url}")
        
        logger.info(f"=====================================")
        
        # Convert messages to OpenAI format
        messages_dict = [{"role": m.role, "content": m.content} for m in request.messages]
        
        # Build payload for OpenAI-compatible endpoint
        # Use current_model_identifier (actual path or HF model) instead of config.model
        payload = {
            "model": current_model_identifier if current_model_identifier else current_config.model,
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
                                                            delta = data['choices'][0].get('delta', {})
                                                            content = delta.get('content', '')
                                                            if content:
                                                                full_response_text += content
                                                except:
                                                    pass
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
    global current_config, current_model_identifier, current_run_mode
    
    # Check server status based on mode
    if current_run_mode == "container":
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
            url = f"http://{current_config.host}:{current_config.port}/v1/completions"
            logger.info(f"Using localhost URL: {url}")
        
        payload = {
            "model": current_model_identifier if current_model_identifier else current_config.model,
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
        {"name": "mistralai/Mistral-7B-Instruct-v0.2", "size": "7B", "description": "Mistral Instruct (slow on CPU)", "cpu_friendly": False},
        {"name": "RedHatAI/Llama-3.2-1B-Instruct-FP8", "size": "1B", "description": "Llama 3.2 1B Instruct FP8 (GPU-optimized, gated)", "cpu_friendly": False, "gated": True},
        {"name": "RedHatAI/Llama-3.1-8B-Instruct", "size": "8B", "description": "Llama 3.1 8B Instruct (gated)", "cpu_friendly": False, "gated": True},
    ]
    
    return {"models": common_models}


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


@app.get("/api/vllm/metrics")
async def get_vllm_metrics():
    """Get vLLM server metrics including KV cache and prefix cache stats"""
    global current_config, latest_vllm_metrics, metrics_timestamp, current_run_mode
    
    # Check server status based on mode
    if current_run_mode == "container":
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
    if current_run_mode == "container":
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
            url = f"http://{server_config.host}:{server_config.port}/v1/chat/completions"
            logger.info(f"Using localhost URL for benchmark: {url}")
        
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
                        "model": current_model_identifier if current_model_identifier else server_config.model,
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

