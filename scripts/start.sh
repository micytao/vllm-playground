#!/bin/bash
# Quick start script for vLLM Playground

echo "🚀 Starting vLLM Playground..."
echo ""

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is required but not found."
    exit 1
fi

# Check if requirements are installed
if ! python3 -c "import fastapi" &> /dev/null; then
    echo "📦 Installing dependencies..."
    pip install -r requirements.txt
    echo ""
fi

# Start the WebUI
echo "✅ Starting server..."
python3 run.py
