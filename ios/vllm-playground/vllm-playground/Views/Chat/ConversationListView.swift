import SwiftUI

struct ConversationListView: View {
    let conversations: [Conversation]
    @Binding var selectedConversation: Conversation?
    let onNewChat: () -> Void
    let onDelete: (Conversation) -> Void

    @State private var searchText = ""

    private var filteredConversations: [Conversation] {
        if searchText.isEmpty { return conversations }
        return conversations.filter {
            $0.title.localizedCaseInsensitiveContains(searchText)
        }
    }

    private var groupedConversations: [(String, [Conversation])] {
        let calendar = Calendar.current
        var groups: [String: [Conversation]] = [:]

        for convo in filteredConversations {
            let key: String
            if calendar.isDateInToday(convo.updatedAt) {
                key = "Today"
            } else if calendar.isDateInYesterday(convo.updatedAt) {
                key = "Yesterday"
            } else if calendar.isDate(convo.updatedAt, equalTo: Date(), toGranularity: .weekOfYear) {
                key = "This Week"
            } else {
                key = "Older"
            }
            groups[key, default: []].append(convo)
        }

        let order = ["Today", "Yesterday", "This Week", "Older"]
        return order.compactMap { key in
            guard let items = groups[key], !items.isEmpty else { return nil }
            return (key, items)
        }
    }

    var body: some View {
        ZStack {
            AppColors.pageBg.ignoresSafeArea()

            if conversations.isEmpty {
                VStack(spacing: 12) {
                    Spacer()
                    Image(systemName: "bubble.left")
                        .font(.largeTitle)
                        .foregroundStyle(AppColors.textTertiary)
                    Text("No conversations yet")
                        .font(.callout)
                        .foregroundStyle(AppColors.textSecondary)
                    Spacer()
                }
            } else {
                List(selection: $selectedConversation) {
                    ForEach(groupedConversations, id: \.0) { section, convos in
                        Section {
                            ForEach(convos) { conversation in
                                ConversationRow(conversation: conversation)
                                    .tag(conversation)
                                    .listRowBackground(
                                        selectedConversation?.id == conversation.id
                                            ? AppColors.sidebarItem
                                            : Color.clear
                                    )
                                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                        Button(role: .destructive) {
                                            onDelete(conversation)
                                        } label: {
                                            Label("Delete", systemImage: "trash")
                                        }
                                    }
                            }
                        } header: {
                            Text(section)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(AppColors.textTertiary)
                        }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .searchable(text: $searchText, prompt: "Search")
            }
        }
        .navigationTitle("Chats")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(action: onNewChat) {
                    Image(systemName: "square.and.pencil")
                        .font(.body.weight(.medium))
                        .foregroundStyle(AppColors.textSecondary)
                }
            }
        }
    }
}

struct ConversationRow: View {
    let conversation: Conversation

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(conversation.title)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(AppColors.textPrimary)
                .lineLimit(1)

            HStack(spacing: 6) {
                if !conversation.model.isEmpty {
                    Text(shortModelName)
                        .font(.caption)
                        .foregroundStyle(AppColors.textTertiary)
                        .lineLimit(1)
                }
                Spacer()
                Text(conversation.updatedAt.relativeFormatted)
                    .font(.caption2)
                    .foregroundStyle(AppColors.textTertiary)
            }
        }
        .padding(.vertical, 2)
    }

    private var shortModelName: String {
        let parts = conversation.model.split(separator: "/")
        return String(parts.last ?? Substring(conversation.model))
    }
}
