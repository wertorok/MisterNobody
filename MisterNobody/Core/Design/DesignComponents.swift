import SwiftUI

// MARK: – Primary Button
struct PrimaryButton: View {
    let title: String
    let icon: String?
    let isLoading: Bool
    let action: () -> Void

    init(_ title: String, icon: String? = nil, isLoading: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.isLoading = isLoading
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: Theme.spaceS) {
                if isLoading {
                    ProgressView().tint(.white)
                } else {
                    if let icon { Image(systemName: icon) }
                    Text(title).font(Theme.fontHeadline)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(
                LinearGradient(
                    colors: [Theme.accentPrimary, Theme.accentSecondary],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .foregroundColor(.white)
            .cornerRadius(Theme.radiusL)
        }
        .disabled(isLoading)
    }
}

// MARK: – Secondary Button
struct SecondaryButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(Theme.fontHeadline)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .foregroundColor(Theme.accentPrimary)
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.radiusL)
                        .stroke(Theme.accentPrimary, lineWidth: 1.5)
                )
        }
    }
}

// MARK: – Card
struct Card<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .background(Theme.cardBackground)
            .cornerRadius(Theme.radiusL)
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radiusL)
                    .stroke(Theme.border, lineWidth: 1)
            )
    }
}

// MARK: – Status Badge
struct StatusBadge: View {
    let status: VPNStatus

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(status.color)
                .frame(width: 8, height: 8)
                .shadow(color: status.color.opacity(0.6), radius: 4)
            Text(status.label)
                .font(Theme.fontCaption)
                .foregroundColor(status.color)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(status.color.opacity(0.12))
        .cornerRadius(Theme.radiusS)
    }
}

// MARK: – Section Header
struct SectionHeader: View {
    let title: String

    var body: some View {
        Text(title.uppercased())
            .font(Theme.fontSmall)
            .foregroundColor(Theme.textTertiary)
            .tracking(1.2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Theme.spaceM)
    }
}

// MARK: – Stat Item
struct StatItem: View {
    let label: String
    let value: String
    let icon: String

    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundColor(Theme.accentPrimary)
            Text(value)
                .font(Theme.fontSubheadline)
                .foregroundColor(Theme.textPrimary)
            Text(label)
                .font(Theme.fontSmall)
                .foregroundColor(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: – Toast
struct ToastView: View {
    let message: String
    let type: ToastType

    enum ToastType { case success, error, info }

    var icon: String {
        switch type {
        case .success: return "checkmark.circle.fill"
        case .error:   return "xmark.circle.fill"
        case .info:    return "info.circle.fill"
        }
    }

    var color: Color {
        switch type {
        case .success: return Theme.success
        case .error:   return Theme.error
        case .info:    return Theme.accentPrimary
        }
    }

    var body: some View {
        HStack(spacing: Theme.spaceS) {
            Image(systemName: icon).foregroundColor(color)
            Text(message)
                .font(Theme.fontBody)
                .foregroundColor(Theme.textPrimary)
        }
        .padding(.horizontal, Theme.spaceM)
        .padding(.vertical, 12)
        .background(Theme.cardBackground)
        .cornerRadius(Theme.radiusM)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radiusM)
                .stroke(Theme.border, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.3), radius: 12, y: 4)
    }
}
