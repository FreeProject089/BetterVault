import * as OTPAuth from 'otpauth';

export interface TOTPTokenResult {
  token: string;
  remainingSeconds: number;
  period: number;
  progressPercent: number;
}

/**
 * Génère un code TOTP RFC 6238 en temps réel à partir d'un secret Base32 ou d'une URI otpauth://
 */
export function generateTOTP(secretOrUri: string): TOTPTokenResult | null {
  try {
    let totp: OTPAuth.TOTP;

    if (secretOrUri.startsWith('otpauth://')) {
      const parsed = OTPAuth.URI.parse(secretOrUri);
      if (!(parsed instanceof OTPAuth.TOTP)) {
        return null;
      }
      totp = parsed;
    } else {
      // Nettoyage de la clé (suppression des espaces et conversion majuscules)
      const cleanSecret = secretOrUri.replace(/[\s-]/g, '').toUpperCase();
      totp = new OTPAuth.TOTP({
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(cleanSecret)
      });
    }

    const token = totp.generate();
    const period = totp.period || 30;
    const epochSeconds = Math.floor(Date.now() / 1000);
    const remainingSeconds = period - (epochSeconds % period);
    const progressPercent = (remainingSeconds / period) * 100;

    return {
      token,
      remainingSeconds,
      period,
      progressPercent
    };
  } catch (err) {
    console.error('Erreur génération TOTP:', err);
    return null;
  }
}
