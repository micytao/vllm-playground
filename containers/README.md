# vLLM Playground Container Images

This directory contains Containerfile variants optimized for different deployment scenarios.

## Container Architecture

The project uses a **hybrid container approach** for maximum flexibility:

### 1. Web UI Orchestrator Container
- **Local Development**: `Containerfile.vllm-playground`
- **OpenShift/Kubernetes**: `../openshift/Containerfile`

The Web UI runs in its own container and orchestrates vLLM service containers/pods dynamically.

### 2. vLLM Service Containers

**For CPU Mode:**
- **`Containerfile.cpu`** - Self-built optimized vLLM image for CPU workloads
  - Built from source with CPU optimizations
  - Publicly hosted: `quay.io/rh_ee_micyang/vllm-service:cpu`
  - Used for: Local macOS, CPU-only clusters
  - Includes: Python 3.12, vLLM with CPU support, startup scripts

**For GPU Mode:**
- **Official vLLM Image** - `vllm/vllm-openai:v0.11.0`
  - Community-maintained official image
  - Pre-built with CUDA support
  - Publicly accessible from Docker Hub
  - Used for: GPU-enabled clusters

**For macOS Local Development:**
- **`Containerfile.mac`** - macOS-compatible CPU image
  - Optimized for Apple Silicon and Intel Macs
  - Similar to `Containerfile.cpu` but with macOS-specific tuning
  - Used locally with Podman on macOS

## Container Variants Overview

| Container | Purpose | Size | Use Case |
|-----------|---------|------|----------|
| **Containerfile.cpu** | vLLM CPU service | ~5-8GB | CPU-only clusters, self-built optimized image |
| **Containerfile.mac** | vLLM macOS service | ~5-8GB | Local macOS development (Apple Silicon/Intel) |
| **Containerfile.vllm-playground** | Web UI orchestrator | ~2-3GB | Local Podman-based deployment |
| **../openshift/Containerfile** | Web UI orchestrator | ~2-3GB | OpenShift/Kubernetes deployment |

## Current Container Strategy

**GPU Deployments:**
- ✅ Use official vLLM image: `vllm/vllm-openai:v0.11.0`
- ✅ No build required - pull directly from Docker Hub
- ✅ No authentication needed (public image)

**CPU Deployments:**
- ✅ Use self-built image: `quay.io/rh_ee_micyang/vllm-service:cpu`
- ✅ Built from `Containerfile.cpu` with CPU optimizations
- ✅ Publicly accessible on Quay.io (no authentication needed)

**Key Benefits:**
- No registry pull secrets required
- Fast deployment (official GPU image)
- Optimized CPU performance (self-built)
- Same UI and workflow for both modes

## Build Instructions

### Build CPU vLLM Service Image
```bash
podman build -f containers/Containerfile.cpu -t vllm-service:cpu .

# Tag and push to registry (if needed)
podman tag vllm-service:cpu quay.io/yourusername/vllm-service:cpu
podman push quay.io/yourusername/vllm-service:cpu
```

### Build macOS vLLM Service Image
```bash
podman build -f containers/Containerfile.mac -t vllm-service:macos .
```

### Build Web UI Orchestrator (Local)
```bash
podman build -f containers/Containerfile.vllm-playground -t vllm-playground:latest .
```

### Build Web UI Orchestrator (OpenShift)
```bash
podman build -f openshift/Containerfile -t vllm-playground-webui:latest .
```

## Usage

### Local Development (Podman)

**Option 1: Just run the Web UI** (Recommended)
```bash
# Start Web UI - it will pull/manage vLLM containers automatically
python run.py
# Open http://localhost:7860
# Click "Start Server" - vLLM container starts automatically
```

**Option 2: Run everything in containers**
```bash
# Start Web UI container
podman run -d \
  -p 7860:7860 \
  -v /var/run/podman/podman.sock:/var/run/podman/podman.sock:z \
  --name vllm-playground \
  vllm-playground:latest
```

### OpenShift/Kubernetes Deployment

See [../openshift/README.md](../openshift/README.md) and [../openshift/QUICK_START.md](../openshift/QUICK_START.md) for detailed deployment instructions.

## Container Images Repository

| Image | Registry | Public | Authentication |
|-------|----------|--------|----------------|
| Web UI (OpenShift) | `quay.io/rh_ee_micyang/vllm-playground:0.2` | ✅ Yes | ❌ None |
| vLLM GPU | `vllm/vllm-openai:v0.11.0` | ✅ Yes | ❌ None |
| vLLM CPU | `quay.io/rh_ee_micyang/vllm-service:cpu` | ✅ Yes | ❌ None |
| vLLM macOS | Local build only | N/A | N/A |

**Note:** All container images used in production are publicly accessible. No registry authentication or pull secrets are required.

## Troubleshooting

### Image Pull Errors

All images are public - no authentication needed:
```bash
# Test GPU image pull
podman pull vllm/vllm-openai:v0.11.0

# Test CPU image pull
podman pull quay.io/rh_ee_micyang/vllm-service:cpu
```

### Build Fails with Space Issues

```bash
# Clean up build cache
podman system prune -a

# Build with no cache
podman build --no-cache -f containers/Containerfile.cpu -t vllm-service:cpu .
```

### Container Starts But Dependencies Missing

This shouldn't happen with the current images. If it does:
1. Check the container logs: `podman logs vllm-service`
2. Verify the image was pulled correctly: `podman images`
3. Try rebuilding (for custom images) or re-pulling (for public images)

For detailed troubleshooting, see: [../docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md)
