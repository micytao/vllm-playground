import Foundation
import AVFoundation

// MARK: - TTS Backend

enum TTSBackend: String, CaseIterable, Identifiable {
    case apple   // AVSpeechSynthesizer (default, on-device)
    case server  // vLLM Omni /v1/audio/speech

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .apple: return "On-Device"
        case .server: return "Server"
        }
    }

    var icon: String {
        switch self {
        case .apple: return "iphone"
        case .server: return "server.rack"
        }
    }
}

// MARK: - TTS Service

@Observable
@MainActor
final class TTSService: NSObject {
    var backend: TTSBackend = .apple
    var isSpeaking = false
    var error: String?

    // Apple TTS settings
    var appleVoiceIdentifier: String?  // nil = auto-select best available
    var speechRate: Float = AVSpeechUtteranceDefaultSpeechRate * 1.05  // slightly faster than default for natural pace
    var pitchMultiplier: Float = 1.0

    // Server TTS settings
    var serverVoice: String = "Vivian"
    var serverSpeed: Double = 1.0
    var serverModel: String = ""

    // Completion callback
    var onFinishedSpeaking: (() -> Void)?

    // Private
    private let synthesizer = AVSpeechSynthesizer()
    private var audioPlayer: AVAudioPlayer?
    private var serverProfile: ServerProfile?
    private let omniClient = OmniAPIClient.shared
    private var bestVoiceCache: AVSpeechSynthesisVoice?

    override init() {
        super.init()
        synthesizer.delegate = self
        // Pre-select the best available voice
        bestVoiceCache = Self.findBestVoice(language: "en-US")
    }

    func configure(serverProfile: ServerProfile?) {
        self.serverProfile = serverProfile
    }

    // MARK: - Speak

    func speak(_ text: String) async {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            onFinishedSpeaking?()
            return
        }

        error = nil
        isSpeaking = true

        switch backend {
        case .apple:
            speakWithApple(text)
        case .server:
            await speakWithServer(text)
        }
    }

    // MARK: - Stop

    func stop() {
        if synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .immediate)
        }
        audioPlayer?.stop()
        audioPlayer = nil
        isSpeaking = false
    }

    // MARK: - Apple TTS

    private func speakWithApple(_ text: String) {
        // Configure audio session for playback
        configurePlaybackSession()

        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = speechRate
        utterance.pitchMultiplier = pitchMultiplier

        // Add natural pauses between sentences
        utterance.preUtteranceDelay = 0.1
        utterance.postUtteranceDelay = 0.05

        // Select voice: user-chosen > cached best > language default
        if let identifier = appleVoiceIdentifier {
            utterance.voice = AVSpeechSynthesisVoice(identifier: identifier)
        } else if let best = bestVoiceCache {
            utterance.voice = best
        } else {
            utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        }

        // Use sentence-by-sentence speaking for more natural cadence on long text
        if text.count > 200 {
            speakBySentence(text)
        } else {
            synthesizer.speak(utterance)
        }
    }

    /// Splits text into sentences and speaks them individually for more natural pacing
    private func speakBySentence(_ text: String) {
        let sentences = text.components(separatedBy: CharacterSet(charactersIn: ".!?"))
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        for (index, sentence) in sentences.enumerated() {
            // Add back punctuation for natural intonation
            let spokenText = sentence.last?.isPunctuation == true ? sentence : sentence + "."
            let utterance = AVSpeechUtterance(string: spokenText)
            utterance.rate = speechRate
            utterance.pitchMultiplier = pitchMultiplier

            if let identifier = appleVoiceIdentifier {
                utterance.voice = AVSpeechSynthesisVoice(identifier: identifier)
            } else if let best = bestVoiceCache {
                utterance.voice = best
            } else {
                utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
            }

            // Natural pauses between sentences
            utterance.preUtteranceDelay = index == 0 ? 0.1 : 0.25
            utterance.postUtteranceDelay = 0.05

            synthesizer.speak(utterance)
        }
    }

    // MARK: - Server TTS

    private func speakWithServer(_ text: String) async {
        guard let profile = serverProfile else {
            // Fallback to Apple TTS
            speakWithApple(text)
            return
        }

        let baseURL = profile.effectiveOmniURL
        let apiKey = KeychainService.load(for: profile.id)
        let model = serverModel.isEmpty ? (profile.defaultModel ?? profile.availableModels.first ?? "default") : serverModel

        do {
            let speed: Double? = serverSpeed != 1.0 ? serverSpeed : nil
            let audioData = try await omniClient.generateSpeech(
                baseURL: baseURL,
                apiKey: apiKey,
                model: model,
                text: text,
                voice: serverVoice,
                format: "wav",
                speed: speed
            )

            // Configure audio session for playback
            configurePlaybackSession()

            audioPlayer = try AVAudioPlayer(data: audioData)
            audioPlayer?.delegate = self
            audioPlayer?.prepareToPlay()
            audioPlayer?.play()
        } catch {
            // Fallback to Apple TTS on server failure
            self.error = "Server TTS failed, using on-device voice"
            speakWithApple(text)
        }
    }

    // MARK: - Audio Session

    private func configurePlaybackSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(
                .playback,
                mode: .voicePrompt,
                options: [.duckOthers]
            )
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            #if DEBUG
            print("[TTSService] Audio session error: \(error)")
            #endif
        }
    }

    // MARK: - Voice Discovery

    /// Apple's novelty/joke voices that are not suitable for conversation
    private static let noveltyVoiceNames: Set<String> = [
        "Albert", "Bad News", "Bahh", "Bells", "Boing", "Bubbles",
        "Cellos", "Good News", "Jester", "Organ", "Superstar",
        "Trinoids", "Whisper", "Wobble", "Zarvox",
    ]

    /// Whether a voice is a real speech voice (not a novelty effect)
    private static func isRealVoice(_ voice: AVSpeechSynthesisVoice) -> Bool {
        !noveltyVoiceNames.contains(voice.name)
    }

    /// Find the best available voice for a language, preferring Premium > Enhanced > Default quality
    static func findBestVoice(language: String) -> AVSpeechSynthesisVoice? {
        let voices = AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.hasPrefix(language.prefix(2).lowercased()) && isRealVoice($0) }

        // Quality ranking: premium (3) > enhanced (2) > default (1)
        let ranked = voices.sorted { lhs, rhs in
            qualityRank(lhs) > qualityRank(rhs)
        }

        return ranked.first
    }

    private static func qualityRank(_ voice: AVSpeechSynthesisVoice) -> Int {
        switch voice.quality {
        case .premium: return 3
        case .enhanced: return 2
        case .default: return 1
        @unknown default: return 0
        }
    }

    /// Available English voices, excluding novelty voices, sorted by quality
    static var availableAppleVoices: [(identifier: String, name: String, language: String, quality: String)] {
        AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.hasPrefix("en") && isRealVoice($0) }
            .sorted { lhs, rhs in
                // Sort by quality (best first), then by name
                let lq = qualityRank(lhs)
                let rq = qualityRank(rhs)
                if lq != rq { return lq > rq }
                return lhs.name < rhs.name
            }
            .map {
                let quality: String
                switch $0.quality {
                case .premium: quality = "Premium"
                case .enhanced: quality = "Enhanced"
                default: quality = "Default"
                }
                return (identifier: $0.identifier, name: $0.name, language: $0.language, quality: quality)
            }
    }
}

// MARK: - AVSpeechSynthesizerDelegate

extension TTSService: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.isSpeaking = false
            self.onFinishedSpeaking?()
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.isSpeaking = false
        }
    }
}

// MARK: - AVAudioPlayerDelegate

extension TTSService: AVAudioPlayerDelegate {
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            self.isSpeaking = false
            self.audioPlayer = nil
            self.onFinishedSpeaking?()
        }
    }
}
