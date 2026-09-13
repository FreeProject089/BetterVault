# BUM — Zero-Knowledge Vault Manager (Passwords, 2FA & Tasks)

> **Suite unifiée multi-plateforme E2EE** combinant gestionnaire d'identifiants, authentificateur 2FA, générateur diceware, audit de sécurité HIBP et gestionnaire de tâches GTD.

---

## 🔐 Fonctionnalités Clés

### 1. Cryptographie & Sécurité Zero-Knowledge (E2EE)
- **Dérivation de clé (KDF)** : PBKDF2-SHA256 (600 000 itérations, conforme OWASP) / Argon2id.
- **Chiffrement fort** : AES-256-GCM avec vecteur d'initialisation (IV) aléatoire de 96 bits.
- **Coffres-forts étanches** : Multi-comptes (`Personnel`, `Professionnel`, `Équipe`) avec protection par mot de passe dédié et verrouillage instantané.
- **Audit de Sécurité & Fuites HIBP** :
  - Calcul d'entropie mathématique en temps réel (bits & score).
  - Détection automatique des mots de passe faibles et dupliqués.
  - Vérification de compromission mondiale via l'API **Have I Been Pwned** en mode **k-Anonymity** (seuls 5 caractères hexadécimaux de SHA-1 sont transmis). Si le service est injoignable, l'audit l'indique comme « résultat inconnu » au lieu de conclure à l'absence de fuite.
- **Phrases secrètes Diceware** : liste officielle EFF de 7 776 mots (≈ 12,9 bits par mot, ≈ 65 bits pour 5 mots), tirage cryptographique sans biais.

> Liste de mots : [EFF Large Wordlist for Passphrases](https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases) — Electronic Frontier Foundation, licence [CC BY 3.0 US](https://creativecommons.org/licenses/by/3.0/us/).

### 2. Gestion des Identifiants & 2FA
- **Champs complets** : Nom, URL de site, Identifiant/Email, Mot de passe avec historique des versions précédentes, Notes chiffrées, Passkeys (FIDO2 / WebAuthn).
- **Champs personnalisés** : Support de champs dynamiques additionnels (Texte, Masqué/PIN, Question secrète) avec bouton révéler/copier.
- **Authentificateur 2FA RFC 6238** : Génération de codes TOTP en temps réel avec compte à rebours circulaire SVG et copie en 1 clic.
- **Scanner de QR code 2FA** : lecture `otpauth://` via la caméra ou une capture d'écran, décodage 100 % local (jsQR), pré-remplissage du service et de l'identifiant.
- **Passkeys** : affichage de toutes les passkeys d'un identifiant, import/export avec clé privée (FIDO CXF, Bitwarden, KeePassXC).
- **Iconographie intelligente** : Détection de domaine et affichage automatique du logo officiel via `SimpleIcons` vectoriel SVG ou fallback globe monochrome (0 emoji dans l'UI).

### 3. Gestionnaire de Tâches & Projets (GTD)
- **Vues multiples** : Bascule instantanée entre **Vue Liste compacte** et **Vue Kanban** (4 colonnes de flux : À faire, En cours, Bloquée, Terminée).
- **Sous-tâches interactives** : Checklist à cocher directement dans la vue détaillée avec suivi du ratio de complétion.
- **Liaison bidirectionnelle** : Association d'une tâche à un identifiant pour un accès direct en 1 clic.
- **Gestion complète** : Priorités (`Basse`, `Moyenne`, `Haute`, `Urgente`), dates d'échéances, statuts et édition.
- **Matrice d'Eisenhower** : classement automatique Faire / Planifier / Déléguer / Plus tard (priorité + échéance à 2 jours).
- **Récurrences avancées** : quotidienne, hebdomadaire, mensuelle, annuelle avec intervalle et date de fin ; la prochaine occurrence est créée à la complétion (fin de mois gérée).
- **Dépendances** : une tâche ne peut être terminée tant que ses prérequis sont ouverts ; statut « Bloquée » automatique, déblocage des tâches suivantes et détection des cycles.
- **Rappels** : notification système + toast à l'heure choisie, décalés avec la récurrence.

### 4. Interopérabilité & Backups
- **Import universel** : Glisser-déposer de fichiers Bitwarden (JSON avec passkeys / CSV), 1Password (`.1pux`, CSV), KeePass (`.kdbx` 3.1 & 4.x — AES-KDF, Argon2d/id, AES-256, ChaCha20, fichier clé — et XML), FIDO CXF, LastPass, Dashlane, Passky, Chrome, Firefox et JSON brut.
- **Export chiffré** : JSON BUM protégé par un mot de passe dédié (Argon2id + AES-256-GCM, paramètres authentifiés en AAD).
- **Export KeePass** : base `.kdbx` 4 (Argon2id, AES-256) ouvrable dans KeePass / KeePassXC.
- **Exports en clair** : JSON BUM, CSV universel et FIDO CXF, avec avertissement de sécurité avant téléchargement.

### 5. Multi-Plateforme
- **Web App / PWA** : Accessible directement dans le navigateur.
- **Desktop Tauri v2 (`src-tauri/`)** : Application de bureau native Windows / macOS / Linux avec backend Rust : Argon2id natif, AES-256-GCM et trousseau du système (Windows Credential Manager, macOS Keychain, Secret Service) via `keyring` — utilisé pour mémoriser la clé de synchronisation.
- **Extension Web Chromium / Firefox (`extension/`)** : Manifest V3 avec remplissage automatique des identifiants sur les pages web (Autofill).
- **Mobile Android (`mobile-android/`)** : Application native Kotlin + Jetpack Compose avec chiffrement hardware Keystore (AES-256-GCM).
- **Mobile iOS (`mobile-ios/`)** : Application native Swift + SwiftUI avec CryptoKit et Apple Keychain sécurisé.

---

## 🛠️ Commandes Disponibles

```bash
# Installer les dépendances
npm install

# Démarrer le serveur de développement local
npm run dev

# Compiler le bundle de production web
npm run build

# Lancer l'application de bureau native Tauri v2
npm run tauri dev

# Compiler l'installeur desktop de production (.msi / .exe)
npm run tauri build
```

---

## 📁 Architecture du Projet

```
├── src/
│   ├── crypto/            # Moteurs WebCrypto (AES-GCM, KDF, HIBP, Diceware)
│   ├── icons/             # Résolution vectorielle SimpleIcons + Fallback globe
│   ├── import_export/     # Import/export : KeePass KDBX, 1PUX, CXF, export chiffré, JSON/CSV
│   ├── platform/          # Pont Tauri (Argon2id natif, trousseau OS)
│   ├── tasks/             # Moteur de tâches : Eisenhower, récurrences, dépendances, rappels
│   ├── store/             # State manager réactif avec persistence chiffrée
│   ├── styles/            # Design System Swiss Modernism & Addons
│   ├── types/             # Schémas TypeScript stricts
│   └── main.ts            # Contrôleur d'interface principal
├── src-tauri/             # Backend Desktop natif Tauri v2 (Rust)
├── extension/             # Extension Web Manifest V3 avec Autofill
├── mobile-android/        # Application native Android (Kotlin, Jetpack Compose, Keystore)
├── mobile-ios/            # Application native iOS (Swift, SwiftUI, CryptoKit, Keychain)
├── Prompt/                # Cahier des charges & spécifications UI/UX
└── index.html             # Point d'entrée de l'application
```
