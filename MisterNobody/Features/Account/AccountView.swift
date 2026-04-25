import SwiftUI

struct AccountView: View {
    @EnvironmentObject private var rcService: RevenueCatService
    @Environment(\.dismiss) private var dismiss
    @State private var showPaywall = false
    @State private var isRestoring = false
    @State private var restoreMessage: String?

    var sub: UserSubscription { rcService.subscription }

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: Theme.spaceL) {
                    header
                    subscriptionCard
                    actionsSection

                    if let msg = restoreMessage {
                        Text(msg)
                            .font(Theme.fontCaption)
                            .foregroundColor(Theme.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(.horizontal, Theme.spaceM)
                .padding(.vertical, Theme.spaceM)
                .padding(.bottom, Theme.spaceXL)
            }
        }
        .sheet(isPresented: $showPaywall) {
            PaywallView(isPresented: $showPaywall, onComplete: {})
        }
    }

    // MARK: – Header
    private var header: some View {
        HStack {
            Text("Account")
                .font(Theme.fontTitle)
                .foregroundColor(Theme.textPrimary)
            Spacer()
            Button { dismiss() } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundColor(Theme.textTertiary)
                    .font(.system(size: 24))
            }
        }
        .padding(.top, Theme.spaceL)
    }

    // MARK: – Subscription card
    private var subscriptionCard: some View {
        VStack(spacing: Theme.spaceM) {
            HStack {
                ZStack {
                    Circle()
                        .fill(sub.isActive ? Theme.premiumGold.opacity(0.15) : Theme.border)
                        .frame(width: 56, height: 56)
                    Image(systemName: sub.isActive ? "crown.fill" : "person.circle")
                        .font(.system(size: 24))
                        .foregroundColor(sub.isActive ? Theme.premiumGold : Theme.textSecondary)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(sub.displayName)
                        .font(Theme.fontHeadline)
                        .foregroundColor(Theme.textPrimary)
                    if sub.isActive {
                        if sub.isTrialActive, let trialEnd = sub.trialEndsAt {
                            Text("Trial ends \(trialEnd.formatted(date: .abbreviated, time: .omitted))")
                                .font(Theme.fontCaption)
                                .foregroundColor(Theme.warning)
                        } else if let expText = sub.expirationText {
                            Text("Renews \(expText)")
                                .font(Theme.fontCaption)
                                .foregroundColor(Theme.textSecondary)
                        } else if sub.plan == .lifetime {
                            Text("Active forever")
                                .font(Theme.fontCaption)
                                .foregroundColor(Theme.success)
                        }
                    } else {
                        Text("Upgrade to unlock all servers")
                            .font(Theme.fontCaption)
                            .foregroundColor(Theme.textSecondary)
                    }
                }
                Spacer()
            }

            if !sub.isActive {
                PrimaryButton("Upgrade to Premium", icon: "crown.fill") {
                    showPaywall = true
                }
            }
        }
        .padding(Theme.spaceM)
        .cardStyle()
    }

    // MARK: – Actions
    private var actionsSection: some View {
        SettingsSection(title: "Manage") {
            VStack(spacing: 0) {
                if sub.isActive && sub.plan != .lifetime {
                    Button {
                        if let url = URL(string: "https://apps.apple.com/account/subscriptions") {
                            UIApplication.shared.open(url)
                        }
                    } label: {
                        HStack {
                            Image(systemName: "creditcard").foregroundColor(Theme.accentPrimary).frame(width: 28)
                            Text("Manage Subscription").font(Theme.fontSubheadline).foregroundColor(Theme.textPrimary)
                            Spacer()
                            Image(systemName: "arrow.up.right").foregroundColor(Theme.textTertiary).font(.system(size: 12))
                        }
                        .padding(Theme.spaceM)
                    }
                    Divider().background(Theme.divider).padding(.horizontal, Theme.spaceM)
                }

                Button {
                    restore()
                } label: {
                    HStack {
                        if isRestoring {
                            ProgressView().tint(Theme.accentPrimary).frame(width: 28)
                        } else {
                            Image(systemName: "arrow.clockwise").foregroundColor(Theme.accentPrimary).frame(width: 28)
                        }
                        Text("Restore Purchases").font(Theme.fontSubheadline).foregroundColor(Theme.textPrimary)
                        Spacer()
                    }
                    .padding(Theme.spaceM)
                }

                Divider().background(Theme.divider).padding(.horizontal, Theme.spaceM)

                Button {
                    openURL("https://misternobody.vpn/privacy")
                } label: {
                    HStack {
                        Image(systemName: "doc.text").foregroundColor(Theme.accentPrimary).frame(width: 28)
                        Text("Privacy Policy").font(Theme.fontSubheadline).foregroundColor(Theme.textPrimary)
                        Spacer()
                        Image(systemName: "arrow.up.right").foregroundColor(Theme.textTertiary).font(.system(size: 12))
                    }
                    .padding(Theme.spaceM)
                }

                Divider().background(Theme.divider).padding(.horizontal, Theme.spaceM)

                Button {
                    openURL("https://misternobody.vpn/terms")
                } label: {
                    HStack {
                        Image(systemName: "doc.badge.gearshape").foregroundColor(Theme.accentPrimary).frame(width: 28)
                        Text("Terms of Service").font(Theme.fontSubheadline).foregroundColor(Theme.textPrimary)
                        Spacer()
                        Image(systemName: "arrow.up.right").foregroundColor(Theme.textTertiary).font(.system(size: 12))
                    }
                    .padding(Theme.spaceM)
                }
            }
        }
    }

    private func restore() {
        isRestoring = true
        restoreMessage = nil
        Task {
            do {
                try await rcService.restorePurchases()
                restoreMessage = rcService.subscription.isActive
                    ? "Purchases restored successfully!"
                    : "No active subscription found."
            } catch {
                restoreMessage = error.localizedDescription
            }
            isRestoring = false
        }
    }

    private func openURL(_ string: String) {
        guard let url = URL(string: string) else { return }
        UIApplication.shared.open(url)
    }
}
