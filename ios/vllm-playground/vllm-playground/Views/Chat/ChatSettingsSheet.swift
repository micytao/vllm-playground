import SwiftUI

struct ChatSettingsSheet: View {
    @Bindable var viewModel: ChatViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var showToolSettings = false
    @State private var showStructuredOutput = false

    var body: some View {
        NavigationStack {
            ZStack {
                AppColors.pageBg.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 20) {
                        // Model
                        if !viewModel.availableModels.isEmpty {
                            settingCard {
                                VStack(alignment: .leading, spacing: 12) {
                                    sectionLabel("Model")
                                    Picker("Model", selection: $viewModel.selectedModel) {
                                        ForEach(viewModel.availableModels, id: \.self) { model in
                                            Text(model).lineLimit(1).tag(model)
                                        }
                                    }
                                    .pickerStyle(.menu)
                                    .tint(AppColors.textPrimary)
                                }
                            }
                        }

                        // Parameters
                        settingCard {
                            VStack(alignment: .leading, spacing: 16) {
                                sectionLabel("Parameters")

                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Text("Temperature")
                                            .font(.subheadline)
                                            .foregroundStyle(AppColors.textSecondary)
                                        Spacer()
                                        Text(String(format: "%.1f", viewModel.temperature))
                                            .font(.subheadline.monospacedDigit())
                                            .foregroundStyle(AppColors.textPrimary)
                                    }
                                    Slider(value: $viewModel.temperature, in: 0...2, step: 0.1)
                                        .tint(AppColors.appPrimary)
                                }

                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Text("Max Tokens")
                                            .font(.subheadline)
                                            .foregroundStyle(AppColors.textSecondary)
                                        Spacer()
                                        Text("\(viewModel.maxTokens)")
                                            .font(.subheadline.monospacedDigit())
                                            .foregroundStyle(AppColors.textPrimary)
                                    }
                                    Slider(
                                        value: Binding(
                                            get: { Double(viewModel.maxTokens) },
                                            set: { viewModel.maxTokens = Int($0) }
                                        ),
                                        in: 64...4096,
                                        step: 64
                                    )
                                    .tint(AppColors.appPrimary)
                                }
                            }
                        }

                        // System Prompt
                        settingCard {
                            VStack(alignment: .leading, spacing: 10) {
                                HStack {
                                    sectionLabel("System Prompt")
                                    Spacer()
                                    if !viewModel.systemPrompt.isEmpty {
                                        Button("Clear") {
                                            viewModel.systemPrompt = ""
                                        }
                                        .font(.footnote)
                                        .foregroundStyle(AppColors.appRed)
                                    }
                                }

                                TextEditor(text: $viewModel.systemPrompt)
                                    .font(.system(.subheadline, design: .monospaced))
                                    .foregroundStyle(AppColors.textPrimary)
                                    .scrollContentBackground(.hidden)
                                    .frame(minHeight: 80)
                                    .padding(10)
                                    .background(AppColors.inputBg)
                                    .clipShape(RoundedRectangle(cornerRadius: 12))
                            }
                        }

                        // Templates
                        settingCard {
                            VStack(alignment: .leading, spacing: 10) {
                                sectionLabel("Templates")

                                ForEach(SystemPromptTemplate.allCases) { template in
                                    Button {
                                        viewModel.systemPrompt = template.prompt
                                    } label: {
                                        HStack {
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(template.name)
                                                    .font(.subheadline.weight(.medium))
                                                    .foregroundStyle(AppColors.textPrimary)
                                                Text(template.prompt.truncated(to: 60))
                                                    .font(.caption)
                                                    .foregroundStyle(AppColors.textTertiary)
                                            }
                                            Spacer()
                                            Image(systemName: "chevron.right")
                                                .font(.caption)
                                                .foregroundStyle(AppColors.textTertiary)
                                        }
                                        .padding(.vertical, 6)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }

                        // Tool Calling
                        settingCard {
                            Button { showToolSettings = true } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        sectionLabel("Tools")
                                        Text(viewModel.tools.isEmpty ? "No tools configured" : "\(viewModel.tools.count) tool(s) active")
                                            .font(.subheadline)
                                            .foregroundStyle(AppColors.textSecondary)
                                    }
                                    Spacer()
                                    if !viewModel.tools.isEmpty {
                                        Text("\(viewModel.tools.count)")
                                            .font(.caption.weight(.bold))
                                            .foregroundStyle(.white)
                                            .padding(.horizontal, 8)
                                            .padding(.vertical, 3)
                                            .background(AppColors.appPrimary)
                                            .clipShape(Capsule())
                                    }
                                    Image(systemName: "chevron.right")
                                        .font(.caption)
                                        .foregroundStyle(AppColors.textTertiary)
                                }
                            }
                            .buttonStyle(.plain)
                        }

                        // Structured Output
                        settingCard {
                            Button { showStructuredOutput = true } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        sectionLabel("Structured Output")
                                        if let config = viewModel.structuredOutput {
                                            Text(config.displayName)
                                                .font(.subheadline)
                                                .foregroundStyle(AppColors.appPrimary)
                                        } else {
                                            Text("Off")
                                                .font(.subheadline)
                                                .foregroundStyle(AppColors.textSecondary)
                                        }
                                    }
                                    Spacer()
                                    if viewModel.structuredOutput != nil {
                                        Image(systemName: "checkmark.circle.fill")
                                            .font(.caption)
                                            .foregroundStyle(AppColors.appPrimary)
                                    }
                                    Image(systemName: "chevron.right")
                                        .font(.caption)
                                        .foregroundStyle(AppColors.textTertiary)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(16)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(AppColors.appPrimary)
                }
            }
            .sheet(isPresented: $showToolSettings) {
                ToolSettingsSheet(viewModel: viewModel)
            }
            .sheet(isPresented: $showStructuredOutput) {
                StructuredOutputSheet(config: $viewModel.structuredOutput)
            }
        }
    }

    // MARK: - Helpers

    private func sectionLabel(_ text: String) -> some View {
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
}

// MARK: - System Prompt Templates

enum SystemPromptTemplate: String, CaseIterable, Identifiable {
    case helpful
    case concise
    case coder
    case creative

    var id: String { rawValue }

    var name: String {
        switch self {
        case .helpful: return "Helpful Assistant"
        case .concise: return "Concise"
        case .coder: return "Coding Assistant"
        case .creative: return "Creative Writer"
        }
    }

    var prompt: String {
        switch self {
        case .helpful:
            return "You are a helpful, harmless, and honest AI assistant."
        case .concise:
            return "You are a concise assistant. Give short, direct answers without unnecessary explanation."
        case .coder:
            return "You are an expert software engineer. Provide clean, well-documented code with explanations. Use best practices and modern patterns."
        case .creative:
            return "You are a creative writer with a vivid imagination. Write engaging, descriptive prose with rich language."
        }
    }
}

#if DEBUG
#Preview {
    ChatSettingsSheet(viewModel: ChatViewModel.preview())
}
#endif
