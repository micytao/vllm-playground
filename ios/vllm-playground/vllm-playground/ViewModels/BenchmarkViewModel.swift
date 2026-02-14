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

        // Route demo to simulated benchmark
        if profile.isDemo {
            runTask = Task { await runDemoBenchmark(profile: profile, context: context) }
            return
        }

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

    // MARK: - Demo Benchmark

    /// Simulates benchmark requests with realistic randomized metrics.
    private func runDemoBenchmark(profile: ServerProfile, context: ModelContext) async {
        var metrics: [RequestMetric] = []
        let total = totalRequests

        for i in 0..<total {
            guard !Task.isCancelled else { break }

            // Simulate request latency
            let delay = Double.random(in: 0.5...2.0)
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))

            let ttft = Double.random(in: 0.08...0.25)
            let tps = Double.random(in: 25...60)
            let tokens = Int(Double(maxTokens) * Double.random(in: 0.7...1.0))
            let latency = ttft + Double(tokens) / tps

            let metric = RequestMetric(
                requestIndex: i,
                timeToFirstToken: ttft,
                tokensPerSecond: tps,
                totalLatency: latency,
                totalTokens: tokens,
                success: true
            )
            metrics.append(metric)

            progress = BenchmarkService.BenchmarkProgress(
                completed: i + 1,
                total: total,
                latestMetric: metric
            )
        }

        guard !metrics.isEmpty else {
            isRunning = false
            return
        }

        let successful = metrics.filter(\.success)
        let avgTTFT = successful.map(\.timeToFirstToken).reduce(0, +) / Double(successful.count)
        let avgTPS = successful.map(\.tokensPerSecond).reduce(0, +) / Double(successful.count)
        let avgLatency = successful.map(\.totalLatency).reduce(0, +) / Double(successful.count)

        let result = BenchmarkResult(
            model: "Demo Model",
            totalRequests: total,
            concurrentConnections: concurrentConnections,
            maxTokens: maxTokens,
            prompt: prompt,
            avgTimeToFirstToken: avgTTFT,
            avgTokensPerSecond: avgTPS,
            avgTotalLatency: avgLatency,
            errorCount: 0,
            successCount: successful.count,
            requestMetricsJSON: try? JSONEncoder().encode(metrics),
            serverProfile: profile
        )

        context.insert(result)
        try? context.save()

        latestResult = result
        isRunning = false
    }

    // MARK: - Cancel

    func cancel() {
        runTask?.cancel()
        runTask = nil
        isRunning = false
    }
}
