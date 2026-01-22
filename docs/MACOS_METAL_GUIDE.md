# macOS Metal GPU Support

vLLM Playground supports Apple Silicon GPU acceleration through vLLM Metal. This guide explains how to set it up.

## Overview

Metal GPU acceleration allows vLLM to run on Apple Silicon (M1/M2/M3/M4) GPUs instead of CPU, providing significant performance improvements.

**Key Points:**
- You install vllm-metal yourself (not managed by the playground)
- Point the playground to your vllm-metal virtual environment
- Metal support requires subprocess mode

## Installation

### Step 1: Install vLLM Metal

Follow the official vllm-metal installation instructions:

https://github.com/vllm-project/vllm-metal

**Quick install:**

```bash
# Run the official install script
curl -fsSL https://raw.githubusercontent.com/vllm-project/vllm-metal/main/install.sh | bash
```

This creates a virtual environment at `~/.venv-vllm-metal` with both vLLM and vLLM Metal installed.

### Step 2: Configure vLLM Playground

1. Start vLLM Playground
2. In Server Configuration:
   - **Run Mode:** Select "Subprocess"
   - **Compute Mode:** Select "⚡ Metal"
   - **Custom Virtual Environment Path:** Enter `~/.venv-vllm-metal`
3. Select your model and start the server

## How It Works

When you specify a venv path:
1. Playground validates the venv exists and contains vLLM
2. Uses that venv's Python to launch vLLM
3. Sets `VLLM_TARGET_DEVICE=metal` environment variable
4. vLLM detects the Metal plugin and uses GPU acceleration

## Troubleshooting

**"Virtual environment not found"**
- Verify the path is correct
- Use `ls ~/.venv-vllm-metal/bin/python` to check it exists

**"vLLM not found in virtual environment"**
- Reinstall vllm-metal following official instructions
- Check installation: `~/.venv-vllm-metal/bin/python -c "import vllm"`

**Server fails to start**
- Check logs for specific errors
- Ensure you're on Apple Silicon macOS
- Verify Metal installation: `~/.venv-vllm-metal/bin/python -c "import vllm_metal"`

## Performance Tips

- Use smaller models (7B or less) for best performance
- Set `max_model_len` to 2048 or less for faster startup
- Metal works best with bfloat16 dtype (auto-configured)

## Updating vLLM Metal

To update to the latest vllm-metal release:

```bash
# Activate the venv
source ~/.venv-vllm-metal/bin/activate

# Update using the official script
curl -fsSL https://raw.githubusercontent.com/vllm-project/vllm-metal/main/install.sh | bash
```

## See Also

- [Custom Virtual Environment Guide](CUSTOM_VENV_GUIDE.md) - Using any custom vLLM installation
- [vllm-metal GitHub](https://github.com/vllm-project/vllm-metal) - Official documentation
