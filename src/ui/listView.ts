import { vaultStore } from '../store/vaultStore';
import type { Task } from '../types/vault';
import { EisenhowerQuadrant, describeRecurrence, getEisenhowerQuadrant } from '../tasks/taskEngine';
import { expiryInfo, renderExpiryBadge } from '../ui/expiry';
import { itemTypeOf } from '../types/itemTypes';
import { queryCredentials } from '../store/credentialFilters';
import { i18n } from '../i18n';
import { memberAvatarHtml } from '../ui/memberChip';
import { accountService } from '../app/services';

/** Adresse de la personne connectée, pour marquer ses propres tâches */
const myEmail = () => accountService.getAccount()?.email ?? '';
import type { AppController } from '../main';

/** Liste des éléments de la vue active : filtres, tri, recherche */
export function renderList(app: AppController): void {
  const data = vaultStore.getData();
  const container = document.getElementById('items-container');
  const listTitle = document.getElementById('list-view-title');
  if (!container) return;

  container.innerHTML = '';

  // La colonne centrale s'élargit pour les vues tâches en tableau ; la navigation reflète la vue active
  document.getElementById('app')?.classList.toggle('tasks-board', app.activeView === 'tasks' && app.taskViewMode !== 'list');
  document.querySelectorAll<HTMLElement>('[data-view]').forEach(item => item.classList.toggle('active', item.dataset.view === app.activeView));

  const tagKey = app.activeTag?.toLowerCase();
  const matchesTag = (item: { tags: string[] }) => !tagKey || item.tags.some(t => t.toLowerCase() === tagKey);

  const withTag = (title: string) => [title, app.activeTag].filter(Boolean).join(' · ');

  const taskToggle = document.getElementById('task-view-toggle');
  if (taskToggle) {
    taskToggle.style.display = app.activeView === 'tasks' ? 'flex' : 'none';
  }

  if (app.activeView === 'tasks') {
    const filterBar = document.getElementById('filter-bar');
    if (filterBar) filterBar.hidden = true;
    if (listTitle) listTitle.textContent = withTag(i18n.t.tasks.title);
    let tasks = data.tasks.filter(t => t.vaultId === data.activeVaultId && matchesTag(t));

    /*
     * Coffre partagé : une bande de pastilles filtre par personne. Elle
     * n'apparaît que s'il y a quelque chose à filtrer — un coffre partagé dont
     * aucune tâche n'est attribuée n'a pas besoin d'une ligne de plus.
     */
    const partage = !!data.vaults.find(v => v.id === data.activeVaultId)?.shared;
    const moi = myEmail();
    const attribues = [...new Set(tasks.map(t => t.assignee).filter((e): e is string => !!e))].sort();
    if (partage && filterBar && attribues.length) {
      const total = tasks.length;
      const compte = (test: (t: typeof tasks[number]) => boolean) => tasks.filter(test).length;
      const pastilles: Array<{ cle: string; libelle: string; compte: number; avatar?: string }> = [
        { cle: 'all', libelle: app.tr('Toutes', 'All'), compte: total },
        { cle: 'mine', libelle: app.tr('Les miennes', 'Mine'), compte: compte(t => t.assignee === moi) },
        { cle: 'none', libelle: app.tr('Non attribuées', 'Unassigned'), compte: compte(t => !t.assignee) },
        ...attribues.filter(email => email !== moi).map(email => ({
          cle: email,
          libelle: email.split('@')[0],
          compte: compte(t => t.assignee === email),
          avatar: memberAvatarHtml(email, v => app.escapeHtml(v), { size: 18, me: moi })
        }))
      ];
      filterBar.hidden = false;
      filterBar.innerHTML = `<div class="filter-bar-scroll">${pastilles.map(p => {
        const actif = app.taskAssignee === p.cle;
        return `<button type="button" class="filter-chip ${actif ? 'active' : ''}" data-assignee="${app.escapeHtml(p.cle)}" aria-pressed="${actif}">${p.avatar ?? ''}${app.escapeHtml(p.libelle)}<span class="filter-chip-count">${p.compte}</span></button>`;
      }).join('')}</div>`;
      filterBar.onclick = event => {
        const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-assignee]');
        if (!chip) return;
        app.taskAssignee = chip.dataset.assignee!;
        app.selectedItemId = null;
        app.renderList();
        app.renderDetail(null);
      };
    } else if (app.taskAssignee !== 'all') {
      // Plus rien à filtrer : on ne garde pas un filtre invisible actif
      app.taskAssignee = 'all';
    }
    if (app.taskAssignee === 'mine') tasks = tasks.filter(t => t.assignee === moi);
    else if (app.taskAssignee === 'none') tasks = tasks.filter(t => !t.assignee);
    else if (app.taskAssignee !== 'all') tasks = tasks.filter(t => t.assignee === app.taskAssignee);

    if (app.searchQuery) {
      tasks = tasks.filter(t =>
        t.title.toLowerCase().includes(app.searchQuery) ||
        (t.description && t.description.toLowerCase().includes(app.searchQuery))
      );
    }

    if (tasks.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <polyline points="9 11 12 14 22 4"></polyline>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
          </svg>
          <div class="empty-state-title">${i18n.t.tasks.emptyTasksTitle}</div>
          <div class="empty-state-sub">${i18n.t.tasks.emptyTasksSub}</div>
        </div>`;
      return;
    }

    // Mode Kanban
    if (app.taskViewMode === 'kanban') {
      const statuses: Array<{ key: Task['status']; label: string; dot: string }> = [
        { key: 'todo', label: i18n.t.tasks.statusTodo, dot: 'var(--text-muted)' },
        { key: 'in_progress', label: i18n.t.tasks.statusInProgress, dot: 'var(--accent-blue)' },
        { key: 'blocked', label: i18n.t.tasks.statusBlocked, dot: 'var(--accent-red)' },
        { key: 'completed', label: i18n.t.tasks.statusCompleted, dot: 'var(--accent-green)' }
      ];

      const kanbanWrapper = document.createElement('div');
      kanbanWrapper.className = 'kanban-container';

      statuses.forEach(col => {
        const colTasks = tasks.filter(t => t.status === col.key);
        const colEl = document.createElement('div');
        colEl.className = 'kanban-column';
        colEl.innerHTML = `
          <div class="kanban-col-title" style="display:flex;justify-content:space-between;align-items:center;">
            <span style="display:flex;align-items:center;gap:6px;">
              <span style="color:${col.dot};font-size:10px;">●</span>
              ${col.label}
            </span>
            <span style="font-size:10px;opacity:0.7;">${colTasks.length}</span>
          </div>
          <div class="kanban-cards-box" style="display:flex;flex-direction:column;gap:8px;"></div>
        `;

        const cardsBox = colEl.querySelector('.kanban-cards-box') as HTMLElement;
        colTasks.forEach(task => {
          const card = document.createElement('div');
          card.className = `kanban-card ${app.selectedItemId === task.id ? 'selected' : ''}`;
          const prioLabel = (i18n.t.common as any)[task.priority] || task.priority;
          card.innerHTML = `
            <div class="kanban-card-title" title="${app.escapeHtml(task.title)}">${app.escapeHtml(task.title)}</div>
            <div class="kanban-card-meta">
              <span class="badge priority-${task.priority}">${prioLabel.toUpperCase()}</span>
              <span>${i18n.formatRelativeDate(task.dueDate || '')}</span>
              ${task.assignee ? memberAvatarHtml(task.assignee, v => app.escapeHtml(v), { size: 20, me: myEmail(), title: app.tr(`Attribuée à ${task.assignee}`, `Assigned to ${task.assignee}`) }) : ''}
            </div>
          `;
          card.addEventListener('click', () => {
            app.selectedItemId = task.id;
            app.renderList();
            app.renderDetail(task.id);
            document.getElementById('detail-container')?.classList.add('mobile-active');
          });
          cardsBox.appendChild(card);
        });

        kanbanWrapper.appendChild(colEl);
      });

      container.appendChild(kanbanWrapper);
      return;
    }

    // Mode Matrice d'Eisenhower
    if (app.taskViewMode === 'matrix') {
      const quadrants: Array<{ key: EisenhowerQuadrant; title: string; sub: string; color: string }> = [
        { key: 'do', title: app.tr('Faire maintenant', 'Do now'), sub: app.tr('Urgent et important', 'Urgent & important'), color: 'var(--accent-red)' },
        { key: 'plan', title: app.tr('Planifier', 'Schedule'), sub: app.tr('Important, non urgent', 'Important, not urgent'), color: 'var(--accent-blue)' },
        { key: 'delegate', title: app.tr('Déléguer', 'Delegate'), sub: app.tr('Urgent, peu important', 'Urgent, less important'), color: 'var(--accent-orange)' },
        { key: 'eliminate', title: app.tr('Plus tard', 'Later'), sub: app.tr('Ni urgent ni important', 'Neither urgent nor important'), color: 'var(--text-muted)' }
      ];
      const openTasks = tasks.filter(t => t.status !== 'completed');
      const grid = document.createElement('div');
      grid.className = 'eisenhower-grid';

      quadrants.forEach(q => {
        const quadrantTasks = openTasks.filter(t => getEisenhowerQuadrant(t) === q.key);
        const cell = document.createElement('div');
        cell.className = 'eisenhower-cell';
        cell.style.borderTopColor = q.color;
        cell.innerHTML = `
          <div class="eisenhower-cell-header">
            <div>
              <div class="eisenhower-cell-title" style="color:${q.color};">${q.title}</div>
              <div class="eisenhower-cell-sub">${q.sub}</div>
            </div>
            <span class="eisenhower-count">${quadrantTasks.length}</span>
          </div>
          <div class="eisenhower-cell-body"></div>
        `;
        const body = cell.querySelector('.eisenhower-cell-body') as HTMLElement;
        if (quadrantTasks.length === 0) {
          body.innerHTML = `<div class="eisenhower-empty">${app.tr('Aucune tâche', 'No tasks')}</div>`;
        }
        quadrantTasks.forEach(task => {
          const card = document.createElement('div');
          card.className = `kanban-card ${app.selectedItemId === task.id ? 'selected' : ''}`;
          card.innerHTML = `
            <div class="kanban-card-title" title="${app.escapeHtml(task.title)}">${app.escapeHtml(task.title)}</div>
            <div class="kanban-card-meta">
              <span class="badge priority-${task.priority}">${task.priority.toUpperCase()}</span>
              ${task.status === 'blocked' ? `<span class="badge" style="color:var(--accent-red);">${app.tr('BLOQUÉE', 'BLOCKED')}</span>` : ''}
              <span>${task.dueDate ? i18n.formatRelativeDate(task.dueDate) : ''}</span>
            </div>
          `;
          card.addEventListener('click', () => {
            app.selectedItemId = task.id;
            app.renderList();
            app.renderDetail(task.id);
            document.getElementById('detail-container')?.classList.add('mobile-active');
          });
          body.appendChild(card);
        });
        grid.appendChild(cell);
      });

      container.appendChild(grid);
      return;
    }

    // Mode Calendrier / Échéances (Timeline)
    if (app.taskViewMode === 'calendar') {
      const timelineWrapper = document.createElement('div');
      timelineWrapper.className = 'calendar-timeline-container';

      const todayStr = new Date().toISOString().slice(0, 10);
      const overdueTasks: Task[] = [];
      const todayTasks: Task[] = [];
      const upcomingTasks: Task[] = [];
      const noDueDateTasks: Task[] = [];

      tasks.forEach(t => {
        if (!t.dueDate) {
          noDueDateTasks.push(t);
        } else if (t.dueDate < todayStr && t.status !== 'completed') {
          overdueTasks.push(t);
        } else if (t.dueDate === todayStr) {
          todayTasks.push(t);
        } else {
          upcomingTasks.push(t);
        }
      });

      // Tri par date croissante
      upcomingTasks.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));

      const groups = [
        { title: i18n.t.common.overdue, tasks: overdueTasks, color: 'var(--accent-red)', count: overdueTasks.length },
        { title: i18n.t.common.today, tasks: todayTasks, color: 'var(--accent-orange)', count: todayTasks.length },
        { title: i18n.t.common.upcoming, tasks: upcomingTasks, color: 'var(--accent-blue)', count: upcomingTasks.length },
        { title: i18n.t.common.noDueDate, tasks: noDueDateTasks, color: 'var(--text-muted)', count: noDueDateTasks.length }
      ];

      groups.forEach(grp => {
        if (grp.tasks.length === 0 && grp.title === 'En retard / Dépassées') return; // Ne pas encombrer si rien en retard

        const groupEl = document.createElement('div');
        groupEl.className = 'timeline-group';
        groupEl.innerHTML = `
          <div class="timeline-group-header" style="color: ${grp.color};">
            <span style="display:flex;align-items:center;gap:6px;">
              <span style="width:7px;height:7px;border-radius:50%;background-color:${grp.color};"></span>
              ${grp.title}
            </span>
            <span style="opacity:0.7;">${grp.count}</span>
          </div>
          <div class="timeline-items-list"></div>
        `;

        const listEl = groupEl.querySelector('.timeline-items-list') as HTMLElement;
        grp.tasks.forEach(task => {
          const row = document.createElement('div');
          row.className = `timeline-task-row ${app.selectedItemId === task.id ? 'selected' : ''}`;
          const isDone = task.status === 'completed';

          row.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
              <span style="color:${isDone ? 'var(--accent-green)' : 'var(--text-muted)'};">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  ${isDone ? '<polyline points="20 6 9 17 4 12"></polyline>' : '<circle cx="12" cy="12" r="9"></circle>'}
                </svg>
              </span>
              <span style="font-size:12px;font-weight:500;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${isDone ? 'text-decoration:line-through;opacity:0.5;' : ''}">
                ${task.title}
              </span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;font-size:11px;font-family:var(--font-mono);color:var(--text-muted);">
              <span class="badge priority-${task.priority}">${task.priority.toUpperCase()}</span>
              <span>${task.dueDate || '—'}</span>
            </div>
          `;

          row.addEventListener('click', () => {
            app.selectedItemId = task.id;
            app.renderList();
            app.renderDetail(task.id);
            document.getElementById('detail-container')?.classList.add('mobile-active');
          });

          listEl.appendChild(row);
        });

        timelineWrapper.appendChild(groupEl);
      });

      container.appendChild(timelineWrapper);
      return;
    }

    // Mode Liste
    const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
    const sorted = [...tasks].sort((a, b) => {
      if (a.status === 'completed' && b.status !== 'completed') return 1;
      if (b.status === 'completed' && a.status !== 'completed') return -1;
      return (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
    });

    sorted.forEach(task => {
      const row = document.createElement('div');
      row.className = `record-row ${app.selectedItemId === task.id ? 'selected' : ''}`;
      const isDone = task.status === 'completed';
      const isInProgress = task.status === 'in_progress';
      const dotColor = isDone ? 'var(--accent-green)' : isInProgress ? 'var(--accent-blue)' : 'var(--text-muted)';
      const iconBg = isDone ? '35,134,54' : isInProgress ? 'var(--accent-rgb)' : '110,118,129';

      const statusSub = isInProgress ? i18n.t.tasks.statusInProgress : i18n.t.common.noDueDate;
      row.innerHTML = `
        <div class="record-icon" style="color:${dotColor};background-color:rgba(${iconBg},0.1);">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="9 11 12 14 22 4"></polyline>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
          </svg>
        </div>
        <div class="record-info">
          <div class="record-title" title="${app.escapeHtml(task.title)}" style="${isDone ? 'text-decoration:line-through;opacity:0.5;' : ''}">${app.escapeHtml(task.title)}</div>
          <div class="record-sub">${task.dueDate ? i18n.formatRelativeDate(task.dueDate) : statusSub}</div>
        </div>
        <div class="record-badges">
          ${task.assignee ? memberAvatarHtml(task.assignee, v => app.escapeHtml(v), { size: 22, me: myEmail(), title: app.tr(`Attribuée à ${task.assignee}`, `Assigned to ${task.assignee}`) }) : ''}
          ${task.status === 'blocked' ? `<span class="badge" style="color:var(--accent-red);border-color:rgba(218,54,51,0.4);" title="${app.tr('Bloquée par des dépendances', 'Blocked by dependencies')}">${app.tr('BLOQ', 'BLK')}</span>` : ''}
          ${task.recurrence ? `<span class="badge" style="color:var(--accent-purple);" title="${describeRecurrence(task.recurrence, i18n.getLocale() === 'fr' ? 'fr' : 'en')}">${app.tr('RÉC', 'REC')}</span>` : ''}
          ${task.reminderAt && !task.reminderSent && task.status !== 'completed' ? `<span class="badge" style="color:var(--accent-orange);" title="${new Date(task.reminderAt).toLocaleString(i18n.intlLocale())}">${app.tr('RAP', 'REM')}</span>` : ''}
          <span class="badge priority-${task.priority}">${task.priority.charAt(0).toUpperCase()}</span>
        </div>
      `;

      row.addEventListener('click', () => {
        app.selectedItemId = task.id;
        app.renderList();
        app.renderDetail(task.id);
        document.getElementById('detail-container')?.classList.add('mobile-active');
      });
      container.appendChild(row);
    });
    return;
  }

  // Vue Credentials ou 2FA
  if (listTitle) listTitle.textContent = withTag(app.activeView === '2fa-tokens' ? i18n.t.nav.twoFactorTokens : i18n.t.credentials.title);

  const vaultCreds = data.credentials.filter(c =>
    c.vaultId === data.activeVaultId
    && (app.activeView !== '2fa-tokens' || !!c.totpSecret));
  const creds = queryCredentials(vaultCreds, {
    search: app.searchQuery,
    filters: app.credentialFilters,
    sort: app.credentialSort,
    tag: app.activeTag
  });
  app.renderFilterBar(vaultCreds);


  if (creds.length === 0) {
    const filtered = app.credentialFilters.size > 0;
    const title = filtered
      ? app.tr('Aucun identifiant pour ces filtres', 'No credentials match these filters')
      : app.searchQuery ? i18n.t.common.noResultsTitle : i18n.t.common.emptyVaultTitle;
    const sub = filtered ? '' : app.searchQuery ? i18n.t.common.noResultsSub : i18n.t.common.emptyVaultSub;
    container.innerHTML = `
      <div class="empty-state">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <div class="empty-state-title">${title}</div>
        ${sub ? `<div class="empty-state-sub">${sub}</div>` : ''}
        ${filtered ? `<button class="btn-primary" type="button" data-action="reset-filters">${app.tr('Retirer les filtres', 'Clear filters')}</button>` : ''}
      </div>`;
    container.querySelector('[data-action="reset-filters"]')?.addEventListener('click', () => {
      app.credentialFilters.clear();
      app.saveListPrefs();
      app.renderList();
    });
    return;
  }

  if (!app.selectedItemId && creds.length > 0) {
    app.selectedItemId = creds[0].id;
    app.renderDetail(creds[0].id);
  }

  const now = Date.now();
  const locale = app.dateLocale();
  const tr = (fr: string, en: string) => app.tr(fr, en);

  creds.forEach(cred => {
    const row = document.createElement('div');
    row.className = `record-row ${app.selectedItemId === cred.id ? 'selected' : ''}`;
    row.tabIndex = 0;
    const expiry = renderExpiryBadge(expiryInfo(cred.expiresAt, tr, locale, now), { hideOk: true });

    row.innerHTML = `
      <div class="record-icon">${app.credentialIcon(cred)}</div>
      <div class="record-info">
        <div class="record-title">${cred.isFavorite ? `<span class="record-fav" title="${app.tr('Favori', 'Favorite')}">★</span>` : ''}${app.escapeHtml(cred.title)}</div>
        <div class="record-sub">${app.escapeHtml(app.itemSubtitle(cred))}</div>
      </div>
      <div class="record-badges">
        ${itemTypeOf(cred.type) === 'login' && !cred.templateId ? '' : app.typeBadge(itemTypeOf(cred.type), cred.templateId)}
        ${expiry}
        ${cred.totpSecret ? '<span class="badge badge-accent">2FA</span>' : ''}
        ${cred.passkeys && cred.passkeys.length > 0 ? '<span class="badge">Passkey</span>' : ''}
      </div>
    `;

    const open = () => {
      app.selectedItemId = cred.id;
      app.renderList();
      app.renderDetail(cred.id);
      document.getElementById('detail-container')?.classList.add('mobile-active');
    };
    row.addEventListener('click', open);
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter') open();
    });
    container.appendChild(row);
  });
}
