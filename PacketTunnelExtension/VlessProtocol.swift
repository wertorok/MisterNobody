import Foundation
import Network

// MARK: – VLESS request encoder / decoder
// Protocol spec: https://xtls.github.io/development/protocols/vless.html
struct VlessRequest {
    let uuid: UUID
    let command: Command
    let address: TargetAddress
    let port: UInt16

    enum Command: UInt8 {
        case tcp = 0x01
        case udp = 0x02
        case mux = 0x03
    }

    enum TargetAddress {
        case ipv4(Data)    // exactly 4 bytes
        case domain(String)
        case ipv6(Data)    // exactly 16 bytes

        var typeCode: UInt8 {
            switch self {
            case .ipv4:   return 0x01
            case .domain: return 0x02
            case .ipv6:   return 0x03
            }
        }
    }

    // MARK: – Encode to wire bytes
    func encode(withPayload payload: Data = Data()) -> Data {
        var buf = Data()
        // Version
        buf.append(0x00)
        // UUID (16 bytes)
        let (u1, u2, u3, u4, u5, u6, u7, u8, u9, u10, u11, u12, u13, u14, u15, u16) = uuid.uuid
        buf.append(contentsOf: [u1, u2, u3, u4, u5, u6, u7, u8, u9, u10, u11, u12, u13, u14, u15, u16])
        // Addon length (0 = no extensions)
        buf.append(0x00)
        // Command
        buf.append(command.rawValue)
        // Port (big-endian)
        buf.append(UInt8(port >> 8))
        buf.append(UInt8(port & 0xFF))
        // Address
        buf.append(address.typeCode)
        switch address {
        case .ipv4(let bytes):
            buf.append(contentsOf: bytes)
        case .domain(let name):
            let nameData = name.data(using: .utf8) ?? Data()
            buf.append(UInt8(nameData.count))
            buf.append(contentsOf: nameData)
        case .ipv6(let bytes):
            buf.append(contentsOf: bytes)
        }
        // Payload
        buf.append(contentsOf: payload)
        return buf
    }
}

// MARK: – VLESS response parser
struct VlessResponse {
    let version: UInt8
    let addonLength: UInt8
    let addon: Data

    // Minimum header size to read before payload
    static let minHeaderSize = 2

    static func parse(from data: Data) -> (response: VlessResponse, payloadOffset: Int)? {
        guard data.count >= 2 else { return nil }
        let version = data[0]
        let addonLen = Int(data[1])
        let headerSize = 2 + addonLen
        guard data.count >= headerSize else { return nil }
        let addon = data.subdata(in: 2..<(2 + addonLen))
        let response = VlessResponse(version: version, addonLength: UInt8(addonLen), addon: addon)
        return (response, headerSize)
    }
}

// MARK: – Address resolution helper
extension VlessRequest.TargetAddress {
    static func from(host: NWEndpoint.Host, port: NWEndpoint.Port) -> (TargetAddress, UInt16) {
        let portValue = port.rawValue
        switch host {
        case .ipv4(let addr):
            var raw = addr.rawValue
            let bytes = Data(bytes: &raw, count: MemoryLayout.size(ofValue: raw))
            return (.ipv4(bytes), portValue)
        case .ipv6(let addr):
            var raw = addr.rawValue
            let bytes = Data(bytes: &raw, count: MemoryLayout.size(ofValue: raw))
            return (.ipv6(bytes), portValue)
        case .name(let name, _):
            return (.domain(name), portValue)
        @unknown default:
            return (.domain(host.debugDescription), portValue)
        }
    }
}
