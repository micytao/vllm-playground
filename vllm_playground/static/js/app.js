// vLLM Playground - Main JavaScript
import { initMCPModule } from './modules/mcp.js';
import { initGuideLLMModule } from './modules/guidellm.js';
import { initClaudeCodeModule } from './modules/claudecode.js';

class VLLMWebUI {
    constructor() {
        this.ws = null;
        this.chatHistory = [];
        this.serverRunning = false;
        this.serverReady = false;  // Track if server startup is complete
        this.healthCheckStarted = false;  // Track if health check polling is active
        this.autoScroll = true;
        this.benchmarkRunning = false;
        this.benchmarkPollInterval = null;

        // Current vLLM config
        this.currentConfig = null;

        // Resize state
        this.isResizing = false;
        this.currentResizer = null;
        this.resizeDirection = null;

        // Template edit timeouts
        this.stopTokensEditTimeout = null;
        this.chatTemplateEditTimeout = null;

        // Tool calling state
        this.tools = [];  // Array of tool definitions
        this.editingToolIndex = -1;  // Index of tool being edited, -1 for new tool

        // Theme state
        this.currentTheme = localStorage.getItem('vllm-theme') || 'dark';

        // GuideLLM state
        this.guidellmAvailable = false;

        // ModelScope state
        this.modelscopeInstalled = false;
        this.modelscopeVersion = null;

        // vLLM state (for subprocess mode)
        this.vllmInstalled = false;
        this.vllmVersion = null;
        this.containerModeAvailable = false;

        // MCP (Model Context Protocol) state
        this.mcpAvailable = false;
        this.mcpConfigs = [];           // All configured MCP servers
        this.mcpSelectedServers = [];   // Servers selected for chat
        this.mcpEnabled = false;        // Whether MCP is enabled in chat
        this.mcpTools = [];             // Tools from selected servers
        this.mcpPresets = [];           // Built-in presets
        this.mcpDisabledTools = new Set(); // Disabled tools (server:toolName format) - all enabled by default

        this.init();
    }

    init() {
        // Get DOM elements
        this.elements = {
            // Configuration
            modelSelect: document.getElementById('model-select'),
            customModel: document.getElementById('custom-model'),
            hfToken: document.getElementById('hf-token'),
            host: document.getElementById('host'),
            port: document.getElementById('port'),

            // Model Source Toggle
            modelSourceHub: document.getElementById('model-source-hub'),
            modelSourceModelscope: document.getElementById('model-source-modelscope'),
            modelSourceLocal: document.getElementById('model-source-local'),
            modelSourceHubLabel: document.getElementById('model-source-hub-label'),
            modelSourceModelscopeLabel: document.getElementById('model-source-modelscope-label'),
            modelSourceLocalLabel: document.getElementById('model-source-local-label'),
            hubModelSection: document.getElementById('hub-model-section'),
            modelscopeModelSection: document.getElementById('modelscope-model-section'),
            localModelSection: document.getElementById('local-model-section'),
            modelscopeModelSelect: document.getElementById('modelscope-model-select'),
            customModelscopeModel: document.getElementById('custom-modelscope-model'),
            modelscopeToken: document.getElementById('modelscope-token'),
            modelscopeInstallHint: document.getElementById('modelscope-install-hint'),
            hfTokenSection: document.getElementById('hf-token-section'),
            modelscopeTokenSection: document.getElementById('modelscope-token-section'),
            localModelPath: document.getElementById('local-model-path'),
            browseFolderBtn: document.getElementById('browse-folder-btn'),
            validatePathBtn: document.getElementById('validate-path-btn'),
            browseRecipesBtn: document.getElementById('browse-recipes-btn'),
            recipesModal: document.getElementById('recipes-modal'),
            recipesModalOverlay: document.getElementById('recipes-modal-overlay'),
            recipesModalClose: document.getElementById('recipes-modal-close'),
            recipesSearchInput: document.getElementById('recipes-search-input'),
            recipesFilterTags: document.getElementById('recipes-filter-tags'),
            recipesCategories: document.getElementById('recipes-categories'),
            syncRecipesBtn: document.getElementById('sync-recipes-btn'),
            githubTokenInput: document.getElementById('github-token-input'),
            localModelValidation: document.getElementById('local-model-validation'),
            validationIcon: document.getElementById('validation-icon'),
            validationMessage: document.getElementById('validation-message'),
            localModelInfo: document.getElementById('local-model-info'),

            // CPU/GPU/Metal Mode
            modeCpu: document.getElementById('mode-cpu'),
            modeGpu: document.getElementById('mode-gpu'),
            modeMetal: document.getElementById('mode-metal'),
            modeCpuLabel: document.getElementById('mode-cpu-label'),
            modeGpuLabel: document.getElementById('mode-gpu-label'),
            modeMetalLabel: document.getElementById('mode-metal-label'),
            modeHelpText: document.getElementById('mode-help-text'),
            cpuSettings: document.getElementById('cpu-settings'),

            // Run mode elements
            runModeSubprocess: document.getElementById('run-mode-subprocess'),
            runModeContainer: document.getElementById('run-mode-container'),
            runModeSubprocessLabel: document.getElementById('run-mode-subprocess-label'),
            runModeContainerLabel: document.getElementById('run-mode-container-label'),
            runModeHelpText: document.getElementById('run-mode-help-text'),
            gpuSettings: document.getElementById('gpu-settings'),

            // Venv path (for custom vLLM installations)
            venvPathGroup: document.getElementById('venv-path-group'),
            venvPathInput: document.getElementById('venv-path'),

            // GPU settings
            tensorParallel: document.getElementById('tensor-parallel'),
            gpuMemory: document.getElementById('gpu-memory'),
            gpuDevice: document.getElementById('gpu-device'),
            acceleratorSelect: document.getElementById('accelerator-select'),
            acceleratorRow: document.getElementById('accelerator-row'),

            // CPU settings
            cpuKvcache: document.getElementById('cpu-kvcache'),
            cpuThreads: document.getElementById('cpu-threads'),

            dtype: document.getElementById('dtype'),
            dtypeHelpText: document.getElementById('dtype-help-text'),
            maxModelLen: document.getElementById('max-model-len'),
            trustRemoteCode: document.getElementById('trust-remote-code'),
            enablePrefixCaching: document.getElementById('enable-prefix-caching'),
            enableToolCalling: document.getElementById('enable-tool-calling'),
            toolCallParser: document.getElementById('tool-call-parser'),
            toolParserGroup: document.getElementById('tool-parser-group'),
            servedModelName: document.getElementById('served-model-name'),

            // Template Settings
            templateSettingsToggle: document.getElementById('template-settings-toggle'),
            templateSettingsContent: document.getElementById('template-settings-content'),
            chatTemplate: document.getElementById('chat-template'),
            stopTokens: document.getElementById('stop-tokens'),

            // Command Preview
            commandText: document.getElementById('command-text'),
            copyCommandBtn: document.getElementById('copy-command-btn'),

            // Buttons
            startBtn: document.getElementById('start-btn'),
            stopBtn: document.getElementById('stop-btn'),
            sendBtn: document.getElementById('send-btn'),
            clearChatBtn: document.getElementById('clear-chat-btn'),
            exportChatBtn: document.getElementById('export-chat-btn'),
            clearLogsBtn: document.getElementById('clear-logs-btn'),
            saveLogsBtn: document.getElementById('save-logs-btn'),
            logsRowToggle: document.getElementById('logs-row-toggle'),
            logsRow: document.getElementById('logs-row'),
            logsRowContent: document.getElementById('logs-row-content'),

            // Chat
            chatContainer: document.getElementById('chat-container'),
            chatInput: document.getElementById('chat-input'),
            messageTemplates: document.getElementById('message-templates'),
            systemPrompt: document.getElementById('system-prompt'),
            clearSystemPromptBtn: document.getElementById('clear-system-prompt-btn'),
            temperature: document.getElementById('temperature'),
            maxTokens: document.getElementById('max-tokens'),
            tempValue: document.getElementById('temp-value'),
            tokensValue: document.getElementById('tokens-value'),

            // Logs
            logsContainer: document.getElementById('logs-container'),
            autoScrollCheckbox: document.getElementById('auto-scroll'),

            // Status
            statusDot: document.getElementById('status-dot'),
            statusText: document.getElementById('status-text'),
            uptime: document.getElementById('uptime'),

            // Benchmark
            runBenchmarkBtn: document.getElementById('run-benchmark-btn'),
            stopBenchmarkBtn: document.getElementById('stop-benchmark-btn'),
            benchmarkRequests: document.getElementById('benchmark-requests'),
            benchmarkRate: document.getElementById('benchmark-rate'),
            benchmarkPromptTokens: document.getElementById('benchmark-prompt-tokens'),
            benchmarkOutputTokens: document.getElementById('benchmark-output-tokens'),
            benchmarkMethodBuiltin: document.getElementById('benchmark-method-builtin'),
            benchmarkMethodGuidellm: document.getElementById('benchmark-method-guidellm'),
            benchmarkCommandText: document.getElementById('benchmark-command-text'),
            copyBenchmarkCommandBtn: document.getElementById('copy-benchmark-command-btn'),
            guidellmRawOutput: document.getElementById('guidellm-raw-output'),
            copyGuidellmOutputBtn: document.getElementById('copy-guidellm-output-btn'),
            toggleRawOutputBtn: document.getElementById('toggle-raw-output-btn'),
            guidellmRawOutputContent: document.getElementById('guidellm-raw-output-content'),
            guidellmJsonOutput: document.getElementById('guidellm-json-output'),
            copyGuidellmJsonBtn: document.getElementById('copy-guidellm-json-btn'),
            toggleJsonOutputBtn: document.getElementById('toggle-json-output-btn'),
            guidellmJsonOutputContent: document.getElementById('guidellm-json-output-content'),
            metricsSectionContent: document.getElementById('metrics-section-content'),
            metricsDisplay: document.getElementById('metrics-display'),
            metricsGrid: document.getElementById('metrics-grid'),
            benchmarkProgress: document.getElementById('benchmark-progress'),
            progressFill: document.getElementById('progress-fill'),
            progressStatus: document.getElementById('progress-status'),
            progressPercent: document.getElementById('progress-percent'),

            // Toolbar Icon Buttons
            toolbarSettings: document.getElementById('toolbar-settings'),
            toolbarPrompt: document.getElementById('toolbar-prompt'),
            toolbarStructured: document.getElementById('toolbar-structured'),
            toolbarTools: document.getElementById('toolbar-tools'),
            toolbarMcp: document.getElementById('toolbar-mcp'),
            toolbarRag: document.getElementById('toolbar-rag'),

            // Inline Panels
            panelSettings: document.getElementById('panel-settings'),
            panelPrompt: document.getElementById('panel-prompt'),
            panelStructured: document.getElementById('panel-structured'),
            panelTools: document.getElementById('panel-tools'),
            panelMcp: document.getElementById('panel-mcp'),
            panelRag: document.getElementById('panel-rag'),

            // Structured Outputs elements
            structuredEnabled: document.getElementById('structured-enabled'),
            structuredOptions: document.getElementById('structured-options'),
            structuredChoices: document.getElementById('structured-choices'),
            structuredRegex: document.getElementById('structured-regex'),
            structuredJsonName: document.getElementById('structured-json-name'),
            structuredJsonSchema: document.getElementById('structured-json-schema'),
            structuredGrammar: document.getElementById('structured-grammar'),

            // Tools count
            toolsCount: document.getElementById('tools-count'),

            // Theme toggle
            themeToggle: document.getElementById('theme-toggle'),
            toolsCountBadge: document.getElementById('tools-count-badge'),
            toolChoice: document.getElementById('tool-choice'),
            parallelToolCalls: document.getElementById('parallel-tool-calls'),
            toolsList: document.getElementById('tools-list'),
            toolServerWarning: document.getElementById('tool-server-warning'),
            toolServerStatus: document.getElementById('tool-server-status'),
            toolParserDisplay: document.getElementById('tool-parser-display'),
            toolChoiceRow: document.querySelector('.tool-choice-row'),
            toolPresetsRow: document.querySelector('.tool-presets-row'),
            toolsListContainer: document.querySelector('.tools-list-container'),
            addToolBtn: document.getElementById('add-tool-btn'),
            clearToolsBtn: document.getElementById('clear-tools-btn'),
            toolEditorModal: document.getElementById('tool-editor-modal'),
            toolEditorTitle: document.getElementById('tool-editor-title'),
            toolEditorClose: document.getElementById('tool-editor-close'),
            toolName: document.getElementById('tool-name'),
            toolDescription: document.getElementById('tool-description'),
            toolEditorCancel: document.getElementById('tool-editor-cancel'),
            toolEditorSave: document.getElementById('tool-editor-save'),
            // Form-based parameter editor
            addParamBtn: document.getElementById('add-param-btn'),
            paramsList: document.getElementById('params-list'),
            paramCount: document.getElementById('param-count'),
            paramTemplate: document.getElementById('param-template')
        };

        // Attach event listeners
        this.attachListeners();

        // Initialize view switching
        this.initViewSwitching();

        // Initialize i18n (language system) - must be before theme to ensure translations are available
        this.initI18n();

        // Initialize theme
        this.initTheme();

        // Initialize resize functionality
        this.initResize();

        // Initialize compute mode (CPU is default)
        this.toggleComputeMode();

        // Initialize run mode (Subprocess is default)
        this.toggleRunMode();

        // Initialize model source (HF Hub is default)
        this.toggleModelSource();

        // Update command preview initially
        this.updateCommandPreview();

        // Initialize chat template for default model (silent mode - no notification)
        this.updateTemplateForModel(true);

        // NOTE: Benchmark command preview is initialized by GuideLLM module

        // Check feature availability (also initializes GuideLLM and MCP modules)
        this.checkFeatureAvailability();

        // Connect WebSocket for logs
        this.connectWebSocket();

        // Start status polling
        this.pollStatus();
        setInterval(() => this.pollStatus(), 1000);

        // Add GPU status refresh button listener
        document.getElementById('gpu-status-refresh').addEventListener('click', () => {
            this.fetchGpuStatus();
        });

        // Tool Calling event listeners
        this.initToolCalling();
    }

    // ============ View Switching ============
    initViewSwitching() {
        this.currentView = 'vllm-server';
        this.navCollapsed = false;

        // Get nav items
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', () => {
                const viewId = item.dataset.view;
                this.switchView(viewId);
            });
        });

        // Collapse button
        const collapseBtn = document.getElementById('nav-collapse-btn');
        if (collapseBtn) {
            collapseBtn.addEventListener('click', () => this.toggleNavSidebar());
        }

        // Resize handle for sidebar
        const resizeHandle = document.getElementById('nav-resize-handle');
        if (resizeHandle) {
            resizeHandle.addEventListener('mousedown', (e) => this.startNavResize(e));
            document.addEventListener('mousemove', (e) => this.navResize(e));
            document.addEventListener('mouseup', () => this.stopNavResize());
        }
        
    }

    toggleNavSidebar() {
        const sidebar = document.getElementById('nav-sidebar');
        const resizeHandle = document.getElementById('nav-resize-handle');
        const appContainer = document.querySelector('.app-container');

        this.navCollapsed = !this.navCollapsed;

        if (this.navCollapsed) {
            sidebar.classList.add('collapsed');
            sidebar.style.width = '60px';
            if (resizeHandle) resizeHandle.style.left = '60px';
            if (appContainer) appContainer.style.marginLeft = '60px';
        } else {
            sidebar.classList.remove('collapsed');
            sidebar.style.width = '255px';
            if (resizeHandle) resizeHandle.style.left = '255px';
            if (appContainer) appContainer.style.marginLeft = '255px';
        }
    }

    startNavResize(e) {
        e.preventDefault();
        this.isNavResizing = true;
        this.navResizeStartX = e.clientX;

        const sidebar = document.getElementById('nav-sidebar');
        this.navResizeStartWidth = sidebar.offsetWidth;

        const resizeHandle = document.getElementById('nav-resize-handle');
        if (resizeHandle) resizeHandle.classList.add('active');

        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
    }

    navResize(e) {
        if (!this.isNavResizing) return;

        const deltaX = e.clientX - this.navResizeStartX;
        let newWidth = this.navResizeStartWidth + deltaX;

        // Clamp width between 60 and 300
        newWidth = Math.max(60, Math.min(300, newWidth));

        const sidebar = document.getElementById('nav-sidebar');
        const resizeHandle = document.getElementById('nav-resize-handle');
        const appContainer = document.querySelector('.app-container');

        // Auto-collapse if width is small enough
        if (newWidth <= 80) {
            sidebar.classList.add('collapsed');
            this.navCollapsed = true;
        } else {
            sidebar.classList.remove('collapsed');
            this.navCollapsed = false;
        }

        sidebar.style.width = `${newWidth}px`;
        if (resizeHandle) resizeHandle.style.left = `${newWidth}px`;
        if (appContainer) appContainer.style.marginLeft = `${newWidth}px`;
    }

    stopNavResize() {
        if (!this.isNavResizing) return;

        this.isNavResizing = false;

        const resizeHandle = document.getElementById('nav-resize-handle');
        if (resizeHandle) resizeHandle.classList.remove('active');

        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }

    switchView(viewId) {
        // Update nav items
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === viewId);
        });

        // Update view content
        document.querySelectorAll('.view-content').forEach(view => {
            view.classList.remove('active');
            view.style.display = 'none';
        });

        const targetView = document.getElementById(`${viewId}-view`);
        if (targetView) {
            targetView.classList.add('active');
            targetView.style.display = 'block';
        }

        // Update header title
        const viewTitle = document.getElementById('view-title');
        if (viewTitle) {
            switch (viewId) {
                case 'vllm-server':
                    viewTitle.innerHTML = '<img src="/assets/vllm-logo.svg" alt="vLLM" class="view-title-logo"> vLLM Server';
                    break;
                case 'guidellm':
                    viewTitle.innerHTML = '<img src="/assets/guidellm-logo.svg" alt="GuideLLM" class="view-title-logo"> GuideLLM Benchmark';
                    // Update benchmark server status
                    this.updateBenchmarkServerStatus();
                    break;
                case 'mcp-config':
                    viewTitle.innerHTML = '<span class="view-title-icon icon-mcp-header"></span> MCP Servers';
                    // Refresh MCP config view
                    this.refreshMCPConfigView();
                    break;
                case 'claude-code':
                    viewTitle.innerHTML = '<img src="/assets/Claude.png" alt="Claude" class="view-title-logo"> Claude Code';
                    // Activate Claude Code view
                    if (this.onClaudeCodeViewActivated) {
                        this.onClaudeCodeViewActivated();
                    }
                    break;
                default:
                    viewTitle.textContent = viewId;
            }
        }

        // Handle view deactivation for Claude Code
        if (this.currentView === 'claude-code' && viewId !== 'claude-code') {
            if (this.onClaudeCodeViewDeactivated) {
                this.onClaudeCodeViewDeactivated();
            }
        }

        this.currentView = viewId;
    }

    // ============ Theme Toggle ============
    initTheme() {
        // Apply saved theme on load
        this.applyTheme(this.currentTheme);

        // Theme toggle button listener
        if (this.elements.themeToggle) {
            this.elements.themeToggle.addEventListener('click', () => {
                this.toggleTheme();
            });
        }
    }

    applyTheme(theme) {
        const icon = this.elements.themeToggle?.querySelector('.theme-icon');
        const label = this.elements.themeToggle?.querySelector('.theme-label');
        const t = (key) => window.i18n ? window.i18n.t(key) : key;

        if (theme === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
            if (icon) icon.textContent = '◑';
            if (label) label.textContent = t('theme.light');
            if (this.elements.themeToggle) {
                this.elements.themeToggle.title = t('theme.toggle');
            }
        } else {
            document.documentElement.removeAttribute('data-theme');
            if (icon) icon.textContent = '◐';
            if (label) label.textContent = t('theme.dark');
            if (this.elements.themeToggle) {
                this.elements.themeToggle.title = t('theme.toggle');
            }
        }
        this.currentTheme = theme;
    }

    toggleTheme() {
        const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
        this.applyTheme(newTheme);
        localStorage.setItem('vllm-theme', newTheme);
        this.showNotification(`Switched to ${newTheme} mode`, 'info');
    }

    // ============ i18n (Internationalization) ============
    initI18n() {
        // Initialize i18n system
        if (window.i18n) {
            window.i18n.init();

            // Create language selector in header
            const container = document.getElementById('language-selector-container');
            if (container) {
                window.i18n.createLanguageSelector(container);
            }

            // Listen for locale change events
            window.addEventListener('localeChanged', (e) => {
                const locale = e.detail.locale;
                console.log(`[App] Language changed to: ${locale}`);

                // Update dynamic content
                this.updateDynamicTranslations();

                // Show notification
                const localeName = window.i18n.getAvailableLocales()[locale]?.nativeName || locale;
                this.showNotification(`Language: ${localeName}`, 'info');
            });
        } else {
            console.warn('[App] i18n system not available');
        }
    }

    /**
     * Update dynamically generated content with translations
     * This is called when language changes
     */
    updateDynamicTranslations() {
        // Helper function to translate
        const t = (key, params) => window.i18n ? window.i18n.t(key, params) : key;

        // Update status text if needed
        if (this.elements.statusText && !this.serverRunning) {
            this.elements.statusText.textContent = t('status.disconnected');
        }

        // Update nav status text
        const navStatusText = document.getElementById('nav-status-text');
        if (navStatusText && !this.serverRunning) {
            navStatusText.textContent = t('status.offline');
        }

        // Update theme label
        this.updateThemeLabel();

        // Note: Most content is updated automatically via data-i18n attributes
        // This function is only for content that's dynamically generated or needs special handling
    }

    /**
     * Update theme toggle button label based on current language
     */
    updateThemeLabel() {
        const label = this.elements.themeToggle?.querySelector('.theme-label');
        if (label && window.i18n) {
            const isDark = this.currentTheme === 'dark';
            label.textContent = window.i18n.t(isDark ? 'theme.dark' : 'theme.light');
        }
    }

    // NOTE: updateBenchmarkServerStatus is injected by GuideLLM module

    initToolCalling() {
        // Initialize popover system
        this.initPopovers();

        // Initialize structured outputs
        this.initStructuredOutputs();

        // Add tool button
        if (this.elements.addToolBtn) {
            this.elements.addToolBtn.addEventListener('click', () => this.openToolEditor());
        }

        // Clear all tools
        if (this.elements.clearToolsBtn) {
            this.elements.clearToolsBtn.addEventListener('click', () => this.clearAllTools());
        }

        // Tool editor modal
        if (this.elements.toolEditorClose) {
            this.elements.toolEditorClose.addEventListener('click', () => this.closeToolEditor());
        }
        if (this.elements.toolEditorCancel) {
            this.elements.toolEditorCancel.addEventListener('click', () => this.closeToolEditor());
        }
        if (this.elements.toolEditorSave) {
            this.elements.toolEditorSave.addEventListener('click', () => this.saveTool());
        }

        // Add parameter button
        if (this.elements.addParamBtn) {
            this.elements.addParamBtn.addEventListener('click', () => this.addParameter());
        }

        // Tool preset buttons
        document.querySelectorAll('.tool-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => this.loadToolPreset(btn.dataset.preset));
        });

        // Close modal on backdrop click
        if (this.elements.toolEditorModal) {
            this.elements.toolEditorModal.addEventListener('click', (e) => {
                if (e.target === this.elements.toolEditorModal) {
                    this.closeToolEditor();
                }
            });
        }

        // Initialize current parameters array for form
        this.currentParams = [];
    }

    // ============ Inline Panels System ============
    initPopovers() {
        // Track which panels are open
        this.openPanels = new Set();

        // Toolbar icon button click handlers - toggle their respective panels
        const toolbarButtons = [
            { btn: this.elements.toolbarSettings, panel: this.elements.panelSettings, id: 'settings' },
            { btn: this.elements.toolbarPrompt, panel: this.elements.panelPrompt, id: 'prompt' },
            { btn: this.elements.toolbarStructured, panel: this.elements.panelStructured, id: 'structured' },
            { btn: this.elements.toolbarTools, panel: this.elements.panelTools, id: 'tools' },
            { btn: this.elements.toolbarMcp, panel: this.elements.panelMcp, id: 'mcp' },
            { btn: this.elements.toolbarRag, panel: this.elements.panelRag, id: 'rag' }
        ];

        toolbarButtons.forEach(({ btn, panel, id }) => {
            if (btn && panel) {
                btn.addEventListener('click', () => {
                    this.togglePanel(id, btn, panel);
                });
            }
        });

        // Close button handlers for all panels
        document.querySelectorAll('.inline-panel-close').forEach(closeBtn => {
            closeBtn.addEventListener('click', () => {
                const panelId = closeBtn.dataset.panel;
                if (panelId) {
                    this.closePanel(panelId);
                }
            });
        });

        // Temperature and max tokens sync (slider <-> input)
        const tempSlider = this.elements.temperature;
        const tempInput = document.getElementById('temp-value');
        const tokensSlider = this.elements.maxTokens;
        const tokensInput = document.getElementById('tokens-value');

        if (tempSlider && tempInput) {
            tempSlider.addEventListener('input', () => {
                tempInput.value = tempSlider.value;
            });
            tempInput.addEventListener('input', () => {
                tempSlider.value = tempInput.value;
            });
        }

        if (tokensSlider && tokensInput) {
            tokensSlider.addEventListener('input', () => {
                tokensInput.value = tokensSlider.value;
            });
            tokensInput.addEventListener('input', () => {
                tokensSlider.value = tokensInput.value;
            });
        }

        // Clear system prompt button
        const clearPromptBtn = document.getElementById('clear-system-prompt-btn');
        if (clearPromptBtn) {
            clearPromptBtn.addEventListener('click', () => {
                if (this.elements.systemPrompt) {
                    this.elements.systemPrompt.value = '';
                    this.updateModifiedIndicators();
                }
            });
        }

        // System prompt template selector
        const promptTemplateSelect = document.getElementById('system-prompt-template');
        if (promptTemplateSelect) {
            promptTemplateSelect.addEventListener('change', () => {
                const template = promptTemplateSelect.value;
                if (template && this.elements.systemPrompt) {
                    this.elements.systemPrompt.value = this.getSystemPromptTemplate(template);
                    this.updateModifiedIndicators();
                }
                promptTemplateSelect.value = ''; // Reset to show "Templates"
            });
        }

        // Add change listeners to all settings inputs for real-time indicator updates
        const settingsPanel = document.getElementById('panel-settings');
        if (settingsPanel) {
            settingsPanel.querySelectorAll('input, select').forEach(input => {
                input.addEventListener('change', () => this.updateModifiedIndicators());
            });
        }

        // System prompt text change
        if (this.elements.systemPrompt) {
            this.elements.systemPrompt.addEventListener('input', () => this.updateModifiedIndicators());
        }
    }

    getSystemPromptTemplate(type) {
        const templates = {
            default: "You are a helpful assistant.",
            helpful: "You are a helpful, harmless, and honest AI assistant. You provide accurate, thoughtful responses while being transparent about your limitations. If you're unsure about something, you say so.",
            coder: "You are an expert software engineer and coding assistant. You write clean, efficient, well-documented code. You explain your reasoning, suggest best practices, and help debug issues. You're familiar with multiple programming languages and frameworks.",
            writer: "You are a creative writing assistant with a flair for storytelling. You help craft engaging narratives, develop compelling characters, and refine prose. You adapt your style to match the user's vision while offering constructive suggestions.",
            teacher: "You are a patient and knowledgeable teacher. You explain concepts clearly, break down complex topics into understandable parts, and use examples and analogies. You encourage questions and adapt your teaching style to the learner's level.",
            translator: "You are a professional translator fluent in multiple languages. You provide accurate translations while preserving meaning, tone, and cultural nuances. You can explain idioms and suggest alternative phrasings when needed.",
            analyst: "You are a data analyst and business intelligence expert. You help interpret data, identify trends, create insights, and explain statistical concepts. You present findings clearly and suggest actionable recommendations.",
            concise: "You are a concise assistant. You provide brief, direct answers without unnecessary elaboration. You get straight to the point while remaining helpful and accurate."
        };
        return templates[type] || '';
    }

    togglePanel(id, btnEl, panelEl) {
        if (this.openPanels.has(id)) {
            // Close if already open
            this.closePanel(id);
        } else {
            // Close all other panels first (only one at a time)
            this.closeAllPanels();
            // Open the panel
            panelEl.style.display = 'block';
            btnEl.classList.add('active');
            this.openPanels.add(id);
        }
    }

    closePanel(id) {
        const panel = document.getElementById(`panel-${id}`);
        const btn = document.getElementById(`toolbar-${id}`);
        if (panel) panel.style.display = 'none';
        if (btn) btn.classList.remove('active');
        this.openPanels.delete(id);
        // Update modified indicators when panel closes
        this.updateModifiedIndicators();
    }

    closeAllPanels() {
        const panels = ['settings', 'prompt', 'structured', 'tools', 'mcp', 'rag'];
        panels.forEach(id => this.closePanel(id));
    }

    // Check if any settings are modified from defaults and show indicator dots
    updateModifiedIndicators() {
        // Default values - only track key settings to avoid false positives
        const defaults = {
            temperature: 0.7,
            maxTokens: 256
        };
        const defaultSystemPrompt = "You are a helpful assistant.";

        // Settings panel - only check temperature and max tokens
        const settingsBtn = document.getElementById('toolbar-settings');
        if (settingsBtn) {
            const temp = parseFloat(this.elements.temperature?.value) || 0.7;
            const maxTokens = parseInt(this.elements.maxTokens?.value) || 256;

            const isModified = (
                Math.abs(temp - defaults.temperature) > 0.01 ||
                maxTokens !== defaults.maxTokens
            );
            settingsBtn.classList.toggle('modified', isModified);
        }

        // System prompt - check if text differs from default (empty is also considered modified)
        const promptBtn = document.getElementById('toolbar-prompt');
        if (promptBtn) {
            const currentPrompt = (this.elements.systemPrompt?.value?.trim() || '');
            const isModified = currentPrompt !== defaultSystemPrompt;
            promptBtn.classList.toggle('modified', isModified);
        }

        // Structured outputs - check if enabled
        const structuredBtn = document.getElementById('toolbar-structured');
        if (structuredBtn) {
            const isEnabled = this.elements.structuredEnabled?.checked || false;
            structuredBtn.classList.toggle('modified', isEnabled);
        }

        // Tool calling - check if any tools are defined
        const toolsBtn = document.getElementById('toolbar-tools');
        if (toolsBtn) {
            const hasTools = (this.tools?.length || 0) > 0;
            toolsBtn.classList.toggle('modified', hasTools);
        }

        // MCP - check if MCP is enabled in chat with selected servers
        const mcpBtn = document.getElementById('toolbar-mcp');
        if (mcpBtn) {
            const mcpActive = this.mcpEnabled && (this.mcpSelectedServers?.length || 0) > 0;
            mcpBtn.classList.toggle('modified', mcpActive);
        }
    }

    updateToolsBadge() {
        const count = this.tools ? this.tools.length : 0;
        if (this.elements.toolsCount) {
            this.elements.toolsCount.textContent = count;
        }
    }

    updateStructuredBadge() {
        if (this.elements.structuredBadge) {
            if (this.elements.structuredEnabled && this.elements.structuredEnabled.checked) {
                const type = this.structuredOutputType ? this.structuredOutputType.charAt(0).toUpperCase() + this.structuredOutputType.slice(1) : 'On';
                this.elements.structuredBadge.textContent = `Structured Output: ${type}`;
            } else {
                this.elements.structuredBadge.textContent = 'Structured Outputs: Off';
            }
        }
    }

    // ============ Structured Outputs ============
    initStructuredOutputs() {
        this.structuredOutputType = 'choice';
        this.structuredOutputConfig = {
            enabled: false,
            type: 'choice',
            choices: [],
            regex: '',
            jsonSchema: null,
            jsonSchemaName: 'response',
            grammar: ''
        };

        // Enable/disable toggle
        if (this.elements.structuredEnabled) {
            this.elements.structuredEnabled.addEventListener('change', () => {
                const enabled = this.elements.structuredEnabled.checked;
                const optionsEl = document.getElementById('structured-options');
                if (optionsEl) {
                    optionsEl.style.display = enabled ? 'block' : 'none';
                }
                this.structuredOutputConfig.enabled = enabled;
                this.updateStructuredBadge();
                this.updateModifiedIndicators();
            });
        }

        // Output type buttons
        document.querySelectorAll('.output-type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                // Update active button
                document.querySelectorAll('.output-type-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const type = btn.dataset.type;
                this.structuredOutputType = type;
                this.structuredOutputConfig.type = type;

                // Show/hide config sections
                document.querySelectorAll('.structured-config').forEach(config => {
                    config.style.display = 'none';
                });
                const configEl = document.getElementById(`structured-${type}-config`);
                if (configEl) {
                    configEl.style.display = 'block';
                }

                this.updateStructuredBadge();
            });
        });

        // Structured output presets
        document.querySelectorAll('.structured-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.loadStructuredPreset(btn.dataset.preset);
            });
        });
    }

    loadStructuredPreset(preset) {
        const presets = {
            // Choice presets
            sentiment: { type: 'choice', value: 'positive, negative, neutral' },
            yesno: { type: 'choice', value: 'yes, no' },
            rating: { type: 'choice', value: '1, 2, 3, 4, 5' },

            // Regex presets
            email: { type: 'regex', value: '\\w+@\\w+\\.\\w+' },
            phone: { type: 'regex', value: '\\d{3}-\\d{3}-\\d{4}' },
            date: { type: 'regex', value: '\\d{4}-\\d{2}-\\d{2}' },

            // JSON Schema presets
            person: {
                type: 'json',
                name: 'person',
                value: JSON.stringify({
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'The person\'s name' },
                        age: { type: 'integer', description: 'The person\'s age' },
                        email: { type: 'string', description: 'Email address' }
                    },
                    required: ['name']
                }, null, 2)
            },
            product: {
                type: 'json',
                name: 'product',
                value: JSON.stringify({
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        price: { type: 'number' },
                        category: { type: 'string' },
                        in_stock: { type: 'boolean' }
                    },
                    required: ['name', 'price']
                }, null, 2)
            },
            api: {
                type: 'json',
                name: 'api_response',
                value: JSON.stringify({
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' },
                        data: { type: 'object' },
                        message: { type: 'string' }
                    },
                    required: ['success']
                }, null, 2)
            },

            // Grammar presets
            sql: {
                type: 'grammar',
                value: `root ::= select_statement
select_statement ::= "SELECT " column " FROM " table " WHERE " condition
column ::= "id" | "name" | "email" | "*"
table ::= "users" | "products" | "orders"
condition ::= column " = " value
value ::= "'" [a-zA-Z0-9]+ "'" | [0-9]+`
            },
            arithmetic: {
                type: 'grammar',
                value: `root ::= expression
expression ::= term (("+" | "-") term)*
term ::= factor (("*" | "/") factor)*
factor ::= number | "(" expression ")"
number ::= [0-9]+`
            }
        };

        const p = presets[preset];
        if (!p) return;

        if (p.type === 'choice' && this.elements.structuredChoices) {
            this.elements.structuredChoices.value = p.value;
        } else if (p.type === 'regex' && this.elements.structuredRegex) {
            this.elements.structuredRegex.value = p.value;
        } else if (p.type === 'json') {
            if (this.elements.structuredJsonName) this.elements.structuredJsonName.value = p.name;
            if (this.elements.structuredJsonSchema) this.elements.structuredJsonSchema.value = p.value;
        } else if (p.type === 'grammar' && this.elements.structuredGrammar) {
            this.elements.structuredGrammar.value = p.value;
        }
    }

    getStructuredOutputsForRequest() {
        if (!this.structuredOutputConfig.enabled) {
            return null;
        }

        const type = this.structuredOutputConfig.type;

        if (type === 'choice') {
            const choicesStr = this.elements.structuredChoices?.value || '';
            const choices = choicesStr.split(',').map(c => c.trim()).filter(c => c);
            if (choices.length === 0) return null;
            return { structured_outputs: { choice: choices } };
        }

        if (type === 'regex') {
            const regex = this.elements.structuredRegex?.value?.trim();
            if (!regex) return null;
            return { structured_outputs: { regex: regex } };
        }

        if (type === 'json') {
            const schemaStr = this.elements.structuredJsonSchema?.value?.trim();
            const schemaName = this.elements.structuredJsonName?.value?.trim() || 'response';
            if (!schemaStr) return null;
            try {
                const schema = JSON.parse(schemaStr);
                return {
                    response_format: {
                        type: 'json_schema',
                        json_schema: {
                            name: schemaName,
                            schema: schema
                        }
                    }
                };
            } catch (e) {
                console.error('Invalid JSON schema:', e);
                this.showNotification('Invalid JSON schema', 'error');
                return null;
            }
        }

        if (type === 'grammar') {
            const grammar = this.elements.structuredGrammar?.value?.trim();
            if (!grammar) return null;
            return { structured_outputs: { grammar: grammar } };
        }

        return null;
    }

    attachListeners() {
        // Server control
        this.elements.startBtn.addEventListener('click', () => this.startServer());
        this.elements.stopBtn.addEventListener('click', () => this.stopServer());

        // CPU/GPU mode toggle
        this.elements.modeCpu.addEventListener('change', () => this.toggleComputeMode());
        this.elements.modeGpu.addEventListener('change', () => this.toggleComputeMode());
        this.elements.modeMetal.addEventListener('change', () => this.toggleComputeMode());

        // Accelerator selection change (NVIDIA/AMD)
        if (this.elements.acceleratorSelect) {
            this.elements.acceleratorSelect.addEventListener('change', () => {
                this.updateAcceleratorHelpText();
                this.updateCommandPreview();
            });
        }

        // Run mode toggle
        this.elements.runModeSubprocess.addEventListener('change', () => this.toggleRunMode());
        this.elements.runModeContainer.addEventListener('change', () => this.toggleRunMode());

        // Virtual environment path validation (check vLLM version when path changes)
        if (this.elements.venvPathInput) {
            this.elements.venvPathInput.addEventListener('blur', () => this.checkVenvVersion());
        }

        // Model Source toggle
        this.elements.modelSourceHub.addEventListener('change', () => this.toggleModelSource());
        this.elements.modelSourceModelscope.addEventListener('change', () => this.toggleModelSource());
        this.elements.modelSourceLocal.addEventListener('change', () => this.toggleModelSource());

        // Local model path validation and browse
        this.elements.browseFolderBtn.addEventListener('click', () => this.browseForFolder());
        this.elements.validatePathBtn.addEventListener('click', () => this.validateLocalModelPath());

        // Community Recipes modal
        if (this.elements.browseRecipesBtn) {
            this.elements.browseRecipesBtn.addEventListener('click', () => this.openRecipesModal());
        }
        if (this.elements.recipesModalClose) {
            this.elements.recipesModalClose.addEventListener('click', () => this.closeRecipesModal());
        }
        if (this.elements.recipesModalOverlay) {
            this.elements.recipesModalOverlay.addEventListener('click', () => this.closeRecipesModal());
        }
        if (this.elements.recipesSearchInput) {
            this.elements.recipesSearchInput.addEventListener('input', () => this.filterRecipes());
        }
        if (this.elements.recipesFilterTags) {
            this.elements.recipesFilterTags.addEventListener('click', (e) => {
                if (e.target.classList.contains('tag-btn')) {
                    this.filterRecipesByTag(e.target.dataset.tag);
                }
            });
        }
        if (this.elements.syncRecipesBtn) {
            this.elements.syncRecipesBtn.addEventListener('click', () => this.syncRecipesFromGitHub());
        }

        // Optional: validate on blur (can be removed if you want manual-only validation)
        this.elements.localModelPath.addEventListener('blur', () => {
            // Auto-validate only if path is not empty
            if (this.elements.localModelPath.value.trim()) {
                this.validateLocalModelPath();
            }
        });

        // Clear validation when user starts typing and update command preview
        this.elements.localModelPath.addEventListener('input', () => {
            this.clearLocalModelValidation();
            this.updateCommandPreview();
        });

        // Chat
        this.elements.sendBtn.addEventListener('click', () => this.sendMessage());
        this.elements.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                // Enter sends message, Shift+Enter for new line
                // Only send if server is ready
                if (this.serverReady && this.serverRunning) {
                    e.preventDefault();
                    this.sendMessage();
                }
            }
        });
        this.elements.clearChatBtn.addEventListener('click', () => this.clearChat());
        this.elements.exportChatBtn.addEventListener('click', () => this.exportChat());
        this.elements.clearSystemPromptBtn.addEventListener('click', () => this.clearSystemPrompt());

        // Message templates
        this.elements.messageTemplates.addEventListener('change', (e) => {
            if (e.target.value) {
                this.elements.chatInput.value = e.target.value;
                this.elements.chatInput.focus();
                // Reset the dropdown to the placeholder
                e.target.value = '';
            }
        });

        // Logs
        this.elements.clearLogsBtn.addEventListener('click', () => this.clearLogs());
        this.elements.autoScrollCheckbox.addEventListener('change', (e) => {
            this.autoScroll = e.target.checked;
        });

        // Save logs button
        if (this.elements.saveLogsBtn) {
            this.elements.saveLogsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.saveLogs();
            });
        }

        // Logs row toggle (collapsible)
        if (this.elements.logsRowToggle) {
            this.elements.logsRowToggle.addEventListener('click', (e) => {
                // Don't toggle if clicking on controls
                if (e.target.closest('.logs-row-controls')) return;
                this.toggleLogsRow();
            });
        }

        // Generation parameters - bidirectional sync between slider and input
        this.elements.temperature.addEventListener('input', (e) => {
            this.elements.tempValue.value = e.target.value;
        });
        this.elements.tempValue.addEventListener('input', (e) => {
            let val = parseFloat(e.target.value);
            if (isNaN(val)) val = 0.7;
            val = Math.max(0, Math.min(1, val)); // Clamp between 0 and 1
            this.elements.temperature.value = val;
        });
        this.elements.tempValue.addEventListener('blur', (e) => {
            // On blur, ensure the value is properly formatted
            let val = parseFloat(e.target.value);
            if (isNaN(val)) val = 0.7;
            val = Math.max(0, Math.min(1, val));
            e.target.value = val;
            this.elements.temperature.value = val;
        });

        this.elements.maxTokens.addEventListener('input', (e) => {
            this.elements.tokensValue.value = e.target.value;
        });
        this.elements.tokensValue.addEventListener('input', (e) => {
            let val = parseInt(e.target.value);
            if (isNaN(val)) val = 256;
            val = Math.max(1, Math.min(4096, val)); // Clamp between 1 and 4096
            this.elements.maxTokens.value = val;
        });
        this.elements.tokensValue.addEventListener('blur', (e) => {
            // On blur, ensure the value is properly formatted
            let val = parseInt(e.target.value);
            if (isNaN(val)) val = 256;
            val = Math.max(1, Math.min(4096, val));
            e.target.value = val;
            this.elements.maxTokens.value = val;
        });

        // Command preview - update when any config changes
        const configElements = [
            this.elements.modelSelect,
            this.elements.customModel,
            this.elements.host,
            this.elements.port,
            this.elements.modeCpu,
            this.elements.modeGpu,
            this.elements.modeMetal,
            this.elements.venvPathInput,
            this.elements.tensorParallel,
            this.elements.gpuMemory,
            this.elements.cpuKvcache,
            this.elements.cpuThreads,
            this.elements.dtype,
            this.elements.maxModelLen,
            this.elements.hfToken,
            this.elements.trustRemoteCode,
            this.elements.enablePrefixCaching,
            this.elements.enableToolCalling,
            this.elements.toolCallParser,
            this.elements.servedModelName
        ];

        configElements.forEach(element => {
            if (element) {
                element.addEventListener('input', () => this.updateCommandPreview());
                element.addEventListener('change', () => this.updateCommandPreview());
            }
        });

        // Toggle tool parser visibility based on enable tool calling checkbox
        this.elements.enableToolCalling.addEventListener('change', () => {
            this.updateToolParserVisibility();
        });
        this.updateToolParserVisibility(); // Initial state

        // Copy command button
        this.elements.copyCommandBtn.addEventListener('click', () => this.copyCommand());

        // NOTE: Benchmark listeners are set up in GuideLLM module (modules/guidellm.js)

        // Template Settings
        this.elements.templateSettingsToggle.addEventListener('click', () => this.toggleTemplateSettings());
        this.elements.modelSelect.addEventListener('change', () => {
            this.updateTemplateForModel();
            this.optimizeSettingsForModel();
            this.updateToolPanelStatus();  // Update tool parser display
        });
        this.elements.customModel.addEventListener('blur', () => {
            this.updateTemplateForModel();
            this.optimizeSettingsForModel();
            this.updateToolPanelStatus();  // Update tool parser display
        });
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/logs`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            this.addLog('WebSocket connected', 'success');
            this.updateStatus('connected', 'Connected');
        };

        this.ws.onmessage = (event) => {
            if (event.data) {
                this.addLog(event.data);
            }
        };

        this.ws.onerror = (error) => {
            this.addLog(`WebSocket error: ${error.message}`, 'error');
        };

        this.ws.onclose = () => {
            this.addLog('WebSocket disconnected', 'warning');
            this.updateStatus('disconnected', 'Disconnected');

            // Attempt to reconnect after 3 seconds
            setTimeout(() => this.connectWebSocket(), 3000);
        };
    }

    async checkFeatureAvailability() {
        try {
            const response = await fetch('/api/features');
            const features = await response.json();

            // Log feature availability
            console.log('Feature availability:', features);

            // Disable guidellm option if not available
            if (!features.guidellm) {
                this.elements.benchmarkMethodGuidellm.disabled = true;
                this.elements.benchmarkMethodGuidellm.parentElement.classList.add('disabled');
                this.elements.benchmarkMethodGuidellm.parentElement.title = 'GuideLLM not installed. Run: pip install guidellm';

                // Select built-in method instead
                if (this.elements.benchmarkMethodBuiltin) {
                    this.elements.benchmarkMethodBuiltin.checked = true;
                }

                console.warn('GuideLLM is not available. Install with: pip install guidellm');
            }

            // Handle vLLM availability (for subprocess mode)
            this.vllmInstalled = features.vllm_installed || false;
            this.vllmVersion = features.vllm_version || null;
            this.containerModeAvailable = features.container_mode || false;
            this.updateRunModeAvailability();

            // Handle MCP availability
            this.mcpAvailable = features.mcp || false;
            initMCPModule(this);

            // Handle GuideLLM availability
            this.guidellmAvailable = features.guidellm || false;
            initGuideLLMModule(this);

            // Initialize Claude Code module
            initClaudeCodeModule(this);

            // Handle ModelScope availability
            this.modelscopeInstalled = features.modelscope_installed || false;
            this.modelscopeVersion = features.modelscope_version || null;
            this.updateModelscopeAvailability();

            // Update container runtime status
            this.updateContainerRuntimeStatus(features.container_runtime, features.container_mode);

            // Update version display
            this.updateVersionDisplay(features.version);

            // Check hardware capabilities
            await this.checkHardwareCapabilities();
        } catch (error) {
            console.error('Error checking feature availability:', error);
        }
    }

    async checkVenvVersion() {
        const venvPath = this.elements.venvPathInput?.value?.trim();

        if (!venvPath) {
            // Reset to system vLLM version when venv path is cleared
            await this.checkFeatureAvailability();
            return;
        }

        try {
            const response = await fetch('/api/check-venv', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ venv_path: venvPath })
            });

            const result = await response.json();

            if (result.vllm_installed) {
                this.vllmInstalled = true;
                this.vllmVersion = result.vllm_version;
            } else {
                this.vllmInstalled = false;
                this.vllmVersion = null;
            }

            // Update UI with new version info
            this.updateRunModeAvailability();

        } catch (error) {
            console.error('Error checking venv vLLM version:', error);
            // Don't change vllm status on error - keep previous state
        }
    }

    updateContainerRuntimeStatus(runtime, available) {
        const statusEl = document.getElementById('container-runtime-status');
        if (!statusEl) return;

        const textEl = statusEl.querySelector('.feature-status-text');

        statusEl.classList.remove('available', 'unavailable');

        if (available && runtime) {
            statusEl.classList.add('available');
            textEl.textContent = runtime.charAt(0).toUpperCase() + runtime.slice(1);
            statusEl.title = `Container Runtime: ${runtime} (available)`;
        } else {
            statusEl.classList.add('unavailable');
            textEl.textContent = 'No Runtime';
            statusEl.title = 'No container runtime available (podman/docker not found)';
        }
    }

    updateVersionDisplay(version) {
        const versionEl = document.getElementById('nav-version');
        if (!versionEl) return;

        if (version) {
            versionEl.textContent = `v${version}`;
            versionEl.title = `vLLM Playground version ${version}`;
        }
    }

    async checkHardwareCapabilities() {
        try {
            const response = await fetch('/api/hardware-capabilities');
            const capabilities = await response.json();

            // Log hardware capabilities
            console.log('Hardware capabilities:', capabilities);

            // Handle GPU detection result (but don't force disable - allow manual selection)
            if (!capabilities.gpu_available) {
                // GPU not detected - show warning but still allow selection
                // User may know their server has GPU even if detection fails
                this.elements.modeGpuLabel.title = 'GPU not auto-detected. You can still select GPU mode if your server has a GPU.';

                // Update help text with warning
                this.elements.modeHelpText.innerHTML = '⚠️ GPU not auto-detected. Select GPU if your server has one.';
                this.elements.modeHelpText.style.color = '#f59e0b';

                console.warn('GPU not auto-detected (detection method: ' + capabilities.detection_method + ')');
                this.addLog('[SYSTEM] GPU not auto-detected - Manual selection available', 'warning');
            } else {
                // GPU is available - determine accelerator type
                const accelerator = capabilities.accelerator || 'nvidia';  // Default to nvidia if not specified
                let acceleratorName;
                if (accelerator === 'amd') {
                    acceleratorName = 'AMD (ROCm)';
                } else if (accelerator === 'tpu') {
                    acceleratorName = 'Google TPU';
                } else {
                    acceleratorName = 'NVIDIA (CUDA)';
                }
                
                console.log(`GPU is available on this system: ${acceleratorName}`);
                this.elements.modeHelpText.innerHTML = `CPU and GPU modes available. ${acceleratorName} detected.`;
                this.addLog(`[SYSTEM] ${acceleratorName} detected - Both CPU and GPU modes available`, 'info');

                // Auto-select the detected accelerator in the dropdown
                if (this.elements.acceleratorSelect) {
                    this.elements.acceleratorSelect.value = accelerator;
                    console.log(`Auto-selected accelerator: ${accelerator}`);
                }

                // Show GPU status display (only for NVIDIA currently, AMD/TPU use different monitoring)
                if (accelerator === 'nvidia') {
                    document.getElementById('gpu-status-display').style.display = 'block';
                    // Start GPU status polling
                    this.startGpuStatusPolling();
                } else {
                    // AMD/TPU detected - status polling not yet supported
                    document.getElementById('gpu-status-display').style.display = 'none';
                    if (accelerator === 'tpu') {
                        this.addLog('[SYSTEM] Google TPU status monitoring not yet supported', 'info');
                    } else {
                        this.addLog('[SYSTEM] AMD GPU status monitoring not yet supported', 'info');
                    }
                }
            }
        } catch (error) {
            console.error('Failed to check feature availability:', error);
        }
    }

    async pollStatus() {
        try {
            const response = await fetch('/api/status');
            const data = await response.json();

            if (data.running) {
                this.serverRunning = true;
                this.currentConfig = data.config;  // Store current config
                this.updateStatus('running', 'Server Running');
                this.elements.startBtn.disabled = true;
                this.elements.stopBtn.disabled = false;
                // Only enable send button if server is ready
                this.elements.sendBtn.disabled = !this.serverReady;
                this.elements.runBenchmarkBtn.disabled = false;

                // Update send button state only if serverReady (don't remove class unnecessarily)
                if (this.serverReady) {
                    this.updateSendButtonState();
                }

                if (data.uptime) {
                    this.elements.uptime.textContent = `(${data.uptime})`;
                }
            } else {
                this.serverRunning = false;
                this.serverReady = false;  // Reset ready state when server stops
                this.healthCheckStarted = false;  // Reset health check flag
                this.currentConfig = null;  // Clear config when server stops
                this.updateStatus('connected', 'Server Stopped');
                this.elements.startBtn.disabled = false;
                this.elements.stopBtn.disabled = true;
                this.elements.sendBtn.disabled = true;
                this.elements.sendBtn.classList.remove('btn-ready');
                this.elements.runBenchmarkBtn.disabled = true;
                this.elements.uptime.textContent = '';
            }
        } catch (error) {
            console.error('Failed to poll status:', error);
        }
    }

    updateStatus(state, text) {
        this.elements.statusDot.className = `status-dot ${state}`;
        this.elements.statusText.textContent = text;

        // Also update nav sidebar status
        const navStatusDot = document.getElementById('nav-status-dot');
        const navStatusText = document.getElementById('nav-status-text');
        if (navStatusDot) navStatusDot.className = `status-dot ${state}`;
        if (navStatusText) {
            if (state === 'running') {
                navStatusText.textContent = 'Running';
            } else if (state === 'connected') {
                navStatusText.textContent = 'Stopped';
            } else {
                navStatusText.textContent = 'Offline';
            }
        }

        // Update benchmark server status if on that view
        if (this.currentView === 'guidellm') {
            this.updateBenchmarkServerStatus();
        }
    }

    // GPU Status Polling
    startGpuStatusPolling() {
        // Stop any existing polling
        this.stopGpuStatusPolling();

        // Initial fetch
        this.fetchGpuStatus();

        // Start polling every 5 seconds
        this.gpuStatusInterval = setInterval(() => {
            this.fetchGpuStatus();
        }, 5000);
    }

    stopGpuStatusPolling() {
        if (this.gpuStatusInterval) {
            clearInterval(this.gpuStatusInterval);
            this.gpuStatusInterval = null;
        }
    }

    async fetchGpuStatus() {
        try {
            const refreshIndicator = document.getElementById('gpu-status-refresh');
            refreshIndicator.classList.add('refreshing');

            const response = await fetch('/api/gpu-status');
            const data = await response.json();

            refreshIndicator.classList.remove('refreshing');
            this.renderGpuStatus(data);
        } catch (error) {
            console.error('Failed to fetch GPU status:', error);
            document.getElementById('gpu-status-refresh').classList.remove('refreshing');
            this.renderGpuStatusError('Failed to fetch GPU status');
        }
    }

    renderGpuStatus(data) {
        const contentElement = document.getElementById('gpu-status-content');

        if (!data.gpu_available || !data.gpus || data.gpus.length === 0) {
            contentElement.innerHTML = '<div class="no-gpu">No GPU devices detected</div>';
            return;
        }

        let html = '';
        data.gpus.forEach(gpu => {
            // Handle memory values (support both MB and bytes, default to 0 for N/A)
            const memoryTotal = gpu.memory_total || 0;
            const memoryUsed = gpu.memory_used || 0;
            const memoryFree = gpu.memory_free || (memoryTotal - memoryUsed);

            const memoryUsedPercent = memoryTotal > 0 ? (memoryUsed / memoryTotal) * 100 : 0;
            const memoryFreeGB = memoryFree / 1024;
            const memoryTotalGB = memoryTotal / 1024;
            const memoryUsedGB = memoryUsed / 1024;

            // Support multiple property names for utilization (nvidia-smi may return different names)
            const utilization = gpu.utilization ?? gpu.utilization_gpu ?? gpu['utilization.gpu'] ?? 0;

            // Support multiple property names for temperature
            const temperature = gpu.temperature ?? gpu.temperature_gpu ?? gpu['temperature.gpu'] ?? 0;

            // Display N/A for values that couldn't be read (common on Jetson devices)
            const utilizationDisplay = utilization > 0 || gpu.utilization !== undefined ? `${utilization}%` : 'N/A';
            const temperatureDisplay = temperature > 0 || gpu.temperature !== undefined ? `${temperature}°C` : 'N/A';

            html += `
                <div class="gpu-device">
                    <div class="gpu-device-header">
                        <span class="gpu-name">${gpu.name || 'Unknown GPU'}</span>
                        <span class="gpu-index">GPU ${gpu.index ?? 0}</span>
                    </div>
                    <div class="gpu-memory">
                        <div class="memory-info">
                            <span>Memory: ${memoryFreeGB.toFixed(1)}GB free / ${memoryTotalGB.toFixed(1)}GB total</span>
                            <span>${memoryUsedPercent.toFixed(1)}% used</span>
                        </div>
                        <div class="memory-bar">
                            <div class="memory-used" style="width: ${Math.min(memoryUsedPercent, 100)}%"></div>
                        </div>
                    </div>
                    <div class="gpu-utilization">
                        <span class="utilization-label">GPU Utilization:</span>
                        <span class="utilization-value">${utilizationDisplay}</span>
                        <div class="utilization-bar">
                            <div class="utilization-fill" style="width: ${Math.min(utilization, 100)}%"></div>
                        </div>
                    </div>
                    <div class="gpu-temperature">
                        <span class="temp-icon">🌡️</span>
                        <span class="temp-value">${temperatureDisplay}</span>
                    </div>
                </div>
            `;
        });

        contentElement.innerHTML = html;
    }

    renderGpuStatusError(message) {
        const contentElement = document.getElementById('gpu-status-content');
        contentElement.innerHTML = `<div class="gpu-error">${message}</div>`;
    }

    toggleComputeMode() {
        const isCpuMode = this.elements.modeCpu.checked;
        const isGpuMode = this.elements.modeGpu.checked;
        const isMetalMode = this.elements.modeMetal.checked;

        // Update button active states
        this.elements.modeCpuLabel.classList.remove('active');
        this.elements.modeGpuLabel.classList.remove('active');
        this.elements.modeMetalLabel.classList.remove('active');

        if (isCpuMode) {
            this.elements.modeCpuLabel.classList.add('active');
            this.elements.modeHelpText.textContent = 'CPU mode is recommended for macOS';
            this.elements.dtypeHelpText.textContent = 'BFloat16 recommended for CPU';

            // Show CPU settings, hide GPU settings
            this.elements.cpuSettings.style.display = 'block';
            this.elements.gpuSettings.style.display = 'none';

            // Hide accelerator row in CPU mode
            if (this.elements.acceleratorRow) {
                this.elements.acceleratorRow.style.display = 'none';
            }

            // Set dtype to bfloat16 for CPU
            this.elements.dtype.value = 'bfloat16';
        } else if (isGpuMode) {
            this.elements.modeGpuLabel.classList.add('active');
            this.elements.dtypeHelpText.textContent = 'Auto recommended for GPU';

            // Show GPU settings, hide CPU settings
            this.elements.cpuSettings.style.display = 'none';
            this.elements.gpuSettings.style.display = 'block';

            // Update help text based on selected accelerator
            this.updateAcceleratorHelpText();

            // Set dtype to auto for GPU
            this.elements.dtype.value = 'auto';
        } else if (isMetalMode) {
            this.elements.modeMetalLabel.classList.add('active');
            this.elements.modeHelpText.textContent = 'Metal GPU mode for Apple Silicon (requires venv path)';
            this.elements.dtypeHelpText.textContent = 'BFloat16 recommended for Metal';

            // Hide both CPU and GPU settings for Metal (uses defaults)
            this.elements.cpuSettings.style.display = 'none';
            this.elements.gpuSettings.style.display = 'none';

            // Set dtype to bfloat16 for Metal
            this.elements.dtype.value = 'bfloat16';

            // Metal requires subprocess mode
            if (this.elements.runModeSubprocess) {
                this.elements.runModeSubprocess.checked = true;
                this.toggleRunMode();
            }
        }

        // Update accelerator row visibility (only shown in container mode + GPU mode)
        this.updateAcceleratorVisibility();

        // Update help text if in GPU mode (reflects run mode change)
        if (this.elements.modeGpu.checked) {
            this.updateAcceleratorHelpText();
        }

        // Update command preview
        this.updateCommandPreview();
    }

    updateAcceleratorVisibility() {
        // Accelerator dropdown only applies to container mode with GPU
        // In subprocess mode, vLLM auto-detects the hardware
        if (!this.elements.acceleratorRow) return;

        const isGpuMode = this.elements.modeGpu.checked;
        const isContainerMode = this.elements.runModeContainer.checked;

        if (isGpuMode && isContainerMode) {
            this.elements.acceleratorRow.style.display = 'flex';
        } else {
            this.elements.acceleratorRow.style.display = 'none';
        }
    }

    updateAcceleratorHelpText() {
        const isSubprocess = this.elements.runModeSubprocess.checked;
        
        // In subprocess mode, vLLM auto-detects hardware
        if (isSubprocess) {
            this.elements.modeHelpText.textContent = 'GPU mode - vLLM will auto-detect available hardware (NVIDIA/AMD/TPU)';
            return;
        }
        
        // In container mode, show accelerator-specific help
        if (!this.elements.acceleratorSelect) return;
        
        const accelerator = this.elements.acceleratorSelect.value;
        if (accelerator === 'amd') {
            this.elements.modeHelpText.textContent = 'GPU mode for AMD ROCm-enabled systems';
        } else if (accelerator === 'tpu') {
            this.elements.modeHelpText.textContent = 'TPU mode for Google Cloud TPU VMs (requires privileged container)';
        } else {
            this.elements.modeHelpText.textContent = 'GPU mode for NVIDIA CUDA-enabled systems';
        }
    }

    toggleRunMode() {
        const isSubprocess = this.elements.runModeSubprocess.checked;

        // Update button active states
        if (isSubprocess) {
            this.elements.runModeSubprocessLabel.classList.add('active');
            this.elements.runModeContainerLabel.classList.remove('active');

            // Show venv path option only in subprocess mode
            if (this.elements.venvPathGroup) {
                this.elements.venvPathGroup.style.display = 'block';
            }

            // Check if vLLM is installed
            if (!this.vllmInstalled) {
                this.elements.runModeHelpText.innerHTML = '<span style="color: var(--error-color);">⚠️ vLLM not installed. Run: pip install vllm</span>';
            } else if (!this.vllmVersion) {
                // vLLM is installed but version couldn't be detected
                this.elements.runModeHelpText.innerHTML = '<span style="color: var(--warning-color);">⚠️ vLLM installed but version unknown (dev install or missing metadata). Specify venv path below for better detection.</span>';
            } else {
                // vLLM is installed with known version
                this.elements.runModeHelpText.textContent = `Subprocess: Direct execution using vLLM v${this.vllmVersion}`;
            }
        } else {
            this.elements.runModeSubprocessLabel.classList.remove('active');
            this.elements.runModeContainerLabel.classList.add('active');

            // Hide venv path option in container mode
            if (this.elements.venvPathGroup) {
                this.elements.venvPathGroup.style.display = 'none';
            }

            if (!this.containerModeAvailable) {
                this.elements.runModeHelpText.innerHTML = '<span style="color: var(--error-color);">⚠️ No container runtime (podman/docker) found</span>';
            } else {
                this.elements.runModeHelpText.textContent = 'Container: Isolated environment (recommended)';
            }
        }

        // Update accelerator row visibility (only shown in container mode + GPU mode)
        this.updateAcceleratorVisibility();

        // Update command preview
        this.updateCommandPreview();
    }

    updateRunModeAvailability() {
        // Update UI based on what's available
        const subprocessLabel = this.elements.runModeSubprocessLabel;
        const containerLabel = this.elements.runModeContainerLabel;

        // Add visual indication for unavailable modes
        if (!this.vllmInstalled) {
            subprocessLabel.classList.add('mode-unavailable');
            subprocessLabel.title = 'vLLM not installed. Run: pip install vllm';
        } else if (!this.vllmVersion) {
            subprocessLabel.classList.remove('mode-unavailable');
            subprocessLabel.title = 'vLLM installed but version unknown (dev install or missing metadata)';
        } else {
            subprocessLabel.classList.remove('mode-unavailable');
            subprocessLabel.title = `vLLM v${this.vllmVersion} installed`;
        }

        if (!this.containerModeAvailable) {
            containerLabel.classList.add('mode-unavailable');
            containerLabel.title = 'No container runtime (podman/docker) found';
        } else {
            containerLabel.classList.remove('mode-unavailable');
            containerLabel.title = 'Container mode available';
        }

        // Trigger toggleRunMode to update help text
        this.toggleRunMode();
    }

    updateModelscopeAvailability() {
        // Update ModelScope UI based on whether modelscope SDK is installed
        const modelscopeLabel = this.elements.modelSourceModelscopeLabel;
        const modelscopeRadio = this.elements.modelSourceModelscope;

        if (!this.modelscopeInstalled) {
            modelscopeLabel.classList.add('mode-unavailable');
            modelscopeLabel.title = 'ModelScope SDK not installed. Run: pip install modelscope>=1.18.1';
            // If ModelScope was selected, switch to HuggingFace
            if (modelscopeRadio.checked) {
                this.elements.modelSourceHub.checked = true;
                this.toggleModelSource();
            }
        } else {
            modelscopeLabel.classList.remove('mode-unavailable');
            const versionText = this.modelscopeVersion ? `v${this.modelscopeVersion}` : '';
            modelscopeLabel.title = `ModelScope SDK ${versionText} installed`;
        }
    }

    toggleModelSource() {
        const isLocalModel = this.elements.modelSourceLocal.checked;
        const isModelscope = this.elements.modelSourceModelscope.checked;
        const isHuggingface = this.elements.modelSourceHub.checked;

        // Reset all button active states
        this.elements.modelSourceHubLabel.classList.remove('active');
        this.elements.modelSourceModelscopeLabel.classList.remove('active');
        this.elements.modelSourceLocalLabel.classList.remove('active');

        // Hide all model sections
        this.elements.hubModelSection.style.display = 'none';
        this.elements.modelscopeModelSection.style.display = 'none';
        this.elements.localModelSection.style.display = 'none';

        // Hide all token sections
        this.elements.hfTokenSection.style.display = 'none';
        this.elements.modelscopeTokenSection.style.display = 'none';

        if (isLocalModel) {
            this.elements.modelSourceLocalLabel.classList.add('active');
            this.elements.localModelSection.style.display = 'block';
        } else if (isModelscope) {
            this.elements.modelSourceModelscopeLabel.classList.add('active');
            this.elements.modelscopeModelSection.style.display = 'block';
            this.elements.modelscopeTokenSection.style.display = 'block';
            // Show install hint if ModelScope SDK is not installed
            if (this.elements.modelscopeInstallHint) {
                this.elements.modelscopeInstallHint.style.display = this.modelscopeInstalled ? 'none' : 'block';
            }
            // Clear local model validation
            this.clearLocalModelValidation();
        } else {
            // HuggingFace (default)
            this.elements.modelSourceHubLabel.classList.add('active');
            this.elements.hubModelSection.style.display = 'block';
            this.elements.hfTokenSection.style.display = 'block';
            // Clear local model validation
            this.clearLocalModelValidation();
        }

        // Update command preview
        this.updateCommandPreview();
    }

    async validateLocalModelPath() {
        const path = this.elements.localModelPath.value.trim();

        if (!path) {
            return;
        }

        // Show validating status
        this.showValidationStatus('validating', 'Validating path...');

        try {
            const response = await fetch('/api/models/validate-local', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: path })
            });

            const result = await response.json();

            if (result.valid) {
                // Show success
                this.showValidationStatus('valid', '✓ Valid model directory');

                // Update model info display
                this.updateLocalModelInfo(result.info);
            } else {
                // Show error
                this.showValidationStatus('invalid', `✗ ${result.error}`);
                this.hideLocalModelInfo();
            }
        } catch (error) {
            this.showValidationStatus('invalid', `✗ Error validating path: ${error.message}`);
            this.hideLocalModelInfo();
        }
    }

    showValidationStatus(type, message) {
        this.elements.localModelValidation.style.display = 'block';
        this.elements.validationMessage.textContent = message;

        // Remove existing classes
        this.elements.localModelValidation.classList.remove('valid', 'invalid', 'validating');

        // Add appropriate class
        this.elements.localModelValidation.classList.add(type);
    }

    clearLocalModelValidation() {
        this.elements.localModelValidation.style.display = 'none';
        this.hideLocalModelInfo();
    }

    updateLocalModelInfo(info) {
        // Show model info box
        this.elements.localModelInfo.style.display = 'block';

        // Use model_name from backend (intelligently extracted)
        // Fallback to extracting from path if not provided (backward compatibility)
        let modelName;
        if (info.model_name) {
            modelName = info.model_name;
        } else {
            // Fallback: extract from path
            const pathParts = info.path.split('/');
            modelName = pathParts[pathParts.length - 1];
        }

        document.getElementById('info-model-name').textContent = modelName;
        document.getElementById('info-model-type').textContent = info.model_type || 'Unknown';
        document.getElementById('info-model-size').textContent = info.size_mb ? `${info.size_mb} MB` : 'Unknown';
        document.getElementById('info-has-tokenizer').textContent = 'Yes'; // We validated tokenizer_config.json exists
    }

    hideLocalModelInfo() {
        this.elements.localModelInfo.style.display = 'none';
    }

    async browseForFolder() {
        // Try using the File System Access API (Chrome/Edge)
        if ('showDirectoryPicker' in window) {
            try {
                // Show native directory picker (modern browsers)
                const dirHandle = await window.showDirectoryPicker({
                    mode: 'read'
                });

                // We can't get the absolute path directly from the handle for security reasons
                // but we can check if it's a valid model directory

                // Check for required files
                let hasConfig = false;
                let hasTokenizer = false;

                try {
                    await dirHandle.getFileHandle('config.json');
                    hasConfig = true;
                } catch (e) {
                    // File doesn't exist
                }

                try {
                    await dirHandle.getFileHandle('tokenizer_config.json');
                    hasTokenizer = true;
                } catch (e) {
                    // File doesn't exist
                }

                if (!hasConfig || !hasTokenizer) {
                    this.showNotification('⚠️ Selected directory is missing required model files (config.json or tokenizer_config.json)', 'error');
                    return;
                }

                // Show a prompt asking for the absolute path since we can't get it from the API
                this.showNotification('Directory selected! Please enter the absolute path to this directory.', 'info');
                this.showNotification('💡 The browser cannot access the full path for security reasons. Please type or paste the absolute path.', 'info');

                // Focus the input so user can type the path
                this.elements.localModelPath.focus();

            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.error('Directory picker error:', error);
                    this.showNotification('Failed to open directory picker', 'error');
                }
            }
        } else {
            // Fallback: Try backend-based folder browser
            await this.showBackendFolderBrowser();
        }
    }

    async showBackendFolderBrowser() {
        // Show modal with backend folder browser
        try {
            const response = await fetch('/api/browse-directories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: this.elements.localModelPath.value || '~' })
            });

            if (!response.ok) {
                throw new Error('Backend folder browser not available');
            }

            const data = await response.json();

            // Create and show a simple folder browser modal
            this.showFolderBrowserModal(data.directories, data.current_path);

        } catch (error) {
            console.error('Backend browser error:', error);
            // Show helpful message
            this.showNotification(
                '📁 Folder browser unavailable. Please type the absolute path manually.\n\n' +
                'Example:\n' +
                '  • macOS/Linux: /Users/username/models/my-model\n' +
                '  • Windows: C:/Users/username/models/my-model',
                'info'
            );
        }
    }

    showFolderBrowserModal(directories, currentPath) {
        // Create a simple modal for browsing directories
        // This is a fallback UI when File System Access API is not available

        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        const content = document.createElement('div');
        content.style.cssText = `
            background: #1e293b;
            padding: 24px;
            border-radius: 12px;
            max-width: 600px;
            max-height: 80vh;
            overflow: auto;
            color: #e2e8f0;
        `;

        content.innerHTML = `
            <h3 style="margin-top: 0;">Browse Directories</h3>
            <div style="margin-bottom: 16px; padding: 12px; background: #0f172a; border-radius: 6px; font-family: monospace; word-break: break-all;">
                ${currentPath}
            </div>
            <div id="folder-list" style="margin-bottom: 16px;">
                ${directories.map(dir => `
                    <div class="folder-item" data-path="${dir.path}" style="padding: 8px 12px; margin: 4px 0; background: #334155; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 1.2em;">📁</span>
                        <span>${dir.name}</span>
                    </div>
                `).join('')}
            </div>
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="browser-select-btn" class="btn btn-primary">Select This Folder</button>
                <button id="browser-cancel-btn" class="btn btn-secondary">Cancel</button>
            </div>
        `;

        modal.appendChild(content);
        document.body.appendChild(modal);

        // Add event listeners
        document.getElementById('browser-select-btn').addEventListener('click', () => {
            this.elements.localModelPath.value = currentPath;
            document.body.removeChild(modal);
            this.validateLocalModelPath();
        });

        document.getElementById('browser-cancel-btn').addEventListener('click', () => {
            document.body.removeChild(modal);
        });

        // Navigate to subdirectory on click
        document.querySelectorAll('.folder-item').forEach(item => {
            item.addEventListener('click', async () => {
                const path = item.getAttribute('data-path');
                document.body.removeChild(modal);

                // Fetch subdirectory contents
                try {
                    const response = await fetch('/api/browse-directories', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: path })
                    });
                    const data = await response.json();
                    this.showFolderBrowserModal(data.directories, data.current_path);
                } catch (error) {
                    this.showNotification('Failed to browse directory', 'error');
                }
            });
        });
    }

    getConfig() {
        // Check model source: HuggingFace, ModelScope, or Local
        const isLocalModel = this.elements.modelSourceLocal.checked;
        const isModelscope = this.elements.modelSourceModelscope.checked;

        // Get model based on source
        let model;
        if (isModelscope) {
            model = this.elements.customModelscopeModel.value.trim() || this.elements.modelscopeModelSelect.value;
        } else {
            model = this.elements.customModel.value.trim() || this.elements.modelSelect.value;
        }

        const localModelPath = this.elements.localModelPath.value.trim();
        const maxModelLen = this.elements.maxModelLen.value;
        const hfToken = this.elements.hfToken.value.trim();
        const modelscopeToken = this.elements.modelscopeToken.value.trim();

        // Get compute mode (cpu, gpu, or metal)
        let computeMode = 'cpu';
        if (this.elements.modeGpu.checked) {
            computeMode = 'gpu';
        } else if (this.elements.modeMetal.checked) {
            computeMode = 'metal';
        }

        // Get run mode (subprocess or container)
        const runMode = document.getElementById('run-mode-subprocess').checked ? 'subprocess' : 'container';

        const config = {
            model: model,
            host: this.elements.host.value,
            port: parseInt(this.elements.port.value),
            dtype: this.elements.dtype.value,
            max_model_len: maxModelLen ? parseInt(maxModelLen) : null,
            run_mode: runMode,
            trust_remote_code: this.elements.trustRemoteCode.checked,
            enable_prefix_caching: this.elements.enablePrefixCaching.checked,
            compute_mode: computeMode,  // New: send compute_mode instead of use_cpu
            venv_path: this.elements.venvPathInput?.value.trim() || null,  // New: custom venv path
            hf_token: hfToken || null,  // Include HF token for gated models
            local_model_path: isLocalModel && localModelPath ? localModelPath : null,  // Add local model path
            use_modelscope: isModelscope,  // Flag to indicate ModelScope source
            modelscope_token: isModelscope && modelscopeToken ? modelscopeToken : null,  // ModelScope token
            enable_tool_calling: this.elements.enableToolCalling.checked,
            tool_call_parser: this.elements.toolCallParser.value || null,  // null = auto-detect
            served_model_name: this.elements.servedModelName?.value.trim() || null  // null = use model path
        };

        // Don't send chat template or stop tokens - let vLLM auto-detect them
        // The fields in the UI are for reference/display only
        // Users who need custom templates can set them via server config JSON or API

        if (computeMode === 'cpu' || computeMode === 'metal') {
            // CPU and Metal-specific settings
            config.cpu_kvcache_space = parseInt(this.elements.cpuKvcache.value);
            config.cpu_omp_threads_bind = this.elements.cpuThreads.value;
            config.use_cpu = (computeMode === 'cpu');  // Set use_cpu for backward compatibility
        } else {
            // GPU-specific settings
            config.tensor_parallel_size = parseInt(this.elements.tensorParallel.value);
            config.gpu_memory_utilization = parseFloat(this.elements.gpuMemory.value) / 100;
            config.load_format = "auto";
            // GPU accelerator type (nvidia/amd) for container mode
            config.accelerator = this.elements.acceleratorSelect.value;
            config.use_cpu = false;  // Backward compatibility
            // GPU device selection
            const gpuDevice = this.elements.gpuDevice.value.trim();
            if (gpuDevice) {
                config.gpu_device = gpuDevice;
            }
        }

        return config;
    }

    async startServer() {
        const config = this.getConfig();

        // Check run mode requirements
        if (config.run_mode === 'subprocess' && !this.vllmInstalled) {
            this.showNotification('⚠️ Cannot use Subprocess mode: vLLM is not installed. Please install vLLM (pip install vllm) or switch to Container mode.', 'error');
            this.addLog('❌ Subprocess mode requires vLLM to be installed. Run: pip install vllm', 'error');
            return;
        }

        // Check ModelScope SDK requirement
        if (config.use_modelscope && !this.modelscopeInstalled) {
            this.showNotification('⚠️ Cannot use ModelScope: modelscope SDK is not installed. Please install it with: pip install modelscope>=1.18.1', 'error');
            this.addLog('❌ ModelScope requires the modelscope SDK. Run: pip install modelscope>=1.18.1', 'error');
            return;
        }

        if (config.run_mode === 'container' && !this.containerModeAvailable) {
            this.showNotification('⚠️ Cannot use Container mode: No container runtime found. Please install podman or docker.', 'error');
            this.addLog('❌ Container mode requires podman or docker to be installed.', 'error');
            return;
        }

        // Validate local model path if using local model
        if (config.local_model_path) {
            this.addLog('🔍 Validating local model path...', 'info');

            // Check if path is provided
            if (!config.local_model_path.trim()) {
                this.showNotification('⚠️ Please enter a local model path', 'error');
                this.addLog('❌ Local model path is empty', 'error');
                return;
            }

            // Validate the path before starting server
            try {
                const validateResponse = await fetch('/api/models/validate-local', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: config.local_model_path })
                });

                const validateResult = await validateResponse.json();

                if (!validateResult.valid) {
                    this.showNotification(`⚠️ Invalid model path: ${validateResult.error}`, 'error');
                    this.addLog(`❌ Path validation failed: ${validateResult.error}`, 'error');
                    return;
                }

                this.addLog(`✓ Local model validated successfully`, 'success');
                this.addLog(`  Path: ${validateResult.info.path}`, 'info');
                this.addLog(`  Size: ${validateResult.info.size_mb} MB`, 'info');
            } catch (error) {
                this.showNotification('⚠️ Failed to validate local model path', 'error');
                this.addLog(`❌ Validation error: ${error.message}`, 'error');
                return;
            }
        }

        // Check if gated model requires HF token (frontend validation) - only for HF Hub models
        if (!config.local_model_path) {
            const model = config.model.toLowerCase();
            const isGated = model.includes('meta-llama/') || model.includes('redhatai/llama');

            if (isGated && !config.hf_token) {
                this.showNotification(`⚠️ ${config.model} is a gated model and requires a HuggingFace token!`, 'error');
                this.addLog(`❌ Gated model requires HF token: ${config.model}`, 'error');
                return;
            }
        }

        // Reset ready state
        this.serverReady = false;
        this.elements.sendBtn.classList.remove('btn-ready');

        this.elements.startBtn.disabled = true;
        this.elements.startBtn.textContent = 'Starting...';

        // Add immediate log feedback
        this.addLog('🚀 Starting vLLM server...', 'info');

        if (config.local_model_path) {
            this.addLog(`Model Source: Local Folder`, 'info');
            this.addLog(`Path: ${config.local_model_path}`, 'info');
        } else {
            this.addLog(`Model Source: HuggingFace Hub`, 'info');
            this.addLog(`Model: ${config.model}`, 'info');
        }

        this.addLog(`Run Mode: ${config.run_mode === 'subprocess' ? 'Subprocess (Direct)' : 'Container (Isolated)'}`, 'info');
        // Show compute mode with accelerator info if GPU mode
        let computeModeLabel = config.compute_mode.toUpperCase();
        if (config.compute_mode === 'gpu' && config.accelerator) {
            computeModeLabel += ` (${config.accelerator.toUpperCase()})`;
        }
        this.addLog(`Compute Mode: ${computeModeLabel}`, 'info');
        if (config.venv_path) {
            this.addLog(`Using custom venv: ${config.venv_path}`, 'info');
        }

        try {
            const response = await fetch('/api/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(config)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to start server');
            }

            const data = await response.json();

            // Log success with appropriate identifier
            if (data.mode === 'container') {
                this.addLog(`✅ Server started in container mode`, 'success');
                this.addLog(`Container ID: ${data.container_id}`, 'info');
            } else {
                this.addLog(`✅ Server started in subprocess mode`, 'success');
                this.addLog(`Process ID: ${data.pid}`, 'info');
            }

            this.addLog('⏳ Waiting for server initialization...', 'info');
            this.showNotification('Server started successfully', 'success');

        } catch (error) {
            this.addLog(`❌ Failed to start server: ${error.message}`, 'error');
            this.showNotification(`Failed to start: ${error.message}`, 'error');
            this.elements.startBtn.disabled = false;
        } finally {
            this.elements.startBtn.textContent = 'Start Server';
        }
    }

    async stopServer() {
        this.elements.stopBtn.disabled = true;
        this.elements.stopBtn.textContent = 'Stopping...';

        this.addLog('⏹️ Stopping vLLM server...', 'info');

        try {
            const response = await fetch('/api/stop', {
                method: 'POST'
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to stop server');
            }

            this.addLog('✅ Server stopped successfully', 'success');
            this.showNotification('Server stopped', 'success');

        } catch (error) {
            this.addLog(`❌ Failed to stop server: ${error.message}`, 'error');
            this.showNotification(`Failed to stop: ${error.message}`, 'error');
            this.elements.stopBtn.disabled = false;
        } finally {
            this.elements.stopBtn.textContent = 'Stop Server';
        }
    }

    async sendMessage() {
        const message = this.elements.chatInput.value.trim();

        if (!message) {
            return;
        }

        if (!this.serverRunning) {
            this.showNotification('Please start the server first', 'warning');
            return;
        }

        // Add user message to chat
        this.addChatMessage('user', message);
        this.chatHistory.push({role: 'user', content: message});

        // Clear input
        this.elements.chatInput.value = '';

        // Disable send button
        this.elements.sendBtn.disabled = true;
        this.elements.sendBtn.textContent = 'Generating...';

        // Create placeholder for assistant message
        const assistantMessageDiv = this.addChatMessage('assistant', '▌');
        const textSpan = assistantMessageDiv.querySelector('.message-text');
        let fullText = '';
        let startTime = Date.now();
        let firstTokenTime = null;
        let usageData = null;

        try {
            // Get current system prompt and prepare messages
            const systemPrompt = this.elements.systemPrompt.value.trim();
            let messagesToSend = [...this.chatHistory];  // Copy chat history

            // Prepend system prompt to messages if provided
            // This ensures system prompt is sent with every request dynamically
            if (systemPrompt) {
                messagesToSend = [
                    {role: 'system', content: systemPrompt},
                    ...this.chatHistory
                ];
            }

            // Don't send stop tokens by default - let vLLM handle them automatically via chat template
            // Stop tokens are only for reference/documentation in the UI
            // Users can still set custom_stop_tokens in the server config if needed

            // Get tools configuration - MCP and Custom Tools are SEPARATE
            // MCP takes priority when enabled
            let toolsConfig = { tools: null, tool_choice: null, parallel_tool_calls: null };
            let usingMCPTools = false;

            if (this.mcpEnabled && typeof this.getMCPToolsForRequest === 'function') {
                // MCP is enabled - use MCP tools
                const mcpTools = this.getMCPToolsForRequest();
                if (mcpTools.length > 0) {
                    toolsConfig = {
                        tools: mcpTools,
                        tool_choice: 'auto',  // MCP always uses auto
                        parallel_tool_calls: false  // Sequential for reliable execution
                    };
                    usingMCPTools = true;
                    console.log('=== Using MCP Tools ===');
                    console.log('MCP tools:', mcpTools.length);
                    console.log('Tool names:', mcpTools.map(t => t.function?.name));
                }
            }

            if (!usingMCPTools) {
                // MCP not enabled or no MCP tools - use custom tools from Tool Calling panel
                toolsConfig = this.getToolsForRequest();
                console.log('=== Using Custom Tools ===');
            }

            // Build request body
            // Check if tools are being used - use non-streaming for tool calls
            // vLLM streaming has issues with tool_calls data not being sent properly
            const useStreaming = !toolsConfig.tools || toolsConfig.tools.length === 0 || toolsConfig.tool_choice === 'none';

            if (!useStreaming) {
                console.log('🔧 Tools detected - using non-streaming mode for reliable tool call response');
            }

            const requestBody = {
                messages: messagesToSend,  // Send messages with system prompt prepended
                temperature: parseFloat(this.elements.temperature.value),
                max_tokens: parseInt(this.elements.maxTokens.value),
                stream: useStreaming
                // No stop_tokens - let vLLM handle them automatically
            };

            // Store flag for response handling (Phase 2: MCP tool execution)
            this._currentRequestUsingMCP = usingMCPTools;

            // Add tools if configured
            console.log('=== sendMessage: toolsConfig ===', toolsConfig);
            if (toolsConfig.tools) {
                requestBody.tools = toolsConfig.tools;
                if (toolsConfig.tool_choice) {
                    requestBody.tool_choice = toolsConfig.tool_choice;
                }
                if (toolsConfig.parallel_tool_calls !== null) {
                    requestBody.parallel_tool_calls = toolsConfig.parallel_tool_calls;
                }
                console.log('Tools added to request:', requestBody.tools?.length, 'tools, choice:', requestBody.tool_choice);
            } else {
                console.log('No tools added to request (toolsConfig.tools is null/undefined)');
            }

            // Add structured outputs if configured
            const structuredConfig = this.getStructuredOutputsForRequest();
            if (structuredConfig) {
                Object.assign(requestBody, structuredConfig);
                console.log('Structured outputs enabled:', structuredConfig);
            }

            // Use streaming
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'Failed to send message');
            }

            // Handle non-streaming response (used for tool calls)
            if (!useStreaming) {
                console.log('📥 Processing non-streaming response...');
                const jsonResponse = await response.json();
                console.log('📥 Full response:', jsonResponse);

                if (jsonResponse.choices && jsonResponse.choices.length > 0) {
                    const choice = jsonResponse.choices[0];
                    const message = choice.message;

                    if (message && message.tool_calls && message.tool_calls.length > 0) {
                        // Display tool calls (and text content if present)
                        console.log('🔧 Tool calls received:', message.tool_calls);
                        console.log('📝 Message content:', message.content);
                        console.log('📝 Full message object:', JSON.stringify(message, null, 2));

                        // Build HTML with optional text content + tool calls
                        let fullHtml = '';

                        // Show text content if present
                        if (message.content && message.content.trim()) {
                            console.log('📝 Adding text content to display');
                            fullHtml += `<div class="assistant-text-content">${this.escapeHtml(message.content)}</div>`;
                        } else {
                            console.log('📝 No text content to display (null or empty)');
                        }

                        // Use different format for MCP vs custom tools
                        if (this._currentRequestUsingMCP) {
                            // MCP tools - show with Execute/Skip buttons
                            fullHtml += this.formatMCPToolCallMessage(message.tool_calls);
                        } else {
                            // Custom tools - display only (manual handling)
                            fullHtml += this.formatToolCallMessage(message.tool_calls);
                        }

                        textSpan.innerHTML = fullHtml;
                        assistantMessageDiv.classList.add('tool-call');

                        // Add to chat history (include content if present)
                        this.chatHistory.push({
                            role: 'assistant',
                            content: message.content || null,
                            tool_calls: message.tool_calls
                        });
                    } else if (message && message.content) {
                        // Display text content only
                        textSpan.textContent = message.content;
                        this.chatHistory.push({role: 'assistant', content: message.content});
                    } else {
                        textSpan.textContent = 'No response from model';
                        textSpan.classList.add('message-text');
                        assistantMessageDiv.classList.add('error');
                    }

                    // Show usage metrics if available
                    if (jsonResponse.usage) {
                        usageData = jsonResponse.usage;
                        console.log('Usage data:', usageData);
                    }
                } else {
                    textSpan.textContent = 'Invalid response from server';
                    textSpan.classList.add('message-text');
                    assistantMessageDiv.classList.add('error');
                }

                // Calculate and display metrics for non-streaming
                const endTime = Date.now();
                const timeTaken = (endTime - startTime) / 1000;

                const promptTokens = usageData?.prompt_tokens || 0;
                const completionTokens = usageData?.completion_tokens || 0;
                const totalTokens = usageData?.total_tokens || (promptTokens + completionTokens);

                this.updateChatMetrics({
                    promptTokens: promptTokens,
                    completionTokens: completionTokens,
                    totalTokens: totalTokens,
                    timeTaken: timeTaken,
                    tokensPerSecond: completionTokens > 0 ? (completionTokens / timeTaken).toFixed(2) : 0
                });

                console.log('Non-streaming response completed');
                return;
            }

            // Read the streaming response
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            console.log('Starting to read streaming response...');

            // Track raw response data for debugging tool call failures
            let rawChunks = [];
            let toolsWereRequested = requestBody.tools && requestBody.tools.length > 0;

            while (true) {
                const {done, value} = await reader.read();

                if (done) {
                    console.log('Stream reading complete');
                    break;
                }

                // Decode the chunk
                const chunk = decoder.decode(value, {stream: true});
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.substring(6).trim();

                        if (data === '[DONE]') {
                            console.log('Received [DONE] signal');
                            break;
                        }

                        try {
                            const parsed = JSON.parse(data);

                            // Store raw chunks for debugging
                            if (toolsWereRequested) {
                                rawChunks.push(parsed);
                            }

                            if (parsed.choices && parsed.choices.length > 0) {
                                // Handle OpenAI-compatible chat completions endpoint format
                                const choice = parsed.choices[0];
                                let content = null;

                                // Check for tool calls in delta (streaming)
                                if (choice.delta && choice.delta.tool_calls) {
                                    // Store tool calls for later processing
                                    if (!this.pendingToolCalls) {
                                        this.pendingToolCalls = [];
                                    }
                                    console.log('🔧 Received tool_calls in delta:', choice.delta.tool_calls);
                                    for (const tc of choice.delta.tool_calls) {
                                        const idx = tc.index ?? 0;  // Use nullish coalescing
                                        if (!this.pendingToolCalls[idx]) {
                                            this.pendingToolCalls[idx] = {
                                                id: tc.id || '',
                                                type: tc.type || 'function',
                                                function: { name: '', arguments: '' }
                                            };
                                        }
                                        if (tc.id) this.pendingToolCalls[idx].id = tc.id;
                                        if (tc.function?.name) this.pendingToolCalls[idx].function.name += tc.function.name;
                                        if (tc.function?.arguments) this.pendingToolCalls[idx].function.arguments += tc.function.arguments;
                                    }
                                    // Show tool calling indicator
                                    textSpan.innerHTML = '🔧 <em>Calling tool...</em>';
                                }
                                // Check for tool calls in message (non-streaming)
                                else if (choice.message && choice.message.tool_calls) {
                                    console.log('🔧 Received tool_calls in message:', choice.message.tool_calls);
                                    this.pendingToolCalls = choice.message.tool_calls;
                                    textSpan.innerHTML = '🔧 <em>Tool call requested</em>';
                                }
                                // Check for tool calls directly in choice (some vLLM versions)
                                else if (choice.tool_calls) {
                                    console.log('🔧 Received tool_calls directly in choice:', choice.tool_calls);
                                    this.pendingToolCalls = choice.tool_calls;
                                    textSpan.innerHTML = '🔧 <em>Tool call requested</em>';
                                }

                                // Chat completions endpoint format (standard OpenAI format)
                                if (choice.delta && choice.delta.content) {
                                    content = choice.delta.content;
                                }
                                // Fallback: Non-streaming or old format (message.content)
                                else if (choice.message && choice.message.content) {
                                    content = choice.message.content;
                                }
                                // Fallback: Completions endpoint format (if vLLM still returns this)
                                else if (choice.text !== undefined) {
                                    content = choice.text;
                                }

                                if (content) {
                                    // Capture time to first token
                                    if (firstTokenTime === null) {
                                        firstTokenTime = Date.now();
                                        console.log('Time to first token:', (firstTokenTime - startTime) / 1000, 'seconds');
                                    }

                                    fullText += content;
                                    // Update the message in real-time with cursor
                                    textSpan.textContent = `${fullText}▌`;

                                    // Auto-scroll to bottom
                                    this.elements.chatContainer.scrollTop = this.elements.chatContainer.scrollHeight;
                                }
                            }

                            // Capture usage data if available - check both standard and x-* fields
                            if (parsed.usage) {
                                usageData = parsed.usage;
                                console.log('Captured usage data:', usageData);
                            }

                            // vLLM may also include metrics in custom fields
                            if (parsed.metrics) {
                                console.log('Captured metrics:', parsed.metrics);
                                // Merge metrics into usage data
                                usageData = { ...usageData, ...parsed.metrics };
                            }
                        } catch (e) {
                            // Skip invalid JSON lines
                            console.debug('Skipped line:', line, 'Error:', e.message);
                        }
                    }
                }
            }

            // Debug: Log raw chunks if tools were requested but no tool calls captured
            if (toolsWereRequested && (!this.pendingToolCalls || this.pendingToolCalls.length === 0)) {
                console.warn('⚠️ Tools were requested but no tool_calls in response. Raw chunks:', rawChunks);
                // Store for debugging and log full structure
                window.lastRawChunks = rawChunks;
                console.warn('📋 Full chunk structure (copy this for debugging):');
                console.warn(JSON.stringify(rawChunks, null, 2));
            }

            console.log('Finalizing response, fullText length:', fullText.length);
            console.log('Usage data:', usageData);

            // Remove cursor and finalize
            // Check if we have tool calls
            if (this.pendingToolCalls && this.pendingToolCalls.length > 0) {
                // Display tool calls
                const toolCallsHtml = this.formatToolCallMessage(this.pendingToolCalls);
                textSpan.innerHTML = toolCallsHtml;
                assistantMessageDiv.classList.add('tool-call');

                // Add to chat history with tool_calls
                this.chatHistory.push({
                    role: 'assistant',
                    content: null,
                    tool_calls: this.pendingToolCalls
                });

                // Clear pending tool calls
                this.pendingToolCalls = null;

                console.log('Tool calls displayed:', this.chatHistory[this.chatHistory.length - 1].tool_calls);
            } else if (fullText) {
                // Clean up response:
                // 1. Remove literal escape sequences (\r\n, \n, \r as text)
                fullText = fullText.replace(/\\r\\n/g, '\n');  // Replace literal \r\n with actual newline
                fullText = fullText.replace(/\\n/g, '\n');     // Replace literal \n with actual newline
                fullText = fullText.replace(/\\r/g, '');       // Remove literal \r

                // 2. Trim and limit excessive newlines (4+ → 2)
                fullText = fullText.replace(/\n{4,}/g, '\n\n').trim();

                // 3. If response is ONLY newlines/whitespace, mark as error
                if (!fullText || fullText.match(/^[\s\n\r]+$/)) {
                    textSpan.textContent = 'Model generated only whitespace. Try: 1) Clear system prompt, 2) Lower temperature, 3) Different model';
                    assistantMessageDiv.classList.add('error');
                }
                // 4. Check for malformed tool call patterns in the text
                // This happens when vLLM's tool parser fails but returns the raw output
                else if (toolsWereRequested && this.detectMalformedToolCall(fullText)) {
                    console.warn('⚠️ Detected malformed tool call in response text:', fullText);

                    const errorMsg = `⚠️ Tool Parsing Error

The model tried to call a tool but generated malformed JSON that couldn't be parsed.

This usually happens when:
• Max Tokens is too low (increase to 1024+)
• Model is struggling with the tool call format
• Too many tools available (simplify your setup)

Suggestions:
1. Increase "Max Tokens" in Chat Settings
2. Use a larger model (Qwen 2.5 7B+, Llama 3.1 8B+)
3. Use fewer tools / simpler MCP server

Raw output (for debugging):
${fullText.substring(0, 200)}${fullText.length > 200 ? '...' : ''}`;

                    textSpan.textContent = errorMsg;
                    textSpan.classList.add('message-text');
                    assistantMessageDiv.classList.add('error');

                    // Also log to console for debugging
                    console.error('🔧 MALFORMED TOOL CALL DETECTED:');
                    console.error('  Full text:', fullText);
                    console.error('  Check vLLM server logs for: "Error in extracting tool call from response"');
                }
                else {
                    textSpan.textContent = fullText;
                    this.chatHistory.push({role: 'assistant', content: fullText});
                }
            } else {
                // No content and no tool calls - show detailed error
                if (toolsWereRequested) {
                    // Tools were sent but model didn't respond properly
                    const toolChoice = requestBody.tool_choice || 'auto';
                    let errorMsg = `⚠️ Tool calling failed (tool_choice: "${toolChoice}")\n\n`;

                    if (rawChunks.length > 0) {
                        // Show what the model actually returned
                        const lastChunk = rawChunks[rawChunks.length - 1];
                        const finishReason = lastChunk?.choices?.[0]?.finish_reason || 'unknown';
                        errorMsg += `Finish reason: ${finishReason}\n`;

                        // Check if there's a partial tool call that wasn't captured
                        const hasPartialToolCall = rawChunks.some(c =>
                            c?.choices?.[0]?.delta?.tool_calls ||
                            c?.choices?.[0]?.message?.tool_calls
                        );

                        if (finishReason === 'tool_calls') {
                            // Model tried to use tools but we didn't capture the data
                            // This usually means the model generated malformed JSON that vLLM couldn't parse
                            errorMsg += `\n❌ Model generated invalid tool call format.\n\n`;
                            errorMsg += `The model tried to call a tool but produced malformed JSON.\n`;
                            errorMsg += `vLLM's parser couldn't extract the tool call data.\n\n`;
                            errorMsg += `Common causes:\n`;
                            errorMsg += `• Model too small (1B-3B often fail at tool calling)\n`;
                            errorMsg += `• Model not trained for function calling\n\n`;
                            errorMsg += `Solutions:\n`;
                            errorMsg += `• Use a larger model (8B+ recommended)\n`;
                            errorMsg += `• Try: Llama-3.1-8B-Instruct, Mistral-7B-Instruct\n`;
                            errorMsg += `• Or disable tools (set tool_choice to "none")`;

                            // Log detailed debug info
                            console.error('🔧 TOOL CALL PARSE FAILURE:');
                            console.error('  The model generated finish_reason="tool_calls" but no tool_calls data was returned.');
                            console.error('  This indicates vLLM\'s llama_tool_parser failed to extract the tool call.');
                            console.error('  Check server logs for: "Error in extracting tool call from response"');
                            console.error('  Raw chunks:', JSON.stringify(rawChunks, null, 2));
                        } else if (hasPartialToolCall) {
                            errorMsg += `\nPartial tool call detected but may be malformed.\n`;
                            errorMsg += `Check browser console for raw response data.`;
                        } else {
                            errorMsg += `\nModel didn't generate a tool call.\n`;
                            errorMsg += `This often happens with smaller models (1B-3B).\n\n`;
                            errorMsg += `Try:\n`;
                            errorMsg += `• Set tool_choice to "none" for text response\n`;
                            errorMsg += `• Use a larger model (8B+) for better tool calling`;
                        }
                    } else {
                        errorMsg += `No response chunks received.\n`;
                        errorMsg += `Check server logs for errors.`;
                    }

                    textSpan.textContent = errorMsg;
                    textSpan.classList.add('message-text');  // Add class for proper styling
                    console.error('Tool calling failed. Raw chunks:', rawChunks);
                } else {
                    textSpan.textContent = 'No response from model';
                    textSpan.classList.add('message-text');
                }
                assistantMessageDiv.classList.add('error');
            }

            // Calculate and display metrics
            const endTime = Date.now();
            const timeTaken = (endTime - startTime) / 1000; // in seconds
            const timeToFirstToken = firstTokenTime ? (firstTokenTime - startTime) / 1000 : null; // in seconds

            // Estimate prompt tokens if not provided (rough estimate: ~4 chars per token)
            const estimatedPromptTokens = usageData?.prompt_tokens || Math.ceil(
                this.chatHistory
                    .filter(msg => msg.role === 'user')
                    .map(msg => msg.content.length)
                    .reduce((a, b) => a + b, 0) / 4
            );

            const completionTokens = usageData?.completion_tokens || fullText.split(/\s+/).length;
            const totalTokens = usageData?.total_tokens || (estimatedPromptTokens + completionTokens);

            // Extract additional metrics from usage data if available
            // vLLM may provide these under different field names
            let kvCacheUsage = usageData?.gpu_cache_usage_perc ||
                usageData?.kv_cache_usage ||
                usageData?.cache_usage;
            let prefixCacheHitRate = usageData?.prefix_cache_hit_rate ||
                usageData?.cached_tokens_ratio;

            console.log('Full usage data:', usageData);

            // Wait a moment for vLLM to log stats for this request
            // vLLM logs stats after request completion, so we need to give it time
            console.log('⏳ Waiting 2 seconds for vLLM to log metrics...');
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Fetch additional metrics from vLLM's metrics endpoint
            let metricsAge = null;
            try {
                const metricsResponse = await fetch('/api/vllm/metrics');
                console.log('Metrics response status:', metricsResponse.status);

                if (metricsResponse.ok) {
                    const vllmMetrics = await metricsResponse.json();
                    console.log('✓ Fetched vLLM metrics:', vllmMetrics);

                    // Check how fresh the metrics are
                    if (vllmMetrics.metrics_age_seconds !== undefined) {
                        metricsAge = vllmMetrics.metrics_age_seconds;
                        console.log(`  → Metrics age: ${metricsAge}s`);

                        // Metrics should be very fresh (< 5 seconds) to be from this request
                        if (metricsAge <= 5) {
                            console.log(`  ✅ Metrics are fresh - likely from this response`);
                        } else if (metricsAge > 30) {
                            console.warn(`  ⚠️ Metrics are stale (${metricsAge}s old) - definitely NOT from this response`);
                        } else {
                            console.warn(`  ⚠️ Metrics are ${metricsAge}s old - may not be from this response`);
                        }
                    }

                    // Update metrics if available
                    if (vllmMetrics.kv_cache_usage_perc !== undefined) {
                        console.log('  → Using KV cache usage:', vllmMetrics.kv_cache_usage_perc);
                        kvCacheUsage = vllmMetrics.kv_cache_usage_perc;
                    } else {
                        console.log('  → No kv_cache_usage_perc in response');
                    }

                    if (vllmMetrics.prefix_cache_hit_rate !== undefined) {
                        console.log('  → Using prefix cache hit rate:', vllmMetrics.prefix_cache_hit_rate);
                        prefixCacheHitRate = vllmMetrics.prefix_cache_hit_rate;
                    } else {
                        console.log('  → No prefix_cache_hit_rate in response');
                    }
                } else {
                    console.warn('Metrics endpoint returned non-ok status:', metricsResponse.status);
                }
            } catch (e) {
                console.warn('Could not fetch vLLM metrics:', e);
            }

            console.log('Final Metrics:', {
                promptTokens: estimatedPromptTokens,
                completionTokens: completionTokens,
                totalTokens: totalTokens,
                timeTaken: timeTaken,
                timeToFirstToken: timeToFirstToken,
                kvCacheUsage: kvCacheUsage,
                prefixCacheHitRate: prefixCacheHitRate,
                metricsAge: metricsAge
            });

            this.updateChatMetrics({
                promptTokens: estimatedPromptTokens,
                completionTokens: completionTokens,
                totalTokens: totalTokens,
                timeTaken: timeTaken,
                timeToFirstToken: timeToFirstToken,
                kvCacheUsage: kvCacheUsage,
                prefixCacheHitRate: prefixCacheHitRate,
                metricsAge: metricsAge
            });

        } catch (error) {
            console.error('Chat error details:', error);
            this.addLog(`❌ Chat error: ${error.message}`, 'error');
            this.showNotification(`Error: ${error.message}`, 'error');

            // Remove the placeholder message
            if (assistantMessageDiv && assistantMessageDiv.parentNode) {
                assistantMessageDiv.remove();
            }

            this.addChatMessage('system', `Error: ${error.message}`);
        } finally {
            console.log('Finally block executed - resetting button');
            this.elements.sendBtn.disabled = false;
            this.elements.sendBtn.textContent = 'Send';
            if (this.updateSendButtonState) {
                this.updateSendButtonState();
            }
        }
    }

    addChatMessage(role, content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${role}`;

        // Add avatar for user and assistant messages
        if (role !== 'system') {
            const avatarDiv = document.createElement('div');
            avatarDiv.className = 'message-avatar';
            avatarDiv.textContent = role === 'user' ? 'U' : 'AI';
            messageDiv.appendChild(avatarDiv);
        }

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';

        const textSpan = document.createElement('span');
        textSpan.className = 'message-text';
        textSpan.textContent = content;
        contentDiv.appendChild(textSpan);

        messageDiv.appendChild(contentDiv);
        this.elements.chatContainer.appendChild(messageDiv);

        // Auto-scroll
        this.elements.chatContainer.scrollTop = this.elements.chatContainer.scrollHeight;

        return messageDiv;
    }

    clearChat() {
        if (this.chatHistory.length === 0) {
            this.showNotification('No messages to clear', 'info');
            return;
        }

        const modal = document.getElementById('clear-chat-modal');
        const overlay = document.getElementById('clear-chat-modal-overlay');
        const confirmBtn = document.getElementById('clear-chat-confirm-btn');
        const cancelBtn = document.getElementById('clear-chat-cancel-btn');

        if (!modal) {
            // Fallback to confirm if modal not found
            if (!confirm('Clear all chat messages? This cannot be undone.')) {
                return;
            }
            this.performClearChat();
            return;
        }

        // Show modal
        modal.style.display = 'flex';

        // Cleanup function
        const cleanup = () => {
            modal.style.display = 'none';
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            overlay.removeEventListener('click', handleCancel);
        };

        const handleConfirm = () => {
            cleanup();
            this.performClearChat();
        };

        const handleCancel = () => {
            cleanup();
        };

        // Add event listeners
        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);
        overlay.addEventListener('click', handleCancel);
    }

    performClearChat() {
        this.chatHistory = [];
        this.elements.chatContainer.innerHTML = `
            <div class="chat-message system">
                <div class="message-content">
                    <span class="message-text">Chat cleared. Start a new conversation.</span>
                </div>
            </div>
        `;
        this.showNotification('Chat cleared successfully', 'success');
    }

    exportChat() {
        if (this.chatHistory.length === 0) {
            this.showNotification('No messages to export', 'warning');
            return;
        }

        const modal = document.getElementById('export-modal');
        const overlay = document.getElementById('export-modal-overlay');
        const jsonBtn = document.getElementById('export-json-btn');
        const markdownBtn = document.getElementById('export-markdown-btn');
        const cancelBtn = document.getElementById('export-cancel-btn');

        if (!modal) {
            // Fallback to prompt if modal not found
            this.exportChatWithFormat(prompt('Export format:\n1. JSON\n2. Markdown\n\nEnter 1 or 2:', '1') === '2' ? 'markdown' : 'json');
            return;
        }

        // Show modal
        modal.style.display = 'flex';

        // Cleanup function
        const cleanup = () => {
            modal.style.display = 'none';
            jsonBtn.removeEventListener('click', handleJson);
            markdownBtn.removeEventListener('click', handleMarkdown);
            cancelBtn.removeEventListener('click', handleCancel);
            overlay.removeEventListener('click', handleCancel);
        };

        const handleJson = () => {
            cleanup();
            this.exportChatWithFormat('json');
        };

        const handleMarkdown = () => {
            cleanup();
            this.exportChatWithFormat('markdown');
        };

        const handleCancel = () => {
            cleanup();
        };

        // Add event listeners
        jsonBtn.addEventListener('click', handleJson);
        markdownBtn.addEventListener('click', handleMarkdown);
        cancelBtn.addEventListener('click', handleCancel);
        overlay.addEventListener('click', handleCancel);
    }

    exportChatWithFormat(format) {
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
        let content, filename, mimeType;

        if (format === 'markdown') {
            // Markdown format
            const lines = ['# Chat Export', `*Exported: ${new Date().toLocaleString()}*`, ''];
            this.chatHistory.forEach(msg => {
                const role = msg.role === 'user' ? '**You**' : '**AI**';
                lines.push(`${role}:`);
                lines.push('');
                lines.push(msg.content || '');
                lines.push('');
                lines.push('---');
                lines.push('');
            });
            content = lines.join('\n');
            filename = `vllm-chat-export-${timestamp}.md`;
            mimeType = 'text/markdown';
        } else {
            // JSON format
            const exportData = {
                exported: new Date().toISOString(),
                messageCount: this.chatHistory.length,
                messages: this.chatHistory
            };
            content = JSON.stringify(exportData, null, 2);
            filename = `vllm-chat-export-${timestamp}.json`;
            mimeType = 'application/json';
        }

        // Download chat file
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showNotification(`Chat exported as ${filename}`, 'success');
    }

    clearSystemPrompt() {
        this.elements.systemPrompt.value = '';
        this.showNotification('System prompt cleared', 'success');
    }

    addLog(message, type = 'info') {
        // Check if server startup is complete - look for vLLM-specific ready indicators
        // "Uvicorn running" or "Application startup complete" appear BEFORE model is loaded
        // So we start health check polling when we see these, then confirm with /health endpoint
        if (message && !this.healthCheckStarted &&
            (message.includes('Application startup complete') ||
                message.includes('Uvicorn running') ||
                message.match(/Application startup complete/i))) {
            console.log('🔄 Uvicorn started, beginning health check polling...');
            this.healthCheckStarted = true;
            this.startHealthCheckPolling();
        }

        // Auto-detect log type if not specified
        if (type === 'info' && message) {
            const lowerMsg = message.toLowerCase();
            if (lowerMsg.includes('error') || lowerMsg.includes('failed') || lowerMsg.includes('exception')) {
                type = 'error';
            } else if (lowerMsg.includes('warning') || lowerMsg.includes('warn')) {
                type = 'warning';
            } else if (lowerMsg.includes('success') || lowerMsg.includes('started') || lowerMsg.includes('complete')) {
                type = 'success';
            }
        }

        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;

        const timestamp = new Date().toLocaleTimeString();
        logEntry.textContent = `[${timestamp}] ${message}`;

        this.elements.logsContainer.appendChild(logEntry);

        // Auto-scroll if enabled
        if (this.autoScroll) {
            this.elements.logsContainer.scrollTop = this.elements.logsContainer.scrollHeight;
        }

        // Limit log entries to prevent memory issues
        const maxLogs = 1000;
        const logs = this.elements.logsContainer.querySelectorAll('.log-entry');
        if (logs.length > maxLogs) {
            logs[0].remove();
        }
    }

    updateSendButtonState() {
        // Update Send button appearance when server is ready
        if (this.serverReady && this.serverRunning) {
            // Only add if not already added (to avoid duplicate notifications)
            if (!this.elements.sendBtn.classList.contains('btn-ready')) {
                this.elements.sendBtn.classList.add('btn-ready');
                this.elements.sendBtn.disabled = false;
                // Add a brief notification
                this.showNotification('Server is ready to chat!', 'success');
                console.log('✅ Send button turned green!');
            }
        } else if (!this.serverReady) {
            // Only remove if server is not ready
            this.elements.sendBtn.classList.remove('btn-ready');
        }
    }

    async startHealthCheckPolling() {
        // Poll the vLLM health endpoint to confirm server is truly ready
        const maxAttempts = 60; // 60 attempts * 2 seconds = 2 minutes max
        let attempts = 0;

        const checkHealth = async () => {
            if (!this.serverRunning || this.serverReady) {
                this.healthCheckStarted = false;
                return;
            }

            attempts++;

            try {
                const response = await fetch('/api/vllm/health');
                const data = await response.json();

                if (data.success && data.status_code === 200) {
                    console.log('🎉 vLLM health check passed! Server is ready.');
                    this.serverReady = true;
                    this.healthCheckStarted = false;
                    this.updateSendButtonState();
                    this.fetchChatTemplate();
                    return;
                }
            } catch (error) {
                // Health check failed, continue polling
                console.log(`Health check attempt ${attempts}/${maxAttempts} - waiting...`);
            }

            if (attempts < maxAttempts && this.serverRunning && !this.serverReady) {
                setTimeout(checkHealth, 2000); // Check every 2 seconds
            } else {
                this.healthCheckStarted = false;
                if (!this.serverReady) {
                    console.log('⚠️ Health check timed out, server may still be loading...');
                }
            }
        };

        // Start checking after a brief delay
        setTimeout(checkHealth, 1000);
    }

    clearLogs() {
        this.elements.logsContainer.innerHTML = `
            <div class="log-entry info">Logs cleared.</div>
        `;
    }

    saveLogs() {
        const logsContainer = this.elements.logsContainer;
        if (!logsContainer) return;

        // Get all log entries as text
        const logEntries = logsContainer.querySelectorAll('.log-entry');
        let logText = '';
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        logEntries.forEach(entry => {
            const text = entry.textContent || entry.innerText;
            logText += text + '\n';
        });

        if (!logText.trim()) {
            this.showNotification('No logs to save', 'warning');
            return;
        }

        // Create and download file
        const blob = new Blob([logText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vllm-server-logs-${timestamp}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showNotification('Logs saved successfully', 'success');
    }

    toggleLogsRow() {
        const logsRow = this.elements.logsRow;
        if (!logsRow) return;

        logsRow.classList.toggle('collapsed');
    }

    showNotification(message, type = 'info', duration = 4000) {
        // Create toast container if it doesn't exist
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }

        // Get icon based on type
        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ'
        };

        // Create toast element
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <div class="toast-icon">${icons[type] || icons.info}</div>
            <div class="toast-content">
                <div class="toast-message">${message}</div>
            </div>
            <button class="toast-close" onclick="this.parentElement.classList.add('toast-exit'); setTimeout(() => this.parentElement.remove(), 300);">✕</button>
            <div class="toast-progress">
                <div class="toast-progress-bar" style="animation-duration: ${duration}ms;"></div>
            </div>
        `;

        container.appendChild(toast);

        // Log to console
        console.log(`[${type.toUpperCase()}] ${message}`);

        // Auto-remove after duration
        setTimeout(() => {
            if (toast.parentElement) {
                toast.classList.add('toast-exit');
                setTimeout(() => {
                    if (toast.parentElement) {
                        toast.remove();
                    }
                }, 300);
            }
        }, duration);

        return toast;
    }

    /**
     * Show a custom confirm dialog (replaces window.confirm)
     * @param {Object} options - Configuration options
     * @param {string} options.title - Dialog title
     * @param {string} options.message - Dialog message
     * @param {string} options.confirmText - Confirm button text (default: "Confirm")
     * @param {string} options.cancelText - Cancel button text (default: "Cancel")
     * @param {string} options.icon - Icon emoji (default: "⚠️")
     * @param {string} options.type - Button type: "danger", "warning", "primary" (default: "danger")
     * @returns {Promise<boolean>} - Resolves to true if confirmed, false if cancelled
     */
    showConfirm(options = {}) {
        return new Promise((resolve) => {
            const {
                title = 'Confirm Action',
                message = 'Are you sure you want to proceed?',
                confirmText = 'Confirm',
                cancelText = 'Cancel',
                icon = '⚠️',
                type = 'danger'
            } = options;

            const modal = document.getElementById('confirm-modal');
            const overlay = document.getElementById('confirm-modal-overlay');
            const iconEl = document.getElementById('confirm-modal-icon');
            const titleEl = document.getElementById('confirm-modal-title');
            const messageEl = document.getElementById('confirm-modal-message');
            const confirmBtn = document.getElementById('confirm-modal-confirm');
            const cancelBtn = document.getElementById('confirm-modal-cancel');

            if (!modal) {
                console.warn('Confirm modal not found, falling back to window.confirm');
                resolve(window.confirm(message));
                return;
            }

            // Set content
            iconEl.textContent = icon;
            titleEl.textContent = title;
            messageEl.textContent = message;
            confirmBtn.textContent = confirmText;
            cancelBtn.textContent = cancelText;

            // Set button type
            confirmBtn.className = `btn btn-${type}`;

            // Show modal
            modal.style.display = 'flex';

            // Cleanup function
            const cleanup = () => {
                modal.style.display = 'none';
                confirmBtn.removeEventListener('click', handleConfirm);
                cancelBtn.removeEventListener('click', handleCancel);
                overlay.removeEventListener('click', handleCancel);
                document.removeEventListener('keydown', handleKeydown);
            };

            const handleConfirm = () => {
                cleanup();
                resolve(true);
            };

            const handleCancel = () => {
                cleanup();
                resolve(false);
            };

            const handleKeydown = (e) => {
                if (e.key === 'Escape') {
                    handleCancel();
                } else if (e.key === 'Enter') {
                    handleConfirm();
                }
            };

            // Add event listeners
            confirmBtn.addEventListener('click', handleConfirm);
            cancelBtn.addEventListener('click', handleCancel);
            overlay.addEventListener('click', handleCancel);
            document.addEventListener('keydown', handleKeydown);

            // Focus confirm button
            confirmBtn.focus();
        });
    }

    updateChatMetrics(metrics) {
        // Update all metric displays
        const promptTokensEl = document.getElementById('metric-prompt-tokens');
        const completionTokensEl = document.getElementById('metric-completion-tokens');
        const totalTokensEl = document.getElementById('metric-total-tokens');
        const timeTakenEl = document.getElementById('metric-time-taken');
        const tokensPerSecEl = document.getElementById('metric-tokens-per-sec');
        const promptThroughputEl = document.getElementById('metric-prompt-throughput');
        const generationThroughputEl = document.getElementById('metric-generation-throughput');
        const kvCacheUsageEl = document.getElementById('metric-kv-cache-usage');
        const prefixCacheHitEl = document.getElementById('metric-prefix-cache-hit');

        if (promptTokensEl) {
            promptTokensEl.textContent = metrics.promptTokens || '-';
            promptTokensEl.classList.add('updated');
            setTimeout(() => promptTokensEl.classList.remove('updated'), 500);
        }

        if (completionTokensEl) {
            completionTokensEl.textContent = metrics.completionTokens || '-';
            completionTokensEl.classList.add('updated');
            setTimeout(() => completionTokensEl.classList.remove('updated'), 500);
        }

        if (totalTokensEl) {
            const total = (metrics.totalTokens || (metrics.promptTokens + metrics.completionTokens));
            totalTokensEl.textContent = total;
            totalTokensEl.classList.add('updated');
            setTimeout(() => totalTokensEl.classList.remove('updated'), 500);
        }

        if (timeTakenEl) {
            timeTakenEl.textContent = `${metrics.timeTaken.toFixed(2)}s`;
            timeTakenEl.classList.add('updated');
            setTimeout(() => timeTakenEl.classList.remove('updated'), 500);
        }

        if (tokensPerSecEl) {
            const tokensPerSec = metrics.completionTokens / metrics.timeTaken;
            tokensPerSecEl.textContent = tokensPerSec.toFixed(2);
            tokensPerSecEl.classList.add('updated');
            setTimeout(() => tokensPerSecEl.classList.remove('updated'), 500);
        }

        // New metrics
        if (promptThroughputEl) {
            // Calculate prompt throughput: prompt_tokens / time_to_first_token
            if (metrics.timeToFirstToken && metrics.timeToFirstToken > 0) {
                const promptThroughput = metrics.promptTokens / metrics.timeToFirstToken;
                promptThroughputEl.textContent = `${promptThroughput.toFixed(2)} tok/s`;
            } else {
                // Fallback: use overall time if time_to_first_token not available
                const promptThroughput = metrics.promptTokens / metrics.timeTaken;
                promptThroughputEl.textContent = `${promptThroughput.toFixed(2)} tok/s`;
            }
            promptThroughputEl.classList.add('updated');
            setTimeout(() => promptThroughputEl.classList.remove('updated'), 500);
        }

        if (generationThroughputEl) {
            // Calculate generation throughput: completion_tokens / (total_time - time_to_first_token)
            if (metrics.timeToFirstToken) {
                const generationTime = metrics.timeTaken - metrics.timeToFirstToken;
                if (generationTime > 0) {
                    const generationThroughput = metrics.completionTokens / generationTime;
                    generationThroughputEl.textContent = `${generationThroughput.toFixed(2)} tok/s`;
                } else {
                    generationThroughputEl.textContent = '-';
                }
            } else {
                // Fallback: use overall throughput
                const generationThroughput = metrics.completionTokens / metrics.timeTaken;
                generationThroughputEl.textContent = `${generationThroughput.toFixed(2)} tok/s`;
            }
            generationThroughputEl.classList.add('updated');
            setTimeout(() => generationThroughputEl.classList.remove('updated'), 500);
        }

        if (kvCacheUsageEl) {
            // GPU KV cache usage - from vLLM stats if available
            if (metrics.kvCacheUsage !== undefined && metrics.kvCacheUsage !== null) {
                // Server already sends percentage values (e.g., 0.2 = 0.2%, not 20%)
                // No conversion needed
                const percentage = metrics.kvCacheUsage.toFixed(1);

                // Add staleness indicator if metrics are old
                if (metrics.metricsAge !== undefined && metrics.metricsAge > 5) {
                    kvCacheUsageEl.textContent = `${percentage}% ⚠️`;
                    kvCacheUsageEl.title = `Metrics age: ${metrics.metricsAge.toFixed(1)}s - may not reflect this response`;
                } else if (metrics.metricsAge !== undefined) {
                    kvCacheUsageEl.textContent = `${percentage}%`;
                    kvCacheUsageEl.title = `Fresh metrics (${metrics.metricsAge.toFixed(1)}s old) - from this response`;
                } else {
                    kvCacheUsageEl.textContent = `${percentage}%`;
                    kvCacheUsageEl.title = '';
                }
            } else {
                kvCacheUsageEl.textContent = 'N/A';
                kvCacheUsageEl.title = 'No data available';
            }
            kvCacheUsageEl.classList.add('updated');
            setTimeout(() => kvCacheUsageEl.classList.remove('updated'), 500);
        }

        if (prefixCacheHitEl) {
            // Prefix cache hit rate - from vLLM stats if available
            if (metrics.prefixCacheHitRate !== undefined && metrics.prefixCacheHitRate !== null) {
                // Server already sends percentage values (e.g., 36.1 = 36.1%, not 3610%)
                // No conversion needed
                const percentage = metrics.prefixCacheHitRate.toFixed(1);

                // Add staleness indicator if metrics are old
                if (metrics.metricsAge !== undefined && metrics.metricsAge > 5) {
                    prefixCacheHitEl.textContent = `${percentage}% ⚠️`;
                    prefixCacheHitEl.title = `Metrics age: ${metrics.metricsAge.toFixed(1)}s - may not reflect this response`;
                } else if (metrics.metricsAge !== undefined) {
                    prefixCacheHitEl.textContent = `${percentage}%`;
                    prefixCacheHitEl.title = `Fresh metrics (${metrics.metricsAge.toFixed(1)}s old) - from this response`;
                } else {
                    prefixCacheHitEl.textContent = `${percentage}%`;
                    prefixCacheHitEl.title = '';
                }
            } else {
                prefixCacheHitEl.textContent = 'N/A';
                prefixCacheHitEl.title = 'No data available';
            }
            prefixCacheHitEl.classList.add('updated');
            setTimeout(() => prefixCacheHitEl.classList.remove('updated'), 500);
        }
    }

    updateToolParserVisibility() {
        // Show/hide the tool parser dropdown based on enable tool calling checkbox
        if (this.elements.toolParserGroup) {
            this.elements.toolParserGroup.style.display =
                this.elements.enableToolCalling.checked ? 'block' : 'none';
        }
        // Also update the tool panel status
        this.updateToolPanelStatus();
    }

    updateToolPanelStatus() {
        // Update the Tool Calling panel to reflect server configuration
        const toolCallingEnabled = this.elements.enableToolCalling?.checked ?? true;

        // Get the effective parser (auto-detect if not set)
        let parser = this.elements.toolCallParser?.value || '';
        if (!parser && toolCallingEnabled) {
            // Auto-detect based on model name
            const model = (this.elements.customModel?.value.trim() || this.elements.modelSelect?.value || '').toLowerCase();
            if (model.includes('llama-3') || model.includes('llama3') || model.includes('llama_3')) {
                parser = 'llama3_json';
            } else if (model.includes('mistral')) {
                parser = 'mistral';
            } else if (model.includes('hermes') || model.includes('qwen')) {
                parser = 'hermes';
            } else if (model.includes('internlm')) {
                parser = 'internlm';
            } else if (model.includes('granite')) {
                parser = 'granite-20b-fc';
            } else {
                // Default fallback - use hermes as a general-purpose parser
                parser = 'hermes';
            }
        }

        // Update warning/status banners
        if (this.elements.toolServerWarning) {
            this.elements.toolServerWarning.style.display = toolCallingEnabled ? 'none' : 'flex';
        }
        if (this.elements.toolServerStatus) {
            if (toolCallingEnabled) {
                this.elements.toolServerStatus.style.display = 'flex';
                if (this.elements.toolParserDisplay) {
                    this.elements.toolParserDisplay.textContent = parser || 'auto';
                }
            } else {
                this.elements.toolServerStatus.style.display = 'none';
            }
        }

        // Disable/enable tool controls based on server support
        const controlElements = [
            this.elements.toolChoiceRow,
            this.elements.toolPresetsRow,
            this.elements.toolsListContainer
        ];

        controlElements.forEach(el => {
            if (el) {
                if (toolCallingEnabled) {
                    el.classList.remove('tool-controls-disabled');
                } else {
                    el.classList.add('tool-controls-disabled');
                }
            }
        });

        // Update tool choice dropdown - if server doesn't support, set to None
        if (!toolCallingEnabled && this.elements.toolChoice) {
            this.elements.toolChoice.value = '';
        }
    }

    updateCommandPreview() {
        // Check model source: HuggingFace, ModelScope, or Local
        const isLocalModel = this.elements.modelSourceLocal.checked;
        const isModelscope = this.elements.modelSourceModelscope.checked;
        const localModelPath = this.elements.localModelPath.value.trim();

        // Use local model path if in local mode, ModelScope model, or HF model
        let model;
        if (isLocalModel && localModelPath) {
            model = localModelPath;
        } else if (isModelscope) {
            model = this.elements.customModelscopeModel.value.trim() || this.elements.modelscopeModelSelect.value;
        } else {
            model = this.elements.customModel.value.trim() || this.elements.modelSelect.value;
        }

        const host = this.elements.host.value;
        const port = this.elements.port.value;
        const dtype = this.elements.dtype.value;
        const maxModelLen = this.elements.maxModelLen.value;
        const trustRemoteCode = this.elements.trustRemoteCode.checked;
        const enablePrefixCaching = this.elements.enablePrefixCaching.checked;

        // Determine compute mode: cpu, gpu, or metal
        const isCpuMode = this.elements.modeCpu.checked;
        const isMetalMode = this.elements.modeMetal?.checked || false;
        // Metal mode uses GPU settings (not CPU)
        const useGpuSettings = !isCpuMode;  // Both GPU and Metal use GPU settings

        const hfToken = this.elements.hfToken.value.trim();
        const modelscopeToken = this.elements.modelscopeToken.value.trim();

        // Get venv path if specified (for subprocess mode)
        const venvPath = this.elements.venvPathInput?.value.trim() || '';
        const pythonExec = venvPath ? `${venvPath}/bin/python` : 'python';

        // Build command string
        let cmd;

        if (isCpuMode) {
            // CPU mode: show environment variables and use openai.api_server
            const cpuKvcache = this.elements.cpuKvcache?.value || '4';
            const cpuThreads = this.elements.cpuThreads?.value || 'auto';

            cmd = `# CPU Mode - Set environment variables:\n`;
            cmd += `export VLLM_CPU_KVCACHE_SPACE=${cpuKvcache}\n`;
            cmd += `export VLLM_CPU_OMP_THREADS_BIND=${cpuThreads}\n`;
            cmd += `export VLLM_TARGET_DEVICE=cpu\n`;
            cmd += `export VLLM_USE_V1=1  # Required to be explicitly set\n`;
            if (isModelscope) {
                cmd += `export VLLM_USE_MODELSCOPE=True  # Download from ModelScope\n`;
                if (modelscopeToken) {
                    cmd += `export MODELSCOPE_SDK_TOKEN=[YOUR_TOKEN]\n`;
                }
            } else if (hfToken) {
                cmd += `export HF_TOKEN=[YOUR_TOKEN]\n`;
            }
            cmd += `\n${pythonExec} -m vllm.entrypoints.openai.api_server`;
            cmd += ` \\\n  --model ${model}`;
            cmd += ` \\\n  --host ${host}`;
            cmd += ` \\\n  --port ${port}`;
            cmd += ` \\\n  --dtype bfloat16`;
            if (!maxModelLen) {
                cmd += ` \\\n  --max-model-len 2048`;
                cmd += ` \\\n  --max-num-batched-tokens 2048`;
            }
        } else {
            // GPU mode: use openai.api_server
            const gpuDevice = this.elements.gpuDevice.value.trim();

            // Initialize cmd for GPU mode
            cmd = '';

            if (gpuDevice) {
                cmd += `# GPU Device Selection:\n`;
                cmd += `export CUDA_VISIBLE_DEVICES=${gpuDevice}\n\n`;
            }

            if (isModelscope) {
                cmd += `# ModelScope - Download from modelscope.cn:\n`;
                cmd += `export VLLM_USE_MODELSCOPE=True\n`;
                if (modelscopeToken) {
                    cmd += `export MODELSCOPE_SDK_TOKEN=[YOUR_TOKEN]\n`;
                }
                cmd += `\n`;
            } else if (hfToken) {
                cmd += `# Set HF token for gated models:\n`;
                cmd += `export HF_TOKEN=[YOUR_TOKEN]\n\n`;
            }

            cmd += `${pythonExec} -m vllm.entrypoints.openai.api_server`;
            cmd += ` \\\n  --model ${model}`;
            cmd += ` \\\n  --host ${host}`;
            cmd += ` \\\n  --port ${port}`;
            cmd += ` \\\n  --dtype ${dtype}`;

            // GPU-specific flags
            const tensorParallel = this.elements.tensorParallel.value;
            const gpuMemory = parseFloat(this.elements.gpuMemory.value) / 100;

            cmd += ` \\\n  --tensor-parallel-size ${tensorParallel}`;
            cmd += ` \\\n  --gpu-memory-utilization ${gpuMemory}`;
            cmd += ` \\\n  --load-format auto`;
            if (!maxModelLen) {
                // Metal uses 2048 like CPU (less memory than desktop GPUs)
                const defaultMaxLen = isMetalMode ? 2048 : 8192;
                cmd += ` \\\n  --max-model-len ${defaultMaxLen}`;
                cmd += ` \\\n  --max-num-batched-tokens ${defaultMaxLen}`;
            }
        }

        if (maxModelLen) {
            cmd += ` \\\n  --max-model-len ${maxModelLen}`;
            cmd += ` \\\n  --max-num-batched-tokens ${maxModelLen}`;
        }

        if (trustRemoteCode) {
            cmd += ` \\\n  --trust-remote-code`;
        }

        if (enablePrefixCaching) {
            cmd += ` \\\n  --enable-prefix-caching`;
        }

        // Tool calling flags
        const enableToolCalling = this.elements.enableToolCalling.checked;
        const toolCallParser = this.elements.toolCallParser.value;

        if (enableToolCalling) {
            // Determine parser (auto-detect based on model name if not explicitly set)
            let parser = toolCallParser;
            if (!parser) {
                // Auto-detect based on model name
                const modelLower = model.toLowerCase();
                if (modelLower.includes('llama-3') || modelLower.includes('llama3') || modelLower.includes('llama_3')) {
                    parser = 'llama3_json';
                } else if (modelLower.includes('mistral')) {
                    parser = 'mistral';
                } else if (modelLower.includes('hermes') || modelLower.includes('qwen')) {
                    parser = 'hermes';
                } else if (modelLower.includes('internlm')) {
                    parser = 'internlm';
                } else if (modelLower.includes('granite')) {
                    parser = 'granite-20b-fc';
                }
            }

            if (parser) {
                cmd += ` \\\n  --enable-auto-tool-choice`;
                cmd += ` \\\n  --tool-call-parser ${parser}`;
            }
        }

        // Served model name (required for Claude Code)
        const servedModelName = this.elements.servedModelName?.value.trim();
        if (servedModelName) {
            cmd += ` \\\n  --served-model-name ${servedModelName}`;
        }

        // Note: vLLM automatically loads chat templates from model's tokenizer_config.json
        // No need to specify --chat-template manually

        // Update the display (use value for textarea)
        this.elements.commandText.value = cmd;
    }

    async copyCommand() {
        const commandText = this.elements.commandText.value;

        try {
            await navigator.clipboard.writeText(commandText);

            // Visual feedback
            const originalText = this.elements.copyCommandBtn.textContent;
            this.elements.copyCommandBtn.textContent = 'Copied!';
            this.elements.copyCommandBtn.classList.add('copied');

            setTimeout(() => {
                this.elements.copyCommandBtn.textContent = originalText;
                this.elements.copyCommandBtn.classList.remove('copied');
            }, 2000);

            this.showNotification('Command copied to clipboard!', 'success');
        } catch (err) {
            console.error('Failed to copy command:', err);
            this.showNotification('Failed to copy command', 'error');
        }
    }

    // NOTE: Benchmark methods (runBenchmark, stopBenchmark, pollBenchmarkStatus, 
    // displayBenchmarkResults, displayBenchmarkTable, resetBenchmarkUI) are 
    // injected by GuideLLM module (modules/guidellm.js)

    // ============ Template Settings ============
    toggleTemplateSettings() {
        const content = this.elements.templateSettingsContent;
        const icon = this.elements.templateSettingsToggle.querySelector('.toggle-icon');

        if (content.style.display === 'none') {
            content.style.display = 'block';
            icon.classList.add('open');
            // Update template on first open
            if (!this.elements.chatTemplate.value) {
                this.updateTemplateForModel();
            }
        } else {
            content.style.display = 'none';
            icon.classList.remove('open');
        }
    }

    async fetchChatTemplate() {
        try {
            const response = await fetch('/api/chat/template');
            if (response.ok) {
                const data = await response.json();
                console.log('Fetched chat template from backend:', data);

                // Update the template fields with the model's actual template
                this.elements.chatTemplate.value = data.template;
                this.elements.stopTokens.value = data.stop_tokens.join(', ');

                // Show a notification about where the template came from
                if (data.note) {
                    this.addLog(`[INFO] ${data.note}`, 'info');
                }

                this.addLog(`[INFO] Chat template loaded from ${data.source} for model: ${data.model}`, 'info');
            }
        } catch (error) {
            console.error('Failed to fetch chat template:', error);
        }
    }

    updateTemplateForModel(silent = false) {
        const model = this.elements.customModel.value.trim() || this.elements.modelSelect.value;
        const template = this.getTemplateForModel(model);
        const stopTokens = this.getStopTokensForModel(model);

        // Update the template and stop tokens fields
        this.elements.chatTemplate.value = template;
        this.elements.stopTokens.value = stopTokens.join(', ');

        console.log(`Template updated for model: ${model}`);

        // Only show feedback if not silent (i.e., when user actively changes model)
        if (!silent) {
            // Show visual feedback that template was updated
            this.showNotification(`Chat template reference updated for: ${model.split('/').pop()}`, 'success');

            // Add visual highlight to template fields briefly
            this.elements.chatTemplate.style.transition = 'background-color 0.3s ease';
            this.elements.stopTokens.style.transition = 'background-color 0.3s ease';
            this.elements.chatTemplate.style.backgroundColor = '#10b98120';
            this.elements.stopTokens.style.backgroundColor = '#10b98120';

            setTimeout(() => {
                this.elements.chatTemplate.style.backgroundColor = '';
                this.elements.stopTokens.style.backgroundColor = '';
            }, 1000);

            // Note: vLLM handles templates automatically
            if (this.serverRunning) {
                this.showNotification('✅ Note: vLLM applies templates automatically from tokenizer config', 'success');
                this.addLog('[INFO] Model template reference updated. vLLM will use the model\'s built-in chat template automatically.', 'info');
            }
        }
    }

    getTemplateForModel(modelName) {
        const model = modelName.toLowerCase();

        // Llama 3/3.1/3.2 models (use new format with special tokens)
        // Reference: Meta's official Llama 3 tokenizer_config.json
        if (model.includes('llama-3') && (model.includes('llama-3.1') || model.includes('llama-3.2') || model.includes('llama-3-'))) {
            return (
                "{{- bos_token }}"
                + "{% for message in messages %}"
                + "{% if message['role'] == 'system' %}"
                + "{{- '<|start_header_id|>system<|end_header_id|>\\n\\n' + message['content'] + '<|eot_id|>' }}"
                + "{% elif message['role'] == 'user' %}"
                + "{{- '<|start_header_id|>user<|end_header_id|>\\n\\n' + message['content'] + '<|eot_id|>' }}"
                + "{% elif message['role'] == 'assistant' %}"
                + "{{- '<|start_header_id|>assistant<|end_header_id|>\\n\\n' + message['content'] + '<|eot_id|>' }}"
                + "{% endif %}"
                + "{% endfor %}"
                + "{% if add_generation_prompt %}"
                + "{{- '<|start_header_id|>assistant<|end_header_id|>\\n\\n' }}"
                + "{% endif %}"
            );
        }

        // Llama 2 models (older [INST] format with <<SYS>>)
        // Reference: Meta's official Llama 2 tokenizer_config.json
        else if (model.includes('llama-2') || model.includes('llama2')) {
            return (
                "{% if messages[0]['role'] == 'system' %}"
                + "{% set loop_messages = messages[1:] %}"
                + "{% set system_message = messages[0]['content'] %}"
                + "{% else %}"
                + "{% set loop_messages = messages %}"
                + "{% set system_message = false %}"
                + "{% endif %}"
                + "{% for message in loop_messages %}"
                + "{% if loop.index0 == 0 and system_message != false %}"
                + "{{- '<s>[INST] <<SYS>>\\n' + system_message + '\\n<</SYS>>\\n\\n' + message['content'] + ' [/INST]' }}"
                + "{% elif message['role'] == 'user' %}"
                + "{{- '<s>[INST] ' + message['content'] + ' [/INST]' }}"
                + "{% elif message['role'] == 'assistant' %}"
                + "{{- ' ' + message['content'] + ' </s>' }}"
                + "{% endif %}"
                + "{% endfor %}"
            );
        }

        // Mistral/Mixtral models (similar to Llama 2 but simpler)
        // Reference: Mistral AI's official tokenizer_config.json
        else if (model.includes('mistral') || model.includes('mixtral')) {
            return (
                "{{ bos_token }}"
                + "{% for message in messages %}"
                + "{% if (message['role'] == 'user') != (loop.index0 % 2 == 0) %}"
                + "{{- raise_exception('Conversation roles must alternate user/assistant/user/assistant/...') }}"
                + "{% endif %}"
                + "{% if message['role'] == 'user' %}"
                + "{{- '[INST] ' + message['content'] + ' [/INST]' }}"
                + "{% elif message['role'] == 'assistant' %}"
                + "{{- message['content'] + eos_token }}"
                + "{% else %}"
                + "{{- raise_exception('Only user and assistant roles are supported!') }}"
                + "{% endif %}"
                + "{% endfor %}"
            );
        }

        // Gemma models (Google)
        // Reference: Google's official Gemma tokenizer_config.json
        else if (model.includes('gemma')) {
            return (
                "{{ bos_token }}"
                + "{% if messages[0]['role'] == 'system' %}"
                + "{{- raise_exception('System role not supported') }}"
                + "{% endif %}"
                + "{% for message in messages %}"
                + "{% if (message['role'] == 'user') != (loop.index0 % 2 == 0) %}"
                + "{{- raise_exception('Conversation roles must alternate user/assistant/user/assistant/...') }}"
                + "{% endif %}"
                + "{% if message['role'] == 'user' %}"
                + "{{- '<start_of_turn>user\\n' + message['content'] | trim + '<end_of_turn>\\n' }}"
                + "{% elif message['role'] == 'assistant' %}"
                + "{{- '<start_of_turn>model\\n' + message['content'] | trim + '<end_of_turn>\\n' }}"
                + "{% endif %}"
                + "{% endfor %}"
                + "{% if add_generation_prompt %}"
                + "{{- '<start_of_turn>model\\n' }}"
                + "{% endif %}"
            );
        }

        // TinyLlama (use ChatML format)
        // Reference: TinyLlama's official tokenizer_config.json
        else if (model.includes('tinyllama') || model.includes('tiny-llama')) {
            return (
                "{% for message in messages %}\\n"
                + "{% if message['role'] == 'user' %}\\n"
                + "{{- '<|user|>\\n' + message['content'] + eos_token }}\\n"
                + "{% elif message['role'] == 'system' %}\\n"
                + "{{- '<|system|>\\n' + message['content'] + eos_token }}\\n"
                + "{% elif message['role'] == 'assistant' %}\\n"
                + "{{- '<|assistant|>\\n'  + message['content'] + eos_token }}\\n"
                + "{% endif %}\\n"
                + "{% if loop.last and add_generation_prompt %}\\n"
                + "{{- '<|assistant|>' }}\\n"
                + "{% endif %}\\n"
                + "{% endfor %}"
            );
        }

        // CodeLlama (uses Llama 2 format)
        // Reference: Meta's CodeLlama tokenizer_config.json
        else if (model.includes('codellama') || model.includes('code-llama')) {
            return (
                "{% if messages[0]['role'] == 'system' %}"
                + "{% set loop_messages = messages[1:] %}"
                + "{% set system_message = messages[0]['content'] %}"
                + "{% else %}"
                + "{% set loop_messages = messages %}"
                + "{% set system_message = false %}"
                + "{% endif %}"
                + "{% for message in loop_messages %}"
                + "{% if loop.index0 == 0 and system_message != false %}"
                + "{{- '<s>[INST] <<SYS>>\\n' + system_message + '\\n<</SYS>>\\n\\n' + message['content'] + ' [/INST]' }}"
                + "{% elif message['role'] == 'user' %}"
                + "{{- '<s>[INST] ' + message['content'] + ' [/INST]' }}"
                + "{% elif message['role'] == 'assistant' %}"
                + "{{- ' ' + message['content'] + ' </s>' }}"
                + "{% endif %}"
                + "{% endfor %}"
            );
        }

        // Default generic template for unknown models
        else {
            console.log('Using generic chat template for model:', modelName);
            return (
                "{% for message in messages %}"
                + "{% if message['role'] == 'system' %}"
                + "{{- message['content'] + '\\n' }}"
                + "{% elif message['role'] == 'user' %}"
                + "{{- 'User: ' + message['content'] + '\\n' }}"
                + "{% elif message['role'] == 'assistant' %}"
                + "{{- 'Assistant: ' + message['content'] + '\\n' }}"
                + "{% endif %}"
                + "{% endfor %}"
                + "{% if add_generation_prompt %}"
                + "{{- 'Assistant:' }}"
                + "{% endif %}"
            );
        }
    }

    getStopTokensForModel(modelName) {
        const model = modelName.toLowerCase();

        // Llama 3/3.1/3.2 models - use special tokens
        if (model.includes('llama-3') && (model.includes('llama-3.1') || model.includes('llama-3.2') || model.includes('llama-3-'))) {
            return ["<|eot_id|>", "<|end_of_text|>"];
        }

        // Llama 2 models - use special tokens
        else if (model.includes('llama-2') || model.includes('llama2')) {
            return ["</s>", "[INST]"];
        }

        // Mistral/Mixtral models - use special tokens
        else if (model.includes('mistral') || model.includes('mixtral')) {
            return ["</s>", "[INST]"];
        }

        // Gemma models - use special tokens
        else if (model.includes('gemma')) {
            return ["<end_of_turn>", "<start_of_turn>"];
        }

        // TinyLlama - use ChatML special tokens
        else if (model.includes('tinyllama') || model.includes('tiny-llama')) {
            return ["</s>", "<|user|>", "<|system|>", "<|assistant|>"];
        }

        // CodeLlama - use Llama 2 tokens
        else if (model.includes('codellama') || model.includes('code-llama')) {
            return ["</s>", "[INST]"];
        }

        // Default generic stop tokens for unknown models
        else {
            return ["\\n\\nUser:", "\\n\\nAssistant:"];
        }
    }

    optimizeSettingsForModel() {
        // This function can be used to optimize settings based on model
        // Currently disabled to use user-configured defaults
        console.log('Model-specific optimization disabled - using user defaults');
    }

    // ============ Resize Functionality ============
    initResize() {
        const resizeHandles = document.querySelectorAll('.resize-handle');

        resizeHandles.forEach(handle => {
            handle.addEventListener('mousedown', (e) => this.startResize(e, handle));
        });

        document.addEventListener('mousemove', (e) => this.resize(e));
        document.addEventListener('mouseup', () => this.stopResize());
    }

    startResize(e, handle) {
        e.preventDefault();
        this.isResizing = true;
        this.currentResizer = handle;
        this.resizeDirection = handle.dataset.direction;

        // Add resizing class to body
        document.body.classList.add(
            this.resizeDirection === 'horizontal' ? 'resizing' : 'resizing-vertical'
        );

        // Store initial positions
        this.startX = e.clientX;
        this.startY = e.clientY;

        // Get the panel being resized
        if (this.resizeDirection === 'horizontal') {
            // Find which resizable section this handle belongs to
            const parentResizable = handle.closest('.resizable');

            // Determine which panel to resize based on the parent's ID
            if (parentResizable.id === 'config-panel') {
                // Left handle: resize config panel (normal direction)
                this.resizingPanel = parentResizable;
                this.resizeMode = 'left';
            } else if (parentResizable.id === 'chat-panel') {
                // Right handle: resize logs panel (need to find it)
                this.resizingPanel = document.getElementById('logs-panel');
                this.resizeMode = 'right';
            }

            this.startWidth = this.resizingPanel.offsetWidth;
        } else {
            // Vertical resize (horizontal handles for row resizing)
            // Determine which panel to resize based on the handle ID
            if (handle.id === 'metrics-resize-handle') {
                // Handle between main content and performance metrics sections
                this.resizingPanel = document.getElementById('metrics-panel');
                this.startHeight = this.resizingPanel.offsetHeight;

                // Also store the main content height for inverse resizing
                const mainContent = document.querySelector('.main-content');
                this.mainContentStartHeight = mainContent.offsetHeight;
            } else if (handle.id === 'chat-metrics-resize-handle') {
                // Handle between chat panel and chat metrics (Last Response Metrics)
                this.resizingPanel = document.getElementById('chat-metrics-panel');
                this.resizeMode = 'chat-metrics';
                this.startHeight = this.resizingPanel.offsetHeight;

                // Also store the chat panel reference for inverse resizing
                this.chatPanel = handle.closest('.chat-section').querySelector('.panel');
                this.chatPanelStartHeight = this.chatPanel.offsetHeight;
            }
        }
    }

    resize(e) {
        if (!this.isResizing) return;

        e.preventDefault();

        if (this.resizeDirection === 'horizontal') {
            // Horizontal resize (columns)
            const deltaX = e.clientX - this.startX;
            let newWidth;

            // For the right panel (logs), we resize in reverse direction
            if (this.resizeMode === 'right') {
                newWidth = this.startWidth - deltaX; // Dragging left makes logs bigger
            } else {
                newWidth = this.startWidth + deltaX; // Dragging right makes config bigger
            }

            // Apply minimum width
            if (newWidth >= 200) {
                this.resizingPanel.style.width = `${newWidth}px`;
                this.resizingPanel.style.flexShrink = '0';

                // Ensure the chat section remains flexible
                const chatSection = document.querySelector('.chat-section');
                chatSection.style.flex = '1';
                chatSection.style.width = 'auto';
                chatSection.style.minWidth = '200px';

                // Force layout recalculation for better responsiveness
                this.resizingPanel.offsetWidth;
            }
        } else {
            // Vertical resize (horizontal handles for row resizing)
            const deltaY = e.clientY - this.startY;

            if (this.resizeMode === 'chat-metrics') {
                // Special handling for chat-metrics resize
                // Dragging up makes metrics bigger (opposite direction)
                const newMetricsHeight = this.startHeight - deltaY;
                const newChatHeight = this.chatPanelStartHeight + deltaY;

                // Apply minimum heights
                if (newMetricsHeight >= 100 && newChatHeight >= 300) {
                    this.resizingPanel.style.height = `${newMetricsHeight}px`;
                    this.chatPanel.style.maxHeight = `${newChatHeight}px`;
                    this.chatPanel.style.minHeight = `${newChatHeight}px`;

                    // Force layout recalculation
                    this.resizingPanel.offsetHeight;
                }
            } else {
                const newHeight = this.startHeight + deltaY; // Dragging down makes panel bigger

                // Apply minimum height
                if (newHeight >= 200) {
                    // Set height on both the outer section and inner panel
                    this.resizingPanel.style.height = `${newHeight}px`;

                    const innerPanel = this.resizingPanel.querySelector('.panel');
                    if (innerPanel) {
                        innerPanel.style.height = `${newHeight}px`;
                    }

                    // Also adjust the main-content height inversely
                    // When metrics gets bigger, main content should shrink
                    if (this.mainContentStartHeight) {
                        const mainContent = document.querySelector('.main-content');
                        const newMainHeight = this.mainContentStartHeight - deltaY;
                        if (newMainHeight >= 500) {
                            mainContent.style.height = `${newMainHeight}px`;
                            mainContent.style.maxHeight = `${newMainHeight}px`;
                        }
                    }

                    // Force layout recalculation
                    this.resizingPanel.offsetHeight;
                }
            }
        }
    }

    stopResize() {
        if (!this.isResizing) return;

        this.isResizing = false;
        this.currentResizer = null;

        // Remove resizing class
        document.body.classList.remove('resizing', 'resizing-vertical');

        // Save layout preferences to localStorage
        this.saveLayoutPreferences();
    }

    saveLayoutPreferences() {
        const layout = {
            configWidth: document.getElementById('config-panel')?.offsetWidth,
            logsWidth: document.getElementById('logs-panel')?.offsetWidth,
            metricsHeight: document.querySelector('.metrics-section .panel')?.offsetHeight
        };

        try {
            localStorage.setItem('vllm-webui-layout', JSON.stringify(layout));
        } catch (e) {
            console.warn('Could not save layout preferences:', e);
        }
    }

    loadLayoutPreferences() {
        try {
            const saved = localStorage.getItem('vllm-webui-layout');
            if (saved) {
                const layout = JSON.parse(saved);

                if (layout.configWidth) {
                    const configPanel = document.getElementById('config-panel');
                    if (configPanel) configPanel.style.width = `${layout.configWidth}px`;
                }

                if (layout.logsWidth) {
                    const logsPanel = document.getElementById('logs-panel');
                    if (logsPanel) logsPanel.style.width = `${layout.logsWidth}px`;
                }


                if (layout.metricsHeight) {
                    const metricsPanel = document.querySelector('.metrics-section .panel');
                    if (metricsPanel) metricsPanel.style.height = `${layout.metricsHeight}px`;
                }
            }
        } catch (e) {
            console.warn('Could not load layout preferences:', e);
        }
    }

    // NOTE: Benchmark command preview and copy methods are injected by GuideLLM module

    // ===============================================
    // COMMUNITY RECIPES
    // ===============================================

    recipesData = null;
    currentRecipeFilter = 'all';

    async openRecipesModal() {
        if (this.elements.recipesModal) {
            this.elements.recipesModal.style.display = 'flex';

            // Load recipes if not already loaded
            if (!this.recipesData) {
                await this.loadRecipes();
            }
            this.renderRecipes();
        }
    }

    closeRecipesModal() {
        if (this.elements.recipesModal) {
            this.elements.recipesModal.style.display = 'none';
        }
    }

    async loadRecipes() {
        try {
            const response = await fetch('/api/recipes');
            if (response.ok) {
                this.recipesData = await response.json();
            } else {
                console.error('Failed to load recipes');
                this.recipesData = { categories: [] };
            }
        } catch (error) {
            console.error('Error loading recipes:', error);
            this.recipesData = { categories: [] };
        }
    }

    renderRecipes() {
        if (!this.elements.recipesCategories || !this.recipesData) return;

        const searchTerm = this.elements.recipesSearchInput?.value?.toLowerCase() || '';
        const categories = this.recipesData.categories || [];

        if (categories.length === 0) {
            this.elements.recipesCategories.innerHTML = `
                <div class="no-recipes-found">
                    <p>No recipes found.</p>
                    <p>Run <code>python recipes/sync_recipes.py</code> to fetch recipes.</p>
                </div>
            `;
            return;
        }

        let html = '';

        for (const category of categories) {
            // Filter recipes based on search and tag
            const filteredRecipes = category.recipes.filter(recipe => {
                // Search matches recipe fields OR category name/id
                const matchesSearch = !searchTerm ||
                    recipe.name.toLowerCase().includes(searchTerm) ||
                    recipe.model_id.toLowerCase().includes(searchTerm) ||
                    recipe.description.toLowerCase().includes(searchTerm) ||
                    category.name.toLowerCase().includes(searchTerm) ||
                    category.id.toLowerCase().includes(searchTerm);

                const matchesTag = this.currentRecipeFilter === 'all' ||
                    (recipe.tags && recipe.tags.includes(this.currentRecipeFilter));

                return matchesSearch && matchesTag;
            });

            // Skip empty categories
            if (filteredRecipes.length === 0) continue;

            html += `
                <div class="recipe-category" data-category="${category.id}">
                    <div class="category-header" onclick="window.vllmUI.toggleCategoryExpand('${category.id}')">
                        <div class="category-info">
                            <div>
                                <span class="category-name">${category.name}</span>
                                <p class="category-description">${category.description}</p>
                            </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <span class="category-count">${filteredRecipes.length} recipes</span>
                            <span class="category-expand" id="expand-${category.id}">▼</span>
                        </div>
                    </div>
                    <div class="category-recipes" id="recipes-${category.id}">
                        ${filteredRecipes.map(recipe => this.renderRecipeCard(recipe, category)).join('')}
                    </div>
                </div>
            `;
        }

        if (!html) {
            html = `<div class="no-recipes-found">No recipes match your search.</div>`;
        }

        this.elements.recipesCategories.innerHTML = html;
    }

    renderRecipeCard(recipe, category) {
        const tags = (recipe.tags || []).map(tag =>
            `<span class="recipe-tag ${tag}">${tag}</span>`
        ).join('');

        const requiresToken = recipe.requires_hf_token ?
            '<span class="recipe-tag" style="background: rgba(245, 158, 11, 0.2); color: #f59e0b;">requires HF token</span>' : '';

        // Build config display
        const config = recipe.config || {};
        const configItems = [];
        if (config.tensor_parallel_size) configItems.push(`<span class="config-item"><span class="config-label">TP:</span> ${config.tensor_parallel_size}</span>`);
        if (config.pipeline_parallel_size) configItems.push(`<span class="config-item"><span class="config-label">PP:</span> ${config.pipeline_parallel_size}</span>`);
        if (config.data_parallel_size) configItems.push(`<span class="config-item"><span class="config-label">DP:</span> ${config.data_parallel_size}</span>`);
        if (config.max_model_len) configItems.push(`<span class="config-item"><span class="config-label">Max Len:</span> ${config.max_model_len.toLocaleString()}</span>`);
        if (config.dtype) configItems.push(`<span class="config-item"><span class="config-label">Dtype:</span> ${config.dtype}</span>`);
        if (config.gpu_memory_utilization) configItems.push(`<span class="config-item"><span class="config-label">GPU Mem:</span> ${Math.round(config.gpu_memory_utilization * 100)}%</span>`);
        if (config.trust_remote_code) configItems.push(`<span class="config-item config-flag">trust-remote-code</span>`);
        if (config.enable_expert_parallel) configItems.push(`<span class="config-item config-flag">expert-parallel</span>`);

        const configHtml = configItems.length > 0 ? `
            <div class="recipe-config">
                <div class="config-header">
                    <span class="config-icon">⚙️</span>
                    <span>vLLM Config</span>
                </div>
                <div class="config-grid">
                    ${configItems.join('')}
                </div>
            </div>
        ` : '';

        return `
            <div class="recipe-card" data-recipe-id="${recipe.id}" data-category-id="${category.id}">
                <div class="recipe-header">
                    <div>
                        <div class="recipe-title">${recipe.name}</div>
                        <div class="recipe-model-id">${recipe.model_id}</div>
                    </div>
                    <button class="btn-edit-recipe" onclick="window.vllmUI.openEditRecipeModal('${category.id}', '${recipe.id}')" title="Edit Recipe">
                        ✏️
                    </button>
                </div>
                <p class="recipe-description">${recipe.description}</p>
                ${configHtml}
                <div class="recipe-hardware">
                    <div class="hardware-item">
                        <span class="label">Recommended:</span>
                        <span class="value">${recipe.hardware?.recommended || 'See docs'}</span>
                    </div>
                    <div class="hardware-item">
                        <span class="label">Minimum:</span>
                        <span class="value">${recipe.hardware?.minimum || 'See docs'}</span>
                    </div>
                </div>
                <div class="recipe-tags">${tags}${requiresToken}</div>
                <div class="recipe-actions">
                    <a href="${recipe.docs_url}" target="_blank" class="btn btn-view-docs">
                        📖 Docs
                    </a>
                    <button class="btn btn-load-recipe" onclick="window.vllmUI.loadRecipeConfig('${category.id}', '${recipe.id}')">
                        ⚡ Load Config
                    </button>
                </div>
            </div>
        `;
    }

    toggleCategoryExpand(categoryId) {
        const recipesDiv = document.getElementById(`recipes-${categoryId}`);
        const expandIcon = document.getElementById(`expand-${categoryId}`);

        if (recipesDiv && expandIcon) {
            recipesDiv.classList.toggle('expanded');
            expandIcon.classList.toggle('expanded');
        }
    }

    filterRecipes() {
        this.renderRecipes();
    }

    filterRecipesByTag(tag) {
        this.currentRecipeFilter = tag;

        // Update active state on buttons
        const buttons = this.elements.recipesFilterTags?.querySelectorAll('.tag-btn');
        buttons?.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tag === tag);
        });

        this.renderRecipes();
    }

    async loadRecipeConfig(categoryId, recipeId) {
        try {
            const response = await fetch(`/api/recipes/${categoryId}/${recipeId}`);
            if (!response.ok) {
                throw new Error('Failed to load recipe');
            }

            const data = await response.json();
            const recipe = data.recipe;
            const config = recipe.config || {};

            // Set model
            if (recipe.model_id) {
                this.elements.customModel.value = recipe.model_id;
                // Clear the select dropdown
                this.elements.modelSelect.value = '';
            }

            // Set CPU/GPU mode
            if (config.use_cpu) {
                this.elements.modeCpu.checked = true;
                this.toggleComputeMode();
            } else {
                this.elements.modeGpu.checked = true;
                this.toggleComputeMode();
            }

            // Set tensor parallel size
            if (config.tensor_parallel_size && this.elements.tensorParallel) {
                this.elements.tensorParallel.value = config.tensor_parallel_size;
            }

            // Set GPU memory utilization
            if (config.gpu_memory_utilization && this.elements.gpuMemory) {
                this.elements.gpuMemory.value = config.gpu_memory_utilization;
            }

            // Set max model length
            if (config.max_model_len && this.elements.maxModelLen) {
                this.elements.maxModelLen.value = config.max_model_len;
            }

            // Set dtype
            if (config.dtype && this.elements.dtype) {
                this.elements.dtype.value = config.dtype;
            }

            // Set trust remote code
            if (config.trust_remote_code !== undefined && this.elements.trustRemoteCode) {
                this.elements.trustRemoteCode.checked = config.trust_remote_code;
            }

            // Set CPU-specific settings
            if (config.cpu_kvcache_space && this.elements.cpuKvcache) {
                this.elements.cpuKvcache.value = config.cpu_kvcache_space;
            }

            // Update command preview
            this.updateCommandPreview();

            // Close modal
            this.closeRecipesModal();

            // Show success toast
            this.showRecipeToast(`✅ Loaded: ${recipe.name}`);

            // Highlight if HF token is required
            if (recipe.requires_hf_token && this.elements.hfToken) {
                this.elements.hfToken.focus();
                this.showNotification('This model requires a HuggingFace token', 'warning');
            }

        } catch (error) {
            console.error('Error loading recipe config:', error);
            this.showNotification('Failed to load recipe configuration', 'error');
        }
    }

    showRecipeToast(message) {
        // Remove existing toast
        const existingToast = document.querySelector('.recipe-toast');
        if (existingToast) {
            existingToast.remove();
        }

        const toast = document.createElement('div');
        toast.className = 'recipe-toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        // Auto-remove after 3 seconds
        setTimeout(() => {
            toast.classList.add('hide');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    async syncRecipesFromGitHub() {
        const syncBtn = this.elements.syncRecipesBtn;
        if (!syncBtn) return;

        // Get GitHub token if provided
        const githubToken = this.elements.githubTokenInput?.value?.trim() || '';

        // Show loading state
        const originalText = syncBtn.innerHTML;
        syncBtn.innerHTML = '⏳ Syncing';
        syncBtn.disabled = true;

        // Show loading in categories area
        if (this.elements.recipesCategories) {
            this.elements.recipesCategories.innerHTML = `
                <div class="recipes-loading">
                    <div style="font-size: 2rem; margin-bottom: 16px;">🔄</div>
                    <p>Fetching recipes from GitHub...</p>
                    <p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 8px;">
                        This may take a moment...
                    </p>
                </div>
            `;
        }

        try {
            const response = await fetch('/api/recipes/sync', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    github_token: githubToken || null
                })
            });

            const data = await response.json();

            if (data.success) {
                // Clear cached data to force reload
                this.recipesData = null;

                // Reload recipes
                await this.loadRecipes();
                this.renderRecipes();

                // Show success message
                const catalogInfo = data.catalog || {};
                this.showRecipeToast(
                    `✅ Synced! ${catalogInfo.categories || 0} categories, ${catalogInfo.total_recipes || 0} recipes`
                );

                console.log('Recipes sync result:', data);
            } else {
                // Show error
                this.showNotification(
                    `Sync failed: ${data.message || data.error || 'Unknown error'}`,
                    'error'
                );

                // Restore previous recipes display
                if (this.recipesData) {
                    this.renderRecipes();
                } else {
                    this.elements.recipesCategories.innerHTML = `
                        <div class="no-recipes-found">
                            <p>❌ Sync failed: ${data.message || data.error}</p>
                            <p style="margin-top: 12px; font-size: 0.9rem;">
                                Try running manually: <code>python recipes/sync_recipes.py</code>
                            </p>
                        </div>
                    `;
                }
            }
        } catch (error) {
            console.error('Error syncing recipes:', error);
            this.showNotification('Failed to sync recipes from GitHub', 'error');

            // Restore previous recipes display
            if (this.recipesData) {
                this.renderRecipes();
            } else {
                this.elements.recipesCategories.innerHTML = `
                    <div class="no-recipes-found">
                        <p>❌ Connection error</p>
                        <p style="margin-top: 12px; font-size: 0.9rem;">
                            Check your network connection and try again.
                        </p>
                    </div>
                `;
            }
        } finally {
            // Restore button state
            syncBtn.innerHTML = originalText;
            syncBtn.disabled = false;
        }
    }

    // ===============================================
    // RECIPE EDIT/ADD FUNCTIONALITY
    // ===============================================

    editingRecipe = null;
    editingCategory = null;

    openEditRecipeModal(categoryId, recipeId) {
        // Find the recipe in the data
        const category = this.recipesData?.categories?.find(c => c.id === categoryId);
        const recipe = category?.recipes?.find(r => r.id === recipeId);

        if (!recipe) {
            this.showNotification('Recipe not found', 'error');
            return;
        }

        this.editingRecipe = recipe;
        this.editingCategory = category;

        // Show the edit modal
        const modal = document.getElementById('edit-recipe-modal');
        if (!modal) {
            this.createEditRecipeModal();
        }

        this.populateEditForm(recipe, category);
        document.getElementById('edit-recipe-modal').style.display = 'flex';
    }

    openAddRecipeModal() {
        this.editingRecipe = null;
        this.editingCategory = null;

        // Show the edit modal in "add" mode
        const modal = document.getElementById('edit-recipe-modal');
        if (!modal) {
            this.createEditRecipeModal();
        }

        // Clear form and set to add mode
        this.populateEditForm(null, null);
        document.getElementById('edit-recipe-modal').style.display = 'flex';
    }

    closeEditRecipeModal() {
        const modal = document.getElementById('edit-recipe-modal');
        if (modal) {
            modal.style.display = 'none';
        }
        this.editingRecipe = null;
        this.editingCategory = null;
    }

    createEditRecipeModal() {
        const modalHtml = `
            <div id="edit-recipe-modal" class="modal" style="display: none;">
                <div class="modal-overlay" onclick="window.vllmUI.closeEditRecipeModal()"></div>
                <div class="modal-content edit-recipe-modal-content">
                    <div class="modal-header">
                        <h2 id="edit-recipe-title">✏️ Edit Recipe</h2>
                        <button class="modal-close" onclick="window.vllmUI.closeEditRecipeModal()">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form id="edit-recipe-form" onsubmit="window.vllmUI.saveRecipe(event)">
                            <!-- Basic Info -->
                            <div class="edit-form-section">
                                <h3>📋 Basic Information</h3>
                                <div class="form-row">
                                    <div class="form-group">
                                        <label for="edit-recipe-name">Recipe Name *</label>
                                        <input type="text" id="edit-recipe-name" class="form-control" required placeholder="e.g., DeepSeek-R1">
                                    </div>
                                    <div class="form-group">
                                        <label for="edit-recipe-category">Category *</label>
                                        <select id="edit-recipe-category" class="form-control" required>
                                            <option value="">Select category...</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="form-group">
                                    <label for="edit-recipe-model-id">Model ID (HuggingFace) *</label>
                                    <input type="text" id="edit-recipe-model-id" class="form-control" required placeholder="e.g., deepseek-ai/DeepSeek-R1">
                                </div>
                                <div class="form-group">
                                    <label for="edit-recipe-description">Description</label>
                                    <textarea id="edit-recipe-description" class="form-control" rows="2" placeholder="Brief description of the model..."></textarea>
                                </div>
                            </div>
                            
                            <!-- vLLM Config -->
                            <div class="edit-form-section">
                                <h3>⚙️ vLLM Configuration</h3>
                                <div class="form-row">
                                    <div class="form-group">
                                        <label for="edit-recipe-tp">Tensor Parallel Size</label>
                                        <input type="number" id="edit-recipe-tp" class="form-control" min="1" max="16" value="1">
                                    </div>
                                    <div class="form-group">
                                        <label for="edit-recipe-pp">Pipeline Parallel Size</label>
                                        <input type="number" id="edit-recipe-pp" class="form-control" min="1" max="8" value="1">
                                    </div>
                                    <div class="form-group">
                                        <label for="edit-recipe-dp">Data Parallel Size</label>
                                        <input type="number" id="edit-recipe-dp" class="form-control" min="1" max="8" value="1">
                                    </div>
                                </div>
                                <div class="form-row">
                                    <div class="form-group">
                                        <label for="edit-recipe-max-len">Max Model Length</label>
                                        <input type="number" id="edit-recipe-max-len" class="form-control" min="256" placeholder="e.g., 32768">
                                    </div>
                                    <div class="form-group">
                                        <label for="edit-recipe-dtype">Data Type</label>
                                        <select id="edit-recipe-dtype" class="form-control">
                                            <option value="">Auto</option>
                                            <option value="auto">auto</option>
                                            <option value="float16">float16</option>
                                            <option value="bfloat16">bfloat16</option>
                                            <option value="float32">float32</option>
                                        </select>
                                    </div>
                                    <div class="form-group">
                                        <label for="edit-recipe-gpu-mem">GPU Memory %</label>
                                        <input type="number" id="edit-recipe-gpu-mem" class="form-control" min="10" max="100" step="5" placeholder="e.g., 90">
                                    </div>
                                </div>
                                <div class="form-row checkbox-row">
                                    <label class="checkbox-label">
                                        <input type="checkbox" id="edit-recipe-trust-remote">
                                        <span>Trust Remote Code</span>
                                    </label>
                                    <label class="checkbox-label">
                                        <input type="checkbox" id="edit-recipe-expert-parallel">
                                        <span>Enable Expert Parallel (MoE)</span>
                                    </label>
                                    <label class="checkbox-label">
                                        <input type="checkbox" id="edit-recipe-hf-token">
                                        <span>Requires HF Token</span>
                                    </label>
                                </div>
                            </div>
                            
                            <!-- Hardware -->
                            <div class="edit-form-section">
                                <h3>🖥️ Hardware Requirements</h3>
                                <div class="form-row">
                                    <div class="form-group">
                                        <label for="edit-recipe-hw-rec">Recommended</label>
                                        <input type="text" id="edit-recipe-hw-rec" class="form-control" placeholder="e.g., 8x H100 80GB">
                                    </div>
                                    <div class="form-group">
                                        <label for="edit-recipe-hw-min">Minimum</label>
                                        <input type="text" id="edit-recipe-hw-min" class="form-control" placeholder="e.g., 8x A100 80GB">
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Tags -->
                            <div class="edit-form-section">
                                <h3>🏷️ Tags</h3>
                                <div class="form-group">
                                    <label for="edit-recipe-tags">Tags (comma-separated)</label>
                                    <input type="text" id="edit-recipe-tags" class="form-control" placeholder="e.g., reasoning, multi-gpu, large">
                                    <small class="form-help">Common tags: single-gpu, multi-gpu, cpu, vision, reasoning, coding, chat, moe, fp8</small>
                                </div>
                                <div class="form-group">
                                    <label for="edit-recipe-docs-url">Documentation URL</label>
                                    <input type="url" id="edit-recipe-docs-url" class="form-control" placeholder="https://github.com/...">
                                </div>
                            </div>
                            
                            <!-- Actions -->
                            <div class="edit-form-actions">
                                <button type="button" class="btn btn-secondary" onclick="window.vllmUI.closeEditRecipeModal()">Cancel</button>
                                <button type="button" class="btn btn-danger" id="delete-recipe-btn" onclick="window.vllmUI.deleteRecipe()" style="display: none;">🗑️ Delete</button>
                                <button type="submit" class="btn btn-primary">💾 Save Recipe</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    populateEditForm(recipe, category) {
        const isEdit = !!recipe;

        // Update title
        document.getElementById('edit-recipe-title').textContent = isEdit ? '✏️ Edit Recipe' : '➕ Add New Recipe';

        // Show/hide delete button
        const deleteBtn = document.getElementById('delete-recipe-btn');
        if (deleteBtn) {
            deleteBtn.style.display = isEdit ? 'inline-block' : 'none';
        }

        // Populate category dropdown
        const categorySelect = document.getElementById('edit-recipe-category');
        categorySelect.innerHTML = '<option value="">Select category...</option>';
        if (this.recipesData?.categories) {
            for (const cat of this.recipesData.categories) {
                const option = document.createElement('option');
                option.value = cat.id;
                option.textContent = cat.name;
                if (isEdit && category && cat.id === category.id) {
                    option.selected = true;
                }
                categorySelect.appendChild(option);
            }
            // Add option to create new category
            const newOption = document.createElement('option');
            newOption.value = '__new__';
            newOption.textContent = '➕ Create New Category...';
            categorySelect.appendChild(newOption);
        }

        // Populate form fields
        document.getElementById('edit-recipe-name').value = recipe?.name || '';
        document.getElementById('edit-recipe-model-id').value = recipe?.model_id || '';
        document.getElementById('edit-recipe-description').value = recipe?.description || '';

        // Config
        const config = recipe?.config || {};
        document.getElementById('edit-recipe-tp').value = config.tensor_parallel_size || 1;
        document.getElementById('edit-recipe-pp').value = config.pipeline_parallel_size || 1;
        document.getElementById('edit-recipe-dp').value = config.data_parallel_size || 1;
        document.getElementById('edit-recipe-max-len').value = config.max_model_len || '';
        document.getElementById('edit-recipe-dtype').value = config.dtype || '';
        document.getElementById('edit-recipe-gpu-mem').value = config.gpu_memory_utilization ? Math.round(config.gpu_memory_utilization * 100) : '';
        document.getElementById('edit-recipe-trust-remote').checked = config.trust_remote_code || false;
        document.getElementById('edit-recipe-expert-parallel').checked = config.enable_expert_parallel || false;
        document.getElementById('edit-recipe-hf-token').checked = recipe?.requires_hf_token || false;

        // Hardware
        document.getElementById('edit-recipe-hw-rec').value = recipe?.hardware?.recommended || '';
        document.getElementById('edit-recipe-hw-min').value = recipe?.hardware?.minimum || '';

        // Tags
        document.getElementById('edit-recipe-tags').value = (recipe?.tags || []).join(', ');
        document.getElementById('edit-recipe-docs-url').value = recipe?.docs_url || '';
    }

    async saveRecipe(event) {
        event.preventDefault();

        // Gather form data
        let categoryId = document.getElementById('edit-recipe-category').value;

        // Handle new category creation
        if (categoryId === '__new__') {
            const newCatName = prompt('Enter new category name:');
            if (!newCatName) return;
            categoryId = newCatName.toLowerCase().replace(/[^a-z0-9]/g, '');
        }

        if (!categoryId) {
            this.showNotification('Please select a category', 'error');
            return;
        }

        const name = document.getElementById('edit-recipe-name').value.trim();
        const modelId = document.getElementById('edit-recipe-model-id').value.trim();

        if (!name || !modelId) {
            this.showNotification('Name and Model ID are required', 'error');
            return;
        }

        // Build recipe object
        const recipeData = {
            id: this.editingRecipe?.id || name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
            name: name,
            model_id: modelId,
            description: document.getElementById('edit-recipe-description').value.trim(),
            docs_url: document.getElementById('edit-recipe-docs-url').value.trim(),
            requires_hf_token: document.getElementById('edit-recipe-hf-token').checked,
            hardware: {
                recommended: document.getElementById('edit-recipe-hw-rec').value.trim() || 'See documentation',
                minimum: document.getElementById('edit-recipe-hw-min').value.trim() || 'See documentation'
            },
            config: {},
            tags: document.getElementById('edit-recipe-tags').value
                .split(',')
                .map(t => t.trim().toLowerCase())
                .filter(t => t)
        };

        // Add config values only if set
        const tp = parseInt(document.getElementById('edit-recipe-tp').value);
        if (tp && tp > 1) recipeData.config.tensor_parallel_size = tp;

        const pp = parseInt(document.getElementById('edit-recipe-pp').value);
        if (pp && pp > 1) recipeData.config.pipeline_parallel_size = pp;

        const dp = parseInt(document.getElementById('edit-recipe-dp').value);
        if (dp && dp > 1) recipeData.config.data_parallel_size = dp;

        const maxLen = parseInt(document.getElementById('edit-recipe-max-len').value);
        if (maxLen) recipeData.config.max_model_len = maxLen;

        const dtype = document.getElementById('edit-recipe-dtype').value;
        if (dtype) recipeData.config.dtype = dtype;

        const gpuMem = parseInt(document.getElementById('edit-recipe-gpu-mem').value);
        if (gpuMem) recipeData.config.gpu_memory_utilization = gpuMem / 100;

        if (document.getElementById('edit-recipe-trust-remote').checked) {
            recipeData.config.trust_remote_code = true;
        }

        if (document.getElementById('edit-recipe-expert-parallel').checked) {
            recipeData.config.enable_expert_parallel = true;
        }

        // Determine if creating new category
        const existingCategory = this.recipesData?.categories?.find(c => c.id === categoryId);
        const newCategoryName = document.getElementById('edit-recipe-category').value === '__new__'
            ? prompt('Enter new category name:')
            : null;

        try {
            const response = await fetch('/api/recipes/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    category_id: categoryId,
                    recipe: recipeData,
                    is_new: !this.editingRecipe,
                    original_recipe_id: this.editingRecipe?.id,
                    original_category_id: this.editingCategory?.id,
                    new_category_name: newCategoryName
                })
            });

            const data = await response.json();

            if (data.success) {
                // Reload recipes
                this.recipesData = null;
                await this.loadRecipes();
                this.renderRecipes();

                this.closeEditRecipeModal();
                this.showRecipeToast(`✅ Recipe ${this.editingRecipe ? 'updated' : 'added'}: ${name}`);
            } else {
                this.showNotification(data.error || 'Failed to save recipe', 'error');
            }
        } catch (error) {
            console.error('Error saving recipe:', error);
            this.showNotification('Failed to save recipe', 'error');
        }
    }

    async deleteRecipe() {
        if (!this.editingRecipe || !this.editingCategory) {
            return;
        }

        const confirmed = await this.showConfirm({
            title: 'Delete Recipe',
            message: `Are you sure you want to delete "${this.editingRecipe.name}"? This action cannot be undone.`,
            confirmText: 'Delete',
            cancelText: 'Cancel',
            icon: '🗑️',
            type: 'danger'
        });
        if (!confirmed) return;

        try {
            const response = await fetch('/api/recipes/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    category_id: this.editingCategory.id,
                    recipe_id: this.editingRecipe.id
                })
            });

            const data = await response.json();

            if (data.success) {
                // Reload recipes
                this.recipesData = null;
                await this.loadRecipes();
                this.renderRecipes();

                this.closeEditRecipeModal();
                this.showRecipeToast(`🗑️ Deleted: ${this.editingRecipe.name}`);
            } else {
                this.showNotification(data.error || 'Failed to delete recipe', 'error');
            }
        } catch (error) {
            console.error('Error deleting recipe:', error);
            this.showNotification('Failed to delete recipe', 'error');
        }
    }

    // ==========================================
    // Tool Calling / Function Calling Methods
    // ==========================================

    openToolEditor(toolIndex = -1) {
        this.editingToolIndex = toolIndex;

        if (toolIndex >= 0 && toolIndex < this.tools.length) {
            // Editing existing tool
            const tool = this.tools[toolIndex];
            this.elements.toolEditorTitle.textContent = 'Edit Tool';
            this.elements.toolName.value = tool.function.name;
            this.elements.toolDescription.value = tool.function.description || '';

            // Convert JSON Schema parameters to form-based params
            this.currentParams = this.jsonSchemaToParams(tool.function.parameters);
        } else {
            // New tool
            this.elements.toolEditorTitle.textContent = 'Add New Tool';
            this.elements.toolName.value = '';
            this.elements.toolDescription.value = '';
            this.currentParams = [];
        }

        this.renderParamsList();
        this.elements.toolEditorModal.style.display = 'flex';
    }

    // Convert JSON Schema to form-based parameters array
    jsonSchemaToParams(schema) {
        if (!schema || !schema.properties) return [];

        const params = [];
        const required = schema.required || [];

        for (const [name, prop] of Object.entries(schema.properties)) {
            params.push({
                name: name,
                type: prop.type || 'string',
                description: prop.description || '',
                required: required.includes(name),
                enum: prop.enum ? prop.enum.join(', ') : ''
            });
        }

        return params;
    }

    // Convert form-based parameters array to JSON Schema
    paramsToJsonSchema() {
        if (this.currentParams.length === 0) {
            return { type: 'object', properties: {} };
        }

        const properties = {};
        const required = [];

        for (const param of this.currentParams) {
            if (!param.name) continue;

            const prop = { type: param.type };
            if (param.description) prop.description = param.description;
            if (param.enum) {
                prop.enum = param.enum.split(',').map(s => s.trim()).filter(s => s);
            }

            properties[param.name] = prop;
            if (param.required) required.push(param.name);
        }

        const schema = { type: 'object', properties };
        if (required.length > 0) schema.required = required;

        return schema;
    }

    addParameter() {
        this.currentParams.push({
            name: '',
            type: 'string',
            description: '',
            required: false,
            enum: ''
        });
        this.renderParamsList();

        // Focus the new parameter's name input
        setTimeout(() => {
            const items = this.elements.paramsList.querySelectorAll('.param-item');
            const lastItem = items[items.length - 1];
            if (lastItem) {
                const nameInput = lastItem.querySelector('.param-name');
                if (nameInput) nameInput.focus();
            }
        }, 50);
    }

    removeParameter(index) {
        this.currentParams.splice(index, 1);
        this.renderParamsList();
    }

    renderParamsList() {
        const container = this.elements.paramsList;
        if (!container) return;

        // Update count
        if (this.elements.paramCount) {
            this.elements.paramCount.textContent = `(${this.currentParams.length})`;
        }

        if (this.currentParams.length === 0) {
            container.innerHTML = `
                <div class="params-empty">
                    No parameters defined. Click "Add Parameter" to add one.
                </div>
            `;
            return;
        }

        container.innerHTML = this.currentParams.map((param, index) => `
            <div class="param-item" data-param-index="${index}">
                <div class="param-item-header">
                    <div class="param-required-toggle">
                        <input type="checkbox" class="param-required" ${param.required ? 'checked' : ''} title="Required parameter">
                        <span class="required-label">Required</span>
                    </div>
                    <button type="button" class="param-delete-btn" title="Remove parameter">✕</button>
                </div>
                <div class="param-row">
                    <div class="param-field param-name-field">
                        <label>Name</label>
                        <input type="text" class="form-control param-name" placeholder="param_name" value="${this.escapeHtml(param.name)}" spellcheck="false">
                    </div>
                    <div class="param-field param-type-field">
                        <label>Type</label>
                        <select class="form-control param-type">
                            <option value="string" ${param.type === 'string' ? 'selected' : ''}>String</option>
                            <option value="number" ${param.type === 'number' ? 'selected' : ''}>Number</option>
                            <option value="integer" ${param.type === 'integer' ? 'selected' : ''}>Integer</option>
                            <option value="boolean" ${param.type === 'boolean' ? 'selected' : ''}>Boolean</option>
                            <option value="array" ${param.type === 'array' ? 'selected' : ''}>Array</option>
                        </select>
                    </div>
                </div>
                <div class="param-field">
                    <label>Description</label>
                    <input type="text" class="form-control param-description" placeholder="What is this parameter for?" value="${this.escapeHtml(param.description)}">
                </div>
                <div class="param-field param-enum-field" style="${param.type === 'string' ? '' : 'display: none;'}">
                    <label>Allowed Values <span class="optional">(comma-separated)</span></label>
                    <input type="text" class="form-control param-enum" placeholder="e.g., celsius, fahrenheit" value="${this.escapeHtml(param.enum || '')}">
                </div>
            </div>
        `).join('');

        // Attach event listeners to parameter items
        this.attachParamListeners();
    }

    escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    attachParamListeners() {
        const container = this.elements.paramsList;
        if (!container) return;

        container.querySelectorAll('.param-item').forEach((item, index) => {
            // Delete button
            const deleteBtn = item.querySelector('.param-delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => this.removeParameter(index));
            }

            // Required checkbox
            const requiredCheckbox = item.querySelector('.param-required');
            if (requiredCheckbox) {
                requiredCheckbox.addEventListener('change', () => {
                    this.currentParams[index].required = requiredCheckbox.checked;
                });
            }

            // Name input
            const nameInput = item.querySelector('.param-name');
            if (nameInput) {
                nameInput.addEventListener('input', () => {
                    this.currentParams[index].name = nameInput.value;
                });
            }

            // Type select
            const typeSelect = item.querySelector('.param-type');
            if (typeSelect) {
                typeSelect.addEventListener('change', () => {
                    this.currentParams[index].type = typeSelect.value;
                    // Show/hide enum field based on type
                    const enumField = item.querySelector('.param-enum-field');
                    if (enumField) {
                        enumField.style.display = typeSelect.value === 'string' ? '' : 'none';
                    }
                });
            }

            // Description input
            const descInput = item.querySelector('.param-description');
            if (descInput) {
                descInput.addEventListener('input', () => {
                    this.currentParams[index].description = descInput.value;
                });
            }

            // Enum input
            const enumInput = item.querySelector('.param-enum');
            if (enumInput) {
                enumInput.addEventListener('input', () => {
                    this.currentParams[index].enum = enumInput.value;
                });
            }
        });
    }

    closeToolEditor() {
        this.elements.toolEditorModal.style.display = 'none';
        this.editingToolIndex = -1;
    }

    saveTool() {
        const name = this.elements.toolName.value.trim();
        const description = this.elements.toolDescription.value.trim();

        // Validation
        if (!name) {
            this.showNotification('Function name is required', 'error');
            return;
        }

        // Validate function name format
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
            this.showNotification('Invalid function name. Use only letters, numbers, and underscores.', 'error');
            return;
        }

        if (!description) {
            this.showNotification('Description is required', 'error');
            return;
        }

        // Validate parameter names
        for (const param of this.currentParams) {
            if (param.name && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(param.name)) {
                this.showNotification(`Invalid parameter name "${param.name}". Use only letters, numbers, and underscores.`, 'error');
                return;
            }
        }

        // Build parameters from form
        const parameters = this.paramsToJsonSchema();

        const tool = {
            type: 'function',
            function: {
                name: name,
                description: description,
                parameters: parameters
            }
        };

        if (this.editingToolIndex >= 0) {
            // Update existing
            this.tools[this.editingToolIndex] = tool;
            this.showNotification(`Tool "${name}" updated`, 'success');
        } else {
            // Check for duplicate name
            if (this.tools.some(t => t.function.name === name)) {
                this.showNotification(`Tool "${name}" already exists`, 'error');
                return;
            }
            // Add new
            this.tools.push(tool);
            this.showNotification(`Tool "${name}" added`, 'success');
        }

        this.closeToolEditor();
        this.renderToolsList();
        this.updateToolsCountBadge();
    }

    deleteTool(index) {
        if (index >= 0 && index < this.tools.length) {
            const name = this.tools[index].function.name;
            this.tools.splice(index, 1);
            this.renderToolsList();
            this.updateToolsCountBadge();
            this.showNotification(`Tool "${name}" removed`, 'info');
        }
    }

    async clearAllTools() {
        if (this.tools.length === 0) return;

        const confirmed = await this.showConfirm({
            title: 'Clear All Tools',
            message: `Remove all ${this.tools.length} tool(s)? This action cannot be undone.`,
            confirmText: 'Clear All',
            cancelText: 'Cancel',
            icon: '🗑️',
            type: 'danger'
        });

        if (confirmed) {
            this.tools = [];
            this.renderToolsList();
            this.updateToolsCountBadge();
            this.showNotification('All tools cleared', 'info');
        }
    }

    renderToolsList() {
        const container = this.elements.toolsList;
        if (!container) return;

        if (this.tools.length === 0) {
            container.innerHTML = `
                <div class="tools-empty-state">
                    <span>No tools defined. Click "Add Tool" or load a preset to get started.</span>
                </div>
            `;
            return;
        }

        container.innerHTML = this.tools.map((tool, index) => {
            const func = tool.function;
            const params = func.parameters?.properties || {};
            const paramNames = Object.keys(params);
            const requiredParams = func.parameters?.required || [];

            return `
                <div class="tool-item" data-index="${index}">
                    <div class="tool-item-info">
                        <div class="tool-item-name">${this.escapeHtml(func.name)}</div>
                        <div class="tool-item-description">${this.escapeHtml(func.description || 'No description')}</div>
                        ${paramNames.length > 0 ? `
                            <div class="tool-item-params">
                                ${paramNames.map(p => `<span>${requiredParams.includes(p) ? '•' : '○'} ${this.escapeHtml(p)}</span>`).join('')}
                            </div>
                        ` : ''}
                    </div>
                    <div class="tool-item-actions">
                        <button class="btn btn-secondary btn-xs tool-edit-btn" onclick="window.vllmUI.openToolEditor(${index})">Edit</button>
                        <button class="btn btn-danger btn-xs tool-delete-btn" onclick="window.vllmUI.deleteTool(${index})">×</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateToolsCountBadge() {
        // Update old badge (if still present)
        const badge = this.elements.toolsCountBadge;
        if (badge) {
            if (this.tools.length > 0) {
                badge.textContent = `${this.tools.length} tool${this.tools.length > 1 ? 's' : ''}`;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }

        // Update new toolbar badge
        this.updateToolsBadge();
        // Update modified indicators
        this.updateModifiedIndicators();
    }

    async loadToolPreset(presetName) {
        try {
            const response = await fetch('/api/tools/presets');
            const data = await response.json();

            if (data.presets && data.presets[presetName]) {
                const preset = data.presets[presetName];

                // Add tools from preset (avoid duplicates)
                let added = 0;
                for (const tool of preset.tools) {
                    const exists = this.tools.some(t => t.function.name === tool.function.name);
                    if (!exists) {
                        this.tools.push(tool);
                        added++;
                    }
                }

                this.renderToolsList();
                this.updateToolsCountBadge();

                if (added > 0) {
                    this.showNotification(`Loaded ${preset.name}: ${added} tool${added > 1 ? 's' : ''} added`, 'success');

                    // Auto-set tool choice to "auto" if not already set
                    if (this.elements.toolChoice.value === '') {
                        this.elements.toolChoice.value = 'auto';
                    }
                } else {
                    this.showNotification(`${preset.name}: All tools already exist`, 'info');
                }
            }
        } catch (error) {
            console.error('Error loading preset:', error);
            this.showNotification('Failed to load preset', 'error');
        }
    }

    getToolsForRequest() {
        // Return CUSTOM tools array for API request, or null if empty/disabled
        // MCP tools are handled separately via getMCPToolsForRequest()
        // This method is for the Tool Calling panel only
        const toolChoice = this.elements.toolChoice?.value || '';

        // Debug logging
        console.log('=== getToolsForRequest (Custom Tools) ===');
        console.log('toolChoice dropdown value:', JSON.stringify(toolChoice));
        console.log('this.tools.length:', this.tools.length);
        console.log('this.tools:', JSON.stringify(this.tools.map(t => t.function?.name)));

        // If tool choice is empty (None), don't send tools
        if (toolChoice === '') {
            console.log('Result: tool_choice is empty, returning null');
            return { tools: null, tool_choice: null, parallel_tool_calls: null };
        }

        // If tool choice is set but no tools defined, warn the user
        if (this.tools.length === 0) {
            console.warn(`Tool choice "${toolChoice}" selected but no tools defined - ignoring tool settings`);
            this.showNotification('⚠️ Tool choice is set to "Auto" but no tools are defined. Add tools using the + button or presets.', 'warning', 5000);
            return { tools: null, tool_choice: null, parallel_tool_calls: null };
        }

        const result = {
            tools: this.tools,
            tool_choice: toolChoice,
            parallel_tool_calls: this.elements.parallelToolCalls?.checked || null
        };
        console.log('Result: returning tools config:', result.tool_choice, 'with', result.tools.length, 'tools');

        return result;
    }

    /**
     * Detect if text contains malformed tool call patterns
     * This catches cases where vLLM's tool parser failed but still returned content
     */
    detectMalformedToolCall(text) {
        if (!text) return false;

        // Common patterns that indicate a failed tool call parse:
        // 1. Hermes format: <tool_call>...</tool_call>
        // 2. Raw JSON with function name/arguments
        // 3. Truncated JSON (ends with incomplete structure)
        const patterns = [
            /<tool_call>/i,                          // Hermes XML-style tool call tag
            /<\/tool_call>/i,                        // Closing tool call tag
            /\{"name"\s*:\s*"[^"]+"/,                // JSON with "name" field
            /\{"function"\s*:\s*\{/,                 // JSON with function object
            /"arguments"\s*:\s*\{[^}]*$/,            // Truncated arguments JSON
            /\{\s*"type"\s*:\s*"function"/,          // Function type declaration
            /<function=/i,                           // Alternative function tag format
        ];

        return patterns.some(pattern => pattern.test(text));
    }

    formatToolCallMessage(toolCalls) {
        // Format tool calls for display in chat (custom tools - no execution)
        if (!toolCalls || toolCalls.length === 0) return '';

        return `
            <div class="tool-calls-container">
                ${toolCalls.map(tc => {
            const func = tc.function || {};
            let argsDisplay = func.arguments || '{}';
            try {
                argsDisplay = JSON.stringify(JSON.parse(func.arguments), null, 2);
            } catch (e) {}

            return `
                        <div class="tool-call-content">
                            <div class="tool-call-header">
                                <span class="tool-icon"><span class="icon-mcp-tools"></span></span>
                                <span>${this.escapeHtml(func.name || 'unknown')}</span>
                            </div>
                            <div class="tool-call-args">${this.escapeHtml(argsDisplay)}</div>
                        </div>
                    `;
        }).join('')}
            </div>
        `;
    }

    formatMCPToolCallMessage(toolCalls) {
        // Format MCP tool calls with individual Execute/Skip buttons for each tool
        if (!toolCalls || toolCalls.length === 0) return '';

        // Store pending MCP tool calls for execution
        this._pendingMCPToolCalls = [...toolCalls];
        this._mcpToolResults = [];
        this._mcpToolsProcessed = 0;

        return `
            <div class="mcp-tool-calls-container">
                <div class="mcp-tool-calls-header">
                    <span class="mcp-icon">🔗</span>
                    <span>MCP Tool Call${toolCalls.length > 1 ? 's' : ''} - Review Each Tool</span>
                </div>
                ${toolCalls.map((tc, index) => {
            const func = tc.function || {};
            let argsDisplay = func.arguments || '{}';
            try {
                argsDisplay = JSON.stringify(JSON.parse(func.arguments), null, 2);
            } catch (e) {}

            return `
                        <div class="mcp-tool-call-item" data-tool-index="${index}" data-tool-id="${tc.id}">
                            <div class="mcp-tool-call-header">
                                <span class="tool-name">${this.escapeHtml(func.name || 'unknown')}</span>
                                <span class="tool-status pending">Awaiting Decision</span>
                            </div>
                            <details class="mcp-tool-args-details" open>
                                <summary>Arguments</summary>
                                <pre class="mcp-tool-args">${this.escapeHtml(argsDisplay)}</pre>
                            </details>
                            <div class="mcp-tool-actions-individual">
                                <button class="btn btn-success btn-sm" onclick="window.vllmUI.executeSingleMCPTool(${index})">
                                    Execute
                                </button>
                                <button class="btn btn-secondary btn-sm" onclick="window.vllmUI.skipSingleMCPTool(${index})">
                                    Skip
                                </button>
                            </div>
                            <div class="mcp-tool-result" style="display: none;"></div>
                        </div>
                    `;
        }).join('')}
                <div class="mcp-tool-continue" style="display: none;">
                    <button class="btn btn-primary" onclick="window.vllmUI.continueMCPConversation()">
                        Continue Conversation
                    </button>
                    <button class="btn btn-secondary" onclick="window.vllmUI.endMCPConversation()">
                        Done
                    </button>
                </div>
            </div>
        `;
    }

    async executeSingleMCPTool(index) {
        if (!this._pendingMCPToolCalls || !this._pendingMCPToolCalls[index]) {
            this.showNotification('Tool not found', 'warning');
            return;
        }

        const tc = this._pendingMCPToolCalls[index];
        const func = tc.function || {};
        const toolName = func.name;
        // Get the LAST (most recent) tool calls container to avoid targeting old ones
        const containers = document.querySelectorAll('.mcp-tool-calls-container');
        const container = containers[containers.length - 1];
        const itemEl = container?.querySelector(`[data-tool-index="${index}"]`);
        const statusEl = itemEl?.querySelector('.tool-status');
        const resultEl = itemEl?.querySelector('.mcp-tool-result');
        const actionsEl = itemEl?.querySelector('.mcp-tool-actions-individual');

        // Validate tool exists in MCP tools (check ALL tools, not just enabled ones)
        const allMcpTools = this.mcpTools || [];
        const toolExists = allMcpTools.some(t => t.function?.name === toolName);

        if (!toolExists) {
            // Tool doesn't exist - model hallucinated the tool name
            if (actionsEl) actionsEl.style.display = 'none';
            if (statusEl) {
                statusEl.textContent = 'Not Found';
                statusEl.className = 'tool-status error';
            }
            if (resultEl) {
                resultEl.style.display = 'block';
                const availableTools = allMcpTools.map(t => t.function?.name).join(', ') || 'none';
                resultEl.innerHTML = `
                    <div class="tool-error">
                        <strong>Tool "${this.escapeHtml(toolName)}" does not exist.</strong><br>
                        The model hallucinated this tool name.<br><br>
                        <em>Available tools:</em> ${this.escapeHtml(availableTools)}
                    </div>
                `;
            }

            // Add error result
            this._mcpToolResults.push({
                tool_call_id: tc.id,
                role: 'tool',
                content: `Error: Tool "${toolName}" does not exist. Available tools: ${allMcpTools.map(t => t.function?.name).join(', ')}`
            });

            this._mcpToolsProcessed++;
            this.checkMCPToolsComplete();
            return;
        }

        // Hide action buttons for this tool
        if (actionsEl) actionsEl.style.display = 'none';

        // Update status to executing
        if (statusEl) {
            statusEl.textContent = 'Executing...';
            statusEl.className = 'tool-status executing';
        }

        try {
            // Parse arguments
            let args = {};
            try {
                args = JSON.parse(func.arguments || '{}');
            } catch (e) {
                console.error('Failed to parse tool arguments:', e);
            }

            console.log(`🔧 Executing MCP tool: ${func.name}`, args);

            // Call MCP backend
            const response = await fetch('/api/mcp/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tool_name: func.name,
                    arguments: args
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Tool execution failed');
            }

            const result = await response.json();
            console.log(`✅ Tool result for ${func.name}:`, result);

            // Update UI
            if (statusEl) {
                statusEl.textContent = 'Executed';
                statusEl.className = 'tool-status success';
            }
            if (resultEl) {
                resultEl.style.display = 'block';
                resultEl.innerHTML = `<details open><summary>Result</summary><pre>${this.escapeHtml(JSON.stringify(result.result, null, 2))}</pre></details>`;
            }

            // Store result for chat continuation
            this._mcpToolResults.push({
                tool_call_id: tc.id,
                role: 'tool',
                name: toolName,  // Include tool name for proper message format
                content: typeof result.result === 'string' ? result.result : JSON.stringify(result.result)
            });

            console.log('✅ Tool result stored:', { tool_call_id: tc.id, name: toolName });

        } catch (error) {
            console.error(`❌ Tool execution failed for ${func.name}:`, error);

            if (statusEl) {
                statusEl.textContent = 'Failed';
                statusEl.className = 'tool-status error';
            }
            if (resultEl) {
                resultEl.style.display = 'block';
                resultEl.innerHTML = `<div class="tool-error">Error: ${this.escapeHtml(error.message)}</div>`;
            }

            // Still add error result so conversation can continue
            this._mcpToolResults.push({
                tool_call_id: tc.id,
                role: 'tool',
                name: toolName,  // Include tool name for proper message format
                content: `Error: ${error.message}`
            });
        }

        // Mark this tool as processed
        this._mcpToolsProcessed++;
        this.checkMCPToolsComplete();
    }

    skipSingleMCPTool(index) {
        if (!this._pendingMCPToolCalls || !this._pendingMCPToolCalls[index]) {
            return;
        }

        const tc = this._pendingMCPToolCalls[index];
        const func = tc.function || {};
        // Get the LAST (most recent) tool calls container to avoid targeting old ones
        const containers = document.querySelectorAll('.mcp-tool-calls-container');
        const container = containers[containers.length - 1];
        const itemEl = container?.querySelector(`[data-tool-index="${index}"]`);
        const statusEl = itemEl?.querySelector('.tool-status');
        const actionsEl = itemEl?.querySelector('.mcp-tool-actions-individual');

        // Hide action buttons for this tool
        if (actionsEl) actionsEl.style.display = 'none';

        // Update status
        if (statusEl) {
            statusEl.textContent = 'Skipped';
            statusEl.className = 'tool-status skipped';
        }
        this._mcpToolResults.push({
            tool_call_id: tc.id,
            role: 'tool',
            name: func.name,  // Include tool name for proper message format
            content: 'Tool execution was skipped by user.'
        });

        // Mark this tool as processed
        this._mcpToolsProcessed++;
        this.checkMCPToolsComplete();
    }

    checkMCPToolsComplete() {
        // Check if all tools have been processed (executed or skipped)
        if (!this._pendingMCPToolCalls) return;

        const totalTools = this._pendingMCPToolCalls.length;
        const processed = this._mcpToolsProcessed || 0;

        if (processed >= totalTools) {
            // All tools processed - show continue options
            // Get the LAST (most recent) tool calls container
            const containers = document.querySelectorAll('.mcp-tool-calls-container');
            const container = containers[containers.length - 1];
            const header = container?.querySelector('.mcp-tool-calls-header span:last-child');
            const continueDiv = container?.querySelector('.mcp-tool-continue');

            if (header) header.textContent = `All ${totalTools} tool${totalTools > 1 ? 's' : ''} reviewed`;
            if (continueDiv) continueDiv.style.display = 'flex';

            // Clear pending
            this._pendingMCPToolCalls = null;
        }
    }

    async continueMCPConversation() {
        // Phase 3: Continue conversation with tool results
        if (!this._mcpToolResults || this._mcpToolResults.length === 0) {
            this.showNotification('No tool results to continue with', 'warning');
            return;
        }

        // Add tool results to chat history
        for (const result of this._mcpToolResults) {
            this.chatHistory.push(result);
        }

        // Clear stored results
        this._mcpToolResults = null;

        // Trigger a new message to continue the conversation
        // We use a special flag to indicate this is a continuation
        this._mcpContinuation = true;

        // Re-enable send button and trigger send with empty message
        this.elements.sendBtn.disabled = false;
        this.elements.sendBtn.textContent = 'Send';

        // Send continuation request
        await this.sendMCPContinuation();
    }

    async sendMCPContinuation() {
        // Send a follow-up request with tool results already in history
        this.elements.sendBtn.disabled = true;
        this.elements.sendBtn.textContent = 'Generating...';

        const assistantMessageDiv = this.addChatMessage('assistant', '▌');
        const textSpan = assistantMessageDiv.querySelector('.message-text');

        try {
            const systemPrompt = this.elements.systemPrompt.value.trim();
            let messagesToSend = [...this.chatHistory];

            if (systemPrompt) {
                messagesToSend = [
                    {role: 'system', content: systemPrompt},
                    ...this.chatHistory
                ];
            }

            console.log('📤 Sending MCP continuation with messages:', JSON.stringify(messagesToSend, null, 2));

            // Don't send tools in continuation - force text response
            // This prevents the model from calling the same tool again in a loop
            const requestBody = {
                messages: messagesToSend,
                temperature: parseFloat(this.elements.temperature.value),
                max_tokens: parseInt(this.elements.maxTokens.value),
                stream: true  // Use streaming since no tools
            };

            console.log('📤 Continuation request (no tools, streaming):', requestBody);

            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error(await response.text() || 'Failed to continue conversation');
            }

            // Check content type to determine response format
            const contentType = response.headers.get('content-type') || '';

            if (contentType.includes('application/json')) {
                // Non-streaming JSON response
                const jsonResponse = await response.json();
                console.log('📤 MCP continuation response:', jsonResponse);

                if (jsonResponse.choices && jsonResponse.choices.length > 0) {
                    const message = jsonResponse.choices[0].message;

                    // Display text content if present
                    if (message.content) {
                        textSpan.textContent = message.content;
                        this.chatHistory.push({ role: 'assistant', content: message.content });
                    }

                    // If model STILL wants to call tools, show them (but this shouldn't happen)
                    if (message.tool_calls && message.tool_calls.length > 0) {
                        console.warn('⚠️ Model still requesting tool calls after continuation');
                        // Just show the text, ignore the tool calls to prevent infinite loop
                        if (!message.content) {
                            textSpan.textContent = 'Model is trying to call tools again. Please rephrase your question.';
                        }
                    }
                } else {
                    textSpan.textContent = 'No response from model';
                }
            } else {
                // Streaming SSE response
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let fullText = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n');

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === '[DONE]') continue;

                            try {
                                const parsed = JSON.parse(data);
                                const content = parsed.choices?.[0]?.delta?.content || '';
                                if (content) {
                                    fullText += content;
                                    textSpan.textContent = fullText;
                                }
                            } catch (e) {
                                // Skip invalid JSON
                            }
                        }
                    }
                }

                if (fullText) {
                    this.chatHistory.push({ role: 'assistant', content: fullText });
                } else {
                    textSpan.textContent = 'No response from model';
                }
            }

        } catch (error) {
            textSpan.textContent = `Error: ${error.message}`;
            assistantMessageDiv.classList.add('error');
        } finally {
            this.elements.sendBtn.disabled = false;
            this.elements.sendBtn.textContent = 'Send';
            this._mcpContinuation = false;
        }
    }

    endMCPConversation() {
        // User chose not to continue after tool execution
        this._mcpToolResults = null;
        this.showNotification('Conversation ended', 'info');
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ============================================
    // MCP Module - Methods injected from modules/mcp.js
    // ============================================
    // MCP methods are dynamically added via initMCPModule()
    // See: static/js/modules/mcp.js

    // ============================================
    // Claude Code Module - Methods injected from modules/claudecode.js
    // ============================================
    // Claude Code methods are dynamically added via initClaudeCodeModule()
    // See: static/js/modules/claudecode.js
}
// Add CSS animations for notifications
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.vllmUI = new VLLMWebUI();

    // Load saved layout preferences
    window.vllmUI.loadLayoutPreferences();

    // Add cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (window.vllmUI) {
            window.vllmUI.stopGpuStatusPolling();
        }
    });
});

