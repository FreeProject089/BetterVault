import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { S3Client, type S3Config, type S3Like } from './s3.ts';

/**
 * Sauvegardes vers plusieurs destinations S3, indépendantes des nœuds de la grappe.
 *
 * Pourquoi en plus de la réplication : la réplication recopie tout, y compris une
 * suppression ou une corruption. Une sauvegarde garde des états passés, et permet
 * d'y revenir.
 *
 * - Chiffrement obligatoire : la base est compressée puis chiffrée (AES-256-GCM, clé
 *   dérivée de BACKUP_ENCRYPTION_KEY) avant de quitter le serveur. Les pièces jointes
 *   le sont déjà par les applications. Une destination ne voit que des octets illisibles.
 * - Plusieurs destinations (Backup-EU, Backup-US, Backup-CH…), chacune avec son état.
 *   La copie de la base est faite une fois, puis envoyée à chacune indépendamment :
 *   une destination en panne n'empêche pas les autres, et reprend à la tentative suivante.
 * - Ordre d'envoi : les fichiers d'abord, la base ensuite. Une copie de base présente
 *   sur une destination garantit que ses fichiers y sont aussi ; un envoi interrompu
 *   laisse un état cohérent, complété la fois suivante.
 * - Conservation limitée (RGPD) : anciennes copies de base et fichiers effacés par les
 *   utilisateurs disparaissent des sauvegardes après la durée de conservation.
 */

export type DestinationStatus = 'active' | 'disabled' | 'revoked';

export interface BackupDestination {
  id: string;
  name: string;
  region: string;
  s3: S3Config;
  status: DestinationStatus;
  /** Capacité annoncée par l'hébergeur, pour prévenir avant d'être plein */
  quotaBytes?: number;
  addedAt: number;
  replacedBy?: string;
}

export interface BackupSettings {
  enabled: boolean;
  intervalHours: number;
  retentionDays: number;
  /** Ancienne destination unique : reprise automatiquement comme « Principal » */
  s3: S3Config | null;
  destinations?: BackupDestination[];
}

export interface BackupRun {
  id: number;
  trigger: string;
  destinationId: string | null;
  startedAt: number;
  finishedAt: number | null;
  status: 'running' | 'success' | 'error';
  bytes: number | null;
  files: number | null;
  message: string | null;
}

export interface DestinationState {
  id: string;
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  usedBytes: number | null;
  snapshots: number | null;
}

export interface RestorePoint {
  key: string;
  takenAt: number;
  bytes: number;
}

export interface RestorePreview {
  token: string;
  destinationId: string;
  key: string;
  takenAt: number;
  accounts: number;
  sharedVaults: number;
  attachments: number;
  /** Comptes dont le coffre actuel est plus récent que celui de la sauvegarde */
  newerNow: number;
  /** Comptes créés depuis la sauvegarde : ils ne sont pas touchés par une restauration */
  createdSince: number;
}

export interface BackupService {
  runNow(trigger?: string, destinationId?: string): Promise<BackupRun[]>;
  test(destinationId?: string): Promise<void>;
  testConfig(config: S3Config): Promise<void>;
  history(): BackupRun[];
  isRunning(): boolean;
  destinations(): Array<BackupDestination & { state: DestinationState }>;
  restorePoints(destinationId: string): Promise<RestorePoint[]>;
  preview(destinationId: string, key: string): Promise<RestorePreview>;
  restoreAccount(token: string, email: string): Promise<{ restored: boolean; files: number }>;
  restoreServer(token: string): Promise<{ accounts: number; skipped: number; files: number; safetyKey: string }>;
  start(): void;
  stop(): void;
}

const MAGIC = Buffer.from('BVBACKUP1');
const DAY_MS = 86_400_000;
const RETRY_AFTER_MS = 3_600_000;
const PREVIEW_TTL_MS = 15 * 60_000;
/** Tables restaurées ; les réglages, administrateurs et la grappe ne font pas partie d'une restauration */
const RESTORED_TABLES = ['users', 'vaults', 'shared_vaults', 'shared_roles', 'shared_members', 'attachments', 'subscriptions'];

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

/** Destinations effectives : l'ancienne destination unique devient « Principal » */
export function effectiveDestinations(settings: BackupSettings): BackupDestination[] {
  if (settings.destinations?.length) return settings.destinations;
  return settings.s3 ? [{ id: 'dst-principal', name: 'Principal', region: settings.s3.region, s3: settings.s3, status: 'active', addedAt: 0 }] : [];
}

const columnsOf = (db: DatabaseSync, schema: string, table: string) =>
  (db.prepare(`PRAGMA ${schema}.table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name);

export function createBackupService(options: {
  db: DatabaseSync;
  filesDir: string | null;
  settings: () => BackupSettings;
  encryptionKey: string | null;
  clientFactory?: (config: S3Config) => S3Like;
  now?: () => number;
  /** Nœud de grappe : une restauration doit l'emporter sur les autres nœuds */
  nodeId?: () => string | null;
}): BackupService {
  const { db } = options;
  const now = options.now ?? Date.now;
  const clientFactory = options.clientFactory ?? (config => new S3Client(config));
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const previews = new Map<string, { path: string; dir: string; destinationId: string; key: string; expiresAt: number }>();

  db.exec(`
    CREATE TABLE IF NOT EXISTS backup_destination_state (
      id TEXT PRIMARY KEY,
      last_success_at INTEGER,
      last_attempt_at INTEGER,
      last_error TEXT,
      last_error_at INTEGER,
      used_bytes INTEGER,
      snapshots INTEGER
    );
    -- Coffre remplacé par une restauration de compte : de quoi revenir en arrière
    CREATE TABLE IF NOT EXISTS restore_safety (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      blob TEXT NOT NULL,
      saved_at INTEGER NOT NULL
    );
  `);
  if (!columnsOf(db, 'main', 'backup_runs').includes('destination_id')) db.exec('ALTER TABLE backup_runs ADD COLUMN destination_id TEXT');

  const toRun = (row: Record<string, unknown>): BackupRun => ({
    id: row.id as number,
    trigger: row.trigger as string,
    destinationId: (row.destination_id as string | null) ?? null,
    startedAt: row.started_at as number,
    finishedAt: (row.finished_at as number | null) ?? null,
    status: row.status as BackupRun['status'],
    bytes: (row.bytes as number | null) ?? null,
    files: (row.files as number | null) ?? null,
    message: (row.message as string | null) ?? null
  });

  const stateOf = (id: string): DestinationState => {
    const row = db.prepare('SELECT * FROM backup_destination_state WHERE id = ?').get(id) as Record<string, number | string | null> | undefined;
    return {
      id,
      lastSuccessAt: (row?.last_success_at as number) ?? null,
      lastAttemptAt: (row?.last_attempt_at as number) ?? null,
      lastError: (row?.last_error as string) ?? null,
      lastErrorAt: (row?.last_error_at as number) ?? null,
      usedBytes: (row?.used_bytes as number) ?? null,
      snapshots: (row?.snapshots as number) ?? null
    };
  };
  const saveState = (id: string, patch: Partial<Record<'last_success_at' | 'last_attempt_at' | 'last_error' | 'last_error_at' | 'used_bytes' | 'snapshots', unknown>>) => {
    db.prepare('INSERT OR IGNORE INTO backup_destination_state (id) VALUES (?)').run(id);
    for (const [column, value] of Object.entries(patch)) {
      db.prepare(`UPDATE backup_destination_state SET ${column} = ? WHERE id = ?`).run(value as never, id);
    }
  };

  const destination = (id: string) => {
    const found = effectiveDestinations(options.settings()).find(d => d.id === id);
    if (!found) throw new Error('Destination de sauvegarde inconnue');
    return found;
  };
  const requireKey = () => {
    if (!options.encryptionKey) throw new Error('Définissez BACKUP_ENCRYPTION_KEY : une sauvegarde est chiffrée avant de quitter le serveur');
    return options.encryptionKey;
  };

  /** Envoie une copie déjà chiffrée vers une destination ; renvoie le nombre de fichiers envoyés */
  async function uploadTo(dest: BackupDestination, payload: Buffer, stamp: string, suffix = ''): Promise<number> {
    const s3 = clientFactory(dest.s3);
    const prefix = normalizePrefix(dest.s3.prefix);

    // 1. Fichiers : seuls ceux qui manquent. Avant la base, pour que toute copie de base soit complète.
    let uploaded = 0;
    if (options.filesDir && existsSync(options.filesDir)) {
      const existing = new Set((await s3.list(`${prefix}files/`)).map(o => o.key));
      for (const name of readdirSync(options.filesDir)) {
        if (name.endsWith('.part')) continue;
        const key = `${prefix}files/${name}`;
        if (existing.has(key)) continue;
        await s3.put(key, readFileSync(join(options.filesDir, name)));
        uploaded++;
      }
    }

    // 2. La base, en dernier
    await s3.put(`${prefix}db/bettervault-${stamp}${suffix}.db.gz.enc`, payload);

    // 3. Conservation : copies de base trop anciennes (la plus récente reste toujours)
    const { retentionDays } = options.settings();
    const cutoff = now() - retentionDays * DAY_MS;
    const dbObjects = (await s3.list(`${prefix}db/`)).sort((a, b) => b.lastModified - a.lastModified);
    for (const object of dbObjects.slice(1)) {
      if (object.lastModified && object.lastModified < cutoff) await s3.delete(object.key);
    }
    // Fichiers effacés par les utilisateurs : retirés de chaque destination après la même durée
    const expired = db.prepare('SELECT id FROM deleted_files WHERE deleted_at < ?').all(cutoff) as Array<{ id: string }>;
    for (const { id } of expired) await s3.delete(`${prefix}files/${id}`);

    const listing = await s3.list(prefix);
    saveState(dest.id, {
      used_bytes: listing.reduce((sum, o) => sum + o.size, 0),
      snapshots: listing.filter(o => o.key.startsWith(`${prefix}db/`)).length
    });
    return uploaded;
  }

  const runNow = async (trigger = 'manual', destinationId?: string): Promise<BackupRun[]> => {
    if (running) throw new Error('Une sauvegarde est déjà en cours');
    const key = requireKey();
    const targets = effectiveDestinations(options.settings())
      .filter(d => d.status === 'active' && (!destinationId || d.id === destinationId));
    if (!targets.length) throw new Error('Aucune destination de sauvegarde active');

    running = true;
    const startedAt = now();
    const ids: number[] = [];
    try {
      // Une seule copie de la base, envoyée à chaque destination
      const payload = encryptBackup(databaseSnapshot(db), key);
      const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-');
      for (const dest of targets) {
        const id = Number(db.prepare("INSERT INTO backup_runs (trigger, started_at, status, destination_id) VALUES (?, ?, 'running', ?)")
          .run(trigger, now(), dest.id).lastInsertRowid);
        ids.push(id);
        saveState(dest.id, { last_attempt_at: now() });
        try {
          const files = await uploadTo(dest, payload, stamp);
          db.prepare("UPDATE backup_runs SET status = 'success', finished_at = ?, bytes = ?, files = ?, message = NULL WHERE id = ?")
            .run(now(), payload.length, files, id);
          saveState(dest.id, { last_success_at: now(), last_error: null, last_error_at: null });
        } catch (err) {
          // Une destination en panne n'arrête pas les autres ; elle réessaiera plus tard
          const message = err instanceof Error ? err.message : String(err);
          db.prepare("UPDATE backup_runs SET status = 'error', finished_at = ?, message = ? WHERE id = ?").run(now(), message, id);
          saveState(dest.id, { last_error: message, last_error_at: now() });
        }
      }
      // Un fichier effacé est oublié une fois que toutes les destinations ont eu le temps de le purger
      const graceCutoff = now() - (options.settings().retentionDays + 30) * DAY_MS;
      db.prepare('DELETE FROM deleted_files WHERE deleted_at < ?').run(graceCutoff);
    } finally {
      running = false;
      db.prepare('DELETE FROM backup_runs WHERE id NOT IN (SELECT id FROM backup_runs ORDER BY id DESC LIMIT 200)').run();
    }
    return ids.map(id => toRun(db.prepare('SELECT * FROM backup_runs WHERE id = ?').get(id) as Record<string, unknown>));
  };

  /** Destinations dont la dernière réussite est trop ancienne, hors de la pause après un échec */
  const dueDestinations = () => {
    const settings = options.settings();
    return effectiveDestinations(settings).filter(dest => {
      if (dest.status !== 'active') return false;
      const state = stateOf(dest.id);
      if (state.lastSuccessAt && now() - state.lastSuccessAt < settings.intervalHours * 3_600_000) return false;
      if (state.lastErrorAt && now() - state.lastErrorAt < RETRY_AFTER_MS && (!state.lastSuccessAt || state.lastErrorAt > state.lastSuccessAt)) return false;
      return true;
    });
  };

  const tick = () => {
    const settings = options.settings();
    if (!settings.enabled || running || !options.encryptionKey) return;
    const due = dueDestinations();
    if (!due.length) return;
    void (async () => {
      for (const dest of due) {
        await runNow('scheduled', dest.id).catch(err => console.error(`Sauvegarde vers ${dest.name} échouée :`, err instanceof Error ? err.message : err));
      }
    })();
  };

  const testConfig = async (config: S3Config) => {
    const s3 = clientFactory(config);
    const prefix = normalizePrefix(config.prefix);
    const key = `${prefix}.bettervault-test`;
    await s3.put(key, Buffer.from('ok'), 'text/plain');
    await s3.list(prefix);
    await s3.delete(key);
  };

  /* ── Restauration ── */

  const purgePreviews = () => {
    for (const [token, p] of previews) {
      if (p.expiresAt < now()) {
        rmSync(p.dir, { recursive: true, force: true });
        previews.delete(token);
      }
    }
  };

  const openPreview = (token: string) => {
    purgePreviews();
    const found = previews.get(token);
    if (!found) throw new Error('Aperçu expiré : recommencez l’aperçu avant de restaurer');
    return found;
  };

  /** Rapatrie les fichiers cités par la sauvegarde et absents du disque */
  async function fetchMissingFiles(destinationId: string, ids: string[]): Promise<number> {
    if (!options.filesDir) return 0;
    const dest = destination(destinationId);
    const s3 = clientFactory(dest.s3);
    const prefix = normalizePrefix(dest.s3.prefix);
    mkdirSync(options.filesDir, { recursive: true });
    let count = 0;
    for (const id of ids) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || existsSync(join(options.filesDir, id))) continue;
      writeFileSync(join(options.filesDir, id), await s3.get(`${prefix}files/${id}`));
      count++;
    }
    return count;
  }

  /**
   * Une restauration doit l'emporter sur les autres nœuds de la grappe, qui gardent la
   * version d'avant : on donne aux lignes restaurées un vecteur de version qui domine
   * celui d'avant la restauration.
   */
  function dominate(table: 'users' | 'vaults' | 'shared_vaults', keyCol: string, key: string, before: string | null) {
    const node = options.nodeId?.() ?? null;
    if (!node || !columnsOf(db, 'main', table).includes('vv')) return;
    const parse = (raw: string | null) => { try { return (raw ? JSON.parse(raw) : {}) as Record<string, number>; } catch { return {}; } };
    const current = parse((db.prepare(`SELECT vv FROM ${table} WHERE ${keyCol} = ?`).get(key) as { vv: string | null } | undefined)?.vv ?? null);
    const merged = { ...parse(before) };
    for (const [k, v] of Object.entries(current)) merged[k] = Math.max(merged[k] ?? 0, v);
    merged[node] = (merged[node] ?? 0) + 1;
    db.prepare("UPDATE settings SET value = '1' WHERE key = 'cluster_applying'").run();
    try {
      db.prepare(`UPDATE ${table} SET vv = ? WHERE ${keyCol} = ?`).run(JSON.stringify(merged), key);
    } finally {
      db.prepare("UPDATE settings SET value = '0' WHERE key = 'cluster_applying'").run();
    }
  }

  return {
    runNow,
    async test(destinationId?: string) {
      const targets = destinationId ? [destination(destinationId)] : effectiveDestinations(options.settings()).filter(d => d.status === 'active');
      if (!targets.length) throw new Error('Aucune destination de sauvegarde');
      for (const dest of targets) await testConfig(dest.s3);
    },
    testConfig,
    history: () => (db.prepare('SELECT * FROM backup_runs ORDER BY id DESC LIMIT 30').all() as Array<Record<string, unknown>>).map(toRun),
    isRunning: () => running,
    destinations: () => effectiveDestinations(options.settings()).map(d => ({ ...d, state: stateOf(d.id) })),

    async restorePoints(destinationId: string) {
      const dest = destination(destinationId);
      const prefix = normalizePrefix(dest.s3.prefix);
      return (await clientFactory(dest.s3).list(`${prefix}db/`))
        .filter(o => o.key.endsWith('.db.gz.enc'))
        .sort((a, b) => b.lastModified - a.lastModified)
        .map(o => ({ key: o.key, takenAt: o.lastModified, bytes: o.size }));
    },

    async preview(destinationId: string, key: string) {
      const dest = destination(destinationId);
      const prefix = normalizePrefix(dest.s3.prefix);
      if (!key.startsWith(`${prefix}db/`) || !key.endsWith('.db.gz.enc')) throw new Error('Copie de sauvegarde inconnue');
      const raw = gunzipSync(decryptBackup(await clientFactory(dest.s3).get(key), requireKey()));
      if (raw.subarray(0, 15).toString() !== 'SQLite format 3') throw new Error('Copie de sauvegarde illisible');
      const dir = mkdtempSync(join(tmpdir(), 'bettervault-restore-'));
      const path = join(dir, 'snapshot.db');
      writeFileSync(path, raw);

      const snap = new DatabaseSync(path, { readOnly: true });
      try {
        const count = (sql: string) => (snap.prepare(sql).get() as { n: number }).n;
        const snapVaults = new Map((snap.prepare('SELECT user_id, updated_at FROM vaults').all() as Array<{ user_id: string; updated_at: number }>).map(r => [r.user_id, r.updated_at]));
        const current = db.prepare('SELECT u.id, v.updated_at FROM users u LEFT JOIN vaults v ON v.user_id = u.id').all() as Array<{ id: string; updated_at: number | null }>;
        const token = randomBytes(24).toString('base64url');
        purgePreviews();
        previews.set(token, { path, dir, destinationId, key, expiresAt: now() + PREVIEW_TTL_MS });
        const takenAt = (await this.restorePoints(destinationId)).find(p => p.key === key)?.takenAt ?? 0;
        return {
          token,
          destinationId,
          key,
          takenAt,
          accounts: count('SELECT COUNT(*) AS n FROM users'),
          sharedVaults: count('SELECT COUNT(*) AS n FROM shared_vaults'),
          attachments: count('SELECT COUNT(*) AS n FROM attachments'),
          newerNow: current.filter(r => snapVaults.has(r.id) && (r.updated_at ?? 0) > (snapVaults.get(r.id) ?? 0)).length,
          createdSince: current.filter(r => !snapVaults.has(r.id)).length
        };
      } finally {
        snap.close();
      }
    },

    /**
     * Restaure le coffre d'un seul compte. Le coffre actuel est mis de côté
     * (restore_safety) : la restauration elle-même peut être défaite.
     */
    async restoreAccount(token: string, email: string) {
      const preview = openPreview(token);
      const snap = new DatabaseSync(preview.path, { readOnly: true });
      try {
        const address = email.trim().toLowerCase();
        const user = snap.prepare('SELECT id FROM users WHERE email = ?').get(address) as { id: string } | undefined;
        const live = db.prepare('SELECT id FROM users WHERE email = ?').get(address) as { id: string } | undefined;
        if (!user || !live || user.id !== live.id) throw new Error('Ce compte n’existe pas dans la sauvegarde ou a été recréé depuis');
        const old = snap.prepare('SELECT revision, blob FROM vaults WHERE user_id = ?').get(user.id) as { revision: number; blob: string } | undefined;
        if (!old) throw new Error('Aucun coffre pour ce compte dans la sauvegarde');
        // La colonne de version n'existe que sur un serveur membre d'une grappe
        const withVv = columnsOf(db, 'main', 'vaults').includes('vv');
        const current = db.prepare(`SELECT revision, blob${withVv ? ', vv' : ''} FROM vaults WHERE user_id = ?`).get(user.id) as { revision: number; blob: string; vv?: string | null } | undefined;

        const files = (snap.prepare('SELECT * FROM attachments WHERE owner_id = ? AND vault_id IS NULL').all(user.id) as Array<Record<string, unknown>>);
        const fetched = await fetchMissingFiles(preview.destinationId, files.map(f => String(f.id)));

        db.exec('BEGIN IMMEDIATE');
        try {
          if (current) db.prepare('INSERT INTO restore_safety (user_id, revision, blob, saved_at) VALUES (?, ?, ?, ?)').run(user.id, current.revision, current.blob, now());
          // Révision au-dessus de l'actuelle : chaque appareil voit qu'il doit relire
          const revision = (current?.revision ?? 0) + 1;
          db.prepare('UPDATE vaults SET revision = ?, blob = ?, updated_at = ? WHERE user_id = ?').run(revision, old.blob, now(), user.id);
          const cols = columnsOf(db, 'main', 'attachments');
          for (const file of files) {
            if (db.prepare('SELECT 1 FROM attachments WHERE id = ?').get(String(file.id))) continue;
            const keep = cols.filter(c => c in file);
            db.prepare(`INSERT INTO attachments (${keep.join(', ')}) VALUES (${keep.map(() => '?').join(', ')})`).run(...keep.map(c => file[c] as never));
          }
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
        dominate('vaults', 'user_id', user.id, current?.vv ?? null);
        return { restored: true, files: fetched };
      } finally {
        snap.close();
      }
    },

    /**
     * Restauration du serveur : les comptes, coffres et fichiers repassent à l'état de
     * la sauvegarde. Les comptes créés depuis sont gardés. Une copie de sécurité de
     * l'état actuel est envoyée aux destinations avant toute modification.
     */
    async restoreServer(token: string) {
      const preview = openPreview(token);
      const key = requireKey();

      // Copie de sécurité d'abord : si elle échoue partout, on n'écrase rien
      const safety = encryptBackup(databaseSnapshot(db), key);
      const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
      let safetyKey = '';
      for (const dest of effectiveDestinations(options.settings()).filter(d => d.status === 'active')) {
        try {
          await clientFactory(dest.s3).put(`${normalizePrefix(dest.s3.prefix)}db/bettervault-${stamp}-avant-restauration.db.gz.enc`, safety);
          safetyKey ||= `${dest.name} · bettervault-${stamp}-avant-restauration`;
        } catch {
          // essayé sur la suivante
        }
      }
      if (!safetyKey) throw new Error('Copie de sécurité impossible : aucune destination n’a accepté l’état actuel, rien n’a été modifié');

      const snapIds = (() => {
        const snap = new DatabaseSync(preview.path, { readOnly: true });
        try {
          // Une adresse reprise depuis par un AUTRE compte : ce compte récent n'est pas écrasé
          const liveByEmail = new Map((db.prepare('SELECT id, email FROM users').all() as Array<{ id: string; email: string }>).map(r => [r.email, r.id]));
          const snapUsers = snap.prepare('SELECT id, email FROM users').all() as Array<{ id: string; email: string }>;
          const skipped = snapUsers.filter(u => liveByEmail.has(u.email) && liveByEmail.get(u.email) !== u.id).map(u => u.id);
          const skip = new Set(skipped);
          return {
            users: snapUsers.filter(u => !skip.has(u.id)).map(u => u.id),
            skipped,
            files: (snap.prepare('SELECT id, owner_id FROM attachments').all() as Array<{ id: string; owner_id: string }>).filter(f => !skip.has(f.owner_id)).map(r => r.id),
            shared: (snap.prepare('SELECT id, owner_id FROM shared_vaults').all() as Array<{ id: string; owner_id: string }>).filter(v => !skip.has(v.owner_id)).map(r => r.id)
          };
        } finally {
          snap.close();
        }
      })();
      const fetched = await fetchMissingFiles(preview.destinationId, snapIds.files);

      // Vecteurs de version d'avant, pour que la restauration domine les autres nœuds
      const hasVv = columnsOf(db, 'main', 'users').includes('vv');
      const before = hasVv ? {
        users: new Map((db.prepare('SELECT id, vv FROM users').all() as Array<{ id: string; vv: string | null }>).map(r => [r.id, r.vv])),
        vaults: new Map((db.prepare('SELECT user_id, vv FROM vaults').all() as Array<{ user_id: string; vv: string | null }>).map(r => [r.user_id, r.vv])),
        shared: new Map((db.prepare('SELECT id, vv FROM shared_vaults').all() as Array<{ id: string; vv: string | null }>).map(r => [r.id, r.vv]))
      } : null;

      db.exec(`ATTACH DATABASE '${preview.path.replace(/'/g, "''")}' AS snap`);
      db.exec('PRAGMA foreign_keys = OFF');
      try {
        db.exec('BEGIN IMMEDIATE');
        try {
          const users = snapIds.users;
          const placeholders = (n: number) => Array(n).fill('?').join(', ');
          // Les lignes des comptes présents dans la sauvegarde sont remplacées ; les autres restent
          for (const table of RESTORED_TABLES) {
            const cols = columnsOf(db, 'snap', table).filter(c => columnsOf(db, 'main', table).includes(c));
            if (!cols.length) continue;
            const scope: Record<string, string> = {
              users: 'id', vaults: 'user_id', subscriptions: 'user_id', attachments: 'owner_id',
              shared_vaults: 'owner_id', shared_roles: 'vault_id', shared_members: 'vault_id'
            };
            const col = scope[table];
            const ids = table === 'shared_roles' || table === 'shared_members' ? snapIds.shared : users;
            if (ids.length) {
              for (let i = 0; i < ids.length; i += 500) {
                const slice = ids.slice(i, i + 500);
                db.prepare(`DELETE FROM main.${table} WHERE ${col} IN (${placeholders(slice.length)})`).run(...slice);
              }
            }
            const owner = { users: 'id', vaults: 'user_id', subscriptions: 'user_id', attachments: 'owner_id', shared_vaults: 'owner_id' }[table as 'users'];
            const filter = snapIds.skipped.length && owner
              ? ` WHERE ${owner} NOT IN (${placeholders(snapIds.skipped.length)})`
              : table === 'shared_roles' || table === 'shared_members'
                ? ` WHERE vault_id IN (SELECT id FROM main.shared_vaults)`
                : '';
            db.prepare(`INSERT OR REPLACE INTO main.${table} (${cols.join(', ')}) SELECT ${cols.join(', ')} FROM snap.${table}${filter}`)
              .run(...(filter.includes('NOT IN') ? snapIds.skipped : []));
          }

          /*
           * Remplacer une ligne, c'est la supprimer puis la réinsérer. Dans une grappe, la
           * suppression laisse une pierre tombale répliquée : sans ce nettoyage, les
           * autres nœuds effaceraient les comptes que l'on vient de restaurer.
           */
          if (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'cluster_tombstones'").get()) {
            db.exec(`
              DELETE FROM cluster_tombstones WHERE (kind = 'account' AND key IN (SELECT id FROM main.users))
                OR (kind = 'shared' AND key IN (SELECT id FROM main.shared_vaults))
                OR (kind = 'attachment' AND key IN (SELECT id FROM main.attachments));
              DELETE FROM cluster_log WHERE kind = 'tombstone' AND (
                substr(key, 9) IN (SELECT id FROM main.users) AND key LIKE 'account:%'
                OR substr(key, 8) IN (SELECT id FROM main.shared_vaults) AND key LIKE 'shared:%'
                OR substr(key, 12) IN (SELECT id FROM main.attachments) AND key LIKE 'attachment:%');
            `);
          }
          // Les sessions ouvertes datent d'un autre état : chacun se reconnecte
          db.prepare(`DELETE FROM sessions WHERE user_id IN (${placeholders(users.length) || "''"})`).run(...users);
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      } finally {
        db.exec('PRAGMA foreign_keys = ON');
        db.exec('DETACH DATABASE snap');
      }

      if (before) {
        for (const id of snapIds.users) {
          dominate('users', 'id', id, before.users.get(id) ?? null);
          dominate('vaults', 'user_id', id, before.vaults.get(id) ?? null);
        }
        for (const id of snapIds.shared) dominate('shared_vaults', 'id', id, before.shared.get(id) ?? null);
      }
      return { accounts: snapIds.users.length, skipped: snapIds.skipped.length, files: fetched, safetyKey };
    },

    start() {
      if (timer) return;
      timer = setInterval(tick, 10 * 60_000);
      timer.unref?.();
      setTimeout(tick, 30_000).unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      for (const p of previews.values()) rmSync(p.dir, { recursive: true, force: true });
      previews.clear();
    }
  };
}
