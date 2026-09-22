import { describe, it, expect } from 'vitest';
import { VaultStore, createEmptyVaultData } from '../src/store/vaultStore';

/**
 * Effacer une partie du coffre doit tenir après une synchronisation : l'autre
 * appareil possède encore les éléments et les renverrait si rien ne marquait
 * leur disparition.
 */

const prepare = () => {
  const store = new VaultStore();
  store.load(createEmptyVaultData());
  const vaultId = store.getData().activeVaultId;
  const autre = store.addVault('Boulot', 'work');

  const cred = store.addCredential({ title: 'Banque', vaultId, tags: ['argent'], password: 'x' } as never);
  store.addCredential({ title: 'Ailleurs', vaultId: autre, tags: [] } as never);
  store.addTask({ title: 'Changer le mot de passe', vaultId, tags: [], linkedCredentialId: cred } as never);

  return { store, vaultId, autre, cred };
};

describe('eraseData', () => {
  it('n’efface que les coffres choisis', () => {
    const { store, vaultId } = prepare();
    const bilan = store.eraseData({ vaultIds: [vaultId], credentials: true });

    expect(bilan.credentials).toBe(1);
    const reste = store.getData().credentials;
    expect(reste).toHaveLength(1);
    expect(reste[0].title).toBe('Ailleurs');
  });

  it('inscrit les disparus pour que la synchronisation ne les ramène pas', () => {
    const { store, vaultId, cred } = prepare();
    store.eraseData({ vaultIds: [vaultId], credentials: true });
    expect(store.getData().deleted[cred]).toBeGreaterThan(0);
  });

  it('conserve les tâches et coupe seulement leur lien', () => {
    const { store, vaultId } = prepare();
    store.eraseData({ vaultIds: [vaultId], credentials: true });

    const taches = store.getData().tasks;
    expect(taches).toHaveLength(1);
    expect(taches[0].linkedCredentialId).toBeUndefined();
  });


  it('ne retire que les tags dont plus rien ne se sert', () => {
    const { store, vaultId } = prepare();
    const avant = store.getTags().map(t => t.name);
    expect(avant).toContain('argent');

    // Tant que l'identifiant est là, son tag reste
    store.eraseData({ vaultIds: [vaultId], tags: true });
    expect(store.getTags().map(t => t.name)).toContain('argent');

    // Une fois l'identifiant parti, le tag n'a plus de porteur
    store.eraseData({ vaultIds: [vaultId], credentials: true, tags: true });
    expect(store.getTags().map(t => t.name)).not.toContain('argent');
  });

  it('ne touche à rien quand aucune catégorie n’est demandée', () => {
    const { store, vaultId } = prepare();
    const bilan = store.eraseData({ vaultIds: [vaultId] });
    expect(bilan).toEqual({ credentials: 0, tasks: 0, tags: 0 });
    expect(store.getData().credentials).toHaveLength(2);
  });
});
