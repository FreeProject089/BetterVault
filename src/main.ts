import { randomId, vaultStore } from './store/vaultStore';
import type { CredentialItem } from './types/vault';
import { extractDomain, getServiceIconSvg } from './icons/serviceIcons';
import { renderItemIcon, type ItemIcon } from './icons/iconLibrary';
import { generateTOTP, totpUrgency } from './crypto/totpEngine';
import { downloadExportFile } from './import_export/importEngine';
import { AccountService, type SyncStatus } from './account/accountService';
import { SharedReadOnlyError, SharedVaultManager } from './account/sharedVaults';
import { setApiLocale, type SharedPermission, type SharedRole } from './account/cloudClient';
import { decryptFile, encryptFile, formatLimit, localAttachmentBytes, MAX_LOCAL_ATTACHMENT_BYTES, type AttachmentMeta } from './account/attachmentCrypto';
import { fromBase64, toBase64 } from './account/accountCrypto';
import { createDeviceStorage } from './platform/storage';
import { isTauri, openExternal } from './platform/tauriBridge';
import type { UnlockedVaultData } from './types/vault';
import { getDueReminders } from './tasks/taskEngine';
import { accountErrorMessage, mountAuthScreen } from './ui/authScreen';
import { showToast as pushToast } from './ui/toast';
import { printRecoveryKey, recoveryKeyFile } from './ui/recoveryKey';
import { secretGridHtml } from './ui/secretDisplay';
import { translateError } from './i18n/errorMessages';
import { tabIcon } from './ui/tabIcons';
import { ProfileStore } from './account/profiles';
import { ACTION_ICONS, GEN_ICONS, tagColor, VAULT_ICON } from './ui/icons';
import { mountGenerator } from './ui/generator';
import { registerServices } from './app/services';
import { renderList } from './ui/listView';
import { renderDetail } from './ui/detailView';
import { openCreateTaskModal } from './ui/taskModal';
import { openCreateCredentialModal } from './ui/credentialModal';
import { applyTheme, currentMode, hasBothModes, loadSavedTheme, saveMode, type ThemeMode } from './ui/themes';
import { mountTemplateEditor } from './ui/itemTemplatesUi';
import { renderTrash, type VersionsContext } from './ui/versionsPanel';
import { expiredTrash } from './store/vaultStore';
import { TRASH_DAYS } from './account/merge';
import type { TrashEntry } from './types/vault';
import { profileRowsHtml, wireProfileRows, type ProfileActions } from './ui/accountSwitcher';
import { ACCOUNT_STORAGE_KEYS } from './account/accountService';
import { formatCardNumber, itemTypeOf, ITEM_TYPE_INFO, type ItemType } from './types/itemTypes';
import { bindingFromEvent, isPlainKey, loadShortcuts, SHORTCUT_ORDER, type ShortcutAction, type ShortcutBindings } from './ui/shortcuts';
import { CREDENTIAL_FILTERS, countByFilter, type CredentialFilter, type CredentialSort } from './store/credentialFilters';
import { activeTabHost, extensionSessionStore, extensionSurface, fillActiveTab, matchesSite, openFullTab, openSidePanel } from './extension/surface';
import { biometricStore, isAndroidApp, nativeCall, type DeviceSecretStore } from './platform/biometric';
import { i18n } from './i18n';
import { wireLanguageMenu } from './ui/languageMenu';
import { initCustomSelects } from './ui/customSelect';
import { memberAvatarHtml } from './ui/memberChip';

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


const AUTOFILL_KEY = 'bettervault.android-autofill';

/**
 * Retire l'écran de lancement de l'application installée (voir index.html).
 * On attend la fin de la transition avant de l'enlever du document, sinon le
 * fondu ne se voit pas.
 */
function hideSplash(): void {
  const splash = document.getElementById('splash');
  if (!splash) return;
  // Déjà masqué par ailleurs : on enlève le nœud sans jouer de fondu invisible
  if (splash.hidden) {
    splash.remove();
    return;
  }
  splash.classList.add('fade-out');
  window.setTimeout(() => splash.remove(), 320);
}

/*
 * Filet de sécurité : si le démarrage n'aboutit jamais (réseau bloqué, erreur
 * inattendue), l'écran de lancement ne doit pas rester indéfiniment devant la
 * page. Mieux vaut montrer l'écran de connexion, même vide, qu'un chargement
 * sans fin.
 */
window.setTimeout(() => document.getElementById('splash')?.remove(), 8000);


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
  searchQuery = '';
  taskViewMode: TaskViewMode = 'list';
  /**
   * Filtre des tâches par personne, dans un coffre partagé : « toutes »,
   * « les miennes », « non attribuées », ou l'adresse d'un membre.
   */
  taskAssignee: 'all' | 'mine' | 'none' | string = 'all';
  public totpInterval: number | null = null;
  private autoLockTimeout: number | null = null;
  private readonly AUTO_LOCK_DELAY_MS = 5 * 60 * 1000; // 5 minutes d'inactivité
  private clipboardClearTimer: number | null = null;
  activeTag: string | null = null;
  /** Dossier ouvert dans la barre latérale ; null = tout le coffre */
  /** Dossiers dépliés dans l'arborescence : préférence d'affichage, gardée sur l'appareil */
  private authScreen: { show(): void } | null = null;
  credentialFilters = new Set<CredentialFilter>();
  credentialSort: CredentialSort = 'name';
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
    // Listes déroulantes aux couleurs du thème (ordinateur seulement)
    initCustomSelects();
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

  /** Texte dans la langue affichée ; une langue ajoutée par le serveur passe par son dictionnaire */
  tr(fr: string, en: string): string {
    return i18n.pick(fr, en);
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
    // Le thème choisi garde la main ; le mode dit seulement lequel de ses deux
    // jeux de couleurs s'applique.
    applyTheme(loadSavedTheme(), currentMode());
    this.updateThemeIcons();

    document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
      /*
       * Basculer clair / sombre ne quitte plus le thème : chaque thème porte
       * ses deux jeux de couleurs. Avant, ce bouton effaçait le thème choisi,
       * ce qui revenait à ne pouvoir garder un thème que dans un seul mode.
       */
      const next: ThemeMode = currentMode() === 'light' ? 'dark' : 'light';
      saveMode(next);
      const theme = loadSavedTheme();
      applyTheme(theme, next);
      // La couleur de la barre du système suit le fond réellement appliqué
      const meta = document.querySelector('meta[name="theme-color"]');
      const applique = document.documentElement.getAttribute('data-theme') === 'light';
      if (meta) meta.setAttribute('content', applique ? '#f6f8fa' : '#161b22');
      if (theme && !hasBothModes(theme)) {
        this.showToast(this.tr(
          `« ${theme.name} » n’a qu’un seul jeu de couleurs : ajoutez-en un second dans son fichier.`,
          `“${theme.name}” has only one colour set: add a second one in its file.`
        ), 'info');
      }
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
  /** Relance la liste des langues (après connexion d'un compte synchronisé, par exemple) */
  refreshLanguages: () => void = () => undefined;

  private initI18n(): void {
    const toggleBtn = document.getElementById('btn-language-toggle');
    if (toggleBtn) {
      this.refreshLanguages = wireLanguageMenu(toggleBtn, document.getElementById('current-lang-label'), {
        onChange: message => this.showToast(message, 'info', 1500),
        onError: message => this.showToast(message, 'error')
      });
    }
    this.applyI18n();
  }

  private applyI18n(): void {
    const lang = i18n.getLocaleCode();
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

  saveListPrefs(): void {
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

    // Le logo ramène à la page d'accueil, sur le web seulement : l'application
    // de bureau et l'extension n'en ont pas
    const badge = document.querySelector<HTMLElement>('.sidebar .workspace-badge');
    if (badge && !isTauri() && !extensionSurface() && window.location.protocol.startsWith('http')) {
      const home = document.createElement('a');
      const homeLabel = this.tr('Accueil BetterVault', 'BetterVault home');
      home.href = '/';
      home.className = 'workspace-badge workspace-home-link';
      home.title = homeLabel;
      home.setAttribute('aria-label', homeLabel);
      home.append(...badge.childNodes);
      badge.replaceWith(home);
    }

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

    this.renderTagSidebar();
  }

  /* ── List Panel ─────────────────────────────────────────────────────────── */
  renderList(): void {
    renderList(this);
  }

  /* ── Filtres et tri de la liste ─────────────────────────────────────── */
  renderFilterBar(creds: CredentialItem[]): void {
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
    renderDetail(this, id);
  }

  /* ── TOTP Live Refresh ─────────────────────────────────────────────────── */
  updateLiveTOTP(): void {
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
      /*
       * La couleur de l'urgence porte sur toute la carte, pas seulement sur
       * l'anneau : le code lui-même change de teinte, sinon on lit un code
       * bleu tranquille à une seconde de son expiration.
       */
      const urgence = totpUrgency(res.remainingSeconds);
      const carte = document.getElementById('detail-totp-container');
      if (carte) {
        carte.classList.toggle('totp-warning', urgence === 'warning');
        carte.classList.toggle('totp-danger', urgence === 'danger');
      }
      if (meterEl) {
        const pct = (res.remainingSeconds / 30) * 100;
        meterEl.setAttribute('stroke-dashoffset', (100 - pct).toString());
        meterEl.setAttribute('stroke', 'currentColor');
      }
      // Le temps restant est annoncé aux lecteurs d'écran, mais pas chaque seconde
      const label = document.getElementById('detail-totp-seconds-label');
      if (label && res.remainingSeconds % 10 === 0) {
        label.textContent = this.tr(`${res.remainingSeconds} secondes avant le prochain code`, `${res.remainingSeconds} seconds until the next code`);
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
  renderActionMenu(items: Array<{ id: string; label: string; icon: string; danger?: boolean } | 'separator'>): string {
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

  bindActionMenus(root: HTMLElement): void {
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
  openCreateCredentialModal(existingCredId?: string, options: { renew?: boolean } = {}): void {
    openCreateCredentialModal(this, existingCredId, options);
  }

  /* ── Créer ou Modifier une Tâche ─────────────────────────────────────── */
  openCreateTaskModal(linkedCredentialId?: string, existingTaskId?: string): void {
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

  versionsContext(kind: 'credential' | 'task', id: string): VersionsContext {
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
    // Chargée à la première ouverture : l'application démarre sans elle
    void import('./ui/auditModal').then(m => m.openAuditModal(this)).catch(err => this.showToast(accountErrorMessage(err), 'error'));
  }

  /* ── Import & Export Hub ────────────────────────────────────────────────── */
  private openImportModal(): void {
    // Chargée à la première ouverture : l'application démarre sans elle
    void import('./ui/importExportModal').then(m => m.openImportExportModal(this, { accountService, sharedVaults })).catch(err => this.showToast(accountErrorMessage(err), 'error'));
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
    void accountService
      .resumeSession()
      .then(data => {
        if (data) this.showApp(data);
        else this.authScreen?.show();
      })
      .catch(() => this.authScreen?.show())
      // L'écran de lancement s'efface quand il y a vraiment quelque chose à voir
      .finally(() => hideSplash());
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
  renderAttachments(cred: CredentialItem): string {
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

  bindAttachments(container: HTMLElement, cred: CredentialItem): void {
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

  /**
   * Les fenêtres moins courantes ne sont pas dans le premier chargement. Une fois
   * l'application affichée, on les récupère en tâche de fond : elles s'ouvrent
   * aussitôt, et le service worker les garde pour le mode hors ligne.
   */
  private windowsPreloaded = false;
  private preloadWindows(): void {
    if (this.windowsPreloaded) return;
    this.windowsPreloaded = true;
    window.setTimeout(() => {
      for (const load of [
        () => import('./ui/accountModal'),
        () => import('./ui/importExportModal'),
        () => import('./ui/vaultModal'),
        () => import('./ui/auditModal'),
        () => import('./ui/eraseModal'),
        () => import('./ui/tagManagerModal'),
        () => import('./ui/shortcutsModal')
      ]) void load().catch(() => undefined);
    }, 4000);
  }

  private showApp(data: UnlockedVaultData): void {
    vaultStore.load(data);
    vaultStore.setPersistence(snapshot => void accountService.save(sharedVaults.split(snapshot)));
    void this.refreshSharedVaults();
    // Un compte synchronisé désigne son serveur : ses langues ajoutées deviennent disponibles
    this.refreshLanguages();
    this.purgeExpiredTrash();
    this.preloadWindows();
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
    /*
     * Toujours un visage : la photo du compte, sinon sa pastille colorée.
     * Menu replié, il ne restait qu'un point de 8 px dans une case vide — on
     * aurait dit un élément sélectionné sans contenu. L'état de la
     * synchronisation devient un badge posé sur ce visage.
     */
    const email = account?.email ?? '';
    const avatar = this.avatarSrc
      ? `<img class="sync-avatar" src="${this.escapeHtml(this.avatarSrc)}" alt="" referrerpolicy="no-referrer">`
      : email ? memberAvatarHtml(email, v => this.escapeHtml(v), { size: 22 }) : '';
    el.innerHTML = `${avatar}<span class="sync-dot" style="background-color:${colors[status]};"></span><span class="sync-label">${this.syncStatusLabel(status)}</span>`;
    const button = document.getElementById('btn-sync-status');
    if (button) button.title = [account?.email, state.message && translateError(state.message, i18n.getLocale())].filter(Boolean).join(' — ');
  }

  private openAccountModal(): void {
    // Chargée à la première ouverture : l'application démarre sans elle
    void import('./ui/accountModal').then(m => m.openAccountModal(this)).catch(err => this.showToast(accountErrorMessage(err), 'error'));
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
            <span>${store!.kind === 'keyring' ? tr('Ouverture rapide', 'Quick unlock') : tr('Déverrouillage biométrique', 'Biometric unlock')}<small>${store!.kind === 'keyring'
              ? tr(`Ouvrir le coffre avec ${store!.label}, sans retaper le mot de passe. Aucune biométrie n’est reliée sur ce système : une fois votre session ouverte, rien de plus n’est demandé.`,
                   `Open the vault with ${store!.label}, without retyping the password. No biometrics are wired on this system: once your session is open, nothing more is asked.`)
              : tr(`Ouvrir le coffre avec ${store!.label}. Le mot de passe principal reste utilisable.`, `Open the vault with ${store!.label}. The master password still works.`)}</small></span>
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
    // Chargée à la première ouverture : l'application démarre sans elle
    void import('./ui/eraseModal').then(m => m.openEraseModal(this)).catch(err => this.showToast(accountErrorMessage(err), 'error'));
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
    // Chargée à la première ouverture : l'application démarre sans elle
    void import('./ui/vaultModal').then(m => m.openVaultModal(this, vaultId)).catch(err => this.showToast(accountErrorMessage(err), 'error'));
  }

  /* ── Dossiers ────────────────────────────────────────────────────────── */




  /** Action « Annuler » d'une notification de suppression : l'élément revient de la corbeille */
  undoDelete(id: string): { label: string; run: () => void } {
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



  /* ── Tags ────────────────────────────────────────────────────────────── */
  private renderTagSidebar(): void {
    const list = document.getElementById('tag-list');
    if (!list) return;
    const data = vaultStore.getData();
    const tags = vaultStore.getTags();
    if (this.activeTag && !tags.some(t => t.name === this.activeTag)) this.activeTag = null;

    if (tags.length === 0) {
      list.innerHTML = `<li class="nav-empty">${this.tr('Aucun tag', 'No tags')}</li>`;
      list.appendChild(this.tagPickerEntry());
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
    list.appendChild(this.tagPickerEntry());
  }

  /**
   * Barre réduite : une seule entrée remplace la liste des tags. Elle ouvre un
   * petit sélecteur où l'on choisit un tag, ou en crée un nouveau.
   */
  private tagPickerEntry(): HTMLLIElement {
    const li = document.createElement('li');
    const label = this.activeTag
      ? this.tr(`Tag : ${this.activeTag}`, `Tag: ${this.activeTag}`)
      : this.tr('Choisir un tag', 'Pick a tag');
    const active = this.activeTag ? vaultStore.getTagByName(this.activeTag) : undefined;
    li.className = `nav-item tag-picker-entry ${this.activeTag ? 'active' : ''}`;
    li.tabIndex = 0;
    li.title = label;
    li.setAttribute('role', 'button');
    li.setAttribute('aria-haspopup', 'dialog');
    li.innerHTML = `
      <span class="nav-item-left">
        <span class="nav-item-icon"${active ? ` style="color:${tagColor(active.color)};"` : ''}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>
        </span>
        <span>${this.escapeHtml(label)}</span>
      </span>`;
    const open = () => this.openTagPicker(li);
    li.addEventListener('click', open);
    li.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
    return li;
  }

  /** Sélecteur de tags : recherche, choix, ou création d'un tag à la volée */
  private openTagPicker(anchor: HTMLElement): void {
    document.querySelector('.tag-picker-popover')?.remove();
    const pop = document.createElement('div');
    const placeholder = this.escapeHtml(this.tr('Chercher ou créer un tag', 'Search or create a tag'));
    pop.className = 'tag-picker-popover';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Tags');
    pop.innerHTML = `
      <input type="text" class="form-input tag-picker-search" placeholder="${placeholder}" aria-label="${placeholder}">
      <div class="tag-picker-options" role="listbox"></div>`;
    document.body.appendChild(pop);

    const input = pop.querySelector<HTMLInputElement>('.tag-picker-search')!;
    const options = pop.querySelector<HTMLElement>('.tag-picker-options')!;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      pop.style.left = `${Math.round(rect.right + 8)}px`;
      pop.style.top = `${Math.round(Math.max(8, Math.min(rect.top, window.innerHeight - pop.offsetHeight - 16)))}px`;
    };
    const outside = (e: MouseEvent) => {
      if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
    };
    const close = () => {
      pop.remove();
      document.removeEventListener('mousedown', outside, true);
    };
    const pick = (name: string | null) => {
      close();
      this.activeTag = name;
      this.selectedItemId = null;
      this.renderSidebar();
      this.renderList();
      this.renderDetail(null);
      document.querySelector<HTMLElement>('.tag-picker-entry')?.focus();
    };
    const render = () => {
      const query = input.value.trim();
      const key = query.toLowerCase();
      const tags = vaultStore.getTags().filter(t => !key || t.name.toLowerCase().includes(key));
      const rows = tags.map(tag => `
        <button type="button" class="tag-picker-option ${this.activeTag === tag.name ? 'active' : ''}" role="option" aria-selected="${this.activeTag === tag.name}" data-tag="${this.escapeHtml(tag.name)}">
          <span class="tag-dot" style="background-color:${tagColor(tag.color)};"></span>
          <span>${this.escapeHtml(tag.name)}</span>
        </button>`);
      if (this.activeTag && !key) {
        rows.unshift(`<button type="button" class="tag-picker-option" data-clear="1">${this.tr('Tous les éléments', 'All items')}</button>`);
      }
      if (query && !vaultStore.getTagByName(query)) {
        rows.push(`<button type="button" class="tag-picker-option tag-picker-create" data-create="1">+ ${this.escapeHtml(this.tr(`Créer « ${query} »`, `Create "${query}"`))}</button>`);
      }
      options.innerHTML = rows.join('') || `<div class="nav-empty">${this.tr('Aucun tag', 'No tags')}</div>`;
      place();
    };
    options.addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.tag-picker-option');
      if (!btn) return;
      if (btn.dataset.clear) return pick(null);
      if (btn.dataset.create) {
        try {
          const tag = vaultStore.createTag(input.value);
          this.showToast(this.tr(`Tag « ${tag.name} » créé`, `Tag "${tag.name}" created`), 'success');
          pick(tag.name);
        } catch (err) {
          this.showToast(accountErrorMessage(err), 'error');
        }
        return;
      }
      pick(this.activeTag === btn.dataset.tag ? null : btn.dataset.tag ?? null);
    });
    input.addEventListener('input', render);
    pop.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        anchor.focus();
      } else if (e.key === 'Enter' && e.target === input) {
        e.preventDefault();
        options.querySelector<HTMLButtonElement>('.tag-picker-option:not([data-clear])')?.click();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const all = [...options.querySelectorAll<HTMLButtonElement>('.tag-picker-option')];
        if (!all.length) return;
        e.preventDefault();
        const index = all.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === 'ArrowDown' ? Math.min(index + 1, all.length - 1) : index - 1;
        if (next < 0) input.focus(); else all[next].focus();
      }
    });
    render();
    document.addEventListener('mousedown', outside, true);
    input.focus();
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

  typeBadge(type: ItemType, templateId?: string): string {
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
  renderTypeDetail(cred: CredentialItem): string {
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
  itemSubtitle(cred: CredentialItem): string {
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
  safeHref(raw: string): string {
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

  renderTagChips(tags: string[]): string {
    if (!tags.length) return '';
    return `<div class="tag-chip-row">${tags.map(name => {
      const tag = vaultStore.getTagByName(name);
      return `<span class="tag-chip" style="--tag-color:${tagColor(tag?.color)}">${tag?.icon ? `<span class="tag-chip-icon">${renderItemIcon(tag.icon, 12)}</span>` : ''}<span>${this.escapeHtml(name)}</span></span>`;
    }).join('')}</div>`;
  }

  private openTagManagerModal(): void {
    // Chargée à la première ouverture : l'application démarre sans elle
    void import('./ui/tagManagerModal').then(m => m.openTagManagerModal(this)).catch(err => this.showToast(accountErrorMessage(err), 'error'));
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
    // Chargée à la première ouverture : l'application démarre sans elle
    void import('./ui/shortcutsModal').then(m => m.openShortcutsModal(this)).catch(err => this.showToast(accountErrorMessage(err), 'error'));
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

/*
 * Service worker (hors ligne) uniquement pour le site : l'app Tauri embarque
 * déjà ses fichiers.
 *
 * En développement, il est non seulement inutile mais nuisible : il resservait
 * ses fichiers en cache alors que la source venait de changer, et on débogue
 * une version qui n'existe plus. Un service worker déjà installé sur cette
 * adresse est donc retiré, pour ne pas rester coincé sur l'ancienne copie.
 */
if ('serviceWorker' in navigator && window.location.protocol.startsWith('http') && !isTauri()) {
  if (import.meta.env?.DEV) {
    void navigator.serviceWorker.getRegistrations()
      .then(list => Promise.all(list.map(registration => registration.unregister())))
      .catch(() => { /* rien à retirer */ });
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Ignorer si non servi sous HTTP/HTTPS (ex: tauri:// ou file://)
      });
    });
  }
}

