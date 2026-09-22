import { createHash, createHmac } from 'node:crypto';
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
 *   Voir clusterTrust.ts : chaque nœud a sa clé Ed25519, et seuls les nœuds actifs
 *   d'un manifeste signé par la clé racine de la grappe peuvent échanger. Un
 *   serveur d'un autre opérateur n'est dans aucun manifeste et n'obtient rien. Les
 *   routes de grappe ne répondent jamais à un client ordinaire — on ne peut pas,
 *   depuis son serveur, demander les données d'un autre. Un compte n'est répliqué
 *   que vers les nœuds de sa zone de résidence.
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

import type { ClusterPeer } from './clusterTrust.ts';
export type { ClusterPeer };

/** Ce dont la réplication a besoin de la couche de confiance (clusterTrust.ts) */
export interface ClusterAuth {
  selfId: string;
  zone(): string | null;
  /** Nœuds actifs de la même zone : les seuls avec qui l'on réplique */
  peers(): ClusterPeer[];
  signedHeaders(method: string, pathWithQuery: string, body?: string): Record<string, string>;
  verifyRequest(req: IncomingMessage, body: string, allow: 'active'): { id: string; zone?: string };
  refreshManifest(): Promise<void>;
  manifest(): { clusterId: string } | null;
  event(level: 'info' | 'warn' | 'error', message: string, nodeId?: string): void;
}

const PAGE = 200;
export const FILE_CHUNK = 4 * 1024 * 1024;
const NODE_ID = /^n-[a-f0-9]{16}$/;

/* ── Schéma ────────────────────────────────────────────────────────────── */

const APPLYING = "COALESCE((SELECT value FROM settings WHERE key = 'cluster_applying'), '0') = '0'";
const NODE = "(SELECT value FROM settings WHERE key = 'cluster_node')";
const NOW = "CAST(strftime('%s','now') AS INTEGER) * 1000";
/** Incrémente le compteur de ce nœud dans un vecteur de version (JSON) */
const bump = (vv: string) =>
  `json_set(COALESCE(${vv}, '{}'), '$."' || ${NODE} || '"', COALESCE(json_extract(${vv}, '$."' || ${NODE} || '"'), 0) + 1)`;

export function installClusterSchema(db: DatabaseSync, nodeId: string, zone?: string | null): void {
  for (const table of ['users', 'vaults', 'shared_vaults']) {
    const cols = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name));
    if (!cols.has('vv')) db.exec(`ALTER TABLE ${table} ADD COLUMN vv TEXT`);
  }
  // Zone de résidence de chaque compte : il n'est répliqué que vers les nœuds de cette zone
  const userCols = new Set((db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>).map(c => c.name));
  if (!userCols.has('home_zone')) db.exec('ALTER TABLE users ADD COLUMN home_zone TEXT');
  if (zone) db.prepare('UPDATE users SET home_zone = ? WHERE home_zone IS NULL').run(zone);
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

/** Zone d'un compte ; un compte d'avant la grappe appartient à la zone de ce nœud */
const accountZone = (db: DatabaseSync, userId: string, fallback: string | null) =>
  (db.prepare('SELECT home_zone FROM users WHERE id = ?').get(userId) as { home_zone: string | null } | undefined)?.home_zone ?? fallback;

export function clusterRoutes(options: {
  db: DatabaseSync;
  auth: ClusterAuth;
  filesDir: string | null;
}): PatternRoute[] {
  const { db, auth, filesDir } = options;
  const json = (body: unknown): Reply => ({ status: 200, body });

  /** Nœud appelant, actif, et de la même zone que ce nœud : sinon rien ne sort */
  const caller = (req: IncomingMessage) => {
    const node = auth.verifyRequest(req, '', 'active');
    if (node.zone !== auth.zone()) throw new HttpError(403, 'zone_mismatch', 'Ce nœud n’est pas de la même zone');
    return node;
  };

  return [
    route('GET', '/api/v1/cluster/changes', async req => {
      caller(req);
      const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
      const since = Math.max(0, Number(params.get('since') ?? 0) || 0);
      const limit = Math.min(PAGE, Math.max(1, Number(params.get('limit') ?? PAGE) || PAGE));
      const zone = auth.zone();
      const all = db.prepare(`
        SELECT kind, key, MAX(seq) AS seq FROM cluster_log WHERE seq > ?
        GROUP BY kind, key ORDER BY seq LIMIT ?`).all(since, limit) as Array<{ kind: string; key: string; seq: number }>;
      // Les comptes d'une autre zone ne quittent pas celle-ci, même vers un nœud de la grappe
      const items = all.filter(item => {
        if (item.kind === 'account') return accountZone(db, item.key, zone) === zone;
        if (item.kind === 'shared') {
          const owner = db.prepare('SELECT owner_id FROM shared_vaults WHERE id = ?').get(item.key) as { owner_id: string } | undefined;
          return !owner || accountZone(db, owner.owner_id, zone) === zone;
        }
        return true;
      });
      const head = (db.prepare('SELECT COALESCE(MAX(seq), 0) AS head FROM cluster_log').get() as { head: number }).head;
      // La position avance jusqu'au dernier élément examiné, filtré ou non
      const reached = all.length ? all[all.length - 1].seq : since;
      return json({ node: auth.selfId, head, reached, full: all.length === limit, items });
    }),

    route('GET', '/api/v1/cluster/accounts/:id', async (req, params) => {
      caller(req);
      if (accountZone(db, params.id, auth.zone()) !== auth.zone()) throw new HttpError(404, 'not_found', 'Compte inconnu');
      const bundle = accountBundle(db, params.id);
      if (!bundle) throw new HttpError(404, 'not_found', 'Compte inconnu');
      return json(bundle);
    }),

    route('GET', '/api/v1/cluster/shared/:id', async (req, params) => {
      caller(req);
      const bundle = sharedBundle(db, params.id);
      if (!bundle || accountZone(db, String(bundle.vault.owner_id), auth.zone()) !== auth.zone()) throw new HttpError(404, 'not_found', 'Coffre inconnu');
      return json(bundle);
    }),

    // Fichier chiffré, par tranches : un gros fichier ne bloque ni la mémoire ni une requête trop longue
    route('GET', '/api/v1/cluster/files/:id', async (req, params) => {
      caller(req);
      if (!filesDir || !/^[A-Za-z0-9_-]{1,64}$/.test(params.id)) throw new HttpError(404, 'not_found', 'Fichier inconnu');
      const row = db.prepare('SELECT owner_id FROM attachments WHERE id = ?').get(params.id) as { owner_id: string } | undefined;
      if (!row || accountZone(db, row.owner_id, auth.zone()) !== auth.zone()) throw new HttpError(404, 'not_found', 'Fichier inconnu');
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

    // Adresse déjà prise ailleurs dans la zone ? L'adresse ne circule que sous forme d'empreinte
    route('GET', '/api/v1/cluster/email/:hash', async (req, params) => {
      caller(req);
      const clusterId = auth.manifest()?.clusterId ?? '';
      const rows = db.prepare('SELECT email FROM users').all() as Array<{ email: string }>;
      return json({ taken: rows.some(r => emailFingerprint(clusterId, r.email) === params.hash) });
    })
  ];
}

export const emailFingerprint = (clusterId: string, email: string) =>
  createHash('sha256').update(`bettervault/email:${clusterId}:${email.trim().toLowerCase()}`).digest('base64url');

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
  auth: ClusterAuth;
  filesDir: string | null;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}) {
  const { db, auth, filesDir } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? 30_000;
  const status = new Map<string, PeerStatus>();
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const readCursor = (peer: string): number => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(`cluster_cursor:${peer}`) as { value: string } | undefined;
    return Number(row?.value ?? 0) || 0;
  };
  const writeCursor = (peer: string, value: number) =>
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(`cluster_cursor:${peer}`, String(value));

  const stateOf = (peer: ClusterPeer): PeerStatus => {
    let state = status.get(peer.id);
    if (!state) {
      state = { id: peer.id, url: peer.url, cursor: readCursor(peer.id), head: null, lastOkAt: null, lastError: null, lastErrorAt: null, conflicts: 0 };
      status.set(peer.id, state);
    }
    state.url = peer.url;
    return state;
  };

  const get = async (peer: ClusterPeer, path: string, allowNotFound = false): Promise<Response | null> => {
    const response = await fetchImpl(peer.url + path, { headers: auth.signedHeaders('GET', path), signal: AbortSignal.timeout(20_000) });
    if (allowNotFound && response.status === 404) return null;
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
        const response = (await get(peer, `/api/v1/cluster/files/${id}?offset=${offset}`))!;
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
    const response = await get(peer, `/api/v1/cluster/accounts/${encodeURIComponent(id)}`, true);
    if (!response) return; // supprimé entre-temps, ou hors de la zone : la pierre tombale suivra
    const outcome = applyAccountBundle(db, await response.json() as AccountBundle, filesDir, now());
    if (outcome.conflict) {
      stateOf(peer).conflicts += 1;
      auth.event('warn', outcome.conflict, peer.id);
    }
    for (const file of outcome.missingFiles) await pullFile(peer, file);
  };

  const pullShared = async (peer: ClusterPeer, id: string): Promise<void> => {
    const response = await get(peer, `/api/v1/cluster/shared/${encodeURIComponent(id)}`, true);
    if (!response) return;
    const bundle = await response.json() as SharedBundle;
    let outcome = applySharedBundle(db, bundle, filesDir, now());
    if (outcome.needsAccounts?.length) {
      for (const account of outcome.needsAccounts) await pullAccount(peer, account);
      outcome = applySharedBundle(db, bundle, filesDir, now());
    }
    for (const file of outcome.missingFiles) await pullFile(peer, file);
  };

  const syncPeer = async (peer: ClusterPeer) => {
    const state = stateOf(peer);
    try {
      for (let pages = 0; pages < 1000; pages++) {
        const response = (await get(peer, `/api/v1/cluster/changes?since=${state.cursor}&limit=${PAGE}`))!;
        const page = await response.json() as { node: string; head: number; reached: number; full: boolean; items: Array<{ kind: string; key: string; seq: number }> };
        // Le nœud répond sous l'identité qu'on lui connaît, sinon on parle à quelqu'un d'autre
        if (page.node !== peer.id) throw new Error('le nœud répond sous une autre identité');
        state.head = page.head;

        // Les comptes d'abord : un coffre partagé cite ses membres
        const ordered = [...page.items].sort((a, b) => (a.kind === 'account' ? 0 : 1) - (b.kind === 'account' ? 0 : 1));
        for (const item of ordered) {
          if (item.kind === 'account') await pullAccount(peer, item.key);
          else if (item.kind === 'shared') await pullShared(peer, item.key);
          else if (item.kind === 'tombstone') {
            for (const file of applyTombstone(db, item.key)) if (filesDir) rmSync(join(filesDir, file), { force: true });
          }
        }
        // La position n'avance qu'une fois la page entièrement appliquée : une panne en
        // cours de route fait rejouer la page, et l'application est idempotente
        state.cursor = Math.max(state.cursor, page.reached);
        writeCursor(peer.id, state.cursor);
        if (!page.full) break;
      }
      if (state.lastError) auth.event('info', 'Réplication rétablie', peer.id);
      state.lastOkAt = now();
      state.lastError = null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== state.lastError) auth.event('error', `Réplication : ${message}`, peer.id);
      state.lastError = message;
      state.lastErrorAt = now();
    }
  };

  const syncNow = (): Promise<void> => {
    if (running) return running;
    running = (async () => {
      // Un nœud revenu d'absence se remet d'abord à jour de la liste des nœuds autorisés
      await auth.refreshManifest();
      for (const peer of auth.peers()) await syncPeer(peer);
      // Le journal ne garde que la dernière entrée de chaque compte ou coffre
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'cluster_log'").get()) {
        db.exec('DELETE FROM cluster_log WHERE seq NOT IN (SELECT MAX(seq) FROM cluster_log GROUP BY kind, key)');
      }
    })().finally(() => { running = null; });
    return running;
  };

  return {
    syncNow,
    start() {
      if (timer) return;
      timer = setInterval(() => void syncNow(), intervalMs);
      timer.unref?.();
      void syncNow();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    /** État de réplication de chaque nœud actif de la zone, y compris ceux jamais joints */
    status: () => auth.peers().map(peer => ({ ...stateOf(peer) })),
    /** Une adresse est-elle déjà prise sur un autre nœud de la zone ? Un nœud injoignable ne bloque pas */
    async emailTaken(email: string): Promise<boolean> {
      const clusterId = auth.manifest()?.clusterId;
      if (!clusterId) return false;
      const hash = emailFingerprint(clusterId, email);
      const answers = await Promise.all(auth.peers().map(async peer => {
        try {
          const response = await get(peer, `/api/v1/cluster/email/${hash}`);
          return !!response && (await response.json() as { taken: boolean }).taken;
        } catch {
          return false;
        }
      }));
      return answers.some(Boolean);
    }
  };
}

export type ClusterSync = ReturnType<typeof createClusterSync>;
