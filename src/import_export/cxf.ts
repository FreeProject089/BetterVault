import { CredentialField, CredentialItem, PasskeyData } from '../types/vault';
import { buildOtpAuthUri, parseOtpAuthUri } from '../crypto/otpauthUri';

/**
 * FIDO Alliance Credential Exchange Format (CXF) — import/export des identifiants,
 * passkeys, secrets TOTP, notes et champs personnalisés entre gestionnaires.
 */

export const CXF_VERSION = { major: 1, minor: 0 };

type CxfDocument = {
  version?: unknown;
  exporterRpId?: string;
  accounts?: Array<{ items?: CxfItem[] }>;
};

type CxfItem = {
  id?: string;
  title?: string;
  favorite?: boolean;
  creationAt?: number;
  modifiedAt?: number;
  tags?: unknown;
  scope?: { urls?: string[] };
  credentials?: Array<Record<string, any>>;
};

function fieldValue(field: unknown): string {
  if (field && typeof field === 'object' && 'value' in field) {
    const value = (field as { value?: unknown }).value;
    return value === undefined || value === null ? '' : String(value);
  }
  return typeof field === 'string' ? field : '';
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const toSeconds = (ms: number) => Math.floor(ms / 1000);

export function isCxfDocument(value: unknown): boolean {
  const doc = value as CxfDocument | null;
  return !!doc && typeof doc === 'object'
    && Array.isArray(doc.accounts)
    && doc.accounts.some(a => Array.isArray(a?.items))
    && ('exporterRpId' in doc || 'version' in doc);
}

function totpCredential(cred: CredentialItem): Record<string, unknown> | null {
  if (!cred.totpSecret) return null;
  const info = parseOtpAuthUri(cred.totpSecret);
  if (info) {
    return {
      type: 'totp',
      secret: info.secret,
      period: info.period,
      digits: info.digits,
      algorithm: info.algorithm.toLowerCase(),
      issuer: info.issuer,
      username: info.account ?? cred.username
    };
  }
  return { type: 'totp', secret: cred.totpSecret, period: 30, digits: 6, algorithm: 'sha1', username: cred.username };
}

export function exportCredentialsAsCxf(credentials: CredentialItem[], exporterRpId = 'bettervault.app'): string {
  const document = {
    version: CXF_VERSION,
    exporterRpId,
    exporterDisplayName: 'BetterVault',
    timestamp: toSeconds(Date.now()),
    accounts: [{
      id: randomId(),
      username: '',
      email: '',
      collections: [],
      extensions: [],
      items: credentials.map(cred => {
        const totp = totpCredential(cred);
        return {
          id: randomId(),
          creationAt: toSeconds(cred.createdAt),
          modifiedAt: toSeconds(cred.updatedAt),
          title: cred.title,
          favorite: !!cred.isFavorite,
          tags: cred.tags ?? [],
          ...(cred.website ? { scope: { urls: [cred.website], androidApps: [] } } : {}),
          credentials: [
            ...(cred.username || cred.password ? [{
              type: 'basic-auth',
              username: { fieldType: 'string', value: cred.username },
              password: { fieldType: 'concealed-string', value: cred.password }
            }] : []),
            ...(cred.passkeys ?? []).map(pk => ({
              type: 'passkey',
              credentialId: pk.credentialId,
              rpId: pk.rpId,
              username: pk.userName,
              userDisplayName: pk.userDisplayName ?? pk.userName,
              userHandle: pk.userHandle ?? '',
              key: pk.privateKey ?? '',
              fido2Extensions: {}
            })),
            ...(totp ? [totp] : []),
            ...(cred.notes ? [{ type: 'note', content: { fieldType: 'string', value: cred.notes } }] : []),
            ...(cred.fields?.length ? [{
              type: 'custom-fields',
              fields: cred.fields.map(f => ({
                id: f.id,
                label: f.label,
                fieldType: f.isMasked ? 'concealed-string' : 'string',
                value: f.value
              }))
            }] : [])
          ]
        };
      })
    }]
  };
  return JSON.stringify(document, null, 2);
}

export function parseCxf(value: unknown): Partial<CredentialItem>[] {
  const doc = value as CxfDocument;
  const result: Partial<CredentialItem>[] = [];

  for (const account of doc.accounts ?? []) {
    for (const item of account.items ?? []) {
      const createdAt = typeof item.creationAt === 'number' ? item.creationAt * 1000 : Date.now();
      const passkeys: PasskeyData[] = [];
      const fields: CredentialField[] = [];
      const cred: Partial<CredentialItem> = {
        title: item.title || 'Élément CXF',
        website: item.scope?.urls?.[0] ?? '',
        username: '',
        password: '',
        tags: Array.isArray(item.tags) ? item.tags.filter((t): t is string => typeof t === 'string') : [],
        isFavorite: !!item.favorite,
        createdAt,
        updatedAt: typeof item.modifiedAt === 'number' ? item.modifiedAt * 1000 : createdAt
      };

      for (const entry of item.credentials ?? []) {
        switch (entry.type) {
          case 'basic-auth':
            cred.username = fieldValue(entry.username);
            cred.password = fieldValue(entry.password);
            break;
          case 'passkey':
            if (!entry.credentialId || !entry.rpId) break;
            passkeys.push({
              credentialId: String(entry.credentialId),
              publicKey: '',
              privateKey: entry.key ? String(entry.key) : undefined,
              signCount: 0,
              rpId: String(entry.rpId),
              userName: String(entry.username ?? ''),
              userDisplayName: entry.userDisplayName ? String(entry.userDisplayName) : undefined,
              userHandle: entry.userHandle ? String(entry.userHandle) : undefined,
              createdAt
            });
            if (!cred.website) cred.website = `https://${entry.rpId}`;
            break;
          case 'totp': {
            const secret = String(entry.secret ?? '').toUpperCase();
            if (!secret) break;
            const algorithm = String(entry.algorithm ?? 'sha1').toUpperCase();
            const digits = Number(entry.digits ?? 6);
            const period = Number(entry.period ?? 30);
            cred.totpSecret = algorithm === 'SHA1' && digits === 6 && period === 30
              ? secret
              : buildOtpAuthUri({ secret, algorithm, digits, period, issuer: entry.issuer, account: entry.username });
            break;
          }
          case 'note':
            cred.notes = fieldValue(entry.content);
            break;
          case 'custom-fields':
            for (const f of Array.isArray(entry.fields) ? entry.fields : []) {
              const fieldVal = fieldValue(f);
              if (!fieldVal) continue;
              fields.push({
                id: 'cf-' + Math.random().toString(36).substring(2, 8),
                label: String(f.label ?? 'Champ'),
                value: fieldVal,
                isMasked: f.fieldType === 'concealed-string'
              });
            }
            break;
        }
      }

      if (passkeys.length) cred.passkeys = passkeys;
      if (fields.length) cred.fields = fields;
      result.push(cred);
    }
  }
  return result;
}
