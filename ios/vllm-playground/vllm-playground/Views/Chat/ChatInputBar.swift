import SwiftUI

struct ChatInputBar: View {
    @Binding var text: String
    let isStreaming: Bool
    let onSend: () -> Void
    let onImagePicker: () -> Void
    let onCameraPicker: () -> Void
    let onStop: () -> Void
    let onVoiceMode: () -> Void
    @State private var showAttachMenu = false

    @FocusState private var isFocused: Bool

    private var textIsEmpty: Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
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
                .disabled(isStreaming)
                .opacity(isStreaming ? 0.4 : 1)
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
                    .toolbar {
                        ToolbarItemGroup(placement: .keyboard) {
                            Spacer()
                            Button {
                                isFocused = false
                            } label: {
                                Image(systemName: "chevron.down")
                                    .font(.body.weight(.semibold))
                                    .foregroundStyle(AppColors.textSecondary)
                            }
                        }
                    }

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
        } else if textIsEmpty {
            // Voice mode button
            Button(action: onVoiceMode) {
                Image(systemName: "waveform.circle.fill")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(AppColors.appPrimary)
                    .frame(width: 34, height: 34)
                    .background(AppColors.appPrimary.opacity(0.12))
                    .clipShape(Circle())
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
            onStop: {},
            onVoiceMode: {}
        )
    }
    .background(AppColors.pageBg)
}
