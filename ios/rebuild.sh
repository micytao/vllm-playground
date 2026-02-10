#!/bin/bash
# rebuild.sh - Clean rebuild for vllm-playground iOS app
# Prevents the "Application failed preflight checks" simulator error
#
# Usage:
#   ./rebuild.sh          # Regenerate project + clean build
#   ./rebuild.sh --reset  # Also erase all simulators (nuclear option)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/vllm-playground"
SCHEME="vllm-playground"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo -e "${GREEN}=== vllm-playground iOS Rebuild ===${NC}"
echo ""

# Step 0: Nuclear option - reset simulators
if [[ "$1" == "--reset" ]]; then
    echo -e "${YELLOW}[1/5] Resetting all simulators...${NC}"
    xcrun simctl shutdown all 2>/dev/null || true
    xcrun simctl erase all 2>/dev/null || true
    echo "       Simulators erased."
else
    echo -e "${YELLOW}[1/5] Skipping simulator reset (use --reset to erase simulators)${NC}"
fi

# Step 1: Clear DerivedData for this project
echo -e "${YELLOW}[2/5] Clearing DerivedData...${NC}"
DERIVED_DATA_DIR=$(find ~/Library/Developer/Xcode/DerivedData -maxdepth 1 -name "vllm-playground-*" -type d 2>/dev/null)
if [ -n "$DERIVED_DATA_DIR" ]; then
    rm -rf "$DERIVED_DATA_DIR"
    echo "       Removed: $(basename "$DERIVED_DATA_DIR")"
else
    echo "       No DerivedData found (already clean)."
fi

# Step 2: Regenerate Xcode project with XcodeGen
echo -e "${YELLOW}[3/5] Regenerating Xcode project...${NC}"
if ! command -v xcodegen &>/dev/null; then
    echo -e "${RED}       Error: xcodegen not found. Install with: brew install xcodegen${NC}"
    exit 1
fi
cd "$PROJECT_DIR"
xcodegen generate
echo "       Project generated."

# Step 3: Clean build folder
echo -e "${YELLOW}[4/5] Cleaning build folder...${NC}"
xcodebuild clean \
    -project "$PROJECT_DIR/$SCHEME.xcodeproj" \
    -scheme "$SCHEME" \
    -quiet 2>/dev/null || true
echo "       Build folder cleaned."

# Step 4: Done
echo -e "${YELLOW}[5/5] Done!${NC}"
echo ""
echo -e "${GREEN}Ready to build. In Xcode:${NC}"
echo "  1. Close and reopen $SCHEME.xcodeproj"
echo "  2. Press Cmd+R to build and run"
echo ""
