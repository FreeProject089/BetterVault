import type { CredentialField, ItemTemplate, TemplateField, TemplateFieldKind } from '../types/vault';

/**
 * Types d'éléments personnalisés : un modèle nomme une liste de champs (texte,
 * secret, code, texte long, date, mois, nombre, adresse web, email, téléphone,
 * oui / non, liste de choix), chacun éventuellement requis.
 *
 * Un élément créé depuis un modèle reste un élément ordinaire : ses valeurs sont
 * rangées dans ses champs personnalisés, repérés par l'identifiant du champ du
 * modèle. Supprimer ou modifier un modèle ne fait donc rien perdre, et un élément
 * partagé s'affiche correctement chez qui n'a pas le modèle.
 */

export const MAX_TEMPLATES = 30;
export const MAX_TEMPLATE_FIELDS = 20;
export const MAX_FIELD_OPTIONS = 20;
export const TEMPLATE_FIELD_KINDS: TemplateFieldKind[] = [
  'text', 'multiline', 'secret', 'pin',
  'email', 'phone', 'url',
  'date', 'month', 'number',
  'boolean', 'choice'
];

/** Genres dont la valeur est cachée dans la fiche et copiée d'un bouton */
export const MASKED_KINDS: TemplateFieldKind[] = ['secret', 'pin'];

/** Réponses possibles d'un champ « choix » : propres, sans doublon, bornées */
export function normalizeOptions(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const value = clean(raw, 40);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= MAX_FIELD_OPTIONS) break;
  }
  return out;
}

const clean = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Nettoie des modèles venus d'ailleurs (autre appareil, import) : jamais de confiance aveugle */
export function normalizeTemplates(input: unknown, now = Date.now()): ItemTemplate[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_TEMPLATES).flatMap((raw): ItemTemplate[] => {
    const t = raw as Partial<ItemTemplate> | null;
    if (!t || typeof t !== 'object' || !ID.test(String(t.id)) || !clean(t.name, 40)) return [];
    const fields = (Array.isArray(t.fields) ? t.fields : []).slice(0, MAX_TEMPLATE_FIELDS).flatMap((f): TemplateField[] => {
      if (!f || typeof f !== 'object' || !ID.test(String(f.id)) || !clean(f.label, 40)) return [];
      const kind = TEMPLATE_FIELD_KINDS.includes(f.kind as TemplateFieldKind) ? f.kind as TemplateFieldKind : 'text';
      const options = kind === 'choice' ? normalizeOptions(f.options) : [];
      return [{
        id: String(f.id),
        label: clean(f.label, 40),
        // Un choix sans réponse possible n'offrirait rien : il redevient du texte
        kind: kind === 'choice' && options.length === 0 ? 'text' : kind,
        ...(f.required ? { required: true } : {}),
        ...(options.length ? { options } : {})
      }];
    });
    return [{
      id: String(t.id),
      name: clean(t.name, 40),
      fields,
      createdAt: Number(t.createdAt) || now,
      updatedAt: Number(t.updatedAt) || now
    }];
  });
}

/** Valeur actuelle d'un champ du modèle dans un élément (par identifiant, sinon par libellé) */
export function templateValue(field: TemplateField, fields: CredentialField[] | undefined): string {
  const list = fields ?? [];
  return (list.find(f => f.id === field.id) ?? list.find(f => f.label.toLowerCase() === field.label.toLowerCase()))?.value ?? '';
}

export interface TemplateCheck { error?: { fieldId: string; message: string } }

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/;
/* Assez strict pour attraper une faute de frappe, assez large pour les vraies adresses */
const EMAIL = /^[^\s@,;]+@[^\s@.,;]+(?:\.[^\s@.,;]+)+$/;
/* Chiffres, espaces et ponctuation d'appel : « +33 6 12 34 56 78 », « (01) 23-45 » */
const PHONE = /^\+?[\d\s().-]{4,25}$/;

/** Contrôle des valeurs saisies ; renvoie la première erreur, pour placer le curseur dessus */
export function checkTemplateValues(template: ItemTemplate, values: Record<string, string>, tr: (fr: string, en: string) => string): TemplateCheck {
  for (const field of template.fields) {
    const value = (values[field.id] ?? '').trim();
    if (!value) {
      if (field.required) return { error: { fieldId: field.id, message: tr(`« ${field.label} » est requis`, `"${field.label}" is required`) } };
      continue;
    }
    if (field.kind === 'pin' && !/^\d{3,12}$/.test(value)) {
      return { error: { fieldId: field.id, message: tr(`« ${field.label} » doit être un code de 3 à 12 chiffres`, `"${field.label}" must be a 3 to 12 digit code`) } };
    }
    if (field.kind === 'email' && !EMAIL.test(value)) {
      return { error: { fieldId: field.id, message: tr(`« ${field.label} » doit être une adresse email`, `"${field.label}" must be an email address`) } };
    }
    if (field.kind === 'phone' && !PHONE.test(value)) {
      return { error: { fieldId: field.id, message: tr(`« ${field.label} » doit être un numéro de téléphone`, `"${field.label}" must be a phone number`) } };
    }
    if (field.kind === 'month' && !MONTH.test(value)) {
      return { error: { fieldId: field.id, message: tr(`« ${field.label} » doit être un mois (AAAA-MM)`, `"${field.label}" must be a month (YYYY-MM)`) } };
    }
    if (field.kind === 'choice' && !(field.options ?? []).includes(value)) {
      return { error: { fieldId: field.id, message: tr(`« ${field.label} » doit être une des réponses proposées`, `"${field.label}" must be one of the offered answers`) } };
    }
    if (field.kind === 'number' && !/^-?\d+([.,]\d+)?$/.test(value)) {
      return { error: { fieldId: field.id, message: tr(`« ${field.label} » doit être un nombre`, `"${field.label}" must be a number`) } };
    }
    if (field.kind === 'date' && !DATE.test(value)) {
      return { error: { fieldId: field.id, message: tr(`« ${field.label} » doit être une date`, `"${field.label}" must be a date`) } };
    }
    if (field.kind === 'url') {
      try {
        const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocol');
      } catch {
        return { error: { fieldId: field.id, message: tr(`« ${field.label} » doit être une adresse web`, `"${field.label}" must be a web address`) } };
      }
    }
  }
  return {};
}

/**
 * Champs de l'élément après saisie : ceux du modèle prennent l'identifiant du champ
 * du modèle ; les autres champs personnalisés de l'élément sont gardés tels quels.
 */
export function mergeTemplateFields(template: ItemTemplate, values: Record<string, string>, existing: CredentialField[] | undefined): CredentialField[] {
  const own = template.fields.map(field => ({
    id: field.id,
    label: field.label,
    value: values[field.id] ?? '',
    isMasked: MASKED_KINDS.includes(field.kind)
  })).filter(f => f.value !== '');
  const labels = new Set(template.fields.map(f => f.label.toLowerCase()));
  const ids = new Set(template.fields.map(f => f.id));
  const others = (existing ?? []).filter(f => !ids.has(f.id) && !labels.has(f.label.toLowerCase()));
  return [...own, ...others];
}
