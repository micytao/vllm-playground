# OpenShift Deployment - Quick Start Guide

## Prerequisites

1. **OpenShift CLI** (`oc`) or **kubectl** installed
2. **Logged into your OpenShift cluster**:
   ```bash
   oc login <cluster-url>
   ```
3. **Built and pushed Web UI container** to your registry (one-time setup)

## Deployment Steps

### Step 1: Choose Your Deployment Mode

Determine if your cluster has GPU or CPU-only nodes:

```bash
# Check for GPU nodes
oc get nodes -L nvidia.com/gpu.present

# If you see "true" in the nvidia.com/gpu.present column, use GPU mode
# Otherwise, use CPU mode
```

### Step 2: Deploy

#### For GPU Clusters (Recommended for Production)

```bash
cd openshift/
./deploy.sh --gpu
```

**What this does:**
- Creates `vllm-playground` namespace
- Sets up RBAC (ServiceAccount, Role, RoleBinding)
- Creates ConfigMaps for GPU and CPU modes
- Deploys GPU-mode Web UI (1 replica)
- Creates CPU-mode deployment (0 replicas, for easy switching)
- Exposes via Route (OpenShift) or Service (Kubernetes)

**vLLM Image Used:** `vllm/vllm-openai:v0.11.0` (official community image)

#### For CPU-Only Clusters

```bash
cd openshift/
./deploy.sh --cpu
```

**vLLM Image Used:** `quay.io/rh_ee_micyang/vllm-service:cpu` (self-built, publicly accessible)

### Step 3: Access the Web UI

Get the URL:

```bash
# OpenShift (with Routes)
echo "https://$(oc get route vllm-playground -n vllm-playground -o jsonpath='{.spec.host}')"

# Kubernetes (with port-forward)
oc port-forward -n vllm-playground svc/vllm-playground 7860:7860
# Then visit: http://localhost:7860
```

### Step 4: Use the Playground

1. Open the Web UI URL in your browser
2. Select a model (e.g., `facebook/opt-125m` for testing)
3. Configure parameters:
   - **GPU mode**: Leave "Enable CPU Mode" unchecked
   - **CPU mode**: Check "Enable CPU Mode"
4. Click **"Start Server"**
5. Wait for the vLLM service to start (check logs tab)
6. Once ready, go to the **Chat** tab and start chatting!

## Common Operations

### View All Resources

```bash
oc get all -n vllm-playground
```

### Check Deployments

```bash
oc get deployments -n vllm-playground

# Example output (GPU mode active):
# NAME                      READY   UP-TO-DATE   AVAILABLE   AGE
# vllm-playground-gpu       1/1     1            1           5m
# vllm-playground-cpu       0/0     0            0           5m
```

### View Logs

```bash
# Web UI logs (GPU mode)
oc logs -f deployment/vllm-playground-gpu -n vllm-playground

# Web UI logs (CPU mode)
oc logs -f deployment/vllm-playground-cpu -n vllm-playground

# vLLM service logs (when running)
oc logs -f vllm-service -n vllm-playground
```

### Switch Between CPU and GPU

#### Switch from GPU to CPU

```bash
oc scale deployment/vllm-playground-gpu --replicas=0 -n vllm-playground
oc scale deployment/vllm-playground-cpu --replicas=1 -n vllm-playground
```

#### Switch from CPU to GPU

```bash
oc scale deployment/vllm-playground-cpu --replicas=0 -n vllm-playground
oc scale deployment/vllm-playground-gpu --replicas=1 -n vllm-playground
```

**Note:** After switching, restart any running vLLM service in the Web UI.

### Restart Web UI

```bash
# GPU mode
oc rollout restart deployment/vllm-playground-gpu -n vllm-playground

# CPU mode
oc rollout restart deployment/vllm-playground-cpu -n vllm-playground
```

### Undeploy

```bash
cd openshift/
./undeploy.sh

# Or force without confirmation
./undeploy.sh --force

# Or manually
oc delete namespace vllm-playground
```

## Troubleshooting

### Issue: ImagePullBackOff

**Cause:** Cannot pull container images

**Solution:** Check the image name and registry access:

```bash
# Check pod events for details
oc describe pod <pod-name> -n vllm-playground

# Verify the configured image
oc get configmap vllm-playground-config-gpu -n vllm-playground -o yaml

# The deployment uses community images from Docker Hub/Quay.io
# No pull secrets are required for these public images
# If you see ImagePullBackOff, it may be due to:
# 1. Typo in image name
# 2. Network connectivity issues
# 3. Rate limiting from the registry

# Restart deployment
oc rollout restart deployment/vllm-playground-gpu -n vllm-playground
```

### Issue: Pod Not Starting (Pending)

**Cause:** Insufficient resources or GPU not available

**Solution 1 - Check resources:**
```bash
oc describe pod <pod-name> -n vllm-playground
# Look for events like "Insufficient cpu/memory"
```

**Solution 2 - If GPU mode but no GPUs available:**
```bash
# Switch to CPU mode
./deploy.sh --cpu
```

**Solution 3 - Check GPU operator:**
```bash
# Ensure GPU operator is installed (for GPU clusters)
oc get pods -n nvidia-gpu-operator
```

### Issue: Route Not Found

**Cause:** Running on vanilla Kubernetes (not OpenShift)

**Solution:** Use port-forward instead:
```bash
oc port-forward -n vllm-playground svc/vllm-playground 7860:7860
# Visit: http://localhost:7860
```

### Issue: vLLM Service Won't Start

**Cause 1:** Model not found or download failed

**Solution:** Check vLLM logs:
```bash
oc logs vllm-service -n vllm-playground
```

**Common Error:** `LocalEntryNotFoundError: Cannot find an appropriate cached snapshot folder`

This error means the vLLM pod cannot download the model from HuggingFace. This can happen because:
1. **Network access blocked** - The pod has no internet access
2. **HuggingFace authentication required** - Some models require a HuggingFace token

**Solution A - Enable Internet Access:**

Check if the namespace has network policies blocking egress:
```bash
oc get networkpolicies -n vllm-playground
```

If your cluster restricts outbound traffic, you may need to:
1. Request network policy changes from your cluster admin
2. Use pre-downloaded models (mount as PVC)
3. Set up a model mirror/cache in your cluster

**Solution B - Configure HuggingFace Token:**

For gated models (Llama, Mistral, etc.), you need a HuggingFace token:
```bash
# Get your token from https://huggingface.co/settings/tokens

# Create a secret with your HuggingFace token
oc create secret generic huggingface-token \
  --from-literal=HF_TOKEN=hf_xxxxxxxxxxxx \
  -n vllm-playground

# Note: Currently, HF tokens must be entered via the Web UI
# Future enhancement: Auto-inject from secret
```

Then enter your token in the Web UI under "Advanced Settings" when starting a server.

**Cause 2:** Insufficient memory

**Solution:** Use a smaller model or increase limits in `kubernetes_container_manager.py`

**Cause 3:** Wrong mode (GPU model on CPU deployment)

**Solution:** 
- For GPU models: Use GPU deployment (`./deploy.sh --gpu`)
- For CPU models: Check "Enable CPU Mode" in Web UI

## Architecture Overview

```
User Browser
     │
     ↓
OpenShift Route (HTTPS)
     │
     ↓
Service: vllm-playground
     │
     ↓
Deployment: vllm-playground-gpu (active)
  or vllm-playground-cpu (active)
     │
     ├─→ Web UI Container
     │    (FastAPI + React)
     │    │
     │    └─→ Kubernetes API
     │         (Creates/Deletes vLLM Pods)
     │
     └─→ vLLM Service Pod (created dynamically)
          (vLLM OpenAI API Server)
```

## Configuration

### ConfigMaps

- `vllm-playground-config-gpu`: GPU mode configuration
- `vllm-playground-config-cpu`: CPU mode configuration

**Key settings:**
- `VLLM_IMAGE`: Container image for vLLM service
- `KUBERNETES_NAMESPACE`: Namespace for vLLM pods
- `USE_PERSISTENT_CACHE`: Enable PVC for model caching
- `MODEL_CACHE_PVC`: PVC name for model cache

### Environment Variables (Web UI)

Set in deployment manifest (`04-webui-deployment.yaml`):
- `KUBERNETES_NAMESPACE`: Where to create vLLM pods
- `VLLM_IMAGE`: Image to use for vLLM service
- `USE_PERSISTENT_CACHE`: Enable persistent model cache
- `MODEL_CACHE_PVC`: PVC for model cache (if enabled)

## Next Steps

- **[README.md](README.md)** - Architecture overview and deployment details

## Quick Command Reference

```bash
# Deploy GPU mode
./deploy.sh --gpu

# Deploy CPU mode
./deploy.sh --cpu

# Get Web UI URL
echo "https://$(oc get route vllm-playground -n vllm-playground -o jsonpath='{.spec.host}')"

# View all resources
oc get all -n vllm-playground

# View Web UI logs (GPU)
oc logs -f deployment/vllm-playground-gpu -n vllm-playground

# View vLLM logs
oc logs -f vllm-service -n vllm-playground

# Switch to CPU
oc scale deployment/vllm-playground-gpu --replicas=0 -n vllm-playground && \
oc scale deployment/vllm-playground-cpu --replicas=1 -n vllm-playground

# Switch to GPU
oc scale deployment/vllm-playground-cpu --replicas=0 -n vllm-playground && \
oc scale deployment/vllm-playground-gpu --replicas=1 -n vllm-playground

# Undeploy
./undeploy.sh
```

