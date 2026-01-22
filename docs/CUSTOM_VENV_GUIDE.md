# Using Custom vLLM Installations

vLLM Playground supports using custom vLLM installations from virtual environments. This allows you to:

- Use specific vLLM versions
- Test development builds
- Use vLLM with custom patches
- Use vLLM Metal for Apple Silicon GPU acceleration

## How It Works

When running in **subprocess mode**, you can specify a virtual environment path. The playground will:

1. Validate the venv exists and contains vLLM
2. Use that venv's Python interpreter to launch vLLM
3. Pass all configuration options to vLLM as usual

## Setup

### 1. Create and Configure Virtual Environment

```bash
# Create a virtual environment
python3 -m venv ~/.vllm-custom

# Activate it
source ~/.vllm-custom/bin/activate

# Install your desired vLLM version
pip install vllm  # Latest release
# OR
pip install vllm==0.x.x  # Specific version
# OR
pip install git+https://github.com/vllm-project/vllm.git  # Development version
```

### 2. Configure Playground

1. Start vLLM Playground
2. In Server Configuration:
   - **Run Mode:** Select "Subprocess"
   - **Custom Virtual Environment Path:** Enter `~/.vllm-custom`
3. Configure other options (model, compute mode, etc.)
4. Start server

## Use Cases

### Specific vLLM Version

Install a specific version for compatibility or testing:

```bash
python3 -m venv ~/.vllm-0.6.0
source ~/.vllm-0.6.0/bin/activate
pip install vllm==0.6.0
```

Playground venv path: `~/.vllm-0.6.0`

### Development Build

Test unreleased features or bug fixes:

```bash
python3 -m venv ~/.vllm-dev
source ~/.vllm-dev/bin/activate
pip install git+https://github.com/vllm-project/vllm.git@main
```

Playground venv path: `~/.vllm-dev`

### Custom Patches

Install vLLM with your modifications:

```bash
# Clone and modify vLLM
git clone https://github.com/vllm-project/vllm.git
cd vllm
# Make your changes...

# Install in development mode
python3 -m venv ~/.vllm-custom
source ~/.vllm-custom/bin/activate
pip install -e .
```

Playground venv path: `~/.vllm-custom`

### Metal GPU Acceleration

See [macOS Metal Guide](MACOS_METAL_GUIDE.md) for vllm-metal setup.

## Validation

The playground validates your venv before starting:

- ✅ Venv path exists
- ✅ Python binary exists at `<venv>/bin/python`
- ✅ vLLM is importable
- ✅ vLLM version is displayed in logs

If validation fails, check:
1. Path is correct (use `ls <venv>/bin/python` to verify)
2. vLLM is installed (`<venv>/bin/python -c "import vllm"`)
3. No permission issues

## Benefits vs System Installation

**Using venv path:**
- ✅ Isolate vLLM versions
- ✅ Test different configurations
- ✅ No conflicts with system Python
- ✅ Easy to switch between versions
- ✅ Safe to experiment

**Using system Python (no venv path):**
- ✅ Simpler setup
- ✅ One installation to manage
- ⚠️ Can't easily test different versions
- ⚠️ May conflict with other packages

## Troubleshooting

**"Virtual environment not found"**
- Check path spelling and expansion (use full path or `~`)
- Verify with: `ls <venv>/bin/python`

**"vLLM not found in virtual environment"**
- Activate venv and check: `source <venv>/bin/activate && python -c "import vllm"`
- Reinstall vLLM in that venv

**Server fails with import errors**
- Check dependencies: `<venv>/bin/pip list`
- Reinstall with all dependencies: `<venv>/bin/pip install --force-reinstall vllm`

## See Also

- [macOS Metal Guide](MACOS_METAL_GUIDE.md) - Metal GPU acceleration
- [README](../README.md) - Main documentation
