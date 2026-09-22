import { describe, it, expect } from 'vitest';
import { VaultStore, normalizeVaultData, payloadForType, MAX_FOLDER_DEPTH } from '../src/store/vaultStore';
import { mergeVaultData } from '../src/account/merge';
import { cardBrand, formatCardNumber, isLuhnValid, itemTypeOf, looksLikePrivateKey } from '../src/types/itemTypes';
import type { UnlockedVaultData } from '../src/types/vault';

const newStore = () => {
  const store = new VaultStore();
  store.load(normalizeVaultData(null));
  return store;
};

/** addCredential renvoie l'identifiant du nouvel élément */
const addItem = (store: VaultStore, over: Record<string, unknown> = {}): string =>
  store.addCredential({
    vaultId: store.getData().activeVaultId,
    title: 'Élément', username: '', password: '', website: '', domain: '', tags: [],
    ...over
  } as never);

describe('Types d’éléments', () => {
  it('traite un élément sans type enregistré comme un identifiant', () => {
    expect(itemTypeOf(undefined)).toBe('login');
    expect(itemTypeOf('carte-inconnue')).toBe('login');
    expect(itemTypeOf('card')).toBe('card');

    const data = normalizeVaultData({
      credentials: [{ id: 'c1', vaultId: 'v1', title: 'Ancien', username: '', password: '', website: '', domain: '', tags: [], createdAt: 1, updatedAt: 1 }]
    } as Partial<UnlockedVaultData>);
    expect(data.credentials[0].type).toBe('login');
  });

  it('ne garde que les champs du type choisi', () => {
    const card = payloadForType('card', { card: { number: '4111111111111111', holder: 'A B', expMonth: '01', expYear: '2030', cvv: '123', pin: '' } });
    expect(card.card?.number).toBe('4111111111111111');
    expect(card.identity).toBeUndefined();

    // Changer de type ne traîne pas les données de l'ancien
    const note = payloadForType('note', { card: { number: '4111111111111111', holder: '', expMonth: '', expYear: '', cvv: '', pin: '' } });
    expect(note.card).toBeUndefined();
    expect(note.identity).toBeUndefined();
    expect(note.sshKey).toBeUndefined();
  });

  it('écarte les champs inconnus venant d’un import', () => {
    const { card } = payloadForType('card', { card: { number: '4111111111111111', holder: 'A', expMonth: '', expYear: '', cvv: '', pin: '', piege: 'x' } as never });
    expect(card).toBeDefined();
    expect(Object.keys(card!).sort()).toEqual(['brand', 'cvv', 'expMonth', 'expYear', 'holder', 'number', 'pin']);
  });

  it('reconnaît le réseau, met en forme et contrôle le numéro de carte', () => {
    expect(cardBrand('4111111111111111')).toBe('Visa');
    expect(cardBrand('5555555555554444')).toBe('Mastercard');
    expect(cardBrand('378282246310005')).toBe('American Express');
    expect(cardBrand('1234')).toBeUndefined();

    expect(formatCardNumber('4111111111111111')).toBe('4111 1111 1111 1111');
    expect(formatCardNumber('378282246310005')).toBe('3782 822463 10005');

    expect(isLuhnValid('4111111111111111')).toBe(true);
    expect(isLuhnValid('4111111111111112')).toBe(false);
    expect(isLuhnValid('411')).toBe(false);
  });

  it('reconnaît une clé privée', () => {
    expect(looksLikePrivateKey('-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n')).toBe(true);
    expect(looksLikePrivateKey('-----BEGIN PRIVATE KEY-----')).toBe(true);
    expect(looksLikePrivateKey('ssh-rsa AAAA...')).toBe(false);
  });
});

describe('Aller-retour export / import', () => {
  it('garde le type et ses champs lors d’un ré-import BetterVault', () => {
    const store = newStore();
    const exported = [{
      type: 'card' as const,
      title: 'Carte',
      card: { number: '4111111111111111', holder: 'A B', expMonth: '07', expYear: '2030', cvv: '123', pin: '4321' },
      tags: []
    }];

    store.importBulk(exported, []);
    const imported = store.getData().credentials[0];

    expect(imported.type).toBe('card');
    expect(imported.card?.number).toBe('4111111111111111');
    expect(imported.card?.pin).toBe('4321');
    expect(imported.card?.brand).toBe('Visa');
  });

  it('range un import sans type parmi les identifiants', () => {
    const store = newStore();
    store.importBulk([{ title: 'Ancien', username: 'a@b.c', password: 'x', tags: [] }], []);
    expect(store.getData().credentials[0].type).toBe('login');
  });
});

describe('Export vers les autres gestionnaires', () => {
  it('écrit les champs du type dans les notes plutôt que de les perdre', async () => {
    const { MANAGER_EXPORTS } = await import('../src/import_export/managerExports');
    const carte = {
      id: 'c1', vaultId: 'v', type: 'card' as const, title: 'Carte',
      username: '', password: '', website: '', domain: '', tags: [],
      card: { number: '4111111111111111', holder: 'Jean Dupont', expMonth: '07', expYear: '2030', cvv: '123', pin: '4321', brand: 'Visa' },
      createdAt: 1, updatedAt: 1
    };

    const csv = MANAGER_EXPORTS.find(e => e.id === 'lastpass')!.build([carte]);
    expect(csv).toContain('4111111111111111');
    expect(csv).toContain('Jean Dupont');
    expect(csv).toContain('07/2030');
  });

  it('laisse un identifiant ordinaire inchangé', async () => {
    const { MANAGER_EXPORTS } = await import('../src/import_export/managerExports');
    const login = {
      id: 'c2', vaultId: 'v', type: 'login' as const, title: 'GitHub',
      username: 'moi', password: 'secret', website: 'github.com', domain: 'github.com',
      notes: 'ma note', tags: [], createdAt: 1, updatedAt: 1
    };
    const csv = MANAGER_EXPORTS.find(e => e.id === 'lastpass')!.build([login]);
    expect(csv).toContain('ma note');
    expect(csv).not.toContain('Numéro:');
  });
});

describe('Pièces jointes gardées dans le coffre', () => {
  it('chiffre, relit et refuse une clé fausse', async () => {
    const { encryptFile, decryptFile } = await import('../src/account/attachmentCrypto');
    const { toBase64, fromBase64 } = await import('../src/account/accountCrypto');

    const clair = new TextEncoder().encode('Contenu confidentiel');
    const { payload, key } = await encryptFile(clair);

    // Le contenu voyage en base64 dans le coffre : l'aller-retour ne doit rien changer
    const range = toBase64(payload);
    const relu = await decryptFile(fromBase64(range), key);
    expect(new TextDecoder().decode(relu)).toBe('Contenu confidentiel');

    const autre = (await encryptFile(clair)).key;
    await expect(decryptFile(fromBase64(range), autre)).rejects.toThrow('Pièce jointe altérée ou clé incorrecte');
  });

  it('garde le contenu au passage par normalizeAttachments et refuse ce qui n’est pas du base64', async () => {
    const { normalizeAttachments } = await import('../src/account/attachmentCrypto');

    const gardé = normalizeAttachments([
      { id: 'att-0123456789', name: 'contrat.txt', size: 32, type: 'text/plain', key: 'k', data: 'AAEC', createdAt: 1 }
    ]);
    expect(gardé?.[0].data).toBe('AAEC');

    const nettoyé = normalizeAttachments([
      { id: 'att-0123456789', name: 'contrat.txt', size: 32, type: 'text/plain', key: 'k', data: '<script>', createdAt: 1 }
    ]);
    expect(nettoyé?.[0].data).toBeUndefined();
  });

  it('compte la place prise dans le coffre', async () => {
    const { localAttachmentBytes, formatLimit, MAX_LOCAL_ATTACHMENT_BYTES } = await import('../src/account/attachmentCrypto');

    expect(localAttachmentBytes(undefined)).toBe(0);
    expect(localAttachmentBytes([
      { id: 'a', name: 'x', size: 3, type: '', key: 'k', data: 'AAEC', createdAt: 1 },
      { id: 'b', name: 'y', size: 3, type: '', key: 'k', createdAt: 1 }
    ])).toBe(4);

    expect(formatLimit(MAX_LOCAL_ATTACHMENT_BYTES, 'fr')).toBe('1 Mo');
    expect(formatLimit(512 * 1024, 'en')).toBe('512 KB');
  });
});

describe('Offres payantes', () => {
  it('lit les offres depuis l’environnement', async () => {
    const { plansFromEnv } = await import('../server/src/billing.ts');

    expect(plansFromEnv(undefined)).toEqual([]);
    expect(plansFromEnv('  ')).toEqual([]);

    const plans = plansFromEnv(JSON.stringify([{
      id: 'plus',
      name: 'Espace +',
      prices: [
        { id: 'mensuel', label: '2 € / mois', stripePriceId: 'price_abc' },
        { id: 'annuel', label: '20 € / an', stripePriceId: 'price_def' }
      ],
      boosts: { attachmentQuotaBytes: 1073741824 }
    }]));

    expect(plans).toHaveLength(1);
    expect(plans[0].prices.map(p => p.id)).toEqual(['mensuel', 'annuel']);
    expect(plans[0].prices[0].mode).toBe('subscription');
    expect(plans[0].boosts.attachmentQuotaBytes).toBe(1073741824);
  });

  it('arrête le serveur plutôt que de démarrer sur une configuration illisible', async () => {
    const { plansFromEnv } = await import('../server/src/billing.ts');

    expect(() => plansFromEnv('pas du json')).toThrow('tableau JSON valide');
    expect(() => plansFromEnv('{"id":"plus"}')).toThrow('tableau JSON');
    expect(() => plansFromEnv('[{"id":"plus","name":"X","prices":[{"id":"mensuel","stripePriceId":"pas-un-prix"}]}]'))
      .toThrow(/prix Stripe invalide/);
  });

  it('relit une offre enregistrée avant les durées', async () => {
    const { normalizePlan } = await import('../server/src/billing.ts');

    // Ancienne forme : un seul tarif porté par l'offre elle-même
    const plan = normalizePlan({
      id: 'plus', name: 'Plus', priceLabel: '2 € / mois',
      stripePriceId: 'price_abc', mode: 'subscription',
      boosts: { maxVaults: 5 }
    });

    expect(plan.prices).toHaveLength(1);
    expect(plan.prices[0]).toMatchObject({ id: 'defaut', label: '2 € / mois', stripePriceId: 'price_abc', mode: 'subscription' });
    expect(plan.boosts.maxVaults).toBe(5);
  });

  it('refuse deux tarifs de même identifiant', async () => {
    const { normalizePlan } = await import('../server/src/billing.ts');
    expect(() => normalizePlan({
      id: 'plus', name: 'Plus',
      prices: [
        { id: 'mensuel', stripePriceId: 'price_abc' },
        { id: 'mensuel', stripePriceId: 'price_def' }
      ]
    })).toThrow(/en double/);
  });

  it('cache les identifiants de prix Stripe à l’application', async () => {
    const { normalizePlan, planForAccount } = await import('../server/src/billing.ts');
    const plan = normalizePlan({ id: 'plus', name: 'Plus', prices: [{ id: 'mensuel', stripePriceId: 'price_secret' }] });
    expect(JSON.stringify(planForAccount(plan))).not.toContain('price_secret');
  });
});
