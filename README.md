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
  - Vérification de compromission mondiale via l'API **Have I Been Pwned** en mode **k-Anonymity** (seuls 5 caractères hexadécimaux de SHA-1 sont transmis).

### 2. Gestion des Identifiants & 2FA
- **Champs complets** : Nom, URL de site, Identifiant/Email, Mot de passe avec historique des versions précédentes, Notes chiffrées, Passkeys (FIDO2 / WebAuthn).
- **Champs personnalisés** : Support de champs dynamiques additionnels (Texte, Masqué/PIN, Question secrète) avec bouton révéler/copier.
- **Authentificateur 2FA RFC 6238** : Génération de codes TOTP en temps réel avec compte à rebours circulaire SVG et copie en 1 clic.
- **Iconographie intelligente** : Détection de domaine et affichage automatique du logo officiel via `SimpleIcons` vectoriel SVG ou fallback globe monochrome (0 emoji dans l'UI).

### 3. Gestionnaire de Tâches & Projets (GTD)
- **Vues multiples** : Bascule instantanée entre **Vue Liste compacte** et **Vue Kanban** (4 colonnes de flux : À faire, En cours, Bloquée, Terminée).
- **Sous-tâches interactives** : Checklist à cocher directement dans la vue détaillée avec suivi du ratio de complétion.
- **Liaison bidirectionnelle** : Association d'une tâche à un identifiant pour un accès direct en 1 clic.
- **Gestion complète** : Priorités (`Basse`, `Moyenne`, `Haute`, `Urgente`), dates d'échéances, statuts et édition.

### 4. Interopérabilité & Backups
- **Import universel** : Glisser-déposer de fichiers Bitwarden (JSON/CSV), 1Password, KeePass, LastPass, Dashlane, Passky, Chrome, Firefox et JSON brut.
- **Export sécurisé** : Export standard JSON BUM (préservant toutes les métadonnées) et export CSV universel.

### 5. Multi-Plateforme
- **Web App / PWA** : Accessible directement dans le navigateur.
- **Desktop Tauri v2 (`src-tauri/`)** : Application de bureau native Windows / macOS / Linux avec backend Rust.
- **Extension Web Chromium / Firefox (`extension/`)** : Manifest V3 avec remplissage automatique des identifiants sur les pages web (Autofill).

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
│   ├── import_export/     # Parseurs & générateurs universels JSON/CSV
│   ├── store/             # State manager réactif avec persistence chiffrée
│   ├── styles/            # Design System Swiss Modernism & Addons
│   ├── types/             # Schémas TypeScript stricts
│   └── main.ts            # Contrôleur d'interface principal
├── src-tauri/             # Backend Desktop natif Tauri v2 (Rust)
├── extension/             # Extension Web Manifest V3 avec Autofill
├── Prompt/                # Cahier des charges & spécifications UI/UX
└── index.html             # Point d'entrée de l'application
```
