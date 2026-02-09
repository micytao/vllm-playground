import SwiftUI
import SwiftData

struct HomeView: View {
    @Environment(\.showSidebar) private var showSidebar
    @Query(sort: \ServerProfile.name) private var servers: [ServerProfile]
    @Query(sort: \Conversation.updatedAt, order: .reverse) private var conversations: [Conversation]

    var onNavigate: ((AppSection) -> Void)?

    private var healthyCount: Int {
        servers.filter(\.isHealthy).count
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    heroSection
                    statsBar
                    featureGrid
                    quickActions
                    aboutSection
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 32)
            }
            .background(AppColors.pageBg)
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
                ToolbarItem(placement: .topBarTrailing) {
                    Link(destination: URL(string: "https://github.com/micytao/vllm-playground")!) {
                        Image("AuthorMascot")
                            .resizable()
                            .scaledToFill()
                            .frame(width: 30, height: 30)
                            .clipShape(Circle())
                    }
                }
            }
            .toolbarBackground(AppColors.pageBg, for: .navigationBar)
        }
    }

    // MARK: - Hero

    private var heroSection: some View {
        VStack(spacing: 16) {
            Image("VLLMLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 72, height: 72)
                .shadow(color: AppColors.appPrimary.opacity(0.3), radius: 12, y: 4)

            VStack(spacing: 6) {
                Text("vLLM Playground")
                    .font(.title.weight(.bold))
                    .foregroundStyle(AppColors.textPrimary)

                Text("A native iOS client for vLLM servers")
                    .font(.callout)
                    .foregroundStyle(AppColors.textSecondary)
            }

            Text("Chat with LLMs, generate images & audio, run benchmarks — all connecting directly to vLLM's OpenAI-compatible API.")
                .font(.subheadline)
                .foregroundStyle(AppColors.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 8)
        }
        .padding(.vertical, 20)
    }

    // MARK: - Stats Bar

    private var statsBar: some View {
        HStack(spacing: 0) {
            statItem(value: "\(servers.count)", label: "Servers", icon: "server.rack")
            Divider().frame(height: 32).background(AppColors.border)
            statItem(value: "\(healthyCount)", label: "Online", icon: "circle.fill", tint: AppColors.appSuccess)
            Divider().frame(height: 32).background(AppColors.border)
            statItem(value: "\(conversations.count)", label: "Chats", icon: "bubble.left.and.bubble.right")
        }
        .padding(.vertical, 14)
        .background(AppColors.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func statItem(value: String, label: String, icon: String, tint: Color = AppColors.appPrimary) -> some View {
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.caption2)
                    .foregroundStyle(tint)
                Text(value)
                    .font(.title3.weight(.bold).monospacedDigit())
                    .foregroundStyle(AppColors.textPrimary)
            }
            Text(label)
                .font(.caption)
                .foregroundStyle(AppColors.textTertiary)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Feature Grid

    private var featureGrid: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Features")
                .font(.headline)
                .foregroundStyle(AppColors.textPrimary)
                .padding(.leading, 4)

            LazyVGrid(columns: [
                GridItem(.flexible(), spacing: 12),
                GridItem(.flexible(), spacing: 12)
            ], spacing: 12) {
                featureCard(
                    icon: "bubble.left.fill",
                    title: "Chat",
                    subtitle: "Streaming responses with markdown",
                    gradient: [Color.blue.opacity(0.15), Color.cyan.opacity(0.08)]
                )

                featureCard(
                    icon: "photo.on.rectangle.angled",
                    title: "Vision (VLM)",
                    subtitle: "Chat with images attached",
                    gradient: [Color.purple.opacity(0.15), Color.pink.opacity(0.08)]
                )

                featureCard(
                    icon: "waveform.and.mic",
                    title: "Omni Studio",
                    subtitle: "Image, TTS & audio generation",
                    gradient: [Color.orange.opacity(0.15), Color.yellow.opacity(0.08)]
                )

                featureCard(
                    icon: "chart.bar",
                    title: "Benchmark",
                    subtitle: "TTFT, TPS & latency testing",
                    gradient: [Color.green.opacity(0.15), Color.mint.opacity(0.08)]
                )

                featureCard(
                    icon: "wrench.and.screwdriver",
                    title: "Tool Calling",
                    subtitle: "Function calling with presets",
                    gradient: [Color.indigo.opacity(0.15), Color.blue.opacity(0.08)]
                )

                featureCard(
                    icon: "doc.text.magnifyingglass",
                    title: "Structured Output",
                    subtitle: "JSON Schema, regex, grammar",
                    gradient: [Color.teal.opacity(0.15), Color.cyan.opacity(0.08)]
                )
            }
        }
    }

    private func featureCard(icon: String, title: String, subtitle: String, gradient: [Color]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 10)
                    .fill(
                        LinearGradient(colors: gradient, startPoint: .topLeading, endPoint: .bottomTrailing)
                    )
                    .frame(width: 36, height: 36)
                Image(systemName: icon)
                    .font(.callout.weight(.medium))
                    .foregroundStyle(AppColors.textPrimary)
            }

            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AppColors.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.85)

            Text(subtitle)
                .font(.caption)
                .foregroundStyle(AppColors.textTertiary)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(14)
        .background(AppColors.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - Quick Actions

    private var quickActions: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Get Started")
                .font(.headline)
                .foregroundStyle(AppColors.textPrimary)
                .padding(.leading, 4)

            VStack(spacing: 10) {
                if servers.isEmpty {
                    quickActionRow(
                        icon: "plus.circle.fill",
                        title: "Add a Server",
                        subtitle: "Connect to your vLLM instance",
                        tint: AppColors.appPrimary
                    ) {
                        onNavigate?(.servers)
                    }
                } else {
                    quickActionRow(
                        icon: "square.and.pencil",
                        title: "New Chat",
                        subtitle: "Start a conversation with your model",
                        tint: AppColors.appPrimary
                    ) {
                        onNavigate?(.chat)
                    }

                    quickActionRow(
                        icon: "sparkles",
                        title: "Open Omni Studio",
                        subtitle: "Generate images, speech & audio",
                        tint: .orange
                    ) {
                        onNavigate?(.omni)
                    }

                    quickActionRow(
                        icon: "chart.bar.fill",
                        title: "Run Benchmark",
                        subtitle: "Test your server's performance",
                        tint: .green
                    ) {
                        onNavigate?(.benchmark)
                    }
                }
            }
        }
    }

    private func quickActionRow(icon: String, title: String, subtitle: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(tint.opacity(0.12))
                        .frame(width: 40, height: 40)
                    Image(systemName: icon)
                        .font(.callout.weight(.medium))
                        .foregroundStyle(tint)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(AppColors.textPrimary)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(AppColors.textTertiary)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppColors.textTertiary)
            }
            .padding(14)
            .background(AppColors.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
    }

    // MARK: - About

    private var aboutSection: some View {
        VStack(spacing: 12) {
            Divider().background(AppColors.border)
                .padding(.vertical, 4)

            // GitHub + Star
            Link(destination: URL(string: "https://github.com/micytao/vllm-playground")!) {
                VStack(spacing: 12) {
                    HStack(spacing: 12) {
                        ZStack {
                            Circle()
                                .fill(AppColors.textPrimary)
                                .frame(width: 32, height: 32)
                            Image(systemName: "chevron.left.forwardslash.chevron.right")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(AppColors.cardBg)
                        }

                        VStack(alignment: .leading, spacing: 2) {
                            Text("micytao/vllm-playground")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(AppColors.textPrimary)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                            Text("View source code on GitHub")
                                .font(.caption)
                                .foregroundStyle(AppColors.textSecondary)
                        }

                        Spacer()

                        Image(systemName: "arrow.up.right")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(AppColors.textTertiary)
                    }

                    // Star badge
                    HStack(spacing: 6) {
                        Image(systemName: "star.fill")
                            .font(.subheadline)
                            .foregroundStyle(.yellow)
                        Text("Star this repo")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(AppColors.textPrimary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(AppColors.inputBg)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                .padding(14)
                .background(AppColors.cardBg)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }

            HStack(spacing: 6) {
                Text("v0.1.0")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(AppColors.textTertiary)

                Text("·")
                    .foregroundStyle(AppColors.textTertiary)

                Text("Apache 2.0 License")
                    .font(.caption)
                    .foregroundStyle(AppColors.textTertiary)
            }

            HStack(spacing: 4) {
                Text("Made for the")
                    .font(.caption)
                    .foregroundStyle(AppColors.textTertiary)
                Text("vLLM")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppColors.appPrimary)
                Text("community")
                    .font(.caption)
                    .foregroundStyle(AppColors.textTertiary)
            }
        }
    }
}


#Preview {
    HomeView()
        .modelContainer(for: [
            ServerProfile.self,
            Conversation.self,
            Message.self,
            BenchmarkResult.self
        ], inMemory: true)
}
