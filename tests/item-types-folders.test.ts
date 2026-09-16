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

describe('Dossiers', () => {
  it('crée, imbrique et donne le chemin', () => {
    const store = newStore();
    const parent = store.createFolder('Travail');
    const child = store.createFolder('Serveurs', { parentId: parent.id });
    expect(store.folderPath(child.id).map(f => f.name)).toEqual(['Travail', 'Serveurs']);
    expect(store.getFolders().map(f => f.name)).toEqual(['Serveurs', 'Travail']);
  });

  it('refuse un nom vide et une imbrication trop profonde', () => {
    const store = newStore();
    expect(() => store.createFolder('   ')).toThrow('Le nom du dossier est vide');

    let parentId: string | undefined;
    for (let i = 0; i < MAX_FOLDER_DEPTH; i++) parentId = store.createFolder('N' + i, { parentId }).id;
    expect(() => store.createFolder('Trop profond', { parentId })).toThrow(/imbriquer/);
  });

  it('refuse de déplacer un dossier dans sa propre descendance', () => {
    const store = newStore();
    const parent = store.createFolder('Parent');
    const child = store.createFolder('Enfant', { parentId: parent.id });
    expect(() => store.updateFolder(parent.id, { parentId: child.id })).toThrow('Un dossier ne peut pas être déplacé dans lui-même');
  });

  it('remonte le contenu au parent quand un dossier est supprimé, sans rien perdre', () => {
    const store = newStore();
    const parent = store.createFolder('Parent');
    const child = store.createFolder('Enfant', { parentId: parent.id });
    const petit = store.createFolder('Petit-enfant', { parentId: child.id });
    const itemId = addItem(store, { title: 'Secret' });
    store.moveToFolder(itemId, child.id);

    store.deleteFolder(child.id);

    expect(store.getFolder(child.id)).toBeUndefined();
    expect(store.getFolder(petit.id)?.parentId).toBe(parent.id);
    const moved = store.getData().credentials.find(c => c.id === itemId);
    expect(moved).toBeDefined();
    expect(moved!.folderId).toBe(parent.id);
  });

  it('remet à la racine quand le dossier supprimé était à la racine', () => {
    const store = newStore();
    const folder = store.createFolder('Racine');
    const itemId = addItem(store);
    store.moveToFolder(itemId, folder.id);
    store.deleteFolder(folder.id);
    expect(store.getData().credentials.find(c => c.id === itemId)!.folderId).toBeUndefined();
  });

  it('compte les éléments des sous-dossiers', () => {
    const store = newStore();
    const parent = store.createFolder('Parent');
    const child = store.createFolder('Enfant', { parentId: parent.id });
    store.moveToFolder(addItem(store), parent.id);
    store.moveToFolder(addItem(store), child.id);
    expect(store.countFolderItems(parent.id)).toBe(2);
    expect(store.countFolderItems(parent.id, false)).toBe(1);
  });

  it('répare un parent disparu et une boucle de parents', () => {
    const data = normalizeVaultData({
      folders: [
        { id: 'f1', vaultId: 'v1', parentId: 'disparu', name: 'Orphelin', createdAt: 1, updatedAt: 1 },
        { id: 'f2', vaultId: 'v1', parentId: 'f3', name: 'A', createdAt: 1, updatedAt: 1 },
        { id: 'f3', vaultId: 'v1', parentId: 'f2', name: 'B', createdAt: 1, updatedAt: 1 }
      ],
      credentials: [{ id: 'c1', vaultId: 'v1', folderId: 'disparu', title: 'X', username: '', password: '', website: '', domain: '', tags: [], createdAt: 1, updatedAt: 1 }]
    } as Partial<UnlockedVaultData>);

    expect(data.folders.find(f => f.id === 'f1')!.parentId).toBeUndefined();
    // La boucle est cassée : au moins un des deux dossiers remonte à la racine
    const boucle = data.folders.filter(f => f.id === 'f2' || f.id === 'f3');
    expect(boucle.some(f => f.parentId === undefined)).toBe(true);
    expect(data.credentials[0].folderId).toBeUndefined();
  });

  it('fusionne les dossiers entre deux appareils et respecte les suppressions', () => {
    const base = normalizeVaultData(null);
    const local: UnlockedVaultData = {
      ...base,
      folders: [
        { id: 'f1', vaultId: 'v', name: 'Local récent', createdAt: 1, updatedAt: 200 },
        { id: 'f2', vaultId: 'v', name: 'Supprimé ailleurs', createdAt: 1, updatedAt: 100 }
      ],
      deleted: {}
    };
    const remote: UnlockedVaultData = {
      ...base,
      folders: [
        { id: 'f1', vaultId: 'v', name: 'Distant ancien', createdAt: 1, updatedAt: 150 },
        { id: 'f3', vaultId: 'v', name: 'Ajouté ailleurs', createdAt: 1, updatedAt: 120 }
      ],
      deleted: { f2: 180 }
    };

    const merged = mergeVaultData(local, remote);
    const names = merged.folders.map(f => f.name).sort();
    expect(names).toEqual(['Ajouté ailleurs', 'Local récent']);
  });
});
