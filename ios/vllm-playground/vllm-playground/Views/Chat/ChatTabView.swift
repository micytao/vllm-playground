import SwiftUI
import SwiftData

struct ChatTabView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.showSidebar) private var showSidebar
    @Query(sort: \ServerProfile.name) private var servers: [ServerProfile]
    @Query(sort: \Conversation.updatedAt, order: .reverse) private var conversations: [Conversation]
    @Binding var selectedConversationID: UUID?

    private var activeServer: ServerProfile? {
        servers.first(where: \.isDefault) ?? servers.first
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
                    ChatView(
                        conversation: conversation,
                        serverProfile: conversation.serverProfile ?? activeServer
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
                    if !serversWithModels.isEmpty {
                        ServerModelPicker(
                            selectedModel: Binding(
                                get: { selectedConversation?.model ?? activeServer?.defaultModel ?? "" },
                                set: { newModel in
                                    if let convo = selectedConversation {
                                        convo.model = newModel
                                        // Switch server to the one that has this model
                                        if let matchingServer = servers.first(where: { $0.availableModels.contains(newModel) }) {
                                            convo.serverProfile = matchingServer
                                        }
                                    }
                                }
                            ),
                            servers: servers
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

            Text(servers.isEmpty
                ? "Add a server in Settings to get started."
                : "Start a new conversation to begin.")
                .font(.callout)
                .foregroundStyle(AppColors.textSecondary)
                .multilineTextAlignment(.center)

            if !servers.isEmpty {
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
        let conversation = Conversation(
            model: server.defaultModel ?? "",
            serverProfile: server
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
