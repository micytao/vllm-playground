# Quick Reference: Running vLLM on macOS

## 🎯 The Problem You Had
```bash
# ❌ This caused segmentation fault on macOS:
python -m vllm.entrypoints.openai.api_server \
  --model facebook/opt-125m \
  --tensor-parallel-size 1 \           # GPU-specific - crashes on macOS
  --gpu-memory-utilization 0.9 \       # GPU-specific - crashes on macOS
  --dtype auto \
  --load-format auto
```

## ✅ The Solution (CPU Mode)
```bash
# Set environment variables first
export VLLM_CPU_KVCACHE_SPACE=40
export VLLM_CPU_OMP_THREADS_BIND=auto

# Then run vLLM with CPU-compatible settings
python3 -m vllm.entrypoints.openai.api_server \
  --model facebook/opt-125m \
  --host 0.0.0.0 \
  --port 8000 \
  --dtype bfloat16
```

## 🚀 Three Ways to Run

### 1. Helper Script (Easiest)
```bash
./run_cpu.sh
```

### 2. Manual Command
```bash
export VLLM_CPU_KVCACHE_SPACE=40
export VLLM_CPU_OMP_THREADS_BIND=auto
python3 -m vllm.entrypoints.openai.api_server --model facebook/opt-125m --dtype bfloat16 --port 8000
```

### 3. Using WebUI (Auto-detects macOS)
```bash
python3 run.py
# Then open http://localhost:7860 and click "Start Server"
```

## 📚 Documentation
[Official vLLM CPU Guide](https://docs.vllm.ai/en/stable/getting_started/installation/cpu.html#related-runtime-environment-variables)

## 🔑 Key Changes Summary
1. ✅ Add `VLLM_CPU_KVCACHE_SPACE` environment variable
2. ✅ Add `VLLM_CPU_OMP_THREADS_BIND` environment variable
3. ❌ Remove `--tensor-parallel-size`
4. ❌ Remove `--gpu-memory-utilization`
5. ❌ Remove `--load-format`
6. ✅ Change `--dtype auto` to `--dtype bfloat16`
