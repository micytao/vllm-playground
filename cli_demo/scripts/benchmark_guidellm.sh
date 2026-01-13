#!/bin/bash
# =============================================================================
# GuideLLM Benchmark Script
# =============================================================================
# Standalone script to benchmark vLLM server using GuideLLM
# =============================================================================

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

# Configuration
VLLM_HOST="${VLLM_HOST:-127.0.0.1}"
VLLM_PORT="${VLLM_PORT:-8000}"
TARGET_URL="http://${VLLM_HOST}:${VLLM_PORT}/v1"

# Benchmark settings
TOTAL_REQUESTS="${1:-100}"
REQUEST_RATE="${2:-5}"
PROMPT_TOKENS="${3:-128}"
OUTPUT_TOKENS="${4:-128}"
RATE_TYPE="${RATE_TYPE:-constant}"  # constant or sweep

echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}GuideLLM Benchmark${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Configuration:"
echo "  Target: $TARGET_URL"
echo "  Total Requests: $TOTAL_REQUESTS"
echo "  Request Rate: $REQUEST_RATE req/s"
echo "  Rate Type: $RATE_TYPE"
echo "  Prompt Tokens: $PROMPT_TOKENS"
echo "  Output Tokens: $OUTPUT_TOKENS"
echo ""

# Activate venv if available
VENV_PATH="${VENV_PATH:-$HOME/.venv}"
if [ -d "$VENV_PATH" ]; then
    log_info "Activating virtual environment: $VENV_PATH"
    source "$VENV_PATH/bin/activate"
fi

# Check if guidellm is installed
if ! python3 -c "import guidellm" 2>/dev/null; then
    log_error "guidellm not installed"
    echo "Install with: pip install guidellm"
    exit 1
fi

# Check if server is accessible
log_info "Checking server availability..."
if curl -s "${VLLM_HOST}:${VLLM_PORT}/health" > /dev/null 2>&1; then
    log_success "Server is accessible"
else
    log_error "Cannot reach server at ${VLLM_HOST}:${VLLM_PORT}"
    echo "Make sure vLLM server is running:"
    echo "  python -m vllm.entrypoints.openai.api_server --model MODEL_NAME"
    exit 1
fi

# Create results directory
RESULTS_DIR="./benchmark_results"
mkdir -p "$RESULTS_DIR"
timestamp=$(date +"%Y%m%d_%H%M%S")
RESULT_FILE="${RESULTS_DIR}/guidellm_${timestamp}.json"
LOG_FILE="${RESULTS_DIR}/guidellm_${timestamp}.log"

log_info "Results will be saved to: $RESULT_FILE"
log_info "Logs will be saved to: $LOG_FILE"

# Build GuideLLM command
CMD="python3 -m guidellm benchmark"
CMD="$CMD --target \"$TARGET_URL\""
CMD="$CMD --rate-type $RATE_TYPE"

if [ "$RATE_TYPE" = "constant" ]; then
    CMD="$CMD --rate $REQUEST_RATE"
fi

CMD="$CMD --max-requests $TOTAL_REQUESTS"
CMD="$CMD --data \"prompt_tokens=${PROMPT_TOKENS},output_tokens=${OUTPUT_TOKENS}\""
CMD="$CMD --output \"$RESULT_FILE\""

echo ""
log_info "Running benchmark..."
echo -e "${YELLOW}Command:${NC}"
echo "  $CMD"
echo ""

# Run benchmark
eval $CMD 2>&1 | tee "$LOG_FILE"

if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo ""
    log_success "Benchmark completed successfully!"

    # Display results
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}Results Summary${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"

    # Try to parse and display results
    if command -v jq &> /dev/null && [ -f "$RESULT_FILE" ]; then
        cat "$RESULT_FILE" | jq -r '
            "Total Requests: \(.total_requests // "N/A")",
            "Success Rate: \(.success_rate // "N/A")%",
            "Average Latency: \(.avg_latency // "N/A")s",
            "Median Latency: \(.median_latency // "N/A")s",
            "P95 Latency: \(.p95_latency // "N/A")s",
            "P99 Latency: \(.p99_latency // "N/A")s",
            "Throughput: \(.throughput // "N/A") tokens/s"
        ' 2>/dev/null || {
            log_info "Results saved (use jq to view JSON)"
        }
    else
        log_info "Results saved to JSON file"
        if [ -f "$LOG_FILE" ]; then
            echo ""
            log_info "Key metrics from log:"
            grep -E "(Request|Latency|Throughput|Success|tokens/s)" "$LOG_FILE" | tail -10 || true
        fi
    fi

    echo ""
    echo "Files:"
    echo "  📊 Results: $RESULT_FILE"
    echo "  📝 Logs: $LOG_FILE"

    # Provide viewing commands
    echo ""
    echo "View results:"
    echo "  cat $RESULT_FILE | jq ."
    echo "  cat $LOG_FILE"

else
    log_error "Benchmark failed"
    echo "Check logs: $LOG_FILE"
    exit 1
fi
