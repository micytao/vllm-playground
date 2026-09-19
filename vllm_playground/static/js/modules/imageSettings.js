/**
 * Settings / Container Image Version Module
 *
 * Provides the "Settings" sidebar tab, letting users override which
 * container image version is used per accelerator (vLLM GPU NVIDIA/AMD,
 * vLLM CPU, vLLM-Omni NVIDIA/AMD) when running in Container mode.
 *
 * Versions are fetched from GET /api/settings/image-catalog (live from
 * Docker Hub, cached server-side, with an offline fallback list). Selections
 * are persisted via the existing generic /api/settings endpoint using the
 * `saveSettings()` helper already defined on the UI instance.
 *
 * Usage: Import and call initImageSettingsModule(uiInstance) to add
 * Settings-tab methods to the UI class.
 */

/**
 * Initialize the Settings/Image Version module and add methods to the UI instance
 * @param {Object} ui - The VLLMWebUI instance
 */
export function initImageSettingsModule(ui) {
    Object.assign(ui, ImageSettingsMethods);
    ui.initImageSettings();
}

const ImageSettingsMethods = {

    // ============================================
    // Initialization
    // ============================================

    initImageSettings() {
        console.log('Initializing Settings / Container Images module');
        this._imageSettingsTemplateLoaded = false;
        this._imageCatalog = null; // Last-fetched catalog, keyed by settings key
    },

    /**
     * Called by switchView() whenever the Settings tab becomes active.
     */
    onSettingsViewActivated() {
        this.loadSettingsTemplate().then(() => {
            this.fetchAndRenderImageCatalog(false);
        });
    },

    // ============================================
    // Template Loading (lazy, same pattern as vLLM-Omni)
    // ============================================

    async loadSettingsTemplate() {
        const container = document.getElementById('settings-view');
        if (!container) {
            console.error('Settings view container not found');
            return;
        }

        if (this._imageSettingsTemplateLoaded && container.querySelector('#image-settings-rows')) {
            return;
        }

        try {
            const response = await fetch('/static/templates/settings.html');
            if (!response.ok) throw new Error(`Failed to load template: ${response.status}`);

            const html = await response.text();
            container.innerHTML = html;
            this._imageSettingsTemplateLoaded = true;

            const refreshBtn = document.getElementById('image-settings-refresh-btn');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => this.fetchAndRenderImageCatalog(true));
            }
        } catch (error) {
            console.error('Failed to load Settings template:', error);
            container.innerHTML = `
                <div class="error-message">
                    <h3>Failed to load Settings</h3>
                    <p>${error.message}</p>
                </div>`;
        }
    },

    // ============================================
    // Catalog Fetching + Rendering
    // ============================================

    async fetchAndRenderImageCatalog(forceRefresh) {
        const rowsContainer = document.getElementById('image-settings-rows');
        if (!rowsContainer) return;

        try {
            const url = forceRefresh ? '/api/settings/image-catalog?refresh=true' : '/api/settings/image-catalog';
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const catalog = await response.json();
            this._imageCatalog = catalog;

            rowsContainer.innerHTML = '';
            Object.keys(catalog).forEach((key) => {
                rowsContainer.appendChild(this.buildImageSettingsRow(key, catalog[key]));
            });

            if (forceRefresh) {
                this.showNotification('Container image versions refreshed', 'success');
            }
        } catch (error) {
            console.error('Failed to load image catalog:', error);
            rowsContainer.innerHTML = `
                <tr>
                    <td class="image-settings-error">
                        Failed to load container image versions: ${error.message}
                    </td>
                </tr>`;
        }
    },

    /**
     * Build one row (title + inline version select, repo, description) for
     * a single image catalog entry.
     *
     * Built with plain DOM calls (createElement) rather than cloning a
     * <template> containing a bare <tr> - browsers are inconsistent about
     * parsing/cloning table rows declared outside a <table>/<tbody> wrapper
     * inside <template>.
     */
    buildImageSettingsRow(key, entry) {
        const row = document.createElement('tr');
        row.className = 'image-settings-row';
        row.dataset.key = key;

        const cell = document.createElement('td');

        // --- Header line: title on the left, version controls flush right ---
        const header = document.createElement('div');
        header.className = 'image-settings-row-header';

        const title = document.createElement('span');
        title.className = 'image-settings-row-title';
        title.textContent = entry.label;
        header.appendChild(title);

        const controls = document.createElement('div');
        controls.className = 'image-settings-row-controls';

        const select = document.createElement('select');
        select.className = 'image-settings-select';
        controls.appendChild(select);

        const customInput = document.createElement('input');
        customInput.type = 'text';
        customInput.className = 'image-settings-custom-input';
        customInput.placeholder = 'e.g. v0.30.0 or registry.io/vllm-openai:tag';
        customInput.style.display = 'none';
        controls.appendChild(customInput);

        header.appendChild(controls);
        cell.appendChild(header);

        // --- Repo + description, below the header line ---
        const repo = document.createElement('span');
        repo.className = 'image-settings-row-repo';
        repo.textContent = entry.repo;
        cell.appendChild(repo);

        const description = document.createElement('p');
        description.className = 'image-settings-row-description';
        description.textContent = entry.description || '';
        cell.appendChild(description);

        row.appendChild(cell);

        // Populate options: each known version, default tag labeled, plus "Custom..."
        entry.options.forEach((tag) => {
            const opt = document.createElement('option');
            opt.value = tag;
            opt.textContent = tag === entry.default_tag ? `${tag} (default)` : tag;
            select.appendChild(opt);
        });
        const customOpt = document.createElement('option');
        customOpt.value = '__custom__';
        customOpt.textContent = 'Custom…';
        select.appendChild(customOpt);

        // Determine initial selection from the persisted override
        const currentOverride = entry.current_override || '';
        if (!currentOverride) {
            select.value = entry.default_tag;
        } else if (entry.options.includes(currentOverride)) {
            select.value = currentOverride;
        } else {
            // Custom tag not in the known options list
            select.value = '__custom__';
            customInput.value = currentOverride;
            customInput.style.display = 'inline-block';
        }

        // Wire events
        select.addEventListener('change', () => {
            if (select.value === '__custom__') {
                customInput.style.display = 'inline-block';
                customInput.focus();
                // Don't save yet - wait for the user to type a custom value
            } else {
                customInput.style.display = 'none';
                const value = select.value === entry.default_tag ? '' : select.value;
                this.saveImageOverride(key, value);
            }
        });

        let customInputTimer = null;
        customInput.addEventListener('input', () => {
            clearTimeout(customInputTimer);
            customInputTimer = setTimeout(() => {
                const value = customInput.value.trim();
                if (value) {
                    this.saveImageOverride(key, value);
                }
            }, 600); // debounce while typing
        });

        return row;
    },

    /**
     * Persist an image override (or clear it with an empty string) and
     * show a brief confirmation.
     */
    saveImageOverride(key, value) {
        this.saveSettings({ [key]: value });
        if (value) {
            this.showNotification(`Image version set: ${value}`, 'success');
        } else {
            this.showNotification('Reset to built-in default version', 'info');
        }
    },
};
