import { describe, it, expect } from 'vitest';
import { normalizeVaultData, createEmptyVaultData } from '../src/store/vaultStore';
import { assertAccountKdf, assertSalt, ACCOUNT_KDF } from '../src/account/accountCrypto';

/**
 * Chemins corrigés pendant l'audit : un coffre reçu d'un tiers et un serveur
 * hostile sont les deux sources d'entrée que l'application ne choisit pas.
 */

describe('Arborescence de dossiers hostile', () => {
  const chaine = (taille: number) =>
    Array.from({ length: taille }, (_, i) => ({
      id: `folder-${i}`,
      vaultId: 'vault-1',
      name: `Dossier ${i}`,
      // Chaque dossier est l'enfant du suivant, et le dernier reboucle sur le premier
      parentId: `folder-${(i + 1) % taille}`
    }));

  it('répare une boucle de parents sans parcourir l’arbre depuis chaque dossier', () => {
    const base = createEmptyVaultData();
    const debut = Date.now();
    const data = normalizeVaultData({
      ...base,
      vaults: [{ ...base.vaults[0], id: 'vault-1' }],
      activeVaultId: 'vault-1',
      folders: chaine(20_000)
    } as never);
    const duree = Date.now() - debut;

    // Un seul dossier perd son parent : la boucle est ouverte, l'arborescence conservée
    const orphelins = data.folders.filter(f => !f.parentId);
    expect(orphelins).toHaveLength(1);
    expect(data.folders).toHaveLength(20_000);

    // Le parcours quadratique demandait des minutes sur cette taille
    expect(duree).toBeLessThan(4_000);
  });

  it('coupe un dossier qui se déclare son propre parent', () => {
    const base = createEmptyVaultData();
    const data = normalizeVaultData({
      ...base,
      vaults: [{ ...base.vaults[0], id: 'vault-1' }],
      activeVaultId: 'vault-1',
      folders: [{ id: 'boucle', vaultId: 'vault-1', name: 'Boucle', parentId: 'boucle' }]
    } as never);
    expect(data.folders[0].parentId).toBeUndefined();
  });
});

describe('Paramètres de dérivation annoncés par le serveur', () => {
  it('refuse un coût inférieur à celui du client', () => {
    expect(() => assertAccountKdf({ t: 1, m: 8, p: 1 })).toThrow(/trop faibles/);
    expect(() => assertAccountKdf({ ...ACCOUNT_KDF, m: ACCOUNT_KDF.m - 1 })).toThrow(/trop faibles/);
  });

  it('refuse un coût irréaliste, qui bloquerait l’appareil', () => {
    expect(() => assertAccountKdf({ t: 1000, m: 1 << 24, p: 4 })).toThrow(/trop faibles/);
  });

  it('accepte un durcissement, et le plancher du client', () => {
    expect(assertAccountKdf({ t: 4, m: 131072, p: 4 })).toEqual({ t: 4, m: 131072, p: 4 });
    expect(assertAccountKdf({ t: 1, m: 8, p: 1 }, { t: 1, m: 8, p: 1 })).toEqual({ t: 1, m: 8, p: 1 });
  });

  it('refuse un sel trop court', () => {
    expect(() => assertSalt(new Uint8Array(8))).toThrow(/trop faibles/);
    expect(assertSalt(new Uint8Array(16))).toHaveLength(16);
  });
});
