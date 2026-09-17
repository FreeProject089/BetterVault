import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { HttpError, invalid, parseBase64, parseBlob, parseEmail, parseId, readJson, type EncryptedBlob, type Reply } from './http.ts';
import { route, type PatternRoute, type RouteContext } from './context.ts';
import { emails } from './emails.ts';
import { deleteVaultAttachments } from './attachments.ts';

/**
 * Coffres partagés entre comptes.
 *
 * Chaque compte possède une paire de clés X25519 ; sa clé privée est chiffrée par la clé de son coffre personnel.
 * Un coffre partagé est chiffré par sa propre clé aléatoire, remise à chaque membre chiffrée pour sa clé publique.
 * Le serveur applique les permissions d'écriture et de gestion ; il ne peut lire ni le coffre ni les clés.
 */

export const PERMISSIONS = ['write', 'attachments', 'export', 'manage_members', 'manage_roles', 'delete_vault'] as const;
export type Permission = typeof PERMISSIONS[number];

export const BUILTIN_ROLES: Array<{ key: 'owner' | 'admin' | 'editor' | 'viewer'; name: string; permissions: Permission[] }> = [
  { key: 'owner', name: 'Propriétaire', permissions: [...PERMISSIONS] },
  { key: 'admin', name: 'Administrateur', permissions: ['write', 'attachments', 'export', 'manage_members', 'manage_roles'] },
  { key: 'editor', name: 'Éditeur', permissions: ['write', 'attachments', 'export'] },
  { key: 'viewer', name: 'Lecteur', permissions: [] }
];

interface MemberRow {
  vault_id: string;
  user_id: string;
  role_id: string;
  wrapped_key: string;
  status: 'invited' | 'active';
  invited_by: string | null;
  created_at: number;
  permissions: string;
  builtin: string | null;
}

export interface Membership {
  roleId: string;
  status: 'invited' | 'active';
  builtin: string | null;
  permissions: Set<Permission>;
}

function parsePermissions(value: unknown, allowDelete: boolean): Permission[] {
  if (!Array.isArray(value)) throw invalid('permissions');
  const unique = [...new Set(value)];
  if (!unique.every(p => (PERMISSIONS as readonly string[]).includes(p as string))) throw invalid('permissions');
  if (!allowDelete && unique.includes('delete_vault')) throw new HttpError(400, 'invalid_permissions', 'Seul le rôle Propriétaire peut supprimer le coffre');
  return unique as Permission[];
}

/**
 * Un membre ne peut pas accorder une permission qu'il ne détient pas lui-même.
 *
 * Sans cette borne, « manage_members » ou « manage_roles » suffisent à se hisser
 * au niveau d'un administrateur : il suffit de s'attribuer un rôle plus puissant,
 * ou d'ajouter des permissions à un rôle qu'on s'attribue ensuite. Le propriétaire
 * détient toutes les permissions et n'est donc jamais gêné par ce contrôle.
 */
function requireGrantable(me: Membership, permissions: readonly Permission[]): void {
  if (me.builtin === 'owner') return;
  const excess = permissions.filter(permission => !me.permissions.has(permission));
  if (excess.length) {
    throw new HttpError(403, 'forbidden', 'Vous ne pouvez pas accorder une permission que vous n’avez pas');
  }
}

/** Permissions portées par un rôle enregistré */
function rolePermissions(role: { permissions: unknown }): Permission[] {
  try {
    const parsed = JSON.parse(String(role.permissions)) as unknown;
    return Array.isArray(parsed) ? (parsed.filter(p => (PERMISSIONS as readonly string[]).includes(p as string)) as Permission[]) : [];
  } catch {
    return [];
  }
}

function parseRoleName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 40) throw invalid('name');
  return value.trim();
}

const parseWrappedKey = (value: unknown, field = 'wrappedKey') => parseBase64(value, field, { max: 512 });

export function membership(ctx: RouteContext, vaultId: string, userId: string): Membership | null {
  const row = ctx.db.prepare(`SELECT m.*, r.permissions, r.builtin FROM shared_members m JOIN shared_roles r ON r.id = m.role_id WHERE m.vault_id = ? AND m.user_id = ?`)
    .get(vaultId, userId) as MemberRow | undefined;
  if (!row) return null;
  return { roleId: row.role_id, status: row.status, builtin: row.builtin, permissions: new Set(JSON.parse(row.permissions) as Permission[]) };
}

/** Membre actif, sinon 404 : un non-membre ne doit pas apprendre qu'un coffre existe */
export function requireMember(ctx: RouteContext, vaultId: string, userId: string, permission?: Permission): Membership {
  const member = membership(ctx, vaultId, userId);
  if (!member || member.status !== 'active') throw new HttpError(404, 'shared_vault_not_found', 'Coffre partagé introuvable');
  if (permission && !member.permissions.has(permission)) throw new HttpError(403, 'forbidden', 'Votre rôle ne permet pas cette action');
  return member;
}

const vaultState = (ctx: RouteContext, vaultId: string) => {
  const row = ctx.db.prepare('SELECT revision, blob, updated_at FROM shared_vaults WHERE id = ?').get(vaultId) as { revision: number; blob: string; updated_at: number } | undefined;
  if (!row) throw new HttpError(404, 'shared_vault_not_found', 'Coffre partagé introuvable');
  return { revision: row.revision, blob: JSON.parse(row.blob) as EncryptedBlob, updatedAt: row.updated_at };
};

function transaction<T>(ctx: RouteContext, work: () => T): T {
  ctx.db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    ctx.db.exec('COMMIT');
    return result;
  } catch (err) {
    ctx.db.exec('ROLLBACK');
    throw err;
  }
}

/* ── Clés de partage du compte ─────────────────────────────────────────── */

export function accountKeyRoutes(ctx: RouteContext): Record<string, (req: IncomingMessage) => Promise<Reply>> {
  return {
    'GET /api/v1/accounts/keys': async req => {
      const user = ctx.getUser(ctx.authenticate(req).userId);
      return {
        status: 200,
        body: user.public_key
          ? { publicKey: user.public_key, wrappedPrivateKey: JSON.parse(user.wrapped_private_key!) }
          : { publicKey: null, wrappedPrivateKey: null }
      };
    },

    'PUT /api/v1/accounts/keys': async req => {
      const { userId } = ctx.authenticate(req);
      ctx.limit(req, 'keys');
      const body = await readJson(req, 4096);
      const publicKey = parseBase64(body.publicKey, 'publicKey', { exact: 32 });
      const wrappedPrivateKey = parseBlob(body.wrappedPrivateKey, 'wrappedPrivateKey', 128);
      const user = ctx.getUser(userId);
      if (user.public_key) {
        const shares = ctx.db.prepare('SELECT COUNT(*) AS count FROM shared_members WHERE user_id = ?').get(userId) as { count: number };
        if (shares.count > 0) throw new HttpError(409, 'keys_in_use', 'Quittez vos coffres partagés avant de remplacer vos clés de partage');
      }
      ctx.db.prepare('UPDATE users SET public_key = ?, wrapped_private_key = ? WHERE id = ?').run(publicKey, JSON.stringify(wrappedPrivateKey), userId);
      return { status: 204 };
    },

    'POST /api/v1/users/lookup': async req => {
      ctx.authenticate(req);
      ctx.limit(req, 'lookup');
      const email = parseEmail((await readJson(req, 4096)).email);
      const row = ctx.db.prepare('SELECT id, email, public_key FROM users WHERE email = ?').get(email) as { id: string; email: string; public_key: string | null } | undefined;
      if (!row) throw new HttpError(404, 'user_not_found', 'Aucun compte avec cet email sur ce serveur');
      if (!row.public_key) throw new HttpError(409, 'user_without_keys', 'Ce compte doit d’abord se connecter avec une version récente de BetterVault');
      return { status: 200, body: { userId: row.id, email: row.email, publicKey: row.public_key } };
    }
  };
}

/* ── Coffres partagés ──────────────────────────────────────────────────── */

export function sharingRoutes(ctx: RouteContext): PatternRoute[] {
  const maxBlob = () => ctx.settings().limits.maxVaultBytes;

  const roleInVault = (vaultId: string, roleId: string) => {
    const role = ctx.db.prepare('SELECT id, builtin, permissions FROM shared_roles WHERE id = ? AND vault_id = ?').get(roleId, vaultId) as { id: string; builtin: string | null; permissions: string } | undefined;
    if (!role) throw new HttpError(400, 'invalid_role', 'Rôle inconnu pour ce coffre');
    return role;
  };

  return [
    route('GET', '/api/v1/shared-vaults', async req => {
      const { userId } = ctx.authenticate(req);
      const rows = ctx.db.prepare(`
        SELECT v.id, v.revision, v.updated_at, m.status, m.wrapped_key, m.role_id, m.created_at AS joined_at,
               r.name AS role_name, r.permissions, r.builtin, o.email AS owner_email, i.email AS invited_by_email
        FROM shared_members m
        JOIN shared_vaults v ON v.id = m.vault_id
        JOIN shared_roles r ON r.id = m.role_id
        JOIN users o ON o.id = v.owner_id
        LEFT JOIN users i ON i.id = m.invited_by
        WHERE m.user_id = ?
        ORDER BY v.created_at`).all(userId) as Array<Record<string, unknown>>;
      return {
        status: 200,
        body: {
          vaults: rows.map(row => ({
            id: row.id,
            status: row.status,
            revision: row.revision,
            updatedAt: row.updated_at,
            wrappedKey: row.wrapped_key,
            ownerEmail: row.owner_email,
            invitedByEmail: row.invited_by_email ?? null,
            role: { id: row.role_id, name: row.role_name, builtin: row.builtin ?? null, permissions: JSON.parse(row.permissions as string) }
          }))
        }
      };
    }),

    route('POST', '/api/v1/shared-vaults', async req => {
      const { userId } = ctx.authenticate(req);
      ctx.limit(req, 'shared');
      const body = await readJson(req, ctx.maxBody());
      const blob = parseBlob(body.blob, 'blob', maxBlob());
      const wrappedKey = parseWrappedKey(body.wrappedKey);
      const user = ctx.getUser(userId);
      if (!user.public_key) throw new HttpError(409, 'keys_required', 'Clés de partage manquantes');
      const owned = ctx.db.prepare('SELECT COUNT(*) AS count FROM shared_vaults WHERE owner_id = ?').get(userId) as { count: number };
      const maxVaults = ctx.limitsFor(userId).maxVaults;
      if (owned.count >= maxVaults) throw new HttpError(403, 'limit_reached', `Limite de ${maxVaults} coffres partagés atteinte`);

      const id = randomUUID();
      const now = ctx.now();
      const roleIds = Object.fromEntries(BUILTIN_ROLES.map(role => [role.key, randomUUID()])) as Record<string, string>;
      transaction(ctx, () => {
        ctx.db.prepare('INSERT INTO shared_vaults (id, owner_id, revision, blob, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)').run(id, userId, JSON.stringify(blob), now, now);
        const insertRole = ctx.db.prepare('INSERT INTO shared_roles (id, vault_id, name, permissions, builtin, created_at) VALUES (?, ?, ?, ?, ?, ?)');
        for (const role of BUILTIN_ROLES) insertRole.run(roleIds[role.key], id, role.name, JSON.stringify(role.permissions), role.key, now);
        ctx.db.prepare('INSERT INTO shared_members (vault_id, user_id, role_id, wrapped_key, status, invited_by, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)')
          .run(id, userId, roleIds.owner, wrappedKey, 'active', now);
      });
      return { status: 201, body: { id, revision: 1, roleId: roleIds.owner } };
    }),

    route('GET', '/api/v1/shared-vaults/:id', async (req, params) => {
      const { userId } = ctx.authenticate(req);
      requireMember(ctx, params.id, userId);
      return { status: 200, body: vaultState(ctx, params.id) };
    }),

    route('PUT', '/api/v1/shared-vaults/:id', async (req, params) => {
      const { userId } = ctx.authenticate(req);
      requireMember(ctx, params.id, userId, 'write');
      const body = await readJson(req, ctx.maxBody());
      const baseRevision = body.baseRevision;
      if (!Number.isInteger(baseRevision) || (baseRevision as number) < 1) throw invalid('baseRevision');
      const blob = parseBlob(body.blob, 'blob', maxBlob());
      const updatedAt = ctx.now();
      const result = ctx.db.prepare('UPDATE shared_vaults SET revision = revision + 1, blob = ?, updated_at = ? WHERE id = ? AND revision = ?')
        .run(JSON.stringify(blob), updatedAt, params.id, baseRevision as number);
      if (Number(result.changes) === 0) throw new HttpError(409, 'conflict', 'Le coffre partagé a été modifié par un autre membre', vaultState(ctx, params.id));
      return { status: 200, body: { revision: (baseRevision as number) + 1, updatedAt } };
    }),

    route('DELETE', '/api/v1/shared-vaults/:id', async (req, params) => {
      const { userId } = ctx.authenticate(req);
      requireMember(ctx, params.id, userId, 'delete_vault');
      deleteVaultAttachments(ctx, params.id);
      ctx.db.prepare('DELETE FROM shared_vaults WHERE id = ?').run(params.id);
      return { status: 204 };
    }),

    route('GET', '/api/v1/shared-vaults/:id/members', async (req, params) => {
      const { userId } = ctx.authenticate(req);
      const me = requireMember(ctx, params.id, userId);
      const members = ctx.db.prepare(`
        SELECT m.user_id, m.role_id, m.status, m.created_at, u.email, u.public_key, i.email AS invited_by_email
        FROM shared_members m JOIN users u ON u.id = m.user_id LEFT JOIN users i ON i.id = m.invited_by
        WHERE m.vault_id = ? ORDER BY m.created_at`).all(params.id) as Array<Record<string, unknown>>;
      const roles = ctx.db.prepare('SELECT id, name, permissions, builtin FROM shared_roles WHERE vault_id = ? ORDER BY created_at').all(params.id) as Array<Record<string, unknown>>;
      return {
        status: 200,
        body: {
          permissions: [...me.permissions],
          members: members.map(m => ({
            userId: m.user_id, email: m.email, roleId: m.role_id, status: m.status, createdAt: m.created_at,
            publicKey: m.public_key, invitedByEmail: m.invited_by_email ?? null
          })),
          roles: roles.map(r => ({ id: r.id, name: r.name, builtin: r.builtin ?? null, permissions: JSON.parse(r.permissions as string) }))
        }
      };
    }),

    route('POST', '/api/v1/shared-vaults/:id/members', async (req, params) => {
      const { userId } = ctx.authenticate(req);
      ctx.limit(req, 'shared');
      const me = requireMember(ctx, params.id, userId, 'manage_members');
      const body = await readJson(req, 4096);
      const targetId = parseId(body.userId, 'userId');
      const roleId = parseId(body.roleId, 'roleId');
      const wrappedKey = parseWrappedKey(body.wrappedKey);
      const role = roleInVault(params.id, roleId);
      if (role.builtin === 'owner') throw new HttpError(400, 'invalid_role', 'Transférez la propriété depuis la liste des membres');
      requireGrantable(me, rolePermissions(role));
      const target = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(targetId) as Parameters<RouteContext['notify']>[1] | undefined;
      if (!target?.public_key) throw new HttpError(404, 'user_not_found', 'Compte introuvable');
      if (membership(ctx, params.id, targetId)) throw new HttpError(409, 'already_member', 'Cette personne fait déjà partie du coffre');
      const memberCount = ctx.db.prepare('SELECT COUNT(*) AS count FROM shared_members WHERE vault_id = ?').get(params.id) as { count: number };
      const maxMembers = ctx.settings().limits.maxMembersPerSharedVault;
      if (memberCount.count >= maxMembers) throw new HttpError(403, 'limit_reached', `${maxMembers} membres maximum par coffre partagé`);

      ctx.db.prepare('INSERT INTO shared_members (vault_id, user_id, role_id, wrapped_key, status, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(params.id, targetId, roleId, wrappedKey, 'invited', userId, ctx.now());
      const inviter = ctx.getUser(userId);
      ctx.notify(mail => emails.sharedInvite(mail, inviter.email), target);
      return { status: 201, body: { userId: targetId, status: 'invited' } };
    }),

    route('PATCH', '/api/v1/shared-vaults/:id/members/:userId', async (req, params) => {
      const { userId } = ctx.authenticate(req);
      const me = requireMember(ctx, params.id, userId, 'manage_members');
      const roleId = parseId((await readJson(req, 4096)).roleId, 'roleId');
      const role = roleInVault(params.id, roleId);
      const target = membership(ctx, params.id, params.userId);
      if (!target) throw new HttpError(404, 'member_not_found', 'Membre introuvable');

      if (role.builtin === 'owner') {
        // Transfert de propriété : seul le propriétaire actuel, vers un membre actif
        if (me.builtin !== 'owner') throw new HttpError(403, 'forbidden', 'Seul le propriétaire peut transférer la propriété');
        if (target.status !== 'active') throw new HttpError(400, 'member_not_active', 'Le membre doit d’abord accepter l’invitation');
        const adminRole = ctx.db.prepare("SELECT id FROM shared_roles WHERE vault_id = ? AND builtin = 'admin'").get(params.id) as { id: string };
        transaction(ctx, () => {
          ctx.db.prepare('UPDATE shared_members SET role_id = ? WHERE vault_id = ? AND user_id = ?').run(roleId, params.id, params.userId);
          ctx.db.prepare('UPDATE shared_members SET role_id = ? WHERE vault_id = ? AND user_id = ?').run(adminRole.id, params.id, userId);
          ctx.db.prepare('UPDATE shared_vaults SET owner_id = ? WHERE id = ?').run(params.userId, params.id);
        });
        return { status: 204 };
      }

      if (target.builtin === 'owner') throw new HttpError(403, 'forbidden', 'Le rôle du propriétaire ne peut pas être changé');
      // Changer son propre rôle est une élévation de privilèges, jamais un besoin légitime
      if (params.userId === userId) throw new HttpError(403, 'forbidden', 'Vous ne pouvez pas changer votre propre rôle');
      requireGrantable(me, rolePermissions(role));
      ctx.db.prepare('UPDATE shared_members SET role_id = ? WHERE vault_id = ? AND user_id = ?').run(roleId, params.id, params.userId);
      return { status: 204 };
    }),

    route('DELETE', '/api/v1/shared-vaults/:id/members/:userId', async (req, params) => {
      const { userId } = ctx.authenticate(req);
      const target = membership(ctx, params.id, params.userId);
      if (params.userId === userId) {
        if (!target) throw new HttpError(404, 'shared_vault_not_found', 'Coffre partagé introuvable');
        if (target.builtin === 'owner') throw new HttpError(400, 'owner_cannot_leave', 'Transférez la propriété ou supprimez le coffre avant de le quitter');
      } else {
        requireMember(ctx, params.id, userId, 'manage_members');
        if (!target) throw new HttpError(404, 'member_not_found', 'Membre introuvable');
        if (target.builtin === 'owner') throw new HttpError(403, 'forbidden', 'Le propriétaire ne peut pas être retiré');
      }
      ctx.db.prepare('DELETE FROM shared_members WHERE vault_id = ? AND user_id = ?').run(params.id, params.userId);
      return { status: 204 };
    }),

    route('POST', '/api/v1/shared-vaults/:id/accept', async (req, params) => {
      const { userId } = ctx.authenticate(req);
      const result = ctx.db.prepare("UPDATE shared_members SET status = 'active' WHERE vault_id = ? AND user_id = ? AND status = 'invited'").run(params.id, userId);
      if (Number(result.changes) === 0) throw new HttpError(404, 'invitation_not_found', 'Invitation introuvable');
      return { status: 204 };
    }),

    route('POST', '/api/v1/shared-vaults/:id/decline', async (req, params) => {
      const { userId } = ctx.authenticate(req);
      const result = ctx.db.prepare("DELETE FROM shared_members WHERE vault_id = ? AND user_id = ? AND status = 'invited'").run(params.id, userId);
      if (Number(result.changes) === 0) throw new HttpError(404, 'invitation_not_found', 'Invitation introuvable');
      return { status: 204 };
    }),

    route('POST', '/api/v1/shared-vaults/:id/roles', async (req, params) => {
      const { userId } = ctx.authenticate(req);
      const me = requireMember(ctx, params.id, userId, 'manage_roles');
      const body = await readJson(req, 4096);
      const name = parseRoleName(body.name);
      const permissions = parsePermissions(body.permissions, false);
      requireGrantable(me, permissions);
      const count = ctx.db.prepare('SELECT COUNT(*) AS count FROM shared_roles WHERE vault_id = ?').get(params.id) as { count: number };
      const maxRoles = ctx.settings().limits.maxRolesPerSharedVault;
      if (count.count >= maxRoles) throw new HttpError(403, 'limit_reached', `${maxRoles} rôles maximum par coffre`);
      const id = randomUUID();
      ctx.db.prepare('INSERT INTO shared_roles (id, vault_id, name, permissions, builtin, created_at) VALUES (?, ?, ?, ?, NULL, ?)').run(id, params.id, name, JSON.stringify(permissions), ctx.now());
      return { status: 201, body: { id, name, permissions, builtin: null } };
    }),

    route('PATCH', '/api/v1/shared-vaults/:id/roles/:roleId', async (req, params) => {
      const { userId } = ctx.authenticate(req);
      const me = requireMember(ctx, params.id, userId, 'manage_roles');
      const role = roleInVault(params.id, params.roleId);
      if (role.builtin) throw new HttpError(400, 'builtin_role', 'Les rôles prédéfinis ne sont pas modifiables');
      const body = await readJson(req, 4096);
      const name = body.name === undefined ? undefined : parseRoleName(body.name);
      const permissions = body.permissions === undefined ? undefined : parsePermissions(body.permissions, false);
      // Il faut deja detenir ce que porte le role, sinon on s'en sert comme d'un escabeau
      requireGrantable(me, rolePermissions(role));
      if (permissions !== undefined) requireGrantable(me, permissions);
      if (name !== undefined) ctx.db.prepare('UPDATE shared_roles SET name = ? WHERE id = ?').run(name, role.id);
      if (permissions !== undefined) ctx.db.prepare('UPDATE shared_roles SET permissions = ? WHERE id = ?').run(JSON.stringify(permissions), role.id);
      return { status: 204 };
    }),

    route('DELETE', '/api/v1/shared-vaults/:id/roles/:roleId', async (req, params) => {
      const { userId } = ctx.authenticate(req);
      requireMember(ctx, params.id, userId, 'manage_roles');
      const role = roleInVault(params.id, params.roleId);
      if (role.builtin) throw new HttpError(400, 'builtin_role', 'Les rôles prédéfinis ne peuvent pas être supprimés');
      const used = ctx.db.prepare('SELECT COUNT(*) AS count FROM shared_members WHERE role_id = ?').get(role.id) as { count: number };
      if (used.count > 0) throw new HttpError(409, 'role_in_use', 'Ce rôle est encore attribué à des membres');
      ctx.db.prepare('DELETE FROM shared_roles WHERE id = ?').run(role.id);
      return { status: 204 };
    }),

    /**
     * Nouvelle clé du coffre (après le retrait d'un membre) : le contenu est rechiffré et la clé remise
     * uniquement aux membres listés. Les membres absents de la liste sont retirés.
     */
    route('POST', '/api/v1/shared-vaults/:id/rotate', async (req, params) => {
      const { userId } = ctx.authenticate(req);
      // La route remplace le contenu chiffre du coffre : gerer les membres ne suffit pas
      requireMember(ctx, params.id, userId, 'manage_members');
      requireMember(ctx, params.id, userId, 'write');
      const body = await readJson(req, ctx.maxBody());
      const baseRevision = body.baseRevision;
      if (!Number.isInteger(baseRevision)) throw invalid('baseRevision');
      const blob = parseBlob(body.blob, 'blob', maxBlob());
      if (!Array.isArray(body.members) || body.members.length === 0) throw invalid('members');
      const keys = new Map<string, string>();
      for (const entry of body.members as Array<Record<string, unknown>>) keys.set(parseId(entry?.userId, 'members.userId'), parseWrappedKey(entry?.wrappedKey, 'members.wrappedKey'));

      const current = ctx.db.prepare('SELECT m.user_id, r.builtin FROM shared_members m JOIN shared_roles r ON r.id = m.role_id WHERE m.vault_id = ?').all(params.id) as Array<{ user_id: string; builtin: string | null }>;
      const owner = current.find(m => m.builtin === 'owner');
      if (!keys.has(userId) || (owner && !keys.has(owner.user_id))) throw new HttpError(400, 'invalid_members', 'La nouvelle clé doit inclure le propriétaire et vous-même');
      if ([...keys.keys()].some(id => !current.some(m => m.user_id === id))) throw new HttpError(400, 'invalid_members', 'Liste des membres obsolète, rechargez le coffre');

      const updatedAt = ctx.now();
      transaction(ctx, () => {
        const result = ctx.db.prepare('UPDATE shared_vaults SET revision = revision + 1, blob = ?, updated_at = ? WHERE id = ? AND revision = ?')
          .run(JSON.stringify(blob), updatedAt, params.id, baseRevision as number);
        if (Number(result.changes) === 0) throw new HttpError(409, 'conflict', 'Le coffre partagé a été modifié entre-temps', vaultState(ctx, params.id));
        const update = ctx.db.prepare('UPDATE shared_members SET wrapped_key = ? WHERE vault_id = ? AND user_id = ?');
        const remove = ctx.db.prepare('DELETE FROM shared_members WHERE vault_id = ? AND user_id = ?');
        for (const member of current) {
          const wrapped = keys.get(member.user_id);
          if (wrapped) update.run(wrapped, params.id, member.user_id);
          else remove.run(params.id, member.user_id);
        }
      });
      return { status: 200, body: { revision: (baseRevision as number) + 1, updatedAt } };
    })
  ];
}
