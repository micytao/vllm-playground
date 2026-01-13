# Quick Reference - Command Line Demo

## 🚀 Quick Commands

### Full Demo
```bash
./scripts/demo_full_workflow.sh
```

### Individual Components

```bash
# Test vLLM serving
./scripts/test_vllm_serving.sh

# Compress a model
./scripts/compress_model.sh "MODEL_NAME" "./output" "W4A16" "GPTQ" 512

# Benchmark with GuideLLM
./scripts/benchmark_guidellm.sh 100 5 128 128
```

## 📝 Common Tasks

### Start vLLM Server

```bash
# Basic
python -m vllm.entrypoints.openai.api_server \
  --model TinyLlama/TinyLlama-1.1B-Chat-v1.0 \
  --port 8000

# With pre-quantized model (see LLMCompressor Playground for quantization)
# https://github.com/micytao/llmcompressor-playground
python -m vllm.entrypoints.openai.api_server \
  --model /path/to/quantized/model \
  --port 8000

# CPU mode (macOS)
export VLLM_CPU_KVCACHE_SPACE=40
python -m vllm.entrypoints.openai.api_server \
  --model TinyLlama/TinyLlama-1.1B-Chat-v1.0 \
  --port 8000 \
  --dtype auto
```

### Test with curl

```bash
# Health check
curl http://localhost:8000/health

# List models
curl http://localhost:8000/v1/models

# Chat completion
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_NAME",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 100
  }'

# Streaming chat
curl -N http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_NAME",
    "messages": [{"role": "user", "content": "Count to 5"}],
    "max_tokens": 50,
    "stream": true
  }'
```

### Model Compression

```bash
# Compress TinyLlama with W4A16
./scripts/compress_model.sh \
  "TinyLlama/TinyLlama-1.1B-Chat-v1.0" \
  "./compressed_models" \
  "W4A16" \
  "GPTQ" \
  512

```

### Benchmarking

```bash
# Quick test
./scripts/benchmark_guidellm.sh 50 5 128 128

# Thorough test
./scripts/benchmark_guidellm.sh 500 10 256 256

# Load test
./scripts/benchmark_guidellm.sh 1000 20 128 128
```

## 🔧 Configuration

### Environment Variables

```bash
# Server
export VLLM_HOST="127.0.0.1"
export VLLM_PORT="8000"

# Model
export BASE_MODEL="TinyLlama/TinyLlama-1.1B-Chat-v1.0"

# CPU mode (macOS)
export VLLM_CPU_KVCACHE_SPACE=40
export VLLM_CPU_OMP_THREADS_BIND=auto

# Compression
export QUANTIZATION_FORMAT="W4A16"
export ALGORITHM="GPTQ"
export CALIBRATION_SAMPLES="512"

# Benchmark
export BENCHMARK_REQUESTS="100"
export BENCHMARK_RATE="5"
```

## 📊 Quantization Formats

| Format | Description | Use Case |
|--------|-------------|----------|
| `W8A8_INT8` | 8-bit weights & activations | Balanced quality/size |
| `W4A16` | 4-bit weights, 16-bit activations | Best compression |
| `W8A16` | 8-bit weights, 16-bit activations | Good quality |
| `W4A4` | 4-bit weights & activations | Maximum compression |

## 🎯 Recommended Models

### CPU/macOS
- `TinyLlama/TinyLlama-1.1B-Chat-v1.0` ⭐
- `facebook/opt-125m`
- `meta-llama/Llama-3.2-1B` (requires HF token)

### GPU
- `meta-llama/Llama-2-7b-chat-hf`
- `mistralai/Mistral-7B-Instruct-v0.2`
- `google/gemma-2-2b`

## 🐛 Troubleshooting

```bash
# Check dependencies
# Kill vLLM server
pkill -f "vllm.entrypoints.openai.api_server"

# Check port usage
lsof -i :8000

# View logs
tail -f /tmp/vllm_base.log
tail -f /tmp/vllm_compressed.log
```

## 📁 File Locations

```
vllm-playground/
├── scripts/
│   ├── demo_full_workflow.sh      # Full demo
│   ├── test_vllm_serving.sh       # Test serving
├── compressed_models/             # Compressed models
└── benchmark_results/             # Benchmark results
```

## 🔗 Documentation

- [Full CLI Demo Guide](CLI_DEMO_GUIDE.md)
- [Main README](../README.md)
- [vLLM Docs](https://docs.vllm.ai/)
