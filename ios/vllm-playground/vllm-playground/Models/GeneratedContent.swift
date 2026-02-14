import Foundation
import SwiftData

// MARK: - Generated Image

@Model
final class GeneratedImage {
    @Attribute(.unique) var id: UUID
    var prompt: String
    @Attribute(.externalStorage) var imageData: Data
    var isDemo: Bool
    var createdAt: Date

    init(prompt: String, imageData: Data, isDemo: Bool = false) {
        self.id = UUID()
        self.prompt = prompt
        self.imageData = imageData
        self.isDemo = isDemo
        self.createdAt = Date()
    }
}

// MARK: - Generated TTS

@Model
final class GeneratedTTS {
    @Attribute(.unique) var id: UUID
    var text: String
    var voice: String
    @Attribute(.externalStorage) var audioData: Data
    /// If non-nil, this item was generated in demo mode and should be played
    /// via AVSpeechSynthesizer instead of AVAudioPlayer.
    var demoText: String?
    var createdAt: Date

    var isDemo: Bool { demoText != nil }

    init(text: String, voice: String, audioData: Data, demoText: String? = nil) {
        self.id = UUID()
        self.text = text
        self.voice = voice
        self.audioData = audioData
        self.demoText = demoText
        self.createdAt = Date()
    }
}

// MARK: - Generated Audio

@Model
final class GeneratedAudio {
    @Attribute(.unique) var id: UUID
    var prompt: String
    @Attribute(.externalStorage) var audioData: Data
    /// If non-nil, this item was generated in demo mode and should be played
    /// via AVSpeechSynthesizer instead of AVAudioPlayer.
    var demoText: String?
    var createdAt: Date

    var isDemo: Bool { demoText != nil }

    init(prompt: String, audioData: Data, demoText: String? = nil) {
        self.id = UUID()
        self.prompt = prompt
        self.audioData = audioData
        self.demoText = demoText
        self.createdAt = Date()
    }
}

// MARK: - Generated Video

@Model
final class GeneratedVideo {
    @Attribute(.unique) var id: UUID
    var prompt: String
    @Attribute(.externalStorage) var videoData: Data
    var duration: Int
    var isDemo: Bool
    var createdAt: Date

    init(prompt: String, videoData: Data, duration: Int, isDemo: Bool = false) {
        self.id = UUID()
        self.prompt = prompt
        self.videoData = videoData
        self.duration = duration
        self.isDemo = isDemo
        self.createdAt = Date()
    }
}
