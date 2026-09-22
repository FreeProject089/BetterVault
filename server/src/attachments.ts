import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError, parseId, readRaw } from './http.ts';
import { route, type PatternRoute, type RouteContext } from './context.ts';
import { requireMember } from './sharing.ts';

/**
 * Pièces jointes : fichiers déjà chiffrés par l'application (la clé de chaque fichier est rangée dans le coffre).
 * Le serveur ne stocke que des octets illisibles et applique la taille maximale et le quota.
 */

interface AttachmentRow {
  id: string;
  owner_id: string;
  vault_id: string | null;
  size: number;
  created_at: number;
}

const filePath = (ctx: RouteContext, id: string) => join(ctx.filesDir!, id);

function requireFiles(ctx: RouteContext): void {
  if (!ctx.filesDir) throw new HttpError(503, 'attachments_disabled', 'Les pièces jointes ne sont pas activées sur ce serveur');
}

/*
 * L'hébergeur peut refuser les nouveaux fichiers sans rendre illisibles ceux déjà
 * déposés : seul l'envoi est bloqué, la lecture et la suppression restent possibles.
 */
function requireUploads(ctx: RouteContext): void {
  requireFiles(ctx);
  if (ctx.settings().attachmentsEnabled === false) {
    throw new HttpError(403, 'attachments_disabled', 'Ce serveur n’accepte pas de nouveaux fichiers');
  }
}

/** Espace utilisé par un compte : ses fichiers personnels et ceux des coffres partagés qu'il possède */
export function usedBytes(ctx: RouteContext, ownerId: string): number {
  const row = ctx.db.prepare(`
    SELECT COALESCE(SUM(size), 0) AS used FROM attachments
    WHERE (vault_id IS NULL AND owner_id = ?) OR vault_id IN (SELECT id FROM shared_vaults WHERE owner_id = ?)`).get(ownerId, ownerId) as { used: number };
  return row.used;
}

function removeFiles(ctx: RouteContext, ids: string[]): void {
  const now = ctx.now();
  const logDeletion = ctx.db.prepare('INSERT OR REPLACE INTO deleted_files (id, deleted_at) VALUES (?, ?)');
  for (const id of ids) {
    if (ctx.filesDir) rmSync(filePath(ctx, id), { force: true });
    // Les sauvegardes gardent une copie jusqu'à la fin de leur durée de conservation, puis la purgent
    logDeletion.run(id, now);
  }
}

/*
 * Effacement des fichiers d'un compte supprimé.
 *
 * On prend TOUT ce dont l'utilisateur est propriétaire, y compris ce qu'il a déposé
 * dans un coffre partagé appartenant à quelqu'un d'autre. La ligne en base disparaît
 * de toute façon (owner_id ... ON DELETE CASCADE) : sans cela le fichier resterait
 * sur le disque, sans ligne pour le retrouver ni pour le purger des sauvegardes —
 * des données conservées après une demande de suppression.
 */
export function deleteUserAttachments(ctx: RouteContext, userId: string): void {
  const rows = ctx.db.prepare(`
    SELECT id FROM attachments WHERE owner_id = ? OR vault_id IN (SELECT id FROM shared_vaults WHERE owner_id = ?)`).all(userId, userId) as Array<{ id: string }>;
  removeFiles(ctx, rows.map(r => r.id));
  ctx.db.prepare('DELETE FROM attachments WHERE owner_id = ? OR vault_id IN (SELECT id FROM shared_vaults WHERE owner_id = ?)').run(userId, userId);
}

export function deleteVaultAttachments(ctx: RouteContext, vaultId: string): void {
  const rows = ctx.db.prepare('SELECT id FROM attachments WHERE vault_id = ?').all(vaultId) as Array<{ id: string }>;
  removeFiles(ctx, rows.map(r => r.id));
  ctx.db.prepare('DELETE FROM attachments WHERE vault_id = ?').run(vaultId);
}

/** Taille d'un morceau d'envoi : assez petit pour qu'une coupure coûte peu */
export const CHUNK_BYTES = 4 * 1024 * 1024;
/** Un envoi abandonné est effacé au bout d'un jour, place réservée comprise */
const UPLOAD_TTL_MS = 24 * 3_600_000;

interface UploadRow {
  id: string;
  owner_id: string;
  quota_owner: string;
  vault_id: string | null;
  size: number;
  received: number;
  created_at: number;
}

function installUploadSchema(ctx: RouteContext): void {
  ctx.db.exec(`
    CREATE TABLE IF NOT EXISTS attachment_uploads (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      quota_owner TEXT NOT NULL,
      vault_id TEXT,
      size INTEGER NOT NULL,
      received INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
}

const partPath = (ctx: RouteContext, id: string) => join(ctx.filesDir!, `.part-${id}`);

export function attachmentRoutes(ctx: RouteContext): PatternRoute[] {
  installUploadSchema(ctx);

  /** Place déjà promise aux envois en cours : deux envois parallèles ne dépassent pas le quota */
  const reservedBytes = (quotaOwner: string) =>
    Number((ctx.db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM attachment_uploads WHERE quota_owner = ?').get(quotaOwner) as { n: number }).n);

  const purgeStaleUploads = () => {
    const stale = ctx.db.prepare('SELECT id FROM attachment_uploads WHERE created_at < ?').all(ctx.now() - UPLOAD_TTL_MS) as Array<{ id: string }>;
    for (const { id } of stale) {
      rmSync(partPath(ctx, id), { force: true });
      ctx.db.prepare('DELETE FROM attachment_uploads WHERE id = ?').run(id);
    }
  };

  const ownUpload = (userId: string, id: string): UploadRow => {
    const row = ctx.db.prepare('SELECT * FROM attachment_uploads WHERE id = ? AND owner_id = ?').get(parseId(id, 'id'), userId) as UploadRow | undefined;
    if (!row) throw new HttpError(404, 'upload_not_found', 'Envoi introuvable ou expiré : recommencez');
    // Arrêt brutal entre l'enregistrement et l'écriture : le disque fait foi, on reprend de là
    const onDisk = existsSync(partPath(ctx, row.id)) ? statSync(partPath(ctx, row.id)).size : 0;
    if (onDisk < row.received) {
      ctx.db.prepare('UPDATE attachment_uploads SET received = ? WHERE id = ?').run(onDisk, row.id);
      row.received = onDisk;
    }
    return row;
  };

  /** Coffre partagé visé : droit d'y déposer des fichiers, et quota de son propriétaire */
  const target = (userId: string, vaultParam: string | null) => {
    let quotaOwner = userId;
    let vaultId: string | null = null;
    if (vaultParam) {
      vaultId = parseId(vaultParam, 'vault');
      requireMember(ctx, vaultId, userId, 'attachments');
      quotaOwner = (ctx.db.prepare('SELECT owner_id FROM shared_vaults WHERE id = ?').get(vaultId) as { owner_id: string }).owner_id;
    }
    return { quotaOwner, vaultId };
  };

  const access = (userId: string, id: string, permission?: 'attachments'): AttachmentRow => {
    const row = ctx.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as AttachmentRow | undefined;
    if (!row) throw new HttpError(404, 'attachment_not_found', 'Pièce jointe introuvable');
    if (row.vault_id) {
      try {
        requireMember(ctx, row.vault_id, userId, permission);
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) throw new HttpError(404, 'attachment_not_found', 'Pièce jointe introuvable');
        throw err;
      }
    } else if (row.owner_id !== userId) {
      throw new HttpError(404, 'attachment_not_found', 'Pièce jointe introuvable');
    }
    return row;
  };

  return [
    route('GET', '/api/v1/attachments/usage', async req => {
      const { userId } = ctx.authenticate(req);
      const limits = ctx.limitsFor(userId);
      return { status: 200, body: { enabled: !!ctx.filesDir && ctx.settings().attachmentsEnabled !== false, usedBytes: usedBytes(ctx, userId), quotaBytes: limits.attachmentQuotaBytes, maxFileBytes: limits.maxAttachmentBytes } };
    }),

    route('POST', '/api/v1/attachments', async req => {
      const { userId } = ctx.authenticate(req);
      ctx.limit(req, 'attachments');
      requireUploads(ctx);
      const vaultParam = new URL(req.url ?? '/', 'http://localhost').searchParams.get('vault');
      let quotaOwner = userId;
      let vaultId: string | null = null;
      if (vaultParam) {
        vaultId = parseId(vaultParam, 'vault');
        requireMember(ctx, vaultId, userId, 'attachments');
        quotaOwner = (ctx.db.prepare('SELECT owner_id FROM shared_vaults WHERE id = ?').get(vaultId) as { owner_id: string }).owner_id;
      }

      const ownerLimits = ctx.limitsFor(quotaOwner);
      const data = await readRaw(req, ctx.limitsFor(userId).maxAttachmentBytes + 64);
      if (data.length === 0) throw new HttpError(400, 'empty_file', 'Fichier vide');
      if (usedBytes(ctx, quotaOwner) + reservedBytes(quotaOwner) + data.length > ownerLimits.attachmentQuotaBytes) {
        throw new HttpError(413, 'quota_exceeded', `Espace de stockage plein (${Math.round(ownerLimits.attachmentQuotaBytes / 1048576)} Mo)`);
      }

      const id = randomUUID();
      writeFileSync(filePath(ctx, id), data, { mode: 0o600 });
      ctx.db.prepare('INSERT INTO attachments (id, owner_id, vault_id, size, created_at) VALUES (?, ?, ?, ?, ?)').run(id, userId, vaultId, data.length, ctx.now());
      return { status: 201, body: { id, size: data.length } };
    }),

    /* ── Envoi par morceaux, avec reprise ── */

    route('POST', '/api/v1/attachments/uploads', async req => {
      const { userId } = ctx.authenticate(req);
      ctx.limit(req, 'attachments');
      requireUploads(ctx);
      purgeStaleUploads();
      const body = JSON.parse((await readRaw(req, 1024)).toString('utf8') || '{}') as { size?: unknown; vault?: unknown };
      const size = Number(body.size);
      const max = ctx.limitsFor(userId).maxAttachmentBytes;
      if (!Number.isInteger(size) || size <= 0) throw new HttpError(400, 'invalid_size', 'Taille de fichier invalide');
      if (size > max + 64) throw new HttpError(413, 'file_too_large', `Fichier trop volumineux (${Math.round(max / 1048576)} Mo au plus)`);
      const { quotaOwner, vaultId } = target(userId, typeof body.vault === 'string' ? body.vault : null);
      const quota = ctx.limitsFor(quotaOwner).attachmentQuotaBytes;
      if (usedBytes(ctx, quotaOwner) + reservedBytes(quotaOwner) + size > quota) {
        throw new HttpError(413, 'quota_exceeded', `Espace de stockage plein (${Math.round(quota / 1048576)} Mo)`);
      }
      const id = randomUUID();
      writeFileSync(partPath(ctx, id), new Uint8Array(0), { mode: 0o600 });
      ctx.db.prepare('INSERT INTO attachment_uploads (id, owner_id, quota_owner, vault_id, size, received, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
        .run(id, userId, quotaOwner, vaultId, size, ctx.now());
      return { status: 201, body: { uploadId: id, chunkBytes: CHUNK_BYTES, received: 0 } };
    }),

    // Où en est l'envoi : c'est d'ici que l'application reprend après une coupure
    route('GET', '/api/v1/attachments/uploads/:id', async (req, params) => {
      const { userId } = ctx.authenticate(req);
      const row = ownUpload(userId, params.id);
      return { status: 200, body: { uploadId: row.id, size: row.size, received: row.received, chunkBytes: CHUNK_BYTES } };
    }),

    route('PUT', '/api/v1/attachments/uploads/:id', async (req, params) => {
      const { userId } = ctx.authenticate(req);
      requireUploads(ctx);
      const row = ownUpload(userId, params.id);
      const offset = Number(new URL(req.url ?? '/', 'http://localhost').searchParams.get('offset'));
      // Un morceau rejoué ou arrivé dans le désordre est refusé : l'application relit « received » et reprend
      if (offset !== row.received) throw new HttpError(409, 'offset_mismatch', 'Morceau inattendu : reprise nécessaire', { received: row.received });
      const chunk = await readRaw(req, CHUNK_BYTES);
      if (chunk.length === 0) throw new HttpError(400, 'empty_chunk', 'Morceau vide');
      if (row.received + chunk.length > row.size) throw new HttpError(400, 'too_much_data', 'Plus de données qu’annoncé');
      const updated = ctx.db.prepare('UPDATE attachment_uploads SET received = ? WHERE id = ? AND received = ?').run(row.received + chunk.length, row.id, row.received);
      if (Number(updated.changes) !== 1) throw new HttpError(409, 'offset_mismatch', 'Morceau inattendu : reprise nécessaire');
      appendFileSync(partPath(ctx, row.id), chunk);
      return { status: 200, body: { received: row.received + chunk.length } };
    }),

    route('POST', '/api/v1/attachments/uploads/:id/complete', async (req, params) => {
      const { userId } = ctx.authenticate(req);
      requireUploads(ctx);
      const row = ownUpload(userId, params.id);
      const part = partPath(ctx, row.id);
      const onDisk = existsSync(part) ? statSync(part).size : -1;
      if (row.received !== row.size || onDisk !== row.size) {
        throw new HttpError(409, 'upload_incomplete', 'Envoi incomplet : reprise nécessaire', { received: row.received });
      }
      ctx.db.exec('BEGIN IMMEDIATE');
      try {
        ctx.db.prepare('DELETE FROM attachment_uploads WHERE id = ?').run(row.id);
        ctx.db.prepare('INSERT INTO attachments (id, owner_id, vault_id, size, created_at) VALUES (?, ?, ?, ?, ?)').run(row.id, userId, row.vault_id, row.size, ctx.now());
        renameSync(part, filePath(ctx, row.id));
        ctx.db.exec('COMMIT');
      } catch (err) {
        ctx.db.exec('ROLLBACK');
        throw err;
      }
      return { status: 201, body: { id: row.id, size: row.size } };
    }),

    route('DELETE', '/api/v1/attachments/uploads/:id', async (req, params) => {
      const { userId } = ctx.authenticate(req);
      const row = ownUpload(userId, params.id);
      rmSync(partPath(ctx, row.id), { force: true });
      ctx.db.prepare('DELETE FROM attachment_uploads WHERE id = ?').run(row.id);
      return { status: 204 };
    }),

    route('GET', '/api/v1/attachments/:id', async (req, params) => {
      const { userId } = ctx.authenticate(req);
      requireFiles(ctx);
      const row = access(userId, parseId(params.id, 'id'));
      const path = filePath(ctx, row.id);
      if (!existsSync(path)) throw new HttpError(410, 'attachment_missing', 'Le fichier n’est plus disponible sur le serveur');
      return { status: 200, raw: readFileSync(path), contentType: 'application/octet-stream' };
    }),

    route('DELETE', '/api/v1/attachments/:id', async (req, params) => {
      const { userId } = ctx.authenticate(req);
      requireFiles(ctx);
      const row = access(userId, parseId(params.id, 'id'), 'attachments');
      removeFiles(ctx, [row.id]);
      ctx.db.prepare('DELETE FROM attachments WHERE id = ?').run(row.id);
      return { status: 204 };
    })
  ];
}
