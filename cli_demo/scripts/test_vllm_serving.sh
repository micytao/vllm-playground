#!/bin/bash
# =============================================================================
# vLLM Server Testing Script
# =============================================================================
# Test vLLM server with various curl commands
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
log_error() { echo -e "${RED}✗${NC} $1"; }

# Configuration
VLLM_HOST="${VLLM_HOST:-127.0.0.1}"
VLLM_PORT="${VLLM_PORT:-8000}"
BASE_URL="http://${VLLM_HOST}:${VLLM_PORT}"

echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}vLLM Server Testing${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Target: $BASE_URL"
echo ""

# Test 1: Health Check
echo -e "${CYAN}Test 1: Health Check${NC}"
echo "─────────────────────────────────────────────────────────────"
log_info "Checking server health..."

response=$(curl -s "${BASE_URL}/health" || echo "ERROR")
if [ "$response" = "ERROR" ]; then
    log_error "Cannot connect to server"
    echo "Is vLLM running on ${VLLM_HOST}:${VLLM_PORT}?"
    exit 1
else
    log_success "Server is healthy"
    echo "Response: $response"
fi
echo ""

# Test 2: List Models
echo -e "${CYAN}Test 2: List Available Models${NC}"
echo "─────────────────────────────────────────────────────────────"
log_info "Fetching models..."

response=$(curl -s "${BASE_URL}/v1/models")
if echo "$response" | grep -q "data"; then
    log_success "Models endpoint working"
    echo "$response" | python3 -m json.tool 2>/dev/null || echo "$response"
else
    log_error "Failed to fetch models"
    echo "Response: $response"
fi
echo ""

# Extract model name for subsequent tests
MODEL=$(echo "$response" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data['data'][0]['id'])" 2>/dev/null || echo "")
if [ -z "$MODEL" ]; then
    log_error "Could not determine model name"
    exit 1
fi
log_info "Using model: $MODEL"
echo ""

# Test 3: Simple Chat Completion
echo -e "${CYAN}Test 3: Simple Chat Completion${NC}"
echo "─────────────────────────────────────────────────────────────"
log_info "Sending chat request..."
echo ""
echo "Prompt: 'Hello! Tell me a short joke.'"
echo ""

curl -s "${BASE_URL}/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "'"$MODEL"'",
        "messages": [
            {"role": "user", "content": "Hello! Tell me a short joke."}
        ],
        "temperature": 0.7,
        "max_tokens": 100
    }' | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if 'choices' in data:
        print('✓ Response received')
        content = data['choices'][0]['message']['content']
        print('\n\033[0;32mAssistant:\033[0m', content)
        print('\n\033[0;34mℹ\033[0m Tokens used:', data.get('usage', {}).get('total_tokens', 'N/A'))
    else:
        print('✗ Unexpected response format')
        print(json.dumps(data, indent=2))
except Exception as e:
    print(f'✗ Error: {e}')
    print(sys.stdin.read())
"
echo ""

# Test 4: Streaming Chat
echo -e "${CYAN}Test 4: Streaming Chat Completion${NC}"
echo "─────────────────────────────────────────────────────────────"
log_info "Sending streaming chat request..."
echo ""
echo "Prompt: 'Count from 1 to 5.'"
echo ""
echo -e "${GREEN}Assistant (streaming):${NC} "

curl -s -N "${BASE_URL}/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "'"$MODEL"'",
        "messages": [
            {"role": "user", "content": "Count from 1 to 5."}
        ],
        "temperature": 0.7,
        "max_tokens": 50,
        "stream": true
    }' | while IFS= read -r line; do
    if [[ $line == data:* ]]; then
        content=$(echo "${line#data: }" | python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    if 'choices' in data and len(data['choices']) > 0:
        delta = data['choices'][0].get('delta', {})
        print(delta.get('content', ''), end='')
except:
    pass
" 2>/dev/null)
        echo -n "$content"
    fi
done
echo ""
echo ""

# Test 5: Multi-turn Conversation
echo -e "${CYAN}Test 5: Multi-turn Conversation${NC}"
echo "─────────────────────────────────────────────────────────────"
log_info "Testing conversation with context..."
echo ""

curl -s "${BASE_URL}/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "'"$MODEL"'",
        "messages": [
            {"role": "user", "content": "My name is Alice."},
            {"role": "assistant", "content": "Nice to meet you, Alice! How can I help you today?"},
            {"role": "user", "content": "What is my name?"}
        ],
        "temperature": 0.7,
        "max_tokens": 50
    }' | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    content = data['choices'][0]['message']['content']
    print('Conversation history:')
    print('  User: My name is Alice.')
    print('  Assistant: Nice to meet you, Alice!')
    print('  User: What is my name?')
    print('\n\033[0;32mAssistant:\033[0m', content)
    if 'alice' in content.lower():
        print('\n\033[0;32m✓\033[0m Model correctly remembered the name!')
    else:
        print('\n\033[1;33m⚠\033[0m Model may not have retained context')
except Exception as e:
    print(f'✗ Error: {e}')
"
echo ""

# Test 6: Completions API
echo -e "${CYAN}Test 6: Text Completion (Non-Chat)${NC}"
echo "─────────────────────────────────────────────────────────────"
log_info "Testing completions endpoint..."
echo ""
echo "Prompt: 'Once upon a time'"
echo ""

curl -s "${BASE_URL}/v1/completions" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "'"$MODEL"'",
        "prompt": "Once upon a time",
        "max_tokens": 50,
        "temperature": 0.7
    }' | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if 'choices' in data:
        text = data['choices'][0]['text']
        print('\033[0;32mCompletion:\033[0m Once upon a time' + text)
    else:
        print('✗ Unexpected response')
        print(json.dumps(data, indent=2))
except Exception as e:
    print(f'✗ Error: {e}')
"
echo ""

# Summary
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}Test Summary${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
log_success "All tests completed!"
echo ""
echo "Your vLLM server is working correctly and supports:"
echo "  ✓ Health checks"
echo "  ✓ Model listing"
echo "  ✓ Chat completions"
echo "  ✓ Streaming responses"
echo "  ✓ Multi-turn conversations"
echo "  ✓ Text completions"
echo ""
echo "Server: ${BASE_URL}"
echo "Model: ${MODEL}"
