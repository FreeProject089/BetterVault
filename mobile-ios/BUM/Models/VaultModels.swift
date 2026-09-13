import Foundation

public enum Priority: String, Codable {
    case low, medium, high, urgent
}

public enum TaskStatus: String, Codable {
    case todo, inProgress = "in_progress", completed, blocked
}

public enum VaultType: String, Codable {
    case personal, work, team
}

public struct SubTask: Identifiable, Codable {
    public let id: String
    public var title: String
    public var isDone: Bool

    public init(id: String = UUID().uuidString, title: String, isDone: Bool = false) {
        self.id = id
        self.title = title
        self.isDone = isDone
    }
}

public struct TaskItem: Identifiable, Codable {
    public let id: String
    public let vaultId: String
    public var title: String
    public var description: String?
    public var status: TaskStatus
    public var priority: Priority
    public var dueDate: String?
    public var linkedCredentialId: String?
    public var tags: [String]
    public var subtasks: [SubTask]
    public var notes: String?
    public let createdAt: Double

    public init(
        id: String = UUID().uuidString,
        vaultId: String,
        title: String,
        description: String? = nil,
        status: TaskStatus = .todo,
        priority: Priority = .medium,
        dueDate: String? = nil,
        linkedCredentialId: String? = nil,
        tags: [String] = [],
        subtasks: [SubTask] = [],
        notes: String? = nil,
        createdAt: Double = Date().timeIntervalSince1970
    ) {
        self.id = id
        self.vaultId = vaultId
        self.title = title
        self.description = description
        self.status = status
        self.priority = priority
        self.dueDate = dueDate
        self.linkedCredentialId = linkedCredentialId
        self.tags = tags
        self.subtasks = subtasks
        self.notes = notes
        self.createdAt = createdAt
    }
}

public struct CredentialItem: Identifiable, Codable {
    public let id: String
    public let vaultId: String
    public var title: String
    public var username: String
    public var password: String
    public var website: String
    public var domain: String
    public var totpSecret: String?
    public var notes: String?
    public var isFavorite: Bool
    public var tags: [String]
    public let createdAt: Double

    public init(
        id: String = UUID().uuidString,
        vaultId: String,
        title: String,
        username: String,
        password: String,
        website: String,
        domain: String,
        totpSecret: String? = nil,
        notes: String? = nil,
        isFavorite: Bool = false,
        tags: [String] = [],
        createdAt: Double = Date().timeIntervalSince1970
    ) {
        self.id = id
        self.vaultId = vaultId
        self.title = title
        self.username = username
        self.password = password
        self.website = website
        self.domain = domain
        self.totpSecret = totpSecret
        self.notes = notes
        self.isFavorite = isFavorite
        self.tags = tags
        self.createdAt = createdAt
    }
}
