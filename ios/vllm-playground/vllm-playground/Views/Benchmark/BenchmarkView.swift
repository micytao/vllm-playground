import SwiftUI
import SwiftData

struct BenchmarkView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.showSidebar) private var showSidebar
    @Query(sort: \ServerProfile.name) private var servers: [ServerProfile]
    @Query(sort: \BenchmarkResult.createdAt, order: .reverse) private var results: [BenchmarkResult]
    @State private var viewModel = BenchmarkViewModel()
    @State private var showServerPicker = false

    /// Prefer real servers; fall back to demo only when no real servers exist.
    private var activeServer: ServerProfile? {
        let real = servers.filter { !$0.isDemo }
        return real.first(where: \.isDefault) ?? real.first ?? servers.first
    }

    var body: some View {
        NavigationStack {
            ZStack {
                AppColors.pageBg.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 20) {
                        configSection
                        if viewModel.isRunning, let progress = viewModel.progress {
                            progressSection(progress)
                        }
                        if let result = viewModel.latestResult {
                            resultSection(result)
                        }
                        if let error = viewModel.error {
                            errorSection(error)
                        }
                        if !results.isEmpty {
                            historySection
                        }
                    }
                    .padding(16)
                }
            }
            .navigationTitle("Benchmark")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showSidebar.wrappedValue.toggle()
                    } label: {
                        Image(systemName: "line.3.horizontal")
                            .font(.body.weight(.medium))
                            .foregroundStyle(AppColors.textSecondary)
                    }
                }
            }
            .toolbarBackground(AppColors.pageBg, for: .navigationBar)
            .onAppear { viewModel.updateServer(activeServer) }
            .onChange(of: activeServer?.id) { viewModel.updateServer(activeServer) }
        }
    }

    // MARK: - Config

    private var configSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("CONFIGURATION")
                .font(.caption.weight(.semibold))
                .foregroundStyle(AppColors.textSecondary)

            TextEditor(text: $viewModel.prompt)
                .font(.subheadline)
                .foregroundStyle(AppColors.textPrimary)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 50)
                .padding(10)
                .background(AppColors.inputBg)
                .clipShape(RoundedRectangle(cornerRadius: 10))

            HStack(spacing: 12) {
                paramSlider("Requests", value: $viewModel.totalRequests, range: 1...100)
                paramSlider("Concurrency", value: $viewModel.concurrentConnections, range: 1...20)
            }

            paramSlider("Max Tokens", value: $viewModel.maxTokens, range: 32...2048)

            Button {
                if viewModel.isRunning {
                    viewModel.cancel()
                } else if servers.count > 1 {
                    showServerPicker = true
                } else {
                    viewModel.run(context: modelContext)
                }
            } label: {
                HStack {
                    if viewModel.isRunning {
                        ProgressView().tint(.white).controlSize(.small)
                    }
                    Text(viewModel.isRunning ? "Cancel" : "Run Benchmark")
                }
                .font(.callout.weight(.semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(viewModel.isRunning ? AppColors.appRed : AppColors.appPrimary)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .disabled(activeServer == nil)
            .confirmationDialog("Select Server", isPresented: $showServerPicker, titleVisibility: .visible) {
                ForEach(servers) { server in
                    let suffix = server.isDemo ? " (Demo)" : (server.isHealthy ? "" : " (offline)")
                    Button("\(server.name)\(suffix)") {
                        viewModel.updateServer(server)
                        viewModel.run(context: modelContext)
                    }
                }
                Button("Cancel", role: .cancel) {}
            }
        }
        .cardStyle()
    }

    private func paramSlider(_ label: String, value: Binding<Int>, range: ClosedRange<Int>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                    .font(.footnote)
                    .foregroundStyle(AppColors.textSecondary)
                Spacer()
                Text("\(value.wrappedValue)")
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(AppColors.textPrimary)
            }
            Slider(
                value: Binding(
                    get: { Double(value.wrappedValue) },
                    set: { value.wrappedValue = Int($0) }
                ),
                in: Double(range.lowerBound)...Double(range.upperBound),
                step: 1
            )
            .tint(AppColors.appPrimary)
        }
    }

    // MARK: - Progress

    private func progressSection(_ progress: BenchmarkService.BenchmarkProgress) -> some View {
        VStack(spacing: 10) {
            ProgressView(value: Double(progress.completed), total: Double(progress.total))
                .tint(AppColors.appPrimary)

            Text("\(progress.completed) / \(progress.total)")
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(AppColors.textSecondary)

            if let metric = progress.latestMetric, metric.success {
                HStack(spacing: 12) {
                    metricPill("TTFT", String(format: "%.2fs", metric.timeToFirstToken))
                    metricPill("TPS", String(format: "%.1f", metric.tokensPerSecond))
                    metricPill("Latency", String(format: "%.2fs", metric.totalLatency))
                }
            }
        }
        .cardStyle()
    }

    // MARK: - Result

    private func resultSection(_ result: BenchmarkResult) -> some View {
        BenchmarkResultCard(result: result, isExpanded: true)
    }

    private func errorSection(_ error: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(AppColors.appRed)
            Text(error).font(.subheadline).foregroundStyle(AppColors.appRed)
            Spacer()
        }
        .cardStyle()
    }

    private var historySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("HISTORY")
                .font(.caption.weight(.semibold))
                .foregroundStyle(AppColors.textSecondary)

            ForEach(results.prefix(10)) { result in
                NavigationLink(destination: BenchmarkResultsView(result: result)) {
                    BenchmarkResultCard(result: result, isExpanded: false)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func metricPill(_ label: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(label).font(.caption2.weight(.semibold)).foregroundStyle(AppColors.textTertiary)
            Text(value).font(.footnote.weight(.semibold).monospacedDigit()).foregroundStyle(AppColors.textPrimary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background(AppColors.inputBg)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: - Result Card

struct BenchmarkResultCard: View {
    let result: BenchmarkResult
    let isExpanded: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(result.model).font(.subheadline.weight(.semibold)).foregroundStyle(AppColors.textPrimary).lineLimit(1)
                        if result.serverProfile?.isDemo == true {
                            Text("DEMO")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(AppColors.appWarning)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 1)
                                .background(AppColors.appWarning.opacity(0.15))
                                .clipShape(Capsule())
                        }
                    }
                    Text(result.createdAt.shortFormatted).font(.caption).foregroundStyle(AppColors.textTertiary)
                }
                Spacer()
                Text("\(result.successCount)/\(result.totalRequests)")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(result.errorCount == 0 ? AppColors.appPrimary : AppColors.appRed)
            }

            HStack(spacing: 8) {
                metricBox("Avg TTFT", String(format: "%.3fs", result.avgTimeToFirstToken))
                metricBox("Avg TPS", String(format: "%.1f", result.avgTokensPerSecond))
                metricBox("Avg Latency", String(format: "%.2fs", result.avgTotalLatency))
            }
        }
        .cardStyle()
    }

    private func metricBox(_ label: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(label).font(.caption2.weight(.semibold)).foregroundStyle(AppColors.textTertiary)
            Text(value).font(.footnote.weight(.semibold).monospacedDigit()).foregroundStyle(AppColors.textPrimary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background(AppColors.inputBg)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

#Preview {
    BenchmarkView()
        .modelContainer(for: [ServerProfile.self, BenchmarkResult.self], inMemory: true)
}
