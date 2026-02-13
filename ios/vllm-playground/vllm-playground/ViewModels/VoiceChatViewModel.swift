import Foundation
import SwiftUI
import SwiftData
import AVFoundation

// MARK: - Voice Chat State

enum VoiceChatState: Equatable {
    case idle
    case listening
    case thinking
    case speaking
}

// MARK: - Voice Chat Turn

struct VoiceTurn: Identifiable {
    let id = UUID()
    let role: String  // "user" or "assistant"
    let content: String
    let timestamp: Date = Date()
}

// MARK: - Voice Chat View Model

@Observable
@MainActor
final class VoiceChatViewModel: Identifiable {
    let id = UUID()

    // State
    var state: VoiceChatState = .idle
    var userTranscript: String = ""
    var assistantText: String = ""
    var error: String?
    var turns: [VoiceTurn] = []

    // Settings (inherited from ChatViewModel)
    var selectedModel: String = ""
    var systemPrompt: String = ""
    var temperature: Double = 0.7
    var maxTokens: Int = 1024

    // Services
    let speechService = SpeechService()
    let ttsService = TTSService()

    // Private
    private var serverProfile: ServerProfile?
    private let apiClient: VLLMAPIClientProtocol
    private var streamTask: Task<Void, Never>?
    private var silenceTimer: Task<Void, Never>?
    private var lastTranscriptUpdate: Date = Date()

    private let silenceThreshold: TimeInterval = 1.5  // seconds of silence before auto-send

    init(
        serverProfile: ServerProfile?,
        model: String = "",
        systemPrompt: String = "",
        temperature: Double = 0.7,
        maxTokens: Int = 1024,
        apiClient: VLLMAPIClientProtocol = VLLMAPIClient.shared
    ) {
        self.serverProfile = serverProfile
        self.selectedModel = model
        self.systemPrompt = systemPrompt
        self.temperature = temperature
        self.maxTokens = maxTokens
        self.apiClient = apiClient

        // Configure TTS with server profile
        ttsService.configure(serverProfile: serverProfile)

        // Set up TTS completion callback
        ttsService.onFinishedSpeaking = { [weak self] in
            Task { @MainActor [weak self] in
                guard let self, self.state == .speaking else { return }
                // Auto-resume listening after speaking finishes
                self.startListening()
            }
        }
    }

    // MARK: - Start Session

    func startSession() {
        state = .idle
        // Small delay to let the view fully present before accessing audio hardware
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(500))
            guard let self, self.state == .idle else { return }
            self.startListening()
        }
    }

    // MARK: - End Session

    func endSession() {
        stopEverything()
        state = .idle
    }

    // MARK: - Start Listening

    func startListening() {
        // Stop any ongoing TTS
        ttsService.stop()

        // Deactivate audio session from playback before SpeechService takes over
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        state = .listening
        userTranscript = ""
        error = nil

        speechService.startRecording()
        startSilenceDetection()
    }

    // MARK: - Interrupt (tap while speaking)

    func interrupt() {
        switch state {
        case .speaking:
            ttsService.stop()
            startListening()
        case .thinking:
            streamTask?.cancel()
            streamTask = nil
            startListening()
        case .listening:
            // Manual send -- stop listening and process
            finishListeningAndSend()
        case .idle:
            startListening()
        }
    }

    // MARK: - Silence Detection

    private func startSilenceDetection() {
        silenceTimer?.cancel()
        lastTranscriptUpdate = Date()

        silenceTimer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(300))

                guard let self else { return }
                guard self.state == .listening else { return }

                let transcript = self.speechService.transcript
                if transcript != self.userTranscript {
                    // New speech detected, update and reset timer
                    self.userTranscript = transcript
                    self.lastTranscriptUpdate = Date()
                } else if !transcript.isEmpty {
                    // Check if silence threshold exceeded
                    let elapsed = Date().timeIntervalSince(self.lastTranscriptUpdate)
                    if elapsed >= self.silenceThreshold {
                        self.finishListeningAndSend()
                        return
                    }
                }
            }
        }
    }

    // MARK: - Finish Listening and Send

    private func finishListeningAndSend() {
        silenceTimer?.cancel()
        silenceTimer = nil

        let transcript = speechService.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        speechService.stopRecording()

        guard !transcript.isEmpty else {
            // Nothing captured, go back to listening
            startListening()
            return
        }

        userTranscript = transcript

        // Save user turn
        turns.append(VoiceTurn(role: "user", content: transcript))

        // Send to LLM
        sendToLLM(transcript)
    }

    // MARK: - Send to LLM

    private func sendToLLM(_ text: String) {
        guard let profile = serverProfile else {
            error = "No server selected"
            state = .idle
            return
        }

        guard !selectedModel.isEmpty else {
            error = "No model selected"
            state = .idle
            return
        }

        state = .thinking
        assistantText = ""

        let apiKey = KeychainService.load(for: profile.id)
        let apiMessages = buildAPIMessages()

        let request = ChatCompletionRequest(
            model: selectedModel,
            messages: apiMessages,
            temperature: temperature,
            max_tokens: maxTokens,
            stream: true
        )

        streamTask = Task { [weak self] in
            guard let self else { return }

            do {
                let stream = self.apiClient.streamChatCompletion(
                    baseURL: profile.baseURL,
                    apiKey: apiKey,
                    request: request
                )

                var fullResponse = ""

                for try await event in stream {
                    switch event {
                    case .text(let token):
                        fullResponse += token
                        self.assistantText = fullResponse
                    case .done:
                        break
                    }
                }

                guard !Task.isCancelled else { return }

                // Save assistant turn
                self.turns.append(VoiceTurn(role: "assistant", content: fullResponse))

                // Speak the response
                self.state = .speaking
                await self.ttsService.speak(fullResponse)

            } catch is CancellationError {
                // Interrupted by user
                return
            } catch {
                self.error = (error as? VLLMAPIError)?.userMessage ?? error.localizedDescription
                self.state = .idle
            }
        }
    }

    // MARK: - Build API Messages

    private func buildAPIMessages() -> [ChatMessagePayload] {
        var messages: [ChatMessagePayload] = []

        // System prompt
        if !systemPrompt.isEmpty {
            messages.append(ChatMessagePayload(
                role: "system",
                content: .text(systemPrompt)
            ))
        }

        // Conversation history
        for turn in turns {
            messages.append(ChatMessagePayload(
                role: turn.role,
                content: .text(turn.content)
            ))
        }

        return messages
    }

    // MARK: - Save to Conversation

    func saveToConversation(_ conversation: Conversation, context: ModelContext) {
        for turn in turns {
            let role: MessageRole = turn.role == "user" ? .user : .assistant
            let message = Message(
                role: role,
                content: turn.content,
                conversation: conversation
            )
            conversation.messages.append(message)
            context.insert(message)
        }

        if conversation.title == "New Chat", let firstTurn = turns.first(where: { $0.role == "user" }) {
            conversation.title = firstTurn.content.firstLineTitle
        }

        conversation.model = selectedModel
        conversation.temperature = temperature
        conversation.maxTokens = maxTokens
        conversation.systemPrompt = systemPrompt
        conversation.updatedAt = Date()

        try? context.save()
    }

    // MARK: - Helpers

    private func stopEverything() {
        silenceTimer?.cancel()
        silenceTimer = nil
        streamTask?.cancel()
        streamTask = nil
        speechService.stopRecording()
        ttsService.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
