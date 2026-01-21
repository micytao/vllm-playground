"""
Kubernetes Container Manager for vLLM Service
Manages vLLM pods in Kubernetes/OpenShift using the Kubernetes Python client
"""

import asyncio
import logging
import os
import shlex
import time
from typing import Optional, Dict, Any, AsyncIterator
from kubernetes import client, config
from kubernetes.client.rest import ApiException
from kubernetes.stream import stream

logger = logging.getLogger(__name__)


class VLLMKubernetesManager:
    """Manages vLLM pod lifecycle in Kubernetes/OpenShift"""
    
    POD_NAME = "vllm-service"
    SERVICE_NAME = "vllm-service"
    DEFAULT_IMAGE = "quay.io/rh_ee_micyang/vllm-mac:v0.11.0"
    
    def __init__(self, namespace: Optional[str] = None):
        """
        Initialize Kubernetes manager
        
        Args:
            namespace: Kubernetes namespace (defaults to current namespace or 'default')
        """
        self.namespace = namespace or self._get_current_namespace()
        self.api_client = None
        self.core_v1 = None
        
        # Allow overriding vLLM image via environment variable
        self.vllm_image = os.getenv('VLLM_IMAGE', self.DEFAULT_IMAGE)
        logger.info(f"Using vLLM image: {self.vllm_image}")
        
        # Check if persistent cache is enabled
        self.use_persistent_cache = os.getenv('USE_PERSISTENT_CACHE', 'false').lower() == 'true'
        self.model_cache_pvc = os.getenv('MODEL_CACHE_PVC', 'vllm-model-cache')
        if self.use_persistent_cache:
            logger.info(f"Persistent model cache enabled: PVC={self.model_cache_pvc}")
        else:
            logger.info("Using ephemeral model cache (emptyDir)")
        
    def _get_current_namespace(self) -> str:
        """Get current namespace from service account or environment"""
        # Try to read from service account (when running in cluster)
        sa_namespace_file = "/var/run/secrets/kubernetes.io/serviceaccount/namespace"
        if os.path.exists(sa_namespace_file):
            with open(sa_namespace_file, 'r') as f:
                return f.read().strip()
        
        # Fall back to environment variable or default
        return os.getenv('KUBERNETES_NAMESPACE', 'default')
    
    def _get_client(self) -> client.CoreV1Api:
        """Get Kubernetes client"""
        if self.core_v1 is None:
            try:
                # Try to load in-cluster config first (when running in K8s)
                config.load_incluster_config()
                logger.info("Loaded in-cluster Kubernetes config")
            except config.ConfigException:
                try:
                    # Fall back to kubeconfig (for local development)
                    config.load_kube_config()
                    logger.info("Loaded kubeconfig")
                except config.ConfigException as e:
                    logger.error(f"Failed to load Kubernetes config: {e}")
                    raise
            
            self.core_v1 = client.CoreV1Api()
            logger.info(f"Kubernetes client initialized for namespace: {self.namespace}")
        
        return self.core_v1
    
    def build_pod_spec(self, vllm_config: Dict[str, Any], image: Optional[str] = None) -> client.V1Pod:
        """
        Build Kubernetes Pod spec from vLLM config
        
        Args:
            vllm_config: vLLM configuration dictionary
            image: Container image to use
            
        Returns:
            V1Pod object
        """
        if image is None:
            image = self.DEFAULT_IMAGE
        
        # Build environment variables for container
        env_vars = []
        port = str(vllm_config.get('port', 8000))
        host = vllm_config.get('host', '0.0.0.0')
        
        # Core vLLM parameters
        env_vars.append(client.V1EnvVar(name="VLLM_MODEL", value=vllm_config.get('model_source', vllm_config.get('model'))))
        env_vars.append(client.V1EnvVar(name="VLLM_HOST", value=host))
        env_vars.append(client.V1EnvVar(name="VLLM_PORT", value=port))
        
        # Dtype
        if vllm_config.get('use_cpu', False) and vllm_config.get('dtype', 'auto') == 'auto':
            env_vars.append(client.V1EnvVar(name="VLLM_DTYPE", value="bfloat16"))
        else:
            env_vars.append(client.V1EnvVar(name="VLLM_DTYPE", value=vllm_config.get('dtype', 'auto')))
        
        # Max model length
        max_model_len = vllm_config.get('max_model_len')
        if max_model_len:
            env_vars.append(client.V1EnvVar(name="VLLM_MAX_MODEL_LEN", value=str(max_model_len)))
        elif vllm_config.get('use_cpu', False):
            env_vars.append(client.V1EnvVar(name="VLLM_MAX_MODEL_LEN", value="2048"))
        else:
            env_vars.append(client.V1EnvVar(name="VLLM_MAX_MODEL_LEN", value="8192"))
        
        # Trust remote code
        if vllm_config.get('trust_remote_code', False):
            env_vars.append(client.V1EnvVar(name="VLLM_TRUST_REMOTE_CODE", value="true"))
        
        # Cache directories (all writable by non-root users in /tmp)
        # HuggingFace cache for model downloads
        env_vars.append(client.V1EnvVar(name="HF_HOME", value="/tmp/hf_cache"))
        env_vars.append(client.V1EnvVar(name="HUGGINGFACE_HUB_CACHE", value="/tmp/hf_cache"))
        env_vars.append(client.V1EnvVar(name="TRANSFORMERS_CACHE", value="/tmp/hf_cache"))
        # System and vLLM caches
        env_vars.append(client.V1EnvVar(name="XDG_CACHE_HOME", value="/tmp/.cache"))
        env_vars.append(client.V1EnvVar(name="TORCH_HOME", value="/tmp/torch"))
        # GPU kernel caches (for CUDA operations)
        env_vars.append(client.V1EnvVar(name="FLASHINFER_WORKSPACE_DIR", value="/tmp/flashinfer"))
        env_vars.append(client.V1EnvVar(name="TRITON_CACHE_DIR", value="/tmp/triton"))
        
        # Disable vLLM usage statistics to avoid /.config permission errors
        env_vars.append(client.V1EnvVar(name="VLLM_USAGE_STATS", value="0"))
        
        # HuggingFace token
        if vllm_config.get('hf_token'):
            env_vars.append(client.V1EnvVar(name="HF_TOKEN", value=vllm_config['hf_token']))
            env_vars.append(client.V1EnvVar(name="HUGGING_FACE_HUB_TOKEN", value=vllm_config['hf_token']))
        
        # CPU-specific settings
        if vllm_config.get('use_cpu', False):
            env_vars.append(client.V1EnvVar(name="VLLM_CPU_KVCACHE_SPACE", value=str(vllm_config.get('cpu_kvcache_space', 4))))
            env_vars.append(client.V1EnvVar(name="VLLM_CPU_OMP_THREADS_BIND", value=vllm_config.get('cpu_omp_threads_bind', 'auto')))
            env_vars.append(client.V1EnvVar(name="VLLM_TARGET_DEVICE", value="cpu"))
            env_vars.append(client.V1EnvVar(name="VLLM_PLATFORM", value="cpu"))
        
        # GPU-specific settings
        if not vllm_config.get('use_cpu', False):
            env_vars.append(client.V1EnvVar(name="VLLM_TARGET_DEVICE", value="cuda"))
            env_vars.append(client.V1EnvVar(name="VLLM_PLATFORM", value="cuda"))
            env_vars.append(client.V1EnvVar(name="VLLM_TENSOR_PARALLEL_SIZE", value=str(vllm_config.get('tensor_parallel_size', 1))))
            env_vars.append(client.V1EnvVar(name="VLLM_GPU_MEMORY_UTILIZATION", value=str(vllm_config.get('gpu_memory_utilization', 0.9))))
            env_vars.append(client.V1EnvVar(name="VLLM_LOAD_FORMAT", value=vllm_config.get('load_format', 'auto')))
        
        # Volume mounts
        volume_mounts = []
        volumes = []
        
        # HuggingFace cache - use PVC or emptyDir based on configuration
        # Mount to /tmp/hf_cache which is writable by non-root users
        volume_mounts.append(
            client.V1VolumeMount(name="hf-cache", mount_path="/tmp/hf_cache")
        )
        
        if self.use_persistent_cache:
            # Use PVC for persistent model caching (models persist across pod restarts)
            volumes.append(
                client.V1Volume(
                    name="hf-cache",
                    persistent_volume_claim=client.V1PersistentVolumeClaimVolumeSource(
                        claim_name=self.model_cache_pvc
                    )
                )
            )
            logger.info(f"Using PVC {self.model_cache_pvc} for model cache")
        else:
            # Use emptyDir (ephemeral - models re-downloaded each time)
            volumes.append(
                client.V1Volume(name="hf-cache", empty_dir=client.V1EmptyDirVolumeSource())
            )
            logger.info("Using emptyDir for model cache (ephemeral)")
        
        # CRITICAL FIX: Mount emptyDir at /.cache for FlashInfer
        # FlashInfer tries to create /.cache even with FLASHINFER_WORKSPACE_DIR set
        # This is a workaround for FlashInfer's broken path resolution
        volume_mounts.append(
            client.V1VolumeMount(name="root-cache", mount_path="/.cache")
        )
        volumes.append(
            client.V1Volume(name="root-cache", empty_dir=client.V1EmptyDirVolumeSource())
        )
        logger.info("Mounting emptyDir at /.cache for FlashInfer compatibility")
        
        # Resource configuration based on CPU vs GPU mode
        resource_requests = {}
        resource_limits = {}
        
        if vllm_config.get('use_cpu', False):
            # CPU mode
            resource_requests = {
                "memory": "8Gi",
                "cpu": "2"
            }
            resource_limits = {
                "memory": "32Gi",
                "cpu": "8"
            }
        else:
            # GPU mode
            num_gpus = vllm_config.get('tensor_parallel_size', 1)
            resource_requests = {
                "memory": "16Gi",
                "cpu": "4",
                "nvidia.com/gpu": str(num_gpus)  # Request GPUs
            }
            resource_limits = {
                "memory": "64Gi",
                "cpu": "16",
                "nvidia.com/gpu": str(num_gpus)  # Limit GPUs
            }
        
        # Container definition
        # Use a shell wrapper to create cache directories before starting vLLM
        # This works around FlashInfer trying to create parent /.cache directory
        
        # Build vLLM command with explicit model argument
        model_name = vllm_config.get('model_source', vllm_config.get('model'))
        safe_model = shlex.quote(model_name)
        safe_host = shlex.quote(host)
        safe_port = shlex.quote(port)
        
        # Build base command
        vllm_cmd_parts = [
            "python3 -m vllm.entrypoints.openai.api_server",
            f"--model {safe_model}",
            f"--host {safe_host}",
            f"--port {safe_port}",
        ]
        
        # Chat template handling for vLLM v4.44+
        # IMPORTANT: Only provide --chat-template if user explicitly wants to override!
        # When --chat-template is provided, it OVERRIDES the model's built-in template
        # Modern models (Llama 3.x, Mistral, Qwen, etc.) have excellent built-in templates
        # that should NOT be overridden unless explicitly requested
        if vllm_config.get('custom_chat_template'):
            # User explicitly provided a custom chat template
            # This will override the model's built-in template
            safe_template = shlex.quote(vllm_config['custom_chat_template'])
            vllm_cmd_parts.append(f"--chat-template {safe_template}")
            logger.info("Using custom chat template from config (overrides model's built-in template)")
        else:
            # DON'T provide --chat-template flag
            # Let vLLM auto-detect and use the model's built-in chat template
            # vLLM will automatically load it from tokenizer_config.json
            # If the model truly has no template, vLLM will error with clear instructions
            logger.info("Using model's built-in chat template (auto-detected by vLLM)")
        
        vllm_cmd = " ".join(vllm_cmd_parts)
        
        container = client.V1Container(
            name="vllm",
            image=image,
            image_pull_policy="IfNotPresent",  # Only pull if not already on node
            command=["/bin/sh", "-c"],
            args=[
                # Create all cache directories first
                f"mkdir -p /tmp/hf_cache /tmp/.cache /tmp/torch /tmp/flashinfer /tmp/triton && "
                # Then start vLLM with explicit model argument
                f"{vllm_cmd}"
            ],
            env=env_vars,
            ports=[client.V1ContainerPort(container_port=int(port), name="http")],
            volume_mounts=volume_mounts,
            resources=client.V1ResourceRequirements(
                requests=resource_requests,
                limits=resource_limits
            )
        )
        
        # Node selector and tolerations for GPU nodes
        node_selector = {}
        tolerations = []
        
        if not vllm_config.get('use_cpu', False):
            # GPU mode - select GPU nodes
            node_selector = {
                "nvidia.com/gpu.present": "true"  # Target nodes with GPUs
            }
            # Add toleration for GPU nodes (if they're tainted)
            tolerations = [
                client.V1Toleration(
                    key="nvidia.com/gpu",
                    operator="Exists",
                    effect="NoSchedule"
                )
            ]
        
        # Image pull secrets - only needed for private registries
        # Public images don't need pull secrets:
        # - vllm/vllm-openai:v0.12.0 (official community image for GPU, v0.12.0+ for Claude Code)
        # - quay.io/rh_ee_micyang/vllm-cpu:v0.11.0 (self-built, publicly accessible for CPU)
        # 
        # Example for private registries (not needed for current setup):
        # oc create secret docker-registry my-registry \
        #   --docker-server=my-registry.example.com \
        #   --docker-username=<username> \
        #   --docker-password=<password> \
        #   -n vllm-playground
        # oc secrets link vllm-playground-sa redhat-registry --for=pull -n vllm-playground
        image_pull_secrets = []
        
        # Check if we're using Red Hat registry and add pull secret
        if image and 'registry.redhat.io' in image:
            # Use default Red Hat registry secret name
            secret_name = 'redhat-registry'
            image_pull_secrets.append(client.V1LocalObjectReference(name=secret_name))
            logger.info(f"Using imagePullSecret: {secret_name} for Red Hat registry")
        
        # Pod spec
        pod_spec = client.V1PodSpec(
            containers=[container],
            volumes=volumes,
            restart_policy="Never",  # Don't auto-restart, let web UI control lifecycle
            node_selector=node_selector if node_selector else None,
            tolerations=tolerations if tolerations else None,
            image_pull_secrets=image_pull_secrets if image_pull_secrets else None
        )
        
        # Pod metadata
        metadata = client.V1ObjectMeta(
            name=self.POD_NAME,
            labels={
                "app": "vllm",
                "managed-by": "vllm-playground"
            }
        )
        
        # Create pod object
        pod = client.V1Pod(
            api_version="v1",
            kind="Pod",
            metadata=metadata,
            spec=pod_spec
        )
        
        return pod
    
    async def start_container(self, vllm_config: Dict[str, Any], image: Optional[str] = None, wait_ready: bool = False) -> Dict[str, Any]:
        """
        Start vLLM pod in Kubernetes
        
        Args:
            vllm_config: vLLM configuration dictionary
            image: Container image to use (defaults to VLLM_IMAGE env var or DEFAULT_IMAGE)
            wait_ready: If True, wait for vLLM to be ready before returning (default: False)
            
        Returns:
            Dictionary with pod info
        """
        try:
            api = self._get_client()
            
            # Stop existing pod if running
            await self.stop_container()
            
            # Use environment variable if image not specified
            if image is None:
                image = self.vllm_image
            
            # Build pod spec
            pod = self.build_pod_spec(vllm_config, image)
            
            logger.info(f"Creating pod {self.POD_NAME} in namespace {self.namespace}")
            logger.info(f"Image: {image or self.DEFAULT_IMAGE}")
            
            # Create pod
            loop = asyncio.get_event_loop()
            created_pod = await loop.run_in_executor(
                None,
                lambda: api.create_namespaced_pod(namespace=self.namespace, body=pod)
            )
            
            logger.info(f"Pod created: {created_pod.metadata.name}")
            
            # Create or update service for the pod
            port = vllm_config.get('port', 8000)
            await self._ensure_service(port)
            
            result = {
                'id': created_pod.metadata.uid,
                'name': created_pod.metadata.name,
                'status': 'started',
                'image': image or self.DEFAULT_IMAGE,
                'service': f"{self.SERVICE_NAME}.{self.namespace}.svc.cluster.local:{port}"
            }
            
            # Wait for readiness if requested
            if wait_ready:
                port = vllm_config.get('port', 8000)
                readiness = await self.wait_for_ready(port=port)
                result.update(readiness)
            
            return result
            
        except ApiException as e:
            logger.error(f"Failed to create pod: {e}")
            raise Exception(f"Failed to create pod: {e.reason}")
        except Exception as e:
            logger.error(f"Unexpected error creating pod: {e}")
            raise
    
    async def wait_for_ready(self, port: int = 8000, timeout: int = 300) -> Dict[str, Any]:
        """
        Wait for vLLM service inside pod to be ready
        
        Polls the /health endpoint until it returns 200 or timeout is reached.
        This is called AFTER the pod is running (image already pulled).
        Timeout covers model loading and initialization time.
        
        Args:
            port: Port where vLLM is listening (default: 8000)
            timeout: Maximum time to wait in seconds (default: 300 = 5 minutes)
            
        Returns:
            Dictionary with status:
            - {'ready': True, 'elapsed_time': seconds} if successful
            - {'ready': False, 'error': 'timeout'} if timeout reached
            - {'ready': False, 'error': message} if error occurred
        """
        try:
            import aiohttp
            import time
        except ImportError:
            logger.warning("aiohttp not available - skipping readiness check")
            return {'ready': False, 'error': 'aiohttp not installed'}
        
        logger.info(f"Waiting for vLLM to be ready on port {port} (timeout: {timeout}s)...")
        start_time = time.time()
        last_error = None
        
        # In Kubernetes, we connect to the service endpoint
        # From within the cluster, use the service name
        service_url = f"http://{self.SERVICE_NAME}.{self.namespace}.svc.cluster.local:{port}"
        
        while time.time() - start_time < timeout:
            try:
                # Check if pod is still running
                status = await self.get_container_status()
                if not status.get('running', False):
                    elapsed = time.time() - start_time
                    return {
                        'ready': False,
                        'error': 'pod_stopped',
                        'elapsed_time': round(elapsed, 1)
                    }
                
                # Try to hit the health endpoint
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        f"{service_url}/health",
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
        Stop (delete) vLLM pod
        
        In Kubernetes, there's no "stopped" state - pods are either running or deleted.
        This is simpler than container state management and avoids state complexity.
        
        Args:
            remove: Ignored (kept for interface compatibility)
                   In K8s, stop always means delete
        
        Returns:
            Dictionary with status
        """
        try:
            api = self._get_client()
            loop = asyncio.get_event_loop()
            
            # Check if pod exists
            try:
                await loop.run_in_executor(
                    None,
                    lambda: api.read_namespaced_pod(name=self.POD_NAME, namespace=self.namespace)
                )
            except ApiException as e:
                if e.status == 404:
                    logger.info(f"Pod {self.POD_NAME} not found (already deleted)")
                    return {'status': 'not_running'}
                else:
                    raise
            
            # Delete pod (Kubernetes way - no "stopped" state)
            logger.info(f"Deleting pod: {self.POD_NAME}")
            await loop.run_in_executor(
                None,
                lambda: api.delete_namespaced_pod(
                    name=self.POD_NAME,
                    namespace=self.namespace,
                    body=client.V1DeleteOptions()
                )
            )
            
            # Wait for pod deletion to avoid AlreadyExists when recreating
            start_wait = time.time()
            while time.time() - start_wait < 60:
                try:
                    await loop.run_in_executor(
                        None,
                        lambda: api.read_namespaced_pod(name=self.POD_NAME, namespace=self.namespace)
                    )
                    await asyncio.sleep(1)
                except ApiException as e:
                    if e.status == 404:
                        logger.info(f"Pod deleted: {self.POD_NAME}")
                        break
                    raise
            return {'status': 'stopped'}  # "stopped" means "deleted" in K8s context
            
        except Exception as e:
            logger.error(f"Error deleting pod: {e}")
            return {'status': 'error', 'error': str(e)}
    
    async def get_container_status(self) -> Dict[str, Any]:
        """
        Get current pod status
        
        Returns:
            Dictionary with pod status info
        """
        try:
            api = self._get_client()
            loop = asyncio.get_event_loop()
            
            try:
                pod = await loop.run_in_executor(
                    None,
                    lambda: api.read_namespaced_pod(name=self.POD_NAME, namespace=self.namespace)
                )
                
                phase = pod.status.phase
                
                # Determine if pod is still "running" (including startup phases)
                # Check both pod phase AND container states
                is_running = False
                container_state = None
                
                if phase == 'Running':
                    is_running = True
                elif phase == 'Pending':
                    # Check container states - could be ContainerCreating, Waiting, etc.
                    if pod.status.container_statuses:
                        for container in pod.status.container_statuses:
                            if container.state.waiting:
                                # Container is waiting (ContainerCreating, PullImage, etc.)
                                container_state = container.state.waiting.reason
                                # Still starting up - consider as "running"
                                is_running = True
                            elif container.state.running:
                                is_running = True
                                container_state = "Running"
                    else:
                        # No container statuses yet - pod is initializing
                        is_running = True
                        container_state = "Initializing"
                elif phase in ['Failed', 'Succeeded', 'Unknown']:
                    # Actually stopped or in error state
                    is_running = False
                
                status_detail = f"{phase}"
                if container_state:
                    status_detail = f"{phase} ({container_state})"
                
                return {
                    'running': is_running,
                    'status': status_detail,
                    'id': pod.metadata.uid[:12],
                    'name': pod.metadata.name
                }
                
            except ApiException as e:
                if e.status == 404:
                    return {
                        'running': False,
                        'status': 'not_found'
                    }
                else:
                    raise
                
        except Exception as e:
            logger.error(f"Error checking pod status: {e}")
            return {
                'running': False,
                'status': 'error',
                'error': str(e)
            }
    
    async def stream_logs(self) -> AsyncIterator[str]:
        """
        Stream pod logs
        
        Yields:
            Log lines from pod
        """
        try:
            api = self._get_client()
            loop = asyncio.get_event_loop()
            
            # Wait for pod to be running or show image pull status
            # Extended timeout for large image pulls (can take 5-10 minutes for multi-GB images)
            logger.info(f"Waiting for pod {self.POD_NAME} to be running...")
            max_wait_time = 600  # 10 minutes - enough for large image pulls
            check_interval = 1
            
            # Provide immediate feedback to user
            yield "[INFO] Container created, waiting for pod to start..."
            
            for i in range(max_wait_time):
                status = await self.get_container_status()
                
                # Only proceed to log streaming if pod phase is 'Running'
                # Don't stream if pod is still 'Pending' (ContainerCreating, ImagePullBackOff, etc.)
                if status.get('running'):
                    # Check if this is actual "Running" state vs just "starting up"
                    status_str = status.get('status', '')
                    if status_str == 'Running' or status_str.startswith('Running ('):
                        logger.info(f"Pod {self.POD_NAME} is running, starting log stream")
                        break
                    # else: still in Pending/ContainerCreating - keep waiting
                
                # Check if pod is still in Pending state (likely pulling image)
                pod_phase = status.get('status', 'Unknown')
                
                # Provide status updates - immediate for first few checks, then every 5 seconds
                should_update = (i <= 3) or (i > 0 and i % 5 == 0)
                
                if should_update:
                    # Try to get more detailed status
                    try:
                        pod = await loop.run_in_executor(
                            None,
                            lambda: api.read_namespaced_pod(name=self.POD_NAME, namespace=self.namespace)
                        )
                        
                        # Check container status for image pull progress
                        if pod.status.container_statuses:
                            container_status = pod.status.container_statuses[0]
                            if container_status.state.waiting:
                                reason = container_status.state.waiting.reason
                                message = container_status.state.waiting.message or ""
                                
                                if reason == "ContainerCreating" or reason == "PodInitializing":
                                    logger.info(f"Pod initializing... ({i}s elapsed)")
                                    yield f"[INFO] Pod initializing... ({i}s elapsed)"
                                elif reason == "ImagePullBackOff" or reason == "ErrImagePull":
                                    logger.error(f"Image pull failed: {message}")
                                    yield f"[ERROR] Image pull failed: {message}"
                                    return
                                else:
                                    logger.info(f"Waiting: {reason} ({i}s elapsed)")
                                    yield f"[INFO] Status: {reason} ({i}s elapsed)"
                            elif container_status.state.terminated:
                                reason = container_status.state.terminated.reason
                                logger.error(f"Container terminated: {reason}")
                                yield f"[ERROR] Container terminated: {reason}"
                                return
                        else:
                            # No container status yet, likely still pulling image
                            logger.info(f"Pulling container image... ({i}s elapsed)")
                            yield f"[INFO] Pulling container image... ({i}s elapsed, this may take several minutes for large images)"
                    except Exception as e:
                        logger.debug(f"Error checking detailed status: {e}")
                        logger.info(f"Still waiting for pod to be ready... ({i}s elapsed)")
                
                await asyncio.sleep(check_interval)
            else:
                logger.warning(f"Pod {self.POD_NAME} did not start within {max_wait_time} seconds")
                yield f"[ERROR] Pod did not start within timeout ({max_wait_time}s). Check pod status with: oc describe pod {self.POD_NAME} -n {self.namespace}"
                return
            
            # Stream logs
            logger.info(f"Starting log stream for pod {self.POD_NAME}")
            
            # Get log stream (this is a blocking call that returns an HTTPResponse-like object)
            log_stream = await loop.run_in_executor(
                None,
                lambda: api.read_namespaced_pod_log(
                    name=self.POD_NAME,
                    namespace=self.namespace,
                    follow=True,
                    _preload_content=False
                )
            )
            
            logger.info(f"Log stream connection established for pod {self.POD_NAME}")
            
            # Read logs in a non-blocking way using run_in_executor for each readline
            # The log_stream object is an HTTPResponse, we need to read it line by line
            line_count = 0
            while True:
                try:
                    # Read one line in executor to avoid blocking event loop
                    line = await loop.run_in_executor(
                        None,
                        lambda: log_stream.readline()
                    )
                    
                    if not line:
                        # No more data
                        logger.info(f"Log stream ended for pod {self.POD_NAME} (read {line_count} lines)")
                        break
                    
                    if isinstance(line, bytes):
                        line = line.decode('utf-8', errors='replace')
                    
                    line = line.rstrip()
                    if line:  # Only yield non-empty lines
                        line_count += 1
                        yield line
                        
                        # Log first few lines to confirm streaming is working
                        if line_count <= 5:
                            logger.debug(f"vLLM log line {line_count}: {line[:100]}")
                    
                    # Small yield to let other tasks run
                    await asyncio.sleep(0)
                    
                except Exception as e:
                    logger.error(f"Error reading log line: {e}")
                    break
                
        except Exception as e:
            logger.error(f"Error streaming logs: {e}")
            import traceback
            logger.error(traceback.format_exc())
            yield f"[ERROR] Failed to stream logs: {e}"
    
    async def _ensure_service(self, port: int = 8000):
        """Create or update Service for vLLM pod"""
        api = self._get_client()
        loop = asyncio.get_event_loop()
        
        service_spec = client.V1ServiceSpec(
            selector={"app": "vllm"},
            ports=[client.V1ServicePort(port=int(port), target_port=int(port), name="http")],
            type="ClusterIP"
        )
        
        service = client.V1Service(
            api_version="v1",
            kind="Service",
            metadata=client.V1ObjectMeta(name=self.SERVICE_NAME),
            spec=service_spec
        )
        
        try:
            # Try to create service
            await loop.run_in_executor(
                None,
                lambda: api.create_namespaced_service(namespace=self.namespace, body=service)
            )
            logger.info(f"Service created: {self.SERVICE_NAME}")
        except ApiException as e:
            if e.status == 409:  # Already exists
                logger.info(f"Service {self.SERVICE_NAME} already exists, updating with replace")
                # Use replace instead of patch to avoid duplicate port issues
                # Replace completely overwrites the service spec
                try:
                    await loop.run_in_executor(
                        None,
                        lambda: api.replace_namespaced_service(
                            name=self.SERVICE_NAME,
                            namespace=self.namespace,
                            body=service
                        )
                    )
                    logger.info(f"Service {self.SERVICE_NAME} updated successfully")
                except ApiException as replace_error:
                    logger.error(f"Failed to replace service: {replace_error}")
                    # If replace fails, try deleting and recreating
                    logger.info(f"Attempting to delete and recreate service {self.SERVICE_NAME}")
                    try:
                        await loop.run_in_executor(
                            None,
                            lambda: api.delete_namespaced_service(
                                name=self.SERVICE_NAME,
                                namespace=self.namespace
                            )
                        )
                        # Wait a moment for deletion to complete
                        await asyncio.sleep(1)
                        # Recreate service
                        await loop.run_in_executor(
                            None,
                            lambda: api.create_namespaced_service(
                                namespace=self.namespace,
                                body=service
                            )
                        )
                        logger.info(f"Service {self.SERVICE_NAME} recreated successfully")
                    except Exception as recreate_error:
                        logger.error(f"Failed to recreate service: {recreate_error}")
            else:
                logger.warning(f"Failed to create service: {e}")
    
    def close(self):
        """Close Kubernetes client"""
        pass


# Global container manager instance (compatible with Podman version)
container_manager = VLLMKubernetesManager()

