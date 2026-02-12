import Foundation
import SwiftUI
import MarkdownUI

// MARK: - App Markdown Theme

/// Custom MarkdownUI theme matching the vLLM Playground web app styling.
/// Supports GFM: bold, italic, headings, lists, blockquotes, code blocks,
/// inline code, tables, links, horizontal rules.
extension Theme {
    @MainActor static var appTheme: Theme {
        .gitHub
            .text {
                ForegroundColor(AppColors.textPrimary)
                FontSize(.em(1.0))
            }
            .link {
                ForegroundColor(AppColors.appPrimary)
            }
            .heading1 { configuration in
                configuration.label
                    .markdownTextStyle {
                        FontWeight(.bold)
                        FontSize(.em(1.5))
                        ForegroundColor(AppColors.textPrimary)
                    }
                    .markdownMargin(top: 12, bottom: 8)
            }
            .heading2 { configuration in
                configuration.label
                    .markdownTextStyle {
                        FontWeight(.bold)
                        FontSize(.em(1.3))
                        ForegroundColor(AppColors.textPrimary)
                    }
                    .markdownMargin(top: 10, bottom: 6)
            }
            .heading3 { configuration in
                configuration.label
                    .markdownTextStyle {
                        FontWeight(.semibold)
                        FontSize(.em(1.15))
                        ForegroundColor(AppColors.textPrimary)
                    }
                    .markdownMargin(top: 8, bottom: 4)
            }
            .codeBlock { configuration in
                ScrollView(.horizontal, showsIndicators: false) {
                    configuration.label
                        .markdownTextStyle {
                            FontFamilyVariant(.monospaced)
                            FontSize(.em(0.88))
                            ForegroundColor(AppColors.textPrimary)
                        }
                }
                .padding(12)
                .background(AppColors.inputBg)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .markdownMargin(top: 6, bottom: 6)
            }
            .code {
                FontFamilyVariant(.monospaced)
                FontSize(.em(0.88))
                BackgroundColor(AppColors.inputBg)
            }
            .blockquote { configuration in
                HStack(spacing: 0) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(AppColors.border)
                        .frame(width: 3)
                    configuration.label
                        .markdownTextStyle {
                            ForegroundColor(AppColors.textSecondary)
                            FontStyle(.italic)
                        }
                        .padding(.leading, 10)
                }
                .markdownMargin(top: 6, bottom: 6)
            }
            .table { configuration in
                configuration.label
                    .markdownTableBorderStyle(
                        .init(color: AppColors.border, width: 1)
                    )
                    .markdownTableBackgroundStyle(
                        .alternatingRows(AppColors.cardBg, AppColors.inputBg.opacity(0.5))
                    )
                    .markdownMargin(top: 6, bottom: 6)
            }
            .thematicBreak {
                Divider()
                    .overlay(AppColors.border)
                    .markdownMargin(top: 12, bottom: 12)
            }
    }
}

// MARK: - Legacy Renderer (kept for inline-only use cases)

/// Renders markdown strings into AttributedString for SwiftUI Text views.
enum MarkdownRenderer {
    /// Convert a markdown string to AttributedString (inline only).
    /// Falls back to plain text if parsing fails.
    static func render(_ markdown: String) -> AttributedString {
        do {
            let attributed = try AttributedString(
                markdown: markdown,
                options: .init(
                    allowsExtendedAttributes: true,
                    interpretedSyntax: .inlineOnlyPreservingWhitespace,
                    failurePolicy: .returnPartiallyParsedIfPossible
                )
            )
            return attributed
        } catch {
            return AttributedString(markdown)
        }
    }

    /// Render with full block-level markdown (headings, lists, code blocks).
    static func renderFull(_ markdown: String) -> AttributedString {
        do {
            let attributed = try AttributedString(
                markdown: markdown,
                options: .init(
                    allowsExtendedAttributes: true,
                    interpretedSyntax: .full,
                    failurePolicy: .returnPartiallyParsedIfPossible
                )
            )
            return attributed
        } catch {
            return AttributedString(markdown)
        }
    }
}
