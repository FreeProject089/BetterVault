# Contribuer

## Installation

Prérequis : Node.js 24 ou plus récent.

```bash
npm install
```

```bash
cp server/.env.example server/.env
```

Renseignez `BETTERVAULT_SECRET` dans `server/.env`.

## Lancer en local

Deux terminaux :

```bash
npm run server
```

```bash
npm run dev
```

L'application est sur http://localhost:3000. Vite transmet les appels `/api` au serveur local (port 8787) : en mode synchronisé, l'adresse du serveur pré-remplie fonctionne telle quelle.

## Commandes

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Application web avec rechargement à chaud |
| `npm run server` | Serveur de synchronisation |
| `npm test` | Tests |
| `npm run typecheck` | Vérification des types (application et serveur) |
| `npm run build` | Application web de production (`dist/`) |
| `npm run build:extension` | Extension (`dist-extension/`) |
| `npm run docs` | Documentation avec rechargement automatique (uv) |
| `npm run docs:build` | Site de documentation statique (`site/`) |
| `npm run tauri dev` | Application de bureau |

## Tests

Les tests (Vitest) couvrent notamment :

- dérivation des clés, compte local, changement de mot de passe
- serveur réel en mémoire : inscription, connexion, conflits, révocation des sessions
- synchronisation de deux appareils avec modifications simultanées et hors ligne
- tags, fusion, migration des anciennes données
- KeePass, 1Password, CXF, CSV, exports chiffrés
- moteur des tâches, TOTP, générateurs, Have I Been Pwned

```bash
npm test
```

## Documentation

La documentation utilise [MkDocs Material](https://squidfunk.github.io/mkdocs-material/) et [uv](https://docs.astral.sh/uv/) pour gérer Python : aucune installation globale n'est nécessaire, uv crée un environnement temporaire à partir de `docs/requirements.txt`.

Installer uv si besoin :

=== "Windows"

    ```powershell
    powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
    ```

=== "macOS / Linux"

    ```bash
    curl -LsSf https://astral.sh/uv/install.sh | sh
    ```

Prévisualiser la documentation avec rechargement automatique :

```bash
npm run docs
```

Elle est disponible sur http://127.0.0.1:8000. Pour générer le site statique dans `site/` (en mode strict : tout lien cassé fait échouer la génération) :

```bash
npm run docs:build
```

Sans npm, les commandes équivalentes sont :

```bash
uv run --no-project --with-requirements docs/requirements.txt mkdocs serve
```

```bash
uv run --no-project --with-requirements docs/requirements.txt mkdocs build --strict
```

## Construire les paquets

Cette page couvre le développement au quotidien. Pour produire les paquets distribuables — bureau,
Android, iOS, extension, image Docker — voir [Construire l'application](build.md).

## Conventions

- TypeScript strict, sans framework d'interface.
- Textes de l'interface en français et en anglais (`this.tr('…', '…')`).
- Toute nouvelle logique (store, compte, import) s'accompagne de tests.
- Aucune donnée fictive dans l'application.
