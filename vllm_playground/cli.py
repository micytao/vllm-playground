#!/usr/bin/env python3
"""
CLI entry point for vLLM Playground
"""
import argparse
import sys
import os
import signal
import atexit
from pathlib import Path
from typing import Optional

import psutil


def get_pid_file() -> Path:
    """Get the PID file path"""
    # Use user's home directory for PID file
    return Path.home() / ".vllm_playground.pid"


def find_process_by_port(port: int = 7860) -> Optional[psutil.Process]:
    """Find process using a specific port"""
    try:
        for conn in psutil.net_connections(kind='inet'):
            if conn.laddr.port == port and conn.status == 'LISTEN':
                try:
                    return psutil.Process(conn.pid)
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
    except (psutil.AccessDenied, AttributeError):
        pass
    return None


def get_existing_process(port: int = 7860) -> Optional[psutil.Process]:
    """Check if a process is already running"""
    pid_file = get_pid_file()
    
    # First, try PID file method
    if pid_file.exists():
        try:
            with open(pid_file, 'r') as f:
                pid = int(f.read().strip())
            
            if psutil.pid_exists(pid):
                proc = psutil.Process(pid)
                cmdline = ' '.join(proc.cmdline())
                if 'vllm-playground' in cmdline or 'vllm_playground' in cmdline:
                    return proc
        except (ValueError, psutil.NoSuchProcess, psutil.AccessDenied):
            pass
        
        pid_file.unlink(missing_ok=True)
    
    # Fallback: check if port is in use
    port_proc = find_process_by_port(port)
    if port_proc:
        try:
            cmdline = ' '.join(port_proc.cmdline())
            if 'python' in cmdline.lower() and 'vllm' in cmdline.lower():
                return port_proc
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    
    return None


def kill_existing_process(proc: psutil.Process) -> bool:
    """Kill an existing process"""
    try:
        print(f"Terminating existing process (PID: {proc.pid})...")
        proc.terminate()
        
        try:
            proc.wait(timeout=5)
            print("✅ Process terminated successfully")
            return True
        except psutil.TimeoutExpired:
            print("⚠️  Process didn't terminate gracefully, forcing kill...")
            proc.kill()
            proc.wait(timeout=3)
            print("✅ Process killed")
            return True
    except psutil.NoSuchProcess:
        print("✅ Process already terminated")
        return True
    except Exception as e:
        print(f"❌ Error killing process: {e}")
        return False


def write_pid_file():
    """Write current process PID to file"""
    with open(get_pid_file(), 'w') as f:
        f.write(str(os.getpid()))


def cleanup_pid_file():
    """Remove PID file on exit"""
    get_pid_file().unlink(missing_ok=True)


def signal_handler(signum, frame):
    """Handle termination signals"""
    print(f"\n🛑 Received signal {signum}, shutting down...")
    cleanup_pid_file()
    sys.exit(0)


def main():
    """Main CLI entry point"""
    parser = argparse.ArgumentParser(
        prog='vllm-playground',
        description='vLLM Playground - A web interface for managing and interacting with vLLM',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  vllm-playground                    # Start with defaults (http://0.0.0.0:7860)
  vllm-playground --port 8080        # Use custom port
  vllm-playground --host localhost   # Bind to localhost only
  vllm-playground pull               # Pre-download GPU container image (~10GB)
  vllm-playground pull --cpu         # Pre-download CPU container image
  vllm-playground pull --all         # Pre-download all container images
  vllm-playground stop               # Stop running instance
  vllm-playground status             # Check if running
        """
    )
    
    parser.add_argument(
        '--version', '-v',
        action='version',
        version=f'%(prog)s {get_version()}'
    )
    
    subparsers = parser.add_subparsers(dest='command', help='Commands')
    
    # Start command (default)
    start_parser = subparsers.add_parser('start', help='Start the playground (default)')
    start_parser.add_argument('--host', default='0.0.0.0', help='Host to bind to (default: 0.0.0.0)')
    start_parser.add_argument('--port', '-p', type=int, default=7860, help='Port to listen on (default: 7860)')
    start_parser.add_argument('--reload', '-r', action='store_true', help='Enable auto-reload for development')
    
    # Stop command
    subparsers.add_parser('stop', help='Stop running playground instance')
    
    # Status command
    subparsers.add_parser('status', help='Check if playground is running')
    
    # Pull command - pre-download container images
    pull_parser = subparsers.add_parser('pull', help='Pre-download vLLM container images (recommended for first run)')
    pull_parser.add_argument('--nvidia', action='store_true', help='Pull NVIDIA CUDA GPU image (default)')
    pull_parser.add_argument('--amd', action='store_true', help='Pull AMD ROCm GPU image')
    pull_parser.add_argument('--tpu', action='store_true', help='Pull Google Cloud TPU image')
    pull_parser.add_argument('--cpu', action='store_true', help='Pull CPU image')
    pull_parser.add_argument('--all', action='store_true', help='Pull all images (CPU + NVIDIA + AMD + TPU)')
    # Keep --gpu as alias for --nvidia for backward compatibility
    pull_parser.add_argument('--gpu', action='store_true', help=argparse.SUPPRESS)
    
    # Also add these options to the main parser for convenience
    parser.add_argument('--host', default='0.0.0.0', help='Host to bind to (default: 0.0.0.0)')
    parser.add_argument('--port', '-p', type=int, default=7860, help='Port to listen on (default: 7860)')
    parser.add_argument('--reload', '-r', action='store_true', help='Enable auto-reload for development')
    
    args = parser.parse_args()
    
    # Handle commands
    if args.command == 'stop':
        return cmd_stop(args)
    elif args.command == 'status':
        return cmd_status(args)
    elif args.command == 'pull':
        return cmd_pull(args)
    else:
        # Default: start
        return cmd_start(args)


def get_version() -> str:
    """Get package version"""
    try:
        from . import __version__
        return __version__
    except ImportError:
        return "unknown"


def cmd_start(args):
    """Start the playground"""
    port = getattr(args, 'port', 7860)
    host = getattr(args, 'host', '0.0.0.0')
    reload = getattr(args, 'reload', False)
    
    # Check for existing process
    existing_proc = get_existing_process(port)
    if existing_proc:
        print("=" * 60)
        print("⚠️  WARNING: vLLM Playground is already running!")
        print("=" * 60)
        print(f"\nExisting process details:")
        print(f"  PID: {existing_proc.pid}")
        
        print("\n🔄 Automatically stopping the existing process...")
        if kill_existing_process(existing_proc):
            print("✅ Ready to start new instance\n")
        else:
            print(f"❌ Failed to stop existing process. Please manually kill PID {existing_proc.pid}")
            return 1
    
    # Register cleanup handlers
    atexit.register(cleanup_pid_file)
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    
    # Write PID file
    write_pid_file()
    
    print("=" * 60)
    print("🚀 vLLM Playground - Starting...")
    print("=" * 60)
    print("\nFeatures:")
    print("  ⚙️  Configure vLLM servers")
    print("  💬 Chat with your models")
    print("  📋 Real-time log streaming")
    print("  🎛️  Full server control")
    print(f"\nAccess the Playground at: http://{host}:{port}")
    print("Press Ctrl+C to stop\n")
    print(f"Process ID: {os.getpid()}")
    print("=" * 60)
    
    try:
        from .app import main as app_main
        app_main(host=host, port=port, reload=reload)
    except KeyboardInterrupt:
        print("\n🛑 Interrupted by user")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        return 1
    finally:
        cleanup_pid_file()
    
    return 0


def cmd_stop(args):
    """Stop the playground"""
    proc = get_existing_process()
    if proc:
        if kill_existing_process(proc):
            return 0
        return 1
    else:
        print("ℹ️  No running vLLM Playground instance found")
        return 0


def cmd_status(args):
    """Check status"""
    proc = get_existing_process()
    if proc:
        print("✅ vLLM Playground is running")
        print(f"  PID: {proc.pid}")
        try:
            print(f"  Status: {proc.status()}")
        except:
            pass
        return 0
    else:
        print("❌ vLLM Playground is not running")
        return 1


def cmd_pull(args):
    """Pre-download vLLM container images"""
    import subprocess
    
    # Determine which images to pull
    # --gpu is alias for --nvidia for backward compatibility
    pull_nvidia = args.nvidia or args.gpu or args.all or (not args.cpu and not args.amd and not args.tpu and not args.all)  # Default to NVIDIA
    pull_amd = args.amd or args.all
    pull_tpu = args.tpu or args.all
    pull_cpu = args.cpu or args.all
    
    # Image definitions (must match container_manager.py)
    # Note: v0.12.0+ required for Anthropic Messages API (Claude Code support)
    NVIDIA_IMAGE = "docker.io/vllm/vllm-openai:v0.12.0"
    AMD_IMAGE = "docker.io/rocm/vllm:latest"
    TPU_IMAGE = "docker.io/vllm/vllm-tpu:latest"
    CPU_IMAGE_MACOS = "quay.io/rh_ee_micyang/vllm-mac:v0.11.0"
    CPU_IMAGE_X86 = "quay.io/rh_ee_micyang/vllm-cpu:v0.11.0"
    
    # Detect platform for CPU image
    import platform
    system = platform.system()
    machine = platform.machine()
    if system == "Darwin" or machine in ("arm64", "aarch64"):
        cpu_image = CPU_IMAGE_MACOS
    else:
        cpu_image = CPU_IMAGE_X86
    
    # Detect container runtime
    runtime = "podman"
    try:
        subprocess.run(["podman", "--version"], capture_output=True, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        try:
            subprocess.run(["docker", "--version"], capture_output=True, check=True)
            runtime = "docker"
        except (FileNotFoundError, subprocess.CalledProcessError):
            print("❌ Neither Podman nor Docker found. Please install a container runtime.")
            return 1
    
    print(f"🐳 Using container runtime: {runtime}")
    print()
    
    success = True
    
    if pull_nvidia:
        print("=" * 60)
        print(f"📥 Pulling NVIDIA CUDA GPU image: {NVIDIA_IMAGE}")
        print("⏳ This may take 10-20 minutes for the first download (~10GB)...")
        print("=" * 60)
        try:
            # Use sudo for GPU image pull (needed for GPU access later)
            cmd = ["sudo", "-n", runtime, "pull", NVIDIA_IMAGE] if runtime == "podman" else [runtime, "pull", NVIDIA_IMAGE]
            result = subprocess.run(cmd, check=False)
            if result.returncode == 0:
                print(f"✅ NVIDIA GPU image pulled successfully!")
            else:
                # Try without sudo
                result = subprocess.run([runtime, "pull", NVIDIA_IMAGE], check=False)
                if result.returncode == 0:
                    print(f"✅ NVIDIA GPU image pulled successfully!")
                else:
                    print(f"❌ Failed to pull NVIDIA GPU image")
                    success = False
        except Exception as e:
            print(f"❌ Error pulling NVIDIA GPU image: {e}")
            success = False
        print()
    
    if pull_amd:
        print("=" * 60)
        print(f"📥 Pulling AMD ROCm GPU image: {AMD_IMAGE}")
        print("⏳ This may take 10-20 minutes for the first download...")
        print("=" * 60)
        try:
            # Use sudo for GPU image pull (needed for GPU access later)
            cmd = ["sudo", "-n", runtime, "pull", AMD_IMAGE] if runtime == "podman" else [runtime, "pull", AMD_IMAGE]
            result = subprocess.run(cmd, check=False)
            if result.returncode == 0:
                print(f"✅ AMD ROCm GPU image pulled successfully!")
            else:
                # Try without sudo
                result = subprocess.run([runtime, "pull", AMD_IMAGE], check=False)
                if result.returncode == 0:
                    print(f"✅ AMD ROCm GPU image pulled successfully!")
                else:
                    print(f"❌ Failed to pull AMD ROCm GPU image")
                    success = False
        except Exception as e:
            print(f"❌ Error pulling AMD ROCm GPU image: {e}")
            success = False
        print()
    
    if pull_tpu:
        print("=" * 60)
        print(f"📥 Pulling Google Cloud TPU image: {TPU_IMAGE}")
        print("⏳ This may take 10-20 minutes for the first download...")
        print("   Note: TPU image only works on Google Cloud TPU VMs")
        print("=" * 60)
        try:
            # Use sudo for image pull
            cmd = ["sudo", "-n", runtime, "pull", TPU_IMAGE] if runtime == "podman" else [runtime, "pull", TPU_IMAGE]
            result = subprocess.run(cmd, check=False)
            if result.returncode == 0:
                print(f"✅ Google Cloud TPU image pulled successfully!")
            else:
                # Try without sudo
                result = subprocess.run([runtime, "pull", TPU_IMAGE], check=False)
                if result.returncode == 0:
                    print(f"✅ Google Cloud TPU image pulled successfully!")
                else:
                    print(f"❌ Failed to pull Google Cloud TPU image")
                    success = False
        except Exception as e:
            print(f"❌ Error pulling Google Cloud TPU image: {e}")
            success = False
        print()
    
    if pull_cpu:
        print("=" * 60)
        print(f"📥 Pulling CPU image: {cpu_image}")
        print("⏳ This may take a few minutes...")
        print("=" * 60)
        try:
            result = subprocess.run([runtime, "pull", cpu_image], check=False)
            if result.returncode == 0:
                print(f"✅ CPU image pulled successfully!")
            else:
                print(f"❌ Failed to pull CPU image")
                success = False
        except Exception as e:
            print(f"❌ Error pulling CPU image: {e}")
            success = False
        print()
    
    if success:
        print("=" * 60)
        print("🎉 All images ready! You can now run: vllm-playground")
        print("=" * 60)
        return 0
    else:
        print("⚠️  Some images failed to pull. Check the errors above.")
        return 1


if __name__ == "__main__":
    sys.exit(main())

