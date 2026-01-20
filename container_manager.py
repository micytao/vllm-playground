"""
Container Manager for vLLM Service
Handles starting/stopping vLLM containers using Podman or Docker CLI
Uses subprocess for maximum compatibility on macOS
"""

import asyncio
import logging
import os
import json
import platform
import shutil
import subprocess
import time
from typing import Optional, Dict, Any, AsyncIterator

logger = logging.getLogger(__name__)


def detect_container_runtime() -> Optional[str]:
    """
    Detect available container runtime.
    
    Returns:
        'podman' if Podman is available
        'docker' if Docker is available (and Podman is not)
        None if neither is available
    """
    # Check for Podman first (preferred)
    if shutil.which("podman"):
        logger.info("Container runtime detected: podman")
        return "podman"
    
    # Fall back to Docker
    if shutil.which("docker"):
        logger.info("Container runtime detected: docker")
        return "docker"
    
    logger.warning("No container runtime found (neither podman nor docker available)")
    return None


class VLLMContainerManager:
    """Manages vLLM container lifecycle using Podman CLI"""
    
    CONTAINER_NAME = "vllm-service"
    
    # Default images for different platforms and accelerators (must use fully-qualified names for Podman)
    # GPU images by accelerator type
    DEFAULT_IMAGE_GPU_NVIDIA = "docker.io/vllm/vllm-openai:v0.11.0"  # Official vLLM CUDA image (linux/amd64)
    DEFAULT_IMAGE_GPU_AMD = "docker.io/rocm/vllm:latest"  # Official vLLM ROCm image from AMD
    DEFAULT_IMAGE_GPU_TPU = "docker.io/vllm/vllm-tpu:latest"  # Official vLLM TPU image for Google Cloud TPU
    # CPU images by platform
    DEFAULT_IMAGE_CPU_MACOS = "quay.io/rh_ee_micyang/vllm-mac:v0.11.0"  # CPU image for macOS (linux/arm64)
    DEFAULT_IMAGE_CPU_X86 = "quay.io/rh_ee_micyang/vllm-cpu:v0.11.0"  # CPU image for x86_64 Linux
    
    def __init__(self, container_runtime: str = "podman", use_sudo: bool = None):
        """
        Initialize container manager
        
        Args:
            container_runtime: Container runtime to use (podman or docker)
            use_sudo: Run container commands with sudo.
                      Default behavior:
                      - macOS: False (Docker Desktop and Podman run rootless)
                      - Linux: True (for consistent GPU access and container namespace)
                      Override with VLLM_USE_SUDO environment variable.
        """
        self.runtime = container_runtime
        
        # Determine sudo behavior based on platform and environment
        if use_sudo is None:
            sudo_env = os.environ.get("VLLM_USE_SUDO")
            if sudo_env is not None:
                # Explicit environment override
                self.use_sudo = sudo_env.lower() not in ("false", "0", "no")
            elif platform.system() == "Darwin":
                # macOS: Default to no sudo (Docker Desktop and Podman run rootless)
                self.use_sudo = False
                logger.info("macOS detected - running containers without sudo (rootless mode)")
            else:
                # Linux: Default to sudo for consistent GPU access
                self.use_sudo = True
        else:
            self.use_sudo = use_sudo
        
        if self.use_sudo:
            logger.info("Container manager initialized with sudo enabled")
    
    def get_default_image(self, use_cpu: bool = False, accelerator: str = "nvidia") -> str:
        """
        Get the appropriate container image based on platform, CPU/GPU mode, and accelerator type.
        
        Image selection:
        1. CPU mode: Select based on platform
           - macOS (ARM64): quay.io/rh_ee_micyang/vllm-mac:v0.11.0
           - Linux x86_64: quay.io/rh_ee_micyang/vllm-cpu:v0.11.0
        2. GPU mode: Select based on accelerator type
           - nvidia: docker.io/vllm/vllm-openai:v0.11.0 (Official CUDA image)
           - amd: docker.io/rocm/vllm:latest (Official ROCm image)
           - tpu: docker.io/vllm/vllm-tpu:latest (Official TPU image for Google Cloud)
        
        Args:
            use_cpu: Whether CPU mode is enabled
            accelerator: GPU accelerator type ("nvidia", "amd", or "tpu"), only used when use_cpu=False
            
        Returns:
            Container image name
        """
        # Return appropriate default based on mode and platform
        if use_cpu:
            # Detect platform for CPU image selection
            system = platform.system()
            machine = platform.machine()
            
            if system == "Darwin" or machine in ("arm64", "aarch64"):
                # macOS or ARM64 architecture
                logger.info(f"Detected platform: {system}/{machine} - using macOS/ARM64 CPU image")
                return self.DEFAULT_IMAGE_CPU_MACOS
            else:
                # Linux x86_64 or other
                logger.info(f"Detected platform: {system}/{machine} - using x86_64 CPU image")
                return self.DEFAULT_IMAGE_CPU_X86
        
        # GPU mode - select based on accelerator
        if accelerator == "amd":
            logger.info("Using AMD ROCm GPU image")
            return self.DEFAULT_IMAGE_GPU_AMD
        elif accelerator == "tpu":
            logger.info("Using Google Cloud TPU image")
            return self.DEFAULT_IMAGE_GPU_TPU
        else:
            # Default to NVIDIA
            logger.info("Using NVIDIA CUDA GPU image")
            return self.DEFAULT_IMAGE_GPU_NVIDIA
        
    def _should_use_sudo(self) -> bool:
        """
        Determine if sudo should be used for container commands.
        
        Platform-aware defaults:
        - macOS: False (Docker Desktop and Podman run rootless)
        - Linux: True (for consistent GPU access and container namespace)
        
        Override with VLLM_USE_SUDO environment variable.
        """
        return self.use_sudo
    
    def _run_podman_cmd(self, *args, capture_output=True, check=True) -> subprocess.CompletedProcess:
        """Run a podman command (with sudo if needed)"""
        if self._should_use_sudo():
            cmd = ["sudo", self.runtime] + list(args)
        else:
            cmd = [self.runtime] + list(args)
        result = subprocess.run(cmd, capture_output=capture_output, text=True, check=check)
        return result
    
    async def _run_podman_cmd_async(self, *args, capture_output=True, check=True) -> subprocess.CompletedProcess:
        """Run a podman command asynchronously"""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, lambda: self._run_podman_cmd(*args, capture_output=capture_output, check=check))
    
    def _detect_tool_call_parser(self, model_name: str) -> Optional[str]:
        """
        Auto-detect the appropriate tool call parser based on model name.
        
        Returns the parser name or None if no suitable parser is detected.
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
            return 'hermes'
        
        return None
    
    def build_container_config(self, vllm_config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Build container configuration from vLLM config
        Uses environment variables to pass config to container's startup script
        
        Args:
            vllm_config: Dictionary containing vLLM configuration parameters
            
        Returns:
            Dictionary with container configuration (environment, volumes, ports)
        """
        # Prepare environment variables for the container's start_vllm.sh script
        env = []
        
        # Core vLLM parameters (read by start_vllm.sh)
        env.extend(["-e", f"VLLM_MODEL={vllm_config.get('model_source', vllm_config.get('model'))}"])
        env.extend(["-e", "VLLM_HOST=0.0.0.0"])  # Must be 0.0.0.0 inside container
        env.extend(["-e", f"VLLM_PORT=8000"])  # Internal port (mapped to host)
        
        # Dtype
        if vllm_config.get('use_cpu', False) and vllm_config.get('dtype', 'auto') == 'auto':
            env.extend(["-e", "VLLM_DTYPE=bfloat16"])
        else:
            env.extend(["-e", f"VLLM_DTYPE={vllm_config.get('dtype', 'auto')}"])
        
        # Max model length - set default for CPU mode to avoid memory issues
        max_model_len = vllm_config.get('max_model_len')
        if max_model_len:
            env.extend(["-e", f"VLLM_MAX_MODEL_LEN={max_model_len}"])
            env.extend(["-e", f"VLLM_MAX_NUM_BATCHED_TOKENS={max_model_len}"])
        elif vllm_config.get('use_cpu', False):
            # CPU mode: Use conservative default (2048) to avoid memory issues
            env.extend(["-e", "VLLM_MAX_MODEL_LEN=2048"])
            env.extend(["-e", "VLLM_MAX_NUM_BATCHED_TOKENS=2048"])
            logger.info("Using default max_model_len=2048 for CPU mode")
        else:
            # GPU mode: Use reasonable default (8192)
            env.extend(["-e", "VLLM_MAX_MODEL_LEN=8192"])
            env.extend(["-e", "VLLM_MAX_NUM_BATCHED_TOKENS=8192"])
            logger.info("Using default max_model_len=8192 for GPU mode")
        
        # Trust remote code
        if vllm_config.get('trust_remote_code', False):
            env.extend(["-e", "VLLM_TRUST_REMOTE_CODE=true"])
        
        # Custom chat template
        if vllm_config.get('custom_chat_template'):
            env.extend(["-e", "VLLM_CHAT_TEMPLATE=/tmp/chat_template.jinja"])
        
        # HuggingFace token for gated models
        if vllm_config.get('hf_token'):
            env.extend(["-e", f"HF_TOKEN={vllm_config['hf_token']}"])
            env.extend(["-e", f"HUGGING_FACE_HUB_TOKEN={vllm_config['hf_token']}"])
        
        # CPU-specific environment variables (read by start_vllm.sh)
        if vllm_config.get('use_cpu', False):
            env.extend(["-e", f"VLLM_CPU_KVCACHE_SPACE={vllm_config.get('cpu_kvcache_space', 4)}"])
            env.extend(["-e", f"VLLM_CPU_OMP_THREADS_BIND={vllm_config.get('cpu_omp_threads_bind', 'auto')}"])
            env.extend(["-e", "VLLM_TARGET_DEVICE=cpu"])
            env.extend(["-e", "VLLM_PLATFORM=cpu"])
        
        # GPU-specific parameters
        if not vllm_config.get('use_cpu', False):
            env.extend(["-e", f"VLLM_TENSOR_PARALLEL_SIZE={vllm_config.get('tensor_parallel_size', 1)}"])
            env.extend(["-e", f"VLLM_GPU_MEMORY_UTILIZATION={vllm_config.get('gpu_memory_utilization', 0.9)}"])
            env.extend(["-e", f"VLLM_LOAD_FORMAT={vllm_config.get('load_format', 'auto')}"])
        
        # Tool calling support - add environment variables for custom images
        if vllm_config.get('enable_tool_calling', False):
            tool_parser = vllm_config.get('tool_call_parser')
            model_source = vllm_config.get('model_source', vllm_config.get('model'))
            if not tool_parser:
                # Auto-detect based on model name
                tool_parser = self._detect_tool_call_parser(model_source)
            
            if tool_parser:
                env.extend(["-e", "VLLM_ENABLE_AUTO_TOOL_CHOICE=true"])
                env.extend(["-e", f"VLLM_TOOL_CALL_PARSER={tool_parser}"])
                logger.info(f"Tool calling env vars set: parser={tool_parser}")
        
        # Setup volumes
        volumes = []
        
        # Mount HuggingFace cache directory (create if it doesn't exist)
        hf_cache = os.path.expanduser("~/.cache/huggingface")
        if not os.path.exists(hf_cache):
            os.makedirs(hf_cache, exist_ok=True)
            logger.info(f"Created HuggingFace cache directory: {hf_cache}")
        volumes.extend(["-v", f"{hf_cache}:/root/.cache/huggingface:rw"])
        
        # If using local model, mount the model directory
        if vllm_config.get('local_model_path'):
            local_path = os.path.abspath(os.path.expanduser(vllm_config['local_model_path']))
            # Mount parent directory to avoid permission issues
            parent_dir = os.path.dirname(local_path)
            volumes.extend(["-v", f"{parent_dir}:/models:ro"])
        
        # If download_dir specified, mount it
        if vllm_config.get('download_dir'):
            download_dir = os.path.abspath(os.path.expanduser(vllm_config['download_dir']))
            volumes.extend(["-v", f"{download_dir}:/models/downloads:rw"])
        
        # Port mapping - map host port to container port 8000
        host_port = vllm_config.get('port', 8000)
        ports = ["-p", f"{host_port}:8000"]
        
        # Build vLLM command-line arguments (for official vllm-openai image)
        # These are passed after the image name
        vllm_args = []
        
        # Model (required)
        model_source = vllm_config.get('model_source', vllm_config.get('model'))
        vllm_args.extend(["--model", model_source])
        
        # Host and port (inside container)
        vllm_args.extend(["--host", "0.0.0.0"])
        vllm_args.extend(["--port", "8000"])
        
        # Dtype
        if vllm_config.get('use_cpu', False) and vllm_config.get('dtype', 'auto') == 'auto':
            vllm_args.extend(["--dtype", "bfloat16"])
        else:
            vllm_args.extend(["--dtype", vllm_config.get('dtype', 'auto')])
        
        # Max model length and max_num_batched_tokens
        # These must be consistent: max_num_batched_tokens >= max_model_len
        max_model_len = vllm_config.get('max_model_len')
        if max_model_len:
            vllm_args.extend(["--max-model-len", str(max_model_len)])
            vllm_args.extend(["--max-num-batched-tokens", str(max_model_len)])
        elif vllm_config.get('use_cpu', False):
            # CPU mode: Use conservative default to avoid memory issues
            # Many models default to very large context (131072) which exceeds CPU memory
            vllm_args.extend(["--max-model-len", "4096"])
            vllm_args.extend(["--max-num-batched-tokens", "4096"])
            logger.info("Using default max-model-len=4096 for CPU mode")
        
        # Trust remote code
        if vllm_config.get('trust_remote_code', False):
            vllm_args.append("--trust-remote-code")
        
        # Custom chat template
        if vllm_config.get('custom_chat_template'):
            vllm_args.extend(["--chat-template", "/tmp/chat_template.jinja"])
        
        # GPU-specific parameters
        if not vllm_config.get('use_cpu', False):
            vllm_args.extend(["--tensor-parallel-size", str(vllm_config.get('tensor_parallel_size', 1))])
            vllm_args.extend(["--gpu-memory-utilization", str(vllm_config.get('gpu_memory_utilization', 0.9))])
            # Load format (auto, pt, safetensors, etc.)
            load_format = vllm_config.get('load_format', 'auto')
            if load_format and load_format != 'auto':
                vllm_args.extend(["--load-format", load_format])
        
        # Tool calling support
        enable_tool_calling = vllm_config.get('enable_tool_calling', False)
        logger.info(f"Tool calling config: enable_tool_calling={enable_tool_calling}, tool_call_parser={vllm_config.get('tool_call_parser')}")
        
        if enable_tool_calling:
            tool_parser = vllm_config.get('tool_call_parser')
            if not tool_parser:
                # Auto-detect based on model name
                tool_parser = self._detect_tool_call_parser(model_source)
                logger.info(f"Auto-detected tool parser for '{model_source}': {tool_parser}")
            
            if tool_parser:
                vllm_args.append("--enable-auto-tool-choice")
                vllm_args.extend(["--tool-call-parser", tool_parser])
                logger.info(f"Tool calling enabled with parser: {tool_parser}")
            else:
                logger.warning(f"Tool calling enabled but no parser found for model: {model_source}")
        else:
            logger.info("Tool calling disabled in config")
        
        return {
            'environment': env,
            'volumes': volumes,
            'ports': ports,
            'vllm_args': vllm_args
        }
    
    async def _get_container_config_hash(self, vllm_config: Dict[str, Any]) -> str:
        """
        Generate a hash of the configuration for change detection
        
        Args:
            vllm_config: vLLM configuration dictionary
            
        Returns:
            Hash string representing the configuration
        """
        import hashlib
        
        # Create a deterministic string from config (sorted keys)
        config_str = json.dumps(vllm_config, sort_keys=True)
        return hashlib.md5(config_str.encode()).hexdigest()
    
    async def _should_recreate_container(self, vllm_config: Dict[str, Any], expected_image: str) -> bool:
        """
        Check if container needs to be recreated due to config or image change
        
        Args:
            vllm_config: New vLLM configuration
            expected_image: The container image that should be used
            
        Returns:
            True if container should be recreated, False if can reuse existing
        """
        try:
            # Check if container exists and get both config hash and image
            result = await self._run_podman_cmd_async(
                "inspect", self.CONTAINER_NAME,
                "--format", "{{index .Config.Labels \"vllm.config.hash\"}}|{{.Config.Image}}|{{index .Config.Labels \"vllm.image\"}}",
                check=False
            )
            
            if result.returncode != 0:
                # Container doesn't exist
                logger.info("Container doesn't exist - will create new container")
                return True
            
            # Parse the output: stored_hash|container_image|stored_image_label
            output = result.stdout.strip()
            parts = output.split('|')
            stored_hash = parts[0] if len(parts) > 0 else ""
            container_image = parts[1] if len(parts) > 1 else ""
            stored_image_label = parts[2] if len(parts) > 2 else ""
            
            # Use the stored image label if available, otherwise use container image
            stored_image = stored_image_label if stored_image_label else container_image
            
            # Calculate current config hash
            current_hash = await self._get_container_config_hash(vllm_config)
            
            # Check if config changed
            if stored_hash != current_hash:
                logger.info(f"Configuration changed - will recreate container")
                logger.info(f"  Old hash: {stored_hash}")
                logger.info(f"  New hash: {current_hash}")
                return True
            
            # Check if image changed (critical for CPU/GPU mode switching)
            if stored_image != expected_image:
                logger.info(f"Container image changed - will recreate container")
                logger.info(f"  Current image: {stored_image}")
                logger.info(f"  Required image: {expected_image}")
                return True
            
            logger.info(f"Configuration and image unchanged - will reuse existing container")
            return False
            
        except Exception as e:
            logger.warning(f"Error checking config: {e}, will recreate container")
            return True
    
    async def _pull_image_with_progress(self, image: str) -> bool:
        """
        Pull container image with progress logging.
        
        This streams the pull progress to logs so users can see download status.
        
        Args:
            image: Container image to pull
            
        Returns:
            True if pull succeeded or image already exists, False on error
        """
        # First check if image already exists locally
        try:
            result = await self._run_podman_cmd_async(
                "image", "exists", image,
                check=False
            )
            if result.returncode == 0:
                logger.info(f"Image already exists locally: {image}")
                return True
        except Exception:
            pass
        
        # Image doesn't exist, need to pull
        logger.info(f"Pulling container image: {image} (this may take several minutes for large images...)")
        
        try:
            # Build pull command
            if self._should_use_sudo():
                cmd = ["sudo", "-n", self.runtime, "pull", image]
            else:
                cmd = [self.runtime, "pull", image]
            
            # Run pull with streaming output
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT
            )
            
            # Stream output line by line
            last_log_time = asyncio.get_event_loop().time()
            while True:
                line = await process.stdout.readline()
                if not line:
                    break
                
                log_line = line.decode('utf-8', errors='replace').rstrip()
                if log_line:
                    # Log pull progress (throttle to avoid spam)
                    current_time = asyncio.get_event_loop().time()
                    # Log every line that contains progress info, or every 2 seconds
                    if 'Copying' in log_line or 'blob' in log_line or 'sha256' in log_line or current_time - last_log_time > 2:
                        logger.info(f"[PULL] {log_line}")
                        last_log_time = current_time
            
            await process.wait()
            
            if process.returncode == 0:
                logger.info(f"✅ Image pulled successfully: {image}")
                return True
            else:
                logger.error(f"❌ Failed to pull image: {image}")
                return False
                
        except Exception as e:
            logger.error(f"Error pulling image: {e}")
            return False
    
    async def start_container(self, vllm_config: Dict[str, Any], image: Optional[str] = None, wait_ready: bool = False) -> Dict[str, Any]:
        """
        Start vLLM container with given configuration
        
        Smart restart logic:
        - If container exists with same config: restart it (fast)
        - If config changed: remove old container and create new one
        - If no container exists: create new one
        
        When switching between CPU and GPU modes, containers in BOTH contexts
        (rootless and sudo) are stopped to avoid conflicts.
        
        Args:
            vllm_config: vLLM configuration dictionary
            image: Container image to use (default: auto-selected based on CPU/GPU mode)
            wait_ready: If True, wait for vLLM to be ready before returning (default: False)
            
        Returns:
            Dictionary with container info (id, name, status, ready, etc.)
        """
        use_cpu = vllm_config.get('use_cpu', False)
        accelerator = vllm_config.get('accelerator', 'nvidia')
        mode_name = "CPU" if use_cpu else f"GPU ({accelerator.upper()})"
        logger.info(f"Starting vLLM in {mode_name} mode")
        
        if image is None:
            # Auto-select appropriate image based on CPU/GPU mode and accelerator
            image = self.get_default_image(use_cpu=use_cpu, accelerator=accelerator)
            logger.info(f"Using container image: {image}")
        
        try:
            # Check if we need to recreate the container
            # Pass expected image to detect CPU/GPU mode changes
            should_recreate = await self._should_recreate_container(vllm_config, image)
            
            if not should_recreate:
                # Container exists with same config - just restart it
                logger.info(f"Restarting existing container: {self.CONTAINER_NAME}")
                
                # Check current state
                status_result = await self._run_podman_cmd_async(
                    "inspect", self.CONTAINER_NAME,
                    "--format", "{{.State.Status}}",
                    check=False
                )
                
                current_status = status_result.stdout.strip()
                
                if current_status == "running":
                    logger.info("Container already running")
                    # Get container ID
                    id_result = await self._run_podman_cmd_async(
                        "inspect", self.CONTAINER_NAME,
                        "--format", "{{.Id}}"
                    )
                    container_id = id_result.stdout.strip()
                else:
                    # Start the stopped container
                    await self._run_podman_cmd_async("start", self.CONTAINER_NAME)
                    logger.info(f"Container restarted: {self.CONTAINER_NAME}")
                    
                    # Get container ID
                    id_result = await self._run_podman_cmd_async(
                        "inspect", self.CONTAINER_NAME,
                        "--format", "{{.Id}}"
                    )
                    container_id = id_result.stdout.strip()
                
                result = {
                    'id': container_id,
                    'name': self.CONTAINER_NAME,
                    'status': 'running',
                    'image': image,
                    'reused': True
                }
                
                # Wait for readiness if requested
                if wait_ready:
                    port = vllm_config.get('port', 8000)
                    readiness = await self.wait_for_ready(port=port)
                    result.update(readiness)
                
                return result
            
            # Config changed or no container - need to recreate
            logger.info("Configuration changed or no container - creating new container")
            
            # Stop and remove existing container if it exists
            await self.stop_container(remove=True)
            
            # Pull image first (with progress streaming)
            await self._pull_image_with_progress(image)
            
            # Build container configuration
            config = self.build_container_config(vllm_config)
            
            # Generate config hash for future comparison
            config_hash = await self._get_container_config_hash(vllm_config)
            
            logger.info(f"Starting container with image: {image}")
            logger.info(f"Environment: {config['environment']}")
            logger.info(f"Volumes: {config['volumes']}")
            logger.info(f"Ports: {config['ports']}")
            logger.info(f"Using container's default entrypoint (start_vllm.sh)")
            
            # Build podman run command
            podman_cmd = [
                "run",
                "-d",  # Detached
                "--name", self.CONTAINER_NAME,
                # Use host IPC namespace for vLLM shared memory (inter-process communication)
                "--ipc=host",
                # NOTE: Removed --rm flag to keep container for reuse
                # Add labels to track configuration and image for change detection
                "--label", f"vllm.config.hash={config_hash}",
                "--label", f"vllm.image={image}",
            ]
            
            # Add GPU passthrough if not in CPU mode
            use_cpu = vllm_config.get('use_cpu', False)
            accelerator = vllm_config.get('accelerator', 'nvidia')
            if not use_cpu:
                if accelerator == "amd":
                    # AMD ROCm GPU support
                    # Based on official ROCm docs: https://rocm.docs.amd.com/en/latest/how-to/rocm-for-ai/inference/benchmark-docker/vllm.html
                    # Note: --ipc=host is already set in base config, --shm-size is incompatible with --ipc=host
                    podman_cmd.extend([
                        "--network=host",
                        "--group-add=video",
                        "--cap-add=SYS_PTRACE",
                        "--security-opt", "seccomp=unconfined",
                        "--device", "/dev/kfd",
                        "--device", "/dev/dri",
                    ])
                    logger.info("AMD ROCm GPU passthrough enabled for container")
                elif accelerator == "tpu":
                    # Google Cloud TPU support
                    # Based on official vLLM docs: https://docs.vllm.ai/en/stable/getting_started/installation/google_tpu.html
                    # TPU requires privileged mode for full device access
                    # Note: --ipc=host is already set in base config, --shm-size is incompatible with --ipc=host
                    podman_cmd.extend([
                        "--privileged",
                        "--network=host",
                    ])
                    logger.info("Google Cloud TPU passthrough enabled for container (privileged mode)")
                else:
                    # NVIDIA CUDA GPU support (default)
                    if self.runtime == "docker":
                        # Docker uses --gpus flag
                        podman_cmd.extend(["--gpus", "all"])
                    else:
                        # Podman uses --device with CDI
                        # Also add security options needed for GPU access
                        podman_cmd.extend([
                            "--device", "nvidia.com/gpu=all",
                            "--security-opt=label=disable",
                        ])
                    logger.info("NVIDIA CUDA GPU passthrough enabled for container")
            
            # Add environment variables
            podman_cmd.extend(config['environment'])
            
            # Add volumes
            podman_cmd.extend(config['volumes'])
            
            # Add ports
            podman_cmd.extend(config['ports'])
            
            # Add image
            podman_cmd.append(image)
            
            # Add vLLM command-line arguments
            # NVIDIA vllm-openai image has entrypoint, but AMD/TPU images need explicit command
            if config.get('vllm_args'):
                # AMD ROCm and TPU images don't have automatic entrypoint - need to call vllm serve
                if accelerator in ("amd", "tpu"):
                    podman_cmd.extend(["vllm", "serve"])
                    logger.info(f"Using 'vllm serve' command for {accelerator.upper()} container")
                podman_cmd.extend(config['vllm_args'])
                logger.info(f"vLLM arguments: {' '.join(config['vllm_args'])}")
            
            # Run container
            result = await self._run_podman_cmd_async(*podman_cmd)
            container_id = result.stdout.strip()
            
            logger.info(f"Container started: {container_id[:12]}")
            
            result = {
                'id': container_id,
                'name': self.CONTAINER_NAME,
                'status': 'started',
                'image': image,
                'reused': False
            }
            
            # Wait for readiness if requested
            if wait_ready:
                port = vllm_config.get('port', 8000)
                readiness = await self.wait_for_ready(port=port)
                result.update(readiness)
            
            return result
            
        except subprocess.CalledProcessError as e:
            logger.error(f"Failed to start container: {e.stderr}")
            raise Exception(f"Failed to start container: {e.stderr}")
        except Exception as e:
            logger.error(f"Unexpected error starting container: {e}")
            raise
    
    async def wait_for_ready(self, port: int = 8000, timeout: int = 120) -> Dict[str, Any]:
        """
        Wait for vLLM service inside container to be ready
        
        Polls the /health endpoint until it returns 200 or timeout is reached.
        This ensures the vLLM service has fully initialized and is ready to serve requests.
        
        Args:
            port: Port where vLLM is listening (default: 8000)
            timeout: Maximum time to wait in seconds (default: 120)
            
        Returns:
            Dictionary with status:
            - {'ready': True, 'elapsed_time': seconds} if successful
            - {'ready': False, 'error': 'timeout'} if timeout reached
            - {'ready': False, 'error': message} if error occurred
        """
        try:
            import aiohttp
        except ImportError:
            logger.warning("aiohttp not available - skipping readiness check")
            return {'ready': False, 'error': 'aiohttp not installed'}
        
        logger.info(f"Waiting for vLLM to be ready on port {port} (timeout: {timeout}s)...")
        start_time = time.time()
        last_error = None
        
        while time.time() - start_time < timeout:
            try:
                # Check if container is still running
                status = await self.get_container_status()
                if not status.get('running', False):
                    elapsed = time.time() - start_time
                    return {
                        'ready': False,
                        'error': 'container_stopped',
                        'elapsed_time': round(elapsed, 1)
                    }
                
                # Try to hit the health endpoint
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        f"http://localhost:{port}/health",
                        timeout=aiohttp.ClientTimeout(total=3)
                    ) as response:
                        if response.status == 200:
                            elapsed = time.time() - start_time
                            logger.info(f"✅ vLLM is ready! (took {elapsed:.1f}s)")
                            return {
                                'ready': True,
                                'elapsed_time': round(elapsed, 1)
                            }
                        else:
                            last_error = f"HTTP {response.status}"
                            
            except aiohttp.ClientError as e:
                last_error = f"Connection error: {type(e).__name__}"
            except asyncio.TimeoutError:
                last_error = "Request timeout"
            except Exception as e:
                last_error = str(e)
            
            # Wait before retry
            elapsed = time.time() - start_time
            if elapsed < timeout:
                await asyncio.sleep(5)
                if int(elapsed) % 15 == 0:  # Log every 15 seconds
                    logger.info(f"Still waiting for vLLM... ({int(elapsed)}s elapsed, last error: {last_error})")
        
        # Timeout reached
        elapsed = time.time() - start_time
        logger.warning(f"❌ Timeout waiting for vLLM to be ready ({elapsed:.1f}s)")
        return {
            'ready': False,
            'error': 'timeout',
            'elapsed_time': round(elapsed, 1),
            'last_error': last_error
        }
    
    async def stop_container(self, remove: bool = False) -> Dict[str, str]:
        """
        Stop vLLM container (optionally remove it)
        
        Args:
            remove: If True, remove container after stopping (default: False)
                   If False, container is kept for faster restarts
        
        Returns:
            Dictionary with status
        """
        try:
            # Check if container exists
            result = await self._run_podman_cmd_async("ps", "-a", "--filter", f"name={self.CONTAINER_NAME}", "--format", "{{.Names}}", check=False)
            
            if self.CONTAINER_NAME in result.stdout:
                logger.info(f"Stopping container: {self.CONTAINER_NAME}")
                
                # Stop container
                await self._run_podman_cmd_async("stop", self.CONTAINER_NAME, check=False)
                
                if remove:
                    # Remove container
                    await self._run_podman_cmd_async("rm", "-f", self.CONTAINER_NAME, check=False)
                    logger.info(f"Container stopped and removed: {self.CONTAINER_NAME}")
                    return {'status': 'stopped_and_removed'}
                else:
                    logger.info(f"Container stopped (kept for reuse): {self.CONTAINER_NAME}")
                    return {'status': 'stopped'}
            else:
                logger.info(f"Container {self.CONTAINER_NAME} not found (already stopped)")
                return {'status': 'not_running'}
            
        except Exception as e:
            logger.error(f"Error stopping container: {e}")
            return {'status': 'error', 'error': str(e)}
    
    async def get_container_status(self) -> Dict[str, Any]:
        """
        Get current container status
        
        Returns:
            Dictionary with container status info
        """
        try:
            # Check if container is running
            result = await self._run_podman_cmd_async(
                "ps", 
                "--filter", f"name={self.CONTAINER_NAME}", 
                "--format", "json",
                check=False
            )
            
            if result.returncode == 0 and result.stdout.strip():
                output = result.stdout.strip()
                
                # Handle different JSON formats between Docker and Podman
                # Docker returns: [] or [{...}]
                # Podman may return: [{...}] or newline-separated JSON objects
                try:
                    containers = json.loads(output)
                except json.JSONDecodeError:
                    # Podman sometimes returns newline-separated JSON objects
                    lines = output.strip().split('\n')
                    containers = [json.loads(line) for line in lines if line.strip()]
                
                # Ensure containers is a list
                if isinstance(containers, dict):
                    containers = [containers]
                
                if containers and len(containers) > 0:
                    container = containers[0]
                    # Docker uses 'State', Podman may use 'Status' or 'State'
                    state = container.get('State', container.get('Status', 'running'))
                    # Docker uses 'ID' or 'Id', handle both
                    container_id = container.get('Id', container.get('ID', ''))
                    if container_id:
                        container_id = container_id[:12]
                    # Docker uses 'Names' as a string or list
                    names = container.get('Names', self.CONTAINER_NAME)
                    if isinstance(names, list):
                        name = names[0] if names else self.CONTAINER_NAME
                    else:
                        name = names
                    # Remove leading slash if present (Docker convention)
                    if isinstance(name, str) and name.startswith('/'):
                        name = name[1:]
                    
                    return {
                        'running': True,
                        'status': state,
                        'id': container_id,
                        'name': name
                    }
            
            return {
                'running': False,
                'status': 'not_found'
            }
                
        except Exception as e:
            logger.error(f"Error checking container status: {type(e).__name__}: {e}")
            return {
                'running': False,
                'status': 'error',
                'error': str(e)
            }
    
    async def stream_logs(self) -> AsyncIterator[str]:
        """
        Stream container logs
        
        Yields:
            Log lines from container
        """
        try:
            # Build command (with sudo if needed for GPU mode)
            if self._should_use_sudo():
                cmd = ["sudo", self.runtime, "logs", "-f", self.CONTAINER_NAME]
            else:
                cmd = [self.runtime, "logs", "-f", self.CONTAINER_NAME]
            
            # Start streaming logs
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT
            )
            
            # Read logs line by line
            while True:
                line = await process.stdout.readline()
                if not line:
                    break
                    
                log_line = line.decode('utf-8', errors='replace').rstrip()
                if log_line:
                    yield log_line
            
            await process.wait()
                
        except Exception as e:
            logger.error(f"Error streaming logs: {e}")
            yield f"[ERROR] Failed to stream logs: {e}"
    
    def close(self):
        """Close any open connections (not needed for CLI-based approach)"""
        pass


# Global container manager instance
# Only create if a container runtime is available
_detected_runtime = detect_container_runtime()
if _detected_runtime:
    container_manager = VLLMContainerManager(container_runtime=_detected_runtime)
else:
    container_manager = None
    logger.warning("Container manager disabled - no container runtime available")
