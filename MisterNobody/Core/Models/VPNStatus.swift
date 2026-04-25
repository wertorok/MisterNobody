import SwiftUI

enum VPNStatus: Equatable {
    case disconnected
    case connecting
    case connected(since: Date)
    case disconnecting
    case error(String)

    var label: String {
        switch self {
        case .disconnected:  return "Disconnected"
        case .connecting:    return "Connecting..."
        case .connected:     return "Connected"
        case .disconnecting: return "Disconnecting..."
        case .error:         return "Error"
        }
    }

    var color: Color {
        switch self {
        case .disconnected:  return Theme.disconnected
        case .connecting:    return Theme.connecting
        case .connected:     return Theme.connected
        case .disconnecting: return Theme.connecting
        case .error:         return Theme.error
        }
    }

    var isConnected: Bool {
        if case .connected = self { return true }
        return false
    }

    var isBusy: Bool {
        switch self {
        case .connecting, .disconnecting: return true
        default: return false
        }
    }

    var connectedSince: Date? {
        if case .connected(let since) = self { return since }
        return nil
    }
}
