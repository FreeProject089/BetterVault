import { vaultStore } from './store/vaultStore';
import { Task } from './types/vault';
import { getServiceIconSvg } from './icons/serviceIcons';
import { generateTOTP } from './crypto/totpEngine';
import { calculatePasswordEntropy, generateStrongPassword, generatePassphrase, hashVaultPassword, auditVaultSecurity, checkPasswordPwnedHIBP } from './crypto/vaultCrypto';
import { parseImportFile, exportVaultAsJson, exportVaultAsCsv, downloadExportFile } from './import_export/importEngine';
import { isBiometricsAvailable, verifyBiometrics } from './crypto/webauthn';
import { i18n } from './i18n';

type ActiveView = 'all-credentials' | '2fa-tokens' | 'tasks';

/* ════════════════════════════════════════════════════════════════════════════
   APP CONTROLLER — Zero-Knowledge Vault Manager
   ════════════════════════════════════════════════════════════════════════════ */
class AppController {
  private activeView: ActiveView = 'all-credentials';
  private selectedItemId: string | null = null;
  private searchQuery = '';
  private taskViewMode: 'list' | 'kanban' | 'calendar' = 'list';
  public totpInterval: number | null = null;
  private autoLockTimeout: number | null = null;
  private readonly AUTO_LOCK_DELAY_MS = 5 * 60 * 1000; // 5 minutes d'inactivité

  constructor() {
    this.initEventListeners();
    this.initMobileControls();
    this.initI18n();
    this.initAutoLock();
    this.renderSidebar();
    this.renderList();
    this.renderCounts();
    vaultStore.subscribe(() => {
      this.renderSidebar();
      this.renderList();
      this.renderCounts();
      if (this.selectedItemId) this.renderDetail(this.selectedItemId);
    });
    i18n.subscribe(() => {
      this.applyI18n();
      this.renderSidebar();
      this.renderList();
      this.renderCounts();
      if (this.selectedItemId) this.renderDetail(this.selectedItemId);
    });
  }

  /* ── Internationalisation (i18n & i10n) ─────────────────────────────────── */
  private initI18n(): void {
    const toggleBtn = document.getElementById('btn-language-toggle');
    toggleBtn?.addEventListener('click', () => {
      const nextLang = i18n.toggleLocale();
      const label = document.getElementById('current-lang-label');
      if (label) label.textContent = nextLang.toUpperCase();
      this.showToast(nextLang === 'fr' ? 'Langue : Français' : 'Language: English', 'info', 1500);
    });
    this.applyI18n();
  }

  private applyI18n(): void {
    const lang = i18n.getLocale();
    document.documentElement.lang = lang;
    const label = document.getElementById('current-lang-label');
    if (label) label.textContent = lang.toUpperCase();

    // Traduction des textes data-i18n
    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      const keys = key.split('.');
      let val: any = i18n.t;
      for (const k of keys) {
        val = val?.[k];
      }
      if (typeof val === 'string') {
        el.textContent = val;
      }
    });

    // Traduction des placeholders data-i18n-placeholder
    document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (!key) return;
      const keys = key.split('.');
      let val: any = i18n.t;
      for (const k of keys) {
        val = val?.[k];
      }
      if (typeof val === 'string') {
        el.placeholder = val;
      }
    });

    // Traduction des titles/tooltips data-i18n-title
    document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (!key) return;
      const keys = key.split('.');
      let val: any = i18n.t;
      for (const k of keys) {
        val = val?.[k];
      }
      if (typeof val === 'string') {
        el.title = val;
      }
    });
  }

  /* ── Mobile Drawer ─────────────────────────────────────────────────────── */
  private initMobileControls(): void {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('mobile-overlay');
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    const mobileSidebarClose = document.getElementById('mobile-sidebar-close');

    const openSidebar = () => {
      sidebar?.classList.add('mobile-open');
      overlay?.classList.add('active');
    };
    const closeSidebar = () => {
      sidebar?.classList.remove('mobile-open');
      overlay?.classList.remove('active');
    };

    mobileMenuToggle?.addEventListener('click', openSidebar);
    mobileSidebarClose?.addEventListener('click', closeSidebar);
    overlay?.addEventListener('click', closeSidebar);
    document.querySelectorAll('.sidebar .nav-item').forEach(item => {
      item.addEventListener('click', closeSidebar);
    });
  }

  /* ── Toast System ──────────────────────────────────────────────────────── */
  public showToast(message: string, type: 'success' | 'info' | 'error' = 'info', durationMs = 2500): void {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    toast.innerHTML = `<span style="font-size:14px;font-weight:700;">${icons[type]}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 300);
    }, durationMs);
  }

  /* ── Auto-Lock Timer (Zero-Knowledge Inactivity Protection) ────────────── */
  private initAutoLock(): void {
    const resetTimer = () => {
      if (this.autoLockTimeout) {
        window.clearTimeout(this.autoLockTimeout);
      }
      this.autoLockTimeout = window.setTimeout(() => {
        const data = vaultStore.getData();
        const activeVault = data.vaults.find(v => v.id === data.activeVaultId);
        if (activeVault && activeVault.passwordHash && !activeVault.isLocked) {
          vaultStore.lockVault(activeVault.id);
          this.showToast(i18n.getLocale() === 'fr' ? 'Coffre verrouillé pour inactivité' : 'Vault locked due to inactivity', 'info');
        }
      }, this.AUTO_LOCK_DELAY_MS);
    };

    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
      window.addEventListener(evt, resetTimer, { passive: true });
    });

    resetTimer();
  }

  /* ── Event Listeners ───────────────────────────────────────────────────── */
  private initEventListeners(): void {
    document.querySelectorAll('[data-view]').forEach(el => {
      el.addEventListener('click', (e) => {
        document.querySelectorAll('[data-view]').forEach(item => item.classList.remove('active'));
        const target = e.currentTarget as HTMLElement;
        target.classList.add('active');
        this.activeView = target.dataset.view as ActiveView;
        this.selectedItemId = null;
        this.renderList();
        this.renderDetail(null);
      });
    });

    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
        this.renderList();
      });
    }

    window.addEventListener('keydown', (e) => {
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName);

      // Cmd/Ctrl + K : Recherche globale
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInput?.focus();
        searchInput?.select();
        return;
      }

      // Cmd/Ctrl + N : Nouvel élément (Identifiant ou Tâche selon vue active)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n' && !isInput) {
        e.preventDefault();
        if (this.activeView === 'tasks') {
          this.openCreateTaskModal();
        } else {
          this.openCreateCredentialModal();
        }
        return;
      }

      // Cmd/Ctrl + L : Verrouiller le coffre actif immédiatement
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l' && !isInput) {
        e.preventDefault();
        const data = vaultStore.getData();
        const activeVault = data.vaults.find(v => v.id === data.activeVaultId);
        if (activeVault && activeVault.passwordHash && !activeVault.isLocked) {
          vaultStore.lockVault(activeVault.id);
          this.showToast(i18n.getLocale() === 'fr' ? 'Coffre verrouillé' : 'Vault locked', 'info');
        }
        return;
      }

      // Cmd/Ctrl + G : Ouvrir le générateur de mot de passe
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g' && !isInput) {
        e.preventDefault();
        this.openGeneratorModal();
        return;
      }

      // Touche '?' : Afficher la palette d'aide des raccourcis
      if (e.key === '?' && !isInput && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        this.openShortcutsModal();
        return;
      }
    });

    const btnAdd = document.getElementById('btn-add-item');
    if (btnAdd) {
      btnAdd.addEventListener('click', () => {
        if (this.activeView === 'tasks') {
          this.openCreateTaskModal();
        } else {
          this.openCreateCredentialModal();
        }
      });
    }

    document.getElementById('btn-open-generator')?.addEventListener('click', () => {
      this.openGeneratorModal();
    });

    document.getElementById('btn-open-audit')?.addEventListener('click', () => {
      this.openAuditModal();
    });

    document.getElementById('btn-open-import')?.addEventListener('click', () => {
      this.openImportModal();
    });

    document.getElementById('btn-add-vault')?.addEventListener('click', () => {
      this.openCreateVaultModal();
    });

    document.getElementById('btn-view-list')?.addEventListener('click', () => {
      this.taskViewMode = 'list';
      document.getElementById('btn-view-list')?.classList.add('active');
      document.getElementById('btn-view-kanban')?.classList.remove('active');
      document.getElementById('btn-view-calendar')?.classList.remove('active');
      this.renderList();
    });

    document.getElementById('btn-view-kanban')?.addEventListener('click', () => {
      this.taskViewMode = 'kanban';
      document.getElementById('btn-view-kanban')?.classList.add('active');
      document.getElementById('btn-view-list')?.classList.remove('active');
      document.getElementById('btn-view-calendar')?.classList.remove('active');
      this.renderList();
    });

    document.getElementById('btn-view-calendar')?.addEventListener('click', () => {
      this.taskViewMode = 'calendar';
      document.getElementById('btn-view-calendar')?.classList.add('active');
      document.getElementById('btn-view-list')?.classList.remove('active');
      document.getElementById('btn-view-kanban')?.classList.remove('active');
      this.renderList();
    });
  }

  /* ── Counts (sidebar badges) ───────────────────────────────────────────── */
  private renderCounts(): void {
    const data = vaultStore.getData();
    const credCountEl = document.getElementById('count-credentials');
    const totpCountEl = document.getElementById('count-2fa');
    const taskCountEl = document.getElementById('count-tasks');

    const activeVault = data.vaults.find(v => v.id === data.activeVaultId);
    if (activeVault?.isLocked) {
      if (credCountEl) credCountEl.textContent = '—';
      if (totpCountEl) totpCountEl.textContent = '—';
      if (taskCountEl) taskCountEl.textContent = '—';
      return;
    }

    const creds = data.credentials.filter(c => c.vaultId === data.activeVaultId);
    if (credCountEl) credCountEl.textContent = creds.length.toString();
    if (totpCountEl) totpCountEl.textContent = creds.filter(c => !!c.totpSecret).length.toString();
    if (taskCountEl) taskCountEl.textContent = data.tasks.filter(t => t.vaultId === data.activeVaultId).length.toString();
  }

  /* ── Sidebar (coffres) ─────────────────────────────────────────────────── */
  private renderSidebar(): void {
    const data = vaultStore.getData();
    const vaultListEl = document.getElementById('vault-list');
    if (!vaultListEl) return;

    vaultListEl.innerHTML = '';
    data.vaults.forEach(vault => {
      const li = document.createElement('li');
      li.className = `nav-item ${vault.id === data.activeVaultId ? 'active' : ''}`;
      li.style.justifyContent = 'space-between';

      const typeLabels: Record<string, string> = {
        personal: i18n.t.common.personal,
        work: i18n.t.common.work,
        team: i18n.t.common.team
      };
      let rightHTML = `<span class="vault-type-badge ${vault.type}">${typeLabels[vault.type] ?? vault.type}</span>`;

      if (vault.passwordProtected) {
        const isLocked = vault.isLocked;
        const lockColor = isLocked ? 'var(--accent-red)' : 'var(--accent-green)';
        const lockPath = isLocked
          ? 'M7 11V7a5 5 0 0 1 10 0v4'
          : 'M7 11V7a5 5 0 0 0 10 0v4';
        rightHTML += ` <button class="icon-btn btn-vault-lock-action" data-vault-id="${vault.id}" data-locked="${isLocked}" style="color:${lockColor}; padding:2px;" title="${isLocked ? i18n.t.vault.unlockActionTitle : i18n.t.vault.lockActionTitle}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="${lockPath}"></path>
          </svg>
        </button>`;
      }

      li.innerHTML = `
        <span class="nav-item-left">
          <span class="nav-item-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
          </span>
          ${vault.name}
        </span>
        <span style="display:flex;align-items:center;gap:5px;">${rightHTML}</span>
      `;

      li.querySelector('.btn-vault-lock-action')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (vault.isLocked) {
          this.openUnlockVaultModal(vault.id);
        } else {
          vaultStore.lockVault(vault.id);
          this.showToast(`${i18n.t.vault.vaultLockedToast} ("${vault.name}")`, 'info');
        }
      });

      li.addEventListener('click', () => {
        if (vault.passwordProtected && vault.isLocked) {
          this.openUnlockVaultModal(vault.id);
        } else {
          vaultStore.setActiveVault(vault.id);
          this.selectedItemId = null;
          this.renderList();
          this.renderDetail(null);
        }
      });
      vaultListEl.appendChild(li);
    });
  }

  /* ── List Panel ─────────────────────────────────────────────────────────── */
  private renderList(): void {
    const data = vaultStore.getData();
    const container = document.getElementById('items-container');
    const listTitle = document.getElementById('list-view-title');
    if (!container) return;

    container.innerHTML = '';

    // Coffre verrouillé → bannière
    const activeVault = data.vaults.find(v => v.id === data.activeVaultId);
    if (activeVault?.isLocked) {
      if (listTitle) listTitle.textContent = `${activeVault.name} — ${i18n.t.common.locked}`;
      const banner = document.createElement('div');
      banner.className = 'vault-locked-banner';
      banner.innerHTML = `
        <div class="vault-locked-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
        </div>
        <div class="vault-locked-title">${i18n.t.vault.lockedBannerTitle}</div>
        <div class="vault-locked-sub">${i18n.t.vault.lockedBannerSub}</div>
        <button class="btn-primary" id="btn-quick-unlock" style="margin-top:8px;background-color:var(--accent-green);color:#fff;border-color:var(--accent-green);">
          ${i18n.t.vault.unlockButton}
        </button>
      `;
      container.appendChild(banner);
      document.getElementById('btn-quick-unlock')?.addEventListener('click', () => {
        this.openUnlockVaultModal(activeVault.id);
      });
      return;
    }

    const taskToggle = document.getElementById('task-view-toggle');
    if (taskToggle) {
      taskToggle.style.display = this.activeView === 'tasks' ? 'flex' : 'none';
    }

    if (this.activeView === 'tasks') {
      if (listTitle) listTitle.textContent = i18n.t.tasks.title;
      let tasks = data.tasks.filter(t => t.vaultId === data.activeVaultId);

      if (this.searchQuery) {
        tasks = tasks.filter(t =>
          t.title.toLowerCase().includes(this.searchQuery) ||
          (t.description && t.description.toLowerCase().includes(this.searchQuery))
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
      if (this.taskViewMode === 'kanban') {
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
            card.className = `kanban-card ${this.selectedItemId === task.id ? 'selected' : ''}`;
            const prioLabel = (i18n.t.common as any)[task.priority] || task.priority;
            card.innerHTML = `
              <div class="kanban-card-title">${task.title}</div>
              <div class="kanban-card-meta">
                <span class="badge priority-${task.priority}">${prioLabel.toUpperCase()}</span>
                <span>${i18n.formatRelativeDate(task.dueDate || '')}</span>
              </div>
            `;
            card.addEventListener('click', () => {
              this.selectedItemId = task.id;
              this.renderList();
              this.renderDetail(task.id);
              document.getElementById('detail-container')?.classList.add('mobile-active');
            });
            cardsBox.appendChild(card);
          });

          kanbanWrapper.appendChild(colEl);
        });

        container.appendChild(kanbanWrapper);
        return;
      }

      // Mode Calendrier / Échéances (Timeline)
      if (this.taskViewMode === 'calendar') {
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
            row.className = `timeline-task-row ${this.selectedItemId === task.id ? 'selected' : ''}`;
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
              this.selectedItemId = task.id;
              this.renderList();
              this.renderDetail(task.id);
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
        row.className = `record-row ${this.selectedItemId === task.id ? 'selected' : ''}`;
        const isDone = task.status === 'completed';
        const isInProgress = task.status === 'in_progress';
        const dotColor = isDone ? 'var(--accent-green)' : isInProgress ? 'var(--accent-blue)' : 'var(--text-muted)';
        const iconBg = isDone ? '35,134,54' : isInProgress ? '88,166,255' : '110,118,129';

        const statusSub = isInProgress ? i18n.t.tasks.statusInProgress : i18n.t.common.noDueDate;
        row.innerHTML = `
          <div class="record-icon" style="color:${dotColor};background-color:rgba(${iconBg},0.1);">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="9 11 12 14 22 4"></polyline>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
            </svg>
          </div>
          <div class="record-info">
            <div class="record-title" style="${isDone ? 'text-decoration:line-through;opacity:0.5;' : ''}">${task.title}</div>
            <div class="record-sub">${task.dueDate ? i18n.formatRelativeDate(task.dueDate) : statusSub}</div>
          </div>
          <div class="record-badges">
            <span class="badge priority-${task.priority}">${task.priority.charAt(0).toUpperCase()}</span>
          </div>
        `;

        row.addEventListener('click', () => {
          this.selectedItemId = task.id;
          this.renderList();
          this.renderDetail(task.id);
          document.getElementById('detail-container')?.classList.add('mobile-active');
        });
        container.appendChild(row);
      });
      return;
    }

    // Vue Credentials ou 2FA
    if (listTitle) listTitle.textContent = this.activeView === '2fa-tokens' ? i18n.t.nav.twoFactorTokens : i18n.t.credentials.title;

    let creds = data.credentials.filter(c => c.vaultId === data.activeVaultId);
    if (this.activeView === '2fa-tokens') {
      creds = creds.filter(c => !!c.totpSecret);
    }

    if (this.searchQuery) {
      creds = creds.filter(c =>
        c.title.toLowerCase().includes(this.searchQuery) ||
        c.username.toLowerCase().includes(this.searchQuery) ||
        c.website.toLowerCase().includes(this.searchQuery)
      );
    }

    if (creds.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
          <div class="empty-state-title">${this.searchQuery ? i18n.t.common.noResultsTitle : i18n.t.common.emptyVaultTitle}</div>
          <div class="empty-state-sub">${this.searchQuery ? i18n.t.common.noResultsSub : i18n.t.common.emptyVaultSub}</div>
        </div>`;
      return;
    }

    if (!this.selectedItemId && creds.length > 0) {
      this.selectedItemId = creds[0].id;
      this.renderDetail(creds[0].id);
    }

    creds.forEach(cred => {
      const row = document.createElement('div');
      row.className = `record-row ${this.selectedItemId === cred.id ? 'selected' : ''}`;

      row.innerHTML = `
        <div class="record-icon">${getServiceIconSvg(cred.website || cred.title)}</div>
        <div class="record-info">
          <div class="record-title" style="display:flex;align-items:center;gap:6px;">
            ${cred.isFavorite ? '<span style="color:var(--accent-orange);font-size:10px;">&#9733;</span>' : ''}
            ${cred.title}
          </div>
          <div class="record-sub">${cred.username || cred.domain || 'Sans login'}</div>
        </div>
        <div class="record-badges">
          ${cred.totpSecret ? '<span class="badge" style="color:var(--accent-blue);border-color:rgba(88,166,255,0.3);">2FA</span>' : ''}
          ${cred.passkeys && cred.passkeys.length > 0 ? '<span class="badge" style="color:var(--accent-purple);">PK</span>' : ''}
        </div>
      `;

      row.addEventListener('click', () => {
        this.selectedItemId = cred.id;
        this.renderList();
        this.renderDetail(cred.id);
        document.getElementById('detail-container')?.classList.add('mobile-active');
      });
      container.appendChild(row);
    });
  }

  /* ── Detail Panel ─────────────────────────────────────────────────────── */
  private renderDetail(id: string | null): void {
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
              <div class="detail-title">${task.title}</div>
              <div class="detail-meta">Créée le ${new Date(task.createdAt).toLocaleDateString('fr-FR')}</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
            <button class="btn-primary" id="btn-toggle-task-status" style="font-size:11px;padding:6px 14px;">
              ${task.status === 'completed' ? 'Rouvrir' : 'Terminer'}
            </button>
            <button class="btn-primary" id="btn-edit-task" style="font-size:11px;padding:6px 12px;background-color:var(--bg-tertiary);border-color:var(--border-subtle);color:var(--text-primary);">Modifier</button>
            <button class="btn-primary" id="btn-delete-task" style="font-size:11px;padding:6px 12px;color:var(--accent-red);border-color:rgba(218,54,51,0.4);">Supprimer</button>
          </div>
        </div>

        <div class="detail-content">
          <div class="field-group">
            <div class="field-label">Statut & Priorité</div>
            <div class="field-box">
              <span class="field-val" style="color:${statusColors[task.status]};">${statusLabels[task.status] || task.status}</span>
              <span class="badge priority-${task.priority}">${task.priority.toUpperCase()}</span>
            </div>
          </div>

          ${task.dueDate ? `
            <div class="field-group">
              <div class="field-label">Échéance</div>
              <div class="field-box"><span class="field-val">${task.dueDate}</span></div>
            </div>
          ` : ''}

          ${task.description ? `
            <div class="field-group">
              <div class="section-divider" style="margin-bottom:8px;">Description</div>
              <div class="field-box" style="white-space:pre-wrap;line-height:1.6;">${task.description}</div>
            </div>
          ` : ''}

          ${linkedCred ? `
            <div class="field-group">
              <div class="section-divider" style="margin-bottom:8px;">Identifiant lié</div>
              <div class="field-box" style="cursor:pointer;" id="btn-goto-linked-cred">
                <div style="display:flex;align-items:center;gap:10px;">
                  <span style="display:flex;">${getServiceIconSvg(linkedCred.website || linkedCred.title)}</span>
                  <span class="field-val" style="font-weight:600;">${linkedCred.title}</span>
                </div>
                <span style="font-size:11px;color:var(--accent-blue);">Ouvrir →</span>
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
                    <span class="subtask-title ${s.isDone ? 'done' : ''}">${s.title}</span>
                  </label>
                  <button class="icon-btn btn-del-subtask" data-subtask-id="${s.id}" title="Supprimer" style="color:var(--text-muted);padding:2px 4px;">
                    ✕
                  </button>
                </div>
              `).join('')}
            </div>
            <div class="subtask-add-row">
              <input class="form-input" id="input-new-subtask" type="text" placeholder="Ajouter une étape..." style="flex:1;font-size:12px;padding:6px 10px;">
              <button class="btn-primary" id="btn-add-subtask" style="font-size:11px;padding:6px 12px;">Ajouter</button>
            </div>
          </div>

          <div class="field-group">
            <div class="section-divider" style="margin-bottom:8px;">Notes</div>
            <textarea class="note-editor" id="task-notes" placeholder="Notes sur cette tâche...">${task.notes || ''}</textarea>
            <div style="display:flex;justify-content:flex-end;margin-top:6px;">
              <button class="btn-primary" id="btn-save-task-notes" style="font-size:11px;padding:5px 14px;">Enregistrer</button>
            </div>
          </div>
        </div>
      `;

      document.getElementById('btn-detail-back')?.addEventListener('click', () => {
        document.getElementById('detail-container')?.classList.remove('mobile-active');
      });

      document.getElementById('btn-toggle-task-status')?.addEventListener('click', () => {
        const nextStatus = task.status === 'completed' ? 'todo' : 'completed';
        vaultStore.updateTask(task.id, { status: nextStatus });
        this.showToast(nextStatus === 'completed' ? 'Tâche terminée' : 'Tâche rouverte', 'success');
      });

      document.getElementById('btn-goto-linked-cred')?.addEventListener('click', () => {
        if (linkedCred) {
          this.activeView = 'all-credentials';
          this.selectedItemId = linkedCred.id;
          this.renderList();
          this.renderDetail(linkedCred.id);
        }
      });

      document.getElementById('btn-edit-task')?.addEventListener('click', () => {
        this.openCreateTaskModal(undefined, task.id);
      });

      document.getElementById('btn-delete-task')?.addEventListener('click', () => {
        if (confirm(`Supprimer définitivement la tâche "${task.title}" ?`)) {
          vaultStore.deleteTask(task.id);
          this.selectedItemId = null;
          this.renderDetail(null);
          this.showToast('Tâche supprimée', 'error');
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
          this.renderDetail(task.id);
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
          this.renderDetail(task.id);
        });
      });

      document.querySelectorAll('.btn-del-subtask').forEach(el => {
        el.addEventListener('click', (e) => {
          const subId = (e.currentTarget as HTMLElement).dataset.subtaskId;
          const updated = currentSubtasks.filter(s => s.id !== subId);
          vaultStore.updateTask(task.id, { subtasks: updated });
          this.renderDetail(task.id);
        });
      });

      document.getElementById('btn-save-task-notes')?.addEventListener('click', () => {
        const notesEl = document.getElementById('task-notes') as HTMLTextAreaElement;
        if (notesEl) {
          vaultStore.updateTask(task.id, { notes: notesEl.value } as Partial<Task>);
          this.showToast('Notes enregistrées', 'success');
        }
      });
      return;
    }

    /* ─── Cas 2 : Credential ─────────────────────────────────────────────── */
    const cred = data.credentials.find(c => c.id === id);
    if (!cred) return;

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
      : `<div style="font-size:12px;color:var(--text-muted);padding:6px 0;">Aucune tâche liée.</div>`;

    // Passkeys HTML
    const passkeysHTML = cred.passkeys && cred.passkeys.length > 0 ? `
      <div class="field-group">
        <div class="field-label">Passkeys FIDO2 / WebAuthn</div>
        <div class="field-box">
          <div style="display:flex;align-items:center;gap:8px;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="2">
              <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5z"></path>
            </svg>
            <span class="field-val">${cred.passkeys[0].rpId} (x${cred.passkeys[0].signCount})</span>
          </div>
          <span class="badge" style="color:var(--accent-blue);">FIDO2</span>
        </div>
      </div>` : '';

    // TOTP Card HTML
    const totpHTML = cred.totpSecret ? `
      <div class="field-group">
        <div class="field-label">Code 2FA Authenticator (RFC 6238)</div>
        <div class="totp-card" id="detail-totp-container" style="cursor:pointer;" title="Cliquer pour copier">
          <div>
            <div class="totp-code-display" id="detail-totp-code">--- ---</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">Cliquer pour copier</div>
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
        <div class="field-label">Site web</div>
        <div class="field-box">
          <a href="${cred.website}" target="_blank" rel="noopener noreferrer"
            style="color:var(--accent-blue);text-decoration:none;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">
            ${cred.website}
          </a>
          <div class="field-actions">
            <button class="icon-btn" title="Copier l'URL" id="btn-copy-url">
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

    container.innerHTML = `
      <div class="detail-header">
        <div class="detail-header-left">
          <button class="detail-mobile-back" id="btn-detail-back-cred" title="Retour">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            <span>Retour</span>
          </button>
          <div class="detail-main-icon">${getServiceIconSvg(cred.website || cred.title)}</div>
          <div>
            <div class="detail-title">${cred.title}</div>
            <div class="detail-meta">${cred.domain || cred.website || 'Pas de domaine'}</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
          <button class="icon-btn" id="btn-toggle-fav" title="${favTitle}"
            style="color:${favColor};border:1px solid var(--border-subtle);padding:6px 10px;border-radius:var(--radius-md);">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="${favFill}" stroke="currentColor" stroke-width="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
          </button>
          <button class="btn-primary" id="btn-edit-cred" style="font-size:11px;padding:6px 12px;background-color:var(--bg-tertiary);border-color:var(--border-subtle);color:var(--text-primary);">Modifier</button>
          <button class="btn-primary" id="btn-add-task-for-cred" style="font-size:11px;padding:6px 12px;">+ Tâche</button>
          <button class="btn-primary" id="btn-delete-cred" style="font-size:11px;padding:6px 12px;color:var(--accent-red);border-color:rgba(218,54,51,0.4);">Supprimer</button>
        </div>
      </div>

      <div class="detail-content">
        ${totpHTML}

        <div class="field-group">
          <div class="field-label">Nom d'utilisateur / Email</div>
          <div class="field-box">
            <span class="field-val" id="text-username">${cred.username || '—'}</span>
            <div class="field-actions">
              <button class="icon-btn" title="Copier" id="btn-copy-username">
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
            <span class="field-label">Mot de passe</span>
            <span style="font-size:11px;color:${entropy.color};font-weight:600;">${entropy.label} &middot; ${entropy.bits} bits</span>
          </div>
          <div class="field-box">
            <span class="field-val" id="text-password" style="font-family:var(--font-mono);letter-spacing:1px;">&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;</span>
            <div class="field-actions">
              <button class="icon-btn" title="Révéler" id="btn-toggle-password">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </button>
              <button class="icon-btn" title="Copier" id="btn-copy-password">
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

        ${cred.passwordHistory && cred.passwordHistory.length > 0 ? `
          <div class="field-group">
            <div class="section-divider" style="margin-bottom:8px;">Historique des mots de passe (${cred.passwordHistory.length})</div>
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${cred.passwordHistory.map(h => `
                <div class="history-entry">
                  <span class="history-password">&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;</span>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <span class="history-date">${new Date(h.changedAt).toLocaleDateString('fr-FR')}</span>
                    <button class="icon-btn btn-copy-history" data-pwd="${h.password.replace(/"/g, '&quot;')}" title="Copier l'ancien mot de passe">
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
          <div class="section-divider" style="margin-bottom:8px;">Champs personnalisés (${(cred.fields || []).length})</div>
          <div class="custom-fields-list" id="custom-fields-container">
            ${(cred.fields || []).map(f => `
              <div class="custom-field-row">
                <div style="font-size:11px;color:var(--text-muted);font-weight:600;">${f.label}</div>
                <div class="custom-field-box">
                  <span class="custom-field-val ${f.isMasked ? 'masked' : ''}" id="cf-val-${f.id}">
                    ${f.isMasked ? '••••••••••••' : f.value}
                  </span>
                  <div style="display:flex;gap:6px;">
                    ${f.isMasked ? `
                      <button class="icon-btn btn-reveal-cf" data-cf-id="${f.id}" data-val="${f.value.replace(/"/g, '&quot;')}" title="Révéler">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                      </button>
                    ` : ''}
                    <button class="icon-btn btn-copy-cf" data-val="${f.value.replace(/"/g, '&quot;')}" title="Copier">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </button>
                    <button class="icon-btn btn-del-cf" data-cf-id="${f.id}" title="Supprimer" style="color:var(--text-muted);">
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
          <div style="display:flex;gap:6px;margin-top:8px;">
            <input class="form-input" id="input-cf-label" placeholder="Libellé (ex: PIN, Question secrète...)" style="flex:1;font-size:12px;padding:6px 10px;">
            <input class="form-input" id="input-cf-val" placeholder="Valeur..." style="flex:1;font-size:12px;padding:6px 10px;">
            <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted);cursor:pointer;">
              <input type="checkbox" id="input-cf-masked"> Masqué
            </label>
            <button class="btn-primary" id="btn-add-cf" style="font-size:11px;padding:6px 12px;">Ajouter</button>
          </div>
        </div>

        <div class="field-group">
          <div class="section-divider" style="margin-bottom:8px;">Tâches liées (${linkedTasks.length})</div>
          ${linkedTasksHTML}
        </div>

        <div class="field-group">
          <div class="section-divider" style="margin-bottom:8px;">Notes sécurisées</div>
          <textarea class="note-editor" id="inline-notes" placeholder="Codes de récupération, PIN, contexte...">${cred.notes || ''}</textarea>
          <div style="display:flex;justify-content:flex-end;margin-top:6px;">
            <button class="btn-primary" id="btn-save-notes" style="font-size:11px;padding:5px 14px;">Enregistrer</button>
          </div>
        </div>
      </div>
    `;

    // Events après rendu DOM
    this.updateLiveTOTP();

    document.getElementById('btn-copy-username')?.addEventListener('click', async (e) => {
      if (cred.username) {
        await navigator.clipboard.writeText(cred.username);
        this.showToast('Identifiant copié', 'success');
        (e.currentTarget as HTMLElement).classList.add('copied');
        setTimeout(() => (e.currentTarget as HTMLElement).classList.remove('copied'), 500);
      }
    });

    document.getElementById('btn-copy-url')?.addEventListener('click', async () => {
      if (cred.website) {
        await navigator.clipboard.writeText(cred.website);
        this.showToast('URL copiée', 'success');
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
      await navigator.clipboard.writeText(cred.password);
      this.showToast('Mot de passe copié', 'success', 2000);
      (e.currentTarget as HTMLElement).classList.add('copied');
      setTimeout(() => (e.currentTarget as HTMLElement).classList.remove('copied'), 500);
    });

    document.getElementById('detail-totp-container')?.addEventListener('click', () => {
      if (cred.totpSecret) {
        const res = generateTOTP(cred.totpSecret);
        if (res) {
          navigator.clipboard.writeText(res.token);
          this.showToast(`Code 2FA copié : ${res.token.slice(0, 3)} ${res.token.slice(3)}`, 'success');
        }
      }
    });

    document.getElementById('btn-toggle-fav')?.addEventListener('click', () => {
      vaultStore.updateCredential(cred.id, { isFavorite: !cred.isFavorite });
      this.showToast(cred.isFavorite ? 'Retiré des favoris' : 'Ajouté aux favoris', 'info');
    });

    document.getElementById('btn-save-notes')?.addEventListener('click', () => {
      const notesEl = document.getElementById('inline-notes') as HTMLTextAreaElement;
      if (notesEl) {
        vaultStore.updateCredential(cred.id, { notes: notesEl.value });
        this.showToast('Notes enregistrées', 'success');
      }
    });

    document.querySelectorAll('.linked-task-row').forEach(el => {
      el.addEventListener('click', () => {
        const taskId = (el as HTMLElement).dataset.taskId;
        if (taskId) {
          this.activeView = 'tasks';
          this.selectedItemId = taskId;
          this.renderList();
          this.renderDetail(taskId);
        }
      });
    });

    document.getElementById('btn-delete-cred')?.addEventListener('click', () => {
      if (confirm(`Supprimer définitivement l'identifiant "${cred.title}" ?`)) {
        vaultStore.deleteCredential(cred.id);
        this.selectedItemId = null;
        this.renderDetail(null);
        this.showToast('Identifiant supprimé', 'error');
      }
    });

    document.getElementById('btn-edit-cred')?.addEventListener('click', () => {
      this.openCreateCredentialModal(cred.id);
    });

    document.querySelectorAll('.btn-copy-history').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const pwd = (el as HTMLElement).dataset.pwd;
        if (pwd) {
          await navigator.clipboard.writeText(pwd);
          this.showToast('Ancien mot de passe copié', 'success');
        }
      });
    });

    // Gestion des Champs Personnalisés
    const currentFields = [...(cred.fields || [])];

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
        this.renderDetail(cred.id);
        this.showToast('Champ personnalisé ajouté', 'success');
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
          this.showToast('Valeur copiée', 'success');
        }
      });
    });

    document.querySelectorAll('.btn-del-cf').forEach(el => {
      el.addEventListener('click', (e) => {
        const cfId = (e.currentTarget as HTMLElement).dataset.cfId;
        const updated = currentFields.filter(f => f.id !== cfId);
        vaultStore.updateCredential(cred.id, { fields: updated });
        this.renderDetail(cred.id);
      });
    });

    document.getElementById('btn-add-task-for-cred')?.addEventListener('click', () => {
      this.openCreateTaskModal(cred.id);
    });

    document.getElementById('btn-detail-back-cred')?.addEventListener('click', () => {
      document.getElementById('detail-container')?.classList.remove('mobile-active');
    });
  }

  /* ── TOTP Live Refresh ─────────────────────────────────────────────────── */
  private updateLiveTOTP(): void {
    if (this.totpInterval) clearInterval(this.totpInterval);
    if (!this.selectedItemId) return;
    const data = vaultStore.getData();
    const cred = data.credentials.find(c => c.id === this.selectedItemId);
    if (!cred?.totpSecret) return;

    const refresh = () => {
      const res = generateTOTP(cred.totpSecret!);
      if (!res) return;
      const codeEl = document.getElementById('detail-totp-code');
      const secEl = document.getElementById('detail-totp-seconds');
      const meterEl = document.getElementById('totp-circle-meter');
      if (codeEl) {
        const f = res.token.length === 6 ? `${res.token.slice(0, 3)} ${res.token.slice(3)}` : res.token;
        codeEl.textContent = f;
      }
      if (secEl) secEl.textContent = res.remainingSeconds.toString();
      if (meterEl) {
        const pct = (res.remainingSeconds / 30) * 100;
        meterEl.setAttribute('stroke-dashoffset', (100 - pct).toString());
        const color = res.remainingSeconds <= 5 ? 'var(--accent-red)' : res.remainingSeconds <= 10 ? 'var(--accent-orange)' : 'var(--accent-blue)';
        meterEl.setAttribute('stroke', color);
      }
    };
    refresh();
    this.totpInterval = window.setInterval(refresh, 1000);
  }

  /* ══════════════════════════════════════════════════════════════════════
     MODALS
  ══════════════════════════════════════════════════════════════════════ */

  private openModal(htmlContent: string): HTMLElement {
    const container = document.getElementById('modal-container');
    if (!container) return document.createElement('div');
    container.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-box">
          ${htmlContent}
        </div>
      </div>
    `;
    const overlay = document.getElementById('modal-overlay');
    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeModal();
    });
    return container.querySelector('.modal-box') as HTMLElement;
  }

  private closeModal(): void {
    const container = document.getElementById('modal-container');
    if (container) container.innerHTML = '';
  }

  /* ── Créer ou Modifier un Identifiant ────────────────────────────────── */
  private openCreateCredentialModal(existingCredId?: string): void {
    const data = vaultStore.getData();
    const existing = existingCredId ? data.credentials.find(c => c.id === existingCredId) : null;
    const isEdit = !!existing;

    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title">${isEdit ? `Modifier "${existing?.title}"` : 'Nouvel identifiant'}</div>
        <button class="modal-close" id="modal-close-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-field">
          <label class="form-label">Nom du service *</label>
          <input class="form-input" id="field-title" type="text" placeholder="GitHub, Netflix, Gmail..." value="${existing?.title || ''}" autocomplete="off">
        </div>
        <div class="form-field">
          <label class="form-label">URL du site</label>
          <input class="form-input" id="field-website" type="url" placeholder="https://github.com" value="${existing?.website || ''}" autocomplete="off">
        </div>
        <div class="form-field">
          <label class="form-label">Nom d'utilisateur / Email</label>
          <input class="form-input" id="field-username" type="text" placeholder="user@example.com" value="${existing?.username || ''}" autocomplete="off">
        </div>
        <div class="form-field">
          <label class="form-label">Mot de passe *</label>
          <div style="display:flex;gap:8px;">
            <input class="form-input" id="field-password" type="text" placeholder="Mot de passe fort..." value="${existing?.password || ''}" autocomplete="off" style="flex:1;">
            <button class="btn-primary" id="btn-gen-pwd" style="white-space:nowrap;font-size:11px;padding:0 12px;">Générer</button>
          </div>
        </div>
        <div class="form-field">
          <label class="form-label">Secret TOTP (2FA) — optionnel</label>
          <input class="form-input" id="field-totp" type="text" placeholder="JBSWY3DPEHPK3PXP" value="${existing?.totpSecret || ''}" autocomplete="off">
        </div>
        <div class="form-field">
          <label class="form-label">Notes</label>
          <textarea class="note-editor" id="field-notes" placeholder="Codes de récupération, informations supplémentaires...">${existing?.notes || ''}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-primary" id="modal-cancel" style="color:var(--text-muted);">Annuler</button>
        <button class="btn-primary" id="modal-confirm">${isEdit ? 'Enregistrer les modifications' : "Créer l'identifiant"}</button>
      </div>
    `);

    box.querySelector('#modal-close-btn')?.addEventListener('click', () => this.closeModal());
    box.querySelector('#modal-cancel')?.addEventListener('click', () => this.closeModal());

    box.querySelector('#btn-gen-pwd')?.addEventListener('click', () => {
      const pwdInput = box.querySelector('#field-password') as HTMLInputElement;
      if (pwdInput) pwdInput.value = generateStrongPassword({ length: 20, uppercase: true, lowercase: true, numbers: true, symbols: false, avoidAmbiguous: false });
    });

    box.querySelector('#modal-confirm')?.addEventListener('click', () => {
      const title = (box.querySelector('#field-title') as HTMLInputElement)?.value.trim();
      const password = (box.querySelector('#field-password') as HTMLInputElement)?.value;
      if (!title || !password) {
        this.showToast('Le nom et le mot de passe sont requis', 'error');
        return;
      }
      const website = (box.querySelector('#field-website') as HTMLInputElement)?.value.trim();
      const username = (box.querySelector('#field-username') as HTMLInputElement)?.value.trim();
      const totpSecret = (box.querySelector('#field-totp') as HTMLInputElement)?.value.trim();
      const notes = (box.querySelector('#field-notes') as HTMLTextAreaElement)?.value;

      if (isEdit && existing) {
        vaultStore.updateCredential(existing.id, {
          title,
          website: website || '',
          username: username || '',
          password,
          domain: website ? (website.replace(/^https?:\/\//, '').split('/')[0]) : '',
          totpSecret: totpSecret || undefined,
          notes: notes || ''
        });
        this.closeModal();
        this.showToast('Identifiant mis à jour (historique conservé)', 'success');
      } else {
        const data2 = vaultStore.getData();
        vaultStore.addCredential({
          vaultId: data2.activeVaultId,
          title,
          website: website || '',
          username: username || '',
          password,
          domain: website ? (website.replace(/^https?:\/\//, '').split('/')[0]) : '',
          totpSecret: totpSecret || undefined,
          notes: notes || '',
          tags: [],
          isFavorite: false
        });
        this.closeModal();
        this.showToast('Identifiant créé', 'success');
      }
    });
  }

  /* ── Créer ou Modifier une Tâche ─────────────────────────────────────── */
  private openCreateTaskModal(linkedCredentialId?: string, existingTaskId?: string): void {
    const data = vaultStore.getData();
    const existing = existingTaskId ? data.tasks.find(t => t.id === existingTaskId) : null;
    const isEdit = !!existing;

    const targetLinkedCredId = existing ? existing.linkedCredentialId : linkedCredentialId;

    const credOptions = data.credentials
      .filter(c => c.vaultId === data.activeVaultId)
      .map(c => `<option value="${c.id}" ${c.id === targetLinkedCredId ? 'selected' : ''}>${c.title}</option>`)
      .join('');

    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title">${isEdit ? `Modifier "${existing?.title}"` : 'Nouvelle tâche'}</div>
        <button class="modal-close" id="modal-close-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-field">
          <label class="form-label">Titre *</label>
          <input class="form-input" id="task-title" type="text" placeholder="Renouveler le mot de passe GitHub..." value="${existing?.title || ''}" autocomplete="off">
        </div>
        <div class="form-field">
          <label class="form-label">Description</label>
          <textarea class="note-editor" id="task-desc" placeholder="Description optionnelle...">${existing?.description || ''}</textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-field">
            <label class="form-label">Priorité</label>
            <select class="form-input" id="task-priority">
              <option value="low" ${existing?.priority === 'low' ? 'selected' : ''}>Basse</option>
              <option value="medium" ${(!existing || existing?.priority === 'medium') ? 'selected' : ''}>Moyenne</option>
              <option value="high" ${existing?.priority === 'high' ? 'selected' : ''}>Haute</option>
              <option value="urgent" ${existing?.priority === 'urgent' ? 'selected' : ''}>Urgente</option>
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">Échéance</label>
            <input class="form-input" id="task-due" type="date" value="${existing?.dueDate || ''}">
          </div>
        </div>
        ${credOptions ? `
          <div class="form-field">
            <label class="form-label">Identifiant lié (optionnel)</label>
            <select class="form-input" id="task-cred">
              <option value="">— Aucun —</option>
              ${credOptions}
            </select>
          </div>` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn-primary" id="modal-cancel" style="color:var(--text-muted);">Annuler</button>
        <button class="btn-primary" id="modal-confirm">${isEdit ? 'Enregistrer les modifications' : 'Créer la tâche'}</button>
      </div>
    `);

    box.querySelector('#modal-close-btn')?.addEventListener('click', () => this.closeModal());
    box.querySelector('#modal-cancel')?.addEventListener('click', () => this.closeModal());
    box.querySelector('#modal-confirm')?.addEventListener('click', () => {
      const title = (box.querySelector('#task-title') as HTMLInputElement)?.value.trim();
      if (!title) { this.showToast('Le titre est requis', 'error'); return; }
      const description = (box.querySelector('#task-desc') as HTMLTextAreaElement)?.value;
      const priority = (box.querySelector('#task-priority') as HTMLSelectElement)?.value as Task['priority'];
      const dueDate = (box.querySelector('#task-due') as HTMLInputElement)?.value;
      const linkedCredSel = box.querySelector('#task-cred') as HTMLSelectElement;
      const linkedCred = linkedCredSel?.value || undefined;

      if (isEdit && existing) {
        vaultStore.updateTask(existing.id, {
          title,
          description: description || undefined,
          priority,
          dueDate: dueDate || undefined,
          linkedCredentialId: linkedCred
        });
        this.closeModal();
        this.showToast('Tâche mise à jour', 'success');
      } else {
        const data3 = vaultStore.getData();
        vaultStore.addTask({
          vaultId: data3.activeVaultId,
          title,
          description: description || undefined,
          status: 'todo',
          priority,
          dueDate: dueDate || undefined,
          linkedCredentialId: linkedCred,
          tags: []
        });
        this.closeModal();
        this.showToast('Tâche créée', 'success');
      }
    });
  }

  /* ── Générateur ───────────────────────────────────────────────────────── */
  private openGeneratorModal(): void {
    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title">Générateur de secrets</div>
        <button class="modal-close" id="modal-close-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <div style="display:flex;gap:8px;margin-bottom:12px;">
          <button class="btn-primary active" id="mode-pwd" style="flex:1;">Mot de passe</button>
          <button class="btn-primary" id="mode-phrase" style="flex:1;color:var(--text-secondary);">Phrase secrète</button>
        </div>

        <div id="section-pwd">
          <div class="form-field">
            <label class="form-label">Longueur : <span id="len-label">20</span></label>
            <input type="range" id="pwd-length" min="8" max="64" value="20" style="width:100%;accent-color:var(--accent-blue);">
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:12px;">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);">
              <input type="checkbox" id="opt-upper" checked> Majuscules
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);">
              <input type="checkbox" id="opt-lower" checked> Minuscules
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);">
              <input type="checkbox" id="opt-digits" checked> Chiffres
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);">
              <input type="checkbox" id="opt-symbols"> Symboles
            </label>
          </div>
        </div>

        <div id="section-phrase" style="display:none;">
          <div class="form-field">
            <label class="form-label">Nombre de mots : <span id="words-label">5</span></label>
            <input type="range" id="words-count" min="3" max="10" value="5" style="width:100%;accent-color:var(--accent-blue);">
          </div>
          <div class="form-field">
            <label class="form-label">Séparateur</label>
            <select class="form-input" id="phrase-sep">
              <option value="-">Tiret  (mot-de-passe)</option>
              <option value=" ">Espace (mot de passe)</option>
              <option value=".">Point  (mot.de.passe)</option>
              <option value="_">Underscore (mot_de_passe)</option>
            </select>
          </div>
        </div>

        <div style="background-color:var(--bg-primary);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:12px 14px;font-family:var(--font-mono);font-size:14px;color:var(--text-primary);word-break:break-all;min-height:44px;margin:12px 0;" id="gen-output">
          Cliquez sur Générer...
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-primary" id="btn-gen-new" style="flex:1;">Générer</button>
        <button class="btn-primary" id="btn-gen-copy" style="flex:1;">Copier</button>
      </div>
    `);

    let isPhrase = false;
    let generatedValue = '';

    const genOutput = box.querySelector('#gen-output') as HTMLElement;
    const lenLabel = box.querySelector('#len-label') as HTMLElement;
    const wordsLabel = box.querySelector('#words-label') as HTMLElement;
    const lenInput = box.querySelector('#pwd-length') as HTMLInputElement;
    const wordsInput = box.querySelector('#words-count') as HTMLInputElement;
    const sectionPwd = box.querySelector('#section-pwd') as HTMLElement;
    const sectionPhrase = box.querySelector('#section-phrase') as HTMLElement;

    lenInput?.addEventListener('input', () => { lenLabel.textContent = lenInput.value; });
    wordsInput?.addEventListener('input', () => { wordsLabel.textContent = wordsInput.value; });

    box.querySelector('#modal-close-btn')?.addEventListener('click', () => this.closeModal());

    box.querySelector('#mode-pwd')?.addEventListener('click', (e) => {
      isPhrase = false;
      sectionPwd.style.display = 'block';
      sectionPhrase.style.display = 'none';
      (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)';
      (box.querySelector('#mode-phrase') as HTMLElement).style.color = 'var(--text-secondary)';
    });

    box.querySelector('#mode-phrase')?.addEventListener('click', (e) => {
      isPhrase = true;
      sectionPwd.style.display = 'none';
      sectionPhrase.style.display = 'block';
      (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)';
      (box.querySelector('#mode-pwd') as HTMLElement).style.color = 'var(--text-secondary)';
    });

    box.querySelector('#btn-gen-new')?.addEventListener('click', () => {
      if (isPhrase) {
        const count = parseInt(wordsInput.value);
        const sep = (box.querySelector('#phrase-sep') as HTMLSelectElement)?.value ?? '-';
        generatedValue = generatePassphrase({ wordCount: count, separator: sep, capitalize: true, includeNumber: false });
      } else {
        generatedValue = generateStrongPassword({
          length: parseInt(lenInput.value),
          uppercase: (box.querySelector('#opt-upper') as HTMLInputElement)?.checked ?? true,
          lowercase: (box.querySelector('#opt-lower') as HTMLInputElement)?.checked ?? true,
          numbers: (box.querySelector('#opt-digits') as HTMLInputElement)?.checked ?? true,
          symbols: (box.querySelector('#opt-symbols') as HTMLInputElement)?.checked ?? false,
          avoidAmbiguous: false
        });
      }
      genOutput.textContent = generatedValue;
    });

    box.querySelector('#btn-gen-copy')?.addEventListener('click', async () => {
      if (generatedValue) {
        await navigator.clipboard.writeText(generatedValue);
        this.showToast(i18n.t.common.copied, 'success');
      }
    });
  }

  /* ── Audit de Sécurité du Coffre ────────────────────────────────────────── */
  private openAuditModal(): void {
    const data = vaultStore.getData();
    const creds = data.credentials.filter(c => c.vaultId === data.activeVaultId);
    const report = auditVaultSecurity(creds);

    const scoreColor = report.score >= 80 ? 'var(--accent-green)' : report.score >= 50 ? 'var(--accent-orange)' : 'var(--accent-red)';

    let reusedDetailsHTML = '';
    report.reusedMap.forEach((titles) => {
      reusedDetailsHTML += `
        <div class="audit-issue-row">
          <div style="font-size:12px;font-weight:600;color:var(--text-primary);">${titles.join(' & ')}</div>
          <span class="badge" style="color:var(--accent-red);border-color:rgba(218,54,51,0.3);">${i18n.t.audit.reusedCount} (${titles.length})</span>
        </div>
      `;
    });

    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title" style="display:flex;align-items:center;gap:8px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
          </svg>
          ${i18n.t.audit.title}
        </div>
        <button class="modal-close" id="modal-close-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="modal-body" style="max-height:70vh;overflow-y:auto;">
        <div class="audit-score-card">
          <div>
            <div style="font-size:16px;font-weight:700;margin-bottom:4px;">${i18n.t.audit.scoreTitle}</div>
            <div style="font-size:12px;color:var(--text-secondary);max-width:280px;line-height:1.4;">
              ${i18n.getLocale() === 'fr' ? 'Mesure l&#x27;entropie, la non-réutilisation des mots de passe et l&#x27;activation du 2FA.' : 'Measures entropy, password reuse, and 2FA activation rate.'}
            </div>
          </div>
          <div class="audit-score-circle" style="border-color:${scoreColor};color:${scoreColor};">
            ${report.score}<span>%</span>
          </div>
        </div>

        <div class="audit-metric-grid">
          <div class="audit-metric-box">
            <div class="audit-metric-num" style="color:${report.weak > 0 ? 'var(--accent-red)' : 'var(--accent-green)'};">${report.weak}</div>
            <div class="audit-metric-label">${i18n.t.audit.weakCount}</div>
          </div>
          <div class="audit-metric-box">
            <div class="audit-metric-num" style="color:${report.reused > 0 ? 'var(--accent-orange)' : 'var(--accent-green)'};">${report.reused}</div>
            <div class="audit-metric-label">${i18n.t.audit.reusedCount}</div>
          </div>
          <div class="audit-metric-box">
            <div class="audit-metric-num" style="color:${report.missing2fa > 0 ? 'var(--accent-blue)' : 'var(--accent-green)'};">${report.missing2fa}</div>
            <div class="audit-metric-label">${i18n.getLocale() === 'fr' ? 'Sans 2FA' : 'No 2FA'}</div>
          </div>
        </div>

        <div style="margin-bottom:16px;">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px;letter-spacing:0.5px;">
            ${i18n.getLocale() === 'fr' ? 'Vérification de Fuites (Have I Been Pwned - k-anonymity)' : 'Breach Check (Have I Been Pwned - k-anonymity)'}
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn-primary" id="btn-run-hibp" style="font-size:12px;padding:8px 16px;background-color:var(--bg-tertiary);border-color:var(--border-subtle);color:var(--text-primary);width:100%;">
              ${i18n.t.audit.hibpScanButton} (${creds.length})
            </button>
          </div>
          <div id="hibp-results" style="margin-top:10px;font-size:12px;line-height:1.5;"></div>
        </div>

        ${report.reusedMap.size > 0 ? `
          <div>
            <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px;letter-spacing:0.5px;">
              ${i18n.t.audit.reusedSectionTitle}
            </div>
            ${reusedDetailsHTML}
          </div>
        ` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn-primary" id="modal-close-audit">${i18n.t.common.close}</button>
      </div>
    `);

    box.querySelector('#modal-close-btn')?.addEventListener('click', () => this.closeModal());
    box.querySelector('#modal-close-audit')?.addEventListener('click', () => this.closeModal());

    const btnHibp = box.querySelector('#btn-run-hibp') as HTMLButtonElement;
    const hibpResults = box.querySelector('#hibp-results') as HTMLElement;

    btnHibp?.addEventListener('click', async () => {
      btnHibp.disabled = true;
      btnHibp.textContent = i18n.t.audit.scanningHibp;
      hibpResults.innerHTML = `<span style="color:var(--text-muted);">${i18n.t.audit.scanningHibp}</span>`;

      let compromisedCount = 0;
      const compromisedList: string[] = [];
      const breachesLabel = i18n.getLocale() === 'fr' ? 'fuites publiques connues' : 'known public breaches';

      for (const c of creds) {
        if (!c.password) continue;
        const pwnedHits = await checkPasswordPwnedHIBP(c.password);
        if (pwnedHits > 0) {
          compromisedCount++;
          compromisedList.push(`<strong>${c.title}</strong> (${i18n.formatNumber(pwnedHits)} ${breachesLabel})`);
        }
      }

      btnHibp.disabled = false;
      const doneLabel = i18n.getLocale() === 'fr' ? 'Analyse terminée' : 'Scan complete';
      btnHibp.textContent = `✓ ${doneLabel}`;

      if (compromisedCount > 0) {
        const warnLabel = i18n.getLocale() === 'fr'
          ? `${compromisedCount} identifiant(s) compromis détecté(s) dans des bases de fuites mondiales :`
          : `${compromisedCount} credential(s) found in global data breaches:`;
        hibpResults.innerHTML = `
          <div style="padding:10px;background:rgba(218,54,51,0.1);border:1px solid rgba(218,54,51,0.3);border-radius:var(--radius-md);color:var(--accent-red);">
            <strong>${warnLabel}</strong>
            <ul style="margin-top:6px;padding-left:18px;">
              ${compromisedList.map(item => `<li>${item}</li>`).join('')}
            </ul>
          </div>
        `;
      } else {
        const okLabel = i18n.getLocale() === 'fr'
          ? 'Aucun mot de passe compromis trouvé dans les bases publiques de fuites de données.'
          : 'No compromised passwords found in public breach databases.';
        hibpResults.innerHTML = `
          <div style="padding:10px;background:rgba(35,134,54,0.1);border:1px solid rgba(35,134,54,0.3);border-radius:var(--radius-md);color:var(--accent-green);">
            ${okLabel}
          </div>
        `;
      }
    });
  }

  /* ── Import & Export Hub ────────────────────────────────────────────────── */
  private openImportModal(): void {
    const data = vaultStore.getData();
    const creds = data.credentials.filter(c => c.vaultId === data.activeVaultId);
    const tasks = data.tasks.filter(t => t.vaultId === data.activeVaultId);

    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title">${i18n.t.importExport.title}</div>
        <button class="modal-close" id="modal-close-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="import-export-tabs">
          <button class="import-export-tab active" id="tab-btn-import">${i18n.t.importExport.importTab}</button>
          <button class="import-export-tab" id="tab-btn-export">${i18n.t.importExport.exportTab} (${creds.length})</button>
        </div>

        <!-- Section Import -->
        <div id="section-import">
          <p style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;line-height:1.5;">
            ${i18n.t.importExport.supportedFormats}
          </p>
          <div style="border:2px dashed var(--border-subtle);border-radius:var(--radius-lg);padding:28px;text-align:center;cursor:pointer;transition:border-color 0.2s;" id="drop-zone">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5" style="margin:0 auto 10px;">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            <div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;">${i18n.t.importExport.dragDropLabel}</div>
            <div style="font-size:11px;color:var(--text-muted);">JSON / CSV</div>
            <input type="file" id="import-file-input" accept=".json,.csv" style="position:absolute;opacity:0;inset:0;cursor:pointer;">
          </div>
          <div id="import-status" style="margin-top:10px;font-size:12px;color:var(--text-secondary);min-height:20px;"></div>
        </div>

        <!-- Section Export -->
        <div id="section-export" style="display:none;">
          <p style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;line-height:1.5;">
            Exportez les identifiants et tâches du coffre actif vers un fichier téléchargeable.
          </p>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <button class="btn-primary" id="btn-export-json" style="justify-content:flex-start;padding:12px 16px;gap:12px;background-color:var(--bg-tertiary);border-color:var(--border-subtle);color:var(--text-primary);">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
              <div style="text-align:left;">
                <div style="font-size:13px;font-weight:600;">Exporter en JSON BUM Standard</div>
                <div style="font-size:11px;color:var(--text-muted);">Format complet préservant passkeys, 2FA, métadonnées et tâches</div>
              </div>
            </button>
            <button class="btn-primary" id="btn-export-csv" style="justify-content:flex-start;padding:12px 16px;gap:12px;background-color:var(--bg-tertiary);border-color:var(--border-subtle);color:var(--text-primary);">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
              <div style="text-align:left;">
                <div style="font-size:13px;font-weight:600;">Exporter en CSV Universel</div>
                <div style="font-size:11px;color:var(--text-muted);">Compatible avec Bitwarden, 1Password, Excel et navigateurs</div>
              </div>
            </button>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-primary" id="modal-cancel" style="color:var(--text-muted);">${i18n.t.common.close}</button>
        <button class="btn-primary" id="modal-import-confirm" disabled>${i18n.t.importExport.importTab}</button>
      </div>
    `);

    box.querySelector('#modal-close-btn')?.addEventListener('click', () => this.closeModal());
    box.querySelector('#modal-cancel')?.addEventListener('click', () => this.closeModal());

    // Navigation entre onglets
    const tabImport = box.querySelector('#tab-btn-import') as HTMLButtonElement;
    const tabExport = box.querySelector('#tab-btn-export') as HTMLButtonElement;
    const secImport = box.querySelector('#section-import') as HTMLElement;
    const secExport = box.querySelector('#section-export') as HTMLElement;
    const confirmBtn = box.querySelector('#modal-import-confirm') as HTMLButtonElement;

    tabImport?.addEventListener('click', () => {
      tabImport.classList.add('active');
      tabExport.classList.remove('active');
      secImport.style.display = 'block';
      secExport.style.display = 'none';
      confirmBtn.style.display = 'inline-block';
    });

    tabExport?.addEventListener('click', () => {
      tabExport.classList.add('active');
      tabImport.classList.remove('active');
      secExport.style.display = 'block';
      secImport.style.display = 'none';
      confirmBtn.style.display = 'none';
    });

    // Actions Export
    box.querySelector('#btn-export-json')?.addEventListener('click', () => {
      const jsonContent = exportVaultAsJson(creds, tasks);
      const filename = `bum-vault-export-${new Date().toISOString().slice(0, 10)}.json`;
      downloadExportFile(jsonContent, filename, 'application/json');
      this.showToast(i18n.getLocale() === 'fr' ? 'Export JSON téléchargé' : 'JSON export downloaded', 'success');
    });

    box.querySelector('#btn-export-csv')?.addEventListener('click', () => {
      const csvContent = exportVaultAsCsv(creds);
      const filename = `bum-credentials-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadExportFile(csvContent, filename, 'text/csv;charset=utf-8;');
      this.showToast(i18n.getLocale() === 'fr' ? 'Export CSV téléchargé' : 'CSV export downloaded', 'success');
    });

    // Actions Import
    let parsedResult: { credentials: any[]; tasks: any[]; sourceFormat: string; count: number } = { credentials: [], tasks: [], sourceFormat: 'unknown', count: 0 };
    const statusEl = box.querySelector('#import-status') as HTMLElement;

    const handleFile = async (file: File) => {
      try {
        const text = await file.text();
        parsedResult = parseImportFile(text, file.name);
        const foundLabel = i18n.getLocale() === 'fr' ? 'identifiant(s) trouvé(s)' : 'item(s) found';
        statusEl.textContent = `${parsedResult.count} ${foundLabel} — "${file.name}" [${parsedResult.sourceFormat}]`;
        statusEl.style.color = 'var(--accent-green)';
        confirmBtn.disabled = parsedResult.count === 0;
      } catch (err) {
        const errLabel = i18n.getLocale() === 'fr' ? 'Erreur de lecture' : 'Read error';
        statusEl.textContent = `${errLabel}: ${err}`;
        statusEl.style.color = 'var(--accent-red)';
        confirmBtn.disabled = true;
      }
    };

    box.querySelector('#import-file-input')?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) handleFile(file);
    });

    const dropZone = box.querySelector('#drop-zone') as HTMLElement;
    dropZone?.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--accent-blue)'; });
    dropZone?.addEventListener('dragleave', () => { dropZone.style.borderColor = 'var(--border-subtle)'; });
    dropZone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--border-subtle)';
      const file = e.dataTransfer?.files[0];
      if (file) handleFile(file);
    });

    confirmBtn?.addEventListener('click', () => {
      vaultStore.importBulk(parsedResult.credentials, parsedResult.tasks);
      this.closeModal();
      const importedLabel = i18n.getLocale() === 'fr' ? `${parsedResult.count} identifiant(s) importé(s)` : `${parsedResult.count} item(s) imported`;
      this.showToast(importedLabel, 'success');
    });
  }

  /* ── Créer Coffre ─────────────────────────────────────────────────────── */
  private openCreateVaultModal(): void {
    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title">${i18n.t.vault.newVaultModalTitle}</div>
        <button class="modal-close" id="modal-close-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-field">
          <label class="form-label">${i18n.t.vault.vaultNameLabel} *</label>
          <input class="form-input" id="vault-name" type="text" placeholder="Personnel, Travail, Famille..." autocomplete="off">
        </div>
        <div class="form-field">
          <label class="form-label">${i18n.t.vault.vaultTypeLabel}</label>
          <select class="form-input" id="vault-type">
            <option value="personal">${i18n.t.common.personal}</option>
            <option value="work">${i18n.t.common.work}</option>
            <option value="team">${i18n.t.common.team}</option>
          </select>
        </div>
        <div class="form-field">
          <label class="form-label" style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="vault-protected">
            ${i18n.t.vault.passwordProtectLabel}
          </label>
        </div>
        <div id="vault-pwd-section" style="display:none;">
          <div class="form-field">
            <label class="form-label">${i18n.t.vault.passwordOptionalLabel}</label>
            <input class="form-input" id="vault-pwd" type="password" placeholder="Mot de passe fort..." autocomplete="new-password">
          </div>
          <div class="form-field">
            <label class="form-label">Confirmer</label>
            <input class="form-input" id="vault-pwd-confirm" type="password" placeholder="Confirmer..." autocomplete="new-password">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-primary" id="modal-cancel" style="color:var(--text-muted);">${i18n.t.common.cancel}</button>
        <button class="btn-primary" id="modal-confirm">${i18n.t.vault.createVaultButton}</button>
      </div>
    `);

    box.querySelector('#modal-close-btn')?.addEventListener('click', () => this.closeModal());
    box.querySelector('#modal-cancel')?.addEventListener('click', () => this.closeModal());

    const protectedCheck = box.querySelector('#vault-protected') as HTMLInputElement;
    const pwdSection = box.querySelector('#vault-pwd-section') as HTMLElement;
    protectedCheck?.addEventListener('change', () => {
      pwdSection.style.display = protectedCheck.checked ? 'block' : 'none';
    });

    box.querySelector('#modal-confirm')?.addEventListener('click', async () => {
      const name = (box.querySelector('#vault-name') as HTMLInputElement)?.value.trim();
      const type = (box.querySelector('#vault-type') as HTMLSelectElement)?.value;
      if (!name) { this.showToast(i18n.getLocale() === 'fr' ? 'Le nom du coffre est requis' : 'Vault name is required', 'error'); return; }

      let passwordHash: string | undefined;
      if (protectedCheck?.checked) {
        const pwd = (box.querySelector('#vault-pwd') as HTMLInputElement)?.value;
        const confirm = (box.querySelector('#vault-pwd-confirm') as HTMLInputElement)?.value;
        if (!pwd || pwd !== confirm) { this.showToast(i18n.getLocale() === 'fr' ? 'Les mots de passe ne correspondent pas' : 'Passwords do not match', 'error'); return; }
        passwordHash = await hashVaultPassword(pwd);
      }

      vaultStore.addVault(name, type as 'personal' | 'work' | 'team', passwordHash);
      this.closeModal();
      this.showToast(i18n.t.vault.vaultCreatedToast, 'success');
    });
  }

  /* ── Déverrouiller Coffre ─────────────────────────────────────────────── */
  private openUnlockVaultModal(vaultId: string): void {
    const data = vaultStore.getData();
    const vault = data.vaults.find(v => v.id === vaultId);
    if (!vault) return;

    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title">${i18n.t.vault.unlockModalTitle} "${vault.name}"</div>
        <button class="modal-close" id="modal-close-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <div style="text-align:center;padding:16px 0;">
          <div style="width:52px;height:52px;border-radius:var(--radius-xl);background-color:rgba(88,166,255,0.1);border:1px solid rgba(88,166,255,0.2);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">${i18n.t.vault.unlockModalSub}</p>
        </div>
        <div class="form-field">
          <label class="form-label">${i18n.t.vault.masterPasswordPlaceholder}</label>
          <input class="form-input" id="unlock-pwd" type="password" placeholder="${i18n.t.vault.masterPasswordPlaceholder}" autocomplete="current-password">
        </div>
        <div id="unlock-error" style="font-size:12px;color:var(--accent-red);margin-top:8px;display:none;">${i18n.t.vault.invalidPasswordToast}</div>
        <div id="bio-unlock-container" style="margin-top:14px;display:none;">
          <button class="btn-primary" id="btn-bio-unlock" style="width:100%;gap:8px;background:rgba(88,166,255,0.08);border-color:rgba(88,166,255,0.25);color:var(--accent-blue);padding:10px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m0 0a8.003 8.003 0 0115.357-2m1.51 15c-.056-.4-.117-.8-.184-1.196"></path>
            </svg>
            ${i18n.getLocale() === 'fr' ? 'Déverrouiller avec Biométrie (TouchID / Hello)' : 'Unlock with Biometrics (TouchID / Hello)'}
          </button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-primary" id="modal-cancel" style="color:var(--text-muted);">${i18n.t.common.cancel}</button>
        <button class="btn-primary" id="modal-confirm" style="background-color:var(--accent-blue);color:#fff;border-color:var(--accent-blue);">${i18n.t.vault.unlockAction}</button>
      </div>
    `);

    const pwdInput = box.querySelector('#unlock-pwd') as HTMLInputElement;
    const errorEl = box.querySelector('#unlock-error') as HTMLElement;
    const bioContainer = box.querySelector('#bio-unlock-container') as HTMLElement;
    const btnBioUnlock = box.querySelector('#btn-bio-unlock') as HTMLButtonElement;

    // Détection disponibilité WebAuthn Biométrie
    isBiometricsAvailable().then((available) => {
      if (available && bioContainer) {
        bioContainer.style.display = 'block';
      }
    });

    btnBioUnlock?.addEventListener('click', async () => {
      const verified = await verifyBiometrics();
      if (verified) {
        // En mode biométrique vérifié, le coffre s'ouvre directement
        vault.isLocked = false;
        vaultStore.subscribe(() => {})(); // Trigger store update
        this.closeModal();
        this.showToast(`${i18n.t.vault.vaultUnlockedToast} ("${vault.name}")`, 'success');
      } else {
        errorEl.textContent = i18n.getLocale() === 'fr' ? 'Échec d&#x27;authentification biométrique.' : 'Biometric authentication failed.';
        errorEl.style.display = 'block';
      }
    });

    box.querySelector('#modal-close-btn')?.addEventListener('click', () => this.closeModal());
    box.querySelector('#modal-cancel')?.addEventListener('click', () => this.closeModal());

    pwdInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') (box.querySelector('#modal-confirm') as HTMLButtonElement)?.click();
    });

    box.querySelector('#modal-confirm')?.addEventListener('click', async () => {
      const pwd = pwdInput?.value;
      if (!pwd) { this.showToast(i18n.getLocale() === 'fr' ? 'Entrez le mot de passe' : 'Enter the password', 'error'); return; }
      const success = await vaultStore.unlockVault(vaultId, await hashVaultPassword(pwd));
      if (success) {
        this.closeModal();
        this.showToast(`${i18n.t.vault.vaultUnlockedToast} ("${vault.name}")`, 'success');
      } else {
        errorEl.style.display = 'block';
        pwdInput.value = '';
        pwdInput.focus();
      }
    });

    setTimeout(() => pwdInput?.focus(), 100);
  }

  /* ── Raccourcis Clavier (Palette Cheat Sheet) ─────────────────────────── */
  private openShortcutsModal(): void {
    const isFr = i18n.getLocale() === 'fr';
    const shortcuts = [
      { key: 'Cmd / Ctrl + K', label: isFr ? 'Recherche globale & filtre instantané' : 'Global search & instant filter' },
      { key: 'Cmd / Ctrl + N', label: isFr ? 'Créer un élément (Identifiant ou Tâche)' : 'Create new item (Credential or Task)' },
      { key: 'Cmd / Ctrl + G', label: isFr ? 'Générateur de mots de passe & passphrases' : 'Password & passphrase generator' },
      { key: 'Cmd / Ctrl + L', label: isFr ? 'Verrouiller immédiatement le coffre actif' : 'Immediately lock the active vault' },
      { key: '?', label: isFr ? 'Afficher cette liste de raccourcis' : 'Show keyboard shortcuts cheat sheet' },
      { key: 'Esc', label: isFr ? 'Fermer la fenêtre modale active' : 'Close active modal window' }
    ];

    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title" style="display:flex;align-items:center;gap:8px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect>
            <path d="M6 8h.001M10 8h.001M14 8h.001M18 8h.001M6 12h.001M10 12h.001M14 12h.001M18 12h.001M8 16h8"></path>
          </svg>
          ${isFr ? 'Raccourcis Clavier' : 'Keyboard Shortcuts'}
        </div>
        <button class="modal-close" id="modal-close-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${shortcuts.map(s => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg-tertiary);border:1px solid var(--border-subtle);border-radius:var(--radius-md);">
              <span style="font-size:13px;color:var(--text-primary);">${s.label}</span>
              <kbd style="font-family:var(--font-mono);font-size:11px;font-weight:600;padding:3px 8px;background:var(--bg-primary);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);color:var(--accent-blue);box-shadow:0 1px 2px rgba(0,0,0,0.2);">${s.key}</kbd>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-primary" id="modal-cancel">${i18n.t.common.close}</button>
      </div>
    `);

    box.querySelector('#modal-close-btn')?.addEventListener('click', () => this.closeModal());
    box.querySelector('#modal-cancel')?.addEventListener('click', () => this.closeModal());
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   BOOTSTRAP
   ════════════════════════════════════════════════════════════════════════════ */
const app = new AppController();

// Refresh TOTP global toutes les secondes
setInterval(() => {
  if (app.totpInterval === null) {
    // TOTP géré par updateLiveTOTP
  }
}, 1000);

// Enregistrement PWA Service Worker
if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Ignorer si non servi sous HTTP/HTTPS (ex: tauri:// ou file://)
    });
  });
}

