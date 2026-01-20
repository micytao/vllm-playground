/**
 * Claude Code Integration Module
 * 
 * This module provides Claude Code terminal functionality for vLLM Playground.
 * It handles terminal initialization, WebSocket communication, and UI updates.
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
        this.claudeStatus = {
            terminalAvailable: false,
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
                terminalAvailable: statusData.terminal_available,
                claudeInstalled: statusData.claude_installed,
                vllmRunning: statusData.vllm_running,
                claudePath: statusData.claude_path,
                claudeVersion: statusData.claude_version,
                // Config status
                configAvailable: configData.available,
                needsServedModelName: configData.needs_served_model_name || false,
                toolCallingEnabled: configData.tool_calling_enabled,
                toolCallingWarning: configData.tool_calling_warning
            };
            
            this.updateClaudeCodeUI();
            
        } catch (error) {
            console.error('Failed to check Claude Code status:', error);
            this.claudeStatus = {
                terminalAvailable: false,
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
        const ptyWarning = document.getElementById('claude-pty-warning');
        const notInstalledWarning = document.getElementById('claude-not-installed');
        const vllmWarning = document.getElementById('claude-vllm-warning');
        const servedNameWarning = document.getElementById('claude-served-name-warning');
        const toolWarning = document.getElementById('claude-tool-warning');
        const terminalWrapper = document.getElementById('claude-terminal-wrapper');
        
        // Hide all warnings first
        if (ptyWarning) ptyWarning.style.display = 'none';
        if (notInstalledWarning) notInstalledWarning.style.display = 'none';
        if (vllmWarning) vllmWarning.style.display = 'none';
        if (servedNameWarning) servedNameWarning.style.display = 'none';
        if (toolWarning) toolWarning.style.display = 'none';
        if (terminalWrapper) terminalWrapper.style.display = 'none';
        
        // Determine overall readiness
        const isReady = this.claudeStatus.terminalAvailable && 
                       this.claudeStatus.claudeInstalled && 
                       this.claudeStatus.vllmRunning &&
                       this.claudeStatus.configAvailable &&
                       !this.claudeStatus.needsServedModelName;
        
        // Update status indicator
        if (statusEl) {
            statusEl.className = 'claude-header-status';
            
            if (!this.claudeStatus.terminalAvailable) {
                statusEl.classList.add('not-ready');
                statusEl.innerHTML = '<span>❌ Terminal Not Available</span>';
            } else if (!this.claudeStatus.claudeInstalled) {
                statusEl.classList.add('not-ready');
                statusEl.innerHTML = '<span>📦 Claude Not Installed</span>';
            } else if (!this.claudeStatus.vllmRunning) {
                statusEl.classList.add('not-ready');
                statusEl.innerHTML = '<span>vLLM Not Running</span>';
            } else if (this.claudeStatus.needsServedModelName) {
                statusEl.classList.add('not-ready');
                statusEl.innerHTML = '<span>⚠️ Config Required</span>';
            } else if (!this.claudeStatus.toolCallingEnabled) {
                statusEl.classList.add('checking');
                statusEl.innerHTML = '<span>⚠️ Tool Calling Off</span>';
            } else {
                statusEl.classList.add('ready');
                statusEl.innerHTML = '<span>✅ Ready</span>';
            }
        }
        
        // Show appropriate content based on priority
        if (!this.claudeStatus.terminalAvailable) {
            if (ptyWarning) ptyWarning.style.display = 'flex';
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
        
        // Connect to WebSocket
        this.connectClaudeWebSocket();
        
        // Handle terminal input
        this.claudeTerminal.onData(data => {
            if (this.claudeWebSocket && this.claudeWebSocket.readyState === WebSocket.OPEN) {
                this.claudeWebSocket.send(JSON.stringify({
                    type: 'input',
                    data: data
                }));
            }
        });
        
        // Handle terminal resize
        this.claudeTerminal.onResize(({ cols, rows }) => {
            if (this.claudeWebSocket && this.claudeWebSocket.readyState === WebSocket.OPEN) {
                this.claudeWebSocket.send(JSON.stringify({
                    type: 'resize',
                    cols: cols,
                    rows: rows
                }));
            }
        });
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
    
    connectClaudeWebSocket() {
        // Close existing connection
        if (this.claudeWebSocket) {
            this.claudeWebSocket.close();
        }
        
        // Create WebSocket connection
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/terminal`;
        
        this.claudeWebSocket = new WebSocket(wsUrl);
        
        this.claudeWebSocket.onopen = () => {
            console.log('Claude Code terminal WebSocket connected');
            this.claudeTerminal.writeln('\x1b[32m● Connected to Claude Code terminal\x1b[0m');
            this.claudeTerminal.writeln('');
        };
        
        this.claudeWebSocket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                
                switch (message.type) {
                    case 'output':
                        this.claudeTerminal.write(message.data);
                        break;
                    
                    case 'connected':
                        this.claudeTerminal.writeln(`\x1b[36m${message.message}\x1b[0m`);
                        this.claudeTerminal.writeln('');
                        // Update connection info
                        this.updateClaudeConnectionInfo(message);
                        break;
                    
                    case 'error':
                        this.claudeTerminal.writeln(`\x1b[31m✗ Error: ${message.message}\x1b[0m`);
                        break;
                    
                    case 'pong':
                        // Heartbeat response
                        break;
                    
                    default:
                        console.log('Unknown message type:', message.type);
                }
            } catch (e) {
                // Plain text message
                this.claudeTerminal.write(event.data);
            }
        };
        
        this.claudeWebSocket.onclose = (event) => {
            console.log('Claude Code terminal WebSocket closed:', event.code);
            this.claudeTerminal.writeln('');
            this.claudeTerminal.writeln('\x1b[33m● Connection closed\x1b[0m');
        };
        
        this.claudeWebSocket.onerror = (error) => {
            console.error('Claude Code terminal WebSocket error:', error);
            this.claudeTerminal.writeln('\x1b[31m✗ WebSocket error\x1b[0m');
        };
        
        // Start heartbeat
        this.startClaudeHeartbeat();
    },
    
    startClaudeHeartbeat() {
        // Clear existing heartbeat
        if (this.claudeHeartbeatInterval) {
            clearInterval(this.claudeHeartbeatInterval);
        }
        
        // Send ping every 30 seconds
        this.claudeHeartbeatInterval = setInterval(() => {
            if (this.claudeWebSocket && this.claudeWebSocket.readyState === WebSocket.OPEN) {
                this.claudeWebSocket.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000);
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
    
    reconnectClaudeTerminal() {
        if (this.claudeTerminal) {
            this.claudeTerminal.clear();
            this.claudeTerminal.writeln('\x1b[33m● Reconnecting...\x1b[0m');
            this.claudeTerminal.writeln('');
        }
        
        // Re-check status and reconnect
        this.checkClaudeCodeStatus().then(() => {
            if (this.claudeStatus.terminalAvailable && 
                this.claudeStatus.claudeInstalled && 
                this.claudeStatus.vllmRunning) {
                this.connectClaudeWebSocket();
            }
        });
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
        
        // Fit terminal if exists
        if (this.claudeTerminal && this.claudeFitAddon) {
            setTimeout(() => this.fitClaudeTerminal(), 100);
        }
    },
    
    onClaudeCodeViewDeactivated() {
        // Called when Claude Code view is hidden
        console.log('Claude Code view deactivated');
    },
    
    // ============================================
    // Cleanup
    // ============================================
    
    cleanupClaudeCode() {
        // Clear heartbeat
        if (this.claudeHeartbeatInterval) {
            clearInterval(this.claudeHeartbeatInterval);
        }
        
        // Close WebSocket
        if (this.claudeWebSocket) {
            this.claudeWebSocket.close();
            this.claudeWebSocket = null;
        }
        
        // Dispose terminal
        if (this.claudeTerminal) {
            this.claudeTerminal.dispose();
            this.claudeTerminal = null;
        }
    }
};
