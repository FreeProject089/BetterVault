# API du serveur

Base : `/api/v1`. Corps de requête et de réponse en JSON. Les erreurs ont la forme :

```json
{ "error": { "code": "invalid_credentials", "message": "Email ou mot de passe incorrect" } }
```

Les routes authentifiées attendent l'en-tête `Authorization: Bearer <jeton>`.

## Types

```ts
type Kdf = { t: number; m: number; p: number };           // Argon2id : itérations, mémoire (Kio), parallélisme
type EncryptedBlob = { v: 1; iv: string; ct: string };    // AES-256-GCM, Base64
```

`authHash` : preuve d'authentification de 32 octets en Base64, dérivée côté client.

## Santé

### `GET /health`

```json
{ "ok": true, "name": "BetterVault", "version": "1.0.0" }
```

## Comptes

### `POST /accounts`

Crée un compte et son coffre.

```json
{
  "email": "moi@exemple.fr",
  "authHash": "…",
  "kdf": { "t": 3, "m": 65536, "p": 4 },
  "salt": "…",
  "wrappedVaultKey": { "v": 1, "iv": "…", "ct": "…" },
  "vault": { "v": 1, "iv": "…", "ct": "…" }
}
```

| Réponse | Corps |
| --- | --- |
| `201` | `{ "token": "…", "revision": 1 }` |
| `409 email_taken` | Un compte existe pour cet email |

### `PUT /accounts/password` (authentifiée)

Change le mot de passe principal.

```json
{
  "currentAuthHash": "…",
  "newAuthHash": "…",
  "kdf": { "t": 3, "m": 65536, "p": 4 },
  "salt": "…",
  "wrappedVaultKey": { "v": 1, "iv": "…", "ct": "…" }
}
```

| Réponse | Effet |
| --- | --- |
| `204` | Identifiants remplacés, autres sessions révoquées |
| `403 invalid_credentials` | Mot de passe actuel incorrect |

### `DELETE /accounts` (authentifiée)

```json
{ "authHash": "…" }
```

`204` : compte, coffre et sessions supprimés.

## Sessions

### `POST /sessions/prelogin`

```json
{ "email": "moi@exemple.fr" }
```

Réponse : `{ "kdf": {…}, "salt": "…" }`. Pour un email inconnu, la réponse est stable et plausible, afin de ne pas révéler l'existence des comptes.

### `POST /sessions`

```json
{ "email": "moi@exemple.fr", "authHash": "…" }
```

| Réponse | Corps |
| --- | --- |
| `200` | `{ "token": "…", "wrappedVaultKey": {…}, "kdf": {…}, "salt": "…" }` |
| `401 invalid_credentials` | Email ou mot de passe incorrect |

### `DELETE /sessions` (authentifiée)

`204` : la session courante est révoquée.

## Coffre

### `GET /vault` (authentifiée)

```json
{ "revision": 12, "blob": { "v": 1, "iv": "…", "ct": "…" }, "updatedAt": 1789345000000 }
```

### `PUT /vault` (authentifiée)

```json
{ "baseRevision": 12, "blob": { "v": 1, "iv": "…", "ct": "…" } }
```

| Réponse | Corps |
| --- | --- |
| `200` | `{ "revision": 13, "updatedAt": … }` |
| `409 conflict` | `details` contient la version actuelle du serveur : `{ "revision", "blob", "updatedAt" }` |

## Codes d'erreur

| Statut | Code | Cause |
| --- | --- | --- |
| 400 | `invalid_request`, `invalid_json` | Champ ou JSON invalide |
| 401 | `unauthorized` | Jeton absent ou expiré |
| 401 | `invalid_credentials` | Connexion refusée |
| 403 | `invalid_credentials` | Preuve d'authentification incorrecte (suppression, changement de mot de passe) |
| 404 | `not_found` | Route inconnue |
| 409 | `email_taken`, `conflict` | Compte existant, révision obsolète |
| 413 | `payload_too_large` | Corps trop volumineux |
| 415 | `unsupported_media_type` | Corps non JSON |
| 429 | `rate_limited` | Trop de tentatives |
