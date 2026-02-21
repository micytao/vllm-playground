/**
 * Speculative Decoding Dashboard Module
 *
 * Shows acceptance rate, speedup factor, and token counts
 * when speculative decoding is active on the vLLM server.
 * Demo simulation is handled by the Observability page.
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
        this._sdHasData = false;

        const toggle = document.getElementById('spec-decode-toggle');
        if (toggle) {
            toggle.addEventListener('click', () => {
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
            if (!resp.ok) {
                this._sdEmptyPollCount = (this._sdEmptyPollCount || 0) + 1;
                this._sdHandleNoData();
                return;
            }
            const m = await resp.json();
            if (m.spec_decode_accepted != null || m.spec_decode_draft != null) {
                this._sdEmptyPollCount = 0;
                this._sdHasData = true;
                this._sdShowNoData(false);
                this._sdUpdate(m);
            } else {
                this._sdEmptyPollCount = (this._sdEmptyPollCount || 0) + 1;
                this._sdHandleNoData();
            }
        } catch {
            this._sdEmptyPollCount = (this._sdEmptyPollCount || 0) + 1;
            this._sdHandleNoData();
        }
    },

    _sdHandleNoData() {
        if (this._sdHasData && this._sdEmptyPollCount >= 2) {
            this._sdHasData = false;
            this._sdResetDisplay();
        }
        this._sdShowNoData(true);
    },

    _sdResetDisplay() {
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

    destroySpecDecode() {
        if (this._sdTimer) {
            clearInterval(this._sdTimer);
            this._sdTimer = null;
        }
    },
};
