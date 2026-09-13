package com.bum.vault.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.bum.vault.data.model.CredentialItem
import com.bum.vault.data.model.Priority
import com.bum.vault.data.model.TaskItem
import com.bum.vault.data.model.TaskStatus

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            BUMAppTheme {
                BUMMainScreen()
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BUMMainScreen() {
    var selectedTab by remember { mutableStateOf(0) } // 0 = Passwords, 1 = Tasks, 2 = 2FA
    var searchQuery by remember { mutableStateOf("") }

    val credentials = remember {
        mutableStateListOf(
            CredentialItem("1", "vault-1", "GitHub", "dev@bum-vault.io", "••••••••••••", "https://github.com", "github.com", "JBSWY3DPEHPK3PXP", "Clé SSH backup"),
            CredentialItem("2", "vault-1", "AWS Console", "root-bum", "••••••••••••", "https://aws.amazon.com", "amazon.com", "HXDMVJECJJWSRZ3U", null),
            CredentialItem("3", "vault-1", "Google Workspace", "admin@bum.io", "••••••••••••", "https://google.com", "google.com", null, null)
        )
    }

    val tasks = remember {
        mutableStateListOf(
            TaskItem("t1", "vault-1", "Renouveler certificat TLS wildcard", "Vérifier letsencrypt", TaskStatus.IN_PROGRESS, Priority.URGENT, "2026-09-20"),
            TaskItem("t2", "vault-1", "Activer YubiKey FIDO2 sur AWS", "Deuxième clé de secours", TaskStatus.TODO, Priority.HIGH, "2026-09-25")
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(28.dp)
                                .background(Color(0xFF58A6FF), RoundedCornerShape(6.dp)),
                            contentAlignment = Alignment.Center
                        ) {
                            Text("B", color = Color(0xFF0D1117), fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        }
                        Spacer(modifier = Modifier.width(10.dp))
                        Column {
                            Text("BUM Vault", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Color.White)
                            Text("Zero-Knowledge E2EE", fontSize = 10.sp, color = Color(0xFF8B949E))
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color(0xFF161B22))
            )
        },
        bottomBar = {
            NavigationBar(containerColor = Color(0xFF161B22)) {
                NavigationBarItem(
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0 },
                    label = { Text("Logins") },
                    icon = { Text("🔑") }
                )
                NavigationBarItem(
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1 },
                    label = { Text("Tâches") },
                    icon = { Text("✓") }
                )
                NavigationBarItem(
                    selected = selectedTab == 2,
                    onClick = { selectedTab = 2 },
                    label = { Text("2FA") },
                    icon = { Text("⏱") }
                )
            }
        },
        containerColor = Color(0xFF0D1117)
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp)
        ) {
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 12.dp),
                placeholder = { Text("Rechercher...", color = Color(0xFF8B949E)) },
                shape = RoundedCornerShape(8.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Color(0xFF58A6FF),
                    unfocusedBorderColor = Color(0xFF30363D),
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White,
                    focusedContainerColor = Color(0xFF161B22),
                    unfocusedContainerColor = Color(0xFF161B22)
                ),
                singleLine = true
            )

            when (selectedTab) {
                0 -> {
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(credentials) { cred ->
                            CredentialCard(cred)
                        }
                    }
                }
                1 -> {
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(tasks) { task ->
                            TaskCard(task)
                        }
                    }
                }
                2 -> {
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(credentials.filter { it.totpSecret != null }) { cred ->
                            TotpCard(cred)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun CredentialCard(cred: CredentialItem) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFF161B22)),
        shape = RoundedCornerShape(8.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(cred.title, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Text(cred.username, color = Color(0xFF8B949E), fontSize = 12.sp)
            }
            if (cred.totpSecret != null) {
                Badge(containerColor = Color(0x2258A6FF), contentColor = Color(0xFF58A6FF)) {
                    Text("2FA", fontSize = 10.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
fun TaskCard(task: TaskItem) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFF161B22)),
        shape = RoundedCornerShape(8.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(task.title, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Text(task.dueDate ?: "Sans échéance", color = Color(0xFF8B949E), fontSize = 11.sp)
            }
            Badge(
                containerColor = when(task.priority) {
                    Priority.URGENT -> Color(0x33DA3633)
                    Priority.HIGH -> Color(0x33D29922)
                    else -> Color(0x228B949E)
                },
                contentColor = when(task.priority) {
                    Priority.URGENT -> Color(0xFFDA3633)
                    Priority.HIGH -> Color(0xFFD29922)
                    else -> Color(0xFF8B949E)
                }
            ) {
                Text(task.priority.name, fontSize = 10.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
fun TotpCard(cred: CredentialItem) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFF161B22)),
        shape = RoundedCornerShape(8.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(cred.title, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Text("849 201", color = Color(0xFF58A6FF), fontSize = 20.sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
            }
            Text("28s", color = Color(0xFF8B949E), fontSize = 12.sp)
        }
    }
}

@Composable
fun BUMAppTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Color(0xFF58A6FF),
            background = Color(0xFF0D1117),
            surface = Color(0xFF161B22)
        ),
        content = content
    )
}
