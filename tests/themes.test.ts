import { describe, it, expect } from 'vitest';
import { contrast, parseTheme, PRESET_THEMES, THEME_FORMAT } from '../src/ui/themes';

/** Thèmes personnalisés : seules des couleurs sûres et lisibles passent */

const base = { format: THEME_FORMAT, version: 1, name: 'Essai', base: 'dark' };

describe('Thèmes personnalisés', () => {
  it('accepte un thème valide et ignore les variables inconnues', () => {
    const t = parseTheme({ ...base, colors: { accent: '#ABC', 'font-sans': 'Comic Sans', 'bg-primary': '#101010', 'text-primary': '#f0f0f0' } });
    expect(t.colors).toEqual({ accent: '#aabbcc', 'bg-primary': '#101010', 'text-primary': '#f0f0f0' });
  });

  it('refuse tout ce qui n’est pas une couleur hexadécimale (pas d’injection CSS)', () => {
    for (const value of ['red', 'url(https://evil.example/x.png)', '#fff; background:url(x)', 'var(--x)', 'expression(alert(1))']) {
      expect(() => parseTheme({ ...base, colors: { accent: value } })).toThrow();
    }
  });

  it('refuse un texte illisible sur son fond', () => {
    expect(() => parseTheme({ ...base, colors: { 'bg-primary': '#777777', 'text-primary': '#888888' } })).toThrow(/contraste/);
  });

  it('refuse un fichier qui n’est pas un thème', () => {
    expect(() => parseTheme({ name: 'x', colors: {} })).toThrow();
    expect(() => parseTheme({ ...base, name: '   ' })).toThrow();
  });

  it('les thèmes intégrés sont valides et lisibles', () => {
    for (const preset of PRESET_THEMES) {
      expect(parseTheme(preset).name).toBe(preset.name);
      expect(contrast(preset.colors['text-primary']!, preset.colors['bg-primary']!)).toBeGreaterThanOrEqual(7);
    }
  });
});
