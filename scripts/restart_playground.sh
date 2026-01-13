#!/bin/bash
# Restart script for vLLM Playground
# Automatically kills any existing instances and starts fresh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "============================================================"
echo "🔄 vLLM Playground - Restart Script"
echo "============================================================"
echo ""

# Try to kill existing instances
if [ -f "$WORKSPACE_ROOT/scripts/kill_playground.py" ]; then
    echo "🔍 Checking for existing processes..."
    cd "$WORKSPACE_ROOT"
    python3 scripts/kill_playground.py || true
    echo ""
fi

# Wait a moment for port to be released
sleep 2

# Start fresh instance
echo "🚀 Starting fresh instance..."
cd "$WORKSPACE_ROOT"
exec python3 run.py
