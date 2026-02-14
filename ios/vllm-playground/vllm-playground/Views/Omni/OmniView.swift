import SwiftUI
import SwiftData

enum OmniTab: String, CaseIterable {
    case imageGen = "Image"
    case video = "Video"
    case tts = "TTS"
    case audio = "Audio"
    case gallery = "Gallery"
}

struct OmniView: View {
    @Environment(\.showSidebar) private var showSidebar
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \ServerProfile.name) private var servers: [ServerProfile]
    @State private var selectedTab: OmniTab = .imageGen
    @Bindable var viewModel: OmniViewModel
    @State private var selectedServerID: UUID?

    /// Prefer Omni servers, then real servers, fall back to demo only when nothing else exists.
    private var preferredServer: ServerProfile? {
        // If the user has manually selected a server, use it
        if let id = selectedServerID,
           let server = servers.first(where: { $0.id == id }) {
            return server
        }
        // Auto: prefer an Omni-type server (non-demo)
        let realServers = servers.filter { !$0.isDemo }
        let omniServers = realServers.filter { $0.serverType == .vllmOmni }
        if let defaultOmni = omniServers.first(where: \.isDefault) {
            return defaultOmni
        }
        if let firstOmni = omniServers.first {
            return firstOmni
        }
        // Fall back to any real server, then demo
        return realServers.first(where: \.isDefault) ?? realServers.first ?? servers.first
    }

    var body: some View {
        NavigationStack {
            ZStack {
                AppColors.pageBg.ignoresSafeArea()

                VStack(spacing: 0) {
                    // Segmented picker
                    HStack(spacing: 4) {
                        ForEach(OmniTab.allCases, id: \.self) { tab in
                            Button {
                                withAnimation(.easeInOut(duration: 0.2)) {
                                    selectedTab = tab
                                }
                            } label: {
                                Text(tab.rawValue)
                                    .font(.subheadline.weight(.medium))
                                    .foregroundStyle(selectedTab == tab ? AppColors.textPrimary : AppColors.textSecondary)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 8)
                                    .background(selectedTab == tab ? AppColors.cardBg : Color.clear)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(4)
                    .background(AppColors.inputBg)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .padding(.horizontal, 16)
                    .padding(.top, 8)

                    // Demo mode banner — shown when using the demo server
                    if preferredServer?.isDemo == true {
                        HStack(spacing: 8) {
                            Image(systemName: "sparkle")
                                .font(.caption)
                                .foregroundStyle(AppColors.appWarning)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Demo mode — outputs are simulated")
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(AppColors.appWarning)
                                Text("Add a vLLM-Omni server for real generation")
                                    .font(.caption2)
                                    .foregroundStyle(AppColors.textTertiary)
                            }
                            Spacer()
                        }
                        .padding(12)
                        .background(AppColors.appWarning.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                    }
                    // No Omni server warning (only for real servers without Omni type)
                    else if servers.filter({ $0.serverType == .vllmOmni }).isEmpty
                                && servers.contains(where: { !$0.isDemo }) {
                        HStack(spacing: 8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(AppColors.appWarning)
                                .font(.subheadline)
                            Text("No vLLM-Omni server configured. Add one in Servers for best results.")
                                .font(.caption)
                                .foregroundStyle(AppColors.textSecondary)
                            Spacer()
                        }
                        .padding(12)
                        .background(AppColors.appWarning.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                    }

                    // Error
                    if let error = viewModel.error {
                        HStack(spacing: 8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(AppColors.appRed)
                                .font(.subheadline)
                            Text(error)
                                .font(.footnote)
                                .foregroundStyle(AppColors.appRed)
                            Spacer()
                            Button { viewModel.error = nil } label: {
                                Image(systemName: "xmark")
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(AppColors.textTertiary)
                            }
                        }
                        .padding(12)
                        .background(AppColors.appRed.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                    }

                    switch selectedTab {
                    case .imageGen:
                        ImageGenerationView(viewModel: viewModel)
                    case .video:
                        VideoGenerationView(viewModel: viewModel)
                    case .tts:
                        TTSView(viewModel: viewModel)
                    case .audio:
                        AudioGenerationView(viewModel: viewModel)
                    case .gallery:
                        OmniGalleryView(viewModel: viewModel)
                    }
                }
            }
            .navigationTitle("Omni Studio")
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
                    serverModelMenu
                }
            }
            .toolbarBackground(AppColors.pageBg, for: .navigationBar)
            .onAppear {
                viewModel.modelContext = modelContext
                syncServer()
            }
            .onChange(of: selectedServerID) {
                syncServer()
            }
            .onChange(of: servers.count) {
                syncServer()
            }
        }
    }

    // MARK: - Server / Model Picker

    @ViewBuilder
    private var serverModelMenu: some View {
        Menu {
            // Server selection
            Section("Server") {
                ForEach(servers) { server in
                    Button {
                        selectedServerID = server.id
                    } label: {
                        HStack {
                            Label(
                                server.isDemo ? "\(server.name) (Demo)" : server.name,
                                systemImage: server.isDemo ? "sparkle" : server.serverType.icon
                            )
                            if server.id == preferredServer?.id {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            }

            // Model selection
            if let server = preferredServer, !server.availableModels.isEmpty {
                Section("Model") {
                    ForEach(server.availableModels.sorted(), id: \.self) { model in
                        Button {
                            viewModel.selectedModel = model
                        } label: {
                            HStack {
                                Text(model)
                                if model == viewModel.selectedModel {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: preferredServer?.serverType.icon ?? "server.rack")
                    .font(.caption.weight(.medium))
                Text(modelDisplayName)
                    .font(.caption.weight(.medium))
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 8, weight: .bold))
            }
            .foregroundStyle(AppColors.textPrimary)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(AppColors.cardBg)
            .clipShape(Capsule())
        }
    }

    private var modelDisplayName: String {
        if viewModel.selectedModel.isEmpty {
            return preferredServer?.name ?? "No Server"
        }
        let parts = viewModel.selectedModel.split(separator: "/")
        return String(parts.last ?? Substring(viewModel.selectedModel))
    }

    // MARK: - Helpers

    private func syncServer() {
        viewModel.updateServer(preferredServer)
    }
}

#Preview {
    OmniView(viewModel: OmniViewModel())
        .modelContainer(for: [ServerProfile.self, GeneratedImage.self, GeneratedTTS.self, GeneratedAudio.self, GeneratedVideo.self], inMemory: true)
}
