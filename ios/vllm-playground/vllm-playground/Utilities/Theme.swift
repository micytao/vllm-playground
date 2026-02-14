import SwiftUI
import UIKit

// MARK: - Hex Color Helper (standalone function)

func hexColor(_ hex: String) -> Color {
    var int: UInt64 = 0
    Scanner(string: hex).scanHexInt64(&int)
    let r = Double((int >> 16) & 0xFF) / 255
    let g = Double((int >> 8) & 0xFF) / 255
    let b = Double(int & 0xFF) / 255
    return Color(.sRGB, red: r, green: g, blue: b, opacity: 1)
}

func adaptiveColor(light: String, dark: String) -> Color {
    Color(uiColor: UIColor { traits in
        var int: UInt64 = 0
        let hex = traits.userInterfaceStyle == .dark ? dark : light
        Scanner(string: hex).scanHexInt64(&int)
        let r = CGFloat((int >> 16) & 0xFF) / 255
        let g = CGFloat((int >> 8) & 0xFF) / 255
        let b = CGFloat(int & 0xFF) / 255
        return UIColor(red: r, green: g, blue: b, alpha: 1)
    })
}

// MARK: - App Colors
// Palette aligned with the vllm-playground web app (style.css)
// Dark  → Indigo primary, slate backgrounds
// Light → Sky-blue primary (vLLM brand), white/slate backgrounds

enum AppColors {
    // Sidebar
    static var sidebarBg: Color { adaptiveColor(light: "F8FAFC", dark: "0C1322") }
    static var sidebarItem: Color { adaptiveColor(light: "F1F5F9", dark: "1E293B") }

    // Page backgrounds
    static var pageBg: Color { adaptiveColor(light: "F8FAFC", dark: "0F172A") }
    static var cardBg: Color { adaptiveColor(light: "FFFFFF", dark: "1E293B") }
    static var inputBg: Color { adaptiveColor(light: "F1F5F9", dark: "334155") }

    // Text
    static var textPrimary: Color { adaptiveColor(light: "0F172A", dark: "F1F5F9") }
    static var textSecondary: Color { adaptiveColor(light: "64748B", dark: "94A3B8") }
    static var textTertiary: Color { adaptiveColor(light: "94A3B8", dark: "475569") }

    // Message bubbles
    static var userMsgBg: Color { adaptiveColor(light: "F1F5F9", dark: "334155") }
    static var assistantBubbleBg: Color { adaptiveColor(light: "E2E8F0", dark: "1E293B") }

    // Primary accent -- indigo (dark) / sky-blue (light), matching vllm.ai
    static var appPrimary: Color { adaptiveColor(light: "0EA5E9", dark: "6366F1") }

    // Semantic colours
    static var appSuccess: Color { hexColor("10B981") }        // green -- health / success
    static var appWarning: Color { hexColor("F59E0B") }        // amber
    static var appRed: Color { adaptiveColor(light: "EF4444", dark: "F87171") }

    // Legacy alias (prefer appPrimary for new code)
    static var appGreen: Color { appPrimary }

    // Border
    static var border: Color { adaptiveColor(light: "E2E8F0", dark: "475569") }
}

// MARK: - View Modifiers

struct CardStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(16)
            .background(AppColors.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

extension View {
    func cardStyle() -> some View {
        modifier(CardStyle())
    }
}

// MARK: - Avatar

struct AvatarView: View {
    enum AvatarType {
        case user
        case assistant
    }

    let type: AvatarType
    var size: CGFloat = 28

    var body: some View {
        if type == .assistant {
            Image("VLLMLogo")
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
        } else {
            ZStack {
                Circle()
                    .fill(AppColors.userMsgBg)
                    .frame(width: size, height: size)

                Image(systemName: "person.fill")
                    .font(.system(size: size * 0.45, weight: .medium))
                    .foregroundStyle(AppColors.textSecondary)
            }
        }
    }
}

// MARK: - Model Pill Selector

struct ModelPillSelector: View {
    @Binding var selectedModel: String
    let models: [String]

    var body: some View {
        Menu {
            ForEach(models.sorted(), id: \.self) { model in
                Button {
                    selectedModel = model
                } label: {
                    HStack {
                        Text(model)
                        if model == selectedModel {
                            Image(systemName: "checkmark")
                        }
                    }
                }
            }
        } label: {
            modelPillLabel
        }
    }

    private var modelPillLabel: some View {
        HStack(spacing: 4) {
            Text(displayName)
                .font(.footnote.weight(.medium))
                .foregroundStyle(AppColors.textPrimary)
            Image(systemName: "chevron.down")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(AppColors.textSecondary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(AppColors.cardBg)
        .clipShape(Capsule())
    }

    private var displayName: String {
        if selectedModel.isEmpty { return String(localized: "Select Model") }
        let parts = selectedModel.split(separator: "/")
        return String(parts.last ?? Substring(selectedModel))
    }
}

// MARK: - Server-Grouped Model Picker

/// Displays models from all servers, grouped by server name.
struct ServerModelPicker: View {
    @Binding var selectedModel: String
    let servers: [ServerProfile]

    var body: some View {
        Menu {
            ForEach(serversWithModels) { server in
                Section(server.name) {
                    ForEach(server.availableModels.sorted(), id: \.self) { model in
                        Button {
                            selectedModel = model
                        } label: {
                            HStack {
                                Text(model)
                                if model == selectedModel {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(displayName)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(AppColors.textPrimary)
                Image(systemName: "chevron.down")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(AppColors.textSecondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(AppColors.cardBg)
            .clipShape(Capsule())
        }
    }

    private var serversWithModels: [ServerProfile] {
        servers.filter { !$0.availableModels.isEmpty }
    }

    private var displayName: String {
        if selectedModel.isEmpty { return String(localized: "Select Model") }
        let parts = selectedModel.split(separator: "/")
        return String(parts.last ?? Substring(selectedModel))
    }
}
