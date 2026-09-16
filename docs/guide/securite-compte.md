# Sécurité du compte

## Clé de secours

Une clé de secours est créée avec chaque compte. Elle ressemble à ceci :

```
T7NJ NPCP JHD6 W52M G4P3 IQVA 6SRA HC34 LRFV MHPJ EY7B 7HOZ FNAA
```

Elle contient une seconde copie chiffrée de la clé du coffre. Avec elle, un mot de passe principal oublié ne fait rien perdre.

- Elle n'est affichée qu'une fois : copiez-la ou enregistrez le fichier `.txt` proposé, puis rangez-la hors de BetterVault (papier, clé USB).
- **Compte et synchronisation > Sécurité du compte > Créer une nouvelle clé** en génère une autre. L'ancienne cesse aussitôt de fonctionner.
- Le serveur ne peut pas s'en servir : il ne conserve qu'une empreinte protégée par scrypt et la clé du coffre chiffrée.

## Double authentification

Réservée aux comptes synchronisés : elle protège la connexion au serveur.

1. **Compte et synchronisation > Sécurité du compte > Activer**.
2. Confirmez avec le mot de passe principal.
3. Scannez le QR code avec une application d'authentification (Aegis, 2FAS, Google Authenticator, 1Password…).
4. Saisissez le code à 6 chiffres affiché.

Ensuite, chaque nouvelle connexion demande un code. Un code ne sert qu'une fois. Si un appareil reste connecté plus de 30 jours, la synchronisation demande un nouveau code dans la fenêtre du compte.

## Mot de passe oublié

Le lien **Mot de passe oublié ?** se trouve sur l'écran de déverrouillage et sur l'écran de connexion.

=== "Compte local"

    Saisissez la clé de secours et un nouveau mot de passe principal. Le coffre est conservé.

=== "Compte synchronisé"

    | Ce qui est demandé | Quand |
    | --- | --- |
    | Code reçu par email | Si le serveur a un SMTP configuré |
    | Code de l'application d'authentification | Si la double authentification est activée |
    | Clé de secours | Facultative, mais sans elle le coffre est remplacé par un coffre vide |

    Sans clé de secours, le serveur exige au moins le code email ou la double authentification : personne ne peut vider un coffre en connaissant seulement l'adresse email.

    Après la réinitialisation, les autres appareils sont déconnectés et doivent se reconnecter avec le nouveau mot de passe.

## Alertes par email

Si le serveur envoie des emails, vous êtes prévenu :

- d'une nouvelle connexion (adresse IP et appareil) ;
- d'un changement de mot de passe principal ;
- de l'activation ou de la désactivation de la double authentification ;
- d'une nouvelle clé de secours ou d'une réinitialisation du compte.

## Appareils connectés

**Compte > Sessions** liste les appareils connectés au compte synchronisé : appareil, adresse IP tronquée, lieu approximatif, dernière activité. La session en cours est marquée.

Fermer une session (ou toutes les autres) demande le mot de passe principal, et le code de l'application d'authentification si la double authentification est activée. L'appareil concerné est déconnecté dès son prochain échange avec le serveur.

Le lieu est calculé par votre serveur à partir d'une base locale, sans appel à un service tiers, et l'adresse IP complète n'est jamais conservée. Voir [Sessions et lieu](../deploiement/sessions-lieu.md) pour l'installer.
