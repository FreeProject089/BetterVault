import { describe, it, expect } from 'vitest';
import { normalizeVaultData, createEmptyVaultData } from '../src/store/vaultStore';
import { assertAccountKdf, assertSalt, ACCOUNT_KDF } from '../src/account/accountCrypto';

/**
 * Chemins corrigés pendant l'audit : un coffre reçu d'un tiers et un serveur
 * hostile sont les deux sources d'entrée que l'application ne choisit pas.
 */


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
