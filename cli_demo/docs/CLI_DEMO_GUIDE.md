# Command-Line Demo: vLLM + GuideLLM

## 🎯 Overview

This demo showcases the complete workflow:

1. **vLLM Serving** - Start and test model inference
3. **GuideLLM** - Benchmark performance with detailed metrics

## 📋 Prerequisites

```bash
# Install required packages
pip install vllm guidellm

# Or use your virtual environment
source ~/.venv/bin/activate
pip install -r requirements.txt
```

## 🚀 Quick Start - Full Demo

Run the complete workflow with one command:

```bash
./scripts/demo_full_workflow.sh
```

This will:
- ✅ Check dependencies
- ✅ Start vLLM server with base model
- ✅ Test chat serving with curl
### Customization

```bash
# Use a different model
BASE_MODEL="meta-llama/Llama-3.2-1B" ./scripts/demo_full_workflow.sh

# Change quantization format
QUANTIZATION_FORMAT="W4A16" ./scripts/demo_full_workflow.sh

# Use different port
VLLM_PORT=8080 ./scripts/demo_full_workflow.sh

# Quick demo with fewer samples (faster)
CALIBRATION_SAMPLES=128 BENCHMARK_REQUESTS=50 ./scripts/demo_full_workflow.sh
```

## 🔧 Individual Components

### 1. Test vLLM Serving

Test your vLLM server with comprehensive curl-based tests:

```bash
# First, start vLLM server
python -m vllm.entrypoints.openai.api_server \
  --model TinyLlama/TinyLlama-1.1B-Chat-v1.0 \
  --host 0.0.0.0 \
  --port 8000

# Then run tests (in another terminal)
./scripts/test_vllm_serving.sh
```

This script tests:
- ✅ Health check
- ✅ Model listing
- ✅ Simple chat completion
- ✅ Streaming responses
- ✅ Multi-turn conversations
- ✅ Text completions

**Custom server:**
```bash
VLLM_HOST=localhost VLLM_PORT=8080 ./scripts/test_vllm_serving.sh
```

### 3. Benchmark with GuideLLM

Run performance benchmarks against your vLLM server:

```bash
# Make sure vLLM server is running first!

# Basic benchmark
./scripts/benchmark_guidellm.sh

# Custom settings: requests, rate, prompt_tokens, output_tokens
./scripts/benchmark_guidellm.sh 200 10 256 256

# Load test with high rate
./scripts/benchmark_guidellm.sh 500 20 128 128

# Thorough test with many requests
./scripts/benchmark_guidellm.sh 1000 5 512 256
```

**Arguments:**
1. Total requests (default: 100)
2. Request rate per second (default: 5)
3. Prompt tokens (default: 128)
4. Output tokens (default: 128)

**Environment variables:**
```bash
# Test different server
VLLM_HOST=localhost VLLM_PORT=8080 ./scripts/benchmark_guidellm.sh

# Use sweep rate instead of constant
RATE_TYPE=sweep ./scripts/benchmark_guidellm.sh 100
```

**Results:**
- JSON output saved to `./benchmark_results/guidellm_TIMESTAMP.json`
- Detailed logs saved to `./benchmark_results/guidellm_TIMESTAMP.log`
- Real-time metrics displayed in terminal

## 📊 Example Workflows

### Workflow 3: Quick Model Validation

```bash
# Start server in background
python -m vllm.entrypoints.openai.api_server \
  --model TinyLlama/TinyLlama-1.1B-Chat-v1.0 \
  --port 8000 &

# Wait a bit for server to start
sleep 30

# Run quick tests
./scripts/test_vllm_serving.sh

# Quick benchmark
./scripts/benchmark_guidellm.sh 50 5 128 128

# Stop server
pkill -f "vllm.entrypoints.openai.api_server"
```

## 🎬 Example: Manual Step-by-Step Demo

Follow your original plan manually:

```bash
# Step 1: Start vLLM server
python -m vllm.entrypoints.openai.api_server \
  --model TinyLlama/TinyLlama-1.1B-Chat-v1.0 \
  --host 0.0.0.0 \
  --port 8000 \
  --dtype auto

# Step 2: Test with curl (in another terminal)
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
    "messages": [
      {"role": "user", "content": "Hello! How are you?"}
    ],
    "max_tokens": 100
  }'

./scripts/compress_model.sh \
  "TinyLlama/TinyLlama-1.1B-Chat-v1.0" \
  "./compressed_models" \
  "W4A16" \
  "GPTQ" \
  512

## 📁 Output Structure

```
vllm-playground/
├── compressed_models/          # Compressed models
│   └── MODEL_NAME_FORMAT/
│       ├── config.json
│       ├── tokenizer.json
│       └── *.safetensors
│
└── benchmark_results/          # Benchmark results
    ├── guidellm_TIMESTAMP.json
    └── guidellm_TIMESTAMP.log
```

## 🔧 Configuration

### Environment Variables

```bash
# vLLM Configuration
export VLLM_HOST="127.0.0.1"
export VLLM_PORT="8000"
export BASE_MODEL="TinyLlama/TinyLlama-1.1B-Chat-v1.0"

# CPU Mode (macOS)
export VLLM_CPU_KVCACHE_SPACE=40
export VLLM_CPU_OMP_THREADS_BIND=auto

# Compression
export COMPRESSED_MODEL_DIR="./compressed_models"
export QUANTIZATION_FORMAT="W8A8_INT8"
export ALGORITHM="GPTQ"
export CALIBRATION_SAMPLES="512"

# Benchmarking
export BENCHMARK_REQUESTS="100"
export BENCHMARK_RATE="5"
export PROMPT_TOKENS="128"
export OUTPUT_TOKENS="128"
export RATE_TYPE="constant"  # or "sweep"

# Virtual Environment
export VENV_PATH="$HOME/.venv"
```

### Recommended Models for Different Hardware

**CPU (macOS, small RAM):**
- `TinyLlama/TinyLlama-1.1B-Chat-v1.0` (1B params)
- `facebook/opt-125m` (125M params)
- `meta-llama/Llama-3.2-1B` (1B params, requires HF token)

**CPU (Linux, good RAM):**
- `google/gemma-2-2b` (2B params, requires HF token)
- `microsoft/phi-2` (2.7B params)

**GPU (Consumer):**
- `meta-llama/Llama-2-7b-chat-hf` (7B params)
- `mistralai/Mistral-7B-Instruct-v0.2` (7B params)

**GPU (Enterprise):**
- Any model you want!

## 📊 Understanding Results

### GuideLLM Metrics

- **Total Requests**: Number of requests completed
- **Success Rate**: Percentage of successful requests
- **Average Latency**: Mean time per request
- **P95/P99 Latency**: 95th/99th percentile (outliers)
- **Throughput**: Tokens generated per second
- **Request Rate**: Requests processed per second

### What to Look For

**Good Performance:**
- ✅ Success rate > 99%
- ✅ P95 latency < 2x average
- ✅ Consistent throughput
- ✅ Linear scaling with rate

**Issues:**
- ⚠️ Success rate < 95% (server overloaded)
- ⚠️ P99 >> P95 (high variance, instability)
- ⚠️ Throughput plateaus (bottleneck)
- ⚠️ Increasing latency (memory leak?)

## 🐛 Troubleshooting

### vLLM Server Won't Start

```bash
# Check if port is in use
lsof -i :8000

# Kill existing process
pkill -f "vllm.entrypoints.openai.api_server"

# Check vLLM installation
python -c "import vllm; print(vllm.__version__)"

# View logs
tail -f /tmp/vllm_base.log
```

### Benchmark Errors

```bash
# Check server is running
curl http://localhost:8000/health

# Test manually first
./scripts/test_vllm_serving.sh

# Use lower request rate
./scripts/benchmark_guidellm.sh 50 2 128 128

# Check guidellm
python -c "import guidellm"
```

### macOS Specific Issues

```bash
# Set CPU environment variables
export VLLM_CPU_KVCACHE_SPACE=40
export VLLM_CPU_OMP_THREADS_BIND=auto

# Use CPU-optimized models
BASE_MODEL="TinyLlama/TinyLlama-1.1B-Chat-v1.0" ./scripts/demo_full_workflow.sh

# Reduce memory usage
VLLM_CPU_KVCACHE_SPACE=20 ./scripts/run_cpu.sh
```

## 📚 Additional Resources

- [vLLM Documentation](https://docs.vllm.ai/)
## 💡 Tips & Best Practices

### For Benchmarking:
- Run multiple times and average results
- Start with low request rate, increase gradually
- Use realistic prompt/output token sizes
- Monitor system resources during tests
### For Production:
## 🎯 Next Steps

1. Run the full demo: `./scripts/demo_full_workflow.sh`
2. Experiment with different quantization formats
3. Benchmark various models and compare
4. Integrate into your CI/CD pipeline
5. Deploy to production with optimized models

---

**Happy benchmarking! 🚀**
