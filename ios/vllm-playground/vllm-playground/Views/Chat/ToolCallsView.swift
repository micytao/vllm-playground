import SwiftUI
import SwiftData
import UIKit

/// Inline view for pending tool calls. Shows each tool call with its arguments
/// and a text field for the user to provide results.
struct ToolCallsView: View {
    @Bindable var viewModel: ChatViewModel
    @Environment(\.modelContext) private var modelContext
    @State private var results: [String: String] = [:]  // toolCallId -> result text

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            // Header
            HStack(spacing: 8) {
                // Pulsing green dot
                Circle()
                    .fill(AppColors.appPrimary)
                    .frame(width: 8, height: 8)
                    .modifier(PulsingDotModifier())

                Image(systemName: "wrench.and.screwdriver.fill")
                    .font(.subheadline)
                    .foregroundStyle(AppColors.appPrimary)
                Text("Tool Calls")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(AppColors.textPrimary)
                Spacer()
                Text("\(viewModel.pendingToolCalls.count) pending")
                    .font(.caption)
                    .foregroundStyle(AppColors.textTertiary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(AppColors.inputBg)
                    .clipShape(Capsule())
            }

            ForEach(viewModel.pendingToolCalls, id: \.id) { tc in
                toolCallCard(tc)
            }

            // Submit all results
            Button {
                submitAll()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.right.circle.fill")
                    Text("Continue Conversation")
                }
                .font(.callout.weight(.semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(
                    LinearGradient(
                        colors: allResultsFilled
                            ? [AppColors.appPrimary, AppColors.appPrimary.opacity(0.8)]
                            : [AppColors.textTertiary, AppColors.textTertiary],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .shadow(color: allResultsFilled ? AppColors.appPrimary.opacity(0.3) : .clear, radius: 8, y: 4)
            }
            .disabled(!allResultsFilled)
            .animation(.easeInOut(duration: 0.2), value: allResultsFilled)
        }
        .padding(16)
        .background(AppColors.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .padding(.horizontal, 16)
        .onAppear {
            for tc in viewModel.pendingToolCalls {
                if results[tc.id] == nil {
                    results[tc.id] = ""
                }
            }
        }
    }

    // MARK: - Tool Call Card

    private func toolCallCard(_ tc: ToolCallResponse) -> some View {
        HStack(spacing: 0) {
            // Left green accent bar
            RoundedRectangle(cornerRadius: 2)
                .fill(AppColors.appPrimary)
                .frame(width: 4)

            VStack(alignment: .leading, spacing: 10) {
                // Function name + Copy button
                HStack(spacing: 6) {
                    Image(systemName: "function")
                        .font(.caption2)
                        .foregroundStyle(AppColors.appPrimary)
                    Text(tc.function.name)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(AppColors.textPrimary)

                    Spacer()

                    // Copy arguments button
                    Button {
                        UIPasteboard.general.string = formatJSON(tc.function.arguments)
                    } label: {
                        Image(systemName: "doc.on.doc")
                            .font(.caption)
                            .foregroundStyle(AppColors.textTertiary)
                            .padding(5)
                            .background(AppColors.inputBg)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                }

                // Arguments
                Text(formatJSON(tc.function.arguments))
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(AppColors.textSecondary)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(AppColors.inputBg)
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                // Result input
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("Result")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(AppColors.textTertiary)
                        Spacer()
                        // Skip button
                        Button {
                            results[tc.id] = "null"
                        } label: {
                            Text("Skip")
                                .font(.caption2.weight(.medium))
                                .foregroundStyle(AppColors.textTertiary)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(AppColors.inputBg)
                                .clipShape(Capsule())
                        }
                    }
                    TextField("Enter tool result...", text: binding(for: tc.id), axis: .vertical)
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(AppColors.textPrimary)
                        .lineLimit(1...5)
                        .padding(10)
                        .background(AppColors.inputBg)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(
                                    !(results[tc.id]?.isEmpty ?? true) ? AppColors.appPrimary.opacity(0.3) : AppColors.border,
                                    lineWidth: 1
                                )
                        )
                }
            }
            .padding(12)
        }
        .background(AppColors.appPrimary.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Helpers

    private func binding(for id: String) -> Binding<String> {
        Binding(
            get: { results[id] ?? "" },
            set: { results[id] = $0 }
        )
    }

    private var allResultsFilled: Bool {
        viewModel.pendingToolCalls.allSatisfy { tc in
            !(results[tc.id]?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
        }
    }

    private func submitAll() {
        let toolResults = viewModel.pendingToolCalls.map { tc in
            (toolCallId: tc.id, name: tc.function.name, content: results[tc.id] ?? "")
        }
        viewModel.submitToolResults(toolResults, context: modelContext)
    }

    private func formatJSON(_ jsonString: String) -> String {
        guard let data = jsonString.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data),
              let pretty = try? JSONSerialization.data(withJSONObject: obj, options: .prettyPrinted),
              let str = String(data: pretty, encoding: .utf8) else {
            return jsonString
        }
        return str
    }
}

// MARK: - Pulsing Dot Modifier

private struct PulsingDotModifier: ViewModifier {
    @State private var isPulsing = false

    func body(content: Content) -> some View {
        content
            .opacity(isPulsing ? 0.3 : 1.0)
            .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: isPulsing)
            .onAppear { isPulsing = true }
    }
}
