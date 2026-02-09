import SwiftUI
import SwiftData

@main
struct vllm_playgroundApp: App {
    var sharedModelContainer: ModelContainer = {
        let schema = Schema([
            ServerProfile.self,
            Conversation.self,
            Message.self,
            BenchmarkResult.self,
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
        }
        .modelContainer(sharedModelContainer)
    }
}
