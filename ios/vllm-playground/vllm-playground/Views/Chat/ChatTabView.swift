import SwiftUI
import SwiftData

struct ChatTabView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.showSidebar) private var showSidebar
    @Query(sort: \ServerProfile.name) private var servers: [ServerProfile]
    @Query(sort: \Conversation.updatedAt, order: .reverse) private var conversations: [Conversation]
    @Binding var selectedConversationID: UUID?

    /// Prefer real servers; fall back to demo only when no real servers exist.
    private var activeServer: ServerProfile? {
        let real = servers.filter { !$0.isDemo }
        return real.first(where: \.isDefault) ?? real.first ?? servers.first
    }

    /// Real (non-demo) servers.
    private var realServers: [ServerProfile] {
        servers.filter { !$0.isDemo }
    }

    /// The conversation matching the selected ID.
    private var selectedConversation: Conversation? {
        guard let id = selectedConversationID else { return nil }
        return conversations.first(where: { $0.id == id })
    }

    var body: some View {
        NavigationStack {
            Group {
                if let conversation = selectedConversation {
                    let profile = conversation.serverProfile ?? activeServer
                    ChatView(
                        conversation: conversation,
                        serverProfile: profile,
                        apiClient: profile?.isDemo == true ? DemoAPIClient() : VLLMAPIClient.shared
                    )
                    .id(conversation.id) // Force re-create view when conversation changes
                } else {
                    // Empty state / new chat welcome
                    welcomeView
                }
            }
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

                ToolbarItem(placement: .principal) {
                    if selectedConversation != nil, !serversWithModels.isEmpty {
                        // Filter picker to only show servers matching the current conversation type (demo vs real)
                        let isCurrentDemo = selectedConversation?.serverProfile?.isDemo ?? false
                        let pickerServers = servers.filter { $0.isDemo == isCurrentDemo }
                        ServerModelPicker(
                            selectedModel: Binding(
                                get: { selectedConversation?.model ?? activeServer?.defaultModel ?? "" },
                                set: { newModel in
                                    if let convo = selectedConversation {
                                        convo.model = newModel
                                        // Keep current server if it has the model
                                        if let current = convo.serverProfile,
                                           current.availableModels.contains(newModel) {
                                            return
                                        }
                                        // Only search within same type (demo or real)
                                        let isConvoDemo = convo.serverProfile?.isDemo == true
                                        let candidates = servers.filter { $0.isDemo == isConvoDemo }
                                        if let match = candidates.first(where: { $0.availableModels.contains(newModel) }) {
                                            convo.serverProfile = match
                                        }
                                    }
                                }
                            ),
                            servers: pickerServers
                        )
                    } else {
                        Text("vLLM Playground")
                            .font(.headline)
                    }
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        createNewConversation()
                    } label: {
                        Image(systemName: "square.and.pencil")
                            .font(.body.weight(.medium))
                            .foregroundStyle(AppColors.textSecondary)
                    }
                }
            }
            .toolbarBackground(AppColors.pageBg, for: .navigationBar)
        }
    }

    // MARK: - Computed

    private var serversWithModels: [ServerProfile] {
        servers.filter { !$0.availableModels.isEmpty }
    }

    // MARK: - Welcome View

    private var welcomeView: some View {
        VStack(spacing: 16) {
            Spacer()

            Image("VLLMLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 64, height: 64)

            Text("vLLM Playground")
                .font(.title2.weight(.semibold))
                .foregroundStyle(AppColors.textPrimary)

            if realServers.isEmpty {
                Text("Explore the app with demo mode, or add a server to get started.")
                    .font(.callout)
                    .foregroundStyle(AppColors.textSecondary)
                    .multilineTextAlignment(.center)

                Button {
                    createDemoConversation()
                } label: {
                    HStack {
                        Image(systemName: "sparkle")
                        Text("Try Demo")
                    }
                    .font(.callout.weight(.medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)
                    .background(AppColors.appWarning)
                    .clipShape(Capsule())
                }
                .padding(.top, 8)
            } else {
                Text("Start a new conversation to begin.")
                    .font(.callout)
                    .foregroundStyle(AppColors.textSecondary)
                    .multilineTextAlignment(.center)

                Button {
                    createNewConversation()
                } label: {
                    HStack {
                        Image(systemName: "plus")
                        Text("New Chat")
                    }
                    .font(.callout.weight(.medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)
                    .background(AppColors.appPrimary)
                    .clipShape(Capsule())
                }
                .padding(.top, 8)
            }

            Spacer()
        }
        .frame(maxWidth: .infinity)
        .background(AppColors.pageBg)
    }

    // MARK: - Actions

    private func createNewConversation() {
        guard let server = activeServer else { return }
        let model = server.defaultModel ?? server.availableModels.first ?? ""
        let conversation = Conversation(
            model: model,
            serverProfile: server
        )
        modelContext.insert(conversation)
        selectedConversationID = conversation.id
    }

    /// Create a conversation using the demo server.
    private func createDemoConversation() {
        guard let demo = servers.first(where: \.isDemo) else { return }
        let conversation = Conversation(
            model: demo.defaultModel ?? "Demo Model",
            serverProfile: demo
        )
        modelContext.insert(conversation)
        selectedConversationID = conversation.id
    }
}

#Preview {
    ChatTabView(selectedConversationID: .constant(nil))
        .modelContainer(for: [
            ServerProfile.self,
            Conversation.self,
            Message.self,
        ], inMemory: true)
}
