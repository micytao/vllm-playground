import Foundation
import SwiftData

@Model
final class BenchmarkResult {
    @Attribute(.unique) var id: UUID
    var model: String
    var totalRequests: Int
    var concurrentConnections: Int
    var maxTokens: Int
    var prompt: String

    // Aggregate metrics
    var avgTimeToFirstToken: Double  // seconds
    var avgTokensPerSecond: Double
    var avgTotalLatency: Double      // seconds
    var errorCount: Int
    var successCount: Int

    // Per-request metrics stored as JSON
    var requestMetricsJSON: Data?

    var createdAt: Date

    var serverProfile: ServerProfile?

    init(
        id: UUID = UUID(),
        model: String,
        totalRequests: Int,
        concurrentConnections: Int,
        maxTokens: Int,
        prompt: String,
        avgTimeToFirstToken: Double = 0,
        avgTokensPerSecond: Double = 0,
        avgTotalLatency: Double = 0,
        errorCount: Int = 0,
        successCount: Int = 0,
        requestMetricsJSON: Data? = nil,
        createdAt: Date = Date(),
        serverProfile: ServerProfile? = nil
    ) {
        self.id = id
        self.model = model
        self.totalRequests = totalRequests
        self.concurrentConnections = concurrentConnections
        self.maxTokens = maxTokens
        self.prompt = prompt
        self.avgTimeToFirstToken = avgTimeToFirstToken
        self.avgTokensPerSecond = avgTokensPerSecond
        self.avgTotalLatency = avgTotalLatency
        self.errorCount = errorCount
        self.successCount = successCount
        self.requestMetricsJSON = requestMetricsJSON
        self.createdAt = createdAt
        self.serverProfile = serverProfile
    }
}

/// Per-request metric for detailed breakdown.
struct RequestMetric: Codable, Identifiable {
    var id: UUID = UUID()
    var requestIndex: Int
    var timeToFirstToken: Double   // seconds
    var tokensPerSecond: Double
    var totalLatency: Double       // seconds
    var totalTokens: Int
    var success: Bool
    var errorMessage: String?
}
