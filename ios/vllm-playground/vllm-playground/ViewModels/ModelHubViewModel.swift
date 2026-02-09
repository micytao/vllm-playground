import Foundation

@Observable
@MainActor
final class ModelHubViewModel {
    var searchQuery = ""
    var selectedTask: HFTask?
    var selectedLibrary: HFLibrary?
    var selectedApp: HFApp?
    var sortBy: HFSort = .downloads

    var models: [HFModelInfo] = []
    var isLoading = false
    var hasMore = true
    var error: String?

    var hfToken: String = ""
    var showTokenSheet = false

    private let client = ModelHubAPIClient.shared
    private let pageSize = 20
    private var currentOffset = 0
    private var searchTask: Task<Void, Never>?

    // Keychain key for HF token
    private static let hfTokenKey = UUID(uuidString: "00000000-0000-0000-0000-000000000001")!

    init() {
        hfToken = KeychainService.load(for: Self.hfTokenKey) ?? ""
    }

    func saveToken() {
        if hfToken.trimmingCharacters(in: .whitespaces).isEmpty {
            KeychainService.delete(for: Self.hfTokenKey)
        } else {
            try? KeychainService.save(apiKey: hfToken, for: Self.hfTokenKey)
        }
    }

    func searchModels() {
        searchTask?.cancel()
        searchTask = Task {
            // Debounce 500ms
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled else { return }

            currentOffset = 0
            hasMore = true
            isLoading = true
            error = nil

            do {
                let token = hfToken.isEmpty ? nil : hfToken
                let results = try await client.searchHuggingFace(
                    query: searchQuery.isEmpty ? nil : searchQuery,
                    task: selectedTask,
                    library: selectedLibrary,
                    app: selectedApp,
                    sort: sortBy,
                    limit: pageSize,
                    offset: 0,
                    token: token
                )
                guard !Task.isCancelled else { return }
                models = results
                currentOffset = results.count
                hasMore = results.count >= pageSize
                isLoading = false
            } catch {
                guard !Task.isCancelled else { return }
                self.error = error.localizedDescription
                isLoading = false
            }
        }
    }

    func loadMore() {
        guard hasMore, !isLoading else { return }
        isLoading = true

        Task {
            do {
                let token = hfToken.isEmpty ? nil : hfToken
                let results = try await client.searchHuggingFace(
                    query: searchQuery.isEmpty ? nil : searchQuery,
                    task: selectedTask,
                    library: selectedLibrary,
                    app: selectedApp,
                    sort: sortBy,
                    limit: pageSize,
                    offset: currentOffset,
                    token: token
                )
                models.append(contentsOf: results)
                currentOffset += results.count
                hasMore = results.count >= pageSize
                isLoading = false
            } catch {
                self.error = error.localizedDescription
                isLoading = false
            }
        }
    }

    func clearFilters() {
        selectedTask = nil
        selectedLibrary = nil
        selectedApp = nil
        searchModels()
    }

    var hasActiveFilters: Bool {
        selectedTask != nil || selectedLibrary != nil || selectedApp != nil
    }
}
