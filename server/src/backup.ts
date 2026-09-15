import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { DatabaseSync } from 'node:sqlite';
import { S3Client, type S3Config, type S3Like } from './s3.ts';

/**
 * Sauvegardes automatiques vers un stockage S3.
 *
 * - Base SQLite copiée à chaud (VACUUM INTO), compressée, puis chiffrée si BACKUP_ENCRYPTION_KEY est défini.
 * - Pièces jointes envoyées une fois (elles sont déjà chiffrées par les applications).
 * - Conservation limitée (RGPD) : les sauvegardes plus anciennes que la durée de conservation sont supprimées,
 *   et les fichiers effacés par les utilisateurs disparaissent des sauvegardes au même rythme.
 */

export interface BackupSettings {
  enabled: boolean;
  intervalHours: number;
  retentionDays: number;
  s3: S3Config | null;
}

export interface BackupRun {
  id: number;
  trigger: string;
  startedAt: number;
  finishedAt: number | null;
  status: 'running' | 'success' | 'error';
  bytes: number | null;
  files: number | null;
  message: string | null;
}

export interface BackupService {
  runNow(trigger?: string): Promise<BackupRun>;
  test(): Promise<void>;
  history(): BackupRun[];
  isRunning(): boolean;
  start(): void;
  stop(): void;
}

const MAGIC = Buffer.from('BVBACKUP1');
const DAY_MS = 86_400_000;

export function encryptBackup(data: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), encrypted]);
}

export function decryptBackup(data: Buffer, passphrase: string): Buffer {
  if (!data.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Ce fichier n’est pas une sauvegarde BetterVault chiffrée');
  let offset = MAGIC.length;
  const salt = data.subarray(offset, offset += 16);
  const iv = data.subarray(offset, offset += 12);
  const tag = data.subarray(offset, offset += 16);
  const key = scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(data.subarray(offset)), decipher.final()]);
  } catch {
    throw new Error('Clé de chiffrement des sauvegardes incorrecte ou fichier altéré');
  }
}

/** Copie cohérente et compressée de la base (utilisée par les sauvegardes et le téléchargement depuis /admin) */
export function databaseSnapshot(db: DatabaseSync): Buffer {
  const temp = mkdtempSync(join(tmpdir(), 'bettervault-snapshot-'));
  try {
    const copy = join(temp, 'bettervault.db');
    db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
    return gzipSync(readFileSync(copy), { level: 9 });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

const normalizePrefix = (prefix: string) => (prefix ? `${prefix.replace(/^\/+|\/+$/g, '')}/` : '');

export function createBackupService(options: {
  db: DatabaseSync;
  filesDir: string | null;
  settings: () => BackupSettings;
  encryptionKey: string | null;
  clientFactory?: (config: S3Config) => S3Like;
  now?: () => number;
}): BackupService {
  const { db } = options;
  const now = options.now ?? Date.now;
  const clientFactory = options.clientFactory ?? (config => new S3Client(config));
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const toRun = (row: Record<string, unknown>): BackupRun => ({
    id: row.id as number,
    trigger: row.trigger as string,
    startedAt: row.started_at as number,
    finishedAt: (row.finished_at as number | null) ?? null,
    status: row.status as BackupRun['status'],
    bytes: (row.bytes as number | null) ?? null,
    files: (row.files as number | null) ?? null,
    message: (row.message as string | null) ?? null
  });

  const client = () => {
    const s3 = options.settings().s3;
    if (!s3) throw new Error('Configurez d’abord le stockage S3');
    return { s3, client: clientFactory(s3), prefix: normalizePrefix(s3.prefix) };
  };

  const runNow = async (trigger = 'manual'): Promise<BackupRun> => {
    if (running) throw new Error('Une sauvegarde est déjà en cours');
    const { client: s3, prefix } = client();
    running = true;
    const startedAt = now();
    const id = Number(db.prepare("INSERT INTO backup_runs (trigger, started_at, status) VALUES (?, ?, 'running')").run(trigger, startedAt).lastInsertRowid);
    const temp = mkdtempSync(join(tmpdir(), 'bettervault-backup-'));

    try {
      // Copie cohérente de la base, même pendant que le serveur écrit
      const copy = join(temp, 'bettervault.db');
      db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
      const compressed = gzipSync(readFileSync(copy), { level: 9 });
      const payload = options.encryptionKey ? encryptBackup(compressed, options.encryptionKey) : compressed;
      const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-');
      await s3.put(`${prefix}db/bettervault-${stamp}.db.gz${options.encryptionKey ? '.enc' : ''}`, payload);

      // Pièces jointes : seules les nouvelles sont envoyées
      let uploaded = 0;
      if (options.filesDir && existsSync(options.filesDir)) {
        const existing = new Set((await s3.list(`${prefix}files/`)).map(o => o.key));
        for (const name of readdirSync(options.filesDir)) {
          const key = `${prefix}files/${name}`;
          if (existing.has(key)) continue;
          await s3.put(key, readFileSync(join(options.filesDir, name)));
          uploaded++;
        }
      }

      // Conservation : sauvegardes de base trop anciennes (on garde toujours la plus récente)
      const { retentionDays } = options.settings();
      const cutoff = now() - retentionDays * DAY_MS;
      const dbObjects = (await s3.list(`${prefix}db/`)).sort((a, b) => b.lastModified - a.lastModified);
      for (const object of dbObjects.slice(1)) {
        if (object.lastModified && object.lastModified < cutoff) await s3.delete(object.key);
      }
      // Fichiers supprimés par les utilisateurs : purgés des sauvegardes après la même durée
      const expired = db.prepare('SELECT id FROM deleted_files WHERE deleted_at < ?').all(cutoff) as Array<{ id: string }>;
      for (const { id: fileId } of expired) {
        await s3.delete(`${prefix}files/${fileId}`);
        db.prepare('DELETE FROM deleted_files WHERE id = ?').run(fileId);
      }

      db.prepare("UPDATE backup_runs SET status = 'success', finished_at = ?, bytes = ?, files = ?, message = ? WHERE id = ?")
        .run(now(), payload.length, uploaded, options.encryptionKey ? null : 'Sauvegarde non chiffrée : définissez BACKUP_ENCRYPTION_KEY', id);
    } catch (err) {
      db.prepare("UPDATE backup_runs SET status = 'error', finished_at = ?, message = ? WHERE id = ?")
        .run(now(), err instanceof Error ? err.message : String(err), id);
      throw err;
    } finally {
      running = false;
      rmSync(temp, { recursive: true, force: true });
      db.prepare('DELETE FROM backup_runs WHERE id NOT IN (SELECT id FROM backup_runs ORDER BY id DESC LIMIT 50)').run();
    }
    return toRun(db.prepare('SELECT * FROM backup_runs WHERE id = ?').get(id) as Record<string, unknown>);
  };

  const tick = () => {
    const settings = options.settings();
    if (!settings.enabled || !settings.s3 || running) return;
    const last = db.prepare("SELECT started_at FROM backup_runs WHERE status = 'success' ORDER BY id DESC LIMIT 1").get() as { started_at: number } | undefined;
    if (last && now() - last.started_at < settings.intervalHours * 3_600_000) return;
    // Évite de réessayer en boucle après un échec : on attend au moins une heure
    const lastError = db.prepare("SELECT started_at FROM backup_runs WHERE status = 'error' ORDER BY id DESC LIMIT 1").get() as { started_at: number } | undefined;
    if (lastError && now() - lastError.started_at < 3_600_000 && (!last || lastError.started_at > last.started_at)) return;
    runNow('scheduled').catch(err => console.error('Sauvegarde automatique échouée :', err instanceof Error ? err.message : err));
  };

  return {
    runNow,
    async test() {
      const { client: s3, prefix } = client();
      const key = `${prefix}.bettervault-test`;
      await s3.put(key, Buffer.from('ok'), 'text/plain');
      await s3.list(prefix);
      await s3.delete(key);
    },
    history: () => (db.prepare('SELECT * FROM backup_runs ORDER BY id DESC LIMIT 20').all() as Array<Record<string, unknown>>).map(toRun),
    isRunning: () => running,
    start() {
      if (timer) return;
      timer = setInterval(tick, 10 * 60_000);
      timer.unref?.();
      setTimeout(tick, 30_000).unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}
