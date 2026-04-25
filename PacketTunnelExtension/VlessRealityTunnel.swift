import Foundation
import Network
import os.log

private let log = Logger(subsystem: "com.misternobody.app.tunnel", category: "VlessRealityTunnel")

// MARK: – VLESS + Reality outbound tunnel
// Manages the TLS connection to the VLESS server and proxies IP packets.
final class VlessRealityTunnel {

    struct Config {
        let uuid: String
        let host: String
        let port: UInt16
        let sni: String
        let realityPublicKey: String
        let realityShortId: String
        let flow: String

        init?(providerConfig: [String: Any]) {
            guard
                let uuid   = providerConfig["uuid"]             as? String,
                let host   = providerConfig["host"]             as? String,
                let port   = providerConfig["port"]             as? Int,
                let sni    = providerConfig["realitySNI"]       as? String,
                let pubKey = providerConfig["realityPublicKey"] as? String,
                let sid    = providerConfig["realityShortId"]   as? String
            else { return nil }

            self.uuid             = uuid
            self.host             = host
            self.port             = UInt16(port)
            self.sni              = sni
            self.realityPublicKey = pubKey
            self.realityShortId   = sid
            self.flow             = providerConfig["flow"] as? String ?? ""
        }
    }

    private let config: Config
    private var connection: NWConnection?
    private let queue = DispatchQueue(label: "vless.tunnel", qos: .userInitiated)

    // Stats
    private(set) var bytesReceived: Int64 = 0
    private(set) var bytesSent: Int64 = 0

    // Callbacks
    var onPacketToDevice: ((Data) -> Void)?
    var onError: ((Error) -> Void)?
    var onConnected: (() -> Void)?
    var onDisconnected: (() -> Void)?

    init(config: Config) {
        self.config = config
    }

    // MARK: – Connect
    func connect() {
        do {
            let realityConfig = RealityConfig(
                serverHost: config.host,
                serverPort: config.port,
                sni: config.sni,
                publicKeyBase64: config.realityPublicKey,
                shortId: config.realityShortId,
                spiderX: "/"
            )
            let params = try RealityHandshake.buildParameters(config: realityConfig)

            let endpoint = NWEndpoint.hostPort(
                host: NWEndpoint.Host(config.host),
                port: NWEndpoint.Port(rawValue: config.port)!
            )
            connection = NWConnection(to: endpoint, using: params)
            connection?.stateUpdateHandler = { [weak self] state in
                self?.handleStateChange(state)
            }
            connection?.start(queue: queue)
        } catch {
            onError?(error)
        }
    }

    // MARK: – Disconnect
    func disconnect() {
        connection?.cancel()
        connection = nil
    }

    // MARK: – Send IP packet from device → server
    func sendPacket(_ packet: Data, to destination: NWEndpoint) {
        guard let conn = connection else { return }

        // Parse destination from the IP packet header
        guard let (host, port, payload) = parseIPv4Packet(packet) else {
            log.debug("Dropping unrecognised packet (\(packet.count) bytes)")
            return
        }

        let (address, portValue) = VlessRequest.TargetAddress.from(host: host, port: port)
        guard let parsedUUID = UUID(uuidString: config.uuid) else { return }

        let request = VlessRequest(
            uuid: parsedUUID,
            command: .tcp,
            address: address,
            port: portValue
        )
        let wireData = request.encode(withPayload: payload)

        conn.send(content: wireData, completion: .contentProcessed { [weak self] error in
            if let error {
                log.error("send error: \(error)")
                self?.onError?(error)
                return
            }
            self?.bytesSent += Int64(wireData.count)
            self?.receiveResponse()
        })
    }

    // MARK: – Receive loop
    private func receiveResponse() {
        connection?.receive(minimumIncompleteLength: 2, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self else { return }

            if let error {
                log.error("receive error: \(error)")
                self.onError?(error)
                return
            }

            if let data, !data.isEmpty {
                self.bytesReceived += Int64(data.count)

                // Strip VLESS response header on first response, then pass raw payload
                if let (_, offset) = VlessResponse.parse(from: data) {
                    let payload = data.subdata(in: offset..<data.count)
                    if !payload.isEmpty {
                        self.onPacketToDevice?(payload)
                    }
                } else {
                    self.onPacketToDevice?(data)
                }
                // Continue receiving
                self.receiveResponse()
            }

            if isComplete { self.onDisconnected?() }
        }
    }

    // MARK: – State changes
    private func handleStateChange(_ state: NWConnection.State) {
        switch state {
        case .ready:
            log.info("Tunnel connected to \(self.config.host):\(self.config.port)")
            onConnected?()
        case .failed(let error):
            log.error("Tunnel failed: \(error)")
            onError?(error)
        case .cancelled:
            log.info("Tunnel cancelled")
            onDisconnected?()
        default:
            break
        }
    }

    // MARK: – IPv4 packet parser
    // Returns (destination host, port, TCP/UDP payload)
    private func parseIPv4Packet(_ packet: Data) -> (NWEndpoint.Host, NWEndpoint.Port, Data)? {
        guard packet.count >= 20 else { return nil }

        let version = (packet[0] >> 4) & 0xF
        guard version == 4 else { return nil }

        let ihl = Int(packet[0] & 0xF) * 4
        let proto = packet[9]

        // Destination IP
        let destIP = "\(packet[16]).\(packet[17]).\(packet[18]).\(packet[19])"
        let host = NWEndpoint.Host(destIP)

        // TCP (6) or UDP (17)
        guard (proto == 6 || proto == 17), packet.count > ihl + 4 else { return nil }
        let destPort = UInt16(packet[ihl + 2]) << 8 | UInt16(packet[ihl + 3])
        let port = NWEndpoint.Port(rawValue: destPort)!

        let payloadOffset = proto == 6
            ? ihl + Int((packet[ihl + 12] >> 4)) * 4
            : ihl + 8
        guard packet.count > payloadOffset else { return nil }

        let payload = packet.subdata(in: payloadOffset..<packet.count)
        return (host, port, payload)
    }
}
