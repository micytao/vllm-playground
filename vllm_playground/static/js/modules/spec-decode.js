/**
 * Speculative Decoding Dashboard Module
 *
 * Shows acceptance rate, speedup factor, and token counts
 * when speculative decoding is active on the vLLM server.
 * Includes a demo simulation mode similar to Context Observability.
 */

const POLL_INTERVAL = 3000;

export function initSpecDecodeModule(ui) {
    Object.assign(ui, SpecDecodeMethods);
    ui.initSpecDecode();
}

const SpecDecodeMethods = {

    initSpecDecode() {
        this._sdVisible = false;
        this._sdTimer = null;
        this._sdDemoRunning = false;
        this._sdDemoTimer = null;
        this._sdIsSimulated = false;
        this._sdHasData = false;

        const toggle = document.getElementById('spec-decode-toggle');
        if (toggle) {
            toggle.addEventListener('click', (e) => {
                if (e.target.closest('.sd-demo-header-btn')) return;
                document.getElementById('spec-decode-panel')?.classList.toggle('collapsed');
            });
        }

        // Show/hide spec-decode sub-fields based on method dropdown
        const specMethodSelect = document.getElementById('spec-decode-method');
        if (specMethodSelect) {
            const updateSpecFields = () => {
                const method = specMethodSelect.value;
                const needsModel = ['eagle', 'eagle3', 'mlp_speculator', 'medusa', 'mtp'].includes(method);
                const needsTP = ['eagle', 'eagle3', 'mlp_speculator'].includes(method);
                const needsNgram = method === 'ngram';
                const active = !!method;

                const modelGroup = document.getElementById('spec-decode-model-group');
                const tokensGroup = document.getElementById('spec-decode-tokens-group');
                const tpGroup = document.getElementById('spec-decode-tp-group');
                const ngramGroup = document.getElementById('spec-decode-ngram-group');
                const modelHelp = document.getElementById('spec-decode-model-help');

                if (modelGroup) modelGroup.style.display = needsModel ? '' : 'none';
                if (tokensGroup) tokensGroup.style.display = active ? '' : 'none';
                if (tpGroup) tpGroup.style.display = needsTP ? '' : 'none';
                if (ngramGroup) ngramGroup.style.display = needsNgram ? '' : 'none';

                const modelInput = document.getElementById('speculative-model');
                if (modelHelp) {
                    const hints = {
                        eagle: 'Must be an EAGLE-trained drafter for your base model (e.g., yuhuili/EAGLE-LLaMA3-Instruct-8B). Regular models will NOT work.',
                        eagle3: 'Must be an EAGLE3-trained speculator (e.g., RedHatAI/Llama-3.1-8B-Instruct-speculator.eagle3).',
                        mlp_speculator: 'Must be an MLP speculator checkpoint (e.g., ibm-ai-platform/llama3-70b-accelerator).',
                        medusa: 'Must be a Medusa head model trained for your base model.',
                        mtp: 'Must be an MTP-compatible model (e.g., DeepSeek-V3 has built-in MTP heads).',
                    };
                    modelHelp.textContent = hints[method] || '';
                }
                if (modelInput) {
                    const placeholders = {
                        eagle: 'e.g., yuhuili/EAGLE-LLaMA3-Instruct-8B',
                        eagle3: 'e.g., RedHatAI/Llama-3.1-8B-Instruct-speculator.eagle3',
                        mlp_speculator: 'e.g., ibm-ai-platform/llama3-70b-accelerator',
                        medusa: 'e.g., FasterDecoding/medusa-vicuna-7b-v1.3',
                        mtp: 'Model with MTP heads (e.g., deepseek-ai/DeepSeek-V3)',
                    };
                    modelInput.placeholder = placeholders[method] || 'HuggingFace model ID';
                }
            };
            specMethodSelect.addEventListener('change', updateSpecFields);
            updateSpecFields();
        }

        // Demo button in no-data area
        const runDemoBtn = document.getElementById('sd-run-demo-btn');
        if (runDemoBtn) {
            runDemoBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._sdRunDemo();
            });
        }

        // Header demo button
        const hdrDemoBtn = document.getElementById('sd-demo-header-btn');
        if (hdrDemoBtn) {
            hdrDemoBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this._sdDemoRunning) {
                    this._sdStopDemo();
                } else {
                    this._sdRunDemo();
                }
            });
        }

        // Header clear button
        const clearBtn = document.getElementById('sd-demo-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._sdClearDemo();
            });
        }

        this._sdShowNoData(true);
        this._sdStartPolling();
    },

    _sdStartPolling() {
        if (this._sdTimer) clearInterval(this._sdTimer);
        this._sdTimer = setInterval(() => this._sdPoll(), POLL_INTERVAL);
    },

    async _sdPoll() {
        try {
            const resp = await fetch('/api/vllm/metrics');
            if (!resp.ok) return;
            const m = await resp.json();
            if (m.spec_decode_accepted != null || m.spec_decode_draft != null) {
                if (this._sdDemoRunning) {
                    this._sdStopDemo();
                }
                this._sdIsSimulated = false;
                this._sdSetSimulatedBadge(false);
                this._sdHasData = true;
                this._sdShowNoData(false);
                this._sdUpdate(m);
            }
        } catch { /* silent */ }
    },

    _sdShowNoData(show) {
        const noData = document.getElementById('sd-no-data');
        const cards = document.querySelector('.spec-decode-cards');
        const info = document.getElementById('spec-decode-model-info');
        if (noData) noData.style.display = show ? '' : 'none';
        if (cards) cards.style.display = show ? 'none' : '';
        if (info) info.style.display = show ? 'none' : '';
    },

    _sdUpdate(m) {
        const accepted = Math.round(m.spec_decode_accepted || 0);
        const draft = Math.round(m.spec_decode_draft || 0);
        const emitted = Math.round(m.spec_decode_emitted || 0);

        // Acceptance rate
        const rate = draft > 0 ? (accepted / draft) * 100 : 0;
        const rateEl = document.getElementById('spec-acceptance-rate');
        const fillEl = document.getElementById('spec-acceptance-fill');
        if (rateEl) rateEl.textContent = rate.toFixed(1) + '%';
        if (fillEl) {
            fillEl.style.width = rate + '%';
            if (rate >= 70) fillEl.style.background = 'var(--success-color)';
            else if (rate >= 40) fillEl.style.background = 'var(--warning-color)';
            else fillEl.style.background = 'var(--danger-color)';
        }

        // Speedup heuristic
        let speedup = 1.0;
        if (draft > 0 && emitted > 0) {
            const verificationSteps = draft - accepted + emitted;
            speedup = verificationSteps > 0 ? emitted / (emitted - accepted + (draft - accepted)) : 1.0;
            if (speedup < 1) speedup = 1.0;
        }
        const speedupEl = document.getElementById('spec-speedup-value');
        if (speedupEl) speedupEl.textContent = speedup.toFixed(2) + 'x';

        // Raw counters
        const draftEl = document.getElementById('spec-draft-tokens');
        const acceptedEl = document.getElementById('spec-accepted-tokens');
        if (draftEl) draftEl.textContent = draft.toLocaleString();
        if (acceptedEl) acceptedEl.textContent = accepted.toLocaleString();

        // Model info
        const infoEl = document.getElementById('spec-decode-model-info');
        if (infoEl && emitted > 0) {
            infoEl.textContent = `Total emitted: ${emitted.toLocaleString()} tokens`;
        }
    },

    // --- Demo Simulation ---

    async _sdRunDemo() {
        if (this._sdDemoRunning) return;
        this._sdDemoRunning = true;
        this._sdIsSimulated = true;
        this._sdHasData = true;
        this._sdSetDemoBtnState(true);
        this._sdSetSimulatedBadge(true);
        this._sdShowNoData(false);

        const steps = [
            // Phase 1: Warming up — low acceptance
            { accepted: 50,   draft: 200,  emitted: 160,  label: 'Warming up (low acceptance)' },
            { accepted: 80,   draft: 300,  emitted: 250 },
            { accepted: 120,  draft: 400,  emitted: 340 },
            // Phase 2: Improving — acceptance rate climbing
            { accepted: 250,  draft: 500,  emitted: 480,  label: 'Improving acceptance' },
            { accepted: 400,  draft: 600,  emitted: 620 },
            { accepted: 560,  draft: 700,  emitted: 780 },
            // Phase 3: Steady state — high acceptance
            { accepted: 800,  draft: 1000, emitted: 1100, label: 'High acceptance (80%)' },
            { accepted: 1050, draft: 1300, emitted: 1400 },
            { accepted: 1300, draft: 1600, emitted: 1720 },
            { accepted: 1560, draft: 1900, emitted: 2050 },
            // Phase 4: Difficult passage — acceptance drops
            { accepted: 1620, draft: 2200, emitted: 2200, label: 'Harder passage (rate dropping)' },
            { accepted: 1680, draft: 2500, emitted: 2350 },
            { accepted: 1720, draft: 2800, emitted: 2480 },
            // Phase 5: Recovery
            { accepted: 1900, draft: 3000, emitted: 2700, label: 'Recovery' },
            { accepted: 2150, draft: 3200, emitted: 2960 },
            { accepted: 2400, draft: 3400, emitted: 3200 },
        ];

        for (let i = 0; i < steps.length; i++) {
            if (!this._sdDemoRunning) break;

            const s = steps[i];
            if (s.label && this.showNotification) {
                this.showNotification(`Spec Decode Demo: ${s.label}`, 'info', 2500);
            }

            this._sdUpdate({
                spec_decode_accepted: s.accepted,
                spec_decode_draft: s.draft,
                spec_decode_emitted: s.emitted,
            });

            await new Promise(r => { this._sdDemoTimer = setTimeout(r, 1500); });
        }

        this._sdDemoRunning = false;
        this._sdSetDemoBtnState(false);
    },

    _sdStopDemo() {
        this._sdDemoRunning = false;
        if (this._sdDemoTimer) {
            clearTimeout(this._sdDemoTimer);
            this._sdDemoTimer = null;
        }
        this._sdSetDemoBtnState(false);
    },

    _sdClearDemo() {
        this._sdStopDemo();
        this._sdIsSimulated = false;
        this._sdHasData = false;

        // Reset all card values
        const ids = {
            'spec-acceptance-rate': '--%',
            'spec-speedup-value': '--x',
            'spec-draft-tokens': '--',
            'spec-accepted-tokens': '--',
        };
        for (const [id, val] of Object.entries(ids)) {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        }

        const fill = document.getElementById('spec-acceptance-fill');
        if (fill) { fill.style.width = '0%'; fill.style.background = 'var(--accent-primary)'; }

        const info = document.getElementById('spec-decode-model-info');
        if (info) info.textContent = '';

        this._sdSetSimulatedBadge(false);
        this._sdShowNoData(true);
    },

    _sdSetDemoBtnState(running) {
        const btn = document.getElementById('sd-run-demo-btn');
        const hdrBtn = document.getElementById('sd-demo-header-btn');
        if (btn) {
            btn.textContent = running
                ? (window.i18n?.t('specDecode.demo.running') || '⏳ Simulating...')
                : (window.i18n?.t('specDecode.demo.runButton') || '▶ Run Demo Simulation');
            btn.disabled = running;
        }
        if (hdrBtn) {
            hdrBtn.textContent = running
                ? (window.i18n?.t('specDecode.demo.running') || '⏳ Running...')
                : 'Demo';
            hdrBtn.classList.toggle('running', running);
        }
    },

    _sdSetSimulatedBadge(show) {
        const badge = document.getElementById('sd-simulated-badge');
        if (badge) badge.classList.toggle('visible', show);
        const clearBtn = document.getElementById('sd-demo-clear-btn');
        if (clearBtn) clearBtn.style.display = show ? '' : 'none';
    },

    destroySpecDecode() {
        this._sdStopDemo();
        if (this._sdTimer) {
            clearInterval(this._sdTimer);
            this._sdTimer = null;
        }
    },
};
