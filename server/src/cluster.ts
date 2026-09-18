import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readSync, closeSync, renameSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { HttpError, type Reply } from './http.ts';
import { route, type PatternRoute } from './context.ts';

/**
 * Grappe de serveurs tenus par le même opérateur (par exemple un nœud en Europe et
 * un aux États-Unis).
 *
 * Confiance
 *   Les nœuds partagent un secret (CLUSTER_SECRET) et se déclarent nommément
 *   (CLUSTER_PEERS). Chaque requête entre nœuds est signée avec ce secret : un
 *   serveur tenu par quelqu'un d'autre ne le possède pas et n'obtient rien. Les
 *   routes de grappe ne répondent jamais à un client ordinaire — on ne peut pas,
 *   depuis son serveur, demander les données d'un autre.
 *
 * Contenu
 *   Ce qui circule est ce que le serveur stocke déjà : des blobs chiffrés sur les
 *   appareils. La réplication ne donne à aucun nœud la possibilité de lire un coffre.
 *   Les sessions, codes email et jetons restent propres à chaque nœud : on se
 *   reconnecte sur un autre nœud avec son mot de passe, et l'on y retrouve tout.
 *
 * Mécanique
 *   - Des déclencheurs SQL notent chaque changement dans cluster_log, sans toucher
 *     aux routes. Chaque nœud tire des autres la liste de ce qui a changé, page par
 *     page, puis l'état complet des comptes et coffres partagés concernés, puis les
 *     fichiers manquants par tranches.
 *   - Chaque ligne porte un vecteur de version { nœud: compteur }. Une version qui
 *     domine l'autre la remplace ; deux versions concurrentes (modifiées sur deux
 *     nœuds entre deux synchronisations) sont départagées de la même façon partout,
 *     et le coffre perdant est gardé dans vault_conflicts pour que l'application le
 *     fusionne : aucune écriture n'est perdue.
 *   - Une suppression laisse une pierre tombale répliquée ; elle l'emporte toujours.
 */

export interface ClusterPeer {
  id: string;
  url: string;
}

export interface ClusterConfig {
  nodeId: string;
  secret: string;
  peers: ClusterPeer[];
  intervalMs: number;
}

const NODE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MAX_SKEW_MS = 5 * 60 * 1000;
const PAGE = 200;
export const FILE_CHUNK = 4 * 1024 * 1024;

/* ── Configuration ─────────────────────────────────────────────────────── */

export function clusterFromEnv(env: Record<string, string | undefined>): ClusterConfig | null {
  const nodeId = (env.CLUSTER_NODE_ID ?? '').trim();
  const secret = env.CLUSTER_SECRET ?? '';
  const peersRaw = (env.CLUSTER_PEERS ?? '').trim();
  if (!nodeId && !secret && !peersRaw) return null;

  if (!NODE_ID.test(nodeId)) throw new Error('CLUSTER_NODE_ID : lettres minuscules, chiffres et tirets, 32 caractères au plus');
  if (secret.length < 32) throw new Error('CLUSTER_SECRET doit contenir au moins 32 caractères');
  const peers = peersRaw ? peersRaw.split(',').map(entry => {
    const [id, url] = entry.split('=').map(s => s?.trim() ?? '');
    if (!NODE_ID.test(id)) throw new Error(`CLUSTER_PEERS : identifiant de nœud invalide « ${id} »`);
    if (id === nodeId) throw new Error('CLUSTER_PEERS ne doit pas contenir ce nœud lui-même');
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`CLUSTER_PEERS : adresse invalide pour « ${id} »`);
    }
    // En clair, le secret signé circulerait lisiblement : HTTPS obligatoire hors machine locale
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
      throw new Error(`CLUSTER_PEERS : « ${id} » doit être en https://`);
    }
    return { id, url: url.replace(/\/+$/, '') };
  }) : [];
  const seconds = Number(env.CLUSTER_SYNC_INTERVAL_S ?? 30);
  return { nodeId, secret, peers, intervalMs: Math.max(5, Number.isFinite(seconds) ? seconds : 30) * 1000 };
}

/* ── Schéma ────────────────────────────────────────────────────────────── */

const APPLYING = "COALESCE((SELECT value FROM settings WHERE key = 'cluster_applying'), '0') = '0'";
const NODE = "(SELECT value FROM settings WHERE key = 'cluster_node')";
const NOW = "CAST(strftime('%s','now') AS INTEGER) * 1000";
/** Incrémente le compteur de ce nœud dans un vecteur de version (JSON) */
const bump = (vv: string) =>
  `json_set(COALESCE(${vv}, '{}'), '$."' || ${NODE} || '"', COALESCE(json_extract(${vv}, '$."' || ${NODE} || '"'), 0) + 1)`;

export function installClusterSchema(db: DatabaseSync, nodeId: string): void {
  for (const table of ['users', 'vaults', 'shared_vaults']) {
    const cols = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name));
    if (!cols.has('vv')) db.exec(`ALTER TABLE ${table} ADD COLUMN vv TEXT`);
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('cluster_node', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(nodeId);
  db.prepare("INSERT INTO settings (key, value) VALUES ('cluster_applying', '0') ON CONFLICT(key) DO UPDATE SET value = '0'").run();

  db.exec(`
    CREATE TABLE IF NOT EXISTS cluster_log (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cluster_log_key ON cluster_log(kind, key);

    CREATE TABLE IF NOT EXISTS cluster_tombstones (
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      deleted_at INTEGER NOT NULL,
      PRIMARY KEY (kind, key)
    );

    -- Versions d'un coffre écartées lors d'une écriture concurrente sur deux nœuds :
    -- l'application les fusionne à sa prochaine synchronisation
    CREATE TABLE IF NOT EXISTS vault_conflicts (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      hash TEXT NOT NULL,
      revision INTEGER NOT NULL,
      blob TEXT NOT NULL,
      received_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, hash)
    );

    CREATE TABLE IF NOT EXISTS shared_conflicts (
      vault_id TEXT NOT NULL REFERENCES shared_vaults(id) ON DELETE CASCADE,
      hash TEXT NOT NULL,
      revision INTEGER NOT NULL,
      blob TEXT NOT NULL,
      received_at INTEGER NOT NULL,
      PRIMARY KEY (vault_id, hash)
    );

    -- Écritures locales : le compteur de ce nœud avance
    CREATE TRIGGER IF NOT EXISTS cl_users_ins AFTER INSERT ON users WHEN NEW.vv IS NULL AND ${APPLYING}
    BEGIN UPDATE users SET vv = ${bump('NULL')} WHERE id = NEW.id; END;
    CREATE TRIGGER IF NOT EXISTS cl_users_upd AFTER UPDATE ON users WHEN NEW.vv IS OLD.vv AND ${APPLYING}
    BEGIN UPDATE users SET vv = ${bump('OLD.vv')} WHERE id = NEW.id; END;

    CREATE TRIGGER IF NOT EXISTS cl_vaults_ins AFTER INSERT ON vaults WHEN NEW.vv IS NULL AND ${APPLYING}
    BEGIN UPDATE vaults SET vv = ${bump('NULL')} WHERE user_id = NEW.user_id; END;
    CREATE TRIGGER IF NOT EXISTS cl_vaults_upd AFTER UPDATE ON vaults WHEN NEW.vv IS OLD.vv AND ${APPLYING}
    BEGIN UPDATE vaults SET vv = ${bump('OLD.vv')} WHERE user_id = NEW.user_id; END;

    CREATE TRIGGER IF NOT EXISTS cl_shared_ins AFTER INSERT ON shared_vaults WHEN NEW.vv IS NULL AND ${APPLYING}
    BEGIN UPDATE shared_vaults SET vv = ${bump('NULL')} WHERE id = NEW.id; END;
    CREATE TRIGGER IF NOT EXISTS cl_shared_upd AFTER UPDATE ON shared_vaults WHEN NEW.vv IS OLD.vv AND ${APPLYING}
    BEGIN UPDATE shared_vaults SET vv = ${bump('OLD.vv')} WHERE id = NEW.id; END;

    -- Membres et rôles font partie de l'état du coffre partagé : ils en font avancer la version
    CREATE TRIGGER IF NOT EXISTS cl_members_ins AFTER INSERT ON shared_members WHEN ${APPLYING}
    BEGIN UPDATE shared_vaults SET vv = ${bump('vv')} WHERE id = NEW.vault_id; END;
    CREATE TRIGGER IF NOT EXISTS cl_members_upd AFTER UPDATE ON shared_members WHEN ${APPLYING}
    BEGIN UPDATE shared_vaults SET vv = ${bump('vv')} WHERE id = NEW.vault_id; END;
    CREATE TRIGGER IF NOT EXISTS cl_members_del AFTER DELETE ON shared_members WHEN ${APPLYING}
    BEGIN UPDATE shared_vaults SET vv = ${bump('vv')} WHERE id = OLD.vault_id; END;
    CREATE TRIGGER IF NOT EXISTS cl_roles_ins AFTER INSERT ON shared_roles WHEN ${APPLYING}
    BEGIN UPDATE shared_vaults SET vv = ${bump('vv')} WHERE id = NEW.vault_id; END;
    CREATE TRIGGER IF NOT EXISTS cl_roles_upd AFTER UPDATE ON shared_roles WHEN ${APPLYING}
    BEGIN UPDATE shared_vaults SET vv = ${bump('vv')} WHERE id = NEW.vault_id; END;
    CREATE TRIGGER IF NOT EXISTS cl_roles_del AFTER DELETE ON shared_roles WHEN ${APPLYING}
    BEGIN UPDATE shared_vaults SET vv = ${bump('vv')} WHERE id = OLD.vault_id; END;

    -- Journal : tout changement, local ou répliqué, signale le compte ou le coffre concerné
    CREATE TRIGGER IF NOT EXISTS cl_log_users_ins AFTER INSERT ON users BEGIN INSERT INTO cluster_log (kind, key, at) VALUES ('account', NEW.id, ${NOW}); END;
    CREATE TRIGGER IF NOT EXISTS cl_log_users_upd AFTER UPDATE ON users BEGIN INSERT INTO cluster_log (kind, key, at) VALUES ('account', NEW.id, ${NOW}); END;
    CREATE TRIGGER IF NOT EXISTS cl_log_vaults_ins AFTER INSERT ON vaults BEGIN INSERT INTO cluster_log (kind, key, at) VALUES ('account', NEW.user_id, ${NOW}); END;
    CREATE TRIGGER IF NOT EXISTS cl_log_vaults_upd AFTER UPDATE ON vaults BEGIN INSERT INTO cluster_log (kind, key, at) VALUES ('account', NEW.user_id, ${NOW}); END;
    CREATE TRIGGER IF NOT EXISTS cl_log_subs_ins AFTER INSERT ON subscriptions BEGIN INSERT INTO cluster_log (kind, key, at) VALUES ('account', NEW.user_id, ${NOW}); END;
    CREATE TRIGGER IF NOT EXISTS cl_log_subs_upd AFTER UPDATE ON subscriptions BEGIN INSERT INTO cluster_log (kind, key, at) VALUES ('account', NEW.user_id, ${NOW}); END;
    CREATE TRIGGER IF NOT EXISTS cl_log_att_ins AFTER INSERT ON attachments BEGIN
      INSERT INTO cluster_log (kind, key, at) VALUES (CASE WHEN NEW.vault_id IS NULL THEN 'account' ELSE 'shared' END, COALESCE(NEW.vault_id, NEW.owner_id), ${NOW});
    END;
    CREATE TRIGGER IF NOT EXISTS cl_log_shared_ins AFTER INSERT ON shared_vaults BEGIN INSERT INTO cluster_log (kind, key, at) VALUES ('shared', NEW.id, ${NOW}); END;
    CREATE TRIGGER IF NOT EXISTS cl_log_shared_upd AFTER UPDATE ON shared_vaults BEGIN INSERT INTO cluster_log (kind, key, at) VALUES ('shared', NEW.id, ${NOW}); END;

    -- Suppressions : une pierre tombale, répliquée à son tour
    CREATE TRIGGER IF NOT EXISTS cl_tomb_users AFTER DELETE ON users BEGIN
      INSERT OR REPLACE INTO cluster_tombstones (kind, key, deleted_at) VALUES ('account', OLD.id, ${NOW});
      INSERT INTO cluster_log (kind, key, at) VALUES ('tombstone', 'account:' || OLD.id, ${NOW});
    END;
    CREATE TRIGGER IF NOT EXISTS cl_tomb_shared AFTER DELETE ON shared_vaults BEGIN
      INSERT OR REPLACE INTO cluster_tombstones (kind, key, deleted_at) VALUES ('shared', OLD.id, ${NOW});
      INSERT INTO cluster_log (kind, key, at) VALUES ('tombstone', 'shared:' || OLD.id, ${NOW});
    END;
    CREATE TRIGGER IF NOT EXISTS cl_tomb_att AFTER DELETE ON attachments BEGIN
      INSERT OR REPLACE INTO cluster_tombstones (kind, key, deleted_at) VALUES ('attachment', OLD.id, ${NOW});
      INSERT INTO cluster_log (kind, key, at) VALUES ('tombstone', 'attachment:' || OLD.id, ${NOW});
    END;
    CREATE TRIGGER IF NOT EXISTS cl_tomb_subs AFTER DELETE ON subscriptions BEGIN
      INSERT INTO cluster_log (kind, key, at) VALUES ('account', OLD.user_id, ${NOW});
    END;
  `);

  // Première activation : ce qui existait avant n'a jamais été journalisé
  const empty = (db.prepare('SELECT COUNT(*) AS n FROM cluster_log').get() as { n: number }).n === 0;
  if (empty) {
    const at = Date.now();
    db.prepare("INSERT INTO cluster_log (kind, key, at) SELECT 'account', id, ? FROM users").run(at);
    db.prepare("INSERT INTO cluster_log (kind, key, at) SELECT 'shared', id, ? FROM shared_vaults").run(at);
    // Donne un vecteur de version aux lignes antérieures, attribuées à ce nœud
    const initial = JSON.stringify({ [nodeId]: 1 });
    db.prepare("UPDATE settings SET value = '1' WHERE key = 'cluster_applying'").run();
    try {
      for (const table of ['users', 'vaults', 'shared_vaults']) db.prepare(`UPDATE ${table} SET vv = ? WHERE vv IS NULL`).run(initial);
    } finally {
      db.prepare("UPDATE settings SET value = '0' WHERE key = 'cluster_applying'").run();
    }
  }
}

/* ── Vecteurs de version ───────────────────────────────────────────────── */

export type VersionVector = Record<string, number>;
export type Order = 'equal' | 'newer' | 'older' | 'concurrent';

export const parseVv = (raw: unknown): VersionVector => {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([k, v]) => NODE_ID.test(k) && Number.isInteger(v) && (v as number) >= 0) as Array<[string, number]>);
  } catch {
    return {};
  }
};

/** Place `a` par rapport à `b` */
export function compareVv(a: VersionVector, b: VersionVector): Order {
  let greater = false;
  let smaller = false;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[key] ?? 0;
    const y = b[key] ?? 0;
    if (x > y) greater = true;
    if (x < y) smaller = true;
  }
  if (greater && smaller) return 'concurrent';
  if (greater) return 'newer';
  if (smaller) return 'older';
  return 'equal';
}

export const mergeVv = (a: VersionVector, b: VersionVector): VersionVector => {
  const out: VersionVector = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
  return out;
};

/**
 * Départage deux versions concurrentes, de la même façon sur tous les nœuds :
 * sans cela chacun garderait la sienne et ils ne convergeraient jamais.
 */
export function pickWinner(a: { vv: VersionVector; fingerprint: string }, b: { vv: VersionVector; fingerprint: string }): 'a' | 'b' {
  const total = (v: VersionVector) => Object.values(v).reduce((s, n) => s + n, 0);
  if (total(a.vv) !== total(b.vv)) return total(a.vv) > total(b.vv) ? 'a' : 'b';
  return a.fingerprint >= b.fingerprint ? 'a' : 'b';
}

const sha = (value: string) => createHmac('sha256', 'bettervault-fingerprint').update(value).digest('base64url');

/* ── Signature des requêtes entre nœuds ────────────────────────────────── */

const signature = (secret: string, parts: string[]) => createHmac('sha256', secret).update(parts.join('\n')).digest('base64');

export function signedHeaders(config: ClusterConfig, method: string, pathWithQuery: string, now = Date.now()): Record<string, string> {
  const time = String(now);
  const nonce = randomBytes(16).toString('hex');
  return {
    'X-BV-Node': config.nodeId,
    'X-BV-Time': time,
    'X-BV-Nonce': nonce,
    'X-BV-Signature': signature(config.secret, [config.nodeId, time, nonce, method.toUpperCase(), pathWithQuery])
  };
}

export function createVerifier(config: ClusterConfig, now: () => number) {
  const seen = new Map<string, number>();
  return (req: IncomingMessage): string => {
    const node = String(req.headers['x-bv-node'] ?? '');
    const time = String(req.headers['x-bv-time'] ?? '');
    const nonce = String(req.headers['x-bv-nonce'] ?? '');
    const provided = Buffer.from(String(req.headers['x-bv-signature'] ?? ''), 'base64');
    const refuse = () => new HttpError(401, 'cluster_unauthorized', 'Nœud non reconnu');

    // Seuls les nœuds déclarés sont admis, même porteurs du bon secret
    if (!config.peers.some(p => p.id === node)) throw refuse();
    const at = Number(time);
    if (!Number.isFinite(at) || Math.abs(now() - at) > MAX_SKEW_MS) throw refuse();
    if (!/^[0-9a-f]{32}$/.test(nonce)) throw refuse();

    const expected = Buffer.from(signature(config.secret, [node, time, nonce, String(req.method).toUpperCase(), req.url ?? '']), 'base64');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw refuse();

    // Une requête signée ne se rejoue pas
    const key = `${node}:${nonce}`;
    if (seen.has(key)) throw refuse();
    seen.set(key, at);
    if (seen.size > 20_000) for (const [k, t] of seen) if (t < now() - MAX_SKEW_MS) seen.delete(k);
    return node;
  };
}

/* ── Paquets : l'état complet d'un compte ou d'un coffre partagé ────────── */

type Row = Record<string, unknown>;

/** Les BLOB SQLite voyagent en base64, le reste tel quel */
const encodeRow = (row: Row): Row => Object.fromEntries(Object.entries(row).map(([k, v]) =>
  v instanceof Uint8Array ? [k, { $b64: Buffer.from(v).toString('base64') }] : [k, v]));
const decodeRow = (row: Row): Row => Object.fromEntries(Object.entries(row).map(([k, v]) =>
  v && typeof v === 'object' && '$b64' in (v as Row) ? [k, Buffer.from(String((v as Row).$b64), 'base64')] : [k, v]));

const columnsOf = (db: DatabaseSync, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name);

/** Insère ou remplace une ligne, en ne gardant que les colonnes connues localement */
function upsert(db: DatabaseSync, table: string, row: Row, conflictKey: string[]): void {
  const cols = columnsOf(db, table).filter(c => c in row);
  const updates = cols.filter(c => !conflictKey.includes(c)).map(c => `${c} = excluded.${c}`).join(', ');
  db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
    ON CONFLICT(${conflictKey.join(', ')}) DO ${updates ? `UPDATE SET ${updates}` : 'NOTHING'}`)
    .run(...cols.map(c => row[c] as never));
}

export interface AccountBundle {
  user: Row;
  vault: Row | null;
  subscription: Row | null;
  attachments: Row[];
  /** Versions écartées pas encore fusionnées : elles doivent atteindre tous les nœuds */
  conflicts?: Row[];
}

export interface SharedBundle {
  vault: Row;
  roles: Row[];
  members: Row[];
  attachments: Row[];
}

export function accountBundle(db: DatabaseSync, userId: string): AccountBundle | null {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Row | undefined;
  if (!user) return null;
  return {
    user: encodeRow(user),
    vault: (db.prepare('SELECT * FROM vaults WHERE user_id = ?').get(userId) as Row | undefined) ?? null,
    subscription: (db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId) as Row | undefined) ?? null,
    attachments: db.prepare('SELECT * FROM attachments WHERE owner_id = ? AND vault_id IS NULL').all(userId) as Row[],
    conflicts: db.prepare('SELECT * FROM vault_conflicts WHERE user_id = ?').all(userId) as Row[]
  };
}

export function sharedBundle(db: DatabaseSync, vaultId: string): SharedBundle | null {
  const vault = db.prepare('SELECT * FROM shared_vaults WHERE id = ?').get(vaultId) as Row | undefined;
  if (!vault) return null;
  return {
    vault,
    roles: db.prepare('SELECT * FROM shared_roles WHERE vault_id = ?').all(vaultId) as Row[],
    members: db.prepare('SELECT * FROM shared_members WHERE vault_id = ?').all(vaultId) as Row[],
    attachments: db.prepare('SELECT * FROM attachments WHERE vault_id = ?').all(vaultId) as Row[]
  };
}

const tombstoned = (db: DatabaseSync, kind: string, key: string) =>
  !!db.prepare('SELECT 1 FROM cluster_tombstones WHERE kind = ? AND key = ?').get(kind, key);

/** Exécute une application de paquet sans que les déclencheurs la comptent comme une écriture locale */
function applying<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  db.prepare("UPDATE settings SET value = '1' WHERE key = 'cluster_applying'").run();
  try {
    const result = work();
    db.prepare("UPDATE settings SET value = '0' WHERE key = 'cluster_applying'").run();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    db.prepare("UPDATE settings SET value = '0' WHERE key = 'cluster_applying'").run();
    throw err;
  }
}

export interface ApplyOutcome {
  changed: boolean;
  /** Pièces jointes présentes en base mais absentes du disque : à télécharger */
  missingFiles: string[];
  /** Comptes à récupérer avant de pouvoir appliquer ce paquet */
  needsAccounts?: string[];
  conflict?: string;
}

const missingFilesOf = (filesDir: string | null, rows: Row[]) =>
  filesDir ? rows.map(r => String(r.id)).filter(id => !existsSync(join(filesDir, id))) : [];

export function applyAccountBundle(db: DatabaseSync, bundle: AccountBundle, filesDir: string | null, now: number): ApplyOutcome {
  const incomingUser = decodeRow(bundle.user);
  const userId = String(incomingUser.id);
  if (tombstoned(db, 'account', userId)) return { changed: false, missingFiles: [] };

  return applying(db, () => {
    let changed = false;
    const local = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Row | undefined;

    if (!local) {
      // Même adresse, autre compte : créé sur deux nœuds avant qu'ils se voient. On ne fusionne pas.
      const homonyme = db.prepare('SELECT id FROM users WHERE email = ? AND id <> ?').get(incomingUser.email as string, userId);
      if (homonyme) return { changed: false, missingFiles: [], conflict: `email en double : ${String(incomingUser.email)}` };
      upsert(db, 'users', incomingUser, ['id']);
      changed = true;
    } else {
      const a = parseVv(incomingUser.vv);
      const b = parseVv(local.vv);
      const order = compareVv(a, b);
      const take = order === 'newer' || (order === 'concurrent' &&
        pickWinner({ vv: a, fingerprint: sha(JSON.stringify(bundle.user)) }, { vv: b, fingerprint: sha(JSON.stringify(encodeRow(local))) }) === 'a');
      if (take) {
        upsert(db, 'users', { ...incomingUser, vv: JSON.stringify(order === 'concurrent' ? mergeVv(a, b) : a) }, ['id']);
        changed = true;
      } else if (order === 'concurrent') {
        db.prepare('UPDATE users SET vv = ? WHERE id = ?').run(JSON.stringify(mergeVv(a, b)), userId);
        changed = true;
      }
    }

    if (bundle.vault) {
      const decision = applyVaultRow(db, 'vaults', 'user_id', userId, bundle.vault, 'vault_conflicts', now);
      changed = decision.winner !== 'unchanged' || changed;

      /*
       * Versions écartées. Une version qui domine la nôtre sait lesquelles ont déjà été
       * fusionnées (l'acquittement passe par une écriture du coffre) : son ensemble
       * remplace le nôtre. Deux versions concurrentes ne savent chacune qu'une partie :
       * on garde l'union. Une version plus ancienne n'apprend rien.
       */
      const incomingConflicts = bundle.conflicts ?? [];
      if (decision.order === 'newer') {
        db.prepare('DELETE FROM vault_conflicts WHERE user_id = ?').run(userId);
        for (const row of incomingConflicts) upsert(db, 'vault_conflicts', { ...row, user_id: userId }, ['user_id', 'hash']);
      } else if (decision.order === 'concurrent') {
        for (const row of incomingConflicts) {
          db.prepare('INSERT OR IGNORE INTO vault_conflicts (user_id, hash, revision, blob, received_at) VALUES (?, ?, ?, ?, ?)')
            .run(userId, String(row.hash), Number(row.revision), String(row.blob), Number(row.received_at));
        }
      }
    }

    if (bundle.subscription) {
      const localSub = db.prepare('SELECT updated_at FROM subscriptions WHERE user_id = ?').get(userId) as { updated_at: number } | undefined;
      if (!localSub || Number(bundle.subscription.updated_at) > localSub.updated_at) {
        upsert(db, 'subscriptions', bundle.subscription, ['user_id']);
        changed = true;
      }
    }

    for (const att of bundle.attachments) {
      if (tombstoned(db, 'attachment', String(att.id))) continue;
      if (!db.prepare('SELECT 1 FROM attachments WHERE id = ?').get(String(att.id))) {
        upsert(db, 'attachments', att, ['id']);
        changed = true;
      }
    }
    return { changed, missingFiles: missingFilesOf(filesDir, bundle.attachments) };
  });
}

/**
 * Compare et applique un coffre chiffré (personnel ou partagé). En cas d'écritures
 * concurrentes, la version perdante est rangée à part pour que l'application la
 * fusionne ; elle n'est jamais jetée.
 */
type VaultWinner = 'incoming' | 'local' | 'unchanged';
interface VaultDecision { winner: VaultWinner; order: Order }

function applyVaultRow(db: DatabaseSync, table: 'vaults' | 'shared_vaults', keyCol: string, key: string, incoming: Row, conflicts: string, now: number): VaultDecision {
  const local = db.prepare(`SELECT * FROM ${table} WHERE ${keyCol} = ?`).get(key) as Row | undefined;
  if (!local) {
    upsert(db, table, incoming, [keyCol === 'user_id' ? 'user_id' : 'id']);
    return { winner: 'incoming', order: 'newer' };
  }
  const a = parseVv(incoming.vv);
  const b = parseVv(local.vv);
  const order = compareVv(a, b);
  if (order === 'equal' || order === 'older') return { winner: 'unchanged', order };
  if (order === 'newer') {
    upsert(db, table, incoming, [keyCol === 'user_id' ? 'user_id' : 'id']);
    return { winner: 'incoming', order };
  }
  const fa = sha(String(incoming.blob));
  const fb = sha(String(local.blob));
  const winner = pickWinner({ vv: a, fingerprint: fa }, { vv: b, fingerprint: fb }) === 'a' ? incoming : local;
  const loser = winner === incoming ? local : incoming;
  const merged = mergeVv(a, b);
  const conflictKey = conflicts === 'vault_conflicts' ? 'user_id' : 'vault_id';
  db.prepare(`INSERT OR IGNORE INTO ${conflicts} (${conflictKey}, hash, revision, blob, received_at) VALUES (?, ?, ?, ?, ?)`)
    .run(key, sha(String(loser.blob)), Number(loser.revision), String(loser.blob), now);
  // La révision dépasse les deux : un appareil resté sur l'une ou l'autre verra qu'il doit relire
  upsert(db, table, { ...winner, vv: JSON.stringify(merged), revision: Math.max(Number(incoming.revision), Number(local.revision)) + 1 },
    [keyCol === 'user_id' ? 'user_id' : 'id']);
  return { winner: winner === incoming ? 'incoming' : 'local', order };
}

export function applySharedBundle(db: DatabaseSync, bundle: SharedBundle, filesDir: string | null, now: number): ApplyOutcome {
  const vaultId = String(bundle.vault.id);
  if (tombstoned(db, 'shared', vaultId)) return { changed: false, missingFiles: [] };

  // Les comptes cités doivent exister ici avant le coffre : clés étrangères
  const cited = new Set([String(bundle.vault.owner_id), ...bundle.members.map(m => String(m.user_id))]);
  const absents = [...cited].filter(id => !db.prepare('SELECT 1 FROM users WHERE id = ?').get(id) && !tombstoned(db, 'account', id));
  if (absents.length) return { changed: false, missingFiles: [], needsAccounts: absents };
  if (tombstoned(db, 'account', String(bundle.vault.owner_id))) return { changed: false, missingFiles: [] };

  return applying(db, () => {
    const { winner } = applyVaultRow(db, 'shared_vaults', 'id', vaultId, bundle.vault, 'shared_conflicts', now);
    let changed = winner !== 'unchanged';

    // Membres et rôles suivent la version retenue du coffre : l'ensemble gagnant remplace l'autre
    if (winner === 'incoming') {
      const members = bundle.members.filter(m => !tombstoned(db, 'account', String(m.user_id)));
      db.prepare('DELETE FROM shared_members WHERE vault_id = ?').run(vaultId);
      db.prepare('DELETE FROM shared_roles WHERE vault_id = ?').run(vaultId);
      for (const role of bundle.roles) upsert(db, 'shared_roles', role, ['id']);
      for (const member of members) upsert(db, 'shared_members', member, ['vault_id', 'user_id']);
      changed = true;
    }

    for (const att of bundle.attachments) {
      if (tombstoned(db, 'attachment', String(att.id))) continue;
      if (!db.prepare('SELECT 1 FROM attachments WHERE id = ?').get(String(att.id))) {
        upsert(db, 'attachments', att, ['id']);
        changed = true;
      }
    }
    return { changed, missingFiles: missingFilesOf(filesDir, bundle.attachments) };
  });
}

/** Applique une suppression venue d'un autre nœud ; renvoie les fichiers à effacer du disque */
export function applyTombstone(db: DatabaseSync, key: string): string[] {
  const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  if (!['account', 'shared', 'attachment'].includes(kind) || !id) return [];
  return applying(db, () => {
    const files: string[] = [];
    if (kind === 'account') {
      files.push(...(db.prepare('SELECT id FROM attachments WHERE owner_id = ?').all(id) as Array<{ id: string }>).map(r => r.id));
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    } else if (kind === 'shared') {
      files.push(...(db.prepare('SELECT id FROM attachments WHERE vault_id = ?').all(id) as Array<{ id: string }>).map(r => r.id));
      db.prepare('DELETE FROM shared_vaults WHERE id = ?').run(id);
    } else {
      files.push(id);
      db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
    }
    db.prepare('INSERT OR REPLACE INTO cluster_tombstones (kind, key, deleted_at) VALUES (?, ?, ?)').run(kind, id, Date.now());
    return files;
  });
}

/* ── Routes exposées aux autres nœuds ──────────────────────────────────── */

export function clusterRoutes(options: {
  db: DatabaseSync;
  config: ClusterConfig;
  filesDir: string | null;
  now: () => number;
}): PatternRoute[] {
  const { db, config, filesDir, now } = options;
  const verify = createVerifier(config, now);
  const json = (body: unknown): Reply => ({ status: 200, body });

  return [
    route('GET', '/api/v1/cluster/changes', async req => {
      verify(req);
      const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
      const since = Math.max(0, Number(params.get('since') ?? 0) || 0);
      const limit = Math.min(PAGE, Math.max(1, Number(params.get('limit') ?? PAGE) || PAGE));
      const items = db.prepare(`
        SELECT kind, key, MAX(seq) AS seq FROM cluster_log WHERE seq > ?
        GROUP BY kind, key ORDER BY seq LIMIT ?`).all(since, limit) as Array<{ kind: string; key: string; seq: number }>;
      const head = (db.prepare('SELECT COALESCE(MAX(seq), 0) AS head FROM cluster_log').get() as { head: number }).head;
      return json({ node: config.nodeId, head, items });
    }),

    route('GET', '/api/v1/cluster/accounts/:id', async (req, params) => {
      verify(req);
      const bundle = accountBundle(db, params.id);
      if (!bundle) throw new HttpError(404, 'not_found', 'Compte inconnu');
      return json(bundle);
    }),

    route('GET', '/api/v1/cluster/shared/:id', async (req, params) => {
      verify(req);
      const bundle = sharedBundle(db, params.id);
      if (!bundle) throw new HttpError(404, 'not_found', 'Coffre inconnu');
      return json(bundle);
    }),

    // Fichier chiffré, par tranches : un gros fichier ne bloque ni la mémoire ni une requête trop longue
    route('GET', '/api/v1/cluster/files/:id', async (req, params) => {
      verify(req);
      if (!filesDir || !/^[A-Za-z0-9_-]{1,64}$/.test(params.id)) throw new HttpError(404, 'not_found', 'Fichier inconnu');
      const path = join(filesDir, params.id);
      if (!existsSync(path)) throw new HttpError(404, 'not_found', 'Fichier inconnu');
      const size = statSync(path).size;
      const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
      const offset = Math.max(0, Number(query.get('offset') ?? 0) || 0);
      const length = Math.min(FILE_CHUNK, Math.max(0, size - offset));
      const buffer = Buffer.alloc(length);
      if (length) {
        const fd = openSync(path, 'r');
        try {
          readSync(fd, buffer, 0, length, offset);
        } finally {
          closeSync(fd);
        }
      }
      return { status: 200, raw: buffer, contentType: 'application/octet-stream', headers: { 'X-BV-Size': String(size) } } as Reply;
    }),

    // Adresse déjà prise ailleurs dans la grappe ? L'adresse ne circule que sous forme d'empreinte
    route('GET', '/api/v1/cluster/email/:hash', async (req, params) => {
      verify(req);
      const rows = db.prepare('SELECT email FROM users').all() as Array<{ email: string }>;
      const taken = rows.some(r => emailFingerprint(config.secret, r.email) === params.hash);
      return json({ taken });
    })
  ];
}

export const emailFingerprint = (secret: string, email: string) =>
  createHmac('sha256', secret).update(`email:${email.trim().toLowerCase()}`).digest('base64url');

/* ── Réplication : ce nœud tire les changements des autres ─────────────── */

export interface PeerStatus {
  id: string;
  url: string;
  cursor: number;
  head: number | null;
  lastOkAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  conflicts: number;
}

export function createClusterSync(options: {
  db: DatabaseSync;
  config: ClusterConfig;
  filesDir: string | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (message: string) => void;
}) {
  const { db, config, filesDir } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const log = options.log ?? (message => console.warn(`[grappe] ${message}`));
  const status = new Map<string, PeerStatus>(config.peers.map(p => [p.id, {
    id: p.id, url: p.url, cursor: readCursor(p.id), head: null, lastOkAt: null, lastError: null, lastErrorAt: null, conflicts: 0
  }]));
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  function readCursor(peer: string): number {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(`cluster_cursor:${peer}`) as { value: string } | undefined;
    return Number(row?.value ?? 0) || 0;
  }
  const writeCursor = (peer: string, value: number) =>
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(`cluster_cursor:${peer}`, String(value));

  const get = async (peer: ClusterPeer, path: string): Promise<Response> => {
    const response = await fetchImpl(peer.url + path, { headers: signedHeaders(config, 'GET', path, now()), signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`${path.split('?')[0]} : HTTP ${response.status}`);
    return response;
  };

  /** Télécharge un fichier par tranches, dans un fichier temporaire renommé à la fin */
  const pullFile = async (peer: ClusterPeer, id: string) => {
    if (!filesDir || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return;
    mkdirSync(filesDir, { recursive: true });
    const target = join(filesDir, id);
    if (existsSync(target)) return;
    const partial = `${target}.part`;
    writeFileSync(partial, Buffer.alloc(0));
    try {
      let offset = 0;
      for (;;) {
        const response = await get(peer, `/api/v1/cluster/files/${id}?offset=${offset}`);
        const size = Number(response.headers.get('x-bv-size'));
        const chunk = Buffer.from(await response.arrayBuffer());
        appendFileSync(partial, chunk);
        offset += chunk.length;
        if (offset >= size || chunk.length === 0) {
          if (offset !== size) throw new Error(`fichier ${id} incomplet`);
          break;
        }
      }
      renameSync(partial, target);
    } catch (err) {
      rmSync(partial, { force: true });
      throw err;
    }
  };

  const pullAccount = async (peer: ClusterPeer, id: string) => {
    const response = await fetchImpl(peer.url + `/api/v1/cluster/accounts/${encodeURIComponent(id)}`, {
      headers: signedHeaders(config, 'GET', `/api/v1/cluster/accounts/${encodeURIComponent(id)}`, now()),
      signal: AbortSignal.timeout(20_000)
    });
    if (response.status === 404) return; // supprimé entre-temps : la pierre tombale suivra
    if (!response.ok) throw new Error(`compte : HTTP ${response.status}`);
    const outcome = applyAccountBundle(db, await response.json() as AccountBundle, filesDir, now());
    if (outcome.conflict) {
      status.get(peer.id)!.conflicts += 1;
      log(`${peer.id} : ${outcome.conflict}`);
    }
    for (const file of outcome.missingFiles) await pullFile(peer, file);
  };

  const pullShared = async (peer: ClusterPeer, id: string, depth = 0): Promise<void> => {
    const path = `/api/v1/cluster/shared/${encodeURIComponent(id)}`;
    const response = await fetchImpl(peer.url + path, { headers: signedHeaders(config, 'GET', path, now()), signal: AbortSignal.timeout(20_000) });
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`coffre partagé : HTTP ${response.status}`);
    const bundle = await response.json() as SharedBundle;
    let outcome = applySharedBundle(db, bundle, filesDir, now());
    if (outcome.needsAccounts?.length && depth === 0) {
      for (const account of outcome.needsAccounts) await pullAccount(peer, account);
      outcome = applySharedBundle(db, bundle, filesDir, now());
    }
    for (const file of outcome.missingFiles) await pullFile(peer, file);
  };

  const syncPeer = async (peer: ClusterPeer) => {
    const state = status.get(peer.id)!;
    try {
      for (let pages = 0; pages < 1000; pages++) {
        const response = await get(peer, `/api/v1/cluster/changes?since=${state.cursor}&limit=${PAGE}`);
        const page = await response.json() as { node: string; head: number; items: Array<{ kind: string; key: string; seq: number }> };
        // Le nœud répond sous le nom qu'on lui connaît, sinon on parle à quelqu'un d'autre
        if (page.node !== peer.id) throw new Error(`le nœud répond sous le nom « ${page.node} »`);
        state.head = page.head;
        if (!page.items.length) break;

        // Les comptes d'abord : un coffre partagé cite ses membres
        const ordered = [...page.items].sort((a, b) => (a.kind === 'account' ? 0 : 1) - (b.kind === 'account' ? 0 : 1));
        for (const item of ordered) {
          if (item.kind === 'account') await pullAccount(peer, item.key);
          else if (item.kind === 'shared') await pullShared(peer, item.key);
          else if (item.kind === 'tombstone') {
            for (const file of applyTombstone(db, item.key)) if (filesDir) rmSync(join(filesDir, file), { force: true });
          }
        }
        state.cursor = Math.max(state.cursor, ...page.items.map(i => i.seq));
        writeCursor(peer.id, state.cursor);
        if (page.items.length < PAGE) break;
      }
      state.lastOkAt = now();
      state.lastError = null;
    } catch (err) {
      state.lastError = err instanceof Error ? err.message : String(err);
      state.lastErrorAt = now();
      log(`${peer.id} : ${state.lastError}`);
    }
  };

  const syncNow = (): Promise<void> => {
    if (running) return running;
    running = (async () => {
      for (const peer of config.peers) await syncPeer(peer);
      // Le journal ne garde que la dernière entrée de chaque compte ou coffre
      db.exec('DELETE FROM cluster_log WHERE seq NOT IN (SELECT MAX(seq) FROM cluster_log GROUP BY kind, key)');
    })().finally(() => { running = null; });
    return running;
  };

  return {
    syncNow,
    start() {
      if (timer || !config.peers.length) return;
      timer = setInterval(() => void syncNow(), config.intervalMs);
      timer.unref?.();
      void syncNow();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    status: () => [...status.values()],
    /** Une adresse est-elle déjà prise sur un autre nœud ? Un nœud injoignable ne bloque pas l'inscription */
    async emailTaken(email: string): Promise<boolean> {
      const hash = emailFingerprint(config.secret, email);
      const answers = await Promise.all(config.peers.map(async peer => {
        try {
          const path = `/api/v1/cluster/email/${hash}`;
          const response = await fetchImpl(peer.url + path, { headers: signedHeaders(config, 'GET', path, now()), signal: AbortSignal.timeout(3000) });
          return response.ok && (await response.json() as { taken: boolean }).taken;
        } catch {
          return false;
        }
      }));
      return answers.some(Boolean);
    }
  };
}

export type ClusterSync = ReturnType<typeof createClusterSync>;
