# Déploiement sans Docker

## Prérequis

- Node.js 24 ou plus récent
- Un reverse proxy HTTPS pour l'accès depuis Internet

## Installer et construire

```bash
git clone <adresse-du-dépôt> bettervault
```

```bash
cd bettervault
```

```bash
npm ci
```

```bash
npm run build
```

## Configurer

```bash
cp server/.env.example server/.env
```

Dans `server/.env` :

```ini
BETTERVAULT_SECRET=valeur-aléatoire-de-32-caractères-minimum
HOST=127.0.0.1
PORT=8787
BETTERVAULT_DB=/var/lib/bettervault/bettervault.db
BETTERVAULT_STATIC=dist
TRUST_PROXY=true
```

## Lancer

```bash
npm run server
```

## Service systemd

`/etc/systemd/system/bettervault.service` :

```ini
[Unit]
Description=BetterVault
After=network.target

[Service]
Type=simple
User=bettervault
WorkingDirectory=/opt/bettervault
ExecStart=/usr/bin/node --env-file=server/.env server/index.ts
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/bettervault

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now bettervault
```

Configurez ensuite le reverse proxy comme dans l'[exemple Nginx](docker.md#utiliser-un-autre-reverse-proxy).
