import { describe, it, expect } from 'vitest';
import { parseImportFile } from '../src/import_export/importEngine';

describe('Import Passky', () => {
  it('lit un export JSON non chiffré', () => {
    const file = JSON.stringify({
      encrypted: false,
      passwords: [
        { website: 'github.com', username: 'octo', password: 'mot-de-passe-1', message: 'compte perso' },
        { website: 'https://www.exemple.fr/connexion', username: 'moi@exemple.fr', password: 'mot-de-passe-2', message: '' }
      ]
    });
    const result = parseImportFile(file, 'passky_passwords.json');
    expect(result.sourceFormat).toBe('Passky JSON');
    expect(result.count).toBe(2);
    expect(result.credentials[0]).toMatchObject({ title: 'github.com', website: 'https://github.com', username: 'octo', password: 'mot-de-passe-1', notes: 'compte perso' });
    expect(result.credentials[1]).toMatchObject({ title: 'exemple.fr', website: 'https://www.exemple.fr/connexion' });
  });

  it('refuse un export chiffré avec une explication', () => {
    const file = JSON.stringify({ encrypted: true, passwords: [{ website: 'x', username: 'y', password: 'chiffré', message: '' }] });
    expect(() => parseImportFile(file)).toThrow(/non chiffré/);
  });
});
