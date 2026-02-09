#!/bin/bash
# Generate Xcode project from project.yml using XcodeGen.
#
# Prerequisites:
#   brew install xcodegen
#
# Usage:
#   cd ios/vllm-playground
#   ./generate_project.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v xcodegen &> /dev/null; then
    echo "Error: xcodegen is not installed."
    echo "Install it with: brew install xcodegen"
    exit 1
fi

echo "Generating Xcode project..."
xcodegen generate

echo ""
echo "Done! Open the project with:"
echo "  open vllm-playground.xcodeproj"
