"""Tests for openshift/kubernetes_container_manager.py (VLLMKubernetesManager).

Split into two tiers:
1. Pure/offline tests of `build_pod_spec()` -- constructs a V1Pod object in
   memory, no cluster or `kubernetes` API server connectivity needed.
2. Real cluster lifecycle tests against a `kind` (Kubernetes-in-Docker)
   cluster, using a trivial `busybox` image instead of a real vLLM image.
   Skipped automatically when `kind` isn't available (this repo's CI spins
   one up via `helm/kind-action`; most local dev machines won't have it).
"""

import shutil
import subprocess
import time

import pytest
from kubernetes_container_manager import VLLMKubernetesManager

KIND_AVAILABLE = shutil.which("kind") is not None and shutil.which("kubectl") is not None
requires_kind = pytest.mark.skipif(not KIND_AVAILABLE, reason="kind and/or kubectl not installed")


# ---------------------------------------------------------------------------
# Pure / offline: build_pod_spec()
# ---------------------------------------------------------------------------


@pytest.fixture()
def manager():
    return VLLMKubernetesManager(namespace="vllm-playground-test")


def test_get_current_namespace_defaults(monkeypatch):
    monkeypatch.delenv("KUBERNETES_NAMESPACE", raising=False)
    monkeypatch.setattr("os.path.exists", lambda p: False)
    manager = VLLMKubernetesManager()
    assert manager.namespace == "default"


def test_get_current_namespace_from_env(monkeypatch):
    monkeypatch.setattr("os.path.exists", lambda p: False)
    monkeypatch.setenv("KUBERNETES_NAMESPACE", "my-team-ns")
    manager = VLLMKubernetesManager()
    assert manager.namespace == "my-team-ns"


def test_build_pod_spec_cpu_mode_sets_expected_env_and_resources(manager):
    pod = manager.build_pod_spec(
        {"model": "TinyLlama/TinyLlama-1.1B-Chat-v1.0", "port": 8000, "use_cpu": True},
        image="docker.io/library/busybox:latest",
    )

    env_names = {e.name: e.value for e in pod.spec.containers[0].env}
    assert env_names["VLLM_MODEL"] == "TinyLlama/TinyLlama-1.1B-Chat-v1.0"
    assert env_names["VLLM_TARGET_DEVICE"] == "cpu"
    assert env_names["VLLM_MAX_MODEL_LEN"] == "2048"

    resources = pod.spec.containers[0].resources
    assert "nvidia.com/gpu" not in (resources.requests or {})
    assert pod.spec.node_selector is None


def test_build_pod_spec_gpu_mode_requests_gpu_and_targets_gpu_nodes(manager):
    pod = manager.build_pod_spec(
        {"model": "meta-llama/Llama-3.1-8B-Instruct", "use_cpu": False, "tensor_parallel_size": 2},
        image="docker.io/vllm/vllm-openai:v0.29.0",
    )

    env_names = {e.name: e.value for e in pod.spec.containers[0].env}
    assert env_names["VLLM_TARGET_DEVICE"] == "cuda"
    assert env_names["VLLM_TENSOR_PARALLEL_SIZE"] == "2"

    resources = pod.spec.containers[0].resources
    assert resources.requests["nvidia.com/gpu"] == "2"
    assert resources.limits["nvidia.com/gpu"] == "2"
    assert pod.spec.node_selector == {"nvidia.com/gpu.present": "true"}
    assert len(pod.spec.tolerations) == 1


def test_build_pod_spec_uses_persistent_cache_when_enabled(monkeypatch):
    monkeypatch.setenv("USE_PERSISTENT_CACHE", "true")
    monkeypatch.setenv("MODEL_CACHE_PVC", "my-pvc")
    manager = VLLMKubernetesManager(namespace="test-ns")

    pod = manager.build_pod_spec({"model": "tiny-model"}, image="busybox:latest")

    hf_cache_volume = next(v for v in pod.spec.volumes if v.name == "hf-cache")
    assert hf_cache_volume.persistent_volume_claim.claim_name == "my-pvc"


def test_build_pod_spec_uses_ephemeral_cache_by_default(manager):
    pod = manager.build_pod_spec({"model": "tiny-model"}, image="busybox:latest")

    hf_cache_volume = next(v for v in pod.spec.volumes if v.name == "hf-cache")
    assert hf_cache_volume.empty_dir is not None
    assert hf_cache_volume.persistent_volume_claim is None


def test_build_pod_spec_hf_token_sets_both_env_vars(manager):
    pod = manager.build_pod_spec({"model": "tiny-model", "hf_token": "hf_abc123"}, image="busybox:latest")

    env_names = {e.name: e.value for e in pod.spec.containers[0].env}
    assert env_names["HF_TOKEN"] == "hf_abc123"
    assert env_names["HUGGING_FACE_HUB_TOKEN"] == "hf_abc123"


def test_build_pod_spec_adds_redhat_registry_pull_secret(manager):
    pod = manager.build_pod_spec({"model": "tiny-model"}, image="registry.redhat.io/vllm/vllm-openai:latest")
    assert pod.spec.image_pull_secrets[0].name == "redhat-registry"


def test_build_pod_spec_no_pull_secret_for_public_image(manager):
    pod = manager.build_pod_spec({"model": "tiny-model"}, image="docker.io/vllm/vllm-openai:v0.29.0")
    assert pod.spec.image_pull_secrets is None


def test_build_pod_spec_custom_chat_template_overrides_command(manager):
    pod = manager.build_pod_spec(
        {"model": "tiny-model", "custom_chat_template": "/tmp/my_template.jinja"},
        image="busybox:latest",
    )
    command_args = pod.spec.containers[0].args[0]
    assert "--chat-template /tmp/my_template.jinja" in command_args


def test_build_pod_spec_pod_metadata_and_restart_policy(manager):
    pod = manager.build_pod_spec({"model": "tiny-model"}, image="busybox:latest")
    assert pod.metadata.name == VLLMKubernetesManager.POD_NAME
    assert pod.metadata.labels == {"app": "vllm", "managed-by": "vllm-playground"}
    assert pod.spec.restart_policy == "Never"


# ---------------------------------------------------------------------------
# Real cluster lifecycle (kind)
# ---------------------------------------------------------------------------


KIND_CLUSTER_NAME = "vllm-playground-test"


@pytest.fixture(scope="module")
def kind_cluster():
    """Create a throwaway `kind` cluster for the duration of this test module."""
    subprocess.run(["kind", "delete", "cluster", "--name", KIND_CLUSTER_NAME], capture_output=True)
    created = subprocess.run(
        ["kind", "create", "cluster", "--name", KIND_CLUSTER_NAME, "--wait", "120s"],
        capture_output=True,
        text=True,
    )
    assert created.returncode == 0, created.stderr

    kubeconfig = subprocess.run(
        ["kind", "get", "kubeconfig", "--name", KIND_CLUSTER_NAME], capture_output=True, text=True, check=True
    ).stdout

    yield kubeconfig

    subprocess.run(["kind", "delete", "cluster", "--name", KIND_CLUSTER_NAME], capture_output=True)


@pytest.fixture()
def kind_manager(kind_cluster, tmp_path, monkeypatch):
    from kubernetes import config as k8s_config

    kubeconfig_path = tmp_path / "kubeconfig"
    kubeconfig_path.write_text(kind_cluster)
    monkeypatch.setenv("KUBECONFIG", str(kubeconfig_path))

    manager = VLLMKubernetesManager(namespace="default")
    # Force kubeconfig (not in-cluster) loading against our isolated kind cluster.
    monkeypatch.setattr(
        "kubernetes_container_manager.config.load_incluster_config",
        lambda: (_ for _ in ()).throw(k8s_config.ConfigException("not in cluster")),
    )
    return manager


@requires_kind
@pytest.mark.asyncio
async def test_status_reports_not_found_when_no_pod(kind_manager):
    status = await kind_manager.get_container_status()
    assert status["running"] is False
    assert status["status"] == "not_found"


@requires_kind
@pytest.mark.asyncio
async def test_pod_lifecycle_start_status_stop(kind_manager):
    # NOTE: `busybox` has no `python3`, so the manager's hardcoded
    # `vllm.entrypoints.openai.api_server` command will fail shortly after
    # the container starts (restart_policy=Never -> phase eventually
    # "Failed"). That's fine here: this test validates that start_container()
    # actually creates a real Pod/Service via the Kubernetes API and that
    # stop_container() actually deletes it -- the same create/delete
    # command-construction path used for real vLLM images -- without
    # depending on the workload staying healthy forever.
    result = await kind_manager.start_container(
        {"model": "tiny-model", "use_cpu": True},
        image="docker.io/library/busybox:latest",
    )
    assert result["status"] == "started"
    assert result["name"] == VLLMKubernetesManager.POD_NAME

    # Give the scheduler a moment, then confirm the manager sees the pod as
    # present in *some* phase (Pending/Running/Failed all count -- only
    # "not_found" means creation didn't actually happen).
    status = None
    for _ in range(30):
        status = await kind_manager.get_container_status()
        if status["status"] != "not_found":
            break
        time.sleep(1)
    assert status is not None
    assert status["status"] != "not_found"

    stop_result = await kind_manager.stop_container()
    assert stop_result["status"] == "stopped"

    final_status = await kind_manager.get_container_status()
    assert final_status["running"] is False
    assert final_status["status"] == "not_found"
