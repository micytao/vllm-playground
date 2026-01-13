# Deployment Configurations (Legacy)

> **⚠️ NOTICE: This directory contains legacy deployment configurations.**
>
> **For new deployments, please use the [`openshift/`](../openshift/) directory** which provides:
> - ✅ Dynamic pod management via Kubernetes API
> - ✅ Automated deployment scripts (CPU/GPU)
> - ✅ RBAC-based security
> - ✅ Smart container orchestration
> - ✅ Better documentation
>
> **Quick Start (New):** See [openshift/QUICK_START.md](../openshift/QUICK_START.md)
>
> The files in this directory are kept for backwards compatibility and simple static deployments.

---

This directory contains **legacy** deployment configurations and scripts for running vLLM Playground on Kubernetes and OpenShift.

## Available Deployments

### ☸️ kubernetes-deployment.yaml
Standard Kubernetes deployment manifest for vLLM Playground.

**Features:**
- Deployment with GPU support
- Service for WebUI and vLLM API
- ConfigMap for configuration
- Resource limits and requests
- Health checks

**Deploy:**
```bash
kubectl apply -f deployments/kubernetes-deployment.yaml
```

### 🔴 openshift-deployment.yaml
OpenShift-specific deployment with Route, BuildConfig, and ImageStream.

**Features:**
- BuildConfig for building from source
- ImageStream for image management
- Route for external access
- GPU support via NVIDIA device plugin
- Security Context Constraints (SCC)

**Deploy:**
```bash
oc apply -f deployments/openshift-deployment.yaml
```

### 🚀 deploy-to-openshift.sh
Automated deployment script for OpenShift with interactive setup.

**Features:**
- Interactive project and image configuration
- Automatic resource creation
- GPU detection and configuration
- Build monitoring
- Deployment verification

**Usage:**
```bash
./deployments/deploy-to-openshift.sh
```

## Quick Start

### Kubernetes Deployment

1. **Prerequisites:**
   - Kubernetes cluster with GPU support (optional but recommended)
   - NVIDIA GPU Operator installed (for GPU support)
   - kubectl configured

2. **Deploy:**
   ```bash
   # Review and customize the YAML first
   vim deployments/kubernetes-deployment.yaml

   # Deploy
   kubectl apply -f deployments/kubernetes-deployment.yaml

   # Check status
   kubectl get pods -l app=vllm-playground
   kubectl get svc vllm-playground
   ```

3. **Access:**
   ```bash
   # Port forward to access locally
   kubectl port-forward svc/vllm-playground 7860:7860

   # Open http://localhost:7860
   ```

### OpenShift Deployment

#### Option 1: Automated Script (Recommended)
```bash
# Run the deployment script
./deployments/deploy-to-openshift.sh

# Follow the interactive prompts
# The script will:
# - Create/select a project
# - Build the container image
# - Deploy the application
# - Create a route for external access
```

#### Option 2: Manual Deployment
```bash
# Create a new project
oc new-project vllm-playground

# Apply the deployment
oc apply -f deployments/openshift-deployment.yaml

# Check the build
oc logs -f bc/vllm-playground

# Check the deployment
oc get pods -l app=vllm-playground

# Get the route URL
oc get route vllm-playground
```

## GPU Support

### Prerequisites
- NVIDIA GPU Operator or device plugin installed
- GPU nodes labeled appropriately

### Kubernetes GPU Configuration
The deployment includes GPU resource requests:
```yaml
resources:
  limits:
    nvidia.com/gpu: 1
  requests:
    nvidia.com/gpu: 1
```

### OpenShift GPU Configuration
Ensure your cluster has:
1. NVIDIA GPU Operator installed
2. GPU nodes with proper labels
3. Cluster admin access to modify SCCs if needed

Check GPU availability:
```bash
# Kubernetes
kubectl get nodes -o json | jq '.items[].status.allocatable'

# OpenShift
oc get nodes -o json | jq '.items[].status.allocatable'
```

## Configuration

### Environment Variables
Customize these in the deployment YAML:
- `WEBUI_PORT`: WebUI port (default: 7860)
- `VLLM_PORT`: vLLM API port (default: 8000)
- `HF_TOKEN`: HuggingFace token for gated models (optional)

### Resource Limits
Adjust based on your model size:
```yaml
resources:
  limits:
    memory: "16Gi"  # Increase for larger models
    cpu: "4"
    nvidia.com/gpu: 1
  requests:
    memory: "8Gi"
    cpu: "2"
    nvidia.com/gpu: 1
```

## Accessing the Application

### Kubernetes
```bash
# Port forward
kubectl port-forward svc/vllm-playground 7860:7860

# Or create an Ingress (if you have an Ingress controller)
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: vllm-playground
spec:
  rules:
  - host: vllm-playground.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: vllm-playground
            port:
              number: 7860
EOF
```

### OpenShift
```bash
# Get the route URL
oc get route vllm-playground -o jsonpath='{.spec.host}'

# Access via browser
# OpenShift automatically creates a route with TLS
```

## Troubleshooting

### Pod Won't Start
```bash
# Check pod events
kubectl describe pod -l app=vllm-playground

# Check logs
kubectl logs -l app=vllm-playground --tail=100
```

### GPU Not Detected
```bash
# Verify GPU operator is running
kubectl get pods -n gpu-operator-resources

# Check node labels
kubectl get nodes --show-labels | grep gpu
```

### Build Fails (OpenShift)
```bash
# Check build logs
oc logs -f bc/vllm-playground

# Retry build
oc start-build vllm-playground
```

### Can't Access WebUI
```bash
# Check service
kubectl get svc vllm-playground

# Check endpoints
kubectl get endpoints vllm-playground

# Test internal connectivity
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- curl http://vllm-playground:7860
```

## Security Considerations

1. **Secrets Management**: Store sensitive data (HF tokens) in Kubernetes Secrets
   ```bash
   kubectl create secret generic vllm-secrets \
     --from-literal=HF_TOKEN=your-token-here
   ```

2. **Network Policies**: Restrict pod-to-pod communication
3. **RBAC**: Use appropriate service accounts and roles
4. **Image Security**: Use trusted base images and scan for vulnerabilities

## Monitoring

Add monitoring labels to integrate with Prometheus:
```yaml
metadata:
  labels:
    app: vllm-playground
    prometheus.io/scrape: "true"
    prometheus.io/port: "7860"
```

## See Also

- [Container Definitions](../containers/README.md) - Available container images
- [Main Documentation](../docs/) - Application documentation
- [vLLM Documentation](https://docs.vllm.ai/) - vLLM official docs
