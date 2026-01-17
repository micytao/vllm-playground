# Quick Start: CPU-Optimized Models

## TL;DR - Best CPU Models

For macOS and CPU users, use these models (ordered by recommendation):

1. **TinyLlama 1.1B** ⭐ Start here
2. **Llama 3.2 1B** - Better quality, needs HF token
3. **Gemma 2 2B** - Best quality, needs HF token

## 1. TinyLlama 1.1B (No Setup Required)

**Best for**: Testing, learning, quick start

```bash
# WebUI configuration:
Model: TinyLlama/TinyLlama-1.1B-Chat-v1.0
Max Model Length: 2048
CPU KV Cache: 4
```

**No HuggingFace token needed!** Just click Start Server.

**Expected Performance**: 15-30 tokens/second on M1/M2 Mac

## 2. Llama 3.2 1B (Requires HF Token)

**Best for**: Latest Meta technology, good quality

### Setup (5 minutes):

1. **Get access to Llama 3.2**:
   - Go to https://huggingface.co/meta-llama/Llama-3.2-1B
   - Click "Agree and access repository"
   - Accept Meta's license

2. **Get HuggingFace token**:
   - Go to https://huggingface.co/settings/tokens
   - Click "New token"
   - Name it (e.g., "vLLM")
   - Select "Read" permission
   - Copy the token (starts with `hf_`)

3. **Configure in WebUI**:
   ```
   Model: meta-llama/Llama-3.2-1B
   Max Model Length: 2048
   CPU KV Cache: 4
   HF Token: hf_xxxxxxxxxxxxx (paste your token here)
   ```

**Expected Performance**: 15-25 tokens/second on M1/M2 Mac

## 3. Gemma 2 2B (Requires HF Token)

**Best for**: Best quality in small model class

### Setup (5 minutes):

1. **Get access to Gemma 2**:
   - Go to https://huggingface.co/google/gemma-2-2b
   - Click "Agree and access repository"
   - Accept Google's terms

2. **Get HuggingFace token** (same as Llama above)

3. **Configure in WebUI**:
   ```
   Model: google/gemma-2-2b
   Max Model Length: 2048
   CPU KV Cache: 6 (slightly more RAM needed)
   HF Token: hf_xxxxxxxxxxxxx
   ```

**Expected Performance**: 10-15 tokens/second on M1/M2 Mac

## One-Command Start (Terminal)

### TinyLlama (no token):
```bash
# Start WebUI
python run.py

# Or directly with run_cpu.sh
./scripts/run_cpu.sh TinyLlama/TinyLlama-1.1B-Chat-v1.0
```

### Llama 3.2 (with token):
```bash
# Set token first
export HF_TOKEN="hf_xxxxxxxxxxxxx"

# Start WebUI
python run.py

# Or directly
./scripts/run_cpu.sh meta-llama/Llama-3.2-1B
```

### Gemma 2 (with token):
```bash
# Set token first
export HF_TOKEN="hf_xxxxxxxxxxxxx"

# Start WebUI
python run.py

# Or directly
./scripts/run_cpu.sh google/gemma-2-2b
```

## Memory Requirements

| Model | RAM Required | Recommended RAM |
|-------|-------------|-----------------|
| TinyLlama 1.1B | 4GB | 8GB |
| Llama 3.2 1B | 4GB | 8GB |
| Gemma 2 2B | 6GB | 12GB |

## First Download

**Note**: The first time you run a model, it will download the model files:

- TinyLlama: ~2.2GB download (5-10 minutes on good internet)
- Llama 3.2 1B: ~2GB download
- Gemma 2 2B: ~4GB download

**After first download, models are cached** and start instantly!

## Troubleshooting

### "Repository not found" or "Access denied"
➜ You need to request access on the model's HuggingFace page first

### "Invalid token"
➜ Double-check you copied the entire token (starts with `hf_`)

### "Out of memory"
➜ Try reducing `max_model_len` to 1024 or use a smaller model

### Server starts but responses are slow
➜ Normal on CPU! Lower expectations:
- 10-30 tokens/sec is good on CPU
- Compare to 100+ tokens/sec on GPU

## Quality Comparison

For similar prompts:

**TinyLlama**: Decent quality, occasional grammar issues, fast
**Llama 3.2 1B**: Better reasoning, more coherent, slightly slower
**Gemma 2 2B**: Best quality, most coherent, slowest (but still fast enough)

## Which Model Should I Use?

### Choose TinyLlama if:
- You're just testing vLLM
- You want the fastest responses
- You don't want to deal with HF tokens
- You have limited RAM (< 8GB)

### Choose Llama 3.2 1B if:
- You want better quality than TinyLlama
- You can spend 5 mins to get HF token
- You want latest Meta technology
- Good balance of quality and speed

### Choose Gemma 2 2B if:
- You want the best quality in small models
- You have 12GB+ RAM
- You can wait slightly longer for responses
- You want Google's latest efficient model

## Complete Example Session

```bash
# 1. Set HF token (if using Llama or Gemma)
export HF_TOKEN="hf_your_token_here"

# 2. Start WebUI
cd /path/to/vllm-playground
python run.py

# 3. Open browser
open http://localhost:7860

# 4. In WebUI:
#    - Model: meta-llama/Llama-3.2-1B
#    - Max Model Length: 2048
#    - CPU KV Cache: 4
#    - HF Token: (paste your token)
#    - Click "Start Server"

# 5. Wait for "Server ready" message

# 6. Go to Chat tab and start chatting!
```

## Need Help?

- Full gated models guide: [docs/GATED_MODELS_GUIDE.md](GATED_MODELS_GUIDE.md)
- Troubleshooting: [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- macOS setup: [docs/MACOS_CPU_GUIDE.md](MACOS_CPU_GUIDE.md)
