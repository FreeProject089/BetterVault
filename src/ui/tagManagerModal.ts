import { ACTION_ICONS, tagColor } from './icons';
import { TAG_COLORS, vaultStore } from '../store/vaultStore';
import { renderItemIcon, type ItemIcon } from '../icons/iconLibrary';
import { accountErrorMessage } from '../ui/authScreen';
import { mountIconPicker } from '../ui/iconPicker';
import { mountColorPicker } from '../ui/colorPicker';
import { GEN_ICONS } from '../ui/icons';
import type { AppController } from '../main';

/** Gestion des tags : couleur, icône, renommage, suppression */
export function openTagManagerModal(app: AppController): void {
  const tr = (fr: string, en: string) => app.tr(fr, en);
  let newColor = TAG_COLORS[vaultStore.getTags().length % TAG_COLORS.length];

  const box = app.openModal(`
    <div class="modal-header">
      <div class="modal-title">Tags</div>
      <button class="modal-close">${GEN_ICONS.close}</button>
    </div>
    <div class="modal-body">
      <form class="tag-create" data-tag-create>
        <div class="form-row" style="grid-template-columns:minmax(0,1fr) auto;">
          <input class="form-input" id="tag-new-name" maxlength="32" placeholder="${tr('Nom du nouveau tag', 'New tag name')}" aria-label="${tr('Nom du nouveau tag', 'New tag name')}" autocomplete="off" data-autofocus>
          <button class="btn-primary btn-accent" type="submit">${tr('Ajouter', 'Add')}</button>
        </div>
        <div data-new-color></div>
        <span class="tag-chip tag-create-preview" data-preview><span>${tr('Aperçu', 'Preview')}</span></span>
      </form>
      <div class="tag-manager-list" data-tag-list></div>
    </div>
    <div class="modal-footer">
      <button class="btn-primary" data-close>${tr('Fermer', 'Close')}</button>
    </div>
  `);

  const listEl = box.querySelector('[data-tag-list]') as HTMLElement;
  const nameInput = box.querySelector('#tag-new-name') as HTMLInputElement;
  const preview = box.querySelector('[data-preview]') as HTMLElement;

  const updatePreview = () => {
    preview.style.setProperty('--tag-color', newColor);
    (preview.firstElementChild as HTMLElement).textContent = nameInput.value.trim() || tr('Aperçu', 'Preview');
  };
  const newColorPicker = mountColorPicker(box.querySelector('[data-new-color]') as HTMLElement, {
    value: newColor,
    presets: TAG_COLORS,
    label: tr('Couleur', 'Color'),
    customLabel: tr('Couleur personnalisée', 'Custom color'),
    onChange: color => {
      newColor = color;
      updatePreview();
    }
  });
  nameInput.addEventListener('input', updatePreview);
  updatePreview();

  const render = () => {
    const tags = vaultStore.getTags();
    if (tags.length === 0) {
      listEl.innerHTML = `<p class="modal-text">${tr('Aucun tag pour l’instant. Vous pouvez aussi en créer depuis un identifiant ou une tâche.', 'No tags yet. You can also create them from a credential or a task.')}</p>`;
      return;
    }
    listEl.innerHTML = tags.map(tag => {
      const count = vaultStore.countTagUsage(tag.name);
      return `
        <div class="tag-manager-row" data-tag-id="${tag.id}">
          <button type="button" class="tag-icon-button" data-tag-icon title="${tr('Choisir une icône', 'Choose an icon')}" aria-label="${tr('Icône de', 'Icon for')} ${app.escapeHtml(tag.name)}" aria-expanded="false" style="color:${tagColor(tag.color)};">
            <span data-tag-icon-preview>${tag.icon ? renderItemIcon(tag.icon, 16) : `<span class="tag-dot" style="background-color:${tagColor(tag.color)};"></span>`}</span>
          </button>
          <input class="form-input tag-rename" value="${app.escapeHtml(tag.name)}" maxlength="32" aria-label="${tr('Nom du tag', 'Tag name')}">
          <span class="tag-usage">${tr(`${count} élément${count > 1 ? 's' : ''}`, `${count} item${count === 1 ? '' : 's'}`)}</span>
          <button type="button" class="icon-btn tag-delete" title="${tr('Supprimer', 'Delete')}" aria-label="${tr('Supprimer', 'Delete')} ${app.escapeHtml(tag.name)}">${ACTION_ICONS.trash}</button>
          <div data-color-host></div>
          <div class="tag-icon-panel" data-tag-icon-panel hidden></div>
        </div>`;
    }).join('');

    listEl.querySelectorAll<HTMLElement>('[data-tag-id]').forEach(row => {
      const tag = tags.find(t => t.id === row.dataset.tagId);
      if (!tag) return;
      const iconButton = row.querySelector('[data-tag-icon]') as HTMLButtonElement;
      const iconPreview = row.querySelector('[data-tag-icon-preview]') as HTMLElement;
      const iconPanel = row.querySelector('[data-tag-icon-panel]') as HTMLElement;
      const renderTagIcon = (icon: ItemIcon | undefined, color: string) => {
        iconButton.style.color = color;
        iconPreview.innerHTML = icon ? renderItemIcon(icon, 16) : `<span class="tag-dot" style="background-color:${color};"></span>`;
      };

      mountColorPicker(row.querySelector('[data-color-host]') as HTMLElement, {
        value: tagColor(tag.color),
        presets: TAG_COLORS,
        label: tr(`Couleur de ${tag.name}`, `${tag.name} color`),
        customLabel: tr('Couleur personnalisée', 'Custom color'),
        onChange: color => {
          vaultStore.updateTag(tag.id, { color });
          renderTagIcon(vaultStore.getTags().find(t => t.id === tag.id)?.icon, color);
          app.renderSidebar();
        }
      });

      iconButton.addEventListener('click', () => {
        const open = iconPanel.hidden;
        listEl.querySelectorAll<HTMLElement>('[data-tag-icon-panel]').forEach(panel => { panel.hidden = true; });
        listEl.querySelectorAll<HTMLElement>('[data-tag-icon]').forEach(button => button.setAttribute('aria-expanded', 'false'));
        if (!open) return;
        iconPanel.hidden = false;
        iconButton.setAttribute('aria-expanded', 'true');
        mountIconPicker(iconPanel, {
          tr,
          current: tag.icon,
          initialSet: tag.icon?.set ?? 'lucide',
          initialQuery: tag.name,
          onPick: picked => {
            vaultStore.updateTag(tag.id, { icon: picked ?? null });
            const color = vaultStore.getTags().find(t => t.id === tag.id)?.color ?? tag.color;
            renderTagIcon(picked, tagColor(color));
            iconPanel.hidden = true;
            iconButton.setAttribute('aria-expanded', 'false');
            iconButton.focus();
            app.renderSidebar();
            app.renderList();
          }
        }).focus();
      });
    });
  };

  const rowTag = (el: HTMLElement) => {
    const id = el.closest<HTMLElement>('[data-tag-id]')?.dataset.tagId;
    return vaultStore.getTags().find(t => t.id === id);
  };

  listEl.addEventListener('click', async e => {
    const target = e.target as HTMLElement;
    if (!target.closest('.tag-delete')) return;
    const tag = rowTag(target);
    if (!tag) return;
    const count = vaultStore.countTagUsage(tag.name);
    const confirmed = await app.confirmDialog({
      title: tr('Supprimer le tag ?', 'Delete tag?'),
      message: tr(`« ${tag.name} » sera retiré de ${count} élément(s). Les éléments sont conservés.`, `"${tag.name}" will be removed from ${count} item(s). The items are kept.`),
      confirmLabel: tr('Supprimer', 'Delete'),
      danger: true
    });
    if (!confirmed) return;
    if (app.activeTag === tag.name) app.activeTag = null;
    vaultStore.deleteTag(tag.id);
    render();
  });

  listEl.addEventListener('change', e => {
    const input = e.target as HTMLInputElement;
    if (!input.classList.contains('tag-rename')) return;
    const tag = rowTag(input);
    if (!tag) return;
    try {
      const wasActive = app.activeTag === tag.name;
      vaultStore.updateTag(tag.id, { name: input.value });
      if (wasActive) app.activeTag = vaultStore.getTags().find(t => t.id === tag.id)?.name ?? null;
    } catch (err) {
      app.showToast(accountErrorMessage(err), 'error');
    }
    render();
  });

  listEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.target as HTMLElement).classList.contains('tag-rename')) {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
  });

  box.querySelector('[data-tag-create]')?.addEventListener('submit', e => {
    e.preventDefault();
    try {
      const name = nameInput.value;
      if (vaultStore.getTagByName(name)) throw new Error(tr('Ce tag existe déjà', 'This tag already exists'));
      vaultStore.createTag(name, newColor);
      nameInput.value = '';
      newColor = TAG_COLORS[vaultStore.getTags().length % TAG_COLORS.length];
      newColorPicker.setValue(newColor);
      updatePreview();
      render();
    } catch (err) {
      app.showToast(accountErrorMessage(err), 'error');
    }
    nameInput.focus();
  });

  render();
}
