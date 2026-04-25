import Foundation
import NetworkExtension
import Combine

final class VPNManager: ObservableObject {
    static let shared = VPNManager()

    @Published private(set) var status: VPNStatus = .disconnected
    @Published private(set) var bytesReceived: Int64 = 0
    @Published private(set) var bytesSent: Int64 = 0
    @Published private(set) var currentServer: Server?

    private var manager: NETunnelProviderManager?
    private var statsTimer: Timer?
    private var cancellables = Set<AnyCancellable>()

    private let managerTitle = "MisterNobody VPN"
    private let extensionBundleId = "com.misternobody.app.tunnel"

    private init() {
        Task { await loadManager() }
        observeVPNStatus()
    }

    // MARK: – Connect
    func connect(to server: Server, config: VlessConfig) async throws {
        let mgr = try await ensureManager()

        let proto = NETunnelProviderProtocol()
        proto.providerBundleIdentifier = extensionBundleId
        proto.serverAddress = "\(server.host):\(server.port)"
        proto.providerConfiguration = config.toProviderConfig()

        mgr.protocolConfiguration = proto
        mgr.isEnabled = true
        mgr.localizedDescription = managerTitle

        try await mgr.saveToPreferences()
        try await mgr.loadFromPreferences()

        try (mgr.connection as! NETunnelProviderSession)
            .startTunnel(options: nil)

        await MainActor.run {
            self.currentServer = server
            self.status = .connecting
        }
    }

    // MARK: – Disconnect
    func disconnect() async {
        manager?.connection.stopVPNTunnel()
        await MainActor.run {
            self.status = .disconnecting
        }
    }

    // MARK: – Toggle
    func toggle(server: Server, config: VlessConfig) async throws {
        if status.isConnected || status.isBusy {
            await disconnect()
        } else {
            try await connect(to: server, config: config)
        }
    }

    // MARK: – Stats
    private func startStatsPolling() {
        statsTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            self?.requestStats()
        }
    }

    private func stopStatsPolling() {
        statsTimer?.invalidate()
        statsTimer = nil
        Task { @MainActor in
            self.bytesReceived = 0
            self.bytesSent = 0
        }
    }

    private func requestStats() {
        guard let session = manager?.connection as? NETunnelProviderSession else { return }
        try? session.sendProviderMessage(
            try! JSONEncoder().encode(TunnelMessage.getStats)
        ) { [weak self] data in
            guard let data, let stats = try? JSONDecoder().decode(TunnelStats.self, from: data) else { return }
            Task { @MainActor in
                self?.bytesReceived = stats.bytesReceived
                self?.bytesSent = stats.bytesSent
            }
        }
    }

    // MARK: – VPN status observation
    private func observeVPNStatus() {
        NotificationCenter.default.publisher(for: .NEVPNStatusDidChange)
            .sink { [weak self] _ in self?.handleStatusChange() }
            .store(in: &cancellables)
    }

    private func handleStatusChange() {
        guard let conn = manager?.connection else { return }
        Task { @MainActor in
            switch conn.status {
            case .invalid, .disconnected:
                self.status = .disconnected
                self.stopStatsPolling()
            case .connecting, .reasserting:
                self.status = .connecting
            case .connected:
                self.status = .connected(since: conn.connectedDate ?? Date())
                self.startStatsPolling()
            case .disconnecting:
                self.status = .disconnecting
            @unknown default:
                break
            }
        }
    }

    // MARK: – Manager setup
    private func loadManager() async {
        let managers = (try? await NETunnelProviderManager.loadAllFromPreferences()) ?? []
        let existing = managers.first { $0.localizedDescription == managerTitle }
        await MainActor.run {
            self.manager = existing
            if let conn = existing?.connection {
                switch conn.status {
                case .connected:
                    self.status = .connected(since: conn.connectedDate ?? Date())
                default:
                    break
                }
            }
        }
    }

    private func ensureManager() async throws -> NETunnelProviderManager {
        if let mgr = manager { return mgr }
        let managers = try await NETunnelProviderManager.loadAllFromPreferences()
        if let existing = managers.first(where: { $0.localizedDescription == managerTitle }) {
            manager = existing
            return existing
        }
        let new = NETunnelProviderManager()
        new.localizedDescription = managerTitle
        manager = new
        return new
    }
}

// MARK: – Provider config helpers
extension VlessConfig {
    func toProviderConfig() -> [String: Any] {
        [
            "uuid":             uuid,
            "host":             host,
            "port":             Int(port),
            "network":          network.rawValue,
            "security":         security.rawValue,
            "realityPublicKey": realityPublicKey,
            "realityShortId":   realityShortId,
            "realitySNI":       realitySNI,
            "realitySpiderX":   realitySpiderX,
            "flow":             flow.rawValue,
        ]
    }
}

// MARK: – IPC messages
enum TunnelMessage: String, Codable {
    case getStats
    case ping
}

struct TunnelStats: Codable {
    let bytesReceived: Int64
    let bytesSent: Int64
}
