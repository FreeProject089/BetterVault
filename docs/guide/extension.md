# Extension navigateur

L'extension fonctionne sur Chrome, Edge et Firefox (121 et plus récent).

## Installer

Construisez l'extension depuis le code source :

```bash
npm install
```

```bash
npm run build:extension
```

=== "Chrome / Edge"

    1. Ouvrez `chrome://extensions` (ou `edge://extensions`).
    2. Activez le **mode développeur**.
    3. Cliquez sur **Charger l'extension non empaquetée** et choisissez le dossier `dist-extension`.

=== "Firefox"

    1. Ouvrez `about:debugging#/runtime/this-firefox`.
    2. Cliquez sur **Charger un module complémentaire temporaire**.
    3. Choisissez `dist-extension/manifest.json`.

## Se connecter

L'extension a son propre stockage : connectez-vous avec l'onglet **Se connecter** (compte synchronisé) ou créez un compte. L'adresse du serveur par défaut est `http://127.0.0.1:8787` ; remplacez-la par celle de votre serveur.

Après déverrouillage, la clé du coffre reste en mémoire de session du navigateur pendant **15 minutes d'inactivité**. Elle est effacée au verrouillage (icône cadenas) et à la fermeture du navigateur.

## Utiliser

Le popup affiche en premier les identifiants du site ouvert.

| Action | Effet |
| --- | --- |
| **Remplir** | Remplit l'identifiant et le mot de passe dans la page |
| Icône utilisateur | Copie l'identifiant |
| Icône copie | Copie le mot de passe |
| Code à 6 chiffres | Copie le code 2FA actuel |
| Icône flèche | Ouvre l'application complète dans un onglet |

## Protection contre l'hameçonnage

- Le bouton **Remplir** n'apparaît que pour les identifiants dont le domaine correspond au site ouvert.
- Au moment du remplissage, la page est vérifiée à nouveau : si son domaine ne correspond pas (`banque.fr` contre `banque-fr.com`), le remplissage est refusé.
- Aucun script n'est présent en permanence sur les pages : le code de remplissage n'est injecté qu'au clic, dans l'onglet actif.
