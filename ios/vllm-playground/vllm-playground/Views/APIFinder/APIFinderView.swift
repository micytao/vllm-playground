import SwiftUI

struct APIFinderView: View {
    @Environment(\.showSidebar) private var showSidebar
    @State private var viewModel = APIFinderViewModel()
    @State private var showCopiedToast = false

    var body: some View {
        NavigationStack {
            ZStack {
                AppColors.pageBg.ignoresSafeArea()

                VStack(spacing: 0) {
                    // Tab picker
                    tabPicker
                        .padding(.horizontal, 16)
                        .padding(.top, 8)

                    // Search bar
                    searchBar
                        .padding(.horizontal, 16)
                        .padding(.top, 10)

                    // Status banner
                    if viewModel.hasUpdatedData, let date = viewModel.lastLoadedAt {
                        liveBanner(date: date)
                            .padding(.horizontal, 16)
                            .padding(.top, 8)
                    }

                    if let error = viewModel.loadError {
                        errorBanner(message: error)
                            .padding(.horizontal, 16)
                            .padding(.top, 8)
                    }

                    // Content
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            if viewModel.selectedTab == .online {
                                onlineContent
                            } else {
                                offlineContent
                            }
                        }
                        .padding(16)
                    }
                    .scrollDismissesKeyboard(.interactively)
                }

                // Copied toast
                if showCopiedToast {
                    VStack {
                        Spacer()
                        copiedToast
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(100)
                }
            }
            .navigationTitle("API Finder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showSidebar.wrappedValue.toggle()
                    } label: {
                        Image(systemName: "line.3.horizontal")
                            .foregroundStyle(AppColors.textPrimary)
                    }
                }

                ToolbarItem(placement: .topBarTrailing) {
                    if viewModel.isLoading {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Button {
                            Task { await viewModel.loadLatest() }
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "arrow.down.circle")
                                    .font(.caption)
                                Text("Load Latest")
                                    .font(.caption.weight(.medium))
                            }
                            .foregroundStyle(AppColors.appPrimary)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Tab Picker

    private var tabPicker: some View {
        HStack(spacing: 4) {
            ForEach(APIFinderTab.allCases, id: \.self) { tab in
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        viewModel.selectedTab = tab
                    }
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: tab == .online ? "network" : "desktopcomputer")
                            .font(.caption)
                        Text(tab.rawValue)
                            .font(.subheadline.weight(.medium))
                            .lineLimit(1)
                    }
                    .foregroundStyle(viewModel.selectedTab == tab ? AppColors.textPrimary : AppColors.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(viewModel.selectedTab == tab ? AppColors.cardBg : Color.clear)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(AppColors.inputBg)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    // MARK: - Search Bar

    private var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.callout)
                .foregroundStyle(AppColors.textTertiary)

            TextField("Search endpoints, classes, parameters...", text: $viewModel.searchQuery)
                .font(.callout)
                .foregroundStyle(AppColors.textPrimary)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)

            if !viewModel.searchQuery.isEmpty {
                Button {
                    viewModel.searchQuery = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.callout)
                        .foregroundStyle(AppColors.textTertiary)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(AppColors.inputBg)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    // MARK: - Online Content

    private var onlineContent: some View {
        Group {
            let groups = viewModel.groupedEndpoints
            if groups.isEmpty {
                emptyState(message: "No endpoints match your search")
            } else {
                ForEach(groups, id: \.category) { group in
                    Section {
                        ForEach(group.endpoints) { endpoint in
                            EndpointCard(endpoint: endpoint, onCopy: { copyToClipboard($0) })
                        }
                    } header: {
                        sectionHeader(group.category.rawValue, count: group.endpoints.count)
                    }
                }
            }
        }
    }

    // MARK: - Offline Content

    private var offlineContent: some View {
        Group {
            let groups = viewModel.groupedClasses
            if groups.isEmpty {
                emptyState(message: "No classes match your search")
            } else {
                ForEach(groups, id: \.category) { group in
                    Section {
                        ForEach(group.classes) { cls in
                            PythonClassCard(cls: cls, onCopy: { copyToClipboard($0) })
                        }
                    } header: {
                        sectionHeader(group.category.rawValue, count: group.classes.count)
                    }
                }
            }
        }
    }

    // MARK: - Helpers

    private func sectionHeader(_ title: String, count: Int) -> some View {
        HStack(spacing: 6) {
            Text(title.uppercased())
                .font(.caption.weight(.bold))
                .foregroundStyle(AppColors.textTertiary)
            Text("\(count)")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(AppColors.textTertiary)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(AppColors.inputBg)
                .clipShape(Capsule())
            Spacer()
        }
        .padding(.top, 4)
    }

    private func liveBanner(date: Date) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .font(.caption)
                .foregroundStyle(AppColors.appSuccess)
            Text("Updated at")
                .font(.caption.weight(.medium))
                .foregroundStyle(AppColors.appSuccess)
            Text(date, format: .dateTime.month(.abbreviated).day().hour().minute())
                .font(.caption.weight(.medium))
                .foregroundStyle(AppColors.appSuccess)
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(AppColors.appSuccess.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func errorBanner(message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle")
                .font(.caption)
                .foregroundStyle(AppColors.appWarning)
            Text("Failed to load: \(message)")
                .font(.caption)
                .foregroundStyle(AppColors.textSecondary)
                .lineLimit(2)
            Spacer()
            Button {
                viewModel.loadError = nil
            } label: {
                Image(systemName: "xmark")
                    .font(.caption2)
                    .foregroundStyle(AppColors.textTertiary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(AppColors.appWarning.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func emptyState(message: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(.largeTitle)
                .foregroundStyle(AppColors.textTertiary)
            Text(message)
                .font(.callout)
                .foregroundStyle(AppColors.textTertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 60)
    }

    private var copiedToast: some View {
        HStack(spacing: 6) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(AppColors.appSuccess)
            Text("Copied to clipboard!")
                .font(.footnote.weight(.medium))
                .foregroundStyle(AppColors.textPrimary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial)
        .clipShape(Capsule())
        .shadow(color: .black.opacity(0.1), radius: 8, y: 4)
        .padding(.bottom, 24)
    }

    private func copyToClipboard(_ text: String) {
        UIPasteboard.general.string = text
        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
            showCopiedToast = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            withAnimation { showCopiedToast = false }
        }
    }
}

// MARK: - Method Badge

private struct MethodBadge: View {
    let method: APIEndpoint.HTTPMethod

    var body: some View {
        Text(method.rawValue)
            .font(.system(size: 10, weight: .bold, design: .monospaced))
            .foregroundStyle(.white)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(badgeColor)
            .clipShape(RoundedRectangle(cornerRadius: 4))
    }

    private var badgeColor: Color {
        switch method {
        case .get: return AppColors.appSuccess
        case .post: return AppColors.appPrimary
        case .websocket: return hexColor("8B5CF6") // purple
        }
    }
}

// MARK: - Endpoint Card

private struct EndpointCard: View {
    let endpoint: APIEndpoint
    let onCopy: @MainActor (String) -> Void
    @State private var isExpanded = false
    @State private var snippetTab: SnippetTab = .curl

    enum SnippetTab: String, CaseIterable {
        case curl = "curl"
        case python = "Python"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header (always visible)
            Button {
                withAnimation(.default) { isExpanded.toggle() }
            } label: {
                HStack(spacing: 8) {
                    MethodBadge(method: endpoint.method)

                    Text(endpoint.path)
                        .font(.system(.footnote, design: .monospaced).weight(.semibold))
                        .foregroundStyle(AppColors.textPrimary)
                        .lineLimit(1)

                    Spacer()

                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(AppColors.textTertiary)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .buttonStyle(.plain)

            // Subtitle
            if !isExpanded {
                Text(endpoint.name)
                    .font(.caption)
                    .foregroundStyle(AppColors.textSecondary)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 10)
            }

            // Expanded detail
            if isExpanded {
                VStack(alignment: .leading, spacing: 14) {
                    // Description
                    Text(endpoint.description)
                        .font(.caption)
                        .foregroundStyle(AppColors.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)

                    // Parameters
                    if !endpoint.parameters.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("PARAMETERS")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(AppColors.textTertiary)

                            ForEach(endpoint.parameters) { param in
                                paramRow(param)
                            }
                        }
                    }

                    // Sample Snippets
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 4) {
                            Text("SAMPLE")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(AppColors.textTertiary)

                            Spacer()

                            ForEach(SnippetTab.allCases, id: \.self) { tab in
                                Button {
                                    snippetTab = tab
                                } label: {
                                    Text(tab.rawValue)
                                        .font(.system(size: 10, weight: .semibold))
                                        .foregroundStyle(snippetTab == tab ? AppColors.appPrimary : AppColors.textTertiary)
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 3)
                                        .background(snippetTab == tab ? AppColors.appPrimary.opacity(0.1) : Color.clear)
                                        .clipShape(RoundedRectangle(cornerRadius: 4))
                                }
                                .buttonStyle(.plain)
                            }
                        }

                        codeBlock(
                            code: snippetTab == .curl ? endpoint.sampleCurl : endpoint.samplePython,
                            onCopy: onCopy
                        )
                    }
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 14)
            }
        }
        .background(AppColors.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(AppColors.border.opacity(0.5), lineWidth: 0.5)
        )
    }

    private func paramRow(_ param: APIParam) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(param.name)
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundStyle(AppColors.textPrimary)

                Text(param.type)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(AppColors.appPrimary)

                if param.required {
                    Text("required")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(AppColors.appRed)
                }

                if !param.defaultValue.isEmpty {
                    Text("= \(param.defaultValue)")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(AppColors.textTertiary)
                }
            }

            Text(param.description)
                .font(.system(size: 11))
                .foregroundStyle(AppColors.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Python Class Card

private struct PythonClassCard: View {
    let cls: PythonAPIClass
    let onCopy: @MainActor (String) -> Void
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            Button {
                withAnimation(.default) { isExpanded.toggle() }
            } label: {
                HStack(spacing: 8) {
                    Text("class")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(AppColors.appPrimary)
                        .clipShape(RoundedRectangle(cornerRadius: 4))

                    Text(cls.name)
                        .font(.system(.footnote, design: .monospaced).weight(.semibold))
                        .foregroundStyle(AppColors.textPrimary)

                    Spacer()

                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(AppColors.textTertiary)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .buttonStyle(.plain)

            // Subtitle
            if !isExpanded {
                Text(cls.description)
                    .font(.caption)
                    .foregroundStyle(AppColors.textSecondary)
                    .lineLimit(2)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 10)
            }

            // Expanded
            if isExpanded {
                VStack(alignment: .leading, spacing: 14) {
                    // Description
                    Text(cls.description)
                        .font(.caption)
                        .foregroundStyle(AppColors.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)

                    // Properties
                    if !cls.properties.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("PROPERTIES")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(AppColors.textTertiary)

                            ForEach(cls.properties) { prop in
                                propertyRow(prop)
                            }
                        }
                    }

                    // Sample
                    VStack(alignment: .leading, spacing: 8) {
                        Text("EXAMPLE")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(AppColors.textTertiary)

                        codeBlock(code: cls.samplePython, onCopy: onCopy)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 14)
            }
        }
        .background(AppColors.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(AppColors.border.opacity(0.5), lineWidth: 0.5)
        )
    }

    private func propertyRow(_ prop: ClassProperty) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(prop.name)
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundStyle(AppColors.textPrimary)

                Text(prop.type)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(AppColors.appPrimary)

                if !prop.defaultValue.isEmpty {
                    Text("= \(prop.defaultValue)")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(AppColors.textTertiary)
                }
            }

            Text(prop.description)
                .font(.system(size: 11))
                .foregroundStyle(AppColors.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Shared Code Block

private func codeBlock(code: String, onCopy: @MainActor @escaping (String) -> Void) -> some View {
    VStack(alignment: .trailing, spacing: 0) {
        // Copy button row
        HStack {
            Spacer()
            Button {
                let trimmed = code.split(separator: "\n")
                    .map { $0.hasPrefix("            ") ? String($0.dropFirst(12)) : String($0) }
                    .joined(separator: "\n")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                onCopy(trimmed)
            } label: {
                HStack(spacing: 3) {
                    Image(systemName: "doc.on.doc")
                        .font(.system(size: 9))
                    Text("Copy")
                        .font(.system(size: 10, weight: .medium))
                }
                .foregroundStyle(hexColor("94A3B8"))
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
            }
            .buttonStyle(.plain)
        }
        .padding(.top, 6)
        .padding(.trailing, 8)

        // Code content
        ScrollView(.horizontal, showsIndicators: false) {
            Text(trimmedCode(code))
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(hexColor("E2E8F0"))
                .textSelection(.enabled)
                .padding(.horizontal, 14)
                .padding(.bottom, 12)
        }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(hexColor("0F172A"))
    .clipShape(RoundedRectangle(cornerRadius: 10))
}

private func trimmedCode(_ code: String) -> String {
    code.split(separator: "\n")
        .map { $0.hasPrefix("            ") ? String($0.dropFirst(12)) : String($0) }
        .joined(separator: "\n")
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

#Preview {
    APIFinderView()
}
