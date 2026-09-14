import { TAG_COLORS, vaultStore } from './store/vaultStore';
import { Task } from './types/vault';
import { getServiceIconSvg } from './icons/serviceIcons';
import { generateTOTP } from './crypto/totpEngine';
import { calculatePasswordEntropy, generateStrongPassword, generatePassphrase, auditVaultSecurity, checkPasswordPwnedHIBP, HibpUnavailableError, PASSPHRASE_WORDLIST } from './crypto/vaultCrypto';
import { exportVaultAsJson, exportVaultAsCsv, downloadExportFile } from './import_export/importEngine';
import { parseImportData, PasswordRequiredError, ImportSecrets } from './import_export/importRouter';
import { encryptExport, MIN_EXPORT_PASSWORD_LENGTH } from './import_export/encryptedExport';
import { buildKdbx4 } from './import_export/keepass';
import { exportCredentialsAsCxf } from './import_export/cxf';
import { normalizeTotpInput, parseOtpAuthUri } from './crypto/otpauthUri';
import { CameraQrScanner, decodeQrFromFile } from './crypto/qrScanner';
import { AccountService, type SyncStatus } from './account/accountService';
import type { UnlockedVaultData } from './types/vault';
import {
  EisenhowerQuadrant,
  describeRecurrence,
  getDependents,
  getDueReminders,
  getEisenhowerQuadrant,
  getOpenBlockers,
  planTaskCompletion,
  wouldCreateDependencyCycle
} from './tasks/taskEngine';
import type { RecurrenceFrequency, TaskRecurrence } from './types/vault';
import { accountErrorMessage, DEFAULT_SERVER_URL, mountAuthScreen } from './ui/authScreen';
import { mountTagInput } from './ui/tagInput';
import { i18n } from './i18n';

type ActiveView = 'all-credentials' | '2fa-tokens' | 'tasks';
type TaskViewMode = 'list' | 'kanban' | 'matrix' | 'calendar';

const ACTION_ICONS = {
  edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>',
  task: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>'
};

function tagColor(color?: string): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#8b949e';
}

const GEN_ICONS = {
  bolt: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>',
  close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
  copy: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
  refresh: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>',
  eye: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
  eyeOff: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"></path><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>'
};

const GENERATOR_PREFS_KEY = 'bettervault.generator-prefs';
const REMINDER_CHECK_INTERVAL_MS = 30_000;
const SYNC_INTERVAL_MS = 60_000;

const accountService = new AccountService();

/* ════════════════════════════════════════════════════════════════════════════
   APP CONTROLLER — Zero-Knowledge Vault Manager
   ════════════════════════════════════════════════════════════════════════════ */
class AppController {
  private activeView: ActiveView = 'all-credentials';
  private selectedItemId: string | null = null;
  private searchQuery = '';
  private taskViewMode: TaskViewMode = 'list';
  public totpInterval: number | null = null;
  private autoLockTimeout: number | null = null;
  private readonly AUTO_LOCK_DELAY_MS = 5 * 60 * 1000; // 5 minutes d'inactivité
  private clipboardClearTimer: number | null = null;
  private activeTag: string | null = null;
  private authScreen: { show(): void } | null = null;

  constructor() {
    this.initTheme();
    this.initReminders();
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
    this.initAccount();
  }

  private tr(fr: string, en: string): string {
    return i18n.getLocale() === 'fr' ? fr : en;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ── Rappels de tâches (toast + notification système) ─────────────────── */
  private initReminders(): void {
    const check = () => {
      if (!vaultStore.isLoaded()) return;
      const due = getDueReminders(vaultStore.getData().tasks);
      for (const task of due) {
        vaultStore.updateTask(task.id, { reminderSent: true });
        const label = this.tr('Rappel de tâche', 'Task reminder');
        this.showToast(`${label} : ${task.title}`, 'info', 6000);
        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification(`BetterVault — ${label}`, { body: task.title, tag: task.id });
          } catch {
            // Notifications système indisponibles (contexte non sécurisé, webview restreinte)
          }
        }
      }
    };
    check();
    window.setInterval(check, REMINDER_CHECK_INTERVAL_MS);
  }

  private requestNotificationPermission(): void {
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }

  private toDateTimeInputValue(timestamp?: number): string {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /* ── Theme Toggle (Dark / Light) ──────────────────────────────────────── */
  private initTheme(): void {
    const saved = localStorage.getItem('bettervault.theme');
    if (saved === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    }
    this.updateThemeIcons();

    document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'light' ? 'dark' : 'light';
      if (next === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
      localStorage.setItem('bettervault.theme', next);
      // Update meta theme-color
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', next === 'light' ? '#f6f8fa' : '#161b22');
      this.updateThemeIcons();
      this.showToast(next === 'light' ? 'Light mode' : 'Dark mode', 'info', 1500);
    });
  }

  private updateThemeIcons(): void {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const moon = document.getElementById('theme-icon-moon');
    const sun = document.getElementById('theme-icon-sun');
    if (moon) moon.style.display = isLight ? 'none' : 'block';
    if (sun) sun.style.display = isLight ? 'block' : 'none';
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

  /* ── Clipboard Auto-Clear (Zero-Knowledge Hygiene) ────────────────────── */
  public async copyToClipboardWithAutoClear(text: string, label: string, isSensitive = false): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      if (isSensitive) {
        if (this.clipboardClearTimer) window.clearTimeout(this.clipboardClearTimer);
        const clearNotice = i18n.getLocale() === 'fr' ? `${label} (effacé dans 30s)` : `${label} (cleared in 30s)`;
        this.showToast(clearNotice, 'success');

        this.clipboardClearTimer = window.setTimeout(async () => {
          try {
            const currentClip = await navigator.clipboard.readText().catch(() => '');
            if (currentClip === text) {
              await navigator.clipboard.writeText('');
              this.showToast(i18n.getLocale() === 'fr' ? 'Presse-papiers vidé par sécurité' : 'Clipboard cleared for security', 'info', 2000);
            }
          } catch {
            // Ignorer si permission non accordée
          }
        }, 30000);
      } else {
        this.showToast(label, 'success');
      }
    } catch (err) {
      this.showToast('Erreur copie presse-papiers', 'error');
    }
  }

  /* ── Auto-Lock Timer (Zero-Knowledge Inactivity Protection) ────────────── */
  private initAutoLock(): void {
    const resetTimer = () => {
      if (this.autoLockTimeout) {
        window.clearTimeout(this.autoLockTimeout);
      }
      this.autoLockTimeout = window.setTimeout(() => {
        if (!accountService.isUnlocked()) return;
        this.lockApp();
        this.showToast(this.tr('Verrouillé après 5 minutes d’inactivité', 'Locked after 5 minutes of inactivity'), 'info', 4000);
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
      if (!accountService.isUnlocked()) return;
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
        this.lockApp();
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

      // Touche 'Escape' : Fermer la modale ouverte
      if (e.key === 'Escape') {
        const overlay = document.getElementById('modal-overlay');
        if (overlay) {
          e.preventDefault();
          this.closeModal();
          return;
        }
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

    document.getElementById('btn-open-sync')?.addEventListener('click', () => {
      this.openAccountModal();
    });

    document.getElementById('btn-open-shortcuts')?.addEventListener('click', () => {
      this.openShortcutsModal();
    });

    document.getElementById('btn-add-vault')?.addEventListener('click', () => {
      this.openVaultModal();
    });

    document.getElementById('btn-manage-tags')?.addEventListener('click', () => {
      this.openTagManagerModal();
    });

    // Exports enregistrés nativement par l'application de bureau
    window.addEventListener('bettervault:file-saved', e => {
      this.showToast(`${this.tr('Enregistré dans', 'Saved to')} ${(e as CustomEvent<string>).detail}`, 'success', 6000);
    });
    window.addEventListener('bettervault:file-save-error', e => {
      this.showToast(`${this.tr('Enregistrement impossible', 'Could not save file')} : ${(e as CustomEvent<string>).detail}`, 'error', 6000);
    });

    const viewButtons: Array<[string, TaskViewMode]> = [
      ['btn-view-list', 'list'],
      ['btn-view-kanban', 'kanban'],
      ['btn-view-matrix', 'matrix'],
      ['btn-view-calendar', 'calendar']
    ];
    viewButtons.forEach(([buttonId, mode]) => {
      document.getElementById(buttonId)?.addEventListener('click', () => {
        this.taskViewMode = mode;
        viewButtons.forEach(([id]) => document.getElementById(id)?.classList.toggle('active', id === buttonId));
        this.renderList();
      });
    });
  }

  /* ── Counts (sidebar badges) ───────────────────────────────────────────── */
  private renderCounts(): void {
    const data = vaultStore.getData();
    const credCountEl = document.getElementById('count-credentials');
    const totpCountEl = document.getElementById('count-2fa');
    const taskCountEl = document.getElementById('count-tasks');

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

    const typeLabels: Record<string, string> = {
      personal: i18n.t.common.personal,
      work: i18n.t.common.work,
      team: i18n.t.common.team
    };

    vaultListEl.innerHTML = '';
    data.vaults.forEach(vault => {
      const li = document.createElement('li');
      li.className = `nav-item ${vault.id === data.activeVaultId ? 'active' : ''}`;
      li.tabIndex = 0;
      li.innerHTML = `
        <span class="nav-item-left">
          <span class="nav-item-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
          </span>
          <span>${this.escapeHtml(vault.name)}</span>
        </span>
        <span class="nav-item-right">
          <span class="vault-type-badge ${vault.type}">${typeLabels[vault.type] ?? vault.type}</span>
          <button class="icon-btn nav-item-edit" type="button" title="${this.tr('Modifier le coffre', 'Edit vault')}" aria-label="${this.tr('Modifier le coffre', 'Edit vault')} ${this.escapeHtml(vault.name)}">${ACTION_ICONS.edit}</button>
        </span>
      `;

      li.querySelector('.nav-item-edit')?.addEventListener('click', e => {
        e.stopPropagation();
        this.openVaultModal(vault.id);
      });
      const select = () => {
        if (vault.id === vaultStore.getData().activeVaultId) return;
        this.selectedItemId = null;
        vaultStore.setActiveVault(vault.id);
        this.renderDetail(null);
      };
      li.addEventListener('click', select);
      li.addEventListener('keydown', e => {
        if (e.target === li && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          select();
        }
      });
      vaultListEl.appendChild(li);
    });

    this.renderTagSidebar();
  }

  /* ── List Panel ─────────────────────────────────────────────────────────── */
  private renderList(): void {
    const data = vaultStore.getData();
    const container = document.getElementById('items-container');
    const listTitle = document.getElementById('list-view-title');
    if (!container) return;

    container.innerHTML = '';

    // La colonne centrale s'élargit pour les vues tâches en tableau ; la navigation reflète la vue active
    document.getElementById('app')?.classList.toggle('tasks-board', this.activeView === 'tasks' && this.taskViewMode !== 'list');
    document.querySelectorAll<HTMLElement>('[data-view]').forEach(item => item.classList.toggle('active', item.dataset.view === this.activeView));

    const tagKey = this.activeTag?.toLowerCase();
    const matchesTag = (item: { tags: string[] }) => !tagKey || item.tags.some(t => t.toLowerCase() === tagKey);
    const withTag = (title: string) => (this.activeTag ? `${title} · ${this.activeTag}` : title);

    const taskToggle = document.getElementById('task-view-toggle');
    if (taskToggle) {
      taskToggle.style.display = this.activeView === 'tasks' ? 'flex' : 'none';
    }

    if (this.activeView === 'tasks') {
      if (listTitle) listTitle.textContent = withTag(i18n.t.tasks.title);
      let tasks = data.tasks.filter(t => t.vaultId === data.activeVaultId && matchesTag(t));

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
              <div class="kanban-card-title" title="${this.escapeHtml(task.title)}">${this.escapeHtml(task.title)}</div>
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

      // Mode Matrice d'Eisenhower
      if (this.taskViewMode === 'matrix') {
        const quadrants: Array<{ key: EisenhowerQuadrant; title: string; sub: string; color: string }> = [
          { key: 'do', title: this.tr('Faire maintenant', 'Do now'), sub: this.tr('Urgent et important', 'Urgent & important'), color: 'var(--accent-red)' },
          { key: 'plan', title: this.tr('Planifier', 'Schedule'), sub: this.tr('Important, non urgent', 'Important, not urgent'), color: 'var(--accent-blue)' },
          { key: 'delegate', title: this.tr('Déléguer', 'Delegate'), sub: this.tr('Urgent, peu important', 'Urgent, less important'), color: 'var(--accent-orange)' },
          { key: 'eliminate', title: this.tr('Plus tard', 'Later'), sub: this.tr('Ni urgent ni important', 'Neither urgent nor important'), color: 'var(--text-muted)' }
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
            body.innerHTML = `<div class="eisenhower-empty">${this.tr('Aucune tâche', 'No tasks')}</div>`;
          }
          quadrantTasks.forEach(task => {
            const card = document.createElement('div');
            card.className = `kanban-card ${this.selectedItemId === task.id ? 'selected' : ''}`;
            card.innerHTML = `
              <div class="kanban-card-title" title="${this.escapeHtml(task.title)}">${this.escapeHtml(task.title)}</div>
              <div class="kanban-card-meta">
                <span class="badge priority-${task.priority}">${task.priority.toUpperCase()}</span>
                ${task.status === 'blocked' ? `<span class="badge" style="color:var(--accent-red);">${this.tr('BLOQUÉE', 'BLOCKED')}</span>` : ''}
                <span>${task.dueDate ? i18n.formatRelativeDate(task.dueDate) : ''}</span>
              </div>
            `;
            card.addEventListener('click', () => {
              this.selectedItemId = task.id;
              this.renderList();
              this.renderDetail(task.id);
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
            <div class="record-title" title="${this.escapeHtml(task.title)}" style="${isDone ? 'text-decoration:line-through;opacity:0.5;' : ''}">${this.escapeHtml(task.title)}</div>
            <div class="record-sub">${task.dueDate ? i18n.formatRelativeDate(task.dueDate) : statusSub}</div>
          </div>
          <div class="record-badges">
            ${task.status === 'blocked' ? `<span class="badge" style="color:var(--accent-red);border-color:rgba(218,54,51,0.4);" title="${this.tr('Bloquée par des dépendances', 'Blocked by dependencies')}">${this.tr('BLOQ', 'BLK')}</span>` : ''}
            ${task.recurrence ? `<span class="badge" style="color:var(--accent-purple);" title="${describeRecurrence(task.recurrence, i18n.getLocale() === 'fr' ? 'fr' : 'en')}">${this.tr('RÉC', 'REC')}</span>` : ''}
            ${task.reminderAt && !task.reminderSent && task.status !== 'completed' ? `<span class="badge" style="color:var(--accent-orange);" title="${new Date(task.reminderAt).toLocaleString()}">${this.tr('RAP', 'REM')}</span>` : ''}
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
    if (listTitle) listTitle.textContent = withTag(this.activeView === '2fa-tokens' ? i18n.t.nav.twoFactorTokens : i18n.t.credentials.title);

    let creds = data.credentials.filter(c => c.vaultId === data.activeVaultId && matchesTag(c));
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
          ${cred.expiresAt && cred.expiresAt < Date.now() ? '<span class="badge" style="color:var(--accent-red);border-color:rgba(218,54,51,0.4);">EXP</span>' : ''}
          ${cred.expiresAt && cred.expiresAt >= Date.now() && cred.expiresAt - Date.now() <= 14 * 86400000 ? '<span class="badge" style="color:var(--accent-orange);border-color:rgba(210,153,34,0.4);">EXP</span>' : ''}
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
            <span style="font-size:13px;font-weight:500;${t.status === 'completed' ? 'text-decoration:line-through;opacity:0.5;' : ''}">${this.escapeHtml(t.title)}</span>
          </div>
          <span style="font-size:11px;color:${statusColors[t.status]};">${statusLabels[t.status]}</span>
        </div>`;

      const planningHTML = `
        ${task.recurrence ? `
          <div class="field-group">
            <div class="field-label">${this.tr('Récurrence', 'Recurrence')}</div>
            <div class="field-box"><span class="field-val">${describeRecurrence(task.recurrence, locale)}</span></div>
          </div>` : ''}
        ${task.reminderAt ? `
          <div class="field-group">
            <div class="field-label">${this.tr('Rappel', 'Reminder')}</div>
            <div class="field-box">
              <span class="field-val">${new Date(task.reminderAt).toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-US')}</span>
              ${task.reminderSent ? `<span class="badge">${this.tr('ENVOYÉ', 'SENT')}</span>` : ''}
            </div>
          </div>` : ''}
        ${dependencyTasks.length ? `
          <div class="field-group">
            <div class="section-divider" style="margin-bottom:8px;">${this.tr('Dépend de', 'Depends on')} (${dependencyTasks.length - blockers.length}/${dependencyTasks.length})</div>
            ${blockers.length ? `
              <div style="padding:8px 12px;margin-bottom:8px;background:rgba(218,54,51,0.1);border:1px solid rgba(218,54,51,0.3);border-radius:var(--radius-md);color:var(--accent-red);font-size:12px;">
                ${this.tr(`${blockers.length} prérequis à terminer avant de clore cette tâche.`, `${blockers.length} prerequisite(s) must be completed first.`)}
              </div>` : ''}
            ${dependencyTasks.map(taskLinkRow).join('')}
          </div>` : ''}
        ${dependents.length ? `
          <div class="field-group">
            <div class="section-divider" style="margin-bottom:8px;">${this.tr('Bloque', 'Blocks')} (${dependents.length})</div>
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
              <div class="detail-title">${this.escapeHtml(task.title)}</div>
              <div class="detail-meta">${this.tr('Créée le', 'Created')} ${new Date(task.createdAt).toLocaleDateString(i18n.getLocale() === 'fr' ? 'fr-FR' : 'en-US')}</div>
              ${this.renderTagChips(task.tags)}
            </div>
          </div>
          <div class="detail-actions">
            <button class="btn-primary ${task.status === 'completed' ? '' : 'btn-accent'}" id="btn-toggle-task-status">
              ${task.status === 'completed' ? this.tr('Rouvrir', 'Reopen') : this.tr('Terminer', 'Complete')}
            </button>
            ${this.renderActionMenu([
              { id: 'btn-edit-task', label: this.tr('Modifier', 'Edit'), icon: ACTION_ICONS.edit },
              'separator',
              { id: 'btn-delete-task', label: this.tr('Supprimer', 'Delete'), icon: ACTION_ICONS.trash, danger: true }
            ])}
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

          ${planningHTML}

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

      this.bindActionMenus(container);

      document.getElementById('btn-detail-back')?.addEventListener('click', () => {
        document.getElementById('detail-container')?.classList.remove('mobile-active');
      });

      document.getElementById('btn-toggle-task-status')?.addEventListener('click', () => {
        if (task.status === 'completed') {
          const reopenedStatus = getOpenBlockers(task, vaultStore.getData().tasks).length > 0 ? 'blocked' : 'todo';
          vaultStore.updateTask(task.id, { status: reopenedStatus, completedAt: undefined });
          this.showToast(this.tr('Tâche rouverte', 'Task reopened'), 'success');
          return;
        }

        const plan = planTaskCompletion(task, vaultStore.getData().tasks);
        if (plan.blockers.length > 0) {
          const names = plan.blockers.map(b => `"${b.title}"`).join(', ');
          this.showToast(`${this.tr('Terminez d’abord', 'Complete first')} : ${names}`, 'error', 5000);
          return;
        }

        vaultStore.updateTask(task.id, plan.updates);
        plan.unblockedIds.forEach(unblockedId => vaultStore.updateTask(unblockedId, { status: 'todo' }));
        if (plan.nextOccurrence) {
          vaultStore.addTask(plan.nextOccurrence);
          this.showToast(`${this.tr('Tâche terminée — prochaine occurrence le', 'Task completed — next occurrence on')} ${plan.nextOccurrence.dueDate}`, 'success', 4000);
        } else {
          this.showToast(this.tr('Tâche terminée', 'Task completed'), 'success');
        }
      });

      document.querySelectorAll('.dep-task-row').forEach(el => {
        el.addEventListener('click', () => {
          const targetId = (el as HTMLElement).dataset.taskId;
          if (!targetId) return;
          this.selectedItemId = targetId;
          this.renderList();
          this.renderDetail(targetId);
        });
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

      document.getElementById('btn-delete-task')?.addEventListener('click', async () => {
        const confirmed = await this.confirmDialog({
          title: this.tr('Supprimer la tâche ?', 'Delete task?'),
          message: this.tr(`« ${task.title} » sera définitivement supprimée.`, `"${task.title}" will be permanently deleted.`),
          confirmLabel: this.tr('Supprimer', 'Delete'),
          danger: true
        });
        if (confirmed) {
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
        <div class="field-label">Passkeys FIDO2 / WebAuthn (${cred.passkeys.length})</div>
        ${cred.passkeys.map(pk => `
          <div class="field-box" style="margin-bottom:6px;">
            <div style="display:flex;align-items:center;gap:8px;min-width:0;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="2">
                <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5z"></path>
              </svg>
              <span class="field-val">${this.escapeHtml(pk.rpId)} &middot; ${this.escapeHtml(pk.userName || '—')}</span>
            </div>
            <span style="display:flex;gap:4px;">
              ${pk.privateKey ? `<span class="badge" style="color:var(--accent-green);" title="${this.tr('Clé privée présente : exportable (CXF / KeePass)', 'Private key present: exportable (CXF / KeePass)')}">${this.tr('CLÉ', 'KEY')}</span>` : ''}
              <span class="badge" style="color:var(--accent-blue);">FIDO2</span>
            </span>
          </div>`).join('')}
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

    // Calcul de l'état d'expiration
    let expiryAlertHTML = '';
    if (cred.expiresAt) {
      const now = Date.now();
      const diffDays = Math.ceil((cred.expiresAt - now) / (1000 * 60 * 60 * 24));
      const formattedDate = new Date(cred.expiresAt).toLocaleDateString(i18n.getLocale() === 'fr' ? 'fr-FR' : 'en-US');
      if (diffDays < 0) {
        expiryAlertHTML = `
          <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(218,54,51,0.12);border:1px solid rgba(218,54,51,0.3);border-radius:var(--radius-md);color:var(--accent-red);font-size:12px;margin-bottom:12px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <span>${i18n.getLocale() === 'fr' ? `Mot de passe expiré le ${formattedDate}. Renouvellement urgent conseillé.` : `Password expired on ${formattedDate}. Renewal recommended.`}</span>
          </div>
        `;
      } else if (diffDays <= 14) {
        expiryAlertHTML = `
          <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(210,153,34,0.12);border:1px solid rgba(210,153,34,0.3);border-radius:var(--radius-md);color:var(--accent-orange);font-size:12px;margin-bottom:12px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <span>${i18n.getLocale() === 'fr' ? `Expire dans ${diffDays} jour(s) (${formattedDate}).` : `Expires in ${diffDays} day(s) (${formattedDate}).`}</span>
          </div>
        `;
      } else {
        expiryAlertHTML = `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 12px;background:var(--bg-tertiary);border:1px solid var(--border-subtle);border-radius:var(--radius-md);color:var(--text-secondary);font-size:11px;margin-bottom:12px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>
            <span>${i18n.getLocale() === 'fr' ? `Renouvellement prévu le ${formattedDate}` : `Renewal scheduled on ${formattedDate}`}</span>
          </div>
        `;
      }
    }

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
            ${this.renderTagChips(cred.tags)}
          </div>
        </div>
        <div class="detail-actions">
          <button class="icon-btn" id="btn-toggle-fav" title="${favTitle}" aria-pressed="${!!cred.isFavorite}"
            style="color:${favColor};border:1px solid var(--border-subtle);padding:6px;border-radius:var(--radius-md);">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="${favFill}" stroke="currentColor" stroke-width="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
          </button>
          <button class="btn-primary" id="btn-edit-cred">${ACTION_ICONS.edit}<span>${this.tr('Modifier', 'Edit')}</span></button>
          ${this.renderActionMenu([
            { id: 'btn-add-task-for-cred', label: this.tr('Créer une tâche liée', 'Create linked task'), icon: ACTION_ICONS.task },
            'separator',
            { id: 'btn-delete-cred', label: this.tr('Supprimer', 'Delete'), icon: ACTION_ICONS.trash, danger: true }
          ])}
        </div>
      </div>

      <div class="detail-content">
        ${expiryAlertHTML}
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
          <button class="btn-primary btn-ghost" id="btn-show-cf-form" style="align-self:flex-start;margin-top:4px;">+ ${this.tr('Ajouter un champ', 'Add a field')}</button>
          <div id="cf-form" hidden>
            <div class="form-row" style="margin-top:8px;">
              <input class="form-input" id="input-cf-label" placeholder="${this.tr('Libellé (ex : PIN, question secrète)', 'Label (e.g. PIN, security question)')}">
              <input class="form-input" id="input-cf-val" placeholder="${this.tr('Valeur', 'Value')}">
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;flex-wrap:wrap;">
              <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);cursor:pointer;">
                <input type="checkbox" id="input-cf-masked"> ${this.tr('Masquer la valeur', 'Hide value')}
              </label>
              <div style="display:flex;gap:6px;">
                <button class="btn-primary btn-ghost" id="btn-cancel-cf">${this.tr('Annuler', 'Cancel')}</button>
                <button class="btn-primary btn-accent" id="btn-add-cf">${this.tr('Ajouter', 'Add')}</button>
              </div>
            </div>
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
    this.bindActionMenus(container);
    this.updateLiveTOTP();

    document.getElementById('btn-copy-username')?.addEventListener('click', async (e) => {
      if (cred.username) {
        await this.copyToClipboardWithAutoClear(cred.username, i18n.getLocale() === 'fr' ? 'Identifiant copié' : 'Username copied', false);
        (e.currentTarget as HTMLElement).classList.add('copied');
        setTimeout(() => (e.currentTarget as HTMLElement).classList.remove('copied'), 500);
      }
    });

    document.getElementById('btn-copy-url')?.addEventListener('click', async () => {
      if (cred.website) {
        await this.copyToClipboardWithAutoClear(cred.website, i18n.getLocale() === 'fr' ? 'URL copiée' : 'URL copied', false);
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
      await this.copyToClipboardWithAutoClear(cred.password, i18n.getLocale() === 'fr' ? 'Mot de passe copié' : 'Password copied', true);
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
          await this.copyToClipboardWithAutoClear(res.token, label, true);
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

    document.getElementById('btn-delete-cred')?.addEventListener('click', async () => {
      const confirmed = await this.confirmDialog({
        title: this.tr('Supprimer l’identifiant ?', 'Delete credential?'),
        message: this.tr(
          `« ${cred.title} », son historique et ses passkeys seront définitivement supprimés. Les tâches liées sont conservées.`,
          `"${cred.title}", its history and passkeys will be permanently deleted. Linked tasks are kept.`
        ),
        confirmLabel: this.tr('Supprimer', 'Delete'),
        danger: true
      });
      if (confirmed) {
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
        this.renderDetail(cred.id);
        this.showToast('Champ personnalisé ajouté', 'success');
      } else {
        this.showToast(this.tr('Le libellé et la valeur sont requis', 'Label and value are required'), 'error');
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

  private modalReturnFocus: HTMLElement | null = null;

  /**
   * Ouvre une modale avec le comportement commun à toutes :
   * clic sur le fond, croix / [data-close], Entrée → action [data-primary], focus piégé et restauré.
   */
  private openModal(htmlContent: string): HTMLElement {
    const container = document.getElementById('modal-container');
    if (!container) return document.createElement('div');
    if (!container.firstElementChild) this.modalReturnFocus = document.activeElement as HTMLElement | null;

    container.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-box" role="dialog" aria-modal="true">
          ${htmlContent}
        </div>
      </div>
    `;
    const overlay = container.querySelector('#modal-overlay') as HTMLElement;
    const box = overlay.querySelector('.modal-box') as HTMLElement;

    const title = box.querySelector('.modal-title');
    if (title) {
      title.id = 'modal-title';
      box.setAttribute('aria-labelledby', 'modal-title');
    }

    // Le clic doit commencer ET finir sur le fond : une sélection de texte relâchée hors de la boîte ne ferme rien
    let pressedOnBackdrop = false;
    overlay.addEventListener('mousedown', e => { pressedOnBackdrop = e.target === overlay; });
    overlay.addEventListener('click', e => {
      if (pressedOnBackdrop && e.target === overlay) this.closeModal();
      pressedOnBackdrop = false;
    });

    box.querySelectorAll<HTMLElement>('.modal-close, [data-close]').forEach(button => {
      if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', this.tr('Fermer', 'Close'));
      button.addEventListener('click', () => this.closeModal());
    });

    box.addEventListener('keydown', e => {
      const target = e.target as HTMLElement;
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && target instanceof HTMLInputElement
        && !['checkbox', 'radio', 'file', 'range', 'button', 'submit'].includes(target.type)) {
        const primary = box.querySelector<HTMLButtonElement>('[data-primary]:not(:disabled), .modal-footer #modal-confirm:not(:disabled)');
        if (primary) {
          e.preventDefault();
          primary.click();
        }
      }
      if (e.key === 'Tab') {
        const focusable = Array.from(box.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        )).filter(el => el.offsetParent !== null);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    // setTimeout plutôt que requestAnimationFrame : ce dernier est suspendu dans un onglet/panneau masqué
    window.setTimeout(() => {
      if (!box.isConnected || box.contains(document.activeElement)) return;
      const target = box.querySelector<HTMLElement>('[data-autofocus]')
        ?? box.querySelector<HTMLElement>('.modal-body input:not([type="hidden"]):not([type="range"]):not([type="checkbox"]):not([type="file"]):not([disabled]), .modal-body textarea, .modal-body select')
        ?? box.querySelector<HTMLElement>('.modal-footer button:last-of-type');
      target?.focus({ preventScroll: true });
    });

    return box;
  }

  private closeModal(): void {
    const container = document.getElementById('modal-container');
    if (!container?.firstElementChild) return;
    container.innerHTML = '';
    const returnTarget = this.modalReturnFocus;
    this.modalReturnFocus = null;
    if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
  }

  /** Boîte de confirmation stylée, empilée au-dessus d'une éventuelle modale ouverte */
  private confirmDialog(options: { title: string; message: string; confirmLabel: string; danger?: boolean }): Promise<boolean> {
    return new Promise(resolve => {
      const layer = document.createElement('div');
      layer.className = 'modal-overlay dialog-layer';
      layer.innerHTML = `
        <div class="modal-box modal-sm" role="alertdialog" aria-modal="true">
          <div class="modal-header"><div class="modal-title"></div></div>
          <div class="modal-body"><p class="modal-text"></p></div>
          <div class="modal-footer">
            <button class="btn-primary btn-ghost" data-answer="no">${this.tr('Annuler', 'Cancel')}</button>
            <button class="btn-primary ${options.danger ? 'btn-danger' : 'btn-accent'}" data-answer="yes"></button>
          </div>
        </div>`;
      (layer.querySelector('.modal-title') as HTMLElement).textContent = options.title;
      (layer.querySelector('.modal-text') as HTMLElement).textContent = options.message;
      const confirmButton = layer.querySelector('[data-answer="yes"]') as HTMLButtonElement;
      confirmButton.textContent = options.confirmLabel;

      const finish = (answer: boolean) => {
        document.removeEventListener('keydown', onKey, true);
        layer.remove();
        resolve(answer);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          // Capture : n'atteint pas le raccourci global qui fermerait la modale sous-jacente
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        }
      };
      layer.addEventListener('click', e => {
        const target = e.target as HTMLElement;
        if (target === layer) return finish(false);
        const answer = target.closest<HTMLElement>('[data-answer]')?.dataset.answer;
        if (answer) finish(answer === 'yes');
      });

      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(layer);
      confirmButton.focus();
    });
  }

  /** Menu « … » regroupant les actions secondaires d'une fiche */
  private renderActionMenu(items: Array<{ id: string; label: string; icon: string; danger?: boolean } | 'separator'>): string {
    return `
      <div class="action-menu">
        <button class="icon-btn action-menu-trigger" aria-haspopup="menu" aria-expanded="false" title="${this.tr('Plus d’actions', 'More actions')}"
          style="border:1px solid var(--border-subtle);padding:6px;border-radius:var(--radius-md);">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="19" cy="12" r="1.8"></circle></svg>
        </button>
        <div class="action-menu-list" role="menu" hidden>
          ${items.map(item => item === 'separator'
            ? '<div class="action-menu-separator"></div>'
            : `<button class="action-menu-item ${item.danger ? 'danger' : ''}" role="menuitem" id="${item.id}">${item.icon}<span>${item.label}</span></button>`
          ).join('')}
        </div>
      </div>`;
  }

  private bindActionMenus(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>('.action-menu').forEach(menu => {
      const trigger = menu.querySelector('.action-menu-trigger') as HTMLButtonElement;
      const list = menu.querySelector('.action-menu-list') as HTMLElement;

      const close = () => {
        list.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onDocumentClick, true);
      };
      const onDocumentClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (trigger.contains(target)) return;
        if (!menu.contains(target) || target.closest('.action-menu-item')) close();
      };

      trigger.addEventListener('click', () => {
        if (!list.hidden) return close();
        list.hidden = false;
        // Retourne le menu s'il déborderait du panneau (actions passées à la ligne)
        list.style.left = '';
        list.style.right = '';
        const bounds = (menu.closest('.detail-pane') ?? document.body).getBoundingClientRect();
        if (list.getBoundingClientRect().left < bounds.left + 8) {
          list.style.left = '0';
          list.style.right = 'auto';
        }
        trigger.setAttribute('aria-expanded', 'true');
        document.addEventListener('click', onDocumentClick, true);
        list.querySelector<HTMLElement>('.action-menu-item')?.focus();
      });
      list.addEventListener('keydown', e => {
        const items = Array.from(list.querySelectorAll<HTMLElement>('.action-menu-item'));
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
          trigger.focus();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const next = (index + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
          items[next]?.focus();
        }
      });
    });
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
          <label class="form-label" for="field-password">${this.tr('Mot de passe *', 'Password *')}</label>
          <div class="input-with-actions">
            <input class="form-input" id="field-password" type="password" placeholder="${this.tr('Mot de passe fort…', 'Strong password…')}" value="${this.escapeHtml(existing?.password || '')}" autocomplete="new-password" spellcheck="false">
            <button type="button" class="icon-btn" id="btn-toggle-field-password" aria-pressed="false" title="${this.tr('Afficher', 'Show')}">${GEN_ICONS.eye}</button>
          </div>
          <div class="field-inline-row">
            <div class="gen-strength" id="field-password-strength">
              <div class="strength-meter">${'<div class="strength-segment"></div>'.repeat(4)}</div>
              <span class="gen-strength-label"></span>
            </div>
            <button type="button" class="btn-primary btn-ghost" id="btn-gen-pwd" aria-expanded="false" aria-controls="cred-gen-panel">${GEN_ICONS.bolt}<span>${this.tr('Générer', 'Generate')}</span></button>
          </div>
          <div id="cred-gen-panel" class="gen-inline" hidden></div>
        </div>
        <div class="form-field">
          <label class="form-label">Secret TOTP (2FA) — optionnel</label>
          <div style="display:flex;gap:8px;">
            <input class="form-input" id="field-totp" type="text" placeholder="JBSWY3DPEHPK3PXP ou otpauth://totp/..." value="${existing?.totpSecret || ''}" autocomplete="off" style="flex:1;">
            <button class="btn-primary" id="btn-scan-qr" type="button" style="white-space:nowrap;font-size:11px;padding:0 12px;">${this.tr('Scanner QR', 'Scan QR')}</button>
          </div>
          <div id="qr-scan-panel" hidden>
            <video id="qr-video" playsinline muted style="width:100%;max-height:220px;margin-top:8px;border-radius:var(--radius-md);background:#000;object-fit:cover;"></video>
            <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap;">
              <label class="btn-primary" style="font-size:11px;padding:5px 12px;cursor:pointer;">
                ${this.tr('Importer une image', 'Upload an image')}
                <input type="file" id="qr-image-input" accept="image/*" hidden>
              </label>
              <span id="qr-scan-status" style="font-size:11px;color:var(--text-muted);"></span>
            </div>
          </div>
        </div>
        <div class="form-field">
          <label class="form-label">Date d'expiration / Renouvellement — optionnel</label>
          <input class="form-input" id="field-expires-at" type="date" value="${existing?.expiresAt ? new Date(existing.expiresAt).toISOString().split('T')[0] : ''}">
        </div>
        <div class="form-field">
          <label class="form-label">Tags</label>
          <div id="field-tags"></div>
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

    const tagInput = mountTagInput(box.querySelector('#field-tags') as HTMLElement, {
      initial: existing?.tags ?? [],
      suggestions: vaultStore.getTags(),
      placeholder: this.tr('Ajouter un tag…', 'Add a tag…')
    });

    // Mot de passe : visibilité, force en direct et générateur intégré
    const pwdField = box.querySelector('#field-password') as HTMLInputElement;
    const pwdStrength = box.querySelector('#field-password-strength') as HTMLElement;
    const pwdVisibility = box.querySelector('#btn-toggle-field-password') as HTMLButtonElement;
    const genPanel = box.querySelector('#cred-gen-panel') as HTMLElement;
    const genToggle = box.querySelector('#btn-gen-pwd') as HTMLButtonElement;

    const updatePasswordStrength = () => {
      const s = calculatePasswordEntropy(pwdField.value);
      pwdStrength.querySelectorAll<HTMLElement>('.strength-segment').forEach((segment, i) => {
        segment.style.backgroundColor = pwdField.value && i < s.score ? s.color : '';
      });
      const label = pwdStrength.querySelector('.gen-strength-label') as HTMLElement;
      label.textContent = pwdField.value ? `${s.label} · ${s.bits} bits` : '';
      label.style.color = s.color;
    };
    const setPasswordVisible = (visible: boolean) => {
      pwdField.type = visible ? 'text' : 'password';
      pwdVisibility.innerHTML = visible ? GEN_ICONS.eyeOff : GEN_ICONS.eye;
      pwdVisibility.setAttribute('aria-pressed', String(visible));
      pwdVisibility.title = visible ? this.tr('Masquer', 'Hide') : this.tr('Afficher', 'Show');
    };

    pwdField.addEventListener('input', updatePasswordStrength);
    pwdVisibility.addEventListener('click', () => setPasswordVisible(pwdField.type === 'password'));
    updatePasswordStrength();

    genToggle.addEventListener('click', () => {
      const open = genPanel.hidden;
      genPanel.hidden = !open;
      genToggle.setAttribute('aria-expanded', String(open));
      if (open && genPanel.childElementCount === 0) {
        this.mountGenerator(genPanel, {
          onUse: value => {
            pwdField.value = value;
            setPasswordVisible(true);
            updatePasswordStrength();
            genPanel.hidden = true;
            genToggle.setAttribute('aria-expanded', 'false');
            pwdField.focus();
          }
        });
      }
    });

    // Scan QR code 2FA (caméra ou image, décodage 100 % local)
    const qrPanel = box.querySelector('#qr-scan-panel') as HTMLElement;
    const qrVideo = box.querySelector('#qr-video') as HTMLVideoElement;
    const qrStatus = box.querySelector('#qr-scan-status') as HTMLElement;
    let qrScanner: CameraQrScanner | null = null;

    const applyScannedOtp = (text: string): boolean => {
      const normalized = normalizeTotpInput(text);
      if (!normalized) {
        qrStatus.textContent = this.tr('QR code non reconnu comme secret 2FA (otpauth://totp)', 'QR code is not a 2FA secret (otpauth://totp)');
        qrStatus.style.color = 'var(--accent-red)';
        return false;
      }
      (box.querySelector('#field-totp') as HTMLInputElement).value = normalized;
      const info = parseOtpAuthUri(text);
      const titleInput = box.querySelector('#field-title') as HTMLInputElement;
      const usernameInput = box.querySelector('#field-username') as HTMLInputElement;
      if (info?.issuer && !titleInput.value) titleInput.value = info.issuer;
      if (info?.account && !usernameInput.value) usernameInput.value = info.account;
      qrScanner?.stop();
      qrPanel.hidden = true;
      this.showToast(this.tr('Secret 2FA importé depuis le QR code', '2FA secret imported from QR code'), 'success');
      return true;
    };

    box.querySelector('#btn-scan-qr')?.addEventListener('click', async () => {
      if (!qrPanel.hidden) {
        qrScanner?.stop();
        qrPanel.hidden = true;
        return;
      }
      qrPanel.hidden = false;
      qrStatus.style.color = 'var(--text-muted)';
      qrStatus.textContent = this.tr('Présentez le QR code à la caméra…', 'Point the camera at the QR code…');
      qrScanner = new CameraQrScanner(qrVideo);
      try {
        await qrScanner.start(text => {
          if (!applyScannedOtp(text)) {
            qrStatus.textContent += ' — ' + this.tr('importez une image', 'upload an image');
          }
        });
      } catch {
        qrStatus.textContent = this.tr('Caméra indisponible — importez une capture du QR code.', 'Camera unavailable — upload a screenshot of the QR code.');
      }
    });

    box.querySelector('#qr-image-input')?.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await decodeQrFromFile(file);
        if (text) {
          applyScannedOtp(text);
        } else {
          qrStatus.textContent = this.tr('Aucun QR code détecté dans l’image', 'No QR code found in the image');
          qrStatus.style.color = 'var(--accent-red)';
        }
      } catch {
        qrStatus.textContent = this.tr('Image illisible', 'Unreadable image');
        qrStatus.style.color = 'var(--accent-red)';
      }
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
      const totpRaw = (box.querySelector('#field-totp') as HTMLInputElement)?.value.trim();
      const totpSecret = totpRaw ? normalizeTotpInput(totpRaw) : null;
      if (totpRaw && !totpSecret) {
        this.showToast(this.tr('Secret 2FA invalide (Base32 ou URI otpauth://totp attendu)', 'Invalid 2FA secret (Base32 or otpauth://totp URI expected)'), 'error');
        return;
      }
      qrScanner?.stop();
      const notes = (box.querySelector('#field-notes') as HTMLTextAreaElement)?.value;
      const expiresVal = (box.querySelector('#field-expires-at') as HTMLInputElement)?.value;
      const expiresAt = expiresVal ? new Date(expiresVal).getTime() : undefined;

      if (isEdit && existing) {
        vaultStore.updateCredential(existing.id, {
          title,
          website: website || '',
          username: username || '',
          password,
          domain: website ? (website.replace(/^https?:\/\//, '').split('/')[0]) : '',
          totpSecret: totpSecret || undefined,
          notes: notes || '',
          tags: tagInput.getTags(),
          expiresAt
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
          tags: tagInput.getTags(),
          isFavorite: false,
          expiresAt
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

    const dependencyOptions = data.tasks
      .filter(t => t.vaultId === data.activeVaultId && t.id !== existing?.id)
      .map(t => `
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary);cursor:pointer;">
          <input type="checkbox" class="task-dep-check" value="${t.id}" ${existing?.dependsOn?.includes(t.id) ? 'checked' : ''}>
          <span style="${t.status === 'completed' ? 'text-decoration:line-through;opacity:0.6;' : ''}">${this.escapeHtml(t.title)}</span>
        </label>`)
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
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-field">
            <label class="form-label">${this.tr('Récurrence', 'Recurrence')}</label>
            <select class="form-input" id="task-recur-freq">
              <option value="">${this.tr('— Aucune —', '— None —')}</option>
              <option value="daily" ${existing?.recurrence?.freq === 'daily' ? 'selected' : ''}>${this.tr('Quotidienne', 'Daily')}</option>
              <option value="weekly" ${existing?.recurrence?.freq === 'weekly' ? 'selected' : ''}>${this.tr('Hebdomadaire', 'Weekly')}</option>
              <option value="monthly" ${existing?.recurrence?.freq === 'monthly' ? 'selected' : ''}>${this.tr('Mensuelle', 'Monthly')}</option>
              <option value="yearly" ${existing?.recurrence?.freq === 'yearly' ? 'selected' : ''}>${this.tr('Annuelle', 'Yearly')}</option>
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">${this.tr('Tous les (intervalle)', 'Every (interval)')}</label>
            <input class="form-input" id="task-recur-interval" type="number" min="1" max="365" value="${existing?.recurrence?.interval ?? 1}">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-field">
            <label class="form-label">${this.tr('Fin de récurrence', 'Recurrence end')}</label>
            <input class="form-input" id="task-recur-until" type="date" value="${existing?.recurrence?.until || ''}">
          </div>
          <div class="form-field">
            <label class="form-label">${this.tr('Rappel', 'Reminder')}</label>
            <input class="form-input" id="task-reminder" type="datetime-local" value="${this.toDateTimeInputValue(existing?.reminderAt)}">
          </div>
        </div>
        <div class="form-field">
          <label class="form-label">Tags</label>
          <div id="task-tags"></div>
        </div>
        ${dependencyOptions ? `
          <div class="form-field">
            <label class="form-label">${this.tr('Dépend de (à terminer avant)', 'Depends on (complete first)')}</label>
            <div style="display:flex;flex-direction:column;gap:6px;max-height:140px;overflow:auto;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:var(--radius-md);background:var(--bg-secondary);">
              ${dependencyOptions}
            </div>
          </div>` : ''}
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
    const taskTagInput = mountTagInput(box.querySelector('#task-tags') as HTMLElement, {
      initial: existing?.tags ?? [],
      suggestions: vaultStore.getTags(),
      placeholder: this.tr('Ajouter un tag…', 'Add a tag…')
    });

    box.querySelector('#modal-confirm')?.addEventListener('click', () => {
      const title = (box.querySelector('#task-title') as HTMLInputElement)?.value.trim();
      if (!title) { this.showToast('Le titre est requis', 'error'); return; }
      const description = (box.querySelector('#task-desc') as HTMLTextAreaElement)?.value;
      const priority = (box.querySelector('#task-priority') as HTMLSelectElement)?.value as Task['priority'];
      const dueDate = (box.querySelector('#task-due') as HTMLInputElement)?.value;
      const linkedCredSel = box.querySelector('#task-cred') as HTMLSelectElement;
      const linkedCred = linkedCredSel?.value || undefined;

      const freq = (box.querySelector('#task-recur-freq') as HTMLSelectElement).value as RecurrenceFrequency | '';
      const interval = Math.min(365, Math.max(1, parseInt((box.querySelector('#task-recur-interval') as HTMLInputElement).value, 10) || 1));
      const until = (box.querySelector('#task-recur-until') as HTMLInputElement).value || undefined;
      const recurrence: TaskRecurrence | undefined = freq ? { freq, interval, until } : undefined;
      if (recurrence && until && dueDate && until < dueDate) {
        this.showToast(this.tr('La fin de récurrence précède l’échéance', 'Recurrence end is before the due date'), 'error');
        return;
      }

      const reminderValue = (box.querySelector('#task-reminder') as HTMLInputElement).value;
      const reminderAt = reminderValue ? new Date(reminderValue).getTime() : undefined;
      const reminderSent = reminderAt !== undefined && existing?.reminderAt === reminderAt ? existing.reminderSent : false;
      if (reminderAt && reminderAt > Date.now()) this.requestNotificationPermission();

      const dependsOn = Array.from(box.querySelectorAll<HTMLInputElement>('.task-dep-check:checked')).map(el => el.value);
      const allTasks = vaultStore.getData().tasks;
      if (existing && wouldCreateDependencyCycle(allTasks, existing.id, dependsOn)) {
        this.showToast(this.tr('Dépendance circulaire : une tâche choisie dépend déjà de celle-ci', 'Circular dependency: a selected task already depends on this one'), 'error', 5000);
        return;
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
        this.closeModal();
        this.showToast('Tâche mise à jour', 'success');
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
        this.closeModal();
        this.showToast('Tâche créée', 'success');
      }
    });
  }

  /* ── Générateur ───────────────────────────────────────────────────────── */
  private openGeneratorModal(): void {
    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title" style="display:flex;align-items:center;gap:8px;">${GEN_ICONS.bolt}${this.tr('Générateur de secrets', 'Secret generator')}</div>
        <button class="modal-close">${GEN_ICONS.close}</button>
      </div>
      <div class="modal-body" data-generator-host></div>
      <div class="modal-footer">
        <span class="modal-footer-hint"><kbd>R</kbd> ${this.tr('régénérer', 'regenerate')} · <kbd>Échap</kbd> ${this.tr('fermer', 'close')}</span>
        <button class="btn-primary btn-ghost" data-close>${this.tr('Fermer', 'Close')}</button>
        <button class="btn-primary btn-accent" data-primary data-autofocus data-gen-copy>${GEN_ICONS.copy}<span>${this.tr('Copier', 'Copy')}</span></button>
      </div>
    `);
    const generator = this.mountGenerator(box.querySelector('[data-generator-host]') as HTMLElement);
    box.querySelector('[data-gen-copy]')?.addEventListener('click', () => void generator.copy());
  }

  /** Générateur réutilisable : modale dédiée ou panneau intégré au formulaire d'identifiant */
  private mountGenerator(host: HTMLElement, options: { onUse?: (value: string) => void } = {}): { copy: () => Promise<void> } {
    type GeneratorPrefs = {
      mode: 'password' | 'passphrase';
      length: number;
      uppercase: boolean;
      lowercase: boolean;
      numbers: boolean;
      symbols: boolean;
      avoidAmbiguous: boolean;
      words: number;
      separator: string;
      capitalize: boolean;
      includeNumber: boolean;
    };
    const defaults: GeneratorPrefs = {
      mode: 'password', length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true, avoidAmbiguous: false,
      words: 5, separator: '-', capitalize: true, includeNumber: true
    };
    let prefs: GeneratorPrefs = { ...defaults };
    try {
      prefs = { ...defaults, ...JSON.parse(localStorage.getItem(GENERATOR_PREFS_KEY) ?? '{}') };
    } catch {
      // Préférences illisibles : valeurs par défaut
    }
    const savePrefs = () => {
      try {
        localStorage.setItem(GENERATOR_PREFS_KEY, JSON.stringify(prefs));
      } catch {
        // Stockage indisponible (navigation privée)
      }
    };

    const chip = (key: keyof GeneratorPrefs, label: string, hint: string) => `
      <label class="gen-chip" title="${hint}">
        <input type="checkbox" data-pref="${key}" ${prefs[key] ? 'checked' : ''}>
        <span>${label}</span>
      </label>`;
    const slider = (key: 'length' | 'words', label: string, min: number, max: number) => `
      <div class="gen-slider-row">
        <span class="form-label">${label}</span>
        <input type="range" min="${min}" max="${max}" value="${prefs[key]}" data-pref="${key}" aria-label="${label}">
        <input type="number" class="form-input gen-number" min="${min}" max="${max}" value="${prefs[key]}" data-pref="${key}" aria-label="${label}">
      </div>`;
    const separators: Array<[string, string]> = [
      ['-', this.tr('Tiret  -', 'Dash  -')],
      [' ', this.tr('Espace', 'Space')],
      ['.', this.tr('Point  .', 'Dot  .')],
      ['_', this.tr('Tiret bas  _', 'Underscore  _')]
    ];

    host.innerHTML = `
      <div class="gen">
        <div class="gen-output-card">
          <div class="gen-output" data-gen="output" aria-live="polite" title="${this.tr('Cliquer pour copier', 'Click to copy')}"></div>
          <div class="gen-output-actions">
            <button type="button" class="icon-btn" data-gen="refresh" title="${this.tr('Régénérer (R)', 'Regenerate (R)')}">${GEN_ICONS.refresh}</button>
            <button type="button" class="icon-btn" data-gen="copy" title="${this.tr('Copier', 'Copy')}">${GEN_ICONS.copy}</button>
          </div>
        </div>
        <div class="gen-strength">
          <div class="strength-meter" data-gen="meter">${'<div class="strength-segment"></div>'.repeat(4)}</div>
          <span class="gen-strength-label" data-gen="strength"></span>
        </div>
        <div class="tab-btn-group" role="tablist">
          <button type="button" class="tab-btn" role="tab" data-mode="password">${this.tr('Mot de passe', 'Password')}</button>
          <button type="button" class="tab-btn" role="tab" data-mode="passphrase">${this.tr('Phrase secrète', 'Passphrase')}</button>
        </div>
        <div class="gen-section" data-section="password">
          ${slider('length', this.tr('Longueur', 'Length'), 8, 64)}
          <div class="gen-chips">
            ${chip('uppercase', 'A–Z', this.tr('Majuscules', 'Uppercase'))}
            ${chip('lowercase', 'a–z', this.tr('Minuscules', 'Lowercase'))}
            ${chip('numbers', '0–9', this.tr('Chiffres', 'Digits'))}
            ${chip('symbols', '!@#$', this.tr('Symboles', 'Symbols'))}
            ${chip('avoidAmbiguous', this.tr('Sans ambigus', 'No look-alikes'), this.tr('Exclut 0/O, 1/l/I', 'Excludes 0/O, 1/l/I'))}
          </div>
        </div>
        <div class="gen-section" data-section="passphrase">
          ${slider('words', this.tr('Mots', 'Words'), 3, 10)}
          <div class="gen-chips">
            <select class="form-input gen-select" data-pref="separator" aria-label="${this.tr('Séparateur', 'Separator')}">
              ${separators.map(([value, label]) => `<option value="${value}" ${prefs.separator === value ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
            ${chip('capitalize', this.tr('Majuscule initiale', 'Capitalize'), this.tr('Première lettre de chaque mot en majuscule', 'Capitalize each word'))}
            ${chip('includeNumber', this.tr('+ nombre', '+ number'), this.tr('Ajoute un nombre à la fin', 'Append a number'))}
          </div>
        </div>
        ${options.onUse ? `
          <div class="gen-use-row">
            <button type="button" class="btn-primary btn-accent" data-gen="use">${this.tr('Utiliser ce mot de passe', 'Use this password')}</button>
          </div>` : ''}
      </div>`;

    const query = <T extends HTMLElement = HTMLElement>(selector: string) => host.querySelector(selector) as T;
    const output = query('[data-gen="output"]');
    const charsetKeys: Array<keyof GeneratorPrefs> = ['uppercase', 'lowercase', 'numbers', 'symbols'];
    let value = '';

    const strength = () => {
      if (prefs.mode === 'password') return calculatePasswordEntropy(value);
      // Entropie réelle d'une phrase : nombre de mots de la liste, pas la longueur des caractères
      const bits = Math.round(prefs.words * Math.log2(PASSPHRASE_WORDLIST.length) + (prefs.includeNumber ? Math.log2(90) : 0));
      const score = bits >= 75 ? 4 : bits >= 55 ? 3 : bits >= 36 ? 2 : 1;
      const labels = ['', this.tr('Faible', 'Weak'), this.tr('Moyen', 'Fair'), this.tr('Fort', 'Strong'), this.tr('Excellent', 'Excellent')];
      const colors = ['', '#DA3633', '#D29922', '#2EA043', '#238636'];
      return { bits, score, label: labels[score], color: colors[score] };
    };

    const render = () => {
      output.innerHTML = Array.from(value).map(ch => {
        const kind = /[0-9]/.test(ch) ? 'gen-digit' : /[A-Za-z\s]/.test(ch) ? '' : 'gen-symbol';
        const safe = this.escapeHtml(ch);
        return kind ? `<span class="${kind}">${safe}</span>` : safe;
      }).join('');
      const s = strength();
      host.querySelectorAll<HTMLElement>('[data-gen="meter"] .strength-segment').forEach((segment, i) => {
        segment.style.backgroundColor = i < s.score ? s.color : '';
      });
      const label = query('[data-gen="strength"]');
      label.textContent = `${s.label} · ≈ ${s.bits} bits`;
      label.style.color = s.color;
    };

    const generate = () => {
      value = prefs.mode === 'password'
        ? generateStrongPassword({
            length: prefs.length,
            uppercase: prefs.uppercase,
            lowercase: prefs.lowercase,
            numbers: prefs.numbers,
            symbols: prefs.symbols,
            avoidAmbiguous: prefs.avoidAmbiguous
          })
        : generatePassphrase({ wordCount: prefs.words, separator: prefs.separator, capitalize: prefs.capitalize, includeNumber: prefs.includeNumber });
      render();
      output.classList.remove('gen-flash');
      void output.offsetWidth;
      output.classList.add('gen-flash');
    };

    const syncControls = () => {
      host.querySelectorAll<HTMLElement>('[data-mode]').forEach(button => {
        const active = button.dataset.mode === prefs.mode;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
      });
      host.querySelectorAll<HTMLElement>('[data-section]').forEach(section => {
        section.hidden = section.dataset.section !== prefs.mode;
      });
      host.querySelectorAll<HTMLInputElement>('input[data-pref="length"]').forEach(input => { input.value = String(prefs.length); });
      host.querySelectorAll<HTMLInputElement>('input[data-pref="words"]').forEach(input => { input.value = String(prefs.words); });
    };

    host.querySelectorAll<HTMLElement>('[data-mode]').forEach(button => {
      button.addEventListener('click', () => {
        prefs.mode = button.dataset.mode as GeneratorPrefs['mode'];
        syncControls();
        savePrefs();
        generate();
      });
    });

    host.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-pref]').forEach(control => {
      const key = control.dataset.pref as keyof GeneratorPrefs;
      const isNumberField = control instanceof HTMLInputElement && control.type === 'number';

      control.addEventListener('input', () => {
        if (control instanceof HTMLInputElement && control.type === 'checkbox') {
          if (charsetKeys.includes(key) && !control.checked && charsetKeys.every(k => k === key || !prefs[k])) {
            control.checked = true;
            this.showToast(this.tr('Gardez au moins un type de caractères', 'Keep at least one character set'), 'info', 1800);
            return;
          }
          (prefs as Record<string, unknown>)[key] = control.checked;
        } else if (key === 'length' || key === 'words') {
          const [min, max] = key === 'length' ? [8, 64] : [3, 10];
          const n = parseInt(control.value, 10);
          // Saisie en cours dans le champ numérique (ex. « 1 » avant « 16 ») : on attend une valeur valide
          if (!Number.isFinite(n) || (isNumberField && (n < min || n > max))) return;
          prefs[key] = Math.min(max, Math.max(min, n));
        } else {
          (prefs as Record<string, unknown>)[key] = control.value;
        }
        if (!isNumberField) syncControls();
        else host.querySelectorAll<HTMLInputElement>(`input[type="range"][data-pref="${key}"]`).forEach(range => { range.value = control.value; });
        savePrefs();
        generate();
      });

      if (isNumberField) control.addEventListener('change', syncControls);
    });

    const copy = async () => {
      if (!value) return;
      await this.copyToClipboardWithAutoClear(value, this.tr('Secret copié', 'Secret copied'), true);
      const button = query('[data-gen="copy"]');
      button.classList.add('copied');
      setTimeout(() => button.classList.remove('copied'), 500);
    };

    query('[data-gen="refresh"]').addEventListener('click', generate);
    query('[data-gen="copy"]').addEventListener('click', () => void copy());
    output.addEventListener('click', () => void copy());
    if (options.onUse) query('[data-gen="use"]').addEventListener('click', () => options.onUse?.(value));

    host.addEventListener('keydown', e => {
      const target = e.target as HTMLElement;
      const typing = target instanceof HTMLSelectElement || (target instanceof HTMLInputElement && target.type === 'number');
      if ((e.key === 'r' || e.key === 'R') && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        generate();
      }
    });
    // La touche R fonctionne aussi quand le focus est sur le bouton Copier du pied de modale
    host.closest('.modal-box')?.querySelector('.modal-footer')?.addEventListener('keydown', e => {
      const key = (e as KeyboardEvent).key;
      if (key === 'r' || key === 'R') generate();
    });

    syncControls();
    generate();
    return { copy };
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

      const toScan = creds.filter(c => c.password);
      let scanned = 0;
      let serviceError: string | null = null;
      for (const c of toScan) {
        if (!btnHibp.isConnected) return; // Modale fermée pendant l'analyse
        let pwnedHits: number;
        try {
          pwnedHits = await checkPasswordPwnedHIBP(c.password);
        } catch (err) {
          // Service injoignable : on s'arrête, les éléments restants ne sont PAS vérifiés
          serviceError = err instanceof HibpUnavailableError ? err.message : String(err);
          break;
        }
        scanned++;
        btnHibp.textContent = `${i18n.t.audit.scanningHibp} ${scanned}/${toScan.length}`;
        if (pwnedHits > 0) {
          compromisedCount++;
          compromisedList.push(`<strong>${this.escapeHtml(c.title)}</strong> (${i18n.formatNumber(pwnedHits)} ${breachesLabel})`);
        }
      }

      btnHibp.disabled = false;
      btnHibp.textContent = this.tr('Relancer l’analyse', 'Run scan again');

      if (serviceError !== null) {
        const unchecked = toScan.length - scanned;
        hibpResults.innerHTML = `
          <div style="padding:10px;background:rgba(210,153,34,0.1);border:1px solid rgba(210,153,34,0.35);border-radius:var(--radius-md);color:var(--accent-orange);">
            <strong>${this.tr('Analyse incomplète — résultat inconnu', 'Scan incomplete — result unknown')}</strong>
            <div style="margin-top:4px;">
              ${this.escapeHtml(serviceError)}.
              ${this.tr(
                `${scanned} vérifié(s), ${unchecked} non vérifié(s). Vérifiez votre connexion puis relancez.`,
                `${scanned} checked, ${unchecked} not checked. Check your connection and try again.`
              )}
            </div>
            ${compromisedList.length ? `
              <div style="margin-top:8px;color:var(--accent-red);">
                <strong>${this.tr('Déjà détectés comme compromis :', 'Already found compromised:')}</strong>
                <ul style="margin-top:4px;padding-left:18px;">${compromisedList.map(item => `<li>${item}</li>`).join('')}</ul>
              </div>` : ''}
          </div>
        `;
      } else if (compromisedCount > 0) {
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
            <div style="font-size:11px;color:var(--text-muted);">KDBX / 1PUX / CXF / JSON / CSV / XML</div>
            <input type="file" id="import-file-input" accept=".json,.csv,.xml,.kdbx,.1pux" style="position:absolute;opacity:0;inset:0;cursor:pointer;">
          </div>
          <div id="import-status" style="margin-top:10px;font-size:12px;color:var(--text-secondary);min-height:20px;"></div>
          <div id="import-secret-panel" hidden>
            <div style="margin-top:10px;padding:12px;border:1px solid var(--border-subtle);border-radius:var(--radius-md);background:var(--bg-secondary);">
              <label class="form-label" id="import-secret-label">${this.tr('Mot de passe', 'Password')}</label>
              <input class="form-input" id="import-secret-password" type="password" autocomplete="off">
              <div id="import-keyfile-row" hidden>
                <label class="form-label" style="margin-top:8px;">${this.tr('Fichier clé KeePass (optionnel)', 'KeePass key file (optional)')}</label>
                <input class="form-input" id="import-keyfile" type="file">
              </div>
              <div style="display:flex;justify-content:flex-end;margin-top:10px;">
                <button class="btn-primary" id="btn-import-unlock" style="font-size:12px;">${this.tr('Déchiffrer', 'Decrypt')}</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Section Export -->
        <div id="section-export" style="display:none;">
          <p style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;line-height:1.5;">
            Exportez les identifiants et tâches du coffre actif vers un fichier téléchargeable.
          </p>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <button class="btn-primary" id="btn-export-encrypted" style="justify-content:flex-start;padding:12px 16px;gap:12px;background-color:var(--bg-tertiary);border-color:var(--border-subtle);color:var(--text-primary);">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              <div style="text-align:left;">
                <div style="font-size:13px;font-weight:600;">${this.tr('Export chiffré (recommandé)', 'Encrypted export (recommended)')}</div>
                <div style="font-size:11px;color:var(--text-muted);">${this.tr('Protégé par un mot de passe dédié (Argon2id + AES-256-GCM)', 'Protected by a dedicated password (Argon2id + AES-256-GCM)')}</div>
              </div>
            </button>
            <button class="btn-primary" id="btn-export-kdbx" style="justify-content:flex-start;padding:12px 16px;gap:12px;background-color:var(--bg-tertiary);border-color:var(--border-subtle);color:var(--text-primary);">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>
              <div style="text-align:left;">
                <div style="font-size:13px;font-weight:600;">${this.tr('Base KeePass (.kdbx 4)', 'KeePass database (.kdbx 4)')}</div>
                <div style="font-size:11px;color:var(--text-muted);">${this.tr('Compatible KeePass, KeePassXC, Strongbox — chiffrée', 'Compatible with KeePass, KeePassXC, Strongbox — encrypted')}</div>
              </div>
            </button>
            <div id="export-password-panel" hidden>
              <div style="padding:12px;border:1px solid var(--border-subtle);border-radius:var(--radius-md);background:var(--bg-secondary);">
                <div class="form-label" id="export-password-title"></div>
                <input class="form-input" id="export-password" type="password" autocomplete="new-password" placeholder="${this.tr(`Mot de passe (${MIN_EXPORT_PASSWORD_LENGTH} caractères min.)`, `Password (min. ${MIN_EXPORT_PASSWORD_LENGTH} characters)`)}">
                <input class="form-input" id="export-password-confirm" type="password" autocomplete="new-password" placeholder="${this.tr('Confirmer le mot de passe', 'Confirm password')}" style="margin-top:8px;">
                <div id="export-password-status" style="font-size:11px;min-height:16px;margin-top:6px;color:var(--text-muted);"></div>
                <div style="display:flex;justify-content:flex-end;margin-top:6px;">
                  <button class="btn-primary" id="btn-export-password-confirm" style="font-size:12px;">${this.tr('Chiffrer et télécharger', 'Encrypt & download')}</button>
                </div>
              </div>
            </div>
            <div style="padding:8px 12px;border:1px solid rgba(210,153,34,0.35);background:rgba(210,153,34,0.08);border-radius:var(--radius-md);font-size:11px;color:var(--accent-orange);line-height:1.5;">
              ${this.tr('Les formats ci-dessous sont en clair : quiconque obtient le fichier lit tous vos secrets. Supprimez-le après usage.', 'The formats below are unencrypted: anyone who gets the file can read all your secrets. Delete it after use.')}
            </div>
            <button class="btn-primary" id="btn-export-cxf" style="justify-content:flex-start;padding:12px 16px;gap:12px;background-color:var(--bg-tertiary);border-color:var(--border-subtle);color:var(--text-primary);">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-purple)" stroke-width="2"><path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5z"></path></svg>
              <div style="text-align:left;">
                <div style="font-size:13px;font-weight:600;">${this.tr('FIDO CXF — Passkeys & identifiants', 'FIDO CXF — Passkeys & credentials')}</div>
                <div style="font-size:11px;color:var(--text-muted);">${this.tr('Credential Exchange Format de la FIDO Alliance (passkeys, TOTP, notes)', 'FIDO Alliance Credential Exchange Format (passkeys, TOTP, notes)')}</div>
              </div>
            </button>
            <button class="btn-primary" id="btn-export-json" style="justify-content:flex-start;padding:12px 16px;gap:12px;background-color:var(--bg-tertiary);border-color:var(--border-subtle);color:var(--text-primary);">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
              <div style="text-align:left;">
                <div style="font-size:13px;font-weight:600;">${this.tr('JSON BetterVault', 'BetterVault JSON')}</div>
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
    const confirmPlaintextExport = () => this.confirmDialog({
      title: this.tr('Export non chiffré', 'Unencrypted export'),
      message: this.tr(
        'Mots de passe, secrets 2FA et clés de passkeys seront lisibles par quiconque accède au fichier. Préférez l’export chiffré ou KeePass.',
        'Passwords, 2FA secrets and passkey keys will be readable by anyone with the file. Prefer the encrypted or KeePass export.'
      ),
      confirmLabel: this.tr('Exporter en clair', 'Export anyway'),
      danger: true
    });
    const exportDate = new Date().toISOString().slice(0, 10);
    const activeVaultName = data.vaults.find(v => v.id === data.activeVaultId)?.name ?? 'BetterVault';

    const exportPanel = box.querySelector('#export-password-panel') as HTMLElement;
    const exportTitle = box.querySelector('#export-password-title') as HTMLElement;
    const exportPwd = box.querySelector('#export-password') as HTMLInputElement;
    const exportPwdConfirm = box.querySelector('#export-password-confirm') as HTMLInputElement;
    const exportStatus = box.querySelector('#export-password-status') as HTMLElement;
    const exportConfirmBtn = box.querySelector('#btn-export-password-confirm') as HTMLButtonElement;
    let protectedExportMode: 'encrypted' | 'kdbx' = 'encrypted';

    const openExportPasswordPanel = (mode: 'encrypted' | 'kdbx') => {
      protectedExportMode = mode;
      exportTitle.textContent = mode === 'encrypted'
        ? this.tr('Mot de passe dédié de l’export chiffré', 'Dedicated encrypted export password')
        : this.tr('Mot de passe maître de la base KeePass', 'KeePass database master password');
      exportStatus.textContent = '';
      exportPanel.hidden = false;
      exportPwd.focus();
    };

    box.querySelector('#btn-export-encrypted')?.addEventListener('click', () => openExportPasswordPanel('encrypted'));
    box.querySelector('#btn-export-kdbx')?.addEventListener('click', () => openExportPasswordPanel('kdbx'));

    exportConfirmBtn?.addEventListener('click', async () => {
      const setExportStatus = (text: string, color: string) => {
        exportStatus.textContent = text;
        exportStatus.style.color = color;
      };
      if (exportPwd.value !== exportPwdConfirm.value) {
        setExportStatus(this.tr('Les mots de passe ne correspondent pas', 'Passwords do not match'), 'var(--accent-red)');
        return;
      }
      if (exportPwd.value.length < MIN_EXPORT_PASSWORD_LENGTH) {
        setExportStatus(this.tr(`${MIN_EXPORT_PASSWORD_LENGTH} caractères minimum`, `At least ${MIN_EXPORT_PASSWORD_LENGTH} characters`), 'var(--accent-red)');
        return;
      }

      exportConfirmBtn.disabled = true;
      setExportStatus(this.tr('Dérivation de la clé Argon2id en cours…', 'Deriving Argon2id key…'), 'var(--text-secondary)');
      try {
        if (protectedExportMode === 'encrypted') {
          const file = await encryptExport(exportVaultAsJson(creds, tasks), exportPwd.value);
          downloadExportFile(file, `bettervault-${exportDate}.encrypted.json`, 'application/json');
        } else {
          const kdbx = await buildKdbx4(creds, exportPwd.value, { databaseName: activeVaultName });
          downloadExportFile(kdbx, `bettervault-${exportDate}.kdbx`, 'application/octet-stream');
        }
        exportPwd.value = '';
        exportPwdConfirm.value = '';
        exportPanel.hidden = true;
        this.showToast(this.tr('Export chiffré téléchargé', 'Encrypted export downloaded'), 'success');
      } catch (err) {
        setExportStatus(err instanceof Error ? err.message : String(err), 'var(--accent-red)');
      } finally {
        exportConfirmBtn.disabled = false;
      }
    });

    box.querySelector('#btn-export-cxf')?.addEventListener('click', async () => {
      if (!(await confirmPlaintextExport())) return;
      downloadExportFile(exportCredentialsAsCxf(creds), `bettervault-${exportDate}.cxf.json`, 'application/json');
      this.showToast(this.tr('Export CXF téléchargé', 'CXF export downloaded'), 'success');
    });

    box.querySelector('#btn-export-json')?.addEventListener('click', async () => {
      if (!(await confirmPlaintextExport())) return;
      const jsonContent = exportVaultAsJson(creds, tasks);
      const filename = `bettervault-${new Date().toISOString().slice(0, 10)}.json`;
      downloadExportFile(jsonContent, filename, 'application/json');
      this.showToast(i18n.getLocale() === 'fr' ? 'Export JSON téléchargé' : 'JSON export downloaded', 'success');
    });

    box.querySelector('#btn-export-csv')?.addEventListener('click', async () => {
      if (!(await confirmPlaintextExport())) return;
      const csvContent = exportVaultAsCsv(creds);
      const filename = `bettervault-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadExportFile(csvContent, filename, 'text/csv;charset=utf-8;');
      this.showToast(i18n.getLocale() === 'fr' ? 'Export CSV téléchargé' : 'CSV export downloaded', 'success');
    });


    // Actions Import
    let parsedResult: { credentials: any[]; tasks: any[]; sourceFormat: string; count: number } = { credentials: [], tasks: [], sourceFormat: 'unknown', count: 0 };
    const statusEl = box.querySelector('#import-status') as HTMLElement;

    const secretPanel = box.querySelector('#import-secret-panel') as HTMLElement;
    const secretLabel = box.querySelector('#import-secret-label') as HTMLElement;
    const secretPwd = box.querySelector('#import-secret-password') as HTMLInputElement;
    const keyFileRow = box.querySelector('#import-keyfile-row') as HTMLElement;
    const keyFileInput = box.querySelector('#import-keyfile') as HTMLInputElement;
    const unlockBtn = box.querySelector('#btn-import-unlock') as HTMLButtonElement;
    let pendingFile: { bytes: Uint8Array; name: string } | null = null;

    const setImportStatus = (text: string, color: string) => {
      statusEl.textContent = text;
      statusEl.style.color = color;
    };

    const tryParse = async (secrets?: ImportSecrets) => {
      if (!pendingFile) return;
      confirmBtn.disabled = true;
      if (secrets) setImportStatus(this.tr('Déchiffrement en cours…', 'Decrypting…'), 'var(--text-secondary)');
      try {
        parsedResult = await parseImportData(pendingFile.bytes, pendingFile.name, secrets);
        secretPanel.hidden = true;
        secretPwd.value = '';
        const foundLabel = this.tr('identifiant(s) trouvé(s)', 'item(s) found');
        setImportStatus(`${parsedResult.count} ${foundLabel} — "${pendingFile.name}" [${parsedResult.sourceFormat}]`, 'var(--accent-green)');
        confirmBtn.disabled = parsedResult.count === 0;
      } catch (err) {
        if (err instanceof PasswordRequiredError) {
          secretPanel.hidden = false;
          keyFileRow.hidden = err.kind !== 'kdbx';
          secretLabel.textContent = err.kind === 'kdbx'
            ? this.tr('Mot de passe maître KeePass', 'KeePass master password')
            : this.tr('Mot de passe de l’export chiffré', 'Encrypted export password');
          setImportStatus(err.message, 'var(--accent-orange)');
          secretPwd.focus();
          return;
        }
        const errLabel = this.tr('Erreur de lecture', 'Read error');
        setImportStatus(`${errLabel} : ${err instanceof Error ? err.message : String(err)}`, 'var(--accent-red)');
      }
    };

    const handleFile = async (file: File) => {
      pendingFile = { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name };
      secretPanel.hidden = true;
      secretPwd.value = '';
      keyFileInput.value = '';
      await tryParse();
    };

    unlockBtn?.addEventListener('click', async () => {
      const keyFile = keyFileInput.files?.[0];
      unlockBtn.disabled = true;
      try {
        await tryParse({
          password: secretPwd.value,
          keyFile: keyFile && !keyFileRow.hidden ? new Uint8Array(await keyFile.arrayBuffer()) : undefined
        });
      } finally {
        unlockBtn.disabled = false;
      }
    });

    secretPwd?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') unlockBtn.click();
    });

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
      pendingFile?.bytes.fill(0);
      pendingFile = null;
      this.closeModal();
      const importedLabel = i18n.getLocale() === 'fr' ? `${parsedResult.count} identifiant(s) importé(s)` : `${parsedResult.count} item(s) imported`;
      this.showToast(importedLabel, 'success');
    });
  }

  /* ── Compte : déverrouillage, verrouillage, synchronisation ─────────── */
  private initAccount(): void {
    this.authScreen = mountAuthScreen(document.getElementById('auth-screen') as HTMLElement, accountService, data => this.showApp(data));

    accountService.onRemoteData(data => {
      vaultStore.load(data);
      const exists = data.credentials.some(c => c.id === this.selectedItemId) || data.tasks.some(t => t.id === this.selectedItemId);
      if (this.selectedItemId && !exists) {
        this.selectedItemId = null;
        this.renderDetail(null);
      }
    });
    accountService.onSyncStateChange(() => this.renderSyncStatus());

    document.getElementById('btn-lock-app')?.addEventListener('click', () => this.lockApp());
    document.getElementById('btn-sync-status')?.addEventListener('click', () => this.openAccountModal());
    window.addEventListener('online', () => {
      if (accountService.isUnlocked()) void accountService.syncNow();
    });
    window.setInterval(() => {
      if (accountService.isUnlocked()) void accountService.syncNow();
    }, SYNC_INTERVAL_MS);

    this.renderSyncStatus();
    this.authScreen.show();
  }

  private showApp(data: UnlockedVaultData): void {
    vaultStore.load(data);
    vaultStore.setPersistence(snapshot => void accountService.save(snapshot));
    this.selectedItemId = null;
    this.activeTag = null;
    (document.getElementById('app') as HTMLElement).hidden = false;
    this.renderDetail(null);
    this.renderSyncStatus();
    void accountService.syncNow();
  }

  private lockApp(): void {
    if (!accountService.isUnlocked()) return;
    accountService.lock();
    vaultStore.setPersistence(null);
    vaultStore.unload();
    this.closeModal();
    this.selectedItemId = null;
    this.renderDetail(null);
    (document.getElementById('app') as HTMLElement).hidden = true;
    this.authScreen?.show();
  }

  private async signOutDevice(): Promise<void> {
    const account = accountService.getAccount();
    if (!account) return;

    let unsyncedWarning = '';
    if (account.mode === 'cloud') {
      await accountService.flush();
      await accountService.syncNow();
      if (accountService.getSyncState().status !== 'synced') {
        unsyncedWarning = this.tr(' Des modifications n’ont pas pu être synchronisées et seront perdues.', ' Some changes could not be synced and will be lost.');
      }
    }

    const confirmed = await this.confirmDialog({
      title: this.tr('Se déconnecter de cet appareil ?', 'Sign out of this device?'),
      message: account.mode === 'cloud'
        ? this.tr('Le coffre reste disponible sur le serveur et sur vos autres appareils.', 'The vault stays available on the server and your other devices.') + unsyncedWarning
        : this.tr('Ce coffre n’est pas synchronisé : toutes ses données seront définitivement supprimées. Exportez-les avant si nécessaire.', 'This vault is not synced: all of its data will be permanently deleted. Export it first if needed.'),
      confirmLabel: this.tr('Se déconnecter', 'Sign out'),
      danger: true
    });
    if (!confirmed) return;

    await accountService.signOut();
    vaultStore.setPersistence(null);
    vaultStore.unload();
    this.closeModal();
    this.selectedItemId = null;
    this.activeTag = null;
    this.renderDetail(null);
    (document.getElementById('app') as HTMLElement).hidden = true;
    this.authScreen?.show();
  }

  private syncStatusLabel(status: SyncStatus): string {
    const labels: Record<SyncStatus, string> = {
      local: this.tr('Sur cet appareil', 'On this device'),
      synced: this.tr('Synchronisé', 'Synced'),
      pending: this.tr('Modifications en attente', 'Changes pending'),
      syncing: this.tr('Synchronisation…', 'Syncing…'),
      offline: this.tr('Hors ligne', 'Offline'),
      error: this.tr('Erreur de synchronisation', 'Sync error')
    };
    return labels[status];
  }

  private renderSyncStatus(): void {
    const el = document.getElementById('sync-status');
    if (!el) return;
    const account = accountService.getAccount();
    const state = accountService.getSyncState();
    const status: SyncStatus = account?.mode === 'cloud' ? state.status : 'local';
    const colors: Record<SyncStatus, string> = {
      local: 'var(--text-muted)',
      synced: 'var(--accent-green-bright)',
      pending: 'var(--accent-orange)',
      syncing: 'var(--accent-blue)',
      offline: 'var(--accent-orange)',
      error: 'var(--accent-red)'
    };
    el.innerHTML = `<span class="sync-dot" style="background-color:${colors[status]};"></span><span class="sync-label">${this.syncStatusLabel(status)}</span>`;
    const button = document.getElementById('btn-sync-status');
    if (button) button.title = [account?.email, state.message].filter(Boolean).join(' — ');
  }

  private openAccountModal(): void {
    const account = accountService.getAccount();
    if (!account) return;
    const isCloud = account.mode === 'cloud';
    const locale = i18n.getLocale() === 'fr' ? 'fr-FR' : 'en-US';

    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title">${this.tr('Compte', 'Account')}</div>
        <button class="modal-close">${GEN_ICONS.close}</button>
      </div>
      <div class="modal-body">
        <div class="account-summary">
          <div class="account-avatar">${this.escapeHtml(account.email.charAt(0).toUpperCase())}</div>
          <div class="account-summary-text">
            <div class="account-email">${this.escapeHtml(account.email)}</div>
            <div class="account-meta">${isCloud
              ? `${this.tr('Synchronisé avec', 'Synced with')} ${this.escapeHtml(account.serverUrl ?? '')}`
              : this.tr('Stocké uniquement sur cet appareil', 'Stored on this device only')}</div>
          </div>
        </div>

        ${isCloud ? `
          <div class="account-sync-row">
            <div style="min-width:0;">
              <div class="form-label">${this.tr('Synchronisation', 'Sync')}</div>
              <div class="account-sync-state" data-sync-state></div>
            </div>
            <button class="btn-primary" data-action="sync">${GEN_ICONS.refresh}<span>${this.tr('Synchroniser', 'Sync now')}</span></button>
          </div>` : `
          <section class="account-section">
            <h3 class="account-section-title">${this.tr('Activer la synchronisation', 'Enable sync')}</h3>
            <p class="modal-text">${this.tr('Le coffre est envoyé chiffré. Le mot de passe maître et les données en clair ne quittent pas cet appareil.', 'The vault is uploaded encrypted. The master password and plaintext data never leave this device.')}</p>
            <div class="form-field">
              <label class="form-label" for="account-server">${this.tr('Adresse du serveur', 'Server address')}</label>
              <input class="form-input" id="account-server" type="url" value="${this.escapeHtml(DEFAULT_SERVER_URL)}" autocomplete="url" spellcheck="false">
            </div>
            <div class="form-field">
              <label class="form-label" for="account-connect-password">${this.tr('Mot de passe maître', 'Master password')}</label>
              <input class="form-input" id="account-connect-password" type="password" autocomplete="current-password">
            </div>
            <div class="form-error" data-error="connect" role="alert" hidden></div>
            <div class="account-actions account-actions-end">
              <button class="btn-primary btn-accent" data-action="connect">${this.tr('Activer', 'Enable')}</button>
            </div>
          </section>`}

        <section class="account-section">
          <h3 class="account-section-title">${this.tr('Cet appareil', 'This device')}</h3>
          <div class="account-actions">
            <button class="btn-primary" data-action="lock">${this.tr('Verrouiller', 'Lock')}</button>
            <button class="btn-primary btn-ghost" data-action="signout">${this.tr('Se déconnecter de cet appareil', 'Sign out of this device')}</button>
          </div>
        </section>

        ${isCloud ? `
          <section class="account-section account-danger">
            <h3 class="account-section-title">${this.tr('Supprimer le compte en ligne', 'Delete online account')}</h3>
            <p class="modal-text">${this.tr('Supprime définitivement le coffre du serveur. Les données restent sur cet appareil.', 'Permanently deletes the vault from the server. Data stays on this device.')}</p>
            <div class="form-field">
              <label class="form-label" for="account-delete-password">${this.tr('Mot de passe maître', 'Master password')}</label>
              <input class="form-input" id="account-delete-password" type="password" autocomplete="current-password">
            </div>
            <div class="form-error" data-error="delete" role="alert" hidden></div>
            <div class="account-actions account-actions-end">
              <button class="btn-primary btn-danger" data-action="delete">${this.tr('Supprimer le compte en ligne', 'Delete online account')}</button>
            </div>
          </section>` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn-primary" data-close>${this.tr('Fermer', 'Close')}</button>
      </div>
    `);

    const renderState = () => {
      const el = box.querySelector('[data-sync-state]');
      if (!el) return;
      const state = accountService.getSyncState();
      const when = state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString(locale) : this.tr('jamais', 'never');
      el.textContent = `${this.syncStatusLabel(state.status)} · ${this.tr('dernière synchro', 'last sync')} ${when}${state.message ? ` — ${state.message}` : ''}`;
    };
    renderState();
    const unsubscribe = accountService.onSyncStateChange(() => {
      if (!box.isConnected) return unsubscribe();
      renderState();
    });

    const showError = (key: string, err: unknown) => {
      const el = box.querySelector<HTMLElement>(`[data-error="${key}"]`);
      if (!el) return;
      el.textContent = accountErrorMessage(err);
      el.hidden = false;
    };
    const runBusy = async (button: HTMLButtonElement, busyLabel: string, task: () => Promise<void>) => {
      const original = button.innerHTML;
      button.disabled = true;
      button.textContent = busyLabel;
      try {
        await task();
      } finally {
        if (button.isConnected) {
          button.disabled = false;
          button.innerHTML = original;
        }
      }
    };
    const action = (name: string) => box.querySelector<HTMLButtonElement>(`[data-action="${name}"]`);

    action('sync')?.addEventListener('click', event => {
      void runBusy(event.currentTarget as HTMLButtonElement, this.tr('Synchronisation…', 'Syncing…'), () => accountService.syncNow());
    });

    action('connect')?.addEventListener('click', event => {
      const password = (box.querySelector('#account-connect-password') as HTMLInputElement).value;
      const serverUrl = (box.querySelector('#account-server') as HTMLInputElement).value;
      if (!password) return showError('connect', new Error(this.tr('Saisissez le mot de passe maître', 'Enter the master password')));
      void runBusy(event.currentTarget as HTMLButtonElement, this.tr('Envoi du coffre chiffré…', 'Uploading encrypted vault…'), async () => {
        try {
          await accountService.connectCloud(serverUrl, password);
          this.closeModal();
          this.renderSyncStatus();
          this.showToast(this.tr('Synchronisation activée', 'Sync enabled'), 'success');
        } catch (err) {
          showError('connect', err);
        }
      });
    });

    action('lock')?.addEventListener('click', () => this.lockApp());
    action('signout')?.addEventListener('click', () => void this.signOutDevice());

    action('delete')?.addEventListener('click', async event => {
      const button = event.currentTarget as HTMLButtonElement;
      const password = (box.querySelector('#account-delete-password') as HTMLInputElement).value;
      if (!password) return showError('delete', new Error(this.tr('Saisissez le mot de passe maître', 'Enter the master password')));
      const confirmed = await this.confirmDialog({
        title: this.tr('Supprimer le compte en ligne ?', 'Delete online account?'),
        message: this.tr('Le coffre sera supprimé du serveur et vos autres appareils ne pourront plus se synchroniser. Cette action est définitive.', 'The vault will be deleted from the server and your other devices will stop syncing. This cannot be undone.'),
        confirmLabel: this.tr('Supprimer', 'Delete'),
        danger: true
      });
      if (!confirmed) return;
      void runBusy(button, this.tr('Suppression…', 'Deleting…'), async () => {
        try {
          await accountService.deleteCloudAccount(password);
          this.closeModal();
          this.renderSyncStatus();
          this.showToast(this.tr('Compte en ligne supprimé', 'Online account deleted'), 'success');
        } catch (err) {
          showError('delete', err);
        }
      });
    });
  }

  /* ── Coffres ─────────────────────────────────────────────────────────── */
  private openVaultModal(vaultId?: string): void {
    const data = vaultStore.getData();
    const existing = vaultId ? data.vaults.find(v => v.id === vaultId) : undefined;
    const credentialCount = existing ? data.credentials.filter(c => c.vaultId === existing.id).length : 0;
    const taskCount = existing ? data.tasks.filter(t => t.vaultId === existing.id).length : 0;
    const typeOption = (type: 'personal' | 'work' | 'team', label: string) =>
      `<option value="${type}" ${existing?.type === type ? 'selected' : ''}>${label}</option>`;

    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title">${existing ? this.tr('Modifier le coffre', 'Edit vault') : i18n.t.vault.newVaultModalTitle}</div>
        <button class="modal-close">${GEN_ICONS.close}</button>
      </div>
      <div class="modal-body">
        <div class="form-field">
          <label class="form-label" for="vault-name">${i18n.t.vault.vaultNameLabel}</label>
          <input class="form-input" id="vault-name" type="text" maxlength="40" value="${this.escapeHtml(existing?.name ?? '')}" placeholder="${this.tr('Personnel, Travail, Famille…', 'Personal, Work, Family…')}" autocomplete="off">
        </div>
        <div class="form-field">
          <label class="form-label" for="vault-type">${i18n.t.vault.vaultTypeLabel}</label>
          <select class="form-input" id="vault-type">
            ${typeOption('personal', i18n.t.common.personal)}
            ${typeOption('work', i18n.t.common.work)}
            ${typeOption('team', i18n.t.common.team)}
          </select>
        </div>
        ${existing && data.vaults.length > 1 ? `
          <section class="account-section account-danger">
            <h3 class="account-section-title">${this.tr('Supprimer ce coffre', 'Delete this vault')}</h3>
            <p class="modal-text">${this.tr(`${credentialCount} identifiant(s) et ${taskCount} tâche(s) seront supprimés.`, `${credentialCount} credential(s) and ${taskCount} task(s) will be deleted.`)}</p>
            <div class="account-actions account-actions-end">
              <button class="btn-primary btn-danger" data-action="delete-vault">${this.tr('Supprimer le coffre', 'Delete vault')}</button>
            </div>
          </section>` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn-primary" data-close>${i18n.t.common.cancel}</button>
        <button class="btn-primary" id="modal-confirm">${existing ? this.tr('Enregistrer', 'Save') : i18n.t.vault.createVaultButton}</button>
      </div>
    `);

    box.querySelector('#modal-confirm')?.addEventListener('click', () => {
      const name = (box.querySelector('#vault-name') as HTMLInputElement).value.trim();
      const type = (box.querySelector('#vault-type') as HTMLSelectElement).value as 'personal' | 'work' | 'team';
      if (!name) {
        this.showToast(this.tr('Le nom du coffre est requis', 'Vault name is required'), 'error');
        return;
      }
      if (existing) {
        vaultStore.updateVault(existing.id, { name, type });
        this.showToast(this.tr('Coffre enregistré', 'Vault saved'), 'success');
      } else {
        vaultStore.addVault(name, type);
        this.selectedItemId = null;
        this.renderDetail(null);
        this.showToast(i18n.t.vault.vaultCreatedToast, 'success');
      }
      this.closeModal();
    });

    box.querySelector('[data-action="delete-vault"]')?.addEventListener('click', async () => {
      if (!existing) return;
      const confirmed = await this.confirmDialog({
        title: this.tr('Supprimer le coffre ?', 'Delete vault?'),
        message: this.tr(`« ${existing.name} », ses ${credentialCount} identifiant(s) et ses ${taskCount} tâche(s) seront définitivement supprimés.`, `"${existing.name}", its ${credentialCount} credential(s) and ${taskCount} task(s) will be permanently deleted.`),
        confirmLabel: this.tr('Supprimer', 'Delete'),
        danger: true
      });
      if (!confirmed) return;
      vaultStore.deleteVault(existing.id);
      this.selectedItemId = null;
      this.renderDetail(null);
      this.closeModal();
      this.showToast(this.tr('Coffre supprimé', 'Vault deleted'), 'success');
    });
  }

  /* ── Tags ────────────────────────────────────────────────────────────── */
  private renderTagSidebar(): void {
    const list = document.getElementById('tag-list');
    if (!list) return;
    const data = vaultStore.getData();
    const tags = vaultStore.getTags();
    if (this.activeTag && !tags.some(t => t.name === this.activeTag)) this.activeTag = null;

    if (tags.length === 0) {
      list.innerHTML = `<li class="nav-empty">${this.tr('Aucun tag', 'No tags')}</li>`;
      return;
    }

    const itemsInVault = [...data.credentials, ...data.tasks].filter(item => item.vaultId === data.activeVaultId);
    list.innerHTML = '';
    tags.forEach(tag => {
      const key = tag.name.toLowerCase();
      const count = itemsInVault.filter(item => item.tags.some(t => t.toLowerCase() === key)).length;
      const li = document.createElement('li');
      li.className = `nav-item ${this.activeTag === tag.name ? 'active' : ''}`;
      li.tabIndex = 0;
      li.setAttribute('aria-pressed', String(this.activeTag === tag.name));
      li.innerHTML = `
        <span class="nav-item-left">
          <span class="tag-dot" style="background-color:${tagColor(tag.color)};"></span>
          <span>${this.escapeHtml(tag.name)}</span>
        </span>
        <span class="nav-count">${count}</span>`;
      const toggle = () => {
        this.activeTag = this.activeTag === tag.name ? null : tag.name;
        this.selectedItemId = null;
        this.renderSidebar();
        this.renderList();
        this.renderDetail(null);
      };
      li.addEventListener('click', toggle);
      li.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
      list.appendChild(li);
    });
  }

  private renderTagChips(tags: string[]): string {
    if (!tags.length) return '';
    return `<div class="tag-chip-row">${tags.map(name => `
      <span class="tag-chip" style="--tag-color:${tagColor(vaultStore.getTagByName(name)?.color)}"><span>${this.escapeHtml(name)}</span></span>`).join('')}</div>`;
  }

  private openTagManagerModal(): void {
    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title">Tags</div>
        <button class="modal-close">${GEN_ICONS.close}</button>
      </div>
      <div class="modal-body">
        <form class="tag-create-row" data-tag-create>
          <input class="form-input" id="tag-new-name" maxlength="32" placeholder="${this.tr('Nouveau tag', 'New tag')}" aria-label="${this.tr('Nouveau tag', 'New tag')}" autocomplete="off">
          <button class="btn-primary btn-accent" type="submit">${this.tr('Ajouter', 'Add')}</button>
        </form>
        <div class="tag-manager-list" data-tag-list></div>
      </div>
      <div class="modal-footer">
        <button class="btn-primary" data-close>${this.tr('Fermer', 'Close')}</button>
      </div>
    `);

    const listEl = box.querySelector('[data-tag-list]') as HTMLElement;

    const render = () => {
      const tags = vaultStore.getTags();
      if (tags.length === 0) {
        listEl.innerHTML = `<p class="modal-text">${this.tr('Aucun tag. Créez-en un ici ou depuis un identifiant ou une tâche.', 'No tags yet. Create one here or from a credential or task.')}</p>`;
        return;
      }
      listEl.innerHTML = tags.map(tag => {
        const count = vaultStore.countTagUsage(tag.name);
        return `
          <div class="tag-manager-row" data-tag-id="${tag.id}">
            <input class="form-input tag-rename" value="${this.escapeHtml(tag.name)}" maxlength="32" aria-label="${this.tr('Nom du tag', 'Tag name')}">
            <span class="tag-usage">${this.tr(`${count} élément(s)`, `${count} item(s)`)}</span>
            <button type="button" class="icon-btn tag-delete" title="${this.tr('Supprimer', 'Delete')}" aria-label="${this.tr('Supprimer', 'Delete')} ${this.escapeHtml(tag.name)}">${ACTION_ICONS.trash}</button>
            <div class="tag-color-picker" role="radiogroup" aria-label="${this.tr('Couleur', 'Color')}">
              ${TAG_COLORS.map(color => `
                <button type="button" class="tag-swatch ${color === tag.color ? 'selected' : ''}" style="background-color:${color};" data-color="${color}" role="radio" aria-checked="${color === tag.color}" aria-label="${color}"></button>`).join('')}
            </div>
          </div>`;
      }).join('');
    };

    const rowTag = (el: HTMLElement) => {
      const id = el.closest<HTMLElement>('[data-tag-id]')?.dataset.tagId;
      return vaultStore.getTags().find(t => t.id === id);
    };

    listEl.addEventListener('click', async e => {
      const target = e.target as HTMLElement;
      const tag = rowTag(target);
      if (!tag) return;

      const swatch = target.closest<HTMLElement>('.tag-swatch');
      if (swatch?.dataset.color) {
        vaultStore.updateTag(tag.id, { color: swatch.dataset.color });
        render();
        return;
      }

      if (target.closest('.tag-delete')) {
        const count = vaultStore.countTagUsage(tag.name);
        const confirmed = await this.confirmDialog({
          title: this.tr('Supprimer le tag ?', 'Delete tag?'),
          message: this.tr(`« ${tag.name} » sera retiré de ${count} élément(s). Les éléments eux-mêmes sont conservés.`, `"${tag.name}" will be removed from ${count} item(s). The items themselves are kept.`),
          confirmLabel: this.tr('Supprimer', 'Delete'),
          danger: true
        });
        if (!confirmed) return;
        if (this.activeTag === tag.name) this.activeTag = null;
        vaultStore.deleteTag(tag.id);
        render();
      }
    });

    listEl.addEventListener('change', e => {
      const input = e.target as HTMLInputElement;
      if (!input.classList.contains('tag-rename')) return;
      const tag = rowTag(input);
      if (!tag) return;
      try {
        const wasActive = this.activeTag === tag.name;
        vaultStore.updateTag(tag.id, { name: input.value });
        if (wasActive) this.activeTag = vaultStore.getTags().find(t => t.id === tag.id)?.name ?? null;
      } catch (err) {
        this.showToast(err instanceof Error ? err.message : String(err), 'error');
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
      const input = box.querySelector('#tag-new-name') as HTMLInputElement;
      try {
        vaultStore.createTag(input.value);
        input.value = '';
        render();
      } catch (err) {
        this.showToast(err instanceof Error ? err.message : String(err), 'error');
      }
      input.focus();
    });

    render();
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

