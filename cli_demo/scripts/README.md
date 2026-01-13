# Scripts Directory


## 📁 Available Scripts

### 🎬 Full Workflow Demo
**`demo_full_workflow.sh`** - Complete end-to-end demonstration

Runs the full workflow:
1. Start vLLM server with base model
2. Test chat serving
4. Load 5. Benchmark with GuideLLM

```bash
./scripts/demo_full_workflow.sh
```

**Customization:**
```bash
# Quick demo (faster)
CALIBRATION_SAMPLES=128 BENCHMARK_REQUESTS=50 ./scripts/demo_full_workflow.sh

# Different model
BASE_MODEL="facebook/opt-125m" ./scripts/demo_full_workflow.sh

# Different port
VLLM_PORT=8080 ./scripts/demo_full_workflow.sh
```

### 💬 Test vLLM Serving
**`test_vllm_serving.sh`** - Comprehensive serving tests with curl

Tests all endpoints:
- Health check
- Model listing
- Chat completions
- Streaming responses
- Multi-turn conversations
- Text completions

```bash
# Start vLLM first, then test
./scripts/test_vllm_serving.sh

# Custom server
VLLM_HOST=localhost VLLM_PORT=8080 ./scripts/test_vllm_serving.sh
```

### 📊 Benchmark with GuideLLM
**`benchmark_guidellm.sh`** - Performance benchmarking

```bash
# Basic usage
./scripts/benchmark_guidellm.sh

# Full syntax
./scripts/benchmark_guidellm.sh \
  TOTAL_REQUESTS \
  REQUEST_RATE \
  PROMPT_TOKENS \
  OUTPUT_TOKENS
```

**Examples:**
```bash
# Quick benchmark
./scripts/benchmark_guidellm.sh 50 5 128 128

# Thorough benchmark
./scripts/benchmark_guidellm.sh 500 10 256 256

# Load test
./scripts/benchmark_guidellm.sh 1000 20 128 128

# Custom server
VLLM_PORT=8080 ./scripts/benchmark_guidellm.sh 100 5 128 128
```

### 🚀 Run CPU Mode
**`run_cpu.sh`** - Start vLLM in CPU mode (macOS compatible)

```bash
# Default model (TinyLlama)
./scripts/run_cpu.sh

# Specify model
./scripts/run_cpu.sh "facebook/opt-125m"

# Specify model and port
./scripts/run_cpu.sh "TinyLlama/TinyLlama-1.1B-Chat-v1.0" 8080
```

### 🔍 Other Scripts
- **`start.sh`** - General start script
- **`install.sh`** - Installation helper
- **`verify_setup.py`** - Setup verification

## 🔧 Configuration

### Environment Variables

All scripts support these environment variables:

```bash
# Server
export VLLM_HOST="127.0.0.1"
export VLLM_PORT="8000"
export BASE_MODEL="TinyLlama/TinyLlama-1.1B-Chat-v1.0"

# CPU mode
export VLLM_CPU_KVCACHE_SPACE=40
export VLLM_CPU_OMP_THREADS_BIND=auto

export export ALGORITHM="GPTQ"
export CALIBRATION_SAMPLES="512"

# Benchmark
export BENCHMARK_REQUESTS="100"
export BENCHMARK_RATE="5"
export PROMPT_TOKENS="128"
export OUTPUT_TOKENS="128"
export RATE_TYPE="constant"

# Environment
export VENV_PATH="$HOME/.venv"
```

### Using Configuration File

```bash
# Copy and customize
cp demo.env my_demo.env
nano my_demo.env

# Use it
source my_demo.env
./scripts/demo_full_workflow.sh
```

## 📊 Quick Reference

### Recommended Models
**CPU/macOS:**
- `TinyLlama/TinyLlama-1.1B-Chat-v1.0` ⭐
- `facebook/opt-125m`
- `meta-llama/Llama-3.2-1B`

**GPU:**
- `meta-llama/Llama-2-7b-chat-hf`
- `mistralai/Mistral-7B-Instruct-v0.2`
- `google/gemma-2-2b`

## 🎯 Common Workflows

### 1. Quick Test
```bash
# Start server
./scripts/run_cpu.sh &
sleep 30

# Test it
./scripts/test_vllm_serving.sh

# Stop server
pkill -f "vllm.entrypoints.openai.api_server"
```

### 3. Full Demo with Custom Settings
```bash
# Set environment
export BASE_MODEL="facebook/opt-125m"
export QUANTIZATION_FORMAT="W8A8_INT8"
export CALIBRATION_SAMPLES="256"
export BENCHMARK_REQUESTS="50"

# Run demo
./scripts/demo_full_workflow.sh
```

## 🐛 Troubleshooting

### Scripts not executable
```bash
chmod +x scripts/*.sh
```

### vLLM server won't start
```bash
# Check port
lsof -i :8000

# Kill existing
pkill -f "vllm.entrypoints.openai.api_server"

# Check installation
python -c "import vllm; print(vllm.__version__)"
```

### Missing dependencies
```bash
pip install vllm guidellm
```

### Virtual environment issues
```bash
# Specify venv path
export VENV_PATH="/path/to/your/venv"
./scripts/demo_full_workflow.sh

# Or activate manually
source /path/to/your/venv/bin/activate
./scripts/demo_full_workflow.sh
```

## 📚 Documentation

- [Full CLI Demo Guide](../docs/CLI_DEMO_GUIDE.md)
- [CLI Quick Reference](../docs/CLI_QUICK_REFERENCE.md)
- [Main README](../README.md)

## 💡 Tips

1. **Start small**: Use TinyLlama or opt-125m for testing
2. **Adjust samples**: Lower calibration samples for faster 3. **Monitor resources**: Watch CPU/GPU/memory usage during benchmarks
4. **Save results**: Benchmark results are saved to `./benchmark_results/`
5. **Compare formats**: Try different quantization formats to find the best trade-off

---

**Happy scripting! 🚀**
