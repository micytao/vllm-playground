import Foundation
import SwiftData

enum ServerType: String, Codable, CaseIterable, Identifiable {
    case vllm = "vLLM"
    case vllmOmni = "vLLM-Omni"

    var id: String { rawValue }

    var description: String {
        switch self {
        case .vllm: return "Standard vLLM server for text and vision models"
        case .vllmOmni: return "vLLM-Omni server with image, audio & TTS generation"
        }
    }

    var icon: String {
        switch self {
        case .vllm: return "text.bubble"
        case .vllmOmni: return "waveform.and.mic"
        }
    }

    var defaultPort: Int {
        switch self {
        case .vllm: return 8000
        case .vllmOmni: return 8091
        }
    }
}

@Model
final class ServerProfile {
    @Attribute(.unique) var id: UUID
    var name: String
    var baseURL: String
    var omniBaseURL: String = ""
    var serverTypeRaw: String = "vLLM"
    var isDefault: Bool
    var lastConnected: Date?
    var availableModels: [String]
    var defaultModel: String?
    var createdAt: Date
    var updatedAt: Date

    /// We do NOT store apiKey in SwiftData for security.
    /// Use KeychainService with this profile's id as key.

    @Relationship(deleteRule: .cascade, inverse: \Conversation.serverProfile)
    var conversations: [Conversation] = []

    @Relationship(deleteRule: .cascade, inverse: \BenchmarkResult.serverProfile)
    var benchmarkResults: [BenchmarkResult] = []

    var isHealthy: Bool = false

    var serverType: ServerType {
        get { ServerType(rawValue: serverTypeRaw) ?? .vllm }
        set { serverTypeRaw = newValue.rawValue }
    }

    init(
        id: UUID = UUID(),
        name: String,
        baseURL: String,
        omniBaseURL: String = "",
        serverType: ServerType = .vllm,
        isDefault: Bool = false,
        lastConnected: Date? = nil,
        availableModels: [String] = [],
        defaultModel: String? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.name = name
        self.baseURL = baseURL
        self.omniBaseURL = omniBaseURL
        self.serverTypeRaw = serverType.rawValue
        self.isDefault = isDefault
        self.lastConnected = lastConnected
        self.availableModels = availableModels
        self.defaultModel = defaultModel
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    /// The effective Omni URL. Falls back to deriving from baseURL with port 8091.
    var effectiveOmniURL: String {
        if !omniBaseURL.isEmpty { return omniBaseURL }
        // Derive from baseURL by swapping port to 8091
        return Self.deriveOmniURL(from: baseURL)
    }

    /// Derive the Omni URL from a base URL by replacing the port with 8091.
    static func deriveOmniURL(from base: String) -> String {
        guard var components = URLComponents(string: base) else {
            return base
        }
        components.port = 8091
        return components.string ?? base
    }
}
