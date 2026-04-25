import Foundation
import RevenueCat
import Combine

final class RevenueCatService: ObservableObject {
    static let shared = RevenueCatService()

    @Published private(set) var subscription: UserSubscription = .free
    @Published private(set) var offerings: Offerings?
    @Published private(set) var isLoading = false

    private init() {}

    // MARK: – Configure (call once at app start)
    func configure(apiKey: String) {
        Purchases.configure(withAPIKey: apiKey)
        Purchases.shared.delegate = PurchasesDelegateWrapper.shared
        Task { await refreshStatus() }
    }

    // MARK: – Fetch current entitlement
    func refreshStatus() async {
        do {
            let info = try await Purchases.shared.customerInfo()
            await MainActor.run {
                self.subscription = Self.map(info)
            }
        } catch {
            print("[RevenueCat] refreshStatus error: \(error)")
        }
    }

    // MARK: – Load offerings
    func loadOfferings() async {
        await MainActor.run { isLoading = true }
        do {
            let offs = try await Purchases.shared.offerings()
            await MainActor.run {
                self.offerings = offs
                self.isLoading = false
            }
        } catch {
            await MainActor.run { isLoading = false }
            print("[RevenueCat] loadOfferings error: \(error)")
        }
    }

    // MARK: – Purchase
    func purchase(package: Package) async throws {
        let result = try await Purchases.shared.purchase(package: package)
        await MainActor.run {
            self.subscription = Self.map(result.customerInfo)
        }
    }

    // MARK: – Restore
    func restorePurchases() async throws {
        let info = try await Purchases.shared.restorePurchases()
        await MainActor.run {
            self.subscription = Self.map(info)
        }
    }

    // MARK: – Map CustomerInfo → UserSubscription
    private static func map(_ info: CustomerInfo) -> UserSubscription {
        let entitlement = info.entitlements[ProductID.entitlement]
        guard entitlement?.isActive == true else {
            return .free
        }

        let expDate = entitlement?.expirationDate
        let plan: UserSubscription.Plan

        switch entitlement?.productIdentifier {
        case ProductID.monthly:  plan = .monthly
        case ProductID.yearly:   plan = .yearly
        case ProductID.lifetime: plan = .lifetime
        default:                 plan = .monthly
        }

        let isTrialActive = entitlement?.periodType == .trial
        let trialEnds = isTrialActive ? expDate : nil

        return UserSubscription(
            plan: plan,
            expiresAt: expDate,
            isTrialActive: isTrialActive,
            trialEndsAt: trialEnds
        )
    }
}

// MARK: – Delegate wrapper
final class PurchasesDelegateWrapper: NSObject, PurchasesDelegate {
    static let shared = PurchasesDelegateWrapper()

    func purchases(_ purchases: Purchases, receivedUpdated customerInfo: CustomerInfo) {
        Task {
            await RevenueCatService.shared.refreshStatus()
        }
    }
}
