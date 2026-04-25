import SwiftUI

extension View {
    // MARK: – Dark card background
    func cardStyle() -> some View {
        self
            .background(Theme.cardBackground)
            .cornerRadius(Theme.radiusL)
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radiusL)
                    .stroke(Theme.border, lineWidth: 1)
            )
    }

    // MARK: – Tap feedback haptics
    func hapticFeedback(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .medium) -> some View {
        self.simultaneousGesture(
            TapGesture().onEnded {
                UIImpactFeedbackGenerator(style: style).impactOccurred()
            }
        )
    }

    // MARK: – Conditional modifier
    @ViewBuilder
    func `if`<Transform: View>(_ condition: Bool, transform: (Self) -> Transform) -> some View {
        if condition { transform(self) } else { self }
    }

    // MARK: – Glow effect
    func glowEffect(color: Color, radius: CGFloat = 12) -> some View {
        self.shadow(color: color, radius: radius)
    }

    // MARK: – Hide keyboard
    func hideKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}

// MARK: – Formatted bytes
extension Int64 {
    var formattedBytes: String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .binary
        formatter.allowsNonnumericFormatting = false
        return formatter.string(fromByteCount: self)
    }
}

// MARK: – Duration formatting
extension Date {
    func durationString(to other: Date = Date()) -> String {
        let seconds = Int(other.timeIntervalSince(self))
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        let s = seconds % 60
        return String(format: "%02d:%02d:%02d", h, m, s)
    }
}
