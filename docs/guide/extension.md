# Extension navigateur

L'extension fonctionne sur Chrome, Edge et Firefox (121 et plus récent). Elle contient l'application complète : identifiants, codes 2FA, tâches, générateur, audit, import / export, tags, compte et synchronisation.

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

## Trois façons de l'ouvrir

| Où | Comment | Pour quoi |
| --- | --- | --- |
| Popup | Icône BetterVault dans la barre d'outils | Remplir un formulaire, copier un code 2FA |
| Panneau latéral | Bouton panneau dans le popup (Chrome, Edge) ou menu Affichage > Barre latérale (Firefox) | Garder le coffre ouvert à côté de la page |
| Onglet | Bouton flèche dans le popup | Travailler sur grand écran |

L'interface s'adapte à la place disponible : dans le popup, la navigation passe dans la barre du bas, comme sur téléphone.

## Se connecter

L'extension a son propre stockage : connectez-vous avec l'onglet **Se connecter** (compte synchronisé) ou créez un compte. Remplacez l'adresse du serveur par défaut (`http://127.0.0.1:8787`) par celle de votre serveur.

Après déverrouillage, la clé du coffre reste en mémoire de session du navigateur pendant **15 minutes d'inactivité** : rouvrir le popup ne redemande pas le mot de passe. Elle est effacée au verrouillage et à la fermeture du navigateur.

## Remplir un formulaire

En haut de la liste, le bandeau du site ouvert affiche les identifiants correspondants.

| Action | Effet |
| --- | --- |
| **Remplir** | Remplit l'identifiant et le mot de passe dans la page, puis ferme le popup |
| Icône copie | Copie le mot de passe (effacé du presse-papiers après 30 secondes) |

## Protection contre l'hameçonnage

- Le bandeau ne propose que les identifiants dont le domaine correspond au site ouvert.
- Au moment du remplissage, la page est vérifiée à nouveau : si son domaine ne correspond pas (`banque.fr` contre `banque-fr.com`), le remplissage est refusé.
- Aucun script n'est présent en permanence sur les pages : le code de remplissage n'est injecté qu'au clic, dans l'onglet actif.
