import Foundation

// MARK: - Stream Event

enum StreamEvent: Sendable {
    case text(String)
    case done(ChatCompletionResponse.Usage?)
}

// MARK: - API Types

struct StreamOptionsPayload: Encodable, Sendable {
    let include_usage: Bool
}

struct ChatCompletionRequest: Encodable {
    var model: String
    var messages: [ChatMessagePayload]
    var temperature: Double
    var max_tokens: Int
    var stream: Bool
    var stream_options: StreamOptionsPayload?

    // Tool calling (optional)
    var tools: [ToolDefinition]?
    var tool_choice: ToolChoiceValue?
    var parallel_tool_calls: Bool?

    // Structured outputs (optional)
    var response_format: ResponseFormatPayload?
    var structured_outputs: StructuredOutputsPayload?

    enum CodingKeys: String, CodingKey {
        case model, messages, temperature, max_tokens, stream, stream_options
        case tools, tool_choice, parallel_tool_calls
        case response_format, structured_outputs
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(model, forKey: .model)
        try container.encode(messages, forKey: .messages)
        // Use Decimal to avoid Double's IEEE 754 artifacts (e.g. 0.7 → 0.69999999999999996)
        let roundedTemp = Decimal(string: String(format: "%.1f", temperature)) ?? Decimal(temperature)
        try container.encode(roundedTemp, forKey: .temperature)
        try container.encode(max_tokens, forKey: .max_tokens)
        try container.encode(stream, forKey: .stream)
        try container.encodeIfPresent(stream_options, forKey: .stream_options)
        try container.encodeIfPresent(tools, forKey: .tools)
        try container.encodeIfPresent(tool_choice, forKey: .tool_choice)
        try container.encodeIfPresent(parallel_tool_calls, forKey: .parallel_tool_calls)
        try container.encodeIfPresent(response_format, forKey: .response_format)
        try container.encodeIfPresent(structured_outputs, forKey: .structured_outputs)
    }
}

// MARK: - Tool Calling Types

struct ToolDefinition: Codable, Sendable, Identifiable, Equatable {
    var id: UUID = UUID()
    var type: String = "function"
    var function: ToolFunction

    enum CodingKeys: String, CodingKey {
        case type, function
    }

    static func == (lhs: ToolDefinition, rhs: ToolDefinition) -> Bool {
        lhs.id == rhs.id
    }
}

struct ToolFunction: Codable, Sendable {
    var name: String
    var description: String?
    var parameters: JSONValue?
}

/// Flexible JSON value for encoding arbitrary JSON (tool parameters, schemas, etc.)
enum JSONValue: Codable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let s = try? container.decode(String.self) { self = .string(s) }
        else if let n = try? container.decode(Double.self) { self = .number(n) }
        else if let b = try? container.decode(Bool.self) { self = .bool(b) }
        else if let o = try? container.decode([String: JSONValue].self) { self = .object(o) }
        else if let a = try? container.decode([JSONValue].self) { self = .array(a) }
        else if container.decodeNil() { self = .null }
        else { throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value") }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let s): try container.encode(s)
        case .number(let n): try container.encode(n)
        case .bool(let b): try container.encode(b)
        case .object(let o): try container.encode(o)
        case .array(let a): try container.encode(a)
        case .null: try container.encodeNil()
        }
    }

    /// Parse a JSON string into a JSONValue
    static func parse(_ jsonString: String) -> JSONValue? {
        guard let data = jsonString.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(JSONValue.self, from: data)
    }

    /// Render as pretty-printed JSON string
    func prettyPrinted() -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(self),
              let str = String(data: data, encoding: .utf8) else { return "null" }
        return str
    }
}

enum ToolChoiceValue: Encodable, Sendable {
    case auto
    case none
    case specific(name: String)

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .auto: try container.encode("auto")
        case .none: try container.encode("none")
        case .specific(let name):
            let obj: [String: String] = ["type": "function"]
            // Need nested encoding
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode("function", forKey: .type)
            try c.encode(["name": name], forKey: .function)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case type, function
    }
}

// MARK: - Structured Output Payload Types

struct ResponseFormatPayload: Encodable, Sendable {
    let type: String
    let json_schema: JsonSchemaPayload?

    enum CodingKeys: String, CodingKey {
        case type, json_schema
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(type, forKey: .type)
        try container.encodeIfPresent(json_schema, forKey: .json_schema)
    }
}

struct JsonSchemaPayload: Encodable, Sendable {
    let name: String
    let schema: JSONValue
}

struct StructuredOutputsPayload: Encodable, Sendable {
    let choice: [String]?
    let regex: String?
    let grammar: String?

    enum CodingKeys: String, CodingKey {
        case choice, regex, grammar
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(choice, forKey: .choice)
        try container.encodeIfPresent(regex, forKey: .regex)
        try container.encodeIfPresent(grammar, forKey: .grammar)
    }
}

// MARK: - Tool Call Response Types

struct ToolCallResponse: Codable, Sendable {
    let id: String
    let type: String?
    let function: ToolCallFunction
}

struct ToolCallFunction: Codable, Sendable {
    let name: String
    let arguments: String
}

// MARK: - Chat Message Payload

struct ChatMessagePayload: Encodable {
    let role: String
    let content: ChatMessageContent?
    var tool_calls: [ToolCallResponse]?
    var tool_call_id: String?
    var name: String?

    init(role: String, content: ChatMessageContent) {
        self.role = role
        self.content = content
    }

    init(role: String, content: ChatMessageContent? = nil, tool_call_id: String, name: String? = nil) {
        self.role = role
        self.content = content
        self.tool_call_id = tool_call_id
        self.name = name
    }

    init(role: String, content: ChatMessageContent?, tool_calls: [ToolCallResponse]) {
        self.role = role
        self.content = content
        self.tool_calls = tool_calls
    }

    enum CodingKeys: String, CodingKey {
        case role, content, tool_calls, tool_call_id, name
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(role, forKey: .role)
        try container.encodeIfPresent(content, forKey: .content)
        try container.encodeIfPresent(tool_calls, forKey: .tool_calls)
        try container.encodeIfPresent(tool_call_id, forKey: .tool_call_id)
        try container.encodeIfPresent(name, forKey: .name)
    }

    enum ChatMessageContent: Encodable {
        case text(String)
        case multimodal([MultimodalPart])

        func encode(to encoder: Encoder) throws {
            var container = encoder.singleValueContainer()
            switch self {
            case .text(let string):
                try container.encode(string)
            case .multimodal(let parts):
                try container.encode(parts)
            }
        }
    }
}

struct MultimodalPart: Encodable {
    let type: String
    let text: String?
    let image_url: ImageURL?

    struct ImageURL: Encodable {
        let url: String
    }
}

struct ChatCompletionResponse: Decodable, Sendable {
    let id: String?
    let choices: [Choice]
    let usage: Usage?

    struct Choice: Decodable, Sendable {
        let index: Int
        let message: ResponseMessage?
        let delta: ResponseDelta?
        let finish_reason: String?
    }

    struct ResponseMessage: Decodable, Sendable {
        let role: String?
        let content: String?
        let tool_calls: [ToolCallResponse]?
    }

    struct ResponseDelta: Decodable, Sendable {
        let role: String?
        let content: String?
    }

    struct Usage: Decodable, Sendable {
        let prompt_tokens: Int?
        let completion_tokens: Int?
        let total_tokens: Int?
    }
}

struct ModelsResponse: Decodable {
    let data: [ModelInfo]

    struct ModelInfo: Decodable {
        let id: String
        let object: String?
        let owned_by: String?
    }
}

struct HealthResponse: Decodable {
    // vLLM /health returns empty 200, but some setups return JSON
}

// MARK: - Prometheus Metrics

struct VLLMMetrics: Sendable {
    var gpuCacheUsage: Double?
    var cpuCacheUsage: Double?
    var avgPromptThroughput: Double?
    var avgGenerationThroughput: Double?
    var numRequestsRunning: Int?
    var numRequestsWaiting: Int?
    var prefixCacheHitRate: Double?
}

// MARK: - API Errors

enum VLLMAPIError: LocalizedError {
    case invalidURL
    case serverUnreachable
    case httpError(statusCode: Int, body: String)
    case decodingError(Error)
    case streamingError(String)
    case noActiveServer
    case timeout

    /// User-friendly message suitable for display in the UI.
    var userMessage: String {
        switch self {
        case .invalidURL:
            return "The server URL appears to be invalid. Please check it in your server settings."
        case .serverUnreachable:
            return "Could not connect to the server. Check the URL and ensure the server is running."
        case .httpError(let code, let body):
            // Try to extract a clean error message from vLLM's JSON response
            if let data = body.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let message = json["message"] as? String {
                return message
            }
            return httpFriendlyMessage(code)
        case .decodingError:
            return "Received an unexpected response from the server."
        case .streamingError:
            return "The response stream was interrupted. Please try again."
        case .noActiveServer:
            return "No server selected. Please add or select a server in Settings."
        case .timeout:
            return "The request timed out. The server might be busy or unreachable."
        }
    }

    /// Technical detail for debugging (shown in "Show Details" expansion).
    var technicalDetail: String? {
        switch self {
        case .httpError(let code, let body):
            let preview = String(body.prefix(300))
            return preview.isEmpty ? "HTTP \(code)" : "HTTP \(code): \(preview)"
        case .decodingError(let error):
            return error.localizedDescription
        case .streamingError(let message):
            return message
        default:
            return nil
        }
    }

    var errorDescription: String? {
        return userMessage
    }

    private func httpFriendlyMessage(_ code: Int) -> String {
        switch code {
        case 400:
            return "The server couldn't process the request. Check your model settings."
        case 401, 403:
            return "Authentication failed. Check your API key in server settings."
        case 404:
            return "Endpoint not found. The server may not support this feature."
        case 422:
            return "Invalid parameters. Check your settings and try again."
        case 429:
            return "Too many requests. Please wait a moment and try again."
        case 500:
            return "The server encountered an internal error. Please try again later."
        case 502, 503:
            return "The server is temporarily unavailable. Please try again later."
        case 504:
            return "The server took too long to respond. It may be overloaded."
        default:
            return "Server returned an error (HTTP \(code))."
        }
    }
}

// MARK: - Protocol

protocol VLLMAPIClientProtocol: Sendable {
    func checkHealth(baseURL: String, apiKey: String?) async throws -> Bool
    func listModels(baseURL: String, apiKey: String?) async throws -> [String]
    func chatCompletion(
        baseURL: String,
        apiKey: String?,
        request: ChatCompletionRequest
    ) async throws -> ChatCompletionResponse
    func streamChatCompletion(
        baseURL: String,
        apiKey: String?,
        request: ChatCompletionRequest
    ) -> AsyncThrowingStream<StreamEvent, Error>
    func fetchMetrics(baseURL: String, apiKey: String?) async throws -> VLLMMetrics
}

// MARK: - Implementation

final class VLLMAPIClient: VLLMAPIClientProtocol, @unchecked Sendable {
    static let shared = VLLMAPIClient()

    private let session: URLSession
    private let decoder = JSONDecoder()
    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = .sortedKeys
        return e
    }()

    init(session: URLSession? = nil) {
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 120
            config.timeoutIntervalForResource = 300
            self.session = URLSession(configuration: config)
        }
    }

    // MARK: - Health Check

    func checkHealth(baseURL: String, apiKey: String?) async throws -> Bool {
        guard let url = URL(string: "\(normalizeURL(baseURL))/health") else {
            throw VLLMAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        applyAuth(&request, apiKey: apiKey)

        do {
            let (_, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                return false
            }
            return httpResponse.statusCode == 200
        } catch {
            throw VLLMAPIError.serverUnreachable
        }
    }

    // MARK: - List Models

    func listModels(baseURL: String, apiKey: String?) async throws -> [String] {
        guard let url = URL(string: "\(normalizeURL(baseURL))/v1/models") else {
            throw VLLMAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        applyAuth(&request, apiKey: apiKey)

        let (data, response) = try await session.data(for: request)
        try validateResponse(response, data: data)

        let modelsResponse = try decoder.decode(ModelsResponse.self, from: data)
        return modelsResponse.data.map(\.id)
    }

    // MARK: - Chat Completion (Non-Streaming)

    func chatCompletion(
        baseURL: String,
        apiKey: String?,
        request body: ChatCompletionRequest
    ) async throws -> ChatCompletionResponse {
        let request = try buildChatRequest(baseURL: baseURL, apiKey: apiKey, body: body)

        let (data, response) = try await session.data(for: request)
        try validateResponse(response, data: data)

        return try decoder.decode(ChatCompletionResponse.self, from: data)
    }

    // MARK: - Chat Completion (Streaming)

    func streamChatCompletion(
        baseURL: String,
        apiKey: String?,
        request body: ChatCompletionRequest
    ) -> AsyncThrowingStream<StreamEvent, Error> {
        AsyncThrowingStream { continuation in
            Task {
                do {
                    var streamBody = body
                    streamBody.stream = true
                    streamBody.stream_options = StreamOptionsPayload(include_usage: true)

                    let request = try buildChatRequest(baseURL: baseURL, apiKey: apiKey, body: streamBody)

                    let (bytes, response) = try await session.bytes(for: request)

                    guard let httpResponse = response as? HTTPURLResponse else {
                        continuation.finish(throwing: VLLMAPIError.serverUnreachable)
                        return
                    }

                    #if DEBUG
                    print("[VLLMAPIClient] Stream response status: \(httpResponse.statusCode)")
                    #endif

                    if httpResponse.statusCode != 200 {
                        var errorBody = ""
                        for try await line in bytes.lines {
                            errorBody += line
                        }
                        #if DEBUG
                        print("[VLLMAPIClient] Stream error body: \(errorBody)")
                        #endif
                        continuation.finish(throwing: VLLMAPIError.httpError(
                            statusCode: httpResponse.statusCode, body: errorBody
                        ))
                        return
                    }

                    var lastUsage: ChatCompletionResponse.Usage?

                    for try await line in bytes.lines {
                        guard line.hasPrefix("data: ") else { continue }

                        let jsonString = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)

                        if jsonString == "[DONE]" {
                            break
                        }

                        guard let jsonData = jsonString.data(using: .utf8) else { continue }

                        do {
                            let chunk = try self.decoder.decode(ChatCompletionResponse.self, from: jsonData)
                            if let content = chunk.choices.first?.delta?.content, !content.isEmpty {
                                continuation.yield(.text(content))
                            }
                            if let usage = chunk.usage {
                                lastUsage = usage
                            }
                        } catch {
                            #if DEBUG
                            print("[VLLMAPIClient] Failed to decode chunk: \(jsonString)")
                            #endif
                        }
                    }

                    continuation.yield(.done(lastUsage))
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }

    // MARK: - Fetch Prometheus Metrics

    func fetchMetrics(baseURL: String, apiKey: String?) async throws -> VLLMMetrics {
        // /metrics lives at the server root, not under /v1.
        // Strip any trailing /v1 or /v1/ from the base URL so we hit the correct path.
        var root = normalizeURL(baseURL)
        if root.hasSuffix("/v1") { root = String(root.dropLast(3)) }
        if root.hasSuffix("/v1/") { root = String(root.dropLast(4)) }

        guard let url = URL(string: "\(root)/metrics") else {
            throw VLLMAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        applyAuth(&request, apiKey: apiKey)

        let (data, response) = try await session.data(for: request)
        try validateResponse(response, data: data)

        let text = String(data: data, encoding: .utf8) ?? ""
        return parsePrometheusMetrics(text)
    }

    // MARK: - Helpers

    func normalizeURL(_ baseURL: String) -> String {
        var url = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        // Auto-prefix http:// if no scheme
        if !url.hasPrefix("http://") && !url.hasPrefix("https://") {
            url = "http://\(url)"
        }
        if url.hasSuffix("/") {
            url = String(url.dropLast())
        }
        return url
    }

    private func applyAuth(_ request: inout URLRequest, apiKey: String?) {
        if let apiKey, !apiKey.isEmpty {
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        }
    }

    private func buildChatRequest(
        baseURL: String,
        apiKey: String?,
        body: ChatCompletionRequest
    ) throws -> URLRequest {
        guard let url = URL(string: "\(normalizeURL(baseURL))/v1/chat/completions") else {
            throw VLLMAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyAuth(&request, apiKey: apiKey)

        request.httpBody = try encoder.encode(body)

        #if DEBUG
        if let httpBody = request.httpBody {
            if let json = String(data: httpBody, encoding: .utf8) {
                print("[VLLMAPIClient] Request URL: \(url)")
                print("[VLLMAPIClient] Request body: \(json)")
            }
            // Pretty-print for readability
            if let jsonObj = try? JSONSerialization.jsonObject(with: httpBody),
               let pretty = try? JSONSerialization.data(withJSONObject: jsonObj, options: [.prettyPrinted, .sortedKeys]),
               let prettyStr = String(data: pretty, encoding: .utf8) {
                print("[VLLMAPIClient] Pretty request:\n\(prettyStr)")
            }
        }
        #endif

        return request
    }

    private func validateResponse(_ response: URLResponse, data: Data) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw VLLMAPIError.serverUnreachable
        }
        guard 200..<300 ~= httpResponse.statusCode else {
            let body = String(data: data, encoding: .utf8) ?? "No response body"
            throw VLLMAPIError.httpError(statusCode: httpResponse.statusCode, body: body)
        }
    }

    private func parsePrometheusMetrics(_ text: String) -> VLLMMetrics {
        var metrics = VLLMMetrics()

        for line in text.split(separator: "\n") {
            let l = String(line)
            if l.hasPrefix("#") { continue }

            if l.hasPrefix("vllm:gpu_cache_usage_perc") || l.hasPrefix("vllm_gpu_cache_usage_perc") {
                metrics.gpuCacheUsage = extractValue(l)
            } else if l.hasPrefix("vllm:cpu_cache_usage_perc") || l.hasPrefix("vllm_cpu_cache_usage_perc") {
                metrics.cpuCacheUsage = extractValue(l)
            } else if l.hasPrefix("vllm:avg_prompt_throughput_toks_per_s") || l.hasPrefix("vllm_avg_prompt_throughput_toks_per_s") {
                metrics.avgPromptThroughput = extractValue(l)
            } else if l.hasPrefix("vllm:avg_generation_throughput_toks_per_s") || l.hasPrefix("vllm_avg_generation_throughput_toks_per_s") {
                metrics.avgGenerationThroughput = extractValue(l)
            } else if l.hasPrefix("vllm:num_requests_running") || l.hasPrefix("vllm_num_requests_running") {
                if let v = extractValue(l) { metrics.numRequestsRunning = Int(v) }
            } else if l.hasPrefix("vllm:num_requests_waiting") || l.hasPrefix("vllm_num_requests_waiting") {
                if let v = extractValue(l) { metrics.numRequestsWaiting = Int(v) }
            } else if l.hasPrefix("vllm:prefix_cache_hit_rate") || l.hasPrefix("vllm_prefix_cache_hit_rate") {
                metrics.prefixCacheHitRate = extractValue(l)
            }
        }

        return metrics
    }

    private func extractValue(_ line: String) -> Double? {
        // Prometheus format: metric_name{labels} value
        // Or: metric_name value
        let parts = line.split(whereSeparator: { $0 == " " || $0 == "\t" })
        guard let last = parts.last else { return nil }
        return Double(last)
    }
}
