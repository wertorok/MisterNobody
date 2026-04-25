import SwiftUI

struct HomeView: View {
    @StateObject private var vm = HomeViewModel()
    @EnvironmentObject private var rcService: RevenueCatService

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            backgroundGradient

            VStack(spacing: 0) {
                navigationBar
                ScrollView(showsIndicators: false) {
                    VStack(spacing: Theme.spaceL) {
                        connectButton
                        statsRow
                        serverCard
                        if vm.selectedConfig == nil { importConfigBanner }
                    }
                    .padding(.horizontal, Theme.spaceM)
                    .padding(.vertical, Theme.spaceL)
                }
            }

            if let toast = vm.toast {
                VStack {
                    Spacer()
                    ToastView(message: toast.message, type: toast.type)
                        .padding(.bottom, 100)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                .animation(.spring(), value: vm.toast != nil)
            }
        }
        .sheet(isPresented: $vm.showServerPicker) {
            ServerListView(onSelect: vm.selectServer)
        }
        .sheet(isPresented: $vm.showConfigImport) {
            ConfigImportSheet(
                text: $vm.importText,
                error: vm.importError,
                onImport: vm.importConfig
            )
        }
        .sheet(isPresented: $vm.showPaywall) {
            PaywallView(isPresented: $vm.showPaywall, onComplete: {})
        }
    }

    // MARK: – Background gradient (changes with connection state)
    private var backgroundGradient: some View {
        ZStack {
            RadialGradient(
                colors: [
                    vm.status.color.opacity(vm.status.isConnected ? 0.15 : 0.06),
                    Color.clear
                ],
                center: .center,
                startRadius: 10,
                endRadius: 350
            )
        }
        .ignoresSafeArea()
        .animation(.easeInOut(duration: 1.0), value: vm.status.isConnected)
    }

    // MARK: – Navigation bar
    private var navigationBar: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("MisterNobody")
                    .font(Theme.fontTitle)
                    .foregroundColor(Theme.textPrimary)
                StatusBadge(status: vm.status)
            }
            Spacer()
            Button {
                // Profile / account
            } label: {
                ZStack {
                    Circle()
                        .fill(Theme.cardBackground)
                        .frame(width: 40, height: 40)
                    Image(systemName: rcService.subscription.isActive ? "person.crop.circle.fill.badge.checkmark" : "person.crop.circle")
                        .foregroundColor(rcService.subscription.isActive ? Theme.premiumGold : Theme.textSecondary)
                        .font(.system(size: 20))
                }
            }
        }
        .padding(.horizontal, Theme.spaceM)
        .padding(.vertical, Theme.spaceM)
    }

    // MARK: – Big connect button
    private var connectButton: some View {
        Button(action: vm.toggleConnection) {
            ZStack {
                // Outer glow ring
                Circle()
                    .stroke(
                        LinearGradient(
                            colors: [vm.status.color.opacity(0.6), vm.status.color.opacity(0.1)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 3
                    )
                    .frame(width: 200, height: 200)
                    .scaleEffect(vm.status.isBusy ? 1.1 : 1.0)
                    .animation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true), value: vm.status.isBusy)

                // Button circle
                Circle()
                    .fill(
                        LinearGradient(
                            colors: vm.status.isConnected
                                ? [Theme.connected.opacity(0.3), Theme.connected.opacity(0.1)]
                                : [Theme.cardBackground, Theme.surfaceBackground],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 180, height: 180)
                    .shadow(color: vm.status.color.opacity(0.3), radius: 20)

                VStack(spacing: 8) {
                    Image(systemName: vm.status.isConnected ? "lock.fill" : "lock.open.fill")
                        .font(.system(size: 44, weight: .light))
                        .foregroundColor(vm.status.color)
                        .symbolEffect(.pulse, isActive: vm.status.isBusy)

                    Text(vm.status.isConnected ? "Disconnect" : "Connect")
                        .font(Theme.fontSubheadline)
                        .foregroundColor(vm.status.color)
                }
            }
        }
        .hapticFeedback(.heavy)
        .disabled(vm.status.isBusy)
        .padding(.vertical, Theme.spaceM)
    }

    // MARK: – Stats row
    private var statsRow: some View {
        HStack(spacing: 0) {
            StatItem(
                label: "Download",
                value: vm.bytesReceived.formattedBytes,
                icon: "arrow.down.circle.fill"
            )
            Divider().frame(height: 36).background(Theme.border)
            StatItem(
                label: "Upload",
                value: vm.bytesSent.formattedBytes,
                icon: "arrow.up.circle.fill"
            )
            Divider().frame(height: 36).background(Theme.border)
            StatItem(
                label: "Duration",
                value: vm.status.connectedSince?.durationString() ?? "00:00:00",
                icon: "clock.fill"
            )
        }
        .padding(.vertical, Theme.spaceM)
        .cardStyle()
    }

    // MARK: – Server card
    private var serverCard: some View {
        Button(action: { vm.showServerPicker = true }) {
            HStack(spacing: Theme.spaceM) {
                if let server = vm.selectedServer {
                    Text(server.flag)
                        .font(.system(size: 32))
                    VStack(alignment: .leading, spacing: 4) {
                        Text(server.name)
                            .font(Theme.fontHeadline)
                            .foregroundColor(Theme.textPrimary)
                        Text("\(server.city) · \(server.pingMs.map { "\($0) ms" } ?? "—")")
                            .font(Theme.fontCaption)
                            .foregroundColor(Theme.textSecondary)
                    }
                } else {
                    Image(systemName: "globe")
                        .font(.system(size: 24))
                        .foregroundColor(Theme.textSecondary)
                        .frame(width: 36)
                    Text("Select a server")
                        .font(Theme.fontHeadline)
                        .foregroundColor(Theme.textSecondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundColor(Theme.textTertiary)
                    .font(.system(size: 14, weight: .semibold))
            }
            .padding(Theme.spaceM)
            .cardStyle()
        }
    }

    // MARK: – Import config banner
    private var importConfigBanner: some View {
        Button(action: { vm.showConfigImport = true }) {
            HStack(spacing: Theme.spaceM) {
                Image(systemName: "qrcode.viewfinder")
                    .font(.system(size: 22))
                    .foregroundColor(Theme.accentPrimary)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Import VLESS Config")
                        .font(Theme.fontSubheadline)
                        .foregroundColor(Theme.textPrimary)
                    Text("Paste vless:// URI or Xray JSON")
                        .font(Theme.fontCaption)
                        .foregroundColor(Theme.textSecondary)
                }
                Spacer()
                Image(systemName: "plus.circle.fill")
                    .foregroundColor(Theme.accentPrimary)
            }
            .padding(Theme.spaceM)
            .cardStyle()
        }
    }
}

// MARK: – Config Import Sheet
struct ConfigImportSheet: View {
    @Binding var text: String
    let error: String?
    let onImport: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            VStack(spacing: Theme.spaceL) {
                HStack {
                    Text("Import Config")
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

                Text("Paste your vless:// URI or Xray JSON config below")
                    .font(Theme.fontBody)
                    .foregroundColor(Theme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)

                TextEditor(text: $text)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundColor(Theme.textPrimary)
                    .scrollContentBackground(.hidden)
                    .background(Theme.cardBackground)
                    .cornerRadius(Theme.radiusM)
                    .frame(height: 160)
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.radiusM)
                            .stroke(Theme.border, lineWidth: 1)
                    )

                if let error {
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundColor(Theme.error)
                        Text(error)
                            .font(Theme.fontCaption)
                            .foregroundColor(Theme.error)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                PrimaryButton("Import", icon: "arrow.down.circle", isLoading: false, action: onImport)
                Spacer()
            }
            .padding(.horizontal, Theme.spaceM)
        }
    }
}
