import Foundation

struct Server: Identifiable, Codable, Equatable {
    let id: UUID
    var name: String
    var country: String
    var countryCode: String
    var city: String
    var host: String
    var port: UInt16
    var isPremium: Bool
    var isRecommended: Bool
    var pingMs: Int?
    var loadPercent: Int

    var flag: String {
        countryCode
            .unicodeScalars
            .map { 127397 + $0.value }
            .compactMap(Unicode.Scalar.init)
            .map(Character.init)
            .map(String.init)
            .joined()
    }

    var loadColor: String {
        switch loadPercent {
        case 0..<50:  return "#2ED573"
        case 50..<80: return "#FFA502"
        default:      return "#FF4757"
        }
    }

    static let preview = Server(
        id: UUID(),
        name: "Germany #1",
        country: "Germany",
        countryCode: "DE",
        city: "Frankfurt",
        host: "de1.misternobody.vpn",
        port: 443,
        isPremium: false,
        isRecommended: true,
        pingMs: 32,
        loadPercent: 24
    )
}

// MARK: – Repository
final class ServerRepository: ObservableObject {
    @Published private(set) var servers: [Server] = []
    @Published private(set) var isLoading = false

    private let storageKey = "cached_servers"

    init() {
        loadCached()
    }

    func refresh() async {
        await MainActor.run { isLoading = true }
        // In production: fetch from your API endpoint
        // For now: use bundled list
        let bundled = Self.bundledServers
        await MainActor.run {
            self.servers = bundled
            self.isLoading = false
        }
        cache(bundled)
    }

    private func loadCached() {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let decoded = try? JSONDecoder().decode([Server].self, from: data)
        else {
            servers = Self.bundledServers
            return
        }
        servers = decoded
    }

    private func cache(_ servers: [Server]) {
        if let data = try? JSONEncoder().encode(servers) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
    }

    private static let bundledServers: [Server] = [
        Server(id: UUID(), name: "Germany #1",     country: "Germany",        countryCode: "DE", city: "Frankfurt",   host: "de1.example.vpn",  port: 443, isPremium: false, isRecommended: true,  pingMs: 28,  loadPercent: 22),
        Server(id: UUID(), name: "Netherlands #1", country: "Netherlands",    countryCode: "NL", city: "Amsterdam",   host: "nl1.example.vpn",  port: 443, isPremium: false, isRecommended: false, pingMs: 35,  loadPercent: 45),
        Server(id: UUID(), name: "Finland #1",     country: "Finland",        countryCode: "FI", city: "Helsinki",    host: "fi1.example.vpn",  port: 443, isPremium: true,  isRecommended: false, pingMs: 48,  loadPercent: 18),
        Server(id: UUID(), name: "USA East #1",    country: "United States",  countryCode: "US", city: "New York",    host: "us1.example.vpn",  port: 443, isPremium: true,  isRecommended: false, pingMs: 110, loadPercent: 61),
        Server(id: UUID(), name: "USA West #1",    country: "United States",  countryCode: "US", city: "Los Angeles", host: "us2.example.vpn",  port: 443, isPremium: true,  isRecommended: false, pingMs: 135, loadPercent: 38),
        Server(id: UUID(), name: "Japan #1",       country: "Japan",          countryCode: "JP", city: "Tokyo",       host: "jp1.example.vpn",  port: 443, isPremium: true,  isRecommended: false, pingMs: 190, loadPercent: 29),
        Server(id: UUID(), name: "Singapore #1",   country: "Singapore",      countryCode: "SG", city: "Singapore",   host: "sg1.example.vpn",  port: 443, isPremium: true,  isRecommended: false, pingMs: 165, loadPercent: 52),
        Server(id: UUID(), name: "UK #1",          country: "United Kingdom", countryCode: "GB", city: "London",      host: "uk1.example.vpn",  port: 443, isPremium: false, isRecommended: false, pingMs: 42,  loadPercent: 34),
    ]
}
