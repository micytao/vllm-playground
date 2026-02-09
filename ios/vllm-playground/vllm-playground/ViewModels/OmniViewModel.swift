import Foundation
import SwiftUI

struct AudioItem: Identifiable {
    let id = UUID()
    let prompt: String
    let data: Data
    let createdAt: Date = Date()
}

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
    var generatedImages: [Data] = []
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
    var generatedVideos: [VideoItem] = []

    // TTS
    var ttsText = ""
    var ttsVoice = "Vivian"
    var ttsFormat = "wav"
    var ttsSpeed: Double = 1.0
    var ttsInstructions: String = ""
    var isGeneratingTTS = false
    var generatedAudioData: Data?

    // Audio generation
    var audioPrompt = ""
    var audioNegativePrompt = ""
    var audioDuration: Double = 10.0
    var audioInferenceSteps: Double = 50
    var audioGuidanceScale: Double = 7.0
    var audioSeed: String = ""
    var isGeneratingAudio = false
    var generatedAudioList: [AudioItem] = []

    // Error
    var error: String?

    // Server & model
    private(set) var serverProfile: ServerProfile?
    var selectedModel: String = ""

    private let omniClient = OmniAPIClient.shared

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

    // MARK: - Image Generation

    func generateImage() async {
        guard let profile = serverProfile else {
            error = "No server selected. Please add an Omni server in Settings."
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
            generatedImages.insert(contentsOf: images, at: 0)
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
            generatedVideos.insert(
                VideoItem(prompt: videoPrompt, data: videoData, duration: Int(videoDuration)),
                at: 0
            )
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
            generatedAudioData = audioData
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
            generatedAudioList.insert(AudioItem(prompt: audioPrompt, data: audioData), at: 0)
            isGeneratingAudio = false
        } catch {
            self.error = (error as? VLLMAPIError)?.userMessage ?? error.localizedDescription
            isGeneratingAudio = false
        }
    }

    // MARK: - Gallery Management

    func clearAllGallery() {
        generatedImages.removeAll()
        generatedAudioList.removeAll()
        generatedVideos.removeAll()
    }
}
