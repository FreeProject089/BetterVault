import { randomId, vaultStore } from './store/vaultStore';
import type { CredentialItem, Task } from './types/vault';
import { extractDomain, getServiceIconSvg } from './icons/serviceIcons';
import { renderItemIcon, type ItemIcon } from './icons/iconLibrary';
import { generateTOTP } from './crypto/totpEngine';
import { calculatePasswordEntropy } from './crypto/vaultCrypto';
import { downloadExportFile } from './import_export/importEngine';
import { AccountService, type SyncStatus } from './account/accountService';
import { SharedReadOnlyError, SharedVaultManager } from './account/sharedVaults';
import { setApiLocale, type SharedPermission, type SharedRole } from './account/cloudClient';
import { decryptFile, encryptFile, formatLimit, localAttachmentBytes, MAX_LOCAL_ATTACHMENT_BYTES, type AttachmentMeta } from './account/attachmentCrypto';
import { fromBase64, toBase64 } from './account/accountCrypto';
import { createDeviceStorage } from './platform/storage';
import { isTauri, openExternal } from './platform/tauriBridge';
import type { UnlockedVaultData } from './types/vault';
import { EisenhowerQuadrant, describeRecurrence, getDependents, getDueReminders, getEisenhowerQuadrant, getOpenBlockers, planTaskCompletion } from './tasks/taskEngine';
import { accountErrorMessage, mountAuthScreen } from './ui/authScreen';
import { showToast as pushToast } from './ui/toast';
import { expiryInfo, renderExpiryBadge } from './ui/expiry';
import { printRecoveryKey, recoveryKeyFile } from './ui/recoveryKey';
import { secretGridHtml } from './ui/secretDisplay';
import { translateError } from './i18n/errorMessages';
import { tabIcon } from './ui/tabIcons';
import { ProfileStore } from './account/profiles';
import { openImportExportModal } from './ui/importExportModal';
import { ACTION_ICONS, GEN_ICONS, tagColor, VAULT_ICON } from './ui/icons';
import { openTagManagerModal } from './ui/tagManagerModal';
import { openEraseModal } from './ui/eraseModal';
import { openVaultModal } from './ui/vaultModal';
import { mountGenerator } from './ui/generator';
import { registerServices } from './app/services';
import { openCreateTaskModal } from './ui/taskModal';
import { openAuditModal } from './ui/auditModal';
import { openShortcutsModal } from './ui/shortcutsModal';
import { openAccountModal } from './ui/accountModal';
import { openCreateCredentialModal } from './ui/credentialModal';
import { loadSavedTheme, saveTheme, applyTheme } from './ui/themes';
import { mountTemplateEditor } from './ui/itemTemplatesUi';
import { renderVersioning, wireVersioning, renderTrash, type VersionsContext } from './ui/versionsPanel';
import { expiredTrash } from './store/vaultStore';
import { TRASH_DAYS } from './account/merge';
import type { TrashEntry } from './types/vault';
import { profileRowsHtml, wireProfileRows, type ProfileActions } from './ui/accountSwitcher';
import { ACCOUNT_STORAGE_KEYS } from './account/accountService';
import { formatCardNumber, itemTypeOf, ITEM_TYPE_INFO, type ItemType } from './types/itemTypes';
import { bindingFromEvent, isPlainKey, loadShortcuts, SHORTCUT_ORDER, type ShortcutAction, type ShortcutBindings } from './ui/shortcuts';
import { CREDENTIAL_FILTERS, countByFilter, queryCredentials, type CredentialFilter, type CredentialSort } from './store/credentialFilters';
import { activeTabHost, extensionSessionStore, extensionSurface, fillActiveTab, matchesSite, openFullTab, openSidePanel } from './extension/surface';
import { biometricStore, isAndroidApp, nativeCall, type DeviceSecretStore } from './platform/biometric';
import { i18n } from './i18n';

type ActiveView = 'all-credentials' | '2fa-tokens' | 'tasks';
type TaskViewMode = 'list' | 'kanban' | 'matrix' | 'calendar';

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


const SIDEBAR_COLLAPSED_KEY = 'bettervault.sidebar-collapsed';
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


// Créé au démarrage, une fois le stockage de l'appareil chargé (voir la fin du fichier)
let accountService: AccountService;
/** Comptes présents sur l'appareil ; le service de compte ne voit que celui qui est actif */
let profileStore: ProfileStore;

/**
 * Actions de changement de compte.
 *
 * Changer recharge la page plutôt que de remplacer le service à chaud : les clés du
 * compte quitté ne vivent qu'en mémoire, et seul un rechargement garantit qu'il n'en
 * reste rien. La session de l'extension, elle, est rangée hors de la page ; on la
 * vide aussi pour que le nouveau compte ne tente pas de s'ouvrir avec la clé de l'autre.
 */
async function reloadWithoutSession(): Promise<void> {
  try {
    await extensionSessionStore()?.clear();
  } finally {
    window.location.reload();
  }
}

const profileActions: ProfileActions = {
  list: () => profileStore.list(),
  activeId: () => profileStore.activeId(),
  switchTo: id => {
    profileStore.activate(id);
    void reloadWithoutSession();
  },
  addNew: () => {
    profileStore.createEmpty();
    void reloadWithoutSession();
  },
  forget: id => profileStore.forget(id, ACCOUNT_STORAGE_KEYS)
};
let sharedVaults: SharedVaultManager;

/* ════════════════════════════════════════════════════════════════════════════
   APP CONTROLLER — Zero-Knowledge Vault Manager
   ════════════════════════════════════════════════════════════════════════════ */
export class AppController {
  activeView: ActiveView = 'all-credentials';
  shortcuts: ShortcutBindings = loadShortcuts();
  /** Vrai pendant qu'une combinaison est en cours d'enregistrement : les raccourcis sont suspendus */
  recordingShortcut = false;
  /**
   * Maj enfoncée : passe la demande de confirmation d'une suppression.
   *
   * Maj se comporte pareil sur Windows, macOS et Linux — contrairement à Ctrl et
   * Cmd — et aucun navigateur ne se l'approprie. Sur un téléphone la touche n'existe
   * pas : la confirmation y reste simplement toujours demandée.
   */
  private shiftHeld = false;
  /** Photo de profil affichable (data:, blob: ou https:) */
  avatarSrc: string | null = null;
  selectedItemId: string | null = null;
  private searchQuery = '';
  private taskViewMode: TaskViewMode = 'list';
  public totpInterval: number | null = null;
  private autoLockTimeout: number | null = null;
  private readonly AUTO_LOCK_DELAY_MS = 5 * 60 * 1000; // 5 minutes d'inactivité
  private clipboardClearTimer: number | null = null;
  activeTag: string | null = null;
  /** Dossier ouvert dans la barre latérale ; null = tout le coffre */
  activeFolderId: string | null = null;
  /** Dossiers dépliés dans l'arborescence : préférence d'affichage, gardée sur l'appareil */
  private expandedFolders = new Set<string>(loadExpandedFolders());
  private authScreen: { show(): void } | null = null;
  credentialFilters = new Set<CredentialFilter>();
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

  tr(fr: string, en: string): string {
    return i18n.getLocale() === 'fr' ? fr : en;
  }

  escapeHtml(value: string): string {
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

  requestNotificationPermission(): void {
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }

  toDateTimeInputValue(timestamp?: number): string {
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
    // Un thème personnalisé l'emporte sur le simple clair / sombre
    applyTheme(loadSavedTheme());
    this.updateThemeIcons();

    document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
      // Basculer clair / sombre revient aux thèmes intégrés
      if (loadSavedTheme()) saveTheme(null);
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

  updateThemeIcons(): void {
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
    document.getElementById('mobile-add')?.addEventListener('click', () => this.openCreateSheet());
    mobileSidebarClose?.addEventListener('click', closeSidebar);
    overlay?.addEventListener('click', closeSidebar);
    document.querySelectorAll('.sidebar .nav-item').forEach(item => {
      item.addEventListener('click', closeSidebar);
    });

    this.initSidebarSwipe(sidebar as HTMLElement | null, openSidebar, closeSidebar);
  }

  /**
   * Ouverture et fermeture du menu au doigt.
   *
   * Un glissement vers la droite parti du bord gauche ouvre le menu ; un glissement
   * vers la gauche sur le menu le referme. Le geste n'est suivi que s'il est nettement
   * horizontal, sinon il rendrait le défilement vertical de la liste impossible.
   */
  private initSidebarSwipe(sidebar: HTMLElement | null, open: () => void, close: () => void): void {
    if (!sidebar) return;

    const EDGE = 24;        // largeur de la zone de départ, au bord gauche
    const DISTANCE = 60;    // déplacement horizontal à partir duquel le geste compte
    const SLOPE = 1.2;      // le geste doit être plus horizontal que vertical

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let decided = false;

    const isPhoneLayout = () => window.matchMedia('(max-width: 900px)').matches;

    document.addEventListener('touchstart', event => {
      if (!isPhoneLayout() || event.touches.length !== 1) return;
      // Une modale ouverte a ses propres gestes : on ne lui vole pas le doigt
      if (document.querySelector('.modal-overlay')) return;

      const touch = event.touches[0];
      const opened = sidebar.classList.contains('mobile-open');
      if (!opened && touch.clientX > EDGE) return;
      if (opened && !sidebar.contains(event.target as Node)) return;

      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
      decided = false;
    }, { passive: true });

    document.addEventListener('touchmove', event => {
      if (!tracking || decided || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = Math.abs(touch.clientY - startY);
      if (Math.abs(dx) < DISTANCE || Math.abs(dx) < dy * SLOPE) return;

      decided = true;
      tracking = false;
      if (dx > 0 && !sidebar.classList.contains('mobile-open')) open();
      else if (dx < 0 && sidebar.classList.contains('mobile-open')) close();
    }, { passive: true });

    const stop = () => { tracking = false; };
    document.addEventListener('touchend', stop, { passive: true });
    document.addEventListener('touchcancel', stop, { passive: true });
  }

  /**
   * Choix entre un élément du coffre et une tâche.
   *
   * Le bouton « + » de la barre du téléphone ouvre les deux mondes de l'application ;
   * avant, il n'ouvrait que les identifiants et les tâches n'avaient pas de raccourci.
   */
  private openCreateSheet(): void {
    const tr = (fr: string, en: string) => this.tr(fr, en);

    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title">${tr('Ajouter', 'Add')}</div>
        <button class="modal-close" type="button">${GEN_ICONS.close}</button>
      </div>
      <div class="modal-body">
        <div class="type-grid">
          <button type="button" class="type-card" data-create="item" data-autofocus>
            ${tabIcon('typeLogin', 18)}
            <span class="type-card-text">
              <span class="type-card-name">${tr('Élément du coffre', 'Vault item')}</span>
              <span class="type-card-hint">${tr('Identifiant, note, carte, clé, fichier…', 'Login, note, card, key, file…')}</span>
            </span>
          </button>
          <button type="button" class="type-card" data-create="task">
            ${tabIcon('typeNote', 18)}
            <span class="type-card-text">
              <span class="type-card-name">${tr('Tâche', 'Task')}</span>
              <span class="type-card-hint">${tr('À faire, échéance, rappel', 'To do, due date, reminder')}</span>
            </span>
          </button>
        </div>
      </div>`);
    box.classList.add('modal-sm', 'create-sheet');

    box.addEventListener('click', event => {
      const choice = (event.target as HTMLElement).closest<HTMLElement>('[data-create]')?.dataset.create;
      if (!choice) return;
      this.closeModal();
      if (choice === 'task') this.openCreateTaskModal();
      else this.openCreateCredentialModal();
    });
  }

  /* ── Notifications ─────────────────────────────────────────────────────── */
  public showToast(message: string, type: 'success' | 'info' | 'error' | 'warning' = 'info', durationMs?: number, action?: { label: string; run: () => void }): void {
    pushToast(message, { kind: type, duration: durationMs, closeLabel: this.tr('Fermer', 'Close'), action });
  }

  dateLocale(): string {
    return i18n.intlLocale();
  }

  /** Icône choisie pour l'identifiant, sinon logo détecté depuis le site */
  credentialIcon(cred: { icon?: ItemIcon; website: string; title: string; type?: ItemType }, size = 20): string {
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

    /*
     * État de la touche Maj.
     *
     * La valeur est relue sur chaque événement plutôt que basculée aux seuls
     * keydown/keyup : revenir sur l'onglet après l'avoir quitté touche enfoncée
     * laisserait sinon l'application croire qu'elle l'est encore. Chaque clic et
     * chaque frappe portent l'état réel du modificateur, on s'en sert.
     */
    const suivreMaj = (e: KeyboardEvent | MouseEvent) => { this.shiftHeld = e.shiftKey; };
    for (const nom of ['keydown', 'keyup', 'pointerdown', 'mousedown', 'click'] as const) {
      window.addEventListener(nom, suivreMaj as EventListener, true);
    }
    window.addEventListener('blur', () => { this.shiftHeld = false; });

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

    // Barre latérale réduite : le choix est retenu, et chaque entrée garde son nom en infobulle
    const collapseBtn = document.getElementById('btn-collapse-sidebar');
    const appRoot = document.getElementById('app');
    const setCollapsed = (collapsed: boolean) => {
      appRoot?.classList.toggle('sidebar-collapsed', collapsed);
      collapseBtn?.setAttribute('aria-pressed', String(collapsed));
      const label = collapsed ? this.tr('Déplier le menu', 'Expand menu') : this.tr('Réduire le menu', 'Collapse menu');
      collapseBtn?.setAttribute('title', label);
      collapseBtn?.setAttribute('aria-label', label);
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* stockage indisponible */ }
    };
    try { setCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'); } catch { setCollapsed(false); }
    collapseBtn?.addEventListener('click', () => setCollapsed(!appRoot?.classList.contains('sidebar-collapsed')));
    document.querySelector('.sidebar')?.addEventListener('mouseover', event => {
      if (!appRoot?.classList.contains('sidebar-collapsed')) return;
      const item = (event.target as HTMLElement).closest<HTMLElement>('.nav-item');
      if (item && !item.title) item.title = item.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    });

    // Recto / verso d'une pièce d'identité, depuis la fiche
    document.addEventListener('click', async event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-id-scan]');
      if (!button) return;
      const meta = vaultStore.getData().credentials.find(c => c.id === this.selectedItemId)?.attachments?.find(a => a.id === button.dataset.idScan);
      if (!meta) return;
      button.disabled = true;
      try {
        this.openAttachmentPreview(meta, await this.loadAttachment(meta));
      } catch (err) {
        this.showToast(accountErrorMessage(err), 'error');
      } finally {
        button.disabled = false;
      }
    });

    document.getElementById('btn-open-templates')?.addEventListener('click', () => {
      this.openTemplatesModal();
    });

    document.getElementById('btn-open-trash')?.addEventListener('click', () => {
      this.openTrashModal();
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
  renderSidebar(): void {
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
        // Un coffre partagé apporte le type défini sur l'appareil qui l'a créé : cet
        // identifiant n'existe pas forcément ici. Faute de nom, on affiche « Coffre »
        // plutôt que l'identifiant brut, qui ne dit rien et déborde de la barre.
        : (() => {
            const connu = Object.prototype.hasOwnProperty.call(typeLabels, vault.type);
            const label = connu ? typeLabels[vault.type] : this.tr('Coffre', 'Vault');
            const classe = ['personal', 'work', 'team'].includes(vault.type) ? ` ${vault.type}` : '';
            return `<span class="vault-type-badge${classe}">${this.escapeHtml(label)}</span>`;
          })();
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
  renderList(): void {
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
      const breadcrumb = container.querySelector('.folder-breadcrumb');
      breadcrumb?.addEventListener('click', event => {
        const crumb = (event.target as HTMLElement).closest<HTMLElement>('[data-folder-crumb]');
        if (!crumb) return;
        this.activeFolderId = crumb.dataset.folderCrumb || null;
        this.selectedItemId = null;
        this.renderSidebar();
        this.renderList();
        this.renderDetail(null);
      });

      // Le fil d'Ariane accepte aussi le dépôt : c'est ce qui permet de ressortir un élément
      breadcrumb?.querySelectorAll<HTMLElement>('[data-folder-crumb]').forEach(crumb => {
        crumb.addEventListener('dragover', event => {
          const drag = event as DragEvent;
          if (!drag.dataTransfer?.types.includes('text/bettervault-item')) return;
          drag.preventDefault();
          drag.dataTransfer.dropEffect = 'move';
          crumb.classList.add('folder-drop');
        });
        crumb.addEventListener('dragleave', () => crumb.classList.remove('folder-drop'));
        crumb.addEventListener('drop', event => {
          const drag = event as DragEvent;
          const id = drag.dataTransfer?.getData('text/bettervault-item');
          crumb.classList.remove('folder-drop');
          if (!id) return;
          drag.preventDefault();
          this.moveItemToFolder(id, crumb.dataset.folderCrumb || null);
        });
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
      // Glisser une ligne sur un dossier de la barre latérale l'y range
      row.draggable = true;
      row.addEventListener('dragstart', event => {
        event.dataTransfer?.setData('text/bettervault-item', cred.id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        document.body.classList.add('dragging-item');
      });
      row.addEventListener('dragend', () => {
        document.body.classList.remove('dragging-item');
        document.querySelectorAll('.folder-drop').forEach(el => el.classList.remove('folder-drop'));
      });
      const expiry = renderExpiryBadge(expiryInfo(cred.expiresAt, tr, locale, now), { hideOk: true });

      row.innerHTML = `
        <div class="record-icon">${this.credentialIcon(cred)}</div>
        <div class="record-info">
          <div class="record-title">${cred.isFavorite ? `<span class="record-fav" title="${this.tr('Favori', 'Favorite')}">★</span>` : ''}${this.escapeHtml(cred.title)}</div>
          <div class="record-sub">${this.escapeHtml(this.itemSubtitle(cred))}</div>
        </div>
        <div class="record-badges">
          ${itemTypeOf(cred.type) === 'login' && !cred.templateId ? '' : this.typeBadge(itemTypeOf(cred.type), cred.templateId)}
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

    // Rien à filtrer et rien à trier : la barre disparaît au lieu de tenir une ligne vide
    bar.hidden = visible.length === 0 && creds.length < 2;
    if (bar.hidden) return;
    const sorts: Array<[CredentialSort, string]> = [
      ['name', this.tr('Nom', 'Name')],
      ['updated', this.tr('Modifiés', 'Updated')],
      ['recent', this.tr('Ajoutés', 'Added')],
      ['expiry', this.tr('Expiration', 'Expiry')]
    ];

    // Les pastilles défilent dans leur propre bande ; le tri reste en dehors, toujours atteignable
    bar.innerHTML = `
      <div class="filter-bar-scroll">
        ${visible.map(f => {
          const active = this.credentialFilters.has(f);
          return `<button type="button" class="filter-chip ${active ? 'active' : ''}" data-filter="${f}" aria-pressed="${active}">${labels[f]}<span class="filter-chip-count">${counts[f]}</span></button>`;
        }).join('')}
        ${this.credentialFilters.size ? `<button type="button" class="btn-primary btn-ghost filter-reset" data-action="reset">${this.tr('Effacer', 'Clear')}</button>` : ''}
      </div>
      <select class="form-input filter-sort" aria-label="${this.tr('Trier par', 'Sort by')}" title="${this.tr('Trier par', 'Sort by')}">
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
  renderDetail(id: string | null): void {
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
              <div class="field-box" style="white-space:pre-wrap;line-height:1.6;">${this.escapeHtml(task.description)}</div>
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
                    <span class="subtask-title ${s.isDone ? 'done' : ''}">${this.escapeHtml(s.title)}</span>
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
            <textarea class="note-editor" id="task-notes" placeholder="${this.tr('Notes sur cette tâche…', 'Notes about this task…')}">${this.escapeHtml(task.notes || '')}</textarea>
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
          message: this.tr(`« ${task.title} » ira dans la corbeille, où elle reste 30 jours.`, `"${task.title}" will go to the trash, where it stays for 30 days.`),
          confirmLabel: this.tr('Supprimer', 'Delete'),
          danger: true,
          skippable: true
        });
        if (confirmed) {
          vaultStore.deleteTask(task.id);
          this.selectedItemId = null;
          this.renderDetail(null);
          this.showToast(this.tr('Tâche mise à la corbeille', 'Task moved to trash'), 'info', 6000, this.undoDelete(task.id));
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
          <a href="${this.escapeHtml(this.safeHref(cred.website))}" target="_blank" rel="noopener noreferrer"
            style="color:var(--accent-blue);text-decoration:none;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">
            ${this.escapeHtml(cred.website)}
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
              : this.typeBadge(detailType, cred.templateId)}</div>
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
            <span class="field-val" id="text-username">${cred.username ? this.escapeHtml(cred.username) : '—'}</span>
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

        <div data-versioning>${renderVersioning(cred, this.versionsContext('credential', cred.id))}</div>

        ${cred.passwordHistory && cred.passwordHistory.length > 0 ? `
          <div class="field-group">
            <div class="section-divider" style="margin-bottom:8px;">${this.tr('Anciens mots de passe', 'Previous passwords')} (${cred.passwordHistory.length})</div>
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${cred.passwordHistory.map(h => `
                <div class="history-entry">
                  <span class="history-password">&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;</span>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <span class="history-date">${new Date(h.changedAt).toLocaleDateString(i18n.intlLocale())}</span>
                    <button class="icon-btn btn-copy-history" data-pwd="${this.escapeHtml(h.password)}" title="${this.tr('Copier cet ancien mot de passe', 'Copy this previous password')}">
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
                <div style="font-size:11px;color:var(--text-muted);font-weight:600;">${this.escapeHtml(f.label)}</div>
                <div class="custom-field-box">
                  <span class="custom-field-val ${f.isMasked ? 'masked' : ''}" id="cf-val-${f.id}">
                    ${f.isMasked ? '••••••••••••' : this.escapeHtml(f.value)}
                  </span>
                  <div style="display:flex;gap:6px;">
                    ${f.isMasked ? `
                      <button class="icon-btn btn-reveal-cf" data-cf-id="${f.id}" data-val="${this.escapeHtml(f.value)}" title="${this.tr('Afficher', 'Show')}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                      </button>
                    ` : ''}
                    <button class="icon-btn btn-copy-cf" data-val="${this.escapeHtml(f.value)}" title="${this.tr('Copier', 'Copy')}">
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
          <textarea class="note-editor" id="inline-notes" placeholder="${this.tr('Codes de récupération, informations utiles…', 'Recovery codes, useful details…')}">${this.escapeHtml(cred.notes || '')}</textarea>
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
          `« ${cred.title} » ira dans la corbeille avec son historique et ses fichiers, pendant 30 jours. Les tâches liées sont conservées.`,
          `"${cred.title}" will go to the trash with its history and files, for 30 days. Linked tasks are kept.`
        ),
        confirmLabel: this.tr('Supprimer', 'Delete'),
        danger: true,
        skippable: true
      });
      if (confirmed) {
        // L'identifiant part à la corbeille avec ses fichiers : ils ne quittent le serveur qu'à son vidage
        vaultStore.deleteCredential(cred.id);
        this.selectedItemId = null;
        this.renderDetail(null);
        this.showToast(this.tr('Identifiant mis à la corbeille', 'Credential moved to trash'), 'info', 6000, this.undoDelete(cred.id));
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

    const versioning = document.querySelector<HTMLElement>('[data-versioning]');
    if (versioning) wireVersioning(versioning, cred, this.versionsContext('credential', cred.id));

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
  openModal(htmlContent: string, options: { dismissible?: boolean } = {}): HTMLElement {
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

  closeModal(): void {
    const container = document.getElementById('modal-container');
    if (!container?.firstElementChild) return;
    container.innerHTML = '';
    const returnTarget = this.modalReturnFocus;
    this.modalReturnFocus = null;
    if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
  }

  /** Boîte de confirmation stylée, empilée au-dessus d'une éventuelle modale ouverte */
  /**
   * Les rappels de raccourcis n'ont de sens que là où il y a un clavier.
   *
   * On interroge la finesse du pointeur plutôt que la largeur de la fenêtre :
   * la fenêtre de l'extension est étroite mais posée sur un ordinateur, et un
   * téléphone reste un téléphone même en paysage.
   */
  private shortcutsVisible(): boolean {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  }

  confirmDialog(options: { title: string; message: string; confirmLabel: string; danger?: boolean; skippable?: boolean }): Promise<boolean> {
    // Suppression d'un élément que l'on peut refaire : Maj enfoncée vaut confirmation
    if (options.skippable && this.shiftHeld) return Promise.resolve(true);
    return new Promise(resolve => {
      const layer = document.createElement('div');
      layer.className = 'modal-overlay dialog-layer';
      layer.innerHTML = `
        <div class="modal-box modal-sm" role="alertdialog" aria-modal="true">
          <div class="modal-header"><div class="modal-title"></div></div>
          <div class="modal-body"><p class="modal-text"></p></div>
          <div class="modal-footer">
            ${options.skippable && this.shortcutsVisible() ? `<span class="dialog-hint">${this.tr('Maj + clic pour passer cette confirmation', 'Shift-click to skip this confirmation')}</span>` : ''}
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
    openCreateCredentialModal(this, existingCredId, options);
  }

  /* ── Créer ou Modifier une Tâche ─────────────────────────────────────── */
  private openCreateTaskModal(linkedCredentialId?: string, existingTaskId?: string): void {
    openCreateTaskModal(this, linkedCredentialId, existingTaskId);
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

  mountGenerator(host: HTMLElement, options: { onUse?: (value: string) => void } = {}): { copy: () => Promise<void> } {
    return mountGenerator(this, host, options);
  }

  /* ── Audit de Sécurité du Coffre ────────────────────────────────────────── */
  /* ── Versions, conflits, corbeille ─────────────────────────────────── */

  private versionsContext(kind: 'credential' | 'task', id: string): VersionsContext {
    return {
      tr: (fr, en) => this.tr(fr, en),
      esc: value => this.escapeHtml(value),
      locale: () => i18n.intlLocale(),
      confirm: options => this.confirmDialog(options),
      toast: (message, type = 'info') => this.showToast(message, type),
      restoreVersion: rev => {
        const ok = vaultStore.restoreItemVersion(kind, id, rev);
        if (ok) this.renderDetail(id);
        return ok;
      },
      resolveConflict: (conflict, keep) => {
        vaultStore.resolveItemConflict(kind, id, conflict, keep);
        this.renderDetail(id);
      }
    };
  }

  /** Supprime pour de bon, fichiers du serveur compris */
  private purgeTrashEntry(id: string): void {
    const entry: TrashEntry | null = vaultStore.purgeFromTrash(id);
    const files = entry && 'attachments' in entry.item ? entry.item.attachments ?? [] : [];
    for (const file of files) {
      if (!file.data) void accountService.withCloud(client => client.deleteAttachment(file.id)).catch(() => undefined);
    }
  }

  /** À l'ouverture : ce qui dort à la corbeille depuis plus de TRASH_DAYS jours part, fichiers compris */
  private purgeExpiredTrash(): void {
    for (const entry of expiredTrash(vaultStore.getData().trash)) this.purgeTrashEntry(entry.item.id);
  }

  /** Types d'éléments personnalisés : création, modification, suppression */
  openTemplatesModal(): void {
    const tr = (fr: string, en: string) => this.tr(fr, en);
    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title">${tr('Mes types d’éléments', 'My item types')}</div>
        <button class="modal-close" type="button">${GEN_ICONS.close}</button>
      </div>
      <div class="modal-body" data-templates-body></div>
      <div class="modal-footer">
        <button type="button" class="btn-primary" data-close>${tr('Fermer', 'Close')}</button>
      </div>`);
    mountTemplateEditor(box.querySelector<HTMLElement>('[data-templates-body]')!, {
      templates: () => vaultStore.getTemplates(),
      save: input => vaultStore.saveTemplate(input),
      remove: id => {
        vaultStore.deleteTemplate(id);
        this.renderList();
      },
      usage: id => vaultStore.getData().credentials.filter(c => c.templateId === id).length,
      confirm: message => this.confirmDialog({ title: tr('Supprimer ce type ?', 'Delete this type?'), message, confirmLabel: tr('Supprimer', 'Delete'), danger: true }),
      toast: (message, kind) => this.showToast(message, kind),
      errorMessage: accountErrorMessage,
      tr,
      escape: value => this.escapeHtml(value)
    });
  }

  private openTrashModal(): void {
    const tr = (fr: string, en: string) => this.tr(fr, en);
    const context = this.versionsContext('credential', '');
    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title">${tr('Corbeille', 'Trash')}</div>
        <button class="modal-close" type="button">${GEN_ICONS.close}</button>
      </div>
      <div class="modal-body" data-trash-body></div>
      <div class="modal-footer">
        <button type="button" class="btn-primary btn-danger" data-trash-empty>${tr('Vider la corbeille', 'Empty trash')}</button>
        <button type="button" class="btn-primary" data-close>${tr('Fermer', 'Close')}</button>
      </div>`);
    const body = box.querySelector<HTMLElement>('[data-trash-body]')!;
    const paint = () => {
      const entries = vaultStore.getTrash();
      body.innerHTML = renderTrash(entries, context, TRASH_DAYS);
      (box.querySelector('[data-trash-empty]') as HTMLButtonElement).disabled = !entries.length;
    };
    paint();

    body.addEventListener('click', async event => {
      const target = event.target as HTMLElement;
      const restore = target.closest<HTMLElement>('[data-trash-restore]')?.dataset.trashRestore;
      const purge = target.closest<HTMLElement>('[data-trash-purge]')?.dataset.trashPurge;
      if (restore) {
        vaultStore.restoreFromTrash(restore);
        this.showToast(tr('Élément restauré', 'Item restored'), 'success');
        paint();
      } else if (purge) {
        const ok = await this.confirmDialog({
          title: tr('Supprimer définitivement ?', 'Delete forever?'),
          message: tr('L’élément et ses fichiers ne pourront plus être récupérés.', 'The item and its files cannot be recovered.'),
          confirmLabel: tr('Supprimer', 'Delete'),
          danger: true,
          skippable: true
        });
        if (!ok) return;
        this.purgeTrashEntry(purge);
        paint();
      }
    });

    box.querySelector('[data-trash-empty]')?.addEventListener('click', async () => {
      const count = vaultStore.getTrash().length;
      const ok = await this.confirmDialog({
        title: tr('Vider la corbeille ?', 'Empty the trash?'),
        message: tr(`${count} élément(s) et leurs fichiers partiront définitivement.`, `${count} item(s) and their files will be gone for good.`),
        confirmLabel: tr('Vider', 'Empty'),
        danger: true
      });
      if (!ok) return;
      for (const entry of [...vaultStore.getTrash()]) this.purgeTrashEntry(entry.item.id);
      paint();
    });
  }

  private openAuditModal(): void {
    openAuditModal(this);
  }

  /* ── Import & Export Hub ────────────────────────────────────────────────── */
  private openImportModal(): void {
    openImportExportModal(this, { accountService, sharedVaults });
  }

  /* ── Compte : déverrouillage, verrouillage, synchronisation ─────────── */
  private initAccount(): void {
    this.authScreen = mountAuthScreen(document.getElementById('auth-screen') as HTMLElement, accountService, data => this.showApp(data), { deviceStore: this.deviceStore, profiles: profileActions });

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
    document.getElementById('btn-switch-account')?.addEventListener('click', () => this.openAccountSwitcher());
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

  reloadWithShared(): void {
    const personal = accountService.getLatestData();
    if (!personal) return;
    const activeVaultId = vaultStore.getData().activeVaultId;
    vaultStore.load(sharedVaults.mergeInto(personal));
    if (vaultStore.getData().vaults.some(v => v.id === activeVaultId)) vaultStore.setActiveVault(activeVaultId);
  }

  /** Vrai si le rôle de l'utilisateur permet de modifier le coffre (toujours vrai pour un coffre personnel) */
  canEdit(vaultId: string, permission: SharedPermission = 'write'): boolean {
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

  roleLabel(role: SharedRole): string {
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
    const localFiles = this.storesAttachmentsLocally(cred.vaultId);
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
        <label class="btn-primary btn-ghost" style="align-self:flex-start;cursor:pointer;">+ ${tr('Ajouter un fichier', 'Add a file')}<input type="file" data-attachment-input multiple hidden></label>
        <div class="field-hint">${localFiles
          ? tr(`Chiffrés et gardés dans le coffre, sur cet appareil. ${formatLimit(MAX_LOCAL_ATTACHMENT_BYTES, 'fr')} par fichier.`,
               `Encrypted and kept inside the vault, on this device. ${formatLimit(MAX_LOCAL_ATTACHMENT_BYTES, 'en')} per file.`)
          : tr('Chiffrés sur cet appareil, puis stockés sur votre serveur.', 'Encrypted on this device, then stored on your server.')}</div>
      </div>`;
  }

  private bindAttachments(container: HTMLElement, cred: CredentialItem): void {
    const tr = (fr: string, en: string) => this.tr(fr, en);
    const current = () => vaultStore.getData().credentials.find(c => c.id === cred.id);

    container.querySelector<HTMLInputElement>('[data-attachment-input]')?.addEventListener('change', async e => {
      const input = e.target as HTMLInputElement;
      const files = [...(input.files ?? [])];
      input.value = '';
      if (!files.length || !this.canEdit(cred.vaultId, 'attachments')) return;
      const maxBytes = this.attachmentSizeLimit(cred.vaultId);
      for (const file of files) {
        if (file.size > maxBytes) {
          this.showToast(this.attachmentTooLargeMessage(file.name, maxBytes), 'error', 5000);
          continue;
        }
        try {
          const meta = await this.storeAttachment(file, cred.vaultId);
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
            this.openAttachmentPreview(meta, await this.loadAttachment(meta));
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
            downloadExportFile(await this.loadAttachment(meta), meta.name, meta.type || 'application/octet-stream');
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
          message: meta.data
            ? tr(`${meta.name} sera supprimé du coffre.`, `${meta.name} will be deleted from the vault.`)
            : tr(`${meta.name} sera supprimé du serveur.`, `${meta.name} will be deleted from the server.`),
          confirmLabel: tr('Supprimer', 'Delete'),
          danger: true
        });
        if (!confirmed) return;
        try {
          await this.removeAttachment(meta);
          vaultStore.updateCredential(cred.id, { attachments: (current()?.attachments ?? []).filter(a => a.id !== meta.id) });
        } catch (err) {
          this.showToast(accountErrorMessage(err), 'error');
        }
      });
    });
  }

  /**
   * Un fichier va sur le serveur quand le compte est synchronisé, et dans le coffre lui-même
   * sinon. Les trois méthodes suivantes cachent cette différence au reste de l'interface.
   */
  private storesAttachmentsLocally(vaultId: string): boolean {
    return !accountService.isCloud() && !sharedVaults.isShared(vaultId);
  }

  /** Taille maximale d'un fichier pour ce coffre */
  attachmentSizeLimit(vaultId: string): number {
    return this.storesAttachmentsLocally(vaultId)
      ? MAX_LOCAL_ATTACHMENT_BYTES
      : accountService.getLimits().maxAttachmentBytes;
  }

  /** Explique la limite, qui n'est pas la même selon l'endroit où le fichier irait */
  attachmentTooLargeMessage(name: string, maxBytes: number): string {
    const taille = formatLimit(maxBytes, 'fr');
    const size = formatLimit(maxBytes, 'en');
    return maxBytes === MAX_LOCAL_ATTACHMENT_BYTES
      ? this.tr(
          `${name} dépasse ${taille}. Les fichiers sont gardés dans le coffre tant qu'il n'est pas synchronisé ; activez la synchronisation pour des fichiers plus gros.`,
          `${name} is larger than ${size}. Files are kept inside the vault until it is synced; turn on sync for larger files.`)
      : this.tr(`${name} dépasse ${taille}`, `${name} is larger than ${size}`);
  }

  async storeAttachment(file: File, vaultId: string): Promise<AttachmentMeta> {
    const { payload, key } = await encryptFile(new Uint8Array(await file.arrayBuffer()));
    const base = { name: file.name, size: file.size, type: file.type, key, createdAt: Date.now() };

    if (this.storesAttachmentsLocally(vaultId)) {
      const data = toBase64(payload);
      // Les fichiers partagent la place du coffre : on garde de la marge pour le reste
      const budget = Math.floor(accountService.getLimits().maxVaultBytes / 2);
      const used = vaultStore.getData().credentials.reduce((total, c) => total + localAttachmentBytes(c.attachments), 0);
      if (used + data.length > budget) {
        throw new Error(`Les fichiers gardés dans ce coffre dépassent ${Math.round(budget / 1048576)} Mo`);
      }
      return { ...base, id: randomId('att'), data };
    }
    const sharedId = sharedVaults.isShared(vaultId) ? vaultId : undefined;
    const uploaded = await accountService.withCloud(client => client.uploadAttachment(payload, sharedId));
    return { ...base, id: uploaded.id };
  }

  private async loadAttachment(meta: AttachmentMeta): Promise<Uint8Array> {
    const payload = meta.data ? fromBase64(meta.data) : await accountService.withCloud(client => client.downloadAttachment(meta.id));
    return decryptFile(payload, meta.key);
  }

  /** Retire le fichier du serveur ; celui qui est dans le coffre disparaît avec son élément */
  async removeAttachment(meta: AttachmentMeta): Promise<void> {
    if (meta.data) return;
    await accountService.withCloud(client => client.deleteAttachment(meta.id)).catch(err => {
      if (!(err instanceof Error && 'status' in err && (err as { status: number }).status === 404)) throw err;
    });
  }

  /** Aperçu d'une pièce jointe déchiffrée : rien n'est écrit sur le disque, l'URL blob est libérée à la fermeture */
  private openAttachmentPreview(meta: AttachmentMeta, data: Uint8Array): void {
    const tr = (fr: string, en: string) => this.tr(fr, en);
    const kind = previewKind(meta.type, meta.name);
    // Un SVG s'affiche comme une image, mais son contenu peut exécuter du script : il est montré en texte
    const svg = /svg/i.test(meta.type) || meta.name.toLowerCase().endsWith('.svg');

    /*
     * Le type MIME sert à décider comment le navigateur INTERPRÈTE les octets, et il
     * vient du fichier — donc de qui l'a déposé, un membre d'un coffre partagé par
     * exemple. Le reprendre tel quel revient à lui laisser ce choix : « photo.pdf »
     * annoncé « text/html » devient une page, chargée depuis une URL blob: de notre
     * propre origine, avec accès au coffre déchiffré. On ne garde donc du fichier
     * que la catégorie d'affichage, et on impose le type correspondant.
     */
    const safeType = svg ? 'text/plain'
      : kind === 'pdf' ? 'application/pdf'
      : kind === 'image' || kind === 'audio' || kind === 'video'
        ? (/^(image|audio|video)\/[a-z0-9.+-]+$/i.test(meta.type) ? meta.type.toLowerCase() : 'application/octet-stream')
        : 'text/plain';
    const blob = new Blob([data as unknown as BlobPart], { type: safeType });
    const url = URL.createObjectURL(blob);

    let body: string;
    if (kind === 'image' && !svg) body = `<img class="attachment-preview-image" src="${url}" alt="${this.escapeHtml(meta.name)}">`;
    // sandbox vide : le visualiseur PDF interne fonctionne, mais un document qui
    // s'avérerait être autre chose reste privé de script et d'accès à l'origine.
    else if (kind === 'pdf') body = `<iframe class="attachment-preview-frame" sandbox referrerpolicy="no-referrer" src="${url}" title="${this.escapeHtml(meta.name)}"></iframe>`;
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
      downloadExportFile(data, meta.name, meta.type || 'application/octet-stream');
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
    this.purgeExpiredTrash();
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

  lockApp(): void {
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

  async signOutDevice(): Promise<void> {
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

  syncStatusLabel(status: SyncStatus): string {
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

  renderSyncStatus(): void {
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
    openAccountModal(this);
  }

  /* ── Appareil : déverrouillage biométrique et remplissage automatique ── */
  async bindDeviceSection(section: HTMLElement): Promise<void> {
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
  showRecoveryKey(key: string, intro: string): void {
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
  openEraseModal(): void {
    openEraseModal(this);
  }

  /**
   * Fenêtre « Comptes » : un clic pour l'ouvrir, un clic pour changer.
   *
   * Chaque compte est un couple adresse + serveur ; changer de serveur, c'est donc
   * choisir le compte ouvert sur cet autre serveur. Le compte quitté se verrouille :
   * ses clés partent avec la page rechargée, et il demandera son mot de passe au retour.
   */
  private openAccountSwitcher(): void {
    const tr = this.tr.bind(this);
    const box = this.openModal(`
      <div class="modal-header">
        <div class="modal-title">${tr('Comptes', 'Accounts')}</div>
        <button class="modal-close" type="button">${GEN_ICONS.close}</button>
      </div>
      <div class="modal-body">
        <div class="profile-list" data-profile-list>${profileRowsHtml(profileActions, tr, { forgettable: true })}</div>
        <button type="button" class="btn-primary profile-add" data-profile-add>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>${tr('Ajouter un compte', 'Add an account')}</span>
        </button>
        <p class="field-hint">${tr('Un compte par serveur : passer d’un serveur à l’autre, c’est choisir le compte ouvert sur celui-ci. Le compte quitté se verrouille.', 'One account per server: switching servers means picking the account opened there. The account you leave gets locked.')}</p>
      </div>
    `);
    box.classList.add('modal-sm');
    wireProfileRows(box.querySelector('[data-profile-list]') as HTMLElement, profileActions, email => this.confirmDialog({
      title: tr('Oublier ce compte ?', 'Forget this account?'),
      message: tr(`« ${email} » disparaît de cet appareil. Un compte synchronisé reste sur son serveur ; un coffre local non exporté est perdu.`,
                  `"${email}" disappears from this device. A synced account stays on its server; an unexported local vault is lost.`),
      confirmLabel: tr('Oublier', 'Forget'),
      danger: true
    }));
    box.querySelector('[data-profile-add]')?.addEventListener('click', () => profileActions.addNew());
  }

  openVaultModal(vaultId?: string): void {
    openVaultModal(this, vaultId);
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

        li.addEventListener('dragover', event => {
          if (!event.dataTransfer?.types.includes('text/bettervault-item')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          li.classList.add('folder-drop');
        });
        li.addEventListener('dragleave', () => li.classList.remove('folder-drop'));
        li.addEventListener('drop', event => {
          const id = event.dataTransfer?.getData('text/bettervault-item');
          li.classList.remove('folder-drop');
          if (!id) return;
          event.preventDefault();
          this.moveItemToFolder(id, folder.id);
        });

        list.appendChild(li);
        if (expanded) addLevel(folder.id, depth + 1);
      }
    };

    addLevel('', 0);
  }

  /** Range un élément dans un dossier et propose de revenir en arrière */
  private moveItemToFolder(credentialId: string, folderId: string | null): void {
    const item = vaultStore.getData().credentials.find(c => c.id === credentialId);
    const folder = folderId ? vaultStore.getFolder(folderId) : undefined;
    if (!item || (folderId && !folder)) return;
    if ((item.folderId ?? null) === folderId) return;
    if (!this.canEdit(item.vaultId, 'write')) return;

    const previous = item.folderId ?? null;
    try {
      vaultStore.moveToFolder(credentialId, folderId);
    } catch (err) {
      this.showToast(accountErrorMessage(err), 'error');
      return;
    }
    this.renderSidebar();
    this.renderList();

    const where = folder ? folder.name : this.tr('la racine du coffre', 'the vault root');
    this.showToast(this.tr(`${item.title} rangé dans ${where}`, `${item.title} moved to ${where}`), 'success', 5000, {
      label: this.tr('Annuler', 'Undo'),
      run: () => {
        vaultStore.moveToFolder(credentialId, previous);
        this.renderSidebar();
        this.renderList();
      }
    });
  }

  /** Action « Annuler » d'une notification de suppression : l'élément revient de la corbeille */
  private undoDelete(id: string): { label: string; run: () => void } {
    return {
      label: this.tr('Annuler', 'Undo'),
      run: () => {
        if (!vaultStore.restoreFromTrash(id)) return;
        this.selectedItemId = id;
        this.renderSidebar();
        this.renderList();
        this.renderDetail(id);
      }
    };
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
      danger: true,
      skippable: true
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
  /** Recto et verso d'une pièce d'identité : ouverts à la demande, déchiffrés sur l'appareil */
  private identityScans(cred: CredentialItem): string {
    const scans = (['front', 'back'] as const)
      .map(side => ({ side, meta: cred.attachments?.find(a => a.side === side) }))
      .filter(s => s.meta);
    if (!scans.length) return '';
    return `<div class="id-scan-buttons">${scans.map(({ side, meta }) => `
      <button type="button" class="btn-primary" data-id-scan="${this.escapeHtml(meta!.id)}">
        ${side === 'front' ? this.tr('Voir le recto', 'View front') : this.tr('Voir le verso', 'View back')}
      </button>`).join('')}</div>`;
  }

  private typeBadge(type: ItemType, templateId?: string): string {
    const info = ITEM_TYPE_INFO[type];
    const custom = templateId ? vaultStore.getTemplates().find(t => t.id === templateId) : undefined;
    return `<span class="item-type-badge">${tabIcon(info.icon, 13)}${this.escapeHtml(custom?.name ?? this.tr(info.fr, info.en))}</span>`;
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
        this.detailField(tr('Adresse', 'Address'), [id.address, place, id.country].filter(Boolean).join(', ')),
        this.identityScans(cred)
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
    // Type personnalisé : sa première valeur visible, sinon le nom du type
    if (cred.templateId) {
      const visible = (cred.fields ?? []).find(f => !f.isMasked && f.value.trim());
      const custom = vaultStore.getTemplates().find(t => t.id === cred.templateId);
      if (visible || custom) return visible ? `${visible.label} : ${visible.value}` : custom!.name;
    }

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

  /**
   * Adresse sûre pour un attribut href.
   *
   * Seuls http et https sont rendus cliquables : « javascript: » et « data: »
   * ne contiennent aucun caractère à échapper et passeraient l'échappement.
   */
  private safeHref(raw: string): string {
    const value = (raw ?? '').trim();
    if (!value) return '';
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
    try {
      const url = new URL(withScheme);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
    } catch {
      return '';
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
    openTagManagerModal(this);
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
    openShortcutsModal(this);
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
  profileStore = new ProfileStore(storage);
  profileStore.touch();
  accountService = new AccountService({ storage: profileStore.storageFor(), sessionStore: extensionSessionStore() });
  sharedVaults = new SharedVaultManager(accountService);
registerServices(accountService, sharedVaults);
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

