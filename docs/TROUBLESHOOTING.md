# Troubleshooting Guide for vLLM Playground

This guide covers common issues and solutions for vLLM Playground.

## Quick Fixes

| Issue | Quick Fix |
|-------|-----------|
| Port already in use | `vllm-playground stop` or `python scripts/kill_playground.py` |
| Container won't start | `podman logs vllm-service` |
| Image pull errors | `vllm-playground pull --all` |
| Tool calling not working | Restart server with "Enable Tool Calling" checked |

---

## Container Issues

### Container Won't Start

```bash
# Check if Podman is installed
podman --version

# Check Podman connectivity
podman ps

# View container logs
podman logs vllm-service

# Check container status
podman ps -a | grep vllm-service
```

### "Address Already in Use" Error

If you lose connection to the Web UI and get `ERROR: address already in use`:

```bash
# Quick Fix: Auto-detect and kill old process
python run.py

# Alternative: Manual restart
./scripts/restart_playground.sh

# Or kill manually
python scripts/kill_playground.py
```

### vLLM Container Issues

```bash
# Check if container is running
podman ps -a | grep vllm-service

# View vLLM logs
podman logs -f vllm-service

# Stop and remove container
podman stop vllm-service && podman rm vllm-service

# Pull latest vLLM images
podman pull quay.io/rh_ee_micyang/vllm-mac:v0.11.0     # macOS ARM64
podman pull quay.io/rh_ee_micyang/vllm-cpu:v0.11.0    # Linux x86_64
podman pull vllm/vllm-openai:v0.11.0                  # GPU (official)
```

---

## MCP Server Issues

### "Command not found" (npx, uvx)

MCP servers using **STDIO transport** require specific runtimes:

| Command | Required For | Installation |
|---------|--------------|--------------|
| `npx` | Filesystem server | Install Node.js: `brew install node` (macOS) or https://nodejs.org/ |
| `uvx` | Git, Fetch, Time servers | Install uv: `brew install uv` (macOS) or https://docs.astral.sh/uv/ |

**Verify installation:**
```bash
# Check if npx is available
npx --version

# Check if uvx is available
uvx --version
```

---

## Tool Calling Issues

### Tool Calling Not Working

Tool calling requires **server-side configuration**. If tools aren't being called:

1. **Verify server was started with tool calling enabled:**
   - Check "Enable Tool Calling" in Server Configuration BEFORE starting
   - Look for this in startup logs: `Tool calling enabled with parser: llama3_json`

2. **Verify CLI args are passed:**
   ```
   vLLM arguments: --model ... --enable-auto-tool-choice --tool-call-parser llama3_json
   ```

3. **If using container mode**, ensure the container was started fresh after enabling tool calling (stop and restart if needed)

### Tool Call Parse Errors

If you see `Error in extracting tool call from response`:

1. **Increase Max Tokens** to 1024+ in Chat Settings
2. **Use a larger model** (Qwen 2.5 7B+, Llama 3.1 8B+)
3. **Reduce tool count** - fewer tools = more reliable parsing

---

## OpenShift/Kubernetes Issues

### GPU Mode Not Available

The Web UI automatically detects GPU availability by querying Kubernetes nodes for `nvidia.com/gpu` resources.

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
oc auth can-i list nodes --as=system:serviceaccount:vllm-playground:vllm-playground-sa
# Should return "yes"
```

2. Reapply RBAC if needed:
```bash
oc apply -f openshift/manifests/02-rbac.yaml
```

### Pod Not Starting

```bash
# Check pod status
oc get pods -n vllm-playground

# View pod logs
oc logs -f deployment/vllm-playground-gpu -n vllm-playground

# Describe pod for events
oc describe pod <pod-name> -n vllm-playground
```

### Out of Memory (OOM) Issues

**⚠️ Resource Requirements for GuideLLM Benchmarks**

The Web UI pod requires sufficient memory for GuideLLM benchmarks.

**Recommended Memory Limits:**
- **GPU Mode**: 16Gi minimum, 32Gi+ for intensive benchmarks
- **CPU Mode**: 64Gi minimum, 128Gi+ for intensive benchmarks

**To increase resources:**

Edit `openshift/manifests/04-webui-deployment.yaml`:
```yaml
resources:
  limits:
    memory: "32Gi"
    cpu: "8"
```

Then reapply:
```bash
oc apply -f openshift/manifests/04-webui-deployment.yaml
```

### Image Pull Errors

All images are publicly accessible - no authentication needed:
- **GPU**: `vllm/vllm-openai:v0.11.0`
- **CPU**: `quay.io/rh_ee_micyang/vllm-cpu:v0.11.0`

```bash
# Verify image accessibility
podman pull vllm/vllm-openai:v0.11.0
podman pull quay.io/rh_ee_micyang/vllm-cpu:v0.11.0
```

---

## Common vLLM Issues

### 1. Engine Core Initialization Failed with "Torch not compiled with CUDA enabled"

**Error:**
```
AssertionError: Torch not compiled with CUDA enabled
RuntimeError: Engine core initialization failed. See root cause above. Failed core proc(s): {'EngineCore_DP0': 1}
```

**Root Cause:**
vLLM is trying to use CUDA/GPU mode on macOS where CUDA is not available. This happens when the `--device cpu` flag is not explicitly set.

**Solution:**
This is now fixed automatically in the WebUI - it will detect macOS and add the `--device cpu` flag. However, if you're running vLLM manually or seeing this error:

1. **Ensure you're using CPU mode** - The WebUI auto-detects macOS
2. **Verify the command includes** `--device cpu`
3. **Check your vLLM version** - Make sure you have vLLM with CPU backend support
4. **Environment variables are set:**
   ```bash
   export VLLM_CPU_KVCACHE_SPACE=4
   export VLLM_CPU_OMP_THREADS_BIND=auto
   export VLLM_CPU_MOE_PREPACK=0
   export VLLM_CPU_SGL_KERNEL=0
   ```

### 2. Engine Core Initialization Failed (Memory Issues)

**Error:**
```
RuntimeError: Engine core initialization failed. See root cause above. Failed core proc(s): {'EngineCore_DP0': 1}
```
(Without the CUDA error)

**Solution:**
- Use a smaller model (e.g., `facebook/opt-125m` or `facebook/opt-350m` for testing)
- Reduce `max_model_len` to 512, 1024, or 2048
- Reduce KV cache space in settings (try 2-4 GB instead of 40 GB)

#### B. Model Not Compatible with CPU Backend
Some models may not work well with vLLM's CPU backend.

**Solution:**
- Try a different model from the OPT family first: `facebook/opt-125m`, `facebook/opt-350m`
- Check if the model supports CPU inference

#### C. CPU Optimization Issues on Apple Silicon
Some CPU optimizations may cause issues on M1/M2/M3 Macs (now automatically disabled).

**Solution:**
The WebUI now automatically disables problematic optimizations. If running manually, add these to your environment or `config/vllm_cpu.env`:
```bash
export VLLM_CPU_MOE_PREPACK=0
export VLLM_CPU_SGL_KERNEL=0
```

### 3. max_num_batched_tokens Error

**Error:**
```
Value error, max_num_batched_tokens (2048) is smaller than max_model_len (131072)
```

**Solution:**
This is now fixed automatically, but if you still see it:
- Explicitly set `max_model_len` to a reasonable value (2048, 4096, or 8192)
- The WebUI will automatically set `max_num_batched_tokens` to match

### 3. Memory Issues - OOM (Out of Memory)

**Symptoms:**
- Process crashes
- System becomes unresponsive
- "Cannot allocate memory" errors

**Solution:**
1. **Reduce model size:** Use smaller models
2. **Reduce max_model_len:** Try 512, 1024, or 2048
3. **Reduce KV cache:** Set to 2-4 GB
4. **Close other applications:** Free up RAM

**Conservative Settings for CPU:**
```json
{
  "model": "facebook/opt-125m",
  "max_model_len": 1024,
  "cpu_kvcache_space": 2,
  "dtype": "bfloat16"
}
```

### 4. Model Download Issues

**Symptoms:**
- Timeout errors
- Connection refused
- Model not found

**Solution:**
1. Check your internet connection
2. For gated models (Llama 2, etc.), ensure you have:
   - Hugging Face account
   - Accepted model terms
   - Set HF_TOKEN environment variable
3. Pre-download models:
   ```bash
   python -c "from transformers import AutoModelForCausalLM; AutoModelForCausalLM.from_pretrained('facebook/opt-125m')"
   ```

### 5. Server Won't Start

**Solution:**
1. Check if port is already in use:
   ```bash
   lsof -i :8000
   ```
2. Try a different port in settings
3. Check logs in WebUI for specific errors

### 6. Slow Performance on CPU

**Expected Behavior:**
CPU inference is inherently slower than GPU. Typical speeds:
- Small models (125M-350M): 10-50 tokens/second
- Medium models (1B-3B): 1-10 tokens/second
- Large models (7B+): 0.1-2 tokens/second

**Optimization:**
1. Increase KV cache (if you have RAM): 10-40 GB
2. Reduce max_tokens in generation
3. Use smaller models
4. Ensure no other heavy processes are running

## Recommended Starting Configuration

### For Testing (Minimal Resources)
```json
{
  "model": "facebook/opt-125m",
  "max_model_len": 1024,
  "cpu_kvcache_space": 2,
  "dtype": "bfloat16"
}
```

### For Development (Moderate Resources)
```json
{
  "model": "facebook/opt-350m",
  "max_model_len": 2048,
  "cpu_kvcache_space": 4,
  "dtype": "bfloat16"
}
```

### For Production (High Resources)
```json
{
  "model": "facebook/opt-1.3b",
  "max_model_len": 4096,
  "cpu_kvcache_space": 10,
  "dtype": "bfloat16"
}
```

## Getting More Debug Information

To see detailed error messages:

1. **In WebUI:** Check the Server Logs panel
2. **From command line:**
   ```bash
   python app.py
   ```
   Then check terminal output

3. **Enable verbose logging:**
   ```bash
   export VLLM_LOGGING_LEVEL=DEBUG
   python app.py
   ```

## macOS-Specific Issues

### Apple Silicon (M1/M2/M3) Compatibility
- vLLM CPU backend works but may be slower
- Some optimizations may need to be disabled
- Intel-based Macs may have different behavior

### Environment Setup
Make sure you have:
```bash
# Check Python version (3.8+)
python --version

# Check if vLLM is installed
python -c "import vllm; print(vllm.__version__)"

# Check available memory
sysctl hw.memsize
```

## Still Having Issues?

1. **Check the full error log** - The root cause is usually shown above the final error
2. **Try the smallest model first** - `facebook/opt-125m` with minimal settings
3. **Monitor system resources** - Use Activity Monitor to check RAM usage
4. **Check vLLM compatibility** - Some features may not work on CPU backend

## Reporting Issues

When reporting issues, please include:
1. Full error log from WebUI
2. Your system specs (macOS version, RAM, CPU)
3. Model and configuration you're trying to use
4. Steps to reproduce the error
