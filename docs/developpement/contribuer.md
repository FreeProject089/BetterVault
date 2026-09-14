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

La documentation utilise [MkDocs Material](https://squidfunk.github.io/mkdocs-material/).

```bash
pip install -r docs/requirements.txt
```

```bash
mkdocs serve
```

Elle est disponible sur http://127.0.0.1:8000. Pour générer le site statique dans `site/` :

```bash
mkdocs build
```

## Conventions

- TypeScript strict, sans framework d'interface.
- Textes de l'interface en français et en anglais (`this.tr('…', '…')`).
- Toute nouvelle logique (store, compte, import) s'accompagne de tests.
- Aucune donnée fictive dans l'application.
