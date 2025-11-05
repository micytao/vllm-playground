// vLLM WebUI - Main JavaScript
class VLLMWebUI {
    constructor() {
        this.ws = null;
        this.chatHistory = [];
        this.serverRunning = false;
        this.serverReady = false;  // Track if server startup is complete
        this.autoScroll = true;
        this.benchmarkRunning = false;
        this.benchmarkPollInterval = null;
        
        // Resize state
        this.isResizing = false;
        this.currentResizer = null;
        this.resizeDirection = null;
        
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
            resetTemplateBtn: document.getElementById('reset-template-btn'),
            
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
            progressPercent: document.getElementById('progress-percent')
        };

        // Attach event listeners
        this.attachListeners();
        
        // Initialize resize functionality
        this.initResize();
        
        // Initialize compute mode (CPU is default)
        this.toggleComputeMode();
        
        // Update command preview initially
        this.updateCommandPreview();
        
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
        
        // Template Settings
        this.elements.templateSettingsToggle.addEventListener('click', () => this.toggleTemplateSettings());
        this.elements.resetTemplateBtn.addEventListener('click', () => this.resetTemplate());
        this.elements.modelSelect.addEventListener('change', () => this.updateTemplateForModel());
        this.elements.customModel.addEventListener('blur', () => this.updateTemplateForModel());
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
        
        // Add custom template and stop tokens if provided
        const customTemplate = this.elements.chatTemplate.value.trim();
        const customStopTokens = this.elements.stopTokens.value.trim();
        
        if (customTemplate) {
            config.custom_chat_template = customTemplate;
        }
        
        if (customStopTokens) {
            // Parse comma-separated stop tokens
            config.custom_stop_tokens = customStopTokens.split(',').map(t => t.trim()).filter(t => t.length > 0);
        }
        
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
        
        // Add system message at the start of conversation if provided and not already added
        const systemPrompt = this.elements.systemPrompt.value.trim();
        if (systemPrompt && this.chatHistory.length === 0) {
            this.chatHistory.push({role: 'system', content: systemPrompt});
            // Optionally display it in the chat
            this.addChatMessage('system', `System prompt set: ${systemPrompt}`);
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
            // Use streaming
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messages: this.chatHistory,
                    temperature: parseFloat(this.elements.temperature.value),
                    max_tokens: parseInt(this.elements.maxTokens.value),
                    stream: true
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
                                const delta = parsed.choices[0].delta;
                                
                                if (delta && delta.content) {
                                    // Capture time to first token
                                    if (firstTokenTime === null) {
                                        firstTokenTime = Date.now();
                                        console.log('Time to first token:', (firstTokenTime - startTime) / 1000, 'seconds');
                                    }
                                    
                                    fullText += delta.content;
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
                // Clean up response: trim and limit excessive newlines (4+ → 2)
                fullText = fullText.replace(/\n{4,}/g, '\n\n').trim();
                
                textSpan.textContent = fullText;
                this.chatHistory.push({role: 'assistant', content: fullText});
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
            
            // Fetch additional metrics from vLLM's metrics endpoint
            try {
                const metricsResponse = await fetch('/api/vllm/metrics');
                console.log('Metrics response status:', metricsResponse.status);
                
                if (metricsResponse.ok) {
                    const vllmMetrics = await metricsResponse.json();
                    console.log('✓ Fetched vLLM metrics:', vllmMetrics);
                    
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
            
            console.log('Metrics:', {
                promptTokens: estimatedPromptTokens,
                completionTokens: completionTokens,
                totalTokens: totalTokens,
                timeTaken: timeTaken,
                timeToFirstToken: timeToFirstToken,
                kvCacheUsage: kvCacheUsage,
                prefixCacheHitRate: prefixCacheHitRate
            });
            
            this.updateChatMetrics({
                promptTokens: estimatedPromptTokens,
                completionTokens: completionTokens,
                totalTokens: totalTokens,
                timeTaken: timeTaken,
                timeToFirstToken: timeToFirstToken,
                kvCacheUsage: kvCacheUsage,
                prefixCacheHitRate: prefixCacheHitRate
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
                // Handle both decimal (0.85) and percentage (85) formats
                let percentage;
                if (metrics.kvCacheUsage <= 1.0) {
                    // Decimal format (0.0 to 1.0)
                    percentage = (metrics.kvCacheUsage * 100).toFixed(1);
                } else {
                    // Already a percentage
                    percentage = metrics.kvCacheUsage.toFixed(1);
                }
                kvCacheUsageEl.textContent = `${percentage}%`;
            } else {
                kvCacheUsageEl.textContent = 'N/A';
            }
            kvCacheUsageEl.classList.add('updated');
            setTimeout(() => kvCacheUsageEl.classList.remove('updated'), 500);
        }
        
        if (prefixCacheHitEl) {
            // Prefix cache hit rate - from vLLM stats if available
            if (metrics.prefixCacheHitRate !== undefined && metrics.prefixCacheHitRate !== null) {
                // Handle both decimal (0.85) and percentage (85) formats
                let percentage;
                if (metrics.prefixCacheHitRate <= 1.0) {
                    // Decimal format (0.0 to 1.0)
                    percentage = (metrics.prefixCacheHitRate * 100).toFixed(1);
                } else {
                    // Already a percentage
                    percentage = metrics.prefixCacheHitRate.toFixed(1);
                }
                prefixCacheHitEl.textContent = `${percentage}%`;
            } else {
                prefixCacheHitEl.textContent = 'N/A';
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
    
    updateTemplateForModel() {
        const model = this.elements.customModel.value.trim() || this.elements.modelSelect.value;
        const template = this.getTemplateForModel(model);
        const stopTokens = this.getStopTokensForModel(model);
        
        this.elements.chatTemplate.value = template;
        this.elements.stopTokens.value = stopTokens.join(', ');
        
        console.log(`Template updated for model: ${model}`);
    }
    
    resetTemplate() {
        this.updateTemplateForModel();
        this.showNotification('Template reset to auto-detected values', 'success');
    }
    
    getTemplateForModel(modelName) {
        const model = modelName.toLowerCase();
        
        // Llama 2/3 models
        if (model.includes('llama-2') || model.includes('llama-3')) {
            return "{% for message in messages %}{% if message['role'] == 'system' %}<<SYS>>\\n{{ message['content'] }}\\n<</SYS>>\\n\\n{% endif %}{% if message['role'] == 'user' %}[INST] {{ message['content'] }} [/INST]{% endif %}{% if message['role'] == 'assistant' %} {{ message['content'] }}</s>{% endif %}{% endfor %}";
        }
        
        // Mistral models
        else if (model.includes('mistral') || model.includes('mixtral')) {
            return "{% for message in messages %}{% if message['role'] == 'user' %}[INST] {{ message['content'] }} [/INST]{% endif %}{% if message['role'] == 'assistant' %}{{ message['content'] }}</s>{% endif %}{% endfor %}";
        }
        
        // Gemma models
        else if (model.includes('gemma')) {
            return "{% for message in messages %}{% if message['role'] == 'user' %}<start_of_turn>user\\n{{ message['content'] }}<end_of_turn>\\n{% endif %}{% if message['role'] == 'assistant' %}<start_of_turn>model\\n{{ message['content'] }}<end_of_turn>\\n{% endif %}{% endfor %}<start_of_turn>model\\n";
        }
        
        // TinyLlama
        else if (model.includes('tinyllama') || model.includes('tiny-llama')) {
            return "{% for message in messages %}{% if message['role'] == 'system' %}<|system|>\\n{{ message['content'] }}</s>\\n{% endif %}{% if message['role'] == 'user' %}<|user|>\\n{{ message['content'] }}</s>\\n{% endif %}{% if message['role'] == 'assistant' %}<|assistant|>\\n{{ message['content'] }}</s>\\n{% endif %}{% endfor %}<|assistant|>\\n";
        }
        
        // Vicuna
        else if (model.includes('vicuna')) {
            return "{% for message in messages %}{% if message['role'] == 'system' %}{{ message['content'] }}\\n\\n{% endif %}{% if message['role'] == 'user' %}USER: {{ message['content'] }}\\n{% endif %}{% if message['role'] == 'assistant' %}ASSISTANT: {{ message['content'] }}</s>\\n{% endif %}{% endfor %}ASSISTANT:";
        }
        
        // Alpaca
        else if (model.includes('alpaca')) {
            return "{% for message in messages %}{% if message['role'] == 'system' %}{{ message['content'] }}\\n\\n{% endif %}{% if message['role'] == 'user' %}### Instruction:\\n{{ message['content'] }}\\n\\n{% endif %}{% if message['role'] == 'assistant' %}### Response:\\n{{ message['content'] }}\\n\\n{% endif %}{% endfor %}### Response:";
        }
        
        // CodeLlama
        else if (model.includes('codellama') || model.includes('code-llama')) {
            return "{% for message in messages %}{% if message['role'] == 'system' %}<<SYS>>\\n{{ message['content'] }}\\n<</SYS>>\\n\\n{% endif %}{% if message['role'] == 'user' %}[INST] {{ message['content'] }} [/INST]{% endif %}{% if message['role'] == 'assistant' %} {{ message['content'] }}</s>{% endif %}{% endfor %}";
        }
        
        // OPT and generic
        else {
            return "{% for message in messages %}{% if message['role'] == 'user' %}User: {{ message['content'] }}\\n{% elif message['role'] == 'assistant' %}Assistant: {{ message['content'] }}\\n{% elif message['role'] == 'system' %}{{ message['content'] }}\\n{% endif %}{% endfor %}Assistant:";
        }
    }
    
    getStopTokensForModel(modelName) {
        const model = modelName.toLowerCase();
        
        // Llama models
        if (model.includes('llama')) {
            return ["[INST]", "</s>", "<s>", "[/INST] [INST]"];
        }
        
        // Mistral models
        else if (model.includes('mistral') || model.includes('mixtral')) {
            return ["[INST]", "</s>", "[/INST] [INST]"];
        }
        
        // Gemma models
        else if (model.includes('gemma')) {
            return ["<start_of_turn>", "<end_of_turn>"];
        }
        
        // TinyLlama - more aggressive stop tokens to prevent rambling
        else if (model.includes('tinyllama') || model.includes('tiny-llama')) {
            return ["<|user|>", "<|system|>", "</s>", "\\n\\n", " #", "😊", "🤗", "🎉", "❤️", "User:", "Assistant:", "How about you?", "I'm doing"];
        }
        
        // Vicuna
        else if (model.includes('vicuna')) {
            return ["USER:", "ASSISTANT:", "</s>"];
        }
        
        // Alpaca
        else if (model.includes('alpaca')) {
            return ["### Instruction:", "### Response:"];
        }
        
        // Default generic stop tokens
        else {
            return ["\\n\\nUser:", "\\n\\nAssistant:"];
        }
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
            // Vertical resize: metrics section at the bottom
            // The handle is between main-content and metrics-section
            // We always resize the metrics panel
            this.resizingPanel = document.getElementById('metrics-panel');
            this.resizeMode = 'bottom';
            this.startHeight = this.resizingPanel.offsetHeight;
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
            // Vertical resize (bottom metrics section)
            const deltaY = e.clientY - this.startY;
            const newHeight = this.startHeight + deltaY; // Dragging down makes metrics bigger
            
            // Apply minimum height
            if (newHeight >= 200) {
                // Set height on both the outer section and inner panel
                this.resizingPanel.style.height = `${newHeight}px`;
                
                const metricsInnerPanel = this.resizingPanel.querySelector('.panel');
                if (metricsInnerPanel) {
                    metricsInnerPanel.style.height = `${newHeight}px`;
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
});

