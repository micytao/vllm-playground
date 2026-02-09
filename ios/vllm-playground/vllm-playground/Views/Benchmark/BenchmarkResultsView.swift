import SwiftUI
import Charts

struct BenchmarkResultsView: View {
    let result: BenchmarkResult

    private var metrics: [RequestMetric] {
        guard let data = result.requestMetricsJSON else { return [] }
        return (try? JSONDecoder().decode([RequestMetric].self, from: data)) ?? []
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Summary
                summarySection

                // Charts
                if !metrics.isEmpty {
                    ttftChart
                    tpsChart
                    latencyChart
                }

                // Per-request table
                if !metrics.isEmpty {
                    requestTable
                }
            }
            .padding()
        }
        .navigationTitle("Benchmark Results")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: - Summary

    private var summarySection: some View {
        VStack(spacing: 12) {
            HStack(spacing: 8) {
                metricBox("Avg TTFT", String(format: "%.3fs", result.avgTimeToFirstToken))
                metricBox("Avg TPS", String(format: "%.1f", result.avgTokensPerSecond))
                metricBox("Avg Latency", String(format: "%.2fs", result.avgTotalLatency))
            }

            HStack {
                LabeledContent("Model", value: result.model)
                Spacer()
            }
            .font(.caption)

            HStack {
                LabeledContent("Success", value: "\(result.successCount)")
                Spacer()
                LabeledContent("Errors", value: "\(result.errorCount)")
                Spacer()
                LabeledContent("Total", value: "\(result.totalRequests)")
            }
            .font(.caption)
        }
        .padding()
        .background(AppColors.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - TTFT Chart

    private var ttftChart: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Time to First Token")
                .font(.headline)

            Chart(metrics.filter(\.success)) { metric in
                BarMark(
                    x: .value("Request", metric.requestIndex),
                    y: .value("TTFT (s)", metric.timeToFirstToken)
                )
                .foregroundStyle(.blue.gradient)
            }
            .frame(height: 200)
            .chartXAxisLabel("Request #")
            .chartYAxisLabel("Seconds")
        }
        .padding()
        .background(AppColors.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - TPS Chart

    private var tpsChart: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Tokens per Second")
                .font(.headline)

            Chart(metrics.filter(\.success)) { metric in
                BarMark(
                    x: .value("Request", metric.requestIndex),
                    y: .value("TPS", metric.tokensPerSecond)
                )
                .foregroundStyle(.green.gradient)
            }
            .frame(height: 200)
            .chartXAxisLabel("Request #")
            .chartYAxisLabel("Tokens/s")
        }
        .padding()
        .background(AppColors.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Latency Chart

    private var latencyChart: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Total Latency")
                .font(.headline)

            Chart(metrics.filter(\.success)) { metric in
                LineMark(
                    x: .value("Request", metric.requestIndex),
                    y: .value("Latency (s)", metric.totalLatency)
                )
                .foregroundStyle(.orange)
                PointMark(
                    x: .value("Request", metric.requestIndex),
                    y: .value("Latency (s)", metric.totalLatency)
                )
                .foregroundStyle(.orange)
            }
            .frame(height: 200)
            .chartXAxisLabel("Request #")
            .chartYAxisLabel("Seconds")
        }
        .padding()
        .background(AppColors.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Request Table

    private var requestTable: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Per-Request Details")
                .font(.headline)

            ForEach(metrics.sorted(by: { $0.requestIndex < $1.requestIndex })) { metric in
                HStack {
                    Text("#\(metric.requestIndex)")
                        .font(.caption)
                        .frame(width: 30)

                    if metric.success {
                        Text(String(format: "TTFT: %.3fs", metric.timeToFirstToken))
                            .font(.caption2)
                            .monospacedDigit()
                        Spacer()
                        Text(String(format: "TPS: %.1f", metric.tokensPerSecond))
                            .font(.caption2)
                            .monospacedDigit()
                        Spacer()
                        Text(String(format: "%.2fs", metric.totalLatency))
                            .font(.caption2)
                            .monospacedDigit()
                    } else {
                        Text(metric.errorMessage ?? "Error")
                            .font(.caption2)
                            .foregroundStyle(.red)
                        Spacer()
                    }
                }
                .padding(.vertical, 4)

                if metric.id != metrics.last?.id {
                    Divider()
                }
            }
        }
        .padding()
        .background(AppColors.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func metricBox(_ label: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(AppColors.textTertiary)
            Text(value)
                .font(.footnote.weight(.semibold).monospacedDigit())
                .foregroundStyle(AppColors.textPrimary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background(AppColors.inputBg)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

#Preview {
    NavigationStack {
        BenchmarkResultsView(result: BenchmarkResult(
            model: "Qwen/Qwen2.5-7B-Instruct",
            totalRequests: 10,
            concurrentConnections: 2,
            maxTokens: 256,
            prompt: "Hello",
            avgTimeToFirstToken: 0.15,
            avgTokensPerSecond: 42.5,
            avgTotalLatency: 3.2,
            errorCount: 1,
            successCount: 9
        ))
    }
}
