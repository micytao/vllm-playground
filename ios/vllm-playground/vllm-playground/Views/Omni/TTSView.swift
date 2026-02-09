import SwiftUI
import AVFoundation

struct TTSView: View {
    @Bindable var viewModel: OmniViewModel
    @State private var audioPlayer: AVAudioPlayer?
    @State private var isPlaying = false
    @State private var showTemplates = false

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

                // Player
                if viewModel.generatedAudioData != nil {
                    HStack(spacing: 20) {
                        Button { togglePlayback() } label: {
                            Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                                .font(.largeTitle)
                                .imageScale(.large)
                                .foregroundStyle(AppColors.appPrimary)
                        }

                        Button { stopPlayback() } label: {
                            Image(systemName: "stop.circle.fill")
                                .font(.largeTitle)
                                .imageScale(.large)
                                .foregroundStyle(AppColors.textTertiary)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(AppColors.cardBg)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                }
            }
            .padding(16)
        }
        .onChange(of: viewModel.generatedAudioData) {
            preparePlayer()
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

    // MARK: - Playback

    private func preparePlayer() {
        guard let data = viewModel.generatedAudioData else { return }
        do {
            audioPlayer = try AVAudioPlayer(data: data)
            audioPlayer?.prepareToPlay()
        } catch {
            viewModel.error = "Failed to prepare audio: \(error.localizedDescription)"
        }
    }

    private func togglePlayback() {
        guard let player = audioPlayer else {
            preparePlayer()
            audioPlayer?.play()
            isPlaying = true
            return
        }
        if player.isPlaying { player.pause(); isPlaying = false }
        else { player.play(); isPlaying = true }
    }

    private func stopPlayback() {
        audioPlayer?.stop()
        audioPlayer?.currentTime = 0
        isPlaying = false
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
}
