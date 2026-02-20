/**
 * Logprobs Visualizer Module
 *
 * Renders assistant responses with per-token probability heatmap coloring
 * and hover tooltips showing alternative tokens.
 */

export function initLogprobsModule(ui) {
    Object.assign(ui, LogprobsMethods);
    ui.initLogprobs();
}

function probLevel(logprob) {
    const p = Math.exp(logprob);
    if (p >= 0.8) return 'high';
    if (p >= 0.4) return 'medium';
    if (p >= 0.1) return 'low';
    return 'very-low';
}

function formatProb(logprob) {
    return (Math.exp(logprob) * 100).toFixed(1) + '%';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

const LogprobsMethods = {

    initLogprobs() {
        const cb = document.getElementById('logprobs-enabled');
        const topk = document.getElementById('logprobs-topk');
        if (cb && topk) {
            cb.addEventListener('change', () => {
                topk.disabled = !cb.checked;
            });
        }
    },

    /**
     * Returns { logprobs: true, top_logprobs: N } or {} if disabled,
     * for inclusion in the chat API request payload.
     */
    getLogprobsPayload() {
        const cb = document.getElementById('logprobs-enabled');
        if (!cb?.checked) return {};
        const topk = parseInt(document.getElementById('logprobs-topk')?.value) || 5;
        return { logprobs: true, top_logprobs: topk };
    },

    /**
     * Returns true if logprobs display is enabled by the user.
     */
    isLogprobsEnabled() {
        return !!document.getElementById('logprobs-enabled')?.checked;
    },

    /**
     * Render a completed assistant message with logprobs heatmap.
     * @param {HTMLElement} textSpan - The .message-text element
     * @param {string} fullText - The complete response text
     * @param {Array} logprobsContent - Array of token logprob objects from the API
     */
    renderLogprobs(textSpan, fullText, logprobsContent) {
        if (!logprobsContent || logprobsContent.length === 0) return;

        const container = document.createElement('span');
        container.className = 'logprobs-content';

        for (const item of logprobsContent) {
            const token = item.token;
            const logprob = item.logprob;
            const topLogprobs = item.top_logprobs || [];

            const span = document.createElement('span');
            span.className = 'logprobs-token';
            span.setAttribute('data-prob-level', probLevel(logprob));
            span.textContent = token;

            // Build tooltip
            if (topLogprobs.length > 0) {
                const tooltip = document.createElement('div');
                tooltip.className = 'logprobs-tooltip';

                for (const alt of topLogprobs) {
                    const row = document.createElement('div');
                    row.className = 'logprobs-tooltip-row';
                    if (alt.token === token) row.classList.add('chosen');

                    const tokenEl = document.createElement('span');
                    tokenEl.className = 'logprobs-tooltip-token';
                    tokenEl.textContent = JSON.stringify(alt.token);

                    const probEl = document.createElement('span');
                    probEl.className = 'logprobs-tooltip-prob';
                    probEl.textContent = formatProb(alt.logprob);

                    row.appendChild(tokenEl);
                    row.appendChild(probEl);
                    tooltip.appendChild(row);
                }
                span.appendChild(tooltip);
            }

            container.appendChild(span);
        }

        textSpan.innerHTML = '';
        textSpan.appendChild(container);
    },
};
