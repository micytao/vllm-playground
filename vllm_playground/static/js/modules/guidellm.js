// =============================================================================
// GuideLLM Module
// Handles GuideLLM benchmarking functionality
// =============================================================================

/**
 * Initialize the GuideLLM module
 * @param {VLLMWebUI} ui - The main UI instance
 */
export function initGuideLLMModule(ui) {
    // Store reference to UI
    GuideLLMModule.ui = ui;

    // Inject methods into UI class
    injectMethods(ui);

    // Use already-fetched availability from UI (set in checkFeatureAvailability)
    GuideLLMModule.available = ui.guidellmAvailable;

    // Update status indicator with the already-known state
    GuideLLMModule.updateStatusIndicator();

    // Setup benchmark event listeners
    GuideLLMModule.setupBenchmarkListeners();

    // Initialize benchmark command preview
    ui.updateBenchmarkCommandPreview();

    console.log('GuideLLM module initialized');
}

/**
 * Inject GuideLLM methods into the UI class
 */
function injectMethods(ui) {
    // Benchmark control methods
    ui.runBenchmark = GuideLLMModule.runBenchmark.bind(GuideLLMModule);
    ui.stopBenchmark = GuideLLMModule.stopBenchmark.bind(GuideLLMModule);
    ui.pollBenchmarkStatus = GuideLLMModule.pollBenchmarkStatus.bind(GuideLLMModule);
    ui.displayBenchmarkResults = GuideLLMModule.displayBenchmarkResults.bind(GuideLLMModule);
    ui.displayBenchmarkTable = GuideLLMModule.displayBenchmarkTable.bind(GuideLLMModule);
    ui.resetBenchmarkUI = GuideLLMModule.resetBenchmarkUI.bind(GuideLLMModule);

    // Benchmark server status
    ui.updateBenchmarkServerStatus = GuideLLMModule.updateBenchmarkServerStatus.bind(GuideLLMModule);

    // Command preview and copy methods
    ui.updateBenchmarkCommandPreview = GuideLLMModule.updateBenchmarkCommandPreview.bind(GuideLLMModule);
    ui.copyBenchmarkCommand = GuideLLMModule.copyBenchmarkCommand.bind(GuideLLMModule);
    ui.copyGuidellmOutput = GuideLLMModule.copyGuidellmOutput.bind(GuideLLMModule);
    ui.copyGuidellmJson = GuideLLMModule.copyGuidellmJson.bind(GuideLLMModule);

    // Toggle methods
    ui.toggleRawOutput = GuideLLMModule.toggleRawOutput.bind(GuideLLMModule);
    ui.toggleJsonOutput = GuideLLMModule.toggleJsonOutput.bind(GuideLLMModule);
}

/**
 * GuideLLM Module object with all methods
 */
export const GuideLLMModule = {
    ui: null,
    available: false,
    version: null,

    // =========================================================================
    // Status Indicator
    // =========================================================================

    initStatusIndicator() {
        const statusContainer = document.getElementById('guidellm-status');
        if (!statusContainer) {
            console.warn('GuideLLM status container not found');
            return;
        }

        statusContainer.innerHTML = `
            <span class="icon-guidellm"></span>
            <span class="status-dot"></span>
            <span class="status-text">Checking...</span>
        `;
        statusContainer.className = 'guidellm-status-indicator';
    },

    async checkAvailability() {
        try {
            const response = await fetch('/api/features');
            if (!response.ok) throw new Error('Failed to fetch features');

            const data = await response.json();
            this.available = data.guidellm_available || false;
            this.version = data.guidellm_version || null;

            this.updateStatusIndicator();

            if (this.ui) {
                this.ui.guidellmAvailable = this.available;
            }
        } catch (error) {
            console.error('Failed to check GuideLLM availability:', error);
            this.available = false;
            this.updateStatusIndicator();
        }
    },

    updateStatusIndicator() {
        const statusContainer = document.getElementById('guidellm-status');
        const installWarning = document.getElementById('guidellm-install-warning');
        const metricsContent = document.getElementById('metrics-section-content');

        if (this.available) {
            // Update status indicator
            if (statusContainer) {
                statusContainer.className = 'guidellm-status-indicator available';
                statusContainer.innerHTML = '<span>✅ GuideLLM Ready</span>';
                statusContainer.title = this.version
                    ? `GuideLLM v${this.version} installed`
                    : 'GuideLLM installed and ready';
            }
            // Hide warning, show content
            if (installWarning) installWarning.style.display = 'none';
            if (metricsContent) metricsContent.style.display = 'block';
        } else {
            // Update status indicator
            if (statusContainer) {
                statusContainer.className = 'guidellm-status-indicator unavailable';
                statusContainer.innerHTML = '<span>❌ Not Installed</span>';
                statusContainer.title = 'pip install "vllm-playground[benchmark]"';
            }
            // Show warning (content still visible for built-in benchmark)
            if (installWarning) installWarning.style.display = 'flex';
            if (metricsContent) metricsContent.style.display = 'block';
        }
    },

    // =========================================================================
    // Event Listeners Setup
    // =========================================================================

    setupBenchmarkListeners() {
        const ui = this.ui;
        if (!ui || !ui.elements) return;

        // Run/Stop buttons
        if (ui.elements.runBenchmarkBtn) {
            ui.elements.runBenchmarkBtn.addEventListener('click', () => ui.runBenchmark());
        }
        if (ui.elements.stopBenchmarkBtn) {
            ui.elements.stopBenchmarkBtn.addEventListener('click', () => ui.stopBenchmark());
        }

        // Benchmark config changes - update command preview
        const benchmarkConfigElements = [
            ui.elements.benchmarkRequests,
            ui.elements.benchmarkRate,
            ui.elements.benchmarkPromptTokens,
            ui.elements.benchmarkOutputTokens,
            ui.elements.host,
            ui.elements.port
        ].filter(el => el);

        benchmarkConfigElements.forEach(element => {
            element.addEventListener('input', () => ui.updateBenchmarkCommandPreview());
            element.addEventListener('change', () => ui.updateBenchmarkCommandPreview());
        });

        // Benchmark method toggle
        if (ui.elements.benchmarkMethodBuiltin) {
            ui.elements.benchmarkMethodBuiltin.addEventListener('change', () => ui.updateBenchmarkCommandPreview());
        }
        if (ui.elements.benchmarkMethodGuidellm) {
            ui.elements.benchmarkMethodGuidellm.addEventListener('change', () => ui.updateBenchmarkCommandPreview());
        }

        // Copy buttons
        if (ui.elements.copyBenchmarkCommandBtn) {
            ui.elements.copyBenchmarkCommandBtn.addEventListener('click', () => ui.copyBenchmarkCommand());
        }
        if (ui.elements.copyGuidellmOutputBtn) {
            ui.elements.copyGuidellmOutputBtn.addEventListener('click', () => ui.copyGuidellmOutput());
        }
        if (ui.elements.copyGuidellmJsonBtn) {
            ui.elements.copyGuidellmJsonBtn.addEventListener('click', () => ui.copyGuidellmJson());
        }

        // Toggle buttons
        if (ui.elements.toggleRawOutputBtn) {
            ui.elements.toggleRawOutputBtn.addEventListener('click', () => ui.toggleRawOutput());
        }
        if (ui.elements.toggleJsonOutputBtn) {
            ui.elements.toggleJsonOutputBtn.addEventListener('click', () => ui.toggleJsonOutput());
        }
    },

    // =========================================================================
    // Benchmark Server Status
    // =========================================================================

    updateBenchmarkServerStatus() {
        const ui = this.ui;
        const statusBanner = document.getElementById('benchmark-server-status');
        if (!statusBanner) return;

        const isRemote = ui.currentConfig && ui.currentConfig.run_mode === 'remote';

        if (ui.serverRunning && ui.serverReady) {
            statusBanner.classList.add('connected');
            const modeLabel = isRemote ? 'Connected to remote vLLM instance' : 'vLLM server is running';
            statusBanner.innerHTML = `
                <div class="server-status-content">
                    <span class="status-icon">✅</span>
                    <span class="status-message">${modeLabel} — ready for benchmarks</span>
                </div>
            `;
        } else if (ui.serverRunning) {
            statusBanner.classList.remove('connected');
            statusBanner.innerHTML = `
                <div class="server-status-content">
                    <span class="status-icon">⏳</span>
                    <span class="status-message">Server is starting... please wait</span>
                </div>
            `;
        } else {
            statusBanner.classList.remove('connected');
            statusBanner.innerHTML = `
                <div class="server-status-content">
                    <span class="status-icon">⚠️</span>
                    <span class="status-message">Start the vLLM server first to run benchmarks</span>
                    <button class="btn btn-primary btn-sm" onclick="window.vllmUI.switchView('vllm-server')">Go to Server →</button>
                </div>
            `;
        }

        // Refresh command preview so it reflects the current target URL
        this.updateBenchmarkCommandPreview();
    },

    // =========================================================================
    // Benchmark Execution
    // =========================================================================

    async runBenchmark() {
        const ui = this.ui;

        if (!ui.serverRunning) {
            ui.showNotification('Server must be running to benchmark', 'warning');
            return;
        }

        const config = {
            total_requests: parseInt(ui.elements.benchmarkRequests.value),
            request_rate: parseFloat(ui.elements.benchmarkRate.value),
            prompt_tokens: parseInt(ui.elements.benchmarkPromptTokens.value),
            output_tokens: parseInt(ui.elements.benchmarkOutputTokens.value),
            use_guidellm: ui.elements.benchmarkMethodGuidellm.checked
        };

        ui.benchmarkRunning = true;
        ui.benchmarkStartTime = Date.now();
        ui.elements.runBenchmarkBtn.disabled = true;
        ui.elements.runBenchmarkBtn.style.display = 'none';
        ui.elements.stopBenchmarkBtn.disabled = false;
        ui.elements.stopBenchmarkBtn.style.display = 'inline-block';

        // Hide placeholder, show progress
        ui.elements.metricsDisplay.style.display = 'none';
        ui.elements.metricsGrid.style.display = 'none';
        ui.elements.benchmarkProgress.style.display = 'block';

        try {
            const response = await fetch('/api/benchmark/start', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(config)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to start benchmark');
            }

            // Start polling for status
            ui.benchmarkPollInterval = setInterval(() => ui.pollBenchmarkStatus(), 1000);

        } catch (err) {
            console.error('Failed to start benchmark:', err);
            ui.showNotification(`Failed to start benchmark: ${err.message}`, 'error');
            ui.resetBenchmarkUI();
        }
    },

    async stopBenchmark() {
        const ui = this.ui;

        try {
            await fetch('/api/benchmark/stop', {method: 'POST'});
            ui.showNotification('Benchmark stopped', 'info');
        } catch (err) {
            console.error('Failed to stop benchmark:', err);
        }
        ui.resetBenchmarkUI();
    },

    async pollBenchmarkStatus() {
        const ui = this.ui;

        try {
            const response = await fetch('/api/benchmark/status');
            const data = await response.json();

            console.log('[POLL] Benchmark status:', data);

            if (data.running) {
                // GuideLLM doesn't output real-time progress, so we estimate based on time
                const elapsed = Date.now() - ui.benchmarkStartTime;
                const estimated = (ui.elements.benchmarkRequests.value / ui.elements.benchmarkRate.value) * 1000;

                let progress;
                if (elapsed < estimated) {
                    progress = (elapsed / estimated) * 90;
                } else {
                    const overtime = elapsed - estimated;
                    const slowProgress = 90 + (Math.min(overtime / estimated, 1) * 8);
                    progress = Math.min(98, slowProgress);
                }

                ui.elements.progressFill.style.width = `${progress}%`;
                ui.elements.progressPercent.textContent = `${progress.toFixed(0)}%`;
            } else {
                // Benchmark complete
                clearInterval(ui.benchmarkPollInterval);
                ui.benchmarkPollInterval = null;

                if (data.results) {
                    console.log('[POLL] Benchmark completed with results');
                    ui.displayBenchmarkResults(data.results);
                    ui.showNotification('Benchmark completed!', 'success');
                } else {
                    console.error('[POLL] Benchmark completed but no results:', data);
                    ui.showNotification('Benchmark failed', 'error');
                }

                ui.resetBenchmarkUI();
            }
        } catch (err) {
            console.error('Failed to poll benchmark status:', err);
        }
    },

    resetBenchmarkUI() {
        const ui = this.ui;

        ui.benchmarkRunning = false;
        ui.elements.runBenchmarkBtn.disabled = !ui.serverRunning;
        ui.elements.runBenchmarkBtn.style.display = 'inline-block';
        ui.elements.stopBenchmarkBtn.disabled = true;
        ui.elements.stopBenchmarkBtn.style.display = 'none';
        ui.elements.progressFill.style.width = '0%';
        ui.elements.progressPercent.textContent = '0%';

        if (ui.benchmarkPollInterval) {
            clearInterval(ui.benchmarkPollInterval);
            ui.benchmarkPollInterval = null;
        }
    },

    // =========================================================================
    // Results Display
    // =========================================================================

    displayBenchmarkResults(results) {
        const ui = this.ui;

        // Hide progress
        ui.elements.benchmarkProgress.style.display = 'none';

        const isGuideLLM = results.raw_output && results.raw_output.length > 0;

        console.log('=== BENCHMARK RESULTS DEBUG ===');
        console.log('Is GuideLLM:', isGuideLLM);
        console.log('==============================');

        if (isGuideLLM) {
            // GuideLLM: Show raw output, hide metrics
            ui.elements.metricsGrid.style.display = 'none';
            const rawOutputSection = document.getElementById('guidellm-raw-output-section');
            const rawOutputTextarea = document.getElementById('guidellm-raw-output');
            const rawOutputContent = ui.elements.guidellmRawOutputContent;
            const toggleBtn = ui.elements.toggleRawOutputBtn;
            const jsonOutputSection = document.getElementById('guidellm-json-output-section');
            const jsonOutputPre = document.getElementById('guidellm-json-output');

            if (rawOutputSection && rawOutputTextarea) {
                rawOutputTextarea.value = results.raw_output;
                rawOutputSection.style.display = 'block';
                if (rawOutputContent) rawOutputContent.style.display = 'block';
                if (toggleBtn) toggleBtn.textContent = 'Hide';
            }

            // Try to extract and display JSON from results
            if (results.json_output) {
                try {
                    const jsonData = typeof results.json_output === 'string'
                        ? JSON.parse(results.json_output)
                        : results.json_output;

                    if (jsonOutputSection && jsonOutputPre) {
                        jsonOutputPre.textContent = JSON.stringify(jsonData, null, 2);
                        jsonOutputSection.style.display = 'block';

                        const jsonOutputContent = ui.elements.guidellmJsonOutputContent;
                        const toggleJsonBtn = ui.elements.toggleJsonOutputBtn;
                        if (jsonOutputContent) jsonOutputContent.style.display = 'block';
                        if (toggleJsonBtn) toggleJsonBtn.textContent = 'Hide';
                    }

                    // Create table view
                    this.displayBenchmarkTable(jsonData);
                } catch (e) {
                    console.warn('Failed to parse GuideLLM JSON output:', e);
                    if (jsonOutputSection) jsonOutputSection.style.display = 'none';
                }
            } else {
                if (jsonOutputSection) jsonOutputSection.style.display = 'none';
            }
        } else {
            // Built-in: Show metrics, hide raw output
            ui.elements.metricsGrid.style.display = 'grid';
            const rawOutputSection = document.getElementById('guidellm-raw-output-section');
            const jsonOutputSection = document.getElementById('guidellm-json-output-section');
            const tableSection = document.getElementById('guidellm-table-section');

            if (rawOutputSection) rawOutputSection.style.display = 'none';
            if (jsonOutputSection) jsonOutputSection.style.display = 'none';
            if (tableSection) tableSection.style.display = 'none';

            // Update metric cards
            document.getElementById('metric-throughput').textContent =
                results.throughput !== undefined ? `${results.throughput.toFixed(2)} req/s` : '-- req/s';
            document.getElementById('metric-latency').textContent =
                results.avg_latency !== undefined ? `${results.avg_latency.toFixed(2)} ms` : '-- ms';
            document.getElementById('benchmark-tokens-per-sec').textContent =
                results.tokens_per_second !== undefined ? `${results.tokens_per_second.toFixed(2)} tok/s` : '-- tok/s';
            document.getElementById('metric-p50').textContent =
                results.p50_latency !== undefined ? `${results.p50_latency.toFixed(2)} ms` : '-- ms';
            document.getElementById('metric-p95').textContent =
                results.p95_latency !== undefined ? `${results.p95_latency.toFixed(2)} ms` : '-- ms';
            document.getElementById('metric-p99').textContent =
                results.p99_latency !== undefined ? `${results.p99_latency.toFixed(2)} ms` : '-- ms';
            document.getElementById('benchmark-total-tokens').textContent =
                results.total_tokens !== undefined ? results.total_tokens.toLocaleString() : '--';
            document.getElementById('metric-success-rate').textContent =
                results.success_rate !== undefined ? `${results.success_rate.toFixed(1)} %` : '-- %';

            // Animate cards
            document.querySelectorAll('.metric-card').forEach((card, index) => {
                setTimeout(() => {
                    card.classList.add('updated');
                    setTimeout(() => card.classList.remove('updated'), 500);
                }, index * 50);
            });
        }
    },

    displayBenchmarkTable(jsonData) {
        const tableSection = document.getElementById('guidellm-table-section');
        const tableContent = document.getElementById('guidellm-table-content');

        if (!tableSection || !tableContent) return;

        if (!jsonData || !jsonData.benchmarks || jsonData.benchmarks.length === 0) {
            console.warn('[TABLE] No benchmark data in JSON');
            return;
        }

        const benchmark = jsonData.benchmarks[0];
        let html = '';

        // Configuration Table
        html += '<div class="benchmark-table-group">';
        html += '<h4>⚙️ Configuration</h4>';
        html += '<table class="benchmark-data-table"><tbody>';

        if (benchmark.worker) {
            html += `<tr><td class="label">Backend Target</td><td class="value">${benchmark.worker.backend_target || 'N/A'}</td></tr>`;
            html += `<tr><td class="label">Model</td><td class="value">${benchmark.worker.backend_model || 'N/A'}</td></tr>`;
        }
        if (benchmark.request_loader) {
            html += `<tr><td class="label">Data Configuration</td><td class="value">${benchmark.request_loader.data || 'N/A'}</td></tr>`;
        }
        if (benchmark.args && benchmark.args.strategy) {
            html += `<tr><td class="label">Strategy Type</td><td class="value">${benchmark.args.strategy.type_ || 'N/A'}</td></tr>`;
            html += `<tr><td class="label">Request Rate</td><td class="value">${benchmark.args.strategy.rate || 'N/A'} req/s</td></tr>`;
        }
        if (benchmark.args) {
            html += `<tr><td class="label">Max Requests</td><td class="value">${benchmark.args.max_number || 'N/A'}</td></tr>`;
        }
        html += '</tbody></table></div>';

        // Request Statistics Table
        if (benchmark.run_stats) {
            const stats = benchmark.run_stats;
            const duration = stats.end_time - stats.start_time;

            html += '<div class="benchmark-table-group">';
            html += '<h4>📊 Request Statistics</h4>';
            html += '<table class="benchmark-data-table"><tbody>';

            if (stats.requests_made) {
                html += `<tr><td class="label">Total Requests</td><td class="value">${stats.requests_made.total || 0}</td></tr>`;
                html += `<tr><td class="label">Successful</td><td class="value success">${stats.requests_made.successful || 0}</td></tr>`;
                html += `<tr><td class="label">Errored</td><td class="value ${stats.requests_made.errored > 0 ? 'error' : ''}">${stats.requests_made.errored || 0}</td></tr>`;
                html += `<tr><td class="label">Incomplete</td><td class="value">${stats.requests_made.incomplete || 0}</td></tr>`;
            }

            html += `<tr><td class="label">Duration</td><td class="value">${duration.toFixed(2)} seconds</td></tr>`;
            html += `<tr><td class="label">Avg Request Time</td><td class="value">${(stats.request_time_avg || 0).toFixed(3)} seconds</td></tr>`;
            html += '</tbody></table></div>';
        }

        // Performance Metrics Table
        if (benchmark.metrics) {
            html += '<div class="benchmark-table-group">';
            html += '<h4>🚀 Performance Metrics</h4>';
            html += '<table class="benchmark-data-table">';
            html += '<thead><tr><th>Metric</th><th>Mean</th><th>Median</th><th>Min</th><th>Max</th></tr></thead>';
            html += '<tbody>';

            if (benchmark.metrics.requests_per_second?.successful) {
                const rps = benchmark.metrics.requests_per_second.successful;
                html += `<tr><td class="label">Requests/Second</td><td>${(rps.mean || 0).toFixed(2)}</td><td>${(rps.median || 0).toFixed(2)}</td><td>${(rps.min || 0).toFixed(2)}</td><td>${(rps.max || 0).toFixed(2)}</td></tr>`;
            }
            if (benchmark.metrics.time_to_first_token?.successful) {
                const ttft = benchmark.metrics.time_to_first_token.successful;
                html += `<tr><td class="label">Time to First Token (s)</td><td>${(ttft.mean || 0).toFixed(3)}</td><td>${(ttft.median || 0).toFixed(3)}</td><td>${(ttft.min || 0).toFixed(3)}</td><td>${(ttft.max || 0).toFixed(3)}</td></tr>`;
            }
            if (benchmark.metrics.inter_token_latency?.successful) {
                const itl = benchmark.metrics.inter_token_latency.successful;
                html += `<tr><td class="label">Inter-Token Latency (ms)</td><td>${((itl.mean || 0) * 1000).toFixed(2)}</td><td>${((itl.median || 0) * 1000).toFixed(2)}</td><td>${((itl.min || 0) * 1000).toFixed(2)}</td><td>${((itl.max || 0) * 1000).toFixed(2)}</td></tr>`;
            }
            html += '</tbody></table></div>';
        }

        // Token Statistics Table
        if (benchmark.metrics) {
            html += '<div class="benchmark-table-group">';
            html += '<h4>📝 Token Statistics</h4>';
            html += '<table class="benchmark-data-table"><tbody>';

            if (benchmark.metrics.output_tokens_per_second?.successful) {
                const otps = benchmark.metrics.output_tokens_per_second.successful;
                html += `<tr><td class="label">Output Tokens/Second (Mean)</td><td class="value">${(otps.mean || 0).toFixed(2)}</td></tr>`;
            }
            if (benchmark.metrics.total_tokens_per_second?.successful) {
                const ttps = benchmark.metrics.total_tokens_per_second.successful;
                html += `<tr><td class="label">Total Tokens/Second (Mean)</td><td class="value">${(ttps.mean || 0).toFixed(2)}</td></tr>`;
            }
            html += '</tbody></table></div>';
        }

        // Latency Percentiles Table
        if (benchmark.metrics?.request_latency?.successful?.percentiles) {
            const latency = benchmark.metrics.request_latency.successful;
            html += '<div class="benchmark-table-group">';
            html += '<h4>📈 Request Latency Percentiles</h4>';
            html += '<table class="benchmark-data-table">';
            html += '<thead><tr><th>Percentile</th><th>Latency (s)</th><th>Latency (ms)</th></tr></thead>';
            html += '<tbody>';

            const percentiles = [
                { name: 'P50', key: 'p50' },
                { name: 'P75', key: 'p75' },
                { name: 'P90', key: 'p90' },
                { name: 'P95', key: 'p95' },
                { name: 'P99', key: 'p99' }
            ];

            percentiles.forEach(p => {
                if (latency.percentiles[p.key] !== undefined) {
                    const val = latency.percentiles[p.key];
                    html += `<tr><td class="label">${p.name}</td><td>${val.toFixed(3)}</td><td>${(val * 1000).toFixed(2)}</td></tr>`;
                }
            });
            html += '</tbody></table></div>';
        }

        tableContent.innerHTML = html;
        tableSection.style.display = 'block';
    },

    // =========================================================================
    // Command Preview
    // =========================================================================

    updateBenchmarkCommandPreview() {
        const ui = this.ui;
        if (!ui.elements.benchmarkRequests) return;

        const totalRequests = ui.elements.benchmarkRequests.value || '100';
        const requestRate = ui.elements.benchmarkRate.value || '5';
        const promptTokens = ui.elements.benchmarkPromptTokens.value || '100';
        const outputTokens = ui.elements.benchmarkOutputTokens.value || '100';
        const useGuideLLM = ui.elements.benchmarkMethodGuidellm?.checked;

        // In remote mode, use the remote URL; otherwise build from host/port inputs
        const isRemote = ui.currentConfig && ui.currentConfig.run_mode === 'remote';
        let targetUrl;
        if (isRemote && ui.currentConfig.remote_url) {
            targetUrl = `${ui.currentConfig.remote_url.replace(/\/+$/, '')}/v1`;
        } else {
            const host = ui.elements.host?.value || 'localhost';
            const port = ui.elements.port?.value || '8000';
            targetUrl = `http://${host}:${port}/v1`;
        }

        let cmd = '';

        if (useGuideLLM) {
            cmd = '# Benchmark using GuideLLM\n';
            cmd += 'guidellm benchmark';
            cmd += ` \\\n  --target "${targetUrl}"`;

            if (requestRate && requestRate > 0) {
                cmd += ` \\\n  --rate-type constant`;
                cmd += ` \\\n  --rate ${requestRate}`;
            } else {
                cmd += ` \\\n  --rate-type sweep`;
            }

            cmd += ` \\\n  --max-requests ${totalRequests}`;
            cmd += ` \\\n  --data "prompt_tokens=${promptTokens},output_tokens=${outputTokens}"`;
        } else {
            cmd = '# Built-in benchmark (running in the app)\n';
            cmd += 'import asyncio\n';
            cmd += 'import aiohttp\n\n';
            cmd += 'async def benchmark():\n';
            cmd += '    config = {\n';
            cmd += `        "total_requests": ${totalRequests},\n`;
            cmd += `        "request_rate": ${requestRate},\n`;
            cmd += `        "prompt_tokens": ${promptTokens},\n`;
            cmd += `        "output_tokens": ${outputTokens}\n`;
            cmd += '    }\n';
            cmd += `    url = "${targetUrl}/chat/completions"\n`;
            cmd += '    # Send requests at specified rate...';
        }

        if (ui.elements.benchmarkCommandText) {
            ui.elements.benchmarkCommandText.value = cmd;
        }
    },

    // =========================================================================
    // Copy Methods
    // =========================================================================

    async copyBenchmarkCommand() {
        const ui = this.ui;
        const command = ui.elements.benchmarkCommandText?.value;
        if (!command) return;

        try {
            await navigator.clipboard.writeText(command);
            ui.showNotification('Benchmark command copied!', 'success');
        } catch (error) {
            ui.showNotification('Failed to copy command', 'error');
        }
    },

    async copyGuidellmOutput() {
        const ui = this.ui;
        const output = ui.elements.guidellmRawOutput?.value;
        if (!output) return;

        try {
            await navigator.clipboard.writeText(output);
            ui.showNotification('GuideLLM output copied!', 'success');
        } catch (error) {
            ui.showNotification('Failed to copy output', 'error');
        }
    },

    async copyGuidellmJson() {
        const ui = this.ui;
        const jsonOutput = document.getElementById('guidellm-json-output');
        if (!jsonOutput) return;

        try {
            await navigator.clipboard.writeText(jsonOutput.textContent);
            ui.showNotification('GuideLLM JSON copied!', 'success');
        } catch (error) {
            ui.showNotification('Failed to copy JSON', 'error');
        }
    },

    // =========================================================================
    // Toggle Methods
    // =========================================================================

    toggleRawOutput() {
        const ui = this.ui;
        const content = ui.elements.guidellmRawOutputContent;
        const btn = ui.elements.toggleRawOutputBtn;

        if (!content || !btn) return;

        if (content.style.display === 'none') {
            content.style.display = 'block';
            btn.textContent = 'Hide';
        } else {
            content.style.display = 'none';
            btn.textContent = 'Show';
        }
    },

    toggleJsonOutput() {
        const ui = this.ui;
        const content = ui.elements.guidellmJsonOutputContent;
        const btn = ui.elements.toggleJsonOutputBtn;

        if (!content || !btn) return;

        if (content.style.display === 'none') {
            content.style.display = 'block';
            btn.textContent = 'Hide';
        } else {
            content.style.display = 'none';
            btn.textContent = 'Show';
        }
    }
};

export default GuideLLMModule;
