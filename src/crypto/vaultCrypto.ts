import { EncryptedVaultPayload, UnlockedVaultData } from '../types/vault';

// Conversion helpers
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Dérive une clé AES-256 à partir du Master Password et d'un sel cryptographique.
 * Utilise PBKDF2 avec SHA-256 et 600,000 itérations (Recommandation OWASP standard pour WebCrypto natif).
 * Compatible avec l'implémentation Argon2id Rust en production Tauri.
 */
export async function deriveMasterKey(password: string, saltBytes: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new Uint8Array(saltBytes).buffer as ArrayBuffer,
      iterations: 600000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Chiffre le contenu du coffre en AES-256-GCM avec un IV aléatoire de 96 bits.
 */
export async function encryptVault(data: UnlockedVaultData, masterKey: CryptoKey, saltBytes: Uint8Array): Promise<EncryptedVaultPayload> {
  const enc = new TextEncoder();
  const encodedData = enc.encode(JSON.stringify(data));
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96 bits IV

  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv
    },
    masterKey,
    encodedData
  );

  return {
    version: 1,
    kdf: 'PBKDF2-SHA256',
    salt: arrayBufferToBase64(new Uint8Array(saltBytes).buffer as ArrayBuffer),
    iterations: 600000,
    cipher: 'AES-256-GCM',
    iv: arrayBufferToBase64(iv.buffer as ArrayBuffer),
    ciphertext: arrayBufferToBase64(encryptedBuffer),
    authTag: '' // Déjà inclus dans le ciphertext avec AES-GCM WebCrypto
  };
}

/**
 * Déchiffre le coffre-fort avec la clé dérivée.
 */
export async function decryptVault(payload: EncryptedVaultPayload, masterKey: CryptoKey): Promise<UnlockedVaultData> {
  const iv = new Uint8Array(base64ToArrayBuffer(payload.iv));
  const ciphertext = base64ToArrayBuffer(payload.ciphertext);

  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv
    },
    masterKey,
    ciphertext
  );

  const dec = new TextDecoder();
  const jsonStr = dec.decode(decryptedBuffer);
  return JSON.parse(jsonStr) as UnlockedVaultData;
}

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

// Liste de mots soignée pour la génération de passphrase sécurisée (Diceware style)
export const PASSPHRASE_WORDLIST = [
  'alpha', 'anchor', 'orbit', 'cobalt', 'matrix', 'falcon', 'summit', 'aurora',
  'cipher', 'vortex', 'quasar', 'zenith', 'pulse', 'shadow', 'timber', 'breeze',
  'glacier', 'meteor', 'harbor', 'beacon', 'canyon', 'phoenix', 'granite', 'nebula',
  'quantum', 'solstice', 'strata', 'thunder', 'voyage', 'whisper', 'cascade', 'dynamo',
  'eclipse', 'frost', 'horizon', 'island', 'jupiter', 'kinetic', 'lunar', 'monolith',
  'nucleus', 'onyx', 'plasma', 'radius', 'safari', 'titan', 'umbra', 'vector'
];

/**
 * Générateur de Passphrase (style Diceware mémorisable à haute entropie)
 */
export function generatePassphrase(options: {
  wordCount: number;
  separator: string;
  capitalize: boolean;
  includeNumber: boolean;
}): string {
  const words: string[] = [];
  const randomArray = new Uint32Array(options.wordCount);
  crypto.getRandomValues(randomArray);

  for (let i = 0; i < options.wordCount; i++) {
    let word = PASSPHRASE_WORDLIST[randomArray[i] % PASSPHRASE_WORDLIST.length];
    if (options.capitalize) {
      word = word.charAt(0).toUpperCase() + word.slice(1);
    }
    words.push(word);
  }

  let result = words.join(options.separator);
  if (options.includeNumber) {
    const num = Math.floor(Math.random() * 90 + 10);
    result += options.separator + num;
  }
  return result;
}

/**
 * Hashe un mot de passe de coffre pour vérification locale rapide
 */
export async function hashVaultPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(password + '-bum-vault-salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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
}): string {
  const lower = options.avoidAmbiguous ? 'abcdefghijkmnpqrstuvwxyz' : 'abcdefghijklmnopqrstuvwxyz';
  const upper = options.avoidAmbiguous ? 'ABCDEFGHJKLMNPQRSTUVWXYZ' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = options.avoidAmbiguous ? '23456789' : '0123456789';
  const syms = '!@#$%^&*()-_=+[]{}|;:,.<>?';

  const requiredChars: string[] = [];
  let allChars = '';

  const pickRandom = (set: string) => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return set[buf[0] % set.length];
  };

  if (options.lowercase) {
    allChars += lower;
    requiredChars.push(pickRandom(lower));
  }
  if (options.uppercase) {
    allChars += upper;
    requiredChars.push(pickRandom(upper));
  }
  if (options.numbers) {
    allChars += digits;
    requiredChars.push(pickRandom(digits));
  }
  if (options.symbols) {
    allChars += syms;
    requiredChars.push(pickRandom(syms));
  }

  if (!allChars) allChars = lower + upper + digits;

  const remainingLength = Math.max(0, options.length - requiredChars.length);
  const randomArray = new Uint32Array(remainingLength);
  crypto.getRandomValues(randomArray);

  const resultList = [...requiredChars];
  for (let i = 0; i < remainingLength; i++) {
    resultList.push(allChars[randomArray[i] % allChars.length]);
  }

  // Mélange cryptographique (Fisher-Yates)
  const shuffleBuf = new Uint32Array(resultList.length);
  crypto.getRandomValues(shuffleBuf);
  for (let i = resultList.length - 1; i > 0; i--) {
    const j = shuffleBuf[i] % (i + 1);
    [resultList[i], resultList[j]] = [resultList[j], resultList[i]];
  }

  return resultList.slice(0, options.length).join('');
}

/**
 * Vérification k-anonymity Have I Been Pwned (HIBP)
 * Hache le mot de passe en SHA-1, envoie uniquement les 5 premiers caractères hex
 * et compare les suffixes retournés sans jamais divulguer le mot de passe réel.
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

  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' }
    });
    if (!res.ok) return 0;
    const text = await res.text();
    const lines = text.split('\n');
    for (const line of lines) {
      const [hashSuffix, countStr] = line.trim().split(':');
      if (hashSuffix === suffix) {
        return parseInt(countStr, 10) || 0;
      }
    }
    return 0;
  } catch {
    // Mode hors-ligne ou bloqué par le réseau
    return 0;
  }
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

