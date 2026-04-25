import Foundation
import Combine

@MainActor
final class HomeViewModel: ObservableObject {
    @Published var selectedServer: Server?
    @Published var selectedConfig: VlessConfig?
    @Published var showServerPicker = false
    @Published var showConfigImport = false
    @Published var showPaywall = false
    @Published var importText = ""
    @Published var importError: String?
    @Published var toast: (message: String, type: ToastType)?

    private let vpnManager: VPNManager
    private let rcService: RevenueCatService
    private let importService = ConfigImportService()
    private var cancellables = Set<AnyCancellable>()
    private var toastTask: Task<Void, Never>?

    var status: VPNStatus { vpnManager.status }
    var bytesReceived: Int64 { vpnManager.bytesReceived }
    var bytesSent: Int64 { vpnManager.bytesSent }
    var isPremium: Bool { rcService.subscription.isActive }

    init(vpnManager: VPNManager = .shared, rcService: RevenueCatService = .shared) {
        self.vpnManager = vpnManager
        self.rcService = rcService
        bindPublishers()
        loadDefaults()
    }

    // MARK: – Connect / Disconnect
    func toggleConnection() {
        guard let server = selectedServer, let config = selectedConfig else {
            showServerPicker = true
            return
        }

        if !isPremium && server.isPremium {
            showPaywall = true
            return
        }

        Task {
            do {
                try await vpnManager.toggle(server: server, config: config)
            } catch {
                showToast(error.localizedDescription, type: .error)
            }
        }
    }

    // MARK: – Import config
    func importConfig() {
        importError = nil
        let result = importService.parse(text: importText)
        switch result {
        case .success(let config):
            selectedConfig = config
            showConfigImport = false
            importText = ""
            showToast("Config imported successfully", type: .success)
            saveConfig(config)
        case .failure(let error):
            importError = error.localizedDescription
        }
    }

    // MARK: – Server selection
    func selectServer(_ server: Server) {
        if !isPremium && server.isPremium {
            showPaywall = true
            return
        }
        selectedServer = server
        showServerPicker = false
        saveSelectedServer(server)
    }

    // MARK: – Toast
    func showToast(_ message: String, type: ToastType) {
        toastTask?.cancel()
        toast = (message, type)
        toastTask = Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            if !Task.isCancelled { toast = nil }
        }
    }

    // MARK: – Persistence
    private func saveConfig(_ config: VlessConfig) {
        if let data = try? JSONEncoder().encode(config) {
            UserDefaults.standard.set(data, forKey: "last_config")
        }
    }

    private func saveSelectedServer(_ server: Server) {
        if let data = try? JSONEncoder().encode(server) {
            UserDefaults.standard.set(data, forKey: "last_server")
        }
    }

    private func loadDefaults() {
        if let data = UserDefaults.standard.data(forKey: "last_config"),
           let config = try? JSONDecoder().decode(VlessConfig.self, from: data) {
            selectedConfig = config
        }
        if let data = UserDefaults.standard.data(forKey: "last_server"),
           let server = try? JSONDecoder().decode(Server.self, from: data) {
            selectedServer = server
        }
    }

    private func bindPublishers() {
        vpnManager.$status
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)

        vpnManager.$bytesReceived
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)
    }
}

enum ToastType { case success, error, info }
