/**
 * MCP (Model Context Protocol) Module
 *
 * This module provides MCP functionality for vLLM Playground.
 * It handles server configuration, connection management, and chat integration.
 *
 * Usage: Import and call initMCPModule(uiInstance) to add MCP methods to the UI class.
 */

/**
 * Initialize MCP module and add methods to the UI instance
 * @param {Object} ui - The VLLMWebUI instance
 */
export function initMCPModule(ui) {
    // Add MCP methods to the UI instance
    Object.assign(ui, MCPMethods);

    // Initialize MCP
    ui.initMCP();
}

/**
 * MCP Methods object - contains all MCP-related methods
 */
const MCPMethods = {
    // ============================================
    // Initialization
    // ============================================

    initMCP() {
        console.log("Initializing MCP module, available:", this.mcpAvailable);

        // Update MCP config view availability status
        this.updateMCPAvailabilityStatus();

        // Initialize MCP chat panel
        this.initMCPChatPanel();

        // Load MCP configs and presets
        if (this.mcpAvailable) {
            this.loadMCPConfigs(true); // Initial load - trigger auto-connect
            this.loadMCPPresets();
        }

        // Set up MCP form event listeners
        this.initMCPFormListeners();
    },

    updateMCPAvailabilityStatus() {
        const statusEl = document.getElementById("mcp-availability-status");
        const warningEl = document.getElementById("mcp-install-warning");
        const contentEl = document.getElementById("mcp-content-wrapper");
        const chatToggle = document.getElementById("mcp-chat-enabled");
        const chatUnavailable = document.getElementById("mcp-chat-unavailable");
        const chatDisabled = document.getElementById("mcp-chat-disabled");

        if (this.mcpAvailable) {
            if (statusEl) {
                statusEl.className = "mcp-header-status available";
                statusEl.innerHTML = "<span>✅ MCP Available</span>";
            }
            if (warningEl) warningEl.style.display = "none";
            if (contentEl) contentEl.style.display = "flex";
            if (chatToggle) chatToggle.disabled = false;
            if (chatUnavailable) chatUnavailable.style.display = "none";
            if (chatDisabled) chatDisabled.style.display = "block";
        } else {
            if (statusEl) {
                statusEl.className = "mcp-header-status unavailable";
                statusEl.innerHTML = "<span>❌ Not Installed</span>";
            }
            if (warningEl) warningEl.style.display = "flex";
            if (contentEl) contentEl.style.display = "none";
            if (chatToggle) chatToggle.disabled = true;
            if (chatUnavailable) chatUnavailable.style.display = "flex";
            if (chatDisabled) chatDisabled.style.display = "none";
        }
    },

    initMCPChatPanel() {
        // Enable MCP toggle in chat panel
        const toggle = document.getElementById("mcp-chat-enabled");

        if (toggle) {
            toggle.addEventListener("change", (e) => {
                this.mcpEnabled = e.target.checked;

                if (this.mcpEnabled) {
                    // Auto-select all connected servers when MCP is enabled
                    const connectedServers = (this.mcpConfigs || [])
                        .filter((c) => c.connected)
                        .map((c) => c.name);

                    if (connectedServers.length === 0) {
                        // No servers connected - show warning and disable
                        this.showNotification(
                            "No MCP servers connected. Connect to a server first.",
                            "warning",
                        );
                        this.mcpEnabled = false;
                        e.target.checked = false;
                    } else {
                        // Auto-select all connected servers
                        this.mcpSelectedServers = [...connectedServers];
                        this.renderMCPServerCheckboxes();
                        this.loadMCPToolsFromSelected();
                        this.showNotification(
                            `MCP enabled with ${connectedServers.length} server${connectedServers.length > 1 ? "s" : ""}`,
                            "success",
                        );
                    }
                } else {
                    // MCP disabled - clear selection
                    this.mcpSelectedServers = [];
                    this.mcpTools = [];
                    this.updateMCPToolsSummary();
                }

                this.updateMCPChatPanel();

                // Update toolbar indicator
                if (typeof this.updateModifiedIndicators === "function") {
                    this.updateModifiedIndicators();
                }
            });
        }

        // Go to MCP config links
        const gotoLinks = [
            "mcp-chat-goto-config",
            "mcp-chat-goto-config-2",
            "mcp-chat-goto-config-3",
        ];
        gotoLinks.forEach((id) => {
            const link = document.getElementById(id);
            if (link) {
                link.addEventListener("click", (e) => {
                    e.preventDefault();
                    this.switchView("mcp-config");
                });
            }
        });

        // Select all/none buttons
        const selectAll = document.getElementById("mcp-select-all");
        const selectNone = document.getElementById("mcp-select-none");

        if (selectAll) {
            selectAll.addEventListener("click", () =>
                this.selectAllMCPServers(true),
            );
        }
        if (selectNone) {
            selectNone.addEventListener("click", () =>
                this.selectAllMCPServers(false),
            );
        }
    },

    initMCPFormListeners() {
        // Add server button
        const addBtn = document.getElementById("mcp-add-server-btn");
        if (addBtn) {
            addBtn.addEventListener("click", () => this.openMCPServerForm());
        }

        // Form close/cancel buttons
        const closeBtn = document.getElementById("mcp-form-close");
        const cancelBtn = document.getElementById("mcp-form-cancel");
        if (closeBtn)
            closeBtn.addEventListener("click", () => this.closeMCPServerForm());
        if (cancelBtn)
            cancelBtn.addEventListener("click", () =>
                this.closeMCPServerForm(),
            );

        // Save button
        const saveBtn = document.getElementById("mcp-form-save");
        if (saveBtn) {
            saveBtn.addEventListener("click", () => this.saveMCPServer());
        }

        // Transport type change
        const transportSelect = document.getElementById("mcp-server-transport");
        if (transportSelect) {
            transportSelect.addEventListener("change", (e) => {
                this.toggleMCPTransportOptions(e.target.value);
            });
        }

        // Add env var button
        const addEnvBtn = document.getElementById("mcp-add-env-var");
        if (addEnvBtn) {
            addEnvBtn.addEventListener("click", () => this.addMCPEnvVarRow());
        }
    },

    // ============================================
    // Data Loading
    // ============================================

    async loadMCPConfigs(isInitialLoad = false) {
        try {
            const response = await fetch("/api/mcp/configs");
            const data = await response.json();
            this.mcpConfigs = data.configs || [];
            console.log("Loaded MCP configs:", this.mcpConfigs.length);
            this.renderMCPServersGrid();
            this.updateMCPChatPanel();
            this.updateMCPBadge();

            // Auto-connect on initial load
            if (isInitialLoad) {
                await this.autoConnectMCPServers();
            }
        } catch (error) {
            console.error("Failed to load MCP configs:", error);
        }
    },

    async autoConnectMCPServers() {
        // Safety check: ensure MCP is available
        if (!this.mcpAvailable) {
            console.log("MCP not available, skipping auto-connect");
            return;
        }

        // Find servers with auto_connect enabled that are not already connected
        const serversToConnect = this.mcpConfigs.filter(
            (config) =>
                config.auto_connect && config.enabled && !config.connected,
        );

        if (serversToConnect.length === 0) {
            return;
        }

        console.log(
            `Auto-connecting to ${serversToConnect.length} MCP server(s)...`,
        );

        // Connect to each server sequentially to avoid overwhelming the system
        for (const config of serversToConnect) {
            try {
                console.log(`Auto-connecting to MCP server: ${config.name}`);
                const response = await fetch(
                    `/api/mcp/connect/${encodeURIComponent(config.name)}`,
                    {
                        method: "POST",
                    },
                );

                if (response.ok) {
                    const result = await response.json();
                    console.log(
                        `Auto-connected to "${config.name}" - ${result.status?.tools_count || 0} tools available`,
                    );
                    this.showNotification(
                        `Auto-connected to "${config.name}"`,
                        "success",
                    );
                } else {
                    const error = await response.json();
                    console.error(
                        `Failed to auto-connect to "${config.name}":`,
                        error.detail,
                    );
                }
            } catch (error) {
                console.error(
                    `Error auto-connecting to "${config.name}":`,
                    error,
                );
            }
        }

        // Refresh configs to update UI after all auto-connects
        try {
            const response = await fetch("/api/mcp/configs");
            const data = await response.json();
            this.mcpConfigs = data.configs || [];
            this.renderMCPServersGrid();
            this.updateMCPChatPanel();
            this.updateMCPBadge();
        } catch (error) {
            console.error(
                "Failed to refresh MCP configs after auto-connect:",
                error,
            );
        }
    },

    async loadMCPPresets() {
        try {
            const response = await fetch("/api/mcp/presets");
            const data = await response.json();
            this.mcpPresets = data.presets || [];
            this.renderMCPPresetsGrid();
        } catch (error) {
            console.error("Failed to load MCP presets:", error);
        }
    },

    refreshMCPConfigView() {
        if (this.mcpAvailable) {
            this.loadMCPConfigs().then(() => {
                // Update tool counts for all connected servers after configs are loaded
                this.refreshAllMCPToolCounts();
            });
            this.loadMCPPresets();
        }
    },

    refreshAllMCPToolCounts() {
        // Update tool count badges for all servers to reflect disabled tools
        if (!this.mcpConfigs) return;

        this.mcpConfigs.forEach((config) => {
            if (config.connected) {
                this.updateMCPToolCount(config.name);
            }
        });
    },

    // ============================================
    // Server Grid Rendering
    // ============================================

    renderMCPServersGrid() {
        const grid = document.getElementById("mcp-servers-grid");
        const emptyState = document.getElementById("mcp-empty-state");

        if (!grid) return;

        // Clear existing cards (except empty state)
        const existingCards = grid.querySelectorAll(".mcp-server-card");
        existingCards.forEach((card) => card.remove());

        if (this.mcpConfigs.length === 0) {
            if (emptyState) emptyState.style.display = "flex";
            return;
        }

        if (emptyState) emptyState.style.display = "none";

        this.mcpConfigs.forEach((config) => {
            const card = this.createMCPServerCard(config);
            grid.appendChild(card);
        });
    },

    createMCPServerCard(config) {
        const card = document.createElement("div");
        card.className = `mcp-server-card${config.connected ? " connected" : ""}${config.error ? " error" : ""}`;
        card.dataset.server = config.name;

        const statusClass = config.connected
            ? "connected"
            : config.error
              ? "error"
              : "disconnected";
        const transportInfo =
            config.transport === "stdio"
                ? `${config.command || ""} ${(config.args || []).join(" ")}`
                : config.url || "";

        // Build capability summary for connected servers
        const toolsCount = config.tools_count || 0;
        const resourcesCount = config.resources_count || 0;
        const promptsCount = config.prompts_count || 0;

        const capabilitySummary = config.connected
            ? `
            <div class="server-capabilities">
                <span class="capability-badge" title="Tools"><span class="icon-mcp-tools"></span> ${toolsCount}</span>
                <span class="capability-badge" title="Resources"><span class="icon-mcp-resources"></span> ${resourcesCount}</span>
                <span class="capability-badge" title="Prompts"><span class="icon-mcp-prompts"></span> ${promptsCount}</span>
            </div>
        `
            : "";

        card.innerHTML = `
            <div class="server-card-header">
                <div class="server-header-left">
                    <span class="server-name-text">${this.escapeHtml(config.name)}</span>
                    <span class="status-dot ${statusClass}"></span>
                    <span class="server-command">${this.escapeHtml(transportInfo)}</span>
                </div>
                ${capabilitySummary}
                <div class="server-card-actions">
                    <button class="btn btn-icon-only" onclick="window.vllmUI.editMCPServer('${config.name}')" title="Edit">
                        <span class="icon-mcp-edit"></span>
                    </button>
                    <button class="btn btn-icon-only btn-danger-icon" onclick="window.vllmUI.deleteMCPServer('${config.name}')" title="Delete">
                        <span class="icon-mcp-delete"></span>
                    </button>
                    <button class="mcp-toggle-btn ${config.connected ? "connected" : ""}"
                            onclick="event.stopPropagation(); window.vllmUI.toggleMCPServer('${config.name}')"
                            title="${config.connected ? "Click to disconnect" : "Click to connect"}">
                        <span class="toggle-track">
                            <span class="toggle-thumb"></span>
                        </span>
                    </button>
                </div>
            </div>
            ${config.error ? `<div class="server-error-inline">${this.escapeHtml(config.error)}</div>` : ""}
            <div class="server-details-panel" id="mcp-details-${config.name}" style="display: none;">
                <div class="details-loading">Loading...</div>
            </div>
            ${
                config.connected
                    ? `
                <div class="server-expand-toggle" onclick="window.vllmUI.toggleMCPServerDetails('${config.name}')">
                    <span class="expand-text">Show details</span>
                    <span class="expand-icon">▼</span>
                </div>
            `
                    : ""
            }
        `;

        return card;
    },

    async toggleMCPServerDetails(name) {
        const panel = document.getElementById(`mcp-details-${name}`);
        const card = panel?.closest(".mcp-server-card");

        if (!panel || !card) return;

        const isExpanded = card.classList.contains("expanded");

        if (isExpanded) {
            // Collapse
            card.classList.remove("expanded");
            panel.style.display = "none";
            const toggle = card.querySelector(".server-expand-toggle");
            if (toggle) {
                toggle.querySelector(".expand-text").textContent =
                    "Show tools & resources";
                toggle.querySelector(".expand-icon").textContent = "▼";
            }
        } else {
            // Expand and load details
            card.classList.add("expanded");
            panel.style.display = "block";
            panel.innerHTML = '<div class="details-loading">Loading...</div>';

            const toggle = card.querySelector(".server-expand-toggle");
            if (toggle) {
                toggle.querySelector(".expand-text").textContent = "Show less";
                toggle.querySelector(".expand-icon").textContent = "▲";
            }

            await this.loadInlineServerDetails(name, panel);
        }
    },

    async loadInlineServerDetails(name, panel) {
        try {
            const response = await fetch(
                `/api/mcp/servers/${encodeURIComponent(name)}/details`,
            );
            if (!response.ok) throw new Error("Failed to load");

            const data = await response.json();
            const tools = data.tools || [];
            const resources = data.resources || [];
            const prompts = data.prompts || [];

            let html = "";

            // Tools as selectable badges (all enabled by default)
            if (tools.length > 0) {
                html += '<div class="inline-tools-header">';
                html += `<span class="tools-count">${tools.length} tools</span>`;
                html += `<span class="tools-actions">`;
                html += `<button class="btn-link" onclick="window.vllmUI.setAllMCPTools('${this.escapeHtml(name)}', true)">Enable All</button>`;
                html += `<button class="btn-link" onclick="window.vllmUI.setAllMCPTools('${this.escapeHtml(name)}', false)">Disable All</button>`;
                html += `</span>`;
                html += "</div>";
                html += '<div class="inline-tools-section">';
                html += tools
                    .map((tool) => {
                        const toolKey = `${name}:${tool.name}`;
                        // Ensure mcpDisabledTools exists
                        if (!this.mcpDisabledTools)
                            this.mcpDisabledTools = new Set();
                        const isDisabled = this.mcpDisabledTools.has(toolKey);
                        return `
                        <span class="tool-badge ${isDisabled ? "disabled" : "enabled"}"
                              title="${this.escapeHtml(tool.description || "No description")}"
                              data-server="${this.escapeHtml(name)}"
                              data-tool="${this.escapeHtml(tool.name)}"
                              onclick="window.vllmUI.toggleMCPTool('${this.escapeHtml(name)}', '${this.escapeHtml(tool.name)}')"
                        >${this.escapeHtml(tool.name)}</span>
                    `;
                    })
                    .join("");
                html += "</div>";
            }

            // Resources as cards
            if (resources.length > 0) {
                html += '<div class="inline-resources-section">';
                html += resources
                    .map(
                        (res) => `
                    <span class="resource-card" title="${this.escapeHtml(res.uri || "")}">
                        <span class="resource-icon">📄</span> ${this.escapeHtml(res.name || res.uri)}
                    </span>
                `,
                    )
                    .join("");
                html += "</div>";
            }

            // Prompts as cards
            if (prompts.length > 0) {
                html += '<div class="inline-prompts-section">';
                html += prompts
                    .map(
                        (prompt) => `
                    <span class="prompt-card" title="${this.escapeHtml(prompt.description || "")}">
                        <span class="prompt-icon">💬</span> ${this.escapeHtml(prompt.name)}
                    </span>
                `,
                    )
                    .join("");
                html += "</div>";
            }

            if (!html) {
                html =
                    '<div class="no-capabilities">No tools, resources, or prompts available</div>';
            }

            panel.innerHTML = html;

            // Store tool count for this server for later reference
            if (!this._mcpServerToolCounts) this._mcpServerToolCounts = {};
            this._mcpServerToolCounts[name] = tools.length;
        } catch (error) {
            panel.innerHTML = `<div class="details-error">Error loading details: ${this.escapeHtml(error.message)}</div>`;
        }
    },

    toggleMCPTool(serverName, toolName) {
        const toolKey = `${serverName}:${toolName}`;
        const badge = document.querySelector(
            `.tool-badge[data-server="${serverName}"][data-tool="${toolName}"]`,
        );

        // Toggle: if disabled, enable it (remove from disabled set); if enabled, disable it (add to disabled set)
        if (this.mcpDisabledTools.has(toolKey)) {
            // Currently disabled, enable it
            this.mcpDisabledTools.delete(toolKey);
            if (badge) {
                badge.classList.remove("disabled");
                badge.classList.add("enabled");
            }
        } else {
            // Currently enabled, disable it
            this.mcpDisabledTools.add(toolKey);
            if (badge) {
                badge.classList.remove("enabled");
                badge.classList.add("disabled");
            }
        }

        // Update the tools count in header
        this.updateMCPToolCount(serverName);

        // Sync with inline chat panel
        this.updateMCPToolsSummary();
    },

    updateMCPToolCount(serverName) {
        // Get total tools for this server from cache or from config
        let totalTools = this._mcpServerToolCounts?.[serverName];

        // Fallback to config.tools_count if not in cache
        if (totalTools === undefined && this.mcpConfigs) {
            const config = this.mcpConfigs.find((c) => c.name === serverName);
            totalTools = config?.tools_count || 0;
        }
        totalTools = totalTools || 0;

        // Count disabled tools for this server
        let disabledCount = 0;
        if (this.mcpDisabledTools) {
            this.mcpDisabledTools.forEach((key) => {
                if (key.startsWith(`${serverName}:`)) disabledCount++;
            });
        }

        const enabledCount = totalTools - disabledCount;

        // Update the capability badge in the card header
        const card = document.querySelector(
            `.mcp-server-card[data-server="${serverName}"]`,
        );
        if (card) {
            const toolsBadge = card.querySelector(
                '.capability-badge[title="Tools"]',
            );
            if (toolsBadge) {
                // Only show enabled/total if some are disabled
                if (disabledCount > 0) {
                    toolsBadge.innerHTML = `<span class="icon-mcp-tools"></span> ${enabledCount}/${totalTools}`;
                } else {
                    toolsBadge.innerHTML = `<span class="icon-mcp-tools"></span> ${totalTools}`;
                }
            }
        }
    },

    setAllMCPTools(serverName, enabled) {
        // Enable or disable all tools for a server
        const panel = document.getElementById(`mcp-details-${serverName}`);
        if (!panel) return;

        const badges = panel.querySelectorAll(".tool-badge");
        badges.forEach((badge) => {
            const toolName = badge.dataset.tool;
            const toolKey = `${serverName}:${toolName}`;

            if (enabled) {
                // Enable: remove from disabled set
                this.mcpDisabledTools.delete(toolKey);
                badge.classList.remove("disabled");
                badge.classList.add("enabled");
            } else {
                // Disable: add to disabled set
                this.mcpDisabledTools.add(toolKey);
                badge.classList.remove("enabled");
                badge.classList.add("disabled");
            }
        });

        this.updateMCPToolCount(serverName);

        // Sync with inline chat panel
        this.updateMCPToolsSummary();
    },

    getEnabledMCPTools(serverName) {
        // Return tools that are enabled (not in disabled set) for a server
        // If serverName is provided, filter by that server
        return {
            disabledTools: Array.from(this.mcpDisabledTools),
            isToolEnabled: (server, tool) =>
                !this.mcpDisabledTools.has(`${server}:${tool}`),
        };
    },

    renderMCPPresetsGrid() {
        const grid = document.getElementById("mcp-presets-grid");
        if (!grid) return;

        grid.innerHTML = "";

        this.mcpPresets.forEach((preset) => {
            const card = document.createElement("div");
            card.className = "mcp-preset-card";

            const docsLink = preset.docs_url
                ? `<a href="${this.escapeHtml(preset.docs_url)}" target="_blank" class="preset-docs-link" title="View documentation" onclick="event.stopPropagation()">📖</a>`
                : "";

            card.innerHTML = `
                <div class="preset-header">
                    <div class="preset-name">${this.escapeHtml(preset.display_name || preset.name)}</div>
                    ${docsLink}
                </div>
                <div class="preset-description">${this.escapeHtml(preset.description || "")}</div>
            `;
            card.addEventListener("click", () => this.applyMCPPreset(preset));
            grid.appendChild(card);
        });
    },

    applyMCPPreset(preset) {
        // Open form and pre-fill with preset values
        this.openMCPServerForm();

        document.getElementById("mcp-server-name").value = preset.name;
        document.getElementById("mcp-server-transport").value =
            preset.transport || "stdio";
        this.toggleMCPTransportOptions(preset.transport || "stdio");

        if (preset.command) {
            document.getElementById("mcp-server-command").value =
                preset.command;
        }
        if (preset.args) {
            document.getElementById("mcp-server-args").value =
                preset.args.join(" ");
        }
        if (preset.url) {
            document.getElementById("mcp-server-url").value = preset.url;
        }

        document.getElementById("mcp-server-description").value =
            preset.description || "";

        // Add environment variables
        const envContainer = document.getElementById("mcp-env-vars");
        envContainer.innerHTML = "";
        if (preset.env) {
            Object.entries(preset.env).forEach(([key, value]) => {
                this.addMCPEnvVarRow(key, value);
            });
        }

        // Show a note about placeholder variables if any
        if (preset.placeholder_vars) {
            const placeholders = Object.entries(preset.placeholder_vars)
                .map(([key, info]) => `${key}: ${info.label}`)
                .join(", ");
            this.showNotification(
                `📝 Replace placeholders: ${placeholders}`,
                "info",
                5000,
            );
        }
    },

    // ============================================
    // Server Form Management
    // ============================================

    openMCPServerForm(editingServer = null) {
        const form = document.getElementById("mcp-server-form");
        const title = document.getElementById("mcp-form-title");

        if (!form) return;

        // Reset form
        document.getElementById("mcp-server-name").value = "";
        document.getElementById("mcp-server-transport").value = "stdio";
        document.getElementById("mcp-server-command").value = "";
        document.getElementById("mcp-server-args").value = "";
        document.getElementById("mcp-server-url").value = "";
        document.getElementById("mcp-server-description").value = "";
        document.getElementById("mcp-server-enabled").checked = true;
        document.getElementById("mcp-server-auto-connect").checked = false;
        document.getElementById("mcp-env-vars").innerHTML = "";

        this.toggleMCPTransportOptions("stdio");

        if (editingServer) {
            title.textContent = "Edit Server";
            form.dataset.editing = editingServer.name;

            document.getElementById("mcp-server-name").value =
                editingServer.name;
            document.getElementById("mcp-server-transport").value =
                editingServer.transport;
            this.toggleMCPTransportOptions(editingServer.transport);

            if (editingServer.transport === "stdio") {
                document.getElementById("mcp-server-command").value =
                    editingServer.command || "";
                document.getElementById("mcp-server-args").value = (
                    editingServer.args || []
                ).join(" ");
            } else {
                document.getElementById("mcp-server-url").value =
                    editingServer.url || "";
            }

            document.getElementById("mcp-server-description").value =
                editingServer.description || "";
            document.getElementById("mcp-server-enabled").checked =
                editingServer.enabled !== false;
            document.getElementById("mcp-server-auto-connect").checked =
                editingServer.auto_connect || false;

            if (editingServer.env) {
                Object.entries(editingServer.env).forEach(([key, value]) => {
                    this.addMCPEnvVarRow(key, value);
                });
            }
        } else {
            title.textContent = "Add New Server";
            delete form.dataset.editing;
        }

        form.style.display = "block";
        document.getElementById("mcp-server-name").focus();
    },

    closeMCPServerForm() {
        const form = document.getElementById("mcp-server-form");
        if (form) {
            form.style.display = "none";
            delete form.dataset.editing;
        }
    },

    toggleMCPTransportOptions(transport) {
        const stdioOptions = document.getElementById("stdio-options");
        const sseOptions = document.getElementById("sse-options");

        if (transport === "stdio") {
            if (stdioOptions) stdioOptions.style.display = "block";
            if (sseOptions) sseOptions.style.display = "none";
        } else {
            if (stdioOptions) stdioOptions.style.display = "none";
            if (sseOptions) sseOptions.style.display = "block";
        }
    },

    addMCPEnvVarRow(key = "", value = "") {
        const container = document.getElementById("mcp-env-vars");
        if (!container) return;

        const row = document.createElement("div");
        row.className = "env-var-row";
        row.innerHTML = `
            <input type="text" class="form-control env-key" placeholder="KEY" value="${this.escapeHtml(key)}">
            <input type="text" class="form-control env-value" placeholder="VALUE" value="${this.escapeHtml(value)}">
            <button class="btn btn-secondary btn-sm btn-icon" onclick="this.parentElement.remove()" title="Remove">✕</button>
        `;
        container.appendChild(row);
    },

    // ============================================
    // Server CRUD Operations
    // ============================================

    async saveMCPServer() {
        const form = document.getElementById("mcp-server-form");
        const name = document.getElementById("mcp-server-name").value.trim();
        const transport = document.getElementById("mcp-server-transport").value;

        if (!name) {
            this.showNotification("Server name is required", "error");
            return;
        }

        // Build config object
        const config = {
            name,
            transport,
            enabled: document.getElementById("mcp-server-enabled").checked,
            auto_connect: document.getElementById("mcp-server-auto-connect")
                .checked,
            description:
                document
                    .getElementById("mcp-server-description")
                    .value.trim() || null,
        };

        if (transport === "stdio") {
            config.command = document
                .getElementById("mcp-server-command")
                .value.trim();
            const argsStr = document
                .getElementById("mcp-server-args")
                .value.trim();
            config.args = argsStr ? argsStr.split(/\s+/) : [];

            if (!config.command) {
                this.showNotification(
                    "Command is required for stdio transport",
                    "error",
                );
                return;
            }
        } else {
            config.url = document.getElementById("mcp-server-url").value.trim();

            if (!config.url) {
                this.showNotification(
                    "URL is required for SSE transport",
                    "error",
                );
                return;
            }
        }

        // Collect environment variables
        const envRows = document.querySelectorAll("#mcp-env-vars .env-var-row");
        const env = {};
        envRows.forEach((row) => {
            const key = row.querySelector(".env-key").value.trim();
            const value = row.querySelector(".env-value").value.trim();
            if (key) {
                env[key] = value;
            }
        });
        if (Object.keys(env).length > 0) {
            config.env = env;
        }

        try {
            const response = await fetch("/api/mcp/configs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(config),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || "Failed to save server");
            }

            this.showNotification(
                `Server "${name}" saved successfully`,
                "success",
            );
            this.closeMCPServerForm();
            this.loadMCPConfigs();
        } catch (error) {
            this.showNotification(
                `Failed to save server: ${error.message}`,
                "error",
            );
        }
    },

    editMCPServer(name) {
        const config = this.mcpConfigs.find((c) => c.name === name);
        if (config) {
            this.openMCPServerForm(config);
        }
    },

    async deleteMCPServer(name) {
        const confirmed = await this.showConfirm({
            title: "Delete MCP Server",
            message: `Are you sure you want to delete "${name}"? This action cannot be undone.`,
            confirmText: "Delete",
            cancelText: "Cancel",
            icon: "🗑️",
            type: "danger",
        });

        if (!confirmed) {
            return;
        }

        try {
            const response = await fetch(
                `/api/mcp/configs/${encodeURIComponent(name)}`,
                {
                    method: "DELETE",
                },
            );

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || "Failed to delete server");
            }

            this.showNotification(`Server "${name}" deleted`, "success");

            // Clean up state: remove from selected servers
            if (this.mcpSelectedServers) {
                this.mcpSelectedServers = this.mcpSelectedServers.filter(
                    (n) => n !== name,
                );
            }

            // Clean up disabled tools for this server
            if (this.mcpDisabledTools) {
                const toRemove = [];
                this.mcpDisabledTools.forEach((key) => {
                    if (key.startsWith(`${name}:`)) {
                        toRemove.push(key);
                    }
                });
                toRemove.forEach((key) => this.mcpDisabledTools.delete(key));
            }

            // Clean up tool counts cache
            if (this._mcpServerToolCounts) {
                delete this._mcpServerToolCounts[name];
            }

            // Reload configs (this also calls updateMCPChatPanel)
            await this.loadMCPConfigs();

            // Refresh tools from current selection
            await this.loadMCPToolsFromSelected();
        } catch (error) {
            this.showNotification(
                `Failed to delete server: ${error.message}`,
                "error",
            );
        }
    },

    // ============================================
    // Connection Management
    // ============================================

    async toggleMCPServer(name) {
        const config = this.mcpConfigs.find((c) => c.name === name);
        if (config && config.connected) {
            await this.disconnectMCPServer(name);
        } else {
            await this.connectMCPServer(name);
        }
    },

    async connectMCPServer(name) {
        this.showNotification(`Connecting to "${name}"...`, "info");

        try {
            const response = await fetch(
                `/api/mcp/connect/${encodeURIComponent(name)}`,
                {
                    method: "POST",
                },
            );

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || "Failed to connect");
            }

            const result = await response.json();
            this.showNotification(
                `Connected to "${name}" - ${result.status?.tools_count || 0} tools available`,
                "success",
            );
            this.loadMCPConfigs();
        } catch (error) {
            this.showNotification(
                `Failed to connect: ${error.message}`,
                "error",
            );
            this.loadMCPConfigs();
        }
    },

    async disconnectMCPServer(name) {
        try {
            const response = await fetch(
                `/api/mcp/disconnect/${encodeURIComponent(name)}`,
                {
                    method: "POST",
                },
            );

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || "Failed to disconnect");
            }

            this.showNotification(`Disconnected from "${name}"`, "success");

            // Remove from selected servers (disconnected servers can't be used)
            if (this.mcpSelectedServers) {
                this.mcpSelectedServers = this.mcpSelectedServers.filter(
                    (n) => n !== name,
                );
            }

            // Reload configs and refresh tools
            await this.loadMCPConfigs();
            await this.loadMCPToolsFromSelected();
        } catch (error) {
            this.showNotification(
                `Failed to disconnect: ${error.message}`,
                "error",
            );
        }
    },

    updateMCPBadge() {
        const badge = document.getElementById("mcp-servers-badge");
        if (badge) {
            const count = this.mcpConfigs.length;
            badge.textContent = count;
            badge.style.display = count > 0 ? "inline" : "none";
        }
    },

    // ============================================
    // Chat Panel Integration
    // ============================================

    updateMCPChatPanel() {
        const disabledView = document.getElementById("mcp-chat-disabled");
        const enabledView = document.getElementById("mcp-chat-enabled-view");
        const noServersView = document.getElementById("mcp-chat-no-servers");
        const selectionView = document.getElementById(
            "mcp-chat-server-selection",
        );

        if (!this.mcpAvailable) return;

        if (!this.mcpEnabled) {
            if (disabledView) disabledView.style.display = "block";
            if (enabledView) enabledView.style.display = "none";
            return;
        }

        if (disabledView) disabledView.style.display = "none";
        if (enabledView) enabledView.style.display = "block";

        // Check if we have any configured servers
        const connectedServers = this.mcpConfigs.filter((c) => c.connected);

        if (this.mcpConfigs.length === 0) {
            if (noServersView) noServersView.style.display = "block";
            if (selectionView) selectionView.style.display = "none";
            return;
        }

        if (noServersView) noServersView.style.display = "none";
        if (selectionView) selectionView.style.display = "block";

        // Render server checkboxes
        this.renderMCPServerCheckboxes();
    },

    renderMCPServerCheckboxes() {
        const container = document.getElementById("mcp-chat-server-checkboxes");
        if (!container) return;

        container.innerHTML = "";

        this.mcpConfigs.forEach((config) => {
            const isSelected = this.mcpSelectedServers.includes(config.name);
            const label = document.createElement("label");
            label.className = "server-checkbox";
            label.innerHTML = `
                <input type="checkbox" value="${this.escapeHtml(config.name)}" ${isSelected ? "checked" : ""} ${!config.connected ? "disabled" : ""}>
                <span class="server-name ${!config.connected ? "disconnected" : ""}">${this.escapeHtml(config.name)}</span>
            `;

            const checkbox = label.querySelector("input");
            checkbox.addEventListener("change", (e) => {
                if (e.target.checked) {
                    if (!this.mcpSelectedServers.includes(config.name)) {
                        this.mcpSelectedServers.push(config.name);
                    }
                } else {
                    this.mcpSelectedServers = this.mcpSelectedServers.filter(
                        (n) => n !== config.name,
                    );
                }
                this.loadMCPToolsFromSelected();
                // Update toolbar indicator
                if (typeof this.updateModifiedIndicators === "function") {
                    this.updateModifiedIndicators();
                }
            });

            container.appendChild(label);
        });
    },

    selectAllMCPServers(select) {
        const connectedServers = this.mcpConfigs
            .filter((c) => c.connected)
            .map((c) => c.name);
        this.mcpSelectedServers = select ? [...connectedServers] : [];
        this.renderMCPServerCheckboxes();
        this.loadMCPToolsFromSelected();
        // Update toolbar indicator
        if (typeof this.updateModifiedIndicators === "function") {
            this.updateModifiedIndicators();
        }
    },

    async loadMCPToolsFromSelected() {
        if (!this.mcpEnabled || this.mcpSelectedServers.length === 0) {
            this.mcpTools = [];
            this.updateMCPToolsSummary();
            return;
        }

        try {
            const serversParam = this.mcpSelectedServers.join(",");
            const response = await fetch(
                `/api/mcp/tools?servers=${encodeURIComponent(serversParam)}`,
            );
            const data = await response.json();
            this.mcpTools = data.tools || [];
            this.updateMCPToolsSummary();
        } catch (error) {
            console.error("Failed to load MCP tools:", error);
            this.mcpTools = [];
            this.updateMCPToolsSummary();
        }
    },

    updateMCPToolsSummary() {
        const toolsCount = document.getElementById("mcp-active-tools-count");
        const serversCount = document.getElementById(
            "mcp-active-servers-count",
        );
        const summary = document.getElementById("mcp-chat-tools-summary");

        // Count enabled tools (total - disabled)
        const enabledTools = this.getMCPToolsForRequest();
        const enabledCount = enabledTools.length;
        const totalCount = this.mcpTools.length;

        if (toolsCount) {
            // Show "X/Y tools" if some are disabled, otherwise just "X tools"
            if (enabledCount < totalCount) {
                toolsCount.textContent = `${enabledCount}/${totalCount} tools`;
            } else {
                toolsCount.textContent = `${enabledCount} tool${enabledCount !== 1 ? "s" : ""}`;
            }
        }
        if (serversCount) {
            serversCount.textContent = `${this.mcpSelectedServers.length} server${this.mcpSelectedServers.length !== 1 ? "s" : ""}`;
        }
        if (summary) {
            summary.style.display = totalCount > 0 ? "flex" : "none";
        }
    },

    getMCPToolsForRequest() {
        // Return MCP tools in OpenAI format for chat requests
        // Filters out tools that have been disabled by the user
        if (!this.mcpEnabled || this.mcpTools.length === 0) {
            return [];
        }

        // Filter out disabled tools
        // mcpDisabledTools contains keys like "serverName:toolName"
        const enabledTools = this.mcpTools.filter((tool) => {
            const serverName = tool._mcp_server;
            const toolName = tool.function?.name;
            if (!serverName || !toolName) return true; // Include if can't determine

            const toolKey = `${serverName}:${toolName}`;
            const isDisabled =
                this.mcpDisabledTools && this.mcpDisabledTools.has(toolKey);

            if (isDisabled) {
                console.log(`[MCP] Filtering out disabled tool: ${toolKey}`);
            }
            return !isDisabled;
        });

        console.log(
            `[MCP] getMCPToolsForRequest: ${enabledTools.length}/${this.mcpTools.length} tools enabled`,
        );
        return enabledTools;
    },

    // ============================================
    // Server Details Modal
    // ============================================

    async openMCPDetails(serverName) {
        const modal = document.getElementById("mcp-details-modal");
        const overlay = document.getElementById("mcp-details-overlay");
        const closeBtn = document.getElementById("mcp-details-close");

        if (!modal) return;

        // Show modal
        modal.style.display = "block";

        // Set server name
        document.getElementById("details-server-name").textContent = serverName;

        // Setup close handlers
        overlay.onclick = () => this.closeMCPDetails();
        closeBtn.onclick = () => this.closeMCPDetails();

        // Load server details
        await this.loadMCPDetails(serverName);
    },

    closeMCPDetails() {
        const modal = document.getElementById("mcp-details-modal");
        if (modal) {
            modal.style.display = "none";
        }
    },

    async loadMCPDetails(serverName) {
        const statusEl = document.getElementById("details-connection-status");
        const toolsList = document.getElementById("details-tools-list");
        const toolsCount = document.getElementById("details-tools-count");
        const resourcesCount = document.getElementById(
            "details-resources-count",
        );
        const resourcesSummary = document.getElementById(
            "details-resources-summary",
        );
        const promptsCount = document.getElementById("details-prompts-count");
        const promptsSummary = document.getElementById(
            "details-prompts-summary",
        );

        // Show loading state
        statusEl.className = "connection-status";
        statusEl.innerHTML =
            '<span class="status-dot"></span><span class="status-text">Checking...</span>';
        toolsList.innerHTML =
            '<div class="list-loading">Loading tools...</div>';

        try {
            const response = await fetch(
                `/api/mcp/servers/${encodeURIComponent(serverName)}/details`,
            );

            if (!response.ok) {
                const error = await response.json();
                throw new Error(
                    error.detail || "Failed to load server details",
                );
            }

            const data = await response.json();

            // Update connection status
            if (data.connected) {
                statusEl.className = "connection-status connected";
                statusEl.innerHTML =
                    '<span class="status-dot"></span><span class="status-text">Connected</span>';
            } else {
                statusEl.className = "connection-status disconnected";
                statusEl.innerHTML =
                    '<span class="status-dot"></span><span class="status-text">Disconnected</span>';
            }

            // Render tools list
            const tools = data.tools || [];
            toolsCount.textContent = tools.length;

            if (tools.length === 0) {
                toolsList.innerHTML =
                    '<div class="list-empty">No tools available</div>';
            } else {
                toolsList.innerHTML = tools
                    .map(
                        (tool) => `
                    <div class="details-tool-item">
                        <div class="tool-name">${this.escapeHtml(tool.name)}</div>
                        <div class="tool-description">${this.escapeHtml(tool.description || "No description")}</div>
                    </div>
                `,
                    )
                    .join("");
            }

            // Update resources summary
            const resources = data.resources || [];
            resourcesCount.textContent = resources.length;
            resourcesSummary.textContent =
                resources.length > 0
                    ? resources
                          .map((r) => r.name || r.uri)
                          .slice(0, 3)
                          .join(", ") +
                      (resources.length > 3
                          ? ` (+${resources.length - 3} more)`
                          : "")
                    : "No resources available";

            // Update prompts summary
            const prompts = data.prompts || [];
            promptsCount.textContent = prompts.length;
            promptsSummary.textContent =
                prompts.length > 0
                    ? prompts
                          .map((p) => p.name)
                          .slice(0, 3)
                          .join(", ") +
                      (prompts.length > 3
                          ? ` (+${prompts.length - 3} more)`
                          : "")
                    : "No prompts available";
        } catch (error) {
            statusEl.className = "connection-status error";
            statusEl.innerHTML = `<span class="status-dot"></span><span class="status-text">Error</span>`;
            toolsList.innerHTML = `<div class="list-empty" style="color: var(--danger-color);">Error: ${this.escapeHtml(error.message)}</div>`;
        }
    },
};

export default MCPMethods;
