// =============================================================================
// vLLM-Omni Module
// Handles vLLM-Omni multimodal generation functionality
// Reuses patterns from: guidellm.js, mcp.js, app.js
// =============================================================================

/**
 * Initialize the vLLM-Omni module
 * @param {VLLMWebUI} ui - The main UI instance
 */
export function initOmniModule(ui) {
    OmniModule.ui = ui;
    injectMethods(ui);

    // Check availability using already-fetched data from ui
    OmniModule.available = ui.omniAvailable || false;
    OmniModule.version = ui.omniVersion || null;

    // Pass through ModelScope availability from main app (already detected on startup)
    OmniModule.modelscopeInstalled = ui.modelscopeInstalled || false;
    OmniModule.modelscopeVersion = ui.modelscopeVersion || null;

    // Pass through container mode availability from main app
    OmniModule.containerModeAvailable = ui.containerModeAvailable || false;

    // Make OmniModule globally accessible for retry button
    window.OmniModule = OmniModule;

    console.log('vLLM-Omni module initialized, available:', OmniModule.available);
    console.log('vLLM-Omni: ModelScope installed:', OmniModule.modelscopeInstalled);
}

/**
 * Inject vLLM-Omni methods into the UI class
 */
function injectMethods(ui) {
    ui.startOmniServer = OmniModule.startServer.bind(OmniModule);
    ui.stopOmniServer = OmniModule.stopServer.bind(OmniModule);
    ui.generateOmniImage = OmniModule.generateImage.bind(OmniModule);
    ui.loadOmniTemplate = OmniModule.loadTemplate.bind(OmniModule);
    ui.onOmniViewActivated = OmniModule.onViewActivated.bind(OmniModule);
}

/**
 * vLLM-Omni Module object with all methods
 */
export const OmniModule = {
    ui: null,
    available: false,
    version: null,
    serverRunning: false,
    serverReady: false,  // True when API endpoint is actually responding
    healthCheckInterval: null,
    templateLoaded: false,
    currentModelType: 'image',
    currentModelSource: 'hub',
    uploadedImage: null,
    chatHistory: [],
    logWebSocket: null,  // WebSocket for log streaming

    // =========================================================================
    // Template Loading (Option B - Separate HTML)
    // =========================================================================

    async loadTemplate() {
        const container = document.getElementById('vllm-omni-view');

        // Skip if already loaded
        if (this.templateLoaded) {
            console.log('vLLM-Omni template already loaded');
            return;
        }

        console.log('Loading vLLM-Omni template...');

        try {
            const response = await fetch('/static/templates/vllm-omni.html');
            console.log('Fetch response status:', response.status);

            if (!response.ok) throw new Error(`Failed to load template: ${response.status}`);

            const html = await response.text();
            console.log('Template HTML loaded, length:', html.length);

            // Replace loading placeholder with actual content
            container.innerHTML = html;
            this.templateLoaded = true;

            console.log('Template injected, initializing...');

            // Initialize event listeners and UI after template is loaded
            this.init();

            console.log('vLLM-Omni template loaded successfully');
        } catch (error) {
            console.error('Failed to load vLLM-Omni template:', error);
            container.innerHTML = `
                <div class="error-message">
                    <h3>Failed to load vLLM-Omni</h3>
                    <p>${error.message}</p>
                    <button class="btn btn-primary" onclick="window.OmniModule.loadTemplate()">Retry</button>
                </div>
            `;
        }
    },

    onViewActivated() {
        if (!this.templateLoaded) {
            this.loadTemplate();
        } else {
            // Refresh status when returning to view
            this.checkServerStatus();
        }
    },

    // =========================================================================
    // Initialization (called after template loads)
    // =========================================================================

    init() {
        try {
            console.log('Omni init: setting up event listeners...');
            this.setupEventListeners();
            console.log('Omni init: updating availability status...');
            this.updateAvailabilityStatus();
            console.log('Omni init: updating ModelScope availability...');
            this.updateModelscopeAvailability();
            console.log('Omni init: loading model list...');
            this.loadModelList();
            console.log('Omni init: checking server status...');
            this.checkServerStatus();
            console.log('Omni init: updating command preview...');
            this.updateCommandPreview();
            console.log('Omni init: connecting to log WebSocket...');
            this.connectLogWebSocket();
            console.log('Omni init: complete');
        } catch (error) {
            console.error('Omni init error:', error);
        }
    },

    connectLogWebSocket() {
        // Connect to vLLM-Omni log streaming WebSocket
        if (this.logWebSocket && this.logWebSocket.readyState === WebSocket.OPEN) {
            return; // Already connected
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/omni/logs`;

        try {
            this.logWebSocket = new WebSocket(wsUrl);

            this.logWebSocket.onopen = () => {
                console.log('Omni log WebSocket connected');
            };

            this.logWebSocket.onmessage = (event) => {
                const message = event.data;
                if (message && message.trim()) {
                    this.addLog(message);
                }
            };

            this.logWebSocket.onerror = (error) => {
                console.error('Omni log WebSocket error:', error);
            };

            this.logWebSocket.onclose = () => {
                console.log('Omni log WebSocket closed');
                // Attempt to reconnect after 1 second if server is still running (faster reconnect)
                if (this.serverRunning) {
                    setTimeout(() => this.connectLogWebSocket(), 1000);
                }
            };
        } catch (error) {
            console.error('Failed to connect omni log WebSocket:', error);
        }
    },

    disconnectLogWebSocket() {
        if (this.logWebSocket) {
            this.logWebSocket.close();
            this.logWebSocket = null;
        }
    },

    setupEventListeners() {
        // Server controls
        document.getElementById('omni-start-btn')?.addEventListener('click', () => this.startServer());
        document.getElementById('omni-stop-btn')?.addEventListener('click', () => this.stopServer());

        // Generate button - dispatch based on model type
        document.getElementById('omni-generate-btn')?.addEventListener('click', () => {
            if (this.currentModelType === 'video') {
                this.generateVideo();
            } else if (this.currentModelType === 'audio') {
                this.generateAudio();
            } else {
                this.generateImage();
            }
        });

        // Model type change
        document.getElementById('omni-model-type')?.addEventListener('change', (e) => {
            this.onModelTypeChange(e.target.value);
        });

        // Model selection change - update model ID display
        document.getElementById('omni-model-select')?.addEventListener('change', (e) => {
            this.updateModelIdDisplay(e.target.value);
        });

        // Model Source toggle
        document.getElementById('omni-model-source-hub')?.addEventListener('change', () => {
            this.toggleModelSource();
            this.updateCommandPreview();
        });
        document.getElementById('omni-model-source-modelscope')?.addEventListener('change', () => {
            this.toggleModelSource();
            this.updateCommandPreview();
        });

        // Copy command button
        document.getElementById('omni-copy-command-btn')?.addEventListener('click', () => this.copyCommand());

        // Update command preview on config changes
        const configElements = [
            document.getElementById('omni-model-type'),
            document.getElementById('omni-model-select'),
            document.getElementById('omni-port'),
            document.getElementById('omni-venv-path'),
            document.getElementById('omni-gpu-device'),
            document.getElementById('omni-height'),
            document.getElementById('omni-width'),
            document.getElementById('omni-steps'),
            document.getElementById('omni-guidance')
        ].filter(el => el);

        configElements.forEach(element => {
            element.addEventListener('input', () => this.updateCommandPreview());
            element.addEventListener('change', () => this.updateCommandPreview());
        });

        // Run mode changes
        document.querySelectorAll('input[name="omni-run-mode"]').forEach(radio => {
            radio.addEventListener('change', () => this.updateCommandPreview());
        });

        // Parameter sliders
        document.getElementById('omni-steps')?.addEventListener('input', (e) => {
            document.getElementById('omni-steps-value').textContent = e.target.value;
        });
        document.getElementById('omni-guidance')?.addEventListener('input', (e) => {
            document.getElementById('omni-guidance-value').textContent = e.target.value;
        });

        // Run mode toggle
        document.querySelectorAll('input[name="omni-run-mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => this.onRunModeChange(e.target.value));
        });

        // Image upload dropzone
        this.setupDropzone();

        // Initialize resize functionality
        this.initResize();

        // Chat functionality
        document.getElementById('omni-chat-send-btn')?.addEventListener('click', () => this.sendOmniChatMessage());
        document.getElementById('omni-chat-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendOmniChatMessage();
            }
        });

        // Attach image button for chat
        document.getElementById('omni-attach-image-btn')?.addEventListener('click', () => {
            document.getElementById('omni-chat-image-input')?.click();
        });

        // Chat clear and export buttons
        document.getElementById('omni-clear-chat-btn')?.addEventListener('click', () => this.clearChat());
        document.getElementById('omni-export-chat-btn')?.addEventListener('click', () => this.exportChat());

        // Logs controls
        document.getElementById('omni-clear-logs-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.clearLogs();
        });
        document.getElementById('omni-save-logs-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.saveLogs();
        });

        // Logs row toggle (collapsible)
        document.getElementById('omni-logs-row-toggle')?.addEventListener('click', (e) => {
            // Don't toggle if clicking on controls
            if (e.target.closest('.logs-row-controls')) return;
            this.toggleLogsRow();
        });

        // Install section toggle (collapsible)
        document.getElementById('omni-install-toggle')?.addEventListener('click', () => {
            this.toggleInstallSection();
        });

        // Venv path validation (check vLLM-Omni version when path changes)
        document.getElementById('omni-venv-path')?.addEventListener('blur', () => {
            this.checkOmniVenvVersion();
        });
    },

    setupDropzone() {
        const dropzone = document.getElementById('omni-dropzone');
        const fileInput = document.getElementById('omni-image-input');

        if (!dropzone || !fileInput) return;

        // Click to browse
        dropzone.addEventListener('click', () => fileInput.click());

        // File selected
        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                this.handleImageUpload(e.target.files[0]);
            }
        });

        // Drag and drop
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('dragover');
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');

            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                this.handleImageUpload(e.dataTransfer.files[0]);
            }
        });

        // Clear upload
        document.getElementById('omni-clear-upload')?.addEventListener('click', () => {
            this.clearUploadedImage();
        });
    },

    handleImageUpload(file) {
        if (!file.type.startsWith('image/')) {
            this.ui.showNotification('Please upload an image file', 'warning');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            this.uploadedImage = e.target.result;

            // Show preview
            const preview = document.getElementById('omni-uploaded-preview');
            const img = document.getElementById('omni-uploaded-image');
            const dropzone = document.getElementById('omni-dropzone');

            if (img) img.src = this.uploadedImage;
            if (preview) preview.style.display = 'flex';
            if (dropzone) dropzone.style.display = 'none';

            this.ui.showNotification('Image uploaded for image-to-image generation', 'success');
        };
        reader.readAsDataURL(file);
    },

    clearUploadedImage() {
        this.uploadedImage = null;

        const preview = document.getElementById('omni-uploaded-preview');
        const dropzone = document.getElementById('omni-dropzone');
        const fileInput = document.getElementById('omni-image-input');

        if (preview) preview.style.display = 'none';
        if (dropzone) dropzone.style.display = 'flex';
        if (fileInput) fileInput.value = '';
    },

    // =========================================================================
    // Availability Status (reuse MCP pattern)
    // =========================================================================

    updateAvailabilityStatus() {
        const statusEl = document.getElementById('omni-availability-status');
        const installSection = document.getElementById('omni-install-section');
        const installBadge = document.getElementById('omni-install-badge');
        const contentEl = document.getElementById('omni-content-wrapper');

        console.log('updateAvailabilityStatus: available =', this.available);

        if (this.available) {
            // vLLM-Omni is installed
            if (statusEl) {
                statusEl.querySelector('.status-dot')?.classList.add('online');
                const textEl = statusEl.querySelector('.status-text');
                if (textEl) textEl.textContent = this.version ? `v${this.version}` : 'Available';
            }
            // Update install section badge to show version
            if (installSection) {
                installSection.style.display = 'block';
                installSection.classList.add('collapsed'); // Collapse when installed
            }
            if (installBadge) {
                installBadge.textContent = this.version ? `v${this.version}` : 'Installed';
                installBadge.classList.remove('not-installed');
                installBadge.classList.add('installed');
            }
            if (contentEl) contentEl.style.display = 'flex';
        } else {
            // vLLM-Omni not installed - show installation section expanded
            if (statusEl) {
                statusEl.querySelector('.status-dot')?.classList.remove('online');
                const textEl = statusEl.querySelector('.status-text');
                if (textEl) textEl.textContent = 'Not Installed (use Container mode)';
            }
            // Show install section expanded when not installed
            if (installSection) {
                installSection.style.display = 'block';
                installSection.classList.remove('collapsed'); // Expand to show instructions
            }
            if (installBadge) {
                installBadge.textContent = 'Not Installed';
                installBadge.classList.add('not-installed');
                installBadge.classList.remove('installed');
            }
            // Show content - user can still use container mode
            if (contentEl) contentEl.style.display = 'flex';
        }

        // Update run mode availability based on installation status
        this.updateRunModeAvailability();
    },

    // =========================================================================
    // Run Mode Availability (following main vLLM Server pattern)
    // =========================================================================

    updateRunModeAvailability() {
        const subprocessLabel = document.getElementById('omni-run-mode-subprocess-label');
        const subprocessRadio = document.getElementById('omni-run-mode-subprocess');
        const containerRadio = document.getElementById('omni-run-mode-container');
        const helpText = document.getElementById('omni-run-mode-help');

        if (!this.available) {
            // vLLM-Omni not installed - disable subprocess mode
            if (subprocessLabel) {
                subprocessLabel.classList.add('mode-unavailable');
                subprocessLabel.title = 'vLLM-Omni not installed. Install it or use Container mode.';
            }
            if (subprocessRadio) {
                subprocessRadio.disabled = true;
                // If subprocess was selected, switch to container mode
                if (subprocessRadio.checked) {
                    subprocessRadio.checked = false;
                    if (containerRadio) containerRadio.checked = true;
                    this.onRunModeChange('container');
                }
            }
            if (helpText && subprocessRadio?.checked !== true) {
                helpText.innerHTML = '<span style="color: var(--warning-color);">Subprocess requires vLLM-Omni installation</span>';
            }
        } else {
            // vLLM-Omni installed - enable subprocess mode
            if (subprocessLabel) {
                subprocessLabel.classList.remove('mode-unavailable');
                subprocessLabel.title = '';
            }
            if (subprocessRadio) {
                subprocessRadio.disabled = false;
            }
        }
    },

    // =========================================================================
    // ModelScope Availability (passed from main vLLM Server)
    // =========================================================================

    updateModelscopeAvailability() {
        // Use ModelScope availability from main app (already detected on startup)
        const modelscopeLabel = document.getElementById('omni-model-source-modelscope-label');
        const modelscopeRadio = document.getElementById('omni-model-source-modelscope');

        if (!this.modelscopeInstalled) {
            // ModelScope not installed - disable the option
            if (modelscopeLabel) {
                modelscopeLabel.classList.add('mode-unavailable');
                modelscopeLabel.title = 'ModelScope SDK not installed. Run: pip install modelscope>=1.18.1';
            }
            if (modelscopeRadio) {
                modelscopeRadio.disabled = true;
                // If ModelScope was selected, switch to HuggingFace
                if (modelscopeRadio.checked) {
                    modelscopeRadio.checked = false;
                    const hubRadio = document.getElementById('omni-model-source-hub');
                    if (hubRadio) hubRadio.checked = true;
                    this.toggleModelSource();
                }
            }
        } else {
            // ModelScope installed - enable the option
            if (modelscopeLabel) {
                modelscopeLabel.classList.remove('mode-unavailable');
                const versionText = this.modelscopeVersion ? `v${this.modelscopeVersion}` : '';
                modelscopeLabel.title = versionText ? `ModelScope SDK ${versionText}` : 'ModelScope SDK installed';
            }
            if (modelscopeRadio) {
                modelscopeRadio.disabled = false;
            }
        }
    },

    // =========================================================================
    // Venv Version Check (following main vLLM Server pattern)
    // =========================================================================

    async checkOmniVenvVersion() {
        const venvPath = document.getElementById('omni-venv-path')?.value?.trim();

        if (!venvPath) {
            // Reset to system check - don't change availability
            return;
        }

        try {
            const response = await fetch('/api/omni/check-venv', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ venv_path: venvPath })
            });

            const result = await response.json();

            if (result.vllm_omni_installed) {
                this.available = true;
                this.version = result.vllm_omni_version;
                this.ui?.showNotification(`vLLM-Omni v${this.version} found in custom venv`, 'success');
            } else {
                // Venv doesn't have vLLM-Omni - show warning
                this.ui?.showNotification('vLLM-Omni not found in specified venv path', 'warning');
            }

            // Update UI with new availability info
            this.updateAvailabilityStatus();

        } catch (error) {
            console.error('Error checking venv vLLM-Omni version:', error);
            // Don't change status on error - keep previous state
        }
    },

    toggleInstallSection() {
        const installSection = document.getElementById('omni-install-section');
        if (installSection) {
            installSection.classList.toggle('collapsed');
        }
    },

    // =========================================================================
    // Model Type Switching (Hybrid UI)
    // =========================================================================

    onModelTypeChange(modelType) {
        this.currentModelType = modelType;

        const studioPanel = document.getElementById('omni-studio-panel');
        const chatPanel = document.getElementById('omni-chat-panel');
        const imageParams = document.getElementById('omni-image-params');
        const videoParams = document.getElementById('omni-video-params');
        const imageUpload = document.getElementById('omni-image-upload');
        const tipEl = document.getElementById('omni-model-type-tip');

        // Update tip text based on model type
        const tipTexts = {
            'image': 'Generate images from text prompts (Text-to-Image)',
            'video': 'Generate videos from text prompts (Text-to-Video)',
            'audio': 'Generate speech/audio from text (Text-to-Speech)',
            'omni': 'Multimodal chat with text AND audio input/output'
        };
        if (tipEl) {
            tipEl.textContent = tipTexts[modelType] || tipTexts['image'];
        }

        // Update studio UI elements for image/video/audio
        this.updateStudioUI(modelType);

        if (modelType === 'omni') {
            // Show chat interface for Omni models
            if (studioPanel) studioPanel.style.display = 'none';
            if (chatPanel) chatPanel.style.display = 'flex';
            if (imageParams) imageParams.style.display = 'none';
        } else {
            // Show generation studio for image/video models
            if (studioPanel) studioPanel.style.display = 'flex';
            if (chatPanel) chatPanel.style.display = 'none';
            if (imageParams) imageParams.style.display = 'block';
        }

        // Update model dropdown options
        this.updateModelOptions(modelType);
    },

    updateStudioUI(modelType) {
        // UI element references
        const studioIcon = document.getElementById('omni-studio-icon');
        const studioTitle = document.getElementById('omni-studio-title');
        const imageUpload = document.getElementById('omni-image-upload');
        const videoParams = document.getElementById('omni-video-params');
        const generateBtnText = document.getElementById('omni-generate-btn-text');
        const promptTextarea = document.getElementById('omni-prompt');
        const galleryIcon = document.getElementById('omni-gallery-icon');
        const galleryText = document.getElementById('omni-gallery-text');
        const galleryHint = document.getElementById('omni-gallery-hint');
        const negativePrompt = document.getElementById('omni-negative-prompt');

        // Mode-specific configurations
        const modeConfig = {
            'image': {
                icon: '🎨',
                title: 'Image Generation',
                buttonText: 'Generate Image',
                placeholder: 'Describe the image you want to generate...',
                galleryIcon: '🎨',
                galleryText: 'Generated images will appear here',
                galleryHint: 'Start the server and enter a prompt to generate',
                showImageUpload: true,
                showVideoParams: false,
                showNegativePrompt: true
            },
            'video': {
                icon: '🎬',
                title: 'Video Generation',
                buttonText: 'Generate Video',
                placeholder: 'Describe the video you want to generate...',
                galleryIcon: '🎬',
                galleryText: 'Generated videos will appear here',
                galleryHint: 'Start the server and enter a prompt to generate',
                showImageUpload: false,
                showVideoParams: true,
                showNegativePrompt: true
            },
            'audio': {
                icon: '🔊',
                title: 'Audio Generation (TTS)',
                buttonText: 'Generate Audio',
                placeholder: 'Enter the text you want to convert to speech...',
                galleryIcon: '🔊',
                galleryText: 'Generated audio will appear here',
                galleryHint: 'Start the server and enter text to synthesize',
                showImageUpload: false,
                showVideoParams: false,
                showNegativePrompt: false
            }
        };

        const config = modeConfig[modelType] || modeConfig['image'];

        // Apply configuration
        if (studioIcon) studioIcon.textContent = config.icon;
        if (studioTitle) studioTitle.textContent = config.title;
        if (generateBtnText) generateBtnText.textContent = config.buttonText;
        if (promptTextarea) promptTextarea.placeholder = config.placeholder;
        if (galleryIcon) galleryIcon.textContent = config.galleryIcon;
        if (galleryText) galleryText.textContent = config.galleryText;
        if (galleryHint) galleryHint.textContent = config.galleryHint;

        // Show/hide mode-specific sections
        if (imageUpload) imageUpload.style.display = config.showImageUpload ? 'block' : 'none';
        if (videoParams) videoParams.style.display = config.showVideoParams ? 'flex' : 'none';
        if (negativePrompt) negativePrompt.style.display = config.showNegativePrompt ? 'block' : 'none';
    },

    async loadModelList() {
        try {
            const response = await fetch('/api/omni/models');
            if (response.ok) {
                this.modelList = await response.json();
                this.updateModelOptions(this.currentModelType);
            }
        } catch (error) {
            console.error('Failed to load model list:', error);
        }
    },

    updateModelOptions(modelType) {
        const select = document.getElementById('omni-model-select');
        if (!select || !this.modelList) return;

        const models = this.modelList[modelType] || [];
        select.innerHTML = models.map(m =>
            `<option value="${m.id}" title="${m.description || ''}">${m.name} (${m.vram})</option>`
        ).join('');

        // Update the model ID display with the first model
        if (models.length > 0) {
            this.updateModelIdDisplay(models[0].id);
        }
    },

    updateModelIdDisplay(modelId) {
        const modelIdValue = document.getElementById('omni-model-id-value');
        if (modelIdValue) {
            modelIdValue.textContent = modelId;
        }
    },

    toggleModelSource() {
        const isHub = document.getElementById('omni-model-source-hub')?.checked;
        const isModelscope = document.getElementById('omni-model-source-modelscope')?.checked;

        // Get label elements
        const hubLabel = document.getElementById('omni-model-source-hub-label');
        const modelscopeLabel = document.getElementById('omni-model-source-modelscope-label');

        // Reset all button active states
        hubLabel?.classList.remove('active');
        modelscopeLabel?.classList.remove('active');

        if (isHub) {
            hubLabel?.classList.add('active');
        } else if (isModelscope) {
            modelscopeLabel?.classList.add('active');
        }

        // Store current model source
        this.currentModelSource = isHub ? 'hub' : 'modelscope';
    },

    onRunModeChange(mode) {
        const venvGroup = document.getElementById('omni-venv-path-group');
        const helpText = document.getElementById('omni-run-mode-help');
        const subprocessLabel = document.getElementById('omni-run-mode-subprocess-label');
        const containerLabel = document.getElementById('omni-run-mode-container-label');

        if (mode === 'subprocess') {
            if (venvGroup) venvGroup.style.display = 'block';
            // Toggle active class on mode buttons
            if (subprocessLabel) subprocessLabel.classList.add('active');
            if (containerLabel) containerLabel.classList.remove('active');

            // Update help text based on availability (like main vLLM Server)
            if (!this.available) {
                if (helpText) helpText.innerHTML = '<span style="color: var(--error-color);">vLLM-Omni not installed. Specify venv path below or use Container mode.</span>';
            } else if (!this.version) {
                if (helpText) helpText.innerHTML = '<span style="color: var(--warning-color);">vLLM-Omni installed but version unknown. Specify venv path for better detection.</span>';
            } else {
                if (helpText) helpText.textContent = `Subprocess: Direct execution using vLLM-Omni v${this.version}`;
            }
        } else {
            if (venvGroup) venvGroup.style.display = 'none';
            if (helpText) helpText.textContent = 'Container mode uses official vLLM-Omni Docker image';
            // Toggle active class on mode buttons
            if (subprocessLabel) subprocessLabel.classList.remove('active');
            if (containerLabel) containerLabel.classList.add('active');
        }
    },

    // =========================================================================
    // Server Management
    // =========================================================================

    async checkServerStatus() {
        try {
            const response = await fetch('/api/omni/status');
            if (response.ok) {
                const status = await response.json();
                this.serverRunning = status.running;
                this.serverReady = status.ready;
                this.updateServerStatus(status.running, status.ready);

                // Start health polling if running but not ready
                if (status.running && !status.ready && !this.healthCheckInterval) {
                    this.startHealthCheckPolling();
                }
            }
        } catch (error) {
            console.error('Failed to check omni server status:', error);
        }
    },

    startHealthCheckPolling() {
        // Poll health endpoint every 3 seconds until ready
        if (this.healthCheckInterval) return;

        this.addLog('Waiting for model to load...');

        this.healthCheckInterval = setInterval(async () => {
            try {
                const response = await fetch('/api/omni/health');
                if (response.ok) {
                    const health = await response.json();
                    if (health.ready) {
                        this.serverReady = true;
                        this.updateServerStatus(true, true);
                        this.stopHealthCheckPolling();
                        this.ui.showNotification('vLLM-Omni server is ready!', 'success');
                        this.addLog('Server is ready to accept requests');
                    }
                }
            } catch (error) {
                // Server not ready yet, continue polling
            }
        }, 3000);
    },

    stopHealthCheckPolling() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    },

    async startServer() {
        const config = this.buildConfig();

        // Check run mode requirements (like main vLLM Server)
        if (config.run_mode === 'subprocess' && !this.available) {
            this.ui.showNotification('Cannot use Subprocess mode: vLLM-Omni is not installed. Use Container mode or install vLLM-Omni.', 'error');
            this.addLog('ERROR: Subprocess mode requires vLLM-Omni to be installed.', 'error');
            return;
        }

        // Check ModelScope SDK requirement (passed from main app)
        if (config.use_modelscope && !this.modelscopeInstalled) {
            this.ui.showNotification('Cannot use ModelScope: modelscope SDK is not installed. Run: pip install modelscope>=1.18.1', 'error');
            this.addLog('ERROR: ModelScope requires the modelscope SDK. Run: pip install modelscope>=1.18.1', 'error');
            return;
        }

        // Check container mode availability (passed from main app)
        if (config.run_mode === 'container' && !this.containerModeAvailable) {
            this.ui.showNotification('Cannot use Container mode: No container runtime (podman/docker) found.', 'error');
            this.addLog('ERROR: Container mode requires podman or docker to be installed.', 'error');
            return;
        }

        this.ui.showNotification('Starting vLLM-Omni server...', 'info');
        this.addLog('Starting vLLM-Omni server...');

        // Disable start button
        const startBtn = document.getElementById('omni-start-btn');
        if (startBtn) startBtn.disabled = true;

        try {
            const response = await fetch('/api/omni/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            const result = await response.json();

            if (response.ok) {
                this.serverRunning = true;
                this.serverReady = false;  // Not ready yet, still loading
                this.updateServerStatus(true, false);
                this.ui.showNotification('vLLM-Omni server started - loading model...', 'info');
                this.addLog(`Server started in ${result.mode} mode on port ${result.port}`);
                // Health check polling will be triggered by log messages (watching for "Uvicorn running")
                // For container mode, also start polling after a delay as logs may be delayed
                if (result.mode === 'container') {
                    setTimeout(() => {
                        if (this.serverRunning && !this.serverReady && !this.healthCheckInterval) {
                            this.startHealthCheckPolling();
                        }
                    }, 10000);  // Start polling after 10 seconds if not triggered by logs
                }
            } else {
                this.ui.showNotification(`Failed to start: ${result.detail}`, 'error');
                this.addLog(`ERROR: ${result.detail}`);
                if (startBtn) startBtn.disabled = false;
            }
        } catch (error) {
            this.ui.showNotification(`Error: ${error.message}`, 'error');
            this.addLog(`ERROR: ${error.message}`);
            if (startBtn) startBtn.disabled = false;
        }
    },

    async stopServer() {
        this.ui.showNotification('Stopping vLLM-Omni server...', 'info');
        this.addLog('Stopping vLLM-Omni server...');

        // Stop health check polling
        this.stopHealthCheckPolling();

        try {
            const response = await fetch('/api/omni/stop', { method: 'POST' });

            if (response.ok) {
                this.serverRunning = false;
                this.serverReady = false;
                this.updateServerStatus(false, false);
                this.ui.showNotification('vLLM-Omni server stopped', 'success');
                this.addLog('Server stopped');
            } else {
                const result = await response.json();
                this.ui.showNotification(`Failed to stop: ${result.detail}`, 'error');
            }
        } catch (error) {
            this.ui.showNotification(`Error: ${error.message}`, 'error');
        }
    },

    buildConfig() {
        const runMode = document.querySelector('input[name="omni-run-mode"]:checked')?.value || 'subprocess';
        const useModelscope = document.getElementById('omni-model-source-modelscope')?.checked || false;

        return {
            model: document.getElementById('omni-model-select')?.value || 'Tongyi-MAI/Z-Image-Turbo',
            model_type: document.getElementById('omni-model-type')?.value || 'image',
            port: parseInt(document.getElementById('omni-port')?.value) || 8091,
            run_mode: runMode,
            venv_path: runMode === 'subprocess' ? document.getElementById('omni-venv-path')?.value : null,
            gpu_device: document.getElementById('omni-gpu-device')?.value || null,
            gpu_memory_utilization: parseFloat(document.getElementById('omni-gpu-memory')?.value) || 0.9,
            enable_cpu_offload: document.getElementById('omni-cpu-offload')?.checked || false,
            accelerator: 'nvidia',  // Default to NVIDIA, could add UI selector if needed
            default_height: parseInt(document.getElementById('omni-height')?.value) || 1024,
            default_width: parseInt(document.getElementById('omni-width')?.value) || 1024,
            num_inference_steps: parseInt(document.getElementById('omni-steps')?.value) || 6,
            guidance_scale: parseFloat(document.getElementById('omni-guidance')?.value) || 1.0,
            // Model source - if true, download from ModelScope instead of HuggingFace
            use_modelscope: useModelscope,
        };
    },

    // =========================================================================
    // Command Preview
    // =========================================================================

    updateCommandPreview() {
        const commandText = document.getElementById('omni-command-text');
        if (!commandText) return;

        const config = this.buildConfig();
        const runMode = document.querySelector('input[name="omni-run-mode"]:checked')?.value || 'subprocess';

        let command = '';

        if (runMode === 'container') {
            // Container mode - podman/docker command
            // Note: Actual runtime (podman/docker) is auto-detected at startup
            const runtime = 'podman';  // or 'docker'
            const image = 'vllm/vllm-omni:v0.14.0rc1';

            // GPU device selection
            const gpuFlag = config.gpu_device
                ? `--device nvidia.com/gpu=${config.gpu_device}`
                : '--device nvidia.com/gpu=all';

            // Note: Docker uses --gpus all, Podman uses --device nvidia.com/gpu=all
            command = `# Container mode\n`;
            command += `# For Docker: --gpus all (or --gpus '"device=0"' for specific GPU)\n`;
            command += `# For Podman: --device nvidia.com/gpu=all (or =0 for specific GPU)\n`;
            command += `${runtime} run ${gpuFlag} \\
  --ipc=host \\
  -v ~/.cache/huggingface:/root/.cache/huggingface \\
  -p ${config.port}:${config.port}`;

            if (config.hf_token) {
                command += ` \\\n  -e HF_TOKEN=$HF_TOKEN`;
            }
            if (config.use_modelscope) {
                command += ` \\\n  -e VLLM_USE_MODELSCOPE=True`;
            }

            command += ` \\\n  ${image}`;
            command += ` \\\n  vllm serve ${config.model} --omni`;
            command += ` \\\n  --port ${config.port}`;
            command += ` \\\n  --enforce-eager`;  // Disable torch.compile for faster startup
        } else {
            // Subprocess mode - vllm-omni CLI command
            command = `# Subprocess mode\n`;

            // Environment variables
            if (config.gpu_device) {
                command += `export CUDA_VISIBLE_DEVICES=${config.gpu_device}\n`;
            }
            if (config.use_modelscope) {
                command += `export VLLM_USE_MODELSCOPE=True\n`;
            }

            // Activate venv if specified
            if (config.venv_path) {
                command += `source ${config.venv_path}/bin/activate\n`;
            }

            command += `\nvllm-omni serve ${config.model}`;
            command += ` \\\n  --port ${config.port}`;
            command += ` \\\n  --enforce-eager`;  // Disable torch.compile for faster startup
        }

        commandText.value = command;
    },

    copyCommand() {
        const commandText = document.getElementById('omni-command-text');
        const copyBtn = document.getElementById('omni-copy-command-btn');

        if (!commandText) return;

        navigator.clipboard.writeText(commandText.value).then(() => {
            // Visual feedback
            if (copyBtn) {
                const originalText = copyBtn.textContent;
                copyBtn.textContent = 'Copied!';
                copyBtn.classList.add('copied');
                setTimeout(() => {
                    copyBtn.textContent = originalText;
                    copyBtn.classList.remove('copied');
                }, 2000);
            }
            this.ui.showNotification('Command copied to clipboard', 'success');
        }).catch(err => {
            console.error('Failed to copy:', err);
            // Fallback
            commandText.select();
            document.execCommand('copy');
            this.ui.showNotification('Command copied to clipboard', 'success');
        });
    },

    updateServerStatus(running, ready = false) {
        const statusEl = document.getElementById('omni-server-status');
        const dot = statusEl?.querySelector('.status-dot');
        const text = statusEl?.querySelector('.status-text');
        const startBtn = document.getElementById('omni-start-btn');
        const stopBtn = document.getElementById('omni-stop-btn');
        const generateBtn = document.getElementById('omni-generate-btn');
        const chatSendBtn = document.getElementById('omni-chat-send-btn');

        if (running && ready) {
            // Server is running AND ready to accept requests
            dot?.classList.add('online');
            dot?.classList.remove('starting');
            if (text) text.textContent = 'Ready';
            if (startBtn) startBtn.disabled = true;
            if (stopBtn) stopBtn.disabled = false;
            if (generateBtn) {
                generateBtn.disabled = false;
                generateBtn.classList.add('btn-ready');
            }
            if (chatSendBtn) chatSendBtn.disabled = false;
        } else if (running && !ready) {
            // Server is running but still loading model
            dot?.classList.remove('online');
            dot?.classList.add('starting');
            if (text) text.textContent = 'Starting...';
            if (startBtn) startBtn.disabled = true;
            if (stopBtn) stopBtn.disabled = false;
            if (generateBtn) {
                generateBtn.disabled = true;
                generateBtn.classList.remove('btn-ready');
            }
            if (chatSendBtn) chatSendBtn.disabled = true;
        } else {
            // Server is not running
            dot?.classList.remove('online');
            dot?.classList.remove('starting');
            if (text) text.textContent = 'Offline';
            if (startBtn) startBtn.disabled = false;
            if (stopBtn) stopBtn.disabled = true;
            if (generateBtn) {
                generateBtn.disabled = true;
                generateBtn.classList.remove('btn-ready');
            }
            if (chatSendBtn) chatSendBtn.disabled = true;
        }
    },

    // =========================================================================
    // Image Generation
    // =========================================================================

    async generateImage() {
        // Check if server is ready
        if (!this.serverReady) {
            if (this.serverRunning) {
                this.ui.showNotification('Server is still loading, please wait...', 'warning');
            } else {
                this.ui.showNotification('Please start the server first', 'warning');
            }
            return;
        }

        const prompt = document.getElementById('omni-prompt')?.value?.trim();
        if (!prompt) {
            this.ui.showNotification('Please enter a prompt', 'warning');
            return;
        }

        const request = {
            prompt,
            negative_prompt: document.getElementById('omni-negative-prompt')?.value || null,
            width: parseInt(document.getElementById('omni-width')?.value) || 1024,
            height: parseInt(document.getElementById('omni-height')?.value) || 1024,
            num_inference_steps: parseInt(document.getElementById('omni-steps')?.value) || 6,
            guidance_scale: parseFloat(document.getElementById('omni-guidance')?.value) || 1.0,
            seed: document.getElementById('omni-seed')?.value ? parseInt(document.getElementById('omni-seed').value) : null,
        };

        this.ui.showNotification('Generating image...', 'info');
        this.addLog(`Generating image: "${prompt.substring(0, 50)}..."`);

        const generateBtn = document.getElementById('omni-generate-btn');
        const generateBtnText = document.getElementById('omni-generate-btn-text');
        if (generateBtn) generateBtn.disabled = true;
        if (generateBtnText) generateBtnText.textContent = 'Generating...';

        try {
            const response = await fetch('/api/omni/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request)
            });

            const result = await response.json();

            if (result.success) {
                this.addImageToGallery(result.image_base64, prompt);
                this.ui.showNotification(`Image generated in ${result.generation_time?.toFixed(1)}s`, 'success');
                this.addLog(`Image generated in ${result.generation_time?.toFixed(1)}s`);
            } else {
                this.ui.showNotification(`Generation failed: ${result.error}`, 'error');
                this.addLog(`ERROR: ${result.error}`);
            }
        } catch (error) {
            this.ui.showNotification(`Error: ${error.message}`, 'error');
            this.addLog(`ERROR: ${error.message}`);
        } finally {
            if (generateBtn) generateBtn.disabled = false;
            if (generateBtnText) generateBtnText.textContent = 'Generate Image';
        }
    },

    async generateVideo() {
        // Check if server is ready
        if (!this.serverReady) {
            if (this.serverRunning) {
                this.ui.showNotification('Server is still loading, please wait...', 'warning');
            } else {
                this.ui.showNotification('Please start the server first', 'warning');
            }
            return;
        }

        const prompt = document.getElementById('omni-prompt')?.value?.trim();
        if (!prompt) {
            this.ui.showNotification('Please enter a prompt', 'warning');
            return;
        }

        const request = {
            prompt,
            negative_prompt: document.getElementById('omni-negative-prompt')?.value || null,
            duration: parseInt(document.getElementById('omni-video-duration')?.value) || 4,
            fps: parseInt(document.getElementById('omni-video-fps')?.value) || 24,
            num_inference_steps: parseInt(document.getElementById('omni-steps')?.value) || 6,
            guidance_scale: parseFloat(document.getElementById('omni-guidance')?.value) || 1.0,
            seed: document.getElementById('omni-seed')?.value ? parseInt(document.getElementById('omni-seed').value) : null,
        };

        this.ui.showNotification('Generating video... This may take a while.', 'info');
        this.addLog(`Generating video: "${prompt.substring(0, 50)}..." (${request.duration}s @ ${request.fps}fps)`);

        const generateBtn = document.getElementById('omni-generate-btn');
        const generateBtnText = document.getElementById('omni-generate-btn-text');
        if (generateBtn) generateBtn.disabled = true;
        if (generateBtnText) generateBtnText.textContent = 'Generating...';

        try {
            const response = await fetch('/api/omni/generate-video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request)
            });

            const result = await response.json();

            if (result.success) {
                this.addVideoToGallery(result.video_base64, prompt, result.duration);
                this.ui.showNotification(`Video generated in ${result.generation_time?.toFixed(1)}s`, 'success');
                this.addLog(`Video generated in ${result.generation_time?.toFixed(1)}s`);
            } else {
                this.ui.showNotification(`Generation failed: ${result.error}`, 'error');
                this.addLog(`ERROR: ${result.error}`);
            }
        } catch (error) {
            this.ui.showNotification(`Error: ${error.message}`, 'error');
            this.addLog(`ERROR: ${error.message}`);
        } finally {
            if (generateBtn) generateBtn.disabled = false;
            if (generateBtnText) generateBtnText.textContent = 'Generate Video';
        }
    },

    async generateAudio() {
        // Check if server is ready
        if (!this.serverReady) {
            if (this.serverRunning) {
                this.ui.showNotification('Server is still loading, please wait...', 'warning');
            } else {
                this.ui.showNotification('Please start the server first', 'warning');
            }
            return;
        }

        const prompt = document.getElementById('omni-prompt')?.value?.trim();
        if (!prompt) {
            this.ui.showNotification('Please enter text to synthesize', 'warning');
            return;
        }

        const request = {
            text: prompt,
            seed: document.getElementById('omni-seed')?.value ? parseInt(document.getElementById('omni-seed').value) : null,
        };

        this.ui.showNotification('Generating audio...', 'info');
        this.addLog(`Generating audio: "${prompt.substring(0, 50)}..."`);

        const generateBtn = document.getElementById('omni-generate-btn');
        const generateBtnText = document.getElementById('omni-generate-btn-text');
        if (generateBtn) generateBtn.disabled = true;
        if (generateBtnText) generateBtnText.textContent = 'Generating...';

        try {
            const response = await fetch('/api/omni/generate-audio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request)
            });

            const result = await response.json();

            if (result.success) {
                this.addAudioToGallery(result.audio_base64, prompt, result.duration);
                this.ui.showNotification(`Audio generated in ${result.generation_time?.toFixed(1)}s`, 'success');
                this.addLog(`Audio generated in ${result.generation_time?.toFixed(1)}s`);
            } else {
                this.ui.showNotification(`Generation failed: ${result.error}`, 'error');
                this.addLog(`ERROR: ${result.error}`);
            }
        } catch (error) {
            this.ui.showNotification(`Error: ${error.message}`, 'error');
            this.addLog(`ERROR: ${error.message}`);
        } finally {
            if (generateBtn) generateBtn.disabled = false;
            if (generateBtnText) generateBtnText.textContent = 'Generate Audio';
        }
    },

    addImageToGallery(base64Image, prompt) {
        const gallery = document.getElementById('omni-gallery');
        if (!gallery) return;

        // Remove placeholder
        const placeholder = gallery.querySelector('.gallery-placeholder');
        if (placeholder) placeholder.remove();

        // Create gallery item
        const item = document.createElement('div');
        item.className = 'gallery-item';
        item.innerHTML = `
            <img src="data:image/png;base64,${base64Image}" alt="${this.escapeHtml(prompt)}">
            <div class="gallery-item-overlay">
                <span class="gallery-item-prompt">${this.escapeHtml(prompt.substring(0, 50))}...</span>
            </div>
            <div class="gallery-item-actions">
                <button class="btn btn-sm" title="Download">&#8595;</button>
            </div>
        `;

        // Store base64 for download
        item.dataset.base64 = base64Image;
        item.dataset.prompt = prompt;

        // Download click handler
        item.querySelector('.gallery-item-actions button')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.downloadImage(item);
        });

        // Prepend to gallery
        gallery.prepend(item);
    },

    addVideoToGallery(base64Video, prompt, duration) {
        const gallery = document.getElementById('omni-gallery');
        if (!gallery) return;

        // Remove placeholder
        const placeholder = gallery.querySelector('.gallery-placeholder');
        if (placeholder) placeholder.remove();

        // Create gallery item for video
        const item = document.createElement('div');
        item.className = 'gallery-item gallery-item-video';
        item.innerHTML = `
            <video controls loop muted playsinline>
                <source src="data:video/mp4;base64,${base64Video}" type="video/mp4">
                Your browser does not support video playback.
            </video>
            <div class="gallery-item-overlay">
                <span class="gallery-item-prompt">${this.escapeHtml(prompt.substring(0, 50))}...</span>
                <span class="gallery-item-duration">${duration}s</span>
            </div>
            <div class="gallery-item-actions">
                <button class="btn btn-sm gallery-play-btn" title="Play/Pause">&#9658;</button>
                <button class="btn btn-sm gallery-download-btn" title="Download">&#8595;</button>
            </div>
        `;

        // Store data for download
        item.dataset.base64 = base64Video;
        item.dataset.prompt = prompt;
        item.dataset.type = 'video';

        const video = item.querySelector('video');
        const playBtn = item.querySelector('.gallery-play-btn');

        // Play/Pause click handler
        playBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (video.paused) {
                video.play();
                playBtn.innerHTML = '&#10074;&#10074;'; // Pause icon
            } else {
                video.pause();
                playBtn.innerHTML = '&#9658;'; // Play icon
            }
        });

        // Update play button when video ends
        video?.addEventListener('ended', () => {
            playBtn.innerHTML = '&#9658;';
        });

        // Download click handler
        item.querySelector('.gallery-download-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.downloadVideo(item);
        });

        // Prepend to gallery
        gallery.prepend(item);
    },

    downloadVideo(item) {
        const base64 = item.dataset.base64;
        const prompt = item.dataset.prompt || 'video';

        const link = document.createElement('a');
        link.href = `data:video/mp4;base64,${base64}`;
        link.download = `omni-video-${prompt.substring(0, 20).replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.mp4`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    addAudioToGallery(base64Audio, text, duration) {
        const gallery = document.getElementById('omni-gallery');
        if (!gallery) return;

        // Remove placeholder
        const placeholder = gallery.querySelector('.gallery-placeholder');
        if (placeholder) placeholder.remove();

        // Create gallery item for audio
        const item = document.createElement('div');
        item.className = 'gallery-item gallery-item-audio';
        item.innerHTML = `
            <div class="audio-card">
                <div class="audio-icon">🔊</div>
                <div class="audio-text">${this.escapeHtml(text.substring(0, 80))}${text.length > 80 ? '...' : ''}</div>
                <audio controls>
                    <source src="data:audio/wav;base64,${base64Audio}" type="audio/wav">
                    Your browser does not support audio playback.
                </audio>
                ${duration ? `<span class="audio-duration">${duration.toFixed(1)}s</span>` : ''}
            </div>
            <div class="gallery-item-actions">
                <button class="btn btn-sm gallery-download-btn" title="Download">&#8595;</button>
            </div>
        `;

        // Store data for download
        item.dataset.base64 = base64Audio;
        item.dataset.prompt = text;
        item.dataset.type = 'audio';

        // Download click handler
        item.querySelector('.gallery-download-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.downloadAudio(item);
        });

        // Prepend to gallery
        gallery.prepend(item);
    },

    downloadAudio(item) {
        const base64 = item.dataset.base64;
        const prompt = item.dataset.prompt || 'audio';

        const link = document.createElement('a');
        link.href = `data:audio/wav;base64,${base64}`;
        link.download = `omni-audio-${prompt.substring(0, 20).replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.wav`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    downloadImage(item) {
        const base64 = item.dataset.base64;
        const prompt = item.dataset.prompt || 'generated';

        const link = document.createElement('a');
        link.href = `data:image/png;base64,${base64}`;
        link.download = `vllm-omni-${Date.now()}.png`;
        link.click();

        this.ui.showNotification('Image downloaded', 'success');
    },

    // =========================================================================
    // Chat (for Omni models)
    // =========================================================================

    async sendOmniChatMessage() {
        const input = document.getElementById('omni-chat-input');
        const sendBtn = document.getElementById('omni-chat-send-btn');
        const message = input?.value?.trim();

        if (!message) return;

        // Check if server is ready
        if (!this.serverReady) {
            if (this.serverRunning) {
                this.ui.showNotification('Server is still loading, please wait...', 'warning');
            } else {
                this.ui.showNotification('Please start the vLLM-Omni server first', 'warning');
            }
            return;
        }

        // Add user message to UI
        this.addOmniChatMessage('user', message);

        // Clear input and disable send button
        if (input) input.value = '';
        if (sendBtn) {
            sendBtn.disabled = true;
            sendBtn.textContent = 'Generating...';
        }

        // Add to history
        this.chatHistory.push({ role: 'user', content: message });

        // Create placeholder for assistant response
        const assistantMessageDiv = this.addOmniChatMessage('assistant', '▌');
        const textSpan = assistantMessageDiv?.querySelector('.message-text');
        let fullText = '';
        let audioData = null;

        try {
            const response = await fetch('/api/omni/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: this.chatHistory,
                    temperature: 0.7,
                    max_tokens: 512,
                    stream: true
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Chat request failed');
            }

            // Handle streaming response
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;

                        try {
                            const parsed = JSON.parse(data);

                            // Handle text content
                            if (parsed.text) {
                                fullText += parsed.text;
                                if (textSpan) {
                                    textSpan.textContent = fullText + '▌';
                                }
                            }

                            // Handle audio content (usually at the end)
                            if (parsed.audio) {
                                audioData = parsed.audio;
                            }

                            // Handle error
                            if (parsed.error) {
                                throw new Error(parsed.error);
                            }
                        } catch (e) {
                            if (e.message !== 'Unexpected end of JSON input') {
                                console.warn('Parse error:', e);
                            }
                        }
                    }
                }
            }

            // Update final message
            if (textSpan) {
                textSpan.textContent = fullText || 'No response received';
            }

            // Add audio player if audio was returned
            if (audioData && assistantMessageDiv) {
                const audioContainer = document.createElement('div');
                audioContainer.className = 'chat-audio-response';
                audioContainer.innerHTML = `<audio controls src="data:audio/wav;base64,${audioData}" class="chat-inline-audio"></audio>`;
                assistantMessageDiv.querySelector('.message-body')?.appendChild(audioContainer);
            }

            // Add to chat history
            this.chatHistory.push({ role: 'assistant', content: fullText });

        } catch (error) {
            console.error('Omni chat error:', error);
            if (textSpan) {
                textSpan.textContent = `Error: ${error.message}`;
            }
            this.ui.showNotification(`Chat error: ${error.message}`, 'error');
        } finally {
            // Re-enable send button
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.textContent = 'Send';
            }
        }
    },

    addOmniChatMessage(role, content, media = null) {
        const container = document.getElementById('omni-chat-container');
        if (!container) return null;

        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${role}`;

        let html = '<div class="message-content">';

        // Avatar
        if (role !== 'system') {
            html += `<div class="message-avatar">${role === 'user' ? 'U' : 'AI'}</div>`;
        }

        // Content wrapper
        html += '<div class="message-body">';

        // Text content
        if (content) {
            html += `<span class="message-text">${this.escapeHtml(content)}</span>`;
        }

        // Media content (image, audio)
        if (media) {
            if (media.type === 'image') {
                html += `<img src="data:image/png;base64,${media.data}" class="chat-inline-image" alt="Generated image">`;
            } else if (media.type === 'audio') {
                html += `<audio controls src="data:audio/wav;base64,${media.data}" class="chat-inline-audio"></audio>`;
            }
        }

        html += '</div></div>';

        messageDiv.innerHTML = html;
        container.appendChild(messageDiv);

        // Auto-scroll
        container.scrollTop = container.scrollHeight;

        // Return the message div for streaming updates
        return messageDiv;
    },

    clearChat() {
        const container = document.getElementById('omni-chat-container');
        if (container) {
            // Keep only the system welcome message
            container.innerHTML = `
                <div class="chat-message system">
                    <div class="message-content">
                        <span class="message-text">Chat with Qwen-Omni. Supports text, images, and audio input/output.</span>
                    </div>
                </div>
            `;
        }
        // Clear chat history
        this.chatHistory = [];
        this.ui.showNotification('Chat cleared', 'info');
    },

    exportChat() {
        if (this.chatHistory.length === 0) {
            this.ui.showNotification('No chat history to export', 'warning');
            return;
        }

        // Format chat history for export
        const exportData = {
            timestamp: new Date().toISOString(),
            model: 'vLLM-Omni',
            messages: this.chatHistory
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = `omni-chat-${Date.now()}.json`;
        link.click();

        URL.revokeObjectURL(url);
        this.ui.showNotification('Chat exported', 'success');
    },

    // =========================================================================
    // Logging
    // =========================================================================

    addLog(message) {
        const container = document.getElementById('omni-logs-container');
        if (!container) return;

        // Check for startup completion messages to trigger health check polling
        // vLLM-Omni shows "Uvicorn running" or "Application startup complete" when server is starting
        if (message && this.serverRunning && !this.serverReady && !this.healthCheckInterval) {
            if (message.includes('Uvicorn running') ||
                message.includes('Application startup complete') ||
                message.includes('Started server process')) {
                console.log('🔄 vLLM-Omni server starting, beginning health check polling...');
                this.startHealthCheckPolling();
            }
        }

        // Auto-detect log type for styling
        let logType = 'info';
        if (message) {
            const lowerMsg = message.toLowerCase();
            if (lowerMsg.includes('error') || lowerMsg.includes('failed') || lowerMsg.includes('exception')) {
                logType = 'error';
            } else if (lowerMsg.includes('warning') || lowerMsg.includes('warn')) {
                logType = 'warning';
            } else if (lowerMsg.includes('success') || lowerMsg.includes('ready') || lowerMsg.includes('complete')) {
                logType = 'success';
            }
        }

        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${logType}`;

        const timestamp = new Date().toLocaleTimeString();
        logEntry.innerHTML = `<span class="log-timestamp">[${timestamp}]</span> ${this.escapeHtml(message)}`;

        container.appendChild(logEntry);

        // Auto-scroll if enabled
        const autoScroll = document.getElementById('omni-auto-scroll');
        if (autoScroll?.checked) {
            container.scrollTop = container.scrollHeight;
        }

        // Limit log entries to prevent memory issues
        const maxLogs = 500;
        const logs = container.querySelectorAll('.log-entry');
        if (logs.length > maxLogs) {
            logs[0].remove();
        }
    },

    clearLogs() {
        const container = document.getElementById('omni-logs-container');
        if (container) {
            container.innerHTML = '<div class="log-entry info">Logs cleared.</div>';
        }
        this.ui.showNotification('Logs cleared', 'info');
    },

    saveLogs() {
        const container = document.getElementById('omni-logs-container');
        if (!container) return;

        // Get all log entries as text
        const logEntries = container.querySelectorAll('.log-entry');
        if (logEntries.length === 0) {
            this.ui.showNotification('No logs to save', 'warning');
            return;
        }

        // Build log text
        const logLines = [];
        logEntries.forEach(entry => {
            logLines.push(entry.textContent);
        });

        const logText = logLines.join('\n');

        // Create and download file
        const blob = new Blob([logText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `vllm-omni-logs-${Date.now()}.txt`;
        link.click();

        URL.revokeObjectURL(url);
        this.ui.showNotification('Logs saved successfully', 'success');
    },

    toggleLogsRow() {
        const logsRow = document.getElementById('omni-logs-row');
        if (!logsRow) return;
        logsRow.classList.toggle('collapsed');
    },

    // =========================================================================
    // Resize Functionality
    // =========================================================================

    initResize() {
        const resizeHandle = document.getElementById('omni-config-resize-handle');
        if (!resizeHandle) return;

        resizeHandle.addEventListener('mousedown', (e) => this.startResize(e));
        document.addEventListener('mousemove', (e) => this.doResize(e));
        document.addEventListener('mouseup', () => this.stopResize());
    },

    startResize(e) {
        e.preventDefault();
        this.isResizing = true;
        this.resizeStartX = e.clientX;

        const configPanel = document.getElementById('omni-config-panel');
        this.resizeStartWidth = configPanel.offsetWidth;

        // Add visual feedback
        document.body.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    },

    doResize(e) {
        if (!this.isResizing) return;

        e.preventDefault();

        const deltaX = e.clientX - this.resizeStartX;
        let newWidth = this.resizeStartWidth + deltaX;

        // Clamp width between min and max
        const minWidth = 280;
        const maxWidth = 600;
        newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

        const configPanel = document.getElementById('omni-config-panel');
        if (configPanel) {
            configPanel.style.width = `${newWidth}px`;
            configPanel.style.flexShrink = '0';
        }
    },

    stopResize() {
        if (!this.isResizing) return;

        this.isResizing = false;
        document.body.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    },

    // =========================================================================
    // Utility Methods
    // =========================================================================

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};
