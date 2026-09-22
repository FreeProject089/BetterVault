import { describe, it, expect } from 'vitest';
import { buildFullBackup, planImport, applyImport, isFullBackup, type ImportTarget } from '../src/import_export/fullBackup';
import { encryptFile, decryptFile, type AttachmentMeta } from '../src/account/attachmentCrypto';
import { toBase64 } from '../src/account/accountCrypto';
import { createEmptyVaultData, normalizeVaultData } from '../src/store/vaultStore';
import type { UnlockedVaultData } from '../src/types/vault';

/**
 * Sauvegarde complète : tout part, fichiers compris, et revient ailleurs sans que
 * les fichiers soient jamais déchiffrés en chemin.
 */

let n = 0;
const newId = (prefix: string) => `${prefix}-${++n}`;

async function coffreAvecFichiers(): Promise<{ data: UnlockedVaultData; serveur: Map<string, Uint8Array>; clair: Uint8Array }> {
  const data = createEmptyVaultData();
  const vaultId = data.activeVaultId;
  data.vaults.push({ id: 'vault-partage', name: 'Équipe', type: 'team', createdAt: 1, updatedAt: 1, shared: { ownerEmail: 'x@exemple.fr', role: { permissions: [] } } } as never);

  const clair = new TextEncoder().encode('contenu du passeport');
  const surServeur = await encryptFile(clair);
  const dansCoffre = await encryptFile(new TextEncoder().encode('petit fichier'));
  const serveur = new Map([['att-serveur', surServeur.payload]]);

  const metaServeur: AttachmentMeta = { id: 'att-serveur', name: 'passeport.pdf', size: clair.length, type: 'application/pdf', key: surServeur.key, createdAt: 1 };
  const metaCoffre: AttachmentMeta = { id: 'att-coffre', name: 'note.txt', size: 13, type: 'text/plain', key: dansCoffre.key, data: toBase64(dansCoffre.payload), createdAt: 1 };

  data.credentials.push(
    { id: 'cred-1', vaultId, title: 'Identité', tags: ['papiers'], attachments: [metaServeur, metaCoffre], createdAt: 1, updatedAt: 1 } as never,
    { id: 'cred-2', vaultId: 'vault-partage', title: 'Secret d’équipe', tags: [], createdAt: 1, updatedAt: 1 } as never
  );
  data.tasks.push({ id: 'task-1', vaultId, title: 'Renouveler', tags: [], linkedCredentialId: 'cred-1', createdAt: 1, updatedAt: 1 } as never);
  return { data, serveur, clair };
}

const cible = (over: Partial<ImportTarget> = {}): ImportTarget => ({
  serverFiles: true, maxFileBytes: 25 * 1024 * 1024, freeBytes: 500 * 1024 * 1024,
  inlineMaxBytes: 1024 * 1024, inlineBudgetBytes: 10 * 1024 * 1024, vaultSlots: 20, ...over
});

describe('Export complet', () => {
  it('embarque les fichiers du serveur et du coffre, sans les déchiffrer', async () => {
    const { data, serveur } = await coffreAvecFichiers();
    const { backup, problems } = await buildFullBackup(data, {
      canExport: () => true,
      fetchPayload: async meta => serveur.get(meta.id)!
    });
    expect(isFullBackup(backup)).toBe(true);
    expect(problems).toEqual([]);
    expect(Object.keys(backup.files).sort()).toEqual(['att-coffre', 'att-serveur']);
    // Le contenu voyagé est l'octet chiffré tel quel
    expect(backup.files['att-serveur']).toBe(toBase64(serveur.get('att-serveur')!));
    // La fiche ne garde pas une seconde copie du contenu
    expect(backup.data.credentials[0].attachments!.every(a => !a.data)).toBe(true);
    // Un coffre partagé devient un coffre ordinaire
    expect(backup.data.vaults.every(v => !v.shared)).toBe(true);
  });

  it('laisse de côté un coffre partagé que le rôle ne permet pas d’exporter, et le dit', async () => {
    const { data, serveur } = await coffreAvecFichiers();
    const { backup, problems } = await buildFullBackup(data, {
      canExport: vault => vault.id !== 'vault-partage',
      fetchPayload: async meta => serveur.get(meta.id)!
    });
    expect(backup.data.vaults.map(v => v.name)).not.toContain('Équipe');
    expect(backup.data.credentials.map(c => c.title)).not.toContain('Secret d’équipe');
    expect(problems).toEqual([{ vault: 'Équipe', reason: 'export_denied' }]);
  });

  it('signale un fichier illisible sans faire échouer le reste', async () => {
    const { data } = await coffreAvecFichiers();
    const { backup, problems } = await buildFullBackup(data, {
      canExport: () => true,
      fetchPayload: async () => { throw new Error('404'); }
    });
    expect(problems).toEqual([{ file: 'passeport.pdf', reason: 'file_unreadable' }]);
    expect(Object.keys(backup.files)).toEqual(['att-coffre']);
  });
});

describe('Plan d’import', () => {
  it('envoie tout sur un serveur qui a la place', async () => {
    const { data, serveur } = await coffreAvecFichiers();
    const { backup } = await buildFullBackup(data, { canExport: () => true, fetchPayload: async m => serveur.get(m.id)! });
    const plan = planImport(backup, cible());
    expect(plan.complete).toBe(true);
    expect(plan.files.every(f => f.destination === 'server')).toBe(true);
  });

  it('dit combien de place il faut quand elle manque', async () => {
    const { data, serveur } = await coffreAvecFichiers();
    const { backup } = await buildFullBackup(data, { canExport: () => true, fetchPayload: async m => serveur.get(m.id)! });
    const plan = planImport(backup, cible({ freeBytes: 45 }));
    expect(plan.complete).toBe(false);
    expect(plan.requiredServerBytes).toBeGreaterThan(plan.availableServerBytes);
    // Le plus petit passe, le plus gros est refusé faute de place
    expect(plan.files.find(f => f.name === 'note.txt')!.destination).toBe('server');
    expect(plan.files.find(f => f.name === 'passeport.pdf')).toMatchObject({ destination: 'refused', reason: 'no_space' });
  });

  it('refuse un fichier plus gros que la limite du serveur', async () => {
    const { data, serveur } = await coffreAvecFichiers();
    const { backup } = await buildFullBackup(data, { canExport: () => true, fetchPayload: async m => serveur.get(m.id)! });
    const plan = planImport(backup, cible({ maxFileBytes: 45 }));
    expect(plan.files.find(f => f.name === 'passeport.pdf')).toMatchObject({ destination: 'refused', reason: 'too_large' });
  });

  it('garde les petits fichiers dans le coffre quand le serveur n’accepte pas de fichiers', async () => {
    const { data, serveur } = await coffreAvecFichiers();
    const { backup } = await buildFullBackup(data, { canExport: () => true, fetchPayload: async m => serveur.get(m.id)! });
    const plan = planImport(backup, cible({ serverFiles: false, inlineMaxBytes: 45 }));
    expect(plan.files.find(f => f.name === 'note.txt')!.destination).toBe('vault');
    expect(plan.files.find(f => f.name === 'passeport.pdf')).toMatchObject({ destination: 'refused', reason: 'no_files' });
  });

  it('compte les coffres qui dépassent la limite du compte', async () => {
    const { data, serveur } = await coffreAvecFichiers();
    const { backup } = await buildFullBackup(data, { canExport: () => true, fetchPayload: async m => serveur.get(m.id)! });
    expect(planImport(backup, cible({ vaultSlots: 1 })).vaultsOverLimit).toBe(1);
  });
});

describe('Import', () => {
  it('recrée tout ailleurs, avec de nouveaux identifiants et des liens intacts', async () => {
    const { data, serveur, clair } = await coffreAvecFichiers();
    const { backup } = await buildFullBackup(data, { canExport: () => true, fetchPayload: async m => serveur.get(m.id)! });

    const autreServeur = new Map<string, Uint8Array>();
    const destination = createEmptyVaultData();
    const plan = planImport(backup, cible());
    const result = await applyImport(backup, plan, destination, {
      upload: async payload => { const id = `srv-${String(autreServeur.size + 1).padStart(8, '0')}`; autreServeur.set(id, payload); return { id }; },
      newId,
      importedSuffix: '(importé)'
    });
    const out = normalizeVaultData(result.data);

    expect(result.imported).toMatchObject({ vaults: 2, credentials: 2, tasks: 1, files: 2 });
    // Le coffre « Personnel » existait déjà : l'importé est renommé, rien n'est écrasé
    expect(out.vaults.map(v => v.name)).toEqual(expect.arrayContaining(['Personnel', 'Personnel (importé)', 'Équipe']));

    const identite = out.credentials.find(c => c.title === 'Identité')!;
    expect(identite.id).not.toBe('cred-1');
    expect(out.tasks[0].linkedCredentialId).toBe(identite.id);

    // Le fichier renvoyé sur le nouveau serveur s'ouvre avec la clé d'origine
    const meta = identite.attachments!.find(a => a.name === 'passeport.pdf')!;
    expect(new TextDecoder().decode(await decryptFile(autreServeur.get(meta.id)!, meta.key))).toBe(new TextDecoder().decode(clair));
  });

  it('retire les fichiers déjà envoyés quand l’import échoue en route', async () => {
    const { data, serveur } = await coffreAvecFichiers();
    const { backup } = await buildFullBackup(data, { canExport: () => true, fetchPayload: async m => serveur.get(m.id)! });
    const autreServeur = new Map<string, Uint8Array>();
    let envois = 0;
    await expect(applyImport(backup, planImport(backup, cible()), createEmptyVaultData(), {
      upload: async payload => {
        if (++envois === 2) throw new Error('coupure réseau');
        const id = `srv-orphelin-${envois}`;
        autreServeur.set(id, payload);
        return { id };
      },
      discard: async id => { autreServeur.delete(id); },
      newId,
      importedSuffix: '(importé)'
    })).rejects.toThrow('coupure réseau');
    expect(autreServeur.size).toBe(0);
  });

  it('peut être rejoué sans collision', async () => {
    const { data, serveur } = await coffreAvecFichiers();
    const { backup } = await buildFullBackup(data, { canExport: () => true, fetchPayload: async m => serveur.get(m.id)! });
    const options = { upload: async () => ({ id: newId('srv') }), newId, importedSuffix: '(importé)' };
    const une = await applyImport(backup, planImport(backup, cible()), createEmptyVaultData(), options);
    const deux = await applyImport(backup, planImport(backup, cible()), une.data, options);
    const ids = deux.data.credentials.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('n’importe pas ce que le plan a refusé', async () => {
    const { data, serveur } = await coffreAvecFichiers();
    const { backup } = await buildFullBackup(data, { canExport: () => true, fetchPayload: async m => serveur.get(m.id)! });
    const plan = planImport(backup, cible({ freeBytes: 45 }));
    let envois = 0;
    const result = await applyImport(backup, plan, createEmptyVaultData(), { upload: async () => ({ id: newId('srv') + String(++envois) }), newId, importedSuffix: '(importé)' });
    expect(envois).toBe(1);
    expect(result.skippedFiles.map(f => f.name)).toEqual(['passeport.pdf']);
  });
});
