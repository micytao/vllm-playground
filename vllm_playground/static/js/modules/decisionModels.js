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
const DM_LOG_POLL_MS = 3000;
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
    logsPollTimer: null,
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

        if (this.templateLoaded && container.querySelector('.dm-layout')) {
            return;
        }

        try {
            const response = await fetch('/static/templates/decision-models.html');
            if (!response.ok) throw new Error(`Failed to load template: ${response.status}`);

            const html = await response.text();
            container.innerHTML = html;
            this.templateLoaded = true;

            this._bindEvents();
            this._checkHardwareGate();
            this._refreshServerStatus();
            this._startStatusPolling();
            if (!this.useCasesLoaded) {
                this._fetchUseCases();
            }

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
            // Only re-check hardware if we've never checked, or the cached
            // result is stale -- avoid hammering /api/hardware-capabilities
            // (which shells out to nvidia-smi etc.) on every tab switch.
            if (!this.hardwareCheckedAt || Date.now() - this.hardwareCheckedAt > DM_HARDWARE_CACHE_MS) {
                this._checkHardwareGate();
            } else {
                this._updateLaunchButtonState();
            }
            this._refreshServerStatus();
            this._startStatusPolling();
        }
    },

    onViewDeactivated() {
        // Stop background polling while the tab isn't visible, so an
        // in-progress launch keeps running server-side but this tab doesn't
        // keep hammering the backend in the background.
        this._stopStatusPolling();
        this._stopLogsPolling();
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

    _startLogsPolling() {
        if (this.logsPollTimer) return;
        this._pollLogs();
        this.logsPollTimer = setInterval(() => this._pollLogs(), DM_LOG_POLL_MS);
    },

    _stopLogsPolling() {
        if (this.logsPollTimer) {
            clearInterval(this.logsPollTimer);
            this.logsPollTimer = null;
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
        ['dm-model-input', 'dm-image-input', 'dm-canvas-input', 'dm-gpu-device-input'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => { this.launchFieldsTouched = true; });
        });

        const logPanel = document.getElementById('dm-log-panel');
        if (logPanel) {
            logPanel.addEventListener('toggle', () => {
                if (logPanel.open) {
                    this._startLogsPolling();
                } else {
                    this._stopLogsPolling();
                }
            });
        }

        const raceStartBtn = document.getElementById('dm-race-start-btn');
        if (raceStartBtn) raceStartBtn.addEventListener('click', () => this._raceToggle());
        const raceResetBtn = document.getElementById('dm-race-reset-btn');
        if (raceResetBtn) raceResetBtn.addEventListener('click', () => this._raceResetGame());

        const rubricGradeBtn = document.getElementById('dm-rubric-grade-btn');
        if (rubricGradeBtn) rubricGradeBtn.addEventListener('click', () => this._rubricGrade());
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
        if (!launchBtn) return;
        // Only hardware-gate the button when a running server isn't already
        // in flight -- never disable Stop/relaunch controls due to this check.
        if (this.lastPhase && this.lastPhase !== 'stopped' && this.lastPhase !== 'error') return;
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
            if (launchBtn) {
                launchBtn.style.display = (phase === 'ready' || busy) ? 'none' : 'inline-block';
                launchBtn.textContent = busy ? this._phaseLabel(phase) : 'Launch Decision Server';
            }
            if (stopBtn) {
                stopBtn.style.display = (phase === 'ready' || busy) ? 'inline-block' : 'none';
                stopBtn.disabled = phase === 'stopping';
            }
            if (mockNote) {
                mockNote.innerHTML = phase === 'ready'
                    ? 'The Decision Server is <strong>live</strong> -- results below call the real vLLM-backed sidecar.'
                    : 'All results below are currently <strong>simulated</strong> &mdash; launch the Decision Server above for live results.';
            }

            // Prefill launch fields from server-reported defaults (once, and
            // never once the user has started editing them).
            if (!this.launchFieldsTouched && status.defaults) {
                const modelInput = document.getElementById('dm-model-input');
                const imageInput = document.getElementById('dm-image-input');
                const canvasInput = document.getElementById('dm-canvas-input');
                if (modelInput && !modelInput.value) modelInput.value = status.model_id || status.defaults.model_id || '';
                if (imageInput && !imageInput.value) imageInput.value = status.image_tag || status.defaults.image_tag || '';
                if (canvasInput && !canvasInput.value) canvasInput.value = status.canvas_length || status.defaults.canvas_length || '';
            }

            // Auto-poll faster while a launch/stop is in progress, and drop
            // back to idle polling once settled.
            if (busy) {
                this._startStatusPolling();
                this._startLogsPolling();
            } else if (phase === 'stopped') {
                this._stopLogsPolling();
            }
            this._updateLaunchButtonState();
        } catch (error) {
            console.error('Failed to fetch decision server status:', error);
            dot.className = 'dm-status-dot error';
            text.textContent = 'Unavailable';
            message.textContent = 'Could not reach the backend to check Decision Server status.';
        }
    },

    async _pollLogs() {
        const logOutput = document.getElementById('dm-log-output');
        if (!logOutput) return;
        try {
            const response = await fetch('/api/decision/server/logs?limit=200');
            const data = await response.json();
            const lines = data.lines || [];
            logOutput.textContent = lines.length ? lines.join('\n') : '(no logs yet)';
            logOutput.scrollTop = logOutput.scrollHeight;
        } catch (error) {
            console.error('Failed to fetch decision server logs:', error);
        }
    },

    async _launchServer() {
        const launchBtn = document.getElementById('dm-launch-btn');
        const message = document.getElementById('dm-server-message');
        const modelInput = document.getElementById('dm-model-input');
        const imageInput = document.getElementById('dm-image-input');
        const canvasInput = document.getElementById('dm-canvas-input');
        const gpuInput = document.getElementById('dm-gpu-device-input');

        const body = {
            model_id: modelInput && modelInput.value.trim() ? modelInput.value.trim() : null,
            image_tag: imageInput && imageInput.value.trim() ? imageInput.value.trim() : null,
            canvas_length: canvasInput && canvasInput.value ? parseInt(canvasInput.value, 10) : null,
            gpu_device: gpuInput && gpuInput.value.trim() ? gpuInput.value.trim() : null,
        };

        if (launchBtn) launchBtn.disabled = true;
        if (message) message.textContent = 'Starting Decision Server\u2026';

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
            this._startLogsPolling();
            const logPanel = document.getElementById('dm-log-panel');
            if (logPanel) logPanel.open = true;
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

        gallery.innerHTML = this.useCases.map((uc) => `
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
        const rowsHtml = this.race.rows.slice().reverse().map((row) => `
            <div class="dm-race-row">
                ${DM_RACE_LANES.map((lane) => `<div class="dm-race-cell ${row[lane] ? 'dm-race-obstacle' : ''}"></div>`).join('')}
            </div>
        `).join('');
        const carHtml = `
            <div class="dm-race-row dm-race-car-row">
                ${DM_RACE_LANES.map((lane) => `<div class="dm-race-cell ${lane === this.race.carLane ? 'dm-race-car' : ''}"></div>`).join('')}
            </div>
        `;
        track.innerHTML = rowsHtml + carHtml;
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
            this._raceSetMessage(`Decided lane: ${decidedLane} (hazard ${hazard !== null && hazard !== undefined ? Math.round(hazard * 100) : '?'}%).`);
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
        this._raceSetMessage(`Crashed after ${survived} row(s) survived! Press Start to try again.`);
        this.race.carLane = 'center';
        this._raceGenerateInitialRows();
        this._raceRenderTrack();
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
