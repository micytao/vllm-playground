import SwiftUI
import PhotosUI
import UIKit

struct ImageGenerationView: View {
    @Bindable var viewModel: OmniViewModel
    @State private var showTemplates = false
    @State private var showNegativePrompt = false
    @State private var showAdvanced = false
    @State private var showSourceImage = false
    @State private var photoPickerItem: PhotosPickerItem?

    private var isImageToImage: Bool { viewModel.imageInputData != nil }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Source Image (Image-to-Image)
                VStack(alignment: .leading, spacing: 8) {
                    Button {
                        withAnimation(.default) {
                            showSourceImage.toggle()
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: showSourceImage ? "photo.fill" : "photo")
                                .font(.caption)
                            Text("Source Image")
                                .font(.caption.weight(.medium))
                            if isImageToImage {
                                Text("Active")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(AppColors.appPrimary)
                                    .clipShape(Capsule())
                            }
                            Spacer()
                            Image(systemName: showSourceImage ? "chevron.up" : "chevron.down")
                                .font(.caption2.weight(.semibold))
                        }
                        .foregroundStyle(AppColors.textSecondary)
                    }
                    .buttonStyle(.plain)

                    if showSourceImage {
                        if let inputData = viewModel.imageInputData,
                           let uiImage = UIImage(data: inputData) {
                            // Preview
                            VStack(spacing: 8) {
                                HStack(spacing: 6) {
                                    Image(systemName: "pencil.and.outline")
                                        .font(.caption2)
                                        .foregroundStyle(AppColors.appPrimary)
                                    Text("Image-to-Image Mode")
                                        .font(.caption.weight(.medium))
                                        .foregroundStyle(AppColors.appPrimary)
                                    Spacer()
                                    Button {
                                        withAnimation(.default) { viewModel.imageInputData = nil }
                                    } label: {
                                        HStack(spacing: 3) {
                                            Image(systemName: "xmark")
                                                .font(.system(size: 9, weight: .bold))
                                            Text("Clear")
                                                .font(.caption.weight(.medium))
                                        }
                                        .foregroundStyle(AppColors.appRed)
                                    }
                                }

                                Image(uiImage: uiImage)
                                    .resizable()
                                    .scaledToFit()
                                    .frame(maxHeight: 180)
                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                            }
                            .padding(12)
                            .background(AppColors.appPrimary.opacity(0.06))
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        } else {
                            // Upload area
                            VStack(spacing: 10) {
                                Text("Upload an image to edit with your prompt")
                                    .font(.caption)
                                    .foregroundStyle(AppColors.textTertiary)
                                    .multilineTextAlignment(.center)

                                PhotosPicker(selection: $photoPickerItem, matching: .images) {
                                    HStack(spacing: 6) {
                                        Image(systemName: "photo.on.rectangle")
                                            .font(.callout)
                                        Text("Choose Image")
                                            .font(.callout.weight(.medium))
                                    }
                                    .foregroundStyle(AppColors.appPrimary)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 10)
                                    .background(AppColors.appPrimary.opacity(0.1))
                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .padding(16)
                            .background(AppColors.inputBg)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [6]))
                                    .foregroundStyle(AppColors.border)
                            )
                        }
                    }
                }
                .onChange(of: photoPickerItem) {
                    Task {
                        if let data = try? await photoPickerItem?.loadTransferable(type: Data.self) {
                            viewModel.imageInputData = data
                        }
                        photoPickerItem = nil
                    }
                }

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

                    TextEditor(text: $viewModel.imagePrompt)
                        .font(.callout)
                        .foregroundStyle(AppColors.textPrimary)
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 70)
                        .padding(12)
                        .background(AppColors.inputBg)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }

                // Negative prompt toggle + field
                VStack(alignment: .leading, spacing: 8) {
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
                        TextEditor(text: $viewModel.imageNegativePrompt)
                            .font(.callout)
                            .foregroundStyle(AppColors.textPrimary)
                            .scrollContentBackground(.hidden)
                            .frame(minHeight: 50)
                            .padding(12)
                            .background(AppColors.inputBg)
                            .clipShape(RoundedRectangle(cornerRadius: 12))

                        Text("Describe what you don't want in the image")
                            .font(.caption2)
                            .foregroundStyle(AppColors.textTertiary)
                    }
                }

                // Size dropdown
                VStack(alignment: .leading, spacing: 8) {
                    Text("SIZE")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppColors.textSecondary)

                    Menu {
                        Picker("Size", selection: $viewModel.imageSize) {
                            ForEach(viewModel.availableSizes, id: \.self) { size in
                                Text(size).tag(size)
                            }
                        }
                    } label: {
                        HStack {
                            Text(viewModel.imageSize)
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
                            // Inference Steps
                            parameterSlider(
                                label: "Inference Steps",
                                value: $viewModel.imageInferenceSteps,
                                range: 1...100,
                                step: 1,
                                displayValue: "\(Int(viewModel.imageInferenceSteps))",
                                info: "Number of denoising steps. More steps = higher quality but slower."
                            )

                            // Guidance Scale
                            parameterSlider(
                                label: "Guidance Scale",
                                value: $viewModel.imageGuidanceScale,
                                range: 0...20,
                                step: 0.5,
                                displayValue: String(format: "%.1f", viewModel.imageGuidanceScale),
                                info: "How closely to follow the prompt. Higher values = more literal interpretation."
                            )

                            // Seed
                            parameterTextField(
                                label: "Seed",
                                text: $viewModel.imageSeed,
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
                    Task { await viewModel.generateImage() }
                } label: {
                    HStack {
                        if viewModel.isGeneratingImage {
                            ProgressView().tint(.white).controlSize(.small)
                        }
                        Text(viewModel.isGeneratingImage ? "Generating..." : (isImageToImage ? "Edit Image" : "Generate"))
                    }
                    .font(.callout.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(
                        (viewModel.imagePrompt.isEmpty || viewModel.isGeneratingImage) ? AppColors.textTertiary : AppColors.appPrimary
                    )
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(viewModel.imagePrompt.isEmpty || viewModel.isGeneratingImage)

                // Result
                if let latestImageData = viewModel.generatedImages.first,
                   let uiImage = UIImage(data: latestImageData) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFit()
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                        .contextMenu {
                            Button {
                                UIImageWriteToSavedPhotosAlbum(uiImage, nil, nil, nil)
                            } label: {
                                Label("Save to Photos", systemImage: "square.and.arrow.down")
                            }
                        }
                }
            }
            .padding(16)
        }
        .sheet(isPresented: $showTemplates) {
            ImageTemplateSheet(viewModel: viewModel, showNegativePrompt: $showNegativePrompt)
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

// MARK: - Image Template Sheet

private struct ImageTemplateSheet: View {
    @Bindable var viewModel: OmniViewModel
    @Binding var showNegativePrompt: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    ForEach(ImagePromptTemplates.allCategories, id: \.name) { category in
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
            .navigationTitle("Prompt Templates")
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
            viewModel.imagePrompt = template.prompt
            viewModel.imageNegativePrompt = template.negativePrompt
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
    ImageGenerationView(viewModel: OmniViewModel())
}
