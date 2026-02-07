/**
 * English Language Pack - Complete Translation
 * Covers both static HTML content (via data-i18n) and JS-generated content
 */

const en = {
    // Navigation
    nav: {
        vllmServer: 'vLLM Server',
        guidellm: 'GuideLLM',
        mcpServers: 'MCP Servers',
        offline: 'Offline',
        online: 'Online',
        collapseSidebar: 'Collapse sidebar',
        expandSidebar: 'Expand sidebar'
    },

    // Status messages
    status: {
        connected: 'Connected',
        disconnected: 'Disconnected',
        connecting: 'Connecting...',
        serverRunning: 'Server Running',
        serverStopped: 'Server Stopped',
        serverStarting: 'Server Starting...',
        offline: 'Offline',
        online: 'Online'
    },

    // Server Configuration Panel
    serverConfig: {
        title: '⚙️ Server Configuration',
        modelSource: {
            label: 'Model Source',
            huggingface: 'HuggingFace',
            modelscope: 'ModelScope',
            local: 'Local',
            help: 'Select model from HuggingFace, ModelScope, or local directory'
        },
        modelscope: {
            help: 'Models from ModelScope (魔搭社区) - optimized for China region access.'
        },
        model: {
            label: 'Model',
            browseRecipes: '📚 Browse Community Recipes'
        },
        hfToken: {
            label: 'HuggingFace Token (Optional)',
            help: 'Required for gated models (Llama 3.1, Llama 3.2). Get token from <a href="https://huggingface.co/settings/tokens" target="_blank">HuggingFace Settings</a>'
        },
        modelscopeToken: {
            label: 'ModelScope Token (Optional)',
            help: 'Required for some models. Get token from <a href="https://www.modelscope.cn/my/myaccesstoken" target="_blank">ModelScope Settings</a>',
            installHint: '⚠️ Requires: <code>pip install modelscope>=1.18.1</code>'
        },
        cpuSettings: {
            kvcache: 'CPU KV Cache Space (GB)',
            kvcacheHelp: 'Memory allocated for KV cache (start with 4GB)',
            threads: 'CPU Thread Binding',
            threadsAuto: 'Auto (Recommended)',
            threadsCores: 'Cores',
            threadsNone: 'None'
        },
        dtype: {
            label: 'Data Type',
            auto: 'Auto',
            float16: 'Float16',
            bfloat16: 'BFloat16',
            float32: 'Float32',
            help: 'BFloat16 recommended for CPU'
        },
        maxModelLen: {
            label: 'Max Model Length (optional)',
            help: 'Leave empty to use safe defaults: 2048 (CPU/Metal) or 8192 (GPU)'
        },
        checkboxes: {
            trustRemoteCode: 'Trust Remote Code',
            enablePrefixCaching: 'Enable Prefix Caching',
            enableToolCalling: 'Enable Tool Calling'
        },
        commandPreview: {
            title: 'Command Preview',
            copy: 'Copy',
            help: 'Editable for customization. Copy to run manually. "Start Server" uses settings above.'
        },
        runMode: {
            label: 'Run Mode',
            subprocess: '⚡ Subprocess',
            container: '📦 Container',
            remote: '🌐 Remote',
            help: 'Container: Isolated (recommended), Subprocess: Direct (requires vLLM installed)',
            subprocessTip: '💡 Tip: Use subprocess mode for additional accelerators (Huawei Ascend, Intel Gaudi, AWS Neuron) with vLLM + hardware plugin installed on the host.'
        },
        remoteUrl: {
            label: 'Remote vLLM URL',
            placeholder: 'http://gpu-server:8000',
            help: 'Base URL of a running vLLM instance with OpenAI-compatible API'
        },
        remoteApiKey: {
            label: 'API Key (Optional)',
            placeholder: 'sk-...',
            help: 'Bearer token for authenticated vLLM endpoints'
        },
        computeMode: {
            label: 'Compute Mode',
            cpu: '🖥️ CPU',
            gpu: '🎮 GPU',
            metal: '⚡ Metal',
            help: 'CPU mode is recommended for macOS'
        },
        accelerator: {
            label: 'Accelerator',
            nvidia: 'NVIDIA (CUDA)',
            amd: 'AMD (ROCm)',
            tpu: 'Google TPU',
            help: 'Select your GPU accelerator type for container mode'
        },
        venvPath: {
            label: 'Custom Virtual Environment Path (Optional)',
            placeholder: '~/.venv-vllm-metal',
            help: 'Specify path to a virtual environment containing vLLM or vLLM-Metal. Leave empty to use system Python.'
        },
        host: {
            label: 'Host'
        },
        port: {
            label: 'Port'
        },
        buttons: {
            start: 'Start Server',
            stop: 'Stop Server'
        }
    },

    // Server messages
    server: {
        starting: 'Starting vLLM server...',
        stopping: 'Stopping vLLM server...',
        started: 'Server started successfully',
        stopped: 'Server stopped',
        error: 'Server error',
        ready: 'Server is ready',
        notReady: 'Server is not ready'
    },

    // Chat Interface
    chat: {
        title: '💬 Chat Interface',
        clear: 'Clear',
        export: 'Export',
        send: 'Send',
        welcomeMessage: 'Welcome! Try different options in the toolbar to customize your chat experience.',
        inputPlaceholder: 'Type your message here...',
        thinking: 'Thinking...',
        generating: 'Generating response...',
        stopped: 'Generation stopped',
        error: 'Error generating response',
        clearConfirm: 'Are you sure you want to clear all chat history?'
    },

    // VLM (Vision Language Model)
    vlm: {
        title: 'Vision (VLM)',
        docs: 'Docs',
        enable: 'Enable Vision (VLM)',
        dropzone: 'Drag & drop an image here, or click to browse',
        dropzoneHint: 'Supports JPEG, PNG, GIF, WebP',
        urlLabel: 'Or paste image URL',
        urlPlaceholder: 'https://example.com/image.jpg',
        loadUrl: 'Load',
        removeImage: 'Remove image',
        help: 'Attach an image to your next message. The image will be sent once and cleared after sending. Requires a VLM model (e.g., LLaVA, Qwen-VL).'
    },

    // MCP (Model Context Protocol)
    mcp: {
        nav: 'MCP Servers',
        title: 'MCP',
        enable: 'Enable',
        configTitle: 'MCP Server Configuration',
        configSubtitle: 'Configure Model Context Protocol servers to extend LLM capabilities with external tools',
        checkingAvailability: 'Checking MCP availability...',
        notInstalled: 'MCP Not Installed',
        installPrompt: 'Install the MCP package to enable this feature:',
        configuredServers: 'Configured Servers',
        addServer: 'Add Server',
        noServersConfigured: 'No MCP servers configured',
        noServersHint: 'Add a server to get started, or choose from presets below',
        addNewServer: 'Add New Server',
        editServer: 'Edit Server',
        serverName: 'Server Name',
        serverNameHelp: 'Unique identifier for this server',
        transportType: 'Transport Type',
        transportStdio: 'Stdio (Local Command)',
        transportSse: 'SSE (HTTP Endpoint)',
        command: 'Command',
        commandHelp: 'The executable to run',
        arguments: 'Arguments',
        argumentsHelp: 'Space-separated command arguments',
        serverUrl: 'Server URL',
        serverUrlHelp: 'The SSE endpoint URL',
        envVars: 'Environment Variables',
        addEnvVar: '+ Add Variable',
        description: 'Description',
        descriptionPlaceholder: 'Optional description',
        enabled: 'Enabled',
        autoConnect: 'Auto-connect on startup',
        saveServer: 'Save Server',
        securityNotice: 'Security Notice',
        securityWarnings: {
            pythonVersion: 'MCP requires Python 3.10 or higher',
            experimental: 'MCP integration is experimental/demo only',
            trustedOnly: 'Only use trusted MCP servers',
            reviewCalls: 'Review each tool call before executing'
        },
        stdioDepTitle: 'STDIO Transport Dependencies',
        stdioDeps: {
            npx: 'npx (Node.js) - Required for Filesystem server',
            uvx: 'uvx (uv) - Required for Git, Fetch, Time servers',
            sse: 'SSE transport connects to remote URLs, no local dependencies needed'
        },
        quickStart: 'Quick Start with Presets',
        serverDetails: 'Server Details',
        // Chat panel
        chatNotInstalled: 'MCP not installed',
        chatInstallCmd: 'pip install vllm-playground[mcp]',
        chatConfigureLink: 'Configure MCP →',
        chatEnablePrompt: 'Enable MCP to use tools from configured servers',
        chatConfigureServersLink: 'Configure MCP Servers →',
        chatInfoTip: 'Start vLLM with Tool Calling enabled. Set Max Model Length to 8192+. Use a larger model with tool calling capability (e.g., Qwen 2.5 7B+, Llama 3.1 8B+) for better results.',
        chatNoServers: 'No MCP servers configured',
        chatAddServerLink: 'Add MCP Server →',
        chatSelectServers: 'Select servers to use:',
        chatSelectAll: 'All',
        chatSelectNone: 'None',
        chatToolsSummary: '{{tools}} tools from {{servers}} servers',
        // Status
        connecting: 'Connecting...',
        connected: 'Connected',
        disconnected: 'Disconnected',
        error: 'Error'
    },

    // Container Runtime
    containerRuntime: {
        checking: 'Checking...',
        detected: 'Container Runtime',
        notDetected: 'No container runtime'
    },

    // Confirm Modal
    confirmModal: {
        title: 'Confirm Action',
        message: 'Are you sure?',
        cancel: 'Cancel',
        confirm: 'Confirm'
    },

    // Metrics Panel
    metrics: {
        title: '📊 Response Metrics',
        promptTokens: 'Prompt Tokens:',
        completionTokens: 'Completion Tokens:',
        totalTokens: 'Total Tokens:',
        timeTaken: 'Time Taken:',
        tokensPerSec: 'Tokens/sec:',
        avgPromptThroughput: 'Avg Prompt Throughput:',
        avgGenerationThroughput: 'Avg Generation Throughput:',
        gpuKvCacheUsage: 'GPU KV Cache Usage:',
        prefixCacheHitRate: 'Prefix Cache Hit Rate:'
    },

    // Logs Panel
    logs: {
        title: '📋 Server Logs',
        autoScroll: 'Auto-scroll',
        save: 'Save',
        clear: 'Clear'
    },

    // Log messages
    log: {
        connected: 'WebSocket connected',
        disconnected: 'WebSocket disconnected',
        error: 'Error',
        warning: 'Warning',
        info: 'Info',
        success: 'Success'
    },

    // Validation messages
    validation: {
        required: 'This field is required',
        invalidPath: 'Invalid path',
        pathNotFound: 'Path not found',
        validating: 'Validating...',
        valid: 'Valid',
        invalid: 'Invalid'
    },

    // Benchmark messages
    benchmark: {
        title: 'Performance Benchmarking',
        runBenchmark: 'Run Benchmark',
        stop: 'Stop',
        running: 'Benchmark running...',
        completed: 'Benchmark completed',
        failed: 'Benchmark failed',
        starting: 'Starting benchmark...',
        stopping: 'Stopping benchmark...',
        startServerFirst: 'Start the vLLM server first to run benchmarks',
        goToServer: 'Go to Server →',
        noData: 'No benchmark data available',
        noDataHelp: 'Start the vLLM server and click "Run Benchmark" to test performance',
        method: {
            label: 'Benchmark Method:',
            builtin: 'Built-in (Fast)',
            guidellm: 'GuideLLM (Advanced)',
            help: 'Built-in: Fast & simple. GuideLLM: More detailed metrics & HTML reports'
        },
        config: {
            totalRequests: 'Total Requests:',
            requestRate: 'Request Rate (req/s):',
            promptTokens: 'Prompt Tokens:',
            outputTokens: 'Output Tokens:'
        },
        commandPreview: {
            title: 'Command Preview',
            copy: 'Copy',
            help: 'Equivalent GuideLLM command for this benchmark configuration'
        }
    },

    // Tool messages
    tool: {
        added: 'Tool added',
        updated: 'Tool updated',
        deleted: 'Tool deleted',
        error: 'Tool error',
        calling: 'Calling tool...',
        executionResult: 'Execution Result'
    },

    // File operations
    file: {
        uploading: 'Uploading...',
        uploaded: 'File uploaded',
        uploadError: 'Upload error',
        downloading: 'Downloading...',
        downloaded: 'Downloaded'
    },

    // Common actions
    action: {
        save: 'Save',
        cancel: 'Cancel',
        delete: 'Delete',
        edit: 'Edit',
        add: 'Add',
        remove: 'Remove',
        confirm: 'Confirm',
        close: 'Close',
        reset: 'Reset',
        apply: 'Apply',
        browse: 'Browse',
        search: 'Search',
        clear: 'Clear',
        copy: 'Copy',
        paste: 'Paste',
        start: 'Start',
        stop: 'Stop',
        refresh: 'Refresh',
        connect: 'Connect',
        disconnect: 'Disconnect'
    },

    // Error messages
    error: {
        unknown: 'Unknown error occurred',
        network: 'Network error',
        timeout: 'Request timeout',
        serverError: 'Server error',
        invalidInput: 'Invalid input',
        notFound: 'Not found',
        forbidden: 'Access forbidden',
        unauthorized: 'Unauthorized'
    },

    // Time-related
    time: {
        justNow: 'Just now',
        minutesAgo: '{{minutes}} minutes ago',
        hoursAgo: '{{hours}} hours ago',
        daysAgo: '{{days}} days ago',
        uptime: 'Uptime: {{time}}'
    },

    // Units
    units: {
        tokens: 'tokens',
        seconds: 'seconds',
        minutes: 'minutes',
        hours: 'hours',
        mb: 'MB',
        gb: 'GB',
        tools: 'tools',
        servers: 'servers'
    },

    // Theme
    theme: {
        toggle: 'Toggle dark/light mode',
        dark: 'Dark',
        light: 'Light'
    },

    // Language
    language: {
        switch: 'Switch Language',
        english: 'English',
        chinese: '简体中文'
    }
};

// Register language pack
if (window.i18n) {
    window.i18n.register('en', en);
}
