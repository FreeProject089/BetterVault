# Déploiement avec Docker

L'image contient le serveur de synchronisation et l'application web, servis sur le même port.

## Prérequis

- Docker avec Docker Compose
- Pour l'accès depuis Internet : un nom de domaine pointant vers la machine, ports 80 et 443 ouverts

## 1. Configurer

À la racine du projet :

```bash
cp .env.example .env
```

Générez un secret et placez-le dans `BETTERVAULT_SECRET` :

```bash
openssl rand -base64 48
```

!!! danger
    Le secret sert à protéger l'API (réponses pour les comptes inconnus). Ne le partagez pas et ne le changez pas après la mise en service.

## 2. Démarrer

=== "Accès local uniquement"

    ```bash
    docker compose up -d --build
    ```

    BetterVault est disponible sur http://127.0.0.1:8787, uniquement depuis la machine hôte.

=== "Accès public en HTTPS"

    Dans `.env`, renseignez `DOMAIN` et passez `TRUST_PROXY=true`, puis :

    ```bash
    docker compose --profile https up -d --build
    ```

    Caddy obtient et renouvelle automatiquement le certificat HTTPS. BetterVault est disponible sur `https://votre-domaine`.

Vérifier l'état :

```bash
docker compose ps
```

```bash
curl http://127.0.0.1:8787/api/v1/health
```

## 3. Utiliser

Ouvrez l'adresse du serveur dans un navigateur et créez un compte en mode **Synchronisé** : l'adresse du serveur est pré-remplie. Sur les autres appareils (bureau, mobile, extension), saisissez cette même adresse.

!!! warning "HTTPS obligatoire hors machine locale"
    Les applications refusent les serveurs en HTTP, sauf `localhost` et `127.0.0.1`. Exposez toujours BetterVault derrière HTTPS.

## Mettre à jour

```bash
git pull
```

```bash
docker compose up -d --build
```

Les données sont conservées dans le volume `bettervault-data`.

## Sauvegarder

La base SQLite est dans le volume `bettervault-data`, fichier `/data/bettervault.db`. Voir [Configuration et sauvegardes](configuration.md#sauvegardes).

## Utiliser un autre reverse proxy

Sans le profil `https`, le conteneur écoute sur `127.0.0.1:8787`. Configurez votre proxy (Nginx, Traefik…) pour transmettre le trafic HTTPS vers cette adresse et passez `TRUST_PROXY=true`.

Exemple Nginx :

```nginx
server {
    listen 443 ssl http2;
    server_name vault.exemple.fr;

    ssl_certificate     /etc/letsencrypt/live/vault.exemple.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vault.exemple.fr/privkey.pem;

    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
