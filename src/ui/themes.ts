/**
 * Thèmes personnalisés : un petit fichier JSON qui remplace les couleurs de
 * l'interface. Seules des couleurs hexadécimales, sur une liste fermée de
 * variables, sont acceptées : un thème ne peut ni charger une ressource, ni
 * injecter du CSS. Il est gardé sur l'appareil, rien n'est envoyé au serveur.
 */

export const THEME_FORMAT = 'bettervault.theme';
const STORAGE_KEY = 'bettervault.theme.custom';

/** Variables CSS qu'un thème peut changer */
export const THEME_COLORS = [
  'bg-primary', 'bg-secondary', 'bg-tertiary', 'bg-hover',
  'border-subtle', 'border-muted',
  'text-primary', 'text-secondary', 'text-muted',
  'accent', 'accent-strong', 'accent-green', 'accent-red', 'accent-orange'
] as const;
export type ThemeColor = typeof THEME_COLORS[number];

export interface ThemeFile {
  format: typeof THEME_FORMAT;
  version: 1;
  name: string;
  base: 'dark' | 'light';
  colors: Partial<Record<ThemeColor, string>>;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export class ThemeError extends Error {}

const expand = (hex: string) => (hex.length === 4 ? `#${[...hex.slice(1)].map(c => c + c).join('')}` : hex).toLowerCase();

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(expand(hex).slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rapport de contraste WCAG entre deux couleurs */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Lit et vérifie un thème ; lève ThemeError avec un message à montrer tel quel */
export function parseTheme(input: unknown): ThemeFile {
  const t = input as Partial<ThemeFile> | null;
  if (!t || typeof t !== 'object' || t.format !== THEME_FORMAT || t.version !== 1) throw new ThemeError('Ce fichier n’est pas un thème BetterVault');
  const name = String(t.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!name) throw new ThemeError('Le thème n’a pas de nom');
  const base = t.base === 'light' ? 'light' : 'dark';
  const colors: ThemeFile['colors'] = {};
  for (const [key, value] of Object.entries(t.colors ?? {})) {
    if (!(THEME_COLORS as readonly string[]).includes(key)) continue;
    if (typeof value !== 'string' || !HEX.test(value)) throw new ThemeError(`Couleur invalide pour « ${key} » : utilisez #rrggbb`);
    colors[key as ThemeColor] = expand(value);
  }
  const text = colors['text-primary'];
  const background = colors['bg-primary'];
  if (text && background && contrast(text, background) < 4.5) {
    throw new ThemeError('Texte trop peu lisible sur le fond (contraste inférieur à 4,5:1)');
  }
  return { format: THEME_FORMAT, version: 1, name, base, colors };
}

export const PRESET_THEMES: ThemeFile[] = [
  {
    format: THEME_FORMAT, version: 1, name: 'Nord', base: 'dark',
    colors: {
      'bg-primary': '#2e3440', 'bg-secondary': '#3b4252', 'bg-tertiary': '#434c5e', 'bg-hover': '#4c566a',
      'border-subtle': '#4c566a', 'border-muted': '#434c5e',
      'text-primary': '#eceff4', 'text-secondary': '#d8dee9', 'text-muted': '#a3abb9',
      accent: '#88c0d0', 'accent-strong': '#5e81ac', 'accent-green': '#a3be8c', 'accent-red': '#bf616a', 'accent-orange': '#d08770'
    }
  },
  {
    format: THEME_FORMAT, version: 1, name: 'Sable', base: 'light',
    colors: {
      'bg-primary': '#fdf6e3', 'bg-secondary': '#f5ecd4', 'bg-tertiary': '#eee3c4', 'bg-hover': '#e4d8b4',
      'border-subtle': '#d9cba3', 'border-muted': '#e8dcbc',
      'text-primary': '#3a3222', 'text-secondary': '#5f5642', 'text-muted': '#877d66',
      accent: '#b35c00', 'accent-strong': '#8a4600', 'accent-green': '#5f7a00', 'accent-red': '#c0392b', 'accent-orange': '#b58900'
    }
  },
  {
    format: THEME_FORMAT, version: 1, name: 'Contraste élevé', base: 'dark',
    colors: {
      'bg-primary': '#000000', 'bg-secondary': '#0a0a0a', 'bg-tertiary': '#1a1a1a', 'bg-hover': '#2a2a2a',
      'border-subtle': '#ffffff', 'border-muted': '#8a8a8a',
      'text-primary': '#ffffff', 'text-secondary': '#f0f0f0', 'text-muted': '#d0d0d0',
      accent: '#ffd400', 'accent-strong': '#ffea70', 'accent-green': '#3dff7a', 'accent-red': '#ff5c5c', 'accent-orange': '#ffae00'
    }
  }
];

/** Modèle à télécharger : les couleurs du thème sombre par défaut, prêtes à modifier */
export function themeTemplate(): string {
  const read = (name: ThemeColor) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  const colors = Object.fromEntries(THEME_COLORS.map(name => [name, HEX.test(read(name)) ? expand(read(name)) : '#000000']));
  return JSON.stringify({ format: THEME_FORMAT, version: 1, name: 'Mon thème', base: 'dark', colors }, null, 2);
}

/** Applique un thème (ou le retire) : propriétés posées une à une, jamais de texte CSS */
export function applyTheme(theme: ThemeFile | null): void {
  const root = document.documentElement;
  for (const name of THEME_COLORS) root.style.removeProperty(`--${name}`);
  root.style.removeProperty('--accent-rgb');
  if (!theme) {
    // Retour au clair ou au sombre choisi auparavant avec le bouton de l'en-tête
    let light = false;
    try { light = localStorage.getItem('bettervault.theme') === 'light'; } catch { /* stockage indisponible */ }
    if (light) root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
    return;
  }
  if (theme.base === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
  for (const [name, value] of Object.entries(theme.colors)) root.style.setProperty(`--${name}`, value);
  const accent = theme.colors.accent;
  if (accent) root.style.setProperty('--accent-rgb', [1, 3, 5].map(i => parseInt(accent.slice(i, i + 2), 16)).join(', '));
}

export function loadSavedTheme(): ThemeFile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseTheme(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveTheme(theme: ThemeFile | null): void {
  try {
    if (theme) localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Stockage indisponible : le thème vaut pour cette session
  }
  applyTheme(theme);
}
