#!/bin/bash
# =============================================================================
# vLLM + GuideLLM - Full Workflow Demo
# =============================================================================
# This script demonstrates the complete workflow:
# 1. Start vLLM server with a base model
# 2. Test chat serving with curl
# 4. Load quantized model into vLLM
# 5. Benchmark performance with GuideLLM
# =============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Logging functions
log_header() {
    echo -e "\n${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}$1${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}\n"
}

log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

# Configuration
BASE_MODEL="${BASE_MODEL:-TinyLlama/TinyLlama-1.1B-Chat-v1.0}"
VLLM_PORT="${VLLM_PORT:-8000}"
VLLM_HOST="${VLLM_HOST:-127.0.0.1}"
BASE_URL="http://${VLLM_HOST}:${VLLM_PORT}"

# Compression settings
QUANTIZATION_FORMAT="${QUANTIZATION_FORMAT:-W8A8_INT8}"
ALGORITHM="${ALGORITHM:-GPTQ}"
CALIBRATION_SAMPLES="${CALIBRATION_SAMPLES:-128}"  # Reduced for demo speed

# Benchmark settings
BENCHMARK_REQUESTS="${BENCHMARK_REQUESTS:-50}"  # Reduced for demo speed
BENCHMARK_RATE="${BENCHMARK_RATE:-5}"
PROMPT_TOKENS="${PROMPT_TOKENS:-128}"
OUTPUT_TOKENS="${OUTPUT_TOKENS:-128}"

# Virtual environment
VENV_PATH="${VENV_PATH:-$HOME/.venv}"

# PID file for cleanup
VLLM_PID_FILE="/tmp/vllm_demo.pid"

# Cleanup function
cleanup() {
    log_header "🧹 Cleaning Up"

    if [ -f "$VLLM_PID_FILE" ]; then
        local pid=$(cat "$VLLM_PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            log_info "Stopping vLLM server (PID: $pid)..."
            kill "$pid" 2>/dev/null || true
            sleep 2
            # Force kill if still running
            if ps -p "$pid" > /dev/null 2>&1; then
                kill -9 "$pid" 2>/dev/null || true
            fi
            log_success "vLLM server stopped"
        fi
        rm -f "$VLLM_PID_FILE"
    fi

    log_success "Cleanup complete"
}

# Register cleanup on exit
trap cleanup EXIT INT TERM

# Check dependencies
check_dependencies() {
    log_header "🔍 Checking Dependencies"

    local missing_deps=()

    # Check Python
    if ! command -v python3 &> /dev/null; then
        missing_deps+=("python3")
    fi

    # Activate venv if available
    if [ -d "$VENV_PATH" ]; then
        log_info "Activating virtual environment: $VENV_PATH"
        source "$VENV_PATH/bin/activate"
    else
        log_warning "Virtual environment not found at $VENV_PATH, using system Python"
    fi

    # Check Python packages
    log_info "Checking Python packages..."

    if ! python3 -c "import vllm" 2>/dev/null; then
        log_error "vLLM not installed"
        missing_deps+=("vllm")
    else
        local vllm_version=$(python3 -c "import vllm; print(vllm.__version__)" 2>/dev/null || echo "unknown")
        log_success "vLLM installed (version: $vllm_version)"
    fi

    else
    fi

    if ! python3 -c "import guidellm" 2>/dev/null; then
        log_error "guidellm not installed"
        missing_deps+=("guidellm")
    else
        local guide_version=$(python3 -c "import guidellm; print(guidellm.__version__ if hasattr(guidellm, '__version__') else 'unknown')" 2>/dev/null || echo "unknown")
        log_success "guidellm installed (version: $guide_version)"
    fi

    # Check curl
    if ! command -v curl &> /dev/null; then
        missing_deps+=("curl")
    else
        log_success "curl installed"
    fi

    if [ ${#missing_deps[@]} -gt 0 ]; then
        log_error "Missing dependencies: ${missing_deps[*]}"
        echo ""
        log_info "Install missing dependencies:"
        echo "  pip install vllm guidellm"
        exit 1
    fi

    log_success "All dependencies satisfied"
}

# Wait for server to be ready
wait_for_server() {
    local max_attempts=60
    local attempt=0

    log_info "Waiting for vLLM server to be ready..."

    while [ $attempt -lt $max_attempts ]; do
        if curl -s "${BASE_URL}/health" > /dev/null 2>&1; then
            log_success "Server is ready!"
            return 0
        fi

        attempt=$((attempt + 1))
        echo -n "."
        sleep 2
    done

    echo ""
    log_error "Server did not become ready in time"
    return 1
}

# Step 1: Start vLLM server with base model
start_vllm_server() {
    log_header "🚀 Step 1: Starting vLLM Server"

    log_info "Model: $BASE_MODEL"
    log_info "Port: $VLLM_PORT"
    log_info "Host: $VLLM_HOST"

    # Set CPU environment variables for macOS compatibility
    export VLLM_CPU_KVCACHE_SPACE=40
    export VLLM_CPU_OMP_THREADS_BIND=auto

    log_info "Starting vLLM server in background..."

    # Start vLLM server
    nohup python3 -m vllm.entrypoints.openai.api_server \
        --model "$BASE_MODEL" \
        --host "$VLLM_HOST" \
        --port "$VLLM_PORT" \
        --dtype auto \
        > /tmp/vllm_base.log 2>&1 &

    local pid=$!
    echo "$pid" > "$VLLM_PID_FILE"

    log_info "Server started with PID: $pid"
    log_info "Logs: tail -f /tmp/vllm_base.log"

    # Wait for server to be ready
    if ! wait_for_server; then
        log_error "Failed to start server. Check logs: /tmp/vllm_base.log"
        exit 1
    fi

    log_success "vLLM server is running!"
}

# Step 2: Test chat serving with curl
test_chat_serving() {
    log_header "💬 Step 2: Testing Chat Serving"

    log_info "Sending test chat request..."

    local response=$(curl -s "${BASE_URL}/v1/chat/completions" \
        -H "Content-Type: application/json" \
        -d '{
            "model": "'"$BASE_MODEL"'",
            "messages": [
                {"role": "user", "content": "Hello! Can you tell me a short joke?"}
            ],
            "temperature": 0.7,
            "max_tokens": 100
        }')

    if [ $? -eq 0 ] && echo "$response" | grep -q "choices"; then
        log_success "Chat serving is working!"
        echo ""
        echo "Response:"
        echo "$response" | python3 -m json.tool | grep -A 5 '"content"'
        echo ""

        # Extract and display content
        local content=$(echo "$response" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data['choices'][0]['message']['content'])" 2>/dev/null || echo "")
        if [ -n "$content" ]; then
            echo -e "${GREEN}Assistant:${NC} $content"
        fi
    else
        log_error "Chat serving test failed"
        echo "Response: $response"
        return 1
    fi
}

compress_model() {

    log_info "Model: $BASE_MODEL"
    log_info "Quantization: $QUANTIZATION_FORMAT"
    log_info "Algorithm: $ALGORITHM"
    log_info "Calibration samples: $CALIBRATION_SAMPLES"

    # Create output directory
    local model_name=$(echo "$BASE_MODEL" | sed 's/\//_/g')
    local output_dir="${COMPRESSED_MODEL_DIR}/${model_name}_${QUANTIZATION_FORMAT}"

    mkdir -p "$output_dir"
    log_info "Output directory: $output_dir"

    # Check if already compressed
    if [ -f "${output_dir}/config.json" ]; then
        log_warning "Compressed model already exists at $output_dir"
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            log_info "Using existing compressed model"
            echo "$output_dir"
            return 0
        fi
    fi

    log_info "Starting compression (this may take several minutes)..."

    # Create Python compression script
    cat > /tmp/compress_model.py << 'PYTHON_SCRIPT'
import sys

def main():
    model = sys.argv[1]
    output_dir = sys.argv[2]
    scheme = sys.argv[3]
    calibration_samples = int(sys.argv[4])

    print(f"Loading model: {model}")
    print(f"Scheme: {scheme}")
    print(f"Calibration samples: {calibration_samples}")

    # Build recipe
    recipe = [
        GPTQModifier(
            scheme=scheme,
            targets="Linear",
            ignore=["lm_head"]
        )
    ]

    print("Starting compression...")
    oneshot(
        model=model,
        dataset="open_platypus",
        recipe=recipe,
        output_dir=output_dir,
        max_seq_length=2048,
        num_calibration_samples=calibration_samples,
    )

if __name__ == "__main__":
    main()
PYTHON_SCRIPT

    # Map quantization format to scheme
    local scheme="W8A8"
    case "$QUANTIZATION_FORMAT" in
        "W8A8_INT8") scheme="W8A8" ;;
        "W4A16") scheme="W4A16" ;;
        "W8A16") scheme="W8A16" ;;
        *) scheme="W8A8" ;;
    esac

    # Run compression
    if python3 /tmp/compress_model.py "$BASE_MODEL" "$output_dir" "$scheme" "$CALIBRATION_SAMPLES"; then
        log_success "Model compression complete!"
        log_info "Compressed model location: $output_dir"

        # Show size comparison if possible
        if command -v du &> /dev/null; then
            local size=$(du -sh "$output_dir" 2>/dev/null | cut -f1)
            log_info "Compressed model size: $size"
        fi

        echo "$output_dir"
    else
        log_error "Model compression failed"
        return 1
    fi
}
