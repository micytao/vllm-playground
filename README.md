# vLLM WebUI

A modern web interface for managing and interacting with vLLM (Very Large Language Model) servers. Supports both GPU and CPU modes, with special optimizations for macOS Apple Silicon.

![vLLM WebUI Interface](assets/vllm-webui.png)

## 📁 Project Structure

```
vllm-webui/
├── app.py                       # Main FastAPI backend application
├── run.py                       # Backend server launcher
├── index.html                   # Main HTML interface
├── requirements.txt             # Python dependencies
├── LICENSE                      # MIT License
├── README.md                    # This file
├── Containerfile                # Podman/Docker container definition 🐳
├── .containerignore             # Container build exclusions
├── Makefile                     # Quick commands for container management
├── CONTAINER-QUICKSTART.md      # Container quick start guide 🐳
├── README-CONTAINER.md          # Complete container documentation 🐳
│
├── static/                      # Frontend assets
│   ├── css/
│   │   └── style.css           # Main stylesheet
│   └── js/
│       └── app.js              # Frontend JavaScript
│
├── scripts/                    # Utility scripts
│   ├── run_cpu.sh             # Start vLLM in CPU mode (macOS compatible)
│   ├── start.sh               # General start script
│   ├── install.sh             # Installation script
│   ├── verify_setup.py        # Setup verification
│   ├── build_container.sh     # Build Podman container 🐳
│   ├── run_container.sh       # Run Podman container 🐳
│   ├── stop_container.sh      # Stop Podman container 🐳
│   ├── test_container.sh      # Test container setup 🐳
│   └── docker-compose-up.sh   # Docker Compose wrapper 🐳
│
├── config/                     # Configuration files
│   ├── vllm_cpu.env           # CPU mode environment variables
│   └── example_configs.json   # Example configurations
│
└── docs/                       # Documentation
    ├── QUICKSTART.md           # Quick start guide
    ├── MACOS_CPU_GUIDE.md      # macOS CPU setup guide
    ├── CPU_MODELS_QUICKSTART.md # CPU-optimized models guide
    ├── GATED_MODELS_GUIDE.md   # Guide for accessing Llama, Gemma, etc.
    ├── CHAT_TEMPLATES.md       # Model-specific chat templates
    ├── TROUBLESHOOTING.md      # Common issues and solutions
    ├── FEATURES.md             # Feature documentation
    ├── PERFORMANCE_METRICS.md  # Performance metrics
    └── QUICK_REFERENCE.md      # Command reference
```

## 🚀 Quick Start

### 🐳 Option 1: Container (Easiest for macOS) **RECOMMENDED**

For macOS users, the container provides the easiest setup with everything pre-configured:

```bash
# 1. Build the container (one-time, ~15-30 min)
./scripts/build_container.sh

# 2. Run the container
./scripts/run_container.sh

# 3. Open http://localhost:7860
```

**✨ Benefits:**
- ✅ No complex installation
- ✅ Pre-built vLLM optimized for CPU
- ✅ Isolated environment
- ✅ Works out of the box

**📖 See [CONTAINER-QUICKSTART.md](CONTAINER-QUICKSTART.md)** for detailed instructions.

---

### 💻 Option 2: Local Installation

For local development or if you prefer not to use containers:

#### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

#### 2. Install vLLM

```bash
# For macOS/CPU mode
pip install vllm
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

## 💻 macOS Apple Silicon Support

For macOS users, vLLM runs in CPU mode. See [docs/MACOS_CPU_GUIDE.md](docs/MACOS_CPU_GUIDE.md) for detailed setup.

**Quick CPU Mode Setup:**
```bash
# Edit CPU configuration
nano config/vllm_cpu.env

# Run vLLM
./scripts/run_cpu.sh
```

## ✨ Features

- **Server Management**: Start/stop vLLM servers from the UI
- **Chat Interface**: Interactive chat with streaming responses
- **Smart Chat Templates**: Automatic model-specific template detection (Nov 2025) 🆕
- **Performance Metrics**: Real-time token counts and generation speed
- **Model Support**: Pre-configured popular models + custom model support
- **Gated Model Access**: Built-in HuggingFace token support for Llama, Gemma, etc.
- **CPU & GPU Modes**: Automatic detection and configuration
- **macOS Optimized**: Special support for Apple Silicon
- **Benchmarking**: GuideLLM integration for performance testing
- **Resizable Panels**: Customizable layout
- **Command Preview**: See exact commands before execution

## 📖 Documentation

### Getting Started
- **[Container Quick Start](CONTAINER-QUICKSTART.md)** 🐳 - Easiest way for macOS users (RECOMMENDED)
- **[Container Full Guide](README-CONTAINER.md)** - Complete container documentation
- **[Container Workflow](CONTAINER-WORKFLOW.md)** - Step-by-step container workflow
- **[Quick Start Guide](docs/QUICKSTART.md)** - Get up and running in minutes
- [macOS CPU Setup](docs/MACOS_CPU_GUIDE.md) - Apple Silicon optimization guide
- [CPU Models Quickstart](docs/CPU_MODELS_QUICKSTART.md) - Best models for CPU

### Model Configuration
- **[Gated Models Guide (Llama, Gemma)](docs/GATED_MODELS_GUIDE.md)** ⭐ - Access restricted models
- **[Chat Templates Explained](docs/CHAT_TEMPLATES.md)** 🆕 - Model-specific templates

### Reference
- [Feature Overview](docs/FEATURES.md) - Complete feature list
- [Performance Metrics](docs/PERFORMANCE_METRICS.md) - Benchmarking and metrics
- [Command Reference](docs/QUICK_REFERENCE.md) - Command cheat sheet
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

### Project Structure

- **Backend**: FastAPI (`app.py`)
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

## 📝 License

MIT License - See [LICENSE](LICENSE) file for details

## 🤝 Contributing

Contributions welcome! Please feel free to submit issues and pull requests.

## 🔗 Links

- [vLLM Official Documentation](https://docs.vllm.ai/)
- [vLLM CPU Mode Guide](https://docs.vllm.ai/en/stable/getting_started/installation/cpu.html)
- [vLLM GitHub](https://github.com/vllm-project/vllm)

## 🆘 Troubleshooting

### macOS Segmentation Fault

Use CPU mode with proper environment variables. See [docs/MACOS_CPU_GUIDE.md](docs/MACOS_CPU_GUIDE.md).

### Server Won't Start

1. Check if vLLM is installed: `python -c "import vllm; print(vllm.__version__)"`
2. Check port availability: `lsof -i :8000`
3. Review server logs in the WebUI

### Chat Not Streaming

Check browser console (F12) for errors and ensure the server is running.

---

Made with ❤️ for the vLLM community
