# vLLM on macOS - CPU Mode Guide

This guide helps you run vLLM on macOS using CPU inference, based on the [official vLLM CPU documentation](https://docs.vllm.ai/en/stable/getting_started/installation/cpu.html).

## ⚠️ Important Note

vLLM doesn't have native GPU support on macOS. Instead, we use **CPU inference mode**, which is officially supported and works great for development and small models.

## 🚀 Quick Start

### Option 1: Using the Helper Script (Easiest)

```bash
./run_cpu.sh [model_name] [port]
```

**Examples:**
```bash
# Use default model (facebook/opt-125m) on port 8000
./run_cpu.sh

# Specify a different model
./run_cpu.sh facebook/opt-350m

# Specify model and port
./run_cpu.sh facebook/opt-125m 8080
```

### Option 2: Manual Command

```bash
# Set environment variables
export VLLM_CPU_KVCACHE_SPACE=40
export VLLM_CPU_OMP_THREADS_BIND=auto

# Run vLLM server
python3 -m vllm.entrypoints.openai.api_server \
  --model facebook/opt-125m \
  --host 0.0.0.0 \
  --port 8000 \
  --dtype bfloat16
```

### Option 3: Using the WebUI

The WebUI now automatically detects macOS and uses CPU mode:

```bash
# Start the WebUI
python3 run.py

# Then open http://localhost:7860 in your browser
# Click "Start Server" - it will automatically use CPU settings
```

## 📋 Environment Variables

According to the [vLLM CPU documentation](https://docs.vllm.ai/en/stable/getting_started/installation/cpu.html#related-runtime-environment-variables), these are the key settings:

### `VLLM_CPU_KVCACHE_SPACE`
- **Default:** 4 (GB)
- **Recommended:** 40 (GB) for better performance
- **Purpose:** Allocates memory for KV cache
- Larger values support more concurrent requests and longer context

### `VLLM_CPU_OMP_THREADS_BIND`
- **Default:** Not set
- **Recommended:** `auto`
- **Purpose:** Automatic thread binding for optimal CPU performance
- The `auto` setting is recommended for most cases

### Optional: `VLLM_CPU_NUM_OF_RESERVED_CPU`
- **Default:** Not set
- **Recommended:** 1 (when running online serving)
- **Purpose:** Reserve CPU cores for the serving framework
- Helps avoid CPU oversubscription

## ⚙️ Command Differences: GPU vs CPU

### ❌ GPU Mode (Original - Doesn't work on macOS)
```bash
python3 -m vllm.entrypoints.openai.api_server \
  --model facebook/opt-125m \
  --tensor-parallel-size 1 \           # GPU-specific ❌
  --gpu-memory-utilization 0.9 \       # GPU-specific ❌
  --dtype auto \
  --load-format auto                   # Not needed for CPU ❌
```

### ✅ CPU Mode (macOS Compatible)
```bash
export VLLM_CPU_KVCACHE_SPACE=40
export VLLM_CPU_OMP_THREADS_BIND=auto

python3 -m vllm.entrypoints.openai.api_server \
  --model facebook/opt-125m \
  --host 0.0.0.0 \
  --port 8000 \
  --dtype bfloat16                     # Recommended for CPU ✅
```

**Key Changes:**
1. ✅ Added environment variables for CPU mode
2. ❌ Removed `--tensor-parallel-size` (GPU-specific)
3. ❌ Removed `--gpu-memory-utilization` (GPU-specific)
4. ❌ Removed `--load-format` (not needed)
5. ✅ Changed `--dtype` to `bfloat16` (recommended for CPU)

## 🎯 Recommended Settings for macOS

### For Small Models (< 1B parameters)
```bash
export VLLM_CPU_KVCACHE_SPACE=10
export VLLM_CPU_OMP_THREADS_BIND=auto

python3 -m vllm.entrypoints.openai.api_server \
  --model facebook/opt-125m \
  --dtype bfloat16 \
  --port 8000
```

### For Medium Models (1-7B parameters)
```bash
export VLLM_CPU_KVCACHE_SPACE=40
export VLLM_CPU_OMP_THREADS_BIND=auto

python3 -m vllm.entrypoints.openai.api_server \
  --model facebook/opt-1.3b \
  --dtype bfloat16 \
  --port 8000
```

## 🔍 Troubleshooting

### Issue: Segmentation Fault
**Cause:** Trying to use GPU-specific features on macOS

**Solution:** Remove these flags:
- `--tensor-parallel-size`
- `--gpu-memory-utilization`
- `--load-format`

And add environment variables:
```bash
export VLLM_CPU_KVCACHE_SPACE=40
export VLLM_CPU_OMP_THREADS_BIND=auto
```

### Issue: "Triton not installed" Warning
**Cause:** Triton is GPU-specific and not needed for CPU

**Solution:** This is normal! The warning is expected on macOS. vLLM will work fine without Triton when using CPU mode.

### Issue: Out of Memory
**Cause:** Model is too large for available RAM

**Solutions:**
1. Reduce `VLLM_CPU_KVCACHE_SPACE`:
   ```bash
   export VLLM_CPU_KVCACHE_SPACE=4  # or lower
   ```

2. Use a smaller model:
   - `facebook/opt-125m` (smallest)
   - `facebook/opt-350m` (small)
   - `facebook/opt-1.3b` (medium)

### Issue: Slow Performance
**Cause:** CPU inference is slower than GPU

**Solutions:**
1. Ensure thread binding is enabled:
   ```bash
   export VLLM_CPU_OMP_THREADS_BIND=auto
   ```

2. Use smaller batch sizes in the WebUI

3. Reduce max tokens per request

4. Consider using smaller models for faster responses

## 📊 Performance Expectations

CPU inference is significantly slower than GPU, but it works well for:
- ✅ Development and testing
- ✅ Small models (< 1B parameters)
- ✅ Low concurrency scenarios
- ✅ Learning and experimentation

For production workloads, consider:
- Using a Linux machine with GPU
- Cloud GPU services (RunPod, Lambda Labs, etc.)
- Docker with GPU support

## 🔗 References

- [Official vLLM CPU Documentation](https://docs.vllm.ai/en/stable/getting_started/installation/cpu.html)
- [vLLM CPU Installation Guide](https://docs.vllm.ai/en/stable/getting_started/installation/cpu.html#related-runtime-environment-variables)

## 📝 Example: Complete Workflow

```bash
# 1. Navigate to project directory
cd /Users/micyang/vllm-playground

# 2. Start vLLM server (Terminal 1)
./run_cpu.sh facebook/opt-125m 8000

# Wait for "Application startup complete" message

# 3. In another terminal, start the WebUI (Terminal 2)
python3 run.py

# 4. Open browser to http://localhost:7860

# 5. Test the API
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "facebook/opt-125m",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 50
  }'
```

## ✨ WebUI Features

The updated WebUI now:
- 🔍 **Auto-detects macOS** and enables CPU mode
- 🎛️ **Hides GPU-specific options** when in CPU mode
- 📊 **Shows CPU settings** in the logs
- 🖥️ **Displays the correct command** in the preview
- ✅ **Sets dtype=bfloat16** automatically for CPU

Enjoy using vLLM on macOS! 🚀
