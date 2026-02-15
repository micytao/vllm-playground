import SwiftUI
import SwiftData
import AVKit

struct VideoGenerationView: View {
    @Bindable var viewModel: OmniViewModel
    @Query(sort: \GeneratedVideo.createdAt, order: .reverse) private var videos: [GeneratedVideo]
    @State private var showTemplates = false
    @State private var showNegativePrompt = false
    @State private var showAdvanced = false

    init(viewModel: OmniViewModel) {
        self.viewModel = viewModel
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Prompt
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("PROMPT")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(AppColors.textSecondary)

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

                    TextEditor(text: $viewModel.videoPrompt)
                        .font(.callout)
                        .foregroundStyle(AppColors.textPrimary)
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 70)
                        .padding(12)
                        .background(AppColors.inputBg)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }

                // Negative prompt
                VStack(alignment: .leading, spacing: 8) {
                    Button {
                        withAnimation(.default) { showNegativePrompt.toggle() }
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
                        TextEditor(text: $viewModel.videoNegativePrompt)
                            .font(.callout)
                            .foregroundStyle(AppColors.textPrimary)
                            .scrollContentBackground(.hidden)
                            .frame(minHeight: 50)
                            .padding(12)
                            .background(AppColors.inputBg)
                            .clipShape(RoundedRectangle(cornerRadius: 12))

                        Text("Describe what you don't want in the video")
                            .font(.caption2)
                            .foregroundStyle(AppColors.textTertiary)
                    }
                }

                // Resolution
                VStack(alignment: .leading, spacing: 8) {
                    Text("RESOLUTION")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppColors.textSecondary)

                    Menu {
                        Picker("Resolution", selection: $viewModel.videoResolution) {
                            ForEach(viewModel.availableResolutions, id: \.self) { res in
                                Text(res).tag(res)
                            }
                        }
                    } label: {
                        HStack {
                            Text(viewModel.videoResolution)
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

                    Text("Lower resolution uses less GPU memory. L4 (24GB): use 480x640")
                        .font(.caption2)
                        .foregroundStyle(AppColors.textTertiary)
                }

                // Duration & FPS
                VStack(spacing: 14) {
                    parameterSlider(
                        label: "Duration",
                        value: $viewModel.videoDuration,
                        range: 1...16,
                        step: 1,
                        displayValue: "\(Int(viewModel.videoDuration))s",
                        info: "Video length in seconds. Longer = more GPU memory."
                    )

                    parameterSlider(
                        label: "FPS",
                        value: $viewModel.videoFPS,
                        range: 8...30,
                        step: 1,
                        displayValue: "\(Int(viewModel.videoFPS))",
                        info: "Frames per second. 16 FPS recommended for memory efficiency."
                    )
                }
                .padding(14)
                .background(AppColors.cardBg)
                .clipShape(RoundedRectangle(cornerRadius: 14))

                // Advanced parameters
                VStack(alignment: .leading, spacing: 8) {
                    Button {
                        withAnimation(.default) { showAdvanced.toggle() }
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
                            parameterSlider(
                                label: "Inference Steps",
                                value: $viewModel.videoInferenceSteps,
                                range: 1...100,
                                step: 1,
                                displayValue: "\(Int(viewModel.videoInferenceSteps))",
                                info: "Number of denoising steps. More steps = higher quality but slower."
                            )

                            parameterSlider(
                                label: "Guidance Scale",
                                value: $viewModel.videoGuidanceScale,
                                range: 0...20,
                                step: 0.5,
                                displayValue: String(format: "%.1f", viewModel.videoGuidanceScale),
                                info: "How closely to follow the prompt."
                            )

                            parameterTextField(
                                label: "Seed",
                                text: $viewModel.videoSeed,
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
                    Task { await viewModel.generateVideo() }
                } label: {
                    HStack {
                        if viewModel.isGeneratingVideo {
                            ProgressView().tint(.white).controlSize(.small)
                        }
                        Text(viewModel.isGeneratingVideo ? "Generating..." : "Generate Video")
                    }
                    .font(.callout.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(
                        (viewModel.videoPrompt.isEmpty || viewModel.isGeneratingVideo) ? AppColors.textTertiary : AppColors.appPrimary
                    )
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(viewModel.videoPrompt.isEmpty || viewModel.isGeneratingVideo)

                // Latest result preview
                if let latestVideo = videos.first {
                    VideoPreviewCard(videoItem: latestVideo)
                }
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .sheet(isPresented: $showTemplates) {
            VideoTemplateSheet(viewModel: viewModel, showNegativePrompt: $showNegativePrompt)
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
}

// MARK: - Video Preview Card

struct VideoPreviewCard: View {
    let videoItem: GeneratedVideo
    @State private var player: AVPlayer?

    var body: some View {
        VStack(spacing: 0) {
            if let player {
                VideoPlayer(player: player)
                    .frame(height: 240)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(AppColors.inputBg)
                        .frame(height: 240)
                    ProgressView()
                }
            }

            HStack {
                Text(videoItem.prompt)
                    .font(.caption)
                    .foregroundStyle(AppColors.textSecondary)
                    .lineLimit(2)
                Spacer()
                Text("\(videoItem.duration)s")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppColors.appPrimary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(AppColors.appPrimary.opacity(0.1))
                    .clipShape(Capsule())
            }
            .padding(.top, 8)
        }
        .onAppear { setupPlayer() }
    }

    private func setupPlayer() {
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("\(videoItem.id).mp4")
        if !FileManager.default.fileExists(atPath: tempURL.path) {
            try? videoItem.videoData.write(to: tempURL)
        }
        let avPlayer = AVPlayer(url: tempURL)
        avPlayer.isMuted = true
        self.player = avPlayer
    }
}

// MARK: - Video Template Sheet

private struct VideoTemplateSheet: View {
    @Bindable var viewModel: OmniViewModel
    @Binding var showNegativePrompt: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    ForEach(VideoPromptTemplates.allCategories, id: \.name) { category in
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
            .navigationTitle("Video Templates")
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
            viewModel.videoPrompt = template.prompt
            viewModel.videoNegativePrompt = template.negativePrompt
            if !template.negativePrompt.isEmpty { showNegativePrompt = true }
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
    VideoGenerationView(viewModel: OmniViewModel())
        .modelContainer(for: GeneratedVideo.self, inMemory: true)
}
