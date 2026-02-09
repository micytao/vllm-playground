import Foundation
import SwiftData

enum MessageRole: String, Codable {
    case system
    case user
    case assistant
    case tool
}

@Model
final class Message {
    @Attribute(.unique) var id: UUID
    var role: MessageRole
    var content: String
    var imageData: Data?
    var timestamp: Date

    // Response metrics (assistant messages only)
    var promptTokens: Int?
    var completionTokens: Int?
    var generationTimeMs: Double?

    // Tool calling (Feature 2)
    var toolCallId: String?
    var toolCallsJSON: String?
    var toolName: String?

    var conversation: Conversation?

    init(
        id: UUID = UUID(),
        role: MessageRole,
        content: String,
        imageData: Data? = nil,
        timestamp: Date = Date(),
        promptTokens: Int? = nil,
        completionTokens: Int? = nil,
        generationTimeMs: Double? = nil,
        toolCallId: String? = nil,
        toolCallsJSON: String? = nil,
        toolName: String? = nil,
        conversation: Conversation? = nil
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.imageData = imageData
        self.timestamp = timestamp
        self.promptTokens = promptTokens
        self.completionTokens = completionTokens
        self.generationTimeMs = generationTimeMs
        self.toolCallId = toolCallId
        self.toolCallsJSON = toolCallsJSON
        self.toolName = toolName
        self.conversation = conversation
    }

    /// Computed tokens per second
    var tokensPerSecond: Double? {
        guard let completionTokens, let generationTimeMs, generationTimeMs > 0 else { return nil }
        return Double(completionTokens) / (generationTimeMs / 1000.0)
    }

    /// Create a transient streaming message (not persisted until streaming completes).
    static func streaming(_ text: String) -> Message {
        Message(role: .assistant, content: text)
    }
}
