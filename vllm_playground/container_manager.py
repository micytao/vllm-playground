"""
Container Manager for vLLM Service
Handles starting/stopping vLLM containers using Podman CLI
Uses subprocess for maximum compatibility on macOS
"""

import asyncio
import logging
import os
import json
import platform
import subprocess
import time
from typing import Optional, Dict, Any, AsyncIterator

logger = logging.getLogger(__name__)


class VLLMContainerManager:
    """Manages vLLM container lifecycle using Podman CLI"""
    
    CONTAINER_NAME = "vllm-service"
    
    # Default images for different platforms (must use fully-qualified names for Podman)
    # Override with VLLM_CONTAINER_IMAGE environment variable
    DEFAULT_IMAGE_GPU = "docker.io/vllm/vllm-openai:v0.11.0"  # Official vLLM GPU image (linux/amd64)
    DEFAULT_IMAGE_CPU_MACOS = "quay.io/rh_ee_micyang/vllm-service:macos"  # CPU image for macOS (linux/arm64)
    DEFAULT_IMAGE_CPU_X86 = "quay.io/rh_ee_micyang/vllm-service:cpu"  # CPU image for x86_64 Linux
    
    def __init__(self, container_runtime: str = "podman", use_sudo: bool = None):
        """
        Initialize container manager
        
        Args:
            container_runtime: Container runtime to use (podman or docker)
            use_sudo: Run container commands with sudo (required for GPU access on some systems)
                      If None, auto-detect based on VLLM_USE_SUDO env var
        """
        self.runtime = container_runtime
        # Auto-detect from environment, or use provided value
        if use_sudo is None:
            self.use_sudo = os.environ.get("VLLM_USE_SUDO", "").lower() in ("true", "1", "yes")
        else:
            self.use_sudo = use_sudo
        
        # Auto-sudo for GPU mode: automatically use sudo for GPU containers
        # This is the default behavior since rootless podman typically can't access GPU
        # Set VLLM_AUTO_SUDO_GPU=false to disable
        auto_sudo_env = os.environ.get("VLLM_AUTO_SUDO_GPU", "true").lower()
        self.auto_sudo_gpu = auto_sudo_env not in ("false", "0", "no")
        
        # Track current mode for dynamic sudo decisions
        self._current_gpu_mode = False
    
    def get_default_image(self, use_cpu: bool = False) -> str:
        """
        Get the appropriate container image based on environment, platform, and CPU/GPU mode.
        
        Priority:
        1. VLLM_CONTAINER_IMAGE environment variable (if set)
        2. CPU image based on platform if use_cpu=True:
           - macOS (ARM64): quay.io/rh_ee_micyang/vllm-service:macos
           - Linux x86_64: quay.io/rh_ee_micyang/vllm-service:cpu
        3. GPU image (default): docker.io/vllm/vllm-openai:v0.11.0
        
        Args:
            use_cpu: Whether CPU mode is enabled
            
        Returns:
            Container image name
        """
        # Check for environment override first
        env_image = os.environ.get("VLLM_CONTAINER_IMAGE")
        if env_image:
            return env_image
        
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
        
        return self.DEFAULT_IMAGE_GPU
        
    def _should_use_sudo(self) -> bool:
        """
        Determine if sudo should be used for container commands.
        
        Returns True if:
        - use_sudo is explicitly set (via --sudo flag or VLLM_USE_SUDO env)
        - OR auto_sudo_gpu is enabled AND current mode is GPU
        """
        if self.use_sudo:
            return True
        if self.auto_sudo_gpu and self._current_gpu_mode:
            return True
        return False
    
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
        
        # Max model length - only set if user explicitly configures it
        max_model_len = vllm_config.get('max_model_len')
        if max_model_len:
            env.extend(["-e", f"VLLM_MAX_MODEL_LEN={max_model_len}"])
        
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
        
        # Max model length - only set if user explicitly configures it
        # Otherwise let vLLM auto-detect from model config
        max_model_len = vllm_config.get('max_model_len')
        if max_model_len:
            vllm_args.extend(["--max-model-len", str(max_model_len)])
        
        # Trust remote code
        if vllm_config.get('trust_remote_code', False):
            vllm_args.append("--trust-remote-code")
        
        # GPU-specific parameters
        if not vllm_config.get('use_cpu', False):
            vllm_args.extend(["--tensor-parallel-size", str(vllm_config.get('tensor_parallel_size', 1))])
            vllm_args.extend(["--gpu-memory-utilization", str(vllm_config.get('gpu_memory_utilization', 0.9))])
        
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
    
    async def _should_recreate_container(self, vllm_config: Dict[str, Any]) -> bool:
        """
        Check if container needs to be recreated due to config change
        
        Args:
            vllm_config: New vLLM configuration
            
        Returns:
            True if container should be recreated, False if can reuse existing
        """
        try:
            # Check if container exists
            result = await self._run_podman_cmd_async(
                "inspect", self.CONTAINER_NAME,
                "--format", "{{index .Config.Labels \"vllm.config.hash\"}}",
                check=False
            )
            
            if result.returncode != 0:
                # Container doesn't exist
                return True
            
            # Get stored config hash
            stored_hash = result.stdout.strip()
            
            # Calculate current config hash
            current_hash = await self._get_container_config_hash(vllm_config)
            
            if stored_hash != current_hash:
                logger.info(f"Configuration changed - will recreate container")
                logger.info(f"  Old hash: {stored_hash}")
                logger.info(f"  New hash: {current_hash}")
                return True
            
            logger.info(f"Configuration unchanged - will reuse existing container")
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
        
        Args:
            vllm_config: vLLM configuration dictionary
            image: Container image to use (default: auto-selected based on CPU/GPU mode)
            wait_ready: If True, wait for vLLM to be ready before returning (default: False)
            
        Returns:
            Dictionary with container info (id, name, status, ready, etc.)
        """
        # Track GPU mode for dynamic sudo decisions
        use_cpu = vllm_config.get('use_cpu', False)
        self._current_gpu_mode = not use_cpu
        
        if self._current_gpu_mode and self.auto_sudo_gpu:
            logger.info("GPU mode detected - using sudo for container commands")
        
        if image is None:
            # Auto-select appropriate image based on CPU/GPU mode
            image = self.get_default_image(use_cpu=use_cpu)
            logger.info(f"Using container image: {image}")
        
        try:
            # Check if we need to recreate the container
            should_recreate = await self._should_recreate_container(vllm_config)
            
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
                # Add label to track configuration
                "--label", f"vllm.config.hash={config_hash}",
            ]
            
            # Add GPU passthrough if not in CPU mode
            use_cpu = vllm_config.get('use_cpu', False)
            if not use_cpu:
                # For NVIDIA GPU support with Podman/Docker
                # Try CDI (Container Device Interface) first, then fall back to legacy
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
                logger.info("GPU passthrough enabled for container")
            
            # Add environment variables
            podman_cmd.extend(config['environment'])
            
            # Add volumes
            podman_cmd.extend(config['volumes'])
            
            # Add ports
            podman_cmd.extend(config['ports'])
            
            # Add image
            podman_cmd.append(image)
            
            # Add vLLM command-line arguments (required for official vllm-openai image)
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
                containers = json.loads(result.stdout)
                if containers:
                    container = containers[0]
                    return {
                        'running': True,
                        'status': container.get('State', 'running'),
                        'id': container.get('Id', '')[:12],
                        'name': container.get('Names', [''])[0] if isinstance(container.get('Names'), list) else self.CONTAINER_NAME
                    }
            
            return {
                'running': False,
                'status': 'not_found'
            }
                
        except Exception as e:
            logger.error(f"Error checking container status: {e}")
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
container_manager = VLLMContainerManager()
