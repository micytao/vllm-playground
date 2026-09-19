#!/usr/bin/env python3
"""
Kill script for vLLM Playground
Use this to manually stop a running vLLM Playground instance
"""

import sys
from pathlib import Path

import psutil

# PID file location - must match run.py
# Both scripts should reference the same workspace root
WORKSPACE_ROOT = Path(__file__).parent.parent
PID_FILE = WORKSPACE_ROOT / ".vllm_playground.pid"


def find_process_by_port(port: int = 7860):
    """Find process using a specific port"""
    try:
        for conn in psutil.net_connections(kind="inet"):
            if conn.laddr.port == port and conn.status == "LISTEN":
                try:
                    proc = psutil.Process(conn.pid)
                    return proc
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
    except (psutil.AccessDenied, AttributeError):
        # Some systems require elevated privileges for net_connections
        pass
    return None


def find_playground_processes():
    """Find all vLLM Playground processes"""
    processes = []
    pids_seen = set()

    # Method 1: Search by command line
    for proc in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            cmdline = " ".join(proc.info["cmdline"] or [])
            if (
                "run.py" in cmdline
                or "app.py" in cmdline
                or ("vllm-playground" in cmdline and "python" in proc.info["name"].lower())
            ):
                if proc.pid not in pids_seen:
                    processes.append(proc)
                    pids_seen.add(proc.pid)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass

    # Method 2: Check port 7860
    port_proc = find_process_by_port(7860)
    if port_proc and port_proc.pid not in pids_seen:
        try:
            cmdline = " ".join(port_proc.cmdline())
            if "python" in cmdline.lower():
                processes.append(port_proc)
                pids_seen.add(port_proc.pid)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass

    return processes


def kill_process(proc):
    """Kill a process"""
    try:
        print(f"Terminating process {proc.pid}...")
        proc.terminate()

        # Wait up to 5 seconds for graceful termination
        try:
            proc.wait(timeout=5)
            print(f"✅ Process {proc.pid} terminated successfully")
            return True
        except psutil.TimeoutExpired:
            print(f"⚠️  Process {proc.pid} didn't terminate gracefully, forcing kill...")
            proc.kill()
            proc.wait(timeout=3)
            print(f"✅ Process {proc.pid} killed")
            return True
    except psutil.NoSuchProcess:
        print(f"✅ Process {proc.pid} already terminated")
        return True
    except Exception as e:
        print(f"❌ Error killing process {proc.pid}: {e}")
        return False


def main():
    print("=" * 60)
    print("🔪 vLLM Playground - Kill Script")
    print("=" * 60)

    # Check PID file first
    if PID_FILE.exists():
        try:
            with open(PID_FILE, "r") as f:
                pid = int(f.read().strip())

            if psutil.pid_exists(pid):
                proc = psutil.Process(pid)
                print("\n📋 Found process from PID file:")
                print(f"   PID: {pid}")
                print(f"   Status: {proc.status()}")

                if kill_process(proc):
                    PID_FILE.unlink(missing_ok=True)
                    print("\n✅ Cleaned up PID file")
                    print("\n✅ All done!")
                    return 0
            else:
                print(f"\n⚠️  PID file exists but process {pid} is not running")
                PID_FILE.unlink(missing_ok=True)
                print("✅ Cleaned up stale PID file")
        except Exception as e:
            print(f"\n⚠️  Error reading PID file: {e}")

    # Search for all vLLM Playground processes
    print("\n🔍 Searching for vLLM Playground processes...")
    processes = find_playground_processes()

    if not processes:
        print("\n✅ No vLLM Playground processes found")
        return 0

    print(f"\n📋 Found {len(processes)} process(es):")
    for proc in processes:
        print(f"   PID: {proc.pid}")

    print("\n🔄 Killing processes...")
    success = True
    for proc in processes:
        if not kill_process(proc):
            success = False

    # Clean up PID file
    if PID_FILE.exists():
        PID_FILE.unlink(missing_ok=True)
        print("\n✅ Cleaned up PID file")

    if success:
        print("\n✅ All processes terminated successfully!")
        return 0
    else:
        print("\n⚠️  Some processes could not be terminated")
        return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n\n🛑 Interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        sys.exit(1)
