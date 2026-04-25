import SwiftUI

struct ServerListView: View {
    let onSelect: (Server) -> Void

    @StateObject private var vm = ServerListViewModel()
    @EnvironmentObject private var rcService: RevenueCatService
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            VStack(spacing: 0) {
                header
                searchBar
                    .padding(.horizontal, Theme.spaceM)
                    .padding(.vertical, Theme.spaceS)

                if vm.isLoading {
                    loadingView
                } else {
                    serverList
                }
            }
        }
        .task { await vm.load() }
    }

    // MARK: – Header
    private var header: some View {
        HStack {
            Text("Select Server")
                .font(Theme.fontTitle)
                .foregroundColor(Theme.textPrimary)
            Spacer()
            Button { dismiss() } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundColor(Theme.textTertiary)
                    .font(.system(size: 24))
            }
        }
        .padding(.horizontal, Theme.spaceM)
        .padding(.top, Theme.spaceL)
        .padding(.bottom, Theme.spaceS)
    }

    // MARK: – Search
    private var searchBar: some View {
        HStack(spacing: Theme.spaceS) {
            Image(systemName: "magnifyingglass")
                .foregroundColor(Theme.textTertiary)
            TextField("Search country or city...", text: $vm.searchText)
                .font(Theme.fontBody)
                .foregroundColor(Theme.textPrimary)
        }
        .padding(Theme.spaceS + 4)
        .background(Theme.cardBackground)
        .cornerRadius(Theme.radiusM)
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusM).stroke(Theme.border, lineWidth: 1))
    }

    // MARK: – Server list
    private var serverList: some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(spacing: 0, pinnedViews: .sectionHeaders) {
                // Recommended
                if !vm.recommended.isEmpty {
                    Section {
                        ForEach(vm.recommended) { server in
                            ServerRow(server: server, isPremiumUser: rcService.subscription.isActive) {
                                onSelect(server)
                                dismiss()
                            }
                        }
                    } header: {
                        SectionHeader(title: "Recommended")
                            .background(Theme.background)
                    }
                }

                // All servers
                Section {
                    ForEach(vm.filtered) { server in
                        ServerRow(server: server, isPremiumUser: rcService.subscription.isActive) {
                            onSelect(server)
                            dismiss()
                        }
                    }
                } header: {
                    SectionHeader(title: "All Servers")
                        .background(Theme.background)
                }
            }
            .padding(.horizontal, Theme.spaceM)
            .padding(.bottom, Theme.spaceXL)
        }
    }

    private var loadingView: some View {
        VStack(spacing: Theme.spaceM) {
            Spacer()
            ProgressView()
                .tint(Theme.accentPrimary)
            Text("Loading servers...")
                .font(Theme.fontBody)
                .foregroundColor(Theme.textSecondary)
            Spacer()
        }
    }
}

// MARK: – Server Row
struct ServerRow: View {
    let server: Server
    let isPremiumUser: Bool
    let onTap: () -> Void

    var isLocked: Bool { server.isPremium && !isPremiumUser }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: Theme.spaceM) {
                Text(server.flag)
                    .font(.system(size: 28))

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(server.name)
                            .font(Theme.fontSubheadline)
                            .foregroundColor(isLocked ? Theme.textTertiary : Theme.textPrimary)
                        if server.isRecommended {
                            Text("Best")
                                .font(Theme.fontSmall)
                                .foregroundColor(Theme.connected)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Theme.connected.opacity(0.12))
                                .cornerRadius(4)
                        }
                    }
                    Text(server.city)
                        .font(Theme.fontCaption)
                        .foregroundColor(Theme.textSecondary)
                }

                Spacer()

                // Load indicator
                if !isLocked {
                    VStack(spacing: 3) {
                        Text(server.pingMs.map { "\($0) ms" } ?? "—")
                            .font(Theme.fontSmall)
                            .foregroundColor(Theme.textTertiary)
                        LoadBar(percent: server.loadPercent)
                    }
                }

                if isLocked {
                    Image(systemName: "lock.fill")
                        .foregroundColor(Theme.premiumGold)
                        .font(.system(size: 14))
                }
            }
            .padding(.vertical, 12)
        }
        .overlay(
            Divider()
                .background(Theme.divider)
                .frame(height: 1),
            alignment: .bottom
        )
    }
}

// MARK: – Load bar
struct LoadBar: View {
    let percent: Int

    var color: Color {
        switch percent {
        case 0..<50:  return Theme.success
        case 50..<80: return Theme.warning
        default:      return Theme.error
        }
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Theme.border)
                RoundedRectangle(cornerRadius: 2)
                    .fill(color)
                    .frame(width: geo.size.width * CGFloat(percent) / 100)
            }
        }
        .frame(width: 48, height: 4)
    }
}

// MARK: – ViewModel
@MainActor
final class ServerListViewModel: ObservableObject {
    @Published var searchText = ""
    @Published private(set) var servers: [Server] = []
    @Published private(set) var isLoading = false

    private let repo = ServerRepository()

    var recommended: [Server] {
        servers.filter { $0.isRecommended }
    }

    var filtered: [Server] {
        let base = servers.filter { !$0.isRecommended }
        guard !searchText.isEmpty else { return base }
        return base.filter {
            $0.name.localizedCaseInsensitiveContains(searchText) ||
            $0.country.localizedCaseInsensitiveContains(searchText) ||
            $0.city.localizedCaseInsensitiveContains(searchText)
        }
    }

    func load() async {
        isLoading = true
        await repo.refresh()
        servers = repo.servers
        isLoading = false
    }
}
