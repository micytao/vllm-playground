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
    _uplotChart: null,
    _tsMinutes: 5,
    _tsSelectedMetrics: new Set(),
    _tsHistory: [],
    _alertedMetrics: new Set(),
    _alertHistory: [],
    _customThresholds: null,
    _lastScrapeLocalRef: null,
    _prevScrapeAge: null,

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

            this._loadAlertThresholds();
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

        // Time Series controls
        document.querySelectorAll('.obs-ts-range').forEach((btn) => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.obs-ts-range').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                this._tsMinutes = parseInt(btn.dataset.minutes, 10);
                this._loadTimeSeries();
            });
        });

        const exportTsBtn = document.getElementById('obs-export-ts-btn');
        if (exportTsBtn) exportTsBtn.addEventListener('click', () => this._exportTimeSeries());

        // Latency export
        const exportLatBtn = document.getElementById('obs-export-latency-btn');
        if (exportLatBtn) exportLatBtn.addEventListener('click', () => this._exportLatency());

        // Alert settings
        const alertSettingsBtn = document.getElementById('obs-alerts-settings-btn');
        if (alertSettingsBtn) alertSettingsBtn.addEventListener('click', () => this._showAlertSettings());
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

        if (tabId === 'time-series') {
            this._initTsPicker();
            this._loadTimeSeries();
        }
        if (tabId === 'latency' && this._latestMetrics) {
            this._renderLatency(this._latestMetrics);
        }
    },

    _onMetrics({ all }) {
        const source = (all && all.source) || 'none';
        this._updateDemoButtons(source);

        if (!all || !all.metrics) {
            this._showNoData(true, all);
            return;
        }
        const metrics = all.metrics;
        if (Object.keys(metrics).length === 0) {
            this._showNoData(true, all);
            return;
        }
        this._showNoData(false, all);
        this._latestMetrics = metrics;

        const ageEl = document.getElementById('obs-scrape-age');
        if (ageEl && all.scrape_age_seconds != null) {
            const serverAge = all.scrape_age_seconds;
            if (this._prevScrapeAge === null || serverAge < this._prevScrapeAge - 1) {
                this._lastScrapeLocalRef = Date.now() - serverAge * 1000;
            }
            this._prevScrapeAge = serverAge;
            const localAge = ((Date.now() - this._lastScrapeLocalRef) / 1000).toFixed(1);
            ageEl.textContent = `Last scrape: ${localAge}s ago`;
        }

        this._renderOverview(metrics);
        this._renderAllMetricsTable();
        this._renderAlerts(metrics);

        if (this._currentTab === 'time-series' && this._uplotChart) {
            this._appendLivePoint(metrics);
        }
        if (this._currentTab === 'latency') {
            this._renderLatency(metrics);
        }
    },

    _showNoData(show, allData) {
        const nd = document.getElementById('obs-overview-no-data');
        const remoteNd = document.getElementById('obs-remote-no-data');
        const isRemoteNoMetrics = allData?.run_mode === 'remote' && allData?.source === 'none';

        if (show && isRemoteNoMetrics) {
            if (nd) nd.style.display = 'none';
            if (remoteNd) remoteNd.style.display = 'block';
        } else if (show) {
            if (nd) nd.style.display = 'block';
            if (remoteNd) remoteNd.style.display = 'none';
        } else {
            if (nd) nd.style.display = 'none';
            if (remoteNd) remoteNd.style.display = 'none';
        }
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
                const format = reg.format || this._guessFormat(key, entry);
                const formatted = formatMetricValue(value, format, reg.unit);
                const thresholds = this._getThresholds(key);
                const status = getThresholdStatus(value, thresholds);
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

    _getThresholds(key) {
        if (this._customThresholds && this._customThresholds[key]) {
            return this._customThresholds[key];
        }
        const reg = METRIC_REGISTRY[key];
        return reg ? reg.thresholds : null;
    },

    _loadAlertThresholds() {
        try {
            const stored = localStorage.getItem('obs-alert-thresholds');
            if (stored) this._customThresholds = JSON.parse(stored);
        } catch { /* ignore */ }
    },

    _saveAlertThresholds() {
        try {
            localStorage.setItem('obs-alert-thresholds', JSON.stringify(this._customThresholds));
        } catch { /* ignore */ }
    },

    _renderAlerts(metrics) {
        const container = document.getElementById('obs-alerts');
        if (!container) return;

        let html = '';
        for (const [key, entry] of Object.entries(metrics)) {
            const reg = METRIC_REGISTRY[key];
            if (!reg) continue;
            const thresholds = this._getThresholds(key);
            if (!thresholds) continue;
            const value = entry.value ?? null;
            if (value == null) continue;
            const status = getThresholdStatus(value, thresholds);
            if (status === 'ok') {
                this._alertedMetrics.delete(key);
                continue;
            }

            const label = reg.label || key;
            const formatted = formatMetricValue(value, reg.format, reg.unit);
            const level = status === 'danger' ? 'danger' : 'warning';
            const threshVal = status === 'danger' ? thresholds.danger : thresholds.warning;
            const threshDisplay = reg.format === 'percent' ? `${(threshVal * 100).toFixed(0)}%` : threshVal;
            html += `<div class="obs-alert ${level}">
                <strong>${this._escapeHtml(label)}</strong>: ${formatted}
                (threshold: ${threshDisplay})
            </div>`;

            if (!this._alertedMetrics.has(key)) {
                this._alertedMetrics.add(key);
                if (this.ui && this.ui.showNotification) {
                    this.ui.showNotification(
                        `${label}: ${formatted} (${level})`,
                        level === 'danger' ? 'error' : 'warning',
                        5000
                    );
                }
                this._alertHistory.unshift({
                    time: new Date(),
                    label,
                    formatted,
                    level,
                });
                if (this._alertHistory.length > 20) this._alertHistory.pop();
            }
        }
        container.innerHTML = html;
        this._renderAlertHistory();
    },

    _renderAlertHistory() {
        const container = document.getElementById('obs-alert-history');
        const list = document.getElementById('obs-alert-history-list');
        if (!container || !list) return;

        if (this._alertHistory.length === 0) {
            container.style.display = 'none';
            return;
        }
        container.style.display = '';
        let html = '';
        for (const a of this._alertHistory) {
            const t = a.time;
            const ts = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
            html += `<div class="obs-alert-history-item ${a.level}">
                <span class="alert-time">${ts}</span>
                <strong>${this._escapeHtml(a.label)}</strong>: ${a.formatted}
            </div>`;
        }
        list.innerHTML = html;
    },

    _showAlertSettings() {
        let overlay = document.getElementById('obs-alert-settings-overlay');
        if (overlay) {
            overlay.classList.toggle('visible');
            return;
        }

        overlay = document.createElement('div');
        overlay.id = 'obs-alert-settings-overlay';
        overlay.className = 'obs-alert-settings visible';
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('visible');
        });

        const thresholdMetrics = Object.entries(METRIC_REGISTRY).filter(([, r]) => r.thresholds);
        let rows = '';
        for (const [key, reg] of thresholdMetrics) {
            const t = this._getThresholds(key) || reg.thresholds;
            const isPct = reg.format === 'percent';
            const warnDisplay = isPct ? (t.warning * 100) : t.warning;
            const dangerDisplay = isPct ? (t.danger * 100) : t.danger;
            const suffix = isPct ? '%' : '';
            rows += `<tr>
                <td>${this._escapeHtml(reg.label)}${suffix ? ` (${suffix})` : ''}</td>
                <td><input type="number" data-key="${key}" data-level="warning" data-pct="${isPct}" value="${warnDisplay}" /></td>
                <td><input type="number" data-key="${key}" data-level="danger" data-pct="${isPct}" value="${dangerDisplay}" /></td>
            </tr>`;
        }

        overlay.innerHTML = `<div class="obs-alert-settings-panel">
            <h3>Alert Thresholds</h3>
            <table>
                <thead><tr><th>Metric</th><th>Warning</th><th>Danger</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <div style="margin-top:16px; display:flex; gap:8px; justify-content:flex-end;">
                <button class="obs-btn" id="obs-alert-reset-btn">Reset Defaults</button>
                <button class="obs-btn obs-btn-primary" id="obs-alert-save-btn">Save</button>
            </div>
        </div>`;

        document.body.appendChild(overlay);

        document.getElementById('obs-alert-save-btn').addEventListener('click', () => {
            if (!this._customThresholds) this._customThresholds = {};
            overlay.querySelectorAll('input[type="number"]').forEach((inp) => {
                const key = inp.dataset.key;
                const level = inp.dataset.level;
                const isPct = inp.dataset.pct === 'true';
                if (!this._customThresholds[key]) {
                    const reg = METRIC_REGISTRY[key];
                    this._customThresholds[key] = { ...reg.thresholds };
                }
                let val = parseFloat(inp.value);
                if (isPct) val = val / 100;
                this._customThresholds[key][level] = val;
            });
            this._saveAlertThresholds();
            overlay.classList.remove('visible');
        });

        document.getElementById('obs-alert-reset-btn').addEventListener('click', () => {
            this._customThresholds = null;
            localStorage.removeItem('obs-alert-thresholds');
            overlay.querySelectorAll('input[type="number"]').forEach((inp) => {
                const reg = METRIC_REGISTRY[inp.dataset.key];
                if (reg && reg.thresholds) {
                    const isPct = inp.dataset.pct === 'true';
                    const raw = reg.thresholds[inp.dataset.level];
                    inp.value = isPct ? raw * 100 : raw;
                }
            });
        });
    },

    // -- All Metrics table --------------------------------------------------

    _renderAllMetricsTable() {
        const tbody = document.getElementById('obs-metrics-tbody');
        const countEl = document.getElementById('obs-metric-count');
        if (!tbody || !this._latestMetrics) return;

        let rows = [];
        for (const [key, entry] of Object.entries(this._latestMetrics)) {
            if (entry.type === 'histogram_bucket') continue;

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
            const fmt = row.reg ? row.reg.format : this._guessFormat(row.key, this._latestMetrics[row.key]);
            const formatted = formatMetricValue(row.value, fmt, row.reg?.unit);
            html += `<tr>
                <td class="metric-name">${this._escapeHtml(row.key)}</td>
                <td><span class="metric-badge ${row.type}">${row.type}</span></td>
                <td>${formatted}</td>
                <td>${this._escapeHtml(row.catTitle)}</td>
                <td class="metric-labels">${this._escapeHtml(row.labels)}</td>
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

    // -- Time Series tab ----------------------------------------------------

    _initTsPicker() {
        const picker = document.getElementById('obs-ts-picker');
        if (!picker || picker.children.length > 0) return;

        const defaultMetrics = [
            'vllm:kv_cache_usage_perc',
            'vllm:num_requests_running',
            'vllm:avg_generation_throughput_toks_per_s',
        ];
        this._tsSelectedMetrics = new Set(defaultMetrics);

        const allKeys = Object.keys(METRIC_REGISTRY).filter((k) => {
            const r = METRIC_REGISTRY[k];
            return r.format !== 'duration_ms';
        });

        let html = '';
        for (const key of allKeys) {
            const reg = METRIC_REGISTRY[key];
            const checked = defaultMetrics.includes(key) ? 'checked' : '';
            html += `<label><input type="checkbox" value="${key}" ${checked} /> ${this._escapeHtml(reg.label)}</label>`;
        }
        picker.innerHTML = html;

        picker.addEventListener('change', (e) => {
            if (e.target.type !== 'checkbox') return;
            if (e.target.checked) {
                this._tsSelectedMetrics.add(e.target.value);
            } else {
                this._tsSelectedMetrics.delete(e.target.value);
            }
            this._buildChart();
        });
    },

    async _loadTimeSeries() {
        const noData = document.getElementById('obs-ts-no-data');
        try {
            this._tsHistory = await metricsPoller.getHistory(this._tsMinutes);
        } catch {
            this._tsHistory = [];
        }
        if (this._tsHistory.length === 0) {
            if (noData) noData.style.display = '';
            const wrap = document.getElementById('obs-ts-chart-wrap');
            if (wrap) wrap.style.display = 'none';
            return;
        }
        if (noData) noData.style.display = 'none';
        const wrap = document.getElementById('obs-ts-chart-wrap');
        if (wrap) wrap.style.display = '';
        this._buildChart();
    },

    _buildChart() {
        const wrap = document.getElementById('obs-ts-chart-wrap');
        if (!wrap) return;

        if (this._uplotChart) {
            this._uplotChart.destroy();
            this._uplotChart = null;
        }

        const selected = [...this._tsSelectedMetrics];
        if (selected.length === 0 || this._tsHistory.length === 0) return;

        const timestamps = this._tsHistory.map((s) => {
            const d = new Date(s.timestamp);
            return d.getTime() / 1000;
        });

        const series = [{ label: 'Time' }];
        const data = [timestamps];

        const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];

        for (let i = 0; i < selected.length; i++) {
            const key = selected[i];
            const reg = METRIC_REGISTRY[key] || {};
            series.push({
                label: reg.label || key.replace('vllm:', ''),
                stroke: colors[i % colors.length],
                width: 2,
            });
            data.push(this._tsHistory.map((s) => {
                const v = s[key];
                return v != null ? v : null;
            }));
        }

        const width = wrap.clientWidth - 16;
        const height = Math.max(280, wrap.clientHeight - 16);

        const opts = {
            width,
            height,
            series,
            axes: [
                { stroke: '#888', grid: { stroke: 'rgba(255,255,255,0.06)' } },
                { stroke: '#888', grid: { stroke: 'rgba(255,255,255,0.06)' } },
            ],
            cursor: { sync: { key: 'obs' } },
            scales: { x: { time: true } },
        };

        wrap.innerHTML = '';
        try {
            this._uplotChart = new uPlot(opts, data, wrap);
        } catch (e) {
            console.error('uPlot init error:', e);
            wrap.innerHTML = `<div style="padding:20px;color:var(--text-secondary)">Chart error: ${e.message}</div>`;
        }
    },

    _appendLivePoint(metrics) {
        if (!this._uplotChart || this._tsSelectedMetrics.size === 0) return;
        const now = Date.now() / 1000;
        const selected = [...this._tsSelectedMetrics];

        const newData = this._uplotChart.data.map((arr) => [...arr]);
        newData[0].push(now);

        for (let i = 0; i < selected.length; i++) {
            const key = selected[i];
            const entry = metrics[key];
            const val = entry ? (entry.value ?? entry.p50 ?? null) : null;
            newData[i + 1].push(val);
        }

        const cutoff = now - this._tsMinutes * 60;
        let start = 0;
        while (start < newData[0].length && newData[0][start] < cutoff) start++;
        if (start > 0) {
            for (let i = 0; i < newData.length; i++) {
                newData[i] = newData[i].slice(start);
            }
        }

        this._uplotChart.setData(newData);
    },

    // -- Latency tab --------------------------------------------------------

    _renderLatency(metrics) {
        const summaryEl = document.getElementById('obs-latency-summary');
        const histEl = document.getElementById('obs-latency-histograms');
        const noData = document.getElementById('obs-latency-no-data');
        if (!summaryEl || !histEl) return;

        const latencyMetrics = Object.entries(METRIC_REGISTRY)
            .filter(([, r]) => r.histogramDisplay)
            .map(([key, reg]) => ({ key, reg, entry: metrics[key] }))
            .filter(({ entry }) => entry);

        if (latencyMetrics.length === 0) {
            if (noData) noData.style.display = '';
            summaryEl.innerHTML = '';
            histEl.innerHTML = '';
            return;
        }
        if (noData) noData.style.display = 'none';

        const percentiles = ['p50', 'p95', 'p99'];

        const globalMaxSec = Math.max(
            ...latencyMetrics.map(({ entry }) =>
                Math.max(...percentiles.map(p => entry[p] ?? 0))
            ), 0.001
        );

        let tableHtml = `<table class="obs-latency-table">
            <thead><tr>
                <th style="width:22%">Metric</th>
                ${percentiles.map(p => `<th style="width:13%">${p.toUpperCase()}</th>`).join('')}
                <th style="width:39%">Distribution</th>
            </tr></thead><tbody>`;

        for (const { key, reg, entry } of latencyMetrics) {
            tableHtml += `<tr><td>${this._escapeHtml(reg.label)}</td>`;
            for (const p of percentiles) {
                const val = entry[p];
                if (val == null) {
                    tableHtml += `<td>--</td>`;
                } else {
                    const ms = val * 1000;
                    const display = this._formatMs(ms);
                    const cls = ms > 2000 ? 'obs-latency-val-bad'
                              : ms > 500  ? 'obs-latency-val-warn'
                              : 'obs-latency-val-good';
                    tableHtml += `<td class="${cls}">${display}</td>`;
                }
            }

            const p50 = entry.p50 ?? 0;
            const p95 = entry.p95 ?? 0;
            const p99 = entry.p99 ?? 0;
            const scale = globalMaxSec * 1.05;
            const p50Pct = (p50 / scale) * 100;
            const p95Pct = (p95 / scale) * 100;
            const p99Pct = (p99 / scale) * 100;
            const fillPct = Math.min(p99Pct + 2, 100);

            tableHtml += `<td class="obs-pct-bar-cell">
                <div class="obs-pct-bar">
                    <div class="obs-pct-bar-fill" style="width:${fillPct.toFixed(1)}%"></div>
                    <div class="obs-pct-pin obs-pct-pin-p50" style="left:${p50Pct.toFixed(1)}%"
                         title="p50: ${this._formatMs(p50 * 1000)}"></div>
                    <div class="obs-pct-pin obs-pct-pin-p95" style="left:${p95Pct.toFixed(1)}%"
                         title="p95: ${this._formatMs(p95 * 1000)}"></div>
                    <div class="obs-pct-pin obs-pct-pin-p99" style="left:${p99Pct.toFixed(1)}%"
                         title="p99: ${this._formatMs(p99 * 1000)}"></div>
                </div>
            </td>`;
            tableHtml += `</tr>`;
        }
        tableHtml += `</tbody></table>`;
        summaryEl.innerHTML = tableHtml;

        let histHtml = '';
        for (const { key, reg } of latencyMetrics) {
            const bucketKey = key + '_bucket';
            const rawBuckets = Object.entries(metrics)
                .filter(([k]) => k.startsWith(bucketKey))
                .map(([, e]) => ({
                    le: e.labels ? this._extractLeRaw(e.labels) : Infinity,
                    leLabel: e.labels ? this._extractLe(e.labels) : 'Inf',
                    count: e.value || 0,
                }))
                .sort((a, b) => a.le - b.le);

            if (rawBuckets.length === 0) continue;

            const diffBuckets = [];
            let prevCount = 0;
            let prevLabel = '0';
            for (const b of rawBuckets) {
                const diff = Math.max(b.count - prevCount, 0);
                const rangeLabel = b.le === Infinity
                    ? `> ${prevLabel}`
                    : `${prevLabel} \u2013 ${b.leLabel}`;
                diffBuckets.push({ range: rangeLabel, count: diff, le: b.le });
                prevCount = b.count;
                prevLabel = b.leLabel;
            }

            const total = prevCount || 1;
            const maxDiff = Math.max(...diffBuckets.map(d => d.count), 1);
            const peakCount = maxDiff;

            histHtml += `<div class="obs-histogram-group">
                <div class="obs-diff-hist-title">${this._escapeHtml(reg.label)} Distribution</div>`;

            for (const d of diffBuckets) {
                if (d.count === 0 && d.le === Infinity) continue;
                const barPct = (d.count / maxDiff) * 100;
                const freqPct = ((d.count / total) * 100).toFixed(0);
                const isPeak = d.count === peakCount && d.count > 0;
                histHtml += `<div class="obs-diff-bar-row">
                    <span class="obs-diff-range">${d.range}</span>
                    <div class="obs-diff-bar-bg">
                        <div class="obs-diff-bar-fill${isPeak ? ' peak' : ''}" style="width:${barPct.toFixed(1)}%"></div>
                    </div>
                    <span class="obs-diff-count">${d.count}</span>
                    <span class="obs-diff-pct">${freqPct}%</span>
                </div>`;
            }
            histHtml += `</div>`;
        }
        histEl.innerHTML = histHtml;
    },

    _formatMs(ms) {
        if (ms < 1) return `${(ms * 1000).toFixed(0)} \u00b5s`;
        if (ms < 1000) return `${ms.toFixed(1)} ms`;
        return `${(ms / 1000).toFixed(2)} s`;
    },

    _extractLeRaw(labels) {
        const match = labels.match(/le="([^"]+)"/);
        if (!match) return Infinity;
        if (match[1] === '+Inf') return Infinity;
        return parseFloat(match[1]);
    },

    _extractLe(labels) {
        const match = labels.match(/le="([^"]+)"/);
        if (!match) return '?';
        const val = match[1];
        if (val === '+Inf') return 'Inf';
        const num = parseFloat(val);
        if (num < 0.001) return `${(num * 1e6).toFixed(0)}us`;
        if (num < 1) return `${(num * 1000).toFixed(0)}ms`;
        return `${num.toFixed(1)}s`;
    },

    // -- Demo / Clear -------------------------------------------------------

    _updateDemoButtons(source) {
        const demoBtn = document.getElementById('obs-demo-btn');
        const clearBtn = document.getElementById('obs-clear-btn');
        if (demoBtn) demoBtn.disabled = source !== 'none';
        if (clearBtn) clearBtn.disabled = source !== 'simulated';
    },

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
            this._alertHistory = [];
            this._alertedMetrics.clear();
            this._lastScrapeLocalRef = null;
            this._prevScrapeAge = null;
            this._showNoData(true, null);
            const alerts = document.getElementById('obs-alerts');
            if (alerts) alerts.innerHTML = '';
            this._renderAlertHistory();
            const tbody = document.getElementById('obs-metrics-tbody');
            if (tbody) tbody.innerHTML = '';
            const cards = document.getElementById('obs-overview-cards');
            if (cards) {
                cards.querySelectorAll('.obs-category-group').forEach((g) => g.remove());
            }
            if (this._uplotChart) {
                this._uplotChart.destroy();
                this._uplotChart = null;
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

    _exportTimeSeries() {
        if (!this._tsHistory || this._tsHistory.length === 0) return;
        const blob = new Blob(
            [JSON.stringify(this._tsHistory, null, 2)],
            { type: 'application/json' }
        );
        this._download(blob, `vllm-timeseries-${this._timestamp()}.json`);
    },

    _exportLatency() {
        if (!this._latestMetrics) return;
        const latencyData = {};
        for (const [key, reg] of Object.entries(METRIC_REGISTRY)) {
            if (!reg.histogramDisplay) continue;
            const entry = this._latestMetrics[key];
            if (!entry) continue;
            latencyData[key] = {
                label: reg.label,
                p50: entry.p50,
                p95: entry.p95,
                p99: entry.p99,
            };
        }
        const blob = new Blob(
            [JSON.stringify(latencyData, null, 2)],
            { type: 'application/json' }
        );
        this._download(blob, `vllm-latency-${this._timestamp()}.json`);
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

    _guessFormat(key, entry) {
        if (!entry) return 'number';
        const type = entry.type || '';
        if (type === 'histogram') {
            const k = (key || '').toLowerCase();
            if (/seconds|latency|time/.test(k)) return 'duration_ms';
            return 'number';
        }
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
