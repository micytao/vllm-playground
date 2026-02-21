/**
 * MetricsPoller -- single shared polling loop for all metric consumers.
 *
 * Replaces three independent setInterval calls in paged-attention.js,
 * spec-decode.js, and app.js with one fetch + broadcast.
 *
 * Usage:
 *   import { metricsPoller } from './metrics-poller.js';
 *   metricsPoller.subscribe(data => { ... });
 *   metricsPoller.start();
 */

class MetricsPoller {
    constructor(interval = 3000) {
        this._interval = interval;
        this._timer = null;
        this._subscribers = new Set();
        this._latestAll = null;
        this._latestLegacy = null;
    }

    /**
     * Subscribe to metric updates.
     * @param {function} callback - called with { all, legacy } on each poll
     *   all:    structured dict from /api/vllm/metrics/all
     *   legacy: flat dict from /api/vllm/metrics (backward compat)
     * @returns {function} unsubscribe function
     */
    subscribe(callback) {
        this._subscribers.add(callback);
        if (this._latestAll) {
            try { callback({ all: this._latestAll, legacy: this._latestLegacy }); } catch {}
        }
        return () => this._subscribers.delete(callback);
    }

    unsubscribe(callback) {
        this._subscribers.delete(callback);
    }

    start() {
        if (this._timer) return;
        this._poll();
        this._timer = setInterval(() => this._poll(), this._interval);
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    get latest() {
        return { all: this._latestAll, legacy: this._latestLegacy };
    }

    async _poll() {
        try {
            const resp = await fetch('/api/vllm/metrics/all');
            if (!resp.ok) {
                this._notify(null, null);
                return;
            }
            const data = await resp.json();
            this._latestAll = data;

            const legacyResp = await fetch('/api/vllm/metrics');
            this._latestLegacy = legacyResp.ok ? await legacyResp.json() : null;

            this._notify(data, this._latestLegacy);
        } catch {
            this._notify(null, null);
        }
    }

    _notify(all, legacy) {
        const payload = { all, legacy };
        for (const cb of this._subscribers) {
            try { cb(payload); } catch {}
        }
    }

    /**
     * Fetch time-series history for charting.
     * @param {number} [minutes] - optional window in minutes
     * @returns {Promise<Array>}
     */
    async getHistory(minutes) {
        const url = minutes != null
            ? `/api/vllm/metrics/history?minutes=${minutes}`
            : '/api/vllm/metrics/history';
        try {
            const resp = await fetch(url);
            return resp.ok ? await resp.json() : [];
        } catch {
            return [];
        }
    }
}

export const metricsPoller = new MetricsPoller(3000);
