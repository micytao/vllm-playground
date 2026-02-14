import SwiftUI
import SwiftData
import AVFoundation

struct TTSView: View {
    @Bindable var viewModel: OmniViewModel
    @Query(sort: \GeneratedTTS.createdAt, order: .reverse) private var ttsList: [GeneratedTTS]
    @State private var audioPlayer: AVAudioPlayer?
    @State private var isPlaying = false
    @State private var currentlyPlayingID: UUID?
    @State private var showTemplates = false

    init(viewModel: OmniViewModel) {
        self.viewModel = viewModel
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Text input
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("TEXT")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(AppColors.textSecondary)

                        Spacer()

                        Button {
                            showTemplates.toggle()
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "text.book.closed.fill")
                                    .font(.caption2)
                                Text("Presets")
                                    .font(.caption.weight(.medium))
                            }
                            .foregroundStyle(AppColors.appPrimary)
                        }
                    }

                    TextEditor(text: $viewModel.ttsText)
                        .font(.callout)
                        .foregroundStyle(AppColors.textPrimary)
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 100)
                        .padding(12)
                        .background(AppColors.inputBg)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }

                // Voice dropdown
                VStack(alignment: .leading, spacing: 8) {
                    Text("VOICE")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppColors.textSecondary)

                    Menu {
                        Picker("Voice", selection: $viewModel.ttsVoice) {
                            ForEach(viewModel.availableVoices, id: \.self) { voice in
                                Text(voiceDisplayName(voice)).tag(voice)
                            }
                        }
                    } label: {
                        HStack {
                            Text(voiceDisplayName(viewModel.ttsVoice))
                                .font(.callout.weight(.medium))
                                .foregroundStyle(AppColors.textPrimary)
                            Spacer()
                            Image(systemName: "chevron.up.chevron.down")
                                .font(.caption)
                                .foregroundStyle(AppColors.textTertiary)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(AppColors.inputBg)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(AppColors.border, lineWidth: 0.5)
                        )
                    }

                    Text("Select voice for speech synthesis")
                        .font(.caption2)
                        .foregroundStyle(AppColors.textTertiary)
                }

                // Speed
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("Speed")
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(AppColors.textPrimary)
                        Spacer()
                        Text(String(format: "%.2fx", viewModel.ttsSpeed))
                            .font(.footnote.monospacedDigit().weight(.semibold))
                            .foregroundStyle(AppColors.appPrimary)
                    }

                    Slider(value: $viewModel.ttsSpeed, in: 0.25...4.0, step: 0.25)
                        .tint(AppColors.appPrimary)

                    Text("Speech speed. 0.25x (very slow) to 4.0x (very fast).")
                        .font(.caption2)
                        .foregroundStyle(AppColors.textTertiary)
                }
                .padding(14)
                .background(AppColors.cardBg)
                .clipShape(RoundedRectangle(cornerRadius: 14))

                // Style Instructions
                VStack(alignment: .leading, spacing: 8) {
                    Text("STYLE INSTRUCTIONS")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppColors.textSecondary)

                    TextField("e.g., Speak with excitement", text: $viewModel.ttsInstructions)
                        .font(.callout)
                        .foregroundStyle(AppColors.textPrimary)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(AppColors.inputBg)
                        .clipShape(RoundedRectangle(cornerRadius: 12))

                    Text("Voice style or emotion instruction (e.g., 'cheerful', 'serious'). Leave empty for default.")
                        .font(.caption2)
                        .foregroundStyle(AppColors.textTertiary)
                }

                // Generate
                Button {
                    Task { await viewModel.generateSpeech() }
                } label: {
                    HStack {
                        if viewModel.isGeneratingTTS {
                            ProgressView().tint(.white).controlSize(.small)
                        }
                        Text(viewModel.isGeneratingTTS ? "Generating..." : "Generate Speech")
                    }
                    .font(.callout.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(
                        (viewModel.ttsText.isEmpty || viewModel.isGeneratingTTS) ? AppColors.textTertiary : AppColors.appPrimary
                    )
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(viewModel.ttsText.isEmpty || viewModel.isGeneratingTTS)

                // Generated speech gallery
                if ttsList.isEmpty {
                    emptyState
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        sectionLabel("Generated Speech")

                        ForEach(ttsList) { item in
                            ttsCard(item: item)
                        }
                    }
                }
            }
            .padding(16)
        }
        .sheet(isPresented: $showTemplates) {
            TTSTemplateSheet(viewModel: viewModel)
                .presentationDetents([.medium, .large])
        }
    }

    // MARK: - Voice Display Name

    private func voiceDisplayName(_ voice: String) -> String {
        let info: [String: String] = [
            "Vivian": "Vivian (Female, EN)",
            "Serena": "Serena (Female, EN)",
            "Ono_Anna": "Ono Anna (Female, JP)",
            "Sohee": "Sohee (Female, KR)",
            "Ryan": "Ryan (Male, EN)",
            "Aiden": "Aiden (Male, EN)",
            "Dylan": "Dylan (Male, EN)",
            "Eric": "Eric (Male, EN)",
            "Uncle_Fu": "Uncle Fu (Male, ZH)",
        ]
        return info[voice] ?? voice
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 14) {
            Spacer().frame(height: 20)
            ZStack {
                Circle()
                    .fill(AppColors.appPrimary.opacity(0.08))
                    .frame(width: 72, height: 72)
                Image(systemName: "speaker.wave.2")
                    .font(.title)
                    .foregroundStyle(AppColors.appPrimary.opacity(0.5))
            }
            Text("Generate your first speech")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(AppColors.textTertiary)
            Text("Enter text above or choose a preset")
                .font(.caption)
                .foregroundStyle(AppColors.textTertiary.opacity(0.7))
            Spacer().frame(height: 20)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - TTS Card

    private func ttsCard(item: GeneratedTTS) -> some View {
        let isCurrentlyPlaying = isPlaying && currentlyPlayingID == item.id
        let isDemo = item.demoText != nil

        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                ZStack {
                    Circle()
                        .fill(isCurrentlyPlaying ? AppColors.appPrimary.opacity(0.15) : AppColors.inputBg)
                        .frame(width: 36, height: 36)
                    Image(systemName: "speaker.wave.2")
                        .font(.callout.weight(.medium))
                        .foregroundStyle(isCurrentlyPlaying ? AppColors.appPrimary : AppColors.textTertiary)
                        .symbolEffect(.variableColor.iterative, isActive: isCurrentlyPlaying)
                }

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(item.text)
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(AppColors.textPrimary)
                            .lineLimit(2)

                        if isDemo {
                            Text("DEMO")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(AppColors.appWarning)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 1)
                                .background(AppColors.appWarning.opacity(0.12))
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                        }
                    }

                    HStack(spacing: 6) {
                        Text(item.voice)
                            .font(.caption2)
                            .foregroundStyle(AppColors.textTertiary)

                        Text("·")
                            .font(.caption2)
                            .foregroundStyle(AppColors.textTertiary)

                        Text(item.createdAt, style: .relative)
                            .font(.caption2)
                            .foregroundStyle(AppColors.textTertiary)
                        + Text(" ago")
                            .font(.caption2)
                            .foregroundStyle(AppColors.textTertiary)
                    }
                }

                Spacer()
            }

            HStack(spacing: 12) {
                Button { togglePlayback(for: item) } label: {
                    HStack(spacing: 6) {
                        Image(systemName: isCurrentlyPlaying ? "pause.fill" : "play.fill")
                            .font(.caption)
                        Text(isCurrentlyPlaying ? "Pause" : "Play")
                            .font(.caption.weight(.medium))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .background(AppColors.appPrimary)
                    .clipShape(Capsule())
                }

                if isCurrentlyPlaying {
                    Button { stopPlayback() } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "stop.fill")
                                .font(.caption2)
                            Text("Stop")
                                .font(.caption.weight(.medium))
                        }
                        .foregroundStyle(AppColors.textSecondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(AppColors.inputBg)
                        .clipShape(Capsule())
                    }
                }

                Spacer()

                Button {
                    if currentlyPlayingID == item.id {
                        stopPlayback()
                    }
                    withAnimation(.spring(response: 0.3)) {
                        viewModel.modelContext?.delete(item)
                        try? viewModel.modelContext?.save()
                    }
                } label: {
                    Image(systemName: "trash")
                        .font(.caption)
                        .foregroundStyle(AppColors.appRed.opacity(0.7))
                        .padding(6)
                        .background(AppColors.appRed.opacity(0.08))
                        .clipShape(Circle())
                }
            }
        }
        .padding(14)
        .background(AppColors.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .animation(.easeInOut(duration: 0.2), value: isCurrentlyPlaying)
    }

    // MARK: - Helpers

    private func sectionLabel(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(AppColors.textSecondary)
            .textCase(.uppercase)
    }

    // MARK: - Playback

    private func togglePlayback(for item: GeneratedTTS) {
        // Demo items use AVSpeechSynthesizer
        if let demoText = item.demoText {
            if currentlyPlayingID == item.id && viewModel.isDemoSpeaking {
                viewModel.stopDemoSpeech()
                isPlaying = false
            } else {
                stopPlayback()
                viewModel.speakWithSynthesizer(demoText)
                isPlaying = true
                currentlyPlayingID = item.id
            }
            return
        }

        // Real items use AVAudioPlayer
        if currentlyPlayingID == item.id, let player = audioPlayer {
            if player.isPlaying {
                player.pause()
                isPlaying = false
            } else {
                player.play()
                isPlaying = true
            }
        } else {
            stopPlayback()
            do {
                audioPlayer = try AVAudioPlayer(data: item.audioData)
                audioPlayer?.prepareToPlay()
                audioPlayer?.play()
                isPlaying = true
                currentlyPlayingID = item.id
            } catch {
                viewModel.error = "Failed to play audio: \(error.localizedDescription)"
            }
        }
    }

    private func stopPlayback() {
        viewModel.stopDemoSpeech()
        audioPlayer?.stop()
        audioPlayer?.currentTime = 0
        audioPlayer = nil
        isPlaying = false
        currentlyPlayingID = nil
    }
}

// MARK: - TTS Template Sheet

private struct TTSTemplateSheet: View {
    @Bindable var viewModel: OmniViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    ForEach(TTSPresetTemplates.allCategories, id: \.name) { category in
                        VStack(alignment: .leading, spacing: 10) {
                            Text(category.name.uppercased())
                                .font(.caption.weight(.bold))
                                .foregroundStyle(AppColors.textTertiary)
                                .padding(.horizontal, 4)

                            VStack(spacing: 8) {
                                ForEach(category.templates) { template in
                                    ttsTemplateRow(template)
                                }
                            }
                        }
                    }
                }
                .padding(16)
            }
            .background(AppColors.pageBg)
            .navigationTitle("Text Presets")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(AppColors.appPrimary)
                }
            }
        }
    }

    private func ttsTemplateRow(_ template: TTSTemplate) -> some View {
        Button {
            viewModel.ttsText = template.text
            dismiss()
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(AppColors.appPrimary.opacity(0.1))
                        .frame(width: 36, height: 36)
                    Image(systemName: template.icon)
                        .font(.footnote)
                        .foregroundStyle(AppColors.appPrimary)
                }

                VStack(alignment: .leading, spacing: 3) {
                    Text(template.name)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(AppColors.textPrimary)

                    Text(template.text)
                        .font(.caption)
                        .foregroundStyle(AppColors.textTertiary)
                        .lineLimit(2)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.caption2)
                    .foregroundStyle(AppColors.textTertiary)
            }
            .padding(12)
            .background(AppColors.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(AppColors.border.opacity(0.5), lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    TTSView(viewModel: OmniViewModel())
        .modelContainer(for: GeneratedTTS.self, inMemory: true)
}
