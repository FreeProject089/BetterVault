/**
 * Pastille d'une personne : son initiale, sur une couleur tirée de son adresse.
 *
 * La couleur est calculée, jamais stockée : deux appareils affichent la même
 * sans rien synchroniser, et une adresse inconnue a déjà sa couleur. Les
 * teintes évitent la plage rouge réservée aux alertes.
 */

/** Teinte stable d'une adresse, entre 0 et 359, en évitant le rouge (340–20) */
export function memberHue(email: string): number {
  let hash = 0;
  for (const char of email.toLowerCase()) hash = (hash * 31 + char.codePointAt(0)!) % 100_000;
  return 30 + (hash % 300);
}

/** Initiale affichée : la première lettre ou chiffre de l'adresse */
export function memberInitial(email: string): string {
  const char = [...email.trim()].find(c => /[\p{L}\p{N}]/u.test(c));
  return (char ?? '?').toUpperCase();
}

export interface ChipOptions {
  /** Taille du disque en pixels (26 par défaut) */
  size?: number;
  /** Adresse de la personne connectée : sa pastille est marquée */
  me?: string;
  title?: string;
}

/**
 * Pastille seule. `escape` est passé par l'appelant : ce module ne fabrique pas
 * d'échappement de son côté, pour qu'il n'y en ait qu'un dans le projet.
 */
export function memberAvatarHtml(email: string, escape: (value: string) => string, options: ChipOptions = {}): string {
  const size = options.size ?? 26;
  const hue = memberHue(email);
  const self = !!options.me && options.me.toLowerCase() === email.toLowerCase();
  const title = escape(options.title ?? email);
  return `<span class="member-dot${self ? ' member-dot-self' : ''}" style="--dot-hue:${hue};--dot-size:${size}px" title="${title}" aria-hidden="true">${escape(memberInitial(email))}</span>`;
}

/** Pastille suivie de l'adresse, pour une ligne de liste */
export function memberChipHtml(email: string, escape: (value: string) => string, options: ChipOptions = {}): string {
  return `<span class="member-chip">${memberAvatarHtml(email, escape, options)}<span class="member-chip-text">${escape(email)}</span></span>`;
}
