import SwiftUI
import SwiftData
import AVFoundation
import AVKit
import UIKit

// MARK: - Gallery Filter

enum GalleryFilter: String, CaseIterable {
    case all = "All"
    case images = "Images"
    case audio = "Audio"
    case video = "Video"
}

// Unified gallery item for all generated content
enum GalleryItem: Identifiable {
    case image(item: GeneratedImage)
    case tts(item: GeneratedTTS)
    case audio(item: GeneratedAudio)
    case video(item: GeneratedVideo)

    var id: String {
        switch self {
        case .image(let item): return "img-\(item.id.uuidString)"
        case .tts(let item): return "tts-\(item.id.uuidString)"
        case .audio(let item): return "aud-\(item.id.uuidString)"
        case .video(let item): return "vid-\(item.id.uuidString)"
        }
    }
}

struct OmniGalleryView: View {
    @Bindable var viewModel: OmniViewModel
    @Query(sort: \GeneratedImage.createdAt, order: .reverse) private var images: [GeneratedImage]
    @Query(sort: \GeneratedTTS.createdAt, order: .reverse) private var ttsList: [GeneratedTTS]
    @Query(sort: \GeneratedAudio.createdAt, order: .reverse) private var audioList: [GeneratedAudio]
    @Query(sort: \GeneratedVideo.createdAt, order: .reverse) private var videos: [GeneratedVideo]
    @State private var selectedImage: Data?
    @State private var selectedVideo: GeneratedVideo?
    @State private var showClearConfirmation = false
    @State private var activeFilter: GalleryFilter = .all

    init(viewModel: OmniViewModel) {
        self.viewModel = viewModel
    }

    private let columns = [
        GridItem(.flexible(), spacing: 8),
        GridItem(.flexible(), spacing: 8)
    ]

    private var allItems: [GalleryItem] {
        var items: [GalleryItem] = []
        for img in images { items.append(.image(item: img)) }
        for tts in ttsList { items.append(.tts(item: tts)) }
        for audio in audioList { items.append(.audio(item: audio)) }
        for video in videos { items.append(.video(item: video)) }
        // Sort all by createdAt descending
        items.sort { lhsDate(for: $0) > lhsDate(for: $1) }
        return items
    }

    private func lhsDate(for item: GalleryItem) -> Date {
        switch item {
        case .image(let i): return i.createdAt
        case .tts(let i): return i.createdAt
        case .audio(let i): return i.createdAt
        case .video(let i): return i.createdAt
        }
    }

    private var filteredItems: [GalleryItem] {
        switch activeFilter {
        case .all: return allItems
        case .images: return allItems.filter { if case .image = $0 { return true }; return false }
        case .audio: return allItems.filter {
            if case .audio = $0 { return true }
            if case .tts = $0 { return true }
            return false
        }
        case .video: return allItems.filter { if case .video = $0 { return true }; return false }
        }
    }

    private var totalCount: Int { allItems.count }

    private var isEmpty: Bool {
        images.isEmpty && ttsList.isEmpty && audioList.isEmpty && videos.isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header with count, filter, and clear all
            if !isEmpty {
                VStack(spacing: 10) {
                    HStack {
                        Text("\(totalCount) item\(totalCount == 1 ? "" : "s")")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(AppColors.textSecondary)
                        Spacer()
                        Button {
                            showClearConfirmation = true
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "trash")
                                    .font(.caption2)
                                Text("Clear All")
                                    .font(.caption.weight(.medium))
                            }
                            .foregroundStyle(AppColors.appRed)
                        }
                    }

                    // Filter chips
                    HStack(spacing: 6) {
                        ForEach(GalleryFilter.allCases, id: \.self) { filter in
                            Button {
                                withAnimation(.easeInOut(duration: 0.2)) { activeFilter = filter }
                            } label: {
                                Text(filter.rawValue)
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(activeFilter == filter ? .white : AppColors.textSecondary)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 6)
                                    .background(activeFilter == filter ? AppColors.appPrimary : AppColors.inputBg)
                                    .clipShape(Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                        Spacer()
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }

            if isEmpty {
                VStack(spacing: 12) {
                    Spacer()
                    Image(systemName: "square.grid.2x2")
                        .font(.largeTitle)
                        .foregroundStyle(AppColors.textTertiary)
                    Text("No content yet")
                        .font(.callout)
                        .foregroundStyle(AppColors.textSecondary)
                    Text("Generated images, audio, video, and more will appear here")
                        .font(.footnote)
                        .foregroundStyle(AppColors.textTertiary)
                        .multilineTextAlignment(.center)
                    Spacer()
                }
                .padding(.horizontal, 32)
            } else if filteredItems.isEmpty {
                VStack(spacing: 12) {
                    Spacer()
                    Image(systemName: "tray")
                        .font(.largeTitle)
                        .foregroundStyle(AppColors.textTertiary)
                    Text("No \(activeFilter.rawValue.lowercased()) content")
                        .font(.callout)
                        .foregroundStyle(AppColors.textSecondary)
                    Spacer()
                }
            } else {
                ScrollView {
                    LazyVGrid(columns: columns, spacing: 8) {
                        ForEach(filteredItems) { item in
                            switch item {
                            case .image(let imgItem):
                                imageCard(item: imgItem)
                            case .tts(let ttsItem):
                                ttsCard(ttsItem: ttsItem)
                            case .audio(let audioItem):
                                audioCard(audioItem: audioItem)
                            case .video(let videoItem):
                                videoCard(videoItem: videoItem)
                            }
                        }
                    }
                    .padding(16)
                }
            }
        }
        .sheet(item: $selectedImage) { imageData in
            ImageDetailView(imageData: imageData)
        }
        .fullScreenCover(item: $selectedVideo) { videoItem in
            VideoDetailView(videoItem: videoItem)
        }
        .confirmationDialog("Clear Gallery", isPresented: $showClearConfirmation, titleVisibility: .visible) {
            Button("Delete All Content", role: .destructive) {
                withAnimation { viewModel.clearAllGallery() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will remove all generated images, audio, and video. This action cannot be undone.")
        }
    }

    // MARK: - Image Card

    @ViewBuilder
    private func imageCard(item: GeneratedImage) -> some View {
        if let uiImage = UIImage(data: item.imageData) {
            Image(uiImage: uiImage)
                .resizable()
                .scaledToFit()
                .frame(minHeight: 120)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(
                    HStack(spacing: 3) {
                        Image(systemName: "photo")
                            .font(.system(size: 8, weight: .bold))
                        Text(item.isDemo ? "Image · DEMO" : "Image")
                            .font(.system(size: 9, weight: .semibold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(item.isDemo ? Color.orange.opacity(0.7) : .black.opacity(0.5))
                    .clipShape(Capsule())
                    .padding(6),
                    alignment: .topTrailing
                )
                .onTapGesture { selectedImage = item.imageData }
                .contextMenu {
                    Button {
                        UIImageWriteToSavedPhotosAlbum(uiImage, nil, nil, nil)
                    } label: {
                        Label("Save to Photos", systemImage: "square.and.arrow.down")
                    }
                    Button(role: .destructive) {
                        viewModel.modelContext?.delete(item)
                        try? viewModel.modelContext?.save()
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
        }
    }

    // MARK: - TTS Card

    private func ttsCard(ttsItem: GeneratedTTS) -> some View {
        TTSGalleryCard(ttsItem: ttsItem, viewModel: viewModel) {
            viewModel.modelContext?.delete(ttsItem)
            try? viewModel.modelContext?.save()
        }
    }

    // MARK: - Audio Card

    private func audioCard(audioItem: GeneratedAudio) -> some View {
        AudioGalleryCard(audioItem: audioItem, viewModel: viewModel) {
            viewModel.modelContext?.delete(audioItem)
            try? viewModel.modelContext?.save()
        }
    }

    // MARK: - Video Card

    private func videoCard(videoItem: GeneratedVideo) -> some View {
        VideoGalleryCard(videoItem: videoItem, onTap: {
            selectedVideo = videoItem
        }, onDelete: {
            viewModel.modelContext?.delete(videoItem)
            try? viewModel.modelContext?.save()
        })
    }
}

// MARK: - TTS Gallery Card

struct TTSGalleryCard: View {
    let ttsItem: GeneratedTTS
    let viewModel: OmniViewModel
    var onDelete: () -> Void

    @State private var isPlaying = false
    @State private var audioPlayer: AVAudioPlayer?

    private var isDemo: Bool { ttsItem.demoText != nil }

    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(
                        LinearGradient(
                            colors: [Color.green.opacity(0.15), Color.green.opacity(0.05)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(minHeight: 120)

                VStack(spacing: 10) {
                    Button {
                        togglePlayback()
                    } label: {
                        Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                            .font(.system(size: 40))
                            .foregroundStyle(.green)
                    }

                    Text(ttsItem.text)
                        .font(.caption2)
                        .foregroundStyle(AppColors.textSecondary)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 8)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                HStack(spacing: 3) {
                    Image(systemName: "speaker.wave.2")
                        .font(.system(size: 8, weight: .bold))
                    Text("TTS")
                        .font(.system(size: 9, weight: .semibold))
                    if isDemo {
                        Text("· DEMO")
                            .font(.system(size: 9, weight: .bold))
                    }
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(isDemo ? AppColors.appWarning.opacity(0.9) : Color.green.opacity(0.8))
                .clipShape(Capsule())
                .padding(6),
                alignment: .topTrailing
            )
        }
        .contextMenu {
            Button(role: .destructive) {
                onDelete()
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
        .onDisappear {
            audioPlayer?.stop()
            if isPlaying { viewModel.stopDemoSpeech() }
        }
    }

    private func togglePlayback() {
        if isPlaying {
            if let demoText = ttsItem.demoText {
                viewModel.stopDemoSpeech()
                _ = demoText // suppress unused warning
            } else {
                audioPlayer?.stop()
            }
            isPlaying = false
        } else {
            if let demoText = ttsItem.demoText {
                viewModel.speakWithSynthesizer(demoText)
                isPlaying = true
            } else {
                do {
                    audioPlayer = try AVAudioPlayer(data: ttsItem.audioData)
                    audioPlayer?.play()
                    isPlaying = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + (audioPlayer?.duration ?? 0) + 0.1) {
                        isPlaying = false
                    }
                } catch {
                    isPlaying = false
                }
            }
        }
    }
}

// MARK: - Audio Gallery Card

struct AudioGalleryCard: View {
    let audioItem: GeneratedAudio
    let viewModel: OmniViewModel
    var onDelete: () -> Void

    @State private var isPlaying = false
    @State private var audioPlayer: AVAudioPlayer?

    private var isDemo: Bool { audioItem.demoText != nil }

    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(
                        LinearGradient(
                            colors: [AppColors.appPrimary.opacity(0.15), AppColors.appPrimary.opacity(0.05)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(minHeight: 120)

                VStack(spacing: 10) {
                    Button {
                        togglePlayback()
                    } label: {
                        Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                            .font(.system(size: 40))
                            .foregroundStyle(AppColors.appPrimary)
                    }

                    Text(audioItem.prompt)
                        .font(.caption2)
                        .foregroundStyle(AppColors.textSecondary)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 8)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                HStack(spacing: 3) {
                    Image(systemName: "waveform")
                        .font(.system(size: 8, weight: .bold))
                    Text("Audio")
                        .font(.system(size: 9, weight: .semibold))
                    if isDemo {
                        Text("· DEMO")
                            .font(.system(size: 9, weight: .bold))
                    }
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(isDemo ? AppColors.appWarning.opacity(0.9) : AppColors.appPrimary.opacity(0.8))
                .clipShape(Capsule())
                .padding(6),
                alignment: .topTrailing
            )
        }
        .contextMenu {
            Button(role: .destructive) {
                onDelete()
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
        .onDisappear {
            audioPlayer?.stop()
            if isPlaying { viewModel.stopDemoSpeech() }
        }
    }

    private func togglePlayback() {
        if isPlaying {
            if let demoText = audioItem.demoText {
                viewModel.stopDemoSpeech()
                _ = demoText
            } else {
                audioPlayer?.stop()
            }
            isPlaying = false
        } else {
            if let demoText = audioItem.demoText {
                viewModel.speakWithSynthesizer(demoText)
                isPlaying = true
            } else {
                do {
                    audioPlayer = try AVAudioPlayer(data: audioItem.audioData)
                    audioPlayer?.play()
                    isPlaying = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + (audioPlayer?.duration ?? 0) + 0.1) {
                        isPlaying = false
                    }
                } catch {
                    isPlaying = false
                }
            }
        }
    }
}

// MARK: - Video Gallery Card

struct VideoGalleryCard: View {
    let videoItem: GeneratedVideo
    var onTap: () -> Void
    var onDelete: () -> Void

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(
                    LinearGradient(
                        colors: [Color.purple.opacity(0.15), Color.blue.opacity(0.05)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(minHeight: 120)

            VStack(spacing: 10) {
                Image(systemName: "play.circle.fill")
                    .font(.system(size: 40))
                    .foregroundStyle(.purple.opacity(0.8))

                Text(videoItem.prompt)
                    .font(.caption2)
                    .foregroundStyle(AppColors.textSecondary)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 8)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            HStack(spacing: 3) {
                Image(systemName: "film")
                    .font(.system(size: 8, weight: .bold))
                Text("\(videoItem.duration)s")
                    .font(.system(size: 9, weight: .semibold))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(Color.purple.opacity(0.8))
            .clipShape(Capsule())
            .padding(6),
            alignment: .topTrailing
        )
        .onTapGesture { onTap() }
        .contextMenu {
            Button(role: .destructive) {
                onDelete()
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }
}

// MARK: - Data Identifiable

extension Data: @retroactive Identifiable {
    public var id: Int { hashValue }
}

// MARK: - Image Detail View

struct ImageDetailView: View {
    let imageData: Data
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                if let uiImage = UIImage(data: imageData) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFit()
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title2)
                            .foregroundStyle(.white.opacity(0.7))
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    if let uiImage = UIImage(data: imageData) {
                        Button {
                            UIImageWriteToSavedPhotosAlbum(uiImage, nil, nil, nil)
                        } label: {
                            Image(systemName: "square.and.arrow.down")
                                .foregroundStyle(.white.opacity(0.7))
                        }
                    }
                }
            }
            .toolbarBackground(.hidden, for: .navigationBar)
        }
    }
}

// MARK: - Video Detail View

struct VideoDetailView: View {
    let videoItem: GeneratedVideo
    @Environment(\.dismiss) private var dismiss
    @State private var player: AVPlayer?

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                if let player {
                    VideoPlayer(player: player)
                        .ignoresSafeArea()
                } else {
                    ProgressView()
                        .tint(.white)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title2)
                            .foregroundStyle(.white.opacity(0.7))
                    }
                }
            }
            .toolbarBackground(.hidden, for: .navigationBar)
            .onAppear { setupPlayer() }
            .onDisappear { player?.pause() }
        }
    }

    private func setupPlayer() {
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("gallery-\(videoItem.id).mp4")
        if !FileManager.default.fileExists(atPath: tempURL.path) {
            try? videoItem.videoData.write(to: tempURL)
        }
        let avPlayer = AVPlayer(url: tempURL)
        self.player = avPlayer
        avPlayer.play()
    }
}

#Preview {
    OmniGalleryView(viewModel: OmniViewModel())
        .modelContainer(for: [GeneratedImage.self, GeneratedTTS.self, GeneratedAudio.self, GeneratedVideo.self], inMemory: true)
}
