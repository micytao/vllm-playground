# vLLM Playground

A modern web interface for managing and interacting with vLLM servers (www.github.com/vllm-project/vllm). Supports GPU and CPU modes, with special optimizations for macOS Apple Silicon and enterprise deployment on OpenShift/Kubernetes.

### ✨ Agentic-Ready with MCP Support
![vLLM Playground MCP Integration](https://raw.githubusercontent.com/micytao/vllm-playground/main/assets/vllm-playground-mcp-client.png)

*MCP (Model Context Protocol) integration enables models to use external tools with human-in-the-loop approval.*

### ✨ Tool Calling Support
![vLLM Playground Interface](https://raw.githubusercontent.com/micytao/vllm-playground/main/assets/vllm-playground-newUI.png)

### ✨ Structured Outputs Support
![vLLM Playground with Structured Outputs](https://raw.githubusercontent.com/micytao/vllm-playground/main/assets/vllm-playground-structured-outputs.png)

### 🆕 What's New in v0.1.2

- 🌏 **ModelScope Support** - Alternative model source for China region users
- 🌐 **i18n Chinese** - Comprehensive Chinese language translations
- 💬 **Chat Export** - Save conversations with export functionality
- 🐛 **Bug Fixes** - Windows Unicode fix, sidebar UI improvements

See **[Changelog](CHANGELOG.md)** for full details.

---

## 🚀 Quick Start

```bash
# Install from PyPI
pip install vllm-playground

# Pre-download container image (~10GB for GPU)
vllm-playground pull

# Start the playground
vllm-playground
```

Open http://localhost:7860 and click "Start Server" - that's it! 🎉

### CLI Options

```bash
vllm-playground pull                # Pre-download GPU image
vllm-playground pull --cpu          # Pre-download CPU image
vllm-playground --port 8080         # Custom port
vllm-playground stop                # Stop running instance
vllm-playground status              # Check status
```

---

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| 💬 **Modern Chat UI** | Streamlined ChatGPT-style interface with streaming responses |
| 🔧 **Tool Calling** | Function calling with Llama, Mistral, Qwen, and more |
| 🔗 **MCP Integration** | Connect to MCP servers for agentic capabilities |
| 🏗️ **Structured Outputs** | Constrain responses to JSON Schema, Regex, or Grammar |
| 🐳 **Container Mode** | Zero-setup vLLM via automatic container management |
| ☸️ **OpenShift/K8s** | Enterprise deployment with dynamic pod creation |
| 📊 **Benchmarking** | GuideLLM integration for load testing |
| 📚 **Recipes** | One-click configs from vLLM community recipes |

---

## 📦 Installation Options

| Method | Command | Best For |
|--------|---------|----------|
| **PyPI** | `pip install vllm-playground` | Most users |
| **With Benchmarking** | `pip install vllm-playground[benchmark]` | Load testing |
| **From Source** | `git clone` + `python run.py` | Development |
| **OpenShift/K8s** | `./openshift/deploy.sh` | Enterprise |

**📖 See [Installation Guide](docs/INSTALLATION.md)** for detailed instructions.

---

## 🔧 Configuration

### Tool Calling

Enable in **Server Configuration** before starting:

1. Check "Enable Tool Calling"
2. Select parser (or "Auto-detect")
3. Start server
4. Define tools in the 🔧 toolbar panel

**Supported Models:**
- Llama 3.x (`llama3_json`)
- Mistral (`mistral`)
- Qwen (`hermes`)
- Hermes (`hermes`)

### MCP Servers

Connect to external tools via Model Context Protocol:

1. Go to **MCP Servers** in the sidebar
2. Add a server (presets available: Filesystem, Git, Fetch, Time)
3. Connect and enable in chat panel

**⚠️ MCP requires Python 3.10+**

### CPU Mode (macOS)

Edit `config/vllm_cpu.env`:
```bash
export VLLM_CPU_KVCACHE_SPACE=40
export VLLM_CPU_OMP_THREADS_BIND=auto
```

---

## 📖 Documentation

### Getting Started
- **[Installation Guide](docs/INSTALLATION.md)** - All installation methods
- **[Quick Start](docs/QUICKSTART.md)** - Get running in minutes
- **[macOS CPU Guide](docs/MACOS_CPU_GUIDE.md)** - Apple Silicon setup

### Features
- **[Features Overview](docs/FEATURES.md)** - Complete feature list
- **[Gated Models Guide](docs/GATED_MODELS_GUIDE.md)** - Access Llama, Gemma, etc.

### Deployment
- **[OpenShift/K8s Deployment](openshift/README.md)** - Enterprise deployment
- **[Architecture Overview](docs/ARCHITECTURE.md)** - System design
- **[Container Variants](containers/README.md)** - Container options

### Reference
- **[Troubleshooting](docs/TROUBLESHOOTING.md)** - Common issues
- **[Performance Metrics](docs/PERFORMANCE_METRICS.md)** - Benchmarking
- **[Command Reference](docs/QUICK_REFERENCE.md)** - CLI cheat sheet

### Releases
- **[Changelog](CHANGELOG.md)** - Version history and changes
- **[v0.1.2](releases/v0.1.2.md)** - ModelScope integration, i18n improvements
- **[v0.1.1](releases/v0.1.1.md)** - MCP integration, runtime detection
- **[v0.1.0](releases/v0.1.0.md)** - First release, modern UI, tool calling

---

## 🏗️ Architecture

```
┌──────────────────┐
│   User Browser   │
└────────┬─────────┘
         │ http://localhost:7860
         ↓
┌──────────────────┐
│   Web UI (Host)  │  ← FastAPI + JavaScript
└────────┬─────────┘
         │
    ┌────┴────┐
    ↓         ↓
┌───────-─┐ ┌────────┐
│ vLLM    │ │  MCP   │  ← Containers / External Servers
│Container│ │Servers │
└────────-┘ └────────┘
```

**📖 See [Architecture Overview](docs/ARCHITECTURE.md)** for details.

---

## 🆘 Quick Troubleshooting

| Issue | Solution |
|-------|----------|
| Port in use | `vllm-playground stop` |
| Container won't start | `podman logs vllm-service` |
| Tool calling fails | Restart with "Enable Tool Calling" checked |
| Image pull errors | `vllm-playground pull --all` |

**📖 See [Troubleshooting Guide](docs/TROUBLESHOOTING.md)** for more.

---

## 🔗 Related Projects

- **[vLLM](https://github.com/vllm-project/vllm)** - High-throughput LLM serving
- **[LLMCompressor Playground](https://github.com/micytao/llmcompressor-playground)** - Model compression & quantization
- **[GuideLLM](https://github.com/neuralmagic/guidellm)** - Performance benchmarking
- **[MCP Servers](https://github.com/modelcontextprotocol/servers)** - Official MCP servers

---

## 📝 License

Apache 2.0 License - See [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions welcome! Please feel free to submit issues and pull requests.

---

Made with ❤️ for the vLLM community
