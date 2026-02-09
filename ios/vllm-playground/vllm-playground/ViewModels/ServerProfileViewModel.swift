import Foundation
import SwiftUI
import SwiftData

@Observable
@MainActor
final class ServerProfileViewModel {
    var isCheckingHealth = false
    var healthError: String?

    private let apiClient = VLLMAPIClient.shared

    // MARK: - Health Check

    func checkHealth(for profile: ServerProfile) async {
        isCheckingHealth = true
        healthError = nil

        let apiKey = KeychainService.load(for: profile.id)

        do {
            let healthy = try await apiClient.checkHealth(
                baseURL: profile.baseURL,
                apiKey: apiKey
            )
            profile.isHealthy = healthy
            if healthy {
                profile.lastConnected = Date()
            }
            isCheckingHealth = false
        } catch {
            profile.isHealthy = false
            healthError = error.localizedDescription
            isCheckingHealth = false
        }
    }

    // MARK: - Fetch Models

    func fetchModels(for profile: ServerProfile) async {
        let apiKey = KeychainService.load(for: profile.id)

        do {
            let models = try await apiClient.listModels(
                baseURL: profile.baseURL,
                apiKey: apiKey
            )
            profile.availableModels = models.sorted()
            profile.updatedAt = Date()
        } catch {
            #if DEBUG
            print("[ServerProfileVM] Failed to fetch models: \(error)")
            #endif
        }
    }

    // MARK: - Save API Key

    func saveAPIKey(_ apiKey: String, for profile: ServerProfile) {
        if apiKey.isEmpty {
            KeychainService.delete(for: profile.id)
        } else {
            try? KeychainService.save(apiKey: apiKey, for: profile.id)
        }
    }

    // MARK: - Load API Key

    func loadAPIKey(for profile: ServerProfile) -> String {
        KeychainService.load(for: profile.id) ?? ""
    }

    // MARK: - Set Default

    func setDefault(_ profile: ServerProfile, allProfiles: [ServerProfile]) {
        for p in allProfiles {
            p.isDefault = (p.id == profile.id)
        }
    }

    // MARK: - Delete

    func delete(_ profile: ServerProfile, context: ModelContext) {
        KeychainService.delete(for: profile.id)
        context.delete(profile)
    }
}
