import Foundation
import UniformTypeIdentifiers

final class ConfigImportService {

    enum ImportResult {
        case success(VlessConfig)
        case failure(Error)
    }

    // MARK: – Parse raw text (vless:// URI or JSON)
    func parse(text: String) -> ImportResult {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)

        if trimmed.hasPrefix("vless://") {
            do {
                let config = try VlessConfig.parse(uri: trimmed)
                return .success(config)
            } catch {
                return .failure(error)
            }
        }

        // Try JSON Xray/v2ray config format
        if let data = trimmed.data(using: .utf8) {
            do {
                let config = try parseXrayJSON(data)
                return .success(config)
            } catch {
                return .failure(error)
            }
        }

        return .failure(ImportError.unrecognizedFormat)
    }

    // MARK: – Parse Xray outbound JSON
    private func parseXrayJSON(_ data: Data) throws -> VlessConfig {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ImportError.invalidJSON
        }

        // Support top-level outbound or array of outbounds
        let outbound: [String: Any]
        if let outbounds = json["outbounds"] as? [[String: Any]], let first = outbounds.first {
            outbound = first
        } else {
            outbound = json
        }

        guard let settings = outbound["settings"] as? [String: Any],
              let vnext = (settings["vnext"] as? [[String: Any]])?.first,
              let users = (vnext["users"] as? [[String: Any]])?.first,
              let host = vnext["address"] as? String,
              let port = vnext["port"] as? Int,
              let uuid = users["id"] as? String
        else {
            throw ImportError.missingFields
        }

        let streamSettings = outbound["streamSettings"] as? [String: Any]
        let realitySettings = streamSettings?["realitySettings"] as? [String: Any]

        return VlessConfig(
            id: UUID(),
            alias: host,
            uuid: uuid,
            host: host,
            port: UInt16(port),
            network: VlessConfig.NetworkType(rawValue: streamSettings?["network"] as? String ?? "tcp") ?? .tcp,
            security: VlessConfig.SecurityType(rawValue: streamSettings?["security"] as? String ?? "none") ?? .none,
            realityPublicKey: realitySettings?["publicKey"] as? String ?? "",
            realityShortId: (realitySettings?["shortIds"] as? [String])?.first ?? "",
            realitySNI: realitySettings?["serverName"] as? String ?? "",
            realitySpiderX: realitySettings?["spiderX"] as? String ?? "",
            flow: VlessConfig.FlowType(rawValue: users["flow"] as? String ?? "") ?? .none
        )
    }

    enum ImportError: LocalizedError {
        case unrecognizedFormat, invalidJSON, missingFields

        var errorDescription: String? {
            switch self {
            case .unrecognizedFormat: return "Unrecognized config format. Use vless:// URI or Xray JSON."
            case .invalidJSON:        return "Invalid JSON format."
            case .missingFields:      return "Config is missing required fields."
            }
        }
    }
}
