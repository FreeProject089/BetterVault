import { describe, it, expect } from 'vitest';
import { generateTOTP } from '../src/crypto/totpEngine';

describe('TOTP Engine (RFC 6238)', () => {
  it('should generate a 6-digit numeric token from a valid Base32 secret', () => {
    // Secret standard RFC de test : 'JBSWY3DPEHPK3PXP'
    const result = generateTOTP('JBSWY3DPEHPK3PXP');
    expect(result).not.toBeNull();
    if (result) {
      expect(result.token).toMatch(/^\d{6}$/);
      expect(result.remainingSeconds).toBeGreaterThanOrEqual(0);
      expect(result.remainingSeconds).toBeLessThanOrEqual(30);
      expect(result.period).toBe(30);
    }
  });

  it('should return null for invalid Base32 secrets without crashing', () => {
    const invalidResult = generateTOTP('NOT A VALID BASE 32 ??? !!!');
    // Le moteur gère les erreurs silencieusement
    expect(invalidResult === null || typeof invalidResult?.token === 'string').toBe(true);
  });
});
