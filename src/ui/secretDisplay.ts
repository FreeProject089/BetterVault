/**
 * Affichage d'un secret à recopier : clé de secours (52 caractères) et clé de configuration 2FA.
 * Les groupes sont numérotés pour se repérer quand on la recopie à la main ou sur papier.
 */

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);

/** Découpe en groupes de `size` caractères, séparateurs existants ignorés */
export function secretGroups(secret: string, size = 4): string[] {
  const clean = secret.replace(/[\s-]/g, '');
  return clean.match(new RegExp(`.{1,${size}}`, 'g')) ?? [];
}

/**
 * Grille de groupes numérotés.
 * `numbered` : affiche la position de chaque groupe (utile pour une clé longue).
 */
export function secretGridHtml(secret: string, options: { size?: number; numbered?: boolean } = {}): string {
  const groups = secretGroups(secret, options.size ?? 4);
  const numbered = options.numbered ?? groups.length > 6;
  return `<div class="secret-grid${numbered ? ' numbered' : ''}" role="group">
    ${groups.map((group, index) => `<span class="secret-group">${numbered ? `<i>${index + 1}</i>` : ''}<b>${escapeHtml(group)}</b></span>`).join('')}
  </div>`;
}
