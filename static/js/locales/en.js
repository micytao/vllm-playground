/**
 * English Language Pack - Complete Translation
 * Covers both static HTML content (via data-i18n) and JS-generated content
 */

const en = {
    // Navigation
    nav: {
        vllmServer: "vLLM Server",
        guidellm: "GuideLLM",
        mcpServers: "MCP Servers",
        offline: "Offline",
        online: "Online",
        collapseSidebar: "Collapse sidebar",
        expandSidebar: "Expand sidebar",
    },

    // Status messages
    status: {
        connected: "Connected",
        disconnected: "Disconnected",
        connecting: "Connecting...",
        serverRunning: "Server Running",
        serverStopped: "Server Stopped",
        serverStarting: "Server Starting...",
        offline: "Offline",
        online: "Online",
    },

    // Server Configuration Panel
    serverConfig: {
        title: "⚙️ Server Configuration",
        modelSource: {
            label: "Model Source",
            huggingface: "HuggingFace",
            local: "Local",
            help: "Select model from HuggingFace or local directory",
        },
        model: {
            label: "Model",
        },
        runMode: {
            label: "Run Mode",
            subprocess: "⚡ Subprocess",
            container: "📦 Container",
            help: "Container: Isolated (recommended), Subprocess: Direct (requires vLLM installed)",
        },
        computeMode: {
            label: "Compute Mode",
            cpu: "🖥️ CPU",
            gpu: "🎮 GPU",
            help: "CPU mode is recommended for macOS",
        },
        host: {
            label: "Host",
        },
        port: {
            label: "Port",
        },
        buttons: {
            start: "Start Server",
            stop: "Stop Server",
        },
    },

    // Server messages
    server: {
        starting: "Starting vLLM server...",
        stopping: "Stopping vLLM server...",
        started: "Server started successfully",
        stopped: "Server stopped",
        error: "Server error",
        ready: "Server is ready",
        notReady: "Server is not ready",
    },

    // Chat Interface
    chat: {
        title: "💬 Chat Interface",
        clear: "Clear",
        send: "Send",
        welcomeMessage:
            "Welcome! Try different options in the toolbar to customize your chat experience.",
        inputPlaceholder: "Type your message here...",
        thinking: "Thinking...",
        generating: "Generating response...",
        stopped: "Generation stopped",
        error: "Error generating response",
        clearConfirm: "Are you sure you want to clear all chat history?",
    },

    // MCP (Model Context Protocol)
    mcp: {
        nav: "MCP Servers",
        title: "MCP",
        enable: "Enable",
        configTitle: "MCP Server Configuration",
        configSubtitle:
            "Configure Model Context Protocol servers to extend LLM capabilities with external tools",
        checkingAvailability: "Checking MCP availability...",
        notInstalled: "MCP Not Installed",
        installPrompt: "Install the MCP package to enable this feature:",
        configuredServers: "Configured Servers",
        addServer: "Add Server",
        noServersConfigured: "No MCP servers configured",
        noServersHint:
            "Add a server to get started, or choose from presets below",
        addNewServer: "Add New Server",
        editServer: "Edit Server",
        serverName: "Server Name",
        serverNameHelp: "Unique identifier for this server",
        transportType: "Transport Type",
        transportStdio: "Stdio (Local Command)",
        transportSse: "SSE (HTTP Endpoint)",
        command: "Command",
        commandHelp: "The executable to run",
        arguments: "Arguments",
        argumentsHelp: "Space-separated command arguments",
        serverUrl: "Server URL",
        serverUrlHelp: "The SSE endpoint URL",
        envVars: "Environment Variables",
        addEnvVar: "+ Add Variable",
        description: "Description",
        descriptionPlaceholder: "Optional description",
        enabled: "Enabled",
        autoConnect: "Auto-connect on startup",
        saveServer: "Save Server",
        securityNotice: "Security Notice",
        securityWarnings: {
            pythonVersion: "MCP requires Python 3.10 or higher",
            experimental: "MCP integration is experimental/demo only",
            trustedOnly: "Only use trusted MCP servers",
            reviewCalls: "Review each tool call before executing",
        },
        stdioDepTitle: "STDIO Transport Dependencies",
        stdioDeps: {
            npx: "npx (Node.js) - Required for Filesystem server",
            uvx: "uvx (uv) - Required for Git, Fetch, Time servers",
            sse: "SSE transport connects to remote URLs, no local dependencies needed",
        },
        quickStart: "Quick Start with Presets",
        serverDetails: "Server Details",
        // Chat panel
        chatNotInstalled: "MCP not installed",
        chatInstallCmd: "pip install vllm-playground[mcp]",
        chatConfigureLink: "Configure MCP →",
        chatEnablePrompt: "Enable MCP to use tools from configured servers",
        chatConfigureServersLink: "Configure MCP Servers →",
        chatInfoTip:
            "Start vLLM with Tool Calling enabled. Set Max Model Length to 8192+. Use a larger model with tool calling capability (e.g., Qwen 2.5 7B+, Llama 3.1 8B+) for better results.",
        chatNoServers: "No MCP servers configured",
        chatAddServerLink: "Add MCP Server →",
        chatSelectServers: "Select servers to use:",
        chatSelectAll: "All",
        chatSelectNone: "None",
        chatToolsSummary: "{{tools}} tools from {{servers}} servers",
        // Status
        connecting: "Connecting...",
        connected: "Connected",
        disconnected: "Disconnected",
        error: "Error",
    },

    // Container Runtime
    containerRuntime: {
        checking: "Checking...",
        detected: "Container Runtime",
        notDetected: "No container runtime",
    },

    // Confirm Modal
    confirmModal: {
        title: "Confirm Action",
        message: "Are you sure?",
        cancel: "Cancel",
        confirm: "Confirm",
    },

    // Log messages
    log: {
        connected: "WebSocket connected",
        disconnected: "WebSocket disconnected",
        error: "Error",
        warning: "Warning",
        info: "Info",
        success: "Success",
    },

    // Validation messages
    validation: {
        required: "This field is required",
        invalidPath: "Invalid path",
        pathNotFound: "Path not found",
        validating: "Validating...",
        valid: "Valid",
        invalid: "Invalid",
    },

    // Benchmark messages
    benchmark: {
        running: "Benchmark running...",
        completed: "Benchmark completed",
        failed: "Benchmark failed",
        starting: "Starting benchmark...",
        stopping: "Stopping benchmark...",
    },

    // Tool messages
    tool: {
        added: "Tool added",
        updated: "Tool updated",
        deleted: "Tool deleted",
        error: "Tool error",
        calling: "Calling tool...",
        executionResult: "Execution Result",
    },

    // File operations
    file: {
        uploading: "Uploading...",
        uploaded: "File uploaded",
        uploadError: "Upload error",
        downloading: "Downloading...",
        downloaded: "Downloaded",
    },

    // Common actions
    action: {
        save: "Save",
        cancel: "Cancel",
        delete: "Delete",
        edit: "Edit",
        add: "Add",
        remove: "Remove",
        confirm: "Confirm",
        close: "Close",
        reset: "Reset",
        apply: "Apply",
        browse: "Browse",
        search: "Search",
        clear: "Clear",
        copy: "Copy",
        paste: "Paste",
        start: "Start",
        stop: "Stop",
        refresh: "Refresh",
        connect: "Connect",
        disconnect: "Disconnect",
    },

    // Error messages
    error: {
        unknown: "Unknown error occurred",
        network: "Network error",
        timeout: "Request timeout",
        serverError: "Server error",
        invalidInput: "Invalid input",
        notFound: "Not found",
        forbidden: "Access forbidden",
        unauthorized: "Unauthorized",
    },

    // Time-related
    time: {
        justNow: "Just now",
        minutesAgo: "{{minutes}} minutes ago",
        hoursAgo: "{{hours}} hours ago",
        daysAgo: "{{days}} days ago",
        uptime: "Uptime: {{time}}",
    },

    // Units
    units: {
        tokens: "tokens",
        seconds: "seconds",
        minutes: "minutes",
        hours: "hours",
        mb: "MB",
        gb: "GB",
        tools: "tools",
        servers: "servers",
    },

    // Theme
    theme: {
        toggle: "Toggle dark/light mode",
        dark: "Dark",
        light: "Light",
    },

    // Language
    language: {
        switch: "Switch Language",
        english: "English",
        chinese: "简体中文",
    },
};

// Register language pack
if (window.i18n) {
    window.i18n.register("en", en);
}
