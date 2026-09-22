import { vaultStore } from '../store/vaultStore';
import type { Task } from '../types/vault';
import { getOpenBlockers, wouldCreateDependencyCycle } from '../tasks/taskEngine';
import type { RecurrenceFrequency, TaskRecurrence } from '../types/vault';
import { mountTagInput } from '../ui/tagInput';
import { mountDateField } from '../ui/dateField';
import { mountStepper } from '../ui/stepper';
import { i18n } from '../i18n';
import type { AppController } from '../main';

/** Création ou modification d'une tâche */
export function openCreateTaskModal(app: AppController, linkedCredentialId?: string, existingTaskId?: string): void {
  const data = vaultStore.getData();
  const existing = existingTaskId ? data.tasks.find(t => t.id === existingTaskId) : null;
  const isEdit = !!existing;
  if (!app.canEdit(existing?.vaultId ?? data.activeVaultId)) return;

  const targetLinkedCredId = existing ? existing.linkedCredentialId : linkedCredentialId;

  const credOptions = data.credentials
    .filter(c => c.vaultId === data.activeVaultId)
    .map(c => `<option value="${c.id}" ${c.id === targetLinkedCredId ? 'selected' : ''}>${app.escapeHtml(c.title)}</option>`)
    .join('');

  const dependencyOptions = data.tasks
    .filter(t => t.vaultId === data.activeVaultId && t.id !== existing?.id)
    .map(t => `
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary);cursor:pointer;">
        <input type="checkbox" class="task-dep-check" value="${t.id}" ${existing?.dependsOn?.includes(t.id) ? 'checked' : ''}>
        <span style="${t.status === 'completed' ? 'text-decoration:line-through;opacity:0.6;' : ''}">${app.escapeHtml(t.title)}</span>
      </label>`)
    .join('');

  const box = app.openModal(`
    <div class="modal-header">
      <div class="modal-title">${isEdit ? app.tr('Modifier la tâche', 'Edit task') : app.tr('Nouvelle tâche', 'New task')}</div>
      <button class="modal-close" id="modal-close-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
    <div class="modal-body">
      <div id="task-steps"></div>
      <div class="task-form">
      <section data-step="essentiel" hidden>
      <div class="form-field">
        <label class="form-label" for="task-title">${app.tr('Titre', 'Title')}</label>
        <input class="form-input" id="task-title" type="text" placeholder="${app.tr('Renouveler le mot de passe GitHub…', 'Renew the GitHub password…')}" value="${app.escapeHtml(existing?.title || '')}" autocomplete="off" data-step-autofocus>
      </div>
      <div class="form-field">
        <label class="form-label">${app.tr('Priorité', 'Priority')}</label>
        <div class="priority-picker" role="radiogroup" aria-label="${app.tr('Priorité', 'Priority')}">
          ${(['low', 'medium', 'high', 'urgent'] as const).map(level => {
            const selected = existing ? existing.priority === level : level === 'medium';
            return `<button type="button" class="priority-option ${selected ? 'active' : ''}" role="radio" aria-checked="${selected}" data-priority="${level}">${i18n.t.common[level]}</button>`;
          }).join('')}
        </div>
        <input type="hidden" id="task-priority" value="${existing?.priority ?? 'medium'}">
      </div>
      <div class="form-field">
        <label class="form-label">${app.tr('Échéance', 'Due date')}</label>
        <div id="task-due"></div>
      </div>
      <div class="form-field">
        <label class="form-label" for="task-desc">Description</label>
        <textarea class="note-editor" id="task-desc" placeholder="${app.tr('Facultatif', 'Optional')}">${existing?.description || ''}</textarea>
      </div>
      </section>

      <section data-step="rappel" hidden>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-field">
          <label class="form-label">${app.tr('Récurrence', 'Recurrence')}</label>
          <select class="form-input" id="task-recur-freq">
            <option value="">${app.tr('— Aucune —', '— None —')}</option>
            <option value="daily" ${existing?.recurrence?.freq === 'daily' ? 'selected' : ''}>${app.tr('Quotidienne', 'Daily')}</option>
            <option value="weekly" ${existing?.recurrence?.freq === 'weekly' ? 'selected' : ''}>${app.tr('Hebdomadaire', 'Weekly')}</option>
            <option value="monthly" ${existing?.recurrence?.freq === 'monthly' ? 'selected' : ''}>${app.tr('Mensuelle', 'Monthly')}</option>
            <option value="yearly" ${existing?.recurrence?.freq === 'yearly' ? 'selected' : ''}>${app.tr('Annuelle', 'Yearly')}</option>
          </select>
        </div>
        <div class="form-field">
          <label class="form-label">${app.tr('Tous les (intervalle)', 'Every (interval)')}</label>
          <input class="form-input" id="task-recur-interval" type="number" min="1" max="365" value="${existing?.recurrence?.interval ?? 1}">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-field">
          <label class="form-label">${app.tr('Fin de récurrence', 'Recurrence end')}</label>
          <div id="task-recur-until"></div>
        </div>
        <div class="form-field">
          <label class="form-label">${app.tr('Rappel', 'Reminder')}</label>
          <div id="task-reminder"></div>
        </div>
      </div>
      </section>

      <section data-step="liens" hidden>
      <div class="form-field">
        <label class="form-label">Tags</label>
        <div id="task-tags"></div>
      </div>
      ${dependencyOptions ? `
        <div class="form-field">
          <label class="form-label">${app.tr('Dépend de (à terminer avant)', 'Depends on (complete first)')}</label>
          <div style="display:flex;flex-direction:column;gap:6px;max-height:140px;overflow:auto;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:var(--radius-md);background:var(--bg-secondary);">
            ${dependencyOptions}
          </div>
        </div>` : ''}
      ${credOptions ? `
        <div class="form-field">
          <label class="form-label">${app.tr('Identifiant lié (facultatif)', 'Linked credential (optional)')}</label>
          <select class="form-input" id="task-cred">
            <option value="">${app.tr('Aucun', 'None')}</option>
            ${credOptions}
          </select>
        </div>` : ''}
      </section>

      <div class="form-error" id="task-form-error" role="alert" hidden></div>
      </div>
    </div>
    <div class="modal-footer stepper-footer" id="task-footer"></div>
  `);

  box.querySelector('#modal-close-btn')?.addEventListener('click', () => app.closeModal());
  box.querySelector('#modal-cancel')?.addEventListener('click', () => app.closeModal());
  const taskTagInput = mountTagInput(box.querySelector('#task-tags') as HTMLElement, {
    initial: existing?.tags ?? [],
    suggestions: vaultStore.getTags(),
    placeholder: app.tr('Ajouter un tag…', 'Add a tag…'),
    removeLabel: name => app.tr(`Retirer le tag ${name}`, `Remove tag ${name}`)
  });
  const trTask = (fr: string, en: string) => app.tr(fr, en);
  const dueField = mountDateField(box.querySelector('#task-due') as HTMLElement, {
    value: existing?.dueDate || '', label: trTask('Échéance', 'Due date'), tr: trTask, locale: app.dateLocale()
  });
  const untilField = mountDateField(box.querySelector('#task-recur-until') as HTMLElement, {
    value: existing?.recurrence?.until || '', label: trTask('Fin de récurrence', 'Recurrence end'), tr: trTask, locale: app.dateLocale(),
    placeholder: trTask('Jamais', 'Never'), describe: () => ''
  });
  const reminderField = mountDateField(box.querySelector('#task-reminder') as HTMLElement, {
    value: app.toDateTimeInputValue(existing?.reminderAt), label: trTask('Rappel', 'Reminder'), tr: trTask, locale: app.dateLocale(),
    withTime: true, placeholder: trTask('Aucun rappel', 'No reminder'), describe: () => ''
  });

  // Choix de priorité : des boutons plutôt qu'une liste déroulante, plus rapides au doigt
  const priorityInput = box.querySelector('#task-priority') as HTMLInputElement;
  box.querySelector('.priority-picker')?.addEventListener('click', event => {
    const option = (event.target as HTMLElement).closest<HTMLElement>('[data-priority]');
    if (!option) return;
    priorityInput.value = option.dataset.priority ?? 'medium';
    box.querySelectorAll<HTMLElement>('.priority-option').forEach(el => {
      const active = el === option;
      el.classList.toggle('active', active);
      el.setAttribute('aria-checked', String(active));
    });
  });

  const taskError = box.querySelector('#task-form-error') as HTMLElement;
  const failTask = (message: string, focus?: HTMLElement) => {
    taskError.textContent = message;
    taskError.hidden = false;
    focus?.focus();
  };

  const checkTitle = (): string | undefined => {
    const input = box.querySelector('#task-title') as HTMLInputElement;
    if (input.value.trim()) return undefined;
    input.focus();
    return app.tr('Donnez un titre à cette tâche', 'Give app task a title');
  };

  /** La fin d'une répétition avant son échéance ne produirait jamais d'occurrence */
  const checkRecurrence = (): string | undefined => {
    const freq = (box.querySelector('#task-recur-freq') as HTMLSelectElement).value;
    const until = untilField.getValue();
    const due = dueField.getValue();
    if (freq && until && due && until < due) {
      return app.tr('La fin de récurrence précède l’échéance', 'Recurrence end is before the due date');
    }
    return undefined;
  };

  const saveTask = () => {
    taskError.hidden = true;
    const problem = checkTitle() ?? checkRecurrence();
    if (problem) return failTask(problem);

    const title = (box.querySelector('#task-title') as HTMLInputElement)?.value.trim();
    const description = (box.querySelector('#task-desc') as HTMLTextAreaElement)?.value;
    const priority = priorityInput.value as Task['priority'];
    const dueDate = dueField.getValue();
    const linkedCredSel = box.querySelector('#task-cred') as HTMLSelectElement;
    const linkedCred = linkedCredSel?.value || undefined;

    const freq = (box.querySelector('#task-recur-freq') as HTMLSelectElement).value as RecurrenceFrequency | '';
    const interval = Math.min(365, Math.max(1, parseInt((box.querySelector('#task-recur-interval') as HTMLInputElement).value, 10) || 1));
    const until = untilField.getValue() || undefined;
    const recurrence: TaskRecurrence | undefined = freq ? { freq, interval, until } : undefined;

    const reminderValue = reminderField.getValue();
    const reminderAt = reminderValue ? new Date(reminderValue).getTime() : undefined;
    const reminderSent = reminderAt !== undefined && existing?.reminderAt === reminderAt ? existing.reminderSent : false;
    if (reminderAt && reminderAt > Date.now()) app.requestNotificationPermission();

    const dependsOn = Array.from(box.querySelectorAll<HTMLInputElement>('.task-dep-check:checked')).map(el => el.value);
    const allTasks = vaultStore.getData().tasks;
    if (existing && wouldCreateDependencyCycle(allTasks, existing.id, dependsOn)) {
      return failTask(app.tr('Dépendance circulaire : une tâche choisie dépend déjà de celle-ci', 'Circular dependency: a selected task already depends on app one'));
    }
    const hasOpenBlockers = getOpenBlockers({ dependsOn } as Task, allTasks).length > 0;

    if (isEdit && existing) {
      const status: Task['status'] = existing.status === 'completed'
        ? 'completed'
        : hasOpenBlockers ? 'blocked' : existing.status === 'blocked' ? 'todo' : existing.status;
      vaultStore.updateTask(existing.id, {
        title,
        description: description || undefined,
        priority,
        dueDate: dueDate || undefined,
        linkedCredentialId: linkedCred,
        status,
        recurrence,
        dependsOn: dependsOn.length ? dependsOn : undefined,
        reminderAt,
        reminderSent,
        tags: taskTagInput.getTags()
      });
      app.closeModal();
      app.showToast(app.tr('Tâche enregistrée', 'Task saved'), 'success');
    } else {
      const data3 = vaultStore.getData();
      vaultStore.addTask({
        vaultId: data3.activeVaultId,
        title,
        description: description || undefined,
        status: hasOpenBlockers ? 'blocked' : 'todo',
        priority,
        dueDate: dueDate || undefined,
        linkedCredentialId: linkedCred,
        tags: taskTagInput.getTags(),
        recurrence,
        dependsOn: dependsOn.length ? dependsOn : undefined,
        reminderAt,
        reminderSent: false
      });
      app.closeModal();
      app.showToast(app.tr('Tâche créée', 'Task created'), 'success');
    }
  };

  mountStepper({
    body: box.querySelector('.task-form') as HTMLElement,
    header: box.querySelector('#task-steps') as HTMLElement,
    footer: box.querySelector('#task-footer') as HTMLElement,
    steps: [
      { id: 'essentiel', label: app.tr('L’essentiel', 'Essentials'), validate: checkTitle },
      { id: 'rappel', label: app.tr('Répétition', 'Repeat'), validate: checkRecurrence },
      { id: 'liens', label: app.tr('Liens', 'Links') }
    ],
    tr: (fr, en) => app.tr(fr, en),
    finishLabel: isEdit ? app.tr('Enregistrer', 'Save') : app.tr('Créer', 'Create'),
    onFinish: saveTask,
    onError: message => failTask(message),
    onStepChange: () => { taskError.hidden = true; },
    onCancel: () => app.closeModal()
  });
}
