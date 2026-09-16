import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { localizeMessage, requestLocale } from '../server/src/messages.ts';

const serverDir = join(import.meta.dirname, '..', 'server', 'src');
const sources = readdirSync(serverDir).filter(f => f.endsWith('.ts')).map(f => readFileSync(join(serverDir, f), 'utf8')).join('\n');

describe('Messages de l’API traduits', () => {
  it('chaque message d’erreur écrit en dur a sa traduction anglaise', () => {
    const literal = [...sources.matchAll(/HttpError\(\d+, '[a-z_]+', '([^']+)'/g)].map(m => m[1]);
    expect(literal.length).toBeGreaterThan(50);
    const missing = [...new Set(literal)].filter(message => localizeMessage(message, 'en') === message);
    expect(missing).toEqual([]);
  });

  it('traduit les messages avec une valeur', () => {
    expect(localizeMessage('Champ « email » invalide', 'en')).toBe('Invalid field "email"');
    expect(localizeMessage('Espace de stockage plein (500 Mo)', 'en')).toBe('Storage full (500 MB)');
    expect(localizeMessage('Espace de stockage plein (500 Mo)', 'fr')).toBe('Espace de stockage plein (500 Mo)');
  });

  it('choisit la langue d’après Accept-Language', () => {
    const req = (value?: string) => ({ headers: value ? { 'accept-language': value } : {} }) as never;
    expect(requestLocale(req('en-GB,en;q=0.9'))).toBe('en');
    expect(requestLocale(req('fr-CA'))).toBe('fr');
    expect(requestLocale(req('de-DE'))).toBe('en');
    expect(requestLocale(req())).toBe('fr');
  });
});

describe('Messages de l’application traduits', async () => {
  const { translateError } = await import('../src/i18n/errorMessages');
  const srcDir = join(import.meta.dirname, '..', 'src');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) files.push(path);
    }
  };
  walk(srcDir);
  const code = files.map(f => readFileSync(f, 'utf8')).join('\n');

  it('chaque erreur levée avec un message fixe a sa traduction', () => {
    const literal = [...code.matchAll(/throw new [A-Za-z]*Error\('([^']+)'/g)].map(m => m[1]);
    // Les codes internes d'un seul mot (« kdbx ») ne sont pas affichés
    const missing = [...new Set(literal)].filter(message => message.includes(' ') && translateError(message, 'en') === message);
    expect(missing).toEqual([]);
  });

  it('traduit les messages avec une valeur et laisse le français intact', () => {
    expect(translateError('Limite de 20 types de coffres atteinte', 'en')).toBe('Limit of 20 vault types reached');
    expect(translateError('Enregistrement impossible : Coffre verrouillé', 'en')).toBe('Could not save: Vault locked');
    expect(translateError('Coffre verrouillé', 'fr')).toBe('Coffre verrouillé');
  });
});
