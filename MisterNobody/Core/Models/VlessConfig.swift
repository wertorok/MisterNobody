import Foundation

// MARK: – VLESS+Reality configuration
struct VlessConfig: Identifiable, Codable, Equatable {
    let id: UUID
    var alias: String

    // VLESS
    var uuid: String
    var host: String
    var port: UInt16

    // Transport
    var network: NetworkType
    var security: SecurityType

    // Reality parameters
    var realityPublicKey: String
    var realityShortId: String
    var realitySNI: String          // the "show" domain used for TLS handshake
    var realitySpiderX: String

    // XTLS / Flow
    var flow: FlowType

    enum NetworkType: String, Codable, CaseIterable {
        case tcp, ws, grpc, h2
    }

    enum SecurityType: String, Codable {
        case none, tls, reality
    }

    enum FlowType: String, Codable, CaseIterable {
        case none    = ""
        case xtlsRprx = "xtls-rprx-vision"
    }

    // MARK: – Parse vless:// URI
    static func parse(uri: String) throws -> VlessConfig {
        guard uri.hasPrefix("vless://") else {
            throw ParseError.invalidScheme
        }

        // vless://UUID@host:port?params#alias
        guard let url = URL(string: uri),
              let host = url.host,
              let port = url.port.map(UInt16.init),
              let uuid = url.user
        else {
            throw ParseError.malformedURI
        }

        let alias = url.fragment ?? "\(host):\(port)"

        var params: [String: String] = [:]
        URLComponents(string: uri)?.queryItems?.forEach { item in
            if let value = item.value { params[item.name] = value }
        }

        guard let security = SecurityType(rawValue: params["security"] ?? "none") else {
            throw ParseError.unknownSecurity
        }

        return VlessConfig(
            id: UUID(),
            alias: alias,
            uuid: uuid,
            host: host,
            port: port,
            network: NetworkType(rawValue: params["type"] ?? "tcp") ?? .tcp,
            security: security,
            realityPublicKey: params["pbk"] ?? "",
            realityShortId: params["sid"] ?? "",
            realitySNI: params["sni"] ?? params["serverName"] ?? "",
            realitySpiderX: params["spx"] ?? "",
            flow: FlowType(rawValue: params["flow"] ?? "") ?? .none
        )
    }

    // MARK: – Export vless:// URI
    func toURI() -> String {
        var components = URLComponents()
        components.scheme = "vless"
        components.user = uuid
        components.host = host
        components.port = Int(port)
        components.queryItems = [
            URLQueryItem(name: "security", value: security.rawValue),
            URLQueryItem(name: "type",     value: network.rawValue),
            URLQueryItem(name: "pbk",      value: realityPublicKey),
            URLQueryItem(name: "sid",      value: realityShortId),
            URLQueryItem(name: "sni",      value: realitySNI),
            URLQueryItem(name: "spx",      value: realitySpiderX),
            URLQueryItem(name: "flow",     value: flow.rawValue),
        ].filter { !($0.value?.isEmpty ?? true) }
        components.fragment = alias
        return components.url?.absoluteString ?? ""
    }

    enum ParseError: LocalizedError {
        case invalidScheme, malformedURI, unknownSecurity

        var errorDescription: String? {
            switch self {
            case .invalidScheme:   return "Not a vless:// URI"
            case .malformedURI:    return "Malformed VLESS URI"
            case .unknownSecurity: return "Unknown security type"
            }
        }
    }

    static let preview = VlessConfig(
        id: UUID(),
        alias: "Frankfurt Server",
        uuid: "550e8400-e29b-41d4-a716-446655440000",
        host: "de1.example.vpn",
        port: 443,
        network: .tcp,
        security: .reality,
        realityPublicKey: "bXlQdWJsaWNLZXkxMjM0NTY3ODkwYWJjZGVm",
        realityShortId: "a1b2c3d4",
        realitySNI: "www.apple.com",
        realitySpiderX: "/",
        flow: .xtlsRprx
    )
}
