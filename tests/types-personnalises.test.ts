import { describe, it, expect, beforeEach } from 'vitest';
import { checkTemplateValues, mergeTemplateFields, normalizeTemplates } from '../src/store/itemTemplates';
import { normalizeVaultData, VaultStore } from '../src/store/vaultStore';
import { mergeVaultData } from '../src/account/merge';
import type { ItemTemplate } from '../src/types/vault';

/** Types d'éléments personnalisés : modèle, contrôle des valeurs, synchronisation */

const tr = (fr: string) => fr;

const licence: ItemTemplate = {
  id: 'tpl-licence01',
  name: 'Licence',
  fields: [
    { id: 'tfield-cle00001', label: 'Clé', kind: 'secret', required: true },
    { id: 'tfield-date0001', label: 'Expire le', kind: 'date' },
    { id: 'tfield-postes01', label: 'Postes', kind: 'number' },
    { id: 'tfield-site0001', label: 'Portail', kind: 'url' }
  ],
  createdAt: 1,
  updatedAt: 1
};

describe('Types d’éléments personnalisés', () => {
  it('rejette les modèles malformés et borne les libellés', () => {
    const out = normalizeTemplates([
      licence,
      { id: 'x', name: 'trop court' },
      { id: 'tpl-sansnom1', name: '   ' },
      { id: 'tpl-long0001', name: 'N'.repeat(80), fields: [{ id: 'tfield-bizarre1', label: 'L', kind: '<script>' }] }
    ]);
    expect(out.map(t => t.id)).toEqual(['tpl-licence01', 'tpl-long0001']);
    expect(out[1].name).toHaveLength(40);
    expect(out[1].fields[0].kind).toBe('text');
  });

  it('contrôle les valeurs : requis, nombre, date, adresse', () => {
    expect(checkTemplateValues(licence, {}, tr).error?.fieldId).toBe('tfield-cle00001');
    expect(checkTemplateValues(licence, { 'tfield-cle00001': 'K', 'tfield-postes01': 'dix' }, tr).error?.fieldId).toBe('tfield-postes01');
    expect(checkTemplateValues(licence, { 'tfield-cle00001': 'K', 'tfield-date0001': '12/05' }, tr).error?.fieldId).toBe('tfield-date0001');
    expect(checkTemplateValues(licence, { 'tfield-cle00001': 'K', 'tfield-site0001': 'javascript:alert(1)' }, tr).error?.fieldId).toBe('tfield-site0001');
    expect(checkTemplateValues(licence, { 'tfield-cle00001': 'K', 'tfield-postes01': '3', 'tfield-site0001': 'exemple.fr', 'tfield-date0001': '2027-01-31' }, tr).error).toBeUndefined();
  });

  it('range les valeurs dans les champs de l’élément sans perdre les autres', () => {
    const fields = mergeTemplateFields(licence, { 'tfield-cle00001': 'ABC', 'tfield-postes01': '' }, [
      { id: 'field-perso001', label: 'Remarque', value: 'garder', isMasked: false },
      { id: 'field-ancien01', label: 'Clé', value: 'ancienne', isMasked: true }
    ]);
    expect(fields).toEqual([
      { id: 'tfield-cle00001', label: 'Clé', value: 'ABC', isMasked: true },
      { id: 'field-perso001', label: 'Remarque', value: 'garder', isMasked: false }
    ]);
  });

  describe('dans le coffre', () => {
    let store: VaultStore;
    beforeEach(() => {
      store = new VaultStore();
      store.load(normalizeVaultData({}));
    });

    it('crée, refuse les doublons de nom, et supprime sans toucher aux éléments', () => {
      const t = store.saveTemplate({ name: 'Véhicule', fields: [{ label: 'Immatriculation', kind: 'text', required: true }, { label: '  ', kind: 'text' }] });
      expect(t.fields).toHaveLength(1);
      expect(() => store.saveTemplate({ name: 'véhicule', fields: [{ label: 'x', kind: 'text' }] })).toThrow();
      expect(() => store.saveTemplate({ name: 'Vide', fields: [] })).toThrow();

      const id = store.addCredential({ title: 'Clio', type: 'note', templateId: t.id, fields: [{ id: t.fields[0].id, label: 'Immatriculation', value: 'AB-123-CD', isMasked: false }], tags: [], vaultId: store.getData().activeVaultId } as never);
      store.deleteTemplate(t.id);
      expect(store.getTemplates()).toHaveLength(0);
      expect(store.getData().credentials.find(c => c.id === id)?.fields?.[0].value).toBe('AB-123-CD');
    });

    it('se synchronise : ajout d’un côté, suppression de l’autre', () => {
      const t = store.saveTemplate({ name: 'Abonnement', fields: [{ label: 'Prix', kind: 'number' }] });
      const local = structuredClone(store.getData());
      const remote = normalizeVaultData({ ...structuredClone(local), itemTemplates: [] });
      expect(mergeVaultData(local, remote).itemTemplates?.map(x => x.id)).toContain(t.id);

      store.deleteTemplate(t.id);
      const merged = mergeVaultData(structuredClone(store.getData()), local);
      expect(merged.itemTemplates?.some(x => x.id === t.id)).toBe(false);
    });
  });
});
