"""
vLLM WebUI - A web interface for managing and interacting with vLLM
"""
import asyncio
import logging
import os
import subprocess
import sys
from datetime import datetime
from typing import Optional, List, Dict, Any
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(title="vLLM WebUI", version="1.0.0")

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


class ChatMessage(BaseModel):
    """Chat message structure"""
    role: str
    content: str


class ChatRequest(BaseModel):
    """Chat request structure"""
    messages: List[ChatMessage]
    temperature: float = 0.7
    max_tokens: int = 512
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


current_config: Optional[VLLMConfig] = None
server_start_time: Optional[datetime] = None
benchmark_task: Optional[asyncio.Task] = None
benchmark_results: Optional[BenchmarkResults] = None


def get_chat_template_for_model(model_name: str) -> str:
    """
    Get the appropriate chat template for a specific model.
    Returns model-specific template if available, otherwise returns a generic template.
    """
    model_lower = model_name.lower()
    
    # Llama 2/3 models
    if 'llama-2' in model_lower or 'llama-3' in model_lower:
        return "{% for message in messages %}{% if message['role'] == 'system' %}<<SYS>>\\n{{ message['content'] }}\\n<</SYS>>\\n\\n{% endif %}{% if message['role'] == 'user' %}[INST] {{ message['content'] }} [/INST]{% endif %}{% if message['role'] == 'assistant' %} {{ message['content'] }}</s>{% endif %}{% endfor %}"
    
    # Mistral models
    elif 'mistral' in model_lower or 'mixtral' in model_lower:
        return "{% for message in messages %}{% if message['role'] == 'user' %}[INST] {{ message['content'] }} [/INST]{% endif %}{% if message['role'] == 'assistant' %}{{ message['content'] }}</s>{% endif %}{% endfor %}"
    
    # Gemma models (use ChatML-style)
    elif 'gemma' in model_lower:
        return "{% for message in messages %}{% if message['role'] == 'user' %}<start_of_turn>user\\n{{ message['content'] }}<end_of_turn>\\n{% endif %}{% if message['role'] == 'assistant' %}<start_of_turn>model\\n{{ message['content'] }}<end_of_turn>\\n{% endif %}{% endfor %}<start_of_turn>model\\n"
    
    # TinyLlama and similar (use ChatML) - fixed to always add generation prompt
    elif 'tinyllama' in model_lower or 'tiny-llama' in model_lower:
        return "{% for message in messages %}{% if message['role'] == 'system' %}<|system|>\\n{{ message['content'] }}</s>\\n{% endif %}{% if message['role'] == 'user' %}<|user|>\\n{{ message['content'] }}</s>\\n{% endif %}{% if message['role'] == 'assistant' %}<|assistant|>\\n{{ message['content'] }}</s>\\n{% endif %}{% endfor %}<|assistant|>\\n"
    
    # Vicuna models
    elif 'vicuna' in model_lower:
        return "{% for message in messages %}{% if message['role'] == 'system' %}{{ message['content'] }}\\n\\n{% endif %}{% if message['role'] == 'user' %}USER: {{ message['content'] }}\\n{% endif %}{% if message['role'] == 'assistant' %}ASSISTANT: {{ message['content'] }}</s>\\n{% endif %}{% endfor %}ASSISTANT:"
    
    # Alpaca models
    elif 'alpaca' in model_lower:
        return "{% for message in messages %}{% if message['role'] == 'system' %}{{ message['content'] }}\\n\\n{% endif %}{% if message['role'] == 'user' %}### Instruction:\\n{{ message['content'] }}\\n\\n{% endif %}{% if message['role'] == 'assistant' %}### Response:\\n{{ message['content'] }}\\n\\n{% endif %}{% endfor %}### Response:"
    
    # CodeLlama
    elif 'codellama' in model_lower or 'code-llama' in model_lower:
        return "{% for message in messages %}{% if message['role'] == 'system' %}<<SYS>>\\n{{ message['content'] }}\\n<</SYS>>\\n\\n{% endif %}{% if message['role'] == 'user' %}[INST] {{ message['content'] }} [/INST]{% endif %}{% if message['role'] == 'assistant' %} {{ message['content'] }}</s>{% endif %}{% endfor %}"
    
    # OPT and other base models (generic simple format)
    elif 'opt' in model_lower:
        return "{% for message in messages %}{% if message['role'] == 'user' %}User: {{ message['content'] }}\\n{% elif message['role'] == 'assistant' %}Assistant: {{ message['content'] }}\\n{% elif message['role'] == 'system' %}{{ message['content'] }}\\n{% endif %}{% endfor %}Assistant:"
    
    # Default generic template for unknown models
    else:
        logger.info(f"Using generic chat template for model: {model_name}")
        return "{% for message in messages %}{% if message['role'] == 'user' %}User: {{ message['content'] }}\\n{% elif message['role'] == 'assistant' %}Assistant: {{ message['content'] }}\\n{% elif message['role'] == 'system' %}{{ message['content'] }}\\n{% endif %}{% endfor %}Assistant:"


def get_stop_tokens_for_model(model_name: str) -> List[str]:
    """
    Get appropriate stop tokens for a specific model.
    Uses only special tokens that won't appear in natural text.
    """
    model_lower = model_name.lower()
    
    # Llama models - use special tokens only
    if 'llama' in model_lower:
        return ["[INST]", "</s>", "<s>", "[/INST] [INST]"]
    
    # Mistral models - use special tokens only
    elif 'mistral' in model_lower or 'mixtral' in model_lower:
        return ["[INST]", "</s>", "[/INST] [INST]"]
    
    # Gemma models - use special tokens only
    elif 'gemma' in model_lower:
        return ["<start_of_turn>", "<end_of_turn>"]
    
    # TinyLlama - use aggressive stop tokens to prevent rambling and repetition
    elif 'tinyllama' in model_lower or 'tiny-llama' in model_lower:
        return [
            "<|user|>", "<|system|>", "</s>",
            "\n\n",  # Stop at double newlines
            " #", "😊", "🤗", "🎉", "❤️",  # Stop at hashtags and emojis
            "User:", "Assistant:",  # Stop at leaked template markers
            "How about you?",  # Stop at repetitive questions
            "I'm doing",  # Stop at repetitive statements
        ]
    
    # Vicuna
    elif 'vicuna' in model_lower:
        return ["USER:", "ASSISTANT:", "</s>"]
    
    # Alpaca
    elif 'alpaca' in model_lower:
        return ["### Instruction:", "### Response:"]
    
    # Default generic stop tokens - use patterns that indicate new turn, not template markers
    # Use double newline + marker to avoid matching the template itself
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
        
        # Add chat template for models that don't have one (required for transformers v4.44+)
        # Use custom template if provided, otherwise auto-detect
        if config.custom_chat_template:
            chat_template = config.custom_chat_template
            await broadcast_log(f"[WEBUI] Using CUSTOM chat template")
        else:
            chat_template = get_chat_template_for_model(config.model)
            await broadcast_log(f"[WEBUI] Using auto-detected chat template for: {config.model}")
        
        cmd.extend(["--chat-template", chat_template])
        
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
        
        while vllm_process.poll() is None:
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
    global latest_vllm_metrics
    
    if not message:
        return
    
    # Parse metrics from log messages with more flexible patterns
    import re
    
    # Try various patterns for KV cache usage
    # Examples: "GPU KV cache usage: 0.3%", "KV cache usage: 0.3%", "cache usage: 0.3%"
    if "cache usage" in message.lower() and "%" in message:
        # More flexible pattern - match any number before %
        match = re.search(r'cache usage[:\s]+([\d.]+)\s*%', message, re.IGNORECASE)
        if match:
            cache_usage = float(match.group(1))
            latest_vllm_metrics['kv_cache_usage_perc'] = cache_usage
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
            logger.info(f"✓ Captured prefix cache hit rate: {hit_rate}% from: {message[:100]}")
        else:
            logger.debug(f"Failed to parse hit rate from: {message[:100]}")
    
    # Try to parse avg prompt throughput
    if "prompt throughput" in message.lower():
        match = re.search(r'prompt throughput[:\s]+([\d.]+)', message, re.IGNORECASE)
        if match:
            prompt_throughput = float(match.group(1))
            latest_vllm_metrics['avg_prompt_throughput'] = prompt_throughput
            logger.info(f"✓ Captured prompt throughput: {prompt_throughput}")
    
    # Try to parse avg generation throughput
    if "generation throughput" in message.lower():
        match = re.search(r'generation throughput[:\s]+([\d.]+)', message, re.IGNORECASE)
        if match:
            generation_throughput = float(match.group(1))
            latest_vllm_metrics['avg_generation_throughput'] = generation_throughput
            logger.info(f"✓ Captured generation throughput: {generation_throughput}")
    
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


@app.post("/api/chat")
async def chat(request: ChatRequest):
    """Proxy chat requests to vLLM server"""
    global current_config
    
    if vllm_process is None or vllm_process.poll() is not None:
        raise HTTPException(status_code=400, detail="vLLM server is not running")
    
    if current_config is None:
        raise HTTPException(status_code=400, detail="Server configuration not available")
    
    try:
        import aiohttp
        
        url = f"http://{current_config.host}:{current_config.port}/v1/chat/completions"
        
        # Get stop tokens - use custom if provided, otherwise auto-detect
        if current_config.custom_stop_tokens:
            stop_tokens = current_config.custom_stop_tokens
            logger.info(f"Using CUSTOM stop tokens: {stop_tokens}")
        else:
            stop_tokens = get_stop_tokens_for_model(current_config.model)
            logger.info(f"Using auto-detected stop tokens for {current_config.model}: {stop_tokens}")
        
        payload = {
            "model": current_config.model,
            "messages": [{"role": m.role, "content": m.content} for m in request.messages],
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "stream": request.stream,
            # Stop tokens to prevent the model from continuing beyond the assistant's response
            "stop": stop_tokens
        }
        
        async def generate_stream():
            """Generator for streaming responses"""
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload) as response:
                    if response.status != 200:
                        text = await response.text()
                        yield f"data: {{'error': '{text}'}}\n\n"
                        return
                    
                    # Stream the response line by line
                    async for line in response.content:
                        if line:
                            decoded_line = line.decode('utf-8')
                            # Pass through the SSE formatted data
                            if decoded_line.strip():
                                yield decoded_line
        
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
                        raise HTTPException(status_code=response.status, detail=text)
                    
                    data = await response.json()
                    return data
    
    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class CompletionRequest(BaseModel):
    """Completion request structure for non-chat models"""
    prompt: str
    temperature: float = 0.7
    max_tokens: int = 512


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
        {"name": "facebook/opt-125m", "size": "125M", "description": "Tiny test model (fastest)", "cpu_friendly": True},
        {"name": "TinyLlama/TinyLlama-1.1B-Chat-v1.0", "size": "1.1B", "description": "Compact chat model (CPU-friendly)", "cpu_friendly": True},
        {"name": "meta-llama/Llama-3.2-1B", "size": "1B", "description": "Llama 3.2 1B (CPU-friendly, gated)", "cpu_friendly": True, "gated": True},
        {"name": "google/gemma-2-2b", "size": "2B", "description": "Gemma 2 2B (CPU-friendly, gated)", "cpu_friendly": True, "gated": True},
        
        # Larger models (may be slow on CPU)
        {"name": "facebook/opt-1.3b", "size": "1.3B", "description": "OPT 1.3B", "cpu_friendly": True},
        {"name": "facebook/opt-2.7b", "size": "2.7B", "description": "OPT 2.7B", "cpu_friendly": False},
        {"name": "meta-llama/Llama-2-7b-chat-hf", "size": "7B", "description": "Llama 2 Chat (slow on CPU, gated)", "cpu_friendly": False, "gated": True},
        {"name": "mistralai/Mistral-7B-Instruct-v0.2", "size": "7B", "description": "Mistral Instruct (slow on CPU)", "cpu_friendly": False},
        {"name": "codellama/CodeLlama-7b-Instruct-hf", "size": "7B", "description": "Code Llama (slow on CPU)", "cpu_friendly": False},
    ]
    
    return {"models": common_models}


@app.get("/api/vllm/metrics")
async def get_vllm_metrics():
    """Get vLLM server metrics including KV cache and prefix cache stats"""
    global current_config, vllm_process, latest_vllm_metrics
    
    if vllm_process is None or vllm_process.poll() is not None:
        return JSONResponse(
            status_code=400, 
            content={"error": "vLLM server is not running"}
        )
    
    # Log what we have for debugging
    logger.info(f"Returning metrics: {latest_vllm_metrics}")
    
    # Return metrics parsed from logs
    if latest_vllm_metrics:
        return latest_vllm_metrics
    
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
                    # Get stop tokens - use custom if provided, otherwise auto-detect
                    if server_config.custom_stop_tokens:
                        stop_tokens = server_config.custom_stop_tokens
                    else:
                        stop_tokens = get_stop_tokens_for_model(server_config.model)
                    
                    payload = {
                        "model": server_config.model,
                        "messages": [{"role": "user", "content": prompt_text}],
                        "max_tokens": config.output_tokens,
                        "temperature": 0.7,
                        "stop": stop_tokens
                    }
                    
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


def main():
    """Main entry point"""
    logger.info("Starting vLLM WebUI...")
    
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

