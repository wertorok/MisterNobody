import SwiftUI

struct OnboardingView: View {
    @AppStorage("hasSeenOnboarding") private var hasSeenOnboarding = false
    @EnvironmentObject private var rcService: RevenueCatService

    @State private var currentPage = 0
    @State private var showPaywall = false

    private let pages = OnboardingPage.all

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            VStack(spacing: 0) {
                TabView(selection: $currentPage) {
                    ForEach(pages.indices, id: \.self) { index in
                        PageView(page: pages[index])
                            .tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .animation(.easeInOut, value: currentPage)

                pageIndicator
                    .padding(.bottom, Theme.spaceL)

                bottomButtons
                    .padding(.horizontal, Theme.spaceL)
                    .padding(.bottom, Theme.spaceXL)
            }
        }
        .sheet(isPresented: $showPaywall) {
            PaywallView(isPresented: $showPaywall, onComplete: finish)
        }
    }

    private var pageIndicator: some View {
        HStack(spacing: 8) {
            ForEach(pages.indices, id: \.self) { index in
                RoundedRectangle(cornerRadius: 2)
                    .fill(index == currentPage ? Theme.accentPrimary : Theme.border)
                    .frame(width: index == currentPage ? 20 : 6, height: 4)
                    .animation(.spring(response: 0.3), value: currentPage)
            }
        }
    }

    private var bottomButtons: some View {
        VStack(spacing: 12) {
            if currentPage < pages.count - 1 {
                PrimaryButton("Continue", icon: "arrow.right") {
                    withAnimation { currentPage += 1 }
                }
                Button("Skip") { showPaywall = true }
                    .font(Theme.fontCaption)
                    .foregroundColor(Theme.textSecondary)
            } else {
                PrimaryButton("Get Started — It's Free") { showPaywall = true }
                Button("Already have account? Sign In") {
                    finish()
                }
                .font(Theme.fontCaption)
                .foregroundColor(Theme.textSecondary)
            }
        }
    }

    private func finish() {
        hasSeenOnboarding = true
    }
}

// MARK: – Single page
private struct PageView: View {
    let page: OnboardingPage

    var body: some View {
        VStack(spacing: Theme.spaceL) {
            Spacer()

            ZStack {
                Circle()
                    .fill(page.accentColor.opacity(0.12))
                    .frame(width: 180, height: 180)
                Circle()
                    .fill(page.accentColor.opacity(0.06))
                    .frame(width: 240, height: 240)

                Image(systemName: page.icon)
                    .font(.system(size: 72, weight: .light))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [page.accentColor, page.accentColor.opacity(0.6)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
            }
            .padding(.bottom, Theme.spaceM)

            VStack(spacing: Theme.spaceS) {
                Text(page.title)
                    .font(Theme.fontLarge)
                    .foregroundColor(Theme.textPrimary)
                    .multilineTextAlignment(.center)

                Text(page.subtitle)
                    .font(Theme.fontBody)
                    .foregroundColor(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, Theme.spaceL)
            }

            Spacer()
            Spacer()
        }
        .padding(.horizontal, Theme.spaceM)
    }
}

// MARK: – Page model
struct OnboardingPage {
    let title: String
    let subtitle: String
    let icon: String
    let accentColor: Color

    static let all: [OnboardingPage] = [
        OnboardingPage(
            title: "Stay Private Online",
            subtitle: "Encrypt your internet connection and hide your IP address from trackers, advertisers, and your ISP.",
            icon: "lock.shield.fill",
            accentColor: Theme.accentPrimary
        ),
        OnboardingPage(
            title: "Access Blocked Content",
            subtitle: "Break through censorship and geo-restrictions. Access any website or service from anywhere in the world.",
            icon: "globe.americas.fill",
            accentColor: Theme.connected
        ),
        OnboardingPage(
            title: "VLESS Reality Protocol",
            subtitle: "The most advanced VPN technology. Undetectable traffic that looks like regular HTTPS — bypasses even the deepest DPI.",
            icon: "waveform.path.ecg.rectangle.fill",
            accentColor: Theme.premiumGold
        ),
        OnboardingPage(
            title: "Lightning Fast Servers",
            subtitle: "Global network of high-speed servers with unlimited bandwidth. No speed caps, no logs, ever.",
            icon: "bolt.fill",
            accentColor: Theme.accentPrimary
        ),
    ]
}
