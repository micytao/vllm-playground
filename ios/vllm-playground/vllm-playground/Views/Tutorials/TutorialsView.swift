import SwiftUI

// MARK: - Data Model

struct TutorialItem: Identifiable {
    let id = UUID()
    let title: String
    let subtitle: String
    let icon: String
    let url: URL
    let duration: String?
}

struct TutorialSection: Identifiable {
    let id = UUID()
    let title: String
    let icon: String
    let items: [TutorialItem]
}

// MARK: - Tutorial Data

private let baseURL = "https://micytao.github.io/vllm-workshop"

private let tutorialSections: [TutorialSection] = [
    TutorialSection(
        title: "Getting Started",
        icon: "flag",
        items: [
            TutorialItem(
                title: "Home",
                subtitle: "Workshop introduction and setup",
                icon: "house",
                url: URL(string: "\(baseURL)/")!,
                duration: nil
            ),
            TutorialItem(
                title: "Overview",
                subtitle: "Your role, mission, and success criteria",
                icon: "doc.text",
                url: URL(string: "\(baseURL)/overview/")!,
                duration: nil
            ),
            TutorialItem(
                title: "Before You Begin",
                subtitle: "Choose your path and setup environment",
                icon: "checklist",
                url: URL(string: "\(baseURL)/details/")!,
                duration: nil
            ),
        ]
    ),
    TutorialSection(
        title: "Workshop Path",
        icon: "hammer",
        items: [
            TutorialItem(
                title: "Module 1: Getting Started",
                subtitle: "Deploy and interact with your first vLLM server",
                icon: "1.circle",
                url: URL(string: "\(baseURL)/workshop/module-01-getting-started/")!,
                duration: "18 min"
            ),
            TutorialItem(
                title: "Module 2: Structured Outputs",
                subtitle: "JSON Schema, Regex, and Grammar constraints",
                icon: "2.circle",
                url: URL(string: "\(baseURL)/workshop/module-02-structured-outputs/")!,
                duration: "18 min"
            ),
            TutorialItem(
                title: "Module 3: Tool Calling",
                subtitle: "Enable and test tool calling workflows",
                icon: "3.circle",
                url: URL(string: "\(baseURL)/workshop/module-03-tool-calling/")!,
                duration: "18 min"
            ),
            TutorialItem(
                title: "Module 4: MCP Integration",
                subtitle: "Connect MCP servers for agentic capabilities",
                icon: "4.circle",
                url: URL(string: "\(baseURL)/workshop/module-04-mcp-integration/")!,
                duration: "18 min"
            ),
            TutorialItem(
                title: "Module 5: Performance Testing",
                subtitle: "Benchmark and optimize with GuideLLM",
                icon: "5.circle",
                url: URL(string: "\(baseURL)/workshop/module-05-benchmarking/")!,
                duration: "18 min"
            ),
        ]
    ),
    TutorialSection(
        title: "Demo Path",
        icon: "play.rectangle",
        items: [
            TutorialItem(
                title: "Module 1: Getting Started",
                subtitle: "Quick deployment walkthrough",
                icon: "1.circle",
                url: URL(string: "\(baseURL)/demo/module-01-getting-started/")!,
                duration: "8 min"
            ),
            TutorialItem(
                title: "Module 2: Structured Outputs",
                subtitle: "Structured output demonstrations",
                icon: "2.circle",
                url: URL(string: "\(baseURL)/demo/module-02-structured-outputs/")!,
                duration: "10 min"
            ),
            TutorialItem(
                title: "Module 3: Tool Calling",
                subtitle: "Tool calling in action",
                icon: "3.circle",
                url: URL(string: "\(baseURL)/demo/module-03-tool-calling/")!,
                duration: "10 min"
            ),
            TutorialItem(
                title: "Module 4: MCP Integration",
                subtitle: "MCP server demos and workflows",
                icon: "4.circle",
                url: URL(string: "\(baseURL)/demo/module-04-mcp-integration/")!,
                duration: "10 min"
            ),
            TutorialItem(
                title: "Module 5: Performance Testing",
                subtitle: "Performance benchmarking demo",
                icon: "5.circle",
                url: URL(string: "\(baseURL)/demo/module-05-performance-testing/")!,
                duration: "7 min"
            ),
        ]
    ),
    TutorialSection(
        title: "Wrap Up",
        icon: "checkmark.seal",
        items: [
            TutorialItem(
                title: "Conclusion",
                subtitle: "Summary, next steps, and resources",
                icon: "flag.checkered",
                url: URL(string: "\(baseURL)/conclusion/")!,
                duration: nil
            ),
        ]
    ),
]

// MARK: - Tutorials View

struct TutorialsView: View {
    @Environment(\.showSidebar) private var showSidebar

    var body: some View {
        NavigationStack {
            List {
                // Tip banner
                Section {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "info.circle.fill")
                            .font(.subheadline)
                            .foregroundStyle(.blue)
                            .padding(.top, 2)

                        Text("These tutorials are designed for the web version of vLLM Playground. Screenshots may look different on mobile, but the core concepts remain the same.")
                            .font(.caption)
                            .foregroundStyle(AppColors.textSecondary)
                    }
                    .padding(.vertical, 4)
                    .listRowBackground(Color.blue.opacity(0.08))
                }

                ForEach(tutorialSections) { section in
                    Section {
                        ForEach(section.items) { item in
                            NavigationLink {
                                TutorialDetailView(item: item)
                            } label: {
                                TutorialRowView(item: item)
                            }
                        }
                    } header: {
                        Label(section.title, systemImage: section.icon)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(AppColors.textTertiary)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .background(AppColors.pageBg)
            .scrollContentBackground(.hidden)
            .navigationTitle("Tutorials")
            .navigationBarTitleDisplayMode(.large)
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
}

// MARK: - Tutorial Row

private struct TutorialRowView: View {
    let item: TutorialItem

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: item.icon)
                .font(.title3)
                .foregroundStyle(AppColors.appPrimary)
                .frame(width: 28, height: 28)

            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(AppColors.textPrimary)

                Text(item.subtitle)
                    .font(.caption)
                    .foregroundStyle(AppColors.textTertiary)
                    .lineLimit(1)
            }

            Spacer()

            if let duration = item.duration {
                Text(duration)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(AppColors.appPrimary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(AppColors.appPrimary.opacity(0.12))
                    .clipShape(Capsule())
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Tutorial Detail (WebView)

struct TutorialDetailView: View {
    let item: TutorialItem
    @State private var isLoading = true

    var body: some View {
        ZStack {
            WebView(url: item.url, isLoading: $isLoading)
                .ignoresSafeArea(edges: .bottom)

            if isLoading {
                VStack(spacing: 12) {
                    ProgressView()
                        .controlSize(.large)
                    Text("Loading tutorial...")
                        .font(.footnote)
                        .foregroundStyle(AppColors.textTertiary)
                }
            }
        }
        .navigationTitle(item.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    UIApplication.shared.open(item.url)
                } label: {
                    Image(systemName: "safari")
                        .font(.body)
                        .foregroundStyle(AppColors.appPrimary)
                }
            }
        }
    }
}

#Preview {
    TutorialsView()
}
