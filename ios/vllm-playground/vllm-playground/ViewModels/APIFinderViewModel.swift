import Foundation

// MARK: - Tab Enum

enum APIFinderTab: String, CaseIterable {
    case online = "Online Inference"
    case offline = "Offline Inference"
}

// MARK: - Persisted Payload

/// What we save to disk after a successful load
private struct PersistedAPIData: Codable {
    let endpoints: [APIEndpoint]
    let classes: [PythonAPIClass]
    let loadedAt: Date
}

// MARK: - ViewModel

@Observable
@MainActor
final class APIFinderViewModel {
    var searchQuery = ""
    var selectedTab: APIFinderTab = .online

    // MARK: - Loading State

    var isLoading = false
    var loadError: String?
    var lastLoadedAt: Date?

    /// Whether we are showing updated (persisted) data
    var hasUpdatedData: Bool { lastLoadedAt != nil }

    /// The active endpoints (updated or built-in)
    private var updatedEndpoints: [APIEndpoint]?
    /// The active classes (updated or built-in)
    private var updatedClasses: [PythonAPIClass]?

    // MARK: - Init

    init() {
        restoreFromDisk()
    }

    // MARK: - Data Source

    private var activeEndpoints: [APIEndpoint] {
        updatedEndpoints ?? VLLMEndpoints.all
    }

    private var activeClasses: [PythonAPIClass] {
        updatedClasses ?? VLLMPythonAPI.all
    }

    // MARK: - Filtered Online Endpoints

    var filteredEndpoints: [APIEndpoint] {
        let all = activeEndpoints
        guard !searchQuery.isEmpty else { return all }
        let query = searchQuery.lowercased()
        return all.filter { endpoint in
            endpoint.path.lowercased().contains(query)
            || endpoint.name.lowercased().contains(query)
            || endpoint.description.lowercased().contains(query)
            || endpoint.category.rawValue.lowercased().contains(query)
            || endpoint.method.rawValue.lowercased().contains(query)
            || endpoint.parameters.contains { $0.name.lowercased().contains(query) }
        }
    }

    /// Endpoints grouped by category, preserving category order
    var groupedEndpoints: [(category: APIEndpoint.EndpointCategory, endpoints: [APIEndpoint])] {
        let filtered = filteredEndpoints
        return APIEndpoint.EndpointCategory.allCases.compactMap { category in
            let items = filtered.filter { $0.category == category }
            return items.isEmpty ? nil : (category, items)
        }
    }

    // MARK: - Filtered Offline Classes

    var filteredClasses: [PythonAPIClass] {
        let all = activeClasses
        guard !searchQuery.isEmpty else { return all }
        let query = searchQuery.lowercased()
        return all.filter { cls in
            cls.name.lowercased().contains(query)
            || cls.description.lowercased().contains(query)
            || cls.category.rawValue.lowercased().contains(query)
            || cls.properties.contains { $0.name.lowercased().contains(query) }
        }
    }

    /// Classes grouped by category, preserving category order
    var groupedClasses: [(category: PythonAPIClass.PythonAPICategory, classes: [PythonAPIClass])] {
        let filtered = filteredClasses
        return PythonAPIClass.PythonAPICategory.allCases.compactMap { category in
            let items = filtered.filter { $0.category == category }
            return items.isEmpty ? nil : (category, items)
        }
    }

    // MARK: - Counts

    var onlineCount: Int { filteredEndpoints.count }
    var offlineCount: Int { filteredClasses.count }

    // MARK: - Load Latest from vLLM Docs (GitHub)

    func loadLatest() async {
        isLoading = true
        loadError = nil

        do {
            // Fetch online inference docs
            let onlineMD = try await fetchMarkdown(
                from: "https://raw.githubusercontent.com/vllm-project/vllm/main/docs/serving/openai_compatible_server.md"
            )
            let parsedEndpoints = Self.parseEndpoints(from: onlineMD)

            // Fetch offline inference docs
            let offlineMD = try await fetchMarkdown(
                from: "https://raw.githubusercontent.com/vllm-project/vllm/main/docs/api/README.md"
            )
            let parsedClasses = Self.parseClasses(from: offlineMD)

            // Merge: static data provides rich details; live adds new discoveries
            let mergedEndpoints = Self.mergeEndpoints(static: VLLMEndpoints.all, live: parsedEndpoints)
            let mergedClasses = Self.mergeClasses(static: VLLMPythonAPI.all, live: parsedClasses)

            // Update in-memory
            updatedEndpoints = mergedEndpoints
            updatedClasses = mergedClasses
            lastLoadedAt = Date()

            // Persist to disk
            saveToDisk(endpoints: mergedEndpoints, classes: mergedClasses, date: lastLoadedAt!)
        } catch {
            loadError = error.localizedDescription
        }

        isLoading = false
    }

    // MARK: - Persistence

    private static var persistenceURL: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return docs.appendingPathComponent("api_reference_cache.json")
    }

    private func saveToDisk(endpoints: [APIEndpoint], classes: [PythonAPIClass], date: Date) {
        let payload = PersistedAPIData(endpoints: endpoints, classes: classes, loadedAt: date)
        do {
            let data = try JSONEncoder().encode(payload)
            try data.write(to: Self.persistenceURL, options: .atomic)
        } catch {
            print("[APIFinder] Failed to save: \(error)")
        }
    }

    private func restoreFromDisk() {
        let url = Self.persistenceURL
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        do {
            let data = try Data(contentsOf: url)
            let payload = try JSONDecoder().decode(PersistedAPIData.self, from: data)
            updatedEndpoints = payload.endpoints
            updatedClasses = payload.classes
            lastLoadedAt = payload.loadedAt
        } catch {
            print("[APIFinder] Failed to restore: \(error)")
            // Corrupted file -- remove it
            deletePersistedData()
        }
    }

    private func deletePersistedData() {
        try? FileManager.default.removeItem(at: Self.persistenceURL)
    }

    // MARK: - Network

    private func fetchMarkdown(from urlString: String) async throws -> String {
        guard let url = URL(string: urlString) else {
            throw URLError(.badURL)
        }
        let (data, response) = try await URLSession.shared.data(from: url)
        if let httpResp = response as? HTTPURLResponse, httpResp.statusCode != 200 {
            throw URLError(.badServerResponse)
        }
        return String(data: data, encoding: .utf8) ?? ""
    }

    // MARK: - Parsing: Online Endpoints

    static func parseEndpoints(from markdown: String) -> [LiveEndpointInfo] {
        var results: [LiveEndpointInfo] = []

        // Pattern 1: `[Name](#anchor) (`/path`)`
        let pattern1 = #"\[([^\]]+)\]\([^)]+\)\s*\(`([^`]+)`\)"#
        if let regex = try? NSRegularExpression(pattern: pattern1) {
            let nsString = markdown as NSString
            let matches = regex.matches(in: markdown, range: NSRange(location: 0, length: nsString.length))
            for match in matches {
                if match.numberOfRanges >= 3 {
                    let name = nsString.substring(with: match.range(at: 1))
                    let path = nsString.substring(with: match.range(at: 2))
                    results.append(LiveEndpointInfo(name: name, path: path))
                }
            }
        }

        // Pattern 2: standalone `/path` mentions
        let pattern2 = #"`(/[a-z][a-z0-9/_.-]*)`"#
        if let regex = try? NSRegularExpression(pattern: pattern2, options: .caseInsensitive) {
            let nsString = markdown as NSString
            let matches = regex.matches(in: markdown, range: NSRange(location: 0, length: nsString.length))
            for match in matches {
                if match.numberOfRanges >= 2 {
                    let path = nsString.substring(with: match.range(at: 1))
                    if path.contains("#") || path.contains(".") { continue }
                    if !results.contains(where: { $0.path == path }) {
                        results.append(LiveEndpointInfo(name: path, path: path))
                    }
                }
            }
        }

        return results
    }

    // MARK: - Parsing: Offline Classes

    static func parseClasses(from markdown: String) -> [LiveClassInfo] {
        var results: [LiveClassInfo] = []

        let pattern = #"\*\s*(?:\[)?vllm\.([a-zA-Z_.]+[A-Z][a-zA-Z]*)(?:\])?"#
        if let regex = try? NSRegularExpression(pattern: pattern) {
            let nsString = markdown as NSString
            let matches = regex.matches(in: markdown, range: NSRange(location: 0, length: nsString.length))
            for match in matches {
                if match.numberOfRanges >= 2 {
                    let fullPath = nsString.substring(with: match.range(at: 1))
                    let className = fullPath.components(separatedBy: ".").last ?? fullPath
                    if !results.contains(where: { $0.name == className }) {
                        results.append(LiveClassInfo(name: className, fullPath: "vllm.\(fullPath)"))
                    }
                }
            }
        }

        return results
    }

    // MARK: - Merging

    static func mergeEndpoints(static staticList: [APIEndpoint], live: [LiveEndpointInfo]) -> [APIEndpoint] {
        var merged = staticList
        let existingPaths = Set(staticList.map { $0.path })

        for liveItem in live {
            if !existingPaths.contains(liveItem.path) {
                let method: APIEndpoint.HTTPMethod = liveItem.path.contains("realtime") ? .websocket : .post
                let category = guessCategory(for: liveItem.path)
                merged.append(APIEndpoint(
                    method: method,
                    path: liveItem.path,
                    name: "\(liveItem.name) (New)",
                    category: category,
                    description: "Discovered from latest vLLM docs. See docs.vllm.ai for full details.",
                    parameters: [],
                    sampleCurl: "curl -X \(method == .get ? "GET" : "POST") http://localhost:8000\(liveItem.path)",
                    samplePython: "# See docs.vllm.ai for usage details\nimport requests\nresp = requests.\(method == .get ? "get" : "post")(\"http://localhost:8000\(liveItem.path)\")\nprint(resp.json())"
                ))
            }
        }

        return merged
    }

    static func mergeClasses(static staticList: [PythonAPIClass], live: [LiveClassInfo]) -> [PythonAPIClass] {
        var merged = staticList
        let existingNames = Set(staticList.map { $0.name })

        for liveItem in live {
            if !existingNames.contains(liveItem.name) {
                let category = guessClassCategory(for: liveItem.name, fullPath: liveItem.fullPath)
                merged.append(PythonAPIClass(
                    name: liveItem.name,
                    category: category,
                    description: "Discovered from latest vLLM docs (\(liveItem.fullPath)). See docs.vllm.ai for full details.",
                    properties: [],
                    samplePython: "from \(liveItem.fullPath.components(separatedBy: ".").dropLast().joined(separator: ".")) import \(liveItem.name)"
                ))
            }
        }

        return merged
    }

    // MARK: - Category Guessing

    private static func guessCategory(for path: String) -> APIEndpoint.EndpointCategory {
        if path.contains("audio") || path.contains("transcri") || path.contains("translat") || path.contains("realtime") {
            return .audio
        } else if path.contains("embed") || path.contains("pool") || path.contains("classify") || path.contains("score") || path.contains("rerank") {
            return .embeddingsPooling
        } else if path.contains("tokenize") || path.contains("detokenize") {
            return .tokenizer
        } else if path.contains("model") || path.contains("health") || path.contains("metric") {
            return .system
        }
        return .generative
    }

    private static func guessClassCategory(for name: String, fullPath: String) -> PythonAPIClass.PythonAPICategory {
        let lower = fullPath.lowercased()
        if lower.contains("config") {
            return .configuration
        } else if lower.contains("engine") {
            return .engines
        } else if lower.contains("multimodal") || lower.contains("multi_modal") {
            return .multiModal
        }
        return .core
    }
}

// MARK: - Live Data Structs

struct LiveEndpointInfo {
    let name: String
    let path: String
}

struct LiveClassInfo {
    let name: String
    let fullPath: String
}
