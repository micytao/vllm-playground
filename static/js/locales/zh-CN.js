/**
 * Chinese (Simplified) Language Pack - Complete Translation
 * 完整中文语言包
 */

const zhCN = {
    // Navigation
    nav: {
        vllmServer: 'vLLM 服务器',
        guidellm: 'GuideLLM 基准测试',
        mcpServers: 'MCP 服务器',
        offline: '离线',
        online: '在线',
        collapseSidebar: '收起侧边栏',
        expandSidebar: '展开侧边栏'
    },
    
    // Header
    header: {
        viewTitle: {
            vllmServer: 'vLLM 服务器',
            guidellm: 'GuideLLM 基准测试'
        }
    },
    
    // Status messages
    status: {
        connected: '已连接',
        disconnected: '未连接',
        connecting: '连接中...',
        serverRunning: '服务器运行中',
        serverStopped: '服务器已停止',
        serverStarting: '服务器启动中...',
        offline: '离线',
        online: '在线'
    },
    
    // Server Configuration Panel
    serverConfig: {
        title: '⚙️ 服务器配置',
        modelSource: {
            label: '模型来源',
            huggingface: 'HuggingFace',
            modelscope: 'ModelScope',
            local: '本地',
            help: '从 HuggingFace、ModelScope（魔搭社区） 或本地目录选择模型'
        },
        modelscope: {
            help: 'ModelScope（魔搭社区）模型 - 中国区访问优化'
        },
        model: {
            label: '模型',
            customPlaceholder: '或输入自定义模型名称',
            help: '所有模型都支持聊天界面。受限模型需要下方的 HF 令牌。',
            browseRecipes: '📚 浏览社区配方'
        },
        modelGroups: {
            cpuFriendly: '🖥️ CPU 友好模型',
            gpuOptimized: '🎮 GPU 优化模型（CPU 上较慢）'
        },
        localModel: {
            label: '本地模型目录路径',
            placeholder: '~/models/my-model 或 /absolute/path/to/model',
            browse: '📁 浏览',
            validate: '验证',
            help: '输入包含模型文件的绝对路径（config.json、权重等）。支持 ~ 表示主目录。',
            validation: {
                validating: '验证中...',
                valid: '✓ 路径有效',
                invalid: '✗ 路径无效',
                notFound: '路径未找到'
            },
            info: {
                modelName: '模型名称：',
                modelType: '模型类型：',
                size: '大小：',
                hasTokenizer: '有分词器：'
            }
        },
        hfToken: {
            label: 'HuggingFace 令牌（可选）',
            placeholder: 'hf_xxxxxxxxxxxxx',
            help: '受限模型（Llama 3.1、Llama 3.2）需要。从 <a href="https://huggingface.co/settings/tokens" target="_blank">HuggingFace 设置</a> 获取令牌'
        },
        modelscopeToken: {
            label: 'ModelScope 令牌（可选）',
            help: '部分模型需要。从 <a href="https://www.modelscope.cn/my/myaccesstoken" target="_blank">ModelScope 设置</a> 获取令牌',
            installHint: '⚠️ 需要安装：<code>pip install modelscope>=1.18.1</code>'
        },
        runMode: {
            label: '运行模式',
            subprocess: '⚡ 子进程',
            container: '📦 容器',
            help: '子进程：直接运行（本地开发），容器：隔离运行（生产环境）',
            subprocessTip: '💡 提示：使用子进程模式可支持更多加速器（华为昇腾、Intel Gaudi、AWS Neuron），需在主机上安装 vLLM + 硬件插件。'
        },
        computeMode: {
            label: '计算模式',
            cpu: '🖥️ CPU',
            gpu: '🎮 GPU',
            metal: '⚡ Metal',
            help: 'macOS 推荐使用 CPU 模式'
        },
        accelerator: {
            label: '加速器',
            nvidia: 'NVIDIA (CUDA)',
            amd: 'AMD (ROCm)',
            tpu: '谷歌 TPU',
            help: '选择容器模式的 GPU 加速器类型'
        },
        venvPath: {
            label: '自定义虚拟环境路径（可选）',
            placeholder: '~/.venv-vllm-metal',
            help: '指定包含 vLLM 或 vLLM-Metal 的虚拟环境路径。留空则使用系统 Python。'
        },
        host: {
            label: '主机'
        },
        port: {
            label: '端口'
        },
        gpuSettings: {
            tensorParallel: '张量并行大小',
            gpuMemory: 'GPU 内存（%）',
            gpuDevice: 'GPU 设备（可选）',
            gpuDeviceHelp: '指定 GPU 设备 ID：0、1、0,1 等。留空则自动选择。',
            gpuStatus: '🎮 GPU 状态',
            loading: '加载 GPU 状态中...',
            autoRefresh: '每 5 秒自动刷新'
        },
        cpuSettings: {
            kvcache: 'CPU KV 缓存空间（GB）',
            kvcacheHelp: '为 KV 缓存分配的内存（建议从 4GB 开始）',
            threads: 'CPU 线程绑定',
            threadsAuto: '自动（推荐）',
            threadsCores: '核心',
            threadsNone: '无'
        },
        dtype: {
            label: '数据类型',
            auto: '自动',
            float16: 'Float16',
            bfloat16: 'BFloat16',
            float32: 'Float32',
            help: 'CPU 推荐使用 BFloat16'
        },
        maxModelLen: {
            label: '最大模型长度（可选）',
            placeholder: '2048（CPU/Metal）/ 8192（GPU）',
            help: '留空则使用安全默认值：2048（CPU/Metal）或 8192（GPU）'
        },
        chatTemplate: {
            title: '聊天模板参考（高级）',
            noteTitle: 'ℹ️ 注意：',
            noteContent: 'vLLM 会自动从每个模型的分词器配置中加载聊天模板和停止令牌。下面的字段仅供参考。现代模型（2023+）都有内置的正确工作的模板。',
            template: '聊天模板（Jinja2）',
            templateHelp: 'vLLM 自动使用模型分词器配置中的聊天模板。仅供参考。',
            stopTokens: '停止令牌（逗号分隔）',
            stopTokensHelp: 'vLLM 通过聊天模板自动处理停止令牌。仅供参考。使用服务器配置中的 \'custom_stop_tokens\' 来覆盖。',
            referenceOnly: '🔄 仅供参考',
            placeholder: '将从模型的分词器配置中加载...'
        },
        checkboxes: {
            trustRemoteCode: '信任远程代码',
            enablePrefixCaching: '启用前缀缓存',
            enableToolCalling: '启用工具调用'
        },
        toolCallParser: {
            label: '工具调用解析器',
            autoDetect: '自动检测',
            help: '模型工具调用输出的解析器。自动检测使用模型名称。'
        },
        commandPreview: {
            title: '命令预览',
            copy: '复制',
            help: '直接编辑命令或使用上面的表单。启动服务器时将使用您的编辑内容。'
        },
        buttons: {
            start: '启动服务器',
            stop: '停止服务器'
        }
    },
    
    // Chat Interface
    chat: {
        title: '💬 聊天界面',
        clear: '清空',
        export: '导出',
        welcomeMessage: '欢迎！尝试工具栏中的不同选项来自定义您的聊天体验。',
        inputPlaceholder: '在此输入您的消息...',
        send: '发送',
        thinking: '思考中...',
        generating: '生成响应中...',
        stopped: '生成已停止',
        error: '生成响应时出错',
        clearConfirm: '确定要清空所有聊天记录吗？',
        settings: {
            title: '💬 聊天设置',
            temperature: '温度：',
            temperatureHelp: '较低 = 更集中，较高 = 更有创意',
            maxTokens: '最大令牌数：',
            maxTokensHelp: '最大响应长度'
        },
        systemPrompt: {
            title: '📝 系统提示',
            placeholder: '设置系统提示（例如，"你是一个有用的编码助手"）',
            default: '你是一个有用的助手。',
            clear: '清空',
            templates: '模板 ▼',
            templateOptions: {
                default: '默认',
                helpful: '有用的助手',
                coder: '代码助手',
                writer: '创意写作',
                teacher: '教师',
                translator: '翻译',
                analyst: '数据分析师',
                concise: '简洁'
            },
            help: '随每条消息发送以设置行为'
        },
        structuredOutputs: {
            title: '📊 结构化输出',
            docs: '📖 文档',
            enable: '启用结构化输出',
            cpuWarning: '<strong>CPU 模式：</strong>需要 <code>dtype=float32</code>。在 CPU 上使用 bfloat16/float16 会导致错误。',
            outputType: '输出类型：',
            types: {
                choice: '选择',
                regex: '正则表达式',
                json: 'JSON',
                format: '格式'
            },
            choice: {
                label: '选择（从固定选项中选择）',
                placeholder: '一次输入一个选项...',
                add: '添加',
                help: '模型将从这些选项中精确选择一个'
            },
            regex: {
                label: '正则表达式模式',
                placeholder: '例如：[0-9]{3}-[0-9]{4}',
                help: '输出将匹配此正则表达式'
            },
            json: {
                label: 'JSON Schema',
                placeholder: '粘贴您的 JSON Schema...',
                validate: '验证',
                examples: '示例 ▼',
                exampleOptions: {
                    userProfile: '用户资料',
                    productInfo: '产品信息',
                    weatherData: '天气数据',
                    taskList: '任务列表'
                },
                help: '必须是有效的 JSON Schema'
            },
            format: {
                label: '格式类型',
                help: '使用预定义格式'
            }
        },
        tools: {
            title: '🔧 工具',
            docs: '📖 文档',
            enable: '启用工具调用',
            serverRequired: '需要在服务器配置中启用工具调用',
            noTools: '未定义工具',
            addTool: '+ 添加工具',
            clearAll: '清空全部',
            toolCard: {
                edit: '编辑',
                delete: '删除',
                parameters: '参数：',
                required: '必需'
            }
        },
        mcp: {
            title: '🔌 MCP',
            docs: '📖 文档',
            enable: '启用',
            serverRequired: '需要在服务器配置中启用工具调用',
            mcpServers: 'MCP 服务器',
            noServers: '未配置 MCP 服务器',
            addServer: '+ 添加服务器',
            notInstalled: 'MCP 未安装',
            installCmd: 'pip install vllm-playground[mcp]',
            configureLink: '配置 MCP →',
            enablePrompt: '启用 MCP 以使用已配置服务器的工具',
            configureServersLink: '配置 MCP 服务器 →',
            infoTip: '启用工具调用启动 vLLM。设置最大模型长度为 8192+。使用具有工具调用能力的较大模型（例如 Qwen 2.5 7B+、Llama 3.1 8B+）以获得更好的效果。',
            addServerLink: '添加 MCP 服务器 →',
            selectServers: '选择要使用的服务器：',
            selectAll: '全选',
            selectNone: '取消全选',
            toolsSummary: '{{tools}} 个工具来自 {{servers}} 个服务器',
            serverCard: {
                command: '命令：',
                args: '参数：',
                env: '环境：',
                tools: '工具：',
                prompts: '提示：',
                resources: '资源：',
                connect: '连接',
                disconnect: '断开连接',
                refresh: '刷新',
                edit: '编辑',
                delete: '删除'
            }
        },
        rag: {
            title: '📚 RAG（检索增强生成）',
            docs: '📖 文档',
            enable: '启用 RAG',
            files: '文件',
            noFiles: '未上传文件',
            uploadBtn: '上传文件',
            uploadHelp: '支持：PDF、TXT、MD、CSV、JSON',
            fileCard: {
                size: '大小：',
                chunks: '块：',
                delete: '删除'
            },
            settings: {
                title: 'RAG 设置',
                topK: 'Top K 结果',
                topKHelp: '返回的最相关块数',
                chunkSize: '块大小',
                chunkSizeHelp: '每个文本块的字符数',
                chunkOverlap: '块重叠',
                chunkOverlapHelp: '块之间的重叠字符数'
            }
        }
    },
    
    // Metrics Panel
    metrics: {
        title: '📊 响应指标',
        noData: '无可用数据',
        requestsPerSecond: '请求/秒',
        tokensPerSecond: '令牌/秒',
        avgLatency: '平均延迟',
        totalRequests: '总请求数',
        totalTokens: '总令牌数',
        errorRate: '错误率',
        uptime: '运行时间',
        promptTokens: '提示词令牌：',
        completionTokens: '补全令牌：',
        timeTaken: '耗时：',
        tokensPerSec: '令牌/秒：',
        avgPromptThroughput: '平均提示吞吐量：',
        avgGenerationThroughput: '平均生成吞吐量：',
        gpuKvCacheUsage: 'GPU KV 缓存使用率：',
        prefixCacheHitRate: '前缀缓存命中率：'
    },
    
    // Logs Panel
    logs: {
        title: '📋 服务器日志',
        clear: '清空',
        save: '保存',
        autoScroll: '自动滚动',
        noLogs: '无日志',
        level: {
            info: '信息',
            warning: '警告',
            error: '错误',
            success: '成功'
        }
    },
    
    // Server messages
    server: {
        starting: '启动 vLLM 服务器中...',
        stopping: '停止 vLLM 服务器中...',
        started: '服务器启动成功',
        stopped: '服务器已停止',
        error: '服务器错误',
        ready: '服务器已就绪',
        notReady: '服务器未就绪',
        statusBanner: {
            ready: '✅ 服务器已就绪',
            readyDesc: '服务器已就绪。您现在可以开始聊天了！',
            starting: '🔄 服务器启动中',
            startingDesc: '服务器正在初始化。请稍候...',
            stopped: '⚠️ 服务器已停止',
            stoppedDesc: '配置并启动服务器以开始使用'
        }
    },
    
    // GuideLLM Benchmark View
    guidellm: {
        title: '📊 GuideLLM 基准测试',
        description: '使用 GuideLLM 对您的 vLLM 服务器进行基准测试',
        serverRequired: '需要先启动 vLLM 服务器',
        config: {
            title: '基准测试配置',
            endpoint: '端点 URL',
            endpointPlaceholder: 'http://localhost:8000/v1',
            model: '模型名称',
            modelPlaceholder: '自动检测',
            dataSource: '数据源',
            dataTypes: {
                synthetic: '合成数据',
                file: '文件',
                custom: '自定义'
            },
            numRequests: '请求数',
            requestRate: '请求速率',
            maxTokens: '最大令牌数'
        },
        buttons: {
            start: '启动基准测试',
            stop: '停止基准测试'
        },
        results: {
            title: '基准测试结果',
            noResults: '无结果',
            throughput: '吞吐量',
            latency: '延迟',
            p50: 'P50',
            p95: 'P95',
            p99: 'P99'
        }
    },
    
    // Tool Editor Modal
    toolEditor: {
        title: {
            add: '添加工具',
            edit: '编辑工具'
        },
        name: '工具名称',
        namePlaceholder: '例如：get_weather',
        description: '描述',
        descriptionPlaceholder: '此工具的功能...',
        parameters: '参数',
        addParameter: '+ 添加参数',
        noParameters: '此工具没有参数',
        paramName: '参数名称',
        paramType: '类型',
        paramDescription: '描述',
        paramRequired: '必需',
        presets: '预设 ▼',
        buttons: {
            save: '保存',
            cancel: '取消'
        }
    },
    
    // MCP Server Editor Modal
    mcpEditor: {
        title: {
            add: '添加 MCP 服务器',
            edit: '编辑 MCP 服务器'
        },
        name: '服务器名称',
        namePlaceholder: '例如：filesystem',
        command: '命令',
        commandPlaceholder: '例如：npx',
        args: '参数（每行一个）',
        argsPlaceholder: '-y\n@modelcontextprotocol/server-filesystem\n/path/to/allowed/files',
        env: '环境变量（KEY=VALUE，每行一个）',
        envPlaceholder: 'API_KEY=your_key\nDEBUG=true',
        buttons: {
            save: '保存',
            cancel: '取消'
        }
    },
    
    // Log messages
    log: {
        connected: 'WebSocket 已连接',
        disconnected: 'WebSocket 已断开连接',
        error: '错误',
        warning: '警告',
        info: '信息',
        success: '成功'
    },
    
    // Validation messages
    validation: {
        required: '此字段为必填项',
        invalidPath: '路径无效',
        pathNotFound: '路径未找到',
        validating: '验证中...',
        valid: '有效',
        invalid: '无效',
        invalidJson: 'JSON 无效',
        invalidRegex: '正则表达式无效'
    },
    
    // Benchmark messages
    benchmark: {
        title: '性能基准测试',
        runBenchmark: '运行基准测试',
        stop: '停止',
        running: '基准测试运行中...',
        completed: '基准测试完成',
        failed: '基准测试失败',
        starting: '启动基准测试中...',
        stopping: '停止基准测试中...',
        startServerFirst: '请先启动 vLLM 服务器以运行基准测试',
        goToServer: '前往服务器 →',
        noData: '暂无基准测试数据',
        noDataHelp: '启动 vLLM 服务器并点击"运行基准测试"来测试性能',
        method: {
            label: '基准测试方法：',
            builtin: '内置（快速）',
            guidellm: 'GuideLLM（高级）',
            help: '内置：快速简单。GuideLLM：更详细的指标和 HTML 报告'
        },
        config: {
            totalRequests: '总请求数：',
            requestRate: '请求速率（请求/秒）：',
            promptTokens: '提示词令牌：',
            outputTokens: '输出令牌：'
        },
        commandPreview: {
            title: '命令预览',
            copy: '复制',
            help: '此基准测试配置对应的 GuideLLM 命令'
        }
    },
    
    // Tool messages
    tool: {
        added: '工具已添加',
        updated: '工具已更新',
        deleted: '工具已删除',
        error: '工具错误',
        calling: '调用工具中...',
        executionResult: '执行结果',
        deleteConfirm: '确定要删除此工具吗？',
        clearAllConfirm: '确定要清空所有工具吗？'
    },
    
    // File operations
    file: {
        uploading: '上传中...',
        uploaded: '文件已上传',
        uploadError: '上传错误',
        downloading: '下载中...',
        downloaded: '已下载',
        deleteConfirm: '确定要删除此文件吗？'
    },
    
    // Common actions
    action: {
        save: '保存',
        cancel: '取消',
        delete: '删除',
        edit: '编辑',
        add: '添加',
        remove: '移除',
        confirm: '确认',
        close: '关闭',
        reset: '重置',
        apply: '应用',
        browse: '浏览',
        search: '搜索',
        clear: '清空',
        copy: '复制',
        paste: '粘贴',
        start: '启动',
        stop: '停止',
        refresh: '刷新',
        upload: '上传',
        download: '下载'
    },
    
    // Error messages
    error: {
        unknown: '发生未知错误',
        network: '网络错误',
        timeout: '请求超时',
        serverError: '服务器错误',
        invalidInput: '输入无效',
        notFound: '未找到',
        forbidden: '访问被禁止',
        unauthorized: '未授权'
    },
    
    // Time-related
    time: {
        justNow: '刚刚',
        minutesAgo: '{{minutes}} 分钟前',
        hoursAgo: '{{hours}} 小时前',
        daysAgo: '{{days}} 天前',
        uptime: '运行时间：{{time}}',
        seconds: '秒',
        minutes: '分钟',
        hours: '小时',
        days: '天'
    },
    
    // Units
    units: {
        tokens: '令牌',
        seconds: '秒',
        minutes: '分钟',
        hours: '小时',
        mb: 'MB',
        gb: 'GB',
        kb: 'KB',
        requests: '请求',
        per: '/',
        percentage: '%'
    },
    
    // Theme
    theme: {
        toggle: '切换暗色/亮色模式',
        dark: '深色',
        light: '浅色'
    },
    
    // Language
    language: {
        switch: '切换语言',
        english: 'English',
        chinese: '简体中文'
    },
    
    // MCP Configuration View (Model Context Protocol)
    mcp: {
        nav: 'MCP 服务器',
        title: 'MCP',
        enable: '启用',
        configTitle: 'MCP 服务器配置',
        configSubtitle: '配置模型上下文协议服务器以扩展 LLM 能力，使用外部工具',
        checkingAvailability: '正在检查 MCP 可用性...',
        notInstalled: 'MCP 未安装',
        installPrompt: '安装 MCP 包以启用此功能：',
        configuredServers: '已配置的服务器',
        addServer: '添加服务器',
        noServersConfigured: '未配置 MCP 服务器',
        noServersHint: '添加服务器开始使用，或从下面的预设中选择',
        addNewServer: '添加新服务器',
        editServer: '编辑服务器',
        serverName: '服务器名称',
        serverNameHelp: '此服务器的唯一标识符',
        transportType: '传输类型',
        transportStdio: 'Stdio（本地命令）',
        transportSse: 'SSE（HTTP 端点）',
        command: '命令',
        commandHelp: '要运行的可执行文件',
        arguments: '参数',
        argumentsHelp: '以空格分隔的命令参数',
        serverUrl: '服务器 URL',
        serverUrlHelp: 'SSE 端点 URL',
        envVars: '环境变量',
        addEnvVar: '+ 添加变量',
        description: '描述',
        descriptionPlaceholder: '可选描述',
        enabled: '已启用',
        autoConnect: '启动时自动连接',
        saveServer: '保存服务器',
        securityNotice: '安全提示',
        securityWarnings: {
            pythonVersion: 'MCP 需要 Python 3.10 或更高版本',
            experimental: 'MCP 集成是实验性/演示功能',
            trustedOnly: '仅使用受信任的 MCP 服务器',
            reviewCalls: '执行前检查每个工具调用'
        },
        stdioDepTitle: 'STDIO 传输依赖',
        stdioDeps: {
            npx: 'npx (Node.js) - 文件系统服务器需要',
            uvx: 'uvx (uv) - Git、Fetch、Time 服务器需要',
            sse: 'SSE 传输连接到远程 URL，无需本地依赖'
        },
        quickStart: '快速开始预设',
        serverDetails: '服务器详情',
        // Chat panel specific
        chatNotInstalled: 'MCP 未安装',
        chatInstallCmd: 'pip install vllm-playground[mcp]',
        chatConfigureLink: '配置 MCP →',
        chatEnablePrompt: '启用 MCP 以使用已配置服务器的工具',
        chatConfigureServersLink: '配置 MCP 服务器 →',
        chatInfoTip: '启用工具调用启动 vLLM。设置最大模型长度为 8192+。使用具有工具调用能力的较大模型（例如 Qwen 2.5 7B+、Llama 3.1 8B+）以获得更好的效果。',
        chatNoServers: '未配置 MCP 服务器',
        chatAddServerLink: '添加 MCP 服务器 →',
        chatSelectServers: '选择要使用的服务器：',
        chatSelectAll: '全选',
        chatSelectNone: '取消',
        chatToolsSummary: '{{tools}} 个工具来自 {{servers}} 个服务器',
        // Status
        connecting: '连接中...',
        connected: '已连接',
        disconnected: '已断开',
        error: '错误'
    },
    
    // Container Runtime
    containerRuntime: {
        checking: '检测中...',
        detected: '容器运行时',
        notDetected: '未检测到容器运行时'
    },
    
    // Confirm Modal
    confirmModal: {
        title: '确认操作',
        message: '确定吗？',
        cancel: '取消',
        confirm: '确认'
    }
};

// Register language pack
if (window.i18n) {
    window.i18n.register('zh-CN', zhCN);
}

