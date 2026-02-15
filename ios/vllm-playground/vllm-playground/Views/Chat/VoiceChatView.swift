import SwiftUI
import SwiftData
import AVFoundation

struct VoiceChatView: View {
    @Bindable var viewModel: VoiceChatViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var showSettings = false
    @State private var showSaveConfirmation = false

    let conversation: Conversation?

    var body: some View {
        ZStack {
            // Background
            backgroundGradient
                .ignoresSafeArea()

            VStack(spacing: 0) {
                // Top bar
                topBar

                Spacer()

                // Center orb + transcript
                centerContent

                Spacer()

                // Bottom controls
                bottomControls
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
        }
        .onAppear {
            viewModel.startSession()
        }
        .onDisappear {
            viewModel.endSession()
        }
        .sheet(isPresented: $showSettings) {
            VoiceChatSettingsSheet(viewModel: viewModel)
                .presentationDetents([.medium, .large])
        }
        .confirmationDialog(
            "Save Conversation?",
            isPresented: $showSaveConfirmation,
            titleVisibility: .visible
        ) {
            Button("Save & Close") {
                if let conversation {
                    viewModel.saveToConversation(conversation, context: modelContext)
                }
                dismiss()
            }
            Button("Discard & Close", role: .destructive) {
                dismiss()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Would you like to save this voice conversation to the chat history?")
        }
    }

    // MARK: - Background

    private var backgroundGradient: some View {
        ZStack {
            AppColors.pageBg

            // Subtle vLLM logo watermark
            Image("VLLMLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 220, height: 220)
                .opacity(0.04)
                .blendMode(.normal)
                .offset(y: 180)

            // Subtle animated gradient based on state
            Circle()
                .fill(orbColor.opacity(0.08))
                .frame(width: 400, height: 400)
                .blur(radius: 100)
                .offset(y: -60)
                .animation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true), value: viewModel.state)
        }
    }

    // MARK: - Top Bar

    private var topBar: some View {
        HStack {
            Button {
                viewModel.endSession()
                if !viewModel.turns.isEmpty, conversation != nil {
                    showSaveConfirmation = true
                } else {
                    dismiss()
                }
            } label: {
                Image(systemName: "xmark")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(AppColors.textSecondary)
                    .frame(width: 36, height: 36)
                    .background(AppColors.cardBg.opacity(0.8))
                    .clipShape(Circle())
            }

            Spacer()

            // Model name + TTS indicator
            HStack(spacing: 6) {
                Image(systemName: viewModel.ttsService.backend.icon)
                    .font(.caption2)
                    .foregroundStyle(AppColors.textTertiary)

                Text(modelDisplayName)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(AppColors.textSecondary)
                    .lineLimit(1)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(AppColors.cardBg.opacity(0.8))
            .clipShape(Capsule())

            Spacer()

            Button {
                showSettings = true
            } label: {
                Image(systemName: "gear")
                    .font(.body.weight(.medium))
                    .foregroundStyle(AppColors.textSecondary)
                    .frame(width: 36, height: 36)
                    .background(AppColors.cardBg.opacity(0.8))
                    .clipShape(Circle())
            }
        }
    }

    // MARK: - Center Content

    private var centerContent: some View {
        VStack(spacing: 28) {
            // Animated orb
            animatedOrb

            // Transcript area
            transcriptArea
        }
    }

    // MARK: - Animated Orb

    private var animatedOrb: some View {
        ZStack {
            // Outer pulse ring (listening / speaking)
            if viewModel.state == .listening || viewModel.state == .speaking {
                Circle()
                    .stroke(orbColor.opacity(0.2), lineWidth: 2)
                    .frame(width: 160, height: 160)
                    .scaleEffect(viewModel.state == .listening ? 1.15 : 1.05)
                    .animation(
                        .easeInOut(duration: viewModel.state == .listening ? 1.2 : 0.8)
                        .repeatForever(autoreverses: true),
                        value: viewModel.state
                    )
            }

            // Middle glow ring
            Circle()
                .fill(orbColor.opacity(0.12))
                .frame(width: 140, height: 140)
                .scaleEffect(pulseScale)
                .animation(
                    .easeInOut(duration: 1.0).repeatForever(autoreverses: true),
                    value: viewModel.state
                )

            // Core orb
            Circle()
                .fill(
                    RadialGradient(
                        colors: [orbColor, orbColor.opacity(0.6)],
                        center: .center,
                        startRadius: 10,
                        endRadius: 55
                    )
                )
                .frame(width: 110, height: 110)
                .shadow(color: orbColor.opacity(0.4), radius: 20, y: 4)

            // State icon
            stateIcon
        }
        .animation(.easeInOut(duration: 0.4), value: viewModel.state)
    }

    @ViewBuilder
    private var stateIcon: some View {
        switch viewModel.state {
        case .idle:
            Image(systemName: "mic.fill")
                .font(.system(size: 32, weight: .medium))
                .foregroundStyle(.white)
        case .listening:
            Image(systemName: "waveform")
                .font(.system(size: 32, weight: .medium))
                .foregroundStyle(.white)
                .symbolEffect(.variableColor.iterative, isActive: true)
        case .thinking:
            ProgressView()
                .progressViewStyle(.circular)
                .tint(.white)
                .scaleEffect(1.5)
        case .speaking:
            Image(systemName: "speaker.wave.3.fill")
                .font(.system(size: 28, weight: .medium))
                .foregroundStyle(.white)
                .symbolEffect(.variableColor.iterative, isActive: true)
        }
    }

    private var orbColor: Color {
        switch viewModel.state {
        case .idle: return AppColors.textTertiary
        case .listening: return AppColors.appPrimary
        case .thinking: return AppColors.appWarning
        case .speaking: return AppColors.appSuccess
        }
    }

    private var pulseScale: CGFloat {
        switch viewModel.state {
        case .idle: return 1.0
        case .listening: return 1.08
        case .thinking: return 1.04
        case .speaking: return 1.06
        }
    }

    // MARK: - Transcript Area

    private var transcriptArea: some View {
        VStack(spacing: 16) {
            // State label
            Text(stateLabel)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(orbColor)
                .textCase(.uppercase)
                .tracking(1.2)

            // User transcript (while listening)
            if viewModel.state == .listening && !viewModel.speechService.transcript.isEmpty {
                Text(viewModel.speechService.transcript)
                    .font(.body)
                    .foregroundStyle(AppColors.textPrimary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 20)
                    .transition(.opacity.combined(with: .scale(scale: 0.95)))
            }

            // Last user message (while thinking/speaking)
            if (viewModel.state == .thinking || viewModel.state == .speaking) && !viewModel.userTranscript.isEmpty {
                Text(viewModel.userTranscript)
                    .font(.callout)
                    .foregroundStyle(AppColors.textTertiary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .padding(.horizontal, 20)
            }

            // Assistant response (while thinking/speaking)
            if !viewModel.assistantText.isEmpty {
                ScrollView {
                    Text(viewModel.assistantText)
                        .font(.body)
                        .foregroundStyle(AppColors.textPrimary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 20)
                }
                .frame(maxHeight: 150)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }

            // Error
            if let error = viewModel.error {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.caption)
                    Text(error)
                        .font(.caption)
                }
                .foregroundStyle(AppColors.appRed)
                .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.3), value: viewModel.state)
        .animation(.easeInOut(duration: 0.2), value: viewModel.assistantText)
    }

    private var stateLabel: String {
        switch viewModel.state {
        case .idle: return "Tap to start"
        case .listening: return "Listening..."
        case .thinking: return "Thinking..."
        case .speaking: return "Speaking..."
        }
    }

    // MARK: - Bottom Controls

    private var bottomControls: some View {
        HStack(spacing: 40) {
            // End session button
            Button {
                viewModel.endSession()
                if !viewModel.turns.isEmpty, conversation != nil {
                    showSaveConfirmation = true
                } else {
                    dismiss()
                }
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 52, height: 52)
                    .background(AppColors.appRed)
                    .clipShape(Circle())
            }

            // Main action button
            Button {
                viewModel.interrupt()
            } label: {
                Image(systemName: mainButtonIcon)
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 72, height: 72)
                    .background(mainButtonColor)
                    .clipShape(Circle())
                    .shadow(color: mainButtonColor.opacity(0.4), radius: 12, y: 4)
            }
            .scaleEffect(viewModel.state == .listening ? 1.1 : 1.0)
            .animation(
                .easeInOut(duration: 0.8).repeatForever(autoreverses: true),
                value: viewModel.state == .listening
            )

            // Turn count indicator
            VStack(spacing: 4) {
                Text("\(viewModel.turns.count / 2)")
                    .font(.title3.weight(.bold).monospacedDigit())
                    .foregroundStyle(AppColors.textPrimary)
                Text("turns")
                    .font(.caption2)
                    .foregroundStyle(AppColors.textTertiary)
            }
            .frame(width: 52, height: 52)
        }
        .padding(.bottom, 16)
    }

    private var mainButtonIcon: String {
        switch viewModel.state {
        case .idle: return "mic.fill"
        case .listening: return "arrow.up.circle.fill"
        case .thinking: return "stop.fill"
        case .speaking: return "mic.fill"
        }
    }

    private var mainButtonColor: Color {
        switch viewModel.state {
        case .idle: return AppColors.appPrimary
        case .listening: return AppColors.appPrimary
        case .thinking: return AppColors.textSecondary
        case .speaking: return AppColors.appPrimary
        }
    }

    // MARK: - Helpers

    private var modelDisplayName: String {
        if viewModel.selectedModel.isEmpty { return "No Model" }
        let parts = viewModel.selectedModel.split(separator: "/")
        return String(parts.last ?? Substring(viewModel.selectedModel))
    }
}

// MARK: - Voice Chat Settings Sheet

struct VoiceChatSettingsSheet: View {
    @Bindable var viewModel: VoiceChatViewModel
    @Bindable var ttsService: TTSService
    @Environment(\.dismiss) private var dismiss

    init(viewModel: VoiceChatViewModel) {
        self.viewModel = viewModel
        self.ttsService = viewModel.ttsService
    }

    var body: some View {
        NavigationStack {
            List {
                // TTS Backend
                Section {
                    Picker("Voice Engine", selection: $ttsService.backend) {
                        ForEach(TTSBackend.allCases) { backend in
                            HStack {
                                Image(systemName: backend.icon)
                                Text(backend.displayName)
                            }
                            .tag(backend)
                        }
                    }
                    .pickerStyle(.segmented)
                } header: {
                    Text("Text-to-Speech")
                } footer: {
                    Text(ttsService.backend == .apple
                         ? "Uses on-device speech synthesis. Works offline with zero latency."
                         : "Uses vLLM server for higher quality neural voices. Requires an Omni server.")
                }

                // Apple TTS settings
                if ttsService.backend == .apple {
                    Section {
                        NavigationLink {
                            VoicePickerView(
                                selectedIdentifier: $ttsService.appleVoiceIdentifier,
                                ttsService: ttsService
                            )
                        } label: {
                            HStack {
                                Text("Voice")
                                Spacer()
                                Text(selectedVoiceName)
                                    .foregroundStyle(AppColors.textSecondary)
                            }
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("Speed")
                                Spacer()
                                Text(String(format: "%.1fx", ttsService.speechRate / AVSpeechUtteranceDefaultSpeechRate))
                                    .font(.footnote.monospacedDigit())
                                    .foregroundStyle(AppColors.appPrimary)
                            }
                            Slider(
                                value: $ttsService.speechRate,
                                in: AVSpeechUtteranceMinimumSpeechRate...AVSpeechUtteranceMaximumSpeechRate
                            )
                            .tint(AppColors.appPrimary)
                        }
                    } header: {
                        Text("On-Device Voice")
                    } footer: {
                        Text("Premium and Enhanced voices sound more natural. Download them in Settings > Accessibility > Spoken Content > Voices.")
                    }
                }

                // Server TTS settings
                if ttsService.backend == .server {
                    Section("Server Voice") {
                        Picker("Voice", selection: $ttsService.serverVoice) {
                            ForEach(serverVoices, id: \.self) { voice in
                                Text(voice).tag(voice)
                            }
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("Speed")
                                Spacer()
                                Text(String(format: "%.1fx", ttsService.serverSpeed))
                                    .font(.footnote.monospacedDigit())
                                    .foregroundStyle(AppColors.appPrimary)
                            }
                            Slider(value: $ttsService.serverSpeed, in: 0.5...2.0, step: 0.1)
                                .tint(AppColors.appPrimary)
                        }
                    }
                }

                // LLM Settings
                Section("Conversation") {
                    TextField("System Prompt", text: $viewModel.systemPrompt, axis: .vertical)
                        .lineLimit(2...4)
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Voice Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(AppColors.appPrimary)
                }
            }
        }
    }

    private var selectedVoiceName: String {
        guard let id = ttsService.appleVoiceIdentifier else { return "Auto (Best)" }
        return TTSService.availableAppleVoices.first(where: { $0.identifier == id })?.name ?? "Custom"
    }

    private var serverVoices: [String] {
        ["Vivian", "Serena", "Ono_Anna", "Sohee", "Ryan", "Aiden", "Dylan", "Eric", "Uncle_Fu"]
    }
}

// MARK: - Voice Picker View

private struct VoicePickerView: View {
    @Binding var selectedIdentifier: String?
    let ttsService: TTSService
    @State private var isPreviewing = false

    private let previewText = "Hello! I'm your AI assistant. How can I help you today?"
    private let synthesizer = AVSpeechSynthesizer()

    /// Map language codes to friendly region names
    private static let regionNames: [String: String] = [
        "en-US": "English (US)",
        "en-GB": "English (UK)",
        "en-AU": "English (Australia)",
        "en-IE": "English (Ireland)",
        "en-IN": "English (India)",
        "en-ZA": "English (South Africa)",
        "en-SG": "English (Singapore)",
        "en-NZ": "English (New Zealand)",
        "en-PH": "English (Philippines)",
        "en-ID": "English (Indonesia)",
    ]

    /// Group voices by language code, sorted with en-US first
    private var groupedVoices: [(region: String, voices: [(identifier: String, name: String, language: String, quality: String)])] {
        let allVoices = TTSService.availableAppleVoices
        let grouped = Dictionary(grouping: allVoices) { $0.language }

        return grouped
            .sorted { lhs, rhs in
                // en-US first, then alphabetical by region name
                if lhs.key == "en-US" { return true }
                if rhs.key == "en-US" { return false }
                return (Self.regionNames[lhs.key] ?? lhs.key) < (Self.regionNames[rhs.key] ?? rhs.key)
            }
            .map { (region: $0.key, voices: $0.value) }
    }

    var body: some View {
        List {
            // Auto option
            Section {
                Button {
                    selectedIdentifier = nil
                    previewVoice(identifier: nil)
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Auto (Best Available)")
                                .foregroundStyle(AppColors.textPrimary)
                            Text("Automatically picks the highest quality voice")
                                .font(.caption)
                                .foregroundStyle(AppColors.textTertiary)
                        }
                        Spacer()
                        if selectedIdentifier == nil {
                            Image(systemName: "checkmark")
                                .foregroundStyle(AppColors.appPrimary)
                                .fontWeight(.semibold)
                        }
                    }
                }
            }

            // Voices grouped by region
            ForEach(groupedVoices, id: \.region) { group in
                Section {
                    ForEach(group.voices, id: \.identifier) { voice in
                        voiceRow(voice)
                    }
                } header: {
                    Text(Self.regionNames[group.region] ?? group.region)
                }
            }
        }
        .navigationTitle("Choose Voice")
        .navigationBarTitleDisplayMode(.inline)
        .onDisappear {
            synthesizer.stopSpeaking(at: .immediate)
        }
    }

    private func voiceRow(_ voice: (identifier: String, name: String, language: String, quality: String)) -> some View {
        Button {
            selectedIdentifier = voice.identifier
            previewVoice(identifier: voice.identifier)
        } label: {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(voice.name)
                        .foregroundStyle(AppColors.textPrimary)

                    // Quality badge
                    Text(voice.quality)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(qualityColor(voice.quality))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(qualityColor(voice.quality).opacity(0.12))
                        .clipShape(Capsule())
                }

                Spacer()

                // Preview button
                Button {
                    previewVoice(identifier: voice.identifier)
                } label: {
                    Image(systemName: "play.circle.fill")
                        .font(.title3)
                        .foregroundStyle(AppColors.appPrimary.opacity(0.8))
                }
                .buttonStyle(.plain)

                if selectedIdentifier == voice.identifier {
                    Image(systemName: "checkmark")
                        .foregroundStyle(AppColors.appPrimary)
                        .fontWeight(.semibold)
                }
            }
            .contentShape(Rectangle())
        }
    }

    private func qualityColor(_ quality: String) -> Color {
        switch quality {
        case "Premium": return .green
        case "Enhanced": return .orange
        default: return .secondary
        }
    }

    private func previewVoice(identifier: String?) {
        synthesizer.stopSpeaking(at: .immediate)

        let utterance = AVSpeechUtterance(string: previewText)
        utterance.rate = ttsService.speechRate
        utterance.pitchMultiplier = ttsService.pitchMultiplier
        utterance.preUtteranceDelay = 0.1

        if let identifier {
            utterance.voice = AVSpeechSynthesisVoice(identifier: identifier)
        } else {
            utterance.voice = TTSService.findBestVoice(language: "en-US")
        }

        synthesizer.speak(utterance)
    }
}
