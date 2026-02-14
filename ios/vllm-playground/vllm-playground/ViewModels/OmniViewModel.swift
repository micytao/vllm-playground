import Foundation
import SwiftUI
import SwiftData
import AVFoundation

@Observable
@MainActor
final class OmniViewModel {
    // Image generation
    var imagePrompt = ""
    var imageNegativePrompt = ""
    var imageSize = "1024x1024"
    var imageInferenceSteps: Double = 6
    var imageGuidanceScale: Double = 1.0
    var imageSeed: String = ""
    var isGeneratingImage = false
    var imageInputData: Data?  // Source image for image-to-image

    // Video generation
    var videoPrompt = ""
    var videoNegativePrompt = ""
    var videoResolution = "480x640"  // HxW
    var videoDuration: Double = 4
    var videoFPS: Double = 16
    var videoInferenceSteps: Double = 30
    var videoGuidanceScale: Double = 4.0
    var videoSeed: String = ""
    var isGeneratingVideo = false

    // TTS
    var ttsText = ""
    var ttsVoice = "Vivian"
    var ttsFormat = "wav"
    var ttsSpeed: Double = 1.0
    var ttsInstructions: String = ""
    var isGeneratingTTS = false

    // Audio generation
    var audioPrompt = ""
    var audioNegativePrompt = ""
    var audioDuration: Double = 10.0
    var audioInferenceSteps: Double = 50
    var audioGuidanceScale: Double = 7.0
    var audioSeed: String = ""
    var isGeneratingAudio = false

    // Error
    var error: String?

    // Server & model
    private(set) var serverProfile: ServerProfile?
    var selectedModel: String = ""

    // Persistence
    var modelContext: ModelContext?

    private let omniClient = OmniAPIClient.shared
    private var demoSpeechSynthesizer: AVSpeechSynthesizer?

    let availableSizes = ["256x256", "512x512", "1024x1024", "1024x1792", "1792x1024"]
    let availableResolutions = ["320x512", "480x640", "480x848", "720x1280"]
    let availableVoices = ["Vivian", "Serena", "Ono_Anna", "Sohee", "Ryan", "Aiden", "Dylan", "Eric", "Uncle_Fu"]
    let availableFormats = ["mp3", "wav", "opus", "aac", "flac"]

    init(serverProfile: ServerProfile? = nil) {
        self.serverProfile = serverProfile
        self.selectedModel = serverProfile?.defaultModel ?? serverProfile?.availableModels.first ?? ""
    }

    func updateServer(_ profile: ServerProfile?) {
        self.serverProfile = profile
        // Reset model to the server's default or first available
        self.selectedModel = profile?.defaultModel ?? profile?.availableModels.first ?? ""
    }

    /// The model to use for API requests.
    private var effectiveModel: String {
        selectedModel.isEmpty ? (serverProfile?.availableModels.first ?? "default") : selectedModel
    }

    /// Whether the current server supports Omni features (TTS, audio, image, video).
    /// Returns true for vLLM-Omni servers, demo servers, or servers with an explicit omniBaseURL.
    private var serverSupportsOmni: Bool {
        guard let profile = serverProfile else { return false }
        if profile.isDemo { return true }
        if profile.serverType == .vllmOmni { return true }
        if !profile.omniBaseURL.isEmpty { return true }
        return false
    }

    private let omniRequiredError = "This feature requires a vLLM-Omni server. Your current server is a standard vLLM server. Please add a vLLM-Omni server or switch to the Demo server to try it out."

    // MARK: - Image Generation

    func generateImage() async {
        guard let profile = serverProfile else {
            error = "No server selected. Please add an Omni server in Settings."
            return
        }

        if profile.isDemo {
            await generateDemoImage()
            return
        }

        guard serverSupportsOmni else {
            error = omniRequiredError
            return
        }

        let baseURL = profile.effectiveOmniURL
        let apiKey = KeychainService.load(for: profile.id)

        guard !imagePrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            error = "Please enter a prompt"
            return
        }

        isGeneratingImage = true
        error = nil

        do {
            let negPrompt = imageNegativePrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : imageNegativePrompt
            let seedValue = Int(imageSeed)

            let images: [Data]
            if let inputData = imageInputData {
                // Image-to-image via /v1/chat/completions
                images = try await omniClient.generateImageFromImage(
                    baseURL: baseURL,
                    apiKey: apiKey,
                    model: effectiveModel,
                    prompt: imagePrompt,
                    inputImageData: inputData,
                    negativePrompt: negPrompt,
                    size: imageSize,
                    inferenceSteps: Int(imageInferenceSteps),
                    guidanceScale: imageGuidanceScale,
                    seed: seedValue
                )
            } else {
                // Text-to-image via /v1/images/generations
                images = try await omniClient.generateImage(
                    baseURL: baseURL,
                    apiKey: apiKey,
                    model: effectiveModel,
                    prompt: imagePrompt,
                    negativePrompt: negPrompt,
                    size: imageSize,
                    inferenceSteps: Int(imageInferenceSteps),
                    guidanceScale: imageGuidanceScale,
                    seed: seedValue
                )
            }
            for imgData in images {
                let item = GeneratedImage(prompt: imagePrompt, imageData: imgData)
                modelContext?.insert(item)
            }
            try? modelContext?.save()
            isGeneratingImage = false
        } catch {
            self.error = (error as? VLLMAPIError)?.userMessage ?? error.localizedDescription
            isGeneratingImage = false
        }
    }

    // MARK: - Video Generation

    func generateVideo() async {
        guard let profile = serverProfile else {
            error = "No server selected. Please add an Omni server in Settings."
            return
        }

        if profile.isDemo {
            error = "Video generation requires a real vLLM-Omni server."
            return
        }

        guard serverSupportsOmni else {
            error = omniRequiredError
            return
        }

        let baseURL = profile.effectiveOmniURL
        let apiKey = KeychainService.load(for: profile.id)

        guard !videoPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            error = "Please enter a prompt"
            return
        }

        isGeneratingVideo = true
        error = nil

        do {
            let negPrompt = videoNegativePrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : videoNegativePrompt
            let seedValue = Int(videoSeed)

            // Parse resolution (HxW format)
            let resParts = videoResolution.split(separator: "x")
            let height = Int(resParts.first ?? "480") ?? 480
            let width = Int(resParts.last ?? "640") ?? 640

            let videoData = try await omniClient.generateVideo(
                baseURL: baseURL,
                apiKey: apiKey,
                model: effectiveModel,
                prompt: videoPrompt,
                negativePrompt: negPrompt,
                height: height,
                width: width,
                duration: Int(videoDuration),
                fps: Int(videoFPS),
                inferenceSteps: Int(videoInferenceSteps),
                guidanceScale: videoGuidanceScale,
                seed: seedValue
            )
            let item = GeneratedVideo(prompt: videoPrompt, videoData: videoData, duration: Int(videoDuration))
            modelContext?.insert(item)
            try? modelContext?.save()
            isGeneratingVideo = false
        } catch {
            self.error = (error as? VLLMAPIError)?.userMessage ?? error.localizedDescription
            isGeneratingVideo = false
        }
    }

    // MARK: - TTS

    func generateSpeech() async {
        guard let profile = serverProfile else {
            error = "No server selected. Please add an Omni server in Settings."
            return
        }

        if profile.isDemo {
            await generateDemoSpeech()
            return
        }

        guard serverSupportsOmni else {
            error = omniRequiredError
            return
        }

        let baseURL = profile.effectiveOmniURL
        let apiKey = KeychainService.load(for: profile.id)

        guard !ttsText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            error = "Please enter text"
            return
        }

        isGeneratingTTS = true
        error = nil

        do {
            let speed: Double? = ttsSpeed != 1.0 ? ttsSpeed : nil
            let instructions: String? = ttsInstructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : ttsInstructions
            let audioData = try await omniClient.generateSpeech(
                baseURL: baseURL,
                apiKey: apiKey,
                model: effectiveModel,
                text: ttsText,
                voice: ttsVoice,
                format: ttsFormat,
                speed: speed,
                instructions: instructions
            )
            let item = GeneratedTTS(text: ttsText, voice: ttsVoice, audioData: audioData)
            modelContext?.insert(item)
            try? modelContext?.save()
            isGeneratingTTS = false
        } catch {
            self.error = (error as? VLLMAPIError)?.userMessage ?? error.localizedDescription
            isGeneratingTTS = false
        }
    }

    // MARK: - Audio Generation

    func generateAudio() async {
        guard let profile = serverProfile else {
            error = "No server selected. Please add an Omni server in Settings."
            return
        }

        if profile.isDemo {
            await generateDemoAudio()
            return
        }

        guard serverSupportsOmni else {
            error = omniRequiredError
            return
        }

        let baseURL = profile.effectiveOmniURL
        let apiKey = KeychainService.load(for: profile.id)

        guard !audioPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            error = "Please enter a prompt"
            return
        }

        isGeneratingAudio = true
        error = nil

        do {
            let negPrompt = audioNegativePrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : audioNegativePrompt
            let seedValue = Int(audioSeed)
            let audioData = try await omniClient.generateAudio(
                baseURL: baseURL,
                apiKey: apiKey,
                model: effectiveModel,
                prompt: audioPrompt,
                negativePrompt: negPrompt,
                duration: audioDuration,
                inferenceSteps: Int(audioInferenceSteps),
                guidanceScale: audioGuidanceScale,
                seed: seedValue
            )
            let item = GeneratedAudio(prompt: audioPrompt, audioData: audioData)
            modelContext?.insert(item)
            try? modelContext?.save()
            isGeneratingAudio = false
        } catch {
            self.error = (error as? VLLMAPIError)?.userMessage ?? error.localizedDescription
            isGeneratingAudio = false
        }
    }

    // MARK: - Gallery Management

    func clearAllGallery() {
        guard let context = modelContext else { return }
        do {
            try context.delete(model: GeneratedImage.self)
            try context.delete(model: GeneratedTTS.self)
            try context.delete(model: GeneratedAudio.self)
            try context.delete(model: GeneratedVideo.self)
            try context.save()
        } catch {
            self.error = "Failed to clear gallery: \(error.localizedDescription)"
        }
    }

    // MARK: - Demo Generation Methods

    /// Generate a programmatic gradient image with prompt text overlay.
    private func generateDemoImage() async {
        guard !imagePrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            error = "Please enter a prompt"
            return
        }

        isGeneratingImage = true
        error = nil

        // Simulate generation delay
        try? await Task.sleep(nanoseconds: 1_500_000_000)

        let size = CGSize(width: 512, height: 512)
        let renderer = UIGraphicsImageRenderer(size: size)

        let imageData = renderer.pngData { context in
            let rect = CGRect(origin: .zero, size: size)
            let cgContext = context.cgContext

            // Gradient background (vary by prompt hash)
            let hash = abs(imagePrompt.hashValue)
            let hue1 = CGFloat(hash % 360) / 360.0
            let hue2 = CGFloat((hash / 360) % 360) / 360.0
            let color1 = UIColor(hue: hue1, saturation: 0.6, brightness: 0.9, alpha: 1.0)
            let color2 = UIColor(hue: hue2, saturation: 0.5, brightness: 0.7, alpha: 1.0)

            let gradient = CGGradient(
                colorsSpace: CGColorSpaceCreateDeviceRGB(),
                colors: [color1.cgColor, color2.cgColor] as CFArray,
                locations: [0, 1]
            )!
            cgContext.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: size.width, y: size.height), options: [])

            // Prompt text in center
            let paragraphStyle = NSMutableParagraphStyle()
            paragraphStyle.alignment = .center
            paragraphStyle.lineBreakMode = .byWordWrapping
            let textAttrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 24, weight: .semibold),
                .foregroundColor: UIColor.white,
                .paragraphStyle: paragraphStyle
            ]
            let textRect = rect.insetBy(dx: 40, dy: 160)
            (imagePrompt as NSString).draw(in: textRect, withAttributes: textAttrs)

            // "DEMO" watermark bottom-right
            let demoAttrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 14, weight: .bold),
                .foregroundColor: UIColor.white.withAlphaComponent(0.6)
            ]
            let demoText = "DEMO"
            let demoSize = (demoText as NSString).size(withAttributes: demoAttrs)
            let demoPoint = CGPoint(x: size.width - demoSize.width - 16, y: size.height - demoSize.height - 16)
            (demoText as NSString).draw(at: demoPoint, withAttributes: demoAttrs)
        }

        let item = GeneratedImage(prompt: imagePrompt, imageData: imageData, isDemo: true)
        modelContext?.insert(item)
        try? modelContext?.save()
        isGeneratingImage = false
    }

    /// Generate demo TTS — stores text for on-demand playback via the play button.
    private func generateDemoSpeech() async {
        guard !ttsText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            error = "Please enter text"
            return
        }

        isGeneratingTTS = true
        error = nil

        // Brief delay to feel like generation
        try? await Task.sleep(nanoseconds: 600_000_000)

        let item = GeneratedTTS(text: ttsText, voice: "On-Device", audioData: Data([0]), demoText: ttsText)
        modelContext?.insert(item)
        try? modelContext?.save()
        isGeneratingTTS = false
    }

    /// Generate demo audio — stores a description for on-demand playback.
    private func generateDemoAudio() async {
        guard !audioPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            error = "Please enter a prompt"
            return
        }

        isGeneratingAudio = true
        error = nil

        // Brief delay to feel like generation
        try? await Task.sleep(nanoseconds: 600_000_000)

        let spokenText = "Demo audio for: \(audioPrompt)"

        let item = GeneratedAudio(prompt: audioPrompt, audioData: Data([0]), demoText: spokenText)
        modelContext?.insert(item)
        try? modelContext?.save()
        isGeneratingAudio = false
    }

    // MARK: - Demo Speech Playback

    /// Speak text using on-device AVSpeechSynthesizer (used by demo mode).
    func speakWithSynthesizer(_ text: String) {
        stopDemoSpeech()
        let synthesizer = AVSpeechSynthesizer()
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 1.05
        synthesizer.speak(utterance)
        demoSpeechSynthesizer = synthesizer
    }

    /// Stop any in-progress demo speech.
    func stopDemoSpeech() {
        demoSpeechSynthesizer?.stopSpeaking(at: .immediate)
        demoSpeechSynthesizer = nil
    }

    /// Whether demo speech is currently playing.
    var isDemoSpeaking: Bool {
        demoSpeechSynthesizer?.isSpeaking ?? false
    }
}
