import SwiftUI
import SwiftData
import AVFoundation

struct AudioGenerationView: View {
    @Bindable var viewModel: OmniViewModel
    @Query(sort: \GeneratedAudio.createdAt, order: .reverse) private var audioList: [GeneratedAudio]
    @State private var audioPlayer: AVAudioPlayer?
    @State private var isPlaying = false
    @State private var currentlyPlayingID: UUID?
    @State private var showTemplates = false
    @State private var showNegativePrompt = false
    @State private var showAdvanced = false

    init(viewModel: OmniViewModel) {
        self.viewModel = viewModel
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                // Prompt
                settingCard {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            sectionLabel("Prompt")

                            Spacer()

                            Button {
                                showTemplates.toggle()
                            } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: "text.book.closed.fill")
                                        .font(.caption2)
                                    Text("Templates")
                                        .font(.caption.weight(.medium))
                                }
                                .foregroundStyle(AppColors.appPrimary)
                            }
                        }

                        TextEditor(text: $viewModel.audioPrompt)
                            .font(.callout)
                            .foregroundStyle(AppColors.textPrimary)
                            .scrollContentBackground(.hidden)
                            .frame(minHeight: 70)
                            .padding(12)
                            .background(AppColors.inputBg)
                            .clipShape(RoundedRectangle(cornerRadius: 12))

                        Text("Describe the audio you want to generate")
                            .font(.caption)
                            .foregroundStyle(AppColors.textTertiary)

                        // Negative prompt toggle + field
                        Button {
                            withAnimation(.default) {
                                showNegativePrompt.toggle()
                            }
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: showNegativePrompt ? "minus.circle.fill" : "plus.circle.fill")
                                    .font(.caption)
                                Text("Negative Prompt")
                                    .font(.caption.weight(.medium))
                                Spacer()
                            }
                            .foregroundStyle(AppColors.textSecondary)
                        }
                        .buttonStyle(.plain)

                        if showNegativePrompt {
                            TextEditor(text: $viewModel.audioNegativePrompt)
                                .font(.callout)
                                .foregroundStyle(AppColors.textPrimary)
                                .scrollContentBackground(.hidden)
                                .frame(minHeight: 50)
                                .padding(12)
                                .background(AppColors.inputBg)
                                .clipShape(RoundedRectangle(cornerRadius: 12))

                            Text("Describe what you don't want in the audio")
                                .font(.caption2)
                                .foregroundStyle(AppColors.textTertiary)
                        }
                    }
                }

                // Advanced parameters
                VStack(alignment: .leading, spacing: 8) {
                    Button {
                        withAnimation(.default) {
                            showAdvanced.toggle()
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "slider.horizontal.3")
                                .font(.caption)
                            Text("Advanced Settings")
                                .font(.caption.weight(.medium))
                            Spacer()
                            Image(systemName: showAdvanced ? "chevron.up" : "chevron.down")
                                .font(.caption2.weight(.semibold))
                        }
                        .foregroundStyle(AppColors.textSecondary)
                    }
                    .buttonStyle(.plain)

                    if showAdvanced {
                        VStack(spacing: 14) {
                            // Duration
                            parameterSlider(
                                label: "Duration",
                                value: $viewModel.audioDuration,
                                range: 1...47,
                                step: 1,
                                displayValue: "\(Int(viewModel.audioDuration))s",
                                info: "Audio length in seconds. Shorter clips use less GPU memory (1-47s)."
                            )

                            // Inference Steps
                            parameterSlider(
                                label: "Inference Steps",
                                value: $viewModel.audioInferenceSteps,
                                range: 10...200,
                                step: 10,
                                displayValue: "\(Int(viewModel.audioInferenceSteps))",
                                info: "Quality vs speed tradeoff. 20-100 recommended for best results."
                            )

                            // Guidance Scale
                            parameterSlider(
                                label: "Guidance Scale",
                                value: $viewModel.audioGuidanceScale,
                                range: 1...15,
                                step: 0.5,
                                displayValue: String(format: "%.1f", viewModel.audioGuidanceScale),
                                info: "How closely to follow the prompt. 7.0 is recommended."
                            )

                            // Seed
                            parameterTextField(
                                label: "Seed",
                                text: $viewModel.audioSeed,
                                placeholder: "Random",
                                info: "Set a seed for reproducible results. Leave empty for random."
                            )
                        }
                        .padding(14)
                        .background(AppColors.cardBg)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                    }
                }

                // Generate button
                Button {
                    Task { await viewModel.generateAudio() }
                } label: {
                    HStack(spacing: 8) {
                        if viewModel.isGeneratingAudio {
                            ProgressView().tint(.white).controlSize(.small)
                        } else {
                            Image(systemName: "waveform")
                        }
                        Text(viewModel.isGeneratingAudio ? "Generating..." : "Generate Audio")
                    }
                    .font(.callout.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(
                        (viewModel.audioPrompt.isEmpty || viewModel.isGeneratingAudio)
                            ? AppColors.textTertiary
                            : AppColors.appPrimary
                    )
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(viewModel.audioPrompt.isEmpty || viewModel.isGeneratingAudio)

                // Generated audio list or empty state
                if audioList.isEmpty {
                    emptyState
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        sectionLabel("Generated Audio")

                        ForEach(audioList) { item in
                            audioCard(item: item)
                        }
                    }
                }
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .sheet(isPresented: $showTemplates) {
            AudioTemplateSheet(viewModel: viewModel, showNegativePrompt: $showNegativePrompt)
                .presentationDetents([.medium, .large])
        }
    }

    // MARK: - Reusable Parameter Controls

    private func parameterSlider(
        label: String,
        value: Binding<Double>,
        range: ClosedRange<Double>,
        step: Double,
        displayValue: String,
        info: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(label)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(AppColors.textPrimary)
                Spacer()
                Text(displayValue)
                    .font(.footnote.monospacedDigit().weight(.semibold))
                    .foregroundStyle(AppColors.appPrimary)
            }

            Slider(value: value, in: range, step: step)
                .tint(AppColors.appPrimary)

            Text(info)
                .font(.caption2)
                .foregroundStyle(AppColors.textTertiary)
        }
    }

    private func parameterTextField(
        label: String,
        text: Binding<String>,
        placeholder: String,
        info: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.footnote.weight(.medium))
                .foregroundStyle(AppColors.textPrimary)

            TextField(placeholder, text: text)
                .font(.callout)
                .keyboardType(.numberPad)
                .foregroundStyle(AppColors.textPrimary)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(AppColors.inputBg)
                .clipShape(RoundedRectangle(cornerRadius: 8))

            Text(info)
                .font(.caption2)
                .foregroundStyle(AppColors.textTertiary)
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 14) {
            Spacer().frame(height: 20)
            ZStack {
                Circle()
                    .fill(AppColors.appPrimary.opacity(0.08))
                    .frame(width: 72, height: 72)
                Image(systemName: "waveform")
                    .font(.title)
                    .foregroundStyle(AppColors.appPrimary.opacity(0.5))
            }
            Text("Generate your first audio clip")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(AppColors.textTertiary)
            Text("Enter a prompt above or choose a template")
                .font(.caption)
                .foregroundStyle(AppColors.textTertiary.opacity(0.7))
            Spacer().frame(height: 20)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Audio Card

    private func audioCard(item: GeneratedAudio) -> some View {
        let isCurrentlyPlaying = isPlaying && currentlyPlayingID == item.id

        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                ZStack {
                    Circle()
                        .fill(isCurrentlyPlaying ? AppColors.appPrimary.opacity(0.15) : AppColors.inputBg)
                        .frame(width: 36, height: 36)
                    Image(systemName: "waveform")
                        .font(.callout.weight(.medium))
                        .foregroundStyle(isCurrentlyPlaying ? AppColors.appPrimary : AppColors.textTertiary)
                        .symbolEffect(.variableColor.iterative, isActive: isCurrentlyPlaying)
                }

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(item.prompt)
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(AppColors.textPrimary)
                            .lineLimit(2)

                        if item.demoText != nil {
                            Text("DEMO")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(AppColors.appWarning)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 1)
                                .background(AppColors.appWarning.opacity(0.12))
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                        }
                    }

                    Text(item.createdAt, style: .relative)
                        .font(.caption2)
                        .foregroundStyle(AppColors.textTertiary)
                    + Text(" ago")
                        .font(.caption2)
                        .foregroundStyle(AppColors.textTertiary)
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

    private func settingCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .padding(16)
            .background(AppColors.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    // MARK: - Playback

    private func togglePlayback(for item: GeneratedAudio) {
        // Demo items use AVSpeechSynthesizer for playback
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

// MARK: - Audio Template Sheet

private struct AudioTemplateSheet: View {
    @Bindable var viewModel: OmniViewModel
    @Binding var showNegativePrompt: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    ForEach(AudioPromptTemplates.allCategories, id: \.name) { category in
                        VStack(alignment: .leading, spacing: 10) {
                            Text(category.name.uppercased())
                                .font(.caption.weight(.bold))
                                .foregroundStyle(AppColors.textTertiary)
                                .padding(.horizontal, 4)

                            LazyVGrid(columns: [
                                GridItem(.flexible(), spacing: 10),
                                GridItem(.flexible(), spacing: 10),
                                GridItem(.flexible(), spacing: 10),
                            ], spacing: 10) {
                                ForEach(category.templates) { template in
                                    templateCard(template)
                                }
                            }
                        }
                    }
                }
                .padding(16)
            }
            .background(AppColors.pageBg)
            .navigationTitle("Audio Templates")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(AppColors.appPrimary)
                }
            }
        }
    }

    private func templateCard(_ template: PromptTemplate) -> some View {
        Button {
            viewModel.audioPrompt = template.prompt
            viewModel.audioNegativePrompt = template.negativePrompt
            if !template.negativePrompt.isEmpty {
                showNegativePrompt = true
            }
            dismiss()
        } label: {
            VStack(spacing: 8) {
                ZStack {
                    Circle()
                        .fill(AppColors.appPrimary.opacity(0.1))
                        .frame(width: 40, height: 40)
                    Image(systemName: template.icon)
                        .font(.callout)
                        .foregroundStyle(AppColors.appPrimary)
                }

                Text(template.name)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(AppColors.textPrimary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .padding(.horizontal, 8)
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
    AudioGenerationView(viewModel: OmniViewModel())
        .modelContainer(for: GeneratedAudio.self, inMemory: true)
}
