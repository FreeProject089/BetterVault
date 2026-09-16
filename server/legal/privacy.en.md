# Privacy policy

Effective date: {{effectiveDate}}

## Controller

**{{operatorName}}**, {{operatorAddress}}. Contact: {{contactEmail}}.{{#si dpo}} Data protection officer: {{dpoContact}}.{{/si}}

When an organisation uses this service for its members, it is the controller and the Operator acts as a processor under the [data processing agreement](/legal/dpa?lang=en).

## Principle: end-to-end encryption

Credentials, 2FA codes, notes, tasks, shared vaults and attachments are encrypted **on the device** (AES-256-GCM, keys derived from the master password with Argon2id). The server never receives the master password, the keys or the plain data: **the Operator cannot read them**.

## Data processed by the server

| Data | Purpose | Legal basis | Retention |
| --- | --- | --- | --- |
| Email address | Account identification, security emails | Performance of contract | Lifetime of the account |
| Authentication proofs (derived, protected with scrypt) | Sign-in | Performance of contract | Lifetime of the account |
| Encrypted vaults and attachments | Sync and sharing | Performance of contract | Lifetime of the account |
| Profile picture (if added) | Shown to the account holder only | Consent | Until removed |
| Public sharing key | Vault sharing | Performance of contract | Lifetime of the account |
| Sessions: device, truncated IP address{{#si geo}}, approximate country and city{{/si}}, dates | Account security, session management | Legitimate interest (security) | {{sessionDays}} days maximum |
| Two-factor secret | Code verification | Performance of contract | Until turned off |
| Security log (event type, pseudonymised identifier) | Abuse detection, evidence of security measures | Legitimate interest | 90 days |
{{#si billing}}| Subscription: plan, status, Stripe customer identifiers | Billing | Performance of contract, accounting obligations | Length of the subscription, then legal obligations |{{/si}}

The full IP address is **never stored**: it is only used, in memory, to limit sign-in attempts{{#si geo}} and to look up an approximate location in a database installed on the server (no IP address is sent to a third party){{/si}}.

No advertising cookies or audience measurement tools are used. Administration statistics are anonymous totals only (number of accounts, storage used, performance).

{{#si emails}}
## Emails

The server only sends security-related emails: reset codes, new sign-in alerts, password changes, two-factor changes, shared vault invitations.
{{/si}}

## Recipients

- The infrastructure host: {{hostingProvider}} ({{hostingLocation}}), which only receives encrypted data;
{{#si billing}}- Stripe Payments Europe, for plan payments (Stripe never receives vault content);{{/si}}
- the full list is on the [Subprocessors](/legal/subprocessors?lang=en) page.

## Backups

{{#si backups}}Encrypted copies of the database are kept for {{retentionDays}} days. Deleted data disappears from backups no later than the end of that period.{{/si}}

## Your rights

You have the rights of access, rectification, erasure, restriction, objection and portability.

- **Access and portability**: export your data from the app (Import / export).
- **Erasure**: delete your account from the app, or write to {{contactEmail}}.
- **Sessions**: review and close active sessions from the Account window.

You may lodge a complaint with the supervisory authority: {{supervisoryAuthority}}.

## Security

Technical and organisational measures are described on the [Security measures](/legal/security?lang=en) page.
