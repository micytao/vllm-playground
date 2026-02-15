import SwiftUI
import SafariServices

// MARK: - Model Hub Source

enum ModelHubSource: String, CaseIterable {
    case huggingFace = "HuggingFace"
    case modelScope = "ModelScope"
}

struct ModelHubView: View {
    @Environment(\.showSidebar) private var showSidebar
    @State private var viewModel = ModelHubViewModel()
    @State private var source: ModelHubSource = .huggingFace
    @State private var showModelScopeSafari = false
    @State private var showFilters = false

    var body: some View {
        NavigationStack {
            ZStack {
                AppColors.pageBg.ignoresSafeArea()

                VStack(spacing: 0) {
                    // Source toggle
                    HStack(spacing: 4) {
                        ForEach(ModelHubSource.allCases, id: \.self) { src in
                            Button {
                                withAnimation(.easeInOut(duration: 0.2)) { source = src }
                            } label: {
                                HStack(spacing: 4) {
                                    Text(src == .huggingFace ? "🤗" : "🔮")
                                        .font(.caption)
                                    Text(src.rawValue)
                                        .font(.subheadline.weight(.medium))
                                }
                                .foregroundStyle(source == src ? AppColors.textPrimary : AppColors.textSecondary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8)
                                .background(source == src ? AppColors.cardBg : Color.clear)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(4)
                    .background(AppColors.inputBg)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .padding(.horizontal, 16)
                    .padding(.top, 8)

                    if source == .huggingFace {
                        huggingFaceContent
                    } else {
                        modelScopeContent
                    }
                }
            }
            .navigationTitle("Model Hub")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showSidebar.wrappedValue.toggle()
                    } label: {
                        Image(systemName: "line.3.horizontal")
                            .font(.body.weight(.medium))
                            .foregroundStyle(AppColors.textSecondary)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        viewModel.showTokenSheet = true
                    } label: {
                        Image(systemName: viewModel.hfToken.isEmpty ? "key" : "key.fill")
                            .font(.body.weight(.medium))
                            .foregroundStyle(viewModel.hfToken.isEmpty ? AppColors.textSecondary : AppColors.appPrimary)
                    }
                }
            }
            .toolbarBackground(AppColors.pageBg, for: .navigationBar)
            .sheet(isPresented: $viewModel.showTokenSheet) {
                TokenSettingsSheet(viewModel: viewModel)
                    .presentationDetents([.medium])
            }
        }
    }

    // MARK: - HuggingFace Content

    @ViewBuilder
    private var huggingFaceContent: some View {
        VStack(spacing: 0) {
            // Search bar
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .font(.callout)
                    .foregroundStyle(AppColors.textTertiary)
                TextField("Search models...", text: $viewModel.searchQuery)
                    .font(.callout)
                    .foregroundStyle(AppColors.textPrimary)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .onSubmit { viewModel.searchModels() }
                if !viewModel.searchQuery.isEmpty {
                    Button {
                        viewModel.searchQuery = ""
                        viewModel.searchModels()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.callout)
                            .foregroundStyle(AppColors.textTertiary)
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(AppColors.inputBg)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal, 16)
            .padding(.top, 10)
            .onChange(of: viewModel.searchQuery) { viewModel.searchModels() }

            // Filter bar (collapsible)
            VStack(spacing: 0) {
                // Toggle + sort + active filter summary
                HStack(spacing: 6) {
                    Button {
                        withAnimation(.default) { showFilters.toggle() }
                    } label: {
                        HStack(spacing: 3) {
                            Image(systemName: "line.3.horizontal.decrease")
                                .font(.system(size: 10, weight: .semibold))
                            if viewModel.hasActiveFilters {
                                Text("\(activeFilterCount)")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundStyle(.white)
                                    .frame(width: 16, height: 16)
                                    .background(AppColors.appPrimary)
                                    .clipShape(Circle())
                            }
                            Image(systemName: showFilters ? "chevron.up" : "chevron.down")
                                .font(.system(size: 8, weight: .bold))
                        }
                        .foregroundStyle(showFilters ? AppColors.appPrimary : AppColors.textSecondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(AppColors.inputBg)
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .fixedSize()

                    // Active filter chips (shown when collapsed)
                    if !showFilters && viewModel.hasActiveFilters {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 4) {
                                if let t = viewModel.selectedTask {
                                    activeFilterTag(t.displayName) {
                                        viewModel.selectedTask = nil
                                        viewModel.searchModels()
                                    }
                                }
                                if let l = viewModel.selectedLibrary {
                                    activeFilterTag(l.displayName) {
                                        viewModel.selectedLibrary = nil
                                        viewModel.searchModels()
                                    }
                                }
                                if let a = viewModel.selectedApp {
                                    activeFilterTag(a.displayName) {
                                        viewModel.selectedApp = nil
                                        viewModel.searchModels()
                                    }
                                }
                            }
                        }
                    }

                    Spacer()

                    Menu {
                        Picker("Sort", selection: $viewModel.sortBy) {
                            ForEach(HFSort.allCases) { sort in
                                Text(sort.displayName).tag(sort)
                            }
                        }
                    } label: {
                        HStack(spacing: 3) {
                            Image(systemName: "arrow.up.arrow.down")
                                .font(.system(size: 10, weight: .semibold))
                            Text(viewModel.sortBy.displayName)
                                .font(.caption.weight(.medium))
                                .lineLimit(1)
                        }
                        .foregroundStyle(AppColors.appPrimary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(AppColors.appPrimary.opacity(0.1))
                        .clipShape(Capsule())
                        .fixedSize()
                    }
                    .onChange(of: viewModel.sortBy) { viewModel.searchModels() }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)

                // Expanded filter rows
                if showFilters {
                    VStack(alignment: .leading, spacing: 6) {
                        filterRow(title: "Tasks") {
                            ForEach(HFTask.allCases) { task in
                                FilterChip(
                                    label: task.displayName,
                                    icon: task.icon,
                                    isSelected: viewModel.selectedTask == task
                                ) {
                                    viewModel.selectedTask = viewModel.selectedTask == task ? nil : task
                                    viewModel.searchModels()
                                }
                            }
                        }

                        filterRow(title: "Libraries") {
                            ForEach(HFLibrary.allCases) { lib in
                                FilterChip(
                                    label: lib.displayName,
                                    icon: nil,
                                    isSelected: viewModel.selectedLibrary == lib
                                ) {
                                    viewModel.selectedLibrary = viewModel.selectedLibrary == lib ? nil : lib
                                    viewModel.searchModels()
                                }
                            }
                        }

                        filterRow(title: "Apps") {
                            ForEach(HFApp.allCases) { app in
                                FilterChip(
                                    label: app.displayName,
                                    icon: nil,
                                    isSelected: viewModel.selectedApp == app
                                ) {
                                    viewModel.selectedApp = viewModel.selectedApp == app ? nil : app
                                    viewModel.searchModels()
                                }
                            }
                        }

                        if viewModel.hasActiveFilters {
                            Button {
                                viewModel.clearFilters()
                            } label: {
                                HStack(spacing: 3) {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 9, weight: .bold))
                                    Text("Clear all filters")
                                        .font(.caption.weight(.medium))
                                }
                                .foregroundStyle(AppColors.appRed)
                            }
                            .padding(.horizontal, 16)
                        }
                    }
                    .padding(.top, 6)
                }
            }

            Divider().background(AppColors.border).padding(.top, 6)

            // Results
            if viewModel.isLoading && viewModel.models.isEmpty {
                Spacer()
                ProgressView()
                    .controlSize(.large)
                Spacer()
            } else if let error = viewModel.error, viewModel.models.isEmpty {
                Spacer()
                VStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.largeTitle)
                        .foregroundStyle(AppColors.appWarning)
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(AppColors.textSecondary)
                        .multilineTextAlignment(.center)
                    Button("Retry") { viewModel.searchModels() }
                        .font(.callout.weight(.medium))
                        .foregroundStyle(AppColors.appPrimary)
                }
                .padding(.horizontal, 32)
                Spacer()
            } else if viewModel.models.isEmpty {
                Spacer()
                VStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.largeTitle)
                        .foregroundStyle(AppColors.textTertiary)
                    Text("Search for models")
                        .font(.callout)
                        .foregroundStyle(AppColors.textSecondary)
                    Text("Browse 2M+ models on HuggingFace")
                        .font(.footnote)
                        .foregroundStyle(AppColors.textTertiary)
                }
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(viewModel.models) { model in
                            ModelCard(model: model)
                                .onAppear {
                                    if model.id == viewModel.models.last?.id {
                                        viewModel.loadMore()
                                    }
                                }
                        }
                        if viewModel.isLoading {
                            ProgressView()
                                .padding()
                        }
                    }
                    .padding(16)
                }
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .onAppear {
            if viewModel.models.isEmpty {
                viewModel.searchModels()
            }
        }
    }

    // MARK: - Filter Helpers

    private var activeFilterCount: Int {
        var count = 0
        if viewModel.selectedTask != nil { count += 1 }
        if viewModel.selectedLibrary != nil { count += 1 }
        if viewModel.selectedApp != nil { count += 1 }
        return count
    }

    private func activeFilterTag(_ label: String, onRemove: @escaping () -> Void) -> some View {
        HStack(spacing: 3) {
            Text(label)
                .font(.system(size: 10, weight: .medium))
            Button(action: onRemove) {
                Image(systemName: "xmark")
                    .font(.system(size: 7, weight: .bold))
            }
        }
        .foregroundStyle(AppColors.appPrimary)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(AppColors.appPrimary.opacity(0.12))
        .clipShape(Capsule())
    }

    // MARK: - Filter Row

    private func filterRow<Content: View>(title: String, @ViewBuilder content: @escaping () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased())
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(AppColors.textTertiary)
                .padding(.leading, 16)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    content()
                }
                .padding(.horizontal, 16)
            }
        }
    }

    // MARK: - ModelScope Content

    @ViewBuilder
    private var modelScopeContent: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "globe.asia.australia.fill")
                .font(.system(size: 48))
                .foregroundStyle(AppColors.appPrimary.opacity(0.6))

            VStack(spacing: 6) {
                Text("ModelScope (魔搭社区)")
                    .font(.headline)
                    .foregroundStyle(AppColors.textPrimary)
                Text("Browse models optimized for China region access")
                    .font(.footnote)
                    .foregroundStyle(AppColors.textSecondary)
                    .multilineTextAlignment(.center)
            }

            Button {
                showModelScopeSafari = true
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "safari")
                        .font(.callout)
                    Text("Open ModelScope")
                        .font(.callout.weight(.semibold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
                .background(AppColors.appPrimary)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            Spacer()
        }
        .padding(.horizontal, 32)
        .sheet(isPresented: $showModelScopeSafari) {
            SafariView(url: URL(string: "https://www.modelscope.cn/models")!)
                .ignoresSafeArea()
        }
    }
}

// MARK: - Filter Chip

struct FilterChip: View {
    let label: String
    let icon: String?
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 9, weight: .semibold))
                }
                Text(label)
                    .font(.caption2.weight(.medium))
            }
            .foregroundStyle(isSelected ? .white : AppColors.textSecondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(isSelected ? AppColors.appPrimary : AppColors.inputBg)
            .clipShape(Capsule())
            .overlay(
                Capsule()
                    .stroke(isSelected ? Color.clear : AppColors.border, lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Model Card

struct ModelCard: View {
    let model: HFModelInfo
    @Environment(\.openURL) private var openURL
    @State private var showCopied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Model ID + copy
            HStack(spacing: 6) {
                Text(model.id)
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(AppColors.textPrimary)
                    .lineLimit(1)

                Button {
                    copyModelID()
                } label: {
                    Image(systemName: showCopied ? "checkmark" : "doc.on.doc")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(showCopied ? AppColors.appSuccess : AppColors.textTertiary)
                }
                .buttonStyle(.plain)

                if showCopied {
                    Text("Copied!")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(AppColors.appSuccess)
                        .transition(.opacity)
                }

                Spacer()

                if model.isGated {
                    Text("Gated")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(AppColors.appWarning)
                        .clipShape(Capsule())
                }
            }

            // Author
            if let author = model.author {
                Text(author)
                    .font(.caption)
                    .foregroundStyle(AppColors.textTertiary)
            }

            // Stats row
            HStack(spacing: 12) {
                HStack(spacing: 3) {
                    Image(systemName: "arrow.down.circle")
                        .font(.system(size: 10))
                    Text(model.displayDownloads)
                        .font(.caption.weight(.medium))
                }
                .foregroundStyle(AppColors.textSecondary)

                HStack(spacing: 3) {
                    Image(systemName: "heart")
                        .font(.system(size: 10))
                    Text(model.displayLikes)
                        .font(.caption.weight(.medium))
                }
                .foregroundStyle(AppColors.textSecondary)

                Spacer()
            }

            // Tags
            HStack(spacing: 4) {
                if let tag = model.pipeline_tag {
                    Text(tag)
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(AppColors.appPrimary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(AppColors.appPrimary.opacity(0.1))
                        .clipShape(Capsule())
                }

                if let lib = model.library_name {
                    Text(lib)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(AppColors.textSecondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(AppColors.inputBg)
                        .clipShape(Capsule())
                }

                // Show up to 2 extra tags
                if let tags = model.tags {
                    let extraTags = tags.filter { tag in
                        tag != model.pipeline_tag && tag != model.library_name
                        && !tag.starts(with: "arxiv:") && !tag.starts(with: "base_model:")
                        && !tag.starts(with: "region:") && tag != "endpoints_compatible"
                        && tag != "conversational"
                    }.prefix(2)
                    ForEach(Array(extraTags), id: \.self) { tag in
                        Text(tag)
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(AppColors.textTertiary)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(AppColors.inputBg)
                            .clipShape(Capsule())
                    }
                }
            }
        }
        .padding(12)
        .background(AppColors.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(AppColors.border.opacity(0.5), lineWidth: 0.5)
        )
        .contentShape(RoundedRectangle(cornerRadius: 12))
        .onTapGesture { copyModelID() }
        .contextMenu {
            Button {
                copyModelID()
            } label: {
                Label("Copy Model ID", systemImage: "doc.on.doc")
            }

            Divider()

            Button {
                if let url = URL(string: "https://huggingface.co/\(model.id)") {
                    openURL(url)
                }
            } label: {
                Label("Open on HuggingFace", systemImage: "safari")
            }

            Button {
                if let url = URL(string: "https://hf-mirror.com/\(model.id)") {
                    openURL(url)
                }
            } label: {
                Label("Open on HF Mirror (China)", systemImage: "globe.asia.australia")
            }
        }
    }

    private func copyModelID() {
        UIPasteboard.general.string = model.id
        withAnimation(.easeInOut(duration: 0.2)) { showCopied = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            withAnimation(.easeInOut(duration: 0.2)) { showCopied = false }
        }
    }
}

// MARK: - Token Settings Sheet

struct TokenSettingsSheet: View {
    @Bindable var viewModel: ModelHubViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("HuggingFace Token")
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(AppColors.textPrimary)
                    Text("Optional. Provides higher rate limits and access to gated model information.")
                        .font(.caption)
                        .foregroundStyle(AppColors.textTertiary)

                    SecureField("hf_...", text: $viewModel.hfToken)
                        .font(.callout.monospaced())
                        .foregroundStyle(AppColors.textPrimary)
                        .padding(12)
                        .background(AppColors.inputBg)
                        .clipShape(RoundedRectangle(cornerRadius: 10))

                    Link("Get your token from HuggingFace Settings",
                         destination: URL(string: "https://huggingface.co/settings/tokens")!)
                        .font(.caption)
                        .foregroundStyle(AppColors.appPrimary)
                }

                Spacer()
            }
            .padding(20)
            .background(AppColors.pageBg)
            .contentShape(Rectangle())
            .onTapGesture {
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            }
            .navigationTitle("API Tokens")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") {
                        viewModel.saveToken()
                        viewModel.searchModels()
                        dismiss()
                    }
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(AppColors.appPrimary)
                }
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(AppColors.textSecondary)
                }
            }
        }
    }
}

// MARK: - Safari View

struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}

#Preview {
    ModelHubView()
}
