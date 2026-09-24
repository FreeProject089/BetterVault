# Dépannage

Les problèmes les plus fréquents, et comment les régler.

## Docker

### La construction de l'image est très lente ou échoue

Le contexte envoyé à Docker doit rester petit (quelques Mo). S'il pèse des centaines de Mo, un dossier lourd n'est pas exclu :

```bash
docker build --progress=plain . 2>&1 | grep "transferring context"
```

Le fichier `.dockerignore` du dépôt exclut déjà `node_modules`, `src-tauri`, les builds Android (`.gradle`, `*.apk`, `*.aab`) et les tests. Ajoutez-y tout dossier personnel placé à la racine.

### `npm ci` échoue avec `ETIMEDOUT`

Le registre npm n'a pas répondu à temps. Le `Dockerfile` réessaie cinq fois et garde un cache entre deux constructions ; relancez simplement :

```bash
docker compose build
```

Si l'échec persiste, vérifiez le proxy ou le DNS de la machine.

### Le conteneur ne démarre pas : port déjà utilisé

```text
Bind for 0.0.0.0:8787 failed: port is already allocated
```

Un autre programme occupe le port. Trouvez-le, ou changez le port publié dans `docker-compose.yml` :

```bash
docker ps --filter "publish=8787"
```

### Le conteneur redémarre en boucle

Lisez les journaux :

```bash
docker compose logs --tail=50 bettervault
```

Causes habituelles : `BETTERVAULT_SECRET` absent ou trop court (32 caractères minimum), volume de données non accessible en écriture.

## Connexion

### « Trop de tentatives, réessayez dans … »

Une limite de tentatives est atteinte pour cette adresse IP. Attendez le délai affiché. Si **tout le monde** est bloqué en même temps, le serveur est derrière un proxy sans `TRUST_PROXY=true` : toutes les requêtes partagent alors le même compteur. Voir [Limites de tentatives](administration.md#limites-de-tentatives).

### L'administration refuse le jeton de secours

- `ADMIN_TOKEN=disabled` dans le `.env` désactive le jeton : c'est voulu une fois un propriétaire créé.
- Après dix jetons faux, même le bon est refusé pendant un quart d'heure.

## Emails

### Aucun email n'arrive

1. **Réglages → SMTP → Envoyer** expédie un message d'essai et affiche l'erreur exacte du serveur SMTP.
2. Port `465` : sécurité `tls` ; port `587` : `starttls`.
3. Vérifiez les enregistrements SPF et DKIM du domaine de `SMTP_FROM`, sans quoi les messages finissent en indésirables.

### Le logo n'apparaît pas dans les emails

Le logo est chargé depuis l'adresse publique du serveur (`PUBLIC_URL`). Sans elle, l'en-tête affiche l'initiale « B ». Beaucoup de clients bloquent aussi les images jusqu'à ce que le lecteur les autorise.

## Application

### L'application affiche une ancienne version

L'application web est mise en cache pour fonctionner hors ligne. Rechargez deux fois la page, ou fermez tous ses onglets : la nouvelle version s'installe à la réouverture.

### La synchronisation reste « hors ligne »

Vérifiez que l'adresse du serveur, dans **Compte**, est joignable depuis l'appareil (`/api/v1/health` doit répondre `{"ok":true,…}`) et que `CORS_ORIGINS` autorise l'origine de l'application si elle est servie ailleurs.
