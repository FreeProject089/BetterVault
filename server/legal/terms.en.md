# Terms of use

Effective date: {{effectiveDate}}

## 1. Purpose

This BetterVault service is operated by **{{operatorName}}**, {{operatorAddress}} ("the Operator"). It lets you store, sync and share credentials, two-factor codes, tasks and files that are **encrypted on your device before anything is sent**.

## 2. Account

- Creating an account requires an email address and a master password chosen by the user.
- The master password is never sent to the Operator. **The Operator can neither recover it nor decrypt the data.** The recovery key given when the account is created is the only way to recover a vault if the password is forgotten.
- Users are responsible for keeping their master password, recovery key and devices confidential.

## 3. Acceptable use

Users agree not to:

- store or share unlawful content;
- attempt to access other users' accounts or data;
- disrupt the service (attacks, deliberate overload, circumventing limits).

The Operator may suspend an account in case of serious breach, after notice where possible.

## 4. Shared vaults

The owner of a shared vault chooses its members and their roles. Every member can read the vault's content; only share a vault with people you trust. The Operator does not take part in relations between members.

## 5. Availability and backups

The service is provided without any guarantee of continuous availability. {{#si backups}}Encrypted backups are made regularly and kept for {{retentionDays}} days.{{/si}} Users are encouraged to keep an encrypted export of their data.

{{#si billing}}
## 6. Paid plans

Optional plans increase the account's storage and limits. Payment is handled by Stripe. A subscription can be cancelled at any time from the billing portal; the extra storage remains available until the end of the paid period. If the storage used then exceeds the base limits, adding new items is blocked, without deleting existing data.
{{/si}}

## 7. Personal data

Data processing is described in the [privacy policy](/legal/privacy?lang=en). For client organisations, the [data processing agreement](/legal/dpa?lang=en) applies.

## 8. Termination

Users can delete their account at any time from the app: the vault, shared vaults they own, attachments and sessions are erased from the server immediately{{#si backups}}, then from backups no later than {{retentionDays}} days after{{/si}}.

## 9. Liability

As the service is end-to-end encrypted, the Operator cannot restore data whose key is lost. The Operator cannot be held liable for a loss resulting from a forgotten master password and recovery key.

## 10. Governing law

These terms are governed by the law of: {{jurisdiction}}. Contact: {{contactEmail}}.
