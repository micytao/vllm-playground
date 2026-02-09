import SwiftUI
import SwiftData

struct ServerListView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.showSidebar) private var showSidebar
    @Query(sort: \ServerProfile.createdAt, order: .reverse) private var servers: [ServerProfile]
    @State private var showAddServer = false
    @State private var viewModel = ServerProfileViewModel()

    var body: some View {
        NavigationStack {
            ZStack {
                AppColors.pageBg.ignoresSafeArea()

                if servers.isEmpty {
                    emptyState
                } else {
                    List {
                        ForEach(servers) { server in
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
                                viewModel.delete(servers[index], context: modelContext)
                            }
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                }
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

            Text("Add a remote vLLM server to get started.")
                .font(.callout)
                .foregroundStyle(AppColors.textSecondary)

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
