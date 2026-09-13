package com.bum.vault.data.model

import kotlinx.serialization.Serializable

enum class Priority { LOW, MEDIUM, HIGH, URGENT }
enum class TaskStatus { TODO, IN_PROGRESS, COMPLETED, BLOCKED }
enum class VaultType { PERSONAL, WORK, TEAM }

@Serializable
data class SubTask(
    val id: String,
    val title: String,
    val isDone: Boolean = false
)

@Serializable
data class TaskItem(
    val id: String,
    val vaultId: String,
    val title: String,
    val description: String? = null,
    val status: TaskStatus = TaskStatus.TODO,
    val priority: Priority = Priority.MEDIUM,
    val dueDate: String? = null,
    val linkedCredentialId: String? = null,
    val tags: List<String> = emptyList(),
    val subtasks: List<SubTask> = emptyList(),
    val notes: String? = null,
    val createdAt: Long = System.currentTimeMillis()
)

@Serializable
data class CredentialItem(
    val id: String,
    val vaultId: String,
    val title: String,
    val username: String,
    val password: String,
    val website: String,
    val domain: String,
    val totpSecret: String? = null,
    val notes: String? = null,
    val isFavorite: Boolean = false,
    val tags: List<String> = emptyList(),
    val createdAt: Long = System.currentTimeMillis()
)

@Serializable
data class VaultMetadata(
    val id: String,
    val name: String,
    val type: VaultType,
    val isLocked: Boolean = false,
    val passwordProtected: Boolean = false
)
