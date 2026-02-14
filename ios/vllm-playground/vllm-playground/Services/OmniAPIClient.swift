import Foundation

// MARK: - Omni API Types

struct ImageGenerationRequest: Encodable {
    let model: String
    let prompt: String
    let n: Int
    let size: String
    let response_format: String  // "b64_json" or "url"
    var negative_prompt: String?
    var num_inference_steps: Int?
    var guidance_scale: Double?
    var seed: Int?

    enum CodingKeys: String, CodingKey {
        case model, prompt, n, size, response_format
        case negative_prompt, num_inference_steps, guidance_scale, seed
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(model, forKey: .model)
        try container.encode(prompt, forKey: .prompt)
        try container.encode(n, forKey: .n)
        try container.encode(size, forKey: .size)
        try container.encode(response_format, forKey: .response_format)
        try container.encodeIfPresent(negative_prompt, forKey: .negative_prompt)
        try container.encodeIfPresent(num_inference_steps, forKey: .num_inference_steps)
        try container.encodeIfPresent(guidance_scale, forKey: .guidance_scale)
        try container.encodeIfPresent(seed, forKey: .seed)
    }
}

struct ImageGenerationResponse: Decodable {
    let data: [ImageData]

    struct ImageData: Decodable {
        let b64_json: String?
        let url: String?
        let revised_prompt: String?
    }
}

struct TTSRequest: Encodable {
    let model: String
    let input: String
    let voice: String
    let response_format: String  // "mp3", "wav", etc.
    var speed: Double?
    var instructions: String?

    enum CodingKeys: String, CodingKey {
        case model, input, voice, response_format, speed, instructions
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(model, forKey: .model)
        try container.encode(input, forKey: .input)
        try container.encode(voice, forKey: .voice)
        try container.encode(response_format, forKey: .response_format)
        try container.encodeIfPresent(speed, forKey: .speed)
        try container.encodeIfPresent(instructions, forKey: .instructions)
    }
}

struct AudioGenerationRequest: Encodable {
    let model: String
    let prompt: String
    let response_format: String
    var negative_prompt: String?
    var audio_duration: Double?
    var num_inference_steps: Int?
    var guidance_scale: Double?
    var seed: Int?

    enum CodingKeys: String, CodingKey {
        case model, prompt, response_format
        case negative_prompt, audio_duration, num_inference_steps, guidance_scale, seed
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(model, forKey: .model)
        try container.encode(prompt, forKey: .prompt)
        try container.encode(response_format, forKey: .response_format)
        try container.encodeIfPresent(negative_prompt, forKey: .negative_prompt)
        try container.encodeIfPresent(audio_duration, forKey: .audio_duration)
        try container.encodeIfPresent(num_inference_steps, forKey: .num_inference_steps)
        try container.encodeIfPresent(guidance_scale, forKey: .guidance_scale)
        try container.encodeIfPresent(seed, forKey: .seed)
    }
}

// MARK: - Chat Completions Types (for image-to-image and video generation)

/// Generic chat completions request used for image-to-image and video generation via /v1/chat/completions
struct ChatCompletionsGenerationRequest: Encodable {
    let model: String
    let messages: [[String: AnyCodable]]
    var temperature: Double? = 0.7
    var max_tokens: Int? = 1024
    var extra_body: [String: AnyCodable]?

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(model, forKey: .model)
        try container.encode(messages, forKey: .messages)
        try container.encodeIfPresent(temperature, forKey: .temperature)
        try container.encodeIfPresent(max_tokens, forKey: .max_tokens)
        try container.encodeIfPresent(extra_body, forKey: .extra_body)
    }

    enum CodingKeys: String, CodingKey {
        case model, messages, temperature, max_tokens, extra_body
    }
}

/// A type-erased Codable wrapper for building dynamic JSON payloads
struct AnyCodable: Encodable {
    let value: Any

    init(_ value: Any) { self.value = value }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let v = value as? String { try container.encode(v) }
        else if let v = value as? Int { try container.encode(v) }
        else if let v = value as? Double { try container.encode(v) }
        else if let v = value as? Bool { try container.encode(v) }
        else if let v = value as? [String: AnyCodable] { try container.encode(v) }
        else if let v = value as? [AnyCodable] { try container.encode(v) }
        else if let v = value as? [[String: AnyCodable]] { try container.encode(v) }
        else { try container.encodeNil() }
    }
}

/// Response from /v1/chat/completions for generation endpoints
struct ChatCompletionsGenerationResponse: Decodable {
    let choices: [Choice]

    struct Choice: Decodable {
        let message: Message
    }
    struct Message: Decodable {
        let content: ContentValue
    }
    /// Content can be a string or an array of content items
    enum ContentValue: Decodable {
        case string(String)
        case array([ContentItem])

        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if let arr = try? container.decode([ContentItem].self) {
                self = .array(arr)
            } else if let str = try? container.decode(String.self) {
                self = .string(str)
            } else {
                self = .string("")
            }
        }
    }
    struct ContentItem: Decodable {
        let type: String?
        let image_url: MediaURL?
        let video_url: MediaURL?
    }
    struct MediaURL: Decodable {
        let url: String?
    }
}

// MARK: - Omni API Client

final class OmniAPIClient: @unchecked Sendable {
    static let shared = OmniAPIClient()

    private let session: URLSession
    private let videoSession: URLSession  // longer timeout for video
    private let decoder = JSONDecoder()
    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = .sortedKeys
        return e
    }()

    init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 180  // Generation can be slow
        config.timeoutIntervalForResource = 300
        self.session = URLSession(configuration: config)

        let videoConfig = URLSessionConfiguration.default
        videoConfig.timeoutIntervalForRequest = 600  // Video generation is very slow
        videoConfig.timeoutIntervalForResource = 660
        self.videoSession = URLSession(configuration: videoConfig)
    }

    // MARK: - Image Generation

    func generateImage(
        baseURL: String,
        apiKey: String?,
        model: String,
        prompt: String,
        negativePrompt: String? = nil,
        size: String = "1024x1024",
        count: Int = 1,
        inferenceSteps: Int? = nil,
        guidanceScale: Double? = nil,
        seed: Int? = nil
    ) async throws -> [Data] {
        guard let url = URL(string: "\(normalizeURL(baseURL))/v1/images/generations") else {
            throw VLLMAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyAuth(&request, apiKey: apiKey)

        var body = ImageGenerationRequest(
            model: model,
            prompt: prompt,
            n: count,
            size: size,
            response_format: "b64_json"
        )
        if let neg = negativePrompt, !neg.isEmpty {
            body.negative_prompt = neg
        }
        body.num_inference_steps = inferenceSteps
        body.guidance_scale = guidanceScale
        body.seed = seed
        request.httpBody = try encoder.encode(body)

        let (data, response) = try await session.data(for: request)
        try validateResponse(response, data: data)

        let imageResponse = try decoder.decode(ImageGenerationResponse.self, from: data)
        return imageResponse.data.compactMap { imageData in
            if let b64 = imageData.b64_json {
                return Data(base64Encoded: b64)
            }
            return nil
        }
    }

    // MARK: - Text-to-Speech

    func generateSpeech(
        baseURL: String,
        apiKey: String?,
        model: String,
        text: String,
        voice: String = "Vivian",
        format: String = "wav",
        speed: Double? = nil,
        instructions: String? = nil
    ) async throws -> Data {
        guard let url = URL(string: "\(normalizeURL(baseURL))/v1/audio/speech") else {
            throw VLLMAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyAuth(&request, apiKey: apiKey)

        var body = TTSRequest(
            model: model,
            input: text,
            voice: voice,
            response_format: format
        )
        body.speed = speed
        body.instructions = instructions
        request.httpBody = try encoder.encode(body)

        let (data, response) = try await session.data(for: request)
        try validateResponse(response, data: data)

        return data
    }

    // MARK: - Audio Generation

    func generateAudio(
        baseURL: String,
        apiKey: String?,
        model: String,
        prompt: String,
        negativePrompt: String? = nil,
        format: String = "wav",
        duration: Double? = nil,
        inferenceSteps: Int? = nil,
        guidanceScale: Double? = nil,
        seed: Int? = nil
    ) async throws -> Data {
        guard let url = URL(string: "\(normalizeURL(baseURL))/v1/audio/generations") else {
            throw VLLMAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyAuth(&request, apiKey: apiKey)

        var body = AudioGenerationRequest(
            model: model,
            prompt: prompt,
            response_format: format
        )
        if let neg = negativePrompt, !neg.isEmpty {
            body.negative_prompt = neg
        }
        body.audio_duration = duration
        body.num_inference_steps = inferenceSteps
        body.guidance_scale = guidanceScale
        body.seed = seed
        request.httpBody = try encoder.encode(body)

        let (data, response) = try await session.data(for: request)
        try validateResponse(response, data: data)

        return data
    }

    // MARK: - Image-to-Image Generation

    func generateImageFromImage(
        baseURL: String,
        apiKey: String?,
        model: String,
        prompt: String,
        inputImageData: Data,
        negativePrompt: String? = nil,
        size: String = "1024x1024",
        inferenceSteps: Int? = nil,
        guidanceScale: Double? = nil,
        seed: Int? = nil
    ) async throws -> [Data] {
        guard let url = URL(string: "\(normalizeURL(baseURL))/v1/chat/completions") else {
            throw VLLMAPIError.invalidURL
        }

        // Convert image data to base64 data URL
        let base64String = inputImageData.base64EncodedString()
        let imageDataURL = "data:image/jpeg;base64,\(base64String)"

        // Parse size
        let parts = size.split(separator: "x")
        let width = Int(parts.first ?? "1024") ?? 1024
        let height = Int(parts.last ?? "1024") ?? 1024

        // Build multimodal message content
        let messageContent: [AnyCodable] = [
            AnyCodable(["type": AnyCodable("image_url"), "image_url": AnyCodable(["url": AnyCodable(imageDataURL)])]),
            AnyCodable(["type": AnyCodable("text"), "text": AnyCodable(prompt)])
        ]

        let message: [String: AnyCodable] = [
            "role": AnyCodable("user"),
            "content": AnyCodable(messageContent)
        ]

        var extraBody: [String: AnyCodable] = [
            "height": AnyCodable(height),
            "width": AnyCodable(width)
        ]
        if let steps = inferenceSteps { extraBody["num_inference_steps"] = AnyCodable(steps) }
        if let scale = guidanceScale { extraBody["guidance_scale"] = AnyCodable(scale) }
        if let s = seed { extraBody["seed"] = AnyCodable(s) }
        if let neg = negativePrompt, !neg.isEmpty { extraBody["negative_prompt"] = AnyCodable(neg) }

        let body = ChatCompletionsGenerationRequest(
            model: model,
            messages: [message],
            extra_body: extraBody
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyAuth(&request, apiKey: apiKey)
        request.httpBody = try encoder.encode(body)

        let (data, response) = try await session.data(for: request)
        try validateResponse(response, data: data)

        let genResponse = try decoder.decode(ChatCompletionsGenerationResponse.self, from: data)
        return extractImagesFromResponse(genResponse)
    }

    // MARK: - Video Generation

    func generateVideo(
        baseURL: String,
        apiKey: String?,
        model: String,
        prompt: String,
        negativePrompt: String? = nil,
        height: Int = 480,
        width: Int = 640,
        duration: Int = 4,
        fps: Int = 16,
        inferenceSteps: Int? = nil,
        guidanceScale: Double? = nil,
        seed: Int? = nil
    ) async throws -> Data {
        guard let url = URL(string: "\(normalizeURL(baseURL))/v1/chat/completions") else {
            throw VLLMAPIError.invalidURL
        }

        let numFrames = duration * fps

        let message: [String: AnyCodable] = [
            "role": AnyCodable("user"),
            "content": AnyCodable(prompt)
        ]

        var extraBody: [String: AnyCodable] = [
            "modality": AnyCodable("video"),
            "num_frames": AnyCodable(numFrames),
            "height": AnyCodable(height),
            "width": AnyCodable(width),
            "fps": AnyCodable(fps)
        ]
        if let steps = inferenceSteps { extraBody["num_inference_steps"] = AnyCodable(steps) }
        if let scale = guidanceScale { extraBody["guidance_scale"] = AnyCodable(scale) }
        if let s = seed { extraBody["seed"] = AnyCodable(s) }
        if let neg = negativePrompt, !neg.isEmpty { extraBody["negative_prompt"] = AnyCodable(neg) }

        let body = ChatCompletionsGenerationRequest(
            model: model,
            messages: [message],
            extra_body: extraBody
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyAuth(&request, apiKey: apiKey)
        request.httpBody = try encoder.encode(body)

        let (data, response) = try await videoSession.data(for: request)
        try validateResponse(response, data: data)

        let genResponse = try decoder.decode(ChatCompletionsGenerationResponse.self, from: data)
        return try extractVideoFromResponse(genResponse)
    }

    // MARK: - Response Extractors

    private func extractImagesFromResponse(_ response: ChatCompletionsGenerationResponse) -> [Data] {
        guard let choice = response.choices.first else { return [] }
        switch choice.message.content {
        case .array(let items):
            return items.compactMap { item -> Data? in
                guard let urlStr = item.image_url?.url else { return nil }
                let base64 = urlStr.contains(",") ? String(urlStr.split(separator: ",", maxSplits: 1).last ?? "") : urlStr
                return Data(base64Encoded: base64)
            }
        case .string(let str):
            return Data(base64Encoded: str).map { [$0] } ?? []
        }
    }

    private func extractVideoFromResponse(_ response: ChatCompletionsGenerationResponse) throws -> Data {
        guard let choice = response.choices.first else {
            throw VLLMAPIError.httpError(statusCode: 0, body: "No choices in video response")
        }
        switch choice.message.content {
        case .array(let items):
            for item in items {
                if let urlStr = item.video_url?.url {
                    let base64 = urlStr.contains(",") ? String(urlStr.split(separator: ",", maxSplits: 1).last ?? "") : urlStr
                    if let data = Data(base64Encoded: base64) { return data }
                }
            }
            throw VLLMAPIError.httpError(statusCode: 0, body: "No video data in response")
        case .string(let str):
            if let data = Data(base64Encoded: str) { return data }
            throw VLLMAPIError.httpError(statusCode: 0, body: "Could not decode video data")
        }
    }

    // MARK: - Helpers

    private func normalizeURL(_ baseURL: String) -> String {
        var url = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if url.hasSuffix("/") {
            url = String(url.dropLast())
        }
        return url
    }

    private func applyAuth(_ request: inout URLRequest, apiKey: String?) {
        if let apiKey, !apiKey.isEmpty {
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        }
    }

    private func validateResponse(_ response: URLResponse, data: Data) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw VLLMAPIError.serverUnreachable
        }
        guard 200..<300 ~= httpResponse.statusCode else {
            let body = String(data: data, encoding: .utf8) ?? "No response body"
            throw VLLMAPIError.httpError(statusCode: httpResponse.statusCode, body: body)
        }
    }
}
