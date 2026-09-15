# BetterVault

Gestionnaire de mots de passe, de codes 2FA et de tâches, chiffré de bout en bout.
Une seule interface pour le web, l'application de bureau, l'extension navigateur et le mobile.

## Sécurité

- **Mot de passe principal** : dérivé avec Argon2id (64 Mio, 3 itérations), puis séparé par HKDF en une clé de chiffrement et une preuve d'authentification.
- **Coffre** : chiffré en AES-256-GCM avec une clé aléatoire, elle-même chiffrée par la clé dérivée du mot de passe. Les données ne sont jamais écrites en clair sur l'appareil.
- **Serveur** : ne reçoit que le coffre chiffré et la preuve d'authentification (protégée à nouveau par scrypt). Il ne voit ni le mot de passe principal, ni la clé du coffre, ni les données.
- **Mot de passe oublié** : une clé de secours (256 bits) est donnée à la création du compte et permet de choisir un nouveau mot de passe sans perdre le coffre. Sans elle, un compte synchronisé peut repartir d'un coffre vide après un code email ou un code 2FA.
- **Double authentification du compte** : code TOTP demandé à la connexion au serveur, alertes de sécurité par email.
- **Verrouillage** : manuel (`Ctrl+L`) ou après 5 minutes d'inactivité ; les clés sont effacées de la mémoire.

## Fonctionnalités

- Identifiants avec historique des mots de passe, champs personnalisés, passkeys, date d'expiration
- Codes 2FA, import par QR code (caméra ou image)
- Générateur de mots de passe et de phrases secrètes (liste EFF de 7 776 mots)
- Audit : mots de passe faibles, réutilisés, sans 2FA, fuites Have I Been Pwned (k-anonymat)
- Tâches : liste, Kanban, matrice d'Eisenhower, calendrier, sous-tâches, dépendances, récurrences, rappels
- Tags avec couleur exacte, filtres (favoris, 2FA, expirés, faibles, réutilisés…) et tri
- Icônes au choix : logos Simple Icons, Lucide ou Phosphor, pour les identifiants et les coffres
- Plusieurs coffres (personnel, travail, équipe)
- Coffres partagés entre comptes : rôles Propriétaire, Administrateur, Éditeur, Lecteur et rôles personnalisés, clé changée au retrait d'un membre
- Pièces jointes chiffrées (quota par compte)
- Déverrouillage biométrique (Android, Windows Hello, iOS) et remplissage automatique Android
- Sauvegardes automatiques du serveur vers S3 (MinIO fourni), chiffrées, avec durée de conservation
- Import : KeePass (`.kdbx`, `.xml`), 1Password (`.1pux`, CSV), Bitwarden (JSON, CSV), FIDO CXF, LastPass, Dashlane, Chrome, Firefox
- Export : JSON chiffré, KeePass `.kdbx`, FIDO CXF, JSON, CSV

## Comptes

À la création, deux modes :

- **Cet appareil** : le coffre chiffré reste dans le stockage local. La synchronisation peut être activée plus tard depuis *Compte et synchronisation*.
- **Synchronisé** : le coffre chiffré est envoyé à un serveur BetterVault. Les autres appareils s'y connectent avec le même email et le même mot de passe principal. Les modifications faites en parallèle sont fusionnées élément par élément.

## Développement

Prérequis : Node.js 24 ou plus récent.

```bash
npm install
```

Serveur de synchronisation (dans un terminal) :

```bash
cp server/.env.example server/.env
```

Renseigner `BETTERVAULT_SECRET` (32 caractères minimum) dans `server/.env`, puis :

```bash
npm run server
```

Application web sur http://localhost:3000 (l'API du serveur local est accessible via `/api`) :

```bash
npm run dev
```

Tests et vérification des types :

```bash
npm test
```

```bash
npm run typecheck
```

## Documentation

La documentation complète (guide, déploiement, sécurité, API) est dans `docs/`. Avec [uv](https://docs.astral.sh/uv/) installé :

```bash
npm run docs
```

Elle est servie sur http://127.0.0.1:8000.

## Docker

Installation guidée (crée `.env` et démarre les conteneurs) :

```bash
./scripts/install.sh
```

Sous Windows : `powershell -ExecutionPolicy Bypass -File scripts\install.ps1`. La page d'administration (limites, SMTP, inscriptions) est ensuite sur `/admin`.

Installation manuelle :

```bash
cp .env.example .env
```

Renseigner `BETTERVAULT_SECRET` dans `.env`, puis :

```bash
docker compose up -d --build
```

BetterVault (application web et serveur de synchronisation) est disponible sur http://127.0.0.1:8787. Pour un accès public en HTTPS avec certificat automatique, renseigner `DOMAIN` et `TRUST_PROXY=true`, puis :

```bash
docker compose --profile https up -d --build
```

## Déploiement du serveur sans Docker

```bash
npm run build
```

```bash
BETTERVAULT_SECRET=... BETTERVAULT_STATIC=dist HOST=0.0.0.0 npm run server
```

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `BETTERVAULT_SECRET` | Secret du serveur, 32 caractères minimum | requis |
| `PORT` / `HOST` | Adresse d'écoute | `8787` / `127.0.0.1` |
| `BETTERVAULT_DB` | Fichier SQLite | `server/data/bettervault.db` |
| `BETTERVAULT_STATIC` | Dossier de l'application web à servir | aucun |
| `CORS_ORIGINS` | Origines autorisées, séparées par des virgules | toutes |
| `SMTP_*`, `LIMIT_*`, `ADMIN_TOKEN` | Emails, limites des coffres, page d'administration | voir `.env.example` |

Placer le serveur derrière HTTPS : l'application refuse les serveurs en HTTP hors `localhost`.

## Application de bureau (Windows, macOS, Linux)

Prérequis : [Rust](https://rustup.rs) et les dépendances système de [Tauri](https://v2.tauri.app/start/prerequisites/).

```bash
npm run tauri dev
```

```bash
npm run tauri build
```

La version de bureau utilise Argon2id natif (Rust) et enregistre les exports dans le dossier Téléchargements.

## Mobile (Android, iOS)

Même application via Tauri mobile. Prérequis : Android Studio (SDK + NDK) ou Xcode.

```bash
npm run tauri android init
```

```bash
npm run tauri android dev
```

```bash
npm run tauri ios init
```

Sur Windows, si Gradle affiche « Unable to establish loopback connection », voir `docs/applications/bureau-mobile.md`.

## Extension navigateur (Chrome, Edge, Firefox)

```bash
npm run build:extension
```

Charger le dossier `dist-extension` :

- Chrome / Edge : `chrome://extensions`, activer le mode développeur, *Charger l'extension non empaquetée*
- Firefox : `about:debugging`, *Charger un module complémentaire temporaire*, choisir `dist-extension/manifest.json`

L'extension contient l'application complète, dans le popup, le panneau latéral ou un onglet. Un bandeau affiche les identifiants du site ouvert. Le remplissage n'est injecté qu'au clic et est refusé si le domaine de la page ne correspond pas à celui de l'identifiant. L'extension se connecte au même compte que l'application (mode synchronisé recommandé). Après déverrouillage, la clé du coffre reste en mémoire de session du navigateur pendant 15 minutes d'inactivité ; elle est effacée au verrouillage et à la fermeture du navigateur.

## Structure

```
src/
  account/        compte, cryptographie du compte, client du serveur, fusion
  crypto/         entropie, générateurs, TOTP, QR code, HIBP
  extension/      intégration de l'extension (popup, panneau, remplissage)
  icons/          icônes de services et bibliothèques d'icônes
  import_export/  KeePass, 1Password, CXF, exports chiffrés, JSON, CSV
  store/          état du coffre déchiffré en mémoire
  tasks/          moteur des tâches
  ui/             écran de compte, composants (icônes, dates, couleurs, toasts)
server/           API, emails SMTP, page d'administration (Node.js + SQLite)
src-tauri/        application de bureau et mobile (Rust)
extension/        manifeste de l'extension
scripts/          installation guidée du serveur
tests/            tests (Vitest)
```

Liste de mots : [EFF Large Wordlist](https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases), Electronic Frontier Foundation, licence CC BY 3.0 US.
