import Foundation

/// Production-ready mock API client for demo mode.
/// Provides canned streaming responses, tool call support, and static metrics.
/// Ships in release builds (not gated by `#if DEBUG`).
final class DemoAPIClient: VLLMAPIClientProtocol, @unchecked Sendable {

    // MARK: - Health & Models

    func checkHealth(baseURL: String, apiKey: String?) async throws -> Bool {
        true
    }

    func listModels(baseURL: String, apiKey: String?) async throws -> [String] {
        ["Demo Model"]
    }

    // MARK: - Non-Streaming Chat Completion

    func chatCompletion(
        baseURL: String,
        apiKey: String?,
        request: ChatCompletionRequest
    ) async throws -> ChatCompletionResponse {
        // Simulate short latency
        try await Task.sleep(nanoseconds: 200_000_000)

        // If tools are present, return a mock tool call
        if let tools = request.tools, let firstTool = tools.first {
            return ChatCompletionResponse(
                id: "demo-\(UUID().uuidString.prefix(8))",
                choices: [
                    ChatCompletionResponse.Choice(
                        index: 0,
                        message: ChatCompletionResponse.ResponseMessage(
                            role: "assistant",
                            content: nil,
                            tool_calls: [
                                ToolCallResponse(
                                    id: "call_demo_\(UUID().uuidString.prefix(8))",
                                    type: "function",
                                    function: ToolCallFunction(
                                        name: firstTool.function.name,
                                        arguments: "{\"demo\": true}"
                                    )
                                )
                            ]
                        ),
                        delta: nil,
                        finish_reason: "tool_calls"
                    )
                ],
                usage: ChatCompletionResponse.Usage(
                    prompt_tokens: 42,
                    completion_tokens: 15,
                    total_tokens: 57
                )
            )
        }

        // Default non-streaming response
        return ChatCompletionResponse(
            id: "demo-\(UUID().uuidString.prefix(8))",
            choices: [
                ChatCompletionResponse.Choice(
                    index: 0,
                    message: ChatCompletionResponse.ResponseMessage(
                        role: "assistant",
                        content: "This is a demo response. Connect a real vLLM server for actual inference.",
                        tool_calls: nil
                    ),
                    delta: nil,
                    finish_reason: "stop"
                )
            ],
            usage: ChatCompletionResponse.Usage(
                prompt_tokens: 28,
                completion_tokens: 18,
                total_tokens: 46
            )
        )
    }

    // MARK: - Streaming Chat Completion

    func streamChatCompletion(
        baseURL: String,
        apiKey: String?,
        request: ChatCompletionRequest
    ) -> AsyncThrowingStream<StreamEvent, Error> {
        // Extract user's last message for context-aware responses
        let lastMessage = extractLastUserMessage(from: request)
        let response = selectResponse(for: lastMessage)
        let words = response.split(separator: " ").map(String.init)

        return AsyncThrowingStream { continuation in
            Task {
                do {
                    for (index, word) in words.enumerated() {
                        let token = index == 0 ? word : " \(word)"
                        continuation.yield(.text(token))
                        // Realistic streaming delay: 30-60ms per token
                        let delay = UInt64.random(in: 30_000_000...60_000_000)
                        try await Task.sleep(nanoseconds: delay)
                    }

                    let tokenCount = words.count
                    continuation.yield(.done(ChatCompletionResponse.Usage(
                        prompt_tokens: 24,
                        completion_tokens: tokenCount,
                        total_tokens: 24 + tokenCount
                    )))
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }

    // MARK: - Metrics

    func fetchMetrics(baseURL: String, apiKey: String?) async throws -> VLLMMetrics {
        VLLMMetrics(
            gpuCacheUsage: 0.42,
            cpuCacheUsage: 0.08,
            avgPromptThroughput: 156.3,
            avgGenerationThroughput: 48.7,
            numRequestsRunning: 2,
            numRequestsWaiting: 0,
            prefixCacheHitRate: 0.65
        )
    }

    // MARK: - Private Helpers

    private func extractLastUserMessage(from request: ChatCompletionRequest) -> String {
        guard let lastMsg = request.messages.last,
              lastMsg.role == "user" else { return "" }
        switch lastMsg.content {
        case .text(let text):
            return text.lowercased()
        case .multimodal:
            return ""
        case .none:
            return ""
        }
    }

    private func selectResponse(for input: String) -> String {
        if input.isEmpty {
            return Self.fallbackResponse
        }

        let lower = input.lowercased()

        if lower.contains("hello") || lower.contains("hi") || lower.contains("hey") || lower.contains("greet") {
            return Self.greetingResponse
        }
        if lower.contains("code") || lower.contains("python") || lower.contains("function") || lower.contains("program") {
            return Self.codeResponse
        }
        if lower.contains("vllm") || lower.contains("server") || lower.contains("connect") || lower.contains("setup") {
            return Self.vllmExplanation
        }
        if lower.contains("tool") || lower.contains("function call") {
            return Self.toolCallExplanation
        }
        if lower.contains("markdown") || lower.contains("format") {
            return Self.markdownShowcase
        }

        return Self.fallbackResponse
    }

    // MARK: - Response Templates

    private static let greetingResponse = """
    Hello! 👋 Welcome to **vLLM Playground** demo mode.

    I'm a simulated assistant — my responses are pre-written, not generated by a real model. Here's what you can explore:

    - **Chat** with streaming responses
    - **Tool calling** configuration
    - **Structured output** settings
    - **Omni Studio** for image, audio & TTS
    - **Benchmarks** with simulated metrics

    To get started with a real AI model, add a vLLM server in the **Servers** tab. You can run one locally with:

    ```
    pip install vllm
    vllm serve Qwen/Qwen2.5-7B-Instruct
    ```

    What would you like to try?
    """

    private static let codeResponse = """
    Here's a Python example to get you started! 🐍

    ```python
    import requests

    def chat_with_vllm(prompt: str, base_url: str = "http://localhost:8000") -> str:
        \"\"\"Send a chat completion request to a vLLM server.\"\"\"
        response = requests.post(
            f"{base_url}/v1/chat/completions",
            json={
                "model": "Qwen/Qwen2.5-7B-Instruct",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.7,
                "max_tokens": 512,
            },
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]

    # Usage
    answer = chat_with_vllm("Explain quantum computing in simple terms")
    print(answer)
    ```

    This is a **demo response** — connect a real server to generate actual code!
    """

    private static let vllmExplanation = """
    **vLLM** is a high-throughput, memory-efficient inference engine for large language models.

    ### Quick Start

    1. **Install**: `pip install vllm`
    2. **Serve**: `vllm serve Qwen/Qwen2.5-7B-Instruct`
    3. **Connect**: Add `http://localhost:8000` in the Servers tab

    ### Key Features

    | Feature | Description |
    |---------|-------------|
    | PagedAttention | Efficient KV cache management |
    | Continuous Batching | High throughput under load |
    | Tensor Parallelism | Multi-GPU support |
    | OpenAI-compatible API | Drop-in replacement |

    Once your server is running, this app connects via the **OpenAI-compatible API** — the same endpoints used by ChatGPT clients.

    > 💡 *This is a demo response. Add a real server to chat with an actual model!*
    """

    private static let toolCallExplanation = """
    **Tool Calling** (also known as function calling) lets the model invoke external functions.

    ### How It Works

    1. You define **tools** with a name, description, and JSON schema for parameters
    2. The model decides when to call a tool based on the conversation
    3. The app executes the tool and returns the result to the model

    ### Example Tool Definition

    ```json
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather for a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string"}
          }
        }
      }
    }
    ```

    Try configuring tools in the **chat settings** (⚙️ icon) — the UI works fully in demo mode!

    > *This is a demo response. Tool execution requires a real vLLM server.*
    """

    private static let markdownShowcase = """
    Here's a showcase of **Markdown rendering** in the chat:

    ### Text Formatting
    - **Bold text** and *italic text*
    - `Inline code` and ~~strikethrough~~
    - [Links](https://docs.vllm.ai)

    ### Lists
    1. First ordered item
    2. Second ordered item
       - Nested unordered item

    ### Code Block
    ```swift
    let greeting = "Hello, vLLM!"
    print(greeting)
    ```

    ### Blockquote
    > vLLM Playground makes it easy to interact with your self-hosted LLM.

    All rendering works the same with a real model — the responses will just be *actually generated* instead of pre-written! 😄
    """

    private static let fallbackResponse = """
    Thanks for trying **vLLM Playground** demo mode! 🎉

    I'm a simulated assistant with pre-written responses. In demo mode you can explore the full UI — chat streaming, settings, tools, structured output, and more.

    Here are some things to try:
    - Say **"hello"** for a welcome message
    - Ask about **"code"** or **"python"** for a code example
    - Ask about **"vllm"** or **"server"** to learn how to connect
    - Ask about **"tools"** to learn about function calling
    - Ask about **"markdown"** to see rich text rendering

    To use a real AI model, add your vLLM server in the **Servers** tab!
    """
}
