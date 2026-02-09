import Foundation

#if DEBUG
/// Mock API client for SwiftUI Previews and testing.
/// Simulates streaming responses without a real server.
final class MockVLLMAPIClient: VLLMAPIClientProtocol, @unchecked Sendable {
    var shouldFail = false

    func checkHealth(baseURL: String, apiKey: String?) async throws -> Bool {
        if shouldFail { throw VLLMAPIError.serverUnreachable }
        try await Task.sleep(nanoseconds: 200_000_000) // 0.2s
        return true
    }

    func listModels(baseURL: String, apiKey: String?) async throws -> [String] {
        if shouldFail { throw VLLMAPIError.serverUnreachable }
        try await Task.sleep(nanoseconds: 200_000_000)
        return ["Qwen/Qwen2.5-7B-Instruct", "meta-llama/Llama-3.1-8B-Instruct"]
    }

    func chatCompletion(
        baseURL: String,
        apiKey: String?,
        request: ChatCompletionRequest
    ) async throws -> ChatCompletionResponse {
        if shouldFail { throw VLLMAPIError.serverUnreachable }
        try await Task.sleep(nanoseconds: 500_000_000) // 0.5s
        return ChatCompletionResponse(
            id: "mock-\(UUID().uuidString)",
            choices: [
                .init(
                    index: 0,
                    message: .init(role: "assistant", content: "This is a mock response.", tool_calls: nil),
                    delta: nil,
                    finish_reason: "stop"
                )
            ],
            usage: .init(prompt_tokens: 10, completion_tokens: 20, total_tokens: 30)
        )
    }

    func streamChatCompletion(
        baseURL: String,
        apiKey: String?,
        request: ChatCompletionRequest
    ) -> AsyncThrowingStream<StreamEvent, Error> {
        let fail = shouldFail
        return AsyncThrowingStream { continuation in
            Task {
                if fail {
                    continuation.finish(throwing: VLLMAPIError.serverUnreachable)
                    return
                }

                let mockResponse = """
                Hello! I'm a mock response from **\(request.model)**. \
                This simulates streaming output, delivering tokens one at a time. \
                Here's a short poem about AI:\n\n\
                *Silicon dreams in binary light,*\n\
                *Patterns formed through endless night,*\n\
                *Learning, growing, line by line,*\n\
                *A mirror of the human mind.*
                """

                let words = mockResponse.split(separator: " ")
                for (index, word) in words.enumerated() {
                    try? await Task.sleep(nanoseconds: 50_000_000) // 50ms per token
                    let separator = index < words.count - 1 ? " " : ""
                    continuation.yield(.text(String(word) + separator))
                }

                continuation.yield(.done(ChatCompletionResponse.Usage(
                    prompt_tokens: 12,
                    completion_tokens: words.count,
                    total_tokens: 12 + words.count
                )))
                continuation.finish()
            }
        }
    }

    func fetchMetrics(baseURL: String, apiKey: String?) async throws -> VLLMMetrics {
        if shouldFail { throw VLLMAPIError.serverUnreachable }
        return VLLMMetrics(
            gpuCacheUsage: 0.35,
            cpuCacheUsage: 0.0,
            avgPromptThroughput: 125.4,
            avgGenerationThroughput: 42.8,
            numRequestsRunning: 2,
            numRequestsWaiting: 0,
            prefixCacheHitRate: 0.15
        )
    }
}
#endif
