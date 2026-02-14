import SwiftUI

struct ServerMetricsView: View {
    let server: ServerProfile
    @State private var metrics: VLLMMetrics?
    @State private var isLoading = false
    @State private var error: String?
    @State private var autoRefresh = true
    @State private var timer: Timer?
    @State private var lastUpdated: Date?

    var body: some View {
        ZStack {
            AppColors.pageBg.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 16) {
                    // Auto-refresh toggle
                    HStack {
                        Toggle(isOn: $autoRefresh) {
                            HStack(spacing: 8) {
                                if autoRefresh {
                                    Circle()
                                        .fill(AppColors.appSuccess)
                                        .frame(width: 8, height: 8)
                                        .modifier(PulsingIndicator())
                                }
                                Image(systemName: "arrow.triangle.2.circlepath")
                                    .font(.caption)
                                    .foregroundStyle(autoRefresh ? AppColors.appSuccess : AppColors.textSecondary)
                                Text("Auto-refresh (3s)")
                                    .font(.subheadline)
                                    .foregroundStyle(AppColors.textSecondary)
                            }
                        }
                        .tint(AppColors.appPrimary)
                        .toggleStyle(.switch)
                    }
                    .padding(16)
                    .background(AppColors.cardBg)
                    .clipShape(RoundedRectangle(cornerRadius: 16))

                    if let error {
                        HStack(spacing: 8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(AppColors.appRed)
                            Text(error)
                                .font(.footnote)
                                .foregroundStyle(AppColors.appRed)
                            Spacer()
                        }
                        .padding(14)
                        .background(AppColors.appRed.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }

                    if let metrics {
                        // Hero summary numbers
                        heroSummary(metrics)

                        // Cache Utilization
                        metricsCard(title: "Cache Utilization", icon: "memorychip", iconColor: .purple) {
                            if let gpu = metrics.gpuCacheUsage {
                                gaugeRow("GPU KV Cache", value: gpu, color: gaugeColor(gpu))
                            }
                            if let cpu = metrics.cpuCacheUsage {
                                gaugeRow("CPU Cache", value: cpu, color: gaugeColor(cpu))
                            }
                            if let prefix = metrics.prefixCacheHitRate {
                                gaugeRow("Prefix Cache Hit", value: prefix, color: AppColors.appSuccess)
                            }
                            if metrics.gpuCacheUsage == nil && metrics.cpuCacheUsage == nil && metrics.prefixCacheHitRate == nil {
                                emptyMetricText("No cache metrics available")
                            }
                        }

                        // Throughput
                        metricsCard(title: "Throughput", icon: "speedometer", iconColor: .orange) {
                            if let prompt = metrics.avgPromptThroughput {
                                metricRow("Prompt Throughput", value: String(format: "%.1f tok/s", prompt))
                            }
                            if let gen = metrics.avgGenerationThroughput {
                                metricRow("Generation Throughput", value: String(format: "%.1f tok/s", gen))
                            }
                            if metrics.avgPromptThroughput == nil && metrics.avgGenerationThroughput == nil {
                                emptyMetricText("No throughput metrics available")
                            }
                        }

                        // Request Queue
                        metricsCard(title: "Request Queue", icon: "list.number", iconColor: .blue) {
                            if let running = metrics.numRequestsRunning {
                                metricRow("Running", value: "\(running)")
                            }
                            if let waiting = metrics.numRequestsWaiting {
                                metricRow("Waiting", value: "\(waiting)")
                            }
                            if metrics.numRequestsRunning == nil && metrics.numRequestsWaiting == nil {
                                emptyMetricText("No request metrics available")
                            }
                        }
                    } else if isLoading {
                        ProgressView()
                            .frame(maxWidth: .infinity, minHeight: 100)
                    } else {
                        // Empty state
                        VStack(spacing: 16) {
                            ZStack {
                                Circle()
                                    .fill(AppColors.inputBg)
                                    .frame(width: 72, height: 72)
                                Image(systemName: "chart.bar.xaxis")
                                    .font(.title)
                                    .foregroundStyle(AppColors.textTertiary)
                            }
                            Text("No metrics available")
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(AppColors.textSecondary)
                            Text("Make sure the vLLM server exposes the /metrics endpoint.")
                                .font(.caption)
                                .foregroundStyle(AppColors.textTertiary)
                                .multilineTextAlignment(.center)

                            Button {
                                Task { await fetchMetrics() }
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: "arrow.clockwise")
                                    Text("Refresh")
                                }
                                .font(.callout.weight(.medium))
                                .foregroundStyle(AppColors.appPrimary)
                                .padding(.horizontal, 20)
                                .padding(.vertical, 10)
                                .background(AppColors.appPrimary.opacity(0.1))
                                .clipShape(Capsule())
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 40)
                    }

                    // Last updated
                    if let lastUpdated {
                        Text("Last updated: \(lastUpdated.formatted(date: .omitted, time: .standard))")
                            .font(.caption2)
                            .foregroundStyle(AppColors.textTertiary)
                    }
                }
                .padding(16)
            }
        }
        .navigationTitle("Live Metrics")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if autoRefresh {
                    HStack(spacing: 4) {
                        Circle()
                            .fill(AppColors.appSuccess)
                            .frame(width: 6, height: 6)
                            .modifier(PulsingIndicator())
                        Text("Live")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(AppColors.appSuccess)
                    }
                }
            }
        }
        .task {
            await fetchMetrics()
        }
        .onAppear { startTimer() }
        .onDisappear { stopTimer() }
        .onChange(of: autoRefresh) {
            if autoRefresh { startTimer() } else { stopTimer() }
        }
    }

    // MARK: - Hero Summary

    private func heroSummary(_ metrics: VLLMMetrics) -> some View {
        HStack(spacing: 10) {
            if let gpu = metrics.gpuCacheUsage {
                heroBox(
                    value: String(format: "%.0f%%", gpu * 100),
                    label: "GPU Cache",
                    color: gaugeColor(gpu)
                )
            }
            if let gen = metrics.avgGenerationThroughput {
                heroBox(
                    value: String(format: "%.0f", gen),
                    label: "Gen tok/s",
                    color: .orange
                )
            }
            if let running = metrics.numRequestsRunning {
                heroBox(
                    value: "\(running)",
                    label: "Running",
                    color: .blue
                )
            }
        }
        .animation(.easeInOut(duration: 0.3), value: metrics.gpuCacheUsage)
    }

    private func heroBox(value: String, label: String, color: Color) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.title2.monospacedDigit().weight(.bold))
                .foregroundStyle(color)
                .contentTransition(.numericText())
            Text(label)
                .font(.caption2)
                .foregroundStyle(AppColors.textTertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(color.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - Components

    private func metricsCard<Content: View>(title: String, icon: String, iconColor: Color, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(iconColor)
                Text(title.uppercased())
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(AppColors.textSecondary)
            }
            content()
        }
        .padding(16)
        .background(AppColors.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func emptyMetricText(_ text: String) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(AppColors.textTertiary)
    }

    private func metricRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(AppColors.textSecondary)
            Spacer()
            Text(value)
                .font(.subheadline.monospacedDigit().weight(.medium))
                .foregroundStyle(AppColors.textPrimary)
                .contentTransition(.numericText())
        }
        .padding(.vertical, 4)
    }

    private func gaugeRow(_ label: String, value: Double, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(label)
                    .font(.subheadline)
                    .foregroundStyle(AppColors.textSecondary)
                Spacer()
                Text(String(format: "%.1f%%", value * 100))
                    .font(.subheadline.monospacedDigit().weight(.medium))
                    .foregroundStyle(AppColors.textPrimary)
                    .contentTransition(.numericText())
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 5)
                        .fill(AppColors.inputBg)
                        .frame(height: 10)
                    RoundedRectangle(cornerRadius: 5)
                        .fill(color)
                        .frame(width: geo.size.width * min(max(value, 0), 1), height: 10)
                        .animation(.easeInOut(duration: 0.4), value: value)
                }
            }
            .frame(height: 10)
        }
        .padding(.vertical, 4)
    }

    private func gaugeColor(_ value: Double) -> Color {
        if value > 0.9 { return AppColors.appRed }
        if value > 0.7 { return AppColors.appWarning }
        return AppColors.appSuccess
    }

    // MARK: - Data Fetching

    private func fetchMetrics() async {
        // Demo server: return static demo metrics, no network
        if server.isDemo {
            isLoading = true
            metrics = try? await DemoAPIClient().fetchMetrics(baseURL: "", apiKey: nil)
            lastUpdated = Date()
            isLoading = false
            stopTimer()
            autoRefresh = false
            return
        }

        let client = VLLMAPIClient.shared
        let apiKey = KeychainService.load(for: server.id)

        isLoading = true
        do {
            metrics = try await client.fetchMetrics(baseURL: server.baseURL, apiKey: apiKey)
            lastUpdated = Date()
            error = nil
        } catch let err as VLLMAPIError {
            switch err {
            case .httpError(let statusCode, _) where statusCode == 404:
                self.error = "This server does not expose a /metrics endpoint. Prometheus metrics are only available on self-hosted vLLM instances."
                stopTimer()
                autoRefresh = false
            default:
                self.error = err.localizedDescription
            }
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    private func startTimer() {
        stopTimer()
        timer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { _ in
            Task { @MainActor in
                await fetchMetrics()
            }
        }
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }
}

// MARK: - Pulsing Indicator

private struct PulsingIndicator: ViewModifier {
    @State private var isPulsing = false

    func body(content: Content) -> some View {
        content
            .opacity(isPulsing ? 0.3 : 1.0)
            .animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: isPulsing)
            .onAppear { isPulsing = true }
    }
}

#Preview {
    NavigationStack {
        ServerMetricsView(server: ServerProfile(
            name: "Test Server",
            baseURL: "http://localhost:8000"
        ))
    }
}
