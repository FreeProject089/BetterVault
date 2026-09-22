import { describe, it, expect } from 'vitest';
import { mergeItem, stampVersion, restoreVersion, capHistory, MAX_VERSIONS, type Versioned } from '../src/store/versions';
import { mergeVaultData } from '../src/account/merge';
import { VaultStore, createEmptyVaultData, normalizeVaultData, expiredTrash } from '../src/store/vaultStore';
import type { CredentialItem, UnlockedVaultData } from '../src/types/vault';

/**
 * Historique et fusion : deux appareils modifient le même élément sans se voir ;
 * à la synchronisation rien ne doit disparaître en silence, et tous les appareils
 * doivent aboutir au même résultat.
 */

let n = 0;
const rev = () => `rev-${String(++n).padStart(6, '0')}`;

type Cred = Versioned & { title: string; username?: string; password?: string; notes?: string; tags: string[]; attachments?: Array<{ id: string; name: string; data?: string }> };

const base = (): Cred => stampVersion({ id: 'cred-1', updatedAt: 100, title: 'Banque', username: 'moi', password: 'a', tags: ['argent'] }, undefined, rev);

/** Simule une modification enregistrée sur un appareil */
const edit = (item: Cred, patch: Partial<Cred>, at: number): Cred => stampVersion({ ...item, ...patch, updatedAt: at }, item, rev);

describe('Fusion d’un élément', () => {
  it('garde la version descendante sans conflit', () => {
    const origine = base();
    const suite = edit(origine, { password: 'b' }, 200);
    expect(mergeItem(origine, suite)).toMatchObject({ password: 'b', rev: suite.rev });
    expect(mergeItem(suite, origine)).toMatchObject({ password: 'b', rev: suite.rev });
    expect(mergeItem(origine, suite).conflicts).toBeUndefined();
  });

  it('fusionne sans bruit deux champs différents modifiés de chaque côté', () => {
    const origine = base();
    const a = edit(origine, { password: 'nouveau' }, 200);
    const b = edit(origine, { username: 'moi@exemple.fr' }, 300);
    const fusion = mergeItem(a, b);
    expect(fusion).toMatchObject({ password: 'nouveau', username: 'moi@exemple.fr' });
    expect(fusion.conflicts).toBeUndefined();
  });

  it('garde les deux valeurs quand le même champ change des deux côtés', () => {
    const origine = base();
    const a = edit(origine, { password: 'depuis-le-telephone' }, 200);
    const b = edit(origine, { password: 'depuis-le-pc' }, 300);
    const fusion = mergeItem(a, b);
    // La plus récente est retenue, l'autre n'est pas perdue
    expect(fusion.password).toBe('depuis-le-pc');
    expect(fusion.conflicts).toEqual([expect.objectContaining({ field: 'password', value: 'depuis-le-telephone', rev: a.rev })]);
  });

  it('donne le même résultat quel que soit l’appareil qui fusionne', () => {
    const origine = base();
    const a = edit(origine, { password: 'x', tags: ['argent', 'pro'] }, 200);
    const b = edit(origine, { notes: 'note', tags: [] }, 300);
    expect(JSON.stringify(mergeItem(a, b))).toBe(JSON.stringify(mergeItem(b, a)));
  });

  it('fusionne les tags comme un ensemble : ajouts et retraits des deux côtés', () => {
    const origine = edit(base(), { tags: ['argent', 'banque'] }, 150);
    const a = edit(origine, { tags: ['argent', 'banque', 'pro'] }, 200);
    const b = edit(origine, { tags: ['argent'] }, 300);
    expect(mergeItem(a, b).tags).toEqual(['argent', 'pro']);
  });

  it('garde les fichiers ajoutés des deux côtés, contenu compris', () => {
    const origine = base();
    const a = edit(origine, { attachments: [{ id: 'att-aaaaaaaa', name: 'a.pdf', data: 'QUFB' }] }, 200);
    const b = edit(origine, { attachments: [{ id: 'att-bbbbbbbb', name: 'b.pdf', data: 'QkJC' }] }, 300);
    const fichiers = mergeItem(a, b).attachments!;
    expect(fichiers.map(f => f.id).sort()).toEqual(['att-aaaaaaaa', 'att-bbbbbbbb']);
    // Le contenu des fichiers gardés dans le coffre survit à la fusion
    expect(fichiers.find(f => f.id === 'att-aaaaaaaa')!.data).toBe('QUFB');
  });

  it('retire un fichier supprimé d’un côté et intact de l’autre', () => {
    const origine = edit(base(), { attachments: [{ id: 'att-aaaaaaaa', name: 'a.pdf' }] }, 150);
    const a = edit(origine, { attachments: [] }, 200);
    const b = edit(origine, { notes: 'autre chose' }, 300);
    expect(mergeItem(a, b).attachments).toEqual([]);
  });

  it('signale les champs différents d’anciens éléments sans historique', () => {
    const a = { id: 'x', updatedAt: 100, title: 'T', password: 'un', tags: [] } as Cred;
    const b = { id: 'x', updatedAt: 200, title: 'T', password: 'deux', tags: [] } as Cred;
    const fusion = mergeItem(a, b);
    expect(fusion.password).toBe('deux');
    expect(fusion.conflicts?.[0]).toMatchObject({ field: 'password', value: 'un' });
  });

  it('converge après fusions successives', () => {
    const origine = base();
    const a = edit(origine, { password: 'a' }, 200);
    const b = edit(origine, { password: 'b' }, 300);
    const ab = mergeItem(a, b);
    // Chaque appareil fusionne puis se resynchronise : plus rien ne bouge
    expect(mergeItem(ab, mergeItem(b, a))).toEqual(ab);
    expect(mergeItem(ab, a).rev).toBe(ab.rev);
  });
});

describe('Historique', () => {
  it('range l’ancienne version à chaque modification', () => {
    let item = base();
    item = edit(item, { password: 'b' }, 200);
    item = edit(item, { password: 'c' }, 300);
    expect(item.history!.map(v => v.snapshot.password)).toEqual(['a', 'b']);
  });

  it('ne crée pas de version quand rien n’a changé', () => {
    const item = base();
    const pareil = stampVersion({ ...item, updatedAt: 999 }, item, rev);
    // Seule la date a changé ; updatedAt fait partie du contenu, donc on vérifie le cas réel : aucun changement
    const identique = stampVersion({ ...item }, item, rev);
    expect(identique.rev).toBe(item.rev);
    expect(pareil.rev).not.toBe(item.rev);
  });

  it('borne le nombre de versions', () => {
    let item = base();
    for (let i = 0; i < MAX_VERSIONS + 10; i++) item = edit(item, { password: `p${i}` }, 200 + i);
    expect(item.history!.length).toBe(MAX_VERSIONS);
  });

  it('borne la taille de l’historique', () => {
    const grosses = Array.from({ length: 10 }, (_, i) => ({ rev: `r${i}`, at: i, op: 'update' as const, snapshot: { notes: 'x'.repeat(20_000) } }));
    expect(capHistory(grosses).length).toBeLessThan(10);
  });

  it('restaure une ancienne version sans perdre la courante', () => {
    let item = base();
    item = edit(item, { password: 'b' }, 200);
    item = edit(item, { password: 'c' }, 300);
    const cible = item.history!.find(v => v.snapshot.password === 'a')!;
    const restaure = restoreVersion(item, cible.rev, 400, rev)!;
    expect(restaure.password).toBe('a');
    // La version « c » est restaurable à son tour
    expect(restaure.history!.some(v => v.snapshot.password === 'c')).toBe(true);
  });

  it('ne garde pas le contenu des fichiers dans les versions', () => {
    let item = edit(base(), { attachments: [{ id: 'att-aaaaaaaa', name: 'a.pdf', data: 'x'.repeat(1000) }] }, 150);
    item = edit(item, { notes: 'modifié' }, 200);
    expect(JSON.stringify(item.history)).not.toContain('x'.repeat(1000));
  });
});

describe('Fusion de coffres', () => {
  const coffre = (): UnlockedVaultData => createEmptyVaultData(1);

  it('garde les types de coffre créés par l’utilisateur', () => {
    const local = coffre();
    local.vaultTypes = [{ id: 'vtype-1', name: 'Famille', createdAt: 1, updatedAt: 1 }];
    const distant = { ...local, vaultTypes: [] };
    expect(mergeVaultData(local, distant).vaultTypes!.map(t => t.name)).toEqual(['Famille']);
  });

  it('ne perd rien quand deux appareils modifient le même identifiant', () => {
    const origine = coffre();
    const cred = stampVersion({ id: 'cred-1', vaultId: origine.activeVaultId, title: 'Banque', username: '', password: 'a', website: '', domain: '', tags: [], createdAt: 1, updatedAt: 1 } as CredentialItem, undefined, rev);
    origine.credentials = [cred];
    const local = { ...origine, credentials: [stampVersion({ ...cred, password: 'local', updatedAt: 5 }, cred, rev)] };
    const distant = { ...origine, credentials: [stampVersion({ ...cred, notes: 'ajout distant', updatedAt: 6 }, cred, rev)] };
    const fusion = mergeVaultData(local, distant).credentials[0];
    expect(fusion).toMatchObject({ password: 'local', notes: 'ajout distant' });
  });
});

describe('Corbeille', () => {
  const store = () => {
    const s = new VaultStore();
    s.load(createEmptyVaultData());
    return s;
  };

  it('met un identifiant supprimé à la corbeille et le restaure', () => {
    const s = store();
    const id = s.addCredential({ vaultId: s.getData().activeVaultId, title: 'À garder', username: '', password: 'p', website: '', domain: '', tags: [] } as never);
    s.deleteCredential(id);
    expect(s.getData().credentials).toHaveLength(0);
    expect(s.getTrash().map(e => e.item.id)).toEqual([id]);

    expect(s.restoreFromTrash(id)).toBe(true);
    expect(s.getData().credentials.map(c => c.id)).toEqual([id]);
    expect(s.getTrash()).toHaveLength(0);
  });

  it('garde l’élément restauré face à un appareil qui a vu la suppression', () => {
    const s = store();
    const id = s.addCredential({ vaultId: s.getData().activeVaultId, title: 'Revenant', username: '', password: 'p', website: '', domain: '', tags: [] } as never);
    s.deleteCredential(id);
    const autreAppareil = structuredClone(s.getData());
    s.restoreFromTrash(id);
    const fusion = mergeVaultData(s.getData(), autreAppareil);
    expect(fusion.credentials.map(c => c.id)).toContain(id);
    expect(fusion.trash ?? []).toHaveLength(0);
  });

  it('versionne chaque enregistrement sans que les méthodes y pensent', () => {
    const s = store();
    const id = s.addCredential({ vaultId: s.getData().activeVaultId, title: 'T', username: '', password: 'un', website: '', domain: '', tags: [] } as never);
    s.updateCredential(id, { password: 'deux' });
    const cred = s.getData().credentials[0];
    expect(cred.rev).toBeTruthy();
    expect(cred.history!.at(-1)!.snapshot.password).toBe('un');

    expect(s.restoreItemVersion('credential', id, cred.history!.at(-1)!.rev)).toBe(true);
    expect(s.getData().credentials[0].password).toBe('un');
  });

  it('signale les entrées expirées sans les faire disparaître d’elles-mêmes', () => {
    const vieux = [{ kind: 'credential' as const, item: { id: 'cred-vieux' } as CredentialItem, deletedAt: 0 }];
    expect(expiredTrash(vieux, 40 * 86_400_000)).toHaveLength(1);
    expect(normalizeVaultData({ ...createEmptyVaultData(), trash: vieux }).trash).toHaveLength(1);
  });

  it('rejette un historique ou des conflits mal formés venus d’ailleurs', () => {
    const data = normalizeVaultData({
      ...createEmptyVaultData(),
      credentials: [{
        id: 'cred-1', vaultId: 'v', title: 'T', tags: [], createdAt: 1, updatedAt: 1,
        rev: '<script>',
        history: [{ rev: 'ok-1', at: 1, op: 'update', snapshot: {} }, { rev: 'x"><img', at: 1, op: 'update', snapshot: {} }, 'n’importe quoi'],
        conflicts: [{ field: 'password', value: 'p', rev: 'ok-2', at: 1 }, { field: '__proto__', value: 1, rev: 'r', at: 1 }]
      } as never]
    });
    const cred = data.credentials[0];
    expect(cred.rev).toBeUndefined();
    expect(cred.history!.map(v => v.rev)).toEqual(['ok-1']);
    expect(cred.conflicts!.map(c => c.field)).toEqual(['password']);
  });
});
