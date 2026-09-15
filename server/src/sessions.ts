import type { IncomingMessage } from 'node:http';
import { HttpError, invalid, parseBase64, parseCode, readJson, type Reply } from './http.ts';
import type { RouteContext } from './context.ts';

/**
 * Sessions du compte : appareil, IP tronquée et lieu approximatif, dernière activité.
 * Fermer une session demande le mot de passe principal (preuve dérivée) et le code 2FA s'il est activé.
 */

interface SessionRow {
  token_hash: string;
  public_id: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number | null;
  device: string | null;
  ip_prefix: string | null;
  country: string | null;
  city: string | null;
}

export function sessionRoutes(ctx: RouteContext): Record<string, (req: IncomingMessage) => Promise<Reply>> {
  return {
    'GET /api/v1/accounts/sessions': async req => {
      const { userId, tokenHash } = ctx.authenticate(req);
      const rows = ctx.db.prepare(`
        SELECT token_hash, public_id, created_at, expires_at, last_seen_at, device, ip_prefix, country, city
        FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY COALESCE(last_seen_at, created_at) DESC`).all(userId, ctx.now()) as unknown as SessionRow[];
      return {
        status: 200,
        body: {
          sessions: rows.map(row => ({
            id: row.public_id,
            current: row.token_hash === tokenHash,
            device: row.device ?? null,
            ipPrefix: row.ip_prefix ?? null,
            country: row.country ?? null,
            city: row.city ?? null,
            createdAt: row.created_at,
            lastSeenAt: row.last_seen_at ?? row.created_at,
            expiresAt: row.expires_at
          }))
        }
      };
    },

    'POST /api/v1/accounts/sessions/revoke': async req => {
      const { userId, tokenHash } = ctx.authenticate(req);
      ctx.limit(req, 'password');
      const body = await readJson(req, 4096);
      const authHash = parseBase64(body.authHash, 'authHash', { exact: 32 });
      const totp = parseCode(body.totp, 'totp');
      const all = body.all === true;
      const sessionId = typeof body.sessionId === 'string' && /^[a-f0-9]{16}$/.test(body.sessionId) ? body.sessionId : null;
      if (!all && !sessionId) throw invalid('sessionId');

      const user = ctx.getUser(userId);
      if (!(await ctx.verifyAuthHash(user, authHash))) throw new HttpError(403, 'invalid_credentials', 'Mot de passe principal incorrect');
      if (user.totp_enabled) {
        if (!totp) throw new HttpError(401, 'totp_required', 'Code de l’application d’authentification requis');
        if (!ctx.consumeTotp(user, totp)) throw new HttpError(401, 'totp_invalid', 'Code incorrect ou déjà utilisé');
      }

      const result = all
        ? ctx.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(userId, tokenHash)
        : ctx.db.prepare('DELETE FROM sessions WHERE user_id = ? AND public_id = ?').run(userId, sessionId);
      ctx.audit(all ? 'sessions.revoked_all' : 'session.revoked', { count: Number(result.changes) }, userId);
      return { status: 200, body: { revoked: Number(result.changes) } };
    }
  };
}
