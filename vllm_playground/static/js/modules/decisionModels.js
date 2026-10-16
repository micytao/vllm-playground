// =============================================================================
// Decision Models Module (Experimental)
// Sandbox for exploring vLLM's native structured-read decision capability.
// Follows the same dynamic template loading pattern as Observability/Omni:
//   index.html has a small placeholder div; the full HTML is fetched from
//   /static/templates/decision-models.html on first visit.
//
// Launch/Stop drive a dedicated vLLM nightly DiffusionGemma container +
// vendored structured_server.py sidecar (see decision_models.py), fully
// isolated from the main Server Config / Instances flow. Every /evaluate
// response is tagged "source": "live" or "mock" and surfaced with a
// matching badge -- never a silent fake result. When the Decision Server
// isn't ready, Run Decision transparently falls back to a deterministic
// mock evaluator so the gallery is always usable.
// =============================================================================

const DM_ACTIVE_PHASES = new Set(["pulling", "starting_vllm", "waiting_health", "starting_sidecar", "stopping"]);
const DM_STATUS_POLL_MS = 2500;
const DM_RACE_LANES = ["left", "center", "right"];
// /api/hardware-capabilities shells out to nvidia-smi/amd-smi/tpu-info (and,
// in a Kubernetes namespace, lists cluster nodes) on every call. That's cheap
// most of the time, but re-fetching it on every single tab switch adds a
// real, avoidable round-trip for something that essentially never changes
// mid-session. Re-check at most this often.
const DM_HARDWARE_CACHE_MS = 60000;

export function initDecisionModelsModule(ui) {
    DecisionModelsModule.ui = ui;
    ui.loadDecisionModelsTemplate = DecisionModelsModule.loadTemplate.bind(DecisionModelsModule);
    ui.onDecisionModelsViewActivated = DecisionModelsModule.onViewActivated.bind(DecisionModelsModule);
    ui.onDecisionModelsViewDeactivated = DecisionModelsModule.onViewDeactivated.bind(DecisionModelsModule);
    window.DecisionModelsModule = DecisionModelsModule;
}

const DecisionModelsModule = {
    ui: null,
    templateLoaded: false,
    useCases: [],
    useCasesLoaded: false,
    selectedUseCase: null,
    statusPollTimer: null,
    logWebSocket: null,
    launchFieldsTouched: false,
    lastPhase: null,
    hardwareOk: null,
    hardwareCheckedAt: 0,
    race: null,
    rubricUseCase: null,

    // -- Template loading (same pattern as OmniModule / ObservabilityModule) --

    async loadTemplate() {
        const container = document.getElementById('decision-models-view');
        if (!container) {
            console.error('Decision Models view container not found');
            return;
        }

        if (this.templateLoaded && container.querySelector('.dm-content-wrapper')) {
            return;
        }

        try {
            const response = await fetch('/static/templates/decision-models.html');
            if (!response.ok) throw new Error(`Failed to load template: ${response.status}`);

            const html = await response.text();
            container.innerHTML = html;
            this.templateLoaded = true;

            this._bindEvents();

            // Run all init API calls in parallel for fast activation
            const initTasks = [
                this._prefillFromSavedSettings(),
                this._refreshServerStatus(),
            ];
            if (!this.useCasesLoaded) {
                initTasks.push(this._fetchUseCases());
            }
            initTasks.push(this._checkHardwareGate());

            this._startStatusPolling();
            this.connectLogWebSocket();

            // Fire all in parallel -- template is already rendered
            await Promise.allSettled(initTasks);

            console.log('Decision Models template loaded');
        } catch (error) {
            console.error('Failed to load Decision Models template:', error);
            container.innerHTML = `
                <div class="error-message">
                    <h3>Failed to load Decision Models</h3>
                    <p>${error.message}</p>
                    <button class="btn btn-primary" onclick="window.DecisionModelsModule.loadTemplate()">Retry</button>
                </div>
            `;
        }
    },

    async onViewActivated() {
        if (!this.templateLoaded) {
            await this.loadTemplate();
        } else {
            const activationTasks = [this._refreshServerStatus()];

            // Only re-check hardware if we've never checked, or the cached
            // result is stale -- avoid hammering /api/hardware-capabilities
            // (which shells out to nvidia-smi etc.) on every tab switch.
            if (!this.hardwareCheckedAt || Date.now() - this.hardwareCheckedAt > DM_HARDWARE_CACHE_MS) {
                activationTasks.push(this._checkHardwareGate());
            } else {
                this._updateLaunchButtonState();
            }

            this._startStatusPolling();
            this.connectLogWebSocket();

            await Promise.allSettled(activationTasks);
        }
    },

    onViewDeactivated() {
        // Stop background polling while the tab isn't visible, so an
        // in-progress launch keeps running server-side but this tab doesn't
        // keep hammering the backend in the background.
        this._stopStatusPolling();
        this.disconnectLogWebSocket();
        this._raceStop();
    },

    _startStatusPolling() {
        if (this.statusPollTimer) return;
        this.statusPollTimer = setInterval(() => this._refreshServerStatus(), DM_STATUS_POLL_MS);
    },

    _stopStatusPolling() {
        if (this.statusPollTimer) {
            clearInterval(this.statusPollTimer);
            this.statusPollTimer = null;
        }
    },

    // -- WebSocket log streaming (same pattern as Omni) -----------------------

    connectLogWebSocket() {
        if (this.logWebSocket &&
            (this.logWebSocket.readyState === WebSocket.OPEN ||
             this.logWebSocket.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/decision/logs`;

        try {
            this.logWebSocket = new WebSocket(wsUrl);

            this.logWebSocket.onopen = () => {
                console.log('Decision log WebSocket connected');
            };

            this.logWebSocket.onmessage = (event) => {
                const message = event.data;
                if (message && message.trim()) {
                    this._addLog(message);
                }
            };

            this.logWebSocket.onerror = (error) => {
                console.error('Decision log WebSocket error:', error);
            };

            this.logWebSocket.onclose = () => {
                console.log('Decision log WebSocket closed');
                // Attempt to reconnect after 2 seconds if we haven't deactivated
                if (this.templateLoaded && document.getElementById('dm-logs-row')) {
                    setTimeout(() => this.connectLogWebSocket(), 2000);
                }
            };
        } catch (error) {
            console.error('Failed to connect decision log WebSocket:', error);
        }
    },

    disconnectLogWebSocket() {
        if (this.logWebSocket) {
            this.logWebSocket.close();
            this.logWebSocket = null;
        }
    },

    _addLog(message) {
        const container = document.getElementById('dm-logs-container');
        if (!container) return;

        const entry = document.createElement('div');
        entry.className = 'log-entry info';
        entry.textContent = message;
        container.appendChild(entry);

        const autoScroll = document.getElementById('dm-auto-scroll');
        if (autoScroll && autoScroll.checked) {
            container.scrollTop = container.scrollHeight;
        }
    },

    // -- Event wiring ---------------------------------------------------------

    _bindEvents() {
        const closeBtn = document.getElementById('dm-run-close');
        if (closeBtn) closeBtn.addEventListener('click', () => this._closeRunPanel());

        const runBtn = document.getElementById('dm-run-btn');
        if (runBtn) runBtn.addEventListener('click', () => this._runDecision());

        const launchBtn = document.getElementById('dm-launch-btn');
        if (launchBtn) launchBtn.addEventListener('click', () => this._launchServer());

        const stopBtn = document.getElementById('dm-stop-btn');
        if (stopBtn) stopBtn.addEventListener('click', () => this._stopServer());

        // Track manual edits so status polling never clobbers fields the
        // user is actively customizing before launch.
        ['dm-model-input', 'dm-image-input', 'dm-canvas-input', 'dm-gpu-device-input',
            'dm-remote-url-input', 'dm-remote-api-key-input'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => { this.launchFieldsTouched = true; });
        });

        document.querySelectorAll('input[name="dm-run-mode"]').forEach((radio) => {
            radio.addEventListener('change', () => this._onModeChange());
        });
        this._onModeChange();

        // Logs row toggle (collapse/expand, same pattern as vLLM Server)
        const logsToggle = document.getElementById('dm-logs-row-toggle');
        if (logsToggle) {
            logsToggle.addEventListener('click', () => {
                const logsRow = document.getElementById('dm-logs-row');
                if (logsRow) logsRow.classList.toggle('collapsed');
            });
        }

        const clearLogsBtn = document.getElementById('dm-clear-logs-btn');
        if (clearLogsBtn) {
            clearLogsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const container = document.getElementById('dm-logs-container');
                if (container) container.innerHTML = '<div class="log-entry info">Logs cleared.</div>';
            });
        }

        const raceStartBtn = document.getElementById('dm-race-start-btn');
        if (raceStartBtn) raceStartBtn.addEventListener('click', () => this._raceToggle());
        const raceResetBtn = document.getElementById('dm-race-reset-btn');
        if (raceResetBtn) raceResetBtn.addEventListener('click', () => this._raceResetGame());

        const rubricGradeBtn = document.getElementById('dm-rubric-grade-btn');
        if (rubricGradeBtn) rubricGradeBtn.addEventListener('click', () => this._rubricGrade());
    },

    async _prefillFromSavedSettings() {
        try {
            const resp = await fetch('/api/settings');
            if (!resp.ok) return;
            const settings = await resp.json();
            const remoteUrl = settings.decision_remote_url || '';
            if (remoteUrl) {
                const urlInput = document.getElementById('dm-remote-url-input');
                if (urlInput && !urlInput.value) urlInput.value = remoteUrl;
            }
        } catch (e) {
            // Non-critical: the form still works, just without pre-fill.
        }
    },

    _launchMode() {
        const remoteRadio = document.getElementById('dm-run-mode-remote');
        return remoteRadio && remoteRadio.checked ? 'remote' : 'container';
    },

    _setMode(mode) {
        const radio = document.getElementById(`dm-run-mode-${mode}`);
        if (radio && !radio.checked) {
            radio.checked = true;
            this._onModeChange();
        }
    },

    _onModeChange() {
        const remote = this._launchMode() === 'remote';
        const localFields = document.getElementById('dm-local-fields');
        const remoteFields = document.getElementById('dm-remote-fields');
        const launchBtn = document.getElementById('dm-launch-btn');
        // Highlight the selected run-mode button, same as the vLLM Server tab.
        const containerLabel = document.getElementById('dm-run-mode-container-label');
        const remoteLabel = document.getElementById('dm-run-mode-remote-label');
        if (containerLabel) containerLabel.classList.toggle('active', !remote);
        if (remoteLabel) remoteLabel.classList.toggle('active', remote);
        if (localFields) localFields.style.display = remote ? 'none' : 'block';
        if (remoteFields) remoteFields.style.display = remote ? 'block' : 'none';
        if (launchBtn && (!this.lastPhase || this.lastPhase === 'stopped' || this.lastPhase === 'error')) {
            launchBtn.textContent = remote ? 'Connect' : 'Start Server';
        }
        // Swap the model input's default when the mode changes so the user
        // doesn't accidentally send a DiffusionGemma HF repo id to the
        // official Jev API or vice versa.
        const modelInput = document.getElementById('dm-model-input');
        const modelLabel = document.getElementById('dm-model-label');
        if (modelLabel) {
            modelLabel.textContent = remote ? 'Model (e.g. jev-latest)' : 'Model (HF repo id)';
        }
        if (modelInput && this._lastDefaults) {
            const localDefault = this._lastDefaults.model_id || '';
            const remoteDefault = this._lastDefaults.remote_model_id || '';
            const current = modelInput.value.trim();
            if (!current || current === localDefault || current === remoteDefault) {
                modelInput.value = remote ? remoteDefault : localDefault;
            }
        }
        // Remote mode needs no local GPU, so re-run the gate logic to lift any
        // NVIDIA block when switching to remote (and re-apply it for local).
        this._updateLaunchButtonState();
    },

    // -- Hardware gate ---------------------------------------------------------
    // FlashAttention4 + NVIDIA is required for DiffusionGemma (FlashInfer is
    // explicitly rejected since diffusion mixes causal prefill with
    // bidirectional denoising). Check once per view activation and block
    // Launch with a clear message rather than letting a doomed container
    // start fail confusingly minutes later.

    async _checkHardwareGate() {
        const warning = document.getElementById('dm-hardware-warning');
        const launchBtn = document.getElementById('dm-launch-btn');
        if (!warning || !launchBtn) return;

        try {
            const response = await fetch('/api/hardware-capabilities');
            const caps = await response.json();
            const ok = !!caps.gpu_available && caps.accelerator === 'nvidia';
            this.hardwareOk = ok;
            this.hardwareCheckedAt = Date.now();
            if (ok) {
                warning.style.display = 'none';
            } else if (!caps.gpu_available) {
                warning.textContent = '\u26A0\uFE0F No GPU detected. The Decision Server needs an NVIDIA GPU with FlashAttention4 support.';
                warning.style.display = 'block';
            } else {
                warning.textContent = `\u26A0\uFE0F Detected accelerator "${caps.accelerator}" -- DiffusionGemma currently requires NVIDIA (FlashInfer/ROCm are not supported for this model).`;
                warning.style.display = 'block';
            }
        } catch (error) {
            console.error('Failed to check hardware capabilities:', error);
            this.hardwareOk = null;
            warning.style.display = 'none';
        }
        this._updateLaunchButtonState();
    },

    _updateLaunchButtonState() {
        const launchBtn = document.getElementById('dm-launch-btn');
        const warning = document.getElementById('dm-hardware-warning');
        if (!launchBtn) return;
        // Only hardware-gate the button when a running server isn't already
        // in flight -- never disable Stop/relaunch controls due to this check.
        if (this.lastPhase && this.lastPhase !== 'stopped' && this.lastPhase !== 'error') return;
        // Remote mode talks to an external endpoint, so no local GPU is
        // required -- never block Connect on the NVIDIA hardware check.
        if (this._launchMode() === 'remote') {
            launchBtn.disabled = false;
            launchBtn.title = '';
            if (warning) warning.style.display = 'none';
            return;
        }
        if (warning && this.hardwareOk === false) warning.style.display = 'block';
        launchBtn.disabled = this.hardwareOk === false;
        launchBtn.title = this.hardwareOk === false
            ? 'Blocked: no compatible NVIDIA GPU detected (see warning above).'
            : '';
    },

    // -- Decision Server status / lifecycle -----------------------------------

    _phaseLabel(phase) {
        return {
            stopped: 'Stopped',
            pulling: 'Pulling image\u2026',
            starting_vllm: 'Starting vLLM\u2026',
            waiting_health: 'Waiting for health check\u2026',
            starting_sidecar: 'Starting sidecar\u2026',
            ready: 'Ready',
            stopping: 'Stopping\u2026',
            error: 'Error',
        }[phase] || phase || 'Unknown';
    },

    async _refreshServerStatus() {
        const dot = document.getElementById('dm-status-dot');
        const text = document.getElementById('dm-status-text');
        const message = document.getElementById('dm-server-message');
        const launchBtn = document.getElementById('dm-launch-btn');
        const stopBtn = document.getElementById('dm-stop-btn');
        const mockNote = document.getElementById('dm-mock-mode-note');
        if (!dot || !text || !message) return;

        try {
            const response = await fetch('/api/decision/status');
            const status = await response.json();
            const phase = status.phase || 'stopped';
            this.lastPhase = phase;

            dot.className = `dm-status-dot ${phase}`;
            text.textContent = this._phaseLabel(phase);
            message.textContent = status.message || '';

            const busy = DM_ACTIVE_PHASES.has(phase);
            const isRemote = status.connection === 'remote';
            if (launchBtn) {
                launchBtn.style.display = (phase === 'ready' || busy) ? 'none' : 'inline-block';
                launchBtn.textContent = busy
                    ? this._phaseLabel(phase)
                    : (this._launchMode() === 'remote' ? 'Connect' : 'Start Server');
            }
            if (stopBtn) {
                stopBtn.style.display = (phase === 'ready' || busy) ? 'inline-block' : 'none';
                stopBtn.textContent = isRemote ? 'Disconnect' : 'Stop';
                stopBtn.disabled = phase === 'stopping';
            }
            if (mockNote) {
                if (phase === 'ready') {
                    mockNote.innerHTML = isRemote
                        ? `The Decision Server is <strong>live</strong> -- results below call the remote endpoint at <code>${this._escapeHtml(status.remote_url || '')}</code>.`
                        : 'The Decision Server is <strong>live</strong> -- results below call the real vLLM-backed sidecar.';
                } else {
                    mockNote.innerHTML = 'All results below are currently <strong>simulated</strong> &mdash; start the Decision Server for live results.';
                }
            }

            // Prefill launch fields from server-reported defaults (once, and
            // never once the user has started editing them).
            //
            // status.model_id/image_tag/canvas_length reflect whatever was
            // last *attempted*, even if that attempt failed (phase=error) --
            // they are not reset back to null on failure. Only trust them as
            // "current config" while that attempt is actually live (ready or
            // still in progress); otherwise prefer status.defaults so a
            // one-time bad value (e.g. a since-fixed default, or a typo)
            // doesn't keep re-populating the form forever.
            if (!this.launchFieldsTouched && status.defaults) {
                this._lastDefaults = status.defaults;
                const useLiveValues = phase === 'ready' || busy;
                const modelInput = document.getElementById('dm-model-input');
                const imageInput = document.getElementById('dm-image-input');
                const canvasInput = document.getElementById('dm-canvas-input');
                const modeDefault = this._launchMode() === 'remote'
                    ? (status.defaults.remote_model_id || '')
                    : (status.defaults.model_id || '');
                if (modelInput && !modelInput.value) {
                    modelInput.value = (useLiveValues && status.model_id) || modeDefault;
                }
                if (imageInput && !imageInput.value) {
                    imageInput.value = (useLiveValues && status.image_tag) || status.defaults.image_tag || '';
                }
                if (canvasInput && !canvasInput.value) {
                    canvasInput.value = (useLiveValues && status.canvas_length) || status.defaults.canvas_length || '';
                }
                // Reflect an active/attempted remote connection back into the
                // form: select remote mode and prefill the URL so a reload or
                // tab switch shows what's actually connected.
                if (useLiveValues && isRemote) {
                    const remoteUrlInput = document.getElementById('dm-remote-url-input');
                    this._setMode('remote');
                    if (remoteUrlInput && !remoteUrlInput.value) {
                        remoteUrlInput.value = status.remote_url || '';
                    }
                }
            }

            // Auto-expand logs row while a launch/stop is in progress
            if (busy) {
                this._startStatusPolling();
                const logsRow = document.getElementById('dm-logs-row');
                if (logsRow && logsRow.classList.contains('collapsed')) {
                    logsRow.classList.remove('collapsed');
                }
            }
            this._updateLaunchButtonState();
        } catch (error) {
            console.error('Failed to fetch decision server status:', error);
            dot.className = 'dm-status-dot error';
            text.textContent = 'Unavailable';
            message.textContent = 'Could not reach the backend to check Decision Server status.';
        }
    },

    async _launchServer() {
        const launchBtn = document.getElementById('dm-launch-btn');
        const message = document.getElementById('dm-server-message');
        const modelInput = document.getElementById('dm-model-input');
        const imageInput = document.getElementById('dm-image-input');
        const canvasInput = document.getElementById('dm-canvas-input');
        const gpuInput = document.getElementById('dm-gpu-device-input');
        const remoteUrlInput = document.getElementById('dm-remote-url-input');
        const remoteKeyInput = document.getElementById('dm-remote-api-key-input');
        const mode = this._launchMode();

        const body = {
            mode,
            model_id: modelInput && modelInput.value.trim() ? modelInput.value.trim() : null,
            image_tag: imageInput && imageInput.value.trim() ? imageInput.value.trim() : null,
            canvas_length: canvasInput && canvasInput.value ? parseInt(canvasInput.value, 10) : null,
            gpu_device: gpuInput && gpuInput.value.trim() ? gpuInput.value.trim() : null,
            remote_url: remoteUrlInput && remoteUrlInput.value.trim() ? remoteUrlInput.value.trim() : null,
            remote_api_key: remoteKeyInput && remoteKeyInput.value.trim() ? remoteKeyInput.value.trim() : null,
        };

        if (mode === 'remote' && !body.remote_url) {
            if (message) message.textContent = 'Enter the remote endpoint URL to connect.';
            return;
        }

        if (launchBtn) launchBtn.disabled = true;
        if (message) message.textContent = mode === 'remote' ? 'Connecting to remote endpoint\u2026' : 'Starting Decision Server\u2026';

        try {
            const response = await fetch('/api/decision/server/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.detail || `HTTP ${response.status}`);
            }
            // Persist remote connection settings so they survive page reloads.
            if (mode === 'remote' && body.remote_url) {
                const app = window.vllmUI;
                if (app && app.saveSettings) {
                    app.saveSettings({
                        decision_remote_url: body.remote_url,
                        decision_remote_api_key: body.remote_api_key || '',
                    });
                }
            }
            // Auto-expand logs row
            const logsRow = document.getElementById('dm-logs-row');
            if (logsRow && logsRow.classList.contains('collapsed')) {
                logsRow.classList.remove('collapsed');
            }
        } catch (error) {
            console.error('Failed to launch Decision Server:', error);
            if (message) message.textContent = `Failed to launch: ${error.message}`;
        } finally {
            this._refreshServerStatus();
        }
    },

    async _stopServer() {
        const stopBtn = document.getElementById('dm-stop-btn');
        const message = document.getElementById('dm-server-message');
        if (stopBtn) stopBtn.disabled = true;
        if (message) message.textContent = 'Stopping Decision Server\u2026';

        try {
            const response = await fetch('/api/decision/server/stop', { method: 'POST' });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.detail || `HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('Failed to stop Decision Server:', error);
            if (message) message.textContent = `Failed to stop cleanly: ${error.message}`;
        } finally {
            this._refreshServerStatus();
        }
    },

    // -- Use case gallery -------------------------------------------------

    async _fetchUseCases() {
        const gallery = document.getElementById('dm-gallery');
        try {
            const response = await fetch('/api/decision/examples');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            this.useCases = data.use_cases || [];
            this.categoryOrder = data.category_order || [];
            this.categoryLabels = data.category_labels || {};
            this.useCasesLoaded = true;
            this._renderGallery();
        } catch (error) {
            console.error('Failed to fetch decision use cases:', error);
            if (gallery) {
                gallery.innerHTML = `<div class="dm-gallery-error">Failed to load use cases: ${this._escapeHtml(error.message)}</div>`;
            }
        }
    },

    _renderGallery() {
        const gallery = document.getElementById('dm-gallery');
        if (!gallery) return;

        if (!this.useCases.length) {
            gallery.innerHTML = '<div class="dm-gallery-empty">No use cases available.</div>';
            return;
        }

        const byCategory = {};
        for (const uc of this.useCases) {
            const cat = uc.category || 'other';
            if (!byCategory[cat]) byCategory[cat] = [];
            byCategory[cat].push(uc);
        }

        const order = (this.categoryOrder && this.categoryOrder.length
            ? this.categoryOrder
            : Object.keys(byCategory)
        ).filter((cat) => byCategory[cat] && byCategory[cat].length);

        const activeTab = this._activeGalleryTab && (this._activeGalleryTab === '__all__' || order.includes(this._activeGalleryTab))
            ? this._activeGalleryTab
            : '__all__';
        this._activeGalleryTab = activeTab;

        let tabsHtml = '<div class="dm-gallery-tabs" role="tablist">';
        tabsHtml += `<button class="dm-gallery-tab${activeTab === '__all__' ? ' active' : ''}" data-cat="__all__" role="tab">All <span class="dm-gallery-tab-count">${this.useCases.length}</span></button>`;
        for (const cat of order) {
            const label = (this.categoryLabels && this.categoryLabels[cat]) || cat;
            const shortLabel = label.split('(')[0].trim();
            const count = byCategory[cat].length;
            const isActive = cat === activeTab;
            tabsHtml += `<button class="dm-gallery-tab${isActive ? ' active' : ''}" data-cat="${this._escapeHtml(cat)}" role="tab">${this._escapeHtml(shortLabel)} <span class="dm-gallery-tab-count">${count}</span></button>`;
        }
        tabsHtml += '</div>';

        const visibleCats = activeTab === '__all__' ? order : [activeTab];

        let cardsHtml = '<div class="dm-gallery-tab-panel" role="tabpanel">';
        for (const cat of visibleCats) {
            const items = byCategory[cat];
            if (!items || !items.length) continue;
            if (activeTab === '__all__') {
                const label = (this.categoryLabels && this.categoryLabels[cat]) || cat;
                cardsHtml += `<h3 class="dm-gallery-category-heading">${this._escapeHtml(label)}</h3>`;
            }
            cardsHtml += '<div class="dm-gallery-category-group">';
            cardsHtml += items.map((uc) => `
                <button class="dm-card" data-use-case-id="${this._escapeHtml(uc.id)}">
                    <div class="dm-card-header">
                        <span class="dm-card-title">${this._escapeHtml(uc.title)}</span>
                        <span class="dm-card-subtitle">${this._escapeHtml(uc.subtitle || '')}</span>
                    </div>
                    <p class="dm-card-description">${this._escapeHtml(uc.description || '')}</p>
                    <div class="dm-card-tags">
                        ${(uc.tags || []).map((tag) => `<span class="dm-tag">${this._escapeHtml(tag)}</span>`).join('')}
                    </div>
                </button>
            `).join('');
            cardsHtml += '</div>';
        }
        cardsHtml += '</div>';

        gallery.innerHTML = tabsHtml + cardsHtml;

        gallery.querySelectorAll('.dm-gallery-tab').forEach((tab) => {
            tab.addEventListener('click', () => {
                this._activeGalleryTab = tab.dataset.cat;
                this._renderGallery();
            });
        });

        gallery.querySelectorAll('.dm-card').forEach((card) => {
            card.addEventListener('click', () => this._openUseCase(card.dataset.useCaseId));
        });
    },

    // -- Run panel ----------------------------------------------------------

    _openUseCase(useCaseId) {
        const useCase = this.useCases.find((uc) => uc.id === useCaseId);
        if (!useCase) return;
        this.selectedUseCase = useCase;
        this._raceStop();

        const panel = document.getElementById('dm-run-panel');
        const title = document.getElementById('dm-run-title');
        const description = document.getElementById('dm-run-description');
        const genericBody = document.getElementById('dm-generic-body');
        const raceBody = document.getElementById('dm-race-body');
        const rubricBody = document.getElementById('dm-rubric-body');
        const results = document.getElementById('dm-run-results');
        const errorEl = document.getElementById('dm-run-error');

        if (title) title.textContent = useCase.title;
        if (description) description.textContent = useCase.description || '';
        if (results) results.style.display = 'none';
        if (errorEl) errorEl.style.display = 'none';

        if (useCase.interactive === 'race') {
            if (genericBody) genericBody.style.display = 'none';
            if (rubricBody) rubricBody.style.display = 'none';
            if (raceBody) raceBody.style.display = 'block';
            this._raceSetup(useCase);
        } else if (useCase.interactive === 'rubric') {
            if (genericBody) genericBody.style.display = 'none';
            if (raceBody) raceBody.style.display = 'none';
            if (rubricBody) rubricBody.style.display = 'block';
            this._rubricSetup(useCase);
        } else {
            if (raceBody) raceBody.style.display = 'none';
            if (rubricBody) rubricBody.style.display = 'none';
            if (genericBody) genericBody.style.display = 'block';
            const stateInput = document.getElementById('dm-state-input');
            const questionsInput = document.getElementById('dm-questions-input');
            if (stateInput) {
                stateInput.value = typeof useCase.state === 'string'
                    ? useCase.state
                    : JSON.stringify(useCase.state, null, 2);
            }
            if (questionsInput) {
                questionsInput.value = JSON.stringify(useCase.questions, null, 2);
            }
        }

        if (panel) {
            panel.style.display = 'block';
            panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    },

    _closeRunPanel() {
        const panel = document.getElementById('dm-run-panel');
        if (panel) panel.style.display = 'none';
        this._raceStop();
        this.selectedUseCase = null;
    },

    async _runDecision() {
        const stateInput = document.getElementById('dm-state-input');
        const questionsInput = document.getElementById('dm-questions-input');
        const errorEl = document.getElementById('dm-run-error');
        const runBtn = document.getElementById('dm-run-btn');
        if (!stateInput || !questionsInput) return;

        let state = stateInput.value;
        try {
            // Allow either a raw string state or a JSON object/array; try
            // JSON first so use cases with object state round-trip cleanly.
            state = JSON.parse(stateInput.value);
        } catch (_) {
            // Not valid JSON -- treat as a plain text state, which is valid.
        }

        let questions;
        try {
            questions = JSON.parse(questionsInput.value);
        } catch (error) {
            this._showRunError(`Questions JSON is invalid: ${error.message}`);
            return;
        }

        if (errorEl) errorEl.style.display = 'none';
        if (runBtn) {
            runBtn.disabled = true;
            runBtn.textContent = 'Running\u2026';
        }

        try {
            const response = await fetch('/api/decision/evaluate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ state, questions }),
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.detail || `HTTP ${response.status}`);
            }
            this._renderResults(result);
        } catch (error) {
            console.error('Decision evaluate failed:', error);
            this._showRunError(`Request failed: ${error.message}`);
        } finally {
            if (runBtn) {
                runBtn.disabled = false;
                runBtn.textContent = 'Run Decision';
            }
        }
    },

    _showRunError(message) {
        const errorEl = document.getElementById('dm-run-error');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'inline-block';
        }
    },

    _renderResults(result) {
        const resultsEl = document.getElementById('dm-run-results');
        const badge = document.getElementById('dm-simulated-badge');
        const liveBadge = document.getElementById('dm-live-badge');
        const timing = document.getElementById('dm-results-timing');
        const note = document.getElementById('dm-results-note');
        const answersEl = document.getElementById('dm-answers');
        if (!resultsEl || !answersEl) return;

        if (badge) badge.style.display = result.source === 'mock' ? 'inline-block' : 'none';
        if (liveBadge) liveBadge.style.display = result.source === 'live' ? 'inline-block' : 'none';
        if (timing) {
            const ms = result.timing && result.timing.total_ms;
            timing.textContent = ms !== undefined ? `${ms} ms` : '';
        }
        if (note) note.textContent = result.note || '';

        const answers = result.answers || {};
        answersEl.innerHTML = Object.entries(answers).map(([qid, answer]) => {
            if (answer === null || answer === undefined) {
                return `
                    <div class="dm-answer dm-answer-skipped">
                        <div class="dm-answer-id">${this._escapeHtml(qid)}</div>
                        <div class="dm-answer-skipped-note">Skipped &mdash; condition not met</div>
                    </div>
                `;
            }
            return `
                <div class="dm-answer">
                    <div class="dm-answer-id">${this._escapeHtml(qid)}
                        <span class="dm-answer-type">${this._escapeHtml(answer.type)}</span>
                    </div>
                    ${this._renderAnswerValue(answer)}
                </div>
            `;
        }).join('');

        resultsEl.style.display = 'block';
    },

    _renderAnswerValue(answer) {
        if (answer.type === 'noul') {
            const pct = Math.round(answer.noul * 100);
            return `
                <div class="dm-bar-row">
                    <span class="dm-bar-label">yes</span>
                    <div class="dm-bar-track"><div class="dm-bar-fill" style="width:${pct}%"></div></div>
                    <span class="dm-bar-value">${pct}%</span>
                </div>
            `;
        }

        if (answer.type === 'choice' || answer.type === 'score') {
            const probs = answer.probabilities || {};
            const rows = Object.entries(probs).map(([label, p]) => {
                const pct = Math.round(p * 100);
                const displayLabel = answer.type === 'score' ? (answer.legend && answer.legend[label]) || label : label;
                const isTop = answer.type === 'choice' ? label === answer.choice : pct === Math.max(...Object.values(probs).map((v) => Math.round(v * 100)));
                return `
                    <div class="dm-bar-row ${isTop ? 'dm-bar-row-top' : ''}">
                        <span class="dm-bar-label">${this._escapeHtml(String(displayLabel))}</span>
                        <div class="dm-bar-track"><div class="dm-bar-fill" style="width:${pct}%"></div></div>
                        <span class="dm-bar-value">${pct}%</span>
                    </div>
                `;
            }).join('');
            const summary = answer.type === 'choice'
                ? `Choice: <strong>${this._escapeHtml(answer.choice)}</strong> (confidence ${Math.round(answer.confidence * 100)}%)`
                : `Expected score: <strong>${answer.score}</strong> (confidence ${Math.round(answer.confidence * 100)}%)`;
            return `<div class="dm-answer-summary">${summary}</div><div class="dm-bars">${rows}</div>`;
        }

        return `<pre class="dm-answer-raw">${this._escapeHtml(JSON.stringify(answer, null, 2))}</pre>`;
    },

    // -- Race Lane Decider (interactive) ---------------------------------------
    // A live control loop: every tick, the track's lane-obstacle layout ahead
    // of the car is compressed into state, and one batched Choice ("lane") +
    // Noul ("hazard") request decides where the car goes next. Mirrors the
    // community "Jev Road Decider" pattern researched for this feature.

    _raceSetup(useCase) {
        this.race = {
            useCase,
            running: false,
            busy: false,
            rows: [],
            carLane: 'center',
            score: 0,
            lookahead: 6,
            tickTimer: null,
        };
        this._raceGenerateInitialRows();
        this._raceRenderTrack();
        this._raceSetMessage('Press Start \u2014 every tick, the current track layout becomes one batched Choice+Noul request to the Decision Server.');

        const scoreEl = document.getElementById('dm-race-score');
        const hazardEl = document.getElementById('dm-race-hazard');
        const latencyEl = document.getElementById('dm-race-latency');
        const badge = document.getElementById('dm-race-source-badge');
        if (scoreEl) scoreEl.textContent = '0';
        if (hazardEl) hazardEl.textContent = '\u2014';
        if (latencyEl) latencyEl.textContent = '\u2014';
        if (badge) { badge.textContent = ''; badge.className = 'dm-race-badge'; }

        const startBtn = document.getElementById('dm-race-start-btn');
        if (startBtn) startBtn.textContent = 'Start';
    },

    _raceGenerateInitialRows() {
        this.race.rows = [];
        for (let i = 0; i < this.race.lookahead; i++) {
            this.race.rows.push(this._raceBuildRow());
        }
    },

    _raceBuildRow() {
        // At most one blocked lane per row, so a safe lane always exists --
        // the demo is about picking well, not about unsolvable randomness.
        const row = { left: false, center: false, right: false };
        if (Math.random() < 0.55) {
            const lane = DM_RACE_LANES[Math.floor(Math.random() * DM_RACE_LANES.length)];
            row[lane] = true;
        }
        return row;
    },

    _raceBuildState() {
        const state = { current_lane: this.race.carLane };
        DM_RACE_LANES.forEach((lane) => {
            const idx = this.race.rows.findIndex((row) => row[lane]);
            state[lane] = idx === -1 ? 'clear' : `obstacle_row_${idx + 1}`;
        });
        return state;
    },

    _raceRenderTrack() {
        const track = document.getElementById('dm-race-track');
        if (!track || !this.race) return;

        const rows = this.race.rows;

        const rowsHtml = rows.slice().reverse().map((row, visualIdx) => {
            const distFromCar = visualIdx;
            const proximityClass = distFromCar === 0 ? 'dm-race-row-imminent' :
                                   distFromCar === 1 ? 'dm-race-row-near' : '';
            return `
            <div class="dm-race-row ${proximityClass}">
                ${DM_RACE_LANES.map((lane) => {
                    let cls = 'dm-race-cell';
                    if (row[lane]) cls += ' dm-race-obstacle';
                    return `<div class="${cls}"><span class="dm-race-cell-icon">${row[lane] ? '\u26A0' : ''}</span></div>`;
                }).join('')}
            </div>`;
        }).join('');

        const crashed = this.race._justCrashed;
        const carHtml = `
            <div class="dm-race-row dm-race-car-row">
                ${DM_RACE_LANES.map((lane) => {
                    if (lane === this.race.carLane) {
                        return `<div class="dm-race-cell dm-race-car ${crashed ? 'dm-race-car-crash' : ''}">
                            <span class="dm-race-cell-icon">${crashed ? '\uD83D\uDCA5' : '\uD83C\uDFCE\uFE0F'}</span>
                        </div>`;
                    }
                    return `<div class="dm-race-cell"></div>`;
                }).join('')}
            </div>
        `;

        const laneLabels = `
            <div class="dm-race-row dm-race-lane-labels">
                ${DM_RACE_LANES.map((lane) => `<div class="dm-race-lane-label">${lane.charAt(0).toUpperCase() + lane.slice(1)}</div>`).join('')}
            </div>
        `;

        track.innerHTML = rowsHtml + carHtml + laneLabels;
    },

    _raceSetMessage(message) {
        const el = document.getElementById('dm-race-message');
        if (el) el.textContent = message;
    },

    _raceToggle() {
        if (!this.race) return;
        if (this.race.running) {
            this._raceStop();
        } else {
            this._raceStart();
        }
    },

    _raceStart() {
        if (!this.race || this.race.running) return;
        this.race.running = true;
        const startBtn = document.getElementById('dm-race-start-btn');
        if (startBtn) startBtn.textContent = 'Pause';
        this._raceScheduleTick();
    },

    _raceStop() {
        if (!this.race) return;
        this.race.running = false;
        if (this.race.tickTimer) {
            clearTimeout(this.race.tickTimer);
            this.race.tickTimer = null;
        }
        const startBtn = document.getElementById('dm-race-start-btn');
        if (startBtn) startBtn.textContent = 'Start';
    },

    _raceResetGame() {
        if (!this.race) return;
        this._raceStop();
        this.race.score = 0;
        this.race.carLane = 'center';
        this._raceGenerateInitialRows();
        this._raceRenderTrack();
        const scoreEl = document.getElementById('dm-race-score');
        if (scoreEl) scoreEl.textContent = '0';
        this._raceSetMessage('Press Start \u2014 every tick, the current track layout becomes one batched Choice+Noul request to the Decision Server.');
    },

    _raceScheduleTick() {
        const speedSelect = document.getElementById('dm-race-speed-select');
        const ms = speedSelect ? parseInt(speedSelect.value, 10) : 900;
        this.race.tickTimer = setTimeout(() => this._raceTick(), ms);
    },

    async _raceTick() {
        if (!this.race || !this.race.running || this.race.busy) {
            return;
        }
        this.race.busy = true;

        const state = this._raceBuildState();
        const questions = this.race.useCase.questions;
        const clientStart = performance.now();

        try {
            const response = await fetch('/api/decision/evaluate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ state, questions }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);

            const clientMs = Math.round(performance.now() - clientStart);
            const laneAnswer = result.answers && result.answers.lane;
            const hazardAnswer = result.answers && result.answers.hazard;
            const decidedLane = laneAnswer ? laneAnswer.choice : this.race.carLane;
            const hazard = hazardAnswer ? hazardAnswer.noul : null;

            this.race.carLane = DM_RACE_LANES.includes(decidedLane) ? decidedLane : this.race.carLane;

            const latencyEl = document.getElementById('dm-race-latency');
            const hazardEl = document.getElementById('dm-race-hazard');
            const badge = document.getElementById('dm-race-source-badge');
            const serverMs = result.timing && result.timing.total_ms;
            if (latencyEl) latencyEl.textContent = `${serverMs !== undefined ? serverMs : clientMs} ms`;
            if (hazardEl) hazardEl.textContent = hazard !== null && hazard !== undefined ? `${Math.round(hazard * 100)}%` : '\u2014';
            if (badge) {
                badge.textContent = result.source === 'live' ? 'LIVE' : 'SIMULATED';
                badge.className = `dm-race-badge ${result.source === 'live' ? 'dm-race-badge-live' : 'dm-race-badge-mock'}`;
            }

            // Collision check against the row the car is now entering (index 0
            // is always "1 row ahead", matching the obstacle_row_1 state label).
            const frontRow = this.race.rows[0];
            const crashed = !!(frontRow && frontRow[this.race.carLane]);

            this._raceRenderTrack();

            if (crashed) {
                this._raceCrash();
                return;
            }

            this.race.score += 1;
            const scoreEl = document.getElementById('dm-race-score');
            if (scoreEl) scoreEl.textContent = String(this.race.score);

            this.race.rows.shift();
            this.race.rows.push(this._raceBuildRow());
            const hazardPct = hazard !== null && hazard !== undefined ? Math.round(hazard * 100) : null;
            const hazardIcon = hazardPct !== null ? (hazardPct > 60 ? '\u26A0\uFE0F' : hazardPct > 30 ? '\u26AB' : '\u2705') : '';
            this._raceSetMessage(`${hazardIcon} Lane: ${decidedLane} \u2022 Hazard: ${hazardPct !== null ? hazardPct + '%' : '?'} \u2022 Score: ${this.race.score}`);
        } catch (error) {
            console.error('Race tick failed:', error);
            this._raceSetMessage(`Request failed: ${error.message}`);
        } finally {
            this.race.busy = false;
            if (this.race.running) this._raceScheduleTick();
        }
    },

    _raceCrash() {
        const survived = this.race.score;
        this._raceStop();
        this.race._justCrashed = true;
        this._raceRenderTrack();
        this._raceSetMessage(`\uD83D\uDCA5 Crashed after ${survived} row${survived !== 1 ? 's' : ''} survived! Press Start to try again.`);
        this.race.carLane = 'center';
        setTimeout(() => {
            if (this.race) {
                this.race._justCrashed = false;
                this._raceGenerateInitialRows();
                this._raceRenderTrack();
            }
        }, 1200);
    },

    // -- Rubric Grading Puzzle (interactive) -----------------------------------
    // An editable submission + rubric are sent once as shared state; each
    // criterion becomes one Score question in a single batched request.
    // Modeled on AutoRubric's "decision-model judge" batching pattern.

    _rubricSetup(useCase) {
        this.rubricUseCase = useCase;
        const submissionInput = document.getElementById('dm-rubric-submission-input');
        const instructionsInput = document.getElementById('dm-rubric-instructions-input');
        const criteriaList = document.getElementById('dm-rubric-criteria-list');
        const resultsEl = document.getElementById('dm-rubric-results');
        const errorEl = document.getElementById('dm-rubric-error');
        const badge = document.getElementById('dm-rubric-source-badge');

        const state = useCase.state || {};
        if (submissionInput) submissionInput.value = state.submission || '';
        if (instructionsInput) instructionsInput.value = state.rubric || '';
        if (resultsEl) { resultsEl.style.display = 'none'; resultsEl.innerHTML = ''; }
        if (errorEl) errorEl.style.display = 'none';
        if (badge) { badge.textContent = ''; badge.className = 'dm-race-badge'; }

        if (criteriaList) {
            const entries = Object.entries(useCase.questions || {});
            criteriaList.innerHTML = `
                <label>Rubric criteria (one Score question each, sent in one batched request)</label>
                <ul class="dm-rubric-criteria">
                    ${entries.map(([qid, q]) => `<li><strong>${this._escapeHtml(qid)}</strong>: ${this._escapeHtml(q.instructions || '')}</li>`).join('')}
                </ul>
            `;
        }
    },

    async _rubricGrade() {
        if (!this.rubricUseCase) return;
        const submissionInput = document.getElementById('dm-rubric-submission-input');
        const instructionsInput = document.getElementById('dm-rubric-instructions-input');
        const errorEl = document.getElementById('dm-rubric-error');
        const gradeBtn = document.getElementById('dm-rubric-grade-btn');
        const resultsEl = document.getElementById('dm-rubric-results');
        const badge = document.getElementById('dm-rubric-source-badge');

        const state = {
            submission: submissionInput ? submissionInput.value : '',
            rubric: instructionsInput ? instructionsInput.value : '',
        };

        if (errorEl) errorEl.style.display = 'none';
        if (gradeBtn) { gradeBtn.disabled = true; gradeBtn.textContent = 'Grading\u2026'; }

        try {
            const response = await fetch('/api/decision/evaluate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ state, questions: this.rubricUseCase.questions }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);

            if (badge) {
                badge.textContent = result.source === 'live' ? 'LIVE' : 'SIMULATED';
                badge.className = `dm-race-badge ${result.source === 'live' ? 'dm-race-badge-live' : 'dm-race-badge-mock'}`;
            }

            if (resultsEl) {
                const answers = result.answers || {};
                resultsEl.innerHTML = Object.entries(answers).map(([qid, answer]) => {
                    if (!answer) return '';
                    return `
                        <div class="dm-answer">
                            <div class="dm-answer-id">${this._escapeHtml(qid)}</div>
                            ${this._renderAnswerValue(answer)}
                        </div>
                    `;
                }).join('');
                resultsEl.style.display = 'block';
            }
        } catch (error) {
            console.error('Rubric grade failed:', error);
            if (errorEl) {
                errorEl.textContent = `Request failed: ${error.message}`;
                errorEl.style.display = 'inline-block';
            }
        } finally {
            if (gradeBtn) { gradeBtn.disabled = false; gradeBtn.textContent = 'Grade Submission'; }
        }
    },

    // -- Utilities ------------------------------------------------------------

    _escapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = value === undefined || value === null ? '' : String(value);
        return div.innerHTML;
    },
};
