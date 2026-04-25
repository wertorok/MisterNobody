import Foundation

struct UserSubscription: Codable, Equatable {
    var plan: Plan
    var expiresAt: Date?
    var isTrialActive: Bool
    var trialEndsAt: Date?

    enum Plan: String, Codable {
        case free, monthly, yearly, lifetime
    }

    var isActive: Bool {
        switch plan {
        case .free:
            return false
        case .lifetime:
            return true
        case .monthly, .yearly:
            guard let exp = expiresAt else { return false }
            return exp > Date()
        }
    }

    var displayName: String {
        switch plan {
        case .free:     return "Free"
        case .monthly:  return "Premium Monthly"
        case .yearly:   return "Premium Yearly"
        case .lifetime: return "Premium Lifetime"
        }
    }

    var expirationText: String? {
        guard let exp = expiresAt else { return nil }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        return formatter.string(from: exp)
    }

    static let free = UserSubscription(
        plan: .free,
        expiresAt: nil,
        isTrialActive: false,
        trialEndsAt: nil
    )
}

// MARK: – RevenueCat product identifiers
enum ProductID {
    static let monthly  = "com.misternobody.app.premium.monthly"
    static let yearly   = "com.misternobody.app.premium.yearly"
    static let lifetime = "com.misternobody.app.premium.lifetime"
    static let entitlement = "premium"
}
