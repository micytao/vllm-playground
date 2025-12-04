// vLLM Playground - Main JavaScript
class VLLMWebUI {
    constructor() {
        this.ws = null;
        this.chatHistory = [];
        this.serverRunning = false;
        this.serverReady = false;  // Track if server startup is complete
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
            modelSourceLocal: document.getElementById('model-source-local'),
            modelSourceHubLabel: document.getElementById('model-source-hub-label'),
            modelSourceLocalLabel: document.getElementById('model-source-local-label'),
            hubModelSection: document.getElementById('hub-model-section'),
            localModelSection: document.getElementById('local-model-section'),
            localModelPath: document.getElementById('local-model-path'),
            browseFolderBtn: document.getElementById('browse-folder-btn'),
            validatePathBtn: document.getElementById('validate-path-btn'),
            localModelValidation: document.getElementById('local-model-validation'),
            validationIcon: document.getElementById('validation-icon'),
            validationMessage: document.getElementById('validation-message'),
            localModelInfo: document.getElementById('local-model-info'),
            
            // CPU/GPU Mode
            modeCpu: document.getElementById('mode-cpu'),
            modeGpu: document.getElementById('mode-gpu'),
            modeCpuLabel: document.getElementById('mode-cpu-label'),
            modeGpuLabel: document.getElementById('mode-gpu-label'),
            modeHelpText: document.getElementById('mode-help-text'),
            cpuSettings: document.getElementById('cpu-settings'),
            
            // Run mode elements
            runModeSubprocess: document.getElementById('run-mode-subprocess'),
            runModeContainer: document.getElementById('run-mode-container'),
            runModeSubprocessLabel: document.getElementById('run-mode-subprocess-label'),
            runModeContainerLabel: document.getElementById('run-mode-container-label'),
            runModeHelpText: document.getElementById('run-mode-help-text'),
            gpuSettings: document.getElementById('gpu-settings'),
            
            // GPU settings
            tensorParallel: document.getElementById('tensor-parallel'),
            gpuMemory: document.getElementById('gpu-memory'),
            gpuDevice: document.getElementById('gpu-device'),
            
            // CPU settings
            cpuKvcache: document.getElementById('cpu-kvcache'),
            cpuThreads: document.getElementById('cpu-threads'),
            
            dtype: document.getElementById('dtype'),
            dtypeHelpText: document.getElementById('dtype-help-text'),
            maxModelLen: document.getElementById('max-model-len'),
            trustRemoteCode: document.getElementById('trust-remote-code'),
            enablePrefixCaching: document.getElementById('enable-prefix-caching'),
            disableLogStats: document.getElementById('disable-log-stats'),
            
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
            clearLogsBtn: document.getElementById('clear-logs-btn'),
            
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
            progressPercent: document.getElementById('progress-percent')
        };

        // Attach event listeners
        this.attachListeners();
        
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
        
        // Initialize benchmark command preview
        this.updateBenchmarkCommandPreview();
        
        // Check feature availability
        this.checkFeatureAvailability();
        
        // Connect WebSocket for logs
        this.connectWebSocket();
        
        // Start status polling
        this.pollStatus();
        setInterval(() => this.pollStatus(), 3000);
        
        // Add GPU status refresh button listener
        document.getElementById('gpu-status-refresh').addEventListener('click', () => {
            this.fetchGpuStatus();
        });
    }

    attachListeners() {
        // Server control
        this.elements.startBtn.addEventListener('click', () => this.startServer());
        this.elements.stopBtn.addEventListener('click', () => this.stopServer());
        
        // CPU/GPU mode toggle
        this.elements.modeCpu.addEventListener('change', () => this.toggleComputeMode());
        this.elements.modeGpu.addEventListener('change', () => this.toggleComputeMode());
        
        // Run mode toggle
        this.elements.runModeSubprocess.addEventListener('change', () => this.toggleRunMode());
        this.elements.runModeContainer.addEventListener('change', () => this.toggleRunMode());
        
        // Model Source toggle
        this.elements.modelSourceHub.addEventListener('change', () => this.toggleModelSource());
        this.elements.modelSourceLocal.addEventListener('change', () => this.toggleModelSource());
        
        // Local model path validation and browse
        this.elements.browseFolderBtn.addEventListener('click', () => this.browseForFolder());
        this.elements.validatePathBtn.addEventListener('click', () => this.validateLocalModelPath());
        
        // Optional: validate on blur (can be removed if you want manual-only validation)
        this.elements.localModelPath.addEventListener('blur', () => {
            // Auto-validate only if path is not empty
            if (this.elements.localModelPath.value.trim()) {
                this.validateLocalModelPath();
            }
        });
        
        // Clear validation when user starts typing
        this.elements.localModelPath.addEventListener('input', () => {
            this.clearLocalModelValidation();
        });
        
        // Chat
        this.elements.sendBtn.addEventListener('click', () => this.sendMessage());
        this.elements.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                this.sendMessage();
            }
        });
        this.elements.clearChatBtn.addEventListener('click', () => this.clearChat());
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
        
        // Generation parameters
        this.elements.temperature.addEventListener('input', (e) => {
            this.elements.tempValue.textContent = e.target.value;
        });
        this.elements.maxTokens.addEventListener('input', (e) => {
            this.elements.tokensValue.textContent = e.target.value;
        });
        
        // Command preview - update when any config changes
        const configElements = [
            this.elements.modelSelect,
            this.elements.customModel,
            this.elements.host,
            this.elements.port,
            this.elements.modeCpu,
            this.elements.modeGpu,
            this.elements.tensorParallel,
            this.elements.gpuMemory,
            this.elements.cpuKvcache,
            this.elements.cpuThreads,
            this.elements.dtype,
            this.elements.maxModelLen,
            this.elements.hfToken,
            this.elements.trustRemoteCode,
            this.elements.enablePrefixCaching,
            this.elements.disableLogStats
        ];
        
        configElements.forEach(element => {
            element.addEventListener('input', () => this.updateCommandPreview());
            element.addEventListener('change', () => this.updateCommandPreview());
        });
        
        // Copy command button
        this.elements.copyCommandBtn.addEventListener('click', () => this.copyCommand());
        
        // Benchmark
        this.elements.runBenchmarkBtn.addEventListener('click', () => this.runBenchmark());
        this.elements.stopBenchmarkBtn.addEventListener('click', () => this.stopBenchmark());
        
        // Benchmark config changes - update command preview
        const benchmarkConfigElements = [
            this.elements.benchmarkRequests,
            this.elements.benchmarkRate,
            this.elements.benchmarkPromptTokens,
            this.elements.benchmarkOutputTokens,
            this.elements.host,  // Also update when host changes
            this.elements.port   // Also update when port changes
        ];
        
        benchmarkConfigElements.forEach(element => {
            element.addEventListener('input', () => this.updateBenchmarkCommandPreview());
            element.addEventListener('change', () => this.updateBenchmarkCommandPreview());
        });
        
        // Benchmark method toggle
        this.elements.benchmarkMethodBuiltin.addEventListener('change', () => this.updateBenchmarkCommandPreview());
        this.elements.benchmarkMethodGuidellm.addEventListener('change', () => this.updateBenchmarkCommandPreview());
        
        // Copy benchmark command button
        this.elements.copyBenchmarkCommandBtn.addEventListener('click', () => this.copyBenchmarkCommand());
        this.elements.copyGuidellmOutputBtn.addEventListener('click', () => this.copyGuidellmOutput());
        this.elements.toggleRawOutputBtn.addEventListener('click', () => this.toggleRawOutput());
        this.elements.copyGuidellmJsonBtn.addEventListener('click', () => this.copyGuidellmJson());
        this.elements.toggleJsonOutputBtn.addEventListener('click', () => this.toggleJsonOutput());
        
        // Template Settings
        this.elements.templateSettingsToggle.addEventListener('click', () => this.toggleTemplateSettings());
        this.elements.modelSelect.addEventListener('change', () => {
            this.updateTemplateForModel();
            this.optimizeSettingsForModel();
        });
        this.elements.customModel.addEventListener('blur', () => {
            this.updateTemplateForModel();
            this.optimizeSettingsForModel();
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
            
            // Check hardware capabilities
            await this.checkHardwareCapabilities();
        } catch (error) {
            console.error('Error checking feature availability:', error);
        }
    }
    
    async checkHardwareCapabilities() {
        try {
            const response = await fetch('/api/hardware-capabilities');
            const capabilities = await response.json();
            
            // Log hardware capabilities
            console.log('Hardware capabilities:', capabilities);
            
            // Disable GPU option if GPU is not available
            if (!capabilities.gpu_available) {
                // Disable GPU radio button
                this.elements.modeGpu.disabled = true;
                this.elements.modeGpuLabel.classList.add('disabled');
                this.elements.modeGpuLabel.title = 'GPU not available on this system. Requires CUDA-capable GPU and drivers.';
                this.elements.modeGpuLabel.style.opacity = '0.5';
                this.elements.modeGpuLabel.style.cursor = 'not-allowed';
                
                // Force CPU mode
                this.elements.modeCpu.checked = true;
                this.toggleComputeMode();
                
                // Update help text
                this.elements.modeHelpText.innerHTML = '⚠️ GPU not available - Running in CPU-only mode';
                this.elements.modeHelpText.style.color = '#f59e0b';
                
                // Hide GPU status display
                document.getElementById('gpu-status-display').style.display = 'none';
                
                console.warn('GPU is not available on this system');
                this.addLog('[SYSTEM] GPU not detected - GPU mode disabled', 'warning');
            } else {
                // GPU is available
                console.log('GPU is available on this system');
                this.elements.modeHelpText.innerHTML = 'CPU and GPU modes available. GPU recommended for larger models.';
                this.addLog('[SYSTEM] GPU detected - Both CPU and GPU modes available', 'info');
                
                // Show GPU status display
                document.getElementById('gpu-status-display').style.display = 'block';
                
                // Start GPU status polling
                this.startGpuStatusPolling();
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
            const memoryUsedPercent = (gpu.memory_used / gpu.memory_total) * 100;
            const memoryFreeGB = (gpu.memory_total - gpu.memory_used) / 1024;
            const memoryTotalGB = gpu.memory_total / 1024;
            const memoryUsedGB = gpu.memory_used / 1024;

            html += `
                <div class="gpu-device">
                    <div class="gpu-device-header">
                        <span class="gpu-name">${gpu.name}</span>
                        <span class="gpu-index">GPU ${gpu.index}</span>
                    </div>
                    <div class="gpu-memory">
                        <div class="memory-info">
                            <span>Memory: ${memoryFreeGB.toFixed(1)}GB free / ${memoryTotalGB.toFixed(1)}GB total</span>
                            <span>${memoryUsedPercent.toFixed(1)}% used</span>
                        </div>
                        <div class="memory-bar">
                            <div class="memory-used" style="width: ${memoryUsedPercent}%"></div>
                        </div>
                    </div>
                    <div class="gpu-utilization">
                        <span class="utilization-label">GPU Utilization:</span>
                        <span class="utilization-value">${gpu.utilization_gpu}%</span>
                        <div class="utilization-bar">
                            <div class="utilization-fill" style="width: ${gpu.utilization_gpu}%"></div>
                        </div>
                    </div>
                    <div class="gpu-temperature">
                        <span class="temp-icon">🌡️</span>
                        <span class="temp-value">${gpu.temperature}°C</span>
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
        
        // Update button active states
        if (isCpuMode) {
            this.elements.modeCpuLabel.classList.add('active');
            this.elements.modeGpuLabel.classList.remove('active');
            this.elements.modeHelpText.textContent = 'CPU mode is recommended for macOS';
            this.elements.dtypeHelpText.textContent = 'BFloat16 recommended for CPU';
            
            // Show CPU settings, hide GPU settings
            this.elements.cpuSettings.style.display = 'block';
            this.elements.gpuSettings.style.display = 'none';
            
            // Set dtype to bfloat16 for CPU
            this.elements.dtype.value = 'bfloat16';
        } else {
            this.elements.modeCpuLabel.classList.remove('active');
            this.elements.modeGpuLabel.classList.add('active');
            this.elements.modeHelpText.textContent = 'GPU mode for CUDA-enabled systems';
            this.elements.dtypeHelpText.textContent = 'Auto recommended for GPU';
            
            // Show GPU settings, hide CPU settings
            this.elements.cpuSettings.style.display = 'none';
            this.elements.gpuSettings.style.display = 'block';
            
            // Set dtype to auto for GPU
            this.elements.dtype.value = 'auto';
        }
        
        // Update command preview
        this.updateCommandPreview();
    }

    toggleRunMode() {
        const isSubprocess = this.elements.runModeSubprocess.checked;
        
        // Update button active states
        if (isSubprocess) {
            this.elements.runModeSubprocessLabel.classList.add('active');
            this.elements.runModeContainerLabel.classList.remove('active');
            this.elements.runModeHelpText.textContent = 'Subprocess: Direct execution (simpler, local dev)';
        } else {
            this.elements.runModeSubprocessLabel.classList.remove('active');
            this.elements.runModeContainerLabel.classList.add('active');
            this.elements.runModeHelpText.textContent = 'Container: Isolated environment (recommended for production)';
        }
        
        // Update command preview
        this.updateCommandPreview();
    }

    toggleModelSource() {
        const isLocalModel = this.elements.modelSourceLocal.checked;
        
        // Update button active states
        if (isLocalModel) {
            this.elements.modelSourceHubLabel.classList.remove('active');
            this.elements.modelSourceLocalLabel.classList.add('active');
            
            // Show local model section, hide HF hub section
            this.elements.localModelSection.style.display = 'block';
            this.elements.hubModelSection.style.display = 'none';
        } else {
            this.elements.modelSourceHubLabel.classList.add('active');
            this.elements.modelSourceLocalLabel.classList.remove('active');
            
            // Show HF hub section, hide local model section
            this.elements.localModelSection.style.display = 'none';
            this.elements.hubModelSection.style.display = 'block';
            
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
        // Check if using local model or HF hub
        const isLocalModel = this.elements.modelSourceLocal.checked;
        
        const model = this.elements.customModel.value.trim() || this.elements.modelSelect.value;
        const localModelPath = this.elements.localModelPath.value.trim();
        const maxModelLen = this.elements.maxModelLen.value;
        const isCpuMode = this.elements.modeCpu.checked;
        const hfToken = this.elements.hfToken.value.trim();
        
        // Get run mode (subprocess or container)
        const runMode = document.getElementById('run-mode-subprocess').checked ? 'subprocess' : 'container';
        
        const config = {
            model: model,
            host: this.elements.host.value,
            port: parseInt(this.elements.port.value),
            dtype: this.elements.dtype.value,
            max_model_len: maxModelLen ? parseInt(maxModelLen) : null,
            run_mode: runMode,  // Add run_mode to config
            trust_remote_code: this.elements.trustRemoteCode.checked,
            enable_prefix_caching: this.elements.enablePrefixCaching.checked,
            disable_log_stats: this.elements.disableLogStats.checked,
            use_cpu: isCpuMode,
            hf_token: hfToken || null,  // Include HF token for gated models
            local_model_path: isLocalModel && localModelPath ? localModelPath : null  // Add local model path
        };
        
        // Don't send chat template or stop tokens - let vLLM auto-detect them
        // The fields in the UI are for reference/display only
        // Users who need custom templates can set them via server config JSON or API
        
        if (isCpuMode) {
            // CPU-specific settings
            config.cpu_kvcache_space = parseInt(this.elements.cpuKvcache.value);
            config.cpu_omp_threads_bind = this.elements.cpuThreads.value;
        } else {
            // GPU-specific settings
            config.tensor_parallel_size = parseInt(this.elements.tensorParallel.value);
            config.gpu_memory_utilization = parseFloat(this.elements.gpuMemory.value) / 100;
            config.load_format = "auto";
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
        this.addLog(`Compute Mode: ${config.use_cpu ? 'CPU' : 'GPU'}`, 'info');
        
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
            
            // Use streaming
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messages: messagesToSend,  // Send messages with system prompt prepended
                    temperature: parseFloat(this.elements.temperature.value),
                    max_tokens: parseInt(this.elements.maxTokens.value),
                    stream: true
                    // No stop_tokens - let vLLM handle them automatically
                })
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'Failed to send message');
            }
            
            // Read the streaming response
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            
            console.log('Starting to read streaming response...');
            
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
                            
                            if (parsed.choices && parsed.choices.length > 0) {
                                // Handle OpenAI-compatible chat completions endpoint format
                                const choice = parsed.choices[0];
                                let content = null;
                                
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
            
            console.log('Finalizing response, fullText length:', fullText.length);
            console.log('Usage data:', usageData);
            
            // Remove cursor and finalize
            if (fullText) {
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
                } else {
                    textSpan.textContent = fullText;
                    this.chatHistory.push({role: 'assistant', content: fullText});
                }
            } else {
                textSpan.textContent = 'No response from model';
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
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        if (role !== 'system') {
            const roleLabel = document.createElement('strong');
            roleLabel.textContent = role.charAt(0).toUpperCase() + role.slice(1) + ': ';
            contentDiv.appendChild(roleLabel);
        }
        
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
        this.chatHistory = [];
        this.elements.chatContainer.innerHTML = `
            <div class="chat-message system">
                <div class="message-content">
                    <strong>System:</strong> Chat cleared. Start a new conversation.
                </div>
            </div>
        `;
    }
    
    clearSystemPrompt() {
        this.elements.systemPrompt.value = '';
        this.showNotification('System prompt cleared', 'success');
    }

    addLog(message, type = 'info') {
        // Check if server startup is complete (match various formats)
        if (message && (message.includes('Application startup complete') || 
                       message.includes('Uvicorn running') ||
                       message.match(/Application startup complete/i))) {
            console.log('🎉 Server startup detected! Setting serverReady = true');
            this.serverReady = true;
            this.updateSendButtonState();
            
            // Fetch and display the chat template being used by the model
            this.fetchChatTemplate();
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

    clearLogs() {
        this.elements.logsContainer.innerHTML = `
            <div class="log-entry info">Logs cleared.</div>
        `;
    }

    showNotification(message, type = 'info') {
        // Simple notification using browser notification API
        // You could also implement a custom toast notification
        console.log(`[${type.toUpperCase()}] ${message}`);
        
        // Optional: Add a temporary notification element
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#f59e0b'};
            color: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 1000;
            animation: slideIn 0.3s ease-out;
        `;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
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

    updateCommandPreview() {
        const model = this.elements.customModel.value.trim() || this.elements.modelSelect.value;
        const host = this.elements.host.value;
        const port = this.elements.port.value;
        const dtype = this.elements.dtype.value;
        const maxModelLen = this.elements.maxModelLen.value;
        const trustRemoteCode = this.elements.trustRemoteCode.checked;
        const enablePrefixCaching = this.elements.enablePrefixCaching.checked;
        const disableLogStats = this.elements.disableLogStats.checked;
        const isCpuMode = this.elements.modeCpu.checked;
        const hfToken = this.elements.hfToken.value.trim();
        
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
            if (hfToken) {
                cmd += `export HF_TOKEN=[YOUR_TOKEN]\n`;
            }
            cmd += `\npython -m vllm.entrypoints.openai.api_server`;
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
            
            if (gpuDevice) {
                cmd = `# GPU Device Selection:\n`;
                cmd += `export CUDA_VISIBLE_DEVICES=${gpuDevice}\n\n`;
            }
            
            if (hfToken) {
                cmd += `# Set HF token for gated models:\n`;
                cmd += `export HF_TOKEN=[YOUR_TOKEN]\n\n`;
            }
            cmd += `python -m vllm.entrypoints.openai.api_server`;
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
                cmd += ` \\\n  --max-model-len 8192`;
                cmd += ` \\\n  --max-num-batched-tokens 8192`;
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
        
        if (disableLogStats) {
            cmd += ` \\\n  --disable-log-stats`;
        }
        
        // Add chat template flag (vLLM requires this for /v1/chat/completions)
        cmd += ` \\\n  --chat-template <auto-detected-or-custom>`;
        
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

    async runBenchmark() {
        if (!this.serverRunning) {
            this.showNotification('Server must be running to benchmark', 'warning');
            return;
        }

        const config = {
            total_requests: parseInt(this.elements.benchmarkRequests.value),
            request_rate: parseFloat(this.elements.benchmarkRate.value),
            prompt_tokens: parseInt(this.elements.benchmarkPromptTokens.value),
            output_tokens: parseInt(this.elements.benchmarkOutputTokens.value),
            use_guidellm: this.elements.benchmarkMethodGuidellm.checked
        };

        this.benchmarkRunning = true;
        this.benchmarkStartTime = Date.now();
        this.elements.runBenchmarkBtn.disabled = true;
        this.elements.runBenchmarkBtn.style.display = 'none';
        this.elements.stopBenchmarkBtn.disabled = false;
        this.elements.stopBenchmarkBtn.style.display = 'inline-block';

        // Hide placeholder, show progress
        this.elements.metricsDisplay.style.display = 'none';
        this.elements.metricsGrid.style.display = 'none';
        this.elements.benchmarkProgress.style.display = 'block';

        try {
            const response = await fetch('/api/benchmark/start', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(config)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to start benchmark');
            }

            // Start polling for status
            this.benchmarkPollInterval = setInterval(() => this.pollBenchmarkStatus(), 1000);

        } catch (err) {
            console.error('Failed to start benchmark:', err);
            this.showNotification(`Failed to start benchmark: ${err.message}`, 'error');
            this.resetBenchmarkUI();
        }
    }

    async stopBenchmark() {
        try {
            await fetch('/api/benchmark/stop', {method: 'POST'});
            this.showNotification('Benchmark stopped', 'info');
        } catch (err) {
            console.error('Failed to stop benchmark:', err);
        }
        this.resetBenchmarkUI();
    }

    async pollBenchmarkStatus() {
        try {
            const response = await fetch('/api/benchmark/status');
            const data = await response.json();
            
            console.log('[POLL] Benchmark status:', data);

            if (data.running) {
                // GuideLLM doesn't output real-time progress, so we estimate based on time
                const elapsed = Date.now() - this.benchmarkStartTime;
                const estimated = (this.elements.benchmarkRequests.value / this.elements.benchmarkRate.value) * 1000;
                
                // Use a smoother curve that goes up to 98% (leaving 2% for completion)
                let progress;
                if (elapsed < estimated) {
                    // Linear progress up to 90%
                    progress = (elapsed / estimated) * 90;
                } else {
                    // Slow down after estimated time: 90% -> 98% over 2x the time
                    const overtime = elapsed - estimated;
                    const slowProgress = 90 + (Math.min(overtime / estimated, 1) * 8);
                    progress = Math.min(98, slowProgress);
                }
                
                console.log(`[POLL] Estimated progress: ${progress.toFixed(1)}% (${elapsed}ms elapsed, ${estimated}ms estimated)`);
                
                this.elements.progressFill.style.width = `${progress}%`;
                this.elements.progressPercent.textContent = `${progress.toFixed(0)}%`;
            } else {
                // Benchmark complete
                clearInterval(this.benchmarkPollInterval);
                this.benchmarkPollInterval = null;

                if (data.results) {
                    console.log('[POLL] Benchmark completed with results');
                    this.displayBenchmarkResults(data.results);
                    this.showNotification('Benchmark completed!', 'success');
                } else {
                    console.error('[POLL] Benchmark completed but no results:', data);
                    this.showNotification('Benchmark failed', 'error');
                }

                this.resetBenchmarkUI();
            }
        } catch (err) {
            console.error('Failed to poll benchmark status:', err);
        }
    }

    displayBenchmarkResults(results) {
        // Hide progress
        this.elements.benchmarkProgress.style.display = 'none';
        
        // Check if this is GuideLLM results (has raw_output) or built-in results
        const isGuideLLM = results.raw_output && results.raw_output.length > 0;

        // Debug: Log the results to console
        console.log('=== BENCHMARK RESULTS DEBUG ===');
        console.log('Full results object:', JSON.stringify(results, null, 2));
        console.log('Is GuideLLM:', isGuideLLM);
        console.log('throughput:', results.throughput);
        console.log('avg_latency:', results.avg_latency);
        console.log('tokens_per_second:', results.tokens_per_second);
        console.log('total_tokens:', results.total_tokens);
        console.log('p50_latency:', results.p50_latency);
        console.log('p95_latency:', results.p95_latency);
        console.log('p99_latency:', results.p99_latency);
        console.log('success_rate:', results.success_rate);
        console.log('json_output:', results.json_output ? 'Present' : 'Missing');
        console.log('==============================');

        if (isGuideLLM) {
            // GuideLLM: Show raw output, hide metrics
            this.elements.metricsGrid.style.display = 'none';
            const rawOutputSection = document.getElementById('guidellm-raw-output-section');
            const rawOutputTextarea = document.getElementById('guidellm-raw-output');
            const rawOutputContent = this.elements.guidellmRawOutputContent;
            const toggleBtn = this.elements.toggleRawOutputBtn;
            const jsonOutputSection = document.getElementById('guidellm-json-output-section');
            const jsonOutputPre = document.getElementById('guidellm-json-output');
            
            if (rawOutputSection && rawOutputTextarea) {
                rawOutputTextarea.value = results.raw_output;
                rawOutputSection.style.display = 'block';
                // Reset to visible state when new results come in
                if (rawOutputContent) {
                    rawOutputContent.style.display = 'block';
                }
                if (toggleBtn) {
                    toggleBtn.textContent = 'Hide';
                }
            }
            
            // Try to extract and display JSON from results
            if (results.json_output) {
                try {
                    // Parse and format JSON
                    const jsonData = typeof results.json_output === 'string' 
                        ? JSON.parse(results.json_output) 
                        : results.json_output;
                    
                    if (jsonOutputSection && jsonOutputPre) {
                        jsonOutputPre.textContent = JSON.stringify(jsonData, null, 2);
                        jsonOutputSection.style.display = 'block';
                        
                        // Reset to visible state when new results come in
                        const jsonOutputContent = this.elements.guidellmJsonOutputContent;
                        const toggleJsonBtn = this.elements.toggleJsonOutputBtn;
                        if (jsonOutputContent) {
                            jsonOutputContent.style.display = 'block';
                        }
                        if (toggleJsonBtn) {
                            toggleJsonBtn.textContent = 'Hide';
                        }
                    }
                    
                    // Also create table view
                    console.log('[BENCHMARK] Creating table view from JSON data');
                    this.displayBenchmarkTable(jsonData);
                } catch (e) {
                    console.warn('Failed to parse GuideLLM JSON output:', e);
                    if (jsonOutputSection) {
                        jsonOutputSection.style.display = 'none';
                    }
                }
            } else {
                console.warn('[BENCHMARK] No json_output in results');
                if (jsonOutputSection) {
                    jsonOutputSection.style.display = 'none';
                }
            }
        } else {
            // Built-in: Show metrics, hide raw output
            this.elements.metricsGrid.style.display = 'grid';
            const rawOutputSection = document.getElementById('guidellm-raw-output-section');
            const jsonOutputSection = document.getElementById('guidellm-json-output-section');
            const tableSection = document.getElementById('guidellm-table-section');
            if (rawOutputSection) {
                rawOutputSection.style.display = 'none';
            }
            if (jsonOutputSection) {
                jsonOutputSection.style.display = 'none';
            }
            if (tableSection) {
                tableSection.style.display = 'none';
            }

            // Update metric cards with defensive checks
            document.getElementById('metric-throughput').textContent = 
                results.throughput !== undefined ? `${results.throughput.toFixed(2)} req/s` : '-- req/s';
            document.getElementById('metric-latency').textContent = 
                results.avg_latency !== undefined ? `${results.avg_latency.toFixed(2)} ms` : '-- ms';
            document.getElementById('benchmark-tokens-per-sec').textContent = 
                results.tokens_per_second !== undefined ? `${results.tokens_per_second.toFixed(2)} tok/s` : '-- tok/s';
            document.getElementById('metric-p50').textContent = 
                results.p50_latency !== undefined ? `${results.p50_latency.toFixed(2)} ms` : '-- ms';
            document.getElementById('metric-p95').textContent = 
                results.p95_latency !== undefined ? `${results.p95_latency.toFixed(2)} ms` : '-- ms';
            document.getElementById('metric-p99').textContent = 
                results.p99_latency !== undefined ? `${results.p99_latency.toFixed(2)} ms` : '-- ms';
            document.getElementById('benchmark-total-tokens').textContent = 
                results.total_tokens !== undefined ? results.total_tokens.toLocaleString() : '--';
            document.getElementById('metric-success-rate').textContent = 
                results.success_rate !== undefined ? `${results.success_rate.toFixed(1)} %` : '-- %';

            // Animate cards
            document.querySelectorAll('.metric-card').forEach((card, index) => {
                setTimeout(() => {
                    card.classList.add('updated');
                    setTimeout(() => card.classList.remove('updated'), 500);
                }, index * 50);
            });
        }
    }

    displayBenchmarkTable(jsonData) {
        console.log('[TABLE] displayBenchmarkTable called with data:', jsonData);
        
        const tableSection = document.getElementById('guidellm-table-section');
        const tableContent = document.getElementById('guidellm-table-content');
        
        console.log('[TABLE] Table section element:', tableSection);
        console.log('[TABLE] Table content element:', tableContent);
        
        if (!tableSection || !tableContent) {
            console.error('[TABLE] Table section or content element not found');
            return;
        }
        
        if (!jsonData || !jsonData.benchmarks || jsonData.benchmarks.length === 0) {
            console.warn('[TABLE] No benchmark data in JSON');
            return;
        }
        
        const benchmark = jsonData.benchmarks[0]; // Get first benchmark
        console.log('[TABLE] Processing benchmark:', benchmark);
        
        let html = '';
        
        // Configuration Table
        html += '<div class="benchmark-table-group">';
        html += '<h4>⚙️ Configuration</h4>';
        html += '<table class="benchmark-data-table">';
        html += '<tbody>';
        
        if (benchmark.worker) {
            html += `<tr><td class="label">Backend Target</td><td class="value">${benchmark.worker.backend_target || 'N/A'}</td></tr>`;
            html += `<tr><td class="label">Model</td><td class="value">${benchmark.worker.backend_model || 'N/A'}</td></tr>`;
        }
        
        if (benchmark.request_loader) {
            html += `<tr><td class="label">Data Configuration</td><td class="value">${benchmark.request_loader.data || 'N/A'}</td></tr>`;
        }
        
        if (benchmark.args && benchmark.args.strategy) {
            html += `<tr><td class="label">Strategy Type</td><td class="value">${benchmark.args.strategy.type_ || 'N/A'}</td></tr>`;
            html += `<tr><td class="label">Request Rate</td><td class="value">${benchmark.args.strategy.rate || 'N/A'} req/s</td></tr>`;
        }
        
        if (benchmark.args) {
            html += `<tr><td class="label">Max Requests</td><td class="value">${benchmark.args.max_number || 'N/A'}</td></tr>`;
        }
        
        html += '</tbody></table></div>';
        
        // Request Statistics Table
        if (benchmark.run_stats) {
            const stats = benchmark.run_stats;
            const duration = stats.end_time - stats.start_time;
            
            html += '<div class="benchmark-table-group">';
            html += '<h4>📊 Request Statistics</h4>';
            html += '<table class="benchmark-data-table">';
            html += '<tbody>';
            
            if (stats.requests_made) {
                html += `<tr><td class="label">Total Requests</td><td class="value">${stats.requests_made.total || 0}</td></tr>`;
                html += `<tr><td class="label">Successful</td><td class="value success">${stats.requests_made.successful || 0}</td></tr>`;
                html += `<tr><td class="label">Errored</td><td class="value ${stats.requests_made.errored > 0 ? 'error' : ''}">${stats.requests_made.errored || 0}</td></tr>`;
                html += `<tr><td class="label">Incomplete</td><td class="value">${stats.requests_made.incomplete || 0}</td></tr>`;
            }
            
            html += `<tr><td class="label">Duration</td><td class="value">${duration.toFixed(2)} seconds</td></tr>`;
            html += `<tr><td class="label">Avg Request Time</td><td class="value">${(stats.request_time_avg || 0).toFixed(3)} seconds</td></tr>`;
            html += `<tr><td class="label">Avg Worker Time</td><td class="value">${(stats.worker_time_avg || 0).toFixed(3)} seconds</td></tr>`;
            html += `<tr><td class="label">Avg Queued Time</td><td class="value">${((stats.queued_time_avg || 0) * 1000).toFixed(2)} ms</td></tr>`;
            
            html += '</tbody></table></div>';
        }
        
        // Performance Metrics Table
        if (benchmark.metrics) {
            html += '<div class="benchmark-table-group">';
            html += '<h4>🚀 Performance Metrics</h4>';
            html += '<table class="benchmark-data-table">';
            html += '<thead><tr><th>Metric</th><th>Mean</th><th>Median</th><th>Min</th><th>Max</th><th>Std Dev</th></tr></thead>';
            html += '<tbody>';
            
            // Requests per second
            if (benchmark.metrics.requests_per_second && benchmark.metrics.requests_per_second.successful) {
                const rps = benchmark.metrics.requests_per_second.successful;
                html += '<tr>';
                html += '<td class="label">Requests/Second</td>';
                html += `<td>${(rps.mean || 0).toFixed(2)}</td>`;
                html += `<td>${(rps.median || 0).toFixed(2)}</td>`;
                html += `<td>${(rps.min || 0).toFixed(2)}</td>`;
                html += `<td>${(rps.max || 0).toFixed(2)}</td>`;
                html += `<td>${(rps.std_dev || 0).toFixed(2)}</td>`;
                html += '</tr>';
            }
            
            // Time to first token
            if (benchmark.metrics.time_to_first_token && benchmark.metrics.time_to_first_token.successful) {
                const ttft = benchmark.metrics.time_to_first_token.successful;
                html += '<tr>';
                html += '<td class="label">Time to First Token (s)</td>';
                html += `<td>${(ttft.mean || 0).toFixed(3)}</td>`;
                html += `<td>${(ttft.median || 0).toFixed(3)}</td>`;
                html += `<td>${(ttft.min || 0).toFixed(3)}</td>`;
                html += `<td>${(ttft.max || 0).toFixed(3)}</td>`;
                html += `<td>${(ttft.std_dev || 0).toFixed(3)}</td>`;
                html += '</tr>';
            }
            
            // Inter token latency
            if (benchmark.metrics.inter_token_latency && benchmark.metrics.inter_token_latency.successful) {
                const itl = benchmark.metrics.inter_token_latency.successful;
                html += '<tr>';
                html += '<td class="label">Inter-Token Latency (ms)</td>';
                html += `<td>${((itl.mean || 0) * 1000).toFixed(2)}</td>`;
                html += `<td>${((itl.median || 0) * 1000).toFixed(2)}</td>`;
                html += `<td>${((itl.min || 0) * 1000).toFixed(2)}</td>`;
                html += `<td>${((itl.max || 0) * 1000).toFixed(2)}</td>`;
                html += `<td>${((itl.std_dev || 0) * 1000).toFixed(2)}</td>`;
                html += '</tr>';
            }
            
            html += '</tbody></table></div>';
        }
        
        // Token Statistics Table
        if (benchmark.metrics) {
            html += '<div class="benchmark-table-group">';
            html += '<h4>📝 Token Statistics</h4>';
            html += '<table class="benchmark-data-table">';
            html += '<tbody>';
            
            // Output tokens per second
            if (benchmark.metrics.output_tokens_per_second && benchmark.metrics.output_tokens_per_second.successful) {
                const otps = benchmark.metrics.output_tokens_per_second.successful;
                html += `<tr><td class="label">Output Tokens/Second (Mean)</td><td class="value">${(otps.mean || 0).toFixed(2)}</td></tr>`;
                html += `<tr><td class="label">Output Tokens/Second (Median)</td><td class="value">${(otps.median || 0).toFixed(2)}</td></tr>`;
            }
            
            // Total tokens per second
            if (benchmark.metrics.total_tokens_per_second && benchmark.metrics.total_tokens_per_second.successful) {
                const ttps = benchmark.metrics.total_tokens_per_second.successful;
                html += `<tr><td class="label">Total Tokens/Second (Mean)</td><td class="value">${(ttps.mean || 0).toFixed(2)}</td></tr>`;
                html += `<tr><td class="label">Total Tokens/Second (Median)</td><td class="value">${(ttps.median || 0).toFixed(2)}</td></tr>`;
            }
            
            // Request output token counts
            if (benchmark.metrics.request_output_token_count && benchmark.metrics.request_output_token_count.successful) {
                const rotc = benchmark.metrics.request_output_token_count.successful;
                html += `<tr><td class="label">Request Output Tokens (Mean)</td><td class="value">${(rotc.mean || 0).toFixed(0)}</td></tr>`;
                html += `<tr><td class="label">Request Output Tokens (Total)</td><td class="value">${(rotc.total_sum || 0).toFixed(0)}</td></tr>`;
            }
            
            html += '</tbody></table></div>';
        }
        
        // Latency Percentiles Table
        if (benchmark.metrics && benchmark.metrics.request_latency && benchmark.metrics.request_latency.successful) {
            const latency = benchmark.metrics.request_latency.successful;
            if (latency.percentiles) {
                html += '<div class="benchmark-table-group">';
                html += '<h4>📈 Request Latency Percentiles</h4>';
                html += '<table class="benchmark-data-table">';
                html += '<thead><tr><th>Percentile</th><th>Latency (seconds)</th><th>Latency (ms)</th></tr></thead>';
                html += '<tbody>';
                
                const percentiles = [
                    { name: 'P50 (Median)', key: 'p50' },
                    { name: 'P75', key: 'p75' },
                    { name: 'P90', key: 'p90' },
                    { name: 'P95', key: 'p95' },
                    { name: 'P99', key: 'p99' },
                    { name: 'P99.9', key: 'p999' }
                ];
                
                percentiles.forEach(p => {
                    if (latency.percentiles[p.key] !== undefined) {
                        const val = latency.percentiles[p.key];
                        html += `<tr><td class="label">${p.name}</td><td>${val.toFixed(3)}</td><td>${(val * 1000).toFixed(2)}</td></tr>`;
                    }
                });
                
                html += '</tbody></table></div>';
            }
        }
        
        tableContent.innerHTML = html;
        tableSection.style.display = 'block';
        console.log('[TABLE] Table displayed successfully');
    }

    resetBenchmarkUI() {
        this.benchmarkRunning = false;
        this.elements.runBenchmarkBtn.disabled = !this.serverRunning;
        this.elements.runBenchmarkBtn.style.display = 'inline-block';
        this.elements.stopBenchmarkBtn.disabled = true;
        this.elements.stopBenchmarkBtn.style.display = 'none';
        this.elements.progressFill.style.width = '0%';
        this.elements.progressPercent.textContent = '0%';
        
        if (this.benchmarkPollInterval) {
            clearInterval(this.benchmarkPollInterval);
            this.benchmarkPollInterval = null;
        }
    }

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
                // Handle between chat and metrics sections
                this.resizingPanel = document.getElementById('metrics-panel');
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
            const newHeight = this.startHeight + deltaY; // Dragging down makes panel bigger
            
            // Apply minimum height
            if (newHeight >= 200) {
                // Set height on both the outer section and inner panel
                this.resizingPanel.style.height = `${newHeight}px`;
                
                const innerPanel = this.resizingPanel.querySelector('.panel');
                if (innerPanel) {
                    innerPanel.style.height = `${newHeight}px`;
                }
                
                // Force layout recalculation
                this.resizingPanel.offsetHeight;
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
    
    // ============ Benchmark Command Preview ============
    
    updateBenchmarkCommandPreview() {
        const totalRequests = this.elements.benchmarkRequests.value || '100';
        const requestRate = this.elements.benchmarkRate.value || '5';
        const promptTokens = this.elements.benchmarkPromptTokens.value || '100';
        const outputTokens = this.elements.benchmarkOutputTokens.value || '100';
        const useGuideLLM = this.elements.benchmarkMethodGuidellm.checked;
        
        // Get server configuration
        const host = this.elements.host?.value || 'localhost';
        const port = this.elements.port?.value || '8000';
        const targetUrl = `http://${host}:${port}/v1`;
        
        let cmd = '';
        
        if (useGuideLLM) {
            // Build GuideLLM command matching the actual command used in app.py
            cmd = '# Benchmark using GuideLLM\n';
            cmd += '# Actual command used by the app:\n';
            cmd += 'guidellm benchmark';
            cmd += ` \\\n  --target "${targetUrl}"`;
            
            // Add rate configuration
            if (requestRate && requestRate > 0) {
                cmd += ` \\\n  --rate-type constant`;
                cmd += ` \\\n  --rate ${requestRate}`;
            } else {
                cmd += ` \\\n  --rate-type sweep`;
            }
            
            // Add request limit
            cmd += ` \\\n  --max-requests ${totalRequests}`;
            
            // Add token configuration in guidellm's data format
            cmd += ` \\\n  --data "prompt_tokens=${promptTokens},output_tokens=${outputTokens}"`;
        } else {
            // Built-in benchmark - show Python API equivalent
            cmd = '# Built-in benchmark (running in the app)\n';
            cmd += '# Equivalent Python code:\n';
            cmd += 'import asyncio\n';
            cmd += 'import aiohttp\n\n';
            cmd += 'async def benchmark():\n';
            cmd += '    config = {\n';
            cmd += `        "total_requests": ${totalRequests},\n`;
            cmd += `        "request_rate": ${requestRate},\n`;
            cmd += `        "prompt_tokens": ${promptTokens},\n`;
            cmd += `        "output_tokens": ${outputTokens}\n`;
            cmd += '    }\n';
            cmd += `    url = "${targetUrl}/chat/completions"\n`;
            cmd += '    # Send requests at specified rate...\n';
            cmd += '    # Calculate throughput, latency, tokens/sec...\n\n';
            cmd += '# The built-in benchmark is faster and simpler\n';
            cmd += '# Use GuideLLM for advanced features & reports';
        }
        
        this.elements.benchmarkCommandText.value = cmd;
    }
    
    async copyBenchmarkCommand() {
        const command = this.elements.benchmarkCommandText.value;
        try {
            await navigator.clipboard.writeText(command);
            this.showNotification('Benchmark command copied to clipboard!', 'success');
        } catch (error) {
            console.error('Failed to copy:', error);
            this.showNotification('Failed to copy command', 'error');
        }
    }

    async copyGuidellmOutput() {
        const output = this.elements.guidellmRawOutput.value;
        try {
            await navigator.clipboard.writeText(output);
            this.showNotification('GuideLLM output copied to clipboard!', 'success');
        } catch (error) {
            console.error('Failed to copy:', error);
            this.showNotification('Failed to copy output', 'error');
        }
    }

    toggleRawOutput() {
        const content = this.elements.guidellmRawOutputContent;
        const btn = this.elements.toggleRawOutputBtn;
        
        if (content.style.display === 'none') {
            content.style.display = 'block';
            btn.textContent = 'Hide';
        } else {
            content.style.display = 'none';
            btn.textContent = 'Show';
        }
    }

    toggleJsonOutput() {
        const content = this.elements.guidellmJsonOutputContent;
        const btn = this.elements.toggleJsonOutputBtn;
        
        if (content.style.display === 'none') {
            content.style.display = 'block';
            btn.textContent = 'Hide';
        } else {
            content.style.display = 'none';
            btn.textContent = 'Show';
        }
    }

    async copyGuidellmJson() {
        const jsonOutput = document.getElementById('guidellm-json-output');
        if (jsonOutput) {
            try {
                await navigator.clipboard.writeText(jsonOutput.textContent);
                this.showNotification('GuideLLM JSON copied to clipboard!', 'success');
            } catch (error) {
                console.error('Failed to copy:', error);
                this.showNotification('Failed to copy JSON', 'error');
            }
        }
    }
    
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

