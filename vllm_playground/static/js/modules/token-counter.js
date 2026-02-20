/**
 * Live Token Counter Module
 *
 * Shows a real-time token estimate as the user types, plus accumulated
 * conversation tokens, displayed as a gauge against max_model_len.
 *
 * Usage: Import and call initTokenCounterModule(uiInstance).
 */

const DEBOUNCE_MS = 300;
const CHARS_PER_TOKEN = 4;

export function initTokenCounterModule(ui) {
    Object.assign(ui, TokenCounterMethods);
    ui.initTokenCounter();
}

const TokenCounterMethods = {

    initTokenCounter() {
        this._tcMaxModelLen = null;
        this._tcConversationTokens = 0;
        this._tcDebounceTimer = null;
        this._tcTokenizeAvailable = null; // null = unknown, true/false after first probe

        const input = document.getElementById('chat-input');
        if (input) {
            input.addEventListener('input', () => this._tcOnInput());
        }

        this._tcTryGetMaxModelLen();
    },

    _tcTryGetMaxModelLen() {
        // Attempt to get from /api/status periodically until available
        const poll = async () => {
            try {
                const resp = await fetch('/api/status');
                if (!resp.ok) return;
                const data = await resp.json();
                if (data.config?.max_model_len) {
                    this._tcMaxModelLen = data.config.max_model_len;
                    this._tcUpdateDisplay();
                    return;
                }
                // For remote mode, check models
                if (data.models?.[0]?.max_model_len) {
                    this._tcMaxModelLen = data.models[0].max_model_len;
                    this._tcUpdateDisplay();
                    return;
                }
            } catch { /* silent */ }
            setTimeout(poll, 5000);
        };
        poll();
    },

    /**
     * Called from app.js after each chat response to update the authoritative
     * conversation token count. The total context for the *next* request is
     * approximately promptTokens + completionTokens (all prior messages).
     */
    tcUpdateFromUsage(promptTokens, completionTokens) {
        const prompt = promptTokens || 0;
        const completion = completionTokens || 0;
        if (prompt + completion > 0) {
            this._tcConversationTokens = prompt + completion;
            this._tcUpdateDisplay();
        }
    },

    /**
     * Called from app.js on chat clear.
     */
    tcReset() {
        this._tcConversationTokens = 0;
        this._tcUpdateDisplay();
    },

    /**
     * Called from showRemoteServerInfo when max_model_len is discovered.
     */
    tcSetMaxModelLen(len) {
        if (len && len > 0) {
            this._tcMaxModelLen = len;
            this._tcUpdateDisplay();
        }
    },

    _tcOnInput() {
        clearTimeout(this._tcDebounceTimer);
        this._tcDebounceTimer = setTimeout(() => this._tcUpdateDisplay(), DEBOUNCE_MS);
    },

    _tcEstimateTokens(text) {
        if (!text) return 0;
        return Math.ceil(text.length / CHARS_PER_TOKEN);
    },

    _tcUpdateDisplay() {
        const input = document.getElementById('chat-input');
        const systemPrompt = document.getElementById('system-prompt');
        const currentEl = document.getElementById('token-count-current');
        const maxEl = document.getElementById('token-count-max');
        const fillEl = document.getElementById('token-counter-fill');
        if (!currentEl) return;

        const inputTokens = this._tcEstimateTokens(input?.value || '');
        const sysTokens = this._tcEstimateTokens(systemPrompt?.value || '');
        const total = this._tcConversationTokens + inputTokens + (this._tcConversationTokens === 0 ? sysTokens : 0);

        currentEl.textContent = total.toLocaleString();
        currentEl.className = '';

        if (maxEl) {
            maxEl.textContent = this._tcMaxModelLen
                ? this._tcMaxModelLen.toLocaleString()
                : '--';
        }

        if (fillEl && this._tcMaxModelLen) {
            const pct = Math.min((total / this._tcMaxModelLen) * 100, 100);
            fillEl.style.width = `${pct}%`;

            if (pct >= 95) {
                fillEl.style.background = 'var(--danger-color)';
                currentEl.classList.add('tc-danger');
            } else if (pct >= 85) {
                fillEl.style.background = '#f97316';
                currentEl.classList.add('tc-warn');
            } else if (pct >= 70) {
                fillEl.style.background = 'var(--warning-color)';
            } else {
                fillEl.style.background = 'var(--success-color)';
            }

            if (pct >= 90 && !this._tcWarnedAt90) {
                this._tcWarnedAt90 = true;
                if (this.showNotification) {
                    this.showNotification(
                        window.i18n?.t('tokenCounter.warningNearLimit') ||
                        'Approaching context limit — the model may start losing earlier conversation.',
                        'warning', 6000
                    );
                }
            }
            if (pct < 80) {
                this._tcWarnedAt90 = false;
            }
        } else if (fillEl) {
            fillEl.style.width = '0%';
        }
    },
};
