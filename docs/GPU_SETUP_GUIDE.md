# GPU Setup Guide for vLLM Playground

## Overview

This guide walks you through enabling GPU access for your vLLM Playground deployment on OpenShift/Kubernetes.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Step 1: Check GPU Availability](#step-1-check-gpu-availability)
- [Step 2: Update Deployment Configuration](#step-2-update-deployment-configuration)
- [Step 3: Apply Changes](#step-3-apply-changes)
- [Step 4: Verify GPU Access](#step-4-verify-gpu-access)
- [Step 5: Install GPU-Enabled Software](#step-5-install-gpu-enabled-software)
- [Troubleshooting](#troubleshooting)
- [Alternative: CPU-Only Setup](#alternative-cpu-only-setup)

---

## Prerequisites

### Required Cluster Resources

1. **GPU Nodes Available**: Your OpenShift/Kubernetes cluster must have nodes with NVIDIA GPUs
2. **NVIDIA GPU Operator Installed**: The cluster needs the GPU operator for GPU resource management
3. **Appropriate Permissions**: You need permissions to request GPU resources

---

## Step 1: Check GPU Availability

### Check if GPU Nodes Exist

Run these commands from your local machine:

```bash
# Check if GPU nodes are available
oc get nodes -o json | jq '.items[] | select(.status.capacity."nvidia.com/gpu" != null) | {name: .metadata.name, gpus: .status.capacity."nvidia.com/gpu"}'
```

Or for Kubernetes:

```bash
kubectl get nodes -o json | jq '.items[] | select(.status.capacity."nvidia.com/gpu" != null) | {name: .metadata.name, gpus: .status.capacity."nvidia.com/gpu"}'
```

**Expected output if GPUs are available:**
```json
{
  "name": "worker-gpu-1",
  "gpus": "1"
}
```

**If no output:** Your cluster doesn't have GPU nodes or the GPU operator isn't installed.

---

### Check GPU Operator Installation

```bash
# OpenShift
oc get pods -n nvidia-gpu-operator

# Kubernetes
kubectl get pods -n gpu-operator-resources
```

**Expected output:**
```
NAME                                       READY   STATUS
gpu-feature-discovery-xxxxx                1/1     Running
gpu-operator-xxxxx                         1/1     Running
nvidia-container-toolkit-daemonset-xxxxx   1/1     Running
nvidia-dcgm-exporter-xxxxx                 1/1     Running
nvidia-device-plugin-daemonset-xxxxx       1/1     Running
nvidia-driver-daemonset-xxxxx              1/1     Running
```

**If no pods found:** GPU operator is not installed. Contact your cluster administrator.

---

### Check Your Permissions

```bash
# Check if you can request GPU resources
oc auth can-i create resourcequotas --namespace vllm-playground-dev

# Check project resource limits
oc describe limitrange -n vllm-playground-dev
oc describe resourcequota -n vllm-playground-dev
```

---

## Step 2: Update Deployment Configuration

### Option A: Edit the Deployment File

Edit `deployments/openshift-deployment-dev.yaml`:

```yaml
        resources:
          requests:
            cpu: "4"
            memory: "8Gi"
            nvidia.com/gpu: "1"  # Add this line
          limits:
            cpu: "8"
            memory: "16Gi"
            nvidia.com/gpu: "1"  # Add this line
```

**For multiple GPUs:**
```yaml
            nvidia.com/gpu: "2"  # Request 2 GPUs
```

---

### Option B: Patch the Running Deployment

If you want to update without redeploying:

```bash
oc patch deployment vllm-playground-dev -n vllm-playground-dev --type='json' -p='[
  {
    "op": "add",
    "path": "/spec/template/spec/containers/0/resources/requests/nvidia.com~1gpu",
    "value": "1"
  },
  {
    "op": "add",
    "path": "/spec/template/spec/containers/0/resources/limits/nvidia.com~1gpu",
    "value": "1"
  }
]'
```

---

### Add Node Selector (Optional but Recommended)

To ensure your pod runs on GPU nodes:

```yaml
      nodeSelector:
        nvidia.com/gpu.present: "true"
```

Or if your cluster uses different labels:

```yaml
      nodeSelector:
        node-role.kubernetes.io/gpu: ""
```

**Check your cluster's GPU node labels:**
```bash
oc get nodes --show-labels | grep gpu
```

---

### Add Tolerations (If Needed)

If GPU nodes have taints:

```yaml
      tolerations:
      - key: nvidia.com/gpu
        operator: Exists
        effect: NoSchedule
```

---

## Step 3: Apply Changes

### Method 1: Apply Updated YAML

```bash
# Apply the updated deployment
oc apply -f deployments/openshift-deployment-dev.yaml

# Force pod restart to pick up changes
oc delete pod -l app=vllm-playground-dev -n vllm-playground-dev
```

---

### Method 2: Use oc patch (Quick Update)

If you used the patch command in Step 2, the pod will automatically restart.

---

### Monitor the Rollout

```bash
# Watch the deployment status
oc rollout status deployment/vllm-playground-dev -n vllm-playground-dev

# Check pod events
oc get events -n vllm-playground-dev --sort-by='.lastTimestamp'
```

---

## Step 4: Verify GPU Access

### Check Pod Scheduling

```bash
# Check if pod is running
oc get pods -n vllm-playground-dev

# Check which node it's on
oc get pod -n vllm-playground-dev -o wide
```

Look for a node name that includes "gpu" or check if it's a GPU node:

```bash
oc describe node <node-name> | grep -A 10 "Capacity:"
```

You should see:
```
Capacity:
  nvidia.com/gpu: 1
```

---

### Test GPU Access in Pod

Remote into the pod:

```bash
oc exec -it deployment/vllm-playground-dev -n vllm-playground-dev -- /bin/bash
```

**Run nvidia-smi:**
```bash
nvidia-smi
```

**Expected output:**
```
+-----------------------------------------------------------------------------+
| NVIDIA-SMI 525.XX.XX    Driver Version: 525.XX.XX    CUDA Version: 12.0   |
|-------------------------------+----------------------+----------------------+
| GPU  Name        Persistence-M| Bus-Id        Disp.A | Volatile Uncorr. ECC |
| Fan  Temp  Perf  Pwr:Usage/Cap|         Memory-Usage | GPU-Util  Compute M. |
|===============================+======================+======================|
|   0  Tesla T4            Off  | 00000000:00:04.0 Off |                    0 |
| N/A   45C    P0    27W /  70W |      0MiB / 15360MiB |      0%      Default |
+-------------------------------+----------------------+----------------------+
```

**If you get "command not found":** The GPU device plugin might not be working properly.

---

### Test with Python

```bash
python3 << 'EOF'
import torch

print(f"PyTorch version: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
print(f"CUDA version: {torch.version.cuda}")
print(f"Number of GPUs: {torch.cuda.device_count()}")

if torch.cuda.is_available():
    print(f"Current GPU: {torch.cuda.current_device()}")
    print(f"GPU Name: {torch.cuda.get_device_name(0)}")
    print(f"GPU Memory: {torch.cuda.get_device_properties(0).total_memory / 1e9:.2f} GB")
EOF
```

**Expected output:**
```
PyTorch version: 2.X.X
CUDA available: True
CUDA version: 12.1
Number of GPUs: 1
Current GPU: 0
GPU Name: Tesla T4
GPU Memory: 15.36 GB
```

---

## Step 5: Install GPU-Enabled Software

Once GPU access is confirmed, install vLLM first, then WebUI dependencies:

```bash
# Upgrade pip
pip3 install --upgrade pip setuptools wheel --user

# Install PyTorch with CUDA support
pip3 install --user torch torchvision --index-url https://download.pytorch.org/whl/cu121

# Install vLLM with GPU support
pip3 install --user vllm

# Verify GPU is accessible to PyTorch and vLLM
python3 -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}')"
python3 -c "import torch; print(f'GPU: {torch.cuda.get_device_name(0)}')"
python3 -c "import vllm; print(f'✅ vLLM version: {vllm.__version__}')"

# Now install WebUI dependencies
pip3 install --user -r /home/vllm/vllm-playground/requirements.txt

# Verify all dependencies
python3 -c "import flask, gradio; print('✅ All dependencies installed!')"
```

**Why this order?**
- Installing vLLM first allows you to verify GPU access and test vLLM functionality
- If there are GPU issues, you catch them early before installing all WebUI dependencies
- WebUI dependencies are faster to install and don't require GPU

See `docs/INSTALLATION_GUIDE.md` for detailed installation steps.

---

## Troubleshooting

### Issue: No GPU Nodes Available

**Error:**
```
0/3 nodes are available: 3 Insufficient nvidia.com/gpu
```

**Solutions:**

1. **Check if GPU nodes exist:**
   ```bash
   oc get nodes -o json | jq '.items[].status.capacity."nvidia.com/gpu"'
   ```

2. **Check if GPU operator is installed:**
   ```bash
   oc get pods -n nvidia-gpu-operator
   ```

3. **Contact your cluster administrator** to:
   - Add GPU nodes to the cluster
   - Install NVIDIA GPU Operator
   - Configure GPU resource allocation

---

### Issue: Pod Stuck in Pending State

**Check pod events:**
```bash
oc describe pod -l app=vllm-playground-dev -n vllm-playground-dev
```

**Common causes:**

1. **No GPU resources available:**
   - All GPUs are in use
   - Solution: Wait for GPU resources to free up or request more GPUs

2. **Node selector mismatch:**
   - Your nodeSelector doesn't match any nodes
   - Solution: Check and update nodeSelector

3. **Tolerations needed:**
   - GPU nodes have taints
   - Solution: Add appropriate tolerations

---

### Issue: nvidia-smi Not Found in Pod

**This could mean:**

1. **GPU device plugin not working**
2. **NVIDIA drivers not mounted**
3. **GPU not allocated to pod**

**Debugging steps:**

```bash
# Check if GPU was allocated
oc describe pod -l app=vllm-playground-dev -n vllm-playground-dev | grep nvidia.com/gpu

# Check device mounts
ls -la /dev/nvidia*

# Check environment variables
env | grep NVIDIA
```

**Solution:**
- Ensure GPU operator is running
- Restart the pod
- Contact cluster administrator

---

### Issue: CUDA Not Available in PyTorch

**Possible causes:**

1. **Wrong PyTorch version installed (CPU version)**
   ```bash
   pip3 uninstall torch torchvision
   pip3 install --user torch torchvision --index-url https://download.pytorch.org/whl/cu121
   ```

2. **CUDA version mismatch**
   ```bash
   nvidia-smi  # Check CUDA version
   python3 -c "import torch; print(torch.version.cuda)"
   ```
   Install PyTorch with matching CUDA version.

3. **GPU not accessible**
   - Verify `nvidia-smi` works
   - Check GPU resource allocation

---

### Issue: Permission Denied for GPU Access

**Check pod security context:**

```bash
oc get deployment vllm-playground-dev -n vllm-playground-dev -o yaml | grep -A 10 securityContext
```

**GPU access requires:**
- `allowPrivilegeEscalation: false` is fine
- But container needs access to `/dev/nvidia*` devices

This is typically handled by the GPU operator automatically.

---

### Issue: GPU Memory Errors

**Error:** `CUDA out of memory`

**Solutions:**

1. **Use smaller models**
2. **Reduce batch size**
3. **Request more GPU memory:**
   ```yaml
   nvidia.com/gpu: "2"  # Use 2 GPUs
   ```
4. **Use model quantization** (INT8, INT4)

---

## Alternative: CPU-Only Setup

If GPU access is not available or not needed, you can use CPU-only mode:

### Update Deployment (Remove GPU Requests)

```yaml
        resources:
          requests:
            cpu: "8"  # Increase CPU
            memory: "16Gi"  # Increase memory
          limits:
            cpu: "16"
            memory: "32Gi"
```

### Install CPU-Only Packages

```bash
pip3 install --user torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip3 install --user vllm-cpu-only
```

### Use CPU-Optimized Models

- **Smaller models** (< 7B parameters)
- **Quantized models** (INT8, INT4)
- **Efficient architectures** (DistilBERT, MobileBERT)

---

## GPU Resource Planning

### Recommended GPU Types for vLLM

| GPU Model | Memory | Best For |
|-----------|--------|----------|
| NVIDIA T4 | 16 GB | Small models (< 7B params) |
| NVIDIA A10 | 24 GB | Medium models (7-13B params) |
| NVIDIA A100 | 40/80 GB | Large models (13B-70B params) |
| NVIDIA H100 | 80 GB | Very large models (70B+ params) |

### Model Size vs GPU Memory

| Model Size | Min GPU Memory | Recommended |
|------------|----------------|-------------|
| 1-3B | 8 GB | 16 GB |
| 7B | 16 GB | 24 GB |
| 13B | 24 GB | 40 GB |
| 30B | 40 GB | 80 GB |
| 70B | 80 GB | 2x80 GB |

**Note:** These are for FP16/BF16. INT8 quantization reduces memory by ~50%.

---

## Summary Checklist

- [ ] Verify GPU nodes exist in cluster
- [ ] Confirm GPU operator is installed
- [ ] Check you have permissions to request GPU resources
- [ ] Update deployment with GPU resource requests
- [ ] Add node selector for GPU nodes (optional)
- [ ] Add tolerations if needed
- [ ] Apply deployment changes
- [ ] Verify pod is scheduled on GPU node
- [ ] Test `nvidia-smi` in pod
- [ ] Test PyTorch CUDA availability
- [ ] Install CUDA-enabled PyTorch and vLLM
- [ ] Start using GPU-accelerated models!

---

## Getting Help

**If you can't get GPU access:**

1. Contact your OpenShift/Kubernetes cluster administrator
2. Ask about:
   - GPU node availability
   - GPU operator installation
   - Resource quota limits
   - Required permissions

**For vLLM-specific issues:**
- Check vLLM documentation: https://docs.vllm.ai/
- Review INSTALLATION_GUIDE.md
- Check TROUBLESHOOTING.md

---

**Happy GPU-accelerated model serving!** 🚀🎮
