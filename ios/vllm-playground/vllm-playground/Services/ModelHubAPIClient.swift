import Foundation

// MARK: - HuggingFace Model Info

struct HFModelInfo: Identifiable, Decodable {
    let id: String
    let author: String?
    let downloads: Int?
    let likes: Int?
    let pipeline_tag: String?
    let library_name: String?
    let tags: [String]?
    let gated: GatedValue?
    let createdAt: String?
    let modelId: String?

    /// Gated can be a string ("manual", "auto") or false/null
    enum GatedValue: Decodable {
        case string(String)
        case bool(Bool)
        case none

        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if let str = try? container.decode(String.self) {
                self = .string(str)
            } else if let b = try? container.decode(Bool.self) {
                self = .bool(b)
            } else {
                self = .none
            }
        }

        var isGated: Bool {
            switch self {
            case .string: return true
            case .bool(let b): return b
            case .none: return false
            }
        }
    }

    var isGated: Bool { gated?.isGated ?? false }

    var displayDownloads: String {
        guard let d = downloads else { return "—" }
        return formatCount(d)
    }

    var displayLikes: String {
        guard let l = likes else { return "—" }
        return formatCount(l)
    }

    var webURL: URL? {
        URL(string: "https://huggingface.co/\(id)")
    }

    private func formatCount(_ n: Int) -> String {
        if n >= 1_000_000 {
            return String(format: "%.1fM", Double(n) / 1_000_000)
        } else if n >= 1_000 {
            return String(format: "%.1fk", Double(n) / 1_000)
        } else {
            return "\(n)"
        }
    }
}

// MARK: - Filter Definitions

enum HFTask: String, CaseIterable, Identifiable {
    case textGeneration = "text-generation"
    case anyToAny = "any-to-any"
    case imageTextToText = "image-text-to-text"
    case imageToText = "image-to-text"
    case imageToImage = "image-to-image"
    case textToImage = "text-to-image"
    case textToVideo = "text-to-video"
    case textToSpeech = "text-to-speech"
    case textToAudio = "text-to-audio"
    case automaticSpeechRecognition = "automatic-speech-recognition"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .textGeneration: return "Text Generation"
        case .anyToAny: return "Any-to-Any"
        case .imageTextToText: return "Image-Text-to-Text"
        case .imageToText: return "Image-to-Text"
        case .imageToImage: return "Image-to-Image"
        case .textToImage: return "Text-to-Image"
        case .textToVideo: return "Text-to-Video"
        case .textToSpeech: return "Text-to-Speech"
        case .textToAudio: return "Text-to-Audio"
        case .automaticSpeechRecognition: return "Speech Recognition"
        }
    }

    var icon: String {
        switch self {
        case .textGeneration: return "text.bubble"
        case .anyToAny: return "arrow.triangle.2.circlepath"
        case .imageTextToText: return "photo.on.rectangle"
        case .imageToText: return "text.viewfinder"
        case .imageToImage: return "photo.stack"
        case .textToImage: return "photo"
        case .textToVideo: return "film"
        case .textToSpeech: return "speaker.wave.2"
        case .textToAudio: return "waveform"
        case .automaticSpeechRecognition: return "mic"
        }
    }
}

enum HFLibrary: String, CaseIterable, Identifiable {
    case transformers = "transformers"
    case pytorch = "pytorch"
    case diffusers = "diffusers"
    case gguf = "gguf"
    case safetensors = "safetensors"
    case onnx = "onnx"
    case mlx = "mlx"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .transformers: return "Transformers"
        case .pytorch: return "PyTorch"
        case .diffusers: return "Diffusers"
        case .gguf: return "GGUF"
        case .safetensors: return "Safetensors"
        case .onnx: return "ONNX"
        case .mlx: return "MLX"
        }
    }
}

enum HFApp: String, CaseIterable, Identifiable {
    case vllm = "vllm"
    case llamaCpp = "llama.cpp"
    case mlxLm = "mlx-lm"
    case lmStudio = "lm-studio"
    case ollama = "ollama"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .vllm: return "vLLM"
        case .llamaCpp: return "llama.cpp"
        case .mlxLm: return "MLX LM"
        case .lmStudio: return "LM Studio"
        case .ollama: return "Ollama"
        }
    }
}

enum HFSort: String, CaseIterable, Identifiable {
    case downloads = "downloads"
    case likes = "likes"
    case trending = "trending"
    case created = "created"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .downloads: return "Downloads"
        case .likes: return "Likes"
        case .trending: return "Trending"
        case .created: return "Recently Created"
        }
    }
}

// MARK: - Model Hub API Client

final class ModelHubAPIClient: @unchecked Sendable {
    static let shared = ModelHubAPIClient()

    private let session: URLSession
    private let decoder = JSONDecoder()

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 30
        self.session = URLSession(configuration: config)
    }

    func searchHuggingFace(
        query: String? = nil,
        task: HFTask? = nil,
        library: HFLibrary? = nil,
        app: HFApp? = nil,
        sort: HFSort = .downloads,
        limit: Int = 20,
        offset: Int = 0,
        token: String? = nil
    ) async throws -> [HFModelInfo] {
        var components = URLComponents(string: "https://huggingface.co/api/models")!
        var queryItems: [URLQueryItem] = [
            URLQueryItem(name: "sort", value: sort.rawValue),
            URLQueryItem(name: "direction", value: "-1"),
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "full", value: "true"),
        ]

        if offset > 0 {
            queryItems.append(URLQueryItem(name: "offset", value: "\(offset)"))
        }

        if let q = query, !q.trimmingCharacters(in: .whitespaces).isEmpty {
            queryItems.append(URLQueryItem(name: "search", value: q))
        }

        if let t = task {
            queryItems.append(URLQueryItem(name: "pipeline_tag", value: t.rawValue))
        }

        if let l = library {
            queryItems.append(URLQueryItem(name: "library", value: l.rawValue))
        }

        if let a = app {
            queryItems.append(URLQueryItem(name: "filter", value: a.rawValue))
        }

        components.queryItems = queryItems

        guard let url = components.url else {
            throw URLError(.badURL)
        }

        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if let token, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse, 200..<300 ~= httpResponse.statusCode else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            let body = String(data: data, encoding: .utf8) ?? ""
            throw URLError(.badServerResponse, userInfo: [
                NSLocalizedDescriptionKey: "HTTP \(statusCode): \(body)"
            ])
        }

        return try decoder.decode([HFModelInfo].self, from: data)
    }
}
