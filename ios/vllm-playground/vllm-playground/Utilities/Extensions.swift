import Foundation
import SwiftUI

// MARK: - Date Formatting

extension Date {
    var relativeFormatted: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: self, relativeTo: Date())
    }

    var shortFormatted: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter.string(from: self)
    }
}

// MARK: - String Helpers

extension String {
    func truncated(to maxLength: Int) -> String {
        if self.count <= maxLength { return self }
        return String(self.prefix(maxLength)) + "..."
    }

    var firstLineTitle: String {
        let firstLine = self.components(separatedBy: .newlines).first ?? self
        return firstLine.truncated(to: 50)
    }
}

// MARK: - Data Helpers

extension Data {
    func toBase64DataURL(mimeType: String = "image/jpeg") -> String {
        let base64 = self.base64EncodedString()
        return "data:\(mimeType);base64,\(base64)"
    }
}

// MARK: - View Helpers

extension View {
    @ViewBuilder
    func `if`<Content: View>(_ condition: Bool, transform: (Self) -> Content) -> some View {
        if condition {
            transform(self)
        } else {
            self
        }
    }
}
