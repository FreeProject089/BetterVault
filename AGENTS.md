# Consignes pour les agents (IA et outils automatiques)

Ce fichier s'adresse aux assistants de code qui travaillent sur ce dépôt. Les règles valent aussi pour les humains ; celles marquées **impératif** ne souffrent pas d'exception.

## Le projet

BetterVault est un gestionnaire de mots de passe chiffré de bout en bout : le chiffrement a lieu sur l'appareil, le serveur ne voit que des blobs chiffrés.

| Dossier | Contenu |
| --- | --- |
| `src/` | Application web (TypeScript strict, sans framework d'interface) |
| `server/` | Serveur Node.js 24 : **aucune dépendance**, seulement les modules intégrés (`node:sqlite`, `node:crypto`…) |
| `server/admin/` | Page d'administration (JavaScript sans build) |
| `src-tauri/` | Applications de bureau et mobile (Tauri 2, Rust) |
| `extension/` | Extension de navigateur |
| `docs/` | Documentation (Markdown avec blocs B.MD), servie par le serveur sous `/docs` et par MkDocs |
| `tests/` | Vitest, dont un serveur réel en mémoire |
| `security/`, `scripts/security-gate.mjs` | Configuration des scanners et porte de sécurité de la CI |
| `deploy/vps/` | Déploiement sur le VPS (compose, script, proxy) |

## Commandes

```bash
npm ci                 # dépendances
npm run typecheck      # types (application et serveur) — doit passer
npm test               # tests — doivent passer
npm run build          # application web
npm run docs:build     # documentation, mode strict (liens cassés = échec)
```

## Règles impératives

- **Aucune ligne `Co-Authored-By`**, ni signature d'outil (« Generated with… ») dans les commits, les descriptions de demande de fusion ou les fichiers.
- **Aucun secret** dans le dépôt, les tests, les journaux ou les messages : ni `.env`, ni clé, ni jeton. Les valeurs de test sont manifestement factices. Ne jamais afficher un secret trouvé : le masquer.
- **Ne pas affaiblir la sécurité pour faire passer la CI** : pas de seuil abaissé, de règle ignorée ni de test désactivé sans raison écrite et validée par un humain. Un rapport de scanner absent est un échec, pas un succès.
- **Échapper** toute valeur venant d'un coffre, d'un import, d'un serveur ou d'un fichier avant de l'insérer dans du HTML.
- **Pas de dépendance ajoutée au serveur.** Côté application, une dépendance nouvelle se justifie (poids, audit).
- **Ne pas pousser, fusionner, taguer ni déployer** sans demande explicite : ces actions sont publiques.
- **Ne pas viser la production** avec un scanner ou un script d'essai. Le DAST ne cible que l'instance locale du runner ou le staging autorisé.

## Conventions

- Commentaires et textes en **français** ; l'interface existe en français et en anglais (`tr('…', '…')`).
- Commits courts, préfixés par le domaine : `fix(sync): …`, `feat(admin): …`, `docs: …`.
- Toute logique nouvelle arrive avec ses tests ; une route, une option ou un écran qui change met à jour sa page de `docs/`.
- Documentation en B.MD : encadrés `:::note`, étapes `:::steps`, diagrammes `:::mermaid` (organigrammes `graph TD` / `LR`), tableaux `:::table`.
- Pages publiques : une seule largeur de page (`--page`, `--gutter`), thème clair et sombre via `themeVars`, script unique `/site.js` (la politique de sécurité interdit les scripts en ligne).
- Écrire comme le code autour : même densité de commentaires, mêmes noms, mêmes idiomes.

## Vérifier avant de rendre la main

1. `npm run typecheck` et `npm test` passent.
2. Pour une page ou un écran : le vérifier dans un navigateur, sur ordinateur **et** sur téléphone, en thème clair **et** sombre.
3. `git status` : aucun fichier de l'utilisateur modifié sans raison, aucun fichier temporaire, aucun secret.
4. Dire honnêtement ce qui n'a pas pu être vérifié.

## Pour aller plus loin

[CONTRIBUTING.md](CONTRIBUTING.md) · [Architecture](docs/development/architecture.md) · [Choix techniques](docs/development/technical.md) · [Intégration et déploiement continus](docs/development/ci-cd.md) · [Sécurité](docs/security.md)
