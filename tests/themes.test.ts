import { describe, it, expect } from 'vitest';
import { contrast, hasBothModes, parseTheme, PRESET_THEMES, THEME_FORMAT, variantFor } from '../src/ui/themes';

/**
 * Thèmes personnalisés : seules des couleurs sûres et lisibles passent, et
 * chaque thème porte son jeu sombre et son jeu clair.
 */

const v1 = { format: THEME_FORMAT, version: 1, name: 'Essai', base: 'dark' };
const v2 = (variants: unknown) => ({ format: THEME_FORMAT, version: 2, name: 'Essai', variants });

describe('Thèmes personnalisés', () => {
  it('accepte un thème valide et ignore les variables inconnues', () => {
    const t = parseTheme({ ...v1, colors: { accent: '#ABC', 'font-sans': 'Comic Sans', 'bg-primary': '#101010', 'text-primary': '#f0f0f0' } });
    expect(t.variants.dark).toEqual({ accent: '#aabbcc', 'bg-primary': '#101010', 'text-primary': '#f0f0f0' });
  });

  it('refuse tout ce qui n’est pas une couleur hexadécimale (pas d’injection CSS)', () => {
    for (const value of ['red', 'url(https://evil.example/x.png)', '#fff; background:url(x)', 'var(--x)', 'expression(alert(1))']) {
      expect(() => parseTheme({ ...v1, colors: { accent: value } })).toThrow();
      expect(() => parseTheme(v2({ light: { accent: value } }))).toThrow();
    }
  });

  it('refuse un texte illisible sur son fond, dans l’un ou l’autre mode', () => {
    expect(() => parseTheme({ ...v1, colors: { 'bg-primary': '#777777', 'text-primary': '#888888' } })).toThrow(/contraste/);
    // Le jeu sombre est bon, le jeu clair ne l'est pas : le thème entier est refusé,
    // et le message nomme le mode à corriger.
    expect(() => parseTheme(v2({
      dark: { 'bg-primary': '#101010', 'text-primary': '#f0f0f0' },
      light: { 'bg-primary': '#eeeeee', 'text-primary': '#dddddd' }
    }))).toThrow(/fond clair/);
  });

  it('refuse un fichier qui n’est pas un thème', () => {
    expect(() => parseTheme({ name: 'x', colors: {} })).toThrow();
    expect(() => parseTheme({ ...v1, name: '   ' })).toThrow();
    expect(() => parseTheme({ format: THEME_FORMAT, version: 3, name: 'x' })).toThrow();
    expect(() => parseTheme(v2({}))).toThrow(/aucune couleur/);
  });

  it('garde les deux jeux d’un thème de version 2', () => {
    const t = parseTheme(v2({
      dark: { 'bg-primary': '#101010', 'text-primary': '#f0f0f0', accent: '#8888ff' },
      light: { 'bg-primary': '#ffffff', 'text-primary': '#111111', accent: '#2222aa' }
    }));
    expect(hasBothModes(t)).toBe(true);
    expect(variantFor(t, 'light').colors['bg-primary']).toBe('#ffffff');
    expect(variantFor(t, 'dark').colors['bg-primary']).toBe('#101010');
  });

  it('un thème d’ancienne génération garde son seul jeu, quel que soit le mode', () => {
    const t = parseTheme({ ...v1, base: 'light', colors: { 'bg-primary': '#ffffff', 'text-primary': '#111111' } });
    expect(hasBothModes(t)).toBe(false);
    // On demande le sombre : il n'existe pas, donc on applique le clair plutôt
    // que de laisser l'interface sans couleurs.
    const applique = variantFor(t, 'dark');
    expect(applique.mode).toBe('light');
    expect(applique.colors['bg-primary']).toBe('#ffffff');
  });

  it('les thèmes intégrés ont les deux modes, valides et lisibles', () => {
    for (const preset of PRESET_THEMES) {
      expect(parseTheme(preset).name).toBe(preset.name);
      expect(hasBothModes(preset)).toBe(true);
      for (const mode of ['dark', 'light'] as const) {
        const colors = preset.variants[mode]!;
        // 7:1, le niveau AAA : un thème intégré ne doit jamais être le point faible
        expect(contrast(colors['text-primary']!, colors['bg-primary']!)).toBeGreaterThanOrEqual(7);
        // Les couleurs d'accent servent à écrire sur le fond : 3:1 au minimum
        for (const key of ['accent', 'accent-green', 'accent-red', 'accent-orange'] as const) {
          expect(contrast(colors[key]!, colors['bg-primary']!), `${preset.name} ${mode} ${key}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });
});
