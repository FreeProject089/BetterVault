import { describe, it, expect } from 'vitest';
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { normalizeVaultData, payloadForType } from '../src/store/vaultStore';
import { isUsualSeedLength, itemTypeOf, normalizeSeedPhrase, seedWords } from '../src/types/itemTypes';
import { generateEd25519Key, isSshPublicKey, sshFingerprint } from '../src/crypto/sshKeys';
import type { UnlockedVaultData } from '../src/types/vault';
import { countByFilter, queryCredentials } from '../src/store/credentialFilters';

/**
 * Phrases de récupération, clés d'API et clés SSH créées dans l'application.
 * Les mots ci-dessous viennent du vecteur de test public de BIP39 : ils ne
 * protègent rien.
 */

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('Phrase de récupération', () => {
  it('relit une phrase collée numérotée, en colonnes ou en majuscules', () => {
    expect(seedWords('1. Abandon 2. abandon\n3) ABANDON')).toEqual(['abandon', 'abandon', 'abandon']);
    expect(seedWords('  abandon,abandon ;  about ')).toEqual(['abandon', 'abandon', 'about']);
    expect(normalizeSeedPhrase(PHRASE.split(' ').map((w, i) => `${i + 1}. ${w}`).join('\n'))).toBe(PHRASE);
  });

  it('reconnaît les longueurs habituelles', () => {
    expect([12, 24, 25].every(isUsualSeedLength)).toBe(true);
    expect([0, 11, 13, 23].some(isUsualSeedLength)).toBe(false);
  });

  it('range la phrase et ne garde que les champs connus', () => {
    const { seedPhrase } = payloadForType('seedPhrase', { seedPhrase: { phrase: ' 1. Abandon  2. About ', passphrase: 'x', wallet: 'Ledger', address: 'bc1q', piege: 1 } as never });
    expect(seedPhrase).toEqual({ phrase: 'abandon about', passphrase: 'x', wallet: 'Ledger', address: 'bc1q' });
  });

  it('survit à la normalisation du coffre, et changer de type l’efface', () => {
    const data = normalizeVaultData({
      credentials: [{ id: 'c1', vaultId: 'v1', type: 'seedPhrase', title: 'Portefeuille', username: '', password: '', website: '', domain: '', tags: [],
        seedPhrase: { phrase: PHRASE, passphrase: '', wallet: 'Electrum', address: '' }, createdAt: 1, updatedAt: 1 }]
    } as unknown as Partial<UnlockedVaultData>);
    expect(data.credentials[0].type).toBe('seedPhrase');
    expect(data.credentials[0].seedPhrase?.phrase).toBe(PHRASE);
    expect(payloadForType('note', { seedPhrase: data.credentials[0].seedPhrase }).seedPhrase).toBeUndefined();
  });
});

describe('Clé d’API', () => {
  it('est un type à part entière, avec ses trois champs seulement', () => {
    expect(itemTypeOf('apiKey')).toBe('apiKey');
    const { apiKey } = payloadForType('apiKey', { apiKey: { key: 'AKIAEXEMPLE', secret: 'secret-factice', endpoint: 'api.exemple.fr', autre: 'x' } as never });
    expect(apiKey).toEqual({ key: 'AKIAEXEMPLE', secret: 'secret-factice', endpoint: 'api.exemple.fr' });
    expect(payloadForType('apiKey', {}).apiKey).toEqual({ key: '', secret: '', endpoint: '' });
  });
});

/** Relit la clé privée OpenSSH : graine Ed25519 et clé publique de la section privée */
function readOpenSshEd25519(pem: string): { seed: Buffer; publicRaw: Buffer } {
  const body = Buffer.from(pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, ''), 'base64');
  let offset = 0;
  const take = (n: number) => { const out = body.subarray(offset, offset + n); offset += n; return out; };
  const str = () => take(take(4).readUInt32BE(0));
  expect(take(15).toString('latin1')).toBe('openssh-key-v1\0');
  expect(str().toString()).toBe('none');
  expect(str().toString()).toBe('none');
  str();
  expect(take(4).readUInt32BE(0)).toBe(1);
  str();
  const section = str();
  expect(section.length % 8).toBe(0);
  let p = 0;
  const sTake = (n: number) => { const out = section.subarray(p, p + n); p += n; return out; };
  const sStr = () => sTake(sTake(4).readUInt32BE(0));
  expect(sTake(4).equals(sTake(4))).toBe(true);
  expect(sStr().toString()).toBe('ssh-ed25519');
  const publicRaw = sStr();
  const priv = sStr();
  expect(priv.subarray(32).equals(publicRaw)).toBe(true);
  return { seed: priv.subarray(0, 32), publicRaw };
}

describe('Clé SSH', () => {
  it('calcule l’empreinte comme ssh-keygen -l', async () => {
    // Clé publique Ed25519 de 32 octets nuls : empreinte connue, calculée à part
    const blob = Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from('ssh-ed25519'), Buffer.from([0, 0, 0, 32]), Buffer.alloc(32)]);
    const line = `ssh-ed25519 ${blob.toString('base64')} essai`;
    const expected = 'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');
    expect(await sshFingerprint(line)).toBe(expected);
  });

  it('refuse ce qui n’est pas une clé publique', async () => {
    expect(await sshFingerprint('bonjour')).toBeNull();
    expect(await sshFingerprint('ssh-rsa pasdubase64!!')).toBeNull();
    // Le type annoncé doit être celui écrit dans le bloc
    const blob = Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from('ssh-ed25519'), Buffer.alloc(36)]);
    expect(isSshPublicKey(`ssh-rsa ${blob.toString('base64')}`)).toBe(false);
  });

  it('crée une paire Ed25519 au format OpenSSH, qui signe vraiment', async () => {
    const key = await generateEd25519Key('serveur@exemple');
    expect(key.privateKey).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----\n[A-Za-z0-9+/=\n]+-----END OPENSSH PRIVATE KEY-----\n$/);
    expect(key.publicKey).toMatch(/^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]+=* serveur@exemple$/);
    expect(key.fingerprint).toBe(await sshFingerprint(key.publicKey));

    // La graine relue de la clé privée redonne la clé publique, et ses signatures se vérifient
    const { seed, publicRaw } = readOpenSshEd25519(key.privateKey);
    const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
    const privateKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
    const derivedPublic = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32);
    expect(Buffer.from(derivedPublic).equals(publicRaw)).toBe(true);
    const message = Buffer.from('bonjour');
    expect(verify(null, message, createPublicKey(privateKey), sign(null, message, privateKey))).toBe(true);
  });

  it('ne laisse pas un commentaire casser la ligne de clé publique', async () => {
    const key = await generateEd25519Key('a\nb');
    expect(key.publicKey.split('\n')).toHaveLength(1);
    expect(key.publicKey.endsWith(' a b')).toBe(true);
  });
});

describe('Liste et recherche', () => {
  const item = (over: Record<string, unknown>) => ({ id: String(Math.random()), vaultId: 'v', title: 'x', username: '', password: '', website: '', domain: '', tags: [], createdAt: 1, updatedAt: 1, ...over }) as never;

  it('« Sans mot de passe » ne vise que les identifiants', () => {
    const items = [item({ type: 'login' }), item({ type: 'seedPhrase' }), item({ type: 'apiKey' }), item({ type: 'note' }), item({})];
    expect(countByFilter(items).noPassword).toBe(2);
  });

  it('trouve le service et le portefeuille, jamais un secret', () => {
    const items = [
      item({ type: 'apiKey', title: 'A', apiKey: { key: 'cle-unique-secrete', secret: 'jeton-secret', endpoint: 'api.stripe.com' } }),
      item({ type: 'seedPhrase', title: 'B', seedPhrase: { phrase: PHRASE, passphrase: '', wallet: 'Ledger', address: '' } })
    ];
    expect(queryCredentials(items, { search: 'stripe' })).toHaveLength(1);
    expect(queryCredentials(items, { search: 'ledger' })).toHaveLength(1);
    for (const secret of ['abandon', 'jeton-secret', 'cle-unique']) expect(queryCredentials(items, { search: secret })).toHaveLength(0);
  });
});
