import type { IncomingMessage } from 'node:http';
import { createHash, scrypt } from 'node:crypto';

/** Outils HTTP communs aux routes de l'API */

export interface KdfParams {
  t: number;
  m: number;
  p: number;
}

export interface EncryptedBlob {
  v: 1;
  iv: string;
  ct: string;
}

export interface Reply {
  status: number;
  body?: unknown;
  /** Réponse binaire (pièce jointe) */
  raw?: Buffer;
  contentType?: string;
  /** En-têtes supplémentaires (taille totale d'un fichier servi par tranches) */
  headers?: Record<string, string>;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('base64');

export function scryptVerifier(authHash: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(authHash, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export function invalid(field: string): HttpError {
  return new HttpError(400, 'invalid_request', `Champ « ${field} » invalide`);
}

export function parseBase64(value: unknown, field: string, length: { exact?: number; max?: number }): string {
  if (typeof value !== 'string' || value.length % 4 !== 0 || !BASE64.test(value)) throw invalid(field);
  const size = Buffer.from(value, 'base64').length;
  if ((length.exact !== undefined && size !== length.exact) || (length.max !== undefined && size > length.max)) throw invalid(field);
  return value;
}

export function parseEmail(value: unknown): string {
  if (typeof value !== 'string') throw invalid('email');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid('email');
  return email;
}

export function parseKdf(value: unknown, minMemoryKib: number): KdfParams {
  const kdf = value as Partial<KdfParams> | null;
  const valid = !!kdf && typeof kdf === 'object'
    && Number.isInteger(kdf.t) && kdf.t! >= 1 && kdf.t! <= 10
    && Number.isInteger(kdf.p) && kdf.p! >= 1 && kdf.p! <= 8
    && Number.isInteger(kdf.m) && kdf.m! >= Math.max(minMemoryKib, 8 * kdf.p!) && kdf.m! <= 1048576;
  if (!valid) throw invalid('kdf');
  return { t: kdf.t!, m: kdf.m!, p: kdf.p! };
}

export function parseBlob(value: unknown, field: string, maxBytes: number): EncryptedBlob {
  const blob = value as Partial<EncryptedBlob> | null;
  if (!blob || typeof blob !== 'object' || blob.v !== 1) throw invalid(field);
  return { v: 1, iv: parseBase64(blob.iv, `${field}.iv`, { exact: 12 }), ct: parseBase64(blob.ct, `${field}.ct`, { max: maxBytes }) };
}

export function parseCode(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{6}$/.test(value.replace(/\s/g, ''))) throw invalid(field);
  return value.replace(/\s/g, '');
}

export function parseId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(value)) throw invalid(field);
  return value;
}

export interface RecoveryMaterial {
  authHash: string;
  wrappedVaultKey: EncryptedBlob;
}

export function parseRecovery(value: unknown): RecoveryMaterial | null {
  if (value === undefined || value === null) return null;
  const recovery = value as Partial<RecoveryMaterial>;
  if (typeof recovery !== 'object') throw invalid('recovery');
  return {
    authHash: parseBase64(recovery.authHash, 'recovery.authHash', { exact: 32 }),
    wrappedVaultKey: parseBlob(recovery.wrappedVaultKey, 'recovery.wrappedVaultKey', 64)
  };
}

export async function readJson(req: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Corps JSON attendu');
  }
  const body = await readRaw(req, maxBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'JSON invalide');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, 'invalid_json', 'Objet JSON attendu');
  return parsed as Record<string, unknown>;
}

export async function readRaw(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, 'payload_too_large', 'Requête trop volumineuse');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new HttpError(413, 'payload_too_large', 'Requête trop volumineuse');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}
