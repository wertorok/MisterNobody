import NetworkExtension
import os.log

private let log = Logger(subsystem: "com.misternobody.app.tunnel", category: "PacketTunnelProvider")

final class PacketTunnelProvider: NEPacketTunnelProvider {

    private var tunnel: VlessRealityTunnel?
    private let tunnelQueue = DispatchQueue(label: "tunnel.provider", qos: .userInitiated)

    // MARK: – Start tunnel
    override func startTunnel(options: [String: NSObject]?, completionHandler: @escaping (Error?) -> Void) {
        log.info("Starting tunnel...")

        guard let proto = protocolConfiguration as? NETunnelProviderProtocol,
              let providerConfig = proto.providerConfiguration,
              let tunnelConfig = VlessRealityTunnel.Config(providerConfig: providerConfig)
        else {
            log.error("Invalid provider configuration")
            completionHandler(TunnelError.invalidConfig)
            return
        }

        let tunnel = VlessRealityTunnel(config: tunnelConfig)
        self.tunnel = tunnel

        tunnel.onConnected = { [weak self] in
            self?.configureTunnelNetwork(completionHandler: completionHandler)
        }
        tunnel.onDisconnected = { [weak self] in
            self?.cancelTunnelWithError(nil)
        }
        tunnel.onError = { [weak self] error in
            log.error("Tunnel error: \(error)")
            self?.cancelTunnelWithError(error)
        }
        tunnel.onPacketToDevice = { [weak self] data in
            self?.writePacketToDevice(data)
        }

        tunnel.connect()
    }

    // MARK: – Stop tunnel
    override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        log.info("Stopping tunnel, reason: \(reason.rawValue)")
        tunnel?.disconnect()
        tunnel = nil
        completionHandler()
    }

    // MARK: – Handle IPC messages from app
    override func handleAppMessage(_ messageData: Data, completionHandler: ((Data?) -> Void)?) {
        guard let message = try? JSONDecoder().decode(TunnelMessage.self, from: messageData) else {
            completionHandler?(nil)
            return
        }
        switch message {
        case .getStats:
            let stats = TunnelStats(
                bytesReceived: tunnel?.bytesReceived ?? 0,
                bytesSent: tunnel?.bytesSent ?? 0
            )
            let data = try? JSONEncoder().encode(stats)
            completionHandler?(data)
        case .ping:
            completionHandler?(try? JSONEncoder().encode("pong"))
        }
    }

    // MARK: – Read packets from device and forward to server
    private func readPacketsFromDevice() {
        packetFlow.readPacketObjects { [weak self] packets in
            guard let self else { return }
            for packet in packets {
                // packet.data = raw IP packet
                // TODO: derive NWEndpoint from IP header in tunnel
                self.tunnel?.sendPacket(packet.data, to: .hostPort(host: "0.0.0.0", port: 0))
            }
            // Continue reading
            self.readPacketsFromDevice()
        }
    }

    // MARK: – Write decrypted payload back to device
    private func writePacketToDevice(_ data: Data) {
        // Wrap payload in a fake IPv4 header so NEPacketFlow accepts it
        // In production: reassemble the full IP packet from the server payload
        packetFlow.writePacketObjects([
            NEPacket(data: data, protocolFamily: AF_INET)
        ])
    }

    // MARK: – Set up virtual network interface
    private func configureTunnelNetwork(completionHandler: @escaping (Error?) -> Void) {
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "10.0.0.1")

        // Virtual IP assigned to device
        settings.ipv4Settings = {
            let s = NEIPv4Settings(addresses: ["10.0.0.2"], subnetMasks: ["255.255.255.0"])
            s.includedRoutes = [NEIPv4Route.default()]  // route all traffic
            return s
        }()

        // DNS through VPN
        settings.dnsSettings = NEDNSSettings(servers: ["1.1.1.1", "8.8.8.8"])
        settings.dnsSettings?.matchDomains = [""]      // intercept all DNS

        // MTU (Reality/VLESS overhead ~50 bytes)
        settings.mtu = 1400

        setTunnelNetworkSettings(settings) { [weak self] error in
            if let error {
                log.error("Network settings error: \(error)")
                completionHandler(error)
                return
            }
            log.info("Network settings applied, starting packet read loop")
            self?.readPacketsFromDevice()
            completionHandler(nil)
        }
    }
}

// MARK: – Errors
enum TunnelError: LocalizedError {
    case invalidConfig

    var errorDescription: String? {
        switch self {
        case .invalidConfig: return "Invalid VPN configuration. Please re-import your VLESS config."
        }
    }
}
