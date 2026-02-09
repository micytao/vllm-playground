import Foundation
import Speech
import AVFoundation

@Observable
@MainActor
final class SpeechService {
    var isRecording = false
    var transcript = ""
    var error: String?

    private var audioEngine: AVAudioEngine?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private let speechRecognizer = SFSpeechRecognizer()

    // MARK: - Start Recording

    func startRecording() {
        // Reset state
        transcript = ""
        error = nil

        // Check availability
        guard let speechRecognizer, speechRecognizer.isAvailable else {
            error = "Speech recognition is not available on this device."
            return
        }

        // Request permissions
        Task {
            let speechAuthorized = await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { status in
                    continuation.resume(returning: status == .authorized)
                }
            }

            guard speechAuthorized else {
                error = "Speech recognition permission denied. Enable it in Settings."
                return
            }

            let micAuthorized: Bool
            if #available(iOS 17.0, *) {
                micAuthorized = await AVAudioApplication.requestRecordPermission()
            } else {
                micAuthorized = await withCheckedContinuation { continuation in
                    AVAudioSession.sharedInstance().requestRecordPermission { granted in
                        continuation.resume(returning: granted)
                    }
                }
            }

            guard micAuthorized else {
                error = "Microphone permission denied. Enable it in Settings."
                return
            }

            beginRecording()
        }
    }

    // MARK: - Stop Recording

    func stopRecording() {
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()

        audioEngine = nil
        recognitionRequest = nil
        recognitionTask = nil
        isRecording = false
    }

    // MARK: - Private

    private func beginRecording() {
        let audioEngine = AVAudioEngine()
        let request = SFSpeechAudioBufferRecognitionRequest()

        // Prefer on-device recognition if available
        if speechRecognizer?.supportsOnDeviceRecognition == true {
            request.requiresOnDeviceRecognition = true
        }
        request.shouldReportPartialResults = true

        self.audioEngine = audioEngine
        self.recognitionRequest = request

        // Configure audio session
        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            self.error = "Failed to configure audio session: \(error.localizedDescription)"
            return
        }

        // Install audio tap
        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
            request.append(buffer)
        }

        // Start audio engine
        do {
            audioEngine.prepare()
            try audioEngine.start()
        } catch {
            self.error = "Failed to start audio engine: \(error.localizedDescription)"
            return
        }

        // Start recognition
        recognitionTask = speechRecognizer?.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor in
                guard let self else { return }

                if let result {
                    self.transcript = result.bestTranscription.formattedString
                }

                if let error {
                    // Ignore cancellation errors
                    let nsError = error as NSError
                    if nsError.domain == "kAFAssistantErrorDomain" && nsError.code == 216 {
                        // User cancelled - not a real error
                        return
                    }
                    self.error = error.localizedDescription
                    self.stopRecording()
                }
            }
        }

        isRecording = true
    }
}
