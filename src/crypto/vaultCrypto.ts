import { EFF_LARGE_WORDLIST } from './effWordlist';

/**
 * Calcule l'entropie et la force d'un mot de passe (en bits)
 */
export function calculatePasswordEntropy(password: string): { score: number; bits: number; label: string; color: string } {
  if (!password) return { score: 0, bits: 0, label: 'Vide', color: '#6E7681' };

  let poolSize = 0;
  if (/[a-z]/.test(password)) poolSize += 26;
  if (/[A-Z]/.test(password)) poolSize += 26;
  if (/[0-9]/.test(password)) poolSize += 10;
  if (/[^a-zA-Z0-9]/.test(password)) poolSize += 32;

  const bits = Math.round(password.length * (Math.log2(poolSize || 1)));
  let score = 1;
  let label = 'Très faible';
  let color = '#DA3633'; // Red

  if (bits >= 75) {
    score = 4;
    label = 'Excellent';
    color = '#238636'; // Green
  } else if (bits >= 55) {
    score = 3;
    label = 'Fort';
    color = '#2EA043';
  } else if (bits >= 36) {
    score = 2;
    label = 'Moyen';
    color = '#D29922'; // Orange/Yellow
  }

  return { score, bits, label, color };
}

// Liste Diceware officielle de l'EFF : 7 776 mots, ≈ 12,9 bits d'entropie par mot
export const PASSPHRASE_WORDLIST: readonly string[] = EFF_LARGE_WORDLIST;

/**
 * Entier aléatoire uniforme dans [0, max) par échantillonnage par rejet :
 * un simple modulo favoriserait les premiers indices quand 2^32 n'est pas multiple de max.
 */
export function secureRandomIndex(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 0x100000000) throw new RangeError('Borne aléatoire invalide');
  const limit = Math.floor(0x100000000 / max) * max;
  const buffer = new Uint32Array(1);
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= limit);
  return buffer[0] % max;
}

/**
 * Générateur de Passphrase Diceware (liste EFF, tirage cryptographique non biaisé)
 */
export type PassphraseCase = 'lower' | 'title' | 'upper' | 'random';

export const PASSPHRASE_SYMBOLS = '!#$%&*+-=?@^_~';
export const MAX_PASSPHRASE_WORDS = 20;

export interface PassphraseOptions {
  wordCount: number;
  separator: string;
  /** Ancienne option : équivaut à wordCase « title » */
  capitalize?: boolean;
  wordCase?: PassphraseCase;
  includeNumber: boolean;
  /** Nombre de chiffres du nombre ajouté (1 à 6, 2 par défaut) */
  numberDigits?: number;
  includeSymbol?: boolean;
}

export function generatePassphrase(options: PassphraseOptions): string {
  const count = Math.min(MAX_PASSPHRASE_WORDS, Math.max(1, Math.floor(options.wordCount)));
  const wordCase: PassphraseCase = options.wordCase ?? (options.capitalize ? 'title' : 'lower');
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    const word = PASSPHRASE_WORDLIST[secureRandomIndex(PASSPHRASE_WORDLIST.length)];
    const style = wordCase === 'random' ? (['lower', 'title', 'upper'] as const)[secureRandomIndex(3)] : wordCase;
    words.push(style === 'upper' ? word.toUpperCase() : style === 'title' ? word.charAt(0).toUpperCase() + word.slice(1) : word);
  }

  const parts = [...words];
  if (options.includeNumber) {
    const digits = Math.min(6, Math.max(1, options.numberDigits ?? 2));
    // Nombre à longueur fixe : 10^(digits-1) à 10^digits - 1 (2 chiffres : 10 à 99)
    const min = digits === 1 ? 0 : 10 ** (digits - 1);
    parts.push(String(min + secureRandomIndex(10 ** digits - min)));
  }
  if (options.includeSymbol) parts.push(PASSPHRASE_SYMBOLS[secureRandomIndex(PASSPHRASE_SYMBOLS.length)]);
  return parts.join(options.separator);
}

/** Entropie réelle d'une phrase générée (tirages aléatoires, pas longueur des caractères) */
export function passphraseEntropyBits(options: PassphraseOptions): number {
  const count = Math.min(MAX_PASSPHRASE_WORDS, Math.max(1, Math.floor(options.wordCount)));
  const wordCase = options.wordCase ?? (options.capitalize ? 'title' : 'lower');
  let bits = count * Math.log2(PASSPHRASE_WORDLIST.length);
  if (wordCase === 'random') bits += count * Math.log2(3);
  if (options.includeNumber) {
    const digits = Math.min(6, Math.max(1, options.numberDigits ?? 2));
    bits += Math.log2(10 ** digits - (digits === 1 ? 0 : 10 ** (digits - 1)));
  }
  if (options.includeSymbol) bits += Math.log2(PASSPHRASE_SYMBOLS.length);
  return Math.round(bits);
}

/**
 * Générateur de mot de passe à haute entropie cryptographique
 */
export function generateStrongPassword(options: {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  avoidAmbiguous: boolean;
  /** Caractères à ne jamais utiliser (ex. refusés par un site) */
  exclude?: string;
}): string {
  const excluded = new Set(options.exclude ?? '');
  const keep = (set: string) => Array.from(set).filter(ch => !excluded.has(ch)).join('');
  const lower = keep(options.avoidAmbiguous ? 'abcdefghijkmnpqrstuvwxyz' : 'abcdefghijklmnopqrstuvwxyz');
  const upper = keep(options.avoidAmbiguous ? 'ABCDEFGHJKLMNPQRSTUVWXYZ' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  const digits = keep(options.avoidAmbiguous ? '23456789' : '0123456789');
  const syms = keep('!@#$%^&*()-_=+[]{}|;:,.<>?');

  const requiredChars: string[] = [];
  let allChars = '';

  const pickRandom = (set: string) => set[secureRandomIndex(set.length)];

  for (const [enabled, set] of [[options.lowercase, lower], [options.uppercase, upper], [options.numbers, digits], [options.symbols, syms]] as const) {
    if (enabled && set) {
      allChars += set;
      requiredChars.push(pickRandom(set));
    }
  }

  if (!allChars) allChars = keep('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
  if (!allChars) throw new Error('Tous les caractères sont exclus');

  const remainingLength = Math.max(0, options.length - requiredChars.length);
  const resultList = [...requiredChars];
  for (let i = 0; i < remainingLength; i++) {
    resultList.push(pickRandom(allChars));
  }

  // Mélange cryptographique non biaisé (Fisher-Yates)
  for (let i = resultList.length - 1; i > 0; i--) {
    const j = secureRandomIndex(i + 1);
    [resultList[i], resultList[j]] = [resultList[j], resultList[i]];
  }

  return resultList.slice(0, options.length).join('');
}

/** Le service HIBP n'a pas pu être interrogé : le résultat est inconnu, PAS « non compromis » */
export class HibpUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HibpUnavailableError';
  }
}

/**
 * Vérification k-anonymity Have I Been Pwned (HIBP)
 * Hache le mot de passe en SHA-1, envoie uniquement les 5 premiers caractères hex
 * et compare les suffixes retournés sans jamais divulguer le mot de passe réel.
 * Retourne le nombre d'apparitions dans des fuites (0 = absent).
 * @throws HibpUnavailableError si le service est injoignable ou répond en erreur
 */
export async function checkPasswordPwnedHIBP(password: string): Promise<number> {
  if (!password) return 0;
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-1', enc.encode(password));
  const hex = Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

  const prefix = hex.slice(0, 5);
  const suffix = hex.slice(5);

  let res: Response;
  let text: string;
  try {
    res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' }
    });
    text = await res.text();
  } catch {
    throw new HibpUnavailableError('Service Have I Been Pwned injoignable (hors ligne ou bloqué par le réseau)');
  }
  if (!res.ok) {
    throw new HibpUnavailableError(`Have I Been Pwned a répondu une erreur HTTP ${res.status}`);
  }

  for (const line of text.split('\n')) {
    const [hashSuffix, countStr] = line.trim().split(':');
    if (hashSuffix === suffix) {
      // Les lignes de remplissage (Add-Padding) ont un compteur à 0
      return parseInt(countStr, 10) || 0;
    }
  }
  return 0;
}

export interface PasswordAuditReport {
  total: number;
  weak: number;
  reused: number;
  reusedMap: Map<string, string[]>; // password -> item titles
  missing2fa: number;
  score: number; // 0 à 100
}

/**
 * Analyse de sécurité complète du coffre actif
 */
export function auditVaultSecurity(credentials: Array<{ id: string; title: string; password: string; totpSecret?: string }>): PasswordAuditReport {
  const total = credentials.length;
  if (total === 0) {
    return { total: 0, weak: 0, reused: 0, reusedMap: new Map(), missing2fa: 0, score: 100 };
  }

  let weak = 0;
  let missing2fa = 0;
  const pwdMap = new Map<string, string[]>();

  credentials.forEach(c => {
    if (!c.password || calculatePasswordEntropy(c.password).score <= 2) {
      weak++;
    }
    if (!c.totpSecret) {
      missing2fa++;
    }
    if (c.password) {
      const list = pwdMap.get(c.password) || [];
      list.push(c.title);
      pwdMap.set(c.password, list);
    }
  });

  const reusedMap = new Map<string, string[]>();
  let reused = 0;
  pwdMap.forEach((titles, pwd) => {
    if (titles.length > 1) {
      reused += titles.length;
      reusedMap.set(pwd, titles);
    }
  });

  // Calcul du score global de santé de sécurité (0 - 100)
  const weakPenalty = (weak / total) * 40;
  const reusedPenalty = (reused / total) * 35;
  const missing2faPenalty = (missing2fa / total) * 25;
  const score = Math.max(0, Math.round(100 - weakPenalty - reusedPenalty - missing2faPenalty));

  return { total, weak, reused, reusedMap, missing2fa, score };
}

