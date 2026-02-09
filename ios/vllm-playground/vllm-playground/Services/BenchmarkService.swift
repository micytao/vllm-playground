import Foundation

/// Lightweight benchmarking engine that sends concurrent requests to a vLLM server
/// and measures performance metrics (TTFT, TPS, latency).
final class BenchmarkService: @unchecked Sendable {
    static let shared = BenchmarkService()

    private let apiClient = VLLMAPIClient.shared

    struct BenchmarkConfig {
        var baseURL: String
        var apiKey: String?
        var model: String
        var prompt: String
        var maxTokens: Int
        var totalRequests: Int
        var concurrentConnections: Int
    }

    struct BenchmarkProgress {
        var completed: Int
        var total: Int
        var latestMetric: RequestMetric?
    }

    /// Run a benchmark with the given configuration.
    /// Reports progress via the callback and returns the final result.
    func run(
        config: BenchmarkConfig,
        onProgress: @escaping @Sendable (BenchmarkProgress) -> Void
    ) async throws -> BenchmarkResult {
        let metrics = try await withThrowingTaskGroup(of: RequestMetric.self) { group in
            var results: [RequestMetric] = []
            var pendingRequests = 0
            var requestIndex = 0

            // Seed initial concurrent tasks
            for _ in 0..<min(config.concurrentConnections, config.totalRequests) {
                let idx = requestIndex
                requestIndex += 1
                pendingRequests += 1
                group.addTask {
                    await self.runSingleRequest(config: config, index: idx)
                }
            }

            // Collect results and add more tasks as slots free up
            for try await metric in group {
                results.append(metric)
                pendingRequests -= 1

                onProgress(BenchmarkProgress(
                    completed: results.count,
                    total: config.totalRequests,
                    latestMetric: metric
                ))

                if requestIndex < config.totalRequests {
                    let idx = requestIndex
                    requestIndex += 1
                    pendingRequests += 1
                    group.addTask {
                        await self.runSingleRequest(config: config, index: idx)
                    }
                }
            }

            return results
        }

        return buildResult(config: config, metrics: metrics)
    }

    // MARK: - Single Request

    private func runSingleRequest(config: BenchmarkConfig, index: Int) async -> RequestMetric {
        let messages = [
            ChatMessagePayload(role: "user", content: .text(config.prompt))
        ]

        let request = ChatCompletionRequest(
            model: config.model,
            messages: messages,
            temperature: 0.0,  // Deterministic for benchmarks
            max_tokens: config.maxTokens,
            stream: true
        )

        let startTime = CFAbsoluteTimeGetCurrent()
        var firstTokenTime: CFAbsoluteTime?
        var totalTokens = 0

        do {
            let stream = apiClient.streamChatCompletion(
                baseURL: config.baseURL,
                apiKey: config.apiKey,
                request: request
            )

            for try await event in stream {
                switch event {
                case .text(let token):
                    if firstTokenTime == nil {
                        firstTokenTime = CFAbsoluteTimeGetCurrent()
                    }
                    // Rough token counting: split by spaces + punctuation
                    totalTokens += max(1, token.split(separator: " ").count)
                case .done(let usage):
                    // Use actual token count from usage if available
                    if let ct = usage?.completion_tokens {
                        totalTokens = ct
                    }
                }
            }

            let endTime = CFAbsoluteTimeGetCurrent()
            let totalLatency = endTime - startTime
            let ttft = (firstTokenTime ?? endTime) - startTime
            let generationTime = endTime - (firstTokenTime ?? endTime)
            let tps = generationTime > 0 ? Double(totalTokens) / generationTime : 0

            return RequestMetric(
                requestIndex: index,
                timeToFirstToken: ttft,
                tokensPerSecond: tps,
                totalLatency: totalLatency,
                totalTokens: totalTokens,
                success: true,
                errorMessage: nil
            )
        } catch {
            let endTime = CFAbsoluteTimeGetCurrent()
            return RequestMetric(
                requestIndex: index,
                timeToFirstToken: 0,
                tokensPerSecond: 0,
                totalLatency: endTime - startTime,
                totalTokens: 0,
                success: false,
                errorMessage: error.localizedDescription
            )
        }
    }

    // MARK: - Build Result

    private func buildResult(config: BenchmarkConfig, metrics: [RequestMetric]) -> BenchmarkResult {
        let successful = metrics.filter(\.success)
        let failed = metrics.filter { !$0.success }

        let avgTTFT = successful.isEmpty ? 0 :
            successful.map(\.timeToFirstToken).reduce(0, +) / Double(successful.count)
        let avgTPS = successful.isEmpty ? 0 :
            successful.map(\.tokensPerSecond).reduce(0, +) / Double(successful.count)
        let avgLatency = successful.isEmpty ? 0 :
            successful.map(\.totalLatency).reduce(0, +) / Double(successful.count)

        let metricsData = try? JSONEncoder().encode(metrics)

        return BenchmarkResult(
            model: config.model,
            totalRequests: config.totalRequests,
            concurrentConnections: config.concurrentConnections,
            maxTokens: config.maxTokens,
            prompt: config.prompt,
            avgTimeToFirstToken: avgTTFT,
            avgTokensPerSecond: avgTPS,
            avgTotalLatency: avgLatency,
            errorCount: failed.count,
            successCount: successful.count,
            requestMetricsJSON: metricsData
        )
    }
}
