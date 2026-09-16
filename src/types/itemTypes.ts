import type { TabIconName } from '../ui/tabIcons';

/**
 * Types d'éléments d'un coffre. « login » est le type historique : un élément sans
 * type enregistré en est un, ce qui rend la migration des anciens coffres inutile.
 *
 * Chaque type range ses champs propres dans sa propre clé de l'élément (`card`,
 * `identity`, `sshKey`) ; les champs communs (nom, notes, tags, pièces jointes,
 * champs personnalisés) restent partagés par tous.
 */
export type ItemType = 'login' | 'note' | 'card' | 'identity' | 'sshKey' | 'file' | 'folder';

export const ITEM_TYPES: ItemType[] = ['login', 'note', 'card', 'identity', 'sshKey', 'file', 'folder'];

export const DEFAULT_ITEM_TYPE: ItemType = 'login';

/** Carte bancaire ou de fidélité */
export interface CardData {
  number: string;
  holder: string;
  /** « MM » et « AAAA », vides si la carte n'expire pas */
  expMonth: string;
  expYear: string;
  cvv: string;
  pin: string;
  /** Réseau détecté depuis le numéro (Visa, Mastercard…), à titre indicatif */
  brand?: string;
}

/** Pièce d'identité, coordonnées */
export interface IdentityData {
  firstName: string;
  lastName: string;
  birthDate: string;
  email: string;
  phone: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  docNumber: string;
}

/** Clé SSH ou GPG */
export interface SshKeyData {
  privateKey: string;
  publicKey: string;
  passphrase: string;
  fingerprint?: string;
}

export const EMPTY_CARD: CardData = { number: '', holder: '', expMonth: '', expYear: '', cvv: '', pin: '' };
export const EMPTY_IDENTITY: IdentityData = {
  firstName: '', lastName: '', birthDate: '', email: '', phone: '',
  address: '', postalCode: '', city: '', country: '', docNumber: ''
};
export const EMPTY_SSH_KEY: SshKeyData = { privateKey: '', publicKey: '', passphrase: '' };

export interface ItemTypeInfo {
  icon: TabIconName;
  fr: string;
  en: string;
  /** Phrase affichée sous le nom du type au moment de le choisir */
  hintFr: string;
  hintEn: string;
}

export const ITEM_TYPE_INFO: Record<ItemType, ItemTypeInfo> = {
  login: {
    icon: 'typeLogin', fr: 'Identifiant', en: 'Login',
    hintFr: 'Site ou application, avec mot de passe et 2FA',
    hintEn: 'Site or app, with password and 2FA'
  },
  note: {
    icon: 'typeNote', fr: 'Note sécurisée', en: 'Secure note',
    hintFr: 'Texte libre, chiffré comme le reste',
    hintEn: 'Free text, encrypted like everything else'
  },
  card: {
    icon: 'typeCard', fr: 'Carte bancaire', en: 'Payment card',
    hintFr: 'Numéro, date d’expiration, cryptogramme et code',
    hintEn: 'Number, expiry, security code and PIN'
  },
  identity: {
    icon: 'typeIdentity', fr: 'Identité', en: 'Identity',
    hintFr: 'État civil, coordonnées, numéro de pièce d’identité',
    hintEn: 'Personal details, contact info, document number'
  },
  sshKey: {
    icon: 'typeSshKey', fr: 'Clé SSH', en: 'SSH key',
    hintFr: 'Clé privée, clé publique et phrase de passe',
    hintEn: 'Private key, public key and passphrase'
  },
  file: {
    icon: 'typeFile', fr: 'Fichier', en: 'File',
    hintFr: 'Un document chiffré, gardé tel quel',
    hintEn: 'One encrypted document, kept as is'
  },
  folder: {
    icon: 'typeFolder', fr: 'Dossier de fichiers', en: 'File folder',
    hintFr: 'Plusieurs fichiers réunis dans un même élément',
    hintEn: 'Several files gathered in one item'
  }
};

/** Types dont le contenu est constitué de pièces jointes plutôt que de champs */
export const FILE_TYPES: ItemType[] = ['file', 'folder'];

export const isFileType = (type: ItemType): boolean => FILE_TYPES.includes(type);

/** Un élément sans type enregistré est un identifiant (coffres d'avant les types) */
export function itemTypeOf(value: unknown): ItemType {
  return ITEM_TYPES.includes(value as ItemType) ? (value as ItemType) : DEFAULT_ITEM_TYPE;
}

/** Réseau de la carte d'après son numéro, à titre indicatif */
export function cardBrand(number: string): string | undefined {
  const digits = number.replace(/\D/g, '');
  if (/^4/.test(digits)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'Mastercard';
  if (/^3[47]/.test(digits)) return 'American Express';
  if (/^(6011|65|64[4-9])/.test(digits)) return 'Discover';
  if (/^35/.test(digits)) return 'JCB';
  if (/^3(0[0-5]|[68])/.test(digits)) return 'Diners Club';
  return undefined;
}

/** Groupes de 4 chiffres, ou de 4-6-5 pour American Express */
export function formatCardNumber(number: string): string {
  const digits = number.replace(/\D/g, '').slice(0, 19);
  const groups = /^3[47]/.test(digits) ? [4, 6, 5] : [4, 4, 4, 4, 3];
  const parts: string[] = [];
  let index = 0;
  for (const size of groups) {
    if (index >= digits.length) break;
    parts.push(digits.slice(index, index + size));
    index += size;
  }
  return parts.join(' ');
}

/** Contrôle de Luhn : une faute de frappe dans le numéro se voit tout de suite */
export function isLuhnValid(number: string): boolean {
  const digits = number.replace(/\D/g, '');
  if (digits.length < 12) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let value = digits.charCodeAt(i) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

const SSH_KEY_HEAD = /-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----/;

/** Vrai si le texte ressemble à une clé privée au format PEM/OpenSSH */
export function looksLikePrivateKey(value: string): boolean {
  return SSH_KEY_HEAD.test(value.trim());
}
