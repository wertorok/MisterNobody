import SwiftUI

enum Theme {
    // MARK: – Colors
    static let background       = Color(hex: "#0A0A0F")
    static let cardBackground   = Color(hex: "#1A1A2E")
    static let surfaceBackground = Color(hex: "#16213E")

    static let accentPrimary    = Color(hex: "#7B68EE")
    static let accentSecondary  = Color(hex: "#5956D6")
    static let accentGlow       = Color(hex: "#7B68EE").opacity(0.25)

    static let connected        = Color(hex: "#00E5CC")
    static let connectedGlow    = Color(hex: "#00E5CC").opacity(0.30)
    static let disconnected     = Color(hex: "#FF4757")
    static let connecting       = Color(hex: "#FFA502")

    static let textPrimary      = Color.white
    static let textSecondary    = Color(hex: "#8B8FA8")
    static let textTertiary     = Color(hex: "#565A73")

    static let border           = Color(hex: "#2A2D3E")
    static let divider          = Color(hex: "#1F2234")

    static let premiumGold      = Color(hex: "#FFD700")
    static let success          = Color(hex: "#2ED573")
    static let warning          = Color(hex: "#FFA502")
    static let error            = Color(hex: "#FF4757")

    // MARK: – Typography
    static let fontHero         = Font.system(size: 34, weight: .bold,     design: .rounded)
    static let fontLarge        = Font.system(size: 28, weight: .bold,     design: .rounded)
    static let fontTitle        = Font.system(size: 22, weight: .bold,     design: .rounded)
    static let fontHeadline     = Font.system(size: 17, weight: .semibold, design: .rounded)
    static let fontSubheadline  = Font.system(size: 15, weight: .semibold, design: .rounded)
    static let fontBody         = Font.system(size: 15, weight: .regular,  design: .rounded)
    static let fontCaption      = Font.system(size: 13, weight: .regular,  design: .rounded)
    static let fontSmall        = Font.system(size: 11, weight: .medium,   design: .rounded)

    // MARK: – Spacing
    static let spaceXS:  CGFloat = 4
    static let spaceS:   CGFloat = 8
    static let spaceM:   CGFloat = 16
    static let spaceL:   CGFloat = 24
    static let spaceXL:  CGFloat = 32
    static let spaceXXL: CGFloat = 48

    // MARK: – Corner Radius
    static let radiusS:  CGFloat = 8
    static let radiusM:  CGFloat = 12
    static let radiusL:  CGFloat = 20
    static let radiusXL: CGFloat = 28
}

// MARK: – Color from hex
extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3:
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6:
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 255, 255, 255)
        }
        self.init(.sRGB,
                  red:     Double(r) / 255,
                  green:   Double(g) / 255,
                  blue:    Double(b) / 255,
                  opacity: Double(a) / 255)
    }
}
