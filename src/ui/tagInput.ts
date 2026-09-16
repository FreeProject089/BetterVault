import { renderItemIcon } from '../icons/iconLibrary';
import type { TagDef } from '../types/vault';
import { normalizeTagName } from '../store/vaultStore';

export interface TagInputHandle {
  getTags(): string[];
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);

const safeColor = (color?: string) => (color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#8b949e');

/** Champ de saisie de tags : pastilles, suggestions des tags existants, Entrée ou virgule pour ajouter */
export function mountTagInput(host: HTMLElement, options: { initial: string[]; suggestions: TagDef[]; placeholder: string; removeLabel: (tag: string) => string }): TagInputHandle {
  const tags: string[] = [];
  const listId = `tag-suggestions-${Math.random().toString(36).slice(2, 9)}`;

  host.classList.add('tag-input');
  host.innerHTML = `
    <span class="tag-input-chips"></span>
    <input type="text" class="tag-input-field" list="${listId}" maxlength="32" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(options.placeholder)}" aria-label="${escapeHtml(options.placeholder)}">
    <datalist id="${listId}">${options.suggestions.map(t => `<option value="${escapeHtml(t.name)}"></option>`).join('')}</datalist>`;

  const chips = host.querySelector('.tag-input-chips') as HTMLElement;
  const input = host.querySelector('.tag-input-field') as HTMLInputElement;
  const findDef = (name: string) => options.suggestions.find(t => t.name.toLowerCase() === name.toLowerCase());

  const render = () => {
    chips.innerHTML = tags.map((tag, index) => {
      const def = findDef(tag);
      return `
      <span class="tag-chip" style="--tag-color:${safeColor(def?.color)}">
        ${def?.icon ? `<span class="tag-chip-icon">${renderItemIcon(def.icon, 12)}</span>` : ''}
        <span>${escapeHtml(tag)}</span>
        <button type="button" class="tag-chip-remove" data-index="${index}" aria-label="${escapeHtml(options.removeLabel(tag))}">×</button>
      </span>`;
    }).join('');
  };

  const add = (raw: string) => {
    for (const part of raw.split(',')) {
      const name = normalizeTagName(part);
      if (!name || tags.some(t => t.toLowerCase() === name.toLowerCase())) continue;
      tags.push(findDef(name)?.name ?? name);
    }
    input.value = '';
    render();
  };

  input.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) {
      e.preventDefault();
      e.stopPropagation(); // n'envoie pas le formulaire de la modale
      add(input.value);
    } else if (e.key === 'Backspace' && !input.value && tags.length) {
      tags.pop();
      render();
    }
  });
  input.addEventListener('change', () => {
    if (findDef(input.value.trim())) add(input.value);
  });
  input.addEventListener('blur', () => {
    if (input.value.trim()) add(input.value);
  });
  chips.addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('.tag-chip-remove');
    if (!button) return;
    tags.splice(Number(button.dataset.index), 1);
    render();
    input.focus();
  });
  host.addEventListener('click', e => {
    if (e.target === host) input.focus();
  });

  add(options.initial.join(','));

  return {
    getTags: () => {
      if (input.value.trim()) add(input.value);
      return [...tags];
    }
  };
}
