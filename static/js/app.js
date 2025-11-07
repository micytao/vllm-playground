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
        
        // Compression state
        this.compressionRunning = false;
        this.compressionPollInterval = null;
        this.selectedPreset = null;
        
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
            
            // CPU/GPU Mode
            modeCpu: document.getElementById('mode-cpu'),
            modeGpu: document.getElementById('mode-gpu'),
            modeCpuLabel: document.getElementById('mode-cpu-label'),
            modeGpuLabel: document.getElementById('mode-gpu-label'),
            modeHelpText: document.getElementById('mode-help-text'),
            cpuSettings: document.getElementById('cpu-settings'),
            gpuSettings: document.getElementById('gpu-settings'),
            
            // GPU settings
            tensorParallel: document.getElementById('tensor-parallel'),
            gpuMemory: document.getElementById('gpu-memory'),
            
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
            metricsDisplay: document.getElementById('metrics-display'),
            metricsGrid: document.getElementById('metrics-grid'),
            benchmarkProgress: document.getElementById('benchmark-progress'),
            progressFill: document.getElementById('progress-fill'),
            progressStatus: document.getElementById('progress-status'),
            progressPercent: document.getElementById('progress-percent'),
            
            // Compression elements
            runCompressionBtn: document.getElementById('run-compression-btn'),
            stopCompressionBtn: document.getElementById('stop-compression-btn'),
            presetsContainer: document.getElementById('presets-container'),
            compressModelSelect: document.getElementById('compress-model-select'),
            compressCustomModel: document.getElementById('compress-custom-model'),
            compressFormat: document.getElementById('compress-format'),
            compressAlgorithm: document.getElementById('compress-algorithm'),
            compressDataset: document.getElementById('compress-dataset'),
            compressSamples: document.getElementById('compress-samples'),
            compressSeqLength: document.getElementById('compress-seq-length'),
            compressHfToken: document.getElementById('compress-hf-token'),
            compressTargetLayers: document.getElementById('compress-target-layers'),
            compressIgnoreLayers: document.getElementById('compress-ignore-layers'),
            compressSmoothing: document.getElementById('compress-smoothing'),
            advancedToggle: document.getElementById('advanced-toggle'),
            advancedContent: document.getElementById('advanced-content'),
            compressCommandText: document.getElementById('compress-command-text'),
            copyCompressCommandBtn: document.getElementById('copy-compress-command-btn'),
            compressionStatusDisplay: document.getElementById('compression-status-display'),
            compressionStageBadge: document.getElementById('compression-stage-badge'),
            compressionProgressFill: document.getElementById('compression-progress-fill'),
            compressionProgressMessage: document.getElementById('compression-progress-message'),
            compressionProgressPercent: document.getElementById('compression-progress-percent'),
            sizeComparison: document.getElementById('size-comparison'),
            originalSize: document.getElementById('original-size'),
            compressedSize: document.getElementById('compressed-size'),
            compressionRatio: document.getElementById('compression-ratio'),
            outputDirectoryDisplay: document.getElementById('output-directory-display'),
            outputDirPath: document.getElementById('output-dir-path'),
            compressionActions: document.getElementById('compression-actions'),
            downloadCompressedBtn: document.getElementById('download-compressed-btn'),
            loadCompressedBtn: document.getElementById('load-compressed-btn'),
            newCompressionBtn: document.getElementById('new-compression-btn')
        };

        // Attach event listeners
        this.attachListeners();
        
        // Initialize resize functionality
        this.initResize();
        
        // Initialize compute mode (CPU is default)
        this.toggleComputeMode();
        
        // Update command preview initially
        this.updateCommandPreview();
        
        // Initialize chat template for default model (silent mode - no notification)
        this.updateTemplateForModel(true);
        
        // Load compression presets
        this.loadCompressionPresets();
        
        // Initialize compression command preview
        this.updateCompressCommandPreview();
        
        // Connect WebSocket for logs
        this.connectWebSocket();
        
        // Start status polling
        this.pollStatus();
        setInterval(() => this.pollStatus(), 3000);
    }

    attachListeners() {
        // Server control
        this.elements.startBtn.addEventListener('click', () => this.startServer());
        this.elements.stopBtn.addEventListener('click', () => this.stopServer());
        
        // CPU/GPU mode toggle
        this.elements.modeCpu.addEventListener('change', () => this.toggleComputeMode());
        this.elements.modeGpu.addEventListener('change', () => this.toggleComputeMode());
        
        // Chat
        this.elements.sendBtn.addEventListener('click', () => this.sendMessage());
        this.elements.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                this.sendMessage();
            }
        });
        this.elements.clearChatBtn.addEventListener('click', () => this.clearChat());
        this.elements.clearSystemPromptBtn.addEventListener('click', () => this.clearSystemPrompt());
        
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
        
        // Compression
        this.elements.runCompressionBtn.addEventListener('click', () => this.runCompression());
        this.elements.stopCompressionBtn.addEventListener('click', () => this.stopCompression());
        this.elements.advancedToggle.addEventListener('click', () => this.toggleAdvancedOptions());
        this.elements.downloadCompressedBtn.addEventListener('click', () => this.downloadCompressed());
        this.elements.loadCompressedBtn.addEventListener('click', () => this.loadCompressedIntoVLLM());
        this.elements.newCompressionBtn.addEventListener('click', () => this.resetCompression());
        this.elements.copyCompressCommandBtn.addEventListener('click', () => this.copyCompressCommand());
        this.elements.outputDirPath.addEventListener('click', () => this.copyOutputPath());
        
        // Compression config changes - update command preview
        const compressConfigElements = [
            this.elements.compressModelSelect,
            this.elements.compressCustomModel,
            this.elements.compressFormat,
            this.elements.compressAlgorithm,
            this.elements.compressDataset,
            this.elements.compressSamples,
            this.elements.compressSeqLength,
            this.elements.compressHfToken,
            this.elements.compressTargetLayers,
            this.elements.compressIgnoreLayers,
            this.elements.compressSmoothing
        ];
        
        compressConfigElements.forEach(element => {
            element.addEventListener('input', () => this.updateCompressCommandPreview());
            element.addEventListener('change', () => this.updateCompressCommandPreview());
        });
        
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

    getConfig() {
        const model = this.elements.customModel.value.trim() || this.elements.modelSelect.value;
        const maxModelLen = this.elements.maxModelLen.value;
        const isCpuMode = this.elements.modeCpu.checked;
        const hfToken = this.elements.hfToken.value.trim();
        
        const config = {
            model: model,
            host: this.elements.host.value,
            port: parseInt(this.elements.port.value),
            dtype: this.elements.dtype.value,
            max_model_len: maxModelLen ? parseInt(maxModelLen) : null,
            trust_remote_code: this.elements.trustRemoteCode.checked,
            enable_prefix_caching: this.elements.enablePrefixCaching.checked,
            disable_log_stats: this.elements.disableLogStats.checked,
            use_cpu: isCpuMode,
            hf_token: hfToken || null  // Include HF token for gated models
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
        }
        
        return config;
    }

    async startServer() {
        const config = this.getConfig();
        
        // Check if gated model requires HF token (frontend validation)
        // Meta Llama models (official and RedHatAI) are gated in our supported list
        const model = config.model.toLowerCase();
        const isGated = model.includes('meta-llama/') || model.includes('redhatai/llama');
        
        if (isGated && !config.hf_token) {
            this.showNotification(`⚠️ ${config.model} is a gated model and requires a HuggingFace token!`, 'error');
            this.addLog(`❌ Gated model requires HF token: ${config.model}`, 'error');
            return;
        }
        
        // Reset ready state
        this.serverReady = false;
        this.elements.sendBtn.classList.remove('btn-ready');
        
        this.elements.startBtn.disabled = true;
        this.elements.startBtn.textContent = 'Starting...';
        
        // Add immediate log feedback
        this.addLog('🚀 Starting vLLM server...', 'info');
        this.addLog(`Model: ${config.model}`, 'info');
        this.addLog(`Mode: ${config.use_cpu ? 'CPU' : 'GPU'}`, 'info');
        
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
            this.addLog(`✅ Server started with PID: ${data.pid}`, 'success');
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
            if (hfToken) {
                cmd = `# Set HF token for gated models:\n`;
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
            output_tokens: parseInt(this.elements.benchmarkOutputTokens.value)
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

            if (data.running) {
                // Update progress (estimate based on time)
                // This is approximate since we don't have real-time progress
                const elapsed = Date.now() - this.benchmarkStartTime;
                const estimated = (this.elements.benchmarkRequests.value / this.elements.benchmarkRate.value) * 1000;
                const progress = Math.min(95, (elapsed / estimated) * 100);
                
                this.elements.progressFill.style.width = `${progress}%`;
                this.elements.progressPercent.textContent = `${progress.toFixed(0)}%`;
            } else {
                // Benchmark complete
                clearInterval(this.benchmarkPollInterval);
                this.benchmarkPollInterval = null;

                if (data.results) {
                    this.displayBenchmarkResults(data.results);
                    this.showNotification('Benchmark completed!', 'success');
                } else {
                    this.showNotification('Benchmark failed', 'error');
                }

                this.resetBenchmarkUI();
            }
        } catch (err) {
            console.error('Failed to poll benchmark status:', err);
        }
    }

    displayBenchmarkResults(results) {
        // Hide progress, show metrics
        this.elements.benchmarkProgress.style.display = 'none';
        this.elements.metricsGrid.style.display = 'grid';

        // Update metric cards
        document.getElementById('metric-throughput').textContent = `${results.throughput} req/s`;
        document.getElementById('metric-latency').textContent = `${results.avg_latency} ms`;
        document.getElementById('metric-tokens-per-sec').textContent = `${results.tokens_per_second} tok/s`;
        document.getElementById('metric-p50').textContent = `${results.p50_latency} ms`;
        document.getElementById('metric-p95').textContent = `${results.p95_latency} ms`;
        document.getElementById('metric-p99').textContent = `${results.p99_latency} ms`;
        document.getElementById('metric-total-tokens').textContent = results.total_tokens.toLocaleString();
        document.getElementById('metric-success-rate').textContent = `${results.success_rate} %`;

        // Animate cards
        document.querySelectorAll('.metric-card').forEach((card, index) => {
            setTimeout(() => {
                card.classList.add('updated');
                setTimeout(() => card.classList.remove('updated'), 500);
            }, index * 50);
        });
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
            if (handle.id === 'compression-resize-handle') {
                // Handle between main-content and compression section
                this.resizingPanel = document.getElementById('compression-panel');
                this.resizeMode = 'bottom';
                this.startHeight = this.resizingPanel.offsetHeight;
            } else if (handle.id === 'metrics-resize-handle') {
                // Handle between compression and metrics sections
                this.resizingPanel = document.getElementById('metrics-panel');
                this.resizeMode = 'bottom';
                this.startHeight = this.resizingPanel.offsetHeight;
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
            compressionHeight: document.getElementById('compression-panel')?.offsetHeight,
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
                
                if (layout.compressionHeight) {
                    const compressionPanel = document.getElementById('compression-panel');
                    if (compressionPanel) {
                        compressionPanel.style.height = `${layout.compressionHeight}px`;
                        const innerPanel = compressionPanel.querySelector('.panel');
                        if (innerPanel) innerPanel.style.height = `${layout.compressionHeight}px`;
                    }
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
    
    // ============ Compression Functions ============
    
    async loadCompressionPresets() {
        try {
            const response = await fetch('/api/compress/presets');
            if (response.ok) {
                const data = await response.json();
                this.displayPresets(data.presets);
            }
        } catch (error) {
            console.error('Failed to load compression presets:', error);
            this.elements.presetsContainer.innerHTML = '<div class="preset-error">Failed to load presets</div>';
        }
    }
    
    displayPresets(presets) {
        this.elements.presetsContainer.innerHTML = '';
        
        presets.forEach(preset => {
            const presetCard = document.createElement('div');
            presetCard.className = 'preset-card';
            presetCard.innerHTML = `
                <div class="preset-emoji">${preset.emoji}</div>
                <div class="preset-name">${preset.name}</div>
                <div class="preset-description">${preset.description}</div>
                <div class="preset-stats">
                    <span class="preset-stat">⚡ ${preset.expected_speedup}</span>
                    <span class="preset-stat">📦 ${preset.size_reduction}</span>
                </div>
            `;
            
            presetCard.addEventListener('click', () => this.applyPreset(preset));
            this.elements.presetsContainer.appendChild(presetCard);
        });
    }
    
    applyPreset(preset) {
        // Apply preset configuration
        this.selectedPreset = preset;
        this.elements.compressFormat.value = preset.quantization_format;
        this.elements.compressAlgorithm.value = preset.algorithm;
        
        // Update command preview with new preset values
        this.updateCompressCommandPreview();
        
        // Visual feedback
        document.querySelectorAll('.preset-card').forEach(card => {
            card.classList.remove('selected');
        });
        event.target.closest('.preset-card').classList.add('selected');
        
        this.showNotification(`Applied preset: ${preset.name}`, 'success');
    }
    
    toggleAdvancedOptions() {
        const content = this.elements.advancedContent;
        const icon = this.elements.advancedToggle.querySelector('.toggle-icon');
        const rightColumn = document.querySelector('.compression-right-column');
        
        if (content.style.display === 'none') {
            content.style.display = 'block';
            icon.classList.add('open');
            // Add class to indicate advanced options are expanded
            rightColumn.classList.add('advanced-expanded');
        } else {
            content.style.display = 'none';
            icon.classList.remove('open');
            // Remove class when advanced options are collapsed
            rightColumn.classList.remove('advanced-expanded');
        }
    }
    
    async runCompression() {
        if (this.compressionRunning) {
            this.showNotification('Compression already running', 'warning');
            return;
        }
        
        // Get model from dropdown or custom input
        const model = this.elements.compressCustomModel.value.trim() || 
                     this.elements.compressModelSelect.value;
        
        if (!model) {
            this.showNotification('Please select or enter a model', 'error');
            return;
        }
        
        // Check if gated model requires HF token
        const model_lower = model.toLowerCase();
        const isGated = model_lower.includes('meta-llama/') || 
                       model_lower.includes('redhatai/llama') ||
                       model_lower.includes('gated');
        
        const hfToken = this.elements.compressHfToken?.value?.trim() || null;
        
        if (isGated && !hfToken) {
            this.showNotification(`⚠️ ${model} is a gated model and requires a HuggingFace token!`, 'error');
            this.addLog(`❌ Gated model requires HF token: ${model}`, 'error');
            return;
        }
        
        const config = {
            model: model,
            quantization_format: this.elements.compressFormat.value,
            algorithm: this.elements.compressAlgorithm.value,
            dataset: this.elements.compressDataset.value,
            num_calibration_samples: parseInt(this.elements.compressSamples.value),
            max_seq_length: parseInt(this.elements.compressSeqLength.value),
            target_layers: this.elements.compressTargetLayers.value,
            ignore_layers: this.elements.compressIgnoreLayers.value,
            smoothing_strength: parseFloat(this.elements.compressSmoothing.value),
            hf_token: hfToken
        };
        
        console.log('Starting compression with config:', config);
        
        this.compressionRunning = true;
        this.elements.runCompressionBtn.disabled = true;
        this.elements.runCompressionBtn.style.display = 'none';
        this.elements.stopCompressionBtn.disabled = false;
        this.elements.stopCompressionBtn.style.display = 'inline-block';
        // Status display is always visible now
        
        try {
            const response = await fetch('/api/compress/start', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(config)
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to start compression');
            }
            
            // Start polling for status
            this.compressionPollInterval = setInterval(() => this.pollCompressionStatus(), 2000);
            this.showNotification('Compression started', 'success');
            
        } catch (error) {
            console.error('Failed to start compression:', error);
            this.showNotification(`Failed to start: ${error.message}`, 'error');
            this.resetCompressionUI();
        }
    }
    
    async stopCompression() {
        try {
            await fetch('/api/compress/stop', {method: 'POST'});
            this.showNotification('Compression stopped', 'info');
        } catch (error) {
            console.error('Failed to stop compression:', error);
        }
        this.resetCompressionUI();
    }
    
    async pollCompressionStatus() {
        try {
            const response = await fetch('/api/compress/status');
            const status = await response.json();
            
            this.updateCompressionStatus(status);
            
            if (!status.running && (status.stage === 'complete' || status.stage === 'error' || status.stage === 'cancelled')) {
                clearInterval(this.compressionPollInterval);
                this.compressionPollInterval = null;
                this.compressionRunning = false;
                
                if (status.stage === 'complete') {
                    this.showNotification('Compression completed!', 'success');
                    this.elements.compressionActions.style.display = 'block';
                } else if (status.stage === 'error') {
                    this.showNotification(`Compression failed: ${status.error}`, 'error');
                }
                
                this.elements.stopCompressionBtn.disabled = true;
                this.elements.stopCompressionBtn.style.display = 'none';
            }
        } catch (error) {
            console.error('Failed to poll compression status:', error);
        }
    }
    
    updateCompressionStatus(status) {
        // Update progress bar with smooth transition
        this.elements.compressionProgressFill.style.transition = 'width 0.5s ease';
        this.elements.compressionProgressFill.style.width = `${status.progress}%`;
        this.elements.compressionProgressPercent.textContent = `${status.progress.toFixed(0)}%`;
        this.elements.compressionProgressMessage.textContent = status.message;
        
        // Update stage badge
        this.elements.compressionStageBadge.textContent = status.stage.toUpperCase();
        this.elements.compressionStageBadge.className = `stage-badge stage-${status.stage}`;
        
        // Update size comparison if available
        if (status.original_size_mb || status.compressed_size_mb) {
            this.elements.sizeComparison.style.display = 'flex';
            
            if (status.original_size_mb) {
                this.elements.originalSize.textContent = `${status.original_size_mb.toFixed(0)} MB`;
            }
            
            if (status.compressed_size_mb) {
                this.elements.compressedSize.textContent = `${status.compressed_size_mb.toFixed(0)} MB`;
            }
            
            if (status.compression_ratio) {
                this.elements.compressionRatio.textContent = `${status.compression_ratio.toFixed(2)}x`;
            }
        }
        
        // Update output directory display if available
        if (status.output_dir) {
            this.elements.outputDirectoryDisplay.style.display = 'block';
            this.elements.outputDirPath.textContent = status.output_dir;
        }
    }
    
    resetCompressionUI() {
        this.compressionRunning = false;
        this.elements.runCompressionBtn.disabled = false;
        this.elements.runCompressionBtn.style.display = 'inline-block';
        this.elements.stopCompressionBtn.disabled = true;
        this.elements.stopCompressionBtn.style.display = 'none';
        
        if (this.compressionPollInterval) {
            clearInterval(this.compressionPollInterval);
            this.compressionPollInterval = null;
        }
    }
    
    resetCompression() {
        // Don't hide the status display anymore - it's always visible
        this.elements.compressionActions.style.display = 'none';
        this.elements.sizeComparison.style.display = 'none';
        this.elements.outputDirectoryDisplay.style.display = 'none';
        this.elements.compressionProgressFill.style.width = '0%';
        this.elements.compressionProgressPercent.textContent = '0%';
        this.elements.compressionProgressMessage.textContent = 'Ready to compress';
        this.elements.compressionStageBadge.textContent = 'IDLE';
        this.elements.compressionStageBadge.className = 'stage-badge stage-idle';
        this.resetCompressionUI();
        this.showNotification('Ready for new compression', 'success');
    }
    
    async downloadCompressed() {
        try {
            window.open('/api/compress/download', '_blank');
            this.showNotification('Downloading compressed model...', 'success');
        } catch (error) {
            console.error('Failed to download:', error);
            this.showNotification('Failed to download model', 'error');
        }
    }
    
    async loadCompressedIntoVLLM() {
        this.showNotification('Loading compressed model into vLLM...', 'info');
        // This would require updating the server config with the compressed model path
        // For now, show instructions to user
        alert('To load the compressed model:\n\n1. Download the compressed model\n2. Extract it to a directory\n3. Stop the current vLLM server\n4. Update the model path in configuration\n5. Start the server with the new model');
    }
    
    async copyOutputPath() {
        const path = this.elements.outputDirPath.textContent;
        if (path && path !== '--') {
            try {
                await navigator.clipboard.writeText(path);
                this.showNotification('Output path copied to clipboard!', 'success');
            } catch (error) {
                console.error('Failed to copy:', error);
                this.showNotification('Failed to copy path', 'error');
            }
        }
    }
    
    // ============ Compression Command Preview ============
    
    updateCompressCommandPreview() {
        const model = this.elements.compressCustomModel.value.trim() || 
                     this.elements.compressModelSelect.value;
        const format = this.elements.compressFormat.value;
        const algorithm = this.elements.compressAlgorithm.value;
        const dataset = this.elements.compressDataset.value;
        const samples = this.elements.compressSamples.value;
        const seqLength = this.elements.compressSeqLength.value;
        const targetLayers = this.elements.compressTargetLayers.value;
        const ignoreLayers = this.elements.compressIgnoreLayers.value;
        const smoothing = this.elements.compressSmoothing.value;
        const hfToken = this.elements.compressHfToken?.value?.trim() || '';
        
        // Check if gated model
        const model_lower = model.toLowerCase();
        const isGated = model_lower.includes('meta-llama/') || 
                       model_lower.includes('redhatai/llama') ||
                       model_lower.includes('gated');
        
        // Build Python script command
        let cmd = '# Compression using LLM-Compressor\n';
        cmd += 'from llmcompressor import oneshot\n';
        
        if (algorithm === 'SmoothQuant') {
            cmd += 'from llmcompressor.modifiers.smoothquant import SmoothQuantModifier\n';
        }
        cmd += 'from llmcompressor.modifiers.quantization import GPTQModifier\n\n';
        
        if (isGated || hfToken) {
            cmd += '# Set HuggingFace token for gated model\n';
            cmd += 'import os\n';
            if (hfToken) {
                // Mask the token for security (show first 7 chars like "hf_xxxx...")
                const maskedToken = hfToken.length > 7 ? hfToken.substring(0, 7) + '...' : '***';
                cmd += `os.environ["HF_TOKEN"] = "${maskedToken}"  # Your actual token\n\n`;
            } else {
                cmd += 'os.environ["HF_TOKEN"] = "YOUR_HF_TOKEN_HERE"\n\n';
            }
        }
        
        cmd += '# Build compression recipe\n';
        cmd += 'recipe = [\n';
        
        if (algorithm === 'SmoothQuant') {
            cmd += `    SmoothQuantModifier(smoothing_strength=${smoothing}),\n`;
        }
        
        // Map format to scheme
        const schemeMap = {
            'W8A8_INT8': 'W8A8',
            'W8A8_FP8': 'W8A8_FP8',
            'W4A16': 'W4A16',
            'W8A16': 'W8A16',
            'FP4_W4A16': 'W4A16',
            'FP4_W4A4': 'W4A4',
            'W4A4': 'W4A4',
        };
        const scheme = schemeMap[format] || 'W8A8';
        
        cmd += `    GPTQModifier(\n`;
        cmd += `        scheme="${scheme}",\n`;
        cmd += `        targets="${targetLayers}",\n`;
        cmd += `        ignore=["${ignoreLayers}"]\n`;
        cmd += `    )\n`;
        cmd += ']\n\n';
        
        cmd += '# Run compression\n';
        cmd += 'oneshot(\n';
        cmd += `    model="${model}",\n`;
        cmd += `    dataset="${dataset}",\n`;
        cmd += `    recipe=recipe,\n`;
        cmd += `    output_dir="./compressed_model",\n`;
        cmd += `    max_seq_length=${seqLength},\n`;
        cmd += `    num_calibration_samples=${samples}\n`;
        cmd += ')';
        
        this.elements.compressCommandText.value = cmd;
    }
    
    async copyCompressCommand() {
        const commandText = this.elements.compressCommandText.value;
        
        try {
            await navigator.clipboard.writeText(commandText);
            
            // Visual feedback
            const originalText = this.elements.copyCompressCommandBtn.textContent;
            this.elements.copyCompressCommandBtn.textContent = 'Copied!';
            this.elements.copyCompressCommandBtn.classList.add('copied');
            
            setTimeout(() => {
                this.elements.copyCompressCommandBtn.textContent = originalText;
                this.elements.copyCompressCommandBtn.classList.remove('copied');
            }, 2000);
            
            this.showNotification('Command copied to clipboard!', 'success');
        } catch (err) {
            console.error('Failed to copy command:', err);
            this.showNotification('Failed to copy command', 'error');
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
    
    // Initialize compression section resize functionality
    initCompressionResize();
});

/**
 * Initialize resize functionality for compression section
 */
function initCompressionResize() {
    const presetsSection = document.querySelector('.compression-presets');
    const leftColumn = document.querySelector('.compression-left-column');
    const commandPreview = document.querySelector('.compression-command-preview');
    
    if (!presetsSection || !leftColumn || !commandPreview) return;
    
    let isResizing = false;
    let startY = 0;
    let startHeight = 0;
    
    // Create a visual resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'compression-resize-divider';
    resizeHandle.style.cssText = `
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 8px;
        cursor: row-resize;
        background: transparent;
        z-index: 10;
        transition: background 0.2s;
    `;
    presetsSection.style.position = 'relative';
    presetsSection.appendChild(resizeHandle);
    
    // Hover effect
    resizeHandle.addEventListener('mouseenter', () => {
        resizeHandle.style.background = 'rgba(79, 70, 229, 0.3)';
    });
    
    resizeHandle.addEventListener('mouseleave', () => {
        if (!isResizing) {
            resizeHandle.style.background = 'transparent';
        }
    });
    
    // Start resize
    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startY = e.clientY;
        startHeight = presetsSection.offsetHeight;
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });
    
    // Handle resize
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const deltaY = e.clientY - startY;
        const newHeight = Math.max(150, Math.min(startHeight + deltaY, 500));
        presetsSection.style.height = `${newHeight}px`;
        presetsSection.style.flexBasis = `${newHeight}px`;
        presetsSection.style.flex = `0 0 ${newHeight}px`;
    });
    
    // Stop resize
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            resizeHandle.style.background = 'transparent';
        }
    });
}


