import { TAG_COLORS, vaultStore } from './store/vaultStore';
import type { CredentialItem, Task } from './types/vault';
import { extractDomain, getServiceIconSvg } from './icons/serviceIcons';
import { renderItemIcon, type ItemIcon } from './icons/iconLibrary';
import BRAND_ICONS from 'virtual:bettervault-icons/brands';
import { generateTOTP } from './crypto/totpEngine';
import {
  calculatePasswordEntropy,
  generateStrongPassword,
  generatePassphrase,
  auditVaultSecurity,
  checkPasswordPwnedHIBP,
  HibpUnavailableError,
  MAX_PASSPHRASE_WORDS,
  passphraseEntropyBits,
  secureRandomIndex,
  type PassphraseCase
} from './crypto/vaultCrypto';
import { exportVaultAsJson, exportVaultAsCsv, downloadExportFile } from './import_export/importEngine';
import { parseImportData, PasswordRequiredError, ImportSecrets } from './import_export/importRouter';
import { encryptExport, MIN_EXPORT_PASSWORD_LENGTH } from './import_export/encryptedExport';
import { buildKdbx4 } from './import_export/keepass';
import { exportCredentialsAsCxf } from './import_export/cxf';
import { normalizeTotpInput, parseOtpAuthUri } from './crypto/otpauthUri';
import { CameraQrScanner, decodeQrFromFile } from './crypto/qrScanner';
import { AccountService, type SyncStatus } from './account/accountService';
import { SharedReadOnlyError, SharedVaultManager } from './account/sharedVaults';
import { setApiLocale, type AccountSession, type SharedMember, type SharedPermission, type SharedRole } from './account/cloudClient';
import { decryptFile, encryptFile, type AttachmentMeta } from './account/attachmentCrypto';
import { createDeviceStorage } from './platform/storage';
import { isTauri, openExternal } from './platform/tauriBridge';
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
import { mountIconPicker } from './ui/iconPicker';
import { mountColorPicker } from './ui/colorPicker';
import { mountDateField } from './ui/dateField';
import { showToast as pushToast } from './ui/toast';
import { EXPIRY_SOON_DAYS, expiryInfo, renderExpiryBadge } from './ui/expiry';
import { printRecoveryKey, recoveryKeyFile } from './ui/recoveryKey';
import { MANAGER_EXPORTS } from './import_export/managerExports';
import { secretGridHtml } from './ui/secretDisplay';
import { resizeAvatar } from './ui/avatarImage';
import { translateError } from './i18n/errorMessages';
import { tabIcon } from './ui/tabIcons';
import { mountStepper, type StepDef } from './ui/stepper';
import {
  cardBrand, formatCardNumber, isLuhnValid, isFileType, itemTypeOf, looksLikePrivateKey,
  ITEM_TYPES, ITEM_TYPE_INFO, type ItemType
} from './types/itemTypes';
import { bindingFromEvent, checkBinding, DEFAULT_SHORTCUTS, formatBinding, isPlainKey, loadShortcuts, saveShortcuts, SHORTCUT_ORDER, type ShortcutAction, type ShortcutBindings } from './ui/shortcuts';
import { CREDENTIAL_FILTERS, countByFilter, queryCredentials, reusedPasswords, type CredentialFilter, type CredentialSort } from './store/credentialFilters';
import { checkCredential, remainingCapacity } from './account/limits';
import { renderSVG } from 'uqr';
import { activeTabHost, extensionSessionStore, extensionSurface, fillActiveTab, matchesSite, openFullTab, openSidePanel } from './extension/surface';
import { biometricStore, isAndroidApp, nativeCall, type DeviceSecretStore } from './platform/biometric';
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

const formatFileSize = (bytes: number) => i18n.formatBytes(bytes);

/** Types affichables directement dans la fenêtre d'aperçu (le fichier reste déchiffré en mémoire) */
function previewKind(type: string, name: string): 'image' | 'pdf' | 'text' | 'audio' | 'video' | null {
  const extension = name.toLowerCase().split('.').pop() ?? '';
  if (type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp'].includes(extension)) return 'image';
  if (type === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('text/') || type === 'application/json' || ['txt', 'md', 'csv', 'json', 'log', 'xml', 'yml', 'yaml'].includes(extension)) return 'text';
  return null;
}

const isPreviewable = (type: string, name: string) => previewKind(type, name) !== null;

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
const LIST_PREFS_KEY = 'bettervault.list-prefs';

/**
 * Dossiers dépliés : simple confort d'affichage, gardé sur l'appareil.
 * Rien de sensible : ce ne sont que des identifiants de dossiers du coffre déverrouillé.
 */
const EXPANDED_FOLDERS_KEY = 'bettervault-expanded-folders';

function loadExpandedFolders(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(EXPANDED_FOLDERS_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function saveExpandedFolders(ids: Set<string>): void {
  try {
    localStorage.setItem(EXPANDED_FOLDERS_KEY, JSON.stringify([...ids]));
  } catch {
    // Stockage indisponible (navigation privée) : l'arborescence repart repliée
  }
}
const AUTOFILL_KEY = 'bettervault.android-autofill';

const VAULT_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
const GENERIC_FILE_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';

// Créé au démarrage, une fois le stockage de l'appareil chargé (voir la fin du fichier)
let accountService: AccountService;
let sharedVaults: SharedVaultManager;

/* ════════════════════════════════════════════════════════════════════════════
   APP CONTROLLER — Zero-Knowledge Vault Manager
   ════════════════════════════════════════════════════════════════════════════ */
class AppController {
  private activeView: ActiveView = 'all-credentials';
  private shortcuts: ShortcutBindings = loadShortcuts();
  /** Vrai pendant qu'une combinaison est en cours d'enregistrement : les raccourcis sont suspendus */
  private recordingShortcut = false;
  /** Photo de profil affichable (data:, blob: ou https:) */
  private avatarSrc: string | null = null;
  private selectedItemId: string | null = null;
  private searchQuery = '';
  private taskViewMode: TaskViewMode = 'list';
  public totpInterval: number | null = null;
  private autoLockTimeout: number | null = null;
  private readonly AUTO_LOCK_DELAY_MS = 5 * 60 * 1000; // 5 minutes d'inactivité
  private clipboardClearTimer: number | null = null;
  private activeTag: string | null = null;
  /** Dossier ouvert dans la barre latérale ; null = tout le coffre */
  private activeFolderId: string | null = null;
  /** Dossiers dépliés dans l'arborescence : préférence d'affichage, gardée sur l'appareil */
  private expandedFolders = new Set<string>(loadExpandedFolders());
  private authScreen: { show(): void } | null = null;
  private credentialFilters = new Set<CredentialFilter>();
  private credentialSort: CredentialSort = 'name';
  /** Faux pour une fenêtre qui ne doit pas se fermer par Échap ou clic sur le fond (clé de secours) */
  private modalDismissible = true;
  private readonly deviceStore: DeviceSecretStore | null = biometricStore();
  private autofillTimer = 0;

  constructor() {
    this.loadListPrefs();
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
      void this.renderSiteStrip();
      this.scheduleAutofillSync();
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
    document.getElementById('mobile-more')?.addEventListener('click', openSidebar);
    document.getElementById('mobile-add')?.addEventListener('click', () => document.getElementById('btn-add-item')?.click());
    mobileSidebarClose?.addEventListener('click', closeSidebar);
    overlay?.addEventListener('click', closeSidebar);
    document.querySelectorAll('.sidebar .nav-item').forEach(item => {
      item.addEventListener('click', closeSidebar);
    });
  }

  /* ── Notifications ─────────────────────────────────────────────────────── */
  public showToast(message: string, type: 'success' | 'info' | 'error' | 'warning' = 'info', durationMs?: number): void {
    pushToast(message, { kind: type, duration: durationMs, closeLabel: this.tr('Fermer', 'Close') });
  }

  private dateLocale(): string {
    return i18n.intlLocale();
  }

  /** Icône choisie pour l'identifiant, sinon logo détecté depuis le site */
  private credentialIcon(cred: { icon?: ItemIcon; website: string; title: string; type?: ItemType }, size = 20): string {
    if (cred.icon) return renderItemIcon(cred.icon, size);
    // Le logo du service n'a de sens que pour un identifiant ; les autres types portent l'icône de leur type
    const type = itemTypeOf(cred.type);
    if (type !== 'login') return tabIcon(ITEM_TYPE_INFO[type].icon, size);
    return getServiceIconSvg(cred.website || cred.title).replace('width="20" height="20"', `width="${size}" height="${size}"`);
  }

  private loadListPrefs(): void {
    try {
      const prefs = JSON.parse(localStorage.getItem(LIST_PREFS_KEY) ?? '{}') as { filters?: string[]; sort?: string };
      this.credentialFilters = new Set((prefs.filters ?? []).filter((f): f is CredentialFilter => CREDENTIAL_FILTERS.includes(f as CredentialFilter)));
      if (prefs.sort === 'name' || prefs.sort === 'recent' || prefs.sort === 'updated' || prefs.sort === 'expiry') this.credentialSort = prefs.sort;
    } catch {
      // Préférences illisibles : valeurs par défaut
    }
  }

  private saveListPrefs(): void {
    try {
      localStorage.setItem(LIST_PREFS_KEY, JSON.stringify({ filters: [...this.credentialFilters], sort: this.credentialSort }));
    } catch {
      // Stockage indisponible
    }
  }

  /* ── Clipboard Auto-Clear (Zero-Knowledge Hygiene) ────────────────────── */
  public async copyToClipboardWithAutoClear(text: string, label: string, isSensitive = false): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      if (isSensitive) {
        if (this.clipboardClearTimer) window.clearTimeout(this.clipboardClearTimer);
        const clearNotice = this.tr(`${label}, effacé du presse-papiers dans 30 s`, `${label}, cleared from clipboard in 30 s`);
        this.showToast(clearNotice, 'success');

        this.clipboardClearTimer = window.setTimeout(async () => {
          try {
            const currentClip = await navigator.clipboard.readText().catch(() => '');
            if (currentClip === text) {
              await navigator.clipboard.writeText('');
              this.showToast(this.tr('Presse-papiers vidé', 'Clipboard cleared'), 'info', 2000);
            }
          } catch {
            // Ignorer si permission non accordée
          }
        }, 30000);
      } else {
        this.showToast(label, 'success');
      }
    } catch (err) {
      this.showToast(this.tr('Copie impossible', 'Copy failed'), 'error');
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
      // Échap : fermer la fenêtre ouverte (toujours actif, non modifiable)
      if (e.key === 'Escape') {
        const overlay = document.getElementById('modal-overlay');
        if (overlay && this.modalDismissible) {
          e.preventDefault();
          this.closeModal();
        }
        return;
      }
      if (!accountService.isUnlocked() || this.recordingShortcut) return;
      const target = e.target as HTMLElement | null;
      const isInput = !!target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
      const combo = bindingFromEvent(e);
      if (!combo) return;
      const action = SHORTCUT_ORDER.find(a => this.shortcuts[a] === combo);
      if (!action) return;
      // Une touche seule (« ? ») ne se déclenche pas pendant la saisie ; seule la recherche reste accessible dans un champ
      if (isInput && (isPlainKey(combo) || action !== 'search')) return;
      // Une fenêtre ouverte garde la main, sauf pour l'aide et le verrouillage
      if (document.getElementById('modal-overlay') && action !== 'lock' && action !== 'help') return;
      e.preventDefault();
      this.runShortcut(action, searchInput);
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

    document.getElementById('btn-new-folder')?.addEventListener('click', () => {
      this.openFolderModal(undefined, this.activeFolderId ?? undefined);
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
      team: i18n.t.common.team,
      ...Object.fromEntries(vaultStore.getVaultTypes().map(type => [type.id, type.name]))
    };
    const SHARED_ICON = '<svg class="nav-shared-mark" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>';

    vaultListEl.innerHTML = '';
    data.vaults.forEach(vault => {
      const li = document.createElement('li');
      li.className = `nav-item ${vault.id === data.activeVaultId ? 'active' : ''}`;
      li.tabIndex = 0;
      const badge = vault.shared
        ? `<span class="vault-type-badge shared" title="${this.escapeHtml(this.tr(`Partagé par ${vault.shared.ownerEmail}`, `Shared by ${vault.shared.ownerEmail}`))}">${SHARED_ICON}${this.escapeHtml(this.roleLabel(vault.shared.role))}</span>`
        : `<span class="vault-type-badge ${vault.type}">${typeLabels[vault.type] ?? vault.type}</span>`;
      li.innerHTML = `
        <span class="nav-item-left">
          <span class="nav-vault-icon">${vault.icon ? renderItemIcon(vault.icon, 15) : VAULT_ICON}</span>
          <span>${this.escapeHtml(vault.name)}</span>
        </span>
        <span class="nav-item-right">
          ${badge}
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

    this.renderFolderSidebar();
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

    // Un dossier ouvert montre aussi le contenu de ses sous-dossiers
    const folderIds = this.activeFolderId ? new Set(vaultStore.folderSubtree(this.activeFolderId)) : null;
    const matchesFolder = (item: { folderId?: string }) =>
      !folderIds || (!!item.folderId && folderIds.has(item.folderId));

    const folderName = this.activeFolderId ? vaultStore.getFolder(this.activeFolderId)?.name : undefined;
    const withTag = (title: string) => {
      const parts = [title, folderName, this.activeTag].filter(Boolean);
      return parts.join(' · ');
    };

    const taskToggle = document.getElementById('task-view-toggle');
    if (taskToggle) {
      taskToggle.style.display = this.activeView === 'tasks' ? 'flex' : 'none';
    }

    if (this.activeView === 'tasks') {
      const filterBar = document.getElementById('filter-bar');
      if (filterBar) filterBar.hidden = true;
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
            <div class="record-title" title="${this.escapeHtml(task.title)}" style="${isDone ? 'text-decoration:line-through;opacity:0.5;' : ''}">${this.escapeHtml(task.title)}</div>
            <div class="record-sub">${task.dueDate ? i18n.formatRelativeDate(task.dueDate) : statusSub}</div>
          </div>
          <div class="record-badges">
            ${task.status === 'blocked' ? `<span class="badge" style="color:var(--accent-red);border-color:rgba(218,54,51,0.4);" title="${this.tr('Bloquée par des dépendances', 'Blocked by dependencies')}">${this.tr('BLOQ', 'BLK')}</span>` : ''}
            ${task.recurrence ? `<span class="badge" style="color:var(--accent-purple);" title="${describeRecurrence(task.recurrence, i18n.getLocale() === 'fr' ? 'fr' : 'en')}">${this.tr('RÉC', 'REC')}</span>` : ''}
            ${task.reminderAt && !task.reminderSent && task.status !== 'completed' ? `<span class="badge" style="color:var(--accent-orange);" title="${new Date(task.reminderAt).toLocaleString(i18n.intlLocale())}">${this.tr('RAP', 'REM')}</span>` : ''}
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

    const vaultCreds = data.credentials.filter(c =>
      c.vaultId === data.activeVaultId
      && matchesFolder(c)
      && (this.activeView !== '2fa-tokens' || !!c.totpSecret));
    const creds = queryCredentials(vaultCreds, {
      search: this.searchQuery,
      filters: this.credentialFilters,
      sort: this.credentialSort,
      tag: this.activeTag
    });
    this.renderFilterBar(vaultCreds);

    /** Chemin du dossier ouvert, posé en tête de liste une fois celle-ci rendue */
    const addBreadcrumb = () => {
      if (!this.activeFolderId) return;
      container.insertAdjacentHTML('afterbegin', this.renderFolderBreadcrumb());
      container.querySelector('.folder-breadcrumb')?.addEventListener('click', event => {
        const crumb = (event.target as HTMLElement).closest<HTMLElement>('[data-folder-crumb]');
        if (!crumb) return;
        this.activeFolderId = crumb.dataset.folderCrumb || null;
        this.selectedItemId = null;
        this.renderSidebar();
        this.renderList();
        this.renderDetail(null);
      });
    };

    if (creds.length === 0) {
      const filtered = this.credentialFilters.size > 0;
      const title = filtered
        ? this.tr('Aucun identifiant pour ces filtres', 'No credentials match these filters')
        : this.searchQuery ? i18n.t.common.noResultsTitle : i18n.t.common.emptyVaultTitle;
      const sub = filtered ? '' : this.searchQuery ? i18n.t.common.noResultsSub : i18n.t.common.emptyVaultSub;
      container.innerHTML = `
        <div class="empty-state">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
          <div class="empty-state-title">${title}</div>
          ${sub ? `<div class="empty-state-sub">${sub}</div>` : ''}
          ${filtered ? `<button class="btn-primary" type="button" data-action="reset-filters">${this.tr('Retirer les filtres', 'Clear filters')}</button>` : ''}
        </div>`;
      container.querySelector('[data-action="reset-filters"]')?.addEventListener('click', () => {
        this.credentialFilters.clear();
        this.saveListPrefs();
        this.renderList();
      });
      addBreadcrumb();
      return;
    }

    if (!this.selectedItemId && creds.length > 0) {
      this.selectedItemId = creds[0].id;
      this.renderDetail(creds[0].id);
    }

    const now = Date.now();
    const locale = this.dateLocale();
    const tr = (fr: string, en: string) => this.tr(fr, en);

    creds.forEach(cred => {
      const row = document.createElement('div');
      row.className = `record-row ${this.selectedItemId === cred.id ? 'selected' : ''}`;
      row.tabIndex = 0;
      const expiry = renderExpiryBadge(expiryInfo(cred.expiresAt, tr, locale, now), { hideOk: true });

      row.innerHTML = `
        <div class="record-icon">${this.credentialIcon(cred)}</div>
        <div class="record-info">
          <div class="record-title">${cred.isFavorite ? `<span class="record-fav" title="${this.tr('Favori', 'Favorite')}">★</span>` : ''}${this.escapeHtml(cred.title)}</div>
          <div class="record-sub">${this.escapeHtml(this.itemSubtitle(cred))}</div>
        </div>
        <div class="record-badges">
          ${itemTypeOf(cred.type) === 'login' ? '' : this.typeBadge(itemTypeOf(cred.type))}
          ${expiry}
          ${cred.totpSecret ? '<span class="badge badge-accent">2FA</span>' : ''}
          ${cred.passkeys && cred.passkeys.length > 0 ? '<span class="badge">Passkey</span>' : ''}
        </div>
      `;

      const open = () => {
        this.selectedItemId = cred.id;
        this.renderList();
        this.renderDetail(cred.id);
        document.getElementById('detail-container')?.classList.add('mobile-active');
      };
      row.addEventListener('click', open);
      row.addEventListener('keydown', e => {
        if (e.key === 'Enter') open();
      });
      container.appendChild(row);
    });

    addBreadcrumb();
  }

  /* ── Filtres et tri de la liste ─────────────────────────────────────── */
  private renderFilterBar(creds: CredentialItem[]): void {
    const bar = document.getElementById('filter-bar');
    if (!bar) return;
    bar.hidden = creds.length === 0 && this.credentialFilters.size === 0;
    if (bar.hidden) return;

    const counts = countByFilter(creds);
    const labels: Record<CredentialFilter, string> = {
      favorites: this.tr('Favoris', 'Favorites'),
      totp: '2FA',
      passkeys: 'Passkeys',
      expiring: this.tr('Expire bientôt', 'Expiring soon'),
      expired: this.tr('Expirés', 'Expired'),
      weak: this.tr('Faibles', 'Weak'),
      reused: this.tr('Réutilisés', 'Reused'),
      noPassword: this.tr('Sans mot de passe', 'No password')
    };
    const visible = CREDENTIAL_FILTERS
      .filter(f => this.activeView !== '2fa-tokens' || f !== 'totp')
      .filter(f => counts[f] > 0 || this.credentialFilters.has(f));
    const sorts: Array<[CredentialSort, string]> = [
      ['name', this.tr('Trier : nom', 'Sort: name')],
      ['updated', this.tr('Trier : modifiés', 'Sort: updated')],
      ['recent', this.tr('Trier : ajoutés', 'Sort: added')],
      ['expiry', this.tr('Trier : expiration', 'Sort: expiry')]
    ];

    bar.innerHTML = `
      ${visible.map(f => {
        const active = this.credentialFilters.has(f);
        return `<button type="button" class="filter-chip ${active ? 'active' : ''}" data-filter="${f}" aria-pressed="${active}">${labels[f]}<span class="filter-chip-count">${counts[f]}</span></button>`;
      }).join('')}
      ${this.credentialFilters.size ? `<button type="button" class="btn-primary btn-ghost filter-reset" data-action="reset">${this.tr('Effacer', 'Clear')}</button>` : ''}
      <select class="form-input filter-sort" aria-label="${this.tr('Trier', 'Sort')}">
        ${sorts.map(([value, label]) => `<option value="${value}" ${value === this.credentialSort ? 'selected' : ''}>${label}</option>`).join('')}
      </select>`;

    bar.onclick = e => {
      const target = e.target as HTMLElement;
      const filter = target.closest<HTMLElement>('[data-filter]')?.dataset.filter as CredentialFilter | undefined;
      if (filter) {
        if (this.credentialFilters.has(filter)) this.credentialFilters.delete(filter);
        else this.credentialFilters.add(filter);
      } else if (target.closest('[data-action="reset"]')) {
        this.credentialFilters.clear();
      } else {
        return;
      }
      this.selectedItemId = null;
      this.saveListPrefs();
      this.renderList();
      this.renderDetail(this.selectedItemId);
    };
    (bar.querySelector('.filter-sort') as HTMLSelectElement).onchange = e => {
      this.credentialSort = (e.target as HTMLSelectElement).value as CredentialSort;
      this.saveListPrefs();
      this.renderList();
    };
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
              <span class="field-val">${new Date(task.reminderAt).toLocaleString(i18n.intlLocale())}</span>
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
              <div class="detail-meta">${this.tr('Créée le', 'Created')} ${new Date(task.createdAt).toLocaleDateString(i18n.intlLocale())}</div>
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
            <div class="field-label">${this.tr('Statut et priorité', 'Status and priority')}</div>
            <div class="field-box">
              <span class="field-val" style="color:${statusColors[task.status]};">${statusLabels[task.status] || task.status}</span>
              <span class="badge priority-${task.priority}">${task.priority.toUpperCase()}</span>
            </div>
          </div>

          ${task.dueDate ? `
            <div class="field-group">
              <div class="field-label">${this.tr('Échéance', 'Due date')}</div>
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
              <div class="section-divider" style="margin-bottom:8px;">${this.tr('Identifiant lié', 'Linked credential')}</div>
              <div class="field-box" style="cursor:pointer;" id="btn-goto-linked-cred">
                <div style="display:flex;align-items:center;gap:10px;">
                  <span style="display:flex;">${this.credentialIcon(linkedCred)}</span>
                  <span class="field-val" style="font-weight:600;">${this.escapeHtml(linkedCred.title)}</span>
                </div>
                <span style="font-size:11px;color:var(--accent-blue);">${this.tr('Ouvrir', 'Open')} →</span>
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
                  <button class="icon-btn btn-del-subtask" data-subtask-id="${s.id}" title="${this.tr('Supprimer', 'Delete')}" style="color:var(--text-muted);padding:2px 4px;">
                    ✕
                  </button>
                </div>
              `).join('')}
            </div>
            <div class="subtask-add-row">
              <input class="form-input" id="input-new-subtask" type="text" placeholder="${this.tr('Ajouter une étape…', 'Add a step…')}" style="flex:1;font-size:12px;padding:6px 10px;">
              <button class="btn-primary" id="btn-add-subtask" style="font-size:11px;padding:6px 12px;">${this.tr('Ajouter', 'Add')}</button>
            </div>
          </div>

          <div class="field-group">
            <div class="section-divider" style="margin-bottom:8px;">Notes</div>
            <textarea class="note-editor" id="task-notes" placeholder="${this.tr('Notes sur cette tâche…', 'Notes about this task…')}">${task.notes || ''}</textarea>
            <div style="display:flex;justify-content:flex-end;margin-top:6px;">
              <button class="btn-primary" id="btn-save-task-notes" style="font-size:11px;padding:5px 14px;">${this.tr('Enregistrer', 'Save')}</button>
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
          this.showToast(this.tr('Tâche supprimée', 'Task deleted'), 'info');
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
          this.showToast(this.tr('Notes enregistrées', 'Notes saved'), 'success');
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
      : `<div style="font-size:12px;color:var(--text-muted);padding:6px 0;">${this.tr('Aucune tâche liée', 'No linked tasks')}</div>`;

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
        <div class="field-label">${this.tr('Code 2FA', '2FA code')}</div>
        <div class="totp-card" id="detail-totp-container" style="cursor:pointer;" title="${this.tr('Cliquer pour copier', 'Click to copy')}">
          <div>
            <div class="totp-code-display" id="detail-totp-code">--- ---</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${this.tr('Cliquer pour copier', 'Click to copy')}</div>
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
        <div class="field-label">${this.tr('Site web', 'Website')}</div>
        <div class="field-box">
          <a href="${cred.website}" target="_blank" rel="noopener noreferrer"
            style="color:var(--accent-blue);text-decoration:none;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">
            ${cred.website}
          </a>
          <div class="field-actions">
            <button class="icon-btn" title="${this.tr('Copier le lien', 'Copy link')}" id="btn-copy-url">
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
    const expiry = expiryInfo(cred.expiresAt, (fr, en) => this.tr(fr, en), this.dateLocale());
    if (expiry) {
      const title = expiry.state === 'expired'
        ? this.tr('Mot de passe expiré', 'Password expired')
        : expiry.state === 'ok' ? this.tr('Renouvellement prévu', 'Renewal planned') : this.tr('À renouveler bientôt', 'Renew soon');
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
          ${expiry.state !== 'ok' ? `<button class="btn-primary" type="button" id="btn-renew-cred">${this.tr('Renouveler', 'Renew')}</button>` : ''}
        </div>
      `;
    }

    container.innerHTML = `
      <div class="detail-header">
        <div class="detail-header-left">
          <button class="detail-mobile-back" id="btn-detail-back-cred" title="${this.tr('Retour', 'Back')}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            <span>${this.tr('Retour', 'Back')}</span>
          </button>
          <div class="detail-main-icon">${this.credentialIcon(cred, 24)}</div>
          <div>
            <div class="detail-title">${this.escapeHtml(cred.title)}</div>
            <div class="detail-meta">${detailType === 'login'
              ? this.escapeHtml(cred.domain || cred.website || this.tr('Aucun site', 'No website'))
              : this.typeBadge(detailType)}</div>
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
        ${this.renderTypeDetail(cred)}
        ${detailType !== 'login' ? '' : `
        ${totpHTML}

        <div class="field-group">
          <div class="field-label">${this.tr('Identifiant', 'Username')}</div>
          <div class="field-box">
            <span class="field-val" id="text-username">${cred.username || '—'}</span>
            <div class="field-actions">
              <button class="icon-btn" title="${this.tr('Copier', 'Copy')}" id="btn-copy-username">
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
            <span class="field-label">${this.tr('Mot de passe', 'Password')}</span>
            <span style="font-size:11px;color:${entropy.color};font-weight:600;">${entropy.label} &middot; ${entropy.bits} bits</span>
          </div>
          <div class="field-box">
            <span class="field-val" id="text-password" style="font-family:var(--font-mono);letter-spacing:1px;">&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;</span>
            <div class="field-actions">
              <button class="icon-btn" title="${this.tr('Afficher', 'Show')}" id="btn-toggle-password">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </button>
              <button class="icon-btn" title="${this.tr('Copier', 'Copy')}" id="btn-copy-password">
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

        ${cred.passwordHistory && cred.passwordHistory.length > 0 ? `
          <div class="field-group">
            <div class="section-divider" style="margin-bottom:8px;">${this.tr('Anciens mots de passe', 'Previous passwords')} (${cred.passwordHistory.length})</div>
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${cred.passwordHistory.map(h => `
                <div class="history-entry">
                  <span class="history-password">&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;</span>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <span class="history-date">${new Date(h.changedAt).toLocaleDateString(i18n.intlLocale())}</span>
                    <button class="icon-btn btn-copy-history" data-pwd="${h.password.replace(/"/g, '&quot;')}" title="${this.tr('Copier cet ancien mot de passe', 'Copy this previous password')}">
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
          <div class="section-divider" style="margin-bottom:8px;">${this.tr('Champs personnalisés', 'Custom fields')} (${(cred.fields || []).length})</div>
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
                      <button class="icon-btn btn-reveal-cf" data-cf-id="${f.id}" data-val="${f.value.replace(/"/g, '&quot;')}" title="${this.tr('Afficher', 'Show')}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                      </button>
                    ` : ''}
                    <button class="icon-btn btn-copy-cf" data-val="${f.value.replace(/"/g, '&quot;')}" title="${this.tr('Copier', 'Copy')}">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </button>
                    <button class="icon-btn btn-del-cf" data-cf-id="${f.id}" title="${this.tr('Supprimer', 'Delete')}" style="color:var(--text-muted);">
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

        ${this.renderAttachments(cred)}

        <div class="field-group">
          <div class="section-divider" style="margin-bottom:8px;">${this.tr('Tâches liées', 'Linked tasks')} (${linkedTasks.length})</div>
          ${linkedTasksHTML}
        </div>

        <div class="field-group">
          <div class="section-divider" style="margin-bottom:8px;">Notes</div>
          <textarea class="note-editor" id="inline-notes" placeholder="${this.tr('Codes de récupération, informations utiles…', 'Recovery codes, useful details…')}">${cred.notes || ''}</textarea>
          <div style="display:flex;justify-content:flex-end;margin-top:6px;">
            <button class="btn-primary" id="btn-save-notes" style="font-size:11px;padding:5px 14px;">${this.tr('Enregistrer', 'Save')}</button>
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
      this.showToast(cred.isFavorite ? this.tr('Retiré des favoris', 'Removed from favorites') : this.tr('Ajouté aux favoris', 'Added to favorites'), 'info');
    });

    document.getElementById('btn-save-notes')?.addEventListener('click', () => {
      const notesEl = document.getElementById('inline-notes') as HTMLTextAreaElement;
      if (notesEl) {
        vaultStore.updateCredential(cred.id, { notes: notesEl.value });
        this.showToast(this.tr('Notes enregistrées', 'Notes saved'), 'success');
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
      if (!this.canEdit(cred.vaultId)) return;
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
        // Les fichiers chiffrés de l'identifiant sont retirés du serveur
        for (const file of cred.attachments ?? []) {
          void accountService.withCloud(client => client.deleteAttachment(file.id)).catch(() => undefined);
        }
        vaultStore.deleteCredential(cred.id);
        this.selectedItemId = null;
        this.renderDetail(null);
        this.showToast(this.tr('Identifiant supprimé', 'Credential deleted'), 'info');
      }
    });

    document.getElementById('btn-edit-cred')?.addEventListener('click', () => {
      this.openCreateCredentialModal(cred.id);
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
        button.title = shown ? this.tr('Afficher', 'Show') : this.tr('Masquer', 'Hide');
        return;
      }

      if (target.closest('[data-secret-copy]')) {
        const sensitive = (target.closest('[data-secret-copy]') as HTMLElement).dataset.sensitive === 'true';
        await this.copyToClipboardWithAutoClear(secret, this.tr('Copié', 'Copied'), sensitive);
      }
    });

    document.getElementById('btn-renew-cred')?.addEventListener('click', () => {
      this.openCreateCredentialModal(cred.id, { renew: true });
    });

    document.querySelectorAll('.btn-copy-history').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const pwd = (el as HTMLElement).dataset.pwd;
        if (pwd) {
          await navigator.clipboard.writeText(pwd);
          this.showToast(this.tr('Ancien mot de passe copié', 'Previous password copied'), 'success');
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
        this.showToast(this.tr('Champ ajouté', 'Field added'), 'success');
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
          this.showToast(this.tr('Valeur copiée', 'Value copied'), 'success');
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

    this.bindAttachments(container, cred);

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
  private openModal(htmlContent: string, options: { dismissible?: boolean } = {}): HTMLElement {
    const container = document.getElementById('modal-container');
    if (!container) return document.createElement('div');
    if (!container.firstElementChild) this.modalReturnFocus = document.activeElement as HTMLElement | null;
    this.modalDismissible = options.dismissible !== false;

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
      if (pressedOnBackdrop && e.target === overlay && this.modalDismissible) this.closeModal();
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
  private openCreateCredentialModal(existingCredId?: string, options: { renew?: boolean } = {}): void {
    const data = vaultStore.getData();
    const existing = existingCredId ? data.credentials.find(c => c.id === existingCredId) : null;
    const isEdit = !!existing;
    const limits = accountService.getLimits();
    const tr = (fr: string, en: string) => this.tr(fr, en);
    const attr = (value?: string) => this.escapeHtml(value ?? '');
    if (!this.canEdit(existing?.vaultId ?? data.activeVaultId)) return;

    if (!isEdit && remainingCapacity(data, data.activeVaultId, limits).credentials === 0) {
      this.showToast(tr(`Ce coffre contient déjà ${limits.maxCredentialsPerVault} identifiants, la limite du serveur`, `This vault already holds ${limits.maxCredentialsPerVault} credentials, the server limit`), 'error');
      return;
    }

    const SECTION = {
      login: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/></svg>',
      shield: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
      folder: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5"/></svg>',
      note: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>',
      scan: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/></svg>'
    };

    const pad = (n: number) => String(n).padStart(2, '0');
    const expiresValue = existing?.expiresAt
      ? (() => { const d = new Date(existing.expiresAt!); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })()
      : '';

    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title">${isEdit ? tr('Modifier l’élément', 'Edit item') : tr('Nouvel élément', 'New item')}</div>
        <button class="modal-close" type="button">${GEN_ICONS.close}</button>
      </div>
      <div class="modal-body">
        <div id="cred-steps"></div>
        <div class="cred-form">
          <section data-step="type" hidden>
            <p class="modal-text">${tr('Que voulez-vous ranger dans le coffre ?', 'What do you want to keep in the vault?')}</p>
            <div class="type-grid" id="cred-type-grid" role="group"></div>
          </section>

          <section data-step="essentiel" hidden>
          <div class="cred-identity">
            <button type="button" class="cred-icon-button" id="cred-icon-btn" aria-expanded="false" aria-controls="cred-icon-panel" title="${tr('Choisir une icône', 'Choose an icon')}" aria-label="${tr('Choisir une icône', 'Choose an icon')}">
              <span id="cred-icon-preview" style="display:flex;"></span>
              <span class="cred-icon-edit">${ACTION_ICONS.edit}</span>
            </button>
            <div class="form-field">
              <label class="form-label" for="field-title">${tr('Nom', 'Name')}</label>
              <input class="form-input cred-title-input" id="field-title" type="text" maxlength="${limits.maxTitleLength}" placeholder="GitHub, Netflix, Banque…" value="${attr(existing?.title)}" autocomplete="off" data-autofocus>
            </div>
          </div>
          <div id="cred-icon-panel" hidden></div>

          <section class="form-section" id="section-login">
            <div class="form-section-title">${SECTION.login}${tr('Connexion', 'Sign-in')}</div>
            <div class="form-row">
              <div class="form-field">
                <label class="form-label" for="field-username">${tr('Identifiant ou email', 'Username or email')}</label>
                <input class="form-input" id="field-username" type="text" maxlength="${limits.maxUsernameLength}" placeholder="nom@exemple.fr" value="${attr(existing?.username)}" autocomplete="off" spellcheck="false">
              </div>
              <div class="form-field">
                <label class="form-label" for="field-website">${tr('Site web', 'Website')}</label>
                <input class="form-input" id="field-website" type="url" maxlength="${limits.maxUrlLength}" placeholder="https://exemple.fr" value="${attr(existing?.website)}" autocomplete="off" spellcheck="false">
              </div>
            </div>
            <div class="form-field">
              <label class="form-label" for="field-password">${tr('Mot de passe', 'Password')}</label>
              <div class="input-with-actions">
                <input class="form-input" id="field-password" type="password" maxlength="${limits.maxPasswordLength}" value="${attr(existing?.password)}" autocomplete="new-password" spellcheck="false">
                <button type="button" class="icon-btn" id="btn-toggle-field-password" aria-pressed="false" title="${tr('Afficher', 'Show')}">${GEN_ICONS.eye}</button>
              </div>
              <div class="field-inline-row">
                <div class="gen-strength" id="field-password-strength">
                  <div class="strength-meter">${'<div class="strength-segment"></div>'.repeat(4)}</div>
                  <span class="gen-strength-label"></span>
                </div>
                <button type="button" class="btn-primary btn-ghost" id="btn-gen-pwd" aria-expanded="false" aria-controls="cred-gen-panel">${GEN_ICONS.bolt}<span>${tr('Générer', 'Generate')}</span></button>
              </div>
              <div id="cred-gen-panel" class="gen-inline" hidden></div>
            </div>
          </section>

          <section class="form-section" id="section-card" hidden>
            <div class="form-section-title">${SECTION.login}${tr('Carte', 'Card')}</div>
            <div class="form-field">
              <label class="form-label" for="field-card-number">${tr('Numéro', 'Number')}</label>
              <div class="input-with-actions">
                <input class="form-input mono-field" id="field-card-number" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="4111 1111 1111 1111" value="${attr(existing?.card?.number)}">
                <button type="button" class="icon-btn" id="btn-toggle-card-number" aria-pressed="false" title="${tr('Afficher', 'Show')}">${GEN_ICONS.eye}</button>
              </div>
              <span class="field-hint" id="card-brand-hint"></span>
            </div>
            <div class="form-field">
              <label class="form-label" for="field-card-holder">${tr('Titulaire', 'Cardholder')}</label>
              <input class="form-input" id="field-card-holder" type="text" maxlength="100" autocomplete="off" value="${attr(existing?.card?.holder)}">
            </div>
            <div class="form-row">
              <div class="form-field">
                <label class="form-label" for="field-card-exp-month">${tr('Expiration', 'Expiry')}</label>
                <div class="form-row">
                  <input class="form-input" id="field-card-exp-month" type="text" inputmode="numeric" maxlength="2" placeholder="MM" autocomplete="off" value="${attr(existing?.card?.expMonth)}">
                  <input class="form-input" id="field-card-exp-year" type="text" inputmode="numeric" maxlength="4" placeholder="${tr('AAAA', 'YYYY')}" autocomplete="off" value="${attr(existing?.card?.expYear)}">
                </div>
              </div>
              <div class="form-field">
                <label class="form-label" for="field-card-cvv">${tr('Cryptogramme', 'Security code')}</label>
                <input class="form-input mono-field" id="field-card-cvv" type="password" inputmode="numeric" maxlength="4" autocomplete="off" value="${attr(existing?.card?.cvv)}">
              </div>
              <div class="form-field">
                <label class="form-label" for="field-card-pin">${tr('Code', 'PIN')}</label>
                <input class="form-input mono-field" id="field-card-pin" type="password" inputmode="numeric" maxlength="12" autocomplete="off" value="${attr(existing?.card?.pin)}">
              </div>
            </div>
          </section>

          <section class="form-section" id="section-identity" hidden>
            <div class="form-section-title">${SECTION.login}${tr('Identité', 'Identity')}</div>
            <div class="form-row">
              <div class="form-field">
                <label class="form-label" for="field-id-first">${tr('Prénom', 'First name')}</label>
                <input class="form-input" id="field-id-first" type="text" maxlength="100" autocomplete="off" value="${attr(existing?.identity?.firstName)}">
              </div>
              <div class="form-field">
                <label class="form-label" for="field-id-last">${tr('Nom de famille', 'Last name')}</label>
                <input class="form-input" id="field-id-last" type="text" maxlength="100" autocomplete="off" value="${attr(existing?.identity?.lastName)}">
              </div>
            </div>
            <div class="form-row">
              <div class="form-field">
                <label class="form-label" for="field-id-birth">${tr('Date de naissance', 'Date of birth')}</label>
                <input class="form-input" id="field-id-birth" type="date" autocomplete="off" value="${attr(existing?.identity?.birthDate)}">
              </div>
              <div class="form-field">
                <label class="form-label" for="field-id-doc">${tr('Numéro de pièce', 'Document number')}</label>
                <input class="form-input mono-field" id="field-id-doc" type="password" maxlength="60" autocomplete="off" value="${attr(existing?.identity?.docNumber)}">
              </div>
            </div>
            <div class="form-row">
              <div class="form-field">
                <label class="form-label" for="field-id-email">Email</label>
                <input class="form-input" id="field-id-email" type="email" maxlength="200" autocomplete="off" spellcheck="false" value="${attr(existing?.identity?.email)}">
              </div>
              <div class="form-field">
                <label class="form-label" for="field-id-phone">${tr('Téléphone', 'Phone')}</label>
                <input class="form-input" id="field-id-phone" type="tel" maxlength="40" autocomplete="off" value="${attr(existing?.identity?.phone)}">
              </div>
            </div>
            <div class="form-field">
              <label class="form-label" for="field-id-address">${tr('Adresse', 'Address')}</label>
              <input class="form-input" id="field-id-address" type="text" maxlength="200" autocomplete="off" value="${attr(existing?.identity?.address)}">
            </div>
            <div class="form-row">
              <div class="form-field">
                <label class="form-label" for="field-id-postal">${tr('Code postal', 'Postal code')}</label>
                <input class="form-input" id="field-id-postal" type="text" maxlength="20" autocomplete="off" value="${attr(existing?.identity?.postalCode)}">
              </div>
              <div class="form-field">
                <label class="form-label" for="field-id-city">${tr('Ville', 'City')}</label>
                <input class="form-input" id="field-id-city" type="text" maxlength="100" autocomplete="off" value="${attr(existing?.identity?.city)}">
              </div>
              <div class="form-field">
                <label class="form-label" for="field-id-country">${tr('Pays', 'Country')}</label>
                <input class="form-input" id="field-id-country" type="text" maxlength="100" autocomplete="off" value="${attr(existing?.identity?.country)}">
              </div>
            </div>
          </section>

          <section class="form-section" id="section-ssh" hidden>
            <div class="form-section-title">${SECTION.shield}${tr('Clé', 'Key')}</div>
            <div class="form-field">
              <label class="form-label" for="field-ssh-private">${tr('Clé privée', 'Private key')}</label>
              <textarea class="key-editor" id="field-ssh-private" spellcheck="false" autocomplete="off" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----">${attr(existing?.sshKey?.privateKey)}</textarea>
              <span class="field-hint" id="ssh-key-hint"></span>
            </div>
            <div class="form-field">
              <label class="form-label" for="field-ssh-passphrase">${tr('Phrase de passe de la clé', 'Key passphrase')}</label>
              <input class="form-input" id="field-ssh-passphrase" type="password" autocomplete="off" spellcheck="false" value="${attr(existing?.sshKey?.passphrase)}">
            </div>
            <div class="form-field">
              <label class="form-label" for="field-ssh-public">${tr('Clé publique', 'Public key')}</label>
              <textarea class="key-editor" id="field-ssh-public" spellcheck="false" autocomplete="off" placeholder="ssh-ed25519 AAAA…">${attr(existing?.sshKey?.publicKey)}</textarea>
            </div>
          </section>

          <section class="form-section" id="section-files" hidden>
            <div class="form-section-title">${SECTION.folder}${tr('Contenu', 'Contents')}</div>
            <div id="files-host"></div>
          </section>

          </section>

          <section data-step="securite" hidden>
          <section class="form-section">
            <div class="form-section-head">
              <div class="form-section-title">${SECTION.shield}${tr('Double authentification', 'Two-factor authentication')}</div>
              <button class="btn-primary btn-ghost" id="btn-scan-qr" type="button">${SECTION.scan}<span>${tr('Scanner un QR code', 'Scan a QR code')}</span></button>
            </div>
            <div class="form-field">
              <label class="form-label" for="field-totp">${tr('Clé de configuration', 'Setup key')}</label>
              <input class="form-input" id="field-totp" type="text" placeholder="${tr('Clé ou lien otpauth://', 'Key or otpauth:// link')}" value="${attr(existing?.totpSecret)}" autocomplete="off" spellcheck="false">
              <div class="totp-preview" id="totp-preview" hidden></div>
            </div>
            <div id="qr-scan-panel" hidden>
              <video id="qr-video" playsinline muted style="width:100%;max-height:220px;border-radius:var(--radius-md);background:#000;object-fit:cover;"></video>
              <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap;">
                <label class="btn-primary" style="cursor:pointer;">
                  ${tr('Importer une image', 'Upload an image')}
                  <input type="file" id="qr-image-input" accept="image/*" hidden>
                </label>
                <span id="qr-scan-status" class="field-hint"></span>
              </div>
            </div>
          </section>
          </section>

          <section data-step="details" hidden>
          <section class="form-section">
            <div class="form-section-title">${SECTION.folder}${tr('Organisation', 'Organization')}</div>
            <div class="form-row">
              <div class="form-field">
                <label class="form-label">Tags</label>
                <div id="field-tags"></div>
              </div>
              <div class="form-field">
                <label class="form-label">${tr('Expiration du mot de passe', 'Password expiry')}</label>
                <div id="field-expires"></div>
              </div>
            </div>
            <div class="form-row">
              <div class="form-field">
                <label class="form-label" for="field-folder">${tr('Dossier', 'Folder')}</label>
                <select class="form-input" id="field-folder">
                  <option value="">${tr('Aucun dossier', 'No folder')}</option>
                  ${vaultStore.getFolders().map(f => {
                    const path = vaultStore.folderPath(f.id).map(x => x.name).join(' / ');
                    const selected = (existing?.folderId ?? this.activeFolderId) === f.id;
                    return `<option value="${f.id}" ${selected ? 'selected' : ''}>${this.escapeHtml(path)}</option>`;
                  }).join('')}
                </select>
              </div>
            </div>
            <label class="switch-row">
              <span>${tr('Favori', 'Favorite')}<small>${tr('Affiché en haut de la liste', 'Shown at the top of the list')}</small></span>
              <input type="checkbox" class="switch" id="field-favorite" ${existing?.isFavorite ? 'checked' : ''}>
            </label>
            <div class="form-field" id="attachments-field">
              <label class="form-label" id="attachments-label">${tr('Pièces jointes', 'Attachments')}</label>
              ${accountService.isCloud() ? `
                <div class="pending-files" id="field-files"></div>
                <label class="btn-primary btn-ghost" style="align-self:flex-start;cursor:pointer;">+ ${tr('Ajouter un fichier', 'Add a file')}<input type="file" id="field-files-input" multiple hidden></label>
                <span class="field-hint">${tr('Chiffrés sur cet appareil, puis envoyés à votre serveur.', 'Encrypted on this device, then uploaded to your server.')}</span>`
                : `<span class="field-hint">${tr('Les pièces jointes demandent un compte synchronisé.', 'Attachments need a synced account.')}</span>`}
            </div>
          </section>

          <section class="form-section" id="section-notes">
            <div class="form-section-title">${SECTION.note}Notes</div>
            <textarea class="note-editor" id="field-notes" placeholder="${tr('Codes de récupération, questions de sécurité…', 'Recovery codes, security questions…')}">${attr(existing?.notes)}</textarea>
            <span class="char-counter" id="notes-counter"></span>
          </section>
          </section>

          <div class="form-error" id="cred-form-error" role="alert" hidden></div>
        </div>
      </div>
      <div class="modal-footer stepper-footer" id="cred-footer"></div>
    `);
    box.classList.add('modal-lg');

    const $ = <T extends HTMLElement>(selector: string) => box.querySelector(selector) as T;

    /* ── Type de l'élément : il décide des champs affichés et des étapes ── */
    let itemType: ItemType = itemTypeOf(existing?.type);
    // Tant que rien n'est choisi, la modale reste neutre : « identifiant » n'est qu'une présélection
    let typeChosen = isEdit;

    const typeGrid = $<HTMLElement>('#cred-type-grid');
    const renderTypeGrid = () => {
      typeGrid.innerHTML = ITEM_TYPES.map(type => {
        const info = ITEM_TYPE_INFO[type];
        return `<button type="button" class="type-card" data-type="${type}" aria-pressed="${type === itemType}">
          ${tabIcon(info.icon, 18)}
          <span class="type-card-text">
            <span class="type-card-name">${this.escapeHtml(tr(info.fr, info.en))}</span>
            <span class="type-card-hint">${this.escapeHtml(tr(info.hintFr, info.hintEn))}</span>
          </span>
        </button>`;
      }).join('');
    };
    const titleInput = $<HTMLInputElement>('#field-title');
    const websiteInput = $<HTMLInputElement>('#field-website');
    const usernameInput = $<HTMLInputElement>('#field-username');
    const totpInput = $<HTMLInputElement>('#field-totp');
    const notesInput = $<HTMLTextAreaElement>('#field-notes');
    const errorEl = $<HTMLElement>('#cred-form-error');

    // Icône : choisie dans une bibliothèque ou détectée depuis le site
    let chosenIcon: ItemIcon | undefined = existing?.icon;
    const iconButton = $<HTMLButtonElement>('#cred-icon-btn');
    const iconPanel = $<HTMLElement>('#cred-icon-panel');
    const updateIconPreview = () => {
      $<HTMLElement>('#cred-icon-preview').innerHTML = this.credentialIcon({ icon: chosenIcon, website: websiteInput.value, title: titleInput.value, type: itemType }, 28);
    };
    const closeIconPanel = () => {
      iconPanel.hidden = true;
      iconPanel.innerHTML = '';
      iconPanel.className = '';
      iconButton.setAttribute('aria-expanded', 'false');
    };
    iconButton.addEventListener('click', () => {
      if (!iconPanel.hidden) return closeIconPanel();
      iconPanel.hidden = false;
      iconButton.setAttribute('aria-expanded', 'true');
      const suggestion = chosenIcon ? '' : (extractDomain(websiteInput.value).split('.').slice(-2, -1)[0] || titleInput.value.trim());
      const picker = mountIconPicker(iconPanel, {
        tr,
        current: chosenIcon,
        initialQuery: suggestion,
        onPick: icon => {
          chosenIcon = icon;
          updateIconPreview();
          closeIconPanel();
          iconButton.focus();
        }
      });
      picker.focus();
    });
    titleInput.addEventListener('input', () => { if (!chosenIcon) updateIconPreview(); });
    websiteInput.addEventListener('input', () => { if (!chosenIcon) updateIconPreview(); });
    updateIconPreview();

    const tagInput = mountTagInput($<HTMLElement>('#field-tags'), {
      initial: existing?.tags ?? [],
      suggestions: vaultStore.getTags(),
      placeholder: tr('Ajouter un tag…', 'Add a tag…'),
      removeLabel: name => tr(`Retirer le tag ${name}`, `Remove tag ${name}`)
    });

    const expiresField = mountDateField($<HTMLElement>('#field-expires'), {
      value: expiresValue,
      label: tr('Expiration du mot de passe', 'Password expiry'),
      tr,
      locale: this.dateLocale(),
      describe: (days, formatted) => days < 0
        ? tr(`Expiré depuis ${-days} jour${days < -1 ? 's' : ''}`, `Expired ${-days} day${days < -1 ? 's' : ''} ago`)
        : days === 0 ? tr('Expire aujourd’hui', 'Expires today') : tr(`Expire dans ${days} jour${days > 1 ? 's' : ''} · ${formatted}`, `Expires in ${days} day${days > 1 ? 's' : ''} · ${formatted}`)
    });

    // Mot de passe : visibilité, force en direct et générateur intégré
    const pwdField = $<HTMLInputElement>('#field-password');
    const pwdStrength = $<HTMLElement>('#field-password-strength');
    const pwdVisibility = $<HTMLButtonElement>('#btn-toggle-field-password');
    const genPanel = $<HTMLElement>('#cred-gen-panel');
    const genToggle = $<HTMLButtonElement>('#btn-gen-pwd');

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
      pwdVisibility.title = visible ? tr('Masquer', 'Hide') : tr('Afficher', 'Show');
    };
    const toggleGenerator = (open: boolean) => {
      genPanel.hidden = !open;
      genToggle.setAttribute('aria-expanded', String(open));
      if (open && genPanel.childElementCount === 0) {
        this.mountGenerator(genPanel, {
          onUse: value => {
            pwdField.value = value;
            setPasswordVisible(true);
            updatePasswordStrength();
            toggleGenerator(false);
            pwdField.focus();
          }
        });
      }
    };

    pwdField.addEventListener('input', updatePasswordStrength);
    pwdVisibility.addEventListener('click', () => setPasswordVisible(pwdField.type === 'password'));
    genToggle.addEventListener('click', () => toggleGenerator(genPanel.hidden === true));
    updatePasswordStrength();
    if (options.renew) {
      toggleGenerator(true);
      expiresField.setValue('');
    }

    // Aperçu du code 2FA dès qu'une clé valide est saisie
    const totpPreview = $<HTMLElement>('#totp-preview');
    const updateTotpPreview = () => {
      const raw = totpInput.value.trim();
      if (!raw) {
        totpPreview.hidden = true;
        return;
      }
      const secret = normalizeTotpInput(raw);
      const code = secret ? generateTOTP(secret) : null;
      totpPreview.hidden = false;
      totpPreview.innerHTML = code
        ? `${tr('Code actuel', 'Current code')} <strong>${code.token.slice(0, 3)} ${code.token.slice(3)}</strong>`
        : `<span class="field-hint error">${tr('Clé non reconnue : collez la clé Base32 ou le lien otpauth://', 'Key not recognized: paste the Base32 key or the otpauth:// link')}</span>`;
    };
    totpInput.addEventListener('input', updateTotpPreview);
    const totpTimer = window.setInterval(() => {
      if (!box.isConnected) return window.clearInterval(totpTimer);
      if (!totpPreview.hidden) updateTotpPreview();
    }, 1000);
    updateTotpPreview();

    // Scan QR code 2FA (caméra ou image, décodage local)
    const qrPanel = $<HTMLElement>('#qr-scan-panel');
    const qrVideo = $<HTMLVideoElement>('#qr-video');
    const qrStatus = $<HTMLElement>('#qr-scan-status');
    let qrScanner: CameraQrScanner | null = null;

    const applyScannedOtp = (text: string): boolean => {
      const normalized = normalizeTotpInput(text);
      if (!normalized) {
        qrStatus.textContent = tr('Ce QR code ne contient pas de clé 2FA', 'This QR code has no 2FA key');
        qrStatus.classList.add('error');
        return false;
      }
      totpInput.value = normalized;
      const info = parseOtpAuthUri(text);
      if (info?.issuer && !titleInput.value) titleInput.value = info.issuer;
      if (info?.account && !usernameInput.value) usernameInput.value = info.account;
      qrScanner?.stop();
      qrPanel.hidden = true;
      updateTotpPreview();
      updateIconPreview();
      return true;
    };

    $<HTMLButtonElement>('#btn-scan-qr').addEventListener('click', async () => {
      if (!qrPanel.hidden) {
        qrScanner?.stop();
        qrPanel.hidden = true;
        return;
      }
      qrPanel.hidden = false;
      qrStatus.classList.remove('error');
      qrStatus.textContent = tr('Présentez le QR code à la caméra', 'Point the camera at the QR code');
      qrScanner = new CameraQrScanner(qrVideo);
      try {
        await qrScanner.start(text => { applyScannedOtp(text); });
      } catch {
        qrStatus.textContent = tr('Caméra indisponible : importez une capture du QR code', 'Camera unavailable: upload a screenshot of the QR code');
      }
    });

    $<HTMLInputElement>('#qr-image-input').addEventListener('change', async e => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await decodeQrFromFile(file);
        if (!text || !applyScannedOtp(text)) {
          qrStatus.textContent = tr('Aucun QR code 2FA trouvé dans l’image', 'No 2FA QR code found in the image');
          qrStatus.classList.add('error');
        }
      } catch {
        qrStatus.textContent = tr('Image illisible', 'Unreadable image');
        qrStatus.classList.add('error');
      }
    });

    // Compteur de caractères des notes (limite du serveur)
    const counter = $<HTMLElement>('#notes-counter');
    const updateCounter = () => {
      const length = notesInput.value.length;
      counter.textContent = `${length.toLocaleString(this.dateLocale())} / ${limits.maxNoteLength.toLocaleString(this.dateLocale())}`;
      counter.classList.toggle('over', length > limits.maxNoteLength);
      counter.hidden = length < limits.maxNoteLength * 0.5;
    };
    notesInput.addEventListener('input', updateCounter);
    updateCounter();

    const fail = (message: string, focus?: HTMLElement) => {
      errorEl.textContent = message;
      errorEl.hidden = false;
      focus?.focus();
    };

    const stopScanner = () => qrScanner?.stop();
    box.closest('.modal-overlay')?.addEventListener('click', e => {
      if ((e.target as HTMLElement).closest('.modal-close, [data-close]')) stopScanner();
    });

    // Fichiers choisis avant l'enregistrement : chiffrés et envoyés une fois l'identifiant créé
    const pendingFiles: File[] = [];
    const filesList = box.querySelector('#field-files') as HTMLElement | null;
    const renderPendingFiles = () => {
      if (!filesList) return;
      filesList.innerHTML = pendingFiles.map((file, index) => `
        <div class="pending-file">
          <span class="attachment-name">${this.escapeHtml(file.name)}</span>
          <span class="field-hint">${formatFileSize(file.size)}</span>
          <button type="button" class="icon-btn" data-remove-file="${index}" aria-label="${tr('Retirer', 'Remove')} ${this.escapeHtml(file.name)}">${GEN_ICONS.close}</button>
        </div>`).join('');
    };
    box.querySelector<HTMLInputElement>('#field-files-input')?.addEventListener('change', event => {
      const input = event.target as HTMLInputElement;
      for (const file of [...(input.files ?? [])]) {
        if (file.size > limits.maxAttachmentBytes) {
          this.showToast(tr(`${file.name} dépasse ${Math.round(limits.maxAttachmentBytes / 1048576)} Mo`, `${file.name} is larger than ${Math.round(limits.maxAttachmentBytes / 1048576)} MB`), 'error');
          continue;
        }
        pendingFiles.push(file);
      }
      input.value = '';
      renderPendingFiles();
    });
    filesList?.addEventListener('click', event => {
      const index = (event.target as HTMLElement).closest<HTMLElement>('[data-remove-file]')?.dataset.removeFile;
      if (index === undefined) return;
      pendingFiles.splice(Number(index), 1);
      renderPendingFiles();
    });

    /** Envoi des fichiers en attente, une fois l'identifiant enregistré */
    const uploadPendingFiles = async (credentialId: string, vaultId: string) => {
      if (!pendingFiles.length) return;
      const sharedId = sharedVaults.isShared(vaultId) ? vaultId : undefined;
      for (const file of pendingFiles) {
        try {
          const { payload, key } = await encryptFile(new Uint8Array(await file.arrayBuffer()));
          const uploaded = await accountService.withCloud(client => client.uploadAttachment(payload, sharedId));
          const meta: AttachmentMeta = { id: uploaded.id, name: file.name, size: file.size, type: file.type, key, createdAt: Date.now() };
          const current = vaultStore.getData().credentials.find(c => c.id === credentialId);
          vaultStore.updateCredential(credentialId, { attachments: [...(current?.attachments ?? []), meta] });
        } catch (err) {
          this.showToast(`${file.name} : ${accountErrorMessage(err)}`, 'error');
        }
      }
      if (this.selectedItemId === credentialId) this.renderDetail(credentialId);
    };

    /* ── Champs propres au type ──────────────────────────────────────── */
    const cardNumber = $<HTMLInputElement>('#field-card-number');
    const cardBrandHint = $<HTMLElement>('#card-brand-hint');
    const sshPrivate = $<HTMLTextAreaElement>('#field-ssh-private');
    const sshKeyHint = $<HTMLElement>('#ssh-key-hint');
    const notesSection = $<HTMLElement>('#section-notes');
    const attachmentsField = $<HTMLElement>('#attachments-field');
    const filesHost = $<HTMLElement>('#files-host');
    const detailsPanel = box.querySelector<HTMLElement>('[data-step="details"]') as HTMLElement;
    const organisationSection = detailsPanel.querySelector('.form-section') as HTMLElement;

    /**
     * Le numéro enregistré vit dans `cardDigits` ; le champ n'en montre qu'une version
     * mise en forme. Tant qu'il est masqué il est en lecture seule : sans cela, taper
     * dans un texte à puces reviendrait à modifier des chiffres qu'on ne voit pas.
     */
    let cardDigits = (existing?.card?.number ?? '').replace(/\D/g, '');
    let cardNumberVisible = !cardDigits;

    const maskCardNumber = (value: string) => value.replace(/\d(?=.*\d{4})/g, '•');
    const paintCardNumber = () => {
      const formatted = formatCardNumber(cardDigits);
      cardNumber.value = cardNumberVisible ? formatted : maskCardNumber(formatted);
      cardNumber.readOnly = !cardNumberVisible;
    };

    const updateCardHints = () => {
      const invalid = cardDigits.length >= 12 && !isLuhnValid(cardDigits);
      cardBrandHint.textContent = !cardDigits ? ''
        : invalid ? tr('Ce numéro ne passe pas le contrôle : vérifiez la saisie', 'This number fails the checksum: check your typing')
        : cardBrand(cardDigits) ?? '';
      cardBrandHint.classList.toggle('field-hint-warn', invalid);
    };

    cardNumber.addEventListener('input', () => {
      if (!cardNumberVisible) return;
      // Le curseur est replacé en fin de saisie : la mise en forme insère des espaces
      cardDigits = cardNumber.value.replace(/\D/g, '').slice(0, 19);
      paintCardNumber();
      cardNumber.setSelectionRange(cardNumber.value.length, cardNumber.value.length);
      updateCardHints();
    });

    $<HTMLButtonElement>('#btn-toggle-card-number').addEventListener('click', event => {
      cardNumberVisible = !cardNumberVisible;
      const button = event.currentTarget as HTMLButtonElement;
      button.setAttribute('aria-pressed', String(cardNumberVisible));
      button.title = cardNumberVisible ? tr('Masquer', 'Hide') : tr('Afficher', 'Show');
      paintCardNumber();
      if (cardNumberVisible) cardNumber.focus();
    });

    sshPrivate.addEventListener('input', () => {
      const value = sshPrivate.value.trim();
      sshKeyHint.textContent = !value || looksLikePrivateKey(value) ? ''
        : tr('Ce texte ne ressemble pas à une clé privée', 'This does not look like a private key');
    });

    /** Montre les sections du type choisi et déplace ce qui change de place */
    const applyType = () => {
      $<HTMLElement>('#section-login').hidden = itemType !== 'login';
      $<HTMLElement>('#section-card').hidden = itemType !== 'card';
      $<HTMLElement>('#section-identity').hidden = itemType !== 'identity';
      $<HTMLElement>('#section-ssh').hidden = itemType !== 'sshKey';
      $<HTMLElement>('#section-files').hidden = !isFileType(itemType);

      // Une note et un fichier ont leur contenu comme sujet principal : il remonte à la première étape
      const essentiel = box.querySelector<HTMLElement>('[data-step="essentiel"]') as HTMLElement;
      if (itemType === 'note') essentiel.append(notesSection);
      else detailsPanel.append(notesSection);

      if (isFileType(itemType)) filesHost.append(attachmentsField);
      else organisationSection.append(attachmentsField);

      $<HTMLElement>('#attachments-label').textContent = isFileType(itemType)
        ? (itemType === 'folder' ? tr('Fichiers du dossier', 'Files in the folder') : tr('Fichier', 'File'))
        : tr('Pièces jointes', 'Attachments');

      titleInput.placeholder = itemType === 'card' ? tr('Carte bleue, carte de fidélité…', 'Debit card, loyalty card…')
        : itemType === 'identity' ? tr('Passeport, carte d’identité…', 'Passport, ID card…')
        : itemType === 'sshKey' ? tr('Serveur de production, dépôt Git…', 'Production server, Git repo…')
        : itemType === 'note' ? tr('Codes de secours, procédure…', 'Backup codes, procedure…')
        : isFileType(itemType) ? tr('Contrat, scan de document…', 'Contract, scanned document…')
        : 'GitHub, Netflix, Banque…';

      if (itemType === 'card') { paintCardNumber(); updateCardHints(); }

      // Le titre ne nomme le type qu'une fois celui-ci choisi, pas sur l'écran de choix
      if (typeChosen) {
        const info = ITEM_TYPE_INFO[itemType];
        const typeName = tr(info.fr, info.en);
        $<HTMLElement>('.modal-title').textContent = isEdit
          ? tr(`Modifier : ${typeName}`, `Edit ${typeName}`)
          : tr(`Nouveau : ${typeName}`, `New ${typeName}`);
      }

      updateIconPreview();
    };

    typeGrid.addEventListener('click', event => {
      const choice = (event.target as HTMLElement).closest<HTMLElement>('[data-type]')?.dataset.type;
      if (!choice) return;
      itemType = itemTypeOf(choice);
      typeChosen = true;
      renderTypeGrid();
      applyType();
      stepper.setSteps(stepsForType());
      stepper.next();
    });

    /* ── Validation et enregistrement ────────────────────────────────── */
    const requireTitle = (): string | undefined => {
      const title = titleInput.value.trim();
      if (title) return undefined;
      titleInput.focus();
      return itemType === 'login'
        ? tr('Donnez un nom à cet identifiant', 'Give this credential a name')
        : tr('Donnez un nom à cet élément', 'Give this item a name');
    };

    const checkEssentiel = (): string | undefined => {
      const missingTitle = requireTitle();
      if (missingTitle) return missingTitle;

      if (itemType === 'card') {
        if (cardDigits && !isLuhnValid(cardDigits)) {
          cardNumber.focus();
          return tr('Ce numéro de carte ne passe pas le contrôle', 'This card number fails the checksum');
        }
        const month = Number($<HTMLInputElement>('#field-card-exp-month').value);
        if (month && (month < 1 || month > 12)) {
          $<HTMLInputElement>('#field-card-exp-month').focus();
          return tr('Le mois d’expiration doit être compris entre 01 et 12', 'The expiry month must be between 01 and 12');
        }
      }
      return undefined;
    };

    const checkSecurite = (): string | undefined => {
      const totpRaw = totpInput.value.trim();
      if (totpRaw && !normalizeTotpInput(totpRaw)) {
        totpInput.focus();
        return tr('La clé 2FA n’est pas valide', 'The 2FA key is not valid');
      }
      return undefined;
    };

    const stepsForType = (): StepDef[] => {
      const steps: StepDef[] = [];
      if (!isEdit) steps.push({ id: 'type', label: tr('Type', 'Type') });
      steps.push({ id: 'essentiel', label: tr('L’essentiel', 'Essentials'), validate: checkEssentiel });
      if (itemType === 'login') steps.push({ id: 'securite', label: tr('2FA', '2FA'), validate: checkSecurite });
      steps.push({ id: 'details', label: tr('Détails', 'Details') });
      return steps;
    };

    const payloadForItemType = () => {
      if (itemType === 'card') {
        const brand = cardBrand(cardDigits);
        const month = $<HTMLInputElement>('#field-card-exp-month').value.trim();
        return {
          card: {
            number: cardDigits,
            holder: $<HTMLInputElement>('#field-card-holder').value.trim(),
            expMonth: month ? month.padStart(2, '0').slice(0, 2) : '',
            expYear: $<HTMLInputElement>('#field-card-exp-year').value.trim(),
            cvv: $<HTMLInputElement>('#field-card-cvv').value.trim(),
            pin: $<HTMLInputElement>('#field-card-pin').value.trim(),
            ...(brand ? { brand } : {})
          }
        };
      }
      if (itemType === 'identity') {
        return {
          identity: {
            firstName: $<HTMLInputElement>('#field-id-first').value.trim(),
            lastName: $<HTMLInputElement>('#field-id-last').value.trim(),
            birthDate: $<HTMLInputElement>('#field-id-birth').value,
            email: $<HTMLInputElement>('#field-id-email').value.trim(),
            phone: $<HTMLInputElement>('#field-id-phone').value.trim(),
            address: $<HTMLInputElement>('#field-id-address').value.trim(),
            postalCode: $<HTMLInputElement>('#field-id-postal').value.trim(),
            city: $<HTMLInputElement>('#field-id-city').value.trim(),
            country: $<HTMLInputElement>('#field-id-country').value.trim(),
            docNumber: $<HTMLInputElement>('#field-id-doc').value.trim()
          }
        };
      }
      if (itemType === 'sshKey') {
        return {
          sshKey: {
            privateKey: sshPrivate.value,
            publicKey: $<HTMLTextAreaElement>('#field-ssh-public').value.trim(),
            passphrase: $<HTMLInputElement>('#field-ssh-passphrase').value
          }
        };
      }
      return {};
    };

    const submit = () => {
      errorEl.hidden = true;
      const blocking = checkEssentiel() ?? (itemType === 'login' ? checkSecurite() : undefined);
      if (blocking) return fail(blocking);

      const title = titleInput.value.trim();
      const isLogin = itemType === 'login';
      const website = isLogin ? websiteInput.value.trim() : '';
      const totpSecret = isLogin ? normalizeTotpInput(totpInput.value.trim()) : null;

      const expiresDate = expiresField.getValue();
      const [y, m, d] = expiresDate ? expiresDate.split('-').map(Number) : [];
      const item = {
        type: itemType,
        title,
        website,
        username: isLogin ? usernameInput.value.trim() : '',
        password: isLogin ? pwdField.value : '',
        domain: extractDomain(website),
        totpSecret: totpSecret || undefined,
        notes: notesInput.value,
        tags: tagInput.getTags(),
        isFavorite: $<HTMLInputElement>('#field-favorite').checked,
        expiresAt: expiresDate ? new Date(y, m - 1, d, 12).getTime() : undefined,
        folderId: $<HTMLSelectElement>('#field-folder').value || undefined,
        icon: chosenIcon,
        // Les champs de l'ancien type sont effacés quand le type change
        card: undefined,
        identity: undefined,
        sshKey: undefined,
        ...payloadForItemType()
      };

      const problem = checkCredential({ ...item, fields: existing?.fields }, limits, tr);
      if (problem) return fail(problem);

      stopScanner();
      if (isEdit && existing) {
        vaultStore.updateCredential(existing.id, item);
        this.closeModal();
        this.showToast(tr('Modifications enregistrées', 'Changes saved'), 'success');
        void uploadPendingFiles(existing.id, existing.vaultId);
      } else {
        const vaultId = vaultStore.getData().activeVaultId;
        const id = vaultStore.addCredential({ ...item, vaultId });
        this.closeModal();
        this.selectedItemId = id;
        this.renderList();
        this.renderDetail(id);
        this.showToast(tr(`${title} ajouté`, `${title} added`), 'success');
        void uploadPendingFiles(id, vaultId);
      }
    };

    renderTypeGrid();
    applyType();

    const stepper = mountStepper({
      body: $<HTMLElement>('.cred-form'),
      header: $<HTMLElement>('#cred-steps'),
      footer: $<HTMLElement>('#cred-footer'),
      steps: stepsForType(),
      tr,
      finishLabel: isEdit ? tr('Enregistrer', 'Save') : tr('Ajouter', 'Add'),
      onFinish: submit,
      onError: message => fail(message),
      onStepChange: () => { errorEl.hidden = true; },
      onCancel: () => { stopScanner(); this.closeModal(); }
    });
  }

  /* ── Créer ou Modifier une Tâche ─────────────────────────────────────── */
  private openCreateTaskModal(linkedCredentialId?: string, existingTaskId?: string): void {
    const data = vaultStore.getData();
    const existing = existingTaskId ? data.tasks.find(t => t.id === existingTaskId) : null;
    const isEdit = !!existing;
    if (!this.canEdit(existing?.vaultId ?? data.activeVaultId)) return;

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
        <div class="modal-title">${isEdit ? this.tr('Modifier la tâche', 'Edit task') : this.tr('Nouvelle tâche', 'New task')}</div>
        <button class="modal-close" id="modal-close-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-field">
          <label class="form-label">${this.tr('Titre *', 'Title *')}</label>
          <input class="form-input" id="task-title" type="text" placeholder="${this.tr('Renouveler le mot de passe GitHub…', 'Renew the GitHub password…')}" value="${existing?.title || ''}" autocomplete="off">
        </div>
        <div class="form-field">
          <label class="form-label">Description</label>
          <textarea class="note-editor" id="task-desc" placeholder="${this.tr('Facultatif', 'Optional')}">${existing?.description || ''}</textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-field">
            <label class="form-label">${this.tr('Priorité', 'Priority')}</label>
            <select class="form-input" id="task-priority">
              <option value="low" ${existing?.priority === 'low' ? 'selected' : ''}>${i18n.t.common.low}</option>
              <option value="medium" ${(!existing || existing?.priority === 'medium') ? 'selected' : ''}>${i18n.t.common.medium}</option>
              <option value="high" ${existing?.priority === 'high' ? 'selected' : ''}>${i18n.t.common.high}</option>
              <option value="urgent" ${existing?.priority === 'urgent' ? 'selected' : ''}>${i18n.t.common.urgent}</option>
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">${this.tr('Échéance', 'Due date')}</label>
            <div id="task-due"></div>
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
            <div id="task-recur-until"></div>
          </div>
          <div class="form-field">
            <label class="form-label">${this.tr('Rappel', 'Reminder')}</label>
            <div id="task-reminder"></div>
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
            <label class="form-label">${this.tr('Identifiant lié (facultatif)', 'Linked credential (optional)')}</label>
            <select class="form-input" id="task-cred">
              <option value="">${this.tr('Aucun', 'None')}</option>
              ${credOptions}
            </select>
          </div>` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn-primary" id="modal-cancel">${this.tr('Annuler', 'Cancel')}</button>
        <button class="btn-primary" id="modal-confirm">${isEdit ? this.tr('Enregistrer', 'Save') : this.tr('Créer', 'Create')}</button>
      </div>
    `);

    box.querySelector('#modal-close-btn')?.addEventListener('click', () => this.closeModal());
    box.querySelector('#modal-cancel')?.addEventListener('click', () => this.closeModal());
    const taskTagInput = mountTagInput(box.querySelector('#task-tags') as HTMLElement, {
      initial: existing?.tags ?? [],
      suggestions: vaultStore.getTags(),
      placeholder: this.tr('Ajouter un tag…', 'Add a tag…'),
      removeLabel: name => this.tr(`Retirer le tag ${name}`, `Remove tag ${name}`)
    });
    const trTask = (fr: string, en: string) => this.tr(fr, en);
    const dueField = mountDateField(box.querySelector('#task-due') as HTMLElement, {
      value: existing?.dueDate || '', label: trTask('Échéance', 'Due date'), tr: trTask, locale: this.dateLocale()
    });
    const untilField = mountDateField(box.querySelector('#task-recur-until') as HTMLElement, {
      value: existing?.recurrence?.until || '', label: trTask('Fin de récurrence', 'Recurrence end'), tr: trTask, locale: this.dateLocale(),
      placeholder: trTask('Jamais', 'Never'), describe: () => ''
    });
    const reminderField = mountDateField(box.querySelector('#task-reminder') as HTMLElement, {
      value: this.toDateTimeInputValue(existing?.reminderAt), label: trTask('Rappel', 'Reminder'), tr: trTask, locale: this.dateLocale(),
      withTime: true, placeholder: trTask('Aucun rappel', 'No reminder'), describe: () => ''
    });

    box.querySelector('#modal-confirm')?.addEventListener('click', () => {
      const title = (box.querySelector('#task-title') as HTMLInputElement)?.value.trim();
      if (!title) { this.showToast(this.tr('Le titre est obligatoire', 'Title is required'), 'error'); return; }
      const description = (box.querySelector('#task-desc') as HTMLTextAreaElement)?.value;
      const priority = (box.querySelector('#task-priority') as HTMLSelectElement)?.value as Task['priority'];
      const dueDate = dueField.getValue();
      const linkedCredSel = box.querySelector('#task-cred') as HTMLSelectElement;
      const linkedCred = linkedCredSel?.value || undefined;

      const freq = (box.querySelector('#task-recur-freq') as HTMLSelectElement).value as RecurrenceFrequency | '';
      const interval = Math.min(365, Math.max(1, parseInt((box.querySelector('#task-recur-interval') as HTMLInputElement).value, 10) || 1));
      const until = untilField.getValue() || undefined;
      const recurrence: TaskRecurrence | undefined = freq ? { freq, interval, until } : undefined;
      if (recurrence && until && dueDate && until < dueDate) {
        this.showToast(this.tr('La fin de récurrence précède l’échéance', 'Recurrence end is before the due date'), 'error');
        return;
      }

      const reminderValue = reminderField.getValue();
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
        this.showToast(this.tr('Tâche enregistrée', 'Task saved'), 'success');
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
        this.showToast(this.tr('Tâche créée', 'Task created'), 'success');
      }
    });
  }

  /* ── Générateur ───────────────────────────────────────────────────────── */
  private openGeneratorModal(): void {
    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title" style="display:flex;align-items:center;gap:8px;">${GEN_ICONS.bolt}${this.tr('Générateur', 'Generator')}</div>
        <button class="modal-close">${GEN_ICONS.close}</button>
      </div>
      <div class="modal-body" data-generator-host></div>
      <div class="modal-footer">
        <span class="modal-footer-hint"><kbd>R</kbd> ${this.tr('régénérer', 'regenerate')}</span>
        <button class="btn-primary btn-ghost" data-close>${this.tr('Fermer', 'Close')}</button>
        <button class="btn-primary btn-accent" data-primary data-autofocus data-gen-copy>${GEN_ICONS.copy}<span>${this.tr('Copier', 'Copy')}</span></button>
      </div>
    `);
    const generator = this.mountGenerator(box.querySelector('[data-generator-host]') as HTMLElement);
    box.querySelector('[data-gen-copy]')?.addEventListener('click', () => void generator.copy());
  }

  /** Générateur réutilisable : modale dédiée ou panneau intégré au formulaire d'identifiant */
  private mountGenerator(host: HTMLElement, options: { onUse?: (value: string) => void } = {}): { copy: () => Promise<void> } {
    type GeneratorMode = 'password' | 'passphrase' | 'pin';
    type GeneratorPrefs = {
      mode: GeneratorMode;
      length: number;
      uppercase: boolean;
      lowercase: boolean;
      numbers: boolean;
      symbols: boolean;
      avoidAmbiguous: boolean;
      exclude: string;
      words: number;
      separator: string;
      customSeparator: string;
      wordCase: PassphraseCase;
      numberDigits: number;
      includeSymbol: boolean;
      pinLength: number;
    };
    const defaults: GeneratorPrefs = {
      mode: 'password', length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true, avoidAmbiguous: false, exclude: '',
      words: 5, separator: '-', customSeparator: '', wordCase: 'title', numberDigits: 2, includeSymbol: false,
      pinLength: 6
    };
    let prefs: GeneratorPrefs = { ...defaults };
    try {
      const saved = JSON.parse(localStorage.getItem(GENERATOR_PREFS_KEY) ?? '{}') as Partial<GeneratorPrefs> & { capitalize?: boolean; includeNumber?: boolean };
      prefs = { ...defaults, ...saved };
      // Anciennes préférences
      if (saved.wordCase === undefined && saved.capitalize === false) prefs.wordCase = 'lower';
      if (saved.numberDigits === undefined && saved.includeNumber === false) prefs.numberDigits = 0;
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

    const BOUNDS: Record<'length' | 'words' | 'pinLength', [number, number]> = {
      length: [8, 128],
      words: [3, MAX_PASSPHRASE_WORDS],
      pinLength: [4, 12]
    };

    const chip = (key: keyof GeneratorPrefs, label: string, hint: string) => `
      <label class="gen-chip" title="${hint}">
        <input type="checkbox" data-pref="${key}" ${prefs[key] ? 'checked' : ''}>
        <span>${label}</span>
      </label>`;
    const slider = (key: keyof typeof BOUNDS, label: string) => `
      <div class="gen-slider-row">
        <span class="form-label">${label}</span>
        <input type="range" min="${BOUNDS[key][0]}" max="${BOUNDS[key][1]}" value="${prefs[key]}" data-pref="${key}" aria-label="${label}">
        <input type="number" class="form-input gen-number" min="${BOUNDS[key][0]}" max="${BOUNDS[key][1]}" value="${prefs[key]}" data-pref="${key}" aria-label="${label}">
      </div>`;
    const select = (key: keyof GeneratorPrefs, label: string, choices: Array<[string | number, string]>) => `
      <div class="form-field">
        <label class="form-label">${label}</label>
        <select class="form-input" data-pref="${key}" aria-label="${label}">
          ${choices.map(([value, text]) => `<option value="${value}" ${String(prefs[key]) === String(value) ? 'selected' : ''}>${text}</option>`).join('')}
        </select>
      </div>`;

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
          <button type="button" class="tab-btn" role="tab" data-mode="password">${tabIcon('password')}<span>${this.tr('Mot de passe', 'Password')}</span></button>
          <button type="button" class="tab-btn" role="tab" data-mode="passphrase">${tabIcon('passphrase')}<span>${this.tr('Phrase secrète', 'Passphrase')}</span></button>
          <button type="button" class="tab-btn" role="tab" data-mode="pin">${tabIcon('pin')}<span>${this.tr('Code PIN', 'PIN')}</span></button>
        </div>

        <div class="gen-section" data-section="password">
          ${slider('length', this.tr('Longueur', 'Length'))}
          <div class="gen-chips">
            ${chip('uppercase', 'A–Z', this.tr('Majuscules', 'Uppercase'))}
            ${chip('lowercase', 'a–z', this.tr('Minuscules', 'Lowercase'))}
            ${chip('numbers', '0–9', this.tr('Chiffres', 'Digits'))}
            ${chip('symbols', '!@#$', this.tr('Symboles', 'Symbols'))}
            ${chip('avoidAmbiguous', this.tr('Sans ambigus', 'No look-alikes'), this.tr('Exclut 0/O, 1/l/I', 'Excludes 0/O, 1/l/I'))}
          </div>
          <div class="form-field">
            <label class="form-label">${this.tr('Caractères à exclure', 'Characters to exclude')}</label>
            <input class="form-input" type="text" data-pref="exclude" value="${this.escapeHtml(prefs.exclude)}" placeholder="${this.tr('Ex. : {}[]<>"\'', 'E.g. {}[]<>"\'')}" spellcheck="false" autocomplete="off" style="font-family:var(--font-mono);">
          </div>
        </div>

        <div class="gen-section" data-section="passphrase">
          ${slider('words', this.tr('Mots', 'Words'))}
          <div class="gen-grid">
            ${select('separator', this.tr('Séparateur', 'Separator'), [
              ['-', this.tr('Tiret  -', 'Dash  -')],
              [' ', this.tr('Espace', 'Space')],
              ['.', this.tr('Point  .', 'Dot  .')],
              [',', this.tr('Virgule  ,', 'Comma  ,')],
              ['_', this.tr('Tiret bas  _', 'Underscore  _')],
              ['', this.tr('Aucun', 'None')],
              ['custom', this.tr('Personnalisé', 'Custom')]
            ])}
            <div class="form-field" data-custom-separator>
              <label class="form-label">${this.tr('Séparateur personnalisé', 'Custom separator')}</label>
              <input class="form-input" type="text" maxlength="5" data-pref="customSeparator" value="${this.escapeHtml(prefs.customSeparator)}" spellcheck="false" autocomplete="off" style="font-family:var(--font-mono);">
            </div>
            ${select('wordCase', this.tr('Casse des mots', 'Word case'), [
              ['lower', this.tr('minuscules', 'lowercase')],
              ['title', this.tr('Majuscule initiale', 'Capitalized')],
              ['upper', this.tr('MAJUSCULES', 'UPPERCASE')],
              ['random', this.tr('Aléatoire', 'Random')]
            ])}
            ${select('numberDigits', this.tr('Nombre ajouté', 'Added number'), [
              [0, this.tr('Aucun', 'None')],
              [1, this.tr('1 chiffre', '1 digit')],
              [2, this.tr('2 chiffres', '2 digits')],
              [3, this.tr('3 chiffres', '3 digits')],
              [4, this.tr('4 chiffres', '4 digits')]
            ])}
          </div>
          <div class="gen-chips">
            ${chip('includeSymbol', this.tr('+ symbole', '+ symbol'), this.tr('Ajoute un symbole à la fin', 'Append a symbol'))}
          </div>
          <p class="gen-mode-hint">${this.tr('Mots tirés de la liste EFF (7 776 mots) : chaque mot ajoute environ 12,9 bits. Facile à retenir et à taper.', 'Words from the EFF list (7,776 words): each word adds about 12.9 bits. Easy to remember and type.')}</p>
        </div>

        <div class="gen-section" data-section="pin">
          ${slider('pinLength', this.tr('Chiffres', 'Digits'))}
          <p class="gen-mode-hint">${this.tr('Pour un téléphone, une carte ou un cadenas. Trop court pour protéger un compte en ligne.', 'For a phone, a card or a lock. Too short to protect an online account.')}</p>
        </div>

        ${options.onUse ? `
          <div class="gen-use-row">
            <button type="button" class="btn-primary btn-accent" data-gen="use">${this.tr('Utiliser', 'Use')}</button>
          </div>` : ''}
      </div>`;

    const query = <T extends HTMLElement = HTMLElement>(selector: string) => host.querySelector(selector) as T;
    const output = query('[data-gen="output"]');
    const charsetKeys: Array<keyof GeneratorPrefs> = ['uppercase', 'lowercase', 'numbers', 'symbols'];
    let value = '';

    const passphraseOptions = () => ({
      wordCount: prefs.words,
      separator: prefs.separator === 'custom' ? prefs.customSeparator : prefs.separator,
      wordCase: prefs.wordCase,
      includeNumber: prefs.numberDigits > 0,
      numberDigits: prefs.numberDigits,
      includeSymbol: prefs.includeSymbol
    });

    const strength = () => {
      if (prefs.mode === 'password') return calculatePasswordEntropy(value);
      const bits = prefs.mode === 'pin' ? Math.round(prefs.pinLength * Math.log2(10)) : passphraseEntropyBits(passphraseOptions());
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
      label.textContent = value ? `${s.label} · ≈ ${s.bits} bits` : '';
      label.style.color = s.color;
    };

    const generate = () => {
      try {
        if (prefs.mode === 'password') {
          value = generateStrongPassword({
            length: prefs.length,
            uppercase: prefs.uppercase,
            lowercase: prefs.lowercase,
            numbers: prefs.numbers,
            symbols: prefs.symbols,
            avoidAmbiguous: prefs.avoidAmbiguous,
            exclude: prefs.exclude
          });
        } else if (prefs.mode === 'passphrase') {
          value = generatePassphrase(passphraseOptions());
        } else {
          value = Array.from({ length: prefs.pinLength }, () => String(secureRandomIndex(10))).join('');
        }
      } catch {
        value = '';
        this.showToast(this.tr('Trop de caractères exclus', 'Too many excluded characters'), 'error');
      }
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
      (Object.keys(BOUNDS) as Array<keyof typeof BOUNDS>).forEach(key => {
        host.querySelectorAll<HTMLInputElement>(`input[data-pref="${key}"]`).forEach(input => { input.value = String(prefs[key]); });
      });
      query('[data-custom-separator]').hidden = prefs.separator !== 'custom';
    };

    host.querySelectorAll<HTMLElement>('[data-mode]').forEach(button => {
      button.addEventListener('click', () => {
        prefs.mode = button.dataset.mode as GeneratorMode;
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
            this.showToast(this.tr('Gardez au moins un type de caractères', 'Keep at least one character type'), 'info', 1800);
            return;
          }
          (prefs as Record<string, unknown>)[key] = control.checked;
        } else if (key === 'length' || key === 'words' || key === 'pinLength') {
          const [min, max] = BOUNDS[key];
          const n = parseInt(control.value, 10);
          // Saisie en cours dans le champ numérique (ex. « 1 » avant « 16 ») : on attend une valeur valide
          if (!Number.isFinite(n) || (isNumberField && (n < min || n > max))) return;
          prefs[key] = Math.min(max, Math.max(min, n));
        } else if (key === 'numberDigits') {
          prefs.numberDigits = parseInt(control.value, 10) || 0;
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
      await this.copyToClipboardWithAutoClear(value, this.tr('Copié', 'Copied'), true);
      const button = query('[data-gen="copy"]');
      button.classList.add('copied');
      setTimeout(() => button.classList.remove('copied'), 500);
    };

    query('[data-gen="refresh"]').addEventListener('click', generate);
    query('[data-gen="copy"]').addEventListener('click', () => void copy());
    output.addEventListener('click', () => void copy());
    if (options.onUse) query('[data-gen="use"]').addEventListener('click', () => { if (value) options.onUse?.(value); });

    host.addEventListener('keydown', e => {
      const target = e.target as HTMLElement;
      const typing = target instanceof HTMLSelectElement || (target instanceof HTMLInputElement && ['number', 'text'].includes(target.type));
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
    const now = Date.now();
    const reused = reusedPasswords(creds);

    const groups = {
      weak: { label: this.tr('Mots de passe faibles', 'Weak passwords'), tone: 'var(--accent-red)', items: creds.filter(c => !c.password || calculatePasswordEntropy(c.password).score <= 2) },
      reused: { label: this.tr('Réutilisés', 'Reused'), tone: 'var(--accent-orange)', items: creds.filter(c => c.password && reused.has(c.password)) },
      no2fa: { label: this.tr('Sans 2FA', 'No 2FA'), tone: 'var(--accent)', items: creds.filter(c => !c.totpSecret) },
      expiry: { label: this.tr('À renouveler', 'To renew'), tone: '#f0883e', items: creds.filter(c => c.expiresAt && c.expiresAt - now <= EXPIRY_SOON_DAYS * 86_400_000) }
    };
    type GroupKey = keyof typeof groups;

    const scoreTone = report.score >= 80 ? 'var(--accent-green-bright)' : report.score >= 50 ? 'var(--accent-orange)' : 'var(--accent-red)';
    const scoreLabel = creds.length === 0
      ? this.tr('Rien à analyser', 'Nothing to check')
      : report.score >= 80 ? this.tr('Bonne santé', 'Healthy') : report.score >= 50 ? this.tr('À améliorer', 'Needs work') : this.tr('À risque', 'At risk');
    const radius = 40;
    const circumference = 2 * Math.PI * radius;

    const itemRow = (cred: CredentialItem, sub: string) => `
      <button type="button" class="audit-item" data-cred-id="${cred.id}">
        <span class="record-icon">${this.credentialIcon(cred, 16)}</span>
        <span class="audit-item-text">
          <span class="audit-item-title" style="display:block;">${this.escapeHtml(cred.title)}</span>
          <span class="audit-item-sub">${sub}</span>
        </span>
      </button>`;

    const describe = (key: GroupKey, cred: CredentialItem) => {
      if (key === 'weak') {
        if (!cred.password) return this.tr('Aucun mot de passe', 'No password');
        const s = calculatePasswordEntropy(cred.password);
        return `${s.label} · ${s.bits} bits`;
      }
      if (key === 'reused') {
        const count = creds.filter(c => c.password === cred.password).length;
        return this.tr(`Utilisé par ${count} identifiants`, `Used by ${count} credentials`);
      }
      if (key === 'no2fa') return this.escapeHtml(cred.username || cred.domain || '');
      return expiryInfo(cred.expiresAt, (fr, en) => this.tr(fr, en), this.dateLocale())?.long ?? '';
    };

    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title">${i18n.t.audit.title}</div>
        <button class="modal-close">${GEN_ICONS.close}</button>
      </div>
      <div class="modal-body">
        <div class="audit-hero">
          <div class="audit-ring" role="img" aria-label="${this.tr('Score', 'Score')} ${report.score} / 100">
            <svg width="92" height="92" viewBox="0 0 92 92">
              <circle cx="46" cy="46" r="${radius}" fill="none" stroke="var(--bg-tertiary)" stroke-width="8"></circle>
              <circle cx="46" cy="46" r="${radius}" fill="none" stroke="${scoreTone}" stroke-width="8" stroke-linecap="round"
                stroke-dasharray="${circumference}" stroke-dashoffset="${circumference * (1 - report.score / 100)}"></circle>
            </svg>
            <span class="audit-ring-value" style="color:${scoreTone};">${report.score}</span>
          </div>
          <div>
            <div class="audit-hero-title">${scoreLabel}</div>
            <div class="audit-hero-sub">${creds.length === 0
              ? this.tr('Ajoutez des identifiants pour voir leur niveau de sécurité.', 'Add credentials to see how secure they are.')
              : this.tr(`${creds.length} identifiant${creds.length > 1 ? 's' : ''} analysé${creds.length > 1 ? 's' : ''} dans ce coffre. Le score tient compte de la force, de la réutilisation et de la 2FA.`, `${creds.length} credential${creds.length > 1 ? 's' : ''} checked in this vault. The score reflects strength, reuse and 2FA.`)}</div>
          </div>
        </div>

        <div class="audit-cards">
          ${(Object.keys(groups) as GroupKey[]).map(key => `
            <button type="button" class="audit-card" data-group="${key}" style="--tone:${groups[key].items.length ? groups[key].tone : 'var(--accent-green-bright)'};" ${groups[key].items.length ? '' : 'disabled'}>
              <span class="audit-card-value">${groups[key].items.length}</span>
              <span class="audit-card-label">${groups[key].label}</span>
            </button>`).join('')}
        </div>

        <div class="audit-list" data-group-list hidden></div>

        <div class="audit-breach">
          <div class="audit-breach-head">
            <div>
              <div class="form-section-title">${this.tr('Fuites de données', 'Data breaches')}</div>
              <div class="field-hint">${this.tr('Compare chaque mot de passe à la base Have I Been Pwned. Seuls 5 caractères de son empreinte sont envoyés.', 'Checks each password against Have I Been Pwned. Only 5 characters of its hash are sent.')}</div>
            </div>
            <button class="btn-primary" type="button" id="btn-run-hibp" ${creds.some(c => c.password) ? '' : 'disabled'}>${this.tr('Vérifier', 'Check')}</button>
          </div>
          <div class="audit-progress" hidden><span></span></div>
          <div id="hibp-results"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-primary" data-close>${i18n.t.common.close}</button>
      </div>
    `);

    const openCredential = (id: string) => {
      this.closeModal();
      this.activeView = 'all-credentials';
      this.credentialFilters.clear();
      this.selectedItemId = id;
      this.renderList();
      this.renderDetail(id);
      document.getElementById('detail-container')?.classList.add('mobile-active');
    };
    box.addEventListener('click', e => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-cred-id]')?.dataset.credId;
      if (id) openCredential(id);
    });

    const listEl = box.querySelector('[data-group-list]') as HTMLElement;
    box.querySelectorAll<HTMLButtonElement>('.audit-card').forEach(card => {
      card.addEventListener('click', () => {
        const key = card.dataset.group as GroupKey;
        const wasActive = card.classList.contains('active');
        box.querySelectorAll('.audit-card').forEach(c => c.classList.remove('active'));
        if (wasActive) {
          listEl.hidden = true;
          return;
        }
        card.classList.add('active');
        listEl.hidden = false;
        listEl.innerHTML = `
          <div class="audit-list-title">${groups[key].label}</div>
          ${groups[key].items.map(cred => itemRow(cred, describe(key, cred))).join('')}`;
      });
    });

    const btnHibp = box.querySelector('#btn-run-hibp') as HTMLButtonElement;
    const hibpResults = box.querySelector('#hibp-results') as HTMLElement;
    const progress = box.querySelector('.audit-progress') as HTMLElement;
    const progressBar = progress.querySelector('span') as HTMLElement;

    btnHibp.addEventListener('click', async () => {
      btnHibp.disabled = true;
      progress.hidden = false;
      hibpResults.innerHTML = '';
      const toScan = creds.filter(c => c.password);
      const compromised: Array<{ cred: CredentialItem; hits: number }> = [];
      let scanned = 0;
      let serviceError: string | null = null;

      for (const cred of toScan) {
        if (!btnHibp.isConnected) return; // Modale fermée pendant l'analyse
        try {
          const hits = await checkPasswordPwnedHIBP(cred.password);
          if (hits > 0) compromised.push({ cred, hits });
        } catch (err) {
          // Service injoignable : les éléments restants ne sont PAS vérifiés
          serviceError = err instanceof HibpUnavailableError ? err.message : String(err);
          break;
        }
        scanned++;
        progressBar.style.width = `${Math.round((scanned / toScan.length) * 100)}%`;
        btnHibp.textContent = `${scanned}/${toScan.length}`;
      }

      btnHibp.disabled = false;
      btnHibp.textContent = this.tr('Vérifier à nouveau', 'Check again');
      const compromisedList = compromised.map(({ cred, hits }) => itemRow(cred, this.tr(`Vu ${i18n.formatNumber(hits)} fois dans des fuites`, `Seen ${i18n.formatNumber(hits)} times in breaches`))).join('');

      if (serviceError !== null) {
        hibpResults.innerHTML = `
          <div class="notice notice-warning">
            <strong>${this.tr('Vérification interrompue', 'Check interrupted')}</strong><br>
            ${this.escapeHtml(serviceError)}. ${this.tr(`${scanned} vérifié(s), ${toScan.length - scanned} restant(s).`, `${scanned} checked, ${toScan.length - scanned} left.`)}
          </div>
          ${compromisedList ? `<div class="audit-list" style="margin-top:8px;">${compromisedList}</div>` : ''}`;
      } else if (compromised.length > 0) {
        hibpResults.innerHTML = `
          <div class="notice notice-danger"><strong>${this.tr(`${compromised.length} mot${compromised.length > 1 ? 's' : ''} de passe présent${compromised.length > 1 ? 's' : ''} dans des fuites`, `${compromised.length} password${compromised.length > 1 ? 's' : ''} found in breaches`)}</strong> · ${this.tr('changez-les dès que possible.', 'change them as soon as possible.')}</div>
          <div class="audit-list" style="margin-top:8px;">${compromisedList}</div>`;
      } else {
        hibpResults.innerHTML = `<div class="notice notice-success">${this.tr('Aucun mot de passe trouvé dans les fuites connues.', 'No password found in known breaches.')}</div>`;
      }
      window.setTimeout(() => { progress.hidden = true; }, 600);
    });
  }

  /* ── Import & Export Hub ────────────────────────────────────────────────── */
  private openImportModal(): void {
    const data = vaultStore.getData();
    const creds = data.credentials.filter(c => c.vaultId === data.activeVaultId);
    const tasks = data.tasks.filter(t => t.vaultId === data.activeVaultId);
    const limits = accountService.getLimits();
    const tr = (fr: string, en: string) => this.tr(fr, en);
    const activeVaultName = data.vaults.find(v => v.id === data.activeVaultId)?.name ?? 'BetterVault';

    const brand = (slug: string, size = 22) => {
      const row = BRAND_ICONS.find(([s]) => s === slug);
      return row ? renderItemIcon({ set: 'simple', name: row[0], title: row[1], hex: row[2], body: `<path d="${row[3]}"/>` }, size) : GENERIC_FILE_ICON;
    };
    const bvLogo = `<img class="brand-logo brand-logo-dark" src="/brand/logo-on-dark.svg" width="22" height="22" alt="" style="width:22px;height:22px;"><img class="brand-logo brand-logo-light" src="/brand/logo-on-light.svg" width="22" height="22" alt="" style="width:22px;height:22px;">`;

    type Source = { id: string; name: string; logo: string; formats: string; accept: string; steps: string[] };
    const sources: Source[] = [
      { id: 'bettervault', name: 'BetterVault', logo: bvLogo, formats: 'JSON', accept: '.json', steps: [tr('Dans BetterVault : Importer / exporter, onglet Exporter', 'In BetterVault: Import / export, Export tab'), tr('Export chiffré ou JSON', 'Encrypted export or JSON')] },
      { id: 'bitwarden', name: 'Bitwarden', logo: brand('bitwarden'), formats: 'JSON · CSV', accept: '.json,.csv', steps: [tr('Coffre web : Outils, puis Exporter le coffre', 'Web vault: Tools, then Export vault'), tr('Format .json de préférence (garde les codes 2FA et les champs)', 'Prefer .json (keeps 2FA codes and fields)')] },
      { id: '1password', name: '1Password', logo: brand('1password'), formats: '1PUX', accept: '.1pux', steps: [tr('Application de bureau : Fichier, puis Exporter', 'Desktop app: File, then Export'), tr('Choisissez le format 1PUX', 'Choose the 1PUX format')] },
      { id: 'keepass', name: 'KeePass', logo: brand('keepassxc'), formats: 'KDBX · XML', accept: '.kdbx,.xml', steps: [tr('Choisissez directement votre base .kdbx', 'Pick your .kdbx database directly'), tr('Son mot de passe est demandé ensuite', 'Its password is asked next')] },
      { id: 'proton', name: 'Proton Pass', logo: brand('proton'), formats: 'CSV · JSON', accept: '.csv,.json', steps: [tr('Paramètres, puis Exporter', 'Settings, then Export'), tr('Format CSV', 'CSV format')] },
      { id: 'chrome', name: 'Chrome', logo: brand('googlechrome'), formats: 'CSV', accept: '.csv', steps: [tr('Ouvrez chrome://password-manager/settings', 'Open chrome://password-manager/settings'), tr('Exporter les mots de passe', 'Export passwords')] },
      { id: 'firefox', name: 'Firefox', logo: brand('firefoxbrowser'), formats: 'CSV', accept: '.csv', steps: [tr('Ouvrez about:logins', 'Open about:logins'), tr('Menu ⋯, puis Exporter les identifiants', 'Menu ⋯, then Export logins')] },
      { id: 'lastpass', name: 'LastPass', logo: brand('lastpass'), formats: 'CSV', accept: '.csv', steps: [tr('Options avancées, puis Exporter', 'Advanced options, then Export')] },
      { id: 'dashlane', name: 'Dashlane', logo: brand('dashlane'), formats: 'CSV', accept: '.csv', steps: [tr('Paramètres, Exporter les données, format CSV', 'Settings, Export data, CSV format')] },
      { id: 'apple', name: tr('Mots de passe Apple', 'Apple Passwords'), logo: brand('apple'), formats: 'CSV', accept: '.csv', steps: [tr('App Mots de passe : Fichier, puis Exporter', 'Passwords app: File, then Export')] },
      { id: 'passky', name: 'Passky', logo: GENERIC_FILE_ICON, formats: 'JSON', accept: '.json', steps: [tr('Passky : Paramètres, puis Exporter', 'Passky: Settings, then Export'), tr('Choisissez l’export non chiffré (JSON)', 'Choose the unencrypted export (JSON)')] },
      { id: 'cxf', name: 'FIDO CXF', logo: brand('fidoalliance'), formats: 'JSON', accept: '.json', steps: [tr('Fichier Credential Exchange Format, passkeys comprises', 'Credential Exchange Format file, passkeys included')] },
      { id: 'other', name: tr('Autre fichier', 'Other file'), logo: GENERIC_FILE_ICON, formats: 'KDBX · 1PUX · JSON · CSV · XML', accept: '.json,.csv,.xml,.kdbx,.1pux', steps: [tr('Le format est reconnu automatiquement', 'The format is detected automatically')] }
    ];

    const exportItem = (id: string, logo: string, title: string, sub: string, pill?: { label: string; safe: boolean }) => `
      <button type="button" class="ie-export" data-export="${id}" aria-expanded="false">
        <span class="ie-logo">${logo}</span>
        <span class="ie-export-text">
          <span class="ie-export-title">${title}${pill ? `<span class="ie-pill ${pill.safe ? 'ie-pill-safe' : 'ie-pill-plain'}">${pill.label}</span>` : ''}</span>
          <span class="ie-export-sub">${sub}</span>
        </span>
      </button>`;

    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title">${i18n.t.importExport.title}</div>
        <button class="modal-close">${GEN_ICONS.close}</button>
      </div>
      <div class="modal-body">
        <div class="tab-btn-group" role="tablist">
          <button type="button" class="tab-btn active" role="tab" data-tab="import" aria-selected="true">${tabIcon('import')}<span>${tr('Importer', 'Import')}</span></button>
          <button type="button" class="tab-btn" role="tab" data-tab="export" aria-selected="false">${tabIcon('export')}<span>${tr('Exporter', 'Export')}</span></button>
        </div>

        <div data-panel="import">
          <div data-step="sources">
            <p class="modal-text" style="margin-bottom:10px;">${tr('D’où viennent vos identifiants ?', 'Where are your credentials coming from?')}</p>
            <div class="ie-sources">
              ${sources.map(source => `
                <button type="button" class="ie-source" data-source="${source.id}">
                  <span class="ie-logo">${source.logo}</span>
                  <span>${this.escapeHtml(source.name)}</span>
                  <span class="ie-source-format">${source.formats}</span>
                </button>`).join('')}
            </div>
          </div>

          <div data-step="file" hidden style="display:flex;flex-direction:column;gap:12px;">
            <div class="ie-selected">
              <span class="ie-logo" data-selected-logo></span>
              <div class="ie-selected-text">
                <div class="ie-selected-title" data-selected-name></div>
                <div class="ie-selected-sub" data-selected-formats></div>
              </div>
              <button type="button" class="btn-primary btn-ghost" data-action="change-source">${tr('Changer', 'Change')}</button>
            </div>
            <ol class="ie-steps" data-selected-steps></ol>
            <div class="drop-zone" id="drop-zone" role="button" tabindex="0" aria-label="${tr('Choisir un fichier à importer', 'Choose a file to import')}">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
              <div class="drop-zone-title">${tr('Déposez le fichier ici', 'Drop the file here')}</div>
              <div class="drop-zone-sub">${tr('ou cliquez pour le choisir · rien n’est envoyé, tout est lu sur cet appareil', 'or click to choose it · nothing is uploaded, the file is read on this device')}</div>
            </div>
            <input type="file" id="import-file-input" hidden>
            <div id="import-secret-panel" class="form-section" hidden>
              <div class="form-field">
                <label class="form-label" for="import-secret-password" id="import-secret-label">${tr('Mot de passe', 'Password')}</label>
                <input class="form-input" id="import-secret-password" type="password" autocomplete="off">
              </div>
              <div class="form-field" id="import-keyfile-row" hidden>
                <label class="form-label" for="import-keyfile">${tr('Fichier clé KeePass (facultatif)', 'KeePass key file (optional)')}</label>
                <input class="form-input" id="import-keyfile" type="file">
              </div>
              <div class="account-actions account-actions-end">
                <button type="button" class="btn-primary btn-accent" id="btn-import-unlock">${tr('Ouvrir le fichier', 'Open file')}</button>
              </div>
            </div>
            <div id="import-status" aria-live="polite"></div>
          </div>
        </div>

        <div data-panel="export" hidden style="display:flex;flex-direction:column;gap:10px;">
          <p class="modal-text">${tr(`Coffre « ${this.escapeHtml(activeVaultName)} » : ${creds.length} identifiant${creds.length > 1 ? 's' : ''} et ${tasks.length} tâche${tasks.length > 1 ? 's' : ''}.`, `Vault "${this.escapeHtml(activeVaultName)}": ${creds.length} credential${creds.length === 1 ? '' : 's'} and ${tasks.length} task${tasks.length === 1 ? '' : 's'}.`)}</p>
          <div class="ie-group-title">${tr('Chiffré', 'Encrypted')}</div>
          <div class="ie-export-list">
            ${exportItem('encrypted', bvLogo, tr('BetterVault chiffré', 'Encrypted BetterVault'), tr('Protégé par un mot de passe dédié · Argon2id et AES-256-GCM', 'Protected by a dedicated password · Argon2id and AES-256-GCM'), { label: tr('Recommandé', 'Recommended'), safe: true })}
            ${exportItem('kdbx', brand('keepassxc'), tr('Base KeePass (.kdbx)', 'KeePass database (.kdbx)'), 'KeePass, KeePassXC, Strongbox')}
          </div>
          <div id="export-password-panel" class="form-section" hidden>
            <div class="form-section-title" id="export-password-title"></div>
            <div class="form-row">
              <input class="form-input" id="export-password" type="password" autocomplete="new-password" placeholder="${tr(`Mot de passe (${MIN_EXPORT_PASSWORD_LENGTH} caractères minimum)`, `Password (at least ${MIN_EXPORT_PASSWORD_LENGTH} characters)`)}">
              <input class="form-input" id="export-password-confirm" type="password" autocomplete="new-password" placeholder="${tr('Confirmer', 'Confirm')}">
            </div>
            <div class="field-hint" id="export-password-status"></div>
            <div class="account-actions account-actions-end">
              <button type="button" class="btn-primary btn-accent" id="btn-export-password-confirm">${tr('Chiffrer et enregistrer', 'Encrypt and save')}</button>
            </div>
          </div>

          <div class="ie-group-title">${tr('Non chiffré', 'Not encrypted')}</div>
          <div class="notice notice-warning">${tr('Ces fichiers contiennent vos mots de passe en clair. Supprimez-les dès qu’ils ne servent plus.', 'These files contain your passwords in plain text. Delete them once you no longer need them.')}</div>
          <div class="ie-export-list">
            ${exportItem('cxf', brand('fidoalliance'), 'FIDO CXF', tr('Format d’échange standard, passkeys comprises', 'Standard exchange format, passkeys included'))}
            ${exportItem('json', bvLogo, 'JSON BetterVault', tr('Tout le contenu du coffre, tâches comprises', 'Everything in the vault, tasks included'))}
            ${exportItem('csv', brand('bitwarden'), 'CSV', tr('Compatible Bitwarden, Chrome, Firefox et tableurs', 'Works with Bitwarden, Chrome, Firefox and spreadsheets'))}
          </div>

          <div class="ie-group-title">${tr('Vers un autre gestionnaire', 'To another password manager')}</div>
          <p class="field-hint">${tr('Fichier au format attendu par l’import de chaque application. Non chiffré.', 'File in the format each app expects on import. Not encrypted.')}</p>
          <div class="ie-export-list ie-export-grid">
            ${MANAGER_EXPORTS.map(format => exportItem(`manager:${format.id}`, format.logo ? brand(format.logo) : GENERIC_FILE_ICON,
              format.id === 'apple' ? tr('Mots de passe Apple (CSV)', 'Apple Passwords (CSV)') : format.name,
              format.extension.toUpperCase())).join('')}
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-primary" data-close>${i18n.t.common.close}</button>
        <button class="btn-primary" id="modal-import-confirm" disabled>${tr('Importer', 'Import')}</button>
      </div>
    `);

    const $ = <T extends HTMLElement>(selector: string) => box.querySelector(selector) as T;
    const confirmBtn = $<HTMLButtonElement>('#modal-import-confirm');

    // Onglets
    box.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        const name = tab.dataset.tab;
        box.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(t => {
          t.classList.toggle('active', t === tab);
          t.setAttribute('aria-selected', String(t === tab));
        });
        box.querySelectorAll<HTMLElement>('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
        confirmBtn.hidden = name !== 'import';
      });
    });

    /* ── Export ── */
    const exportDate = new Date().toISOString().slice(0, 10);
    const confirmPlaintextExport = () => this.confirmDialog({
      title: tr('Exporter en clair ?', 'Export in plain text?'),
      message: tr('Toute personne qui obtient ce fichier pourra lire vos mots de passe, codes 2FA et passkeys.', 'Anyone who gets this file can read your passwords, 2FA codes and passkeys.'),
      confirmLabel: tr('Exporter', 'Export'),
      danger: true
    });

    const exportPanel = $<HTMLElement>('#export-password-panel');
    const exportPwd = $<HTMLInputElement>('#export-password');
    const exportPwdConfirm = $<HTMLInputElement>('#export-password-confirm');
    const exportStatus = $<HTMLElement>('#export-password-status');
    const exportConfirmBtn = $<HTMLButtonElement>('#btn-export-password-confirm');
    let protectedExportMode: 'encrypted' | 'kdbx' = 'encrypted';

    const setExportStatus = (text: string, error = false) => {
      exportStatus.textContent = text;
      exportStatus.classList.toggle('error', error);
    };

    box.querySelectorAll<HTMLButtonElement>('[data-export]').forEach(button => {
      button.addEventListener('click', async () => {
        const kind = button.dataset.export;
        if (kind === 'encrypted' || kind === 'kdbx') {
          const reopen = exportPanel.hidden || protectedExportMode !== kind;
          box.querySelectorAll('[data-export]').forEach(b => b.setAttribute('aria-expanded', 'false'));
          if (!reopen) {
            exportPanel.hidden = true;
            return;
          }
          protectedExportMode = kind;
          button.setAttribute('aria-expanded', 'true');
          $<HTMLElement>('#export-password-title').textContent = kind === 'encrypted'
            ? tr('Mot de passe de l’export', 'Export password')
            : tr('Mot de passe de la base KeePass', 'KeePass database password');
          button.parentElement?.insertAdjacentElement('afterend', exportPanel);
          setExportStatus('');
          exportPanel.hidden = false;
          exportPwd.focus();
          return;
        }
        if (!(await confirmPlaintextExport())) return;
        const manager = kind?.startsWith('manager:') ? MANAGER_EXPORTS.find(f => `manager:${f.id}` === kind) : undefined;
        if (manager) {
          downloadExportFile(manager.build(creds), `bettervault-${manager.id}-${exportDate}.${manager.extension}`,
            manager.extension === 'json' ? 'application/json' : 'text/csv;charset=utf-8;');
        }
        if (kind === 'cxf') downloadExportFile(exportCredentialsAsCxf(creds), `bettervault-${exportDate}.cxf.json`, 'application/json');
        if (kind === 'json') downloadExportFile(exportVaultAsJson(creds, tasks), `bettervault-${exportDate}.json`, 'application/json');
        if (kind === 'csv') downloadExportFile(exportVaultAsCsv(creds), `bettervault-${exportDate}.csv`, 'text/csv;charset=utf-8;');
        if (!isTauri()) this.showToast(tr('Fichier enregistré dans vos téléchargements', 'File saved to your downloads'), 'success');
      });
    });

    exportConfirmBtn.addEventListener('click', async () => {
      if (exportPwd.value.length < MIN_EXPORT_PASSWORD_LENGTH) return setExportStatus(tr(`${MIN_EXPORT_PASSWORD_LENGTH} caractères minimum`, `At least ${MIN_EXPORT_PASSWORD_LENGTH} characters`), true);
      if (exportPwd.value !== exportPwdConfirm.value) return setExportStatus(tr('Les deux mots de passe sont différents', 'The two passwords are different'), true);

      exportConfirmBtn.disabled = true;
      setExportStatus(tr('Chiffrement…', 'Encrypting…'));
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
        box.querySelectorAll('[data-export]').forEach(b => b.setAttribute('aria-expanded', 'false'));
        if (!isTauri()) this.showToast(tr('Export chiffré enregistré', 'Encrypted export saved'), 'success');
      } catch (err) {
        setExportStatus(accountErrorMessage(err), true);
      } finally {
        exportConfirmBtn.disabled = false;
      }
    });

    /* ── Import ── */
    const sourcesStep = $<HTMLElement>('[data-step="sources"]');
    const fileStep = $<HTMLElement>('[data-step="file"]');
    const fileInput = $<HTMLInputElement>('#import-file-input');
    const statusEl = $<HTMLElement>('#import-status');
    const secretPanel = $<HTMLElement>('#import-secret-panel');
    const secretLabel = $<HTMLElement>('#import-secret-label');
    const secretPwd = $<HTMLInputElement>('#import-secret-password');
    const keyFileRow = $<HTMLElement>('#import-keyfile-row');
    const keyFileInput = $<HTMLInputElement>('#import-keyfile');
    const unlockBtn = $<HTMLButtonElement>('#btn-import-unlock');

    let pendingFile: { bytes: Uint8Array; name: string } | null = null;
    let ready: { credentials: Partial<CredentialItem>[]; tasks: Partial<Task>[] } | null = null;

    const setStatus = (html: string) => { statusEl.innerHTML = html; };

    const showSources = () => {
      sourcesStep.hidden = false;
      fileStep.hidden = true;
      pendingFile = null;
      ready = null;
      confirmBtn.disabled = true;
      setStatus('');
    };

    box.querySelectorAll<HTMLButtonElement>('[data-source]').forEach(button => {
      button.addEventListener('click', () => {
        const source = sources.find(s => s.id === button.dataset.source)!;
        $<HTMLElement>('[data-selected-logo]').innerHTML = source.logo;
        $<HTMLElement>('[data-selected-name]').textContent = source.name;
        $<HTMLElement>('[data-selected-formats]').textContent = source.formats;
        $<HTMLElement>('[data-selected-steps]').innerHTML = source.steps.map(step => `<li>${this.escapeHtml(step)}</li>`).join('');
        fileInput.accept = source.accept;
        sourcesStep.hidden = true;
        fileStep.hidden = false;
        secretPanel.hidden = true;
        setStatus('');
        $<HTMLElement>('#drop-zone').focus();
      });
    });
    $<HTMLButtonElement>('[data-action="change-source"]').addEventListener('click', showSources);

    const tryParse = async (secrets?: ImportSecrets) => {
      if (!pendingFile) return;
      confirmBtn.disabled = true;
      ready = null;
      if (secrets) setStatus(`<div class="field-hint">${tr('Déchiffrement…', 'Decrypting…')}</div>`);
      try {
        const parsed = await parseImportData(pendingFile.bytes, pendingFile.name, secrets);
        secretPanel.hidden = true;
        secretPwd.value = '';

        const valid = parsed.credentials.filter(c => !checkCredential(c, limits, tr));
        const skipped = parsed.credentials.length - valid.length;
        const capacity = remainingCapacity(vaultStore.getData(), vaultStore.getData().activeVaultId, limits);
        const file = this.escapeHtml(pendingFile.name);

        if (valid.length === 0 && parsed.tasks.length === 0) {
          setStatus(`<div class="notice notice-warning">${tr(`Aucun identifiant trouvé dans ${file}.`, `No credentials found in ${file}.`)}</div>`);
          return;
        }
        if (valid.length > capacity.credentials) {
          setStatus(`<div class="notice notice-danger"><strong>${tr('Trop d’identifiants', 'Too many credentials')}</strong> · ${tr(`ce coffre peut encore en recevoir ${capacity.credentials}, le fichier en contient ${valid.length}.`, `this vault can take ${capacity.credentials} more, the file has ${valid.length}.`)}</div>`);
          return;
        }

        ready = { credentials: valid, tasks: parsed.tasks };
        const parts = [
          tr(`${valid.length} identifiant${valid.length > 1 ? 's' : ''}`, `${valid.length} credential${valid.length === 1 ? '' : 's'}`),
          ...(parsed.tasks.length ? [tr(`${parsed.tasks.length} tâche${parsed.tasks.length > 1 ? 's' : ''}`, `${parsed.tasks.length} task${parsed.tasks.length === 1 ? '' : 's'}`)] : [])
        ];
        setStatus(`
          <div class="notice notice-success"><strong>${tr('Prêt à importer', 'Ready to import')}</strong> · ${parts.join(tr(' et ', ' and '))} (${file}, ${this.escapeHtml(parsed.sourceFormat)})</div>
          ${skipped ? `<div class="notice notice-warning" style="margin-top:8px;">${tr(`${skipped} élément${skipped > 1 ? 's' : ''} dépasse${skipped > 1 ? 'nt' : ''} les limites du coffre et ne ser${skipped > 1 ? 'ont' : 'a'} pas importé${skipped > 1 ? 's' : ''}.`, `${skipped} item${skipped === 1 ? '' : 's'} exceed the vault limits and will be skipped.`)}</div>` : ''}`);
        confirmBtn.disabled = false;
        confirmBtn.focus();
      } catch (err) {
        if (err instanceof PasswordRequiredError) {
          secretPanel.hidden = false;
          keyFileRow.hidden = err.kind !== 'kdbx';
          secretLabel.textContent = err.kind === 'kdbx'
            ? tr('Mot de passe de la base KeePass', 'KeePass database password')
            : tr('Mot de passe de l’export chiffré', 'Encrypted export password');
          setStatus(secrets ? `<div class="notice notice-danger">${this.escapeHtml(err.message)}</div>` : '');
          secretPwd.focus();
          return;
        }
        setStatus(`<div class="notice notice-danger"><strong>${tr('Fichier illisible', 'Unreadable file')}</strong> · ${this.escapeHtml(accountErrorMessage(err))}</div>`);
      }
    };

    const handleFile = async (file: File) => {
      pendingFile = { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name };
      secretPanel.hidden = true;
      secretPwd.value = '';
      keyFileInput.value = '';
      await tryParse();
    };

    unlockBtn.addEventListener('click', async () => {
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
    secretPwd.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        unlockBtn.click();
      }
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      // Vidé après lecture : choisir à nouveau le même fichier relance la lecture
      fileInput.value = '';
      if (file) void handleFile(file);
    });

    // Seule la zone de dépôt ouvre le sélecteur de fichier (clic ou clavier)
    const dropZone = $<HTMLElement>('#drop-zone');
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragging'); });
    dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('dragging'); });
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('dragging');
      const file = e.dataTransfer?.files[0];
      if (file) void handleFile(file);
    });

    confirmBtn.addEventListener('click', () => {
      if (!ready) return;
      const result = vaultStore.importBulk(ready.credentials, ready.tasks);
      pendingFile?.bytes.fill(0);
      pendingFile = null;
      this.closeModal();
      this.showToast(tr(`${result.credentials} identifiant${result.credentials > 1 ? 's' : ''} importé${result.credentials > 1 ? 's' : ''}`, `${result.credentials} credential${result.credentials === 1 ? '' : 's'} imported`), 'success');
    });
  }

  /* ── Compte : déverrouillage, verrouillage, synchronisation ─────────── */
  private initAccount(): void {
    this.authScreen = mountAuthScreen(document.getElementById('auth-screen') as HTMLElement, accountService, data => this.showApp(data), { deviceStore: this.deviceStore });

    sharedVaults.onSaveError((vaultId, err) => {
      this.showToast(err instanceof SharedReadOnlyError ? err.message : `${this.tr('Coffre partagé non enregistré', 'Shared vault not saved')} : ${accountErrorMessage(err)}`, 'error', 5000);
      this.reloadWithShared();
      void this.refreshSharedVaults();
      if (vaultId === this.selectedItemId) this.renderDetail(null);
    });

    accountService.onRemoteData(data => {
      vaultStore.load(sharedVaults.mergeInto(data));
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
      if (!accountService.isUnlocked()) return;
      void accountService.syncNow();
      void this.refreshSharedVaults();
    }, SYNC_INTERVAL_MS);

    this.renderSyncStatus();
    // Extension : le coffre reste ouvert quelques minutes entre deux ouvertures du popup
    void accountService.resumeSession().then(data => {
      if (data) this.showApp(data);
      else this.authScreen?.show();
    });
  }

  /** Coffres partagés : liste, contenu et invitations */
  private async refreshSharedVaults(): Promise<void> {
    if (!sharedVaults.isAvailable()) {
      this.renderInvitations();
      return;
    }
    try {
      if (await sharedVaults.refresh()) this.reloadWithShared();
    } catch (err) {
      console.warn('Coffres partagés indisponibles', err);
    }
    this.renderInvitations();
  }

  private reloadWithShared(): void {
    const personal = accountService.getLatestData();
    if (!personal) return;
    const activeVaultId = vaultStore.getData().activeVaultId;
    vaultStore.load(sharedVaults.mergeInto(personal));
    if (vaultStore.getData().vaults.some(v => v.id === activeVaultId)) vaultStore.setActiveVault(activeVaultId);
  }

  /** Vrai si le rôle de l'utilisateur permet de modifier le coffre (toujours vrai pour un coffre personnel) */
  private canEdit(vaultId: string, permission: SharedPermission = 'write'): boolean {
    if (sharedVaults.can(vaultId, permission)) return true;
    this.showToast(this.tr('Votre rôle dans ce coffre partagé ne permet pas cette action', 'Your role in this shared vault does not allow this'), 'error');
    return false;
  }

  private renderInvitations(): void {
    const host = document.getElementById('shared-invitations');
    if (!host) return;
    const invitations = sharedVaults.isAvailable() ? sharedVaults.invitations() : [];
    host.hidden = invitations.length === 0;
    host.innerHTML = invitations.length ? `
      <button type="button" class="invitation-banner" data-action="invitations">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        <span>${this.tr(`${invitations.length} invitation${invitations.length > 1 ? 's' : ''} à un coffre partagé`, `${invitations.length} shared vault invitation${invitations.length > 1 ? 's' : ''}`)}</span>
      </button>` : '';
    host.querySelector('[data-action="invitations"]')?.addEventListener('click', () => this.openInvitationsModal());
  }

  private openInvitationsModal(): void {
    const tr = (fr: string, en: string) => this.tr(fr, en);
    const render = () => sharedVaults.invitations().map(inv => `
      <div class="member-row" data-vault="${inv.id}">
        <div class="member-main">
          <div class="member-email">${this.escapeHtml(inv.invitedByEmail ?? inv.ownerEmail)}</div>
          <div class="field-hint">${tr('Rôle proposé', 'Offered role')} : ${this.escapeHtml(this.roleLabel(inv.role))} · ${tr('propriétaire', 'owner')} ${this.escapeHtml(inv.ownerEmail)}</div>
        </div>
        <button class="btn-primary btn-ghost" data-action="decline">${tr('Refuser', 'Decline')}</button>
        <button class="btn-primary btn-accent" data-action="accept">${tr('Accepter', 'Accept')}</button>
      </div>`).join('') || `<p class="modal-text">${tr('Aucune invitation en attente.', 'No pending invitations.')}</p>`;

    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title">${tr('Invitations', 'Invitations')}</div>
        <button class="modal-close">${GEN_ICONS.close}</button>
      </div>
      <div class="modal-body">
        <p class="modal-text">${tr('Le nom et le contenu du coffre s’affichent après acceptation : ils sont chiffrés pour les membres uniquement.', 'The vault name and content appear after you accept: they are encrypted for members only.')}</p>
        <div class="member-list" data-list>${render()}</div>
      </div>
      <div class="modal-footer"><button class="btn-primary" data-close>${tr('Fermer', 'Close')}</button></div>
    `);
    const list = box.querySelector('[data-list]') as HTMLElement;
    list.addEventListener('click', async e => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
      const vaultId = button?.closest<HTMLElement>('[data-vault]')?.dataset.vault;
      if (!button || !vaultId) return;
      button.disabled = true;
      try {
        if (button.dataset.action === 'accept') {
          await sharedVaults.accept(vaultId);
          this.reloadWithShared();
          this.showToast(tr('Vous avez rejoint le coffre partagé', 'You joined the shared vault'), 'success');
        } else {
          await sharedVaults.decline(vaultId);
        }
        list.innerHTML = render();
        this.renderInvitations();
        if (sharedVaults.invitations().length === 0) this.closeModal();
      } catch (err) {
        button.disabled = false;
        this.showToast(accountErrorMessage(err), 'error');
      }
    });
  }

  private roleLabel(role: SharedRole): string {
    const labels: Record<string, string> = {
      owner: this.tr('Propriétaire', 'Owner'),
      admin: this.tr('Administrateur', 'Administrator'),
      editor: this.tr('Éditeur', 'Editor'),
      viewer: this.tr('Lecteur', 'Viewer')
    };
    return role.builtin ? labels[role.builtin] : role.name;
  }

  /* ── Pièces jointes ──────────────────────────────────────────────────── */
  private renderAttachments(cred: CredentialItem): string {
    const tr = (fr: string, en: string) => this.tr(fr, en);
    const files = cred.attachments ?? [];
    const formatSize = formatFileSize;
    const available = accountService.isCloud();
    return `
      <div class="field-group">
        <div class="section-divider" style="margin-bottom:8px;">${tr('Pièces jointes', 'Attachments')} (${files.length})</div>
        <div class="attachment-list">
          ${files.map(file => `
            <div class="attachment-row" data-attachment="${file.id}">
              <span class="attachment-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg></span>
              <span class="attachment-text"><span class="attachment-name">${this.escapeHtml(file.name)}</span><span class="field-hint">${formatSize(file.size)}</span></span>
              ${isPreviewable(file.type, file.name) ? `<button class="icon-btn" type="button" data-attachment-action="preview" title="${tr('Aperçu', 'Preview')}" aria-label="${tr('Aperçu de', 'Preview')} ${this.escapeHtml(file.name)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>` : ''}
              <button class="icon-btn" type="button" data-attachment-action="download" title="${tr('Télécharger', 'Download')}" aria-label="${tr('Télécharger', 'Download')}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
              <button class="icon-btn" type="button" data-attachment-action="delete" title="${tr('Supprimer', 'Delete')}" aria-label="${tr('Supprimer', 'Delete')}">${ACTION_ICONS.trash}</button>
            </div>`).join('')}
        </div>
        ${available
          ? `<label class="btn-primary btn-ghost" style="align-self:flex-start;cursor:pointer;">+ ${tr('Ajouter un fichier', 'Add a file')}<input type="file" data-attachment-input multiple hidden></label>`
          : `<div class="field-hint">${tr('Les pièces jointes demandent un compte synchronisé : elles sont chiffrées puis stockées sur votre serveur.', 'Attachments need a synced account: they are encrypted and stored on your server.')}</div>`}
      </div>`;
  }

  private bindAttachments(container: HTMLElement, cred: CredentialItem): void {
    const tr = (fr: string, en: string) => this.tr(fr, en);
    const sharedId = sharedVaults.isShared(cred.vaultId) ? cred.vaultId : undefined;
    const current = () => vaultStore.getData().credentials.find(c => c.id === cred.id);

    container.querySelector<HTMLInputElement>('[data-attachment-input]')?.addEventListener('change', async e => {
      const input = e.target as HTMLInputElement;
      const files = [...(input.files ?? [])];
      input.value = '';
      if (!files.length || !this.canEdit(cred.vaultId, 'attachments')) return;
      const limits = accountService.getLimits();
      for (const file of files) {
        if (file.size > limits.maxAttachmentBytes) {
          this.showToast(tr(`${file.name} dépasse ${Math.round(limits.maxAttachmentBytes / 1048576)} Mo`, `${file.name} is larger than ${Math.round(limits.maxAttachmentBytes / 1048576)} MB`), 'error');
          continue;
        }
        try {
          const { payload, key } = await encryptFile(new Uint8Array(await file.arrayBuffer()));
          const uploaded = await accountService.withCloud(client => client.uploadAttachment(payload, sharedId));
          const meta: AttachmentMeta = { id: uploaded.id, name: file.name, size: file.size, type: file.type, key, createdAt: Date.now() };
          vaultStore.updateCredential(cred.id, { attachments: [...(current()?.attachments ?? []), meta] });
          this.showToast(tr(`${file.name} ajouté`, `${file.name} added`), 'success');
        } catch (err) {
          this.showToast(`${file.name} : ${accountErrorMessage(err)}`, 'error');
        }
      }
    });

    container.querySelectorAll<HTMLButtonElement>('[data-attachment-action]').forEach(button => {
      button.addEventListener('click', async () => {
        const id = button.closest<HTMLElement>('[data-attachment]')?.dataset.attachment;
        const meta = current()?.attachments?.find(a => a.id === id);
        if (!meta) return;
        if (button.dataset.attachmentAction === 'preview') {
          button.disabled = true;
          try {
            const payload = await accountService.withCloud(client => client.downloadAttachment(meta.id));
            this.openAttachmentPreview(meta, await decryptFile(payload, meta.key));
          } catch (err) {
            this.showToast(accountErrorMessage(err), 'error');
          } finally {
            button.disabled = false;
          }
          return;
        }
        if (button.dataset.attachmentAction === 'download') {
          button.disabled = true;
          try {
            const payload = await accountService.withCloud(client => client.downloadAttachment(meta.id));
            downloadExportFile(await decryptFile(payload, meta.key), meta.name, meta.type || 'application/octet-stream');
          } catch (err) {
            this.showToast(accountErrorMessage(err), 'error');
          } finally {
            button.disabled = false;
          }
          return;
        }
        if (!this.canEdit(cred.vaultId, 'attachments')) return;
        const confirmed = await this.confirmDialog({
          title: tr('Supprimer la pièce jointe ?', 'Delete attachment?'),
          message: tr(`${meta.name} sera supprimé du serveur.`, `${meta.name} will be deleted from the server.`),
          confirmLabel: tr('Supprimer', 'Delete'),
          danger: true
        });
        if (!confirmed) return;
        try {
          await accountService.withCloud(client => client.deleteAttachment(meta.id)).catch(err => {
            if (!(err instanceof Error && 'status' in err && (err as { status: number }).status === 404)) throw err;
          });
          vaultStore.updateCredential(cred.id, { attachments: (current()?.attachments ?? []).filter(a => a.id !== meta.id) });
        } catch (err) {
          this.showToast(accountErrorMessage(err), 'error');
        }
      });
    });
  }

  /** Aperçu d'une pièce jointe déchiffrée : rien n'est écrit sur le disque, l'URL blob est libérée à la fermeture */
  private openAttachmentPreview(meta: AttachmentMeta, data: Uint8Array): void {
    const tr = (fr: string, en: string) => this.tr(fr, en);
    const kind = previewKind(meta.type, meta.name);
    // Un SVG s'affiche comme une image, mais son contenu peut exécuter du script : il est montré en texte
    const svg = /svg/i.test(meta.type) || meta.name.toLowerCase().endsWith('.svg');
    const type = meta.type || (kind === 'pdf' ? 'application/pdf' : 'application/octet-stream');
    const blob = new Blob([data as unknown as BlobPart], { type: svg ? 'text/plain' : type });
    const url = URL.createObjectURL(blob);

    let body: string;
    if (kind === 'image' && !svg) body = `<img class="attachment-preview-image" src="${url}" alt="${this.escapeHtml(meta.name)}">`;
    else if (kind === 'pdf') body = `<iframe class="attachment-preview-frame" src="${url}" title="${this.escapeHtml(meta.name)}"></iframe>`;
    else if (kind === 'audio') body = `<audio class="attachment-preview-media" src="${url}" controls></audio>`;
    else if (kind === 'video') body = `<video class="attachment-preview-media" src="${url}" controls></video>`;
    else body = `<pre class="attachment-preview-text">${this.escapeHtml(new TextDecoder().decode(data).slice(0, 200_000))}</pre>`;

    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title">${this.escapeHtml(meta.name)}</div>
        <button class="modal-close">${GEN_ICONS.close}</button>
      </div>
      <div class="modal-body attachment-preview-body">${body}</div>
      <div class="modal-footer">
        <span class="field-hint">${formatFileSize(meta.size)}${svg ? ` · ${tr('SVG affiché en texte', 'SVG shown as text')}` : ''}</span>
        <button class="btn-primary" data-preview-download>${tr('Télécharger', 'Download')}</button>
        <button class="btn-primary" data-close>${tr('Fermer', 'Close')}</button>
      </div>
    `);
    box.querySelector('[data-preview-download]')?.addEventListener('click', () => {
      downloadExportFile(data, meta.name, type);
    });
    // La fenêtre est retirée du DOM à la fermeture : on libère l'URL à ce moment-là
    new MutationObserver((_records, observer) => {
      if (box.isConnected) return;
      URL.revokeObjectURL(url);
      observer.disconnect();
    }).observe(document.body, { childList: true, subtree: true });
  }

  private showApp(data: UnlockedVaultData): void {
    vaultStore.load(data);
    vaultStore.setPersistence(snapshot => void accountService.save(sharedVaults.split(snapshot)));
    void this.refreshSharedVaults();
    this.selectedItemId = null;
    this.activeTag = null;
    (document.getElementById('app') as HTMLElement).hidden = false;
    this.renderDetail(null);
    this.renderSyncStatus();
    void accountService.getAvatarSource().then(src => {
      this.avatarSrc = src;
      this.renderSyncStatus();
    }).catch(() => undefined);
    void accountService.syncNow();
    void this.renderSiteStrip();
  }

  /** Extension : identifiants du site ouvert dans l'onglet actif, remplissage en un clic */
  private async renderSiteStrip(): Promise<void> {
    const strip = document.getElementById('site-strip');
    const surface = extensionSurface();
    if (!strip || !surface || !vaultStore.isLoaded()) return;
    const { host } = await activeTabHost();
    const data = vaultStore.getData();
    const matches = host ? data.credentials.filter(c => matchesSite(c, host)) : [];
    const tr = (fr: string, en: string) => this.tr(fr, en);

    strip.hidden = false;
    strip.innerHTML = `
      <div class="site-strip-head">
        <span class="site-strip-host">${host ? this.escapeHtml(host) : tr('Aucun site web dans cet onglet', 'No website in this tab')}</span>
        <span class="site-strip-actions">
          ${surface === 'popup' ? `<button type="button" class="icon-btn" data-ext="panel" title="${tr('Ouvrir dans le panneau latéral', 'Open in the side panel')}" aria-label="${tr('Ouvrir dans le panneau latéral', 'Open in the side panel')}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/></svg></button>` : ''}
          <button type="button" class="icon-btn" data-ext="tab" title="${tr('Ouvrir dans un onglet', 'Open in a tab')}" aria-label="${tr('Ouvrir dans un onglet', 'Open in a tab')}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/></svg></button>
        </span>
      </div>
      ${matches.map(c => `
        <div class="site-strip-row" data-id="${c.id}">
          <span class="record-icon">${this.credentialIcon(c, 16)}</span>
          <span class="site-strip-text">
            <span class="record-title">${this.escapeHtml(c.title)}</span>
            <span class="record-sub">${this.escapeHtml(c.username || '—')}</span>
          </span>
          <button type="button" class="icon-btn" data-ext="copy" title="${tr('Copier le mot de passe', 'Copy password')}" aria-label="${tr('Copier le mot de passe', 'Copy password')}">${GEN_ICONS.copy}</button>
          <button type="button" class="btn-primary btn-accent" data-ext="fill">${tr('Remplir', 'Fill')}</button>
        </div>`).join('')}
      ${host && matches.length === 0 ? `<div class="site-strip-empty">${tr('Aucun identifiant enregistré pour ce site', 'No credentials saved for this site')}</div>` : ''}`;

    strip.onclick = async e => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('[data-ext]');
      if (!button) return;
      const action = button.dataset.ext;
      if (action === 'panel') {
        if (await openSidePanel()) window.close();
        else this.showToast(tr('Panneau latéral indisponible dans ce navigateur', 'Side panel not available in this browser'), 'error');
        return;
      }
      if (action === 'tab') {
        openFullTab();
        if (surface === 'popup') window.close();
        return;
      }
      const cred = vaultStore.getData().credentials.find(c => c.id === button.closest<HTMLElement>('[data-id]')?.dataset.id);
      if (!cred) return;
      if (action === 'copy') {
        await this.copyToClipboardWithAutoClear(cred.password, tr('Mot de passe copié', 'Password copied'), true);
        return;
      }
      const outcome = await fillActiveTab(cred);
      if (outcome === 'filled') {
        if (surface === 'popup') window.close();
        else this.showToast(tr('Formulaire rempli', 'Form filled'), 'success');
      } else {
        this.showToast(
          outcome === 'domain' ? tr('Refusé : la page n’appartient pas au site de cet identifiant', 'Refused: the page does not belong to this credential’s site')
            : outcome === 'no-fields' ? tr('Aucun champ de connexion trouvé sur la page', 'No sign-in field found on the page')
            : tr('Impossible de remplir cette page', 'Cannot fill this page'),
          'error'
        );
      }
    };
  }

  private lockApp(): void {
    if (!accountService.isUnlocked()) return;
    accountService.lock();
    this.avatarSrc = null;
    sharedVaults.clear();
    this.renderInvitations();
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
    sharedVaults.clear();
    this.renderInvitations();
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
    const avatar = this.avatarSrc
      ? `<img class="sync-avatar" src="${this.escapeHtml(this.avatarSrc)}" alt="" referrerpolicy="no-referrer">`
      : '';
    el.innerHTML = `${avatar}<span class="sync-dot" style="background-color:${colors[status]};"></span><span class="sync-label">${this.syncStatusLabel(status)}</span>`;
    const button = document.getElementById('btn-sync-status');
    if (button) button.title = [account?.email, state.message && translateError(state.message, i18n.getLocale())].filter(Boolean).join(' — ');
  }

  private openAccountModal(): void {
    const account = accountService.getAccount();
    if (!account) return;
    const isCloud = account.mode === 'cloud';
    const locale = this.dateLocale();
    const limits = accountService.getLimits();
    const tr = (fr: string, en: string) => this.tr(fr, en);
    const hasRecovery = accountService.hasRecoveryKey();

    const limitRows: Array<[string, string]> = [
      [tr('Coffres', 'Vaults'), limits.maxVaults.toLocaleString(locale)],
      [tr('Identifiants par coffre', 'Credentials per vault'), limits.maxCredentialsPerVault.toLocaleString(locale)],
      [tr('Tâches par coffre', 'Tasks per vault'), limits.maxTasksPerVault.toLocaleString(locale)],
      [tr('Longueur d’une note', 'Note length'), tr(`${limits.maxNoteLength.toLocaleString(locale)} caractères`, `${limits.maxNoteLength.toLocaleString(locale)} characters`)],
      [tr('Longueur d’une URL', 'URL length'), tr(`${limits.maxUrlLength.toLocaleString(locale)} caractères`, `${limits.maxUrlLength.toLocaleString(locale)} characters`)],
      [tr('Taille du coffre chiffré', 'Encrypted vault size'), `${Math.round(limits.maxVaultBytes / 1048576)} ${tr('Mo', 'MB')}`]
    ];

    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title">${tr('Compte', 'Account')}</div>
        <button class="modal-close">${GEN_ICONS.close}</button>
      </div>
      <div class="modal-body">
        <div class="account-summary">
          <div class="account-avatar" data-account-avatar>${this.avatarSrc ? `<img src="${this.escapeHtml(this.avatarSrc)}" alt="" referrerpolicy="no-referrer">` : this.escapeHtml(account.email.charAt(0).toUpperCase())}</div>
          <div class="account-summary-text">
            <div class="account-email">${this.escapeHtml(account.email)}</div>
            <div class="account-meta">${isCloud
              ? `${tr('Synchronisé avec', 'Synced with')} ${this.escapeHtml(account.serverUrl ?? '')}`
              : tr('Stocké uniquement sur cet appareil', 'Stored on this device only')}</div>
          </div>
        </div>

        <div class="tab-btn-group account-tabs" role="tablist">
          <button type="button" class="tab-btn active" role="tab" aria-selected="true" data-account-tab="general">${tabIcon('general')}<span>${tr('Général', 'General')}</span></button>
          <button type="button" class="tab-btn" role="tab" aria-selected="false" data-account-tab="security">${tabIcon('security')}<span>${tr('Sécurité', 'Security')}</span></button>
          ${isCloud ? `<button type="button" class="tab-btn" role="tab" aria-selected="false" data-account-tab="sessions">${tabIcon('sessions')}<span>${tr('Sessions', 'Sessions')}</span></button>` : ''}
          <button type="button" class="tab-btn" role="tab" aria-selected="false" data-account-tab="plan">${tabIcon('storage')}<span>${isCloud ? tr('Espace', 'Storage') : tr('Limites', 'Limits')}</span></button>
          <button type="button" class="tab-btn" role="tab" aria-selected="false" data-account-tab="data">${tabIcon('data')}<span>${tr('Données', 'Data')}</span></button>
        </div>

        <div data-tab-panel="general">
        ${isCloud ? `
          <div class="account-sync-row">
            <div style="min-width:0;">
              <div class="form-label">${tr('Synchronisation', 'Sync')}</div>
              <div class="account-sync-state" data-sync-state></div>
            </div>
            <button class="btn-primary" data-action="sync">${GEN_ICONS.refresh}<span>${tr('Synchroniser', 'Sync now')}</span></button>
          </div>
          <div class="form-section" data-reauth hidden>
            <div class="form-section-title">${tr('Session expirée', 'Session expired')}</div>
            <p class="modal-text">${tr('Saisissez un code de votre application d’authentification pour reprendre la synchronisation.', 'Enter a code from your authenticator app to resume syncing.')}</p>
            <div class="form-row" style="grid-template-columns:minmax(0,1fr) auto;">
              <input class="form-input otp-input" data-reauth-code inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000">
              <button class="btn-primary btn-accent" data-action="reauth">${tr('Reprendre', 'Resume')}</button>
            </div>
            <div class="form-error" data-error="reauth" role="alert" hidden></div>
          </div>` : `
          <section class="account-section">
            <h3 class="account-section-title">${tr('Activer la synchronisation', 'Enable sync')}</h3>
            <p class="modal-text">${tr('Le coffre est envoyé chiffré. Le mot de passe principal ne quitte jamais cet appareil.', 'The vault is uploaded encrypted. The master password never leaves this device.')}</p>
            <div class="form-field">
              <label class="form-label" for="account-server">${tr('Adresse du serveur', 'Server address')}</label>
              <input class="form-input" id="account-server" type="url" value="${this.escapeHtml(DEFAULT_SERVER_URL)}" autocomplete="url" spellcheck="false">
            </div>
            <div class="form-field">
              <label class="form-label" for="account-connect-password">${tr('Mot de passe principal', 'Master password')}</label>
              <input class="form-input" id="account-connect-password" type="password" autocomplete="current-password">
            </div>
            <div class="form-error" data-error="connect" role="alert" hidden></div>
            <div class="account-actions account-actions-end">
              <button class="btn-primary btn-accent" data-action="connect">${tr('Activer', 'Enable')}</button>
            </div>
          </section>`}

        <section class="account-section" data-profile-section>
          <h3 class="account-section-title">${tr('Photo de profil', 'Profile picture')}</h3>
          <div class="profile-row">
            <div class="account-avatar large" data-profile-preview>${this.escapeHtml(account.email.charAt(0).toUpperCase())}</div>
            <div class="profile-controls" data-profile-controls><span class="skeleton skeleton-line" style="width:60%"></span></div>
          </div>
          <div class="form-error" data-error="avatar" role="alert" hidden></div>
        </section>

        <section class="account-section" data-device-section hidden></section>

        <section class="account-section">
          <h3 class="account-section-title">${tr('Session sur cet appareil', 'Session on this device')}</h3>
          <div class="account-actions">
            <button class="btn-primary" data-action="lock">${tr('Verrouiller', 'Lock')}</button>
            <button class="btn-primary btn-ghost" data-action="signout">${tr('Se déconnecter de cet appareil', 'Sign out of this device')}</button>
          </div>
        </section>
        </div>

        <div data-tab-panel="security" hidden>
        <section class="account-section">
          <h3 class="account-section-title">${tr('Sécurité du compte', 'Account security')}</h3>
          ${isCloud ? `
            <div class="switch-row" style="cursor:default;">
              <span>${tr('Double authentification', 'Two-factor authentication')}<small>${tr('Un code de votre application (Aegis, Google Authenticator, 2FAS…) est demandé à chaque connexion', 'A code from your app (Aegis, Google Authenticator, 2FAS…) is required at every sign-in')}</small></span>
              <span class="status-pill" data-totp-status>…</span>
            </div>
            <div class="account-actions account-actions-end"><button class="btn-primary" data-action="totp" disabled>${tr('Configurer', 'Set up')}</button></div>
            <div class="form-section" data-totp-flow hidden></div>` : `
            <p class="modal-text">${tr('La double authentification protège la connexion au serveur : activez d’abord la synchronisation.', 'Two-factor authentication protects the server sign-in: enable sync first.')}</p>`}
          <div class="switch-row" style="cursor:default;">
            <span>${tr('Clé de secours', 'Recovery key')}<small>${tr('Permet de choisir un nouveau mot de passe principal sans perdre le coffre', 'Lets you set a new master password without losing the vault')}</small></span>
            <span class="status-pill ${hasRecovery ? 'on' : 'off'}">${hasRecovery ? tr('Créée', 'Created') : tr('Aucune', 'None')}</span>
          </div>
          <div class="account-actions account-actions-end"><button class="btn-primary" data-action="recovery">${hasRecovery ? tr('Créer une nouvelle clé', 'Create a new key') : tr('Créer une clé', 'Create a key')}</button></div>
          <div class="form-section" data-recovery-flow hidden>
            ${hasRecovery ? `<p class="modal-text">${tr('L’ancienne clé cessera de fonctionner.', 'The previous key will stop working.')}</p>` : ''}
            <div class="form-row" style="grid-template-columns:minmax(0,1fr) auto;">
              <input class="form-input" type="password" data-recovery-password autocomplete="current-password" placeholder="${tr('Mot de passe principal', 'Master password')}">
              <button class="btn-primary btn-accent" data-action="recovery-create">${tr('Créer', 'Create')}</button>
            </div>
            <div class="form-error" data-error="recovery" role="alert" hidden></div>
          </div>
        </section>

        <section class="account-section">
          <h3 class="account-section-title">${tr('Changer le mot de passe principal', 'Change master password')}</h3>
          <div class="form-field">
            <label class="form-label" for="account-current-password">${tr('Mot de passe actuel', 'Current password')}</label>
            <input class="form-input" id="account-current-password" type="password" autocomplete="current-password">
          </div>
          <div class="form-row">
            <div class="form-field">
              <label class="form-label" for="account-new-password">${tr('Nouveau mot de passe', 'New password')}</label>
              <input class="form-input" id="account-new-password" type="password" autocomplete="new-password">
            </div>
            <div class="form-field">
              <label class="form-label" for="account-new-password-confirm">${tr('Confirmer', 'Confirm')}</label>
              <input class="form-input" id="account-new-password-confirm" type="password" autocomplete="new-password">
            </div>
          </div>
          <div class="form-error" data-error="password" role="alert" hidden></div>
          <div class="account-actions account-actions-end">
            <button class="btn-primary" data-action="change-password">${tr('Changer le mot de passe', 'Change password')}</button>
          </div>
        </section>
        </div>

        ${isCloud ? `
        <div data-tab-panel="sessions" hidden>
          <section class="account-section">
            <div class="account-section-head">
              <h3 class="account-section-title">${tr('Appareils connectés', 'Signed-in devices')}</h3>
              <button class="btn-primary btn-ghost btn-sm" data-action="sessions-refresh">${GEN_ICONS.refresh}<span>${tr('Actualiser', 'Refresh')}</span></button>
            </div>
            <p class="modal-text">${tr('Adresse IP tronquée et lieu approximatif, calculés par votre serveur. Fermer une session déconnecte l’appareil au prochain échange avec le serveur.', 'Truncated IP address and approximate place, computed by your server. Closing a session signs the device out the next time it talks to the server.')}</p>
            <div class="session-list" data-session-list></div>
            <div class="form-section session-confirm" data-session-confirm hidden></div>
          </section>
        </div>` : ''}

        <div data-tab-panel="plan" hidden>
          ${isCloud ? `<section class="account-section" data-billing-section>
            <h3 class="account-section-title">${tr('Espace de stockage', 'Storage')}</h3>
            <div data-usage></div>
            <div data-plans></div>
          </section>` : ''}
          <section class="account-section">
            <h3 class="account-section-title">${isCloud ? tr('Limites du compte', 'Account limits') : tr('Limites', 'Limits')}</h3>
            <div class="limit-grid" data-limit-grid>
              ${limitRows.map(([label, value]) => `<span>${label}</span><span>${value}</span>`).join('')}
            </div>
          </section>
        </div>

        <div data-tab-panel="data" hidden>
        <section class="account-section">
          <h3 class="account-section-title">${tr('Confidentialité', 'Privacy')}</h3>
          <p class="modal-text">${isCloud
            ? tr('Le serveur ne reçoit que des données chiffrées sur cet appareil : il ne peut lire ni vos identifiants, ni vos notes, ni vos fichiers.', 'The server only receives data encrypted on this device: it cannot read your credentials, notes or files.')
            : tr('Rien ne quitte cet appareil.', 'Nothing leaves this device.')}</p>
          <div class="legal-links" data-legal-links></div>
          <div class="account-actions">
            <button class="btn-primary" data-action="export">${tr('Exporter mes données', 'Export my data')}</button>
          </div>
        </section>

        ${isCloud ? `
          <section class="account-section account-danger">
            <h3 class="account-section-title">${tr('Supprimer le compte en ligne', 'Delete online account')}</h3>
            <p class="modal-text">${tr('Supprime le coffre du serveur. Les données restent sur cet appareil.', 'Deletes the vault from the server. Data stays on this device.')}</p>
            <div class="form-field">
              <label class="form-label" for="account-delete-password">${tr('Mot de passe principal', 'Master password')}</label>
              <input class="form-input" id="account-delete-password" type="password" autocomplete="current-password">
            </div>
            <div class="form-error" data-error="delete" role="alert" hidden></div>
            <div class="account-actions account-actions-end">
              <button class="btn-primary btn-danger" data-action="delete">${tr('Supprimer le compte en ligne', 'Delete online account')}</button>
            </div>
          </section>` : ''}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-primary" data-close>${tr('Fermer', 'Close')}</button>
      </div>
    `);

    const $ = <T extends HTMLElement>(selector: string) => box.querySelector(selector) as T | null;
    box.classList.add('account-modal');

    const loaded = new Set<string>();
    const selectTab = (name: string) => {
      box.querySelectorAll<HTMLElement>('[data-account-tab]').forEach(tab => {
        const active = tab.dataset.accountTab === name;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
      });
      box.querySelectorAll<HTMLElement>('[data-tab-panel]').forEach(panel => { panel.hidden = panel.dataset.tabPanel !== name; });
      if (loaded.has(name)) return;
      loaded.add(name);
      if (name === 'sessions') void loadSessions();
      if (name === 'plan' && isCloud) void loadBilling();
      if (name === 'data') void loadLegal();
    };
    box.querySelectorAll<HTMLElement>('[data-account-tab]').forEach(tab => tab.addEventListener('click', () => selectTab(tab.dataset.accountTab!)));

    const renderState = () => {
      const el = $('[data-sync-state]');
      if (!el) return;
      const state = accountService.getSyncState();
      const when = state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString(locale) : tr('jamais', 'never');
      el.textContent = `${this.syncStatusLabel(state.status)} · ${tr('dernière synchro', 'last sync')} ${when}${state.message ? ` · ${translateError(state.message, i18n.getLocale())}` : ''}`;
      const reauth = $('[data-reauth]');
      if (reauth) reauth.hidden = state.code !== 'totp_required';
    };
    renderState();
    const unsubscribe = accountService.onSyncStateChange(() => {
      if (!box.isConnected) return unsubscribe();
      renderState();
    });

    const showError = (key: string, err: unknown) => {
      const el = $(`[data-error="${key}"]`);
      if (!el) return;
      el.textContent = accountErrorMessage(err);
      el.hidden = false;
    };
    const hideError = (key: string) => {
      const el = $(`[data-error="${key}"]`);
      if (el) el.hidden = true;
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
    const action = (name: string) => $<HTMLButtonElement>(`[data-action="${name}"]`);

    action('sync')?.addEventListener('click', event => {
      void runBusy(event.currentTarget as HTMLButtonElement, tr('Synchronisation…', 'Syncing…'), () => accountService.syncNow());
    });

    action('reauth')?.addEventListener('click', event => {
      const code = ($<HTMLInputElement>('[data-reauth-code]')?.value ?? '').trim();
      hideError('reauth');
      void runBusy(event.currentTarget as HTMLButtonElement, '…', async () => {
        try {
          await accountService.reauthenticate(code);
        } catch (err) {
          showError('reauth', err);
        }
      });
    });

    action('connect')?.addEventListener('click', event => {
      const password = ($<HTMLInputElement>('#account-connect-password')?.value ?? '');
      const serverUrl = ($<HTMLInputElement>('#account-server')?.value ?? '');
      hideError('connect');
      if (!password) return showError('connect', new Error(tr('Saisissez le mot de passe principal', 'Enter the master password')));
      void runBusy(event.currentTarget as HTMLButtonElement, tr('Envoi du coffre chiffré…', 'Uploading encrypted vault…'), async () => {
        try {
          const { recoveryKey } = await accountService.connectCloud(serverUrl, password);
          this.renderSyncStatus();
          this.showRecoveryKey(recoveryKey, tr('La synchronisation est active. Voici la clé de secours de ce compte : elle permet de retrouver l’accès si vous oubliez votre mot de passe principal.', 'Sync is on. Here is this account’s recovery key: it lets you get back in if you forget your master password.'));
        } catch (err) {
          showError('connect', err);
        }
      });
    });

    // Double authentification du compte
    const totpButton = action('totp');
    const totpStatus = $('[data-totp-status]');
    const totpFlow = $('[data-totp-flow]');
    let totpEnabled = false;
    const renderTotpStatus = () => {
      if (!totpStatus || !totpButton) return;
      totpStatus.className = `status-pill ${totpEnabled ? 'on' : 'off'}`;
      totpStatus.textContent = totpEnabled ? tr('Activée', 'On') : tr('Désactivée', 'Off');
      totpButton.textContent = totpEnabled ? tr('Désactiver', 'Turn off') : tr('Activer', 'Turn on');
      totpButton.disabled = false;
    };
    if (isCloud && totpStatus) {
      accountService.getCloudAccountInfo().then(info => {
        if (!box.isConnected) return;
        totpEnabled = info.totpEnabled;
        renderTotpStatus();
      }).catch(() => {
        if (totpStatus.isConnected) totpStatus.textContent = tr('Serveur injoignable', 'Server unreachable');
      });
    }

    totpButton?.addEventListener('click', () => {
      if (!totpFlow) return;
      if (!totpFlow.hidden) {
        totpFlow.hidden = true;
        return;
      }
      totpFlow.hidden = false;
      if (totpEnabled) {
        totpFlow.innerHTML = `
          <p class="modal-text">${tr('Confirmez avec votre mot de passe principal et un code de l’application.', 'Confirm with your master password and a code from the app.')}</p>
          <div class="form-row">
            <input class="form-input" type="password" data-totp-password autocomplete="current-password" placeholder="${tr('Mot de passe principal', 'Master password')}">
            <input class="form-input otp-input" data-totp-code inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000">
          </div>
          <div class="form-error" data-error="totp" role="alert" hidden></div>
          <div class="account-actions account-actions-end"><button class="btn-primary btn-danger" data-totp-disable>${tr('Désactiver', 'Turn off')}</button></div>`;
        totpFlow.querySelector<HTMLButtonElement>('[data-totp-disable]')?.addEventListener('click', event => {
          hideError('totp');
          const password = totpFlow.querySelector<HTMLInputElement>('[data-totp-password]')!.value;
          const code = totpFlow.querySelector<HTMLInputElement>('[data-totp-code]')!.value;
          void runBusy(event.currentTarget as HTMLButtonElement, '…', async () => {
            try {
              await accountService.disableTotp(password, code);
              totpEnabled = false;
              totpFlow.hidden = true;
              renderTotpStatus();
              this.showToast(tr('Double authentification désactivée', 'Two-factor authentication turned off'), 'info');
            } catch (err) {
              showError('totp', err);
            }
          });
        });
        totpFlow.querySelector<HTMLInputElement>('[data-totp-password]')?.focus();
        return;
      }

      totpFlow.innerHTML = `
        <p class="modal-text">${tr('Confirmez avec votre mot de passe principal pour afficher le QR code.', 'Confirm with your master password to show the QR code.')}</p>
        <div class="form-row" style="grid-template-columns:minmax(0,1fr) auto;">
          <input class="form-input" type="password" data-totp-password autocomplete="current-password" placeholder="${tr('Mot de passe principal', 'Master password')}">
          <button class="btn-primary btn-accent" data-totp-start>${tr('Continuer', 'Continue')}</button>
        </div>
        <div class="form-error" data-error="totp" role="alert" hidden></div>`;
      const passwordInput = totpFlow.querySelector<HTMLInputElement>('[data-totp-password]')!;
      passwordInput.focus();
      totpFlow.querySelector<HTMLButtonElement>('[data-totp-start]')?.addEventListener('click', event => {
        hideError('totp');
        void runBusy(event.currentTarget as HTMLButtonElement, '…', async () => {
          try {
            const setup = await accountService.beginTotpSetup(passwordInput.value);
            totpFlow.innerHTML = `
              <div class="totp-setup">
                <div class="qr-box" aria-label="QR code">${renderSVG(setup.uri, { border: 1 })}</div>
                <div style="display:flex;flex-direction:column;gap:10px;min-width:0;">
                  <ol class="ie-steps">
                    <li>${tr('Scannez le QR code avec votre application d’authentification', 'Scan the QR code with your authenticator app')}</li>
                    <li>${tr('Saisissez le code à 6 chiffres qu’elle affiche', 'Enter the 6-digit code it shows')}</li>
                  </ol>
                  <input class="form-input otp-input" data-totp-code inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000">
                  <div class="form-error" data-error="totp" role="alert" hidden></div>
                  <button class="btn-primary btn-accent" data-totp-enable style="justify-content:center;">${tr('Activer', 'Turn on')}</button>
                  <div class="secret-card compact">
                    <div class="secret-card-head">
                      <span class="secret-card-label">${tr('Clé de configuration', 'Setup key')}</span>
                      <button class="btn-primary btn-ghost btn-sm" data-totp-copy>${GEN_ICONS.copy}<span>${tr('Copier', 'Copy')}</span></button>
                    </div>
                    ${secretGridHtml(setup.secret, { numbered: false })}
                  </div>
                </div>
              </div>`;
            const codeInput = totpFlow.querySelector<HTMLInputElement>('[data-totp-code]')!;
            codeInput.focus();
            totpFlow.querySelector('[data-totp-copy]')?.addEventListener('click', () => {
              void this.copyToClipboardWithAutoClear(setup.secret, tr('Clé copiée', 'Key copied'), true);
            });
            totpFlow.querySelector<HTMLButtonElement>('[data-totp-enable]')?.addEventListener('click', enableEvent => {
              hideError('totp');
              void runBusy(enableEvent.currentTarget as HTMLButtonElement, '…', async () => {
                try {
                  await accountService.enableTotp(codeInput.value);
                  totpEnabled = true;
                  totpFlow.hidden = true;
                  renderTotpStatus();
                  this.showToast(tr('Double authentification activée', 'Two-factor authentication turned on'), 'success');
                } catch (err) {
                  showError('totp', err);
                }
              });
            });
          } catch (err) {
            showError('totp', err);
          }
        });
      });
    });

    // Clé de secours
    const recoveryFlow = $('[data-recovery-flow]');
    action('recovery')?.addEventListener('click', () => {
      if (!recoveryFlow) return;
      recoveryFlow.hidden = !recoveryFlow.hidden;
      if (!recoveryFlow.hidden) $<HTMLInputElement>('[data-recovery-password]')?.focus();
    });
    action('recovery-create')?.addEventListener('click', event => {
      hideError('recovery');
      const password = $<HTMLInputElement>('[data-recovery-password]')?.value ?? '';
      void runBusy(event.currentTarget as HTMLButtonElement, '…', async () => {
        try {
          const key = await accountService.regenerateRecoveryKey(password);
          this.showRecoveryKey(key, tr('Voici votre nouvelle clé de secours. L’ancienne ne fonctionne plus.', 'Here is your new recovery key. The previous one no longer works.'));
        } catch (err) {
          showError('recovery', err);
        }
      });
    });

    // Photo de profil : envoi ou lien selon ce que le serveur autorise
    const profileControls = $('[data-profile-controls]');
    const renderAvatarInto = (el: HTMLElement | null, src: string | null) => {
      if (!el) return;
      el.classList.toggle('has-image', !!src);
      el.innerHTML = src
        ? `<img src="${this.escapeHtml(src)}" alt="" referrerpolicy="no-referrer">`
        : this.escapeHtml(account.email.charAt(0).toUpperCase());
    };
    const refreshAvatar = async () => {
      try {
        this.avatarSrc = await accountService.getAvatarSource();
      } catch {
        this.avatarSrc = null;
      }
      box.querySelectorAll<HTMLElement>('[data-account-avatar], [data-profile-preview]').forEach(el => renderAvatarInto(el, this.avatarSrc));
      this.renderSyncStatus();
      const remove = box.querySelector<HTMLButtonElement>('[data-avatar-remove]');
      if (remove) remove.hidden = !this.avatarSrc;
    };
    if (profileControls) {
      void accountService.getAvatarPolicy().then(policy => {
        if (!box.isConnected) return;
        const kb = Math.round(policy.maxBytes / 1024);
        if (!policy.uploads && !policy.remoteUrls) {
          profileControls.innerHTML = `<p class="field-hint">${tr('Ce serveur ne permet pas d’ajouter une photo de profil.', 'This server does not allow profile pictures.')}</p>`;
          return;
        }
        profileControls.innerHTML = `
          <div class="account-actions">
            ${policy.uploads ? `<label class="btn-primary" style="cursor:pointer;">${tr('Choisir une image', 'Choose an image')}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" data-avatar-file hidden></label>` : ''}
            <button type="button" class="btn-primary btn-ghost" data-avatar-remove hidden>${tr('Retirer', 'Remove')}</button>
          </div>
          ${policy.uploads ? `<span class="field-hint">${isCloud
            ? tr(`Recadrée et réduite sur cet appareil (${kb} Ko max. sur ce serveur). Visible par vous uniquement.`, `Cropped and resized on this device (${kb} KB max on this server). Visible to you only.`)
            : tr('Gardée sur cet appareil uniquement.', 'Kept on this device only.')}</span>` : ''}
          ${policy.remoteUrls ? `
            <div class="form-row" style="grid-template-columns:minmax(0,1fr) auto;">
              <input class="form-input" type="url" data-avatar-url placeholder="https://…/photo.png" autocomplete="off" spellcheck="false">
              <button type="button" class="btn-primary" data-avatar-link>${tr('Utiliser ce lien', 'Use this link')}</button>
            </div>
            <span class="field-hint">${tr('Le site qui héberge l’image voit votre adresse IP quand elle s’affiche.', 'The site hosting the image sees your IP address when it is displayed.')}</span>` : ''}`;

        profileControls.querySelector<HTMLInputElement>('[data-avatar-file]')?.addEventListener('change', async event => {
          const input = event.target as HTMLInputElement;
          const file = input.files?.[0];
          input.value = '';
          if (!file) return;
          hideError('avatar');
          try {
            const { bytes, dataUrl } = await resizeAvatar(file);
            if (isCloud && bytes.length > policy.maxBytes) throw new Error(tr(`Image trop lourde après réduction (${kb} Ko max.)`, `Image too large after resizing (${kb} KB max)`));
            await accountService.setAvatarImage(bytes, dataUrl);
            await refreshAvatar();
            this.showToast(tr('Photo de profil mise à jour', 'Profile picture updated'), 'success');
          } catch (err) {
            showError('avatar', err);
          }
        });
        profileControls.querySelector<HTMLButtonElement>('[data-avatar-link]')?.addEventListener('click', event => {
          const url = profileControls.querySelector<HTMLInputElement>('[data-avatar-url]')?.value ?? '';
          hideError('avatar');
          void runBusy(event.currentTarget as HTMLButtonElement, '…', async () => {
            try {
              await accountService.setAvatarUrl(url);
              await refreshAvatar();
            } catch (err) {
              showError('avatar', err);
            }
          });
        });
        profileControls.querySelector<HTMLButtonElement>('[data-avatar-remove]')?.addEventListener('click', event => {
          hideError('avatar');
          void runBusy(event.currentTarget as HTMLButtonElement, '…', async () => {
            try {
              await accountService.removeAvatar();
              await refreshAvatar();
            } catch (err) {
              showError('avatar', err);
            }
          });
        });
        void refreshAvatar();
      });
    }

    void this.bindDeviceSection(box.querySelector('[data-device-section]') as HTMLElement);

    action('change-password')?.addEventListener('click', event => {
      const value = (id: string) => ($<HTMLInputElement>(`#${id}`)?.value ?? '');
      hideError('password');
      if (!value('account-current-password')) return showError('password', new Error(tr('Saisissez le mot de passe actuel', 'Enter the current password')));
      if (value('account-new-password') !== value('account-new-password-confirm')) {
        return showError('password', new Error(tr('Les deux nouveaux mots de passe sont différents', 'The two new passwords are different')));
      }
      void runBusy(event.currentTarget as HTMLButtonElement, tr('Changement…', 'Changing…'), async () => {
        try {
          await accountService.changeMasterPassword(value('account-current-password'), value('account-new-password'));
          box.querySelectorAll<HTMLInputElement>('#account-current-password, #account-new-password, #account-new-password-confirm').forEach(input => { input.value = ''; });
          this.showToast(tr('Mot de passe principal changé', 'Master password changed'), 'success', 4000);
        } catch (err) {
          showError('password', err);
        }
      });
    });

    action('lock')?.addEventListener('click', () => this.lockApp());
    action('signout')?.addEventListener('click', () => void this.signOutDevice());
    action('export')?.addEventListener('click', () => {
      this.closeModal();
      document.getElementById('btn-open-import')?.click();
    });

    // Sessions : liste, fermeture avec mot de passe (et code 2FA si activée)
    const sessionList = $('[data-session-list]');
    const sessionConfirm = $('[data-session-confirm]');
    const skeletonRows = (count: number) => Array.from({ length: count }, () => `
      <div class="session-row"><span class="skeleton skeleton-circle"></span><div class="session-main"><span class="skeleton skeleton-line" style="width:55%"></span><span class="skeleton skeleton-line" style="width:80%"></span></div></div>`).join('');
    const flag = (country: string | null) => country && /^[A-Z]{2}$/.test(country)
      ? String.fromCodePoint(...[...country].map(c => 0x1f1a5 + c.charCodeAt(0)))
      : '';
    const regionName = (country: string | null) => {
      if (!country) return '';
      try {
        return new Intl.DisplayNames([locale], { type: 'region' }).of(country) ?? country;
      } catch {
        return country;
      }
    };
    const relative = (at: number) => {
      const diff = Date.now() - at;
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
      if (diff < 60_000) return tr('à l’instant', 'just now');
      if (diff < 3_600_000) return rtf.format(-Math.round(diff / 60_000), 'minute');
      if (diff < 86_400_000) return rtf.format(-Math.round(diff / 3_600_000), 'hour');
      return rtf.format(-Math.round(diff / 86_400_000), 'day');
    };
    const deviceIcon = (device: string | null) => /Android|iOS/.test(device ?? '')
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>';

    let sessions: AccountSession[] = [];
    const renderSessions = () => {
      if (!sessionList) return;
      const others = sessions.filter(s => !s.current).length;
      sessionList.innerHTML = sessions.map(s => {
        const place = [s.city, regionName(s.country)].filter(Boolean).join(', ');
        return `
          <div class="session-row ${s.current ? 'current' : ''}">
            <span class="session-icon">${deviceIcon(s.device)}</span>
            <div class="session-main">
              <div class="session-title">${this.escapeHtml(s.device ?? tr('Appareil inconnu', 'Unknown device'))}${s.current ? `<span class="status-pill on">${tr('Cet appareil', 'This device')}</span>` : ''}</div>
              <div class="session-meta">
                ${place ? `<span>${flag(s.country)} ${this.escapeHtml(place)}</span>` : `<span>${tr('Lieu inconnu', 'Unknown place')}</span>`}
                ${s.ipPrefix ? `<span class="mono">${this.escapeHtml(s.ipPrefix)}</span>` : ''}
                <span title="${new Date(s.lastSeenAt).toLocaleString(locale)}">${tr('Actif', 'Active')} ${relative(s.lastSeenAt)}</span>
                <span>${tr('Connecté le', 'Signed in')} ${new Date(s.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              </div>
            </div>
            ${s.current ? '' : `<button class="btn-primary btn-ghost btn-sm" data-revoke="${s.id}">${tr('Fermer', 'Close')}</button>`}
          </div>`;
      }).join('') + (others > 1 ? `
        <div class="account-actions account-actions-end"><button class="btn-primary btn-danger btn-sm" data-revoke="all">${tr(`Fermer les ${others} autres sessions`, `Close the ${others} other sessions`)}</button></div>` : '');
    };
    const loadSessions = async () => {
      if (!sessionList) return;
      sessionList.innerHTML = skeletonRows(2);
      try {
        sessions = await accountService.listSessions();
        if (box.isConnected) renderSessions();
      } catch (err) {
        sessionList.innerHTML = `<div class="form-error">${this.escapeHtml(accountErrorMessage(err))}</div>`;
      }
    };
    action('sessions-refresh')?.addEventListener('click', () => void loadSessions());

    sessionList?.addEventListener('click', e => {
      const target = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-revoke]')?.dataset.revoke;
      if (!target || !sessionConfirm) return;
      const session = sessions.find(s => s.id === target);
      sessionConfirm.hidden = false;
      sessionConfirm.innerHTML = `
        <p class="modal-text"><strong>${target === 'all'
          ? tr('Fermer toutes les autres sessions', 'Close all other sessions')
          : `${tr('Fermer la session', 'Close session')} « ${this.escapeHtml(session?.device ?? '')} »`}</strong><br>${tr('Confirmez avec votre mot de passe principal', 'Confirm with your master password')}${totpEnabled ? tr(' et un code de l’application d’authentification.', ' and a code from your authenticator app.') : '.'}</p>
        <div class="form-row" style="grid-template-columns:${totpEnabled ? 'minmax(0,1fr) 120px' : 'minmax(0,1fr)'};">
          <input class="form-input" type="password" data-revoke-password autocomplete="current-password" placeholder="${tr('Mot de passe principal', 'Master password')}">
          ${totpEnabled ? '<input class="form-input otp-input" data-revoke-code inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000">' : ''}
        </div>
        <div class="form-error" data-error="revoke" role="alert" hidden></div>
        <div class="account-actions account-actions-end">
          <button class="btn-primary btn-ghost" data-revoke-cancel>${tr('Annuler', 'Cancel')}</button>
          <button class="btn-primary btn-danger" data-revoke-confirm>${tr('Fermer', 'Close')}</button>
        </div>`;
      const passwordInput = sessionConfirm.querySelector<HTMLInputElement>('[data-revoke-password]')!;
      passwordInput.focus();
      sessionConfirm.querySelector('[data-revoke-cancel]')?.addEventListener('click', () => { sessionConfirm.hidden = true; });
      const submit = (button: HTMLButtonElement) => {
        hideError('revoke');
        const code = sessionConfirm.querySelector<HTMLInputElement>('[data-revoke-code]')?.value;
        void runBusy(button, '…', async () => {
          try {
            const count = await accountService.revokeSessions(passwordInput.value, target === 'all' ? { all: true } : { sessionId: target }, code);
            sessionConfirm.hidden = true;
            this.showToast(count > 1 ? tr(`${count} sessions fermées`, `${count} sessions closed`) : tr('Session fermée', 'Session closed'), 'success');
            await loadSessions();
          } catch (err) {
            showError('revoke', err);
          }
        });
      };
      const confirmButton = sessionConfirm.querySelector<HTMLButtonElement>('[data-revoke-confirm]')!;
      confirmButton.addEventListener('click', () => submit(confirmButton));
      sessionConfirm.addEventListener('keydown', ev => { if ((ev as KeyboardEvent).key === 'Enter') submit(confirmButton); });
    });

    // Espace de stockage et offres du serveur
    const loadBilling = async () => {
      const usageEl = $('[data-usage]');
      const plansEl = $('[data-plans]');
      if (!usageEl || !plansEl) return;
      usageEl.innerHTML = '<span class="skeleton skeleton-line" style="width:60%"></span><span class="skeleton skeleton-bar"></span>';
      try {
        const [billing, usage] = await Promise.all([accountService.getBilling(), accountService.getAttachmentUsage().catch(() => null)]);
        if (!box.isConnected) return;
        const mb = (bytes: number) => bytes >= 1073741824 ? `${(bytes / 1073741824).toLocaleString(locale, { maximumFractionDigits: 1 })} ${tr('Go', 'GB')}` : `${Math.round(bytes / 1048576).toLocaleString(locale)} ${tr('Mo', 'MB')}`;
        usageEl.innerHTML = usage?.enabled ? `
          <div class="usage-head"><span>${tr('Pièces jointes', 'Attachments')}</span><span class="mono">${mb(usage.usedBytes)} / ${mb(usage.quotaBytes)}</span></div>
          <div class="usage-bar"><span style="width:${Math.min(100, (usage.usedBytes / Math.max(1, usage.quotaBytes)) * 100).toFixed(1)}%"></span></div>` : `<p class="modal-text">${tr('Pièces jointes désactivées sur ce serveur.', 'Attachments are disabled on this server.')}</p>`;
        const grid = $('[data-limit-grid]');
        if (grid) {
          const l = billing.limits;
          grid.innerHTML = ([
            [tr('Coffres', 'Vaults'), l.maxVaults.toLocaleString(locale)],
            [tr('Identifiants par coffre', 'Credentials per vault'), l.maxCredentialsPerVault.toLocaleString(locale)],
            [tr('Taille du coffre chiffré', 'Encrypted vault size'), mb(l.maxVaultBytes)],
            [tr('Taille d’un fichier', 'File size'), mb(l.maxAttachmentBytes ?? 0)],
            [tr('Espace des pièces jointes', 'Attachment storage'), mb(l.attachmentQuotaBytes ?? 0)],
            [tr('Longueur d’une note', 'Note length'), l.maxNoteLength.toLocaleString(locale)]
          ] as Array<[string, string]>).map(([label, value]) => `<span>${label}</span><span>${value}</span>`).join('');
        }
        if (!billing.enabled || billing.plans.length === 0) {
          plansEl.innerHTML = '';
          return;
        }
        const sub = billing.subscription;
        const boostLabel = (key: string, value: number) => ({
          attachmentQuotaBytes: `+${mb(value)} ${tr('de pièces jointes', 'attachment storage')}`,
          maxAttachmentBytes: `+${mb(value)} ${tr('par fichier', 'per file')}`,
          maxVaultBytes: `+${mb(value)} ${tr('par coffre', 'per vault')}`,
          maxVaults: `+${value} ${tr('coffres', 'vaults')}`,
          maxCredentialsPerVault: `+${value.toLocaleString(locale)} ${tr('identifiants par coffre', 'credentials per vault')}`
        } as Record<string, string>)[key] ?? '';
        plansEl.innerHTML = `
          <div class="plan-list">
            ${billing.plans.map(plan => {
              const current = sub?.active && sub.planId === plan.id;
              return `
                <div class="plan-card ${current ? 'current' : ''}">
                  <div class="plan-head"><span class="plan-name">${this.escapeHtml(plan.name)}</span><span class="plan-price">${this.escapeHtml(plan.priceLabel)}</span></div>
                  ${plan.description ? `<p class="modal-text">${this.escapeHtml(plan.description)}</p>` : ''}
                  <ul class="plan-boosts">${Object.entries(plan.boosts).map(([k, v]) => `<li>${boostLabel(k, v)}</li>`).join('')}</ul>
                  ${current
                    ? `<span class="status-pill on">${tr('Offre actuelle', 'Current plan')}${sub?.currentPeriodEnd ? ` · ${tr('jusqu’au', 'until')} ${new Date(sub.currentPeriodEnd).toLocaleDateString(locale)}` : ''}</span>`
                    : `<button class="btn-primary btn-accent btn-sm" data-checkout="${this.escapeHtml(plan.id)}">${tr('Choisir', 'Choose')}</button>`}
                </div>`;
            }).join('')}
          </div>
          ${sub ? `<div class="account-actions account-actions-end"><button class="btn-primary btn-ghost btn-sm" data-billing-portal>${tr('Gérer le paiement', 'Manage billing')}</button></div>` : ''}
          <p class="field-hint">${tr('Paiement sur Stripe. BetterVault ne voit pas vos coordonnées bancaires.', 'Payment on Stripe. BetterVault never sees your card details.')}</p>`;
        plansEl.querySelectorAll<HTMLButtonElement>('[data-checkout]').forEach(button => button.addEventListener('click', () => {
          void runBusy(button, '…', async () => {
            try {
              const { url } = await accountService.startCheckout(button.dataset.checkout!);
              await openExternal(url);
            } catch (err) {
              this.showToast(accountErrorMessage(err), 'error');
            }
          });
        }));
        plansEl.querySelector<HTMLButtonElement>('[data-billing-portal]')?.addEventListener('click', event => {
          void runBusy(event.currentTarget as HTMLButtonElement, '…', async () => {
            try {
              await openExternal((await accountService.openBillingPortal()).url);
            } catch (err) {
              this.showToast(accountErrorMessage(err), 'error');
            }
          });
        });
      } catch (err) {
        usageEl.innerHTML = `<div class="form-error">${this.escapeHtml(accountErrorMessage(err))}</div>`;
      }
    };

    // Documents légaux du serveur
    const loadLegal = async () => {
      const el = $('[data-legal-links]');
      if (!el || !isCloud || !account.serverUrl) return;
      el.innerHTML = '<span class="skeleton skeleton-line" style="width:70%"></span>';
      try {
        const legal = await accountService.getLegal();
        if (!box.isConnected) return;
        el.innerHTML = `
          ${legal.operatorName ? `<p class="field-hint">${tr('Serveur hébergé par', 'Server operated by')} ${this.escapeHtml(legal.operatorName)}</p>` : ''}
          <div class="legal-link-list">${legal.documents.map(doc => `<a href="${this.escapeHtml(account.serverUrl + doc.url)}" target="_blank" rel="noopener">${this.escapeHtml(doc.title)}</a>`).join('')}</div>`;
      } catch {
        el.innerHTML = '';
      }
    };

    action('delete')?.addEventListener('click', async event => {
      const button = event.currentTarget as HTMLButtonElement;
      const password = $<HTMLInputElement>('#account-delete-password')?.value ?? '';
      hideError('delete');
      if (!password) return showError('delete', new Error(tr('Saisissez le mot de passe principal', 'Enter the master password')));
      const confirmed = await this.confirmDialog({
        title: tr('Supprimer le compte en ligne ?', 'Delete online account?'),
        message: tr('Le coffre sera supprimé du serveur et vos autres appareils ne pourront plus se synchroniser. C’est définitif.', 'The vault will be deleted from the server and your other devices will stop syncing. This is permanent.'),
        confirmLabel: tr('Supprimer', 'Delete'),
        danger: true
      });
      if (!confirmed) return;
      void runBusy(button, tr('Suppression…', 'Deleting…'), async () => {
        try {
          await accountService.deleteCloudAccount(password);
          this.closeModal();
          this.renderSyncStatus();
          this.showToast(tr('Compte en ligne supprimé', 'Online account deleted'), 'success');
        } catch (err) {
          showError('delete', err);
        }
      });
    });
  }

  /* ── Appareil : déverrouillage biométrique et remplissage automatique ── */
  private async bindDeviceSection(section: HTMLElement): Promise<void> {
    const tr = (fr: string, en: string) => this.tr(fr, en);
    const store = this.deviceStore;
    const biometricOk = !!store && await store.available();
    const android = isAndroidApp();
    let autofill: { autofillSupported: boolean; autofillEnabled: boolean; autofillReady: boolean } | null = null;
    if (android) {
      try {
        autofill = await nativeCall('status');
      } catch {
        autofill = null;
      }
    }
    if (!section.isConnected || (!biometricOk && !autofill?.autofillSupported)) return;

    const render = () => {
      const enabled = accountService.hasDeviceUnlock();
      const autofillOn = localStorage.getItem(AUTOFILL_KEY) === 'on';
      section.hidden = false;
      section.innerHTML = `
        <h3 class="account-section-title">${tr('Cet appareil', 'This device')}</h3>
        ${biometricOk ? `
          <div class="switch-row" style="cursor:default;">
            <span>${tr('Déverrouillage biométrique', 'Biometric unlock')}<small>${tr(`Ouvrir le coffre avec ${store!.label}. Le mot de passe principal reste utilisable.`, `Open the vault with ${store!.label}. The master password still works.`)}</small></span>
            <span class="status-pill ${enabled ? 'on' : 'off'}">${enabled ? tr('Activé', 'On') : tr('Désactivé', 'Off')}</span>
          </div>
          ${enabled
            ? `<div class="account-actions account-actions-end"><button class="btn-primary" data-device="disable">${tr('Désactiver', 'Turn off')}</button></div>`
            : `<div class="form-row" style="grid-template-columns:minmax(0,1fr) auto;">
                 <input class="form-input" type="password" data-device-password autocomplete="current-password" placeholder="${tr('Mot de passe principal', 'Master password')}">
                 <button class="btn-primary btn-accent" data-device="enable">${tr('Activer', 'Turn on')}</button>
               </div>`}
          <div class="form-error" data-device-error role="alert" hidden></div>` : ''}
        ${autofill?.autofillSupported ? `
          <div class="switch-row" style="cursor:default;">
            <span>${tr('Remplissage automatique Android', 'Android autofill')}<small>${tr('Propose vos identifiants dans les applications et navigateurs, après empreinte ou visage.', 'Offers your credentials in apps and browsers, after fingerprint or face.')}</small></span>
            <span class="status-pill ${autofill.autofillEnabled && autofillOn ? 'on' : 'off'}">${autofill.autofillEnabled ? (autofillOn ? tr('Actif', 'On') : tr('En pause', 'Paused')) : tr('Non choisi', 'Not selected')}</span>
          </div>
          <div class="account-actions account-actions-end">
            ${autofill.autofillEnabled ? '' : `<button class="btn-primary" data-device="autofill-settings">${tr('Choisir BetterVault dans Android', 'Select BetterVault in Android')}</button>`}
            <button class="btn-primary ${autofillOn ? '' : 'btn-accent'}" data-device="autofill-toggle">${autofillOn ? tr('Arrêter', 'Stop') : tr('Préparer les identifiants', 'Prepare credentials')}</button>
          </div>` : ''}`;
    };

    section.addEventListener('click', async e => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-device]');
      if (!button) return;
      const errorEl = section.querySelector<HTMLElement>('[data-device-error]');
      if (errorEl) errorEl.hidden = true;
      button.disabled = true;
      try {
        switch (button.dataset.device) {
          case 'enable': {
            const password = section.querySelector<HTMLInputElement>('[data-device-password]')?.value ?? '';
            await accountService.enableDeviceUnlock(password, store!);
            this.showToast(tr('Déverrouillage biométrique activé', 'Biometric unlock turned on'), 'success');
            break;
          }
          case 'disable':
            await accountService.disableDeviceUnlock(store);
            break;
          case 'autofill-settings':
            await nativeCall('openAutofillSettings');
            break;
          case 'autofill-toggle':
            if (localStorage.getItem(AUTOFILL_KEY) === 'on') {
              localStorage.removeItem(AUTOFILL_KEY);
              await nativeCall('autofillClear');
            } else {
              localStorage.setItem(AUTOFILL_KEY, 'on');
              await this.syncAutofill();
              this.showToast(tr('Identifiants prêts pour le remplissage automatique', 'Credentials ready for autofill'), 'success');
            }
            break;
        }
        if (android) autofill = await nativeCall('status');
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = accountErrorMessage(err);
          errorEl.hidden = false;
        } else {
          this.showToast(accountErrorMessage(err), 'error');
        }
        button.disabled = false;
        return;
      }
      render();
    });

    render();
  }

  /** Android : met à jour le cache chiffré du remplissage automatique après chaque modification */
  private scheduleAutofillSync(): void {
    if (!isAndroidApp() || localStorage.getItem(AUTOFILL_KEY) !== 'on' || !vaultStore.isLoaded()) return;
    window.clearTimeout(this.autofillTimer);
    this.autofillTimer = window.setTimeout(() => void this.syncAutofill().catch(err => console.warn('Remplissage automatique non mis à jour', err)), 2000);
  }

  private async syncAutofill(): Promise<void> {
    const entries = vaultStore.getData().credentials
      .filter(c => c.password)
      .map(c => ({
        title: c.title,
        username: c.username,
        password: c.password,
        domains: [extractDomain(c.website) || c.domain].filter(Boolean),
        // Une URL « androidapp://nom.du.paquet » associe l'identifiant à une application
        packages: /^androidapp:\/\//i.test(c.website) ? [c.website.replace(/^androidapp:\/\//i, '').split(/[/?#]/)[0]] : []
      }));
    await nativeCall('autofillUpdate', { entries: JSON.stringify(entries) });
  }

  /** Affiche une clé de secours ; la fenêtre ne se ferme qu'après confirmation de l'enregistrement */
  private showRecoveryKey(key: string, intro: string): void {
    const tr = (fr: string, en: string) => this.tr(fr, en);
    const email = accountService.getAccount()?.email ?? '';
    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title">${tr('Clé de secours', 'Recovery key')}</div>
      </div>
      <div class="modal-body">
        <p class="modal-text">${intro}</p>
        <div class="secret-card">
          <div class="secret-card-head">
            <span class="secret-card-label">${tr('52 caractères · affichée une seule fois', '52 characters · shown only once')}</span>
            <button class="btn-primary btn-ghost btn-sm" data-action="copy">${GEN_ICONS.copy}<span>${tr('Copier', 'Copy')}</span></button>
          </div>
          ${secretGridHtml(key)}
        </div>
        <div class="recovery-actions">
          <button class="btn-primary" data-action="download">${tr('Enregistrer en .txt', 'Save as .txt')}</button>
          <button class="btn-primary" data-action="print">${tr('Imprimer', 'Print')}</button>
        </div>
        <div class="notice notice-warning">${tr('Gardez-la en dehors de BetterVault : sur papier ou dans un endroit sûr. Elle ne sera plus affichée.', 'Keep it outside BetterVault: on paper or somewhere safe. It won’t be shown again.')}</div>
        <label class="check-row"><input type="checkbox" data-confirm> ${tr('J’ai mis ma clé de secours en lieu sûr', 'I stored my recovery key somewhere safe')}</label>
      </div>
      <div class="modal-footer">
        <button class="btn-primary btn-accent" data-action="done" disabled>${tr('Terminé', 'Done')}</button>
      </div>
    `, { dismissible: false });

    box.querySelector('[data-action="copy"]')?.addEventListener('click', () => void this.copyToClipboardWithAutoClear(key, tr('Clé copiée', 'Key copied'), true));
    box.querySelector('[data-action="download"]')?.addEventListener('click', () => {
      downloadExportFile(recoveryKeyFile(email, key, tr, this.dateLocale()), 'bettervault-cle-de-secours.txt', 'text/plain;charset=utf-8');
    });
    box.querySelector('[data-action="print"]')?.addEventListener('click', () => printRecoveryKey(email, key));
    const done = box.querySelector('[data-action="done"]') as HTMLButtonElement;
    box.querySelector<HTMLInputElement>('[data-confirm]')?.addEventListener('change', e => {
      done.disabled = !(e.target as HTMLInputElement).checked;
    });
    done.addEventListener('click', () => this.closeModal());
  }

  /* ── Coffres ─────────────────────────────────────────────────────────── */
  private openVaultModal(vaultId?: string): void {
    const data = vaultStore.getData();
    const existing = vaultId ? data.vaults.find(v => v.id === vaultId) : undefined;
    const shared = existing?.shared ? sharedVaults.summary(existing.id) : undefined;
    const credentialCount = existing ? data.credentials.filter(c => c.vaultId === existing.id).length : 0;
    const taskCount = existing ? data.tasks.filter(t => t.vaultId === existing.id).length : 0;
    const limits = accountService.getLimits();
    const tr = (fr: string, en: string) => this.tr(fr, en);
    const cloud = accountService.isCloud();
    const permissions = new Set<SharedPermission>(shared?.role.permissions ?? ['write', 'attachments', 'export', 'manage_members', 'manage_roles', 'delete_vault']);
    const isOwner = !shared || shared.role.builtin === 'owner';
    const personalCount = data.vaults.filter(v => !v.shared).length;
    const typeOption = (type: 'personal' | 'work' | 'team', label: string) =>
      `<option value="${type}" ${existing?.type === type ? 'selected' : ''}>${label}</option>`;

    if (!existing && remainingCapacity(data, data.activeVaultId, limits).vaults === 0) {
      this.showToast(tr(`Limite de ${limits.maxVaults} coffres atteinte`, `Limit of ${limits.maxVaults} vaults reached`), 'error');
      return;
    }

    let icon: ItemIcon | undefined = existing?.icon;
    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title">${existing ? this.escapeHtml(existing.name) : i18n.t.vault.newVaultModalTitle}</div>
        <button class="modal-close">${GEN_ICONS.close}</button>
      </div>
      <div class="modal-body">
        ${shared ? `
          <div class="tab-btn-group" role="tablist">
            <button type="button" class="tab-btn active" data-tab="general" role="tab">${tabIcon('general')}<span>${tr('Général', 'General')}</span></button>
            <button type="button" class="tab-btn" data-tab="members" role="tab">${tabIcon('members')}<span>${tr('Membres', 'Members')}</span></button>
            <button type="button" class="tab-btn" data-tab="roles" role="tab">${tabIcon('roles')}<span>${tr('Rôles', 'Roles')}</span></button>
          </div>` : ''}

        <div data-panel="general" style="display:flex;flex-direction:column;gap:16px;">
          ${shared ? `<div class="notice">${tr('Coffre partagé par', 'Vault shared by')} <strong>${this.escapeHtml(shared.ownerEmail)}</strong> · ${tr('votre rôle', 'your role')} : <strong>${this.escapeHtml(this.roleLabel(shared.role))}</strong></div>` : ''}
          <div class="cred-identity">
            <button type="button" class="cred-icon-button" data-icon-button aria-expanded="false" title="${tr('Choisir une icône', 'Choose an icon')}" aria-label="${tr('Choisir une icône', 'Choose an icon')}" ${permissions.has('write') ? '' : 'disabled'}>
              <span data-icon-preview style="display:flex;"></span>
              <span class="cred-icon-edit">${ACTION_ICONS.edit}</span>
            </button>
            <div class="form-field">
              <label class="form-label" for="vault-name">${i18n.t.vault.vaultNameLabel}</label>
              <input class="form-input cred-title-input" id="vault-name" type="text" maxlength="40" value="${this.escapeHtml(existing?.name ?? '')}" placeholder="${tr('Personnel, Travail, Famille…', 'Personal, Work, Family…')}" autocomplete="off" data-autofocus ${permissions.has('write') ? '' : 'disabled'}>
            </div>
          </div>
          <div data-icon-panel hidden></div>
          <div class="form-field">
            <label class="form-label" for="vault-type">${i18n.t.vault.vaultTypeLabel}</label>
            <select class="form-input" id="vault-type" ${permissions.has('write') ? '' : 'disabled'}>
              ${typeOption('personal', i18n.t.common.personal)}
              ${typeOption('work', i18n.t.common.work)}
              ${typeOption('team', i18n.t.common.team)}
              ${vaultStore.getVaultTypes().map(custom => `<option value="${this.escapeHtml(custom.id)}" ${existing?.type === custom.id ? 'selected' : ''}>${this.escapeHtml(custom.name)}</option>`).join('')}
              <option value="__new__">${tr('＋ Nouveau type…', '＋ New type…')}</option>
            </select>
            <div class="form-row" data-new-type hidden style="grid-template-columns:minmax(0,1fr) auto;margin-top:8px;">
              <input class="form-input" id="vault-type-name" maxlength="40" placeholder="${tr('Nom du type (Famille, Association…)', 'Type name (Family, Club…)')}" autocomplete="off">
              <button type="button" class="btn-primary btn-ghost" data-cancel-type>${tr('Annuler', 'Cancel')}</button>
            </div>
            ${vaultStore.getVaultTypes().length ? `<div class="type-manage" data-type-manage>${vaultStore.getVaultTypes().map(custom => `
              <span class="type-chip">${this.escapeHtml(custom.name)}<button type="button" class="icon-btn" data-delete-type="${this.escapeHtml(custom.id)}" aria-label="${tr('Supprimer le type', 'Delete type')} ${this.escapeHtml(custom.name)}">${GEN_ICONS.close}</button></span>`).join('')}</div>` : ''}
          </div>

          ${!existing && cloud ? `
            <label class="switch-row">
              <span>${tr('Coffre partagé', 'Shared vault')}<small>${tr('Invitez d’autres comptes de ce serveur et choisissez leur rôle', 'Invite other accounts on this server and pick their role')}</small></span>
              <input type="checkbox" class="switch" id="vault-shared">
            </label>` : ''}

          ${existing && !shared && cloud ? `
            <section class="account-section">
              <h3 class="account-section-title">${tr('Partager ce coffre', 'Share this vault')}</h3>
              <p class="modal-text">${tr(`Ses ${credentialCount} identifiant(s) et ${taskCount} tâche(s) deviennent un coffre partagé, chiffré avec une nouvelle clé. Vous en êtes propriétaire.`, `Its ${credentialCount} credential(s) and ${taskCount} task(s) become a shared vault encrypted with a new key. You own it.`)}</p>
              <div class="account-actions account-actions-end">
                <button class="btn-primary" data-action="share-existing" ${personalCount <= 1 ? 'disabled' : ''}>${tr('Transformer en coffre partagé', 'Turn into a shared vault')}</button>
              </div>
              ${personalCount <= 1 ? `<div class="field-hint">${tr('Gardez au moins un autre coffre personnel.', 'Keep at least one other personal vault.')}</div>` : ''}
            </section>` : ''}

          ${existing && !shared && data.vaults.filter(v => !v.shared).length > 1 ? `
            <section class="account-section account-danger">
              <h3 class="account-section-title">${tr('Supprimer ce coffre', 'Delete this vault')}</h3>
              <p class="modal-text">${tr(`${credentialCount} identifiant(s) et ${taskCount} tâche(s) seront supprimés.`, `${credentialCount} credential(s) and ${taskCount} task(s) will be deleted.`)}</p>
              <div class="account-actions account-actions-end">
                <button class="btn-primary btn-danger" data-action="delete-vault">${tr('Supprimer le coffre', 'Delete vault')}</button>
              </div>
            </section>` : ''}

          ${shared ? `
            <section class="account-section account-danger">
              <h3 class="account-section-title">${isOwner ? tr('Supprimer le coffre partagé', 'Delete shared vault') : tr('Quitter le coffre', 'Leave vault')}</h3>
              <p class="modal-text">${isOwner
                ? tr('Le coffre, ses pièces jointes et l’accès de tous les membres seront supprimés.', 'The vault, its attachments and every member’s access will be deleted.')
                : tr('Vous perdez l’accès à ce coffre. Un membre autorisé pourra vous réinviter.', 'You lose access to this vault. An authorized member can invite you again.')}</p>
              <div class="account-actions account-actions-end">
                ${isOwner
                  ? (permissions.has('delete_vault') ? `<button class="btn-primary btn-danger" data-action="delete-shared">${tr('Supprimer', 'Delete')}</button>` : '')
                  : `<button class="btn-primary btn-danger" data-action="leave-shared">${tr('Quitter', 'Leave')}</button>`}
              </div>
            </section>` : ''}
        </div>

        ${shared ? `
          <div data-panel="members" hidden style="display:flex;flex-direction:column;gap:12px;">
            ${permissions.has('manage_members') ? `
              <form class="form-section" data-invite>
                <div class="form-section-title">${tr('Inviter un compte', 'Invite an account')}</div>
                <div class="form-row" style="grid-template-columns:minmax(0,1fr) auto;">
                  <input class="form-input" type="email" data-invite-email placeholder="${tr('Email du compte BetterVault', 'BetterVault account email')}" autocomplete="off">
                  <button class="btn-primary" type="submit">${tr('Rechercher', 'Look up')}</button>
                </div>
                <div data-invite-found hidden></div>
              </form>` : ''}
            <div class="member-list" data-members><div class="icon-picker-loading"></div></div>
          </div>

          <div data-panel="roles" hidden style="display:flex;flex-direction:column;gap:12px;">
            <p class="modal-text">${tr('Les rôles décident de qui peut modifier, gérer les membres ou supprimer. Toute personne membre peut lire le contenu du coffre.', 'Roles decide who can edit, manage members or delete. Every member can read the vault content.')}</p>
            <div class="role-list" data-roles></div>
            ${permissions.has('manage_roles') ? `
              <form class="form-section" data-role-create>
                <div class="form-section-title">${tr('Nouveau rôle', 'New role')}</div>
                <input class="form-input" data-role-name maxlength="40" placeholder="${tr('Nom du rôle', 'Role name')}">
                <div class="permission-grid" data-role-permissions></div>
                <div class="account-actions account-actions-end"><button class="btn-primary btn-accent" type="submit">${tr('Créer le rôle', 'Create role')}</button></div>
              </form>` : ''}
          </div>` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn-primary" data-close>${i18n.t.common.cancel}</button>
        ${!shared || permissions.has('write') ? `<button class="btn-primary" id="modal-confirm">${existing ? tr('Enregistrer', 'Save') : i18n.t.vault.createVaultButton}</button>` : ''}
      </div>
    `);

    const $ = <T extends HTMLElement>(selector: string) => box.querySelector(selector) as T | null;

    // Onglets
    box.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        box.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(t => t.classList.toggle('active', t === tab));
        box.querySelectorAll<HTMLElement>('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== tab.dataset.tab; });
        const confirm = $<HTMLButtonElement>('#modal-confirm');
        if (confirm) confirm.hidden = tab.dataset.tab !== 'general';
        if (tab.dataset.tab === 'members' || tab.dataset.tab === 'roles') void loadMembers();
      });
    });

    // Icône
    const preview = $<HTMLElement>('[data-icon-preview]')!;
    const panel = $<HTMLElement>('[data-icon-panel]')!;
    const iconButton = $<HTMLButtonElement>('[data-icon-button]')!;
    const renderPreview = () => { preview.innerHTML = icon ? renderItemIcon(icon, 28) : VAULT_ICON.replace(/width="15" height="15"/, 'width="28" height="28"'); };
    const closePanel = () => {
      panel.hidden = true;
      panel.innerHTML = '';
      panel.className = '';
      iconButton.setAttribute('aria-expanded', 'false');
    };
    iconButton.addEventListener('click', () => {
      if (!panel.hidden) return closePanel();
      panel.hidden = false;
      iconButton.setAttribute('aria-expanded', 'true');
      mountIconPicker(panel, { tr, current: icon, initialSet: 'lucide', onPick: picked => { icon = picked; renderPreview(); closePanel(); iconButton.focus(); } }).focus();
    });
    renderPreview();

    // Types de coffres créés par l'utilisateur : « Nouveau type… » ouvre un champ, les puces en suppriment un
    const typeSelect = $<HTMLSelectElement>('#vault-type')!;
    const newTypeRow = box.querySelector('[data-new-type]') as HTMLElement;
    const newTypeInput = $<HTMLInputElement>('#vault-type-name');
    let previousType = typeSelect.value;
    typeSelect.addEventListener('change', () => {
      const creating = typeSelect.value === '__new__';
      newTypeRow.hidden = !creating;
      if (creating) newTypeInput?.focus();
      else previousType = typeSelect.value;
    });
    box.querySelector('[data-cancel-type]')?.addEventListener('click', () => {
      typeSelect.value = previousType;
      newTypeRow.hidden = true;
      if (newTypeInput) newTypeInput.value = '';
    });
    box.querySelector('[data-type-manage]')?.addEventListener('click', async e => {
      const typeId = (e.target as HTMLElement).closest<HTMLElement>('[data-delete-type]')?.dataset.deleteType;
      if (!typeId) return;
      const custom = vaultStore.getVaultTypes().find(t => t.id === typeId);
      const used = vaultStore.getData().vaults.filter(v => v.type === typeId).length;
      const confirmed = await this.confirmDialog({
        title: tr('Supprimer ce type ?', 'Delete this type?'),
        message: used
          ? tr(`${used} coffre(s) repasseront en « ${i18n.t.common.personal} ».`, `${used} vault(s) will go back to "${i18n.t.common.personal}".`)
          : tr(`« ${custom?.name ?? ''} » sera retiré de la liste.`, `"${custom?.name ?? ''}" will be removed from the list.`),
        confirmLabel: tr('Supprimer', 'Delete'),
        danger: true
      });
      if (!confirmed) return;
      vaultStore.deleteVaultType(typeId);
      this.closeModal();
      this.renderSidebar();
      this.openVaultModal(vaultId);
    });

    $<HTMLButtonElement>('#modal-confirm')?.addEventListener('click', async event => {
      const button = event.currentTarget as HTMLButtonElement;
      const name = ($<HTMLInputElement>('#vault-name')?.value ?? '').trim();
      let type = typeSelect.value;
      if (type === '__new__') {
        const typeName = newTypeInput?.value.trim() ?? '';
        if (!typeName) {
          this.showToast(tr('Donnez un nom au nouveau type', 'Name the new type'), 'error');
          newTypeInput?.focus();
          return;
        }
        try {
          type = vaultStore.createVaultType(typeName, limits.maxVaultTypes).id;
        } catch (err) {
          this.showToast(accountErrorMessage(err), 'error');
          return;
        }
      }
      if (!name) {
        this.showToast(tr('Donnez un nom au coffre', 'Give the vault a name'), 'error');
        return;
      }
      if (existing) {
        vaultStore.updateVault(existing.id, { name, type, icon });
        this.closeModal();
        this.showToast(tr('Coffre enregistré', 'Vault saved'), 'success');
        return;
      }
      if ($<HTMLInputElement>('#vault-shared')?.checked) {
        button.disabled = true;
        try {
          const id = await sharedVaults.create(name, type, icon);
          this.reloadWithShared();
          vaultStore.setActiveVault(id);
          this.closeModal();
          this.showToast(tr(`Coffre partagé ${name} créé. Invitez des membres depuis ses réglages.`, `Shared vault ${name} created. Invite members from its settings.`), 'success', 5000);
          this.openVaultModal(id);
        } catch (err) {
          button.disabled = false;
          this.showToast(accountErrorMessage(err), 'error');
        }
        return;
      }
      vaultStore.addVault(name, type, icon);
      this.selectedItemId = null;
      this.renderDetail(null);
      this.closeModal();
      this.showToast(tr(`Coffre ${name} créé`, `Vault ${name} created`), 'success');
    });

    $<HTMLButtonElement>('[data-action="share-existing"]')?.addEventListener('click', async event => {
      if (!existing) return;
      const confirmed = await this.confirmDialog({
        title: tr('Transformer en coffre partagé ?', 'Turn into a shared vault?'),
        message: tr('Le contenu est déplacé dans un coffre partagé. Vous pourrez ensuite inviter des membres.', 'The content moves to a shared vault. You can then invite members.'),
        confirmLabel: tr('Transformer', 'Convert')
      });
      if (!confirmed) return;
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      try {
        const id = await sharedVaults.shareExisting(vaultStore.getData(), existing.id);
        vaultStore.removeVaultSilently(existing.id);
        await accountService.flush();
        this.reloadWithShared();
        vaultStore.setActiveVault(id);
        this.closeModal();
        this.openVaultModal(id);
      } catch (err) {
        button.disabled = false;
        this.showToast(accountErrorMessage(err), 'error');
      }
    });

    $<HTMLButtonElement>('[data-action="delete-vault"]')?.addEventListener('click', async () => {
      if (!existing) return;
      const confirmed = await this.confirmDialog({
        title: tr('Supprimer le coffre ?', 'Delete vault?'),
        message: tr(`« ${existing.name} », ses ${credentialCount} identifiant(s) et ses ${taskCount} tâche(s) seront définitivement supprimés.`, `"${existing.name}", its ${credentialCount} credential(s) and ${taskCount} task(s) will be permanently deleted.`),
        confirmLabel: tr('Supprimer', 'Delete'),
        danger: true
      });
      if (!confirmed) return;
      vaultStore.deleteVault(existing.id);
      this.selectedItemId = null;
      this.renderDetail(null);
      this.closeModal();
      this.showToast(tr('Coffre supprimé', 'Vault deleted'), 'success');
    });

    const leaveOrDelete = async (kind: 'delete' | 'leave') => {
      if (!existing) return;
      const confirmed = await this.confirmDialog({
        title: kind === 'delete' ? tr('Supprimer le coffre partagé ?', 'Delete shared vault?') : tr('Quitter le coffre ?', 'Leave vault?'),
        message: kind === 'delete'
          ? tr(`« ${existing.name} » sera supprimé pour tous ses membres.`, `"${existing.name}" will be deleted for all members.`)
          : tr(`Vous n’aurez plus accès à « ${existing.name} ».`, `You will no longer have access to "${existing.name}".`),
        confirmLabel: kind === 'delete' ? tr('Supprimer', 'Delete') : tr('Quitter', 'Leave'),
        danger: true
      });
      if (!confirmed) return;
      try {
        if (kind === 'delete') await sharedVaults.deleteVault(existing.id);
        else await sharedVaults.leave(existing.id);
        this.selectedItemId = null;
        this.reloadWithShared();
        this.renderDetail(null);
        this.closeModal();
      } catch (err) {
        this.showToast(accountErrorMessage(err), 'error');
      }
    };
    $<HTMLButtonElement>('[data-action="delete-shared"]')?.addEventListener('click', () => void leaveOrDelete('delete'));
    $<HTMLButtonElement>('[data-action="leave-shared"]')?.addEventListener('click', () => void leaveOrDelete('leave'));

    if (!shared || !existing) return;

    /* ── Membres et rôles ── */
    const PERMISSION_LABELS: Record<SharedPermission, string> = {
      write: tr('Ajouter et modifier', 'Add and edit'),
      attachments: tr('Pièces jointes', 'Attachments'),
      export: tr('Exporter', 'Export'),
      manage_members: tr('Gérer les membres', 'Manage members'),
      manage_roles: tr('Gérer les rôles', 'Manage roles'),
      delete_vault: tr('Supprimer le coffre', 'Delete the vault')
    };
    const EDITABLE_PERMISSIONS: SharedPermission[] = ['write', 'attachments', 'export', 'manage_members', 'manage_roles'];
    let roles: SharedRole[] = [];
    let members: SharedMember[] = [];
    const myEmail = accountService.getAccount()?.email ?? '';

    const roleOptions = (selected: string, includeOwner: boolean) => roles
      .filter(r => includeOwner || r.builtin !== 'owner')
      .map(r => `<option value="${r.id}" ${r.id === selected ? 'selected' : ''}>${this.escapeHtml(this.roleLabel(r))}</option>`).join('');

    const renderMembers = () => {
      const host = $<HTMLElement>('[data-members]')!;
      host.innerHTML = members.map(member => {
        const role = roles.find(r => r.id === member.roleId);
        const self = member.email === myEmail;
        const editable = permissions.has('manage_members') && role?.builtin !== 'owner' && !self;
        return `
          <div class="member-row" data-user="${member.userId}">
            <div class="member-avatar">${this.escapeHtml(member.email.charAt(0).toUpperCase())}</div>
            <div class="member-main">
              <div class="member-email">${this.escapeHtml(member.email)}${self ? ` <span class="field-hint">(${tr('vous', 'you')})</span>` : ''}</div>
              <div class="field-hint">${member.status === 'invited' ? `<span class="status-pill off">${tr('Invitation envoyée', 'Invitation sent')}</span>` : ''}
                <button type="button" class="link-btn" data-fingerprint="${member.publicKey ?? ''}">${tr('Empreinte de clé', 'Key fingerprint')}</button></div>
            </div>
            ${editable
              ? `<select class="form-input member-role" data-role-select>${roleOptions(member.roleId, isOwner && member.status === 'active')}</select>
                 <button type="button" class="icon-btn" data-remove title="${tr('Retirer', 'Remove')}" aria-label="${tr('Retirer', 'Remove')}">${ACTION_ICONS.trash}</button>`
              : `<span class="vault-type-badge shared">${this.escapeHtml(role ? this.roleLabel(role) : '')}</span>`}
          </div>`;
      }).join('');
    };

    const permissionChecks = (selected: SharedPermission[], disabled: boolean) => EDITABLE_PERMISSIONS.map(p => `
      <label class="check-row"><input type="checkbox" value="${p}" ${selected.includes(p) ? 'checked' : ''} ${disabled ? 'disabled' : ''}> ${PERMISSION_LABELS[p]}</label>`).join('');

    const renderRoles = () => {
      const host = $<HTMLElement>('[data-roles]')!;
      host.innerHTML = roles.map(role => {
        const editable = permissions.has('manage_roles') && !role.builtin;
        const usedBy = members.filter(m => m.roleId === role.id).length;
        return `
          <div class="form-section role-card" data-role="${role.id}">
            <div class="form-section-head">
              ${editable
                ? `<input class="form-input" data-role-rename value="${this.escapeHtml(role.name)}" maxlength="40" style="max-width:240px;">`
                : `<div class="form-section-title">${this.escapeHtml(this.roleLabel(role))}${role.builtin ? ` <span class="field-hint">${tr('prédéfini', 'built-in')}</span>` : ''}</div>`}
              <span class="field-hint">${tr(`${usedBy} membre${usedBy > 1 ? 's' : ''}`, `${usedBy} member${usedBy === 1 ? '' : 's'}`)}</span>
            </div>
            ${role.builtin === 'owner'
              ? `<div class="field-hint">${tr('Toutes les permissions, dont la suppression du coffre.', 'All permissions, including deleting the vault.')}</div>`
              : `<div class="permission-grid">${permissionChecks(role.permissions, !editable)}</div>`}
            ${role.builtin === 'viewer' ? `<div class="field-hint">${tr('Lecture seule.', 'Read only.')}</div>` : ''}
            ${editable ? `<div class="account-actions account-actions-end"><button type="button" class="btn-primary btn-ghost" data-role-delete>${tr('Supprimer', 'Delete')}</button><button type="button" class="btn-primary" data-role-save>${tr('Enregistrer', 'Save')}</button></div>` : ''}
          </div>`;
      }).join('');
      const create = $<HTMLElement>('[data-role-permissions]');
      if (create && !create.childElementCount) create.innerHTML = permissionChecks(['write'], false);
    };

    const loadMembers = async () => {
      try {
        const result = await sharedVaults.members(existing.id);
        roles = result.roles;
        members = result.members;
        renderMembers();
        renderRoles();
      } catch (err) {
        $<HTMLElement>('[data-members]')!.innerHTML = `<div class="notice notice-danger">${this.escapeHtml(accountErrorMessage(err))}</div>`;
      }
    };

    // Invitation : recherche du compte, affichage de l'empreinte, choix du rôle
    const inviteForm = $<HTMLFormElement>('[data-invite]');
    inviteForm?.addEventListener('submit', async e => {
      e.preventDefault();
      const found = $<HTMLElement>('[data-invite-found]')!;
      const email = $<HTMLInputElement>('[data-invite-email]')!.value.trim();
      found.hidden = false;
      found.innerHTML = `<div class="field-hint">${tr('Recherche…', 'Looking up…')}</div>`;
      try {
        if (!roles.length) await loadMembers();
        const user = await sharedVaults.lookup(email);
        found.innerHTML = `
          <div class="invite-card">
            <div><strong>${this.escapeHtml(user.email)}</strong></div>
            <div class="field-hint">${tr('Empreinte de sa clé : vérifiez-la avec la personne (appel, message) avant d’inviter.', 'Key fingerprint: check it with the person (call, message) before inviting.')}</div>
            <code class="secret-text">${user.fingerprint}</code>
            <div class="form-row" style="grid-template-columns:minmax(0,1fr) auto;">
              <select class="form-input" data-invite-role>${roleOptions(roles.find(r => r.builtin === 'editor')?.id ?? '', false)}</select>
              <button type="button" class="btn-primary btn-accent" data-invite-send>${tr('Inviter', 'Invite')}</button>
            </div>
          </div>`;
        found.querySelector<HTMLButtonElement>('[data-invite-send]')?.addEventListener('click', async ev => {
          const button = ev.currentTarget as HTMLButtonElement;
          button.disabled = true;
          try {
            await sharedVaults.invite(existing.id, user, found.querySelector<HTMLSelectElement>('[data-invite-role]')!.value);
            found.hidden = true;
            $<HTMLInputElement>('[data-invite-email]')!.value = '';
            this.showToast(tr(`Invitation envoyée à ${user.email}`, `Invitation sent to ${user.email}`), 'success');
            await loadMembers();
          } catch (err) {
            button.disabled = false;
            this.showToast(accountErrorMessage(err), 'error');
          }
        });
      } catch (err) {
        found.innerHTML = `<div class="notice notice-danger">${this.escapeHtml(accountErrorMessage(err))}</div>`;
      }
    });

    const membersHost = $<HTMLElement>('[data-members]')!;
    membersHost.addEventListener('click', async e => {
      const target = e.target as HTMLElement;
      const fingerprintButton = target.closest<HTMLButtonElement>('[data-fingerprint]');
      if (fingerprintButton) {
        const key = fingerprintButton.dataset.fingerprint;
        fingerprintButton.textContent = key ? await sharedVaults.fingerprintOf(key) : tr('Pas de clé', 'No key');
        return;
      }
      if (!target.closest('[data-remove]')) return;
      const userId = target.closest<HTMLElement>('[data-user]')?.dataset.user;
      const member = members.find(m => m.userId === userId);
      if (!member) return;
      const confirmed = await this.confirmDialog({
        title: tr('Retirer ce membre ?', 'Remove this member?'),
        message: tr(`${member.email} perd l’accès. Le coffre est rechiffré avec une nouvelle clé pour les membres restants.`, `${member.email} loses access. The vault is re-encrypted with a new key for the remaining members.`),
        confirmLabel: tr('Retirer', 'Remove'),
        danger: true
      });
      if (!confirmed) return;
      try {
        await sharedVaults.removeMember(existing.id, member.userId);
        this.showToast(tr(`${member.email} retiré, nouvelle clé en place`, `${member.email} removed, new key in place`), 'success');
        await loadMembers();
      } catch (err) {
        this.showToast(accountErrorMessage(err), 'error');
      }
    });
    membersHost.addEventListener('change', async e => {
      const select = (e.target as HTMLElement).closest<HTMLSelectElement>('[data-role-select]');
      const userId = select?.closest<HTMLElement>('[data-user]')?.dataset.user;
      const member = members.find(m => m.userId === userId);
      const role = roles.find(r => r.id === select?.value);
      if (!select || !member || !role) return;
      if (role.builtin === 'owner') {
        const confirmed = await this.confirmDialog({
          title: tr('Transférer la propriété ?', 'Transfer ownership?'),
          message: tr(`${member.email} devient propriétaire. Vous passez administrateur.`, `${member.email} becomes owner. You become administrator.`),
          confirmLabel: tr('Transférer', 'Transfer'),
          danger: true
        });
        if (!confirmed) {
          select.value = member.roleId;
          return;
        }
      }
      try {
        await sharedVaults.changeRole(existing.id, member.userId, role.id);
        this.reloadWithShared();
        if (role.builtin === 'owner') {
          this.closeModal();
          this.openVaultModal(existing.id);
          return;
        }
        await loadMembers();
      } catch (err) {
        select.value = member.roleId;
        this.showToast(accountErrorMessage(err), 'error');
      }
    });

    const rolesHost = $<HTMLElement>('[data-roles]')!;
    rolesHost.addEventListener('click', async e => {
      const target = e.target as HTMLElement;
      const card = target.closest<HTMLElement>('[data-role]');
      const roleId = card?.dataset.role;
      if (!card || !roleId) return;
      try {
        if (target.closest('[data-role-save]')) {
          const name = card.querySelector<HTMLInputElement>('[data-role-rename]')?.value.trim();
          const selected = [...card.querySelectorAll<HTMLInputElement>('.permission-grid input:checked')].map(i => i.value as SharedPermission);
          await sharedVaults.updateRole(existing.id, roleId, { name, permissions: selected });
          this.showToast(tr('Rôle enregistré', 'Role saved'), 'success');
          await loadMembers();
        } else if (target.closest('[data-role-delete]')) {
          await sharedVaults.deleteRole(existing.id, roleId);
          await loadMembers();
        }
      } catch (err) {
        this.showToast(accountErrorMessage(err), 'error');
      }
    });

    $<HTMLFormElement>('[data-role-create]')?.addEventListener('submit', async e => {
      e.preventDefault();
      const form = e.currentTarget as HTMLFormElement;
      const name = form.querySelector<HTMLInputElement>('[data-role-name]')!.value.trim();
      const selected = [...form.querySelectorAll<HTMLInputElement>('[data-role-permissions] input:checked')].map(i => i.value as SharedPermission);
      if (!name) return this.showToast(tr('Donnez un nom au rôle', 'Give the role a name'), 'error');
      try {
        await sharedVaults.createRole(existing.id, name, selected);
        form.querySelector<HTMLInputElement>('[data-role-name]')!.value = '';
        this.showToast(tr(`Rôle ${name} créé`, `Role ${name} created`), 'success');
        await loadMembers();
      } catch (err) {
        this.showToast(accountErrorMessage(err), 'error');
      }
    });
  }

  /* ── Dossiers ────────────────────────────────────────────────────────── */

  /** Fil d'Ariane du dossier ouvert, affiché en haut de la liste */
  private renderFolderBreadcrumb(): string {
    if (!this.activeFolderId) return '';
    const path = vaultStore.folderPath(this.activeFolderId);
    if (!path.length) return '';
    return `
      <nav class="folder-breadcrumb" aria-label="${this.tr('Chemin du dossier', 'Folder path')}">
        <button type="button" data-folder-crumb="">${this.tr('Tout le coffre', 'Whole vault')}</button>
        ${path.map(folder => `
          <span class="folder-breadcrumb-sep" aria-hidden="true">/</span>
          <button type="button" data-folder-crumb="${folder.id}">${this.escapeHtml(folder.name)}</button>`).join('')}
      </nav>`;
  }

  private renderFolderSidebar(): void {
    const list = document.getElementById('folder-list');
    if (!list) return;

    const folders = vaultStore.getFolders();
    if (this.activeFolderId && !folders.some(f => f.id === this.activeFolderId)) this.activeFolderId = null;

    if (folders.length === 0) {
      list.innerHTML = `<li class="nav-empty">${this.tr('Aucun dossier', 'No folders')}</li>`;
      return;
    }

    list.innerHTML = '';
    const byParent = new Map<string, typeof folders>();
    for (const folder of folders) {
      const key = folder.parentId ?? '';
      byParent.set(key, [...(byParent.get(key) ?? []), folder]);
    }

    const addLevel = (parentId: string, depth: number) => {
      for (const folder of byParent.get(parentId) ?? []) {
        const children = byParent.get(folder.id) ?? [];
        const expanded = this.expandedFolders.has(folder.id);
        const active = this.activeFolderId === folder.id;

        const li = document.createElement('li');
        li.className = `nav-item folder-item ${active ? 'active' : ''}`;
        li.tabIndex = 0;
        li.setAttribute('aria-pressed', String(active));
        li.style.paddingLeft = `${8 + depth * 12}px`;
        li.innerHTML = `
          <span class="nav-item-left">
            ${children.length
              ? `<button type="button" class="folder-twisty" aria-expanded="${expanded}" data-twisty
                   aria-label="${expanded ? this.tr('Replier', 'Collapse') : this.tr('Déplier', 'Expand')}">${tabIcon('chevronRight', 12)}</button>`
              : '<span class="folder-twisty-spacer" aria-hidden="true"></span>'}
            ${folder.icon ? renderItemIcon(folder.icon, 15) : tabIcon(expanded && children.length ? 'folderOpen' : 'typeFolder', 15)}
            <span class="folder-name">${this.escapeHtml(folder.name)}</span>
          </span>
          <span class="folder-actions">
            <button type="button" class="icon-btn" data-folder-edit title="${this.tr('Renommer', 'Rename')}" aria-label="${this.tr('Renommer le dossier', 'Rename folder')}">${ACTION_ICONS.edit}</button>
            <button type="button" class="icon-btn" data-folder-delete title="${this.tr('Supprimer', 'Delete')}" aria-label="${this.tr('Supprimer le dossier', 'Delete folder')}">${ACTION_ICONS.trash}</button>
          </span>
          <span class="nav-count">${vaultStore.countFolderItems(folder.id)}</span>`;

        const open = () => {
          this.activeFolderId = this.activeFolderId === folder.id ? null : folder.id;
          this.selectedItemId = null;
          this.renderSidebar();
          this.renderList();
          this.renderDetail(null);
        };

        li.addEventListener('click', event => {
          const target = event.target as HTMLElement;
          if (target.closest('[data-twisty]')) {
            if (expanded) this.expandedFolders.delete(folder.id);
            else this.expandedFolders.add(folder.id);
            saveExpandedFolders(this.expandedFolders);
            this.renderFolderSidebar();
            return;
          }
          if (target.closest('[data-folder-edit]')) return this.openFolderModal(folder.id);
          if (target.closest('[data-folder-delete]')) return this.confirmDeleteFolder(folder.id);
          open();
        });
        li.addEventListener('keydown', event => {
          if ((event as KeyboardEvent).key === 'Enter') open();
        });

        list.appendChild(li);
        if (expanded) addLevel(folder.id, depth + 1);
      }
    };

    addLevel('', 0);
  }

  /** Création ou renommage d'un dossier */
  private openFolderModal(folderId?: string, parentId?: string): void {
    const tr = (fr: string, en: string) => this.tr(fr, en);
    const folder = folderId ? vaultStore.getFolder(folderId) : undefined;
    const others = vaultStore.getFolders().filter(f => !folderId || !vaultStore.folderSubtree(folderId).includes(f.id));

    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title">${folder ? tr('Renommer le dossier', 'Rename folder') : tr('Nouveau dossier', 'New folder')}</div>
        <button class="modal-close" type="button">${GEN_ICONS.close}</button>
      </div>
      <div class="modal-body">
        <div class="form-field">
          <label class="form-label" for="folder-name">${tr('Nom', 'Name')}</label>
          <input class="form-input" id="folder-name" type="text" maxlength="60" autocomplete="off"
            value="${this.escapeHtml(folder?.name ?? '')}" placeholder="${tr('Travail, Banque, Serveurs…', 'Work, Banking, Servers…')}" data-autofocus>
        </div>
        <div class="form-field">
          <label class="form-label" for="folder-parent">${tr('Ranger dans', 'Place inside')}</label>
          <select class="form-input" id="folder-parent">
            <option value="">${tr('À la racine du coffre', 'At the vault root')}</option>
            ${others.map(f => `<option value="${f.id}" ${(folder?.parentId ?? parentId) === f.id ? 'selected' : ''}>${this.escapeHtml(vaultStore.folderPath(f.id).map(x => x.name).join(' / '))}</option>`).join('')}
          </select>
        </div>
        <div class="form-error" id="folder-error" role="alert" hidden></div>
      </div>
      <div class="modal-footer">
        <button class="btn-primary" type="button" data-close>${tr('Annuler', 'Cancel')}</button>
        <button class="btn-primary btn-accent" type="button" id="folder-confirm">${folder ? tr('Renommer', 'Rename') : tr('Créer', 'Create')}</button>
      </div>`);

    const nameInput = box.querySelector('#folder-name') as HTMLInputElement;
    const parentSelect = box.querySelector('#folder-parent') as HTMLSelectElement;
    const errorEl = box.querySelector('#folder-error') as HTMLElement;

    const save = () => {
      errorEl.hidden = true;
      try {
        const parent = parentSelect.value || undefined;
        if (folder) vaultStore.updateFolder(folder.id, { name: nameInput.value, parentId: parent ?? null });
        else {
          const created = vaultStore.createFolder(nameInput.value, { parentId: parent });
          if (parent) {
            this.expandedFolders.add(parent);
            saveExpandedFolders(this.expandedFolders);
          }
          this.activeFolderId = created.id;
        }
        this.closeModal();
        this.renderSidebar();
        this.renderList();
      } catch (err) {
        errorEl.textContent = accountErrorMessage(err);
        errorEl.hidden = false;
        nameInput.focus();
      }
    };

    box.querySelector('#folder-confirm')?.addEventListener('click', save);
    nameInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); save(); }
    });
  }

  private confirmDeleteFolder(folderId: string): void {
    const folder = vaultStore.getFolder(folderId);
    if (!folder) return;
    const count = vaultStore.countFolderItems(folderId);
    const tr = (fr: string, en: string) => this.tr(fr, en);

    void this.confirmDialog({
      title: tr('Supprimer ce dossier ?', 'Delete this folder?'),
      message: count
        ? tr(`Les ${count} élément(s) qu'il contient ne sont pas supprimés : ils remontent d'un niveau.`,
             `The ${count} item(s) inside are not deleted: they move up one level.`)
        : tr('Ce dossier est vide.', 'This folder is empty.'),
      confirmLabel: tr('Supprimer', 'Delete'),
      danger: true
    }).then(confirmed => {
      if (!confirmed) return;
      vaultStore.deleteFolder(folderId);
      if (this.activeFolderId === folderId) this.activeFolderId = folder.parentId ?? null;
      this.renderSidebar();
      this.renderList();
      this.showToast(tr('Dossier supprimé', 'Folder deleted'), 'success');
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
          ${tag.icon
            ? `<span class="tag-icon" style="color:${tagColor(tag.color)};">${renderItemIcon(tag.icon, 15)}</span>`
            : `<span class="tag-dot" style="background-color:${tagColor(tag.color)};"></span>`}
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

  /** Pastille rappelant le type de l'élément */
  private typeBadge(type: ItemType): string {
    const info = ITEM_TYPE_INFO[type];
    return `<span class="item-type-badge">${tabIcon(info.icon, 13)}${this.escapeHtml(this.tr(info.fr, info.en))}</span>`;
  }

  /**
   * Une ligne de valeur recopiable. Une valeur sensible reste masquée jusqu'à
   * ce qu'on demande à la voir, et la copie passe par l'effacement automatique
   * du presse-papiers comme pour un mot de passe.
   */
  private detailField(label: string, value: string, options: { secret?: boolean; mono?: boolean; multiline?: boolean } = {}): string {
    if (!value) return '';
    const shown = options.secret ? '•'.repeat(Math.min(value.length, 20)) : this.escapeHtml(value);
    const style = options.mono ? 'font-family:var(--font-mono);letter-spacing:0.04em;' : '';
    return `
      <div class="field-group">
        <div class="field-label">${this.escapeHtml(label)}</div>
        <div class="field-box">
          <span class="field-val${options.multiline ? ' field-val-multiline' : ''}" style="${style}"
            data-secret-view data-secret-shown="${options.secret ? 'false' : 'true'}"
            data-secret-value="${this.escapeHtml(value)}">${shown}</span>
          <div class="field-actions">
            ${options.secret ? `<button class="icon-btn" data-secret-toggle title="${this.tr('Afficher', 'Show')}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg></button>` : ''}
            <button class="icon-btn" data-secret-copy data-sensitive="${!!options.secret}" title="${this.tr('Copier', 'Copy')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
        </div>
      </div>`;
  }

  /** Champs affichés pour une carte, une identité ou une clé */
  private renderTypeDetail(cred: CredentialItem): string {
    const type = itemTypeOf(cred.type);
    const tr = (fr: string, en: string) => this.tr(fr, en);

    if (type === 'card' && cred.card) {
      const c = cred.card;
      const expiry = c.expMonth && c.expYear ? `${c.expMonth}/${c.expYear}` : '';
      return [
        this.detailField(tr('Numéro', 'Number'), formatCardNumber(c.number), { secret: true, mono: true }),
        this.detailField(tr('Titulaire', 'Cardholder'), c.holder),
        this.detailField(tr('Expiration', 'Expiry'), expiry, { mono: true }),
        this.detailField(tr('Cryptogramme', 'Security code'), c.cvv, { secret: true, mono: true }),
        this.detailField(tr('Code', 'PIN'), c.pin, { secret: true, mono: true })
      ].join('');
    }

    if (type === 'identity' && cred.identity) {
      const id = cred.identity;
      const fullName = [id.firstName, id.lastName].filter(Boolean).join(' ');
      const place = [id.postalCode, id.city].filter(Boolean).join(' ');
      return [
        this.detailField(tr('Nom complet', 'Full name'), fullName),
        this.detailField(tr('Date de naissance', 'Date of birth'), id.birthDate),
        this.detailField(tr('Numéro de pièce', 'Document number'), id.docNumber, { secret: true, mono: true }),
        this.detailField('Email', id.email),
        this.detailField(tr('Téléphone', 'Phone'), id.phone),
        this.detailField(tr('Adresse', 'Address'), [id.address, place, id.country].filter(Boolean).join(', '))
      ].join('');
    }

    if (type === 'sshKey' && cred.sshKey) {
      const key = cred.sshKey;
      return [
        this.detailField(tr('Clé privée', 'Private key'), key.privateKey, { secret: true, mono: true, multiline: true }),
        this.detailField(tr('Phrase de passe de la clé', 'Key passphrase'), key.passphrase, { secret: true }),
        this.detailField(tr('Clé publique', 'Public key'), key.publicKey, { mono: true, multiline: true })
      ].join('');
    }

    return '';
  }

  /** Ce qui distingue l'élément dans la liste, selon son type */
  private itemSubtitle(cred: CredentialItem): string {
    const type = itemTypeOf(cred.type);
    const info = ITEM_TYPE_INFO[type];
    const fallback = this.tr(info.fr, info.en);

    switch (type) {
      case 'login':
        return cred.username || cred.domain || this.tr('Sans identifiant', 'No username');
      case 'card': {
        const last4 = (cred.card?.number ?? '').replace(/\D/g, '').slice(-4);
        const label = [cred.card?.brand, last4 ? '•••• ' + last4 : ''].filter(Boolean).join(' ');
        return label || fallback;
      }
      case 'identity': {
        const name = [cred.identity?.firstName, cred.identity?.lastName].filter(Boolean).join(' ');
        return name || cred.identity?.email || fallback;
      }
      case 'note': {
        // La première ligne de la note en dit plus que le nom du type
        const first = (cred.notes ?? '').split(/\r?\n/).map(l => l.trim()).find(Boolean);
        return first ? first.slice(0, 80) : fallback;
      }
      case 'sshKey':
        return cred.sshKey?.publicKey?.split(' ')[0] || fallback;
      case 'file':
      case 'folder': {
        const count = cred.attachments?.length ?? 0;
        if (!count) return fallback;
        return count === 1
          ? (cred.attachments?.[0]?.name ?? fallback)
          : this.tr(`${count} fichiers`, `${count} files`);
      }
      default:
        return fallback;
    }
  }

  private renderTagChips(tags: string[]): string {
    if (!tags.length) return '';
    return `<div class="tag-chip-row">${tags.map(name => {
      const tag = vaultStore.getTagByName(name);
      return `<span class="tag-chip" style="--tag-color:${tagColor(tag?.color)}">${tag?.icon ? `<span class="tag-chip-icon">${renderItemIcon(tag.icon, 12)}</span>` : ''}<span>${this.escapeHtml(name)}</span></span>`;
    }).join('')}</div>`;
  }

  private openTagManagerModal(): void {
    const tr = (fr: string, en: string) => this.tr(fr, en);
    let newColor = TAG_COLORS[vaultStore.getTags().length % TAG_COLORS.length];

    const box = this.openModal(`
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
            <button type="button" class="tag-icon-button" data-tag-icon title="${tr('Choisir une icône', 'Choose an icon')}" aria-label="${tr('Icône de', 'Icon for')} ${this.escapeHtml(tag.name)}" aria-expanded="false" style="color:${tagColor(tag.color)};">
              <span data-tag-icon-preview>${tag.icon ? renderItemIcon(tag.icon, 16) : `<span class="tag-dot" style="background-color:${tagColor(tag.color)};"></span>`}</span>
            </button>
            <input class="form-input tag-rename" value="${this.escapeHtml(tag.name)}" maxlength="32" aria-label="${tr('Nom du tag', 'Tag name')}">
            <span class="tag-usage">${tr(`${count} élément${count > 1 ? 's' : ''}`, `${count} item${count === 1 ? '' : 's'}`)}</span>
            <button type="button" class="icon-btn tag-delete" title="${tr('Supprimer', 'Delete')}" aria-label="${tr('Supprimer', 'Delete')} ${this.escapeHtml(tag.name)}">${ACTION_ICONS.trash}</button>
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
            this.renderSidebar();
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
              this.renderSidebar();
              this.renderList();
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
      const confirmed = await this.confirmDialog({
        title: tr('Supprimer le tag ?', 'Delete tag?'),
        message: tr(`« ${tag.name} » sera retiré de ${count} élément(s). Les éléments sont conservés.`, `"${tag.name}" will be removed from ${count} item(s). The items are kept.`),
        confirmLabel: tr('Supprimer', 'Delete'),
        danger: true
      });
      if (!confirmed) return;
      if (this.activeTag === tag.name) this.activeTag = null;
      vaultStore.deleteTag(tag.id);
      render();
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
        this.showToast(accountErrorMessage(err), 'error');
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
        this.showToast(accountErrorMessage(err), 'error');
      }
      nameInput.focus();
    });

    render();
  }

  private runShortcut(action: ShortcutAction, searchInput: HTMLInputElement | null): void {
    const showView = (view: ActiveView) => (document.querySelector(`[data-view="${view}"]`) as HTMLElement | null)?.click();
    switch (action) {
      case 'search':
        searchInput?.focus();
        searchInput?.select();
        break;
      case 'newItem':
        if (this.activeView === 'tasks') this.openCreateTaskModal();
        else this.openCreateCredentialModal();
        break;
      case 'generator':
        this.openGeneratorModal();
        break;
      case 'lock':
        this.lockApp();
        break;
      case 'sync':
        if (accountService.isCloud()) void accountService.syncNow();
        else this.showToast(this.tr('La synchronisation n’est pas activée sur ce compte', 'Sync is not enabled on this account'), 'info');
        break;
      case 'viewCredentials':
        showView('all-credentials');
        break;
      case 'view2fa':
        showView('2fa-tokens');
        break;
      case 'viewTasks':
        showView('tasks');
        break;
      case 'importExport':
        document.getElementById('btn-open-import')?.click();
        break;
      case 'account':
        this.openAccountModal();
        break;
      case 'help':
        if (document.getElementById('modal-overlay')) this.closeModal();
        this.openShortcutsModal();
        break;
    }
  }

  /* ── Raccourcis Clavier (Palette Cheat Sheet) ─────────────────────────── */
  private openShortcutsModal(): void {
    const tr = (fr: string, en: string) => this.tr(fr, en);
    const labels: Record<ShortcutAction, string> = {
      search: tr('Rechercher', 'Search'),
      newItem: tr('Nouvel identifiant ou nouvelle tâche', 'New credential or task'),
      generator: tr('Générateur de mots de passe', 'Password generator'),
      lock: tr('Verrouiller le coffre', 'Lock the vault'),
      sync: tr('Synchroniser maintenant', 'Sync now'),
      viewCredentials: tr('Afficher les identifiants', 'Show credentials'),
      view2fa: tr('Afficher les codes 2FA', 'Show 2FA codes'),
      viewTasks: tr('Afficher les tâches', 'Show tasks'),
      importExport: tr('Importer / exporter', 'Import / export'),
      account: tr('Compte et réglages', 'Account and settings'),
      help: tr('Afficher les raccourcis', 'Show shortcuts')
    };
    let recording: ShortcutAction | null = null;

    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title">${tr('Raccourcis clavier', 'Keyboard shortcuts')}</div>
        <button class="modal-close">${GEN_ICONS.close}</button>
      </div>
      <div class="modal-body">
        <p class="modal-text">${tr('Cliquez sur une combinaison puis appuyez sur les touches voulues. Échap annule, Retour arrière retire le raccourci.', 'Click a combination, then press the keys you want. Esc cancels, Backspace removes the shortcut.')}</p>
        <div class="shortcut-list" data-shortcut-list></div>
        <div class="shortcut-row fixed">
          <span>${tr('Fermer la fenêtre ouverte', 'Close the open window')}</span>
          <kbd class="shortcut-key">Esc</kbd>
        </div>
        <div class="form-error" data-shortcut-error role="alert" hidden></div>
      </div>
      <div class="modal-footer">
        <button class="btn-primary btn-ghost" data-shortcut-reset-all>${tr('Tout rétablir', 'Reset all')}</button>
        <button class="btn-primary" data-close>${tr('Fermer', 'Close')}</button>
      </div>
    `);

    const list = box.querySelector('[data-shortcut-list]') as HTMLElement;
    const errorEl = box.querySelector('[data-shortcut-error]') as HTMLElement;
    const showError = (text: string) => {
      errorEl.textContent = text;
      errorEl.hidden = !text;
    };

    const render = () => {
      list.innerHTML = SHORTCUT_ORDER.map(action => {
        const binding = this.shortcuts[action];
        const custom = binding !== DEFAULT_SHORTCUTS[action];
        return `
          <div class="shortcut-row ${custom ? 'custom' : ''}">
            <span>${labels[action]}</span>
            <span class="shortcut-actions">
              ${custom ? `<button type="button" class="icon-btn" data-shortcut-reset="${action}" title="${tr('Rétablir', 'Reset')} (${formatBinding(DEFAULT_SHORTCUTS[action])})" aria-label="${tr('Rétablir', 'Reset')}">${GEN_ICONS.refresh}</button>` : ''}
              <button type="button" class="shortcut-key ${recording === action ? 'recording' : ''}" data-shortcut="${action}" aria-label="${labels[action]} : ${formatBinding(binding)}">${recording === action ? tr('Appuyez…', 'Press keys…') : formatBinding(binding)}</button>
            </span>
          </div>`;
      }).join('');
    };

    const onKey = (e: KeyboardEvent) => {
      if (!recording) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return stopRecording();
      if (e.key === 'Backspace' || e.key === 'Delete') {
        this.shortcuts = { ...this.shortcuts, [recording]: '' };
        saveShortcuts(this.shortcuts);
        return stopRecording();
      }
      const combo = bindingFromEvent(e);
      if (!combo) return;
      const problem = checkBinding(this.shortcuts, recording, combo);
      if (problem?.kind === 'reserved') return showError(tr(`${formatBinding(combo)} est réservé par le navigateur ou le système`, `${formatBinding(combo)} is reserved by the browser or system`));
      if (problem?.kind === 'needsModifier') return showError(tr('Ajoutez Ctrl, Cmd ou Alt : une lettre seule gênerait la saisie', 'Add Ctrl, Cmd or Alt: a single letter would get in the way of typing'));
      const next = { ...this.shortcuts, [recording]: combo };
      // Combinaison déjà prise : elle est retirée de l'autre action, qui est signalée
      if (problem?.kind === 'conflict') {
        next[problem.action] = '';
        showError(tr(`${formatBinding(combo)} a été retiré de « ${labels[problem.action]} »`, `${formatBinding(combo)} was removed from "${labels[problem.action]}"`));
      } else {
        showError('');
      }
      this.shortcuts = next;
      saveShortcuts(next);
      stopRecording();
    };

    // Appelée depuis onKey : déclarée après, mais seulement exécutée une fois les deux définies
    const stopRecording = (): void => {
      recording = null;
      this.recordingShortcut = false;
      document.removeEventListener('keydown', onKey, true);
      render();
    };

    list.addEventListener('click', e => {
      const target = e.target as HTMLElement;
      const reset = target.closest<HTMLElement>('[data-shortcut-reset]')?.dataset.shortcutReset as ShortcutAction | undefined;
      if (reset) {
        const problem = checkBinding(this.shortcuts, reset, DEFAULT_SHORTCUTS[reset]);
        const next = { ...this.shortcuts, [reset]: DEFAULT_SHORTCUTS[reset] };
        if (problem?.kind === 'conflict') next[problem.action] = '';
        this.shortcuts = next;
        saveShortcuts(next);
        showError('');
        render();
        return;
      }
      const action = target.closest<HTMLElement>('[data-shortcut]')?.dataset.shortcut as ShortcutAction | undefined;
      if (!action) return;
      if (recording === action) return stopRecording();
      if (!recording) document.addEventListener('keydown', onKey, true);
      recording = action;
      this.recordingShortcut = true;
      showError('');
      render();
    });

    box.querySelector('[data-shortcut-reset-all]')?.addEventListener('click', () => {
      this.shortcuts = { ...DEFAULT_SHORTCUTS };
      saveShortcuts(this.shortcuts);
      showError('');
      render();
    });

    // Fermeture pendant l'enregistrement : le clavier est relâché
    new MutationObserver((_records, observer) => {
      if (box.isConnected) return;
      if (recording) stopRecording();
      observer.disconnect();
    }).observe(document.body, { childList: true, subtree: true });

    render();
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   BOOTSTRAP
   ════════════════════════════════════════════════════════════════════════════ */
// Liens externes (documents légaux, site d'un identifiant, paiement) : dans les applications de bureau
// et mobiles, target="_blank" n'ouvre rien ; on passe par le navigateur du système.
document.addEventListener('click', event => {
  const link = (event.target as HTMLElement | null)?.closest?.('a[target="_blank"]') as HTMLAnchorElement | null;
  if (!link || !isTauri()) return;
  const url = link.href;
  if (!/^https?:\/\//i.test(url)) return;
  event.preventDefault();
  void openExternal(url).catch(err => console.warn('Lien non ouvert', err));
});

// Popup de l'extension : ouvrir le sélecteur de fichiers ferme le popup (Chrome) et l'envoi est perdu.
// Les fichiers se choisissent donc dans l'application ouverte en onglet.
document.addEventListener('click', event => {
  if (extensionSurface() !== 'popup') return;
  const target = event.target as HTMLElement | null;
  const input = target?.closest?.('input[type="file"]') ?? target?.closest?.('label')?.querySelector('input[type="file"]');
  if (!input) return;
  event.preventDefault();
  openFullTab();
  const fr = i18n.getLocale().startsWith('fr');
  pushToast(
    fr ? 'Le choix du fichier s’ouvre dans un onglet : le popup se ferme dès qu’on ouvre le sélecteur.'
       : 'File picking opens in a tab: the popup closes as soon as the picker opens.',
    { kind: 'info', duration: 5000, closeLabel: fr ? 'Fermer' : 'Close' }
  );
}, true);

// Le stockage de l'appareil est chargé avant l'interface : fichier natif sous Tauri, navigateur sinon
setApiLocale(() => i18n.getLocale());
createDeviceStorage().then(storage => {
  const surface = extensionSurface();
  if (surface) document.body.classList.add(`ext-${surface}`);
  accountService = new AccountService({ storage, sessionStore: extensionSessionStore() });
  sharedVaults = new SharedVaultManager(accountService);
  new AppController();
}).catch(err => {
  // Ne jamais démarrer sur un stockage vide : un nouveau compte écraserait le fichier existant
  console.error(err);
  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  box.style.cssText = 'position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:24px;background:#0b0f17;color:#e6e9ef;font:15px system-ui;text-align:center';
  box.textContent = navigator.language.startsWith('fr')
    ? `Impossible de lire les données de BetterVault sur cet appareil. Le fichier n'a pas été modifié. Détail : ${String(err)}`
    : `BetterVault could not read its data on this device. The file was not modified. Details: ${String(err)}`;
  document.body.append(box);
});

// Service worker (hors ligne) uniquement pour le site : l'app Tauri embarque déjà ses fichiers
if ('serviceWorker' in navigator && window.location.protocol.startsWith('http') && !isTauri()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Ignorer si non servi sous HTTP/HTTPS (ex: tauri:// ou file://)
    });
  });
}

