import SwiftUI

enum AppLanguage: String, CaseIterable {
    case system
    case en
    case zhHans = "zh-Hans"

    var displayName: LocalizedStringKey {
        switch self {
        case .system: return "System"
        case .en: return "English"
        case .zhHans: return "简体中文"
        }
    }

    var icon: String {
        switch self {
        case .system: return "globe"
        case .en: return "a.circle"
        case .zhHans: return "character.textbox"
        }
    }

    var locale: Locale? {
        switch self {
        case .system: return nil
        case .en: return Locale(identifier: "en")
        case .zhHans: return Locale(identifier: "zh-Hans")
        }
    }
}

enum AppTheme: String, CaseIterable {
    case system
    case light
    case dark

    var displayName: LocalizedStringKey {
        switch self {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }

    var icon: String {
        switch self {
        case .system: return "circle.lefthalf.filled"
        case .light: return "sun.max.fill"
        case .dark: return "moon.fill"
        }
    }
}

struct AppSettingsView: View {
    @Environment(\.showSidebar) private var showSidebar
    @AppStorage("appTheme") private var appTheme: AppTheme = .system
    @AppStorage("appLanguage") private var appLanguage: AppLanguage = .system
    @AppStorage("defaultTemperature") private var defaultTemperature: Double = 0.7
    @AppStorage("defaultMaxTokens") private var defaultMaxTokens: Int = 1024

    var body: some View {
        NavigationStack {
            ZStack {
                AppColors.pageBg.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 20) {
                        // Theme
                        settingCard {
                            VStack(alignment: .leading, spacing: 12) {
                                sectionLabel("Appearance")

                                HStack(spacing: 8) {
                                    ForEach(AppTheme.allCases, id: \.self) { theme in
                                        Button {
                                            withAnimation { appTheme = theme }
                                        } label: {
                                            VStack(spacing: 6) {
                                                Image(systemName: theme.icon)
                                                    .font(.title3)
                                                    .foregroundStyle(
                                                        appTheme == theme ? AppColors.appPrimary : AppColors.textTertiary
                                                    )
                                                Text(theme.displayName)
                                                    .font(.caption.weight(.medium))
                                                    .foregroundStyle(
                                                        appTheme == theme ? AppColors.textPrimary : AppColors.textSecondary
                                                    )
                                            }
                                            .frame(maxWidth: .infinity)
                                            .padding(.vertical, 12)
                                            .background(
                                                appTheme == theme ? AppColors.appPrimary.opacity(0.1) : AppColors.inputBg
                                            )
                                            .clipShape(RoundedRectangle(cornerRadius: 12))
                                            .overlay(
                                                RoundedRectangle(cornerRadius: 12)
                                                    .stroke(
                                                        appTheme == theme ? AppColors.appPrimary.opacity(0.4) : Color.clear,
                                                        lineWidth: 1.5
                                                    )
                                            )
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                            }
                        }

                        // Language
                        settingCard {
                            VStack(alignment: .leading, spacing: 12) {
                                sectionLabel("Language")

                                HStack(spacing: 8) {
                                    ForEach(AppLanguage.allCases, id: \.self) { lang in
                                        Button {
                                            withAnimation { appLanguage = lang }
                                        } label: {
                                            VStack(spacing: 6) {
                                                Image(systemName: lang.icon)
                                                    .font(.title3)
                                                    .foregroundStyle(
                                                        appLanguage == lang ? AppColors.appPrimary : AppColors.textTertiary
                                                    )
                                                Text(lang.displayName)
                                                    .font(.caption.weight(.medium))
                                                    .foregroundStyle(
                                                        appLanguage == lang ? AppColors.textPrimary : AppColors.textSecondary
                                                    )
                                            }
                                            .frame(maxWidth: .infinity)
                                            .padding(.vertical, 12)
                                            .background(
                                                appLanguage == lang ? AppColors.appPrimary.opacity(0.1) : AppColors.inputBg
                                            )
                                            .clipShape(RoundedRectangle(cornerRadius: 12))
                                            .overlay(
                                                RoundedRectangle(cornerRadius: 12)
                                                    .stroke(
                                                        appLanguage == lang ? AppColors.appPrimary.opacity(0.4) : Color.clear,
                                                        lineWidth: 1.5
                                                    )
                                            )
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                            }
                        }

                        // Defaults
                        settingCard {
                            VStack(alignment: .leading, spacing: 16) {
                                sectionLabel("Chat Defaults")

                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Text("Temperature")
                                            .font(.subheadline)
                                            .foregroundStyle(AppColors.textSecondary)
                                        Spacer()
                                        Text(String(format: "%.1f", defaultTemperature))
                                            .font(.subheadline.monospacedDigit())
                                            .foregroundStyle(AppColors.textPrimary)
                                    }
                                    Slider(value: $defaultTemperature, in: 0...2, step: 0.1)
                                        .tint(AppColors.appPrimary)
                                }

                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Text("Max Tokens")
                                            .font(.subheadline)
                                            .foregroundStyle(AppColors.textSecondary)
                                        Spacer()
                                        Text("\(defaultMaxTokens)")
                                            .font(.subheadline.monospacedDigit())
                                            .foregroundStyle(AppColors.textPrimary)
                                    }
                                    Slider(
                                        value: Binding(
                                            get: { Double(defaultMaxTokens) },
                                            set: { defaultMaxTokens = Int($0) }
                                        ),
                                        in: 64...4096,
                                        step: 64
                                    )
                                    .tint(AppColors.appPrimary)
                                }
                            }
                        }

                        // About
                        settingCard {
                            VStack(spacing: 16) {
                                // App branding & author
                                VStack(spacing: 12) {
                                    Image("VLLMLogo")
                                        .resizable()
                                        .scaledToFit()
                                        .frame(width: 64, height: 64)

                                    Text("vLLM Playground")
                                        .font(.headline)
                                        .foregroundStyle(AppColors.textPrimary)

                                    HStack(spacing: 6) {
                                        Text("by")
                                            .font(.subheadline)
                                            .foregroundStyle(AppColors.textTertiary)
                                        Image("AuthorMascot")
                                            .resizable()
                                            .scaledToFill()
                                            .frame(width: 22, height: 22)
                                            .clipShape(Circle())
                                        Text("micytao")
                                            .font(.subheadline.weight(.medium))
                                            .foregroundStyle(AppColors.textSecondary)
                                    }
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.top, 4)

                                Divider().background(AppColors.border)

                                VStack(spacing: 0) {
                                    infoRow("Version", "0.1.0")
                                    Divider().background(AppColors.border)
                                    infoRow("Platform", "iOS")
                                }

                                Divider().background(AppColors.border)

                                // Star on GitHub
                                Link(destination: URL(string: "https://github.com/micytao/vllm-playground")!) {
                                    HStack(spacing: 10) {
                                        Image(systemName: "star.fill")
                                            .font(.callout)
                                            .foregroundStyle(.yellow)
                                        Text("Star on GitHub")
                                            .font(.subheadline.weight(.medium))
                                            .foregroundStyle(AppColors.textPrimary)
                                            .lineLimit(1)
                                            .layoutPriority(1)
                                        Spacer()
                                        Text("micytao/vllm-playground")
                                            .font(.caption)
                                            .foregroundStyle(AppColors.textTertiary)
                                            .lineLimit(1)
                                            .minimumScaleFactor(0.7)
                                        Image(systemName: "arrow.up.right")
                                            .font(.caption2)
                                            .foregroundStyle(AppColors.textTertiary)
                                    }
                                    .padding(12)
                                    .background(AppColors.inputBg)
                                    .clipShape(RoundedRectangle(cornerRadius: 12))
                                }

                                Link(destination: URL(string: "https://github.com/vllm-project/vllm")!) {
                                    HStack {
                                        Text("vLLM Project")
                                            .font(.subheadline)
                                            .foregroundStyle(AppColors.appPrimary)
                                        Spacer()
                                        Image(systemName: "arrow.up.right")
                                            .font(.caption)
                                            .foregroundStyle(AppColors.textTertiary)
                                    }
                                }
                            }
                        }
                    }
                    .padding(16)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showSidebar.wrappedValue.toggle()
                    } label: {
                        Image(systemName: "line.3.horizontal")
                            .font(.body.weight(.medium))
                            .foregroundStyle(AppColors.textSecondary)
                    }
                }
            }
            .toolbarBackground(AppColors.pageBg, for: .navigationBar)
        }
    }

    // MARK: - Helpers

    private func sectionLabel(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(AppColors.textSecondary)
            .textCase(.uppercase)
    }

    private func settingCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .padding(16)
            .background(AppColors.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func infoRow(_ label: LocalizedStringKey, _ value: String) -> some View {
        HStack {
            Text(label).font(.subheadline).foregroundStyle(AppColors.textSecondary)
            Spacer()
            Text(value).font(.subheadline).foregroundStyle(AppColors.textPrimary)
        }
        .padding(.vertical, 10)
    }
}

#Preview {
    AppSettingsView()
}
