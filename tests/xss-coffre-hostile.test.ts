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
      folders: [{ id: CHARGE, vaultId: 'v1', name: 'Anodin', createdAt: 1, updatedAt: 1 }],
      credentials: [{ id: '</script><script>x</script>', vaultId: 'v1', title: 'X', username: '', password: '', website: '', domain: '', tags: [], createdAt: 1, updatedAt: 1 }],
      tagDefs: [{ id: 'tag" onmouseover="x', name: 'Tag', color: '#112233', createdAt: 1, updatedAt: 1 }]
    } as Partial<UnlockedVaultData>);

    expect(isSafeId(data.folders[0].id)).toBe(true);
    expect(isSafeId(data.credentials[0].id)).toBe(true);
    expect(isSafeId(data.tagDefs[0].id)).toBe(true);
    // Le contenu, lui, est conservé : on remplace l'identifiant, on ne jette pas l'élément
    expect(data.folders[0].name).toBe('Anodin');
    expect(data.credentials[0].title).toBe('X');
  });

  it('réécrit les références qui désignaient l’identifiant remplacé', () => {
    const data = normalizeVaultData({
      vaults: [{ id: 'v"1', name: 'Coffre', type: 'personal', createdAt: 1, updatedAt: 1 }],
      activeVaultId: 'v"1',
      folders: [
        { id: 'parent<x>', vaultId: 'v"1', name: 'Parent', createdAt: 1, updatedAt: 1 },
        { id: 'enfant<y>', vaultId: 'v"1', parentId: 'parent<x>', name: 'Enfant', createdAt: 1, updatedAt: 1 }
      ],
      credentials: [{ id: 'c<1>', vaultId: 'v"1', folderId: 'parent<x>', title: 'Secret', username: '', password: '', website: '', domain: '', tags: [], createdAt: 1, updatedAt: 1 }],
      tasks: [{ id: 't<1>', vaultId: 'v"1', title: 'Tache', status: 'todo', priority: 'medium', linkedCredentialId: 'c<1>', dependsOn: [], tags: [], createdAt: 1, updatedAt: 1 }]
    } as Partial<UnlockedVaultData>);

    const vaultId = data.vaults[0].id;
    const parent = data.folders.find(f => f.name === 'Parent')!;
    const enfant = data.folders.find(f => f.name === 'Enfant')!;

    // Le coffre actif suit son coffre
    expect(data.activeVaultId).toBe(vaultId);
    // Le lien parent/enfant survit au remplacement
    expect(enfant.parentId).toBe(parent.id);
    // L'élément reste dans son dossier et dans son coffre
    expect(data.credentials[0].folderId).toBe(parent.id);
    expect(data.credentials[0].vaultId).toBe(vaultId);
    // La tâche pointe toujours vers le bon identifiant
    expect(data.tasks[0].linkedCredentialId).toBe(data.credentials[0].id);
    expect(isSafeId(parent.id) && isSafeId(enfant.id) && isSafeId(vaultId)).toBe(true);
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
