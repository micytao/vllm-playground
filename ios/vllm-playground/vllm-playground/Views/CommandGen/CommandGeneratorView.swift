import SwiftUI

struct CommandGeneratorView: View {
    @Environment(\.showSidebar) private var showSidebar
    @State private var viewModel = CommandGeneratorViewModel()
    @State private var showCopiedToast = false
    @State private var showResetConfirmation = false

    var body: some View {
        NavigationStack {
            ZStack {
                AppColors.pageBg.ignoresSafeArea()

                VStack(spacing: 0) {
                    // Command type picker
                    commandTypePicker
                        .padding(.horizontal, 16)
                        .padding(.top, 8)

                    // Parameters + preview
                    ScrollView {
                        VStack(spacing: 16) {
                            if viewModel.commandType == .serve {
                                serveParameterSections
                            } else {
                                benchParameterSections
                            }

                            // Live preview
                            commandPreview
                        }
                        .padding(16)
                    }
                    .scrollDismissesKeyboard(.interactively)
                }

                // Copied toast
                if showCopiedToast {
                    VStack {
                        Spacer()
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
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(100)
                }
            }
            .navigationTitle("Command Generator")
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
                    Button {
                        showResetConfirmation = true
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "arrow.counterclockwise")
                                .font(.caption)
                            Text("Reset")
                                .font(.caption.weight(.medium))
                        }
                        .foregroundStyle(AppColors.appPrimary)
                    }
                }
            }
            .alert("Reset All Parameters?", isPresented: $showResetConfirmation) {
                Button("Reset", role: .destructive) {
                    viewModel.resetToDefaults()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This will reset all parameters to their default values.")
            }
        }
    }

    // MARK: - Command Type Picker

    private var commandTypePicker: some View {
        HStack(spacing: 4) {
            ForEach(VLLMCommandType.allCases, id: \.self) { type in
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        viewModel.commandType = type
                    }
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: type == .serve ? "server.rack" : "gauge.with.dots.needle.33percent")
                            .font(.caption)
                        Text(type.rawValue)
                            .font(.subheadline.weight(.medium))
                            .lineLimit(1)
                    }
                    .foregroundStyle(viewModel.commandType == type ? AppColors.textPrimary : AppColors.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(viewModel.commandType == type ? AppColors.cardBg : Color.clear)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(AppColors.inputBg)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    // MARK: - Serve Parameter Sections

    private var serveParameterSections: some View {
        VStack(spacing: 12) {
            // Model section (expanded by default since model name is required)
            ServeModelSection(viewModel: viewModel)

            // Server section
            ServeServerSection(viewModel: viewModel)

            // Parallelism section
            ServeParallelismSection(viewModel: viewModel)

            // Memory & Performance section
            ServeMemorySection(viewModel: viewModel)

            // Advanced section
            ServeAdvancedSection(viewModel: viewModel)
        }
    }

    // MARK: - Bench Parameter Sections

    private var benchParameterSections: some View {
        VStack(spacing: 12) {
            BenchTargetSection(viewModel: viewModel)
            BenchWorkloadSection(viewModel: viewModel)
            BenchSamplingSection(viewModel: viewModel)
            BenchOutputSection(viewModel: viewModel)
        }
    }

    // MARK: - Command Preview

    private var commandPreview: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                HStack(spacing: 5) {
                    Image(systemName: "terminal")
                        .font(.caption.weight(.semibold))
                    Text("COMMAND PREVIEW")
                        .font(.caption.weight(.semibold))
                }
                .foregroundStyle(AppColors.textSecondary)

                Spacer()

                Button {
                    copyCommand()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "doc.on.doc")
                            .font(.caption2)
                        Text("Copy")
                            .font(.caption.weight(.medium))
                    }
                    .foregroundStyle(AppColors.appPrimary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(AppColors.appPrimary.opacity(0.1))
                    .clipShape(Capsule())
                }
            }

            ScrollView(.horizontal, showsIndicators: false) {
                Text(viewModel.generatedCommand)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(hexColor("E2E8F0"))
                    .textSelection(.enabled)
                    .padding(14)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(hexColor("0F172A"))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .padding(14)
        .background(AppColors.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(AppColors.border.opacity(0.5), lineWidth: 0.5)
        )
    }

    private func copyCommand() {
        UIPasteboard.general.string = viewModel.generatedCommand
        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
            showCopiedToast = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            withAnimation { showCopiedToast = false }
        }
    }
}

// MARK: - Collapsible Section Helper

struct CollapsibleSection<Content: View>: View {
    let title: String
    let icon: String
    @Binding var isExpanded: Bool
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.default) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: icon)
                        .font(.caption)
                        .foregroundStyle(AppColors.appPrimary)
                        .frame(width: 18)
                    Text(title)
                        .font(.subheadline.weight(.medium))
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

            if isExpanded {
                VStack(spacing: 14) {
                    content()
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
}

// MARK: - Parameter Field Helpers

struct ParamTextField: View {
    let label: String
    @Binding var text: String
    var placeholder: String = ""
    var info: String? = nil
    var keyboardType: UIKeyboardType = .default

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label)
                .font(.footnote.weight(.medium))
                .foregroundStyle(AppColors.textPrimary)

            TextField(placeholder, text: $text)
                .font(.callout)
                .keyboardType(keyboardType)
                .foregroundStyle(AppColors.textPrimary)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(AppColors.inputBg)
                .clipShape(RoundedRectangle(cornerRadius: 8))

            if let info = info {
                Text(info)
                    .font(.caption2)
                    .foregroundStyle(AppColors.textTertiary)
            }
        }
    }
}

struct ParamToggle: View {
    let label: String
    @Binding var isOn: Bool
    var info: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Toggle(isOn: $isOn) {
                Text(label)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(AppColors.textPrimary)
            }
            .tint(AppColors.appPrimary)

            if let info = info {
                Text(info)
                    .font(.caption2)
                    .foregroundStyle(AppColors.textTertiary)
            }
        }
    }
}

struct ParamDropdown<T: Hashable & Identifiable>: View {
    let label: String
    @Binding var selection: T
    let options: [T]
    let displayName: (T) -> String
    var info: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label)
                .font(.footnote.weight(.medium))
                .foregroundStyle(AppColors.textPrimary)

            Menu {
                Picker(label, selection: $selection) {
                    ForEach(options) { option in
                        Text(displayName(option)).tag(option)
                    }
                }
            } label: {
                HStack {
                    Text(displayName(selection))
                        .font(.callout)
                        .foregroundStyle(AppColors.textPrimary)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption)
                        .foregroundStyle(AppColors.textTertiary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(AppColors.inputBg)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(AppColors.border, lineWidth: 0.5)
                )
            }

            if let info = info {
                Text(info)
                    .font(.caption2)
                    .foregroundStyle(AppColors.textTertiary)
            }
        }
    }
}

struct ParamSlider: View {
    let label: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    var step: Double = 0.01
    var displayValue: String
    var info: String? = nil

    var body: some View {
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

            Slider(value: $value, in: range, step: step)
                .tint(AppColors.appPrimary)

            if let info = info {
                Text(info)
                    .font(.caption2)
                    .foregroundStyle(AppColors.textTertiary)
            }
        }
    }
}

// MARK: - Serve Sections

private struct ServeModelSection: View {
    @Bindable var viewModel: CommandGeneratorViewModel
    @State private var isExpanded = true

    var body: some View {
        CollapsibleSection(title: "Model", icon: "cube", isExpanded: $isExpanded) {
            ParamTextField(
                label: "Model Name",
                text: $viewModel.modelName,
                placeholder: "e.g. meta-llama/Llama-3.1-8B-Instruct",
                info: "HuggingFace model ID or local path (required)"
            )

            ParamDropdown(
                label: "Data Type (dtype)",
                selection: $viewModel.dtype,
                options: DTypeOption.allCases,
                displayName: { $0.rawValue },
                info: "Model weight precision. 'auto' uses the model's default."
            )

            ParamDropdown(
                label: "Quantization",
                selection: $viewModel.quantization,
                options: QuantizationOption.allCases,
                displayName: { $0.displayName },
                info: "Quantization method to reduce model size and memory usage."
            )

            ParamToggle(
                label: "Trust Remote Code",
                isOn: $viewModel.trustRemoteCode,
                info: "Allow execution of code from the model repository."
            )

            ParamTextField(
                label: "Max Model Length",
                text: $viewModel.maxModelLen,
                placeholder: "Auto (from model config)",
                info: "Maximum context length. Leave empty to use the model default.",
                keyboardType: .numberPad
            )
        }
    }
}

private struct ServeServerSection: View {
    @Bindable var viewModel: CommandGeneratorViewModel
    @State private var isExpanded = false

    var body: some View {
        CollapsibleSection(title: "Server", icon: "network", isExpanded: $isExpanded) {
            ParamTextField(
                label: "Host",
                text: $viewModel.host,
                placeholder: "0.0.0.0"
            )

            ParamTextField(
                label: "Port",
                text: $viewModel.port,
                placeholder: "8000",
                keyboardType: .numberPad
            )

            ParamTextField(
                label: "API Key",
                text: $viewModel.apiKey,
                placeholder: "Optional"
            )

            ParamTextField(
                label: "Served Model Name",
                text: $viewModel.servedModelName,
                placeholder: "Same as model name",
                info: "Override the model name exposed in the API."
            )
        }
    }
}

private struct ServeParallelismSection: View {
    @Bindable var viewModel: CommandGeneratorViewModel
    @State private var isExpanded = false

    var body: some View {
        CollapsibleSection(title: "Parallelism", icon: "arrow.triangle.branch", isExpanded: $isExpanded) {
            ParamTextField(
                label: "Tensor Parallel Size",
                text: $viewModel.tensorParallelSize,
                placeholder: "1",
                info: "Number of GPUs for tensor parallelism.",
                keyboardType: .numberPad
            )

            ParamTextField(
                label: "Pipeline Parallel Size",
                text: $viewModel.pipelineParallelSize,
                placeholder: "1",
                info: "Number of pipeline stages.",
                keyboardType: .numberPad
            )

            ParamTextField(
                label: "Data Parallel Size",
                text: $viewModel.dataParallelSize,
                placeholder: "1",
                info: "Number of data parallel replicas.",
                keyboardType: .numberPad
            )
        }
    }
}

private struct ServeMemorySection: View {
    @Bindable var viewModel: CommandGeneratorViewModel
    @State private var isExpanded = false

    var body: some View {
        CollapsibleSection(title: "Memory & Performance", icon: "memorychip", isExpanded: $isExpanded) {
            ParamSlider(
                label: "GPU Memory Utilization",
                value: $viewModel.gpuMemoryUtilization,
                range: 0.1...1.0,
                step: 0.05,
                displayValue: String(format: "%.0f%%", viewModel.gpuMemoryUtilization * 100),
                info: "Fraction of GPU memory to use for model weights and KV cache."
            )

            ParamTextField(
                label: "Max Num Sequences",
                text: $viewModel.maxNumSeqs,
                placeholder: "256 (default)",
                info: "Maximum number of sequences per iteration.",
                keyboardType: .numberPad
            )

            ParamToggle(
                label: "Enforce Eager",
                isOn: $viewModel.enforceEager,
                info: "Disable CUDA graph to reduce memory usage at the cost of performance."
            )

            ParamToggle(
                label: "Enable Chunked Prefill",
                isOn: $viewModel.enableChunkedPrefill,
                info: "Split long prompts into chunks to improve time-to-first-token."
            )

            ParamToggle(
                label: "Enable Prefix Caching",
                isOn: $viewModel.enablePrefixCaching,
                info: "Cache KV blocks for shared prefixes to speed up repeated prompts."
            )
        }
    }
}

private struct ServeAdvancedSection: View {
    @Bindable var viewModel: CommandGeneratorViewModel
    @State private var isExpanded = false

    var body: some View {
        CollapsibleSection(title: "Advanced", icon: "slider.horizontal.3", isExpanded: $isExpanded) {
            ParamTextField(
                label: "Seed",
                text: $viewModel.seed,
                placeholder: "0 (default)",
                info: "Random seed for reproducibility.",
                keyboardType: .numberPad
            )

            ParamTextField(
                label: "Max Log Probs",
                text: $viewModel.maxLogprobs,
                placeholder: "20 (default)",
                info: "Maximum number of log probabilities to return.",
                keyboardType: .numberPad
            )

            ParamTextField(
                label: "Chat Template",
                text: $viewModel.chatTemplate,
                placeholder: "Path to Jinja template",
                info: "Override the model's default chat template."
            )

            ParamToggle(
                label: "Enable Auto Tool Choice",
                isOn: $viewModel.enableAutoToolChoice,
                info: "Automatically detect when the model wants to use a tool."
            )

            ParamDropdown(
                label: "Tool Call Parser",
                selection: $viewModel.toolCallParser,
                options: ToolCallParserOption.allCases,
                displayName: { $0.displayName },
                info: "Parser for extracting tool calls from model output."
            )

            ParamTextField(
                label: "Reasoning Parser",
                text: $viewModel.reasoningParser,
                placeholder: "Optional",
                info: "Parser for extracting reasoning content."
            )
        }
    }
}

// MARK: - Bench Sections

private struct BenchTargetSection: View {
    @Bindable var viewModel: CommandGeneratorViewModel
    @State private var isExpanded = true

    var body: some View {
        CollapsibleSection(title: "Target", icon: "scope", isExpanded: $isExpanded) {
            ParamTextField(
                label: "Host",
                text: $viewModel.benchHost,
                placeholder: "127.0.0.1"
            )

            ParamTextField(
                label: "Port",
                text: $viewModel.benchPort,
                placeholder: "8000",
                keyboardType: .numberPad
            )

            ParamTextField(
                label: "Model",
                text: $viewModel.benchModel,
                placeholder: "e.g. meta-llama/Llama-3.1-8B-Instruct",
                info: "Model to benchmark against."
            )

            ParamDropdown(
                label: "Backend",
                selection: $viewModel.benchBackend,
                options: BenchBackendOption.allCases,
                displayName: { $0.rawValue },
                info: "API backend for sending requests."
            )
        }
    }
}

private struct BenchWorkloadSection: View {
    @Bindable var viewModel: CommandGeneratorViewModel
    @State private var isExpanded = false

    var body: some View {
        CollapsibleSection(title: "Workload", icon: "bolt.horizontal", isExpanded: $isExpanded) {
            ParamTextField(
                label: "Number of Prompts",
                text: $viewModel.numPrompts,
                placeholder: "1000",
                info: "Total number of prompts to send.",
                keyboardType: .numberPad
            )

            ParamDropdown(
                label: "Dataset",
                selection: $viewModel.datasetName,
                options: BenchDatasetOption.allCases,
                displayName: { $0.rawValue },
                info: "Prompt source. 'random' generates synthetic prompts."
            )

            ParamTextField(
                label: "Input Length",
                text: $viewModel.inputLen,
                placeholder: "1024",
                info: "Number of input tokens per prompt.",
                keyboardType: .numberPad
            )

            ParamTextField(
                label: "Output Length",
                text: $viewModel.outputLen,
                placeholder: "128",
                info: "Number of output tokens per response.",
                keyboardType: .numberPad
            )

            ParamTextField(
                label: "Request Rate",
                text: $viewModel.requestRate,
                placeholder: "inf",
                info: "Requests per second. 'inf' sends all at once."
            )
        }
    }
}

private struct BenchSamplingSection: View {
    @Bindable var viewModel: CommandGeneratorViewModel
    @State private var isExpanded = false

    var body: some View {
        CollapsibleSection(title: "Sampling", icon: "dice", isExpanded: $isExpanded) {
            ParamTextField(
                label: "Temperature",
                text: $viewModel.benchTemperature,
                placeholder: "Not set",
                info: "Sampling temperature. Leave empty to use server default."
            )

            ParamTextField(
                label: "Top P",
                text: $viewModel.benchTopP,
                placeholder: "Not set",
                info: "Nucleus sampling threshold."
            )

            ParamTextField(
                label: "Top K",
                text: $viewModel.benchTopK,
                placeholder: "Not set",
                info: "Top-K sampling.",
                keyboardType: .numberPad
            )
        }
    }
}

private struct BenchOutputSection: View {
    @Bindable var viewModel: CommandGeneratorViewModel
    @State private var isExpanded = false

    var body: some View {
        CollapsibleSection(title: "Output", icon: "doc.text", isExpanded: $isExpanded) {
            ParamToggle(
                label: "Save Result",
                isOn: $viewModel.saveResult,
                info: "Save benchmark results to a JSON file."
            )

            ParamTextField(
                label: "Result Directory",
                text: $viewModel.resultDir,
                placeholder: "Current directory",
                info: "Directory to save benchmark results."
            )
        }
    }
}

#Preview {
    CommandGeneratorView()
}
