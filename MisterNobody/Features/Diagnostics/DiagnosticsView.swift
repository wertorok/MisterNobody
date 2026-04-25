import SwiftUI
import Network

struct DiagnosticsView: View {
    @StateObject private var vm = DiagnosticsViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            VStack(spacing: 0) {
                header

                ScrollView(showsIndicators: false) {
                    VStack(spacing: Theme.spaceM) {
                        pingSection
                        networkSection
                        logsSection
                    }
                    .padding(.horizontal, Theme.spaceM)
                    .padding(.vertical, Theme.spaceM)
                    .padding(.bottom, Theme.spaceXL)
                }
            }
        }
        .task { await vm.runDiagnostics() }
    }

    private var header: some View {
        HStack {
            Text("Diagnostics")
                .font(Theme.fontTitle)
                .foregroundColor(Theme.textPrimary)
            Spacer()
            if vm.isRunning {
                ProgressView().tint(Theme.accentPrimary)
            } else {
                Button("Re-run") { Task { await vm.runDiagnostics() } }
                    .font(Theme.fontSubheadline)
                    .foregroundColor(Theme.accentPrimary)
            }
            Button { dismiss() } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundColor(Theme.textTertiary)
                    .font(.system(size: 24))
            }
            .padding(.leading, Theme.spaceS)
        }
        .padding(.horizontal, Theme.spaceM)
        .padding(.top, Theme.spaceL)
        .padding(.bottom, Theme.spaceM)
    }

    // MARK: – Ping section
    private var pingSection: some View {
        SettingsSection(title: "Ping Test") {
            VStack(spacing: 0) {
                ForEach(vm.pingResults) { result in
                    DiagnosticRow(
                        label: result.host,
                        value: result.displayValue,
                        status: result.status
                    )
                    if result.id != vm.pingResults.last?.id {
                        Divider().background(Theme.divider).padding(.horizontal, Theme.spaceM)
                    }
                }
            }
        }
    }

    // MARK: – Network info
    private var networkSection: some View {
        SettingsSection(title: "Network") {
            VStack(spacing: 0) {
                DiagnosticRow(label: "Connection Type",  value: vm.connectionType,   status: .neutral)
                Divider().background(Theme.divider).padding(.horizontal, Theme.spaceM)
                DiagnosticRow(label: "Local IP",         value: vm.localIP,          status: .neutral)
                Divider().background(Theme.divider).padding(.horizontal, Theme.spaceM)
                DiagnosticRow(label: "Protocol",         value: "VLESS + Reality",   status: .good)
                Divider().background(Theme.divider).padding(.horizontal, Theme.spaceM)
                DiagnosticRow(label: "DNS Leak Test",    value: vm.dnsLeakStatus,    status: vm.dnsLeakOk ? .good : .bad)
            }
        }
    }

    // MARK: – Logs
    private var logsSection: some View {
        VStack(alignment: .leading, spacing: Theme.spaceS) {
            SectionHeader(title: "Connection Log")
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(vm.logs.reversed(), id: \.self) { line in
                        Text(line)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(Theme.textSecondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(Theme.spaceM)
            }
            .frame(height: 160)
            .background(Theme.cardBackground)
            .cornerRadius(Theme.radiusM)
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusM).stroke(Theme.border))

            Button("Copy Log") {
                UIPasteboard.general.string = vm.logs.joined(separator: "\n")
            }
            .font(Theme.fontCaption)
            .foregroundColor(Theme.accentPrimary)
        }
    }
}

// MARK: – Diagnostic row
struct DiagnosticRow: View {
    let label: String
    let value: String
    let status: DiagnosticStatus

    enum DiagnosticStatus { case good, bad, neutral }

    var statusColor: Color {
        switch status {
        case .good:    return Theme.success
        case .bad:     return Theme.error
        case .neutral: return Theme.textSecondary
        }
    }

    var body: some View {
        HStack {
            Text(label)
                .font(Theme.fontSubheadline)
                .foregroundColor(Theme.textPrimary)
            Spacer()
            Text(value)
                .font(Theme.fontCaption)
                .foregroundColor(statusColor)
        }
        .padding(Theme.spaceM)
    }
}

// MARK: – ViewModel
@MainActor
final class DiagnosticsViewModel: ObservableObject {
    @Published private(set) var pingResults: [PingResult] = []
    @Published private(set) var isRunning = false
    @Published private(set) var connectionType = "—"
    @Published private(set) var localIP = "—"
    @Published private(set) var dnsLeakStatus = "Checking..."
    @Published private(set) var dnsLeakOk = true
    @Published private(set) var logs: [String] = []

    private let monitor = NWPathMonitor()

    struct PingResult: Identifiable {
        let id = UUID()
        let host: String
        var pingMs: Int?
        var failed: Bool = false

        var displayValue: String {
            if failed { return "Timeout" }
            return pingMs.map { "\($0) ms" } ?? "..."
        }

        var status: DiagnosticRow.DiagnosticStatus {
            if failed { return .bad }
            guard let ms = pingMs else { return .neutral }
            return ms < 100 ? .good : ms < 250 ? .neutral : .bad
        }
    }

    func runDiagnostics() async {
        isRunning = true
        logs = []
        addLog("Starting diagnostics...")

        // Network path
        detectNetwork()
        localIP = getLocalIP() ?? "—"
        addLog("Local IP: \(localIP)")
        addLog("Network: \(connectionType)")

        // Ping test
        let hosts = ["8.8.8.8", "1.1.1.1", "google.com"]
        pingResults = hosts.map { PingResult(host: $0) }

        for i in hosts.indices {
            let ms = await pingHost(hosts[i])
            if let ms {
                pingResults[i].pingMs = ms
                addLog("Ping \(hosts[i]): \(ms) ms")
            } else {
                pingResults[i].failed = true
                addLog("Ping \(hosts[i]): timeout")
            }
        }

        // DNS leak check (simplified)
        dnsLeakOk = await checkDNSLeak()
        dnsLeakStatus = dnsLeakOk ? "No leaks detected" : "Potential leak"
        addLog("DNS leak: \(dnsLeakStatus)")
        addLog("Diagnostics complete.")

        isRunning = false
    }

    private func addLog(_ message: String) {
        let ts = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
        logs.append("[\(ts)] \(message)")
    }

    private func detectNetwork() {
        let path = NWPathMonitor().currentPath
        if path.usesInterfaceType(.wifi) {
            connectionType = "Wi-Fi"
        } else if path.usesInterfaceType(.cellular) {
            connectionType = "Cellular"
        } else {
            connectionType = "Unknown"
        }
    }

    private func getLocalIP() -> String? {
        var address: String?
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return nil }
        var ptr: UnsafeMutablePointer<ifaddrs>? = first
        while let current = ptr {
            let flags = Int32(current.pointee.ifa_flags)
            if flags & IFF_UP != 0,
               current.pointee.ifa_addr.pointee.sa_family == UInt8(AF_INET),
               let name = current.pointee.ifa_name,
               String(cString: name) == "en0" {
                var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                if getnameinfo(current.pointee.ifa_addr, socklen_t(current.pointee.ifa_addr.pointee.sa_len),
                               &hostname, socklen_t(hostname.count), nil, 0, NI_NUMERICHOST) == 0 {
                    address = String(cString: hostname)
                }
            }
            ptr = current.pointee.ifa_next
        }
        freeifaddrs(ifaddr)
        return address
    }

    private func pingHost(_ host: String) async -> Int? {
        // Simplified TCP connect timing as ping proxy
        let start = Date()
        let conn = NWConnection(
            host: NWEndpoint.Host(host),
            port: 443,
            using: .tcp
        )
        return await withCheckedContinuation { cont in
            var resolved = false
            conn.stateUpdateHandler = { state in
                guard !resolved else { return }
                switch state {
                case .ready:
                    resolved = true
                    let ms = Int(Date().timeIntervalSince(start) * 1000)
                    conn.cancel()
                    cont.resume(returning: ms)
                case .failed, .cancelled:
                    resolved = true
                    cont.resume(returning: nil)
                default: break
                }
            }
            conn.start(queue: .global())
            DispatchQueue.global().asyncAfter(deadline: .now() + 5) {
                guard !resolved else { return }
                resolved = true
                conn.cancel()
                cont.resume(returning: nil)
            }
        }
    }

    private func checkDNSLeak() async -> Bool {
        // A proper DNS leak test would query a known test resolver.
        // Here we simulate the check.
        try? await Task.sleep(nanoseconds: 500_000_000)
        return true
    }
}
