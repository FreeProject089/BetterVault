import { describe, it, expect } from 'vitest';
import {
  calculatePasswordEntropy,
  generateStrongPassword,
  generatePassphrase,
  auditVaultSecurity
} from '../src/crypto/vaultCrypto';

describe('Vault Cryptography & Entropy Engine', () => {
  it('should calculate entropy correctly for various passwords', () => {
    const emptyEntropy = calculatePasswordEntropy('');
    expect(emptyEntropy.score).toBe(0);
    expect(emptyEntropy.bits).toBe(0);
    expect(emptyEntropy.label).toBe('Vide');

    const simpleEntropy = calculatePasswordEntropy('password');
    expect(simpleEntropy.bits).toBeLessThan(45);
    expect(simpleEntropy.score).toBeLessThanOrEqual(2);

    const complexEntropy = calculatePasswordEntropy('K9#m$L2!zQ9&wX1@');
    expect(complexEntropy.bits).toBeGreaterThanOrEqual(75);
    expect(complexEntropy.score).toBe(4);
    expect(complexEntropy.label).toBe('Excellent');
  });

  it('should generate strong random passwords adhering to character set constraints', () => {
    const pwd = generateStrongPassword({
      length: 24,
      uppercase: true,
      lowercase: true,
      numbers: true,
      symbols: true,
      avoidAmbiguous: false
    });

    expect(pwd.length).toBe(24);
    expect(/[A-Z]/.test(pwd)).toBe(true);
    expect(/[a-z]/.test(pwd)).toBe(true);
    expect(/[0-9]/.test(pwd)).toBe(true);
    expect(/[^A-Za-z0-9]/.test(pwd)).toBe(true);
  });

  it('should generate diceware passphrases with specified word counts and separators', () => {
    const phrase = generatePassphrase({
      wordCount: 5,
      separator: '-',
      capitalize: true,
      includeNumber: false
    });

    const parts = phrase.split('-');
    expect(parts.length).toBe(5);
    parts.forEach(word => {
      expect(word.length).toBeGreaterThan(0);
      expect(word[0]).toBe(word[0].toUpperCase());
    });
  });

  it('should accurately audit credentials for weak passwords, reuse, and 2FA coverage', () => {
    const testCreds = [
      {
        id: '1',
        title: 'Site A',
        password: 'weak', // 4 chars * log2(26) = ~19 bits -> score 1 (<= 2 is weak)
        category: 'logins'
      },
      {
        id: '2',
        title: 'Site B',
        password: 'weak', // reused with Site A
        category: 'logins'
      },
      {
        id: '3',
        title: 'Site C',
        password: 'SuperSecurePassword123!@#$$%',
        totpSecret: 'JBSWY3DPEHPK3PXP',
        category: 'logins'
      }
    ] as any;

    const report = auditVaultSecurity(testCreds);
    expect(report.total).toBe(3);
    expect(report.weak).toBe(2);
    expect(report.reused).toBe(2);
    expect(report.missing2fa).toBe(2);
    expect(report.score).toBeLessThan(70);
  });
});
