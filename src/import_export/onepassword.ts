import { strFromU8, unzipSync } from 'fflate';
import { CredentialField, CredentialItem } from '../types/vault';

/**
 * Import 1Password 1PUX (archive ZIP contenant export.data au format JSON).
 */

export function isZipArchive(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function parse1pux(bytes: Uint8Array): Partial<CredentialItem>[] {
  const files = unzipSync(bytes, { filter: file => file.name === 'export.data' });
  const data = files['export.data'];
  if (!data) throw new Error('Archive .1pux invalide : export.data introuvable');
  return parse1PasswordExportData(JSON.parse(strFromU8(data)));
}

export function is1PasswordExportData(value: unknown): boolean {
  const accounts = (value as { accounts?: unknown })?.accounts;
  return Array.isArray(accounts) && accounts.some(a => Array.isArray((a as { vaults?: unknown })?.vaults));
}

function sectionFieldValue(value: Record<string, unknown>): { kind: string; text: string } | null {
  const entry = Object.entries(value)[0];
  if (!entry) return null;
  const [kind, raw] = entry;
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return { kind, text: String(raw) };
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const text = obj.email_address ?? obj.value ?? obj.url;
    if (typeof text === 'string' && text) return { kind, text };
  }
  return null;
}

export function parse1PasswordExportData(data: any): Partial<CredentialItem>[] {
  const result: Partial<CredentialItem>[] = [];

  for (const account of data?.accounts ?? []) {
    for (const vault of account?.vaults ?? []) {
      const vaultName: string | undefined = vault?.attrs?.name;
      for (const item of vault?.items ?? []) {
        if (item?.state === 'archived' || item?.trashed) continue;

        const details = item.details ?? {};
        const overview = item.overview ?? {};
        const loginFields: any[] = details.loginFields ?? [];
        const username = loginFields.find(f => f.designation === 'username')?.value ?? '';
        const password = loginFields.find(f => f.designation === 'password')?.value ?? details.password ?? '';

        let totpSecret: string | undefined;
        const fields: CredentialField[] = [];
        for (const section of details.sections ?? []) {
          for (const field of section.fields ?? []) {
            const value = field.value ?? {};
            if (typeof value.totp === 'string' && value.totp) {
              totpSecret ??= value.totp;
              continue;
            }
            const parsed = sectionFieldValue(value);
            if (!parsed) continue;
            fields.push({
              id: 'cf-' + Math.random().toString(36).substring(2, 8),
              label: field.title || section.title || parsed.kind,
              value: parsed.text,
              isMasked: parsed.kind === 'concealed'
            });
          }
        }

        const createdAt = typeof item.createdAt === 'number' ? item.createdAt * 1000 : Date.now();
        result.push({
          title: overview.title || 'Élément 1Password',
          username,
          password,
          website: overview.url || overview.urls?.[0]?.url || '',
          totpSecret,
          notes: details.notesPlain ?? '',
          fields: fields.length ? fields : undefined,
          tags: [...(Array.isArray(overview.tags) ? overview.tags : []), ...(vaultName ? [vaultName] : [])],
          isFavorite: !!item.favIndex,
          createdAt,
          updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt * 1000 : createdAt
        });
      }
    }
  }
  return result;
}
