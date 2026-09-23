import { ImportResult, parseImportFile } from './importEngine';
import { getKdbxVersion, isKdbx, parseKdbx, parseKeePassXml } from './keepass';
import { is1PasswordExportData, isZipArchive, parse1PasswordExportData, parse1pux } from './onepassword';
import { isCxfDocument, parseCxf } from './cxf';
import { decryptExport, isEncryptedExport } from './encryptedExport';
import { decryptBitwardenJson, isBitwardenPasswordProtected } from './bitwardenEncrypted';

/**
 * Point d'entrée unique de l'import : détecte le format à partir des octets
 * (KDBX, 1PUX, export chiffré BUM, CXF, KeePass XML, JSON/CSV).
 */

export type ProtectedImportKind = 'kdbx' | 'encrypted-export' | 'bitwarden-encrypted';

export class PasswordRequiredError extends Error {
  readonly kind: ProtectedImportKind;

  constructor(kind: ProtectedImportKind) {
    super(kind === 'kdbx'
      ? 'Base KeePass chiffrée : mot de passe requis'
      : kind === 'bitwarden-encrypted'
        ? 'Export Bitwarden protégé : mot de passe requis'
        : 'Export chiffré : mot de passe requis');
    this.name = 'PasswordRequiredError';
    this.kind = kind;
  }
}

export interface ImportSecrets {
  password?: string;
  keyFile?: Uint8Array;
}

const credentialsResult = (credentials: ImportResult['credentials'], sourceFormat: string): ImportResult => ({
  credentials,
  tasks: [],
  sourceFormat,
  count: credentials.length
});

export async function parseImportData(bytes: Uint8Array, fileName = '', secrets: ImportSecrets = {}): Promise<ImportResult> {
  if (isKdbx(bytes)) {
    if (!secrets.password && !secrets.keyFile) throw new PasswordRequiredError('kdbx');
    const credentials = await parseKdbx(bytes, secrets.password ?? '', secrets.keyFile);
    return credentialsResult(credentials, `KeePass KDBX ${getKdbxVersion(bytes)}`);
  }

  if (isZipArchive(bytes)) {
    return credentialsResult(parse1pux(bytes), '1Password 1PUX');
  }

  const text = new TextDecoder().decode(bytes).replace(/^﻿/, '');
  const trimmed = text.trim();

  if (trimmed.startsWith('{')) {
    let json: unknown = null;
    try {
      json = JSON.parse(trimmed);
    } catch {
      json = null;
    }

    if (isEncryptedExport(json)) {
      if (!secrets.password) throw new PasswordRequiredError('encrypted-export');
      const inner = await decryptExport(json, secrets.password);
      const result = await parseImportData(new TextEncoder().encode(inner), fileName);
      return { ...result, sourceFormat: `${result.sourceFormat} — chiffré Argon2id` };
    }
    // Export Bitwarden « protégé par mot de passe » : on le déchiffre puis on repasse par le lecteur JSON Bitwarden
    if (isBitwardenPasswordProtected(json)) {
      if (!secrets.password) throw new PasswordRequiredError('bitwarden-encrypted');
      const clear = await decryptBitwardenJson(json, secrets.password);
      const result = parseImportFile(clear, fileName || 'bitwarden.json');
      return { ...result, sourceFormat: `${result.sourceFormat} — protégé par mot de passe` };
    }
    if (isCxfDocument(json)) return credentialsResult(parseCxf(json), 'FIDO CXF (Credential Exchange)');
    if (is1PasswordExportData(json)) return credentialsResult(parse1PasswordExportData(json), '1Password export.data');
  }

  if (trimmed.startsWith('<') && trimmed.includes('<KeePassFile')) {
    return credentialsResult(parseKeePassXml(trimmed), 'KeePass XML');
  }

  return parseImportFile(text, fileName);
}
