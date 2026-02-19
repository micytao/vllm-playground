#!/bin/bash
# =============================================================================
# Context Observability (PagedAttention Visualizer) - Test Workflow
# =============================================================================
# Simulates escalating KV cache pressure, prefix cache reuse, and eviction
# events so you can visually verify the UI without a live vLLM server.
#
# Prerequisites:
#   - vllm-playground running (python3 run.py or vllm-playground)
#
# Usage:
#   ./scripts/test_context_observability.sh [PLAYGROUND_URL]
# =============================================================================

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PLAYGROUND_URL="${1:-http://localhost:7860}"
API="${PLAYGROUND_URL}/api/vllm/metrics"
SIMULATE="${API}/simulate"
RESET="${API}/simulate/reset"
POLL_WAIT=3  # Match the frontend polling interval

log_info()    { echo -e "${BLUE}ℹ${NC}  $1"; }
log_success() { echo -e "${GREEN}✓${NC}  $1"; }
log_warn()    { echo -e "${YELLOW}⚠${NC}  $1"; }
log_error()   { echo -e "${RED}✗${NC}  $1"; }
log_step()    { echo -e "\n${CYAN}${BOLD}── $1 ──${NC}"; }
log_observe() { echo -e "${YELLOW}👀 OBSERVE:${NC} $1"; }

inject() {
    curl -s -X POST "${SIMULATE}" \
        -H "Content-Type: application/json" \
        -d "$1" > /dev/null
}

separator() {
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
}

# ── Preamble ──

separator
echo -e "${CYAN}${BOLD}Context Observability — Visual Test Workflow${NC}"
separator
echo ""
echo "  Playground: ${PLAYGROUND_URL}"
echo "  Open the UI in your browser and expand the"
echo "  \"Context Observability\" panel below Response Metrics."
echo ""

# ── Pre-flight: check playground is up ──

log_step "Pre-flight Check"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${PLAYGROUND_URL}")
if [ "$HTTP_CODE" = "200" ]; then
    log_success "Playground is running (HTTP ${HTTP_CODE})"
else
    log_error "Cannot reach playground at ${PLAYGROUND_URL} (HTTP ${HTTP_CODE})"
    echo "  Start it with:  python3 run.py  or  vllm-playground"
    exit 1
fi

# ── Reset ──

log_step "Step 0: Reset Metrics"
curl -s -X POST "${RESET}" > /dev/null
log_success "Metrics cleared"
sleep 1

# =================================================================
# SCENARIO 1: Healthy baseline — low KV cache, no prefix cache
# =================================================================

log_step "Scenario 1: Healthy Baseline (low cache usage)"
log_info "Injecting 6 data points at ~10-20% KV cache usage..."

for pct in 8 10 12 11 14 12; do
    inject "{\"kv_cache_usage_perc\": ${pct}, \"prefix_cache_hit_rate\": 0, \"num_preemptions\": 0}"
    sleep $POLL_WAIT
done

echo ""
log_observe "Heatmap should show GREEN bars, current value ~12%"
log_observe "Utilization bar should be narrow and green"
log_observe "Prefix Cache badge should say 'Inactive'"
log_observe "No eviction banner should be visible"
echo ""
read -p "Press Enter to continue to Scenario 2..."

# =================================================================
# SCENARIO 2: Prefix cache becomes active
# =================================================================

log_step "Scenario 2: Prefix Cache Active (system prompt reuse)"
log_info "Simulating prefix caching with 65% hit rate..."

for pct in 15 18 20 22 20 21; do
    inject "{\"kv_cache_usage_perc\": ${pct}, \"prefix_cache_hit_rate\": 65.0, \"prefix_cache_hits\": 1240, \"prefix_cache_queries\": 1907, \"num_preemptions\": 0}"
    sleep $POLL_WAIT
done

echo ""
log_observe "Prefix Cache badge should turn GREEN and say 'Active'"
log_observe "Hit rate should display '65.0%'"
log_observe "Details should show 'Hits: 1,240 tokens · Queries: 1,907'"
log_observe "Heatmap stays green (low usage)"
echo ""
read -p "Press Enter to continue to Scenario 3..."

# =================================================================
# SCENARIO 3: Gradual pressure — cache filling up
# =================================================================

log_step "Scenario 3: Gradual Memory Pressure (cache filling)"
log_info "Simulating cache usage climbing from 30% to 85%..."

for pct in 30 40 50 55 65 72 78 82 85; do
    inject "{\"kv_cache_usage_perc\": ${pct}, \"prefix_cache_hit_rate\": 42.0, \"prefix_cache_hits\": 2100, \"prefix_cache_queries\": 5000, \"num_preemptions\": 0}"
    sleep $POLL_WAIT
done

echo ""
log_observe "Heatmap should transition: GREEN -> YELLOW -> ORANGE"
log_observe "Current value should show ~85% in ORANGE text"
log_observe "Utilization bar should be wide and orange"
log_observe "No eviction banner yet (below 90% threshold)"
echo ""
read -p "Press Enter to continue to Scenario 4..."

# =================================================================
# SCENARIO 4: Memory pressure warning — above 90%
# =================================================================

log_step "Scenario 4: Memory Pressure Warning (>90%)"
log_info "Pushing cache usage above 90% threshold..."

for pct in 88 90 91 92; do
    inject "{\"kv_cache_usage_perc\": ${pct}, \"prefix_cache_hit_rate\": 30.0, \"num_preemptions\": 0}"
    sleep $POLL_WAIT
done

echo ""
log_observe "YELLOW warning banner should appear: 'Memory Pressure'"
log_observe "Banner text: 'KV cache utilization is high...'"
log_observe "Heatmap bars turning RED"
log_observe "Current value shows ~92% in orange/red"
echo ""
read -p "Press Enter to continue to Scenario 5..."

# =================================================================
# SCENARIO 5: Active eviction — preemptions increasing
# =================================================================

log_step "Scenario 5: Active Context Eviction (preemptions increasing)"
log_info "Simulating preemption events (memory full, dropping context)..."

inject "{\"kv_cache_usage_perc\": 95, \"prefix_cache_hit_rate\": 15.0, \"num_preemptions\": 1}"
sleep $POLL_WAIT

inject "{\"kv_cache_usage_perc\": 97, \"prefix_cache_hit_rate\": 10.0, \"num_preemptions\": 3}"
sleep $POLL_WAIT

inject "{\"kv_cache_usage_perc\": 98, \"prefix_cache_hit_rate\": 5.0, \"num_preemptions\": 6}"
sleep $POLL_WAIT

inject "{\"kv_cache_usage_perc\": 99, \"prefix_cache_hit_rate\": 2.0, \"num_preemptions\": 10}"
sleep $POLL_WAIT

echo ""
log_observe "RED banner: 'Context Eviction Active'"
log_observe "Banner shows preemption count and delta"
log_observe "A TOAST NOTIFICATION should appear warning about memory"
log_observe "Current value should PULSE in red at ~99%"
log_observe "Heatmap is solid red on the right side"
log_observe "Prefix cache rate dropped as caching becomes less effective"
echo ""
read -p "Press Enter to continue to Scenario 6..."

# =================================================================
# SCENARIO 6: Recovery — cache pressure drops
# =================================================================

log_step "Scenario 6: Recovery (user cleared chat)"
log_info "Simulating cache recovery after clearing conversation..."

for pct in 80 60 40 25 15 10; do
    inject "{\"kv_cache_usage_perc\": ${pct}, \"prefix_cache_hit_rate\": 0, \"num_preemptions\": 10}"
    sleep $POLL_WAIT
done

echo ""
log_observe "Eviction banner should DISAPPEAR"
log_observe "Heatmap should show red -> orange -> yellow -> green transition"
log_observe "Current value returns to green"
log_observe "Prefix cache goes inactive"
echo ""

# =================================================================
# Cleanup
# =================================================================

log_step "Cleanup"
curl -s -X POST "${RESET}" > /dev/null
log_success "Metrics reset to clean state"

echo ""
separator
echo -e "${GREEN}${BOLD}Test workflow complete!${NC}"
separator
echo ""
echo "Checklist — verify each item was observed:"
echo ""
echo "  [ ] Heatmap rendered green bars for low cache usage"
echo "  [ ] Heatmap color transitioned green -> yellow -> orange -> red"
echo "  [ ] Current percentage value updated with correct color coding"
echo "  [ ] Utilization bar width and color matched the percentage"
echo "  [ ] Prefix Cache badge turned green when hit rate > 0"
echo "  [ ] Prefix Cache showed hit/query token counts"
echo "  [ ] Warning banner appeared at ~90% cache usage"
echo "  [ ] Critical/eviction banner appeared when preemptions increased"
echo "  [ ] Toast notification fired on first eviction detection"
echo "  [ ] All alerts auto-dismissed during recovery"
echo "  [ ] Panel collapse/expand toggle works"
echo ""
