# Choix techniques

Cette page explique **comment l'application est faite et pourquoi**. Pour le découpage en dossiers et les flux de données, voir [Architecture](architecture.md) ; pour le modèle de menace et les garanties de chiffrement, voir [Sécurité](../security.md).

## Pas de framework

L'interface est écrite en TypeScript, sans React, Vue ni Svelte. `AppController` (`src/main.ts`) produit du HTML sous forme de gabarits littéraux, l'insère, puis branche les écouteurs.

C'est un choix, pas un oubli :

- **Le poids compte.** L'extension et l'application mobile chargent le même fichier ; chaque dépendance s'y retrouve.
- **La surface de dépendances compte encore plus.** Un gestionnaire de mots de passe qui tire trois cents paquets transitifs est difficile à auditer. Les dépendances d'exécution tiennent en une dizaine de lignes de `package.json`, presque toutes du chiffrement ou des icônes.
- **Le serveur n'a aucune dépendance.** Il n'utilise que les modules intégrés de Node.js, `node:sqlite` compris. L'image Docker de production ne contient donc pas de `node_modules`.

En contrepartie, l'insertion de HTML impose une discipline : toute valeur venant du coffre, d'un import ou du serveur passe par `escapeHtml` avant d'être insérée.

## Où vivent les clés

```text
mot de passe principal
   │
   ├─ Argon2id (t=3, m=64 Mio, p=4) ──► clé de compte
   │                                      ├─ HKDF ─► preuve d'authentification (envoyée au serveur)
   │                                      └─ HKDF ─► clé d'enveloppe
   │                                                    │
   │                                                    ▼
   └──────────────────────────────────► clé du coffre (AES-256-GCM), chiffrée par la clé d'enveloppe
```

Ce qui compte :

- **Le mot de passe principal ne quitte jamais l'appareil.** Le serveur ne reçoit qu'une preuve dérivée, qui ne permet pas de remonter à la clé du coffre.
- **Le serveur ne voit que des blobs chiffrés.** Il sait qu'un coffre existe, sa taille et sa date, jamais son contenu.
- **La clé de secours** est une seconde enveloppe de la même clé de coffre. Elle permet de changer le mot de passe principal sans perdre les données — et c'est pourquoi elle n'est affichée qu'une fois.
- **Chaque chiffrement est authentifié par des données associées** (`bettervault/v1/…`), pour qu'un blob ne puisse pas être rejoué à un autre endroit.

Le partage utilise une paire X25519 par compte : la clé d'un coffre partagé est scellée pour chaque membre (X25519 éphémère → HKDF → AES-256-GCM). La clé privée de partage est elle-même chiffrée par la clé du coffre personnel.

Sous Tauri, Argon2id passe par l'implémentation Rust native : le même coût de calcul prend une fraction du temps de la version WebAssembly.

## Le store est la seule source de vérité

`VaultStore` garde l'état déchiffré en mémoire et notifie l'interface à chaque changement. Aucun composant ne modifie les données directement.

Deux fonctions portent l'essentiel de la robustesse :

- **`normalizeVaultData`** répare et migre tout ce qui entre : anciennes versions, imports, données venues d'un autre appareil. Un type d'élément inconnu redevient un identifiant, une icône est re-nettoyée, un dossier dont le parent a disparu remonte à la racine, une boucle de parents est cassée. Rien n'entre dans le coffre sans passer par là.
- **`mergeVaultData`** fusionne deux versions élément par élément : la plus récente gagne, et une suppression enregistrée dans `deleted` l'emporte sur toute modification antérieure. Il n'y a pas de « dernier appareil qui écrit gagne » au niveau du coffre entier.

Ce découpage explique pourquoi la synchronisation supporte les conflits : en cas de `409`, on refait une fusion avec la version renvoyée par le serveur et on réessaie.

## Types d'éléments

Un élément porte un `type` : identifiant, note sécurisée, carte bancaire, identité, clé SSH, fichier ou dossier de fichiers.

Deux décisions de conception :

- **Un élément sans type enregistré est un identifiant.** Les coffres d'avant les types se lisent tels quels : il n'y a aucune migration à jouer, donc aucun risque d'en rater une sur un appareil resté hors ligne.
- **Les champs d'un type vivent dans leur propre clé** (`card`, `identity`, `sshKey`), et `payloadForType` ne garde que ceux du type courant. Changer le type d'un élément ne laisse donc pas traîner les données de l'ancien, et un import ne peut pas glisser un champ inconnu dans le coffre.

## Pièces jointes : deux rangements, une seule interface

Un fichier est toujours chiffré sur l'appareil avec sa propre clé, rangée dans le coffre. Seul l'endroit où atterrit le contenu chiffré change : le serveur pour un compte synchronisé, le coffre lui-même (`AttachmentMeta.data`, en base64) sinon.

Trois méthodes — `storeAttachment`, `loadAttachment`, `removeAttachment` — cachent cette différence au reste de l'interface, qui ne sait pas laquelle des deux voies est utilisée. C'est ce qui a permis d'ouvrir les pièces jointes aux coffres locaux sans toucher aux écrans.

Le rangement dans le coffre a une limite bien plus basse (1 Mo par fichier, la moitié de la taille du coffre au total) : le contenu est déchiffré en mémoire avec tout le coffre à chaque ouverture, et le base64 l'alourdit d'un tiers.

## Pourquoi pas Kotlin Multiplatform (ni React Native, ni Flutter)

La question revient naturellement : puisque l'application vise Windows, macOS, Linux, Android, iOS, le web **et** une extension de navigateur, pourquoi ne pas prendre un cadre multiplateforme prévu pour ça ?

Parce qu'aucun d'eux ne couvre la cible qui compte le plus ici.

| Cadre | Bureau | Mobile | Web | **Extension de navigateur** |
| --- | --- | --- | --- | --- |
| Kotlin Multiplatform + Compose | oui | oui | expérimental (Wasm) | **non** |
| Flutter | oui | oui | oui, mais en canvas | **non** |
| React Native | via RN Desktop | oui | via RN Web | **non** |
| Web + Tauri (choix retenu) | oui | oui | oui | **oui** |

Une extension de navigateur **est** une page web : son popup, son panneau latéral et sa page d'options sont du HTML rendu par le navigateur, et le remplissage de formulaire est du script injecté dans la page visitée. Un gestionnaire de mots de passe sans extension perd sa fonction la plus utilisée au quotidien. En partant du web, l'extension est gratuite ; en partant de Compose ou de Flutter, il faudrait écrire une deuxième application, en TypeScript, rien que pour elle — c'est-à-dire exactement ce qu'on cherchait à éviter.

Les autres raisons, dans l'ordre d'importance :

- **Le chiffrement est déjà portable.** Argon2id, AES-GCM, HKDF et X25519 viennent de `@noble/*` et de la WebCrypto du navigateur, présentes partout. Il n'y a pas de code cryptographique à porter par plateforme, donc pas grand-chose à gagner à changer de langage.
- **KMP ne partage pas l'interface par défaut.** Kotlin Multiplatform partage la logique ; l'interface se partage avec Compose Multiplatform, dont la cible web reste expérimentale et rend dans un canvas — au prix de l'accessibilité, de la sélection de texte et du poids.
- **Tauri donne déjà le natif là où il compte.** Trousseau du système, Windows Hello, Touch ID, Face ID, Argon2id natif, remplissage automatique Android et iOS : tout cela existe dans `src-tauri/`, en Rust, appelé depuis l'interface. Le natif sert là où il apporte quelque chose, pas partout.
- **Réécrire coûterait tout le reste.** Import/export de six formats, fusion des versions, moteur de tâches, audit, générateur : tout serait à refaire et à re-tester.

### Ce que ce choix coûte

Il faut être honnête sur l'autre côté :

- **Les performances d'une webview** restent en dessous d'une interface native sur les très longues listes. Le rendu direct sans framework compense en partie.
- **iOS impose WKWebView**, dont on ne choisit pas la version.
- **L'extension AutoFill iOS s'écrit en Swift** de toute façon (`src-tauri/ios-extension/`), comme le service d'autofill Android s'écrit en Kotlin (`BetterVaultPlugin.kt`). Le natif n'est pas entièrement évité, il est cantonné.

### Où serait KMP le bon choix

Si l'extension de navigateur disparaissait du périmètre et que les applications mobiles devenaient l'essentiel, KMP + Compose deviendrait un choix défendable : une seule base Kotlin, une interface vraiment native sur Android, et l'interopérabilité Swift sur iOS. Ce n'est pas le périmètre de BetterVault.

## Une seule interface, quatre surfaces

Le même `index.html` et le même bundle servent partout. Ce qui change est détecté à l'exécution :

| Surface | Détection | Particularités |
| --- | --- | --- |
| Web | défaut | Service worker pour le hors-ligne |
| Bureau et mobile | `__TAURI_INTERNALS__` | Stockage fichier, trousseau, biométrie, Argon2id natif |
| Popup d'extension | `?surface=popup` | Fenêtre figée à 400 × 600 |
| Panneau latéral | `?surface=panel` | Fluide, barre d'onglets mobile |

Le stockage suit la même logique : fichier écrit de façon atomique sous Tauri, `localStorage` ailleurs. Le fichier est préféré parce que le stockage d'une webview peut être vidé avec le cache — ce qui effacerait le coffre.

## Découpage du bundle

Les bibliothèques d'icônes (Simple Icons, Phosphor) pèsent bien plus que l'application. Elles sont donc chargées **à la demande**, à l'ouverture du sélecteur d'icônes, et rangées dans leurs propres fichiers par `manualChunks`.

C'est fragile dans un sens précis : un simple `import` statique depuis un module de démarrage ramènerait toute la bibliothèque dans le fichier initial. C'est pour cela que les icônes d'onglets et de types sont **recopiées** dans `src/ui/tabIcons.ts` au lieu d'être importées depuis `lucide`. Le build signale ce genre de régression avec un avertissement `INEFFECTIVE_DYNAMIC_IMPORT`.

Le service worker ne pré-charge que cinq petits fichiers ; les gros fichiers d'icônes ne sont mis en cache qu'après avoir été réellement demandés.

## Internationalisation

Les textes sont écrits en français dans le code et traduits à l'affichage, par `tr('français', 'english')` au plus près du rendu. Les messages d'erreur levés passent par `translateError`, qui tient une table de correspondances exactes et une liste de motifs pour les messages à trous.

Un test garde ce mécanisme honnête : **tout message d'erreur littéral levé dans le code doit avoir sa traduction**, sinon la suite de tests échoue. C'est ce qui empêche une erreur en français de se retrouver dans une interface en anglais.

Les pages légales et les emails sont rendus par le serveur, qui répond dans la langue demandée par `Accept-Language`.

## Le serveur

Node.js sans dépendance, SQLite via `node:sqlite`. Il expose une API de synchronisation, sert l'application web, les pages légales et une page d'administration.

Il ne connaît que des données chiffrées, ce qui simplifie son rôle : versionner les coffres (révisions et conflits), gérer les comptes et les sessions, transporter les invitations de partage, et stocker les pièces jointes chiffrées. Les journaux d'audit désignent les comptes par un pseudonyme HMAC : on peut relier des événements entre eux sans connaître l'adresse email.

## Tests

La suite Vitest couvre les parties où une erreur ne se verrait pas à l'œil nu :

- **Cryptographie** : dérivation, enveloppes, clé de secours, scellage du partage.
- **Fusion et synchronisation** : conflits entre deux appareils, suppressions qui l'emportent, coffres partagés — avec un vrai serveur HTTP et une vraie base SQLite, pas des simulacres.
- **Formats d'import et d'export** : KeePass, 1Password, Bitwarden, CXF, CSV, et l'aller-retour des exports BetterVault.
- **Réparation des données** : parents disparus, boucles de dossiers, types inconnus.
- **Traductions** : le test décrit plus haut.

Les tests qui dérivent des clés utilisent des paramètres Argon2id réduits : le coût réel rendrait la suite inutilisable, et ce n'est pas lui qu'on teste.
