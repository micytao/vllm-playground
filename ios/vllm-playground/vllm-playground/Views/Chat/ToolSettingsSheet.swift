import SwiftUI
import UIKit

struct ToolSettingsSheet: View {
    @Bindable var viewModel: ChatViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var showAddCustom = false
    @State private var customJSON = ""

    var body: some View {
        NavigationStack {
            ZStack {
                AppColors.pageBg.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 20) {
                        // Info banner
                        HStack(spacing: 10) {
                            Image(systemName: "info.circle.fill")
                                .font(.subheadline)
                                .foregroundStyle(.blue)
                            Text("Tool calling uses non-streaming mode for reliable function call parsing.")
                                .font(.caption)
                                .foregroundStyle(AppColors.textSecondary)
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.blue.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 12))

                        // Tool Choice
                        settingCard {
                            VStack(alignment: .leading, spacing: 12) {
                                sectionLabel("Tool Choice")
                                Picker("Tool Choice", selection: $viewModel.toolChoice) {
                                    Text("Auto").tag("auto")
                                    Text("None").tag("none")
                                }
                                .pickerStyle(.segmented)

                                Toggle(isOn: $viewModel.parallelToolCalls) {
                                    HStack(spacing: 8) {
                                        Image(systemName: "arrow.triangle.branch")
                                            .font(.caption)
                                            .foregroundStyle(AppColors.textTertiary)
                                        Text("Parallel tool calls")
                                            .font(.subheadline)
                                            .foregroundStyle(AppColors.textSecondary)
                                    }
                                }
                                .tint(AppColors.appPrimary)
                            }
                        }

                        // Active tools
                        if !viewModel.tools.isEmpty {
                            settingCard {
                                VStack(alignment: .leading, spacing: 12) {
                                    HStack {
                                        sectionLabel("Active Tools")
                                        Text("\(viewModel.tools.count)")
                                            .font(.caption2.weight(.bold))
                                            .foregroundStyle(.white)
                                            .padding(.horizontal, 7)
                                            .padding(.vertical, 2)
                                            .background(AppColors.appPrimary)
                                            .clipShape(Capsule())
                                        Spacer()
                                        Button {
                                            withAnimation(.spring(response: 0.3)) {
                                                viewModel.tools.removeAll()
                                            }
                                        } label: {
                                            Text("Clear All")
                                                .font(.footnote)
                                                .foregroundStyle(AppColors.appRed)
                                        }
                                    }

                                    ForEach(Array(viewModel.tools.enumerated()), id: \.element.id) { index, tool in
                                        if index > 0 {
                                            Divider().background(AppColors.border)
                                        }
                                        HStack(spacing: 10) {
                                            ZStack {
                                                Circle()
                                                    .fill(AppColors.appPrimary.opacity(0.12))
                                                    .frame(width: 32, height: 32)
                                                Image(systemName: "wrench.and.screwdriver.fill")
                                                    .font(.caption2)
                                                    .foregroundStyle(AppColors.appPrimary)
                                            }

                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(tool.function.name)
                                                    .font(.subheadline.weight(.medium))
                                                    .foregroundStyle(AppColors.textPrimary)
                                                if let desc = tool.function.description {
                                                    Text(desc)
                                                        .font(.caption)
                                                        .foregroundStyle(AppColors.textTertiary)
                                                        .lineLimit(1)
                                                }
                                            }

                                            Spacer()

                                            Button {
                                                withAnimation(.spring(response: 0.3)) {
                                                    viewModel.tools.removeAll { $0.id == tool.id }
                                                }
                                            } label: {
                                                Image(systemName: "minus.circle.fill")
                                                    .font(.body)
                                                    .foregroundStyle(AppColors.appRed.opacity(0.7))
                                            }
                                        }
                                        .padding(.vertical, 2)
                                    }
                                }
                            }
                        }

                        // Presets
                        settingCard {
                            VStack(alignment: .leading, spacing: 12) {
                                sectionLabel("Presets")

                                ForEach(Array(ToolPreset.allCases.enumerated()), id: \.element.id) { index, preset in
                                    if index > 0 {
                                        Divider().background(AppColors.border)
                                    }
                                    Button {
                                        withAnimation(.spring(response: 0.3)) {
                                            addPreset(preset)
                                        }
                                    } label: {
                                        HStack(spacing: 12) {
                                            ZStack {
                                                Circle()
                                                    .fill(presetColor(preset).opacity(0.12))
                                                    .frame(width: 36, height: 36)
                                                Image(systemName: preset.icon)
                                                    .font(.callout.weight(.medium))
                                                    .foregroundStyle(presetColor(preset))
                                            }

                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(preset.name)
                                                    .font(.subheadline.weight(.medium))
                                                    .foregroundStyle(AppColors.textPrimary)
                                                Text(preset.description)
                                                    .font(.caption)
                                                    .foregroundStyle(AppColors.textTertiary)
                                            }

                                            Spacer()

                                            if isPresetActive(preset) {
                                                Image(systemName: "checkmark.circle.fill")
                                                    .foregroundStyle(AppColors.appPrimary)
                                                    .font(.body)
                                                    .transition(.scale.combined(with: .opacity))
                                            } else {
                                                Image(systemName: "plus.circle")
                                                    .foregroundStyle(AppColors.textTertiary)
                                                    .font(.body)
                                            }
                                        }
                                        .padding(.vertical, 2)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }

                        // Custom tool
                        settingCard {
                            VStack(alignment: .leading, spacing: 10) {
                                sectionLabel("Custom Tool")

                                if showAddCustom {
                                    TextEditor(text: $customJSON)
                                        .font(.system(.caption, design: .monospaced))
                                        .foregroundStyle(AppColors.textPrimary)
                                        .scrollContentBackground(.hidden)
                                        .frame(minHeight: 150)
                                        .padding(10)
                                        .background(AppColors.inputBg)
                                        .clipShape(RoundedRectangle(cornerRadius: 10))
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 10)
                                                .stroke(AppColors.border, lineWidth: 1)
                                        )

                                    HStack {
                                        Button {
                                            showAddCustom = false
                                            customJSON = ""
                                        } label: {
                                            Text("Cancel")
                                                .font(.footnote)
                                                .foregroundStyle(AppColors.textSecondary)
                                        }

                                        Spacer()

                                        Button {
                                            if let clipboard = UIPasteboard.general.string {
                                                customJSON = clipboard
                                            }
                                        } label: {
                                            Label("Paste", systemImage: "doc.on.clipboard")
                                                .font(.footnote)
                                                .foregroundStyle(AppColors.textSecondary)
                                        }

                                        Button {
                                            addCustomTool()
                                        } label: {
                                            Text("Add Tool")
                                                .font(.footnote.weight(.semibold))
                                                .foregroundStyle(.white)
                                                .padding(.horizontal, 14)
                                                .padding(.vertical, 6)
                                                .background(customJSON.isEmpty ? AppColors.textTertiary : AppColors.appPrimary)
                                                .clipShape(Capsule())
                                        }
                                        .disabled(customJSON.isEmpty)
                                    }
                                } else {
                                    Button {
                                        customJSON = sampleToolJSON
                                        showAddCustom = true
                                    } label: {
                                        HStack(spacing: 10) {
                                            ZStack {
                                                Circle()
                                                    .strokeBorder(AppColors.border, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                                                    .frame(width: 36, height: 36)
                                                Image(systemName: "plus")
                                                    .font(.callout.weight(.medium))
                                                    .foregroundStyle(AppColors.textTertiary)
                                            }
                                            Text("Add Custom Tool (JSON)")
                                                .font(.subheadline)
                                                .foregroundStyle(AppColors.textSecondary)
                                            Spacer()
                                        }
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                    .padding(16)
                }
            }
            .navigationTitle("Tool Calling")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(AppColors.appPrimary)
                        .fontWeight(.semibold)
                }
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

    private func presetColor(_ preset: ToolPreset) -> Color {
        switch preset {
        case .weather: return .blue
        case .calculator: return .purple
        case .search: return .orange
        case .codeExecution: return AppColors.appPrimary
        case .database: return .pink
        }
    }

    private func addPreset(_ preset: ToolPreset) {
        if isPresetActive(preset) {
            let presetNames = Set(preset.tools.map(\.function.name))
            viewModel.tools.removeAll { presetNames.contains($0.function.name) }
        } else {
            viewModel.tools.append(contentsOf: preset.tools)
        }
    }

    private func isPresetActive(_ preset: ToolPreset) -> Bool {
        let presetNames = Set(preset.tools.map(\.function.name))
        let activeNames = Set(viewModel.tools.map(\.function.name))
        return presetNames.isSubset(of: activeNames)
    }

    private func addCustomTool() {
        guard let data = customJSON.data(using: .utf8),
              let tool = try? JSONDecoder().decode(ToolDefinition.self, from: data) else {
            if let data = customJSON.data(using: .utf8),
               let fn = try? JSONDecoder().decode(ToolFunction.self, from: data) {
                viewModel.tools.append(ToolDefinition(function: fn))
                showAddCustom = false
                customJSON = ""
            }
            return
        }
        viewModel.tools.append(tool)
        showAddCustom = false
        customJSON = ""
    }

    private var sampleToolJSON: String {
        """
        {
          "type": "function",
          "function": {
            "name": "my_tool",
            "description": "Description of what the tool does",
            "parameters": {
              "type": "object",
              "properties": {
                "param1": {
                  "type": "string",
                  "description": "Parameter description"
                }
              },
              "required": ["param1"]
            }
          }
        }
        """
    }
}

#Preview {
    ToolSettingsSheet(viewModel: ChatViewModel.preview())
}
