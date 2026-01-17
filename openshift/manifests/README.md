# Kubernetes/OpenShift Manifests

This directory contains all the Kubernetes manifests needed to deploy vLLM Playground.

## Files

| File | Description | Required |
|------|-------------|----------|
| `00-secrets-template.yaml` | Template for registry pull secret (only if using private registries) | ⚙️ Optional |
| `01-namespace.yaml` | Creates `vllm-playground` namespace | ✅ Yes |
| `02-rbac.yaml` | ServiceAccount, Role, RoleBinding for pod management | ✅ Yes |
| `03-configmap.yaml` | Configuration for GPU and CPU modes | ✅ Yes |
| `04-webui-deployment.yaml` | Web UI deployment, service, and route | ✅ Yes |
| `05-pvc-optional.yaml` | Optional persistent volume for model cache | ⚙️ Optional |

## Quick Setup

### 1. Deploy

**Note:** Pull secrets are NOT required for community container images. The deployment uses public images from Docker Hub and other public registries.

```bash
cd /Users/micyang/vllm-playground/openshift

# For GPU clusters (default)
./deploy.sh --gpu

# For CPU-only clusters
./deploy.sh --cpu
```

The deploy script will:
- ✅ Create the namespace
- ✅ Set up RBAC resources
- ✅ Deploy all required resources

## Manual Deployment

If you prefer to apply manifests manually:

```bash
# Create namespace
oc apply -f 01-namespace.yaml

# Create RBAC resources
oc apply -f 02-rbac.yaml

# Create ConfigMaps
oc apply -f 03-configmap.yaml

# Deploy Web UI
oc apply -f 04-webui-deployment.yaml

# Optional: Create persistent model cache
oc apply -f 05-pvc-optional.yaml
```

## Security Notes

The deployment uses public community container images that don't require pull secrets.

If you need to use private registries or images that require authentication, see `00-secrets-template.yaml` for instructions on creating pull secrets.

For production secrets management, consider using:
- **Sealed Secrets**: https://github.com/bitnami-labs/sealed-secrets
- **External Secrets Operator**: https://external-secrets.io/
- **Vault**: https://www.vaultproject.io/

## Configuration

### GPU vs CPU Mode

The deployment supports both GPU and CPU modes. Choose one:

```bash
# GPU mode (default) - uses vllm/vllm-openai:v0.11.0 (official)
./deploy.sh --gpu

# CPU mode - uses quay.io/rh_ee_micyang/vllm-cpu:v0.11.0 (self-built, public)
./deploy.sh --cpu
```

Edit `03-configmap.yaml` to customize:
- `VLLM_IMAGE`: Container image to use
- `USE_PERSISTENT_CACHE`: Enable persistent model storage
- `MODEL_CACHE_PVC`: PVC name for model cache

### Persistent Model Cache

To avoid re-downloading models on every pod restart:

1. Edit `05-pvc-optional.yaml` to set desired storage size
2. Apply it: `oc apply -f 05-pvc-optional.yaml`
3. Enable in ConfigMap: Set `USE_PERSISTENT_CACHE: "true"`
4. Restart deployment: `oc rollout restart deployment/vllm-playground-gpu -n vllm-playground`

## Troubleshooting

### Image Pull Errors

If you see `ImagePullBackOff`:

```bash
# Check pod events
oc describe pod vllm-service -n vllm-playground

# Common causes:
# 1. Image name typo in ConfigMap
# 2. Network connectivity issues
# 3. Registry rate limiting
# 4. Image does not exist or was deleted

# Verify the configured image
oc get configmap vllm-playground-config-gpu -n vllm-playground -o yaml
```

### Model Download Issues

If vLLM can't download models:

```bash
# Check vLLM pod logs
oc logs vllm-service -n vllm-playground

# Common causes:
# 1. No internet access (NetworkPolicy blocking egress)
# 2. HuggingFace token required (for gated models)
# 3. Model not found

# Test network access
oc run -it --rm debug --image=registry.access.redhat.com/ubi9/ubi-minimal:latest \
  -n vllm-playground -- curl -I https://huggingface.co
```

## References

- [OpenShift QUICK_START.md](../QUICK_START.md)
- [Kubernetes container manager](../kubernetes_container_manager.py)
- [Deploy script](../deploy.sh)
