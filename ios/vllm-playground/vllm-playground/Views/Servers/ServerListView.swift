import SwiftUI
import SwiftData

struct ServerListView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.showSidebar) private var showSidebar
    @Query(sort: \ServerProfile.createdAt, order: .reverse) private var servers: [ServerProfile]
    @State private var showAddServer = false
    @State private var viewModel = ServerProfileViewModel()
    @State private var showResetDemoConfirmation = false

    /// Real (non-demo) servers.
    private var realServers: [ServerProfile] {
        servers.filter { !$0.isDemo }
    }

    /// The demo server, if present.
    private var demoServer: ServerProfile? {
        servers.first(where: \.isDemo)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                AppColors.pageBg.ignoresSafeArea()

                List {
                    // Demo server card (always first, if present)
                    if let demo = demoServer {
                        Section {
                            DemoServerCard(server: demo, showResetConfirmation: $showResetDemoConfirmation)
                                .listRowBackground(Color.clear)
                                .listRowSeparator(.hidden)
                                .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                        }
                    }

                    // Real servers
                    if realServers.isEmpty {
                        Section {
                            emptyState
                                .listRowBackground(Color.clear)
                                .listRowSeparator(.hidden)
                                .frame(maxWidth: .infinity)
                        }
                    } else {
                        Section {
                            ForEach(realServers) { server in
                                NavigationLink(destination: ServerStatusView(server: server)) {
                                    ServerCard(server: server)
                                }
                                .buttonStyle(.plain)
                                .listRowBackground(Color.clear)
                                .listRowSeparator(.hidden)
                                .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                            }
                            .onDelete { indexSet in
                                for index in indexSet {
                                    let server = realServers[index]
                                    guard !server.isDemo else { continue }
                                    viewModel.delete(server, context: modelContext)
                                }
                            }
                        }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
            .navigationTitle("Servers")
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
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showAddServer = true
                    } label: {
                        Image(systemName: "plus")
                            .font(.body.weight(.medium))
                            .foregroundStyle(AppColors.textSecondary)
                    }
                }
            }
            .toolbarBackground(AppColors.pageBg, for: .navigationBar)
            .sheet(isPresented: $showAddServer) {
                ServerFormView(mode: .add)
            }
            .confirmationDialog(
                "Reset Demo",
                isPresented: $showResetDemoConfirmation,
                titleVisibility: .visible
            ) {
                Button("Reset", role: .destructive) {
                    resetDemoData()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This will delete all demo conversations and benchmark results. The demo server itself will remain.")
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "server.rack")
                .font(.largeTitle)
                .foregroundStyle(AppColors.textTertiary)

            Text("No Servers")
                .font(.title3.weight(.semibold))
                .foregroundStyle(AppColors.textPrimary)

            Text("Run `vllm serve <model>` on your machine, then add the server here.")
                .font(.callout)
                .foregroundStyle(AppColors.textSecondary)
                .multilineTextAlignment(.center)

            Button {
                showAddServer = true
            } label: {
                HStack {
                    Image(systemName: "plus")
                    Text("Add Server")
                }
                .font(.callout.weight(.medium))
                .foregroundStyle(.white)
                .padding(.horizontal, 20)
                .padding(.vertical, 10)
                .background(AppColors.appPrimary)
                .clipShape(Capsule())
            }
        }
        .padding(.vertical, 24)
    }

    /// Delete all conversations and benchmark results linked to the demo server.
    private func resetDemoData() {
        guard let demo = demoServer else { return }
        for convo in demo.conversations {
            modelContext.delete(convo)
        }
        for result in demo.benchmarkResults {
            modelContext.delete(result)
        }
        // Also clear demo-generated Omni content
        let imageDescriptor = FetchDescriptor<GeneratedImage>(predicate: #Predicate { $0.isDemo == true })
        if let demoImages = try? modelContext.fetch(imageDescriptor) {
            for img in demoImages { modelContext.delete(img) }
        }
        let ttsDescriptor = FetchDescriptor<GeneratedTTS>(predicate: #Predicate { $0.demoText != nil })
        if let demoTTS = try? modelContext.fetch(ttsDescriptor) {
            for tts in demoTTS { modelContext.delete(tts) }
        }
        let audioDescriptor = FetchDescriptor<GeneratedAudio>(predicate: #Predicate { $0.demoText != nil })
        if let demoAudio = try? modelContext.fetch(audioDescriptor) {
            for audio in demoAudio { modelContext.delete(audio) }
        }
        let videoDescriptor = FetchDescriptor<GeneratedVideo>(predicate: #Predicate { $0.isDemo == true })
        if let demoVideos = try? modelContext.fetch(videoDescriptor) {
            for video in demoVideos { modelContext.delete(video) }
        }
        try? modelContext.save()
    }
}

// MARK: - Demo Server Card

private struct DemoServerCard: View {
    let server: ServerProfile
    @Binding var showResetConfirmation: Bool

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(AppColors.appSuccess.opacity(0.15))
                    .frame(width: 44, height: 44)

                Image(systemName: "sparkle")
                    .font(.body)
                    .foregroundStyle(AppColors.appSuccess)
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(server.name)
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(AppColors.textPrimary)

                    Text("DEMO")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(AppColors.appWarning)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(AppColors.appWarning.opacity(0.15))
                        .clipShape(Capsule())
                }

                Text("Built-in demo with simulated responses")
                    .font(.footnote)
                    .foregroundStyle(AppColors.textSecondary)
                    .lineLimit(1)
            }

            Spacer()

            Menu {
                Button(role: .destructive) {
                    showResetConfirmation = true
                } label: {
                    Label("Reset Demo Data", systemImage: "arrow.counterclockwise")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.body)
                    .foregroundStyle(AppColors.textTertiary)
            }
        }
        .padding(14)
        .background(AppColors.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

// MARK: - Server Card

struct ServerCard: View {
    let server: ServerProfile

    var body: some View {
        HStack(spacing: 14) {
            // Status indicator
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(server.isHealthy ? AppColors.appSuccess.opacity(0.15) : AppColors.appRed.opacity(0.15))
                    .frame(width: 44, height: 44)

                Image(systemName: server.serverType.icon)
                    .font(.body)
                    .foregroundStyle(server.isHealthy ? AppColors.appSuccess : AppColors.appRed)
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(server.name)
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(AppColors.textPrimary)

                    if server.isDefault {
                        Text("Default")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(AppColors.appPrimary)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(AppColors.appPrimary.opacity(0.15))
                            .clipShape(Capsule())
                    }
                }

                Text(server.baseURL)
                    .font(.footnote)
                    .foregroundStyle(AppColors.textSecondary)
                    .lineLimit(1)

                if !server.availableModels.isEmpty {
                    Text("\(server.availableModels.count) model(s)")
                        .font(.caption)
                        .foregroundStyle(AppColors.textTertiary)
                }
            }

            Spacer()

            // Health dot
            Circle()
                .fill(server.isHealthy ? AppColors.appSuccess : AppColors.appRed)
                .frame(width: 8, height: 8)
        }
        .padding(14)
        .background(AppColors.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

#Preview {
    ServerListView()
        .modelContainer(for: ServerProfile.self, inMemory: true)
}
