# Sessions et lieu approximatif

Chaque connexion crée une session. Dans l'application, **Compte › Sessions** liste les appareils connectés et permet d'en fermer un, ou tous les autres.

## Ce qui est conservé

| Donnée | Détail |
| --- | --- |
| Appareil | Résumé du navigateur et du système (« Chrome · Windows »), jamais le User-Agent complet |
| Adresse IP | Tronquée : `203.0.113.x` en IPv4, `2001:db8:85a3::/48` en IPv6 |
| Lieu | Pays et ville approximatifs, calculés sur le serveur |
| Dates | Création de la session et dernière activité (mise à jour au maximum toutes les 5 minutes) |

L'adresse IP complète n'est jamais enregistrée, et rien n'est envoyé à un service tiers : le lieu est calculé localement à partir d'une base téléchargée sur le serveur.

## Installer la base de localisation

Sans base, tout fonctionne : la colonne « lieu » reste vide.

```bash
node scripts/download-geoip.mjs
```

Le script télécharge la base **DB-IP City Lite** (licence CC BY 4.0) et l'écrit dans `server/data/geoip.mmdb`. Le serveur la charge au démarrage ; redémarrez-le après le téléchargement.

Pour un autre emplacement ou une base MaxMind GeoLite2 City déjà présente :

```bash
GEOIP_DB=/chemin/vers/base.mmdb
```

Le format lu est MaxMind DB (`.mmdb`), sans dépendance externe. Mettez la base à jour de temps en temps (mensuellement chez DB-IP) : un fichier ancien donne des villes moins exactes, rien de plus.

## Fermer une session

Fermer une session demande le **mot de passe principal**, et le **code de l'application d'authentification** si la double authentification est activée. L'appareil concerné est déconnecté dès son prochain échange avec le serveur ; ses données locales restent chiffrées sur cet appareil jusqu'à ce qu'il se déconnecte.

Un changement de mot de passe principal ferme également toutes les autres sessions.
