# Installation Guide

This guide covers all installation methods for vLLM Playground.

## Quick Comparison

| Method | Best For | Prerequisites |
|--------|----------|---------------|
| **PyPI** | Most users | Python 3.10+ |
| **Container (Source)** | Developers, customization | Python 3.10+, Podman |
| **OpenShift/Kubernetes** | Enterprise deployment | K8s cluster access |
| **Local (Traditional)** | Advanced users | Python 3.10+, vLLM installed |

---

## 📦 Option 1: PyPI Installation (Recommended)

The easiest way to get started:

```bash
# Basic installation
pip install vllm-playground

# With GuideLLM benchmarking support
pip install vllm-playground[benchmark]

# Pre-download container image (~10GB for GPU)
vllm-playground pull

# Start the playground
vllm-playground
```

Open http://localhost:7860 in your browser.

### CLI Options

```bash
vllm-playground --help              # Show all options
vllm-playground pull                # Pre-download GPU image with progress
vllm-playground pull --cpu          # Pre-download CPU image
vllm-playground pull --all          # Pre-download all images
vllm-playground --port 8080         # Use custom port
vllm-playground --host localhost    # Bind to localhost only
vllm-playground stop                # Stop running instance
vllm-playground status              # Check if running
```

### Benefits
- ✅ Simple one-command installation
- ✅ Automatic container management
- ✅ Pre-pull images with progress display
- ✅ Auto GPU/CPU detection
- ✅ Easy updates: `pip install --upgrade vllm-playground`

---

## 🐳 Option 2: Container Orchestration (From Source)

For development or customization:

```bash
# 1. Clone the repository
git clone https://github.com/micytao/vllm-playground.git
cd vllm-playground

# 2. Install Podman (if not already installed)
# macOS: brew install podman
# Linux: dnf install podman or apt install podman

# 3. Install Python dependencies
pip install -r requirements.txt

# 4. Start the Web UI
python run.py

# 5. Open http://localhost:7860
# 6. Click "Start Server" - vLLM container starts automatically!
```

### How It Works

```
┌──────────────────┐
│   User Browser   │
└────────┬─────────┘
         │ http://localhost:7860
         ↓
┌──────────────────┐
│   Web UI (Host)  │  ← FastAPI app
│   app.py         │
└────────┬─────────┘
         │ Podman CLI
         ↓
┌──────────────────┐
│  vLLM Container  │  ← Isolated vLLM service
│  (Port 8000)     │
└──────────────────┘
```

### Benefits
- ✅ No vLLM installation required
- ✅ Isolated vLLM environment
- ✅ Easy to modify and customize
- ✅ Same UI works locally and on OpenShift/Kubernetes

---

## ☸️ Option 3: OpenShift/Kubernetes Deployment

Deploy the entire stack to OpenShift or Kubernetes:
### GPU Clusters (Default) ⭐
```bash
# 1. Clone repo
git clone https://github.com/micytao/vllm-playground.git

# 2. Build and push Web UI image
cd vllm-playground
podman build -f openshift/Containerfile -t your-registry/vllm-playground:latest .
podman push your-registry/vllm-playground:latest

# 3. Update image in manifest
vim openshift/manifests/04-webui-deployment.yaml  # Update image reference

# 4. Deploy to OpenShift (GPU mode)
cd openshift/
./deploy.sh --gpu  # Uses vllm/vllm-openai:v0.12.0

# 5. Get Web UI URL
echo "https://$(oc get route vllm-playground -n vllm-playground -o jsonpath='{.spec.host}')"
```

### CPU Clusters
```bash
# Same steps 1-3 as above, then:

# 3. Deploy to OpenShift (CPU mode)
cd openshift/
./deploy.sh --cpu  # Uses quay.io/rh_ee_micyang/vllm-cpu:v0.11.0 (self-built, publicly accessible)

# 4. Get Web UI URL
echo "https://$(oc get route vllm-playground -n vllm-playground -o jsonpath='{.spec.host}')"
```


### Features
- ✅ Enterprise-grade deployment
- ✅ Dynamic vLLM pod creation via Kubernetes API
- ✅ Same UI and workflow as local setup
- ✅ Auto-scaling and resource management
- ✅ Automatic GPU detection from cluster nodes

### Container Images

| Mode | Image | Notes |
|------|-------|-------|
| GPU | `vllm/vllm-openai:v0.12.0` | Official vLLM image (v0.12.0+ for Claude Code) |
| CPU (Linux x86) | `quay.io/rh_ee_micyang/vllm-cpu:v0.11.0` | Self-built |
| CPU (macOS ARM64) | `quay.io/rh_ee_micyang/vllm-mac:v0.11.0` | Self-built |

All images are publicly accessible - no registry authentication needed.

**📖 Full Documentation:**
- [OpenShift README](../openshift/README.md)
- [Quick Start Guide](../openshift/QUICK_START.md)

---

## 💻 Option 4: Local Installation (Traditional)

For local development without containers (requires vLLM installed):

### 1. Install vLLM

```bash
# For GPU
pip install vllm

# For macOS/CPU mode
pip install vllm
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Start the WebUI

```bash
python run.py
```

Open http://localhost:7860 in your browser.

### 4. Start vLLM Server

**Option A: Using the WebUI**
- Select CPU or GPU mode
- Click "Start Server"

**Option B: Using the script (macOS/CPU)**
```bash
./scripts/run_cpu.sh
```

---

## 🍎 macOS Apple Silicon Notes

vLLM runs in CPU mode on macOS. Container mode is recommended:

```bash
# Just start the Web UI - it handles containers automatically
python run.py
# Click "Start Server" in the UI
```

For direct mode:
```bash
# Edit CPU configuration
nano config/vllm_cpu.env

# Run vLLM directly
./scripts/run_cpu.sh
```

**📖 See [macOS CPU Guide](MACOS_CPU_GUIDE.md)** for detailed setup.

---

## 🔧 Post-Installation

### Verify Installation

```bash
# Check if running
vllm-playground status

# Or check manually
curl http://localhost:7860/health
```

### First Steps

1. Open http://localhost:7860
2. Click "Start Server" to launch vLLM
3. Select a model (TinyLlama is pre-configured)
4. Start chatting!

### Optional: MCP Integration

For agentic capabilities with external tools:

```bash
# MCP requires Python 3.10+
pip install mcp

# Then configure MCP servers in the UI
```

#### MCP Server Dependencies (STDIO Transport Only)

MCP servers using **STDIO transport** (local command execution) require specific runtimes:

| Server Type | Requires | Installation |
|-------------|----------|--------------|
| **Node.js servers** (filesystem) | `npx` | `brew install node` (macOS) or https://nodejs.org/ |
| **Python servers** (git, fetch, time) | `uvx` | `brew install uv` (macOS) or https://docs.astral.sh/uv/ |

> **Note:** SSE transport (HTTP endpoints) doesn't require these - it connects to remote servers directly.

The UI will show helpful error messages if these are missing when you try to connect.

---

## 🆘 Troubleshooting

See [Troubleshooting Guide](TROUBLESHOOTING.md) for common issues.

### Quick Fixes

**Port already in use:**
```bash
vllm-playground stop
# or
python scripts/kill_playground.py
```

**Container won't start:**
```bash
podman ps -a | grep vllm
podman logs vllm-service
```

**Image pull issues:**
```bash
vllm-playground pull --all
```
