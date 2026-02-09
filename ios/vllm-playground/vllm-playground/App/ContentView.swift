import SwiftUI
import SwiftData

enum AppSection: String, CaseIterable {
    case home
    case chat
    case omni
    case benchmark
    case modelHub
    case servers
    case settings
}

struct ContentView: View {
    @AppStorage("appTheme") private var appTheme: AppTheme = .system
    @State private var selectedSection: AppSection = .home
    @State private var showSidebar = false
    @State private var selectedConversationID: UUID?
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var body: some View {
        Group {
            if horizontalSizeClass == .regular {
                // iPad: persistent sidebar
                NavigationSplitView {
                    SidebarView(
                        selectedSection: $selectedSection,
                        selectedConversationID: $selectedConversationID
                    )
                } detail: {
                    destinationView
                }
            } else {
                // iPhone: drawer-style sidebar
                ZStack {
                    destinationView

                    // Overlay
                    if showSidebar {
                        Color.black.opacity(0.4)
                            .ignoresSafeArea()
                            .onTapGesture { withAnimation(.easeOut(duration: 0.25)) { showSidebar = false } }
                            .transition(.opacity)
                    }

                    // Drawer
                    HStack(spacing: 0) {
                        if showSidebar {
                            SidebarView(
                                selectedSection: $selectedSection,
                                selectedConversationID: $selectedConversationID,
                                onSelect: {
                                    withAnimation(.easeOut(duration: 0.25)) { showSidebar = false }
                                }
                            )
                            .frame(width: 280)
                            .transition(.move(edge: .leading))
                        }
                        Spacer(minLength: 0)
                    }
                }
                .animation(.easeOut(duration: 0.25), value: showSidebar)
            }
        }
        .preferredColorScheme(appTheme.colorScheme)
        .environment(\.showSidebar, $showSidebar)
    }

    @ViewBuilder
    private var destinationView: some View {
        switch selectedSection {
        case .home:
            HomeView(onNavigate: { section in
                selectedSection = section
            })
        case .chat:
            ChatTabView(selectedConversationID: $selectedConversationID)
        case .omni:
            OmniView()
        case .benchmark:
            BenchmarkView()
        case .modelHub:
            ModelHubView()
        case .servers:
            ServerListView()
        case .settings:
            AppSettingsView()
        }
    }
}

// MARK: - Sidebar

struct SidebarView: View {
    @Environment(\.modelContext) private var modelContext
    @Binding var selectedSection: AppSection
    @Binding var selectedConversationID: UUID?
    @Query(sort: \Conversation.updatedAt, order: .reverse) private var conversations: [Conversation]
    var onSelect: (() -> Void)?

    @State private var isEditing = false
    @State private var selectedForDeletion: Set<UUID> = []
    @State private var showDeleteAllConfirmation = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header — tappable to go Home
            Button {
                selectedSection = .home
                onSelect?()
            } label: {
                HStack(spacing: 10) {
                    Image("VLLMLogo")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 28, height: 28)
                    Text("vLLM Playground")
                        .font(.headline)
                        .foregroundStyle(AppColors.textPrimary)
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .background(selectedSection == .home ? AppColors.sidebarItem.opacity(0.6) : Color.clear)
            }
            .buttonStyle(.plain)

            Divider().background(AppColors.border)

            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    // New Chat button
                    SidebarButton(
                        icon: "square.and.pencil",
                        title: "New Chat",
                        isSelected: false
                    ) {
                        selectedConversationID = nil
                        selectedSection = .chat
                        onSelect?()
                    }
                    .padding(.top, 8)

                    // Main navigation
                    SidebarButton(
                        icon: "sparkles",
                        title: "Omni Studio",
                        isSelected: selectedSection == .omni
                    ) {
                        selectedSection = .omni
                        onSelect?()
                    }

                    SidebarButton(
                        icon: "chart.bar",
                        title: "Benchmark",
                        isSelected: selectedSection == .benchmark
                    ) {
                        selectedSection = .benchmark
                        onSelect?()
                    }

                    SidebarButton(
                        icon: "magnifyingglass",
                        title: "Model Hub",
                        isSelected: selectedSection == .modelHub
                    ) {
                        selectedSection = .modelHub
                        onSelect?()
                    }

                    SidebarButton(
                        icon: "server.rack",
                        title: "Servers",
                        isSelected: selectedSection == .servers
                    ) {
                        selectedSection = .servers
                        onSelect?()
                    }

                    // Recent conversations
                    Divider()
                        .background(AppColors.border)
                        .padding(.vertical, 8)

                    // RECENT header with Edit button
                    HStack {
                        Text("RECENT")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(AppColors.textTertiary)

                        Spacer()

                        if !conversations.isEmpty {
                            Button {
                                withAnimation(.easeInOut(duration: 0.25)) {
                                    isEditing.toggle()
                                    if !isEditing {
                                        selectedForDeletion.removeAll()
                                    }
                                }
                            } label: {
                                Text(isEditing ? "Done" : "Edit")
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(AppColors.appPrimary)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 4)

                    if conversations.isEmpty {
                        // Empty state
                        VStack(spacing: 6) {
                            Text("No conversations yet")
                                .font(.footnote)
                                .foregroundStyle(AppColors.textTertiary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, 12)
                    }

                    ForEach(conversations.prefix(15)) { convo in
                            if isEditing {
                                editableConversationRow(convo)
                            } else {
                                SwipeToDeleteRow(
                                    onDelete: {
                                        deleteConversation(convo)
                                    }
                                ) {
                                    SidebarButton(
                                        icon: "bubble.left",
                                        title: convo.title,
                                        isSelected: selectedSection == .chat && selectedConversationID == convo.id
                                    ) {
                                        selectedConversationID = convo.id
                                        selectedSection = .chat
                                        onSelect?()
                                    }
                                }
                            }
                        }
                }
                .padding(.horizontal, 8)
            }

            // Edit mode bottom bar
            if isEditing && !conversations.isEmpty {
                editBottomBar
            }

            Spacer(minLength: 16)

            Divider().background(AppColors.border)

            // Bottom: Settings
            SidebarButton(
                icon: "gear",
                title: "Settings",
                isSelected: selectedSection == .settings
            ) {
                selectedSection = .settings
                onSelect?()
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 8)
        }
        .background(AppColors.sidebarBg)
        .confirmationDialog(
            "Delete All Conversations",
            isPresented: $showDeleteAllConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete All", role: .destructive) {
                deleteAllConversations()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will permanently delete all \(conversations.count) conversations. This action cannot be undone.")
        }
    }

    // MARK: - Editable Conversation Row

    private func editableConversationRow(_ convo: Conversation) -> some View {
        Button {
            withAnimation(.easeInOut(duration: 0.15)) {
                if selectedForDeletion.contains(convo.id) {
                    selectedForDeletion.remove(convo.id)
                } else {
                    selectedForDeletion.insert(convo.id)
                }
            }
        } label: {
            HStack(spacing: 10) {
                // Selection circle
                ZStack {
                    Circle()
                        .stroke(
                            selectedForDeletion.contains(convo.id) ? AppColors.appPrimary : AppColors.textTertiary,
                            lineWidth: 1.5
                        )
                        .frame(width: 22, height: 22)

                    if selectedForDeletion.contains(convo.id) {
                        Circle()
                            .fill(AppColors.appPrimary)
                            .frame(width: 22, height: 22)
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.white)
                    }
                }
                .animation(.easeInOut(duration: 0.15), value: selectedForDeletion.contains(convo.id))

                Image(systemName: "bubble.left")
                    .font(.subheadline)
                    .foregroundStyle(AppColors.textSecondary)
                    .frame(width: 20)

                Text(convo.title)
                    .font(.subheadline)
                    .foregroundStyle(AppColors.textSecondary)
                    .lineLimit(1)

                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .transition(.opacity)
    }

    // MARK: - Edit Bottom Bar

    private var editBottomBar: some View {
        HStack(spacing: 12) {
            // Delete All
            Button {
                showDeleteAllConfirmation = true
            } label: {
                Text("Delete All")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(AppColors.appRed)
            }
            .buttonStyle(.plain)

            Spacer()

            // Delete Selected
            Button {
                deleteSelectedConversations()
            } label: {
                Text(selectedForDeletion.isEmpty ? "Select Items" : "Delete (\(selectedForDeletion.count))")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(selectedForDeletion.isEmpty ? AppColors.textTertiary : .white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .background(selectedForDeletion.isEmpty ? AppColors.inputBg : AppColors.appRed)
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
            .disabled(selectedForDeletion.isEmpty)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(AppColors.cardBg)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    // MARK: - Deletion Helpers

    private func deleteConversation(_ conversation: Conversation) {
        if selectedConversationID == conversation.id {
            selectedConversationID = nil
        }
        modelContext.delete(conversation)
    }

    private func deleteSelectedConversations() {
        withAnimation(.easeOut(duration: 0.25)) {
            for convo in conversations where selectedForDeletion.contains(convo.id) {
                if selectedConversationID == convo.id {
                    selectedConversationID = nil
                }
                modelContext.delete(convo)
            }
            selectedForDeletion.removeAll()
            // Exit edit mode if no conversations remain
            if conversations.count <= selectedForDeletion.count {
                isEditing = false
            }
        }
    }

    private func deleteAllConversations() {
        withAnimation(.easeOut(duration: 0.25)) {
            selectedConversationID = nil
            for convo in conversations {
                modelContext.delete(convo)
            }
            selectedForDeletion.removeAll()
            isEditing = false
        }
    }
}

// MARK: - Swipe to Delete Row

struct SwipeToDeleteRow<Content: View>: View {
    let onDelete: () -> Void
    @ViewBuilder let content: () -> Content

    @State private var offset: CGFloat = 0
    @State private var showDelete = false

    private let deleteWidth: CGFloat = 70

    var body: some View {
        ZStack(alignment: .trailing) {
            // Delete button behind
            if showDelete || offset < 0 {
                HStack(spacing: 0) {
                    Spacer()
                    Button {
                        withAnimation(.easeOut(duration: 0.2)) {
                            offset = 0
                            showDelete = false
                        }
                        // Small delay so the animation plays before the item disappears
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                            withAnimation(.easeOut(duration: 0.25)) {
                                onDelete()
                            }
                        }
                    } label: {
                        Image(systemName: "trash.fill")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.white)
                            .frame(width: deleteWidth, height: .infinity)
                            .frame(maxHeight: .infinity)
                    }
                    .background(AppColors.appRed)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
            }

            // Main content
            content()
                .offset(x: offset)
                .gesture(
                    DragGesture(minimumDistance: 16)
                        .onChanged { value in
                            let translation = value.translation.width
                            // Only allow left swipe
                            if translation < 0 {
                                offset = max(translation, -deleteWidth - 10)
                            } else if showDelete {
                                // Allow swiping back to close
                                offset = min(0, -deleteWidth + translation)
                            }
                        }
                        .onEnded { value in
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                                if offset < -deleteWidth * 0.4 {
                                    offset = -deleteWidth
                                    showDelete = true
                                } else {
                                    offset = 0
                                    showDelete = false
                                }
                            }
                        }
                )
        }
        .clipped()
    }
}

// MARK: - Sidebar Button

struct SidebarButton: View {
    let icon: String
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.subheadline)
                    .foregroundStyle(isSelected ? AppColors.textPrimary : AppColors.textSecondary)
                    .frame(width: 20)

                Text(title)
                    .font(.subheadline)
                    .foregroundStyle(isSelected ? AppColors.textPrimary : AppColors.textSecondary)
                    .lineLimit(1)

                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(isSelected ? AppColors.sidebarItem : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Environment Key for Sidebar Toggle

private struct ShowSidebarKey: EnvironmentKey {
    static let defaultValue: Binding<Bool> = .constant(false)
}

extension EnvironmentValues {
    var showSidebar: Binding<Bool> {
        get { self[ShowSidebarKey.self] }
        set { self[ShowSidebarKey.self] = newValue }
    }
}

#Preview {
    ContentView()
        .modelContainer(for: [
            ServerProfile.self,
            Conversation.self,
            Message.self,
            BenchmarkResult.self
        ], inMemory: true)
}
