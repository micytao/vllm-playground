import SwiftUI
import SwiftData
import PhotosUI
import UIKit

// MARK: - Camera Picker (UIImagePickerController wrapper)

struct CameraPicker: UIViewControllerRepresentable {
    @Binding var imageData: Data?
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage,
               let data = image.jpegData(compressionQuality: 0.7) {
                parent.imageData = data
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}

struct ChatView: View {
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: ChatViewModel
    @State private var inputText = ""
    @State private var showSettings = false
    @State private var showImagePicker = false
    @State private var showCameraPicker = false
    @State private var cameraImageData: Data?
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var showErrorDetails = false

    init(conversation: Conversation, serverProfile: ServerProfile?) {
        _viewModel = State(initialValue: ChatViewModel(
            conversation: conversation,
            serverProfile: serverProfile
        ))
    }

    var body: some View {
        ZStack {
            AppColors.pageBg.ignoresSafeArea()

            VStack(spacing: 0) {
                // Messages
                messagesView

                // Pending tool calls
                if !viewModel.pendingToolCalls.isEmpty {
                    ToolCallsView(viewModel: viewModel)
                }

                // Error banner
                if let error = viewModel.error {
                    errorBanner(error)
                }

                // Image attachment preview
                if viewModel.attachedImageData != nil {
                    attachmentPreview
                }

                // Input bar
                ChatInputBar(
                    text: $inputText,
                    isStreaming: viewModel.isStreaming,
                    onSend: sendMessage,
                    onImagePicker: { showImagePicker = true },
                    onCameraPicker: { showCameraPicker = true },
                    onStop: { viewModel.stopStreaming() }
                )
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showSettings = true
                } label: {
                    Image(systemName: "slider.horizontal.3")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(AppColors.textSecondary)
                }
            }
        }
        .sheet(isPresented: $showSettings) {
            ChatSettingsSheet(viewModel: viewModel)
        }
        .photosPicker(isPresented: $showImagePicker, selection: $selectedPhotoItem, matching: .images)
        .fullScreenCover(isPresented: $showCameraPicker) {
            CameraPicker(imageData: $cameraImageData)
                .ignoresSafeArea()
        }
        .onChange(of: selectedPhotoItem) { _, newItem in
            loadImage(from: newItem)
        }
        .onChange(of: cameraImageData) { _, newData in
            if let data = newData {
                viewModel.attachImage(data)
                cameraImageData = nil
            }
        }
    }

    // MARK: - Messages View

    private var messagesView: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 2) {
                    ForEach(viewModel.conversation.sortedMessages) { message in
                        MessageBubble(message: message)
                            .id(message.id)
                            .padding(.horizontal, 12)
                    }

                    // Streaming
                    if viewModel.isStreaming {
                        MessageBubble(message: Message.streaming(viewModel.streamingText + "  ▌"))
                            .id("streaming")
                            .padding(.horizontal, 12)
                    }
                }
                .padding(.top, 8)
                .padding(.bottom, 16)
            }
            .onChange(of: viewModel.conversation.messages.count) {
                scrollToBottom(proxy)
            }
            .onChange(of: viewModel.streamingText) {
                scrollToBottom(proxy)
            }
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.2)) {
            if viewModel.isStreaming {
                proxy.scrollTo("streaming", anchor: .bottom)
            } else if let lastId = viewModel.conversation.sortedMessages.last?.id {
                proxy.scrollTo(lastId, anchor: .bottom)
            }
        }
    }

    // MARK: - Error Banner

    private func errorBanner(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(AppColors.appRed)
                    .font(.subheadline)
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(AppColors.appRed)
                    .lineLimit(showErrorDetails ? nil : 2)
                Spacer()
                Button {
                    showErrorDetails = false
                    viewModel.error = nil
                } label: {
                    Image(systemName: "xmark")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(AppColors.textTertiary)
                }
            }

            // Show Details / Hide toggle
            if message.count > 60 {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        showErrorDetails.toggle()
                    }
                } label: {
                    Text(showErrorDetails ? "Hide Details" : "Show Details")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(AppColors.appRed.opacity(0.8))
                }
                .padding(.top, 6)
            }
        }
        .padding(12)
        .background(AppColors.appRed.opacity(0.1))
    }

    // MARK: - Attachment Preview

    private var attachmentPreview: some View {
        HStack(spacing: 10) {
            if let data = viewModel.attachedImageData,
               let uiImage = UIImage(data: data) {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 44, height: 44)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            Text("Image attached")
                .font(.footnote)
                .foregroundStyle(AppColors.textSecondary)
            Spacer()
            Button {
                viewModel.removeAttachment()
                selectedPhotoItem = nil
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(AppColors.textTertiary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(AppColors.cardBg)
    }

    // MARK: - Actions

    private func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        inputText = ""
        viewModel.sendMessage(text, context: modelContext)
    }

    private func loadImage(from item: PhotosPickerItem?) {
        guard let item else { return }
        Task {
            if let data = try? await item.loadTransferable(type: Data.self) {
                if let uiImage = UIImage(data: data),
                   let compressed = uiImage.jpegData(compressionQuality: 0.7) {
                    await MainActor.run {
                        viewModel.attachImage(compressed)
                    }
                } else {
                    await MainActor.run {
                        viewModel.attachImage(data)
                    }
                }
            }
        }
    }
}

#Preview {
    NavigationStack {
        ChatView(
            conversation: Conversation(title: "Preview Chat"),
            serverProfile: ServerProfile(name: "Test", baseURL: "http://localhost:8000")
        )
    }
    .modelContainer(for: [Conversation.self, Message.self], inMemory: true)
}
