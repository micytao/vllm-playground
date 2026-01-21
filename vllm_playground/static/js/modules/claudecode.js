/**
 * Claude Code Integration Module
 * 
 * This module provides Claude Code terminal functionality for vLLM Playground.
 * It handles terminal initialization, ttyd WebSocket communication, and UI updates.
 * 
 * Usage: Import and call initClaudeCodeModule(uiInstance) to add Claude Code methods to the UI class.
 */

/**
 * Initialize Claude Code module and add methods to the UI instance
 * @param {Object} ui - The VLLMWebUI instance
 */
export function initClaudeCodeModule(ui) {
    // Add Claude Code methods to the UI instance
    Object.assign(ui, ClaudeCodeMethods);
    
    // Initialize Claude Code
    ui.initClaudeCode();
}

/**
 * Claude Code Methods object - contains all Claude Code-related methods
 */
const ClaudeCodeMethods = {
    
    // ============================================
    // Initialization
    // ============================================
    
    initClaudeCode() {
        console.log('Initializing Claude Code module');
        
        // Initialize state
        this.claudeTerminal = null;
        this.claudeWebSocket = null;
        this.claudeFitAddon = null;
        this.claudeWebLinksAddon = null;
        this.ttydPort = null;
        this.claudeDataDisposable = null;  // Store onData disposable
        this.claudeResizeDisposable = null;  // Store onResize disposable
        this.claudeStatus = {
            ttydAvailable: false,
            claudeInstalled: false,
            vllmRunning: false
        };
        
        // Set up event listeners
        this.initClaudeCodeListeners();
        
        // Check initial status
        this.checkClaudeCodeStatus();
    },
    
    initClaudeCodeListeners() {
        // Install button
        const installBtn = document.getElementById('claude-install-btn');
        if (installBtn) {
            installBtn.addEventListener('click', () => this.installClaudeCode());
        }
        
        // Go to vLLM server links (multiple places)
        const gotoVllm = document.getElementById('claude-goto-vllm');
        if (gotoVllm) {
            gotoVllm.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchView('vllm-server');
            });
        }
        
        const gotoVllmConfig = document.getElementById('claude-goto-vllm-config');
        if (gotoVllmConfig) {
            gotoVllmConfig.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchView('vllm-server');
            });
        }
        
        const gotoVllmTools = document.getElementById('claude-goto-vllm-tools');
        if (gotoVllmTools) {
            gotoVllmTools.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchView('vllm-server');
            });
        }
        
        // Reconnect button
        const reconnectBtn = document.getElementById('claude-reconnect-btn');
        if (reconnectBtn) {
            reconnectBtn.addEventListener('click', () => this.reconnectClaudeTerminal());
        }
        
        // Clear button
        const clearBtn = document.getElementById('claude-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearClaudeTerminal());
        }
        
        // Handle window resize
        window.addEventListener('resize', () => {
            if (this.claudeTerminal && this.claudeFitAddon) {
                this.fitClaudeTerminal();
            }
        });
    },
    
    // ============================================
    // Status Management
    // ============================================
    
    async checkClaudeCodeStatus() {
        try {
            // Fetch both status and config
            const [statusResponse, configResponse] = await Promise.all([
                fetch('/api/claude-code/status'),
                fetch('/api/claude-code/config')
            ]);
            
            const statusData = await statusResponse.json();
            const configData = await configResponse.json();
            
            this.claudeStatus = {
                ttydAvailable: statusData.ttyd_available,
                claudeInstalled: statusData.claude_installed,
                vllmRunning: statusData.vllm_running,
                ttydRunning: statusData.ttyd_running,
                ttydPort: statusData.ttyd_port,
                claudePath: statusData.claude_path,
                claudeVersion: statusData.claude_version,
                // Config status
                configAvailable: configData.available,
                needsServedModelName: configData.needs_served_model_name || false,
                toolCallingEnabled: configData.tool_calling_enabled,
                toolCallingWarning: configData.tool_calling_warning,
                model: configData.model,
                port: configData.port
            };
            
            this.updateClaudeCodeUI();
            
        } catch (error) {
            console.error('Failed to check Claude Code status:', error);
            this.claudeStatus = {
                ttydAvailable: false,
                claudeInstalled: false,
                vllmRunning: false,
                configAvailable: false,
                needsServedModelName: false,
                toolCallingEnabled: false
            };
            this.updateClaudeCodeUI();
        }
    },
    
    updateClaudeCodeUI() {
        const statusEl = document.getElementById('claude-status');
        const ttydWarning = document.getElementById('claude-pty-warning');  // Reuse the same element ID
        const notInstalledWarning = document.getElementById('claude-not-installed');
        const vllmWarning = document.getElementById('claude-vllm-warning');
        const servedNameWarning = document.getElementById('claude-served-name-warning');
        const toolWarning = document.getElementById('claude-tool-warning');
        const terminalWrapper = document.getElementById('claude-terminal-wrapper');
        
        // Hide all warnings first
        if (ttydWarning) ttydWarning.style.display = 'none';
        if (notInstalledWarning) notInstalledWarning.style.display = 'none';
        if (vllmWarning) vllmWarning.style.display = 'none';
        if (servedNameWarning) servedNameWarning.style.display = 'none';
        if (toolWarning) toolWarning.style.display = 'none';
        if (terminalWrapper) terminalWrapper.style.display = 'none';
        
        // Determine overall readiness
        const isReady = this.claudeStatus.ttydAvailable && 
                       this.claudeStatus.claudeInstalled && 
                       this.claudeStatus.vllmRunning &&
                       this.claudeStatus.configAvailable &&
                       !this.claudeStatus.needsServedModelName;
        
        // Update status indicator
        if (statusEl) {
            statusEl.className = 'claude-header-status';
            
            if (!this.claudeStatus.ttydAvailable) {
                statusEl.classList.add('not-ready');
                statusEl.innerHTML = '<span>ttyd Not Available</span>';
            } else if (!this.claudeStatus.claudeInstalled) {
                statusEl.classList.add('not-ready');
                statusEl.innerHTML = '<span>Claude Not Installed</span>';
            } else if (!this.claudeStatus.vllmRunning) {
                statusEl.classList.add('not-ready');
                statusEl.innerHTML = '<span>vLLM Not Running</span>';
            } else if (this.claudeStatus.needsServedModelName) {
                statusEl.classList.add('not-ready');
                statusEl.innerHTML = '<span>Config Required</span>';
            } else if (!this.claudeStatus.toolCallingEnabled) {
                statusEl.classList.add('checking');
                statusEl.innerHTML = '<span>Tool Calling Off</span>';
            } else {
                statusEl.classList.add('ready');
                statusEl.innerHTML = '<span>Ready</span>';
            }
        }
        
        // Show appropriate content based on priority
        if (!this.claudeStatus.ttydAvailable) {
            if (ttydWarning) ttydWarning.style.display = 'flex';
        } else if (!this.claudeStatus.claudeInstalled) {
            if (notInstalledWarning) notInstalledWarning.style.display = 'flex';
        } else if (!this.claudeStatus.vllmRunning) {
            if (vllmWarning) vllmWarning.style.display = 'flex';
        } else if (this.claudeStatus.needsServedModelName) {
            if (servedNameWarning) servedNameWarning.style.display = 'flex';
        } else if (!this.claudeStatus.toolCallingEnabled) {
            // Show tool calling warning but still allow terminal (it's a soft warning)
            if (toolWarning) toolWarning.style.display = 'flex';
        } else {
            if (terminalWrapper) terminalWrapper.style.display = 'flex';
            // Initialize terminal if not already done
            if (!this.claudeTerminal) {
                this.initClaudeTerminal();
            }
        }
    },
    
    // ============================================
    // Terminal Management
    // ============================================
    
    initClaudeTerminal() {
        const terminalContainer = document.getElementById('claude-terminal');
        if (!terminalContainer) {
            console.error('Claude terminal container not found');
            return;
        }
        
        // Check if xterm is available
        if (typeof Terminal === 'undefined') {
            console.error('xterm.js not loaded');
            return;
        }
        
        // Create terminal instance
        this.claudeTerminal = new Terminal({
            cursorBlink: true,
            cursorStyle: 'block',
            fontSize: 14,
            fontFamily: "'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace",
            theme: {
                background: '#1a1a2e',
                foreground: '#e4e4e7',
                cursor: '#f59e0b',
                cursorAccent: '#1a1a2e',
                selection: 'rgba(139, 92, 246, 0.3)',
                black: '#27272a',
                red: '#ef4444',
                green: '#10b981',
                yellow: '#f59e0b',
                blue: '#3b82f6',
                magenta: '#8b5cf6',
                cyan: '#06b6d4',
                white: '#e4e4e7',
                brightBlack: '#52525b',
                brightRed: '#f87171',
                brightGreen: '#34d399',
                brightYellow: '#fbbf24',
                brightBlue: '#60a5fa',
                brightMagenta: '#a78bfa',
                brightCyan: '#22d3ee',
                brightWhite: '#fafafa'
            },
            allowTransparency: true,
            scrollback: 10000
        });
        
        // Load addons
        if (typeof FitAddon !== 'undefined') {
            this.claudeFitAddon = new FitAddon.FitAddon();
            this.claudeTerminal.loadAddon(this.claudeFitAddon);
        }
        
        if (typeof WebLinksAddon !== 'undefined') {
            this.claudeWebLinksAddon = new WebLinksAddon.WebLinksAddon();
            this.claudeTerminal.loadAddon(this.claudeWebLinksAddon);
        }
        
        // Open terminal in container
        this.claudeTerminal.open(terminalContainer);
        
        // Fit terminal to container
        this.fitClaudeTerminal();
        
        // Focus terminal
        this.claudeTerminal.focus();
        
        // Helper to ensure terminal is focused
        const focusTerminal = () => {
            if (this.claudeTerminal) {
                this.claudeTerminal.focus();
            }
        };
        
        // Focus terminal when clicking anywhere in terminal area
        terminalContainer.addEventListener('click', focusTerminal);
        
        // Store focus helper for later use
        this.focusClaudeTerminal = focusTerminal;
        
        // Connect to ttyd
        this.connectClaudeTerminal();
    },
    
    fitClaudeTerminal() {
        if (this.claudeFitAddon) {
            try {
                this.claudeFitAddon.fit();
            } catch (e) {
                console.warn('Failed to fit terminal:', e);
            }
        }
    },
    
    async connectClaudeTerminal() {
        // Dispose existing event handlers to prevent duplicates
        if (this.claudeDataDisposable) {
            this.claudeDataDisposable.dispose();
            this.claudeDataDisposable = null;
        }
        if (this.claudeResizeDisposable) {
            this.claudeResizeDisposable.dispose();
            this.claudeResizeDisposable = null;
        }
        
        // Close existing connection
        if (this.claudeWebSocket) {
            this.claudeWebSocket.close();
            this.claudeWebSocket = null;
        }
        
        this.claudeTerminal.writeln('\x1b[33m● Starting Claude Code terminal...\x1b[0m');
        
        try {
            // Start ttyd terminal via API
            console.log('Calling /api/claude-code/start-terminal...');
            const response = await fetch('/api/claude-code/start-terminal', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const data = await response.json();
            console.log('start-terminal response:', data);
            
            if (!data.success) {
                this.claudeTerminal.writeln(`\x1b[31m✗ Failed to start terminal: ${data.error}\x1b[0m`);
                console.error('Failed to start ttyd:', data.error);
                
                if (data.install_instructions) {
                    this.claudeTerminal.writeln('');
                    this.claudeTerminal.writeln('\x1b[33mInstall ttyd:\x1b[0m');
                    this.claudeTerminal.writeln(`  macOS:  ${data.install_instructions.macos}`);
                    this.claudeTerminal.writeln(`  Ubuntu: ${data.install_instructions.ubuntu}`);
                }
                return;
            }
            
            this.ttydPort = data.port;
            
            // Build WebSocket URL - handle both relative (/ws/ttyd) and absolute URLs
            let wsUrl = data.ws_url;
            if (wsUrl.startsWith('/')) {
                // Relative URL - build full WebSocket URL from current page
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                wsUrl = `${protocol}//${window.location.host}${wsUrl}`;
            }
            
            this.claudeTerminal.writeln(`\x1b[32m● ttyd started on port ${data.port}\x1b[0m`);
            this.claudeTerminal.writeln('\x1b[36m● Connecting to Claude Code...\x1b[0m');
            this.claudeTerminal.writeln('');
            
            console.log('Connecting to WebSocket:', wsUrl);
            
            // Connect to ttyd WebSocket (via our proxy)
            this.claudeWebSocket = new WebSocket(wsUrl);
            this.claudeWebSocket.binaryType = 'arraybuffer';
            
            this.claudeWebSocket.onopen = () => {
                console.log('ttyd WebSocket connected');
                
                const encoder = new TextEncoder();
                
                // ttyd protocol: First message MUST be JSON_DATA (starts with '{')
                // containing AuthToken to trigger process spawn
                const authMessage = JSON.stringify({ AuthToken: "" });
                this.claudeWebSocket.send(encoder.encode(authMessage));
                console.log('Sent JSON auth message to ttyd:', authMessage);
                
                // Focus terminal
                if (this.focusClaudeTerminal) this.focusClaudeTerminal();
                
                // Send resize after a small delay
                setTimeout(() => {
                    if (this.claudeWebSocket && this.claudeWebSocket.readyState === WebSocket.OPEN) {
                        this.fitClaudeTerminal();
                        
                        if (this.claudeTerminal) {
                            const cols = this.claudeTerminal.cols;
                            const rows = this.claudeTerminal.rows;
                            console.log('Sending resize to ttyd:', cols, 'x', rows);
                            
                            // ttyd resize format: type byte '1' + JSON
                            const resizeData = JSON.stringify({ columns: cols, rows: rows });
                            const jsonData = encoder.encode(resizeData);
                            const message = new Uint8Array(jsonData.length + 1);
                            message[0] = 49;  // ASCII '1' for resize
                            message.set(jsonData, 1);
                            this.claudeWebSocket.send(message);
                        }
                        
                        if (this.focusClaudeTerminal) this.focusClaudeTerminal();
                    }
                }, 200);
            };
            
            this.claudeWebSocket.onmessage = (event) => {
                // ttyd sends binary data
                if (event.data instanceof ArrayBuffer) {
                    const data = new Uint8Array(event.data);
                    
                    if (data.length === 0) {
                        console.log('ttyd: empty message received');
                        return;
                    }
                    
                    // ttyd protocol: first byte is ASCII character for message type
                    // '0' (48) = output, '1' (49) = set window title, '2' (50) = preferences
                    const msgType = data[0];
                    const payload = data.slice(1);
                    
                    console.log('ttyd message type:', msgType, 'payload length:', payload.length);
                    
                    if (msgType === 48) {  // ASCII '0' = output
                        const text = new TextDecoder().decode(payload);
                        this.claudeTerminal.write(text);
                    } else if (msgType === 49) {  // ASCII '1' = set window title
                        const text = new TextDecoder().decode(payload);
                        console.log('ttyd window title:', text);
                    } else if (msgType === 50) {  // ASCII '2' = preferences
                        const text = new TextDecoder().decode(payload);
                        console.log('ttyd preferences:', text);
                    } else {
                        // Unknown type - might be raw output without type prefix
                        console.log('ttyd unknown type:', msgType, '- treating as output');
                        const text = new TextDecoder().decode(data);
                        this.claudeTerminal.write(text);
                    }
                } else if (typeof event.data === 'string') {
                    // Text data - write directly
                    console.log('ttyd text message:', event.data.substring(0, 100));
                    this.claudeTerminal.write(event.data);
                }
            };
            
            this.claudeWebSocket.onclose = (event) => {
                console.log('ttyd WebSocket closed:', event.code);
                this.claudeTerminal.writeln('');
                this.claudeTerminal.writeln('\x1b[33m● Connection closed\x1b[0m');
                this.claudeWebSocket = null;
            };
            
            this.claudeWebSocket.onerror = (error) => {
                console.error('ttyd WebSocket error:', error);
                this.claudeTerminal.writeln('\x1b[31m✗ WebSocket error\x1b[0m');
            };
            
            // Handle terminal input - send to ttyd
            // Store disposable to prevent duplicate handlers on reconnect
            this.claudeDataDisposable = this.claudeTerminal.onData(data => {
                if (this.claudeWebSocket && this.claudeWebSocket.readyState === WebSocket.OPEN) {
                    // ttyd expects: type byte ASCII '0' (48) for input + data
                    const encoder = new TextEncoder();
                    const inputData = encoder.encode(data);
                    const message = new Uint8Array(inputData.length + 1);
                    message[0] = 48;  // ASCII '0' for input
                    message.set(inputData, 1);
                    this.claudeWebSocket.send(message);
                    console.log('Sent input to ttyd:', data.length, 'chars');
                }
            });
            
            // Handle terminal resize - send to ttyd
            // Store disposable to prevent duplicate handlers on reconnect
            this.claudeResizeDisposable = this.claudeTerminal.onResize(({ cols, rows }) => {
                if (this.claudeWebSocket && this.claudeWebSocket.readyState === WebSocket.OPEN) {
                    // ttyd resize: type byte ASCII '1' (49) + JSON {columns, rows}
                    const resizeData = JSON.stringify({ columns: cols, rows: rows });
                    const encoder = new TextEncoder();
                    const jsonData = encoder.encode(resizeData);
                    const message = new Uint8Array(jsonData.length + 1);
                    message[0] = 49;  // ASCII '1' for resize
                    message.set(jsonData, 1);
                    this.claudeWebSocket.send(message);
                    console.log('Sent resize to ttyd:', cols, 'x', rows);
                }
            });
            
            // Update connection info
            this.updateClaudeConnectionInfo({
                port: this.claudeStatus.port,
                model: this.claudeStatus.model
            });
            
        } catch (error) {
            console.error('Failed to connect to Claude terminal:', error);
            this.claudeTerminal.writeln(`\x1b[31m✗ Connection error: ${error.message}\x1b[0m`);
        }
    },
    
    updateClaudeConnectionInfo(message) {
        const endpointEl = document.getElementById('claude-endpoint');
        const modelEl = document.getElementById('claude-model-name');
        
        if (endpointEl && message.port) {
            endpointEl.textContent = `http://localhost:${message.port}`;
        }
        
        if (modelEl && message.model) {
            modelEl.textContent = `Model: ${message.model}`;
        }
    },
    
    // ============================================
    // Actions
    // ============================================
    
    async reconnectClaudeTerminal() {
        // Stop existing terminal
        await this.stopClaudeTerminal();
        
        if (this.claudeTerminal) {
            this.claudeTerminal.clear();
            this.claudeTerminal.writeln('\x1b[33m● Reconnecting...\x1b[0m');
            this.claudeTerminal.writeln('');
        }
        
        // Re-check status and reconnect
        await this.checkClaudeCodeStatus();
        
        if (this.claudeStatus.ttydAvailable && 
            this.claudeStatus.claudeInstalled && 
            this.claudeStatus.vllmRunning) {
            await this.connectClaudeTerminal();
        }
    },
    
    async stopClaudeTerminal() {
        // Close WebSocket
        if (this.claudeWebSocket) {
            this.claudeWebSocket.close();
            this.claudeWebSocket = null;
        }
        
        // Stop ttyd via API
        try {
            await fetch('/api/claude-code/stop-terminal', {
                method: 'POST'
            });
        } catch (error) {
            console.error('Failed to stop terminal:', error);
        }
    },
    
    clearClaudeTerminal() {
        if (this.claudeTerminal) {
            this.claudeTerminal.clear();
        }
    },
    
    async installClaudeCode() {
        const installBtn = document.getElementById('claude-install-btn');
        if (installBtn) {
            installBtn.disabled = true;
            installBtn.textContent = 'Installing...';
        }
        
        try {
            const response = await fetch('/api/claude-code/install', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ method: 'npm' })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showNotification('Claude Code installed successfully!', 'success');
                // Re-check status
                await this.checkClaudeCodeStatus();
            } else {
                this.showNotification(`Installation failed: ${data.message}`, 'error');
            }
        } catch (error) {
            console.error('Installation error:', error);
            this.showNotification(`Installation error: ${error.message}`, 'error');
        } finally {
            if (installBtn) {
                installBtn.disabled = false;
                installBtn.textContent = 'Install Claude Code';
            }
        }
    },
    
    // ============================================
    // View Lifecycle
    // ============================================
    
    onClaudeCodeViewActivated() {
        // Called when Claude Code view becomes active
        console.log('Claude Code view activated');
        
        // Refresh status
        this.checkClaudeCodeStatus();
        
        // Fit terminal and focus if exists
        if (this.claudeTerminal) {
            setTimeout(() => {
                if (this.claudeFitAddon) {
                    this.fitClaudeTerminal();
                }
                // Focus terminal
                if (this.focusClaudeTerminal) {
                    this.focusClaudeTerminal();
                } else {
                    this.claudeTerminal.focus();
                }
            }, 100);
        }
    },
    
    onClaudeCodeViewDeactivated() {
        // Called when Claude Code view is hidden
        console.log('Claude Code view deactivated');
    },
    
    // ============================================
    // Cleanup
    // ============================================
    
    async cleanupClaudeCode() {
        // Dispose event handlers
        if (this.claudeDataDisposable) {
            this.claudeDataDisposable.dispose();
            this.claudeDataDisposable = null;
        }
        if (this.claudeResizeDisposable) {
            this.claudeResizeDisposable.dispose();
            this.claudeResizeDisposable = null;
        }
        
        // Stop terminal
        await this.stopClaudeTerminal();
        
        // Dispose terminal
        if (this.claudeTerminal) {
            this.claudeTerminal.dispose();
            this.claudeTerminal = null;
        }
    }
};
