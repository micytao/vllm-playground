/**
 * Metric Registry -- single source of truth for all vLLM metric metadata.
 *
 * Adding a new curated metric = one entry here.  Unregistered metrics
 * auto-appear in the All Metrics table with sensible defaults.
 */

export const METRIC_REGISTRY = {
    // --- KV Cache & Memory ---
    'vllm:kv_cache_usage_perc': {
        category: 'kv-cache',
        label: 'KV Cache Usage',
        format: 'percent',
        thresholds: { warning: 0.70, danger: 0.90 },
        sidebar: true,
        obsTab: 'overview',
    },
    'vllm:gpu_cache_usage_perc': {
        category: 'kv-cache',
        label: 'GPU Cache Usage',
        format: 'percent',
        thresholds: { warning: 0.70, danger: 0.90 },
        obsTab: 'overview',
    },
    'vllm:cpu_cache_usage_perc': {
        category: 'kv-cache',
        label: 'CPU Cache Usage',
        format: 'percent',
        thresholds: { warning: 0.80, danger: 0.95 },
        obsTab: 'overview',
    },
    'vllm:prefix_cache_hit_rate': {
        category: 'kv-cache',
        label: 'Prefix Cache Hit Rate',
        format: 'percent',
        obsTab: 'overview',
    },
    'vllm:prefix_cache_hits': {
        category: 'kv-cache',
        label: 'Prefix Cache Hits',
        format: 'integer',
        obsTab: 'overview',
    },
    'vllm:prefix_cache_queries': {
        category: 'kv-cache',
        label: 'Prefix Cache Queries',
        format: 'integer',
        obsTab: 'overview',
    },
    'vllm:num_preemptions': {
        category: 'kv-cache',
        label: 'Preemptions',
        format: 'integer',
        thresholds: { warning: 1, danger: 5 },
        obsTab: 'overview',
    },

    // --- Request Queue ---
    'vllm:num_requests_running': {
        category: 'requests',
        label: 'Running Requests',
        format: 'integer',
        sidebar: true,
        obsTab: 'overview',
    },
    'vllm:num_requests_waiting': {
        category: 'requests',
        label: 'Waiting Requests',
        format: 'integer',
        thresholds: { warning: 10, danger: 50 },
        sidebar: true,
        obsTab: 'overview',
    },

    // --- Throughput ---
    'vllm:avg_prompt_throughput_toks_per_s': {
        category: 'throughput',
        label: 'Avg Prompt Throughput',
        unit: 'tok/s',
        format: 'number',
        obsTab: 'overview',
    },
    'vllm:avg_generation_throughput_toks_per_s': {
        category: 'throughput',
        label: 'Avg Generation Throughput',
        unit: 'tok/s',
        format: 'number',
        obsTab: 'overview',
    },

    // --- Speculative Decoding ---
    'vllm:spec_decode_num_accepted_tokens': {
        category: 'spec-decode',
        label: 'Accepted Tokens',
        format: 'integer',
        obsTab: 'overview',
    },
    'vllm:spec_decode_num_draft_tokens': {
        category: 'spec-decode',
        label: 'Draft Tokens',
        format: 'integer',
        obsTab: 'overview',
    },
    'vllm:spec_decode_num_emitted_tokens': {
        category: 'spec-decode',
        label: 'Emitted Tokens',
        format: 'integer',
        obsTab: 'overview',
    },
    'vllm:spec_decode_acceptance_rate': {
        category: 'spec-decode',
        label: 'Acceptance Rate',
        format: 'percent',
        sidebar: true,
        obsTab: 'overview',
    },

    // --- Latency ---
    'vllm:e2e_request_latency_seconds': {
        category: 'latency',
        label: 'E2E Request Latency',
        format: 'duration_ms',
        obsTab: 'latency',
        histogramDisplay: ['p50', 'p95', 'p99'],
    },
    'vllm:time_to_first_token_seconds': {
        category: 'latency',
        label: 'Time to First Token',
        format: 'duration_ms',
        thresholds: { warning: 500, danger: 2000 },
        sidebar: true,
        obsTab: 'latency',
        histogramDisplay: ['p50', 'p95', 'p99'],
    },
    'vllm:inter_token_latency_seconds': {
        category: 'latency',
        label: 'Inter-Token Latency',
        format: 'duration_ms',
        obsTab: 'latency',
        histogramDisplay: ['p50', 'p95', 'p99'],
    },
    'vllm:time_per_output_token_seconds': {
        category: 'latency',
        label: 'Time per Output Token',
        format: 'duration_ms',
        obsTab: 'latency',
        histogramDisplay: ['p50', 'p95', 'p99'],
    },
};

export const CATEGORIES = {
    'kv-cache':    { title: 'KV Cache & Memory',    icon: 'database' },
    'requests':    { title: 'Request Queue',         icon: 'list' },
    'throughput':  { title: 'Throughput',             icon: 'zap' },
    'spec-decode': { title: 'Speculative Decoding',  icon: 'rocket' },
    'latency':     { title: 'Latency',               icon: 'clock' },
    'other':       { title: 'Other Metrics',         icon: 'bar-chart', autoPopulate: true },
};

/**
 * Format a metric value for display based on its format spec.
 * @param {number|null} value
 * @param {string} format - one of: percent, integer, number, duration_ms
 * @param {string} [unit]
 * @returns {string}
 */
export function formatMetricValue(value, format, unit) {
    if (value == null || isNaN(value)) return '--';
    switch (format) {
        case 'percent':
            return `${(value * 100).toFixed(1)}%`;
        case 'integer':
            return Math.round(value).toLocaleString();
        case 'number':
            return value.toFixed(1) + (unit ? ` ${unit}` : '');
        case 'duration_ms':
            return `${(value * 1000).toFixed(1)} ms`;
        default:
            return String(value);
    }
}

/**
 * Get the threshold status for a metric value.
 * @param {number} value
 * @param {object} thresholds - { warning: number, danger: number }
 * @returns {'ok'|'warning'|'danger'}
 */
export function getThresholdStatus(value, thresholds) {
    if (!thresholds || value == null) return 'ok';
    if (value >= thresholds.danger) return 'danger';
    if (value >= thresholds.warning) return 'warning';
    return 'ok';
}

/**
 * Derive a legacy flat dict (compatible with /api/vllm/metrics) from the
 * structured metrics returned by /api/vllm/metrics/all.
 */
const _LEGACY_KEY_MAP = {
    'vllm:kv_cache_usage_perc': 'kv_cache_usage_perc',
    'vllm:gpu_cache_usage_perc': 'gpu_cache_usage_perc',
    'vllm:cpu_cache_usage_perc': 'cpu_cache_usage_perc',
    'vllm:prefix_cache_hit_rate': 'prefix_cache_hit_rate',
    'vllm:prefix_cache_hits': 'prefix_cache_hits',
    'vllm:prefix_cache_queries': 'prefix_cache_queries',
    'vllm:num_preemptions': 'num_preemptions',
    'vllm:num_requests_running': 'num_requests_running',
    'vllm:num_requests_waiting': 'num_requests_waiting',
    'vllm:avg_prompt_throughput_toks_per_s': 'avg_prompt_throughput',
    'vllm:avg_generation_throughput_toks_per_s': 'avg_generation_throughput',
    'vllm:spec_decode_num_accepted_tokens': 'spec_decode_accepted',
    'vllm:spec_decode_num_draft_tokens': 'spec_decode_draft',
    'vllm:spec_decode_num_emitted_tokens': 'spec_decode_emitted',
    'vllm:spec_decode_acceptance_rate': 'spec_decode_acceptance_rate',
};

const _PERCENT_KEYS = new Set([
    'vllm:kv_cache_usage_perc',
    'vllm:gpu_cache_usage_perc',
    'vllm:cpu_cache_usage_perc',
    'vllm:prefix_cache_hit_rate',
]);

export function toLegacyDict(metrics) {
    if (!metrics || typeof metrics !== 'object') return {};
    const out = {};
    for (const [canonical, legacy] of Object.entries(_LEGACY_KEY_MAP)) {
        const entry = metrics[canonical];
        if (!entry) continue;
        let val = entry.value ?? null;
        if (val != null && _PERCENT_KEYS.has(canonical)) {
            val = val * 100;
        }
        if (val != null) out[legacy] = val;
    }
    return out;
}

/**
 * Given the full metrics dict from /api/vllm/metrics/all, group metrics
 * by their registered category.  Unregistered metrics go into 'other'.
 * @param {object} metrics - { "vllm:foo": { value, type, labels }, ... }
 * @returns {object} - { categoryId: [ { key, entry, registry }, ... ], ... }
 */
export function groupByCategory(metrics) {
    const groups = {};
    for (const catId of Object.keys(CATEGORIES)) {
        groups[catId] = [];
    }

    for (const [key, entry] of Object.entries(metrics)) {
        if (entry.type === 'histogram_bucket') continue;
        const reg = METRIC_REGISTRY[key];
        const catId = reg ? reg.category : 'other';
        if (!groups[catId]) groups[catId] = [];
        groups[catId].push({ key, entry, registry: reg || null });
    }

    return groups;
}
