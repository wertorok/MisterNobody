import SwiftUI

struct MainTabView: View {
    @State private var selectedTab = 0

    var body: some View {
        ZStack(alignment: .bottom) {
            Theme.background.ignoresSafeArea()

            TabView(selection: $selectedTab) {
                HomeView()
                    .tag(0)
                SettingsView()
                    .tag(1)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))

            customTabBar
        }
    }

    private var customTabBar: some View {
        HStack(spacing: 0) {
            TabBarItem(icon: "shield.fill",   label: "VPN",      tag: 0, selected: $selectedTab)
            TabBarItem(icon: "gearshape.fill", label: "Settings", tag: 1, selected: $selectedTab)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 12)
        .background(
            Capsule()
                .fill(Theme.cardBackground)
                .shadow(color: .black.opacity(0.4), radius: 16, y: 4)
        )
        .overlay(
            Capsule()
                .stroke(Theme.border, lineWidth: 1)
        )
        .padding(.bottom, 20)
        .padding(.horizontal, 40)
    }
}

struct TabBarItem: View {
    let icon: String
    let label: String
    let tag: Int
    @Binding var selected: Int

    var isSelected: Bool { selected == tag }

    var body: some View {
        Button {
            withAnimation(.spring(response: 0.3)) {
                selected = tag
            }
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        } label: {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 20, weight: isSelected ? .semibold : .regular))
                    .foregroundColor(isSelected ? Theme.accentPrimary : Theme.textTertiary)
                Text(label)
                    .font(Theme.fontSmall)
                    .foregroundColor(isSelected ? Theme.accentPrimary : Theme.textTertiary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 4)
        }
    }
}
