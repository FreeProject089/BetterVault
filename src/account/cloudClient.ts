import type { Argon2Params } from '../import_export/encryptedExport';
import type { EncryptedBlob } from './accountCrypto';
import type { VaultLimits } from './limits';

export class CloudError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = 'CloudError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface CloudVault {
  revision: number;
  blob: EncryptedBlob | null;
  updatedAt: number | null;
}

export interface CloudSession {
  token: string;
  wrappedVaultKey: EncryptedBlob;
  kdf: Argon2Params;
  salt: string;
}

export interface RecoveryPayload {
  authHash: string;
  wrappedVaultKey: EncryptedBlob;
}

export interface RegisterPayload {
  email: string;
  authHash: string;
  kdf: Argon2Params;
  salt: string;
  wrappedVaultKey: EncryptedBlob;
  vault: EncryptedBlob;
  recovery?: RecoveryPayload;
  locale?: string;
}

export interface AvatarPolicy {
  uploads: boolean;
  remoteUrls: boolean;
  maxBytes: number;
}

export interface AvatarInfo {
  kind: 'upload' | 'url';
  url: string | null;
  updatedAt: number;
}

export interface ServerConfig {
  version: string;
  limits: VaultLimits;
  registrationOpen: boolean;
  emailEnabled: boolean;
  avatars?: AvatarPolicy;
}

export interface AccountInfo {
  email: string;
  createdAt: number;
  totpEnabled: boolean;
  hasRecoveryKey: boolean;
  emailEnabled: boolean;
  limits: VaultLimits;
  avatar?: AvatarInfo | null;
}

export interface AccountSession {
  id: string;
  current: boolean;
  device: string | null;
  ipPrefix: string | null;
  country: string | null;
  city: string | null;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

export interface BillingPlanInfo {
  id: string;
  name: string;
  description: string;
  priceLabel: string;
  mode: 'subscription' | 'payment';
  boosts: Record<string, number>;
}

export interface BillingInfo {
  enabled: boolean;
  plans: BillingPlanInfo[];
  subscription: { planId: string; status: string; currentPeriodEnd: number | null; active: boolean } | null;
  limits: VaultLimits & Record<string, number>;
}

export interface LegalInfo {
  configured: boolean;
  operatorName: string | null;
  effectiveDate: string | null;
  documents: Array<{ slug: string; title: string; url: string }>;
}

export type SharedPermission = 'write' | 'attachments' | 'export' | 'manage_members' | 'manage_roles' | 'delete_vault';

export interface SharedRole {
  id: string;
  name: string;
  builtin: 'owner' | 'admin' | 'editor' | 'viewer' | null;
  permissions: SharedPermission[];
}

export interface SharedVaultSummary {
  id: string;
  status: 'invited' | 'active';
  revision: number;
  updatedAt: number;
  wrappedKey: string;
  ownerEmail: string;
  invitedByEmail: string | null;
  role: SharedRole;
}

export interface SharedMember {
  userId: string;
  email: string;
  roleId: string;
  status: 'invited' | 'active';
  createdAt: number;
  publicKey: string | null;
  invitedByEmail: string | null;
}

export interface SharedMembers {
  permissions: SharedPermission[];
  members: SharedMember[];
  roles: SharedRole[];
}

/** Le serveur demande le code de l'application d'authentification */
export const isTotpRequired = (err: unknown) => err instanceof CloudError && err.code === 'totp_required';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function normalizeServerUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new CloudError('Adresse du serveur invalide', 0, 'invalid_url');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) {
    throw new CloudError('Le serveur doit utiliser HTTPS (HTTP accepté uniquement en local)', 0, 'insecure_url');
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

export class CloudClient {
  readonly baseUrl: string;
  private token: string | null;

  constructor(serverUrl: string, token: string | null = null) {
    this.baseUrl = normalizeServerUrl(serverUrl);
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch {
      throw new CloudError('Serveur BetterVault injoignable', 0, 'network');
    }

    const text = await response.text();
    const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
    let json: { error?: { code?: string; message?: string; details?: unknown } } | null = null;
    if (isJson && text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    if (!response.ok) {
      throw new CloudError(
        json?.error?.message ?? `Erreur serveur (${response.status})`,
        response.status,
        json?.error?.code ?? 'http_error',
        json?.error?.details
      );
    }
    // Une réponse vide n'est attendue que pour 204 ; toute autre réponse doit être du JSON de l'API
    if (response.status !== 204 && !json) {
      throw new CloudError('Cette adresse ne répond pas comme un serveur BetterVault', response.status, 'invalid_response');
    }
    return json as T;
  }

  health(): Promise<{ ok: boolean; name: string; version: string }> {
    return this.request('GET', '/api/v1/health');
  }

  config(): Promise<ServerConfig> {
    return this.request('GET', '/api/v1/config');
  }

  prelogin(email: string): Promise<{ kdf: Argon2Params; salt: string }> {
    return this.request('POST', '/api/v1/sessions/prelogin', { email });
  }

  async register(payload: RegisterPayload): Promise<{ token: string; revision: number }> {
    const result = await this.request<{ token: string; revision: number }>('POST', '/api/v1/accounts', payload);
    this.token = result.token;
    return result;
  }

  async login(email: string, authHash: string, extra: { totp?: string; locale?: string; notify?: boolean } = {}): Promise<CloudSession> {
    const session = await this.request<CloudSession>('POST', '/api/v1/sessions', { email, authHash, ...extra });
    this.token = session.token;
    return session;
  }

  me(): Promise<AccountInfo> {
    return this.request('GET', '/api/v1/accounts/me');
  }

  listSessions(): Promise<{ sessions: AccountSession[] }> {
    return this.request('GET', '/api/v1/accounts/sessions');
  }

  revokeSessions(payload: { authHash: string; sessionId?: string; all?: boolean; totp?: string }): Promise<{ revoked: number }> {
    return this.request('POST', '/api/v1/accounts/sessions/revoke', payload);
  }

  billing(): Promise<BillingInfo> {
    return this.request('GET', '/api/v1/billing');
  }

  checkout(planId: string): Promise<{ url: string }> {
    return this.request('POST', '/api/v1/billing/checkout', { planId });
  }

  billingPortal(): Promise<{ url: string }> {
    return this.request('POST', '/api/v1/billing/portal', {});
  }

  legal(): Promise<LegalInfo> {
    return this.request('GET', '/api/v1/legal');
  }

  setupTotp(authHash: string): Promise<{ secret: string; uri: string }> {
    return this.request('POST', '/api/v1/accounts/2fa/setup', { authHash });
  }

  async enableTotp(code: string): Promise<void> {
    await this.request('POST', '/api/v1/accounts/2fa/enable', { code });
  }

  async disableTotp(authHash: string, code: string): Promise<void> {
    await this.request('DELETE', '/api/v1/accounts/2fa', { authHash, code });
  }

  async setRecovery(authHash: string, recovery: RecoveryPayload): Promise<void> {
    await this.request('PUT', '/api/v1/accounts/recovery', { authHash, recovery });
  }

  recoveryStart(email: string, locale?: string): Promise<{ emailCodeRequired: boolean }> {
    return this.request('POST', '/api/v1/recovery/start', { email, locale });
  }

  recoveryVerify(payload: { email: string; recoveryAuthHash?: string; emailCode?: string; totp?: string }): Promise<{ token: string; withRecoveryKey: boolean; wrappedVaultKey: EncryptedBlob | null }> {
    return this.request('POST', '/api/v1/recovery/verify', payload);
  }

  async recoveryComplete(payload: {
    token: string;
    authHash: string;
    kdf: Argon2Params;
    salt: string;
    wrappedVaultKey: EncryptedBlob;
    recovery?: RecoveryPayload;
    vault?: EncryptedBlob;
  }): Promise<{ token: string; revision: number }> {
    const result = await this.request<{ token: string; revision: number }>('POST', '/api/v1/recovery/complete', payload);
    this.token = result.token;
    return result;
  }

  async logout(): Promise<void> {
    await this.request('DELETE', '/api/v1/sessions');
    this.token = null;
  }

  getVault(): Promise<CloudVault> {
    return this.request('GET', '/api/v1/vault');
  }

  putVault(baseRevision: number, blob: EncryptedBlob): Promise<{ revision: number; updatedAt: number }> {
    return this.request('PUT', '/api/v1/vault', { baseRevision, blob });
  }

  async changePassword(payload: { currentAuthHash: string; newAuthHash: string; kdf: Argon2Params; salt: string; wrappedVaultKey: EncryptedBlob }): Promise<void> {
    await this.request('PUT', '/api/v1/accounts/password', payload);
  }

  /* ── Partage ─────────────────────────────────────────────────────────── */

  getSharingKeys(): Promise<{ publicKey: string | null; wrappedPrivateKey: EncryptedBlob | null }> {
    return this.request('GET', '/api/v1/accounts/keys');
  }

  async setSharingKeys(publicKey: string, wrappedPrivateKey: EncryptedBlob): Promise<void> {
    await this.request('PUT', '/api/v1/accounts/keys', { publicKey, wrappedPrivateKey });
  }

  lookupUser(email: string): Promise<{ userId: string; email: string; publicKey: string }> {
    return this.request('POST', '/api/v1/users/lookup', { email });
  }

  async listSharedVaults(): Promise<SharedVaultSummary[]> {
    return (await this.request<{ vaults: SharedVaultSummary[] }>('GET', '/api/v1/shared-vaults')).vaults;
  }

  createSharedVault(blob: EncryptedBlob, wrappedKey: string): Promise<{ id: string; revision: number; roleId: string }> {
    return this.request('POST', '/api/v1/shared-vaults', { blob, wrappedKey });
  }

  getSharedVault(id: string): Promise<CloudVault> {
    return this.request('GET', `/api/v1/shared-vaults/${encodeURIComponent(id)}`);
  }

  putSharedVault(id: string, baseRevision: number, blob: EncryptedBlob): Promise<{ revision: number; updatedAt: number }> {
    return this.request('PUT', `/api/v1/shared-vaults/${encodeURIComponent(id)}`, { baseRevision, blob });
  }

  async deleteSharedVault(id: string): Promise<void> {
    await this.request('DELETE', `/api/v1/shared-vaults/${encodeURIComponent(id)}`);
  }

  sharedMembers(id: string): Promise<SharedMembers> {
    return this.request('GET', `/api/v1/shared-vaults/${encodeURIComponent(id)}/members`);
  }

  async inviteMember(id: string, payload: { userId: string; roleId: string; wrappedKey: string }): Promise<void> {
    await this.request('POST', `/api/v1/shared-vaults/${encodeURIComponent(id)}/members`, payload);
  }

  async changeMemberRole(id: string, userId: string, roleId: string): Promise<void> {
    await this.request('PATCH', `/api/v1/shared-vaults/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { roleId });
  }

  async removeMember(id: string, userId: string): Promise<void> {
    await this.request('DELETE', `/api/v1/shared-vaults/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`);
  }

  async acceptInvitation(id: string): Promise<void> {
    await this.request('POST', `/api/v1/shared-vaults/${encodeURIComponent(id)}/accept`);
  }

  async declineInvitation(id: string): Promise<void> {
    await this.request('POST', `/api/v1/shared-vaults/${encodeURIComponent(id)}/decline`);
  }

  createRole(id: string, role: { name: string; permissions: SharedPermission[] }): Promise<SharedRole> {
    return this.request('POST', `/api/v1/shared-vaults/${encodeURIComponent(id)}/roles`, role);
  }

  async updateRole(id: string, roleId: string, patch: { name?: string; permissions?: SharedPermission[] }): Promise<void> {
    await this.request('PATCH', `/api/v1/shared-vaults/${encodeURIComponent(id)}/roles/${encodeURIComponent(roleId)}`, patch);
  }

  async deleteRole(id: string, roleId: string): Promise<void> {
    await this.request('DELETE', `/api/v1/shared-vaults/${encodeURIComponent(id)}/roles/${encodeURIComponent(roleId)}`);
  }

  rotateSharedVault(id: string, payload: { baseRevision: number; blob: EncryptedBlob; members: Array<{ userId: string; wrappedKey: string }> }): Promise<{ revision: number; updatedAt: number }> {
    return this.request('POST', `/api/v1/shared-vaults/${encodeURIComponent(id)}/rotate`, payload);
  }

  /* ── Pièces jointes ──────────────────────────────────────────────────── */

  private async rawRequest(method: string, path: string, body?: Uint8Array): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/octet-stream' } : {}),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
        },
        body: body ? (body.slice().buffer as ArrayBuffer) : undefined
      });
    } catch {
      throw new CloudError('Serveur BetterVault injoignable', 0, 'network');
    }
    if (!response.ok) {
      const json = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
      throw new CloudError(json?.error?.message ?? `Erreur serveur (${response.status})`, response.status, json?.error?.code ?? 'http_error');
    }
    return response;
  }

  async uploadAttachment(payload: Uint8Array, sharedVaultId?: string): Promise<{ id: string; size: number }> {
    const query = sharedVaultId ? `?vault=${encodeURIComponent(sharedVaultId)}` : '';
    return (await this.rawRequest('POST', `/api/v1/attachments${query}`, payload)).json();
  }

  async downloadAttachment(id: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.rawRequest('GET', `/api/v1/attachments/${encodeURIComponent(id)}`)).arrayBuffer());
  }

  async uploadAvatar(image: Uint8Array): Promise<AvatarInfo | null> {
    return (await (await this.rawRequest('PUT', '/api/v1/accounts/avatar', image)).json()).avatar;
  }

  async downloadAvatar(): Promise<Uint8Array> {
    return new Uint8Array(await (await this.rawRequest('GET', '/api/v1/accounts/avatar')).arrayBuffer());
  }

  async setAvatarUrl(url: string): Promise<AvatarInfo | null> {
    return (await this.request<{ avatar: AvatarInfo | null }>('PUT', '/api/v1/accounts/avatar-url', { url })).avatar;
  }

  async deleteAvatar(): Promise<void> {
    await this.request('DELETE', '/api/v1/accounts/avatar');
  }

  async deleteAttachment(id: string): Promise<void> {
    await this.request('DELETE', `/api/v1/attachments/${encodeURIComponent(id)}`);
  }

  attachmentUsage(): Promise<{ enabled: boolean; usedBytes: number; quotaBytes: number; maxFileBytes: number }> {
    return this.request('GET', '/api/v1/attachments/usage');
  }

  async deleteAccount(authHash: string): Promise<void> {
    await this.request('DELETE', '/api/v1/accounts', { authHash });
    this.token = null;
  }
}
