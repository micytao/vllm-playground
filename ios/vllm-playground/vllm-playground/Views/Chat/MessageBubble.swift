import SwiftUI
import UIKit
import MarkdownUI

// MARK: - Emoji Detection

private extension Character {
    var isEmojiCharacter: Bool {
        guard let scalar = unicodeScalars.first else { return false }
        // Filter out basic ASCII/symbols like #, *, 0-9
        if scalar.value < 0x238C && unicodeScalars.count == 1 {
            return false
        }
        return scalar.properties.isEmoji && scalar.properties.isEmojiPresentation
            || unicodeScalars.count > 1 && unicodeScalars.first?.properties.isEmoji == true
    }
}

private extension String {
    /// True if the string is composed entirely of emoji characters.
    var isOnlyEmoji: Bool {
        !isEmpty && allSatisfy { $0.isEmojiCharacter }
    }

    /// The number of visible emoji glyphs.
    var emojiCount: Int {
        filter { $0.isEmojiCharacter }.count
    }
}

// MARK: - Bubble Shape

/// A rounded rectangle with one corner having a smaller radius, mimicking iMessage tails.
struct BubbleShape: Shape {
    let isFromUser: Bool

    func path(in rect: CGRect) -> Path {
        let largeR: CGFloat = 18
        let smallR: CGFloat = 4

        // User: small bottom-trailing, Assistant: small bottom-leading
        let tl = largeR
        let tr = largeR
        let bl = isFromUser ? largeR : smallR
        let br = isFromUser ? smallR : largeR

        return Path { p in
            p.move(to: CGPoint(x: rect.minX + tl, y: rect.minY))
            p.addLine(to: CGPoint(x: rect.maxX - tr, y: rect.minY))
            p.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.minY),
                     tangent2End: CGPoint(x: rect.maxX, y: rect.minY + tr),
                     radius: tr)
            p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - br))
            p.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.maxY),
                     tangent2End: CGPoint(x: rect.maxX - br, y: rect.maxY),
                     radius: br)
            p.addLine(to: CGPoint(x: rect.minX + bl, y: rect.maxY))
            p.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.maxY),
                     tangent2End: CGPoint(x: rect.minX, y: rect.maxY - bl),
                     radius: bl)
            p.addLine(to: CGPoint(x: rect.minX, y: rect.minY + tl))
            p.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.minY),
                     tangent2End: CGPoint(x: rect.minX + tl, y: rect.minY),
                     radius: tl)
        }
    }
}

// MARK: - MessageBubble

struct MessageBubble: View {
    let message: Message
    @State private var showMetrics = false

    /// Whether the trimmed content is purely emoji (and short enough to display large).
    private var isEmojiOnly: Bool {
        let text = message.content.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isOnlyEmoji && text.emojiCount <= 5
    }

    private var isUser: Bool { message.role == .user }
    private var isAssistant: Bool { message.role == .assistant }
    private var isTool: Bool { message.role == .tool }

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            if isUser { Spacer(minLength: 48) }

            // Assistant avatar
            if !isUser {
                AvatarView(type: .assistant, size: 26)
                    .padding(.top, 2)
            }

            VStack(alignment: isUser ? .trailing : .leading, spacing: 4) {
                // Image attachment
                if let imageData = message.imageData,
                   let uiImage = UIImage(data: imageData) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: 220, maxHeight: 220)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                }

                // Tool calls from assistant
                if let toolCallsJSON = message.toolCallsJSON,
                   let data = toolCallsJSON.data(using: .utf8),
                   let toolCalls = try? JSONDecoder().decode([ToolCallResponse].self, from: data) {
                    toolCallsBubble(toolCalls)
                }

                // Main content
                if !message.content.isEmpty {
                    if isTool {
                        toolResultBubble
                    } else if isEmojiOnly {
                        emojiBubble
                    } else if isUser {
                        userBubble
                    } else {
                        assistantBubble
                    }
                }

                // Response metrics chip (assistant only)
                if isAssistant, message.completionTokens != nil || message.generationTimeMs != nil {
                    metricsChip
                }
            }

            if !isUser { Spacer(minLength: 48) }
        }
        .padding(.vertical, 3)
    }

    // MARK: - User Bubble

    private var userBubble: some View {
        Text(message.content)
            .font(.body)
            .foregroundStyle(.white)
            .textSelection(.enabled)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(AppColors.appPrimary)
            .clipShape(BubbleShape(isFromUser: true))
    }

    // MARK: - Assistant Bubble

    private var assistantBubble: some View {
        Markdown(message.content)
            .markdownTheme(.appTheme)
            .textSelection(.enabled)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(AppColors.assistantBubbleBg)
            .clipShape(BubbleShape(isFromUser: false))
    }

    // MARK: - Emoji Bubble (no background, large font)

    private var emojiBubble: some View {
        Text(message.content)
            .font(.system(size: 48))
            .padding(.vertical, 4)
    }

    // MARK: - Tool Result Bubble

    private var toolResultBubble: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let name = message.toolName {
                HStack(spacing: 4) {
                    Image(systemName: "wrench.and.screwdriver.fill")
                        .font(.caption2)
                        .foregroundStyle(AppColors.appPrimary)
                    Text(name)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppColors.textSecondary)
                }
            }
            Text(message.content)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(AppColors.textPrimary)
                .textSelection(.enabled)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppColors.inputBg)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Metrics Chip

    @ViewBuilder
    private var metricsChip: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                    showMetrics.toggle()
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "gauge.with.dots.needle.33percent")
                        .font(.caption2)
                    if let tps = message.tokensPerSecond {
                        Text(String(format: "%.1f tok/s", tps))
                            .font(.caption2.monospacedDigit())
                            .contentTransition(.numericText())
                    } else if let time = message.generationTimeMs {
                        Text(String(format: "%.0fms", time))
                            .font(.caption2.monospacedDigit())
                    }
                    Image(systemName: showMetrics ? "chevron.up" : "chevron.down")
                        .font(.system(size: 8, weight: .bold))
                }
                .foregroundStyle(AppColors.textTertiary)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(AppColors.inputBg)
                .clipShape(Capsule())
                .overlay(
                    Capsule()
                        .stroke(AppColors.border, lineWidth: 1)
                )
            }
            .buttonStyle(.plain)

            // Expanded metrics
            if showMetrics {
                let columns = [
                    GridItem(.flexible(), spacing: 8),
                    GridItem(.flexible(), spacing: 8)
                ]
                LazyVGrid(columns: columns, spacing: 8) {
                    if let pt = message.promptTokens {
                        metricCell(icon: "arrow.right.circle", label: "Prompt", value: "\(pt)", tint: .blue)
                    }
                    if let ct = message.completionTokens {
                        metricCell(icon: "text.bubble", label: "Completion", value: "\(ct)", tint: .purple)
                    }
                    if let time = message.generationTimeMs {
                        let display = time >= 1000
                            ? String(format: "%.1fs", time / 1000)
                            : String(format: "%.0fms", time)
                        metricCell(icon: "clock", label: "Time", value: display, tint: .orange)
                    }
                    if let tps = message.tokensPerSecond {
                        metricCell(icon: "gauge.with.dots.needle.67percent", label: "Speed", value: String(format: "%.1f t/s", tps), tint: AppColors.appPrimary)
                    }
                }
                .padding(.top, 6)
                .transition(.opacity.combined(with: .scale(scale: 0.95)))
            }
        }
    }

    private func metricCell(icon: String, label: String, value: String, tint: Color) -> some View {
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.caption2)
                    .foregroundStyle(tint)
                Text(label)
                    .font(.caption2)
                    .foregroundStyle(AppColors.textTertiary)
            }
            Text(value)
                .font(.footnote.monospacedDigit().weight(.semibold))
                .foregroundStyle(AppColors.textPrimary)
                .contentTransition(.numericText())
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .padding(.horizontal, 6)
        .background(AppColors.inputBg)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    // MARK: - Tool Calls Bubble

    private func toolCallsBubble(_ toolCalls: [ToolCallResponse]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(toolCalls, id: \.id) { tc in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Image(systemName: "wrench.and.screwdriver.fill")
                            .font(.caption2)
                            .foregroundStyle(AppColors.appPrimary)
                        Text(tc.function.name)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(AppColors.textPrimary)
                    }
                    Text(formatJSON(tc.function.arguments))
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(AppColors.textSecondary)
                        .lineLimit(6)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(AppColors.appPrimary.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
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

#Preview("User") {
    VStack(spacing: 8) {
        MessageBubble(message: Message(role: .user, content: "Hello, how are you?"))
        MessageBubble(message: Message(role: .user, content: "😀🎉🔥"))
        MessageBubble(message: Message(role: .user, content: "That's great! 🎉"))
    }
    .padding()
    .background(AppColors.pageBg)
}

#Preview("Assistant with Metrics") {
    MessageBubble(message: Message(
        role: .assistant,
        content: "I'm doing well! Here's some **bold** and *italic* text.",
        promptTokens: 24,
        completionTokens: 48,
        generationTimeMs: 1250
    ))
    .padding()
    .background(AppColors.pageBg)
}
