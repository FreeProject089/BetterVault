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

/**
 * WebAuthn utilisable ici. Vérifier la seule présence de l'objet ne suffit
 * pas : hors contexte sécurisé (serveur en http simple), l'appel échoue
 * toujours, et proposer un bouton qui ne peut pas marcher est pire que ne rien
 * proposer. Les vues natives sans WebAuthn (WebKitGTK sous Linux, WebView
 * Android) n'exposent pas l'objet du tout et sont donc déjà écartées.
 */
export const securityKeysSupported = (): boolean =>
  typeof globalThis.PublicKeyCredential === 'function'
  && typeof globalThis.navigator?.credentials?.create === 'function'
  && globalThis.isSecureContext !== false
  && !!currentRpId();

/**
 * L'appareil porte-t-il une clé intégrée avec vérification de la personne :
 * Windows Hello, Touch ID, empreinte ou visage Android ? Si oui, le second
 * facteur peut être la biométrie de l'appareil au lieu d'une clé branchée —
 * y compris dans l'extension, où il n'y a pas de trousseau système.
 */
export async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (!securityKeysSupported()) return false;
  const probe = (globalThis.PublicKeyCredential as unknown as {
    isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
  }).isUserVerifyingPlatformAuthenticatorAvailable;
  if (typeof probe !== 'function') return false;
  try {
    return await probe.call(globalThis.PublicKeyCredential);
  } catch {
    return false;
  }
}

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

/**
 * `kind` choisit le type de clé : `platform` pour la biométrie de l'appareil
 * (vérification de la personne exigée, sinon l'invite ne servirait à rien),
 * `roaming` pour une clé branchée ou NFC.
 */
export async function createCredential(
  options: RegistrationOptions,
  kind: 'platform' | 'roaming' = 'roaming'
): Promise<{ clientDataJSON: string; attestationObject: string }> {
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: fromB64url(options.challenge),
      rp: options.rp,
      user: { ...options.user, id: fromB64url(options.user.id) },
      pubKeyCredParams: options.pubKeyCredParams,
      excludeCredentials: descriptors(options.excludeCredentials),
      authenticatorSelection: kind === 'platform'
        ? { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' }
        : { authenticatorAttachment: 'cross-platform', userVerification: 'discouraged', residentKey: 'discouraged' },
      attestation: 'none',
      timeout: options.timeout
    }
  }) as PublicKeyCredential | null;
  if (!credential) throw new Error('Aucune clé n’a répondu');
  const response = credential.response as AuthenticatorAttestationResponse;
  return { clientDataJSON: toB64url(response.clientDataJSON), attestationObject: toB64url(response.attestationObject) };
}
