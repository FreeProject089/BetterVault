import SwiftUI

@main
struct BUMApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
        }
    }
}

struct ContentView: View {
    @State private var selectedTab = 0
    @State private var searchQuery = ""

    @State private var credentials: [CredentialItem] = [
        CredentialItem(title: "GitHub", username: "dev@bum-vault.io", password: "••••••••••••", website: "https://github.com", domain: "github.com", totpSecret: "JBSWY3DPEHPK3PXP"),
        CredentialItem(title: "AWS Console", username: "root-bum", password: "••••••••••••", website: "https://aws.amazon.com", domain: "amazon.com", totpSecret: "HXDMVJECJJWSRZ3U"),
        CredentialItem(title: "Google Workspace", username: "admin@bum.io", password: "••••••••••••", website: "https://google.com", domain: "google.com")
    ]

    @State private var tasks: [TaskItem] = [
        TaskItem(vaultId: "v1", title: "Renouveler certificat TLS wildcard", description: "LetsEncrypt", status: .inProgress, priority: .urgent, dueDate: "2026-09-20"),
        TaskItem(vaultId: "v1", title: "Activer YubiKey FIDO2 sur AWS", description: "Clé de secours", status: .todo, priority: .high, dueDate: "2026-09-25")
    ]

    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack {
                CredentialListView(credentials: credentials, searchQuery: $searchQuery)
                    .navigationTitle("Identifiants")
                    .searchable(text: $searchQuery, prompt: "Rechercher un mot de passe...")
            }
            .tabItem {
                Label("Logins", systemImage: "key.fill")
            }
            .tag(0)

            NavigationStack {
                TaskListView(tasks: tasks)
                    .navigationTitle("Tâches & Rappels")
            }
            .tabItem {
                Label("Tâches", systemImage: "checklist")
            }
            .tag(1)

            NavigationStack {
                TotpListView(credentials: credentials.filter { $0.totpSecret != nil })
                    .navigationTitle("Codes 2FA")
            }
            .tabItem {
                Label("2FA", systemImage: "timer")
            }
            .tag(2)
        }
        .tint(Color(red: 0.35, green: 0.65, blue: 1.0))
    }
}

struct CredentialListView: View {
    let credentials: [CredentialItem]
    @Binding var searchQuery: String

    var filtered: [CredentialItem] {
        if searchQuery.isEmpty { return credentials }
        return credentials.filter { $0.title.localizedCaseInsensitiveContains(searchQuery) || $0.username.localizedCaseInsensitiveContains(searchQuery) }
    }

    var body: some View {
        List(filtered) { cred in
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color(red: 0.12, green: 0.15, blue: 0.19))
                    .frame(width: 36, height: 36)
                    .overlay(
                        Text(String(cred.title.prefix(1)))
                            .font(.headline)
                            .foregroundColor(.white)
                    )

                VStack(alignment: .leading, spacing: 2) {
                    Text(cred.title)
                        .font(.headline)
                        .foregroundColor(.primary)
                    Text(cred.username)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }

                Spacer()

                if cred.totpSecret != nil {
                    Text("2FA")
                        .font(.caption2)
                        .fontWeight(.bold)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.blue.opacity(0.2))
                        .foregroundColor(.blue)
                        .cornerRadius(4)
                }
            }
            .padding(.vertical, 4)
        }
        .listStyle(.insetGrouped)
    }
}

struct TaskListView: View {
    let tasks: [TaskItem]

    var body: some View {
        List(tasks) { task in
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(task.title)
                        .font(.headline)
                    if let due = task.dueDate {
                        Text(due)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
                Spacer()
                Text(task.priority.rawValue.uppercased())
                    .font(.caption2)
                    .fontWeight(.bold)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(task.priority == .urgent ? Color.red.opacity(0.2) : Color.orange.opacity(0.2))
                    .foregroundColor(task.priority == .urgent ? .red : .orange)
                    .cornerRadius(4)
            }
            .padding(.vertical, 4)
        }
        .listStyle(.insetGrouped)
    }
}

struct TotpListView: View {
    let credentials: [CredentialItem]

    var body: some View {
        List(credentials) { cred in
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(cred.title)
                        .font(.headline)
                    Text("849 201")
                        .font(.system(.title2, design: .monospaced))
                        .fontWeight(.bold)
                        .foregroundColor(.blue)
                }
                Spacer()
                Text("28s")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            .padding(.vertical, 6)
        }
        .listStyle(.insetGrouped)
    }
}
