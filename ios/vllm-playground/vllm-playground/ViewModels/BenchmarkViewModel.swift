import Foundation
import SwiftUI
import SwiftData

@Observable
@MainActor
final class BenchmarkViewModel {
    // Configuration
    var prompt = "Write a short poem about artificial intelligence."
    var maxTokens = 256
    var totalRequests = 10
    var concurrentConnections = 2

    // State
    var isRunning = false
    var progress: BenchmarkService.BenchmarkProgress?
    var latestResult: BenchmarkResult?
    var error: String?

    // Server
    private var serverProfile: ServerProfile?
    private let benchmarkService = BenchmarkService.shared
    private var runTask: Task<Void, Never>?

    init(serverProfile: ServerProfile? = nil) {
        self.serverProfile = serverProfile
    }

    func updateServer(_ profile: ServerProfile?) {
        self.serverProfile = profile
    }

    var selectedModel: String {
        serverProfile?.availableModels.first ?? ""
    }

    // MARK: - Run Benchmark

    func run(context: ModelContext) {
        guard let profile = serverProfile else {
            error = "No server selected"
            return
        }

        guard !selectedModel.isEmpty else {
            error = "No model available on server"
            return
        }

        isRunning = true
        error = nil
        progress = nil
        latestResult = nil

        let config = BenchmarkService.BenchmarkConfig(
            baseURL: profile.baseURL,
            apiKey: KeychainService.load(for: profile.id),
            model: selectedModel,
            prompt: prompt,
            maxTokens: maxTokens,
            totalRequests: totalRequests,
            concurrentConnections: concurrentConnections
        )

        runTask = Task {
            do {
                let result = try await benchmarkService.run(config: config) { [weak self] progress in
                    Task { @MainActor in
                        self?.progress = progress
                    }
                }

                result.serverProfile = profile
                context.insert(result)
                try? context.save()

                self.latestResult = result
                self.isRunning = false
            } catch {
                self.error = (error as? VLLMAPIError)?.userMessage ?? error.localizedDescription
                self.isRunning = false
            }
        }
    }

    // MARK: - Cancel

    func cancel() {
        runTask?.cancel()
        runTask = nil
        isRunning = false
    }
}
