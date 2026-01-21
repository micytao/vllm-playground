# Deploying vLLM Playground to OpenShift/Kubernetes

## Architecture Options

### Option 1: Static Deployment (Simplest) ⭐ RECOMMENDED FOR PROD

**Architecture:**
```
┌─────────────────┐         ┌──────────────────┐
│  Web UI Pod     │────────>│  vLLM Service    │
│  (FastAPI)      │  HTTP   │  (Always Running)│
└─────────────────┘         └──────────────────┘
```

**Pros:**
- Simple, reliable, production-ready
- No special permissions needed
- Standard Kubernetes patterns
- Easy to scale and monitor

**Cons:**
- Can't dynamically change models via UI
- Configuration changes require redeployment
- Always consuming resources even when idle

**Best for:** Production environments, single model use case

---

### Option 2: Dynamic Pod Management (Most Flexible) ⭐ RECOMMENDED FOR YOUR USE CASE

**Architecture:**
```
┌─────────────────┐   K8s API   ┌──────────────────┐
│  Web UI Pod     │────────────>│  Creates/Deletes │
│  (FastAPI +     │             │  vLLM Pods       │
│   K8s Client)   │             │  Dynamically     │
└─────────────────┘             └──────────────────┘
```

**Pros:**
- Keep your existing UI workflow ("Start Server" button)
- Dynamic model switching
- Resource efficient (only run when needed)
- Similar to your local Podman setup

**Cons:**
- Requires ServiceAccount with pod creation permissions (RBAC)
- More complex than static deployment
- Needs proper cleanup on failures

**Best for:** Development, experimentation, multi-model testing

---

### Option 3: Kubernetes Job Pattern (Good Middle Ground)

**Architecture:**
```
┌─────────────────┐  Create Job  ┌──────────────────┐
│  Web UI Pod     │─────────────>│  vLLM Job/Pod    │
│  (K8s Client)   │              │  (Runs to Completion)
└─────────────────┘              └──────────────────┘
```

**Pros:**
- Automatic cleanup
- Job tracking and retry logic
- Good for batch/benchmark workloads

**Cons:**
- Jobs are meant for completion, vLLM is long-running
- Not ideal for interactive servers

**Best for:** Benchmark workloads, batch inference

---

## ✅ Implemented: Option 2 (Dynamic Pod Management)

**Status: COMPLETE & VERIFIED** ✅

This implementation maintains your current workflow while leveraging OpenShift's orchestration.

### Implementation Overview

1. ✅ **Web UI Container** runs in OpenShift
2. ✅ Uses **Kubernetes Python Client** instead of Podman
3. ✅ **ServiceAccount** with permissions to create/delete pods
4. ✅ **Same WebUI** - users click "Start Server" and a vLLM pod is created

### Key Changes from Local Setup

| Local (Podman) | OpenShift/K8s |
|----------------|---------------|
| `podman run` | `client.create_namespaced_pod()` |
| `podman stop` | `client.delete_namespaced_pod()` |
| `podman logs -f` | `client.read_namespaced_pod_log()` |
| Container name | Pod name |
| Port mapping | Service + ClusterIP |
| Volume mounts | PVCs or hostPath |
| `container_manager.py` | `kubernetes_container_manager.py` |

### How It Works

**File Substitution at Build Time:**

```dockerfile
# openshift/Containerfile (line 38)
COPY openshift/kubernetes_container_manager.py ${HOME}/vllm-playground/container_manager.py
```

- **Locally**: `app.py` imports `container_manager.py` (Podman CLI)
- **In OpenShift**: `app.py` imports the **substituted** file (Kubernetes API)
- **Same interface**: Both managers implement identical methods
- **Same UX**: Users see no difference!

**No Podman in OpenShift - Only Kubernetes API** ✅

---

## 📚 Documentation

- **[QUICK_START.md](QUICK_START.md)** - 5-minute deployment guide
- **[kubernetes_container_manager.py](kubernetes_container_manager.py)** - Kubernetes implementation

---

## 🚀 Quick Deployment

### GPU Clusters (Default) ⭐
```bash
# 1. Build and push Web UI image
cd /Users/micyang/vllm-playground
podman build -f openshift/Containerfile -t vllm-playground-webui:latest .
podman tag vllm-playground-webui:latest quay.io/yourusername/vllm-playground-webui:latest
podman push quay.io/yourusername/vllm-playground-webui:latest

# 2. Update image in manifest
vim openshift/manifests/04-webui-deployment.yaml  # Update image reference

# 3. Deploy to OpenShift (GPU mode)
cd openshift/
./deploy.sh --gpu  # Uses vllm/vllm-openai:v0.12.0

# 4. Get Web UI URL
echo "https://$(oc get route vllm-playground -n vllm-playground -o jsonpath='{.spec.host}')"
```

### CPU Clusters
```bash
# Same steps 1-2 as above, then:

# 3. Deploy to OpenShift (CPU mode)
cd openshift/
./deploy.sh --cpu  # Uses quay.io/rh_ee_micyang/vllm-cpu:v0.11.0 (self-built, publicly accessible)

# 4. Get Web UI URL
echo "https://$(oc get route vllm-playground -n vllm-playground -o jsonpath='{.spec.host}')"
```

## 🗑️ Undeployment

```bash
# Quick undeploy (deletes namespace and all resources)
cd openshift/
./undeploy.sh

# OR force undeploy without confirmation
./undeploy.sh --force

# OR detailed undeploy (deletes resources individually)
./undeploy-detailed.sh
```

---

## ✅ Verification

The implementation has been verified for interface compatibility:

```bash
# Run verification script
python3 openshift/verify_interface.py
```

**Result:** ✅ All required methods present and signatures match!

---

## 🔒 Security Considerations for OpenShift

1. ✅ **RBAC**: Minimal permissions (only pod creation in specific namespace)
2. ✅ **ServiceAccount**: Dedicated SA for web UI (`vllm-playground-sa`)
3. ✅ **SecurityContextConstraints (SCC)**: OpenShift's security layer
4. ⚙️ **ResourceQuotas**: Can limit how many vLLM pods can be created
5. ⚙️ **NetworkPolicies**: Can restrict pod-to-pod communication

---

## 📋 Files in This Directory

| File | Purpose |
|------|---------|
| `kubernetes_container_manager.py` | K8s-based manager (replaces Podman) |
| `Containerfile` | Builds Web UI image for OpenShift |
| `requirements-k8s.txt` | Python deps (includes kubernetes client) |
| `manifests/` | Kubernetes manifests for deployment |
| `deploy.sh` | 🚀 Automated deployment script (supports --gpu/--cpu) |
| `undeploy.sh` | 🗑️ Automated undeployment script (fast) |
| `undeploy-detailed.sh` | 🗑️ Detailed undeployment script |
| `README.md` | This file - architecture overview |
| `QUICK_START.md` | Quick deployment guide |
| `verify_interface.py` | Interface compatibility test script |

## 🎮 GPU Support

✅ **GPU support is fully enabled!**

The deployment automatically detects and uses GPUs when:
- CPU mode is **disabled** in the Web UI
- GPU nodes are available in the cluster

**Features:**
- ✅ Automatic GPU resource requests
- ✅ GPU node targeting via node selector
- ✅ Multi-GPU support (tensor parallelism)
- ✅ Falls back to CPU mode when enabled

## 🖥️ CPU vs GPU Deployment

The deployment supports both **CPU-only** and **GPU-enabled** clusters:

| Mode | Container Image | Use Case |
|------|----------------|----------|
| **GPU** (default) | `vllm/vllm-openai:v0.12.0` | Production workloads on GPU clusters (official vLLM image, v0.12.0+ for Claude Code) |
| **CPU** | `quay.io/rh_ee_micyang/vllm-cpu:v0.11.0` | Development/testing on CPU-only clusters (self-built, optimized) |

**Container Strategy:**
- ✅ **GPU**: Uses official community vLLM image (no authentication needed)
- ✅ **CPU**: Uses self-built optimized image (publicly accessible on Quay.io)
- ✅ **No Pull Secrets**: Both images are publicly accessible, no registry authentication required

**Features:**
- ✅ Easy switching between CPU and GPU modes
- ✅ Dedicated ConfigMaps for each mode
- ✅ Separate deployments (one active at a time)
- ✅ Single command deployment: `./deploy.sh --gpu` or `./deploy.sh --cpu`

