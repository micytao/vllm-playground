/**
 * PagedAttention Visualizer Module (Context Observability)
 *
 * Provides real-time visualization of vLLM's KV cache utilization,
 * prefix cache reuse, and eviction alerts.
 *
 * Usage: Import and call initPagedAttentionModule(uiInstance).
 */

const POLL_INTERVAL_MS = 3000;
const HEATMAP_MAX_POINTS = 40;
const EVICTION_WARN_THRESHOLD = 0.90;
const EVICTION_CRITICAL_THRESHOLD = 0.95;

export function initPagedAttentionModule(ui) {
    Object.assign(ui, PagedAttentionMethods);
    ui.initPagedAttention();
}

const PagedAttentionMethods = {

    initPagedAttention() {
        this._paHeatmapData = [];
        this._paPrevPreemptions = null;
        this._paPollTimer = null;
        this._paEvictionState = 'none'; // 'none' | 'warning' | 'critical'
        this._paEmptyPollCount = 0;
        this._paHasData = false;
        this._paDemoRunning = false;
        this._paDemoTimer = null;
        this._paIsSimulated = false;

        const toggle = document.getElementById('context-obs-toggle');
        if (toggle) {
            toggle.addEventListener('click', (e) => {
                if (e.target.closest('.pa-demo-header-btn')) return;
                const panel = document.getElementById('context-observability-panel');
                if (panel) panel.classList.toggle('collapsed');
            });
        }

        const demoBtn = document.getElementById('pa-run-demo-btn');
        if (demoBtn) demoBtn.addEventListener('click', (e) => { e.stopPropagation(); this._paRunDemo(); });

        const headerDemoBtn = document.getElementById('pa-demo-header-btn');
        if (headerDemoBtn) headerDemoBtn.addEventListener('click', (e) => { e.stopPropagation(); this._paRunDemo(); });

        const clearBtn = document.getElementById('pa-demo-clear-btn');
        if (clearBtn) clearBtn.addEventListener('click', (e) => { e.stopPropagation(); this._paClearDemo(); });

        this._paInitCanvas();
        this._paStartPolling();
    },

    _paInitCanvas() {
        const canvas = document.getElementById('kv-heatmap-canvas');
        if (!canvas) return;
        const wrap = canvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = wrap.clientWidth * dpr;
        canvas.height = wrap.clientHeight * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        this._paCanvasWidth = wrap.clientWidth;
        this._paCanvasHeight = wrap.clientHeight;

        window.addEventListener('resize', () => {
            const w = wrap.clientWidth;
            const h = wrap.clientHeight;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            const rctx = canvas.getContext('2d');
            rctx.scale(dpr, dpr);
            this._paCanvasWidth = w;
            this._paCanvasHeight = h;
            this._paDrawHeatmap();
        });
    },

    _paStartPolling() {
        this._paPoll();
        this._paPollTimer = setInterval(() => this._paPoll(), POLL_INTERVAL_MS);
    },

    async _paPoll() {
        try {
            const resp = await fetch('/api/vllm/metrics');
            if (!resp.ok) {
                this._paEmptyPollCount++;
                this._paShowNoData(true);
                return;
            }
            const data = await resp.json();
            if (data.error || Object.keys(data).length === 0) {
                this._paEmptyPollCount++;
                this._paShowNoData(true);
                return;
            }
            this._paUpdateFromMetrics(data);
        } catch {
            this._paEmptyPollCount++;
            this._paShowNoData(true);
        }
    },

    _paShowNoData(show) {
        const noData = document.getElementById('context-obs-no-data');
        const body = document.getElementById('context-obs-body');
        if (!noData) return;

        if (show && !this._paHasData) {
            noData.style.display = '';
            body?.querySelectorAll('.kv-heatmap-section, .prefix-cache-section, .eviction-banner')
                .forEach(el => el.style.display = 'none');
        } else {
            noData.style.display = 'none';
            body?.querySelectorAll('.kv-heatmap-section, .prefix-cache-section')
                .forEach(el => el.style.display = '');
        }
    },

    _paUpdateFromMetrics(m, fromDemo = false) {
        const kvUsage = m.kv_cache_usage_perc ?? m.gpu_cache_usage_perc ?? null;
        const prefixHitRate = m.prefix_cache_hit_rate ?? null;
        const prefixHits = m.prefix_cache_hits ?? null;
        const prefixQueries = m.prefix_cache_queries ?? null;
        const numPreemptions = m.num_preemptions ?? null;

        // Real metrics arrived — stop any running demo and switch over
        if (!fromDemo && this._paDemoRunning) {
            this._paStopDemo();
        }
        if (!fromDemo) {
            this._paIsSimulated = false;
            this._paSetSimulatedBadge(false);
        }

        this._paHasData = true;
        this._paEmptyPollCount = 0;
        this._paShowNoData(false);

        // KV cache percentage: vLLM reports as fraction (0-1) or percentage (0-100)
        let kvPct = null;
        if (kvUsage !== null) {
            kvPct = kvUsage <= 1.0 ? kvUsage * 100 : kvUsage;
        }

        this._paUpdateHeatmap(kvPct);
        this._paUpdateUtilizationBar(kvPct);
        this._paUpdateCurrentValue(kvPct);
        this._paUpdatePrefixCache(prefixHitRate, prefixHits, prefixQueries);
        this._paUpdateEvictionAlerts(kvPct, numPreemptions);
    },

    // --- KV Cache Heatmap ---

    _paUpdateHeatmap(kvPct) {
        if (kvPct === null) return;
        this._paHeatmapData.push(kvPct);
        if (this._paHeatmapData.length > HEATMAP_MAX_POINTS) {
            this._paHeatmapData.shift();
        }
        this._paDrawHeatmap();
    },

    _paDrawHeatmap() {
        const canvas = document.getElementById('kv-heatmap-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = this._paCanvasWidth || canvas.clientWidth;
        const h = this._paCanvasHeight || canvas.clientHeight;

        ctx.clearRect(0, 0, w, h);

        const data = this._paHeatmapData;
        if (data.length === 0) return;

        const barWidth = w / HEATMAP_MAX_POINTS;
        const startIdx = Math.max(0, HEATMAP_MAX_POINTS - data.length);

        for (let i = 0; i < data.length; i++) {
            const pct = data[i];
            const x = (startIdx + i) * barWidth;
            const barH = (pct / 100) * h;

            ctx.fillStyle = this._paColorForPct(pct);
            ctx.fillRect(x, h - barH, barWidth - 1, barH);
        }
    },

    _paColorForPct(pct) {
        if (pct < 50) return '#10b981';      // green
        if (pct < 80) return '#f59e0b';      // yellow/amber
        if (pct < 90) return '#f97316';      // orange
        return '#ef4444';                     // red
    },

    _paUpdateUtilizationBar(kvPct) {
        const fill = document.getElementById('kv-utilization-fill');
        if (!fill || kvPct === null) return;
        fill.style.width = `${Math.min(kvPct, 100)}%`;
        fill.style.background = this._paColorForPct(kvPct);
    },

    _paUpdateCurrentValue(kvPct) {
        const el = document.getElementById('kv-cache-current-value');
        if (!el) return;

        if (kvPct === null) {
            el.textContent = '--%';
            el.className = 'kv-cache-current level-ok';
            return;
        }

        el.textContent = `${kvPct.toFixed(1)}%`;

        let level = 'level-ok';
        if (kvPct >= 95) level = 'level-critical';
        else if (kvPct >= 80) level = 'level-high';
        else if (kvPct >= 50) level = 'level-moderate';
        el.className = `kv-cache-current ${level}`;
    },

    // --- Prefix Cache Indicator ---

    _paUpdatePrefixCache(hitRate, hits, queries) {
        const badge = document.getElementById('prefix-cache-badge');
        const status = document.getElementById('prefix-cache-status');
        const details = document.getElementById('prefix-cache-details');
        const rate = document.getElementById('prefix-cache-rate');

        const isActive = hitRate !== null && hitRate > 0;

        if (badge) {
            badge.classList.toggle('active', isActive);
        }

        if (status) {
            if (hitRate === null) {
                status.textContent = window.i18n?.t('contextObs.prefixCache.inactive') || 'Prefix Cache Inactive';
            } else if (isActive) {
                status.textContent = window.i18n?.t('contextObs.prefixCache.active') || 'Prefix Cache Active';
            } else {
                status.textContent = window.i18n?.t('contextObs.prefixCache.inactive') || 'Prefix Cache Inactive';
            }
        }

        if (details) {
            if (hits !== null && queries !== null) {
                const hitsStr = Math.round(hits).toLocaleString();
                const queriesStr = Math.round(queries).toLocaleString();
                details.textContent = `Hits: ${hitsStr} tokens · Queries: ${queriesStr}`;
            } else if (hitRate !== null) {
                details.textContent = window.i18n?.t('contextObs.prefixCache.reusingMemory') || 'System prompt memory is being reused';
            } else {
                details.textContent = window.i18n?.t('contextObs.prefixCache.noData') || 'No prefix cache data available';
            }
        }

        if (rate) {
            if (hitRate !== null) {
                const pct = hitRate <= 1.0 ? hitRate * 100 : hitRate;
                rate.textContent = `${pct.toFixed(1)}%`;
            } else {
                rate.textContent = '--';
            }
        }
    },

    // --- Eviction Alerts ---

    _paUpdateEvictionAlerts(kvPct, numPreemptions) {
        const banner = document.getElementById('eviction-banner');
        const icon = document.getElementById('eviction-banner-icon');
        const title = document.getElementById('eviction-banner-title');
        const detail = document.getElementById('eviction-banner-detail');
        if (!banner) return;

        let newState = 'none';
        let preemptionDelta = 0;

        // Detect preemption increases
        if (numPreemptions !== null && this._paPrevPreemptions !== null) {
            preemptionDelta = numPreemptions - this._paPrevPreemptions;
        }
        if (numPreemptions !== null) {
            this._paPrevPreemptions = numPreemptions;
        }

        // Active eviction: preemptions increasing
        if (preemptionDelta > 0) {
            newState = 'critical';
        } else if (kvPct !== null && kvPct >= EVICTION_CRITICAL_THRESHOLD * 100) {
            newState = 'critical';
        } else if (kvPct !== null && kvPct >= EVICTION_WARN_THRESHOLD * 100) {
            newState = 'warning';
        }

        if (newState === 'none') {
            banner.classList.remove('visible', 'warning', 'critical');
            this._paEvictionState = 'none';
            return;
        }

        banner.classList.remove('warning', 'critical');
        banner.classList.add('visible', newState);

        if (newState === 'critical' && preemptionDelta > 0) {
            if (icon) icon.textContent = '🔴';
            if (title) title.textContent = window.i18n?.t('contextObs.eviction.activeTitle') || 'Context Eviction Active';
            if (detail) {
                const totalStr = Math.round(numPreemptions).toLocaleString();
                detail.textContent = (window.i18n?.t('contextObs.eviction.activeDetail') ||
                    "The model's memory is full. Oldest conversation context is being dropped to make room for new tokens.") +
                    ` Preemptions: ${totalStr} (+${preemptionDelta})`;
            }

            // Fire toast notification only on state transition
            if (this._paEvictionState !== 'critical' && this.showNotification) {
                this.showNotification(
                    window.i18n?.t('contextObs.eviction.toast') ||
                    'Memory full — the model is dropping older conversation context to continue generating.',
                    'warning',
                    8000
                );
            }
        } else if (newState === 'critical') {
            if (icon) icon.textContent = '🔴';
            if (title) title.textContent = window.i18n?.t('contextObs.eviction.criticalTitle') || 'Critical Memory Pressure';
            if (detail) detail.textContent = window.i18n?.t('contextObs.eviction.criticalDetail') ||
                'KV cache is nearly full. Context eviction is imminent.';
        } else {
            if (icon) icon.textContent = '⚠';
            if (title) title.textContent = window.i18n?.t('contextObs.eviction.pressureTitle') || 'Memory Pressure';
            if (detail) detail.textContent = window.i18n?.t('contextObs.eviction.pressureDetail') ||
                'KV cache utilization is high. Context eviction may begin soon.';
        }

        this._paEvictionState = newState;
    },

    // --- Demo Simulation ---

    async _paRunDemo() {
        if (this._paDemoRunning) return;
        this._paDemoRunning = true;
        this._paIsSimulated = true;
        this._paSetDemoBtnState(true);
        this._paSetSimulatedBadge(true);

        // Reset state for clean demo
        this._paHeatmapData = [];
        this._paPrevPreemptions = null;
        this._paEvictionState = 'none';
        this._paHasData = true;
        this._paShowNoData(false);

        const steps = [
            // Phase 1: Healthy baseline
            { kv: 8,  prefix: 0,    preempt: 0, label: 'Healthy' },
            { kv: 12, prefix: 0,    preempt: 0 },
            { kv: 15, prefix: 0,    preempt: 0 },
            // Phase 2: Prefix cache active
            { kv: 18, prefix: 45,   preempt: 0, label: 'Prefix caching' },
            { kv: 22, prefix: 62,   preempt: 0 },
            { kv: 25, prefix: 68,   preempt: 0 },
            // Phase 3: Rising pressure
            { kv: 35, prefix: 55,   preempt: 0, label: 'Pressure building' },
            { kv: 50, prefix: 48,   preempt: 0 },
            { kv: 65, prefix: 40,   preempt: 0 },
            { kv: 78, prefix: 35,   preempt: 0 },
            { kv: 85, prefix: 30,   preempt: 0 },
            // Phase 4: Warning threshold
            { kv: 91, prefix: 22,   preempt: 0, label: 'Warning zone' },
            { kv: 93, prefix: 18,   preempt: 0 },
            // Phase 5: Eviction
            { kv: 96, prefix: 10,   preempt: 2, label: 'Eviction active' },
            { kv: 98, prefix: 5,    preempt: 5 },
            { kv: 99, prefix: 2,    preempt: 9 },
            // Phase 6: Recovery
            { kv: 75, prefix: 0,    preempt: 9, label: 'Recovery' },
            { kv: 50, prefix: 0,    preempt: 9 },
            { kv: 30, prefix: 0,    preempt: 9 },
            { kv: 15, prefix: 0,    preempt: 9 },
            { kv: 10, prefix: 0,    preempt: 9 },
        ];

        for (let i = 0; i < steps.length; i++) {
            if (!this._paDemoRunning) break;

            const s = steps[i];
            if (s.label && this.showNotification) {
                this.showNotification(`Demo: ${s.label}`, 'info', 2500);
            }

            this._paUpdateFromMetrics({
                kv_cache_usage_perc: s.kv,
                prefix_cache_hit_rate: s.prefix,
                num_preemptions: s.preempt,
                prefix_cache_hits: s.prefix > 0 ? Math.round(s.prefix * 20) : null,
                prefix_cache_queries: s.prefix > 0 ? Math.round(s.prefix * 20 / (s.prefix / 100)) : null,
            }, true);

            await new Promise(r => { this._paDemoTimer = setTimeout(r, 1500); });
        }

        this._paDemoRunning = false;
        this._paSetDemoBtnState(false);
    },

    _paStopDemo() {
        this._paDemoRunning = false;
        if (this._paDemoTimer) {
            clearTimeout(this._paDemoTimer);
            this._paDemoTimer = null;
        }
        this._paSetDemoBtnState(false);
    },

    _paClearDemo() {
        this._paStopDemo();
        this._paIsSimulated = false;
        this._paHasData = false;
        this._paHeatmapData = [];
        this._paPrevPreemptions = null;
        this._paEvictionState = 'none';

        // Reset all UI elements
        this._paDrawHeatmap();
        this._paUpdateCurrentValue(null);
        this._paUpdateUtilizationBar(null);
        this._paUpdatePrefixCache(null, null, null);
        const banner = document.getElementById('eviction-banner');
        if (banner) banner.classList.remove('visible', 'warning', 'critical');
        const fill = document.getElementById('kv-utilization-fill');
        if (fill) { fill.style.width = '0%'; fill.style.background = 'var(--success-color)'; }

        this._paSetSimulatedBadge(false);
        this._paShowNoData(true);
    },

    _paSetDemoBtnState(running) {
        const btn = document.getElementById('pa-run-demo-btn');
        const hdrBtn = document.getElementById('pa-demo-header-btn');
        if (btn) {
            btn.textContent = running
                ? (window.i18n?.t('contextObs.demo.running') || '⏳ Simulating...')
                : (window.i18n?.t('contextObs.demo.runButton') || '▶ Run Demo Simulation');
            btn.disabled = running;
        }
        if (hdrBtn) {
            hdrBtn.textContent = running
                ? (window.i18n?.t('contextObs.demo.running') || '⏳ Running...')
                : 'Demo';
            hdrBtn.classList.toggle('running', running);
        }
    },

    _paSetSimulatedBadge(show) {
        const badge = document.getElementById('pa-simulated-badge');
        if (badge) badge.classList.toggle('visible', show);
        const clearBtn = document.getElementById('pa-demo-clear-btn');
        if (clearBtn) clearBtn.style.display = show ? '' : 'none';
    },

    destroyPagedAttention() {
        this._paStopDemo();
        if (this._paPollTimer) {
            clearInterval(this._paPollTimer);
            this._paPollTimer = null;
        }
    },
};
