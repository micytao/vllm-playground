# vLLM Playground

A modern web interface for managing and interacting with vLLM servers (www.github.com/vllm-project/vllm). Supports both GPU and CPU modes, with special optimizations for macOS Apple Silicon and enterprise deployment on OpenShift/Kubernetes.

![vLLM Playground Interface](assets/vllm-playground.png)

## 🐳 New: Containerized vLLM Service

**No more manual vLLM installation!** The Web UI now automatically manages vLLM in isolated containers, providing a seamless experience from local development to enterprise deployment.

**📹 Watch Demo: Automatic Container Startup**

![Start vLLM Demo](assets/start-vllm.gif)

*See how easy it is: Just click "Start Server" and the container orchestrator automatically starts the vLLM container - no manual installation or configuration needed!*

**📹 Watch Demo: Automatic Container Shutdown**

![Stop vLLM Demo](assets/stop-vllm.gif)

*Clean shutdown: Click "Stop Server" and the container orchestrator gracefully stops the vLLM container with automatic cleanup!*

**Key Benefits:**
- ✅ **Zero Setup**: No vLLM installation required - containers handle everything
- ✅ **Isolated Environment**: vLLM runs in its own container, preventing conflicts
- ✅ **Smart Management**: Automatic container lifecycle (start, stop, logs, health checks)
- ✅ **Fast Restarts**: Configuration caching for quick server restarts
- ✅ **Hybrid Architecture**: Same UI works locally (Podman) and in cloud (Kubernetes)

**Architecture:**
- **Local Development**: Podman-based container orchestration
- **Enterprise Deployment**: OpenShift/Kubernetes with dynamic pod creation
- **Container Manager**: Automatic lifecycle management with smart reuse

## 📊 New: GuideLLM Benchmarking

Integrated GuideLLM for comprehensive performance benchmarking and analysis. Run load tests and get detailed metrics on throughput, latency, and token generation performance!

![GuideLLM Benchmark Results](assets/guidellm.png)

## 📚 New: vLLM Community Recipes

**One-click model configurations from the official [vLLM Recipes Repository](https://github.com/vllm-project/recipes)!** Browse community-maintained configurations for popular models like DeepSeek, Qwen, Llama, Mistral, and more.

![vLLM Recipes Browser](assets/vllm-recipes-1.png)

*Browse 17+ model categories with optimized configurations - just click "Load Config" to auto-fill all settings!*

![vLLM Recipes Details](assets/vllm-recipes-2.png)

*Each recipe includes hardware requirements, vLLM parameters, and direct links to documentation.*

**Key Features:**
- ✅ **One-Click Configuration**: Load optimized vLLM settings instantly
- ✅ **Community-Maintained**: Syncs with official vLLM recipes repository
- ✅ **Searchable Catalog**: Filter by model name, category, or tags (multi-gpu, vision, reasoning, etc.)
- ✅ **Hardware Guidance**: See recommended GPU configurations for each model
- ✅ **Custom Recipes**: Add, edit, or delete your own recipes
- ✅ **GitHub Sync**: Update catalog from GitHub with optional token for higher rate limits

**Supported Model Families:**
DeepSeek, Qwen, Llama, Mistral, InternVL, GLM, NVIDIA Nemotron, Moonshot AI (Kimi), MiniMax, Jina AI, Tencent Hunyuan, Ernie, OpenAI, PaddlePaddle, Seed, inclusionAI, and CPU-friendly models.

## 🔧 Model Compression

**Looking for model compression and quantization?** Check out the separate **[LLMCompressor Playground](https://github.com/micytao/llmcompressor-playground)** project for:
- Model quantization (INT8, INT4, FP8)
- GPTQ, AWQ, and SmoothQuant algorithms
- Built-in compression presets
- Integration with vLLM

This keeps the vLLM Playground focused on serving and benchmarking, while providing a dedicated tool for model optimization.

## 📁 Project Structure

```
vllm-playground/
├── app.py                       # Main FastAPI backend application
├── run.py                       # Backend server launcher
├── container_manager.py         # 🆕 Podman-based container orchestration (local)
├── index.html                   # Main HTML interface
├── requirements.txt             # Python dependencies
├── env.example                  # Example environment variables
├── LICENSE                      # MIT License
├── README.md                    # This file
│
├── containers/                  # Container definitions 🐳
│   ├── Containerfile.vllm-playground  # 🆕 Web UI container (orchestrator)
│   ├── Containerfile.mac       # 🆕 vLLM service container (macOS/CPU)
│   └── README.md               # Container variants documentation
│
├── openshift/                   # 🆕 OpenShift/Kubernetes deployment ☸️
│   ├── kubernetes_container_manager.py  # K8s API-based orchestration
│   ├── Containerfile           # Web UI container for OpenShift
│   ├── requirements-k8s.txt    # Python dependencies (with K8s client)
│   ├── deploy.sh               # Automated deployment (CPU/GPU)
│   ├── undeploy.sh             # Automated undeployment
│   ├── build.sh                # Container build script
│   ├── manifests/              # Kubernetes manifests
│   │   ├── 00-secrets-template.yaml
│   │   ├── 01-namespace.yaml
│   │   ├── 02-rbac.yaml
│   │   ├── 03-configmap.yaml
│   │   ├── 04-webui-deployment.yaml
│   │   └── 05-pvc-optional.yaml
│   ├── README.md               # Architecture overview
│   └── QUICK_START.md          # Quick deployment guide
│
├── deployments/                 # Legacy deployment scripts
│   ├── kubernetes-deployment.yaml
│   ├── openshift-deployment.yaml
│   └── deploy-to-openshift.sh
│
├── static/                      # Frontend assets
│   ├── css/
│   │   └── style.css           # Main stylesheet
│   └── js/
│       └── app.js              # Frontend JavaScript
│
├── scripts/                     # Utility scripts
│   ├── run_cpu.sh              # Start vLLM in CPU mode (macOS compatible)
│   ├── start.sh                # General start script
│   ├── install.sh              # Installation script
│   ├── verify_setup.py         # Setup verification
│   ├── kill_playground.py      # Kill running playground instances
│   └── restart_playground.sh   # Restart playground
│
├── config/                      # Configuration files
│   ├── vllm_cpu.env            # CPU mode environment variables
│   └── example_configs.json    # Example configurations
│
├── cli_demo/                    # 🆕 Command-line demo workflow
│   ├── scripts/                # Demo shell scripts
│   └── docs/                   # Demo documentation
│
├── recipes/                     # 🆕 vLLM Community Recipes 📚
│   ├── recipes_catalog.json    # Model configurations catalog
│   └── sync_recipes.py         # GitHub sync script
│
├── assets/                      # Images and assets
│   ├── vllm-playground.png     # WebUI screenshot
│   ├── guidellm.png            # GuideLLM benchmark results screenshot
│   ├── vllm-recipes-1.png      # 🆕 Recipes browser screenshot
│   ├── vllm-recipes-2.png      # 🆕 Recipes details screenshot
│   ├── vllm.png                # vLLM logo
│   └── vllm_only.png           # vLLM logo (alternate)
│
└── docs/                        # Documentation
    ├── QUICKSTART.md            # Quick start guide
    ├── MACOS_CPU_GUIDE.md       # macOS CPU setup guide
    ├── CPU_MODELS_QUICKSTART.md # CPU-optimized models guide
    ├── GATED_MODELS_GUIDE.md    # Guide for accessing Llama, Gemma, etc.
    ├── TROUBLESHOOTING.md       # Common issues and solutions
    ├── FEATURES.md              # Feature documentation
    ├── PERFORMANCE_METRICS.md   # Performance metrics
    └── QUICK_REFERENCE.md       # Command reference
```

## 🚀 Quick Start

### 🐳 Option 1: Container Orchestration (Recommended)

The Web UI can orchestrate vLLM containers automatically - no manual vLLM installation needed!

```bash
# 1. Install Podman (if not already installed)
# macOS: brew install podman
# Linux: dnf install podman or apt install podman

# 2. Install Python dependencies
pip install -r requirements.txt

# 3. Start the Web UI
python run.py

# 4. Open http://localhost:7860
# 5. Click "Start Server" - vLLM container starts automatically!
```

**✨ Benefits:**
- ✅ No vLLM installation required
- ✅ Automatic container lifecycle management
- ✅ Isolated vLLM environment
- ✅ Same UI works locally and on OpenShift/Kubernetes

**How it works:**
- Web UI runs on your host
- vLLM runs in an isolated container
- Container manager (`container_manager.py`) orchestrates everything

**Note:** The Web UI will automatically pull and start the vLLM container when you click "Start Server"

---

### ☸️ Option 2: OpenShift/Kubernetes Deployment

Deploy the entire stack to OpenShift or Kubernetes with dynamic pod management:

```bash
# 1. Build and push Web UI container
cd openshift/
podman build -f Containerfile -t your-registry/vllm-playground:latest .
podman push your-registry/vllm-playground:latest

# 2. Deploy to cluster (GPU or CPU mode)
./deploy.sh --gpu   # For GPU clusters
./deploy.sh --cpu   # For CPU-only clusters

# 3. Get the URL
oc get route vllm-playground -n vllm-playground
```

**✨ Benefits:**
- ✅ Enterprise-grade deployment
- ✅ Dynamic vLLM pod creation via Kubernetes API
- ✅ Same UI and workflow as local setup
- ✅ Auto-scaling and resource management

**📖 See [openshift/README.md](openshift/README.md)** and **[openshift/QUICK_START.md](openshift/QUICK_START.md)** for detailed instructions.

---

### 💻 Option 3: Local Installation (Traditional)

For local development without containers:

#### 1. Install vLLM

```bash
# For macOS/CPU mode
pip install vllm
```

#### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

#### 3. Start the WebUI

```bash
python run.py
```

Then open http://localhost:7860 in your browser.

#### 4. Start vLLM Server

**Option A: Using the WebUI**
- Select CPU or GPU mode
- Click "Start Server"

**Option B: Using the script (macOS/CPU)**
```bash
./scripts/run_cpu.sh
```

## ☸️ OpenShift/Kubernetes Deployment

Deploy vLLM Playground to enterprise Kubernetes/OpenShift clusters with dynamic pod management:

**Features:**
- ✅ Dynamic vLLM pod creation via Kubernetes API
- ✅ GPU and CPU mode support with Red Hat images
- ✅ RBAC-based security model
- ✅ Automated deployment scripts
- ✅ Same UI and workflow as local setup

**Quick Deploy:**
```bash
cd openshift/
./deploy.sh --gpu    # For GPU clusters
./deploy.sh --cpu    # For CPU-only clusters
```

**📖 Full Documentation:** See [openshift/README.md](openshift/README.md) and [openshift/QUICK_START.md](openshift/QUICK_START.md)

---

## 💻 macOS Apple Silicon Support

For macOS users, vLLM runs in CPU mode using containerization:

**Container Mode (Recommended):**
```bash
# Just start the Web UI - it handles containers automatically
python run.py
# Click "Start Server" in the UI
```

**Direct Mode:**
```bash
# Edit CPU configuration
nano config/vllm_cpu.env

# Run vLLM directly
./scripts/run_cpu.sh
```

**📖 See [docs/MACOS_CPU_GUIDE.md](docs/MACOS_CPU_GUIDE.md)** for detailed setup.

## ✨ Features

- **🐳 Container Orchestration**: Automatic vLLM container lifecycle management 🆕
  - Local development: Podman-based orchestration
  - Enterprise deployment: Kubernetes API-based orchestration
  - Seamless switching between local and cloud environments
  - Smart container reuse (fast restarts with same config)
- **☸️ OpenShift/Kubernetes Deployment**: Production-ready cloud deployment 🆕
  - Dynamic pod creation via Kubernetes API
  - CPU and GPU mode support
  - RBAC-based security
  - Automated deployment scripts
- **🎯 Intelligent Hardware Detection**: Automatic GPU availability detection 🆕
  - Kubernetes-native: Queries cluster nodes for `nvidia.com/gpu` resources
  - Automatic UI adaptation: GPU mode enabled/disabled based on availability
  - No nvidia-smi required: Uses Kubernetes API for detection
  - Fallback support: nvidia-smi detection for local environments
- **Performance Benchmarking**: GuideLLM integration for comprehensive load testing with detailed metrics
  - Request statistics (success rate, duration, avg times)
  - Token throughput analysis (mean/median tokens per second)
  - Latency percentiles (P50, P75, P90, P95, P99)
  - Configurable load patterns and request rates
- **📚 vLLM Community Recipes**: One-click model configurations 🆕
  - Browse 17+ model categories from official vLLM recipes
  - One-click configuration loading for optimized settings
  - Searchable by model name, category, or tags
  - Add, edit, or sync custom recipes
  - Hardware requirements and documentation links
- **Server Management**: Start/stop vLLM servers from the UI
- **Chat Interface**: Interactive chat with streaming responses
- **Smart Chat Templates**: Automatic model-specific template detection
- **Performance Metrics**: Real-time token counts and generation speed
- **Model Support**: Pre-configured popular models + custom model support
- **Gated Model Access**: Built-in HuggingFace token support for Llama, Gemma, etc.
- **CPU & GPU Modes**: Automatic detection and configuration
- **macOS Optimized**: Special support for Apple Silicon
- **Resizable Panels**: Customizable layout
- **Command Preview**: See exact commands before execution

## 📖 Documentation

### Getting Started
- **[Quick Start Guide](docs/QUICKSTART.md)** - Get up and running in minutes
- **[Command-Line Demo Guide](cli_demo/docs/CLI_DEMO_GUIDE.md)** - Full workflow demo with vLLM & GuideLLM
- [macOS CPU Setup](docs/MACOS_CPU_GUIDE.md) - Apple Silicon optimization guide
- [CPU Models Quickstart](docs/CPU_MODELS_QUICKSTART.md) - Best models for CPU

### Container & Deployment
- **[OpenShift/Kubernetes Deployment](openshift/README.md)** ☸️ - Enterprise deployment guide 🆕
- **[OpenShift Quick Start](openshift/QUICK_START.md)** - 5-minute deployment 🆕
- **[Container Variants](containers/README.md)** 🐳 - Local container setup
- [Legacy Deployment Scripts](deployments/README.md) - Kubernetes manifests

### Model Configuration
- **[Gated Models Guide (Llama, Gemma)](docs/GATED_MODELS_GUIDE.md)** ⭐ - Access restricted models

### Reference
- [Feature Overview](docs/FEATURES.md) - Complete feature list
- [Performance Metrics](docs/PERFORMANCE_METRICS.md) - Benchmarking and metrics
- [Command Reference](docs/QUICK_REFERENCE.md) - Command cheat sheet
- [CLI Quick Reference](cli_demo/docs/CLI_QUICK_REFERENCE.md) - Command-line demo quick reference
- [Troubleshooting](docs/TROUBLESHOOTING.md) - Common issues and solutions

## 🔧 Configuration

### CPU Mode (macOS)

Edit `config/vllm_cpu.env`:
```bash
export VLLM_CPU_KVCACHE_SPACE=40
export VLLM_CPU_OMP_THREADS_BIND=auto
```

### Supported Models

**CPU-Optimized Models (Recommended for macOS):**
- **TinyLlama/TinyLlama-1.1B-Chat-v1.0** (default) - Fast, no token required
- **meta-llama/Llama-3.2-1B** - Latest Llama, requires HF token (gated)
- **google/gemma-2-2b** - High quality, requires HF token (gated)
- facebook/opt-125m - Tiny test model

**Larger Models (Slow on CPU, better on GPU):**
- meta-llama/Llama-2-7b-chat-hf (requires HF token)
- mistralai/Mistral-7B-Instruct-v0.2
- Custom models via text input

**📌 Note**: Gated models (Llama, Gemma) require a HuggingFace token. See [Gated Models Guide](docs/GATED_MODELS_GUIDE.md) for setup.

## 🛠️ Development

### Architecture

The project uses a **hybrid architecture** that works seamlessly in both local and cloud environments:

```
┌─────────────────────────────────────────────────────────────┐
│                     Web UI (FastAPI)                        │
│              app.py + index.html + static/                  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ├─→ container_manager.py (Local)
                         │   └─→ Podman CLI
                         │       └─→ vLLM Container
                         │
                         └─→ kubernetes_container_manager.py (Cloud)
                             └─→ Kubernetes API
                                 └─→ vLLM Pods
```

**Key Components:**
- **Backend**: FastAPI (`app.py`)
- **Container Manager (Local)**: Podman orchestration (`container_manager.py`)
- **Container Manager (K8s)**: Kubernetes API orchestration (`openshift/kubernetes_container_manager.py`)
- **Frontend**: Vanilla JavaScript (`static/js/app.js`)
- **Styling**: Custom CSS (`static/css/style.css`)
- **Scripts**: Bash scripts in `scripts/`
- **Config**: Environment files in `config/`

### Running in Development

```bash
# Start backend with auto-reload
uvicorn app:app --reload --port 7860

# Or use the run script
python run.py
```

### Container Development

```bash
# Build vLLM service container (macOS/CPU)
podman build -f containers/Containerfile.mac -t vllm-service:macos .

# Build Web UI orchestrator container
podman build -f containers/Containerfile.vllm-playground -t vllm-playground:latest .

# Build OpenShift Web UI container
podman build -f openshift/Containerfile -t vllm-playground-webui:latest .
```

## 📝 License

MIT License - See [LICENSE](LICENSE) file for details

## 🤝 Contributing

Contributions welcome! Please feel free to submit issues and pull requests.

## 🔗 Links

- [vLLM Official Documentation](https://docs.vllm.ai/)
- [vLLM CPU Mode Guide](https://docs.vllm.ai/en/stable/getting_started/installation/cpu.html)
- [vLLM GitHub](https://github.com/vllm-project/vllm)
- **[LLMCompressor Playground](https://github.com/micytao/llmcompressor-playground)** - Separate project for model compression and quantization
- [GuideLLM](https://github.com/neuralmagic/guidellm) - Performance benchmarking tool

## 🏗️ Architecture Overview

### Local Development (Container Orchestration)

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
│ container_manager│  ← Podman orchestration
│     .py          │
└────────┬─────────┘
         │ podman run/stop
         ↓
┌──────────────────┐
│  vLLM Container  │  ← Isolated vLLM service
│  (Port 8000)     │
└──────────────────┘
```

### OpenShift/Kubernetes Deployment

```
┌──────────────────┐
│   User Browser   │
└────────┬─────────┘
         │ https://route-url
         ↓
┌──────────────────┐
│ OpenShift Route  │
└────────┬─────────┘
         ↓
┌──────────────────┐
│  Web UI Pod      │  ← FastAPI app in container
│  (Deployment)    │  ← Auto-detects GPU availability
└────────┬─────────┘
         │ Kubernetes API
         │ (reads nodes, creates/deletes pods)
         ↓
┌──────────────────┐
│   kubernetes_    │  ← K8s API orchestration
│   container_     │  ← Checks nvidia.com/gpu resources
│   manager.py     │
└────────┬─────────┘
         │ create/delete pods
         ↓
┌──────────────────┐
│  vLLM Pod        │  ← Dynamically created
│  (Dynamic)       │  ← GPU: Official vLLM image
│                  │  ← CPU: Self-built optimized image
└──────────────────┘
```

**Container Images:**
- **GPU Mode**: Official vLLM image (`vllm/vllm-openai:v0.11.0`)
- **CPU Mode**: Self-built optimized image (`quay.io/rh_ee_micyang/vllm-service:cpu`)

**Key Features:**
- Same UI code works in both environments
- Container manager is swapped at build time (Podman → Kubernetes)
- Identical user experience locally and in the cloud
- Smart container/pod lifecycle management
- **Automatic GPU detection**: UI adapts based on cluster hardware
  - Kubernetes-native: Queries nodes for `nvidia.com/gpu` resources
  - Automatic mode selection: GPU mode disabled if no GPUs available
  - RBAC-secured: Requires node read permissions (automatically configured)
- No registry authentication needed (all images are publicly accessible)

---

## 🆘 Troubleshooting

### Container-Related Issues

#### Container Won't Start
```bash
# Check if Podman is installed
podman --version

# Check Podman connectivity
podman ps

# View container logs
podman logs vllm-service
```

#### "Address Already in Use" Error
If you lose connection to the Web UI and get `ERROR: address already in use`:

```bash
# Quick Fix: Auto-detect and kill old process
python run.py

# Alternative: Manual restart
./scripts/restart_playground.sh

# Or kill manually
python scripts/kill_playground.py
```

#### vLLM Container Issues
```bash
# Check if container is running
podman ps -a | grep vllm-service

# View vLLM logs
podman logs -f vllm-service

# Stop and remove container
podman stop vllm-service && podman rm vllm-service

# Pull latest vLLM image
podman pull quay.io/rh_ee_micyang/vllm-service:macos
```

### OpenShift/Kubernetes Issues

#### GPU Mode Not Available

The Web UI automatically detects GPU availability by querying Kubernetes nodes for `nvidia.com/gpu` resources. If GPU mode is disabled in the UI:

**Check GPU availability in your cluster:**
```bash
# List nodes with GPU capacity
oc get nodes -o custom-columns=NAME:.metadata.name,GPU:.status.capacity.nvidia\.com/gpu

# Or check all node details
oc describe nodes | grep nvidia.com/gpu
```

**If GPUs exist but not detected:**
1. Verify RBAC permissions:
```bash
# Check if service account has node read permissions
oc auth can-i list nodes --as=system:serviceaccount:vllm-playground:vllm-playground-sa
# Should return "yes"
```

2. Reapply RBAC if needed:
```bash
oc apply -f openshift/manifests/02-rbac.yaml
```

3. Check Web UI logs for detection errors:
```bash
oc logs -f deployment/vllm-playground-cpu -n vllm-playground | grep -i gpu
```

**Expected behavior:**
- **GPU available**: Both CPU and GPU modes enabled in UI
- **No GPU**: GPU mode automatically disabled, forced to CPU-only mode
- **Detection method logged**: Check logs for "GPU detected via Kubernetes API" or "No GPUs found"

#### Pod Not Starting
```bash
# Check pod status
oc get pods -n vllm-playground

# View pod logs
oc logs -f deployment/vllm-playground-gpu -n vllm-playground

# Describe pod for events
oc describe pod <pod-name> -n vllm-playground
```

#### Out of Memory (OOM) Issues

**⚠️ IMPORTANT: Resource Requirements for GuideLLM Benchmarks**

The Web UI pod requires sufficient memory to avoid OOM kills when running GuideLLM benchmarks. GuideLLM generates many concurrent requests for load testing, which can quickly consume available memory.

**Memory usage scales with:**
- Number of concurrent users/requests
- Request rate (requests per second)
- Model size and response length
- Benchmark duration

**Recommended Memory Limits:**

- **GPU Mode (default)**: 16Gi minimum
  - For intensive GuideLLM benchmarks: **32Gi+**
  - For high-concurrency tests (50+ users): **64Gi+**

- **CPU Mode**: 64Gi minimum
  - For intensive GuideLLM benchmarks: **128Gi+**

**To increase resources:**

Edit `openshift/manifests/04-webui-deployment.yaml`:
```yaml
resources:
  limits:
    memory: "32Gi"  # Increase based on benchmark intensity
    cpu: "8"
```

Then reapply:
```bash
oc apply -f openshift/manifests/04-webui-deployment.yaml
```

**Symptoms of OOM:**
- Pod restarts during benchmarks
- Benchmark failures with connection errors
- `OOMKilled` status in pod events: `oc describe pod <pod-name>`

#### Image Pull Errors

**Note:** The deployment now uses publicly accessible container images:
- **GPU**: `vllm/vllm-openai:v0.11.0` (official vLLM image)
- **CPU**: `quay.io/rh_ee_micyang/vllm-service:cpu` (self-built, publicly accessible)

No registry authentication or pull secrets are required. If you encounter image pull errors:

```bash
# Verify image accessibility
podman pull vllm/vllm-openai:v0.11.0  # For GPU
podman pull quay.io/rh_ee_micyang/vllm-service:cpu  # For CPU

# Check pod events for details
oc describe pod <pod-name> -n vllm-playground
```

**📖 See [openshift/QUICK_START.md](openshift/QUICK_START.md)** for detailed OpenShift troubleshooting

### Local Installation Issues

#### macOS Segmentation Fault
Use CPU mode with proper environment variables or use container mode (recommended).
See [docs/MACOS_CPU_GUIDE.md](docs/MACOS_CPU_GUIDE.md).

#### Server Won't Start
1. Check if vLLM is installed: `python -c "import vllm; print(vllm.__version__)"`
2. Check port availability: `lsof -i :8000`
3. Review server logs in the WebUI

#### Chat Not Streaming
Check browser console (F12) for errors and ensure the server is running.

---

Made with ❤️ for the vLLM community
