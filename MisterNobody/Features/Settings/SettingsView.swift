import SwiftUI

struct SettingsView: View {
    @AppStorage("killSwitchEnabled")    private var killSwitchEnabled = false
    @AppStorage("autoConnectEnabled")   private var autoConnectEnabled = false
    @AppStorage("customDNS")            private var customDNS = ""
    @AppStorage("splitTunnelingEnabled") private var splitTunnelingEnabled = false
    @AppStorage("obfs4Enabled")         private var obfs4Enabled = false

    @EnvironmentObject private var rcService: RevenueCatService
    @State private var showPaywall = false
    @State private var showDiagnostics = false
    @State private var showAccount = false
    @State private var showImportConfig = false

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: Theme.spaceM) {
                    header

                    if !rcService.subscription.isActive {
                        premiumBanner
                    }

                    connectionSection
                    privacySection
                    protocolSection
                    supportSection
                    appInfoSection
                }
                .padding(.horizontal, Theme.spaceM)
                .padding(.vertical, Theme.spaceM)
                .padding(.bottom, Theme.spaceXL)
            }
        }
        .sheet(isPresented: $showPaywall) {
            PaywallView(isPresented: $showPaywall, onComplete: {})
        }
        .sheet(isPresented: $showDiagnostics) {
            DiagnosticsView()
        }
        .sheet(isPresented: $showAccount) {
            AccountView()
        }
    }

    private var header: some View {
        Text("Settings")
            .font(Theme.fontTitle)
            .foregroundColor(Theme.textPrimary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, Theme.spaceS)
    }

    // MARK: – Premium banner
    private var premiumBanner: some View {
        Button(action: { showPaywall = true }) {
            HStack(spacing: Theme.spaceM) {
                Image(systemName: "crown.fill")
                    .foregroundColor(Theme.premiumGold)
                    .font(.system(size: 22))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Upgrade to Premium")
                        .font(Theme.fontSubheadline)
                        .foregroundColor(Theme.textPrimary)
                    Text("Unlock all servers and features")
                        .font(Theme.fontCaption)
                        .foregroundColor(Theme.textSecondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundColor(Theme.premiumGold)
                    .font(.system(size: 12, weight: .semibold))
            }
            .padding(Theme.spaceM)
            .background(
                LinearGradient(
                    colors: [Theme.premiumGold.opacity(0.15), Theme.premiumGold.opacity(0.05)],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .cornerRadius(Theme.radiusL)
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radiusL)
                    .stroke(Theme.premiumGold.opacity(0.3), lineWidth: 1)
            )
        }
    }

    // MARK: – Connection
    private var connectionSection: some View {
        SettingsSection(title: "Connection") {
            ToggleRow(
                title: "Kill Switch",
                subtitle: "Block internet if VPN drops",
                icon: "xmark.shield.fill",
                isOn: $killSwitchEnabled
            )
            Divider().background(Theme.divider).padding(.horizontal, Theme.spaceM)
            ToggleRow(
                title: "Auto-Connect",
                subtitle: "Connect on untrusted Wi-Fi",
                icon: "wifi.slash",
                isOn: $autoConnectEnabled
            )
            Divider().background(Theme.divider).padding(.horizontal, Theme.spaceM)
            ToggleRow(
                title: "Split Tunneling",
                subtitle: "Choose which apps use VPN",
                icon: "arrow.triangle.branch",
                isOn: $splitTunnelingEnabled,
                isPremium: !rcService.subscription.isActive,
                onLockedTap: { showPaywall = true }
            )
        }
    }

    // MARK: – Privacy
    private var privacySection: some View {
        SettingsSection(title: "Privacy & DNS") {
            HStack(spacing: Theme.spaceM) {
                Image(systemName: "server.rack")
                    .foregroundColor(Theme.accentPrimary)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Custom DNS")
                        .font(Theme.fontSubheadline)
                        .foregroundColor(Theme.textPrimary)
                    TextField("e.g. 1.1.1.1", text: $customDNS)
                        .font(Theme.fontCaption)
                        .foregroundColor(Theme.textSecondary)
                        .keyboardType(.decimalPad)
                }
            }
            .padding(Theme.spaceM)
        }
    }

    // MARK: – Protocol
    private var protocolSection: some View {
        SettingsSection(title: "Protocol") {
            ToggleRow(
                title: "XTLS Vision Flow",
                subtitle: "Reduces latency for VLESS Reality",
                icon: "waveform.path.ecg.rectangle",
                isOn: .constant(true)
            )
            Divider().background(Theme.divider).padding(.horizontal, Theme.spaceM)
            NavigationRow(
                title: "Import Config",
                subtitle: "Add vless:// URI or Xray JSON",
                icon: "qrcode.viewfinder"
            ) { showImportConfig = true }
        }
    }

    // MARK: – Support
    private var supportSection: some View {
        SettingsSection(title: "Support") {
            NavigationRow(
                title: "Diagnostics",
                subtitle: "Ping, speed test, connection logs",
                icon: "stethoscope"
            ) { showDiagnostics = true }

            Divider().background(Theme.divider).padding(.horizontal, Theme.spaceM)

            NavigationRow(
                title: "Account",
                subtitle: rcService.subscription.displayName,
                icon: "person.crop.circle"
            ) { showAccount = true }
        }
    }

    // MARK: – App info
    private var appInfoSection: some View {
        VStack(spacing: 4) {
            Text("MisterNobody VPN")
                .font(Theme.fontCaption)
                .foregroundColor(Theme.textTertiary)
            Text("Version 1.0.0 · No-Log Policy")
                .font(Theme.fontSmall)
                .foregroundColor(Theme.textTertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, Theme.spaceS)
    }
}

// MARK: – Reusable rows
struct SettingsSection<Content: View>: View {
    let title: String
    let content: Content

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            SectionHeader(title: title)
                .padding(.bottom, Theme.spaceS)
            content
                .background(Theme.cardBackground)
                .cornerRadius(Theme.radiusL)
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.radiusL)
                        .stroke(Theme.border, lineWidth: 1)
                )
        }
    }
}

struct ToggleRow: View {
    let title: String
    let subtitle: String
    let icon: String
    @Binding var isOn: Bool
    var isPremium: Bool = false
    var onLockedTap: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: Theme.spaceM) {
            Image(systemName: icon)
                .foregroundColor(isPremium ? Theme.premiumGold : Theme.accentPrimary)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(Theme.fontSubheadline)
                    .foregroundColor(Theme.textPrimary)
                Text(subtitle)
                    .font(Theme.fontCaption)
                    .foregroundColor(Theme.textSecondary)
            }
            Spacer()
            if isPremium {
                Button(action: { onLockedTap?() }) {
                    Image(systemName: "lock.fill")
                        .foregroundColor(Theme.premiumGold)
                }
            } else {
                Toggle("", isOn: $isOn)
                    .tint(Theme.accentPrimary)
                    .labelsHidden()
            }
        }
        .padding(Theme.spaceM)
    }
}

struct NavigationRow: View {
    let title: String
    let subtitle: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Theme.spaceM) {
                Image(systemName: icon)
                    .foregroundColor(Theme.accentPrimary)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(Theme.fontSubheadline)
                        .foregroundColor(Theme.textPrimary)
                    Text(subtitle)
                        .font(Theme.fontCaption)
                        .foregroundColor(Theme.textSecondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundColor(Theme.textTertiary)
                    .font(.system(size: 12, weight: .semibold))
            }
            .padding(Theme.spaceM)
        }
    }
}
