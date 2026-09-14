# Sécurité

## Modèle

BetterVault est conçu pour que le serveur, et toute personne y ayant accès, ne puisse pas lire les données. Tout le chiffrement et le déchiffrement ont lieu sur l'appareil.

## Clés

```text
mot de passe maître
        │  Argon2id (64 Mio, 3 itérations, 4 voies, sel aléatoire de 16 octets)
        ▼
    clé maître (32 octets, jamais stockée)
        │  HKDF-SHA-256
        ├──────────────────────────────┐
        ▼                              ▼
clé de chiffrement              preuve d'authentification
        │                              │  envoyée au serveur, protégée
        │  AES-256-GCM                 │  à nouveau par scrypt
        ▼                              ▼
clé du coffre (aléatoire)       vérificateur stocké sur le serveur
        │  AES-256-GCM
        ▼
     coffre chiffré
```

- La **clé du coffre** est aléatoire : changer le mot de passe maître ne re-chiffre que cette clé.
- La **preuve d'authentification** est dérivée indépendamment de la clé de chiffrement : la connaître ne permet pas de déchiffrer.
- Les données chiffrées sont authentifiées (AES-GCM avec données associées) : toute altération est détectée.

## Ce que le serveur stocke

| Donnée | Lisible par le serveur |
| --- | --- |
| Email | Oui |
| Paramètres Argon2id et sel | Oui |
| Clé du coffre chiffrée | Non |
| Coffre chiffré | Non |
| Vérificateur scrypt de la preuve d'authentification | Non (ne permet ni de se connecter ni de déchiffrer) |
| Jetons de session | Empreinte SHA-256 uniquement |
| Date de dernière modification, numéro de révision | Oui |

## Sur l'appareil

- Le coffre est toujours stocké chiffré.
- Les clés ne sont gardées qu'en mémoire, jusqu'au verrouillage (manuel, ++ctrl+l++ ou 5 minutes d'inactivité).
- **Extension** : la clé du coffre est conservée en mémoire de session du navigateur (non accessible aux pages web) pendant 15 minutes d'inactivité, et effacée au verrouillage et à la fermeture du navigateur.
- Les mots de passe copiés sont effacés du presse-papiers après 30 secondes.

## Protections du serveur

- Limitation des tentatives par adresse
- Réponse identique pour les emails inconnus lors de la pré-connexion (pas d'énumération des comptes)
- Comparaison en temps constant du vérificateur
- Écritures conditionnées au numéro de révision (pas d'écrasement silencieux)
- Changement de mot de passe : révocation des autres sessions
- En-têtes `Cache-Control: no-store`, `X-Content-Type-Options`, politique CSP pour l'application servie

## Exports

| Export | Protection |
| --- | --- |
| Export chiffré BetterVault | Argon2id + AES-256-GCM, mot de passe dédié, paramètres authentifiés |
| KeePass `.kdbx` 4 | Argon2id + AES-256, valeurs protégées en ChaCha20 |
| CXF, JSON, CSV | **Aucune** : confirmation demandée avant l'export |

## Limites connues

- Un appareil compromis (logiciel malveillant, extension malveillante) peut lire les données une fois le coffre déverrouillé.
- La sécurité repose sur la robustesse du mot de passe maître face à une attaque hors ligne si le coffre chiffré est volé.
- Les métadonnées (email, taille du coffre, horaires de synchronisation) sont visibles par le serveur.

## Signaler une vulnérabilité

Ne publiez pas de détails dans un ticket public. Contactez les mainteneurs en privé avec une description et, si possible, les étapes de reproduction.
