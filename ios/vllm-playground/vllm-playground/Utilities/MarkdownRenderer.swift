import Foundation
import SwiftUI

/// Renders markdown strings into AttributedString for SwiftUI Text views.
enum MarkdownRenderer {
    /// Convert a markdown string to AttributedString.
    /// Falls back to plain text if parsing fails.
    static func render(_ markdown: String) -> AttributedString {
        do {
            var attributed = try AttributedString(
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
