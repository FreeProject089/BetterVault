import { describe, it, expect } from 'vitest';
import { normalizeVaultData, isSafeId } from '../src/store/vaultStore';
import { sanitizeIconBody } from '../src/icons/iconLibrary';
import type { UnlockedVaultData } from '../src/types/vault';

/**
 * Un coffre partagé est écrit par quelqu'un d'autre. Un import vient d'un fichier
 * inconnu. Une synchronisation vient d'un autre appareil. Ces trois sources sont
 * hostiles : rien de ce qu'elles apportent ne doit pouvoir sortir de son contexte
 * HTML, ni servir de sélecteur CSS.
 */

const CHARGE = '"><img src=x onerror=alert(1)>';

describe('Coffre hostile : identifiants', () => {
  it('remplace un identifiant qui pourrait sortir d’un attribut', () => {
    const data = normalizeVaultData({
      vaults: [{ id: CHARGE, name: 'Anodin', type: 'personal', createdAt: 1, updatedAt: 1 }],
      credentials: [{ id: '</script><script>x</script>', vaultId: 'v1', title: 'X', username: '', password: '', website: '', domain: '', tags: [], createdAt: 1, updatedAt: 1 }],
      tagDefs: [{ id: 'tag" onmouseover="x', name: 'Tag', color: '#112233', createdAt: 1, updatedAt: 1 }]
    } as Partial<UnlockedVaultData>);

    expect(isSafeId(data.vaults[0].id)).toBe(true);
    expect(isSafeId(data.credentials[0].id)).toBe(true);
    expect(isSafeId(data.tagDefs[0].id)).toBe(true);
    // Le contenu, lui, est conservé : on remplace l'identifiant, on ne jette pas l'élément
    expect(data.vaults[0].name).toBe('Anodin');
    expect(data.credentials[0].title).toBe('X');
  });

  it('réécrit les références qui désignaient l’identifiant remplacé', () => {
    const data = normalizeVaultData({
      vaults: [{ id: 'v"1', name: 'Coffre', type: 'personal', createdAt: 1, updatedAt: 1 }],
      activeVaultId: 'v"1',
      credentials: [{ id: 'c<1>', vaultId: 'v"1', title: 'Secret', username: '', password: '', website: '', domain: '', tags: [], createdAt: 1, updatedAt: 1 }],
      tasks: [
        { id: 't<1>', vaultId: 'v"1', title: 'Tache', status: 'todo', priority: 'medium', linkedCredentialId: 'c<1>', dependsOn: [], tags: [], createdAt: 1, updatedAt: 1 },
        { id: 't<2>', vaultId: 'v"1', title: 'Suite', status: 'todo', priority: 'medium', dependsOn: ['t<1>'], tags: [], createdAt: 1, updatedAt: 1 }
      ]
    } as Partial<UnlockedVaultData>);

    const vaultId = data.vaults[0].id;
    const premiere = data.tasks.find(t => t.title === 'Tache')!;
    const suite = data.tasks.find(t => t.title === 'Suite')!;

    // Le coffre actif suit son coffre
    expect(data.activeVaultId).toBe(vaultId);
    // L'élément reste dans son coffre
    expect(data.credentials[0].vaultId).toBe(vaultId);
    // La tâche pointe toujours vers le bon identifiant, et la dépendance vers la bonne tâche
    expect(premiere.linkedCredentialId).toBe(data.credentials[0].id);
    expect(suite.dependsOn).toEqual([premiere.id]);
    expect(isSafeId(premiere.id) && isSafeId(suite.id) && isSafeId(vaultId)).toBe(true);
  });

  it('laisse intact un identifiant déjà conforme', () => {
    const data = normalizeVaultData({
      credentials: [{ id: 'cred-0123456789abcdef', vaultId: 'vault-abc', title: 'X', username: '', password: '', website: '', domain: '', tags: [], createdAt: 1, updatedAt: 1 }]
    } as Partial<UnlockedVaultData>);
    expect(data.credentials[0].id).toBe('cred-0123456789abcdef');
  });

  it('assainit aussi les identifiants des champs personnalisés et des sous-tâches', () => {
    const data = normalizeVaultData({
      credentials: [{
        id: 'cred-ok', vaultId: 'v', title: 'X', username: '', password: '', website: '', domain: '', tags: [],
        fields: [{ id: CHARGE, label: 'PIN', value: '1234', isMasked: true }],
        createdAt: 1, updatedAt: 1
      }],
      tasks: [{
        id: 'task-ok', vaultId: 'v', title: 'T', status: 'todo', priority: 'medium', tags: [],
        subtasks: [{ id: CHARGE, title: 'Etape', isDone: false }],
        createdAt: 1, updatedAt: 1
      }]
    } as Partial<UnlockedVaultData>);

    expect(isSafeId(data.credentials[0].fields![0].id)).toBe(true);
    expect(isSafeId(data.tasks[0].subtasks![0].id)).toBe(true);
  });
});

describe('Coffre hostile : icônes', () => {
  it('refuse tout SVG qui sort du jeu de formes autorisé', () => {
    for (const charge of [
      '<script>alert(1)</script>',
      '<path d="M0 0" onload="alert(1)"/>',
      '<foreignObject><body>x</body></foreignObject>',
      '<path d="M0 0"/>texte',
      '<path d="M0 0" fill="javascript:alert(1)"/>',
      '<use href="#x"/>',
      '<animate attributeName="x" to="1"/>',
      '<path d="M0 0" style="x:expression(alert(1))"/>'
    ]) {
      expect(sanitizeIconBody(charge)).toBe('');
    }
  });

  it('garde une icône légitime', () => {
    const propre = sanitizeIconBody('<path d="M12 2a10 10 0 100 20z" fill="none"/>');
    expect(propre).toContain('<path');
    expect(propre).not.toContain('script');
  });
});

describe('Coffre hostile : attribution d’une tâche', () => {
  it('ramène l’attribution à une chaîne courte, ou la retire', () => {
    const base = { id: 'task-abcdefgh', vaultId: 'vault-abcdefgh', title: 'T', status: 'todo', priority: 'medium', tags: [], createdAt: 1, updatedAt: 1 };
    const data = normalizeVaultData({
      vaults: [{ id: 'vault-abcdefgh', name: 'V', type: 'personal', createdAt: 1, updatedAt: 1 }],
      activeVaultId: 'vault-abcdefgh',
      tasks: [
        { ...base, id: 'task-aaaaaaaa', assignee: `  ${CHARGE}  ` },
        { ...base, id: 'task-bbbbbbbb', assignee: 'x'.repeat(5000) },
        // Un objet à la place du texte ne doit pas se retrouver dans le HTML
        { ...base, id: 'task-cccccccc', assignee: { toString: () => 'piege' } },
        { ...base, id: 'task-dddddddd', assignee: '   ' },
        { ...base, id: 'task-eeeeeeee', assignee: 'bob@exemple.fr' }
      ]
    } as unknown as UnlockedVaultData);

    const par = (id: string) => data.tasks.find(t => t.id === id)!;
    // La charge reste du texte : c'est l'affichage qui échappe, mais elle est bornée et rognée
    expect(par('task-aaaaaaaa').assignee).toBe(CHARGE);
    expect(par('task-bbbbbbbb').assignee!.length).toBe(200);
    expect(par('task-cccccccc').assignee).toBeUndefined();
    expect(par('task-dddddddd').assignee).toBeUndefined();
    expect(par('task-eeeeeeee').assignee).toBe('bob@exemple.fr');
  });
});
