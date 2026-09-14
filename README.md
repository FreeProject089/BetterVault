# BetterVault

Gestionnaire de mots de passe, de codes 2FA et de tâches, chiffré de bout en bout.
Une seule interface pour le web, l'application de bureau, l'extension navigateur et le mobile.

## Sécurité

- **Mot de passe maître** : dérivé avec Argon2id (64 Mio, 3 itérations), puis séparé par HKDF en une clé de chiffrement et une preuve d'authentification.
- **Coffre** : chiffré en AES-256-GCM avec une clé aléatoire, elle-même chiffrée par la clé dérivée du mot de passe. Les données ne sont jamais écrites en clair sur l'appareil.
- **Serveur** : ne reçoit que le coffre chiffré et la preuve d'authentification (protégée à nouveau par scrypt). Il ne voit ni le mot de passe maître, ni la clé du coffre, ni les données.
- **Mot de passe oublié** : aucune récupération possible, par conception.
- **Verrouillage** : manuel (`Ctrl+L`) ou après 5 minutes d'inactivité ; les clés sont effacées de la mémoire.

## Fonctionnalités

- Identifiants avec historique des mots de passe, champs personnalisés, passkeys, date d'expiration
- Codes 2FA (TOTP), import par QR code (caméra ou image)
- Générateur de mots de passe et de phrases secrètes (liste EFF de 7 776 mots)
- Audit : mots de passe faibles, réutilisés, sans 2FA, fuites Have I Been Pwned (k-anonymat)
- Tâches : liste, Kanban, matrice d'Eisenhower, calendrier, sous-tâches, dépendances, récurrences, rappels
- Tags colorés sur les identifiants et les tâches, filtre dans la barre latérale
- Plusieurs coffres (personnel, travail, équipe)
- Import : KeePass (`.kdbx`, `.xml`), 1Password (`.1pux`, CSV), Bitwarden (JSON, CSV), FIDO CXF, LastPass, Dashlane, Chrome, Firefox
- Export : JSON chiffré, KeePass `.kdbx`, FIDO CXF, JSON, CSV

## Comptes

À la création, deux modes :

- **Cet appareil** : le coffre chiffré reste dans le stockage local. La synchronisation peut être activée plus tard depuis *Compte & synchronisation*.
- **Synchronisé** : le coffre chiffré est envoyé à un serveur BetterVault. Les autres appareils s'y connectent avec le même email et le même mot de passe maître. Les modifications faites en parallèle sont fusionnées élément par élément.

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

## Déploiement du serveur

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

Le trousseau du système n'est pas encore relié sur mobile.

## Extension navigateur (Chrome, Edge, Firefox)

```bash
npm run build:extension
```

Charger le dossier `dist-extension` :

- Chrome / Edge : `chrome://extensions`, activer le mode développeur, *Charger l'extension non empaquetée*
- Firefox : `about:debugging`, *Charger un module complémentaire temporaire*, choisir `dist-extension/manifest.json`

Le popup affiche les identifiants du site ouvert. Le remplissage n'est injecté qu'au clic et est refusé si le domaine de la page ne correspond pas à celui de l'identifiant. L'extension se connecte au même compte que l'application (mode synchronisé recommandé). Le coffre doit être déverrouillé à chaque ouverture du popup.

## Structure

```
src/
  account/        compte, cryptographie du compte, client du serveur, fusion
  crypto/         entropie, générateurs, TOTP, QR code, HIBP
  extension/      popup et remplissage de l'extension
  import_export/  KeePass, 1Password, CXF, exports chiffrés, JSON, CSV
  store/          état du coffre déchiffré en mémoire
  tasks/          moteur des tâches
  ui/             écran de compte, saisie de tags
server/           API de synchronisation (Node.js + SQLite)
src-tauri/        application de bureau et mobile (Rust)
extension/        manifeste et page du popup
tests/            tests (Vitest)
```

Liste de mots : [EFF Large Wordlist](https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases), Electronic Frontier Foundation, licence CC BY 3.0 US.
