import SwiftUI
import SwiftData

enum ServerFormMode {
    case add
    case edit(ServerProfile)
}

struct ServerFormView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Query private var allServers: [ServerProfile]

    let mode: ServerFormMode

    @State private var name = ""
    @State private var serverType: ServerType = .vllm
    @State private var baseURL = ""
    @State private var omniBaseURL = ""
    @State private var apiKey = ""
    @State private var isDefault = false
    @State private var isTesting = false
    @State private var testResult: TestResult?
    @State private var defaultModel = ""
    @State private var detectedModels: [String] = []
    @State private var showDemoURLError = false
    @State private var showGuide = false

    var viewModel = ServerProfileViewModel()

    enum TestResult {
        case success(modelCount: Int)
        case failure(String)
    }

    var isEditing: Bool {
        if case .edit = mode { return true }
        return false
    }

    var body: some View {
        NavigationStack {
            ZStack {
                AppColors.pageBg.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 20) {
                        // Quick Setup templates (add mode only)
                        if !isEditing {
                            quickSetupSection
                        }

                        // Info banner
                        infoBanner

                        // Server type selector
                        formCard {
                            VStack(alignment: .leading, spacing: 12) {
                                sectionLabel("Server Type")

                                ForEach(ServerType.allCases) { type in
                                    Button {
                                        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                                            serverType = type
                                        }
                                    } label: {
                                        HStack(spacing: 12) {
                                            ZStack {
                                                RoundedRectangle(cornerRadius: 10)
                                                    .fill(serverType == type ? AppColors.appPrimary.opacity(0.12) : AppColors.inputBg)
                                                    .frame(width: 40, height: 40)
                                                Image(systemName: type.icon)
                                                    .font(.callout.weight(.medium))
                                                    .foregroundStyle(serverType == type ? AppColors.appPrimary : AppColors.textTertiary)
                                            }

                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(type.rawValue)
                                                    .font(.callout.weight(.semibold))
                                                    .foregroundStyle(AppColors.textPrimary)
                                                Text(type.description)
                                                    .font(.caption)
                                                    .foregroundStyle(AppColors.textTertiary)
                                            }

                                            Spacer()

                                            if serverType == type {
                                                Image(systemName: "checkmark.circle.fill")
                                                    .font(.body)
                                                    .foregroundStyle(AppColors.appPrimary)
                                                    .transition(.scale.combined(with: .opacity))
                                            }
                                        }
                                        .padding(.vertical, 4)
                                    }
                                    .buttonStyle(.plain)

                                    if type != ServerType.allCases.last {
                                        Divider().background(AppColors.border)
                                    }
                                }
                            }
                        }

                        // Server details
                        formCard {
                            VStack(alignment: .leading, spacing: 16) {
                                sectionLabel("Connection")

                                formField("Name", text: $name, placeholder: "My GPU Server")

                                if serverType == .vllm {
                                    formField("Base URL", text: $baseURL, placeholder: "http://192.168.1.100:8000")
                                        .keyboardType(.URL)
                                        .autocapitalization(.none)

                                    urlHint(
                                        "The URL where your vLLM server is running. Default port is 8000. The app connects via the OpenAI-compatible API at /v1/."
                                    )
                                } else {
                                    formField("Omni URL", text: $omniBaseURL, placeholder: "http://192.168.1.100:8091")
                                        .keyboardType(.URL)
                                        .autocapitalization(.none)

                                    urlHint(
                                        "The URL of your vLLM-Omni server. Default port is 8091. Supports image generation, TTS, and audio generation."
                                    )
                                }
                            }
                        }

                        // Auth
                        formCard {
                            VStack(alignment: .leading, spacing: 16) {
                                sectionLabel("Authentication")

                                VStack(alignment: .leading, spacing: 6) {
                                    Text("API Key")
                                        .font(.footnote)
                                        .foregroundStyle(AppColors.textSecondary)
                                    SecureField("Optional", text: $apiKey)
                                        .font(.callout)
                                        .padding(.horizontal, 14)
                                        .padding(.vertical, 10)
                                        .background(AppColors.inputBg)
                                        .clipShape(RoundedRectangle(cornerRadius: 10))
                                }

                                urlHint(
                                    "Required if your server uses --api-key. Stored securely in the iOS Keychain, not with other app data."
                                )
                            }
                        }

                        // Default toggle
                        formCard {
                            Toggle(isOn: $isDefault) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Default Server")
                                        .font(.callout.weight(.medium))
                                        .foregroundStyle(AppColors.textPrimary)
                                    Text("Used automatically for new chats")
                                        .font(.footnote)
                                        .foregroundStyle(AppColors.textSecondary)
                                }
                            }
                            .tint(AppColors.appPrimary)
                        }

                        // Test connection
                        formCard {
                            VStack(spacing: 12) {
                                Button {
                                    testConnection()
                                } label: {
                                    HStack {
                                        if isTesting {
                                            ProgressView()
                                                .tint(AppColors.textSecondary)
                                                .controlSize(.small)
                                        }
                                        Text(isTesting ? "Testing..." : "Test Connection")
                                            .font(.callout.weight(.medium))
                                    }
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 12)
                                    .background(AppColors.inputBg)
                                    .foregroundStyle(AppColors.textPrimary)
                                    .clipShape(RoundedRectangle(cornerRadius: 12))
                                }
                                .disabled(effectiveURL.isEmpty || isTesting)

                                if let result = testResult {
                                    HStack(spacing: 8) {
                                        switch result {
                                        case .success(let count):
                                            Image(systemName: "checkmark.circle.fill")
                                                .foregroundStyle(AppColors.appSuccess)
                                            Text("Connected - \(count) model(s)")
                                                .font(.subheadline)
                                                .foregroundStyle(AppColors.appSuccess)
                                        case .failure(let msg):
                                            Image(systemName: "xmark.circle.fill")
                                                .foregroundStyle(AppColors.appRed)
                                            Text(msg)
                                                .font(.subheadline)
                                                .foregroundStyle(AppColors.appRed)
                                        }
                                        Spacer()
                                    }
                                }
                            }
                        }

                        // Default model picker
                        if !detectedModels.isEmpty {
                            formCard {
                                VStack(alignment: .leading, spacing: 12) {
                                    sectionLabel("Default Model")

                                    Text("The selected model will be used automatically for new chats. Choose \"None\" to always be prompted.")
                                        .font(.footnote)
                                        .foregroundStyle(AppColors.textSecondary)

                                    VStack(spacing: 0) {
                                        // "None (always ask)" option
                                        Button {
                                            defaultModel = ""
                                        } label: {
                                            HStack {
                                                Text("None (always ask)")
                                                    .font(.callout)
                                                    .foregroundStyle(AppColors.textPrimary)
                                                Spacer()
                                                if defaultModel.isEmpty {
                                                    Image(systemName: "checkmark")
                                                        .font(.subheadline.weight(.semibold))
                                                        .foregroundStyle(AppColors.appPrimary)
                                                }
                                            }
                                            .padding(.horizontal, 14)
                                            .padding(.vertical, 10)
                                            .background(defaultModel.isEmpty ? AppColors.appPrimary.opacity(0.1) : Color.clear)
                                        }

                                        Divider().foregroundStyle(AppColors.border)

                                        // Model options
                                        ForEach(detectedModels.sorted(), id: \.self) { model in
                                            Button {
                                                defaultModel = model
                                            } label: {
                                                HStack {
                                                    Text(model)
                                                        .font(.callout)
                                                        .foregroundStyle(AppColors.textPrimary)
                                                        .lineLimit(1)
                                                    Spacer()
                                                    if defaultModel == model {
                                                        Image(systemName: "checkmark")
                                                            .font(.subheadline.weight(.semibold))
                                                            .foregroundStyle(AppColors.appPrimary)
                                                    }
                                                }
                                                .padding(.horizontal, 14)
                                                .padding(.vertical, 10)
                                                .background(defaultModel == model ? AppColors.appPrimary.opacity(0.1) : Color.clear)
                                            }

                                            if model != detectedModels.sorted().last {
                                                Divider().foregroundStyle(AppColors.border)
                                            }
                                        }
                                    }
                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 10)
                                            .stroke(AppColors.border, lineWidth: 1)
                                    )
                                }
                            }
                        }
                    }
                    .padding(16)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .navigationTitle(isEditing ? "Edit Server" : "Add Server")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(AppColors.textSecondary)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .fontWeight(.semibold)
                        .foregroundStyle(
                            (name.isEmpty || effectiveURL.isEmpty) ? AppColors.textTertiary : AppColors.appPrimary
                        )
                        .disabled(name.isEmpty || effectiveURL.isEmpty)
                }
            }
            .onAppear(perform: loadExisting)
            .alert("Reserved URL Scheme", isPresented: $showDemoURLError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("The \"demo://\" URL scheme is reserved for the built-in demo server. Please enter a valid server URL (http:// or https://).")
            }
        }
    }

    // MARK: - Components

    private var infoBanner: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "info.circle.fill")
                    .font(.callout)
                    .foregroundStyle(AppColors.appPrimary)
                Text("How it works")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AppColors.textPrimary)
            }

            VStack(alignment: .leading, spacing: 8) {
                infoBullet(
                    icon: "link",
                    text: "This app connects directly to your vLLM server's OpenAI-compatible API. No middleware needed."
                )
                infoBullet(
                    icon: "lock.shield",
                    text: "API keys are stored in the iOS Keychain. Server profiles and chat history are saved on-device only."
                )
                infoBullet(
                    icon: "wifi",
                    text: "Your device must be able to reach the server URL. For local servers, ensure you're on the same network."
                )
            }
        }
        .padding(14)
        .background(AppColors.appPrimary.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(AppColors.appPrimary.opacity(0.15), lineWidth: 1)
        )
    }

    private func infoBullet(icon: String, text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon)
                .font(.caption)
                .foregroundStyle(AppColors.textTertiary)
                .frame(width: 16, alignment: .center)
                .padding(.top, 2)
            Text(text)
                .font(.caption)
                .foregroundStyle(AppColors.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func urlHint(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: "lightbulb.min")
                .font(.caption2)
                .foregroundStyle(AppColors.textTertiary)
                .padding(.top, 1)
            Text(text)
                .font(.caption)
                .foregroundStyle(AppColors.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func sectionLabel(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(AppColors.textSecondary)
            .textCase(.uppercase)
    }

    private func formCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .padding(16)
            .background(AppColors.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func formField(_ label: String, text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.footnote)
                .foregroundStyle(AppColors.textSecondary)
            TextField(placeholder, text: text)
                .font(.callout)
                .foregroundStyle(AppColors.textPrimary)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(AppColors.inputBg)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .autocorrectionDisabled()
        }
    }

    // MARK: - Quick Setup

    private var quickSetupSection: some View {
        formCard {
            VStack(alignment: .leading, spacing: 12) {
                sectionLabel("Quick Setup")

                HStack(spacing: 10) {
                    quickSetupButton(
                        icon: "desktopcomputer",
                        title: "Local Server",
                        tint: .blue
                    ) {
                        name = "Local vLLM"
                        baseURL = "http://localhost:8000"
                        serverType = .vllm
                    }

                    quickSetupButton(
                        icon: "network",
                        title: "LAN Server",
                        tint: .purple
                    ) {
                        name = "LAN vLLM"
                        baseURL = "http://192.168.1.100:8000"
                        serverType = .vllm
                    }

                    quickSetupButton(
                        icon: "waveform.and.mic",
                        title: "Omni Server",
                        tint: .orange
                    ) {
                        name = "Local Omni"
                        omniBaseURL = "http://localhost:8091"
                        serverType = .vllmOmni
                    }
                }

                DisclosureGroup(isExpanded: $showGuide) {
                    VStack(alignment: .leading, spacing: 8) {
                        codeHint("pip install vllm")
                        codeHint("vllm serve Qwen/Qwen2.5-7B-Instruct")
                        Text("Server starts on port 8000 by default")
                            .font(.caption)
                            .foregroundStyle(AppColors.textTertiary)
                        Link("vLLM Documentation", destination: URL(string: "https://docs.vllm.ai")!)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(AppColors.appPrimary)
                    }
                    .padding(.top, 8)
                } label: {
                    Text("How to start vLLM")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(AppColors.textSecondary)
                }
                .tint(AppColors.textTertiary)
            }
        }
    }

    private func quickSetupButton(icon: String, title: LocalizedStringKey, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(tint.opacity(0.12))
                        .frame(width: 36, height: 36)
                    Image(systemName: icon)
                        .font(.callout)
                        .foregroundStyle(tint)
                }
                Text(title)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(AppColors.textSecondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(AppColors.inputBg)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }

    private func codeHint(_ text: String) -> some View {
        Text(text)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(AppColors.textPrimary)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(AppColors.inputBg)
            .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    // MARK: - Actions

    private func loadExisting() {
        if case .edit(let profile) = mode {
            // Block editing demo server
            guard !profile.isDemo else {
                dismiss()
                return
            }
            name = profile.name
            serverType = profile.serverType
            baseURL = profile.baseURL
            omniBaseURL = profile.omniBaseURL
            isDefault = profile.isDefault
            apiKey = viewModel.loadAPIKey(for: profile)
            defaultModel = profile.defaultModel ?? ""
            detectedModels = profile.availableModels
        }
    }

    /// The primary URL for this server type.
    private var effectiveURL: String {
        serverType == .vllmOmni ? omniBaseURL : baseURL
    }

    private func testConnection() {
        isTesting = true
        testResult = nil

        Task {
            let client = VLLMAPIClient.shared
            let key = apiKey.isEmpty ? nil : apiKey
            let normalizedURL = normalizeURL(effectiveURL)

            do {
                let healthy = try await client.checkHealth(baseURL: normalizedURL, apiKey: key)
                if healthy {
                    let models = try await client.listModels(baseURL: normalizedURL, apiKey: key)
                    detectedModels = models.sorted()
                    testResult = .success(modelCount: models.count)
                } else {
                    testResult = .failure("Server returned unhealthy status")
                }
            } catch {
                testResult = .failure(error.localizedDescription)
            }
            isTesting = false
        }
    }

    private func save() {
        // Block demo:// URL scheme — reserved for the built-in demo server
        let urlToCheck = serverType == .vllmOmni ? omniBaseURL : baseURL
        if urlToCheck.lowercased().trimmingCharacters(in: .whitespaces).hasPrefix("demo://") {
            showDemoURLError = true
            return
        }

        // For vLLM servers: baseURL is the primary URL, omniBaseURL stays empty.
        // For vLLM-Omni servers: omniBaseURL is the primary URL, baseURL is set to same
        //   (so health checks, model listing, etc. all work via baseURL).
        let resolvedBase: String
        let resolvedOmni: String

        if serverType == .vllmOmni {
            resolvedOmni = normalizeURL(omniBaseURL)
            resolvedBase = resolvedOmni
        } else {
            resolvedBase = normalizeURL(baseURL)
            resolvedOmni = ""
        }

        switch mode {
        case .add:
            let profile = ServerProfile(
                name: name,
                baseURL: resolvedBase,
                omniBaseURL: resolvedOmni,
                serverType: serverType,
                isDefault: isDefault,
                defaultModel: defaultModel.isEmpty ? nil : defaultModel
            )

            if isDefault {
                for p in allServers { p.isDefault = false }
            }

            modelContext.insert(profile)
            viewModel.saveAPIKey(apiKey, for: profile)

            Task {
                await viewModel.fetchModels(for: profile)
                await viewModel.checkHealth(for: profile)
            }

        case .edit(let profile):
            profile.name = name
            profile.serverType = serverType
            profile.baseURL = resolvedBase
            profile.omniBaseURL = resolvedOmni
            profile.defaultModel = defaultModel.isEmpty ? nil : defaultModel
            profile.updatedAt = Date()

            if isDefault {
                for p in allServers { p.isDefault = false }
                profile.isDefault = true
            }

            viewModel.saveAPIKey(apiKey, for: profile)

            Task {
                await viewModel.fetchModels(for: profile)
                await viewModel.checkHealth(for: profile)
            }
        }

        dismiss()
    }

    /// Auto-prefix http:// if no scheme is provided. Rejects demo:// URLs.
    private func normalizeURL(_ url: String) -> String {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        // Block demo:// scheme (reserved for built-in demo server)
        if trimmed.lowercased().hasPrefix("demo://") {
            return ""
        }
        if !trimmed.hasPrefix("http://") && !trimmed.hasPrefix("https://") {
            return "http://\(trimmed)"
        }
        return trimmed
    }
}



#Preview("Add") {
    ServerFormView(mode: .add)
        .modelContainer(for: ServerProfile.self, inMemory: true)
}
