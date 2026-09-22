/**
 * Clés de sécurité (WebAuthn) côté application : conversion entre ce que renvoie le
 * serveur (base64url) et ce qu'attend le navigateur (ArrayBuffer).
 *
 * Une clé est liée au domaine de l'application qui l'enregistre (site, bureau ou
 * extension). Le domaine envoyé au serveur est donc celui de la page courante.
 */

export interface SecurityKeyAssertion {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}

export interface SecurityKeyInfo {
  id: string;
  name: string;
  rpId: string;
  createdAt: number;
  lastUsedAt: number | null;
}

interface Descriptor { type: 'public-key'; id: string }

export interface LoginOptions {
  challenge: string;
  rpId: string;
  allowCredentials: Descriptor[];
  userVerification?: UserVerificationRequirement;
  timeout?: number;
}

export interface RegistrationOptions {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: 'public-key'; alg: number }[];
  excludeCredentials: Descriptor[];
  timeout?: number;
}

const fromB64url = (value: string): ArrayBuffer => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return bytes.buffer;
};
const toB64url = (buffer: ArrayBuffer): string => {
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Domaine de l'application courante, ou undefined hors navigateur (tests, serveur) */
export const currentRpId = (): string | undefined => {
  const host = globalThis.location?.hostname;
  return host ? host.toLowerCase() : undefined;
};

export const securityKeysSupported = (): boolean =>
  typeof globalThis.PublicKeyCredential === 'function' && !!globalThis.navigator?.credentials && !!currentRpId();

const descriptors = (list: Descriptor[]): PublicKeyCredentialDescriptor[] =>
  list.map(d => ({ type: 'public-key', id: fromB64url(d.id) }));

export async function getAssertion(options: LoginOptions): Promise<SecurityKeyAssertion> {
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: fromB64url(options.challenge),
      rpId: options.rpId,
      allowCredentials: descriptors(options.allowCredentials),
      userVerification: options.userVerification ?? 'discouraged',
      timeout: options.timeout
    }
  }) as PublicKeyCredential | null;
  if (!credential) throw new Error('Aucune clé n’a répondu');
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: toB64url(credential.rawId),
    clientDataJSON: toB64url(response.clientDataJSON),
    authenticatorData: toB64url(response.authenticatorData),
    signature: toB64url(response.signature)
  };
}

export async function createCredential(options: RegistrationOptions): Promise<{ clientDataJSON: string; attestationObject: string }> {
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: fromB64url(options.challenge),
      rp: options.rp,
      user: { ...options.user, id: fromB64url(options.user.id) },
      pubKeyCredParams: options.pubKeyCredParams,
      excludeCredentials: descriptors(options.excludeCredentials),
      authenticatorSelection: { userVerification: 'discouraged', residentKey: 'discouraged' },
      attestation: 'none',
      timeout: options.timeout
    }
  }) as PublicKeyCredential | null;
  if (!credential) throw new Error('Aucune clé n’a répondu');
  const response = credential.response as AuthenticatorAttestationResponse;
  return { clientDataJSON: toB64url(response.clientDataJSON), attestationObject: toB64url(response.attestationObject) };
}
