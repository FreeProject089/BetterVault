import type { IncomingMessage } from 'node:http';
import { HttpError, readJson, readRaw, type Reply } from './http.ts';
import type { RouteContext } from './context.ts';

/**
 * Photo de profil. Chaque serveur choisit ce qu'il autorise :
 * - l'envoi d'une image (stockée dans la base, 512 Ko par défaut) ;
 * - un lien vers une image hébergée ailleurs (https uniquement).
 * L'image n'est servie qu'au compte lui-même : elle n'est pas publique.
 */

export interface AvatarSettings {
  uploads: boolean;
  remoteUrls: boolean;
}

export const DEFAULT_AVATARS: AvatarSettings = { uploads: true, remoteUrls: true };

export function avatarsFromEnv(env: Record<string, string | undefined>): AvatarSettings {
  return { uploads: env.AVATAR_UPLOADS !== 'false', remoteUrls: env.AVATAR_URLS !== 'false' };
}

export function parseAvatarUpdate(input: unknown, current: AvatarSettings): AvatarSettings {
  const body = (input ?? {}) as Partial<Record<keyof AvatarSettings, unknown>>;
  return {
    uploads: typeof body.uploads === 'boolean' ? body.uploads : current.uploads,
    remoteUrls: typeof body.remoteUrls === 'boolean' ? body.remoteUrls : current.remoteUrls
  };
}

/** Type réel d'après les premiers octets : le Content-Type annoncé n'est pas une preuve */
export function sniffImage(data: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function parseAvatarUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 500) throw new HttpError(400, 'invalid_avatar_url', 'Adresse d’image invalide');
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new HttpError(400, 'invalid_avatar_url', 'Adresse d’image invalide');
  }
  if (url.protocol !== 'https:' || url.username || url.password) throw new HttpError(400, 'invalid_avatar_url', 'L’image doit être servie en https');
  return url.toString();
}

interface AvatarRow {
  avatar: Uint8Array | null;
  avatar_type: string | null;
  avatar_url: string | null;
  avatar_updated_at: number | null;
}

export function avatarInfo(ctx: RouteContext, userId: string): { kind: 'upload' | 'url'; url: string | null; updatedAt: number } | null {
  const row = ctx.db.prepare('SELECT avatar_type, avatar_url, avatar_updated_at FROM users WHERE id = ?').get(userId) as Omit<AvatarRow, 'avatar'> | undefined;
  if (!row?.avatar_updated_at) return null;
  if (row.avatar_url) return { kind: 'url', url: row.avatar_url, updatedAt: row.avatar_updated_at };
  if (row.avatar_type) return { kind: 'upload', url: null, updatedAt: row.avatar_updated_at };
  return null;
}

export function avatarRoutes(ctx: RouteContext): Record<string, (req: IncomingMessage) => Promise<Reply>> {
  const avatars = () => ctx.settings().avatars ?? DEFAULT_AVATARS;
  const clear = ctx.db.prepare('UPDATE users SET avatar = NULL, avatar_type = NULL, avatar_url = NULL, avatar_updated_at = NULL WHERE id = ?');

  return {
    'GET /api/v1/accounts/avatar': async req => {
      const { userId } = ctx.authenticate(req);
      const row = ctx.db.prepare('SELECT avatar, avatar_type FROM users WHERE id = ?').get(userId) as Pick<AvatarRow, 'avatar' | 'avatar_type'> | undefined;
      if (!row?.avatar || !row.avatar_type) throw new HttpError(404, 'no_avatar', 'Aucune photo de profil');
      return { status: 200, raw: Buffer.from(row.avatar), contentType: row.avatar_type };
    },

    'PUT /api/v1/accounts/avatar': async req => {
      const { userId } = ctx.authenticate(req);
      ctx.limit(req, 'avatar');
      if (!avatars().uploads) throw new HttpError(403, 'avatar_uploads_disabled', 'Ce serveur n’accepte pas l’envoi d’images');
      const max = ctx.limitsFor(userId).maxAvatarBytes;
      const data = await readRaw(req, max);
      const type = sniffImage(data);
      if (!type) throw new HttpError(415, 'invalid_image', 'Image PNG, JPEG ou WebP attendue');
      ctx.db.prepare('UPDATE users SET avatar = ?, avatar_type = ?, avatar_url = NULL, avatar_updated_at = ? WHERE id = ?').run(data, type, ctx.now(), userId);
      ctx.audit('account.avatar_updated', { kind: 'upload', bytes: data.length }, userId);
      return { status: 200, body: { avatar: avatarInfo(ctx, userId) } };
    },

    'PUT /api/v1/accounts/avatar-url': async req => {
      const { userId } = ctx.authenticate(req);
      ctx.limit(req, 'avatar');
      if (!avatars().remoteUrls) throw new HttpError(403, 'avatar_urls_disabled', 'Ce serveur n’accepte pas les liens vers une image');
      const url = parseAvatarUrl((await readJson(req, 2048)).url);
      ctx.db.prepare('UPDATE users SET avatar = NULL, avatar_type = NULL, avatar_url = ?, avatar_updated_at = ? WHERE id = ?').run(url, ctx.now(), userId);
      ctx.audit('account.avatar_updated', { kind: 'url' }, userId);
      return { status: 200, body: { avatar: avatarInfo(ctx, userId) } };
    },

    'DELETE /api/v1/accounts/avatar': async req => {
      const { userId } = ctx.authenticate(req);
      clear.run(userId);
      return { status: 204 };
    }
  };
}
