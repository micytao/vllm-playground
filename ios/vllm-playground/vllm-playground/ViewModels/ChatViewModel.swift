import Foundation
import SwiftUI
import SwiftData

@Observable
@MainActor
final class ChatViewModel {
    // Chat state
    var isStreaming = false
    var streamingText = ""
    var error: String?

    // Settings (synced with conversation)
    var selectedModel: String = ""
    var temperature: Double = 0.7
    var maxTokens: Int = 1024
    var systemPrompt: String = ""

    // Available models from server
    var availableModels: [String] = []

    // VLM image attachment
    var attachedImageData: Data?

    // Tool calling
    var tools: [ToolDefinition] = []
    var toolChoice: String = "auto"  // "auto", "none"
    var parallelToolCalls: Bool = false
    var pendingToolCalls: [ToolCallResponse] = []

    // Structured outputs
    var structuredOutput: StructuredOutputConfig?

    // Reference
    var conversation: Conversation
    private var serverProfile: ServerProfile?
    private let apiClient: VLLMAPIClientProtocol
    private var streamTask: Task<Void, Never>?

    init(
        conversation: Conversation,
        serverProfile: ServerProfile?,
        apiClient: VLLMAPIClientProtocol = VLLMAPIClient.shared
    ) {
        self.conversation = conversation
        self.serverProfile = serverProfile
        self.apiClient = apiClient

        // Initialize settings from conversation
        self.selectedModel = conversation.model
        self.temperature = conversation.temperature
        self.maxTokens = conversation.maxTokens
        self.systemPrompt = conversation.systemPrompt

        // Load available models
        if let profile = serverProfile {
            self.availableModels = profile.availableModels
            if selectedModel.isEmpty, let defaultModel = profile.defaultModel, !defaultModel.isEmpty {
                selectedModel = defaultModel
            }
        }
    }

    // MARK: - Send Message

    func sendMessage(_ text: String, context: ModelContext) {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        guard !selectedModel.isEmpty else {
            error = "Please select a model first"
            return
        }
        guard let profile = serverProfile else {
            error = "No server selected"
            return
        }

        let apiKey = KeychainService.load(for: profile.id)
        error = nil

        // Build user message content
        let userMessage: Message
        if let imageData = attachedImageData {
            userMessage = Message(
                role: .user,
                content: text,
                imageData: imageData,
                conversation: conversation
            )
        } else {
            userMessage = Message(
                role: .user,
                content: text,
                conversation: conversation
            )
        }

        conversation.messages.append(userMessage)
        context.insert(userMessage)
        attachedImageData = nil

        // Update conversation metadata
        if conversation.title == "New Chat" {
            conversation.title = text.firstLineTitle
        }
        conversation.model = selectedModel
        conversation.temperature = temperature
        conversation.maxTokens = maxTokens
        conversation.systemPrompt = systemPrompt
        conversation.updatedAt = Date()

        // Build API messages
        let apiMessages = buildAPIMessages()

        // Build request
        var request = ChatCompletionRequest(
            model: selectedModel,
            messages: apiMessages,
            temperature: temperature,
            max_tokens: maxTokens,
            stream: !tools.isEmpty ? false : true  // Tool calls require non-streaming
        )

        // Add tools if configured
        if !tools.isEmpty {
            request.tools = tools
            request.tool_choice = toolChoice == "none" ? .none : .auto
            if parallelToolCalls { request.parallel_tool_calls = true }
        }

        // Add structured output if configured
        if let config = structuredOutput {
            config.applyTo(request: &request)
        }

        if !tools.isEmpty {
            // Non-streaming tool call mode
            sendWithToolCalls(request: request, profile: profile, apiKey: apiKey, context: context)
        } else {
            // Streaming mode
            sendStreaming(request: request, profile: profile, apiKey: apiKey, context: context)
        }
    }

    // MARK: - Streaming Send

    private func sendStreaming(request: ChatCompletionRequest, profile: ServerProfile, apiKey: String?, context: ModelContext) {
        isStreaming = true
        streamingText = ""

        let startTime = Date()

        streamTask = Task {
            do {
                let stream = apiClient.streamChatCompletion(
                    baseURL: profile.baseURL,
                    apiKey: apiKey,
                    request: request
                )

                var lastUsage: ChatCompletionResponse.Usage?

                for try await event in stream {
                    switch event {
                    case .text(let token):
                        streamingText += token
                    case .done(let usage):
                        lastUsage = usage
                    }
                }

                let generationTime = Date().timeIntervalSince(startTime) * 1000 // ms

                // Streaming finished - save assistant message with metrics
                let assistantMessage = Message(
                    role: .assistant,
                    content: streamingText,
                    promptTokens: lastUsage?.prompt_tokens,
                    completionTokens: lastUsage?.completion_tokens,
                    generationTimeMs: generationTime,
                    conversation: conversation
                )
                conversation.messages.append(assistantMessage)
                context.insert(assistantMessage)
                conversation.updatedAt = Date()

                isStreaming = false
                streamingText = ""

                try? context.save()
            } catch is CancellationError {
                // User cancelled - save partial response if any
                if !streamingText.isEmpty {
                    let partialMessage = Message(
                        role: .assistant,
                        content: streamingText + "\n\n*(generation stopped)*",
                        conversation: conversation
                    )
                    conversation.messages.append(partialMessage)
                    context.insert(partialMessage)
                    try? context.save()
                }
                isStreaming = false
                streamingText = ""
            } catch {
                self.error = (error as? VLLMAPIError)?.userMessage ?? error.localizedDescription
                isStreaming = false
                streamingText = ""
            }
        }
    }

    // MARK: - Non-Streaming with Tool Calls

    private func sendWithToolCalls(request: ChatCompletionRequest, profile: ServerProfile, apiKey: String?, context: ModelContext) {
        isStreaming = true
        streamingText = ""

        let startTime = Date()

        streamTask = Task {
            do {
                let response = try await apiClient.chatCompletion(
                    baseURL: profile.baseURL,
                    apiKey: apiKey,
                    request: request
                )

                let generationTime = Date().timeIntervalSince(startTime) * 1000

                guard let choice = response.choices.first else {
                    self.error = "No response from model"
                    isStreaming = false
                    return
                }

                if let toolCalls = choice.message?.tool_calls, !toolCalls.isEmpty {
                    // Model wants to call tools -- save as assistant message with tool_calls
                    let content = choice.message?.content ?? ""
                    let toolCallsData = try? JSONEncoder().encode(toolCalls)
                    let toolCallsJSON = toolCallsData.flatMap { String(data: $0, encoding: .utf8) }

                    let assistantMsg = Message(
                        role: .assistant,
                        content: content,
                        promptTokens: response.usage?.prompt_tokens,
                        completionTokens: response.usage?.completion_tokens,
                        generationTimeMs: generationTime,
                        toolCallsJSON: toolCallsJSON,
                        conversation: conversation
                    )
                    conversation.messages.append(assistantMsg)
                    context.insert(assistantMsg)

                    pendingToolCalls = toolCalls
                    isStreaming = false
                    try? context.save()
                } else {
                    // Normal response
                    let content = choice.message?.content ?? ""
                    let assistantMsg = Message(
                        role: .assistant,
                        content: content,
                        promptTokens: response.usage?.prompt_tokens,
                        completionTokens: response.usage?.completion_tokens,
                        generationTimeMs: generationTime,
                        conversation: conversation
                    )
                    conversation.messages.append(assistantMsg)
                    context.insert(assistantMsg)
                    conversation.updatedAt = Date()

                    isStreaming = false
                    try? context.save()
                }
            } catch is CancellationError {
                isStreaming = false
            } catch {
                self.error = (error as? VLLMAPIError)?.userMessage ?? error.localizedDescription
                isStreaming = false
            }
        }
    }

    // MARK: - Submit Tool Results

    func submitToolResults(_ results: [(toolCallId: String, name: String, content: String)], context: ModelContext) {
        guard let profile = serverProfile else { return }
        let apiKey = KeychainService.load(for: profile.id)

        // Save tool result messages
        for result in results {
            let toolMsg = Message(
                role: .tool,
                content: result.content,
                toolCallId: result.toolCallId,
                toolName: result.name,
                conversation: conversation
            )
            conversation.messages.append(toolMsg)
            context.insert(toolMsg)
        }

        pendingToolCalls = []
        conversation.updatedAt = Date()

        // Rebuild messages and continue conversation
        let apiMessages = buildAPIMessages()

        var request = ChatCompletionRequest(
            model: selectedModel,
            messages: apiMessages,
            temperature: temperature,
            max_tokens: maxTokens,
            stream: false
        )

        if !tools.isEmpty {
            request.tools = tools
            request.tool_choice = toolChoice == "none" ? .none : .auto
        }

        sendWithToolCalls(request: request, profile: profile, apiKey: apiKey, context: context)
    }

    // MARK: - Stop Streaming

    func stopStreaming() {
        streamTask?.cancel()
        streamTask = nil
    }

    // MARK: - Attach Image (VLM)

    func attachImage(_ data: Data) {
        attachedImageData = data
    }

    func removeAttachment() {
        attachedImageData = nil
    }

    // MARK: - Build API Messages

    private func buildAPIMessages() -> [ChatMessagePayload] {
        var apiMessages: [ChatMessagePayload] = []

        // System prompt
        if !systemPrompt.isEmpty {
            apiMessages.append(ChatMessagePayload(
                role: "system",
                content: .text(systemPrompt)
            ))
        }

        // Conversation history
        for message in conversation.sortedMessages {
            if message.role == .system { continue }

            if message.role == .tool {
                // Tool result message
                apiMessages.append(ChatMessagePayload(
                    role: "tool",
                    content: .text(message.content),
                    tool_call_id: message.toolCallId ?? "",
                    name: message.toolName
                ))
                continue
            }

            // Assistant message with tool calls
            if message.role == .assistant, let toolCallsJSON = message.toolCallsJSON,
               let data = toolCallsJSON.data(using: .utf8),
               let toolCalls = try? JSONDecoder().decode([ToolCallResponse].self, from: data) {
                let payload = ChatMessagePayload(
                    role: "assistant",
                    content: message.content.isEmpty ? nil : .text(message.content),
                    tool_calls: toolCalls
                )
                apiMessages.append(payload)
                continue
            }

            if let imageData = message.imageData {
                // Multimodal message (VLM)
                let parts: [MultimodalPart] = [
                    MultimodalPart(
                        type: "text",
                        text: message.content,
                        image_url: nil
                    ),
                    MultimodalPart(
                        type: "image_url",
                        text: nil,
                        image_url: .init(url: imageData.toBase64DataURL())
                    ),
                ]
                apiMessages.append(ChatMessagePayload(
                    role: message.role.rawValue,
                    content: .multimodal(parts)
                ))
            } else {
                apiMessages.append(ChatMessagePayload(
                    role: message.role.rawValue,
                    content: .text(message.content)
                ))
            }
        }

        return apiMessages
    }

    // MARK: - Preview Helper

    #if DEBUG
    static func preview() -> ChatViewModel {
        let conversation = Conversation(title: "Preview Chat")
        let profile = ServerProfile(name: "Test", baseURL: "http://localhost:8000")
        return ChatViewModel(
            conversation: conversation,
            serverProfile: profile,
            apiClient: MockVLLMAPIClient()
        )
    }
    #endif
}
