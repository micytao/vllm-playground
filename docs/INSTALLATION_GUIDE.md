# vLLM Playground - Installation Guide

## Ultra-Minimal Container Setup

This guide walks you through installing all dependencies in the ultra-minimal vLLM Playground container deployed on OpenShift/Kubernetes.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Detailed Installation Steps](#detailed-installation-steps)
- [Hardware-Specific Instructions](#hardware-specific-instructions)
- [Verification](#verification)
- [Starting the Application](#starting-the-application)
- [Troubleshooting](#troubleshooting)
- [Disk Space Management](#disk-space-management)
- [Next Steps](#next-steps)

---

## Prerequisites

### Access the Container

First, remote into your running pod:

```bash
oc exec -it deployment/vllm-playground-dev -n vllm-playground-dev -- /bin/bash
```

Or if using Kubernetes:

```bash
kubectl exec -it deployment/vllm-playground-dev -n vllm-playground-dev -- /bin/bash
```

### Fix "I have no name!" Issue (If Applicable)

If you see `[I have no name!@...]` prompt, run this command to add your UID to `/etc/passwd`:

```bash
echo "vllm:x:$(id -u):0:vllm user:/home/vllm:/bin/bash" >> /etc/passwd
```

Then verify:

```bash
whoami
# Should output: vllm
```

### Check Available Disk Space

Before starting, verify you have enough space:

```bash
df -h /workspace
```

**Recommended minimum:** 40GB free space
- PyTorch: ~2GB
- vLLM: 2-5GB
- WebUI dependencies: ~1GB
- Models: 5-50GB each

---

## ⚠️ IMPORTANT: Making Installations Persistent

**By default, pip installations with `--user` are NOT persistent across pod restarts!**

### The Problem

When you install packages with `pip3 install --user`, they go to `/home/vllm/.local/` which is ephemeral storage. If your pod restarts, you'll lose:
- ❌ All pip packages (vLLM, PyTorch, FastAPI, etc.)
- ❌ Running processes
- ✅ BUT your models in `/workspace/.cache/huggingface/` are safe (persistent volume)

### The Solution: Use Python venv in Workspace

To make your installations persist across pod restarts, create a Python virtual environment in `/workspace`:

```bash
# Create a virtual environment in the workspace
python3 -m venv /workspace/venv

# Activate it
source /workspace/venv/bin/activate

# Your prompt should now show (venv) at the beginning
# Now all pip installs will go to the persistent venv
```

### Make venv Activation Automatic

Add activation to your shell configuration so it's ready every time:

```bash
# Add to ~/.bashrc
echo 'source /workspace/venv/bin/activate' >> ~/.bashrc

# For current session
source ~/.bashrc
```

### Permanent Setup Script (Optional)

Create a persistent setup script for manual activation:

```bash
cat > /workspace/setup_env.sh << 'EOF'
#!/bin/bash
# Source this file to activate the persistent Python environment
source /workspace/venv/bin/activate
echo "✅ Virtual environment activated from /workspace/venv"
EOF

chmod +x /workspace/setup_env.sh

# To use it manually:
# source /workspace/setup_env.sh
```

### Quick Verification

Check that you're using the venv:

```bash
# Check which Python
which python
# Should show: /workspace/venv/bin/python

# Check where packages are installed
pip show pip | grep Location
# Should show: /workspace/venv/lib/python3.11/site-packages

# After installing vllm, verify it persists
python -c "import vllm; print(f'✅ vLLM {vllm.__version__} from persistent storage')"
```

**Note:** If you've already installed packages to `/home/vllm/.local/`, you'll need to reinstall them in the venv using the commands above.

---

## Quick Start

### For CPU-Only Deployments (Persistent Installation)

```bash
# 1. Create and activate virtual environment
python3 -m venv /workspace/venv
source /workspace/venv/bin/activate

# 2. Upgrade pip
pip install --upgrade pip setuptools wheel

# 3. Install PyTorch and vLLM (CPU version - fastest to install)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install vllm-cpu-only

# 4. Install WebUI dependencies
pip install -r /home/vllm/vllm-playground/requirements.txt

# 5. Verify installation
python -c "import flask, vllm, torch; print('✅ All dependencies installed!')"

# 6. Make venv activation automatic
echo 'source /workspace/venv/bin/activate' >> ~/.bashrc

# 7. Start the application
cd /home/vllm/vllm-playground && python app.py
```

### For GPU Deployments (Persistent Installation)

```bash
# 1. Verify GPU access
nvidia-smi

# 2. Create and activate virtual environment
python3 -m venv /workspace/venv
source /workspace/venv/bin/activate

# 3. Upgrade pip
pip install --upgrade pip setuptools wheel

# 4. Install PyTorch with CUDA support
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121

# 5. Install vLLM with GPU support
pip install vllm

# 6. Verify GPU is accessible to PyTorch
python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}'); print(f'GPU: {torch.cuda.get_device_name(0)}')"

# 7. Install WebUI dependencies
pip install -r /home/vllm/vllm-playground/requirements.txt

# 8. Make venv activation automatic
echo 'source /workspace/venv/bin/activate' >> ~/.bashrc

# 9. Start the application
cd /home/vllm/vllm-playground && python app.py
```

---

## Detailed Installation Steps

### Step 1: Verify Build Tools (Pre-installed)

The ultra-minimal container now includes essential build tools pre-installed:
- `gcc` and `gcc-c++` - C/C++ compilers
- `python3.11-devel` - Python development headers
- `git` - Version control
- `vim` - Text editor

You can verify they're installed:

```bash
gcc --version
python3-config --help
git --version
vim --version
```

**Note:** These tools were installed as root during the container build, so you don't need to install them manually.

---

### Step 2: Create Virtual Environment and Upgrade pip

Always start by creating a virtual environment and upgrading pip:

```bash
# Create virtual environment in persistent storage (IMPORTANT!)
python3 -m venv /workspace/venv

# Activate it
source /workspace/venv/bin/activate

# Your prompt should now show (venv) prefix

# Upgrade pip
pip install --upgrade pip setuptools wheel
```

**Expected output:**
```
Successfully installed pip-XX.X.X setuptools-XX.X.X wheel-X.X.X
```

**Verify:**
```bash
# Check pip version
pip --version
# Should show pip 24.x or newer

# Check which Python is being used
which python
# Should show: /workspace/venv/bin/python

# Verify installation location
pip show pip | grep Location
# Should show: /workspace/venv/lib/python3.11/site-packages
```

**Make it automatic on login:**
```bash
# Add to .bashrc so venv is activated on every login
echo 'source /workspace/venv/bin/activate' >> ~/.bashrc
```

---

### Step 3: Install PyTorch and vLLM

**IMPORTANT:** Install vLLM first before WebUI dependencies. This allows you to verify GPU access and test vLLM functionality before installing the web interface.

Choose the installation method based on your hardware:

#### Option A: CPU Only (Fastest to Install, Works Everywhere)

```bash
# Install PyTorch CPU version (venv must be activated)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Install vLLM CPU-only version
pip install vllm-cpu-only
```

**Pros:**
- Fastest installation (~2-3 minutes)
- Works on any hardware
- Smallest size (~2GB)

**Cons:**
- Slower inference speed
- Limited to smaller models

**Installation time:** 3-5 minutes

---

#### Option B: CUDA GPU (Best Performance)

```bash
# Install PyTorch with CUDA 12.1 support (venv must be activated)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121

# Install vLLM with CUDA support
pip install vllm
```

**Requirements:**
- NVIDIA GPU with CUDA support
- GPU accessible in the pod (requires GPU node and resource allocation)

**Pros:**
- Best performance
- Supports large models
- Fast inference

**Cons:**
- Larger installation size (~5-8GB)
- Requires GPU hardware
- Longer installation time

**Installation time:** 10-20 minutes

**Verify GPU access:**
```bash
nvidia-smi
# Should show your GPU(s)
```

---

#### Option C: ROCm (AMD GPU)

```bash
# Install PyTorch with ROCm 6.1 support (venv must be activated)
pip install torch torchvision --index-url https://download.pytorch.org/whl/rocm6.1

# Install vLLM with ROCm support
pip install vllm
```

**Requirements:**
- AMD GPU with ROCm support
- ROCm drivers installed on the node

**Installation time:** 10-20 minutes

---

### Step 4: Verify vLLM Installation

Before installing WebUI dependencies, verify that vLLM is working correctly:

**For CPU installations:**
```bash
python -c "import vllm; print(f'✅ vLLM version: {vllm.__version__}')"
```

**For GPU installations:**
```bash
# Verify CUDA is available
python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}')"

# Verify GPU details
python -c "import torch; print(f'GPU: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"N/A\"}')"

# Verify vLLM
python -c "import vllm; print(f'✅ vLLM version: {vllm.__version__}')"
```

**Expected output for GPU:**
```
CUDA available: True
GPU: Tesla T4
✅ vLLM version: 0.X.X
```

---

### Step 5: Install WebUI Dependencies

Now that vLLM is installed and working, install the WebUI dependencies:

```bash
pip install -r /home/vllm/vllm-playground/requirements.txt
```

**This will install:**
- Flask and Flask-CORS (web server)
- Gradio (UI components)
- Requests, aiohttp (API calls)
- Pandas, matplotlib (metrics and visualization)
- And other dependencies

**Installation time:** 2-5 minutes

**Verify:**
```bash
python -c "import flask; print(f'✅ Flask version: {flask.__version__}')"
python -c "import gradio; print(f'✅ Gradio version: {gradio.__version__}')"
```

---

For model quantization and compression:

```bash
```

**Use cases:**
**Installation time:** 1-2 minutes

---

## Hardware-Specific Instructions

### For CPU-Only Deployments

```bash
# Complete installation script for CPU (with persistent storage)

# Create and activate virtual environment
python3 -m venv /workspace/venv
source /workspace/venv/bin/activate

# Upgrade pip
pip install --upgrade pip setuptools wheel

# Install vLLM first
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install vllm-cpu-only

# Verify vLLM works
python -c "import vllm, torch; print(f'PyTorch: {torch.__version__}'); print(f'vLLM: {vllm.__version__}'); print(f'Device: {torch.device(\"cpu\")}')"

# Install WebUI dependencies
pip install -r /home/vllm/vllm-playground/requirements.txt

# Verify all dependencies
python -c "import flask, gradio; print('✅ All dependencies installed!')"

# Make venv activation automatic
echo 'source /workspace/venv/bin/activate' >> ~/.bashrc
```

---

### For GPU Deployments

**Step 1: Verify GPU Access**

```bash
nvidia-smi
# Should show your GPU info
```

If `nvidia-smi` fails, your pod doesn't have GPU access. Check your deployment configuration.

**Step 2: Install vLLM with GPU Support (Persistent Storage)**

```bash
# Create and activate virtual environment
python3 -m venv /workspace/venv
source /workspace/venv/bin/activate

# Upgrade pip
pip install --upgrade pip setuptools wheel

# Install PyTorch with CUDA support
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121

# Install vLLM
pip install vllm

# Verify GPU is accessible to PyTorch and vLLM
python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}'); print(f'GPU count: {torch.cuda.device_count()}'); print(f'GPU name: {torch.cuda.get_device_name(0)}')"
python -c "import vllm; print(f'✅ vLLM version: {vllm.__version__}')"

# Make venv activation automatic
echo 'source /workspace/venv/bin/activate' >> ~/.bashrc
```

**Expected output:**
```
CUDA available: True
GPU count: 1 (or more)
GPU name: Tesla T4
✅ vLLM version: 0.X.X
```

**Step 3: Install WebUI Dependencies**

```bash
# Now install the WebUI dependencies (venv must be activated)
pip install -r /home/vllm/vllm-playground/requirements.txt

# Verify all dependencies
python -c "import flask, gradio; print('✅ All dependencies installed!')"
```

---

## Verification

### Verify All Dependencies

Run this comprehensive verification script:

```bash
python << 'EOF'
import sys

def check_import(module_name, display_name=None):
    display_name = display_name or module_name
    try:
        mod = __import__(module_name)
        version = getattr(mod, '__version__', 'unknown')
        print(f"✅ {display_name}: {version}")
        return True
    except ImportError as e:
        print(f"❌ {display_name}: NOT INSTALLED - {e}")
        return False

print("=" * 50)
print("Dependency Verification")
print("=" * 50)

# Core dependencies
check_import('flask', 'Flask')
check_import('gradio', 'Gradio')
check_import('torch', 'PyTorch')
check_import('vllm', 'vLLM')

# Optional dependencies
check_import('requests', 'Requests')
check_import('aiohttp', 'aiohttp')
check_import('pandas', 'Pandas')

# Check PyTorch GPU availability
try:
    import torch
    print(f"\n🖥️  PyTorch Device: {torch.device('cuda' if torch.cuda.is_available() else 'cpu')}")
    if torch.cuda.is_available():
        print(f"🎮 GPU Count: {torch.cuda.device_count()}")
        print(f"🎮 GPU Name: {torch.cuda.get_device_name(0)}")
    else:
        print("💻 Running on CPU")
except Exception as e:
    print(f"⚠️  Error checking PyTorch: {e}")

print("=" * 50)
EOF
```

---

## Starting the Application

### Option 1: Start the WebUI

```bash
cd /home/vllm/vllm-playground
python app.py
```

**Expected output:**
```
Starting vLLM Playground...
Running on: http://0.0.0.0:7860
```

**Access the WebUI:**
- If you have a Route configured: `https://<your-route-url>`
- Otherwise, set up port forwarding:
  ```bash
  oc port-forward deployment/vllm-playground-dev 7860:7860 -n vllm-playground-dev
  ```
  Then access: `http://localhost:7860`

---

### Option 2: Start vLLM Server Directly

For API-only usage:

```bash
vllm serve <model-name> --host 0.0.0.0 --port 8000
```

**Example:**
```bash
vllm serve facebook/opt-125m --host 0.0.0.0 --port 8000
```

**Access the API:**
```bash
curl http://localhost:8000/v1/models
```

---

## Migrating from Non-Persistent to Persistent Installation

If you've already installed packages using `--user` flag (to `/home/vllm/.local/`) or `--prefix`, you'll need to reinstall them in a virtual environment:

### Step 1: Check Current Installation Location

```bash
# Check where vLLM is installed
pip3 show vllm | grep Location

# If it shows: /home/vllm/.local/lib/python3.11/site-packages
# Or: /workspace/.local/lib/python3.11/site-packages
# Then you should migrate to a venv
```

### Step 2: List Currently Installed Packages

```bash
# Save list of installed packages
pip3 freeze > /workspace/installed_packages.txt

# Review what you have
cat /workspace/installed_packages.txt
```

### Step 3: Create Virtual Environment and Reinstall

```bash
# Create virtual environment
python3 -m venv /workspace/venv

# Activate it
source /workspace/venv/bin/activate

# Reinstall everything
pip install -r /workspace/installed_packages.txt

# Or reinstall specific packages
pip install vllm torch torchvision -r /home/vllm/vllm-playground/requirements.txt
```

### Step 4: Verify Migration

```bash
# Check new location
pip show vllm | grep Location
# Should now show: /workspace/venv/lib/python3.11/site-packages

# Check which Python
which python
# Should show: /workspace/venv/bin/python

# Test imports
python -c "import vllm, torch; print('✅ Migration successful')"
```

### Step 5: Make venv Automatic

```bash
# Add to .bashrc for automatic activation
echo 'source /workspace/venv/bin/activate' >> ~/.bashrc
```

### Step 6: Clean Up Old Installation (Optional)

```bash
# After verifying everything works, you can remove the old installations
rm -rf /home/vllm/.local
rm -rf /workspace/.local  # If you used --prefix before
```

---

## Finding Running Processes in Minimal Containers

If you've started your app and lost track of the process, here are methods that work in minimal containers:

### Method 1: Using /proc Filesystem

```bash
# Find Python processes
for pid in /proc/[0-9]*; do
  if [ -f "$pid/cmdline" ]; then
    cmdline=$(cat "$pid/cmdline" 2>/dev/null | tr '\0' ' ')
    if echo "$cmdline" | grep -q "python\|app.py\|uvicorn"; then
      echo "PID: $(basename $pid)"
      echo "Command: $cmdline"
      echo "---"
    fi
  fi
done
```

### Method 2: Check Specific Ports

```bash
# Check what's listening on port 7860 (WebUI)
grep -l ":1EB4" /proc/[0-9]*/net/tcp 2>/dev/null | while read f; do
  pid=$(echo $f | cut -d/ -f3)
  echo "Process on port 7860: PID $pid"
  cat /proc/$pid/cmdline | tr '\0' ' '
  echo
done

# Note: 1EB4 is hexadecimal for 7860
# For port 8000 (vLLM API), use: 1F40
```

### Method 3: Simple Grep Process List

If you have basic `ps` command:

```bash
# Try this first
ps aux 2>/dev/null | grep python

# Or if ps aux doesn't work
ps -ef 2>/dev/null | grep python
```

### Killing a Process Without Full Tools

```bash
# Once you have the PID
kill <PID>

# If that doesn't work, force kill
kill -9 <PID>

# Verify it's gone
ls -la /proc/<PID> 2>/dev/null || echo "Process terminated"
```

### Viewing Process Logs

```bash
# View stdout/stderr of a running process
tail -f /proc/<PID>/fd/1  # stdout
tail -f /proc/<PID>/fd/2  # stderr

# View working directory
ls -l /proc/<PID>/cwd
```

---

## Troubleshooting

### Issue: Permission Denied for microdnf

**Solution:**
Skip Step 1 and proceed with pip installations. Most packages have pre-compiled wheels.

---

### Issue: "I have no name!" in Shell Prompt

**Solution:**
```bash
echo "vllm:x:$(id -u):0:vllm user:/home/vllm:/bin/bash" >> /etc/passwd
```

Exit and re-enter the pod for changes to take effect.

---

### Issue: Cannot Write to /etc/passwd

**Solution:**
Check if you have write permissions:
```bash
ls -la /etc/passwd
```

If not writable, contact your cluster administrator to ensure the container is properly configured for OpenShift arbitrary UIDs.

---

### Issue: Disk Space Full During Installation

**Check disk usage:**
```bash
df -h /workspace
du -sh /workspace/.cache
```

**Clean up cache:**
```bash
# Clear pip cache
pip cache purge

# Remove HuggingFace cache (if you have old models)
rm -rf /workspace/.cache/huggingface/hub/*
```

---

### Issue: Installation is Very Slow

**Causes:**
- Slow network connection
- Large package sizes (PyTorch is ~2GB)
- Disk I/O limitations

**Solutions:**
- Use `--no-cache-dir` flag for pip
- Install CPU version first (smaller), then upgrade to GPU if needed
- Check network connectivity: `ping google.com`

---

### Issue: Import Errors After Installation

**Verify venv is activated:**
```bash
# Check if venv is active (should show venv in prompt)
which python
# Should show: /workspace/venv/bin/python

# If not activated, activate it
source /workspace/venv/bin/activate
```

**If still having issues, reinstall the package:**
```bash
pip uninstall <package-name>
pip install <package-name> --force-reinstall
```

---

### Issue: CUDA Not Available After Installation

**Check GPU access:**
```bash
nvidia-smi
```

If this fails, your pod doesn't have GPU access. Update your deployment to request GPU resources.

**Example deployment snippet:**
```yaml
resources:
  limits:
    nvidia.com/gpu: 1
```

---

## Disk Space Management

### Check Disk Usage

```bash
# Overall disk usage
df -h

# Workspace usage
du -sh /workspace

# Cache directory
du -sh /workspace/.cache/huggingface/hub

# List all models and their sizes
du -sh /workspace/.cache/huggingface/hub/*
```

---

### Clean Up Space

```bash
# Clear pip cache
pip cache purge

# Remove specific model
rm -rf /workspace/.cache/huggingface/hub/models--<org>--<model-name>

# Clean up old Python packages
pip uninstall <old-package>
```

---

## Next Steps

### 1. Download a Model

```bash
python << 'EOF'
from transformers import AutoTokenizer, AutoModelForCausalLM

model_name = "facebook/opt-125m"  # Start with small model
print(f"Downloading {model_name}...")
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForCausalLM.from_pretrained(model_name)
print("✅ Model downloaded successfully!")
print(f"📁 Cached in: /workspace/.cache/huggingface/hub/")
EOF
```

---

### 2. Test vLLM Server

```bash
# Start server in background
vllm serve facebook/opt-125m --host 0.0.0.0 --port 8000 &

# Wait a few seconds for startup
sleep 10

# Test the API
curl http://localhost:8000/v1/models
```

---

### 3. Use the WebUI

```bash
cd /home/vllm/vllm-playground
python app.py
```

Navigate to the exposed route URL and start using the playground!

---

```bash
python << 'EOF'
from transformers import AutoTokenizer

# For model quantization and compression, see:
# https://github.com/micytao/llmcompressor-playground

EOF
```

---

## Additional Resources

- **vLLM Documentation:** https://docs.vllm.ai/
- **HuggingFace Models:** https://huggingface.co/models
- **LLMCompressor Playground:** https://github.com/micytao/llmcompressor-playground (for model compression)

## Summary of Installation Commands

### Minimal CPU Installation (Fastest) - WITH PERSISTENT STORAGE

```bash
# Create and activate virtual environment
python3 -m venv /workspace/venv
source /workspace/venv/bin/activate

# Upgrade pip
pip install --upgrade pip setuptools wheel

# Install vLLM first
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install vllm-cpu-only

# Verify vLLM
python -c "import vllm; print('✅ vLLM installed')"

# Install WebUI dependencies
pip install -r /home/vllm/vllm-playground/requirements.txt

# Make venv activation automatic across pod restarts
echo 'source /workspace/venv/bin/activate' >> ~/.bashrc
```

### Full GPU Installation - WITH PERSISTENT STORAGE

```bash
# Verify GPU access
nvidia-smi

# Create and activate virtual environment
python3 -m venv /workspace/venv
source /workspace/venv/bin/activate

# Upgrade pip
pip install --upgrade pip setuptools wheel

# Install vLLM with GPU support first
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
pip install vllm

# Verify GPU is accessible
python -c "import torch; print(f'CUDA: {torch.cuda.is_available()}')"

# Install WebUI dependencies
pip install -r /home/vllm/vllm-playground/requirements.txt


# Make venv activation automatic across pod restarts
echo 'source /workspace/venv/bin/activate' >> ~/.bashrc
```

---

## Getting Help

If you encounter issues not covered in this guide:

1. Check the logs: `python app.py 2>&1 | tee app.log`
2. Review troubleshooting docs: `docs/TROUBLESHOOTING.md`
3. Check vLLM documentation: https://docs.vllm.ai/
4. Open an issue in the repository

---

**Happy model serving with vLLM Playground!** 🚀
