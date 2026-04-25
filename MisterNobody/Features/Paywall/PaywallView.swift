import SwiftUI
import RevenueCat

struct PaywallView: View {
    @Binding var isPresented: Bool
    let onComplete: () -> Void

    @EnvironmentObject private var rcService: RevenueCatService
    @State private var selectedPlanIndex = 1  // yearly selected by default
    @State private var isLoading = false
    @State private var errorMessage: String?

    private var plans: [PaywallPlan] { PaywallPlan.plans }

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: Theme.spaceL) {
                    headerSection
                    featuresSection
                    plansSection
                    ctaSection
                    footerLinks
                }
                .padding(.horizontal, Theme.spaceM)
                .padding(.bottom, Theme.spaceXL)
            }
        }
        .overlay(closeButton, alignment: .topTrailing)
        .task { await rcService.loadOfferings() }
    }

    // MARK: – Header
    private var headerSection: some View {
        VStack(spacing: Theme.spaceM) {
            Spacer().frame(height: Theme.spaceL)

            ZStack {
                Circle()
                    .fill(Theme.premiumGold.opacity(0.12))
                    .frame(width: 100, height: 100)
                Image(systemName: "crown.fill")
                    .font(.system(size: 44))
                    .foregroundColor(Theme.premiumGold)
            }

            VStack(spacing: Theme.spaceS) {
                Text("Unlock Premium")
                    .font(Theme.fontLarge)
                    .foregroundColor(Theme.textPrimary)
                Text("Get unlimited access to all servers, unlimited bandwidth, and the fastest VLESS Reality protocol.")
                    .font(Theme.fontBody)
                    .foregroundColor(Theme.textSecondary)
                    .multilineTextAlignment(.center)
            }
        }
    }

    // MARK: – Features
    private var featuresSection: some View {
        VStack(spacing: Theme.spaceS) {
            ForEach(PremiumFeature.all) { feature in
                HStack(spacing: Theme.spaceM) {
                    Image(systemName: feature.icon)
                        .font(.system(size: 18))
                        .foregroundColor(Theme.accentPrimary)
                        .frame(width: 28)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(feature.title)
                            .font(Theme.fontSubheadline)
                            .foregroundColor(Theme.textPrimary)
                        Text(feature.subtitle)
                            .font(Theme.fontCaption)
                            .foregroundColor(Theme.textSecondary)
                    }
                    Spacer()
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(Theme.connected)
                }
                .padding(Theme.spaceM)
                .cardStyle()
            }
        }
    }

    // MARK: – Plans
    private var plansSection: some View {
        VStack(spacing: Theme.spaceS) {
            ForEach(plans.indices, id: \.self) { index in
                PlanCard(
                    plan: plans[index],
                    isSelected: selectedPlanIndex == index,
                    offering: rcService.offerings?.current
                ) {
                    selectedPlanIndex = index
                }
            }
        }
    }

    // MARK: – CTA
    private var ctaSection: some View {
        VStack(spacing: Theme.spaceS) {
            if let error = errorMessage {
                Text(error)
                    .font(Theme.fontCaption)
                    .foregroundColor(Theme.error)
                    .multilineTextAlignment(.center)
            }

            PrimaryButton(
                plans[selectedPlanIndex].ctaLabel,
                isLoading: isLoading
            ) {
                purchase()
            }

            Text("Cancel anytime. No hidden fees.")
                .font(Theme.fontSmall)
                .foregroundColor(Theme.textTertiary)
        }
    }

    // MARK: – Footer
    private var footerLinks: some View {
        HStack(spacing: Theme.spaceL) {
            Button("Restore Purchases") { restore() }
            Button("Privacy Policy") { }
            Button("Terms of Use") { }
        }
        .font(Theme.fontSmall)
        .foregroundColor(Theme.textTertiary)
    }

    private var closeButton: some View {
        Button { isPresented = false } label: {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 28))
                .foregroundColor(Theme.textTertiary)
        }
        .padding()
    }

    // MARK: – Actions
    private func purchase() {
        guard let offering = rcService.offerings?.current else { return }
        let plan = plans[selectedPlanIndex]
        guard let package = offering.package(identifier: plan.packageId) else {
            errorMessage = "Product unavailable. Please try again later."
            return
        }
        isLoading = true
        errorMessage = nil
        Task {
            do {
                try await rcService.purchase(package: package)
                isPresented = false
                onComplete()
            } catch {
                errorMessage = error.localizedDescription
            }
            isLoading = false
        }
    }

    private func restore() {
        Task {
            do {
                try await rcService.restorePurchases()
                if rcService.subscription.isActive {
                    isPresented = false
                    onComplete()
                } else {
                    errorMessage = "No active subscription found."
                }
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: – Plan card
struct PlanCard: View {
    let plan: PaywallPlan
    let isSelected: Bool
    let offering: Offering?
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: Theme.spaceM) {
                ZStack {
                    Circle()
                        .fill(isSelected ? Theme.accentPrimary : Theme.border)
                        .frame(width: 20, height: 20)
                    if isSelected {
                        Circle()
                            .fill(.white)
                            .frame(width: 8, height: 8)
                    }
                }

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        Text(plan.title)
                            .font(Theme.fontSubheadline)
                            .foregroundColor(Theme.textPrimary)
                        if let badge = plan.badge {
                            Text(badge)
                                .font(Theme.fontSmall)
                                .foregroundColor(.black)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Theme.premiumGold)
                                .cornerRadius(4)
                        }
                    }
                    Text(plan.subtitle)
                        .font(Theme.fontCaption)
                        .foregroundColor(Theme.textSecondary)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 2) {
                    Text(plan.price)
                        .font(Theme.fontSubheadline)
                        .foregroundColor(Theme.textPrimary)
                    if let perMonth = plan.perMonth {
                        Text(perMonth)
                            .font(Theme.fontSmall)
                            .foregroundColor(Theme.textSecondary)
                    }
                }
            }
            .padding(Theme.spaceM)
            .background(isSelected ? Theme.accentPrimary.opacity(0.08) : Theme.cardBackground)
            .cornerRadius(Theme.radiusL)
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radiusL)
                    .stroke(isSelected ? Theme.accentPrimary : Theme.border, lineWidth: isSelected ? 2 : 1)
            )
        }
    }
}

// MARK: – Data models
struct PaywallPlan {
    let title: String
    let subtitle: String
    let price: String
    let perMonth: String?
    let badge: String?
    let packageId: String
    let ctaLabel: String

    static let plans: [PaywallPlan] = [
        PaywallPlan(
            title: "Monthly",
            subtitle: "Billed monthly",
            price: "$4.99/mo",
            perMonth: nil,
            badge: nil,
            packageId: "$rc_monthly",
            ctaLabel: "Try Free for 7 Days"
        ),
        PaywallPlan(
            title: "Yearly",
            subtitle: "Billed annually · Save 50%",
            price: "$29.99/yr",
            perMonth: "$2.50/mo",
            badge: "Best Value",
            packageId: "$rc_annual",
            ctaLabel: "Try Free for 7 Days"
        ),
        PaywallPlan(
            title: "Lifetime",
            subtitle: "One-time payment, forever",
            price: "$79.99",
            perMonth: nil,
            badge: nil,
            packageId: "$rc_lifetime",
            ctaLabel: "Get Lifetime Access"
        ),
    ]
}

struct PremiumFeature: Identifiable {
    let id = UUID()
    let title: String
    let subtitle: String
    let icon: String

    static let all: [PremiumFeature] = [
        PremiumFeature(title: "All Countries",       subtitle: "8+ server locations worldwide",          icon: "globe"),
        PremiumFeature(title: "Unlimited Bandwidth",  subtitle: "No speed caps, no data limits",          icon: "speedometer"),
        PremiumFeature(title: "VLESS Reality",        subtitle: "Undetectable, ultra-fast protocol",      icon: "waveform.path.ecg"),
        PremiumFeature(title: "Kill Switch",          subtitle: "Blocks traffic if VPN drops",            icon: "xmark.shield.fill"),
        PremiumFeature(title: "No Logs Policy",       subtitle: "Zero activity or connection logs",       icon: "eye.slash.fill"),
        PremiumFeature(title: "5 Devices",            subtitle: "Protect all your Apple devices",         icon: "devices.fill"),
    ]
}
