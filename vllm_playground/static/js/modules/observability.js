/**
 * Observability Module -- full-page metrics dashboard.
 *
 * Follows the same dynamic template loading pattern as vLLM-Omni:
 *   index.html has a small placeholder div; the full HTML is fetched
 *   from /static/templates/observability.html on first visit.
 */

import {
    METRIC_REGISTRY,
    CATEGORIES,
    formatMetricValue,
    getThresholdStatus,
    groupByCategory,
} from './metrics-registry.js';
import { metricsPoller } from './metrics-poller.js';

const ObservabilityModule = {
    ui: null,
    templateLoaded: false,
    _unsubscribe: null,
    _currentTab: 'overview',
    _sortColumn: 'name',
    _sortAsc: true,
    _searchFilter: '',

    // -- Template loading (same pattern as OmniModule) ---------------------

    async loadTemplate() {
        const container = document.getElementById('observability-view');
        if (!container) {
            console.error('Observability view container not found');
            return;
        }

        if (this.templateLoaded && container.querySelector('.obs-layout')) {
            return;
        }

        try {
            const response = await fetch('/static/templates/observability.html');
            if (!response.ok) throw new Error(`Failed to load template: ${response.status}`);

            const html = await response.text();
            container.innerHTML = html;
            this.templateLoaded = true;

            this._bindEvents();
            console.log('Observability template loaded');
        } catch (error) {
            console.error('Failed to load observability template:', error);
            container.innerHTML = `
                <div class="obs-no-data">
                    <h3>Failed to load Observability</h3>
                    <p>${error.message}</p>
                    <button class="obs-btn obs-btn-primary" onclick="window.ObservabilityModule.loadTemplate()">Retry</button>
                </div>
            `;
        }
    },

    onViewActivated() {
        if (!this.templateLoaded) {
            this.loadTemplate();
        }

        if (!this._unsubscribe) {
            this._unsubscribe = metricsPoller.subscribe((data) => this._onMetrics(data));
        }

        if (!metricsPoller._timer) {
            metricsPoller.start();
        }
    },

    onViewDeactivated() {
        // Keep polling -- other consumers (sidebar badge) may need it
    },

    // -- Internal ----------------------------------------------------------

    _bindEvents() {
        const tabs = document.getElementById('obs-tabs');
        if (tabs) {
            tabs.addEventListener('click', (e) => {
                const btn = e.target.closest('.obs-tab');
                if (!btn) return;
                this._switchTab(btn.dataset.obsTab);
            });
        }

        const search = document.getElementById('obs-search');
        if (search) {
            search.addEventListener('input', () => {
                this._searchFilter = search.value.toLowerCase();
                this._renderAllMetricsTable();
            });
        }

        const sortHeaders = document.querySelectorAll('#obs-metrics-table th[data-sort]');
        sortHeaders.forEach((th) => {
            th.addEventListener('click', () => {
                const col = th.dataset.sort;
                if (this._sortColumn === col) {
                    this._sortAsc = !this._sortAsc;
                } else {
                    this._sortColumn = col;
                    this._sortAsc = true;
                }
                this._updateSortArrows();
                this._renderAllMetricsTable();
            });
        });

        const demoBtn = document.getElementById('obs-demo-btn');
        if (demoBtn) demoBtn.addEventListener('click', () => this._runDemo());

        const clearBtn = document.getElementById('obs-clear-btn');
        if (clearBtn) clearBtn.addEventListener('click', () => this._clearDemo());

        const exportBtn = document.getElementById('obs-export-btn');
        if (exportBtn) exportBtn.addEventListener('click', () => this._exportJSON());

        const exportTableBtn = document.getElementById('obs-export-table-btn');
        if (exportTableBtn) exportTableBtn.addEventListener('click', () => this._exportCSV());
    },

    _switchTab(tabId) {
        this._currentTab = tabId;
        document.querySelectorAll('.obs-tab').forEach((t) => {
            t.classList.toggle('active', t.dataset.obsTab === tabId);
        });
        document.querySelectorAll('.obs-tab-content').forEach((c) => {
            c.classList.remove('active');
        });
        const target = document.getElementById(`obs-tab-${tabId}`);
        if (target) target.classList.add('active');
    },

    _onMetrics({ all }) {
        if (!all || !all.metrics) {
            this._showNoData(true);
            return;
        }
        const metrics = all.metrics;
        if (Object.keys(metrics).length === 0) {
            this._showNoData(true);
            return;
        }
        this._showNoData(false);
        this._latestMetrics = metrics;

        const ageEl = document.getElementById('obs-scrape-age');
        if (ageEl && all.scrape_age_seconds != null) {
            ageEl.textContent = `Last scrape: ${all.scrape_age_seconds}s ago`;
        }

        this._renderOverview(metrics);
        this._renderAllMetricsTable();
        this._renderAlerts(metrics);
    },

    _showNoData(show) {
        const nd = document.getElementById('obs-overview-no-data');
        if (nd) nd.style.display = show ? 'block' : 'none';
    },

    // -- Overview tab -------------------------------------------------------

    _renderOverview(metrics) {
        const container = document.getElementById('obs-overview-cards');
        if (!container) return;

        const groups = groupByCategory(metrics);
        let html = '';

        for (const [catId, cat] of Object.entries(CATEGORIES)) {
            const items = groups[catId];
            if (!items || items.length === 0) continue;

            html += `<div class="obs-category-group">`;
            html += `<h3 class="obs-category-title">${this._escapeHtml(cat.title)}</h3>`;
            html += `<div class="obs-cards">`;

            for (const { key, entry, registry } of items) {
                const reg = registry || {};
                const value = entry.value ?? entry.p50 ?? null;
                const format = reg.format || this._guessFormat(entry);
                const formatted = formatMetricValue(value, format, reg.unit);
                const status = getThresholdStatus(value, reg.thresholds);
                const label = reg.label || key.replace('vllm:', '').replace(/_/g, ' ');
                const typeStr = entry.type || 'unknown';

                html += `<div class="obs-card">`;
                html += `  <span class="obs-card-label">${this._escapeHtml(label)}</span>`;
                html += `  <span class="obs-card-value status-${status}">${formatted}</span>`;
                html += `  <span class="obs-card-type">${typeStr}</span>`;
                html += `</div>`;
            }

            html += `</div></div>`;
        }

        const noData = document.getElementById('obs-overview-no-data');
        if (noData) noData.style.display = 'none';

        const existingGroups = container.querySelectorAll('.obs-category-group');
        existingGroups.forEach((g) => g.remove());
        container.insertAdjacentHTML('beforeend', html);
    },

    // -- Alerts -------------------------------------------------------------

    _renderAlerts(metrics) {
        const container = document.getElementById('obs-alerts');
        if (!container) return;

        let html = '';
        for (const [key, entry] of Object.entries(metrics)) {
            const reg = METRIC_REGISTRY[key];
            if (!reg || !reg.thresholds) continue;
            const value = entry.value ?? null;
            if (value == null) continue;
            const status = getThresholdStatus(value, reg.thresholds);
            if (status === 'ok') continue;

            const label = reg.label || key;
            const formatted = formatMetricValue(value, reg.format, reg.unit);
            const level = status === 'danger' ? 'danger' : 'warning';
            html += `<div class="obs-alert ${level}">
                <strong>${this._escapeHtml(label)}</strong>: ${formatted}
                (threshold: ${status === 'danger' ? reg.thresholds.danger : reg.thresholds.warning})
            </div>`;
        }
        container.innerHTML = html;
    },

    // -- All Metrics table --------------------------------------------------

    _renderAllMetricsTable() {
        const tbody = document.getElementById('obs-metrics-tbody');
        const countEl = document.getElementById('obs-metric-count');
        if (!tbody || !this._latestMetrics) return;

        let rows = [];
        for (const [key, entry] of Object.entries(this._latestMetrics)) {
            const reg = METRIC_REGISTRY[key] || null;
            const value = entry.value ?? entry.p50 ?? null;
            const type = entry.type || 'unknown';
            const labels = entry.labels || '';
            const catId = reg ? reg.category : 'other';
            const cat = CATEGORIES[catId] || CATEGORIES['other'];

            if (this._searchFilter) {
                const searchTarget = `${key} ${type} ${catId} ${cat.title} ${labels}`.toLowerCase();
                if (!searchTarget.includes(this._searchFilter)) continue;
            }

            rows.push({ key, value, type, labels, catId, catTitle: cat.title, reg });
        }

        rows.sort((a, b) => {
            let cmp = 0;
            switch (this._sortColumn) {
                case 'name':     cmp = a.key.localeCompare(b.key); break;
                case 'type':     cmp = a.type.localeCompare(b.type); break;
                case 'value':    cmp = (a.value ?? -Infinity) - (b.value ?? -Infinity); break;
                case 'category': cmp = a.catTitle.localeCompare(b.catTitle); break;
            }
            return this._sortAsc ? cmp : -cmp;
        });

        let html = '';
        for (const row of rows) {
            const fmt = row.reg ? row.reg.format : this._guessFormat(this._latestMetrics[row.key]);
            const formatted = formatMetricValue(row.value, fmt, row.reg?.unit);
            html += `<tr>
                <td class="metric-name">${this._escapeHtml(row.key)}</td>
                <td><span class="metric-badge ${row.type}">${row.type}</span></td>
                <td>${formatted}</td>
                <td>${this._escapeHtml(row.catTitle)}</td>
                <td>${this._escapeHtml(row.labels)}</td>
            </tr>`;
        }

        tbody.innerHTML = html;
        if (countEl) countEl.textContent = `${rows.length} metrics`;
    },

    _updateSortArrows() {
        document.querySelectorAll('#obs-metrics-table th[data-sort]').forEach((th) => {
            const arrow = th.querySelector('.sort-arrow');
            if (!arrow) return;
            if (th.dataset.sort === this._sortColumn) {
                arrow.textContent = this._sortAsc ? '▲' : '▼';
                arrow.classList.add('active');
            } else {
                arrow.textContent = '';
                arrow.classList.remove('active');
            }
        });
    },

    // -- Demo / Clear -------------------------------------------------------

    async _runDemo() {
        try {
            await fetch('/api/vllm/metrics/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    kv_cache_usage_perc: 45.2,
                    prefix_cache_hit_rate: 62.5,
                    num_preemptions: 2,
                    num_requests_running: 3,
                    num_requests_waiting: 1,
                    prefix_cache_hits: 1250,
                    prefix_cache_queries: 2000,
                    gpu_cache_usage_perc: 38.7,
                    spec_decode_accepted: 180,
                    spec_decode_draft: 320,
                    spec_decode_emitted: 150,
                }),
            });
            const badge = document.getElementById('obs-simulated-badge');
            if (badge) badge.classList.add('visible');
        } catch (err) {
            console.error('Demo simulation failed:', err);
        }
    },

    async _clearDemo() {
        try {
            await fetch('/api/vllm/metrics/simulate/reset', { method: 'POST' });
            const badge = document.getElementById('obs-simulated-badge');
            if (badge) badge.classList.remove('visible');
            this._latestMetrics = null;
            this._showNoData(true);
            const alerts = document.getElementById('obs-alerts');
            if (alerts) alerts.innerHTML = '';
            const tbody = document.getElementById('obs-metrics-tbody');
            if (tbody) tbody.innerHTML = '';
            const cards = document.getElementById('obs-overview-cards');
            if (cards) {
                cards.querySelectorAll('.obs-category-group').forEach((g) => g.remove());
            }
        } catch (err) {
            console.error('Clear failed:', err);
        }
    },

    // -- Export --------------------------------------------------------------

    _exportJSON() {
        if (!this._latestMetrics) return;
        const blob = new Blob(
            [JSON.stringify(this._latestMetrics, null, 2)],
            { type: 'application/json' }
        );
        this._download(blob, `vllm-metrics-${this._timestamp()}.json`);
    },

    _exportCSV() {
        if (!this._latestMetrics) return;
        const header = 'name,type,value,labels,category\n';
        let csv = header;
        for (const [key, entry] of Object.entries(this._latestMetrics)) {
            const reg = METRIC_REGISTRY[key];
            const cat = reg ? (CATEGORIES[reg.category]?.title || reg.category) : 'Other';
            const value = entry.value ?? entry.p50 ?? '';
            const type = entry.type || 'unknown';
            const labels = (entry.labels || '').replace(/"/g, '""');
            csv += `"${key}","${type}",${value},"${labels}","${cat}"\n`;
        }
        const blob = new Blob([csv], { type: 'text/csv' });
        this._download(blob, `vllm-metrics-${this._timestamp()}.csv`);
    },

    _download(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    },

    _timestamp() {
        return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    },

    // -- Utilities ----------------------------------------------------------

    _guessFormat(entry) {
        if (!entry) return 'number';
        const type = entry.type || '';
        if (type === 'histogram') return 'duration_ms';
        return 'number';
    },

    _escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    },
};

window.ObservabilityModule = ObservabilityModule;

export function initObservabilityModule(ui) {
    ObservabilityModule.ui = ui;
    ui.loadObservabilityTemplate = ObservabilityModule.loadTemplate.bind(ObservabilityModule);
    ui.onObservabilityViewActivated = ObservabilityModule.onViewActivated.bind(ObservabilityModule);
    ui.onObservabilityViewDeactivated = ObservabilityModule.onViewDeactivated.bind(ObservabilityModule);
}

export default ObservabilityModule;
