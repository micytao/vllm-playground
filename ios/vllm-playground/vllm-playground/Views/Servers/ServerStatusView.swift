import SwiftUI

struct ServerStatusView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    let server: ServerProfile
    @State private var viewModel = ServerProfileViewModel()
    @State private var showEditSheet = false
    @State private var showDeleteConfirmation = false
    @State private var isTesting = false
    @State private var testResult: TestResult?

    enum TestResult {
        case success(latency: TimeInterval, modelCount: Int)
        case failure(String)
    }

    var body: some View {
        ZStack {
            AppColors.pageBg.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 16) {
                    // Status hero
                    VStack(spacing: 12) {
                        ZStack {
                            Circle()
                                .fill(server.isHealthy ? AppColors.appSuccess.opacity(0.15) : AppColors.appRed.opacity(0.15))
                                .frame(width: 64, height: 64)

                            Image(systemName: server.serverType.icon)
                                .font(.title)
                                .foregroundStyle(server.isHealthy ? AppColors.appSuccess : AppColors.appRed)
                        }

                        if viewModel.isCheckingHealth {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Text(server.isHealthy ? "Connected" : "Unreachable")
                                .font(.headline)
                                .foregroundStyle(server.isHealthy ? AppColors.appSuccess : AppColors.appRed)
                        }

                        if let error = viewModel.healthError {
                            Text(error)
                                .font(.footnote)
                                .foregroundStyle(AppColors.appRed)
                                .multilineTextAlignment(.center)
                        }
                    }
                    .padding(.vertical, 8)

                    // Connection info
                    infoCard {
                        VStack(spacing: 0) {
                            infoRow("Type", value: server.serverType.rawValue)
                            Divider().background(AppColors.border)
                            infoRow("URL", value: server.baseURL)
                            if server.serverType == .vllmOmni {
                                Divider().background(AppColors.border)
                                infoRow("Omni URL", value: server.effectiveOmniURL)
                            }
                            if let lastConnected = server.lastConnected {
                                Divider().background(AppColors.border)
                                infoRow("Last Connected", value: lastConnected.shortFormatted)
                            }
                            Divider().background(AppColors.border)
                            infoRow("Default", value: server.isDefault ? "Yes" : "No")
                        }
                    }

                    // Models
                    infoCard {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Text("Models")
                                    .font(.footnote.weight(.semibold))
                                    .foregroundStyle(AppColors.textSecondary)
                                    .textCase(.uppercase)
                                Spacer()
                                Text("\(server.availableModels.count)")
                                    .font(.footnote.weight(.medium))
                                    .foregroundStyle(AppColors.textTertiary)
                            }

                            if server.availableModels.isEmpty {
                                Text("No models loaded")
                                    .font(.subheadline)
                                    .foregroundStyle(AppColors.textTertiary)
                            } else {
                                ForEach(server.availableModels, id: \.self) { model in
                                    HStack(spacing: 8) {
                                        Image(systemName: "cpu")
                                            .font(.caption)
                                            .foregroundStyle(AppColors.textTertiary)
                                        Text(model)
                                            .font(.system(.subheadline, design: .monospaced))
                                            .foregroundStyle(AppColors.textPrimary)
                                            .lineLimit(1)
                                    }
                                }
                            }
                        }
                    }

                    // Live Metrics
                    if server.isHealthy {
                        if isMaaSEndpoint {
                            // MaaS warning
                            HStack(spacing: 10) {
                                Image(systemName: "info.circle.fill")
                                    .font(.subheadline)
                                    .foregroundStyle(AppColors.appWarning)
                                Text("Live Metrics is not available for MaaS servers. It requires a self-hosted vLLM instance that exposes the /metrics endpoint.")
                                    .font(.caption)
                                    .foregroundStyle(AppColors.textSecondary)
                            }
                            .padding(14)
                            .background(AppColors.appWarning.opacity(0.08))
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        } else {
                            NavigationLink {
                                ServerMetricsView(server: server)
                            } label: {
                                HStack {
                                    Image(systemName: "chart.bar.xaxis")
                                        .font(.subheadline)
                                        .foregroundStyle(AppColors.appPrimary)
                                    Text("Live Metrics")
                                        .font(.callout.weight(.medium))
                                        .foregroundStyle(AppColors.textPrimary)
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption)
                                        .foregroundStyle(AppColors.textTertiary)
                                }
                                .padding(16)
                                .background(AppColors.cardBg)
                                .clipShape(RoundedRectangle(cornerRadius: 16))
                            }
                        }
                    }

                    // Action buttons
                    HStack(spacing: 12) {
                        Button {
                            Task {
                                await viewModel.checkHealth(for: server)
                                await viewModel.fetchModels(for: server)
                            }
                        } label: {
                            HStack {
                                Image(systemName: "arrow.clockwise")
                                Text("Refresh")
                            }
                            .font(.callout.weight(.medium))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(AppColors.cardBg)
                            .foregroundStyle(AppColors.textPrimary)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        }

                        Button {
                            testConnection()
                        } label: {
                            HStack {
                                if isTesting {
                                    ProgressView()
                                        .tint(.white)
                                        .controlSize(.small)
                                } else {
                                    Image(systemName: "bolt.fill")
                                }
                                Text(isTesting ? "Testing..." : "Test")
                            }
                            .font(.callout.weight(.medium))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(AppColors.appPrimary)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                        .disabled(isTesting)
                    }

                    // Test result
                    if let result = testResult {
                        HStack(spacing: 10) {
                            switch result {
                            case .success(let latency, let modelCount):
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(AppColors.appSuccess)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Connection successful")
                                        .font(.subheadline.weight(.medium))
                                        .foregroundStyle(AppColors.appSuccess)
                                    Text("\(modelCount) model(s) · \(String(format: "%.0fms", latency * 1000)) latency")
                                        .font(.caption)
                                        .foregroundStyle(AppColors.textSecondary)
                                }
                            case .failure(let msg):
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundStyle(AppColors.appRed)
                                Text(msg)
                                    .font(.subheadline)
                                    .foregroundStyle(AppColors.appRed)
                            }
                            Spacer()
                        }
                        .padding(14)
                        .background(AppColors.cardBg)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }

                    // Delete button
                    Button(role: .destructive) {
                        showDeleteConfirmation = true
                    } label: {
                        HStack {
                            Image(systemName: "trash")
                            Text("Delete Server")
                        }
                        .font(.callout.weight(.medium))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .foregroundStyle(AppColors.appRed)
                    }
                    .padding(.top, 8)
                }
                .padding(16)
            }
        }
        .navigationTitle(server.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            Button("Edit") {
                showEditSheet = true
            }
            .foregroundStyle(AppColors.appPrimary)
        }
        .sheet(isPresented: $showEditSheet) {
            ServerFormView(mode: .edit(server))
        }
        .alert("Delete Server", isPresented: $showDeleteConfirmation) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                viewModel.delete(server, context: modelContext)
                dismiss()
            }
        } message: {
            Text("Are you sure you want to delete \"\(server.name)\"? This will also delete all conversations and benchmark results associated with this server.")
        }
        .task {
            await viewModel.checkHealth(for: server)
        }
    }

    /// Heuristic: HTTPS with a domain name (not an IP) is likely a hosted MaaS endpoint.
    private var isMaaSEndpoint: Bool {
        let url = server.baseURL.lowercased()
        guard url.hasPrefix("https://") else { return false }
        // Strip scheme
        let host = url.dropFirst("https://".count).prefix(while: { $0 != ":" && $0 != "/" })
        // If host contains only digits and dots, it's an IP — not MaaS
        let isIP = host.allSatisfy { $0.isNumber || $0 == "." }
        return !isIP
    }

    // MARK: - Actions

    private func testConnection() {
        isTesting = true
        testResult = nil

        Task {
            let client = VLLMAPIClient.shared
            let apiKey = KeychainService.load(for: server.id)
            let start = Date()

            do {
                let healthy = try await client.checkHealth(baseURL: server.baseURL, apiKey: apiKey)
                let latency = Date().timeIntervalSince(start)

                if healthy {
                    let models = try await client.listModels(baseURL: server.baseURL, apiKey: apiKey)
                    server.isHealthy = true
                    server.lastConnected = Date()
                    server.availableModels = models.sorted()
                    testResult = .success(latency: latency, modelCount: models.count)
                } else {
                    server.isHealthy = false
                    testResult = .failure("Server returned unhealthy status")
                }
            } catch {
                server.isHealthy = false
                testResult = .failure(error.localizedDescription)
            }

            isTesting = false
        }
    }

    // MARK: - Components

    private func infoCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .padding(16)
            .background(AppColors.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func infoRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(AppColors.textSecondary)
            Spacer()
            Text(value)
                .font(.subheadline)
                .foregroundStyle(AppColors.textPrimary)
                .lineLimit(1)
        }
        .padding(.vertical, 10)
    }
}

#Preview {
    NavigationStack {
        ServerStatusView(server: ServerProfile(
            name: "Test Server",
            baseURL: "http://localhost:8000",
            availableModels: ["Qwen/Qwen2.5-7B-Instruct"]
        ))
    }
}
