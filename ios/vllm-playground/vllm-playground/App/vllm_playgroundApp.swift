import SwiftUI
import SwiftData

@main
struct vllm_playgroundApp: App {
    @AppStorage("appLanguage") private var appLanguage: AppLanguage = .system

    var sharedModelContainer: ModelContainer = {
        let schema = Schema([
            ServerProfile.self,
            Conversation.self,
            Message.self,
            BenchmarkResult.self,
            GeneratedImage.self,
            GeneratedTTS.self,
            GeneratedAudio.self,
            GeneratedVideo.self,
        ])
        let modelConfiguration = ModelConfiguration(
            schema: schema,
            isStoredInMemoryOnly: false
        )

        do {
            return try ModelContainer(for: schema, configurations: [modelConfiguration])
        } catch {
            // Schema migration failed -- delete the old store and retry.
            // This avoids a fatal crash when the data model changes during development.
            print("⚠️ ModelContainer migration failed: \(error). Deleting old store and retrying.")

            // SwiftData stores in the app's Application Support directory by default
            let fm = FileManager.default
            if let appSupport = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
                let storePath = appSupport.appendingPathComponent("default.store")
                for suffix in ["", "-wal", "-shm"] {
                    let fileURL = URL(fileURLWithPath: storePath.path + suffix)
                    try? fm.removeItem(at: fileURL)
                }
            }

            do {
                return try ModelContainer(for: schema, configurations: [modelConfiguration])
            } catch {
                fatalError("Could not create ModelContainer after reset: \(error)")
            }
        }
    }()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .modifier(LocaleModifier(language: appLanguage))
                .onAppear { ensureDemoServerExists() }
        }
        .modelContainer(sharedModelContainer)
    }

    /// Ensures the built-in demo server is always present.
    /// Runs on every launch to self-heal after migrations or data corruption.
    private func ensureDemoServerExists() {
        let context = sharedModelContainer.mainContext
        let descriptor = FetchDescriptor<ServerProfile>(
            predicate: #Predicate { $0.baseURL == "demo://playground" }
        )
        let existing = (try? context.fetch(descriptor)) ?? []
        if existing.isEmpty {
            let demo = ServerProfile.createDemo()
            context.insert(demo)
            try? context.save()
        }
    }
}

/// Applies a locale override when the user picks a specific language.
/// When `language` is `.system`, no locale override is applied (uses device default).
private struct LocaleModifier: ViewModifier {
    let language: AppLanguage

    func body(content: Content) -> some View {
        if let locale = language.locale {
            content.environment(\.locale, locale)
        } else {
            content
        }
    }
}
