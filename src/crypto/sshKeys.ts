/**
 * Clés SSH : empreinte d'une clé publique et création d'une paire Ed25519,
 * au format d'OpenSSH (celui de ssh-keygen), sans dépendance.
 *
 * La clé privée créée ici n'a pas de phrase de passe : elle est rangée dans le
 * coffre, déjà chiffré. Pour la poser sur un disque, `ssh-keygen -p -f fichier`
 * lui en ajoute une.
 */

const text = new TextEncoder();

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};

const fromBase64 = (value: string): Uint8Array | null => {
  try {
    return Uint8Array.from(atob(value), c => c.charCodeAt(0));
  } catch {
    return null;
  }
};

/** Entier 32 bits gros-boutiste, puis champ préfixé de sa longueur, comme dans le protocole SSH */
const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const sshString = (bytes: Uint8Array | string) => {
  const data = typeof bytes === 'string' ? text.encode(bytes) : bytes;
  return concat(u32(data.length), data);
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
};

/** Ligne « type base64 commentaire » : le bloc binaire, s'il est bien formé */
function publicKeyBlob(publicKey: string): { type: string; blob: Uint8Array } | null {
  const [type, data] = publicKey.trim().split(/\s+/);
  if (!type || !data || !/^(ssh-|ecdsa-|sk-)/.test(type)) return null;
  const blob = fromBase64(data);
  if (!blob || blob.length < 4) return null;
  // Le bloc commence par le nom de son propre type : sinon, ce n'est pas une clé
  const length = (blob[0] << 24) | (blob[1] << 16) | (blob[2] << 8) | blob[3];
  if (length <= 0 || 4 + length > blob.length) return null;
  if (new TextDecoder().decode(blob.slice(4, 4 + length)) !== type) return null;
  return { type, blob };
}

/** Empreinte « SHA256:… » d'une clé publique, telle que l'affiche ssh-keygen -l */
export async function sshFingerprint(publicKey: string): Promise<string | null> {
  const parsed = publicKeyBlob(publicKey);
  if (!parsed) return null;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', parsed.blob as BufferSource));
  return `SHA256:${toBase64(digest).replace(/=+$/, '')}`;
}

export const isSshPublicKey = (publicKey: string): boolean => publicKeyBlob(publicKey) !== null;

/** Ed25519 dans WebCrypto : récent partout, absent de navigateurs anciens */
export async function supportsEd25519(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    return true;
  } catch {
    return false;
  }
}

export interface GeneratedSshKey {
  privateKey: string;
  publicKey: string;
  fingerprint: string;
}

/** Paire Ed25519 au format OpenSSH ; le commentaire suit la clé publique */
export async function generateEd25519Key(comment = ''): Promise<GeneratedSshKey> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  // PKCS#8 d'une clé Ed25519 : 16 octets d'en-tête, puis la graine de 32 octets
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const seed = pkcs8.slice(pkcs8.length - 32);

  const type = 'ssh-ed25519';
  const publicBlob = concat(sshString(type), sshString(publicRaw));
  const safeComment = comment.replace(/[\r\n]+/g, ' ').trim();

  // Section privée : deux contrôles identiques, la clé, le commentaire, puis un bourrage 1, 2, 3…
  const check = crypto.getRandomValues(new Uint8Array(4));
  let section = concat(check, check, sshString(type), sshString(publicRaw), sshString(concat(seed, publicRaw)), sshString(safeComment));
  const padding = (8 - (section.length % 8)) % 8;
  section = concat(section, Uint8Array.from({ length: padding }, (_, i) => i + 1));

  const body = concat(
    text.encode('openssh-key-v1\0'),
    sshString('none'), sshString('none'), sshString(''),
    u32(1), sshString(publicBlob), sshString(section)
  );
  const lines = toBase64(body).match(/.{1,70}/g) ?? [];
  seed.fill(0);
  pkcs8.fill(0);

  const publicKey = `${type} ${toBase64(publicBlob)}${safeComment ? ` ${safeComment}` : ''}`;
  return {
    privateKey: `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines.join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`,
    publicKey,
    fingerprint: (await sshFingerprint(publicKey)) ?? ''
  };
}
