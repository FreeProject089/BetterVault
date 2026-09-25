# Contribuer à BetterVault

Merci de votre intérêt. BetterVault est un gestionnaire de mots de passe : chaque modification touche à la confiance des personnes qui l'utilisent. Les règles ci-dessous existent pour ça.

## Démarrer

Prérequis : Node.js 24, Git. Pour les applications natives : Rust (voir [Construire pas à pas](docs/development/build-guide.md)).

```bash
npm ci
cp server/.env.example server/.env   # puis renseigner BETTERVAULT_SECRET
npm run server                       # terminal 1 : API sur 127.0.0.1:8787
npm run dev                          # terminal 2 : application sur http://localhost:3000
```

Le détail (commandes, tests, documentation) est dans [docs/development/contributing.md](docs/development/contributing.md).

## Branches et demandes de fusion

| Branche | Rôle | Déploiement |
| --- | --- | --- |
| `main` | Ce qui est en production | Production, après approbation |
| `dev` | Intégration, prochaine version | Staging (`dev.<domaine>`) |
| `feat/…`, `fix/…`, `docs/…` | Votre travail | Aucun |

1. Partez de `dev` : `git switch dev && git pull && git switch -c fix/mon-correctif`.
2. Ouvrez la demande de fusion **vers `dev`**. `main` ne reçoit que des fusions de `dev`.
3. La CI (tests, types, builds) et la sécurité (secrets, code, dépendances, image, DAST) doivent être vertes. Voir [Intégration et déploiement continus](docs/development/ci-cd.md).

## Avant d'ouvrir la demande

```bash
npm run typecheck
npm test
npm run build
npm run docs:build   # si la documentation a changé
```

- Toute nouvelle logique (serveur, chiffrement, synchronisation, import) arrive avec ses tests.
- Toute valeur venant d'un coffre, d'un import ou du serveur est échappée avant d'entrer dans le HTML.
- Aucun secret dans le dépôt : ni clé, ni jeton, ni `.env`. Les tests utilisent des valeurs manifestement factices.
- Les textes de l'interface existent en français et en anglais.
- La documentation suit le code : une option, une route ou un écran qui change change aussi sa page.

## Messages de commit

Format court, en français, préfixé par le domaine :

```
fix(sync): ne plus perdre une suppression faite hors ligne
feat(admin): régler l'emplacement d'un serveur sur la carte
docs: guide de mise en place du déploiement continu
```

Pas de ligne `Co-Authored-By` ni de signature d'outil dans les messages.

## Signaler une vulnérabilité

Ne l'ouvrez **pas** en ticket public. Suivez [la politique de sécurité](docs/security.md#signaler-une-vulnerabilite) : un rapport privé, et une correction avant toute publication.

## Licence

En contribuant, vous acceptez que votre contribution soit publiée sous la licence du projet.
