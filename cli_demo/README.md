# Command-Line Demo

## 📁 Contents

```
cli_demo/
├── scripts/                           # Executable scripts
│   ├── demo_full_workflow.sh          ⭐ Full automated demo
│   ├── test_vllm_serving.sh           💬 Test vLLM with curl
├── docs/                              # Documentation
│   ├── CLI_DEMO_GUIDE.md              📘 Complete guide (500+ lines)
│   ├── CLI_QUICK_REFERENCE.md         📄 Quick reference card
│   └── USAGE_EXAMPLES.md              💡 12 real-world examples
│
├── demo.env                           ⚙️  Configuration template
├── CLI_DEMO_SUMMARY.md                📋 Implementation summary
└── WORKFLOW_VISUAL.txt                🎬 Visual workflow diagram
```

## 🚀 Quick Start

### Full Automated Demo
Run the complete workflow (all 5 steps):

```bash
./cli_demo/scripts/demo_full_workflow.sh
```

This will:
1. ✅ Start vLLM server with base model
2. ✅ Test chat serving with curl
5. ✅ Benchmark performance with GuideLLM

### Quick Demo (Faster)
For a faster demo with reduced calibration samples:

```bash
CALIBRATION_SAMPLES=128 BENCHMARK_REQUESTS=50 \
  ./cli_demo/scripts/demo_full_workflow.sh
```

### Individual Components

```bash
# Test vLLM serving (make sure server is running first)
./cli_demo/scripts/test_vllm_serving.sh

  "TinyLlama/TinyLlama-1.1B-Chat-v1.0" \
    "W4A16" \
  "GPTQ" \
  512

# Benchmark with GuideLLM (make sure server is running first)
./cli_demo/scripts/benchmark_guidellm.sh 100 5 128 128
```

## 📚 Documentation

- **[CLI Demo Guide](docs/CLI_DEMO_GUIDE.md)** - Complete documentation with examples
- **[Quick Reference](docs/CLI_QUICK_REFERENCE.md)** - Command cheat sheet
- **[Usage Examples](docs/USAGE_EXAMPLES.md)** - 12 real-world scenarios
- **[Scripts README](scripts/README.md)** - Detailed script documentation

## ⚙️ Configuration

### Using Configuration File

```bash
# Copy and customize
cp cli_demo/demo.env my_config.env
nano my_config.env

# Use it
source my_config.env
./cli_demo/scripts/demo_full_workflow.sh
```

### Environment Variables

```bash
# Server
export VLLM_HOST="127.0.0.1"
export VLLM_PORT="8000"
export BASE_MODEL="TinyLlama/TinyLlama-1.1B-Chat-v1.0"

export QUANTIZATION_FORMAT="W4A16"
export CALIBRATION_SAMPLES="512"

# Benchmark
export BENCHMARK_REQUESTS="100"
export BENCHMARK_RATE="5"
```

## 🎯 Workflow Overview

```
1. vLLM Serve      → Start model inference server
2. Test Serving    → Validate with curl commands
4. Load 5. Benchmark       → Measure performance with GuideLLM
```

## ✨ Features

- ✅ **Fully Automated** - One command runs entire workflow
- ✅ **Modular** - Use individual scripts as needed
- ✅ **Configurable** - Environment variables for customization
- ✅ **Production Ready** - Error handling, cleanup, logging
- ✅ **Well Documented** - Comprehensive guides and examples
- ✅ **Beautiful Output** - Colored, formatted terminal display

## 📊 Supported Configurations

### Algorithms
- `GPTQ` (recommended)
- `AWQ`
- `PTQ`
- `SmoothQuant`

### Recommended Models

**CPU/macOS:**
- `TinyLlama/TinyLlama-1.1B-Chat-v1.0` ⭐ (default)
- `facebook/opt-125m` (fastest)
- `meta-llama/Llama-3.2-1B` (requires HF token)

**GPU:**
- `meta-llama/Llama-2-7b-chat-hf`
- `mistralai/Mistral-7B-Instruct-v0.2`
- `google/gemma-2-2b`

## 🎬 Example Workflows

### Manual Step-by-Step

```bash
# 1. Start vLLM
python -m vllm.entrypoints.openai.api_server \
  --model TinyLlama/TinyLlama-1.1B-Chat-v1.0 \
  --port 8000 &

# 2. Test with curl
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "TinyLlama/TinyLlama-1.1B-Chat-v1.0", "messages": [{"role": "user", "content": "Hello!"}]}'

# 3.   "TinyLlama/TinyLlama-1.1B-Chat-v1.0" \
    "W4A16" \
  "GPTQ" \
  512

# 4. Load pkill -f vllm.entrypoints.openai.api_server
python -m vllm.entrypoints.openai.api_server \
# 5. Benchmark
./cli_demo/scripts/benchmark_guidellm.sh 100 5 128 128
```

## 📦 Prerequisites

```bash
# Install required packages
pip install vllm guidellm

# Or use requirements.txt from parent directory
cd .. && pip install -r requirements.txt
```

## 🐛 Troubleshooting

### Scripts not executable
```bash
chmod +x cli_demo/scripts/*.sh
```

### Dependencies missing
```bash
pip install vllm guidellm
```

### Server won't start
```bash
# Check port
lsof -i :8000

# Kill existing
pkill -f "vllm.entrypoints.openai.api_server"
```

For more troubleshooting, see [CLI_DEMO_GUIDE.md](docs/CLI_DEMO_GUIDE.md#-troubleshooting).

## 📝 License

This demo is part of vLLM Playground - MIT License

## 🔗 Links

- [Main Project README](../README.md)
- [vLLM Documentation](https://docs.vllm.ai/)
**Ready to start? Run:** `./cli_demo/scripts/demo_full_workflow.sh` 🚀
