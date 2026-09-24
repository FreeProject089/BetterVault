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

## Clé de sécurité matérielle

Une clé USB ou NFC (YubiKey, Titan, clé intégrée à l'appareil) remplace le code de l'application d'authentification : après le mot de passe, il suffit de la toucher.

**Ajouter une clé** : *Compte* → onglet **Sécurité** → **Clés de sécurité** → **Ajouter une clé**. Le mot de passe principal est demandé, puis la clé clignote pour confirmer. Vous recevez un email à chaque ajout et à chaque retrait.

### Sans rien brancher : la biométrie de l'appareil

Si l'appareil porte une clé intégrée — **Windows Hello**, **Touch ID**, l'**empreinte ou le visage** d'un téléphone Android —, la fenêtre d'ajout propose deux choix : *Cet appareil* ou *Clé branchée*. Le premier enregistre l'appareil lui-même comme second facteur : à la connexion, une empreinte ou un regard remplace la clé USB. C'est le seul moyen d'utiliser la biométrie **dans l'extension de navigateur**, qui n'a pas accès au trousseau du système.

Le choix n'apparaît que si l'appareil répond qu'il en a une : mieux vaut pas de bouton qu'un bouton qui échoue. Et la vérification de la personne est exigée, sinon l'appareil pourrait signer sans rien demander.

!!! note "Ce que ça protège, et ce que ça ne protège pas"
    C'est un **second facteur de connexion**, pas la clé du coffre. Le coffre reste chiffré par votre mot de passe principal. L'ouverture rapide par biométrie — celle qui évite de retaper le mot de passe — est une autre fonction, réservée aux applications de bureau et mobiles, où le trousseau du système garde le secret.

### Où les clés fonctionnent

| Surface | Clé branchée (USB, NFC) | Biométrie de l'appareil |
| --- | --- | --- |
| Site en HTTPS | Oui | Oui, si l'appareil en a une |
| Extension de navigateur | Oui | Oui, si l'appareil en a une |
| Application Windows, macOS | Oui, selon la vue web du système | Oui, selon la vue web du système |
| Application Linux | Non : WebKitGTK n'a pas WebAuthn | Non |
| Application Android, iOS | Non dans la vue web native | Non |
| Serveur en `http` simple | Non : le navigateur refuse hors contexte sécurisé | Non |

Là où ce n'est pas possible, le bouton **Ajouter une clé** reste grisé avec l'explication, et le code de l'application d'authentification prend le relais. Sur bureau et mobile, l'ouverture rapide passe par Windows Hello, Touch ID, l'empreinte Android ou le trousseau de session sous Linux — voir [Biométrie et remplissage automatique](../apps/biometrics-autofill.md).

**Se connecter** : saisissez le mot de passe, la demande de clé apparaît d'elle-même. Si vous l'écartez et que la double authentification par code est aussi active, le champ du code prend le relais.

!!! warning "Une clé est liée à l'application où elle est enregistrée"
    Le site web, l'application de bureau et l'extension ont chacun leur adresse : une clé ajoutée sur le site ne fonctionne pas dans l'extension. Ajoutez-la sur chaque application que vous utilisez, ou gardez un code d'application d'authentification en second moyen.

Ce que le serveur vérifie à chaque connexion : l'application qui demande, l'usage unique du défi, la signature, et un compteur qui ne recule pas (signe d'une clé copiée).

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

Le lieu est calculé par votre serveur à partir d'une base locale, sans appel à un service tiers, et l'adresse IP complète n'est jamais conservée. Voir [Sessions et lieu](../deployment/sessions-location.md) pour l'installer.
