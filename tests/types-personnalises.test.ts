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

  it('contrôle les nouveaux genres de champ', () => {
    const modele: ItemTemplate = {
      id: 'tpl-abonnem01', name: 'Abonnement', createdAt: 1, updatedAt: 1,
      fields: [
        { id: 'tfield-mail0001', label: 'Email', kind: 'email' },
        { id: 'tfield-tel00001', label: 'Téléphone', kind: 'phone' },
        { id: 'tfield-mois0001', label: 'Expire', kind: 'month' },
        { id: 'tfield-code0001', label: 'Code', kind: 'pin' },
        { id: 'tfield-rythm001', label: 'Rythme', kind: 'choice', options: ['Mensuel', 'Annuel'] }
      ]
    };
    const bon = {
      'tfield-mail0001': 'a.b@exemple.fr',
      'tfield-tel00001': '+33 6 12 34 56 78',
      'tfield-mois0001': '2030-07',
      'tfield-code0001': '4821',
      'tfield-rythm001': 'Annuel'
    };
    expect(checkTemplateValues(modele, bon, tr).error).toBeUndefined();
    // Un champ vide non requis reste accepté : on ne contrôle que ce qui est saisi
    expect(checkTemplateValues(modele, {}, tr).error).toBeUndefined();

    const mauvais: Array<[string, string, RegExp]> = [
      ['tfield-mail0001', 'a.b@exemple', /email/],
      ['tfield-mail0001', 'deux@adresses, a@b.fr', /email/],
      ['tfield-tel00001', 'appelle-moi', /téléphone/],
      ['tfield-mois0001', '2030-13', /mois/],
      ['tfield-mois0001', '2030-07-15', /mois/],
      ['tfield-code0001', '12', /chiffres/],
      ['tfield-code0001', '48a1', /chiffres/],
      // Une réponse hors liste pourrait venir d'un autre appareil ou d'un import
      ['tfield-rythm001', 'Hebdomadaire', /réponses/]
    ];
    for (const [id, valeur, attendu] of mauvais) {
      const res = checkTemplateValues(modele, { ...bon, [id]: valeur }, tr);
      expect(res.error?.fieldId, `${id} = ${valeur}`).toBe(id);
      expect(res.error?.message).toMatch(attendu);
    }
  });

  it('un choix sans réponse possible redevient du texte, et les réponses sont bornées', () => {
    const [modele] = normalizeTemplates([{
      id: 'tpl-choix0001', name: 'Choix', createdAt: 1, updatedAt: 1,
      fields: [
        { id: 'tfield-vide0001', label: 'Sans réponses', kind: 'choice', options: [] },
        { id: 'tfield-plein001', label: 'Avec réponses', kind: 'choice', options: ['  Un  ', 'un', 'Deux', '', ...Array.from({ length: 30 }, (_, i) => `R${i}`)] },
        { id: 'tfield-texte001', label: 'Texte', kind: 'text', options: ['ignoré'] }
      ]
    }]);
    expect(modele.fields[0].kind).toBe('text');
    // « Un » et « un » sont la même réponse ; le vide disparaît ; 20 au maximum
    expect(modele.fields[1].options!.slice(0, 3)).toEqual(['Un', 'Deux', 'R0']);
    expect(modele.fields[1].options!.length).toBe(20);
    expect(modele.fields[2].options).toBeUndefined();
  });

  it('un code chiffré est masqué comme un secret dans la fiche', () => {
    const modele: ItemTemplate = {
      id: 'tpl-carte0001', name: 'Carte', createdAt: 1, updatedAt: 1,
      fields: [
        { id: 'tfield-code0001', label: 'Code', kind: 'pin' },
        { id: 'tfield-titul001', label: 'Titulaire', kind: 'text' }
      ]
    };
    const champs = mergeTemplateFields(modele, { 'tfield-code0001': '4821', 'tfield-titul001': 'A. Martin' }, undefined);
    expect(champs.find(f => f.id === 'tfield-code0001')!.isMasked).toBe(true);
    expect(champs.find(f => f.id === 'tfield-titul001')!.isMasked).toBe(false);
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

describe('Enregistrement d’un compte synchronisé', () => {
  it('garde types d’éléments, types de coffre et corbeille (régression)', async () => {
    const { SharedVaultManager } = await import('../src/account/sharedVaults');
    const manager = new SharedVaultManager({} as never);
    const data = normalizeVaultData({
      itemTemplates: [licence],
      vaultTypes: [{ id: 'vtype-perso01', name: 'Famille', createdAt: 1, updatedAt: 1 }],
      trash: [{ kind: 'credential', item: { id: 'cred-supprime1', title: 'x' }, deletedAt: Date.now() } as never]
    });
    const personal = manager.split(data, { save: false });
    expect(personal.itemTemplates?.map(t => t.id)).toEqual(['tpl-licence01']);
    expect(personal.vaultTypes?.map(t => t.name)).toEqual(['Famille']);
    expect(personal.trash).toHaveLength(1);
  });
});

describe('Pièce d’identité : recto et verso', () => {
  it('garde la face d’un fichier et ignore une valeur inconnue', async () => {
    const { normalizeAttachments } = await import('../src/account/attachmentCrypto');
    const out = normalizeAttachments([
      { id: 'att-recto0001', name: 'recto.jpg', size: 10, type: 'image/jpeg', key: 'k', side: 'front', createdAt: 1 },
      { id: 'att-autre0001', name: 'x.jpg', size: 10, type: 'image/jpeg', key: 'k', side: '<img onerror=alert(1)>', createdAt: 1 }
    ])!;
    expect(out[0].side).toBe('front');
    expect('side' in out[1]).toBe(false);
  });
});
