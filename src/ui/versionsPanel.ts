import type { CredentialItem, Task, TrashEntry } from '../types/vault';
import { contentOf, type ItemConflict, type ItemVersion } from '../store/versions';

/**
 * Historique, conflits et corbeille : ce que l'utilisateur voit du moteur de versions.
 *
 * Tout est dit en langage courant (« Mot de passe modifié le… ») : un identifiant de
 * version ne veut rien dire pour personne. Les valeurs sensibles ne s'affichent
 * jamais en clair dans ces listes.
 */

export interface VersionsContext {
  tr: (fr: string, en: string) => string;
  esc: (value: string) => string;
  locale: () => string;
  confirm: (options: { title: string; message: string; confirmLabel: string; danger?: boolean; skippable?: boolean }) => Promise<boolean>;
  restoreVersion: (rev: string) => boolean;
  resolveConflict: (conflict: ItemConflict, keep: 'current' | 'other') => void;
  toast: (message: string, kind?: 'success' | 'info' | 'error') => void;
}

const SENSITIVE = new Set(['password', 'totpSecret', 'card', 'sshKey', 'passkeys', 'fields', 'notes']);

function fieldLabel(field: string, tr: VersionsContext['tr']): string {
  const labels: Record<string, [string, string]> = {
    title: ['Nom', 'Name'], username: ['Identifiant', 'Username'], password: ['Mot de passe', 'Password'],
    website: ['Site', 'Website'], notes: ['Notes', 'Notes'], totpSecret: ['Code 2FA', '2FA code'],
    tags: ['Tags', 'Tags'], fields: ['Champs', 'Fields'], attachments: ['Fichiers', 'Files'],
    card: ['Carte', 'Card'], identity: ['Identité', 'Identity'], sshKey: ['Clé SSH', 'SSH key'],
    vaultId: ['Coffre', 'Vault'], icon: ['Icône', 'Icon'],
    description: ['Description', 'Description'], status: ['Statut', 'Status'], priority: ['Priorité', 'Priority'],
    dueDate: ['Échéance', 'Due date'], subtasks: ['Sous-tâches', 'Subtasks'], passkeys: ['Passkeys', 'Passkeys'],
    isFavorite: ['Favori', 'Favourite'], expiresAt: ['Expiration', 'Expiry']
  };
  const pair = labels[field];
  return pair ? tr(pair[0], pair[1]) : field;
}

/** Aperçu d'une valeur, sans rien révéler de sensible */
function preview(field: string, value: unknown, ctx: VersionsContext): string {
  if (value === null || value === undefined || value === '') return ctx.tr('(vide)', '(empty)');
  if (SENSITIVE.has(field)) return '••••••••';
  if (Array.isArray(value)) return ctx.esc(value.map(v => (typeof v === 'string' ? v : '…')).join(', ')).slice(0, 80);
  if (typeof value === 'object') return ctx.tr('(modifié)', '(changed)');
  return ctx.esc(String(value)).slice(0, 80);
}

const IGNORED = new Set(['updatedAt', 'createdAt', 'passwordHistory', 'domain', 'id']);

/** Champs qui diffèrent entre deux contenus, pour résumer une version */
function changedFields(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter(k => !IGNORED.has(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

export function renderVersioning(item: CredentialItem | Task, ctx: VersionsContext): string {
  const conflicts = item.conflicts ?? [];
  const history = [...(item.history ?? [])].reverse();
  if (!conflicts.length && !history.length) return '';
  const date = (t: number) => new Date(t).toLocaleString(ctx.locale(), { dateStyle: 'medium', timeStyle: 'short' });
  const current = item as unknown as Record<string, unknown>;

  const conflictsHtml = conflicts.map((c, i) => `
    <div class="conflict-row">
      <div class="conflict-text">
        <strong>${ctx.esc(fieldLabel(c.field, ctx.tr))}</strong>
        ${ctx.tr('a été modifié sur deux appareils en même temps.', 'was changed on two devices at the same time.')}
        <span class="conflict-values">${ctx.tr('Gardé', 'Kept')} : ${preview(c.field, current[c.field], ctx)} · ${ctx.tr('Autre', 'Other')} : ${preview(c.field, c.value, ctx)} <span class="field-hint">(${date(c.at)})</span></span>
      </div>
      <div class="conflict-actions">
        <button type="button" class="btn-primary btn-sm" data-conflict="${i}" data-keep="current">${ctx.tr('Garder', 'Keep')}</button>
        <button type="button" class="btn-primary btn-sm" data-conflict="${i}" data-keep="other">${ctx.tr('Prendre l’autre', 'Use other')}</button>
      </div>
    </div>`).join('');

  // Chaque ligne dit ce qui a changé ENTRE cette version et la suivante
  const versionsHtml = history.map((version, i) => {
    // La version courante se compare par son contenu seul, sans son historique ni sa version
    const next = i === 0 ? contentOf(current) : history[i - 1].snapshot;
    const fields = changedFields(version.snapshot, next).map(f => fieldLabel(f, ctx.tr));
    return `
      <li class="version-row">
        <div>
          <div class="version-date">${date(version.at)}</div>
          <div class="field-hint">${fields.length
            ? `${ctx.tr('Ensuite modifié', 'Then changed')} : ${ctx.esc(fields.slice(0, 4).join(', '))}${fields.length > 4 ? '…' : ''}`
            : ctx.tr('Aucune différence visible', 'No visible difference')}</div>
        </div>
        <button type="button" class="btn-primary btn-sm" data-restore-rev="${ctx.esc(version.rev)}">${ctx.tr('Restaurer', 'Restore')}</button>
      </li>`;
  }).join('');

  return `
    ${conflicts.length ? `
      <div class="notice notice-warning versions-conflicts" role="status">
        <div class="versions-title">${ctx.tr('À vérifier', 'Needs a look')}</div>
        ${conflictsHtml}
      </div>` : ''}
    ${history.length ? `
      <details class="versions-panel">
        <summary>${ctx.tr('Historique', 'History')} <span class="nav-count">${history.length}</span></summary>
        <ul class="version-list">${versionsHtml}</ul>
      </details>` : ''}`;
}

export function wireVersioning(root: HTMLElement, item: CredentialItem | Task, ctx: VersionsContext): void {
  root.querySelectorAll<HTMLButtonElement>('[data-conflict]').forEach(button => {
    button.addEventListener('click', () => {
      const conflict = item.conflicts?.[Number(button.dataset.conflict)];
      if (!conflict) return;
      ctx.resolveConflict(conflict, button.dataset.keep === 'other' ? 'other' : 'current');
      ctx.toast(ctx.tr('Conflit réglé', 'Conflict resolved'), 'success');
    });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-restore-rev]').forEach(button => {
    button.addEventListener('click', async () => {
      const ok = await ctx.confirm({
        title: ctx.tr('Restaurer cette version ?', 'Restore this version?'),
        message: ctx.tr('La version actuelle rejoint l’historique : vous pourrez y revenir.', 'The current version moves into the history: you can come back to it.'),
        confirmLabel: ctx.tr('Restaurer', 'Restore'),
        skippable: true
      });
      if (!ok) return;
      if (ctx.restoreVersion(button.dataset.restoreRev!)) ctx.toast(ctx.tr('Version restaurée', 'Version restored'), 'success');
    });
  });
}

/* ── Corbeille ─────────────────────────────────────────────────────────── */

export function renderTrash(entries: TrashEntry[], ctx: VersionsContext, trashDays: number): string {
  if (!entries.length) {
    return `<div class="empty-state"><p class="modal-text">${ctx.tr('La corbeille est vide.', 'The trash is empty.')}</p></div>`;
  }
  const date = (t: number) => new Date(t).toLocaleDateString(ctx.locale(), { dateStyle: 'medium' });
  const left = (t: number) => Math.max(0, Math.ceil((t + trashDays * 86_400_000 - Date.now()) / 86_400_000));
  return `
    <p class="field-hint">${ctx.tr(`Les éléments supprimés restent ${trashDays} jours, puis partent définitivement avec leurs fichiers.`, `Deleted items stay ${trashDays} days, then go for good with their files.`)}</p>
    <ul class="trash-list">
      ${entries.map(entry => `
        <li class="trash-row">
          <div class="trash-text">
            <span class="trash-title">${ctx.esc((entry.item as { title?: string }).title || ctx.tr('Sans nom', 'Untitled'))}</span>
            <span class="field-hint">${entry.kind === 'task' ? ctx.tr('Tâche', 'Task') : ctx.tr('Élément', 'Item')} · ${ctx.tr('supprimé le', 'deleted on')} ${date(entry.deletedAt)} · ${ctx.tr(`encore ${left(entry.deletedAt)} j`, `${left(entry.deletedAt)} days left`)}</span>
          </div>
          <div class="trash-actions">
            <button type="button" class="btn-primary btn-sm" data-trash-restore="${ctx.esc(entry.item.id)}">${ctx.tr('Restaurer', 'Restore')}</button>
            <button type="button" class="icon-btn" data-trash-purge="${ctx.esc(entry.item.id)}" title="${ctx.tr('Supprimer définitivement', 'Delete forever')}" aria-label="${ctx.tr('Supprimer définitivement', 'Delete forever')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </li>`).join('')}
    </ul>`;
}

export type { ItemVersion };
