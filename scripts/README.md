# vLLM Playground Scripts

This directory contains utility scripts for managing the vLLM Playground.

## Process Management Scripts

### restart_playground.sh ⭐ RECOMMENDED

**The easiest way to handle "address already in use" errors in containers!**

Automatically kills any existing instances and starts fresh.

**Usage:**
```bash
./scripts/restart_playground.sh
# or
bash scripts/restart_playground.sh
```

**What it does:**
1. Searches for and kills any running vLLM Playground processes
2. Waits for port to be released
3. Starts a fresh instance automatically

**When to use:**
- **In containers after losing connection** (most common use case)
- When you get "address already in use" errors
- Anytime you want a clean restart without multiple commands

### kill_playground.py

Manually kill any running vLLM Playground instances without starting a new one.

**Usage:**
```bash
python scripts/kill_playground.py
# or
./scripts/kill_playground.py
```

**What it does:**
- Searches for running vLLM Playground processes (by PID file and port 7860)
- Attempts graceful termination first (SIGTERM)
- Forces kill if graceful termination fails (SIGKILL)
- Cleans up PID files

**When to use:**
- When you only want to stop (not restart) the playground
- When you want to ensure no other instances are running
- When the automatic process management in `run.py` fails

## Setup Scripts

### install.sh

Install dependencies and set up the environment.

**Usage:**
```bash
./scripts/install.sh
```

### start.sh

Start the vLLM Playground (alternative to `run.py`).

**Usage:**
```bash
./scripts/start.sh
```

### verify_setup.py

Verify that the installation and setup are correct.

**Usage:**
```bash
python scripts/verify_setup.py
```

## Package Sync Scripts

### sync_to_package.py ⭐ IMPORTANT FOR MAINTAINERS

Syncs files from the root directory to the `vllm_playground/` package directory for PyPI distribution.

**Why this exists:**
- The project maintains TWO copies of the code:
  - **Root** (`app.py`, etc.): For users who clone and run directly
  - **Package** (`vllm_playground/`): For PyPI installation (`pip install vllm-playground`)
- The package version requires different imports (relative imports like `from .container_manager`)

**Usage:**
```bash
# Preview what would be synced (recommended first)
python3 scripts/sync_to_package.py --dry-run

# Actually sync the files
python3 scripts/sync_to_package.py

# Verbose output
python3 scripts/sync_to_package.py --verbose
```

**What it syncs:**
| Source | Destination | Transform |
|--------|-------------|-----------|
| `app.py` | `vllm_playground/app.py` | ✅ Fixes imports for package |
| `container_manager.py` | `vllm_playground/container_manager.py` | Direct copy |
| `index.html` | `vllm_playground/index.html` | Direct copy |
| `static/` | `vllm_playground/static/` | Direct copy |
| `assets/` | `vllm_playground/assets/` | Direct copy |
| `config/` | `vllm_playground/config/` | Direct copy |
| `recipes/` | `vllm_playground/recipes/` | Direct copy |

**When to run:**
- After making changes to any root files
- Before building a new PyPI package version
- Run: `python3 scripts/sync_to_package.py && python -m build`

---

## CPU-Specific Scripts

### run_cpu.sh

Run vLLM Playground optimized for CPU-only environments.

**Usage:**
```bash
./scripts/run_cpu.sh
```

## Process Management Features

The main `run.py` launcher includes automatic process management:

1. **PID File**: Creates `.vllm_playground.pid` to track the running process
2. **Automatic Detection**: Detects if another instance is already running (via PID file)
3. **Port-Based Fallback**: If PID file detection fails, finds processes using port 7860
4. **Auto-Kill**: Automatically terminates existing instances before starting
5. **Cleanup**: Removes PID files on exit (normal or interrupted)
6. **Signal Handling**: Properly handles SIGTERM and SIGINT (Ctrl+C)

### How It Works

When you start `run.py`:
1. Checks for existing PID file
2. Verifies if the process is still running
3. If PID file method fails, checks port 7860 for processes
4. If found, automatically terminates the old instance
5. Starts the new instance
6. Creates a new PID file with current process ID

When you stop with Ctrl+C or kill the process:
1. Signal handler catches the termination
2. Cleans up the PID file
3. Exits gracefully

### Troubleshooting

**Problem: "Address already in use" (port 7860)**
- **Quick Fix**: Just rerun `python run.py` - it will auto-detect and kill the old process
- **Easier Fix**: Use `./scripts/restart_playground.sh` (recommended for containers)
- **Manual Fix**: Use `python scripts/kill_playground.py`

**Problem: "Process could not be terminated"**
- Solution: Use `kill_playground.py` to forcefully kill all instances
- Last resort: `lsof -i :7860` to find PID, then `kill -9 <PID>`

**Problem: PID file exists but process is dead**
- The script automatically cleans up stale PID files
- No action needed

**Problem: Multiple instances running**
- Run `kill_playground.py` to terminate all instances
- Then start fresh with `run.py`

**Problem: Lost connection to container**
- Use `./scripts/restart_playground.sh` for one-command restart
- Or just rerun `python run.py` - auto-detection will handle it

## Additional Information

For more details on using the vLLM Playground, see:
- [Main README](../README.md)
- [Quick Start Guide](../docs/QUICKSTART.md)
- [Troubleshooting Guide](../docs/TROUBLESHOOTING.md)
