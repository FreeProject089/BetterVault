/**
 * Thèmes personnalisés : un petit fichier JSON qui remplace les couleurs de
 * l'interface. Seules des couleurs hexadécimales, sur une liste fermée de
 * variables, sont acceptées : un thème ne peut ni charger une ressource, ni
 * injecter du CSS. Il est gardé sur l'appareil, rien n'est envoyé au serveur.
 *
 * Un thème porte **deux jeux de couleurs**, un sombre et un clair : le bouton
 * clair / sombre de l'en-tête change de jeu sans quitter le thème. Les
 * fichiers de la première version n'en portaient qu'un ; ils restent lisibles
 * et ne proposent que celui-là.
 */

export const THEME_FORMAT = 'bettervault.theme';
const STORAGE_KEY = 'bettervault.theme.custom';
const MODE_KEY = 'bettervault.theme';

/** Variables CSS qu'un thème peut changer */
export const THEME_COLORS = [
  'bg-primary', 'bg-secondary', 'bg-tertiary', 'bg-hover',
  'border-subtle', 'border-muted',
  'text-primary', 'text-secondary', 'text-muted',
  'accent', 'accent-strong', 'accent-green', 'accent-red', 'accent-orange'
] as const;
export type ThemeColor = typeof THEME_COLORS[number];
export type ThemeMode = 'dark' | 'light';
export type ThemeColors = Partial<Record<ThemeColor, string>>;

export interface ThemeFile {
  format: typeof THEME_FORMAT;
  version: 1 | 2;
  name: string;
  /** Jeu de couleurs par mode ; au moins un des deux est présent */
  variants: Partial<Record<ThemeMode, ThemeColors>>;
}

/** Fichier tel qu'il circule : version 1 (un seul jeu, « base » + « colors ») ou 2 (« variants ») */
interface ThemeFileIncoming {
  format?: unknown;
  version?: unknown;
  name?: unknown;
  base?: unknown;
  colors?: unknown;
  variants?: unknown;
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

/** Vérifie un jeu de couleurs : hexadécimal, variables connues, texte lisible */
function parseColors(input: unknown, mode: ThemeMode): ThemeColors {
  const colors: ThemeColors = {};
  for (const [key, value] of Object.entries((input ?? {}) as Record<string, unknown>)) {
    if (!(THEME_COLORS as readonly string[]).includes(key)) continue;
    if (typeof value !== 'string' || !HEX.test(value)) throw new ThemeError(`Couleur invalide pour « ${key} » : utilisez #rrggbb`);
    colors[key as ThemeColor] = expand(value);
  }
  const text = colors['text-primary'];
  const background = colors['bg-primary'];
  if (text && background && contrast(text, background) < 4.5) {
    // Le mode est nommé : sur un thème à deux jeux, il faut savoir lequel corriger
    throw new ThemeError(
      mode === 'light'
        ? 'Texte trop peu lisible sur le fond clair (contraste inférieur à 4,5:1)'
        : 'Texte trop peu lisible sur le fond (contraste inférieur à 4,5:1)'
    );
  }
  return colors;
}

/** Lit et vérifie un thème ; lève ThemeError avec un message à montrer tel quel */
export function parseTheme(input: unknown): ThemeFile {
  const t = input as ThemeFileIncoming | null;
  if (!t || typeof t !== 'object' || t.format !== THEME_FORMAT || (t.version !== 1 && t.version !== 2)) {
    throw new ThemeError('Ce fichier n’est pas un thème BetterVault');
  }
  const name = String(t.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!name) throw new ThemeError('Le thème n’a pas de nom');

  const variants: ThemeFile['variants'] = {};
  if (t.version === 2) {
    const source = (t.variants ?? {}) as Record<string, unknown>;
    for (const mode of ['dark', 'light'] as const) {
      if (source[mode] !== undefined) variants[mode] = parseColors(source[mode], mode);
    }
    if (!variants.dark && !variants.light) throw new ThemeError('Le thème n’a aucune couleur');
  } else {
    // Version 1 : un seul jeu, rangé du côté annoncé par « base »
    const mode: ThemeMode = t.base === 'light' ? 'light' : 'dark';
    variants[mode] = parseColors(t.colors, mode);
  }
  return { format: THEME_FORMAT, version: t.version as 1 | 2, name, variants };
}

/** Le jeu de couleurs à utiliser pour ce mode, et le mode réellement appliqué */
export function variantFor(theme: ThemeFile, mode: ThemeMode): { mode: ThemeMode; colors: ThemeColors } {
  const wanted = theme.variants[mode];
  if (wanted) return { mode, colors: wanted };
  // Thème d'ancienne génération : il n'a qu'un jeu, on garde le sien
  const other: ThemeMode = mode === 'dark' ? 'light' : 'dark';
  return { mode: other, colors: theme.variants[other] ?? {} };
}

/** Le thème propose-t-il les deux modes ? */
export const hasBothModes = (theme: ThemeFile): boolean => !!theme.variants.dark && !!theme.variants.light;

/** Mode clair ou sombre choisi sur cet appareil */
export function currentMode(): ThemeMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function saveMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Stockage indisponible : le choix vaut pour cette session
  }
}

export const PRESET_THEMES: ThemeFile[] = [
  {
    format: THEME_FORMAT, version: 2, name: 'Nord',
    variants: {
      dark: {
        'bg-primary': '#2e3440', 'bg-secondary': '#3b4252', 'bg-tertiary': '#434c5e', 'bg-hover': '#4c566a',
        'border-subtle': '#4c566a', 'border-muted': '#434c5e',
        'text-primary': '#eceff4', 'text-secondary': '#d8dee9', 'text-muted': '#a3abb9',
        accent: '#88c0d0', 'accent-strong': '#5e81ac', 'accent-green': '#a3be8c', 'accent-red': '#bf616a', 'accent-orange': '#d08770'
      },
      // « Snow Storm », le versant clair de la palette Nord
      light: {
        'bg-primary': '#eceff4', 'bg-secondary': '#e5e9f0', 'bg-tertiary': '#dde3ec', 'bg-hover': '#d2dae6',
        'border-subtle': '#c3ccda', 'border-muted': '#d8dee9',
        'text-primary': '#2e3440', 'text-secondary': '#3b4252', 'text-muted': '#59637a',
        accent: '#2e6f83', 'accent-strong': '#3b5a83', 'accent-green': '#4b6b2f', 'accent-red': '#a3323c', 'accent-orange': '#96542a'
      }
    }
  },
  {
    format: THEME_FORMAT, version: 2, name: 'Sable',
    variants: {
      light: {
        'bg-primary': '#fdf6e3', 'bg-secondary': '#f5ecd4', 'bg-tertiary': '#eee3c4', 'bg-hover': '#e4d8b4',
        'border-subtle': '#d9cba3', 'border-muted': '#e8dcbc',
        'text-primary': '#3a3222', 'text-secondary': '#5f5642', 'text-muted': '#877d66',
        accent: '#b35c00', 'accent-strong': '#8a4600', 'accent-green': '#5f7a00', 'accent-red': '#c0392b', 'accent-orange': '#a67c00'
      },
      // Le même sable, la nuit : fonds bruns chauds, mêmes accents dorés
      dark: {
        'bg-primary': '#221d14', 'bg-secondary': '#2c2619', 'bg-tertiary': '#382f20', 'bg-hover': '#463a28',
        'border-subtle': '#4b3f2b', 'border-muted': '#382f20',
        'text-primary': '#f3e9d2', 'text-secondary': '#ddd0b2', 'text-muted': '#a99a7c',
        accent: '#e0a458', 'accent-strong': '#c88b3c', 'accent-green': '#a3be6c', 'accent-red': '#e08a7a', 'accent-orange': '#d9a441'
      }
    }
  },
  {
    format: THEME_FORMAT, version: 2, name: 'Contraste élevé',
    variants: {
      dark: {
        'bg-primary': '#000000', 'bg-secondary': '#0a0a0a', 'bg-tertiary': '#1a1a1a', 'bg-hover': '#2a2a2a',
        'border-subtle': '#ffffff', 'border-muted': '#8a8a8a',
        'text-primary': '#ffffff', 'text-secondary': '#f0f0f0', 'text-muted': '#d0d0d0',
        accent: '#ffd400', 'accent-strong': '#ffea70', 'accent-green': '#3dff7a', 'accent-red': '#ff5c5c', 'accent-orange': '#ffae00'
      },
      light: {
        'bg-primary': '#ffffff', 'bg-secondary': '#f2f2f2', 'bg-tertiary': '#e6e6e6', 'bg-hover': '#d9d9d9',
        'border-subtle': '#000000', 'border-muted': '#595959',
        'text-primary': '#000000', 'text-secondary': '#141414', 'text-muted': '#3d3d3d',
        accent: '#0033cc', 'accent-strong': '#001f7a', 'accent-green': '#006622', 'accent-red': '#b00018', 'accent-orange': '#8a4b00'
      }
    }
  }
];

/** Aperçu d'un thème dans l'interface : les couleurs du mode en cours */
export const previewColors = (theme: ThemeFile, mode: ThemeMode): ThemeColors => variantFor(theme, mode).colors;

/** Modèle à télécharger : les deux jeux du thème par défaut, prêts à modifier */
export function themeTemplate(): string {
  const read = (name: ThemeColor) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  const actuel = Object.fromEntries(THEME_COLORS.map(name => [name, HEX.test(read(name)) ? expand(read(name)) : '#000000']));
  const mode = currentMode();
  const autre = mode === 'dark' ? 'light' : 'dark';
  return JSON.stringify({
    format: THEME_FORMAT,
    version: 2,
    name: 'Mon thème',
    // Les deux jeux sont présents : c'est le mode en cours qui est prérempli,
    // l'autre part des mêmes valeurs et reste à retoucher.
    variants: { [mode]: actuel, [autre]: actuel }
  }, null, 2);
}

/** Applique un thème (ou le retire) : propriétés posées une à une, jamais de texte CSS */
export function applyTheme(theme: ThemeFile | null, mode: ThemeMode = currentMode()): void {
  const root = document.documentElement;
  for (const name of THEME_COLORS) root.style.removeProperty(`--${name}`);
  root.style.removeProperty('--accent-rgb');
  if (!theme) {
    if (mode === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
    return;
  }
  const variant = variantFor(theme, mode);
  if (variant.mode === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
  for (const [name, value] of Object.entries(variant.colors)) root.style.setProperty(`--${name}`, value);
  const accent = variant.colors.accent;
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

export function saveTheme(theme: ThemeFile | null, mode: ThemeMode = currentMode()): void {
  try {
    if (theme) localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Stockage indisponible : le thème vaut pour cette session
  }
  applyTheme(theme, mode);
}
