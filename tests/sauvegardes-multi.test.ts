import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openDatabase } from '../server/src/db.ts';
import { createBackupService, type BackupDestination, type BackupSettings } from '../server/src/backup.ts';
import { installClusterSchema } from '../server/src/cluster.ts';
import type { S3Like, S3Object, S3Config } from '../server/src/s3.ts';

/**
 * Sauvegardes vers plusieurs destinations, restauration contrôlée. Une destination
 * en panne ne bloque pas les autres ; une restauration peut être défaite, et ne se
 * fait pas écraser par la grappe.
 */

const KEY = 'phrase de chiffrement des sauvegardes';

class MemoryS3 implements S3Like {
  objects = new Map<string, { body: Buffer; lastModified: number }>();
  down = false;
  constructor(public clock: () => number) {}
  private check() { if (this.down) throw new Error('Stockage S3 injoignable'); }
  async put(key: string, body: Buffer) { this.check(); this.objects.set(key, { body, lastModified: this.clock() }); }
  async get(key: string) { this.check(); const o = this.objects.get(key); if (!o) throw new Error('absent'); return o.body; }
  async delete(key: string) { this.check(); this.objects.delete(key); }
  async list(prefix: string): Promise<S3Object[]> {
    this.check();
    return [...this.objects].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.body.length, lastModified: o.lastModified }));
  }
}

const s3Config = (bucket: string): S3Config => ({ endpoint: 'https://s3.exemple.fr', region: 'eu', bucket, accessKeyId: 'a', secretAccessKey: 's', prefix: 'bv', pathStyle: true });
const dest = (id: string, name: string): BackupDestination => ({ id, name, region: 'r', s3: s3Config(name), status: 'active', addedAt: 1 });

function setup(opts: { encryptionKey?: string | null } = {}) {
  let now = Date.now();
  const clock = () => now;
  const db = openDatabase(':memory:');
  const filesDir = mkdtempSync(join(tmpdir(), 'bv-multi-'));
  const stores = new Map<string, MemoryS3>([['EU', new MemoryS3(clock)], ['US', new MemoryS3(clock)], ['CH', new MemoryS3(clock)]]);
  const settings: BackupSettings = {
    enabled: true, intervalHours: 24, retentionDays: 30, s3: null,
    destinations: [dest('dst-eu', 'EU'), dest('dst-us', 'US'), dest('dst-ch', 'CH')]
  };
  const service = createBackupService({
    db, filesDir, settings: () => settings,
    encryptionKey: opts.encryptionKey === undefined ? KEY : opts.encryptionKey,
    clientFactory: config => stores.get(config.bucket)!,
    now: clock,
    nodeId: () => (db.prepare("SELECT value FROM settings WHERE key = 'cluster_node'").get() as { value: string } | undefined)?.value ?? null
  });
  const addUser = (id: string, email: string, blob: string, updatedAt: number) => {
    db.prepare("INSERT INTO users (id, email, auth_verifier, auth_salt, kdf, salt, wrapped_key, created_at) VALUES (?, ?, 'v', 's', '{}', 's', '{}', 1)").run(id, email);
    db.prepare('INSERT INTO vaults (user_id, revision, blob, updated_at) VALUES (?, 1, ?, ?)').run(id, blob, updatedAt);
  };
  return {
    db, filesDir, stores, settings, service, addUser,
    advance: (ms: number) => { now += ms; },
    cleanup: () => { service.stop(); rmSync(filesDir, { recursive: true, force: true }); }
  };
}

describe('Destinations multiples', () => {
  it('envoie à chaque destination, et une panne n’arrête pas les autres', async () => {
    const t = setup();
    try {
      t.stores.get('US')!.down = true;
      const runs = await t.service.runNow();
      expect(runs.map(r => [r.destinationId, r.status])).toEqual([['dst-eu', 'success'], ['dst-us', 'error'], ['dst-ch', 'success']]);
      const us = t.service.destinations().find(d => d.id === 'dst-us')!;
      expect(us.state.lastError).toMatch(/injoignable/);

      // Revenue, la destination reprend sans rien d'autre à faire
      t.stores.get('US')!.down = false;
      const [retry] = await t.service.runNow('manual', 'dst-us');
      expect(retry.status).toBe('success');
      expect(t.service.destinations().find(d => d.id === 'dst-us')!.state.lastError).toBeNull();
    } finally {
      t.cleanup();
    }
  });

  it('envoie les fichiers avant la base : une copie présente est toujours complète', async () => {
    const t = setup();
    try {
      writeFileSync(join(t.filesDir, 'fichier-a'), randomBytes(10));
      const order: string[] = [];
      const eu = t.stores.get('EU')!;
      const put = eu.put.bind(eu);
      eu.put = async (key, body) => { order.push(key); return put(key, body); };
      await t.service.runNow('manual', 'dst-eu');
      expect(order.findIndex(k => k.includes('/files/'))).toBeLessThan(order.findIndex(k => k.includes('/db/')));
    } finally {
      t.cleanup();
    }
  });

  it('ne laisse rien partir sans chiffrement', async () => {
    const t = setup({ encryptionKey: null });
    try {
      await expect(t.service.runNow()).rejects.toThrow(/BACKUP_ENCRYPTION_KEY/);
      expect([...t.stores.values()].every(s => s.objects.size === 0)).toBe(true);
    } finally {
      t.cleanup();
    }
  });

  it('ignore une destination désactivée ou révoquée', async () => {
    const t = setup();
    try {
      t.settings.destinations![1] = { ...t.settings.destinations![1], status: 'disabled' };
      t.settings.destinations![2] = { ...t.settings.destinations![2], status: 'revoked' };
      const runs = await t.service.runNow();
      expect(runs.map(r => r.destinationId)).toEqual(['dst-eu']);
    } finally {
      t.cleanup();
    }
  });
});

describe('Restauration', () => {
  it('prévient des données plus récentes et des comptes créés depuis', async () => {
    const t = setup();
    try {
      t.addUser('u1', 'alice@exemple.fr', '{"v":"ancien"}', 100);
      await t.service.runNow('manual', 'dst-eu');
      t.db.prepare("UPDATE vaults SET blob = '{\"v\":\"recent\"}', updated_at = 200 WHERE user_id = 'u1'").run();
      t.addUser('u2', 'bob@exemple.fr', '{}', 300);

      const [point] = await t.service.restorePoints('dst-eu');
      const preview = await t.service.preview('dst-eu', point.key);
      expect(preview).toMatchObject({ accounts: 1, newerNow: 1, createdSince: 1 });
    } finally {
      t.cleanup();
    }
  });

  it('restaure le coffre d’un compte et garde de quoi revenir en arrière', async () => {
    const t = setup();
    try {
      t.addUser('u1', 'alice@exemple.fr', '{"v":"bon"}', 100);
      await t.service.runNow('manual', 'dst-eu');
      t.db.prepare("UPDATE vaults SET blob = '{\"v\":\"corrompu\"}', revision = 5 WHERE user_id = 'u1'").run();

      const [point] = await t.service.restorePoints('dst-eu');
      const { token } = await t.service.preview('dst-eu', point.key);
      await t.service.restoreAccount(token, 'alice@exemple.fr');

      const vault = t.db.prepare("SELECT revision, blob FROM vaults WHERE user_id = 'u1'").get() as { revision: number; blob: string };
      expect(vault.blob).toBe('{"v":"bon"}');
      // Révision au-dessus de l'actuelle : les appareils voient qu'ils doivent relire
      expect(vault.revision).toBe(6);
      expect((t.db.prepare("SELECT blob FROM restore_safety WHERE user_id = 'u1'").get() as { blob: string }).blob).toBe('{"v":"corrompu"}');
    } finally {
      t.cleanup();
    }
  });

  it('restaure le serveur, garde les comptes créés depuis, et fait d’abord une copie de sécurité', async () => {
    const t = setup();
    try {
      t.addUser('u1', 'alice@exemple.fr', '{"v":"bon"}', 100);
      writeFileSync(join(t.filesDir, 'fichier-1'), randomBytes(10));
      t.db.prepare("INSERT INTO attachments (id, owner_id, size, created_at) VALUES ('fichier-1', 'u1', 10, 1)").run();
      await t.service.runNow('manual', 'dst-eu');

      // Ensuite : corruption, fichier perdu, et un nouveau compte
      t.db.prepare("UPDATE vaults SET blob = '{\"v\":\"corrompu\"}' WHERE user_id = 'u1'").run();
      rmSync(join(t.filesDir, 'fichier-1'));
      t.addUser('u2', 'bob@exemple.fr', '{"v":"bob"}', 300);
      t.advance(60_000);

      const [point] = await t.service.restorePoints('dst-eu');
      const { token } = await t.service.preview('dst-eu', point.key);
      const result = await t.service.restoreServer(token);

      expect(result).toMatchObject({ accounts: 1, files: 1 });
      expect(result.safetyKey).toMatch(/avant-restauration/);
      expect((t.db.prepare("SELECT blob FROM vaults WHERE user_id = 'u1'").get() as { blob: string }).blob).toBe('{"v":"bon"}');
      expect(existsSync(join(t.filesDir, 'fichier-1'))).toBe(true);
      // Bob n'existait pas dans la sauvegarde : il est gardé
      expect((t.db.prepare("SELECT blob FROM vaults WHERE user_id = 'u2'").get() as { blob: string }).blob).toBe('{"v":"bob"}');
    } finally {
      t.cleanup();
    }
  });

  it('refuse de restaurer si aucune copie de sécurité n’a pu être faite', async () => {
    const t = setup();
    try {
      t.addUser('u1', 'alice@exemple.fr', '{"v":"bon"}', 100);
      await t.service.runNow('manual', 'dst-eu');
      const [point] = await t.service.restorePoints('dst-eu');
      const { token } = await t.service.preview('dst-eu', point.key);
      t.db.prepare("UPDATE vaults SET blob = '{\"v\":\"actuel\"}' WHERE user_id = 'u1'").run();
      for (const store of t.stores.values()) store.down = true;
      await expect(t.service.restoreServer(token)).rejects.toThrow(/Copie de sécurité impossible/);
      expect((t.db.prepare("SELECT blob FROM vaults WHERE user_id = 'u1'").get() as { blob: string }).blob).toBe('{"v":"actuel"}');
    } finally {
      t.cleanup();
    }
  });

  it('dans une grappe, ne laisse pas de pierre tombale et domine les autres nœuds', async () => {
    const t = setup();
    try {
      installClusterSchema(t.db, 'n-aaaaaaaaaaaaaaaa', 'EU');
      t.addUser('u1', 'alice@exemple.fr', '{"v":"bon"}', 100);
      await t.service.runNow('manual', 'dst-eu');
      t.db.prepare("UPDATE vaults SET blob = '{\"v\":\"corrompu\"}' WHERE user_id = 'u1'").run();
      const avant = JSON.parse((t.db.prepare("SELECT vv FROM vaults WHERE user_id = 'u1'").get() as { vv: string }).vv);

      const [point] = await t.service.restorePoints('dst-eu');
      const { token } = await t.service.preview('dst-eu', point.key);
      await t.service.restoreServer(token);

      expect(t.db.prepare("SELECT 1 FROM cluster_tombstones WHERE kind = 'account' AND key = 'u1'").get()).toBeUndefined();
      expect(t.db.prepare("SELECT 1 FROM cluster_log WHERE kind = 'tombstone' AND key = 'account:u1'").get()).toBeUndefined();
      const apres = JSON.parse((t.db.prepare("SELECT vv FROM vaults WHERE user_id = 'u1'").get() as { vv: string }).vv);
      // Le vecteur après restauration domine celui d'avant : les autres nœuds adoptent la version restaurée
      expect(apres['n-aaaaaaaaaaaaaaaa']).toBeGreaterThan(avant['n-aaaaaaaaaaaaaaaa']);
    } finally {
      t.cleanup();
    }
  });

  it('expire un aperçu trop ancien', async () => {
    const t = setup();
    try {
      t.addUser('u1', 'alice@exemple.fr', '{}', 1);
      await t.service.runNow('manual', 'dst-eu');
      const [point] = await t.service.restorePoints('dst-eu');
      const { token } = await t.service.preview('dst-eu', point.key);
      t.advance(20 * 60_000);
      await expect(t.service.restoreAccount(token, 'alice@exemple.fr')).rejects.toThrow(/expiré/);
    } finally {
      t.cleanup();
    }
  });
});
