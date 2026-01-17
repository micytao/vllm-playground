#!/usr/bin/env python3
"""
vLLM Playground - Setup Verification Script
Checks if everything is properly configured
"""

import sys
import subprocess
from pathlib import Path


def print_header(text):
    print(f"\n{'=' * 60}")
    print(f"  {text}")
    print(f"{'=' * 60}\n")


def check_python_version():
    """Check Python version"""
    version = sys.version_info
    if version.major >= 3 and version.minor >= 8:
        print(f"✅ Python version: {version.major}.{version.minor}.{version.micro}")
        return True
    else:
        print(f"❌ Python version: {version.major}.{version.minor}.{version.micro} (need 3.8+)")
        return False


def check_package(package_name, import_name=None):
    """Check if a Python package is installed"""
    if import_name is None:
        import_name = package_name

    try:
        __import__(import_name)
        print(f"✅ {package_name} is installed")
        return True
    except ImportError:
        print(f"❌ {package_name} is NOT installed")
        return False


def check_vllm():
    """Check if vLLM is installed"""
    try:
        import vllm

        print(f"✅ vLLM is installed (version: {vllm.__version__})")
        return True
    except ImportError:
        print(f"⚠️  vLLM is NOT installed (required for running models)")
        print("    Install with: pip install vllm")
        return False
    except AttributeError:
        print(f"✅ vLLM is installed (version unknown)")
        return True


def check_cuda():
    """Check CUDA availability"""
    try:
        import torch

        if torch.cuda.is_available():
            count = torch.cuda.device_count()
            device = torch.cuda.get_device_name(0)
            print(f"✅ CUDA is available")
            print(f"   - {count} GPU(s) detected")
            print(f"   - Primary GPU: {device}")
            return True
        else:
            print(f"⚠️  CUDA is NOT available (GPU required for vLLM)")
            return False
    except ImportError:
        print(f"⚠️  PyTorch not installed (cannot check CUDA)")
        return False


def check_files():
    """Check if all necessary files exist"""
    required_files = [
        "app.py",
        "index.html",
        "requirements.txt",
        "static/css/style.css",
        "static/js/app.js",
    ]

    all_exist = True
    for file in required_files:
        path = Path(file)
        if path.exists():
            print(f"✅ {file}")
        else:
            print(f"❌ {file} is MISSING")
            all_exist = False

    return all_exist


def main():
    print_header("🔍 vLLM Playground Setup Verification")

    results = []

    # Check Python version
    print_header("Python Version Check")
    results.append(check_python_version())

    # Check required packages
    print_header("Required Packages Check")
    results.append(check_package("fastapi"))
    results.append(check_package("uvicorn"))
    results.append(check_package("websockets"))
    results.append(check_package("aiohttp"))
    results.append(check_package("pydantic"))

    # Check vLLM
    print_header("vLLM Installation Check")
    vllm_installed = check_vllm()

    # Check CUDA (optional but recommended)
    print_header("CUDA/GPU Check")
    cuda_available = check_cuda()

    # Check files
    print_header("File Structure Check")
    results.append(check_files())

    # Summary
    print_header("📊 Summary")

    if all(results):
        print("✅ All checks passed! WebUI is ready to run.")
        print("\n🚀 To start the WebUI:")
        print("   ./start.sh")
        print("   or")
        print("   python3 run.py")
        print("\n🌐 Then open: http://localhost:7860")

        if not vllm_installed:
            print("\n⚠️  Note: vLLM is not installed.")
            print("   Install it to actually run models:")
            print("   pip install vllm")

        if not cuda_available:
            print("\n⚠️  Note: CUDA is not available.")
            print("   A GPU is required to run vLLM models.")

        return 0
    else:
        print("❌ Some checks failed. Please fix the issues above.")
        print("\n📦 To install missing packages:")
        print("   pip install -r requirements.txt")
        return 1


if __name__ == "__main__":
    sys.exit(main())
