import type { CredentialField, ItemTemplate, TemplateField, TemplateFieldKind } from '../types/vault';
import { MAX_TEMPLATE_FIELDS, normalizeOptions, TEMPLATE_FIELD_KINDS, templateValue } from '../store/itemTemplates';

/**
 * Interface des types d'éléments personnalisés : cartes de choix, champs à remplir
 * dans le formulaire d'un élément, et éditeur des types.
 */

type Tr = (fr: string, en: string) => string;
type Escape = (value: string) => string;

const KIND_LABELS: Record<TemplateFieldKind, [string, string]> = {
  text: ['Texte', 'Text'],
  multiline: ['Texte long', 'Long text'],
  secret: ['Secret (masqué)', 'Secret (hidden)'],
  pin: ['Code chiffré (masqué)', 'Numeric code (hidden)'],
  email: ['Adresse email', 'Email address'],
  phone: ['Téléphone', 'Phone'],
  url: ['Adresse web', 'Web address'],
  date: ['Date', 'Date'],
  month: ['Mois (expiration)', 'Month (expiry)'],
  number: ['Nombre', 'Number'],
  boolean: ['Oui / non', 'Yes / no'],
  choice: ['Liste de choix', 'Choice list']
};

/** Ce que chaque genre apporte, dit en une ligne dans l'éditeur */
const KIND_HINTS: Partial<Record<TemplateFieldKind, [string, string]>> = {
  secret: ['Caché dans la fiche, copiable d’un bouton.', 'Hidden on the item, copied with a button.'],
  pin: ['Chiffres seulement, caché comme un secret.', 'Digits only, hidden like a secret.'],
  month: ['Mois et année, comme une date d’expiration de carte.', 'Month and year, like a card expiry date.'],
  boolean: ['Une case à cocher : renouvellement, partagé…', 'A checkbox: auto-renewal, shared…'],
  choice: ['Vos réponses possibles, séparées par des virgules.', 'Your possible answers, separated by commas.']
};

/** Clavier le plus commode sur téléphone, par genre de champ */
const INPUT_MODES: Partial<Record<TemplateFieldKind, string>> = {
  pin: 'numeric',
  number: 'decimal',
  email: 'email',
  phone: 'tel',
  url: 'url'
};

const INPUT_TYPES: Partial<Record<TemplateFieldKind, string>> = {
  secret: 'password',
  pin: 'password',
  email: 'email',
  phone: 'tel',
  url: 'url',
  date: 'date',
  month: 'month'
};

const TEMPLATE_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 8h10M7 12h10M7 16h6"/></svg>';
const PLUS_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

/** Cartes des types personnalisés, à la suite des types intégrés */
export function templateCardsHtml(templates: ItemTemplate[], selectedId: string | undefined, tr: Tr, escape: Escape): string {
  return `${templates.map(t => `
    <button type="button" class="type-card" data-template="${escape(t.id)}" aria-pressed="${t.id === selectedId}">
      ${TEMPLATE_ICON}
      <span class="type-card-text">
        <span class="type-card-name">${escape(t.name)}</span>
        <span class="type-card-hint">${escape(t.fields.slice(0, 3).map(f => f.label).join(', '))}${t.fields.length > 3 ? '…' : ''}</span>
      </span>
    </button>`).join('')}
    <button type="button" class="type-card type-card-manage" data-manage-templates>
      ${PLUS_ICON}
      <span class="type-card-text">
        <span class="type-card-name">${templates.length ? tr('Gérer mes types', 'Manage my types') : tr('Créer un type', 'Create a type')}</span>
        <span class="type-card-hint">${tr('Vos propres champs : abonnement, licence, véhicule…', 'Your own fields: subscription, licence, vehicle…')}</span>
      </span>
    </button>`;
}

/** Champs d'un type personnalisé dans le formulaire de l'élément */
export function templateFieldsHtml(template: ItemTemplate, fields: CredentialField[] | undefined, tr: Tr, escape: Escape): string {
  return template.fields.map(f => {
    const id = `tpl-${escape(f.id)}`;
    const value = escape(templateValue(f, fields));
    const required = f.required ? ' required aria-required="true"' : '';
    const label = `<label class="form-label" for="${id}">${escape(f.label)}${f.required ? ' <span class="required-mark" aria-hidden="true">*</span>' : ''}</label>`;
    const brut = templateValue(f, fields);
    const mode = INPUT_MODES[f.kind] ? ` inputmode="${INPUT_MODES[f.kind]}"` : '';

    if (f.kind === 'multiline') {
      const zone = `<textarea class="form-input" id="${id}" data-tpl-field="${escape(f.id)}" rows="3"${required}>${value}</textarea>`;
      return `<div class="form-field">${label}${zone}</div>`;
    }
    if (f.kind === 'boolean') {
      // Une case à cocher porte son propre libellé : pas de label au-dessus
      const coche = brut === 'true' ? ' checked' : '';
      return `<div class="form-field"><label class="check-row"><input type="checkbox" data-tpl-field="${escape(f.id)}" data-tpl-bool id="${id}"${coche}> ${escape(f.label)}</label></div>`;
    }
    if (f.kind === 'choice') {
      const options = f.options ?? [];
      const choisi = options.includes(brut) ? brut : '';
      const liste = `<select class="form-input" id="${id}" data-tpl-field="${escape(f.id)}"${required}>
          <option value=""${choisi ? '' : ' selected'}>${f.required ? tr('À choisir…', 'Choose…') : tr('Aucun', 'None')}</option>
          ${options.map(o => `<option value="${escape(o)}"${o === choisi ? ' selected' : ''}>${escape(o)}</option>`).join('')}
        </select>`;
      return `<div class="form-field">${label}${liste}</div>`;
    }
    const input = `<input class="form-input${f.kind === 'secret' || f.kind === 'pin' ? ' mono' : ''}" id="${id}" data-tpl-field="${escape(f.id)}" value="${value}"${required}
          type="${INPUT_TYPES[f.kind] ?? 'text'}"${mode} autocomplete="off" spellcheck="false">`;
    return `<div class="form-field">${label}${input}</div>`;
  }).join('') || `<p class="field-hint">${tr('Ce type n’a aucun champ.', 'This type has no field.')}</p>`;
}

export function readTemplateValues(root: HTMLElement): Record<string, string> {
  const values: Record<string, string> = {};
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-tpl-field]').forEach(el => {
    // Une case à cocher n'a pas de valeur utile : c'est son état qu'on garde
    values[el.dataset.tplField!] = el instanceof HTMLInputElement && el.type === 'checkbox'
      ? String(el.checked)
      : el.value;
  });
  return values;
}

/* ── Éditeur des types ─────────────────────────────────────────────────── */

type DraftField = Omit<TemplateField, 'id'> & { id?: string };

export interface TemplateEditorActions {
  templates(): ItemTemplate[];
  save(input: { id?: string; name: string; fields: DraftField[] }): ItemTemplate;
  remove(id: string): void;
  /** Nombre d'éléments créés avec ce type, pour prévenir avant de le supprimer */
  usage(id: string): number;
  confirm(message: string): Promise<boolean>;
  toast(message: string, kind: 'success' | 'error'): void;
  errorMessage(err: unknown): string;
  tr: Tr;
  escape: Escape;
}

export function mountTemplateEditor(host: HTMLElement, a: TemplateEditorActions): void {
  const { tr, escape } = a;
  let editing: { id?: string; name: string; fields: DraftField[] } | null = null;

  const list = () => {
    const templates = a.templates();
    host.innerHTML = `
      <p class="modal-text">${tr('Un type décrit les champs d’un élément. Les éléments gardent leurs valeurs même si le type change ou disparaît.', 'A type describes an item’s fields. Items keep their values even if the type changes or disappears.')}</p>
      <ul class="template-list">${templates.map(t => `
        <li class="template-row" data-id="${escape(t.id)}">
          <span class="template-row-text"><strong>${escape(t.name)}</strong><small>${escape(t.fields.map(f => f.label).join(' · '))}</small></span>
          <button type="button" class="btn-primary btn-ghost btn-sm" data-edit>${tr('Modifier', 'Edit')}</button>
          <button type="button" class="btn-primary btn-ghost btn-sm" data-remove>${tr('Supprimer', 'Delete')}</button>
        </li>`).join('') || `<li class="field-hint">${tr('Aucun type pour l’instant.', 'No type yet.')}</li>`}</ul>
      <div class="account-actions account-actions-end"><button type="button" class="btn-primary btn-accent" data-new>${tr('Nouveau type', 'New type')}</button></div>`;
    host.querySelector('[data-new]')!.addEventListener('click', () => {
      editing = { name: '', fields: [{ label: '', kind: 'text' }] };
      edit();
    });
    host.querySelectorAll<HTMLElement>('.template-row').forEach(row => {
      const template = templates.find(t => t.id === row.dataset.id)!;
      row.querySelector('[data-edit]')!.addEventListener('click', () => {
        editing = { id: template.id, name: template.name, fields: template.fields.map(f => ({ ...f })) };
        edit();
      });
      row.querySelector('[data-remove]')!.addEventListener('click', async () => {
        const used = a.usage(template.id);
        const ok = await a.confirm(used
          ? tr(`${used} élément(s) utilisent « ${template.name} ». Ils gardent toutes leurs valeurs.`, `${used} item(s) use “${template.name}”. They keep all their values.`)
          : tr(`Supprimer « ${template.name} » ?`, `Delete “${template.name}”?`));
        if (!ok) return;
        a.remove(template.id);
        list();
      });
    });
  };

  const edit = () => {
    if (!editing) return list();
    const draft = editing;
    host.innerHTML = `
      <div class="form-field">
        <label class="form-label" for="tpl-name">${tr('Nom du type', 'Type name')}</label>
        <input class="form-input" id="tpl-name" maxlength="40" value="${escape(draft.name)}" placeholder="${tr('Abonnement, Licence logicielle, Véhicule…', 'Subscription, Software licence, Vehicle…')}">
      </div>
      <div class="form-label">${tr('Champs', 'Fields')}</div>
      <ol class="template-fields">${draft.fields.map((f, i) => `
        <li class="template-field-row" data-index="${i}">
          <input class="form-input" data-f="label" maxlength="40" value="${escape(f.label)}" placeholder="${tr('Libellé', 'Label')}" aria-label="${tr('Libellé du champ', 'Field label')}">
          <select class="form-input" data-f="kind" aria-label="${tr('Genre de champ', 'Field kind')}">${TEMPLATE_FIELD_KINDS.map(k => `<option value="${k}"${k === f.kind ? ' selected' : ''}>${tr(...KIND_LABELS[k])}</option>`).join('')}</select>
          <label class="check-inline"><input type="checkbox" data-f="required"${f.required ? ' checked' : ''}> ${tr('Requis', 'Required')}</label>
          <button type="button" class="icon-btn" data-drop aria-label="${tr('Retirer ce champ', 'Remove this field')}">✕</button>
          ${f.kind === 'choice' ? `<input class="form-input template-field-options" data-f="options" maxlength="400" value="${escape((f.options ?? []).join(', '))}"
            placeholder="${tr('Mensuel, Annuel, À vie', 'Monthly, Yearly, Lifetime')}" aria-label="${tr('Réponses possibles, séparées par des virgules', 'Possible answers, separated by commas')}">` : ''}
          ${KIND_HINTS[f.kind] ? `<span class="field-hint template-field-hint">${tr(...KIND_HINTS[f.kind]!)}</span>` : ''}
        </li>`).join('')}</ol>
      <button type="button" class="btn-primary btn-ghost btn-sm" data-add-field${draft.fields.length >= MAX_TEMPLATE_FIELDS ? ' disabled' : ''}>${tr('+ Ajouter un champ', '+ Add a field')}</button>
      <div class="form-error" data-tpl-error hidden></div>
      <div class="account-actions account-actions-end">
        <button type="button" class="btn-primary btn-ghost" data-cancel>${tr('Retour', 'Back')}</button>
        <button type="button" class="btn-primary btn-accent" data-save>${tr('Enregistrer le type', 'Save type')}</button>
      </div>`;

    // Garde la saisie en cours avant de redessiner (ajout ou retrait d'un champ)
    const sync = () => {
      draft.name = host.querySelector<HTMLInputElement>('#tpl-name')!.value;
      host.querySelectorAll<HTMLElement>('.template-field-row').forEach(row => {
        const f = draft.fields[Number(row.dataset.index)];
        f.label = row.querySelector<HTMLInputElement>('[data-f="label"]')!.value;
        f.kind = row.querySelector<HTMLSelectElement>('[data-f="kind"]')!.value as TemplateFieldKind;
        f.required = row.querySelector<HTMLInputElement>('[data-f="required"]')!.checked || undefined;
        const options = row.querySelector<HTMLInputElement>('[data-f="options"]');
        // Les réponses restent en mémoire même si le genre change puis revient
        if (options) f.options = normalizeOptions(options.value.split(','));
      });
    };
    host.querySelectorAll<HTMLSelectElement>('[data-f="kind"]').forEach(select => select.addEventListener('change', () => {
      // Le genre commande ce que la ligne affiche : on redessine, saisie gardée
      sync();
      edit();
      const index = Number(select.closest<HTMLElement>('.template-field-row')!.dataset.index);
      host.querySelector<HTMLSelectElement>(`.template-field-row[data-index="${index}"] [data-f="kind"]`)?.focus();
    }));
    host.querySelector('[data-add-field]')!.addEventListener('click', () => {
      sync();
      draft.fields.push({ label: '', kind: 'text' });
      edit();
      host.querySelector<HTMLInputElement>('.template-field-row:last-child [data-f="label"]')?.focus();
    });
    host.querySelectorAll<HTMLElement>('[data-drop]').forEach(button => button.addEventListener('click', () => {
      sync();
      draft.fields.splice(Number(button.closest<HTMLElement>('.template-field-row')!.dataset.index), 1);
      edit();
    }));
    host.querySelector('[data-cancel]')!.addEventListener('click', () => { editing = null; list(); });
    host.querySelector('[data-save]')!.addEventListener('click', () => {
      sync();
      try {
        const saved = a.save(draft);
        a.toast(tr(`Type « ${saved.name} » enregistré`, `Type “${saved.name}” saved`), 'success');
        editing = null;
        list();
      } catch (err) {
        const error = host.querySelector<HTMLElement>('[data-tpl-error]')!;
        error.textContent = a.errorMessage(err);
        error.hidden = false;
      }
    });
    host.querySelector<HTMLInputElement>('#tpl-name')!.focus();
  };

  list();
}
