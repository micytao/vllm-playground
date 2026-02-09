import Foundation
import SwiftData

@Model
final class Conversation {
    @Attribute(.unique) var id: UUID
    var title: String
    var model: String
    var systemPrompt: String
    var temperature: Double
    var maxTokens: Int
    var createdAt: Date
    var updatedAt: Date

    var serverProfile: ServerProfile?

    @Relationship(deleteRule: .cascade, inverse: \Message.conversation)
    var messages: [Message] = []

    var sortedMessages: [Message] {
        messages.sorted { $0.timestamp < $1.timestamp }
    }

    init(
        id: UUID = UUID(),
        title: String = "New Chat",
        model: String = "",
        systemPrompt: String = "",
        temperature: Double = 0.7,
        maxTokens: Int = 512,
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        serverProfile: ServerProfile? = nil
    ) {
        self.id = id
        self.title = title
        self.model = model
        self.systemPrompt = systemPrompt
        self.temperature = temperature
        self.maxTokens = maxTokens
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.serverProfile = serverProfile
    }
}
