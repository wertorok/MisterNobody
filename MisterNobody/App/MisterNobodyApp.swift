import SwiftUI

@main
struct MisterNobodyApp: App {
    @AppStorage("hasSeenOnboarding") private var hasSeenOnboarding = false

    @StateObject private var vpnManager  = VPNManager.shared
    @StateObject private var rcService   = RevenueCatService.shared

    init() {
        configureRevenueCat()
        configureAppearance()
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if hasSeenOnboarding {
                    MainTabView()
                } else {
                    OnboardingView()
                }
            }
            .environmentObject(vpnManager)
            .environmentObject(rcService)
            .preferredColorScheme(.dark)
        }
    }

    // MARK: – RevenueCat
    private func configureRevenueCat() {
        // Replace with your actual RevenueCat API key from App Store Connect
        let apiKey = Bundle.main.object(forInfoDictionaryKey: "RevenueCatAPIKey") as? String
                     ?? "appl_REPLACE_WITH_YOUR_KEY"
        rcService.configure(apiKey: apiKey)
    }

    // MARK: – Global UIKit appearance
    private func configureAppearance() {
        UINavigationBar.appearance().largeTitleTextAttributes = [
            .foregroundColor: UIColor.white
        ]
        UINavigationBar.appearance().titleTextAttributes = [
            .foregroundColor: UIColor.white
        ]
        UITableView.appearance().backgroundColor = .clear
    }
}
