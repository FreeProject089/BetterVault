# Security measures

Technical and organisational measures (annex to the DPA). Practices are aligned with ISO/IEC 27001:2022 controls (Annex A); **this server is not certified** unless the Operator states otherwise.

## Zero knowledge

| Measure | Detail |
| --- | --- |
| Client-side encryption | AES-256-GCM for vaults, shared vaults and attachments |
| Key derivation | Argon2id (64 MiB, 3 iterations), HKDF separation between the encryption key and the authentication proof |
| Master password | Never sent; the server only stores a derived proof protected with scrypt |
| Sharing | X25519 keys per account; a shared vault's key is sealed for each member; key rotation when a member is removed |
| Recovery | 256-bit recovery key held by the user alone |

## Zero trust

| ISO 27001 control | Measure |
| --- | --- |
| 5.15 Access control | Every request is authenticated with a session token; shared vault permissions are checked by the server on every action |
| 5.17 Authentication information | Random 256-bit session tokens stored only as SHA-256 hashes; TOTP two-factor authentication without code reuse |
| 8.5 Secure authentication | Rate limiting per address; identical response whether the account exists or not |
| 5.18 Access rights | Sessions can be reviewed and revoked by the user (password and 2FA code required) |
| 8.2 Privileged access rights | Administration page protected by a dedicated token stored as a hash; no access to vault content |
| 8.24 Use of cryptography | Standard algorithms (AES-GCM, Argon2id, scrypt, HKDF, X25519, HMAC-SHA256); no home-made cryptography |
| 8.12 Data leakage prevention | Full IP address never stored; administration statistics aggregated only |
| 8.13 Information backup | {{#si backups}}Automatic encrypted backups to S3 storage, kept {{retentionDays}} days, documented restore procedure{{/si}} |
| 8.15 Logging | Security event log with pseudonymised identifiers, kept 90 days |
| 8.16 Monitoring | Dashboard for performance and storage |
| 8.23 / 8.26 Application security | Security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy), no executable third-party resources |
| 8.20 Network security | TLS required for the apps (HTTP only accepted locally) |
| 5.34 Privacy | Data minimisation, rights exercised from the app |
| 5.24 Incident management | Breach notification to the Client within 72 hours |

## Organisation

- Administrator access limited to people designated by the Operator, bound by confidentiality.
- System and server security updates applied regularly.
- Hosting: {{hostingProvider}} ({{hostingLocation}}).
