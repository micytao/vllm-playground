import SwiftUI

struct ChatInputBar: View {
    @Binding var text: String
    let isStreaming: Bool
    let onSend: () -> Void
    let onImagePicker: () -> Void
    let onCameraPicker: () -> Void
    let onStop: () -> Void
    @State private var showAttachMenu = false

    @FocusState private var isFocused: Bool
    @State private var speechService = SpeechService()

    private var textIsEmpty: Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
            // Live transcription preview
            if speechService.isRecording, !speechService.transcript.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "waveform")
                        .font(.caption)
                        .foregroundStyle(AppColors.appRed)
                    Text(speechService.transcript)
                        .font(.footnote)
                        .foregroundStyle(AppColors.textSecondary)
                        .lineLimit(2)
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(AppColors.cardBg)
            }

            // Speech error
            if let error = speechService.error {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(AppColors.appRed)
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(AppColors.appRed)
                    Spacer()
                    Button {
                        speechService.error = nil
                    } label: {
                        Image(systemName: "xmark")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(AppColors.textTertiary)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 6)
                .background(AppColors.appRed.opacity(0.1))
            }

            // Thin top border
            Divider()
                .background(AppColors.border)

            HStack(alignment: .bottom, spacing: 10) {
                // Attach button
                Button {
                    showAttachMenu = true
                } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(.title2)
                        .foregroundStyle(AppColors.appPrimary)
                }
                .disabled(isStreaming || speechService.isRecording)
                .opacity((isStreaming || speechService.isRecording) ? 0.4 : 1)
                .padding(.bottom, 6)
                .confirmationDialog("Add Attachment", isPresented: $showAttachMenu, titleVisibility: .hidden) {
                    Button {
                        onImagePicker()
                    } label: {
                        Label("Photo Library", systemImage: "photo.on.rectangle")
                    }
                    Button {
                        onCameraPicker()
                    } label: {
                        Label("Camera", systemImage: "camera")
                    }
                    Button("Cancel", role: .cancel) {}
                }

                // Text input
                TextField("Message...", text: $text, axis: .vertical)
                    .font(.body)
                    .lineLimit(1...8)
                    .focused($isFocused)
                    .foregroundStyle(AppColors.textPrimary)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(AppColors.inputBg)
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                    .overlay(
                        RoundedRectangle(cornerRadius: 20)
                            .stroke(isFocused ? AppColors.appPrimary.opacity(0.5) : AppColors.border, lineWidth: 1)
                    )
                    .disabled(speechService.isRecording)

                // Action button
                actionButton
            }
            .padding(.horizontal, 14)
            .padding(.top, 10)
            .padding(.bottom, 8)
        }
        .background(AppColors.cardBg)
    }

    // MARK: - Action Button

    @ViewBuilder
    private var actionButton: some View {
        if isStreaming {
            // Stop streaming
            Button(action: onStop) {
                Image(systemName: "stop.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 34, height: 34)
                    .background(AppColors.textSecondary)
                    .clipShape(Circle())
            }
            .padding(.bottom, 4)
        } else if speechService.isRecording {
            // Stop recording — pulsing red mic
            Button(action: stopRecordingAndApply) {
                Image(systemName: "mic.fill")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 34, height: 34)
                    .background(AppColors.appRed)
                    .clipShape(Circle())
                    .overlay(
                        Circle()
                            .stroke(AppColors.appRed.opacity(0.4), lineWidth: 3)
                            .scaleEffect(1.4)
                    )
            }
            .padding(.bottom, 4)
        } else if textIsEmpty {
            // Mic button
            Button(action: { speechService.startRecording() }) {
                Image(systemName: "mic.fill")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(AppColors.textSecondary)
                    .frame(width: 34, height: 34)
                    .background(AppColors.inputBg)
                    .clipShape(Circle())
                    .overlay(
                        Circle()
                            .stroke(AppColors.border, lineWidth: 1)
                    )
            }
            .padding(.bottom, 4)
        } else {
            // Send button
            Button(action: onSend) {
                Image(systemName: "arrow.up")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 34, height: 34)
                    .background(AppColors.appPrimary)
                    .clipShape(Circle())
            }
            .padding(.bottom, 4)
        }
    }

    // MARK: - Actions

    private func stopRecordingAndApply() {
        let transcribedText = speechService.transcript
        speechService.stopRecording()

        if !transcribedText.isEmpty {
            if text.isEmpty {
                text = transcribedText
            } else {
                text += " " + transcribedText
            }
        }
    }
}

#Preview {
    VStack {
        Spacer()
        ChatInputBar(
            text: .constant("Hello"),
            isStreaming: false,
            onSend: {},
            onImagePicker: {},
            onCameraPicker: {},
            onStop: {}
        )
    }
    .background(AppColors.pageBg)
}
