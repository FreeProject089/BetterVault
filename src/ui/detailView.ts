import { vaultStore } from '../store/vaultStore';
import type { Task } from '../types/vault';
import { generateTOTP } from '../crypto/totpEngine';
import { calculatePasswordEntropy } from '../crypto/vaultCrypto';
import { describeRecurrence, getDependents, getOpenBlockers, planTaskCompletion } from '../tasks/taskEngine';
import { expiryInfo } from '../ui/expiry';
import { ACTION_ICONS } from '../ui/icons';
import { memberChipHtml } from '../ui/memberChip';
import { accountService } from '../app/services';
import { renderVersioning, wireVersioning } from '../ui/versionsPanel';
import { itemTypeOf } from '../types/itemTypes';
import { i18n } from '../i18n';
import type { AppController } from '../main';

/** Fiche d'un identifiant ou d'une tâche, avec ses actions */
export function renderDetail(app: AppController, id: string | null): void {
  const container = document.getElementById('detail-container');
  if (!container) return;

  if (!id) {
    container.innerHTML = `
      <div class="detail-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <p>${i18n.t.common.emptySelection}</p>
      </div>`;
    return;
  }

  const data = vaultStore.getData();

  /* ─── Cas 1 : Tâche ─────────────────────────────────────────────────── */
  const task = data.tasks.find(t => t.id === id);
  if (task) {
    const linkedCred = task.linkedCredentialId
      ? data.credentials.find(c => c.id === task.linkedCredentialId)
      : null;

    const statusColors: Record<string, string> = {
      todo: 'var(--text-muted)',
      in_progress: 'var(--accent-blue)',
      completed: 'var(--accent-green)',
      blocked: 'var(--accent-red)'
    };
    const statusLabels: Record<string, string> = {
      todo: i18n.t.tasks.statusTodo,
      in_progress: i18n.t.tasks.statusInProgress,
      completed: i18n.t.tasks.statusCompleted,
      blocked: i18n.t.tasks.statusBlocked
    };

    const locale = i18n.getLocale() === 'fr' ? 'fr' : 'en';
    const blockers = getOpenBlockers(task, data.tasks);
    const dependencyTasks = (task.dependsOn ?? [])
      .map(depId => data.tasks.find(t => t.id === depId))
      .filter((t): t is Task => !!t);
    const dependents = getDependents(task.id, data.tasks);
    const taskLinkRow = (t: Task) => `
      <div class="field-box dep-task-row" data-task-id="${t.id}" style="cursor:pointer;margin-bottom:6px;">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
          <span style="font-size:10px;color:${statusColors[t.status]};">&#9679;</span>
          <span style="font-size:13px;font-weight:500;${t.status === 'completed' ? 'text-decoration:line-through;opacity:0.5;' : ''}">${app.escapeHtml(t.title)}</span>
        </div>
        <span style="font-size:11px;color:${statusColors[t.status]};">${statusLabels[t.status]}</span>
      </div>`;

    const planningHTML = `
      ${task.recurrence ? `
        <div class="field-group">
          <div class="field-label">${app.tr('Récurrence', 'Recurrence')}</div>
          <div class="field-box"><span class="field-val">${describeRecurrence(task.recurrence, locale)}</span></div>
        </div>` : ''}
      ${task.reminderAt ? `
        <div class="field-group">
          <div class="field-label">${app.tr('Rappel', 'Reminder')}</div>
          <div class="field-box">
            <span class="field-val">${new Date(task.reminderAt).toLocaleString(i18n.intlLocale())}</span>
            ${task.reminderSent ? `<span class="badge">${app.tr('ENVOYÉ', 'SENT')}</span>` : ''}
          </div>
        </div>` : ''}
      ${dependencyTasks.length ? `
        <div class="field-group">
          <div class="section-divider" style="margin-bottom:8px;">${app.tr('Dépend de', 'Depends on')} (${dependencyTasks.length - blockers.length}/${dependencyTasks.length})</div>
          ${blockers.length ? `
            <div style="padding:8px 12px;margin-bottom:8px;background:rgba(218,54,51,0.1);border:1px solid rgba(218,54,51,0.3);border-radius:var(--radius-md);color:var(--accent-red);font-size:12px;">
              ${app.tr(`${blockers.length} prérequis à terminer avant de clore cette tâche.`, `${blockers.length} prerequisite(s) must be completed first.`)}
            </div>` : ''}
          ${dependencyTasks.map(taskLinkRow).join('')}
        </div>` : ''}
      ${dependents.length ? `
        <div class="field-group">
          <div class="section-divider" style="margin-bottom:8px;">${app.tr('Bloque', 'Blocks')} (${dependents.length})</div>
          ${dependents.map(taskLinkRow).join('')}
        </div>` : ''}
    `;

    container.innerHTML = `
      <div class="detail-header">
        <div class="detail-header-left">
          <button class="detail-mobile-back" id="btn-detail-back" title="${i18n.t.common.close}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            <span>${i18n.t.common.close}</span>
          </button>
          <div class="detail-main-icon" style="color:${statusColors[task.status] || 'var(--text-secondary)'};">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 11 12 14 22 4"></polyline>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
            </svg>
          </div>
          <div>
            <div class="detail-title">${app.escapeHtml(task.title)}</div>
            <div class="detail-meta">${app.tr('Créée le', 'Created')} ${new Date(task.createdAt).toLocaleDateString(i18n.intlLocale())}</div>
            ${app.renderTagChips(task.tags)}
          </div>
        </div>
        <div class="detail-actions">
          <button class="btn-primary ${task.status === 'completed' ? '' : 'btn-accent'}" id="btn-toggle-task-status">
            ${task.status === 'completed' ? app.tr('Rouvrir', 'Reopen') : app.tr('Terminer', 'Complete')}
          </button>
          ${app.renderActionMenu([
            { id: 'btn-edit-task', label: app.tr('Modifier', 'Edit'), icon: ACTION_ICONS.edit },
            'separator',
            { id: 'btn-delete-task', label: app.tr('Supprimer', 'Delete'), icon: ACTION_ICONS.trash, danger: true }
          ])}
        </div>
      </div>

      <div class="detail-content">
        <div class="field-group">
          <div class="field-label">${app.tr('Statut et priorité', 'Status and priority')}</div>
          <div class="field-box">
            <span class="field-val" style="color:${statusColors[task.status]};">${statusLabels[task.status] || task.status}</span>
            <span class="badge priority-${task.priority}">${task.priority.toUpperCase()}</span>
          </div>
        </div>

        ${task.dueDate ? `
          <div class="field-group">
            <div class="field-label">${app.tr('Échéance', 'Due date')}</div>
            <div class="field-box"><span class="field-val">${task.dueDate}</span></div>
          </div>
        ` : ''}

        ${task.assignee ? `
          <div class="field-group">
            <div class="field-label">${app.tr('Attribuée à', 'Assigned to')}</div>
            <div class="field-box">${memberChipHtml(task.assignee, v => app.escapeHtml(v), { size: 24, me: accountService.getAccount()?.email ?? '' })}</div>
          </div>
        ` : ''}

        ${planningHTML}

        ${task.description ? `
          <div class="field-group">
            <div class="section-divider" style="margin-bottom:8px;">Description</div>
            <div class="field-box" style="white-space:pre-wrap;line-height:1.6;">${app.escapeHtml(task.description)}</div>
          </div>
        ` : ''}

        ${linkedCred ? `
          <div class="field-group">
            <div class="section-divider" style="margin-bottom:8px;">${app.tr('Identifiant lié', 'Linked credential')}</div>
            <div class="field-box" style="cursor:pointer;" id="btn-goto-linked-cred">
              <div style="display:flex;align-items:center;gap:10px;">
                <span style="display:flex;">${app.credentialIcon(linkedCred)}</span>
                <span class="field-val" style="font-weight:600;">${app.escapeHtml(linkedCred.title)}</span>
              </div>
              <span style="font-size:11px;color:var(--accent-blue);">${app.tr('Ouvrir', 'Open')} →</span>
            </div>
          </div>
        ` : ''}

        <!-- Sous-tâches Checklist -->
        <div class="field-group">
          <div class="section-divider" style="margin-bottom:8px;">
            Sous-tâches (${(task.subtasks || []).filter(s => s.isDone).length}/${(task.subtasks || []).length})
          </div>
          <div class="subtask-list" id="subtask-container">
            ${(task.subtasks || []).map(s => `
              <div class="subtask-item">
                <label class="subtask-left">
                  <input type="checkbox" class="subtask-checkbox" data-subtask-id="${s.id}" ${s.isDone ? 'checked' : ''}>
                  <span class="subtask-title ${s.isDone ? 'done' : ''}">${app.escapeHtml(s.title)}</span>
                </label>
                <button class="icon-btn btn-del-subtask" data-subtask-id="${s.id}" title="${app.tr('Supprimer', 'Delete')}" style="color:var(--text-muted);padding:2px 4px;">
                  ✕
                </button>
              </div>
            `).join('')}
          </div>
          <div class="subtask-add-row">
            <input class="form-input" id="input-new-subtask" type="text" placeholder="${app.tr('Ajouter une étape…', 'Add a step…')}" style="flex:1;font-size:12px;padding:6px 10px;">
            <button class="btn-primary" id="btn-add-subtask" style="font-size:11px;padding:6px 12px;">${app.tr('Ajouter', 'Add')}</button>
          </div>
        </div>

        <div class="field-group">
          <div class="section-divider" style="margin-bottom:8px;">Notes</div>
          <textarea class="note-editor" id="task-notes" placeholder="${app.tr('Notes sur cette tâche…', 'Notes about app task…')}">${app.escapeHtml(task.notes || '')}</textarea>
          <div style="display:flex;justify-content:flex-end;margin-top:6px;">
            <button class="btn-primary" id="btn-save-task-notes" style="font-size:11px;padding:5px 14px;">${app.tr('Enregistrer', 'Save')}</button>
          </div>
        </div>
      </div>
    `;

    app.bindActionMenus(container);

    document.getElementById('btn-detail-back')?.addEventListener('click', () => {
      document.getElementById('detail-container')?.classList.remove('mobile-active');
    });

    document.getElementById('btn-toggle-task-status')?.addEventListener('click', () => {
      if (task.status === 'completed') {
        const reopenedStatus = getOpenBlockers(task, vaultStore.getData().tasks).length > 0 ? 'blocked' : 'todo';
        vaultStore.updateTask(task.id, { status: reopenedStatus, completedAt: undefined });
        app.showToast(app.tr('Tâche rouverte', 'Task reopened'), 'success');
        return;
      }

      const plan = planTaskCompletion(task, vaultStore.getData().tasks);
      if (plan.blockers.length > 0) {
        const names = plan.blockers.map(b => `"${b.title}"`).join(', ');
        app.showToast(`${app.tr('Terminez d’abord', 'Complete first')} : ${names}`, 'error', 5000);
        return;
      }

      vaultStore.updateTask(task.id, plan.updates);
      plan.unblockedIds.forEach(unblockedId => vaultStore.updateTask(unblockedId, { status: 'todo' }));
      if (plan.nextOccurrence) {
        vaultStore.addTask(plan.nextOccurrence);
        app.showToast(`${app.tr('Tâche terminée — prochaine occurrence le', 'Task completed — next occurrence on')} ${plan.nextOccurrence.dueDate}`, 'success', 4000);
      } else {
        app.showToast(app.tr('Tâche terminée', 'Task completed'), 'success');
      }
    });

    document.querySelectorAll('.dep-task-row').forEach(el => {
      el.addEventListener('click', () => {
        const targetId = (el as HTMLElement).dataset.taskId;
        if (!targetId) return;
        app.selectedItemId = targetId;
        app.renderList();
        app.renderDetail(targetId);
      });
    });

    document.getElementById('btn-goto-linked-cred')?.addEventListener('click', () => {
      if (linkedCred) {
        app.activeView = 'all-credentials';
        app.selectedItemId = linkedCred.id;
        app.renderList();
        app.renderDetail(linkedCred.id);
      }
    });

    document.getElementById('btn-edit-task')?.addEventListener('click', () => {
      app.openCreateTaskModal(undefined, task.id);
    });

    document.getElementById('btn-delete-task')?.addEventListener('click', async () => {
      const confirmed = await app.confirmDialog({
        title: app.tr('Supprimer la tâche ?', 'Delete task?'),
        message: app.tr(`« ${task.title} » ira dans la corbeille, où elle reste 30 jours.`, `"${task.title}" will go to the trash, where it stays for 30 days.`),
        confirmLabel: app.tr('Supprimer', 'Delete'),
        danger: true,
        skippable: true
      });
      if (confirmed) {
        vaultStore.deleteTask(task.id);
        app.selectedItemId = null;
        app.renderDetail(null);
        app.showToast(app.tr('Tâche mise à la corbeille', 'Task moved to trash'), 'info', 6000, app.undoDelete(task.id));
      }
    });

    // Gestion des Sous-tâches
    const currentSubtasks = [...(task.subtasks || [])];

    document.getElementById('btn-add-subtask')?.addEventListener('click', () => {
      const inputEl = document.getElementById('input-new-subtask') as HTMLInputElement;
      const text = inputEl?.value.trim();
      if (text) {
        const newSub = { id: 'sub-' + Math.random().toString(36).substring(2, 8), title: text, isDone: false };
        vaultStore.updateTask(task.id, { subtasks: [...currentSubtasks, newSub] });
        app.renderDetail(task.id);
      }
    });

    document.getElementById('input-new-subtask')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') (document.getElementById('btn-add-subtask') as HTMLButtonElement)?.click();
    });

    document.querySelectorAll('.subtask-checkbox').forEach(el => {
      el.addEventListener('change', (e) => {
        const subId = (e.target as HTMLElement).dataset.subtaskId;
        const isDone = (e.target as HTMLInputElement).checked;
        const updated = currentSubtasks.map(s => s.id === subId ? { ...s, isDone } : s);
        vaultStore.updateTask(task.id, { subtasks: updated });
        app.renderDetail(task.id);
      });
    });

    document.querySelectorAll('.btn-del-subtask').forEach(el => {
      el.addEventListener('click', (e) => {
        const subId = (e.currentTarget as HTMLElement).dataset.subtaskId;
        const updated = currentSubtasks.filter(s => s.id !== subId);
        vaultStore.updateTask(task.id, { subtasks: updated });
        app.renderDetail(task.id);
      });
    });

    document.getElementById('btn-save-task-notes')?.addEventListener('click', () => {
      const notesEl = document.getElementById('task-notes') as HTMLTextAreaElement;
      if (notesEl) {
        vaultStore.updateTask(task.id, { notes: notesEl.value } as Partial<Task>);
        app.showToast(app.tr('Notes enregistrées', 'Notes saved'), 'success');
      }
    });
    return;
  }

  /* ─── Cas 2 : Credential ─────────────────────────────────────────────── */
  const cred = data.credentials.find(c => c.id === id);
  if (!cred) return;

  const detailType = itemTypeOf(cred.type);
  const entropy = calculatePasswordEntropy(cred.password);
  const linkedTasks = data.tasks.filter(t => t.linkedCredentialId === cred.id);

  // Jauge de force (4 segments)
  const strengthHTML = [0, 1, 2, 3]
    .map(i => `<div class="strength-segment" style="background-color:${i < entropy.score ? entropy.color : 'var(--bg-hover)'}"></div>`)
    .join('');

  // Tâches liées
  const linkedTasksHTML = linkedTasks.length > 0
    ? linkedTasks.map(t => `
        <div class="field-box linked-task-row" data-task-id="${t.id}" style="cursor:pointer;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:10px;color:${t.status === 'completed' ? 'var(--accent-green)' : 'var(--text-muted)'};">&#9679;</span>
            <span style="font-size:13px;font-weight:500;${t.status === 'completed' ? 'text-decoration:line-through;opacity:0.5;' : ''}">${t.title}</span>
          </div>
          <span class="badge priority-${t.priority}">${t.priority.charAt(0).toUpperCase()}</span>
        </div>`).join('')
    : `<div style="font-size:12px;color:var(--text-muted);padding:6px 0;">${app.tr('Aucune tâche liée', 'No linked tasks')}</div>`;

  // Passkeys HTML
  const passkeysHTML = cred.passkeys && cred.passkeys.length > 0 ? `
    <div class="field-group">
      <div class="field-label">Passkeys (${cred.passkeys.length})</div>
      ${cred.passkeys.map(pk => `
        <div class="field-box" style="margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="2">
              <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5z"></path>
            </svg>
            <span class="field-val">${app.escapeHtml(pk.rpId)} &middot; ${app.escapeHtml(pk.userName || '—')}</span>
          </div>
          <span style="display:flex;gap:4px;">
            ${pk.privateKey ? `<span class="badge" style="color:var(--accent-green);" title="${app.tr('Clé privée présente : exportable (CXF / KeePass)', 'Private key present: exportable (CXF / KeePass)')}">${app.tr('CLÉ', 'KEY')}</span>` : ''}
            <span class="badge" style="color:var(--accent-blue);">FIDO2</span>
          </span>
        </div>`).join('')}
    </div>` : '';

  // TOTP Card HTML
  const totpHTML = cred.totpSecret ? `
    <div class="field-group">
      <div class="field-label">${app.tr('Code 2FA', '2FA code')}</div>
      <div class="totp-card" id="detail-totp-container" style="cursor:pointer;" title="${app.tr('Cliquer pour copier', 'Click to copy')}">
        <div>
          <div class="totp-code-display" id="detail-totp-code">--- ---</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${app.tr('Cliquer pour copier', 'Click to copy')}</div>
        </div>
        <div class="totp-timer-ring">
          <svg width="42" height="42" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15.915" fill="none" stroke="var(--bg-tertiary)" stroke-width="3"></circle>
            <circle id="totp-circle-meter" cx="18" cy="18" r="15.915" fill="none" stroke="var(--accent-blue)" stroke-width="3"
              stroke-dasharray="100 100" stroke-dashoffset="0" stroke-linecap="round" transform="rotate(-90 18 18)"></circle>
          </svg>
          <div class="totp-timer-sec" id="detail-totp-seconds" style="position:absolute;">30</div>
        </div>
      </div>
    </div>` : '';

  // Website HTML
  const websiteHTML = cred.website ? `
    <div class="field-group">
      <div class="field-label">${app.tr('Site web', 'Website')}</div>
      <div class="field-box">
        <a href="${app.escapeHtml(app.safeHref(cred.website))}" target="_blank" rel="noopener noreferrer"
          style="color:var(--accent-blue);text-decoration:none;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">
          ${app.escapeHtml(cred.website)}
        </a>
        <div class="field-actions">
          <button class="icon-btn" title="${app.tr('Copier le lien', 'Copy link')}" id="btn-copy-url">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        </div>
      </div>
    </div>` : '';

  const favFill = cred.isFavorite ? 'currentColor' : 'none';
  const favColor = cred.isFavorite ? 'var(--accent-orange)' : 'var(--text-muted)';
  const favTitle = cred.isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris';

  // Expiration : carte dont la couleur et la barre indiquent l'urgence
  let expiryAlertHTML = '';
  const expiry = expiryInfo(cred.expiresAt, (fr, en) => app.tr(fr, en), app.dateLocale());
  if (expiry) {
    const title = expiry.state === 'expired'
      ? app.tr('Mot de passe expiré', 'Password expired')
      : expiry.state === 'ok' ? app.tr('Renouvellement prévu', 'Renewal planned') : app.tr('À renouveler bientôt', 'Renew soon');
    const elapsed = expiry.days <= 0 ? 100 : Math.max(6, Math.min(100, 100 - (expiry.days / 30) * 100));
    expiryAlertHTML = `
      <div class="expiry-card expiry-${expiry.state}">
        <span class="expiry-card-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
        </span>
        <div class="expiry-card-text">
          <div class="expiry-card-title">${title}</div>
          <div class="expiry-card-sub">${expiry.long}</div>
          ${expiry.state !== 'ok' ? `<div class="expiry-card-bar"><span style="width:${elapsed}%"></span></div>` : ''}
        </div>
        ${expiry.state !== 'ok' ? `<button class="btn-primary" type="button" id="btn-renew-cred">${app.tr('Renouveler', 'Renew')}</button>` : ''}
      </div>
    `;
  }

  container.innerHTML = `
    <div class="detail-header">
      <div class="detail-header-left">
        <button class="detail-mobile-back" id="btn-detail-back-cred" title="${app.tr('Retour', 'Back')}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          <span>${app.tr('Retour', 'Back')}</span>
        </button>
        <div class="detail-main-icon">${app.credentialIcon(cred, 24)}</div>
        <div>
          <div class="detail-title">${app.escapeHtml(cred.title)}</div>
          <div class="detail-meta">${detailType === 'login'
            ? app.escapeHtml(cred.domain || cred.website || app.tr('Aucun site', 'No website'))
            : app.typeBadge(detailType, cred.templateId)}</div>
          ${app.renderTagChips(cred.tags)}
        </div>
      </div>
      <div class="detail-actions">
        <button class="icon-btn" id="btn-toggle-fav" title="${favTitle}" aria-pressed="${!!cred.isFavorite}"
          style="color:${favColor};border:1px solid var(--border-subtle);padding:6px;border-radius:var(--radius-md);">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="${favFill}" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        </button>
        <button class="btn-primary" id="btn-edit-cred">${ACTION_ICONS.edit}<span>${app.tr('Modifier', 'Edit')}</span></button>
        ${app.renderActionMenu([
          { id: 'btn-add-task-for-cred', label: app.tr('Créer une tâche liée', 'Create linked task'), icon: ACTION_ICONS.task },
          'separator',
          { id: 'btn-delete-cred', label: app.tr('Supprimer', 'Delete'), icon: ACTION_ICONS.trash, danger: true }
        ])}
      </div>
    </div>

    <div class="detail-content">
      ${expiryAlertHTML}
      ${app.renderTypeDetail(cred)}
      ${detailType !== 'login' ? '' : `
      ${totpHTML}

      <div class="field-group">
        <div class="field-label">${app.tr('Identifiant', 'Username')}</div>
        <div class="field-box">
          <span class="field-val" id="text-username">${cred.username ? app.escapeHtml(cred.username) : '—'}</span>
          <div class="field-actions">
            <button class="icon-btn" title="${app.tr('Copier', 'Copy')}" id="btn-copy-username">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div class="field-group">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="field-label">${app.tr('Mot de passe', 'Password')}</span>
          <span style="font-size:11px;color:${entropy.color};font-weight:600;">${entropy.label} &middot; ${entropy.bits} bits</span>
        </div>
        <div class="field-box">
          <span class="field-val" id="text-password" style="font-family:var(--font-mono);letter-spacing:1px;">&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;</span>
          <div class="field-actions">
            <button class="icon-btn" title="${app.tr('Afficher', 'Show')}" id="btn-toggle-password">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
            <button class="icon-btn" title="${app.tr('Copier', 'Copy')}" id="btn-copy-password">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
        </div>
        <div class="strength-meter" style="margin-top:6px;">${strengthHTML}</div>
      </div>

      ${websiteHTML}
      ${passkeysHTML}
      `}

      <div data-versioning>${renderVersioning(cred, app.versionsContext('credential', cred.id))}</div>

      ${cred.passwordHistory && cred.passwordHistory.length > 0 ? `
        <div class="field-group">
          <div class="section-divider" style="margin-bottom:8px;">${app.tr('Anciens mots de passe', 'Previous passwords')} (${cred.passwordHistory.length})</div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${cred.passwordHistory.map(h => `
              <div class="history-entry">
                <span class="history-password">&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;</span>
                <div style="display:flex;align-items:center;gap:8px;">
                  <span class="history-date">${new Date(h.changedAt).toLocaleDateString(i18n.intlLocale())}</span>
                  <button class="icon-btn btn-copy-history" data-pwd="${app.escapeHtml(h.password)}" title="${app.tr('Copier cet ancien mot de passe', 'Copy app previous password')}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Champs Personnalisés (Custom Fields) -->
      <div class="field-group">
        <div class="section-divider" style="margin-bottom:8px;">${app.tr('Champs personnalisés', 'Custom fields')} (${(cred.fields || []).length})</div>
        <div class="custom-fields-list" id="custom-fields-container">
          ${(cred.fields || []).map(f => `
            <div class="custom-field-row">
              <div style="font-size:11px;color:var(--text-muted);font-weight:600;">${app.escapeHtml(f.label)}</div>
              <div class="custom-field-box">
                <span class="custom-field-val ${f.isMasked ? 'masked' : ''}" id="cf-val-${f.id}">
                  ${f.isMasked ? '••••••••••••' : app.escapeHtml(f.value)}
                </span>
                <div style="display:flex;gap:6px;">
                  ${f.isMasked ? `
                    <button class="icon-btn btn-reveal-cf" data-cf-id="${f.id}" data-val="${app.escapeHtml(f.value)}" title="${app.tr('Afficher', 'Show')}">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                    </button>
                  ` : ''}
                  <button class="icon-btn btn-copy-cf" data-val="${app.escapeHtml(f.value)}" title="${app.tr('Copier', 'Copy')}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  </button>
                  <button class="icon-btn btn-del-cf" data-cf-id="${f.id}" title="${app.tr('Supprimer', 'Delete')}" style="color:var(--text-muted);">
                    ✕
                  </button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
        <button class="btn-primary btn-ghost" id="btn-show-cf-form" style="align-self:flex-start;margin-top:4px;">+ ${app.tr('Ajouter un champ', 'Add a field')}</button>
        <div id="cf-form" hidden>
          <div class="form-row" style="margin-top:8px;">
            <input class="form-input" id="input-cf-label" placeholder="${app.tr('Libellé (ex : PIN, question secrète)', 'Label (e.g. PIN, security question)')}">
            <input class="form-input" id="input-cf-val" placeholder="${app.tr('Valeur', 'Value')}">
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);cursor:pointer;">
              <input type="checkbox" id="input-cf-masked"> ${app.tr('Masquer la valeur', 'Hide value')}
            </label>
            <div style="display:flex;gap:6px;">
              <button class="btn-primary btn-ghost" id="btn-cancel-cf">${app.tr('Annuler', 'Cancel')}</button>
              <button class="btn-primary btn-accent" id="btn-add-cf">${app.tr('Ajouter', 'Add')}</button>
            </div>
          </div>
        </div>
      </div>

      ${app.renderAttachments(cred)}

      <div class="field-group">
        <div class="section-divider" style="margin-bottom:8px;">${app.tr('Tâches liées', 'Linked tasks')} (${linkedTasks.length})</div>
        ${linkedTasksHTML}
      </div>

      <div class="field-group">
        <div class="section-divider" style="margin-bottom:8px;">Notes</div>
        <textarea class="note-editor" id="inline-notes" placeholder="${app.tr('Codes de récupération, informations utiles…', 'Recovery codes, useful details…')}">${app.escapeHtml(cred.notes || '')}</textarea>
        <div style="display:flex;justify-content:flex-end;margin-top:6px;">
          <button class="btn-primary" id="btn-save-notes" style="font-size:11px;padding:5px 14px;">${app.tr('Enregistrer', 'Save')}</button>
        </div>
      </div>
    </div>
  `;

  // Events après rendu DOM
  app.bindActionMenus(container);
  app.updateLiveTOTP();

  document.getElementById('btn-copy-username')?.addEventListener('click', async (e) => {
    if (cred.username) {
      await app.copyToClipboardWithAutoClear(cred.username, i18n.getLocale() === 'fr' ? 'Identifiant copié' : 'Username copied', false);
      (e.currentTarget as HTMLElement).classList.add('copied');
      setTimeout(() => (e.currentTarget as HTMLElement).classList.remove('copied'), 500);
    }
  });

  document.getElementById('btn-copy-url')?.addEventListener('click', async () => {
    if (cred.website) {
      await app.copyToClipboardWithAutoClear(cred.website, i18n.getLocale() === 'fr' ? 'URL copiée' : 'URL copied', false);
    }
  });

  const passEl = document.getElementById('text-password');
  let isMasked = true;
  document.getElementById('btn-toggle-password')?.addEventListener('click', () => {
    isMasked = !isMasked;
    if (passEl) {
      passEl.textContent = isMasked ? '••••••••••••••••••••' : cred.password;
      passEl.style.letterSpacing = isMasked ? '1px' : '0.3px';
    }
  });

  document.getElementById('btn-copy-password')?.addEventListener('click', async (e) => {
    await app.copyToClipboardWithAutoClear(cred.password, i18n.getLocale() === 'fr' ? 'Mot de passe copié' : 'Password copied', true);
    (e.currentTarget as HTMLElement).classList.add('copied');
    setTimeout(() => (e.currentTarget as HTMLElement).classList.remove('copied'), 500);
  });

  document.getElementById('detail-totp-container')?.addEventListener('click', async () => {
    if (cred.totpSecret) {
      const res = generateTOTP(cred.totpSecret);
      if (res) {
        const label = i18n.getLocale() === 'fr' 
          ? `Code 2FA copié : ${res.token.slice(0, 3)} ${res.token.slice(3)}` 
          : `2FA code copied: ${res.token.slice(0, 3)} ${res.token.slice(3)}`;
        await app.copyToClipboardWithAutoClear(res.token, label, true);
      }
    }
  });

  document.getElementById('btn-toggle-fav')?.addEventListener('click', () => {
    vaultStore.updateCredential(cred.id, { isFavorite: !cred.isFavorite });
    app.showToast(cred.isFavorite ? app.tr('Retiré des favoris', 'Removed from favorites') : app.tr('Ajouté aux favoris', 'Added to favorites'), 'info');
  });

  document.getElementById('btn-save-notes')?.addEventListener('click', () => {
    const notesEl = document.getElementById('inline-notes') as HTMLTextAreaElement;
    if (notesEl) {
      vaultStore.updateCredential(cred.id, { notes: notesEl.value });
      app.showToast(app.tr('Notes enregistrées', 'Notes saved'), 'success');
    }
  });

  document.querySelectorAll('.linked-task-row').forEach(el => {
    el.addEventListener('click', () => {
      const taskId = (el as HTMLElement).dataset.taskId;
      if (taskId) {
        app.activeView = 'tasks';
        app.selectedItemId = taskId;
        app.renderList();
        app.renderDetail(taskId);
      }
    });
  });

  document.getElementById('btn-delete-cred')?.addEventListener('click', async () => {
    if (!app.canEdit(cred.vaultId)) return;
    const confirmed = await app.confirmDialog({
      title: app.tr('Supprimer l’identifiant ?', 'Delete credential?'),
      message: app.tr(
        `« ${cred.title} » ira dans la corbeille avec son historique et ses fichiers, pendant 30 jours. Les tâches liées sont conservées.`,
        `"${cred.title}" will go to the trash with its history and files, for 30 days. Linked tasks are kept.`
      ),
      confirmLabel: app.tr('Supprimer', 'Delete'),
      danger: true,
      skippable: true
    });
    if (confirmed) {
      // L'identifiant part à la corbeille avec ses fichiers : ils ne quittent le serveur qu'à son vidage
      vaultStore.deleteCredential(cred.id);
      app.selectedItemId = null;
      app.renderDetail(null);
      app.showToast(app.tr('Identifiant mis à la corbeille', 'Credential moved to trash'), 'info', 6000, app.undoDelete(cred.id));
    }
  });

  document.getElementById('btn-edit-cred')?.addEventListener('click', () => {
    app.openCreateCredentialModal(cred.id);
  });

  // Champs des types carte, identité et clé : affichage et copie
  document.getElementById('detail-container')?.addEventListener('click', async event => {
    const target = event.target as HTMLElement;
    const box = target.closest('.field-box');
    const value = box?.querySelector<HTMLElement>('[data-secret-view]');
    if (!value) return;
    const secret = value.dataset.secretValue ?? '';

    if (target.closest('[data-secret-toggle]')) {
      const button = target.closest('[data-secret-toggle]') as HTMLButtonElement;
      const shown = value.dataset.secretShown === 'true';
      value.dataset.secretShown = String(!shown);
      value.textContent = shown ? '•'.repeat(Math.min(secret.length, 20)) : secret;
      button.title = shown ? app.tr('Afficher', 'Show') : app.tr('Masquer', 'Hide');
      return;
    }

    if (target.closest('[data-secret-copy]')) {
      const sensitive = (target.closest('[data-secret-copy]') as HTMLElement).dataset.sensitive === 'true';
      await app.copyToClipboardWithAutoClear(secret, app.tr('Copié', 'Copied'), sensitive);
    }
  });

  document.getElementById('btn-renew-cred')?.addEventListener('click', () => {
    app.openCreateCredentialModal(cred.id, { renew: true });
  });

  const versioning = document.querySelector<HTMLElement>('[data-versioning]');
  if (versioning) wireVersioning(versioning, cred, app.versionsContext('credential', cred.id));

  document.querySelectorAll('.btn-copy-history').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const pwd = (el as HTMLElement).dataset.pwd;
      if (pwd) {
        await navigator.clipboard.writeText(pwd);
        app.showToast(app.tr('Ancien mot de passe copié', 'Previous password copied'), 'success');
      }
    });
  });

  // Gestion des Champs Personnalisés
  const currentFields = [...(cred.fields || [])];
  const cfForm = document.getElementById('cf-form');
  const cfShowButton = document.getElementById('btn-show-cf-form');
  const toggleCustomFieldForm = (open: boolean) => {
    if (cfForm) cfForm.hidden = !open;
    if (cfShowButton) cfShowButton.hidden = open;
    if (open) (document.getElementById('input-cf-label') as HTMLInputElement | null)?.focus();
  };
  cfShowButton?.addEventListener('click', () => toggleCustomFieldForm(true));
  document.getElementById('btn-cancel-cf')?.addEventListener('click', () => toggleCustomFieldForm(false));

  document.getElementById('btn-add-cf')?.addEventListener('click', () => {
    const labelInput = document.getElementById('input-cf-label') as HTMLInputElement;
    const valInput = document.getElementById('input-cf-val') as HTMLInputElement;
    const maskedInput = document.getElementById('input-cf-masked') as HTMLInputElement;

    const label = labelInput?.value.trim();
    const val = valInput?.value.trim();
    if (label && val) {
      const newField = {
        id: 'cf-' + Math.random().toString(36).substring(2, 8),
        label,
        value: val,
        isMasked: !!maskedInput?.checked
      };
      vaultStore.updateCredential(cred.id, { fields: [...currentFields, newField] });
      app.renderDetail(cred.id);
      app.showToast(app.tr('Champ ajouté', 'Field added'), 'success');
    } else {
      app.showToast(app.tr('Le libellé et la valeur sont requis', 'Label and value are required'), 'error');
    }
  });

  document.querySelectorAll('.btn-reveal-cf').forEach(el => {
    el.addEventListener('click', (e) => {
      const cfId = (e.currentTarget as HTMLElement).dataset.cfId;
      const rawVal = (e.currentTarget as HTMLElement).dataset.val;
      const valEl = document.getElementById(`cf-val-${cfId}`);
      if (valEl && rawVal) {
        const isCurrentlyMasked = valEl.classList.contains('masked');
        valEl.textContent = isCurrentlyMasked ? rawVal : '••••••••••••';
        valEl.classList.toggle('masked');
      }
    });
  });

  document.querySelectorAll('.btn-copy-cf').forEach(el => {
    el.addEventListener('click', async (e) => {
      const val = (e.currentTarget as HTMLElement).dataset.val;
      if (val) {
        await navigator.clipboard.writeText(val);
        app.showToast(app.tr('Valeur copiée', 'Value copied'), 'success');
      }
    });
  });

  document.querySelectorAll('.btn-del-cf').forEach(el => {
    el.addEventListener('click', (e) => {
      const cfId = (e.currentTarget as HTMLElement).dataset.cfId;
      const updated = currentFields.filter(f => f.id !== cfId);
      vaultStore.updateCredential(cred.id, { fields: updated });
      app.renderDetail(cred.id);
    });
  });

  document.getElementById('btn-add-task-for-cred')?.addEventListener('click', () => {
    app.openCreateTaskModal(cred.id);
  });

  app.bindAttachments(container, cred);

  document.getElementById('btn-detail-back-cred')?.addEventListener('click', () => {
    document.getElementById('detail-container')?.classList.remove('mobile-active');
  });
}
