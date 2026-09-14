/**
 * Icônes choisies pour un identifiant ou un coffre : Simple Icons (logos de marques), Lucide ou Phosphor.
 *
 * L'icône choisie est copiée dans l'élément (tracé SVG nettoyé) : l'affichage ne charge aucune bibliothèque.
 * Les bibliothèques ne sont chargées qu'à l'ouverture du sélecteur.
 */

export type IconSet = 'simple' | 'lucide' | 'phosphor';

export interface ItemIcon {
  set: IconSet;
  name: string;
  title?: string;
  /** Couleur de marque (Simple Icons), sans # */
  hex?: string;
  /** Contenu SVG nettoyé (éléments de forme uniquement) */
  body: string;
}

export interface IconEntry extends ItemIcon {
  keywords: string;
}

const VIEWBOX: Record<IconSet, string> = {
  simple: '0 0 24 24',
  lucide: '0 0 24 24',
  phosphor: '0 0 256 256'
};

export const ICON_SET_LABELS: Record<IconSet, string> = {
  simple: 'Simple Icons',
  lucide: 'Lucide',
  phosphor: 'Phosphor'
};

/* ── Nettoyage ─────────────────────────────────────────────────────────── */

const ALLOWED_TAGS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g']);
const ALLOWED_ATTRS = new Set(['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points', 'transform', 'fill-rule', 'clip-rule', 'opacity', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin']);
const SAFE_VALUE = /^[-\w\s.,#%()]*$/;
const ELEMENT = /<\s*(\/?)\s*([a-z]+)((?:\s+[a-z-]+\s*=\s*"[^"]*")*)\s*(\/?)\s*>/gi;
const ATTRIBUTE = /([a-z-]+)\s*=\s*"([^"]*)"/gi;

/** Ne garde que des formes SVG et des attributs géométriques : aucun script, lien ou style ne passe */
export function sanitizeIconBody(body: string): string {
  if (typeof body !== 'string' || body.length > 20_000) return '';
  let out = '';
  let lastIndex = 0;
  for (const match of body.matchAll(ELEMENT)) {
    if (body.slice(lastIndex, match.index).trim()) return '';
    lastIndex = match.index! + match[0].length;
    const [, closing, tag, attrs, selfClosing] = match;
    const name = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return '';
    if (closing) {
      out += `</${name}>`;
      continue;
    }
    let cleanAttrs = '';
    for (const [, attr, value] of attrs.matchAll(ATTRIBUTE)) {
      const key = attr.toLowerCase();
      if (!ALLOWED_ATTRS.has(key) || !SAFE_VALUE.test(value)) return '';
      cleanAttrs += ` ${key}="${value}"`;
    }
    out += `<${name}${cleanAttrs}${selfClosing ? '/' : ''}>`;
  }
  return body.slice(lastIndex).trim() ? '' : out;
}

export function normalizeItemIcon(input: unknown): ItemIcon | undefined {
  const icon = input as Partial<ItemIcon> | null;
  if (!icon || typeof icon !== 'object') return undefined;
  if (icon.set !== 'simple' && icon.set !== 'lucide' && icon.set !== 'phosphor') return undefined;
  const body = sanitizeIconBody(String(icon.body ?? ''));
  if (!body || typeof icon.name !== 'string') return undefined;
  const hex = typeof icon.hex === 'string' && /^[0-9a-f]{6}$/i.test(icon.hex) ? icon.hex : undefined;
  return { set: icon.set, name: icon.name.slice(0, 80), title: typeof icon.title === 'string' ? icon.title.slice(0, 80) : undefined, hex, body };
}

/* ── Couleurs de marque lisibles dans les deux thèmes ───────────────────── */

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** Couleur de marque adaptée au fond : un logo noir devient clair sur fond sombre, un logo blanc devient foncé sur fond clair */
export function brandColors(hex: string): { onDark: string; onLight: string } {
  const lum = luminance(hex);
  return {
    onDark: lum < 0.06 ? '#e6edf3' : lum < 0.16 ? `color-mix(in srgb, #${hex} 55%, #ffffff)` : `#${hex}`,
    onLight: lum > 0.8 ? '#1f2328' : lum > 0.55 ? `color-mix(in srgb, #${hex} 60%, #000000)` : `#${hex}`
  };
}

export function renderItemIcon(icon: ItemIcon, size = 20): string {
  const title = icon.title ? `<title>${icon.title.replace(/[<>&"]/g, '')}</title>` : '';
  if (icon.set === 'simple') {
    const colors = icon.hex ? brandColors(icon.hex) : null;
    const style = colors ? ` style="--brand-on-dark:${colors.onDark};--brand-on-light:${colors.onLight}"` : '';
    return `<svg class="svc-icon brand" width="${size}" height="${size}" viewBox="${VIEWBOX.simple}" fill="currentColor" aria-hidden="true"${style}>${title}${icon.body}</svg>`;
  }
  if (icon.set === 'lucide') {
    return `<svg class="svc-icon" width="${size}" height="${size}" viewBox="${VIEWBOX.lucide}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${title}${icon.body}</svg>`;
  }
  return `<svg class="svc-icon" width="${size}" height="${size}" viewBox="${VIEWBOX.phosphor}" fill="currentColor" aria-hidden="true">${title}${icon.body}</svg>`;
}

/* ── Chargement des bibliothèques ──────────────────────────────────────── */

const cache = new Map<IconSet, Promise<IconEntry[]>>();

const kebab = (pascal: string) => pascal.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase();

async function loadSet(set: IconSet): Promise<IconEntry[]> {
  if (set === 'simple') {
    const { default: rows } = await import('virtual:bettervault-icons/simple');
    return rows.map(([slug, title, hex, path]) => ({ set, name: slug, title, hex, body: `<path d="${path}"/>`, keywords: `${title} ${slug}`.toLowerCase() }));
  }
  if (set === 'lucide') {
    const { icons } = await import('lucide');
    return Object.entries(icons as unknown as Record<string, Array<[string, Record<string, string | number>]>>).map(([pascal, nodes]) => {
      const name = kebab(pascal);
      const body = nodes.map(([tag, attrs]) => `<${tag}${Object.entries(attrs).map(([k, v]) => ` ${k}="${v}"`).join('')}/>`).join('');
      return { set, name, title: name.replace(/-/g, ' '), body, keywords: name.replace(/-/g, ' ') };
    });
  }
  const { default: rows } = await import('virtual:bettervault-icons/phosphor');
  return rows.map(([name, keywords, body]) => ({ set, name, title: name.replace(/-/g, ' '), body, keywords: `${name.replace(/-/g, ' ')} ${keywords}`.toLowerCase() }));
}

export function loadIconSet(set: IconSet): Promise<IconEntry[]> {
  let promise = cache.get(set);
  if (!promise) {
    promise = loadSet(set).catch(err => {
      cache.delete(set);
      throw err;
    });
    cache.set(set, promise);
  }
  return promise;
}

/** Recherche : correspondance exacte du nom, puis début de nom, puis mot-clé */
export function searchIcons(entries: IconEntry[], query: string, limit = 160): IconEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries.slice(0, limit);
  const exact: IconEntry[] = [];
  const prefix: IconEntry[] = [];
  const other: IconEntry[] = [];
  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    const title = (entry.title ?? '').toLowerCase();
    if (name === q || title === q) exact.push(entry);
    else if (name.startsWith(q) || title.startsWith(q)) prefix.push(entry);
    else if (entry.keywords.includes(q)) other.push(entry);
    if (exact.length >= limit) break;
  }
  return [...exact, ...prefix, ...other].slice(0, limit);
}

/** Icône de marque correspondant à un domaine (ex. github.com → GitHub), si Simple Icons est déjà chargé ou chargeable */
export async function findBrandIcon(domainOrTitle: string): Promise<ItemIcon | undefined> {
  const key = domainOrTitle.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/.:]/)[0].replace(/[^a-z0-9]/g, '');
  if (key.length < 2) return undefined;
  const entries = await loadIconSet('simple');
  const match = entries.find(e => e.name === key) ?? entries.find(e => (e.title ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') === key);
  return match ? { set: match.set, name: match.name, title: match.title, hex: match.hex, body: match.body } : undefined;
}
