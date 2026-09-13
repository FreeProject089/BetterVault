import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  calculatePasswordEntropy,
  generateStrongPassword,
  generatePassphrase,
  auditVaultSecurity,
  checkPasswordPwnedHIBP,
  HibpUnavailableError,
  PASSPHRASE_WORDLIST,
  secureRandomIndex
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

  it('uses the full EFF large wordlist (7 776 words) for passphrases', () => {
    expect(PASSPHRASE_WORDLIST).toHaveLength(7776);
    expect(new Set(PASSPHRASE_WORDLIST).size).toBe(7776);
    expect(PASSPHRASE_WORDLIST[0]).toBe('abacus');
    expect(PASSPHRASE_WORDLIST[7775]).toBe('zoom');

    const phrase = generatePassphrase({ wordCount: 6, separator: ' ', capitalize: false, includeNumber: true });
    const parts = phrase.split(' ');
    expect(parts).toHaveLength(7);
    parts.slice(0, 6).forEach(word => expect(PASSPHRASE_WORDLIST).toContain(word));
    expect(Number(parts[6])).toBeGreaterThanOrEqual(10);
    expect(Number(parts[6])).toBeLessThan(100);
  });

  it('draws unbiased random indexes within bounds', () => {
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 6000; i++) counts[secureRandomIndex(6)]++;
    counts.forEach(c => {
      expect(c).toBeGreaterThan(800);
      expect(c).toBeLessThan(1200);
    });
    expect(() => secureRandomIndex(0)).toThrow(RangeError);
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

describe('Have I Been Pwned (k-anonymity)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
  it('sends only the 5-char hash prefix and returns the breach count', async () => {
    const fetchMock = vi.fn(async () => new Response('0018A45C4D1DEF81644B54AB7F969B88D65:0\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\r\n'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(checkPasswordPwnedHIBP('password')).resolves.toBe(3861493);
    expect(fetchMock).toHaveBeenCalledWith('https://api.pwnedpasswords.com/range/5BAA6', expect.anything());
  });

  it('returns 0 when the suffix is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('0018A45C4D1DEF81644B54AB7F969B88D65:2\r\n')));
    await expect(checkPasswordPwnedHIBP('password')).resolves.toBe(0);
  });

  it('throws instead of reporting "safe" when offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(checkPasswordPwnedHIBP('password')).rejects.toBeInstanceOf(HibpUnavailableError);
  });

  it('throws on HTTP errors (rate limit, outage)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Too many requests', { status: 429 })));
    await expect(checkPasswordPwnedHIBP('password')).rejects.toThrow('429');
  });
});
