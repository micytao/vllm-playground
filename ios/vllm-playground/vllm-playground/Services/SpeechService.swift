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
        transcript = ""
        error = nil

        guard let speechRecognizer, speechRecognizer.isAvailable else {
            error = "Speech recognition is not available on this device."
            return
        }

        // Step 1: Check speech permission (no async/continuation)
        let speechStatus = SFSpeechRecognizer.authorizationStatus()
        switch speechStatus {
        case .authorized:
            checkMicrophoneAndBegin()
        case .notDetermined:
            // Callback fires on arbitrary thread — hop back via Task
            SFSpeechRecognizer.requestAuthorization { status in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    if status == .authorized {
                        self.checkMicrophoneAndBegin()
                    } else {
                        self.error = "Speech recognition permission denied. Enable it in Settings."
                    }
                }
            }
        default:
            error = "Speech recognition permission denied. Enable it in Settings."
        }
    }

    // MARK: - Step 2: Microphone Permission

    private func checkMicrophoneAndBegin() {
        if #available(iOS 17.0, *) {
            Task {
                let granted = await AVAudioApplication.requestRecordPermission()
                guard granted else {
                    error = "Microphone permission denied. Enable it in Settings."
                    return
                }
                // Brief delay to let audio subsystem settle after fresh permission grant
                try? await Task.sleep(for: .milliseconds(200))
                beginRecording()
            }
        } else {
            // Fallback for iOS < 17 — callback fires on arbitrary thread
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    guard granted else {
                        self.error = "Microphone permission denied. Enable it in Settings."
                        return
                    }
                    try? await Task.sleep(for: .milliseconds(200))
                    self.beginRecording()
                }
            }
        }
    }

    // MARK: - Stop Recording

    func stopRecording() {
        recognitionTask?.cancel()
        recognitionTask = nil

        recognitionRequest?.endAudio()
        recognitionRequest = nil

        audioEngine?.stop()
        if let inputNode = audioEngine?.inputNode {
            inputNode.removeTap(onBus: 0)
        }
        audioEngine = nil

        isRecording = false

        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: - Begin Recording (audio engine + recognition)

    private func beginRecording() {
        // 1. Configure audio session BEFORE creating engine
        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            self.error = "Audio session error: \(error.localizedDescription)"
            return
        }

        guard audioSession.isInputAvailable else {
            self.error = "No microphone available on this device."
            return
        }

        // 2. Create engine AFTER audio session is fully active
        let audioEngine = AVAudioEngine()
        self.audioEngine = audioEngine

        // 3. Create recognition request
        let request = SFSpeechAudioBufferRecognitionRequest()
        if speechRecognizer?.supportsOnDeviceRecognition == true {
            request.requiresOnDeviceRecognition = true
        }
        request.shouldReportPartialResults = true
        self.recognitionRequest = request

        // 4. Build a recording format from the hardware sample rate
        let sampleRate = audioSession.sampleRate
        guard sampleRate > 0 else {
            self.error = "Could not determine audio sample rate."
            cleanup()
            return
        }
        guard let recordingFormat = AVAudioFormat(
            standardFormatWithSampleRate: sampleRate,
            channels: 1
        ) else {
            self.error = "Failed to create audio format."
            cleanup()
            return
        }

        // 5. Install audio tap
        let inputNode = audioEngine.inputNode
        nonisolated(unsafe) let audioRequest = request
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { @Sendable buffer, _ in
            audioRequest.append(buffer)
        }

        // 6. Start engine
        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            self.error = "Audio engine error: \(error.localizedDescription)"
            cleanup()
            return
        }

        // 7. Start recognition task
        recognitionTask = speechRecognizer?.recognitionTask(with: request) { @Sendable [weak self] result, error in
            // Extract Sendable values before crossing actor boundary
            let transcriptText = result?.bestTranscription.formattedString
            let errorDescription: String? = {
                guard let error else { return nil }
                let nsError = error as NSError
                if nsError.domain == "kAFAssistantErrorDomain" &&
                    (nsError.code == 216 || nsError.code == 209) {
                    return nil
                }
                return error.localizedDescription
            }()

            Task { @MainActor in
                guard let self else { return }

                if let transcriptText {
                    self.transcript = transcriptText
                }

                if let errorDescription {
                    self.error = errorDescription
                    self.stopRecording()
                }
            }
        }

        isRecording = true
    }

    private func cleanup() {
        audioEngine?.stop()
        if let inputNode = audioEngine?.inputNode {
            inputNode.removeTap(onBus: 0)
        }
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        audioEngine = nil
        recognitionRequest = nil
        recognitionTask = nil
        isRecording = false
    }
}
