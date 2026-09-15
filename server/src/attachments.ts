import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

export function deleteUserAttachments(ctx: RouteContext, userId: string): void {
  const rows = ctx.db.prepare(`
    SELECT id FROM attachments WHERE (vault_id IS NULL AND owner_id = ?) OR vault_id IN (SELECT id FROM shared_vaults WHERE owner_id = ?)`).all(userId, userId) as Array<{ id: string }>;
  removeFiles(ctx, rows.map(r => r.id));
}

export function deleteVaultAttachments(ctx: RouteContext, vaultId: string): void {
  const rows = ctx.db.prepare('SELECT id FROM attachments WHERE vault_id = ?').all(vaultId) as Array<{ id: string }>;
  removeFiles(ctx, rows.map(r => r.id));
  ctx.db.prepare('DELETE FROM attachments WHERE vault_id = ?').run(vaultId);
}

export function attachmentRoutes(ctx: RouteContext): PatternRoute[] {
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
      return { status: 200, body: { enabled: !!ctx.filesDir, usedBytes: usedBytes(ctx, userId), quotaBytes: limits.attachmentQuotaBytes, maxFileBytes: limits.maxAttachmentBytes } };
    }),

    route('POST', '/api/v1/attachments', async req => {
      const { userId } = ctx.authenticate(req);
      ctx.limit(req, 'attachments');
      requireFiles(ctx);
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
      if (usedBytes(ctx, quotaOwner) + data.length > ownerLimits.attachmentQuotaBytes) {
        throw new HttpError(413, 'quota_exceeded', `Espace de stockage plein (${Math.round(ownerLimits.attachmentQuotaBytes / 1048576)} Mo)`);
      }

      const id = randomUUID();
      writeFileSync(filePath(ctx, id), data, { mode: 0o600 });
      ctx.db.prepare('INSERT INTO attachments (id, owner_id, vault_id, size, created_at) VALUES (?, ?, ?, ?, ?)').run(id, userId, vaultId, data.length, ctx.now());
      return { status: 201, body: { id, size: data.length } };
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
