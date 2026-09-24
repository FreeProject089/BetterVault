import { learnMore } from '../ui/docsLink';
import type { AccountService } from '../account/accountService';
import type { SharedVaultManager } from '../account/sharedVaults';
import { GEN_ICONS, GENERIC_FILE_ICON } from './icons';
import { randomId, vaultStore } from '../store/vaultStore';
import type { CredentialItem, Task } from '../types/vault';
import { renderItemIcon } from '../icons/iconLibrary';
import BRAND_ICONS from 'virtual:bettervault-icons/brands';
import { exportVaultAsJson, exportVaultAsCsv, downloadExportFile } from '../import_export/importEngine';
import { parseImportData, PasswordRequiredError, ImportSecrets } from '../import_export/importRouter';
import { decryptExport, encryptExport, isEncryptedExport, MIN_EXPORT_PASSWORD_LENGTH } from '../import_export/encryptedExport';
import { applyImport, buildFullBackup, isFullBackup, planImport, type FullBackup, type ImportPlan, type ImportTarget } from '../import_export/fullBackup';
import { collectTwoFactor, exportAsUriList, exportAsJson as exportTwoFactorAsJson, exportAsQrSheet, parseTwoFactorImport, withoutKnown } from '../import_export/twoFactor';
import { buildKdbx4 } from '../import_export/keepass';
import { exportCredentialsAsCxf } from '../import_export/cxf';
import { decodeQrFromFile } from '../crypto/qrScanner';
import { localAttachmentBytes, MAX_LOCAL_ATTACHMENT_BYTES } from '../account/attachmentCrypto';
import { isTauri } from '../platform/tauriBridge';
import { accountErrorMessage } from '../ui/authScreen';
import { MANAGER_EXPORTS } from '../import_export/managerExports';
import { exportBitwardenEncrypted } from '../import_export/bitwardenEncrypted';
import { tabIcon } from '../ui/tabIcons';
import { checkCredential, remainingCapacity } from '../account/limits';
import { renderSVG } from 'uqr';
import { i18n } from '../i18n';

/**
 * Fenêtre « Importer / exporter » : sources d'import, formats d'export, sauvegarde
 * complète du compte. Extraite de main.ts ; elle ne dépend de l'application que
 * par les quelques services de fenêtre ci-dessous.
 */

export interface ModalHost {
  tr(fr: string, en: string): string;
  escapeHtml(value: string): string;
  openModal(html: string): HTMLElement;
  closeModal(): void;
  showToast(message: string, type?: 'success' | 'info' | 'error' | 'warning', durationMs?: number, action?: { label: string; run: () => void }): void;
  confirmDialog(options: { title: string; message: string; confirmLabel?: string; danger?: boolean; skippable?: boolean }): Promise<boolean>;
}

export interface ImportExportServices {
  accountService: AccountService;
  sharedVaults: SharedVaultManager;
}

const formatFileSize = (bytes: number) => i18n.formatBytes(bytes);

export function openImportExportModal(app: ModalHost, { accountService, sharedVaults }: ImportExportServices): void {
    const data = vaultStore.getData();
    const creds = data.credentials.filter(c => c.vaultId === data.activeVaultId);
    const tasks = data.tasks.filter(t => t.vaultId === data.activeVaultId);
    const limits = accountService.getLimits();
    const tr = (fr: string, en: string) => app.tr(fr, en);
    const activeVaultName = data.vaults.find(v => v.id === data.activeVaultId)?.name ?? 'BetterVault';
    const totpCount = creds.filter(c => c.totpSecret?.trim()).length;

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
      { id: 'twofactor', name: tr('Codes 2FA seuls', '2FA codes only'), logo: GEN_ICONS.qr, formats: 'otpauth:// · QR · JSON', accept: '.txt,.json,.png,.jpg,.jpeg,.webp', steps: [tr('Collez des URI otpauth://, ou déposez une capture de QR code', 'Paste otpauth:// URIs, or drop a screenshot of a QR code'), tr('Aegis, 2FAS, Bitwarden, KeePassXC exportent ce format', 'Aegis, 2FAS, Bitwarden and KeePassXC export this format')] },
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

    const box = app.openModal(`
      <div class="modal-header">
        <div class="modal-title">${i18n.t.importExport.title}</div>
        <button class="modal-close">${GEN_ICONS.close}</button>
      </div>
      <div class="modal-body">
        <div class="tab-btn-group segmented" role="tablist">
          <button type="button" class="tab-btn active" role="tab" data-tab="import" aria-selected="true">${tabIcon('import')}<span>${tr('Importer', 'Import')}</span></button>
          <button type="button" class="tab-btn" role="tab" data-tab="export" aria-selected="false">${tabIcon('export')}<span>${tr('Exporter', 'Export')}</span></button>
        </div>

        <div data-panel="import">
          <div data-step="sources">
            <p class="modal-text" style="margin-bottom:10px;">${tr('D’où viennent vos identifiants ?', 'Where are your credentials coming from?')}${learnMore('guide/import-export', tr)}</p>
            <div class="ie-sources">
              ${sources.map(source => `
                <button type="button" class="ie-source" data-source="${source.id}">
                  <span class="ie-logo">${source.logo}</span>
                  <span>${app.escapeHtml(source.name)}</span>
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
            <div class="form-field" data-totp-paste hidden>
              <label class="form-label" for="import-totp-text">${tr('Coller des URI otpauth:// ou un JSON', 'Paste otpauth:// URIs or JSON')}</label>
              <textarea class="form-input" id="import-totp-text" rows="5" spellcheck="false" autocomplete="off"
                style="font-family:var(--font-mono);font-size:12px;resize:vertical;"
                placeholder="otpauth://totp/GitHub:moi?secret=..."></textarea>
              <span class="field-hint">${tr('Un secret par ligne. Une capture de QR code déposée ci-dessus fonctionne aussi.', 'One secret per line. A screenshot of a QR code dropped above works too.')}</span>
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

        <div data-panel="export" hidden class="ie-export-panel">
          <div class="ie-export-summary">
            <span class="ie-logo">${bvLogo}</span>
            <div class="ie-export-summary-text">
              <div class="ie-export-summary-title">${app.escapeHtml(activeVaultName)}</div>
              <div class="ie-export-counts">
                <span><b>${creds.length}</b> ${tr(`identifiant${creds.length > 1 ? 's' : ''}`, `credential${creds.length === 1 ? '' : 's'}`)}</span>
                <span><b>${tasks.length}</b> ${tr(`tâche${tasks.length > 1 ? 's' : ''}`, `task${tasks.length === 1 ? '' : 's'}`)}</span>
                <span><b>${totpCount}</b> ${tr(`code${totpCount > 1 ? 's' : ''} 2FA`, `2FA code${totpCount === 1 ? '' : 's'}`)}</span>
              </div>
            </div>
          </div>

          <div class="ie-export-kinds" role="tablist" aria-label="${tr('Type d’export', 'Export type')}">
            <button type="button" role="tab" class="ie-kind active" data-kind="safe" aria-selected="true"><span class="ie-kind-dot ie-kind-safe"></span>${tr('Chiffré', 'Encrypted')}</button>
            <button type="button" role="tab" class="ie-kind" data-kind="plain" aria-selected="false"><span class="ie-kind-dot ie-kind-plain"></span>${tr('En clair', 'Plain text')}</button>
            <button type="button" role="tab" class="ie-kind" data-kind="totp" aria-selected="false">${tr('Codes 2FA', '2FA codes')}</button>
            <button type="button" role="tab" class="ie-kind" data-kind="apps" aria-selected="false">${tr('Autres apps', 'Other apps')}</button>
          </div>

          <section class="ie-export-group" data-group="safe">
            <p class="ie-group-lead">${tr('Le fichier reste illisible sans le mot de passe que vous choisissez. À privilégier pour une sauvegarde.', 'The file stays unreadable without the password you choose. The right choice for a backup.')}</p>
            <div class="ie-export-list">
              ${exportItem('encrypted', bvLogo, tr('BetterVault chiffré', 'Encrypted BetterVault'), tr('Ce coffre, protégé par un mot de passe dédié · Argon2id et AES-256-GCM', 'This vault, protected by a dedicated password · Argon2id and AES-256-GCM'), { label: tr('Recommandé', 'Recommended'), safe: true })}
              ${exportItem('full', bvLogo, tr('Tout le compte, fichiers compris', 'The whole account, files included'), tr('Tous les coffres et pièces jointes, chiffrés · pour changer de compte ou de serveur', 'Every vault and attachment, encrypted · to move to another account or server'))}
              ${exportItem('kdbx', brand('keepassxc'), tr('Base KeePass (.kdbx)', 'KeePass database (.kdbx)'), tr('Chiffrée · KeePass, KeePassXC, Strongbox', 'Encrypted · KeePass, KeePassXC, Strongbox'))}
              ${exportItem('bitwarden-encrypted', brand('bitwarden'), tr('Bitwarden chiffré (JSON)', 'Encrypted Bitwarden (JSON)'), tr('Protégé par mot de passe · Bitwarden, Vaultwarden · PBKDF2 et AES-256', 'Password protected · Bitwarden, Vaultwarden · PBKDF2 and AES-256'))}
            </div>
            <div id="export-password-panel" class="form-section ie-export-password" hidden>
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
          </section>

          <section class="ie-export-group" data-group="plain" hidden>
            <div class="notice notice-warning">${tr('Ces fichiers contiennent vos mots de passe en clair. Supprimez-les dès qu’ils ne servent plus.', 'These files contain your passwords in plain text. Delete them once you no longer need them.')}</div>
            <div class="ie-export-list">
              ${exportItem('cxf', brand('fidoalliance'), 'FIDO CXF', tr('Format d’échange standard, passkeys comprises', 'Standard exchange format, passkeys included'))}
              ${exportItem('json', bvLogo, 'JSON BetterVault', tr('Tout le contenu du coffre, tâches comprises', 'Everything in the vault, tasks included'))}
              ${exportItem('csv', brand('bitwarden'), 'CSV', tr('Compatible Bitwarden, Chrome, Firefox et tableurs', 'Works with Bitwarden, Chrome, Firefox and spreadsheets'))}
            </div>
          </section>

          <section class="ie-export-group" data-group="totp" hidden>
            <p class="ie-group-lead">${tr('Format otpauth://, lu par Aegis, 2FAS, Bitwarden, KeePassXC… Non chiffré.', 'otpauth:// format, read by Aegis, 2FAS, Bitwarden, KeePassXC… Not encrypted.')}</p>
            <div class="ie-export-list">
              ${exportItem('totp-qr', GEN_ICONS.qr, tr('Planche de QR codes', 'Sheet of QR codes'), tr('À imprimer ou à rescanner depuis un téléphone', 'To print, or to rescan from a phone'))}
              ${exportItem('totp-uri', GENERIC_FILE_ICON, tr('Liste otpauth:// (.txt)', 'otpauth:// list (.txt)'), tr('Une URI par ligne', 'One URI per line'))}
              ${exportItem('totp-json', bvLogo, tr('JSON des codes 2FA', '2FA codes as JSON'), tr('Avec le nom et l’émetteur de chaque code', 'With each code’s name and issuer'))}
            </div>
          </section>

          <section class="ie-export-group" data-group="apps" hidden>
            <p class="ie-group-lead">${tr('Fichier au format attendu par l’import de chaque application. Non chiffré.', 'File in the format each app expects on import. Not encrypted.')}</p>
            <div class="ie-export-list ie-export-grid">
              ${MANAGER_EXPORTS.map(format => exportItem(`manager:${format.id}`, format.logo ? brand(format.logo) : GENERIC_FILE_ICON,
                format.id === 'apple' ? tr('Mots de passe Apple (CSV)', 'Apple Passwords (CSV)') : format.name,
                format.extension.toUpperCase())).join('')}
            </div>
          </section>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-primary" data-close>${i18n.t.common.close}</button>
        <button class="btn-primary" id="modal-import-confirm" disabled>${tr('Importer', 'Import')}</button>
      </div>
    `);

    const $ = <T extends HTMLElement>(selector: string) => box.querySelector(selector) as T;
    const confirmBtn = $<HTMLButtonElement>('#modal-import-confirm');

    // Export : une famille de formats à la fois
    box.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(kind => {
      kind.addEventListener('click', () => {
        box.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(k => {
          k.classList.toggle('active', k === kind);
          k.setAttribute('aria-selected', String(k === kind));
        });
        box.querySelectorAll<HTMLElement>('[data-group]').forEach(group => { group.hidden = group.dataset.group !== kind.dataset.kind; });
      });
    });

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
    const confirmPlaintextExport = () => app.confirmDialog({
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
    let protectedExportMode: 'encrypted' | 'kdbx' | 'full' | 'bitwarden-encrypted' = 'encrypted';

    const setExportStatus = (text: string, error = false) => {
      exportStatus.textContent = text;
      exportStatus.classList.toggle('error', error);
    };

    box.querySelectorAll<HTMLButtonElement>('[data-export]').forEach(button => {
      button.addEventListener('click', async () => {
        const kind = button.dataset.export;
        if (kind === 'encrypted' || kind === 'kdbx' || kind === 'full' || kind === 'bitwarden-encrypted') {
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
            : kind === 'full'
              ? tr('Mot de passe de la sauvegarde complète', 'Full backup password')
              : kind === 'bitwarden-encrypted'
                ? tr('Mot de passe du fichier Bitwarden', 'Bitwarden file password')
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
        if (kind === 'totp-uri' || kind === 'totp-json' || kind === 'totp-qr') {
          const entries = collectTwoFactor(creds);
          if (!entries.length) {
            app.showToast(tr('Aucun code 2FA dans ce coffre', 'No 2FA code in this vault'), 'error');
            return;
          }
          if (kind === 'totp-uri') downloadExportFile(exportAsUriList(entries), `bettervault-2fa-${exportDate}.txt`, 'text/plain;charset=utf-8');
          if (kind === 'totp-json') downloadExportFile(exportTwoFactorAsJson(entries), `bettervault-2fa-${exportDate}.json`, 'application/json');
          if (kind === 'totp-qr') {
            downloadExportFile(
              exportAsQrSheet(entries, uri => renderSVG(uri, { border: 1 }), {
                title: tr('Codes 2FA BetterVault', 'BetterVault 2FA codes'),
                warning: tr('Chaque QR code donne le second facteur d’un compte. Traitez cette page comme un mot de passe : ne la laissez pas traîner, et détruisez-la après usage.',
                            'Each QR code gives away one account’s second factor. Treat this page like a password: don’t leave it lying around, and destroy it after use.'),
                empty: tr('Aucun code 2FA dans ce coffre.', 'No 2FA code in this vault.')
              }),
              `bettervault-2fa-${exportDate}.html`,
              'text/html;charset=utf-8'
            );
          }
          if (!isTauri()) app.showToast(tr('Fichier enregistré dans vos téléchargements', 'File saved to your downloads'), 'success');
          return;
        }
        if (kind === 'cxf') downloadExportFile(exportCredentialsAsCxf(creds), `bettervault-${exportDate}.cxf.json`, 'application/json');
        if (kind === 'json') downloadExportFile(exportVaultAsJson(creds, tasks), `bettervault-${exportDate}.json`, 'application/json');
        if (kind === 'csv') downloadExportFile(exportVaultAsCsv(creds), `bettervault-${exportDate}.csv`, 'text/csv;charset=utf-8;');
        if (!isTauri()) app.showToast(tr('Fichier enregistré dans vos téléchargements', 'File saved to your downloads'), 'success');
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
        } else if (protectedExportMode === 'full') {
          // Les fichiers restent chiffrés avec leur propre clé ; le tout est chiffré une seconde fois par ce mot de passe
          const { backup, problems } = await buildFullBackup(vaultStore.getData(), {
            canExport: vault => sharedVaults.can(vault.id, 'export'),
            fetchPayload: meta => accountService.withCloud(client => client.downloadAttachment(meta.id)),
            onProgress: (done, total) => setExportStatus(tr(`Fichiers : ${done} / ${total}`, `Files: ${done} / ${total}`))
          });
          setExportStatus(tr('Chiffrement…', 'Encrypting…'));
          const file = await encryptExport(JSON.stringify(backup), exportPwd.value);
          downloadExportFile(file, `bettervault-complet-${exportDate}.encrypted.json`, 'application/json');
          if (problems.length) {
            const vaultsDenied = problems.filter(p => p.vault).map(p => p.vault as string);
            const filesLost = problems.filter(p => p.file).length;
            app.showToast([
              vaultsDenied.length ? tr(`Coffres partagés non exportés (votre rôle ne le permet pas) : ${vaultsDenied.join(', ')}`, `Shared vaults not exported (your role does not allow it): ${vaultsDenied.join(', ')}`) : '',
              filesLost ? tr(`${filesLost} fichier(s) illisible(s) sur le serveur, non inclus`, `${filesLost} file(s) unreadable on the server, not included`) : ''
            ].filter(Boolean).join(' · '), 'error', 8000);
          }
        } else if (protectedExportMode === 'bitwarden-encrypted') {
          // Bitwarden redemande ce mot de passe à l'import (Importer › JSON Bitwarden)
          const file = await exportBitwardenEncrypted(creds, exportPwd.value);
          downloadExportFile(file, `bettervault-bitwarden-${exportDate}.encrypted.json`, 'application/json');
        } else {
          const kdbx = await buildKdbx4(creds, exportPwd.value, { databaseName: activeVaultName });
          downloadExportFile(kdbx, `bettervault-${exportDate}.kdbx`, 'application/octet-stream');
        }
        exportPwd.value = '';
        exportPwdConfirm.value = '';
        exportPanel.hidden = true;
        box.querySelectorAll('[data-export]').forEach(b => b.setAttribute('aria-expanded', 'false'));
        if (!isTauri()) app.showToast(tr('Export chiffré enregistré', 'Encrypted export saved'), 'success');
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
    /** Sauvegarde complète prête à importer, avec ce qui tiendra sur ce compte */
    let fullReady: { backup: FullBackup; plan: ImportPlan } | null = null;
    let ready: { credentials: Partial<CredentialItem>[]; tasks: Partial<Task>[] } | null = null;
    /** Vrai quand la source choisie est « Codes 2FA seuls » : la lecture ne passe pas par les formats habituels */
    let sourceTotp = false;
    const totpPaste = $<HTMLElement>('[data-totp-paste]');
    const totpText = $<HTMLTextAreaElement>('#import-totp-text');

    /**
     * Transforme des secrets 2FA en identifiants à créer.
     *
     * Chaque code devient un identifiant à part, sans mot de passe : c'est ce que
     * l'on veut quand on importe depuis une application d'authentification, où le
     * compte n'existe que par son second facteur. Rattacher le code à un identifiant
     * existant demanderait de deviner lequel, et se tromper mettrait le mauvais code
     * sur le mauvais compte.
     */
    const lireCodes = (texte: string) => {
      const { entries, rejected } = parseTwoFactorImport(texte);
      const nouveaux = withoutKnown(entries, vaultStore.getData().credentials);
      const doublons = entries.length - nouveaux.length;

      if (!nouveaux.length) {
        ready = null;
        confirmBtn.disabled = true;
        setStatus(`<div class="notice notice-warning">${entries.length
          ? tr(`Ces ${entries.length} code(s) sont déjà dans le coffre.`, `These ${entries.length} code(s) are already in the vault.`)
          : tr('Aucun code 2FA reconnu.', 'No 2FA code recognised.')}${rejected.length
          ? ` ${tr(`${rejected.length} ligne(s) non reconnue(s).`, `${rejected.length} line(s) not recognised.`)}` : ''}</div>`);
        return;
      }

      ready = {
        credentials: nouveaux.map(entry => ({
          title: entry.title,
          username: entry.account || undefined,
          totpSecret: entry.secret,
          vaultId: vaultStore.getData().activeVaultId,
          tags: []
        })),
        tasks: []
      };
      confirmBtn.disabled = false;
      setStatus(`
        <div class="notice notice-success"><strong>${tr('Prêt à importer', 'Ready to import')}</strong> · ${tr(`${nouveaux.length} code(s) 2FA`, `${nouveaux.length} 2FA code(s)`)}</div>
        ${doublons ? `<div class="notice notice-warning" style="margin-top:8px;">${tr(`${doublons} code(s) déjà présent(s), ignoré(s).`, `${doublons} code(s) already present, skipped.`)}</div>` : ''}
        ${rejected.length ? `<div class="notice notice-warning" style="margin-top:8px;">${tr(`${rejected.length} ligne(s) non reconnue(s) : ${app.escapeHtml(rejected.slice(0, 3).join(', '))}`, `${rejected.length} line(s) not recognised: ${app.escapeHtml(rejected.slice(0, 3).join(', '))}`)}</div>` : ''}`);
    };

    totpText?.addEventListener('input', () => lireCodes(totpText.value));

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
        $<HTMLElement>('[data-selected-steps]').innerHTML = source.steps.map(step => `<li>${app.escapeHtml(step)}</li>`).join('');
        fileInput.accept = source.accept;
        sourcesStep.hidden = true;
        fileStep.hidden = false;
        secretPanel.hidden = true;
        sourceTotp = source.id === 'twofactor';
        totpPaste.hidden = !sourceTotp;
        if (totpText) totpText.value = '';
        setStatus('');
        if (sourceTotp) totpText?.focus();
        else $<HTMLElement>('#drop-zone').focus();
      });
    });
    $<HTMLButtonElement>('[data-action="change-source"]').addEventListener('click', showSources);

    /** Ce compte peut-il recevoir la sauvegarde ? Calculé d'après ce que le serveur annonce */
    const importTarget = async (): Promise<ImportTarget> => {
      const cloud = accountService.isCloud();
      const usage = cloud ? await accountService.getAttachmentUsage().catch(() => null) : null;
      const limits = accountService.getLimits();
      const data = vaultStore.getData();
      const inlineUsed = data.credentials.reduce((total, c) => total + localAttachmentBytes(c.attachments), 0);
      return {
        serverFiles: !!usage?.enabled,
        maxFileBytes: usage?.maxFileBytes ?? 0,
        freeBytes: usage ? Math.max(0, usage.quotaBytes - usage.usedBytes) : 0,
        inlineMaxBytes: MAX_LOCAL_ATTACHMENT_BYTES,
        inlineBudgetBytes: Math.max(0, Math.floor(limits.maxVaultBytes / 2) - inlineUsed),
        vaultSlots: limits.maxVaults - data.vaults.length
      };
    };

    const showFullPlan = async (backup: FullBackup) => {
      const plan = planImport(backup, await importTarget());
      const limits = accountService.getLimits();
      const mb = (bytes: number) => formatFileSize(bytes);
      const inlineBytes = plan.files.filter(f => f.destination === 'vault').reduce((n, f) => n + Math.ceil(f.bytes * 4 / 3), 0);
      const { files: _files, ...withoutFiles } = backup;
      const projected = JSON.stringify(vaultStore.getData()).length + JSON.stringify(withoutFiles.data).length + inlineBytes;
      const refused = plan.files.filter(f => f.destination === 'refused');
      const byReason = (reason: string) => refused.filter(f => f.reason === reason);
      const origin = backup.source?.server ? ` · ${app.escapeHtml(backup.source.server)}` : '';

      const summary = `<div class="notice ${plan.complete ? 'notice-success' : 'notice-warning'}">
        <strong>${tr('Sauvegarde complète', 'Full backup')}</strong> ${tr('du', 'from')} ${app.escapeHtml(new Date(backup.exportedAt).toLocaleString(app.tr('fr-FR', 'en-GB')))}${origin}<br>
        ${tr(`${plan.vaults} coffre(s), ${plan.credentials} identifiant(s), ${plan.tasks} tâche(s), ${plan.files.length} fichier(s)`, `${plan.vaults} vault(s), ${plan.credentials} credential(s), ${plan.tasks} task(s), ${plan.files.length} file(s)`)}
      </div>`;

      if (projected > limits.maxVaultBytes) {
        fullReady = null;
        confirmBtn.disabled = true;
        setStatus(`${summary}<div class="notice notice-danger" style="margin-top:8px;"><strong>${tr('Trop volumineux pour ce compte', 'Too large for this account')}</strong> · ${tr(
          `le coffre ferait environ ${mb(projected)}, la limite de ce compte est ${mb(limits.maxVaultBytes)}. Passez à une offre supérieure, videz la corbeille ou importez dans un compte vide.`,
          `the vault would be about ${mb(projected)}, this account’s limit is ${mb(limits.maxVaultBytes)}. Upgrade your plan, empty the trash or import into an empty account.`)}</div>`);
        return;
      }

      const lines: string[] = [];
      if (plan.vaultsOverLimit) lines.push(tr(`${plan.vaultsOverLimit} coffre(s) de trop : ce compte en accepte ${limits.maxVaults}. Les derniers ne seront pas créés.`, `${plan.vaultsOverLimit} vault(s) too many: this account accepts ${limits.maxVaults}. The last ones will not be created.`));
      if (byReason('no_files').length) lines.push(tr(`${byReason('no_files').length} fichier(s) : ce serveur ne garde pas de fichiers, et ils dépassent ${mb(MAX_LOCAL_ATTACHMENT_BYTES)} pour tenir dans le coffre.`, `${byReason('no_files').length} file(s): this server keeps no files, and they exceed ${mb(MAX_LOCAL_ATTACHMENT_BYTES)} to fit in the vault.`));
      if (byReason('too_large').length) lines.push(tr(`${byReason('too_large').length} fichier(s) dépassent la taille maximale de ce serveur.`, `${byReason('too_large').length} file(s) exceed this server’s maximum size.`));
      if (byReason('no_space').length) lines.push(plan.availableServerBytes || accountService.isCloud()
        ? tr(`${byReason('no_space').length} fichier(s) sans place : ${mb(plan.requiredServerBytes)} requis, ${mb(plan.availableServerBytes)} disponibles.`, `${byReason('no_space').length} file(s) without room: ${mb(plan.requiredServerBytes)} required, ${mb(plan.availableServerBytes)} available.`)
        : tr(`${byReason('no_space').length} fichier(s) ne tiennent plus dans le coffre.`, `${byReason('no_space').length} file(s) no longer fit in the vault.`));

      const where = plan.files.filter(f => f.destination !== 'refused');
      fullReady = { backup, plan };
      confirmBtn.disabled = false;
      setStatus(`${summary}
        ${where.length ? `<p class="field-hint" style="margin-top:8px;">${tr(`${where.length} fichier(s) seront ${plan.files.some(f => f.destination === 'server') ? 'envoyés chiffrés sur le serveur' : 'gardés dans le coffre chiffré'}.`, `${where.length} file(s) will be ${plan.files.some(f => f.destination === 'server') ? 'uploaded encrypted to the server' : 'kept inside the encrypted vault'}.`)}</p>` : ''}
        ${lines.length ? `<div class="notice notice-warning" style="margin-top:8px;">
          <strong>${tr('Tout ne tiendra pas', 'Not everything will fit')}</strong>
          <ul style="margin:6px 0 6px 18px;">${lines.map(l => `<li>${l}</li>`).join('')}</ul>
          ${tr('Vous pouvez importer sans ce qui dépasse : rien n’est perdu, tout reste dans le fichier.',
               'You can import without what doesn’t fit: nothing is lost, it all stays in the file.')}${learnMore('guide/switching-server', tr)}
        </div>` : ''}
        <p class="field-hint" style="margin-top:8px;">${tr('Tout est ajouté à côté de ce que contient déjà ce compte : rien n’est remplacé.', 'Everything is added next to what this account already holds: nothing is replaced.')}</p>`);
      confirmBtn.focus();
    };

    /** Reconnaît une sauvegarde complète, chiffrée ou non ; null si le fichier est d'un autre type */
    const readFullBackup = async (bytes: Uint8Array, password?: string): Promise<FullBackup | 'password' | null> => {
      let json: unknown;
      try {
        json = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return null;
      }
      if (isFullBackup(json)) return json;
      if (!isEncryptedExport(json)) return null;
      if (!password) return 'password';
      try {
        const inner = JSON.parse(await decryptExport(json, password));
        return isFullBackup(inner) ? inner : null;
      } catch {
        return null;
      }
    };

    const tryParse = async (secrets?: ImportSecrets) => {
      if (!pendingFile) return;
      confirmBtn.disabled = true;
      ready = null;
      fullReady = null;
      const full = await readFullBackup(pendingFile.bytes, secrets?.password);
      if (full && full !== 'password') {
        secretPanel.hidden = true;
        secretPwd.value = '';
        await showFullPlan(full);
        return;
      }
      if (secrets) setStatus(`<div class="field-hint">${tr('Déchiffrement…', 'Decrypting…')}</div>`);
      try {
        const parsed = await parseImportData(pendingFile.bytes, pendingFile.name, secrets);
        secretPanel.hidden = true;
        secretPwd.value = '';

        const valid = parsed.credentials.filter(c => !checkCredential(c, limits, tr));
        const skipped = parsed.credentials.length - valid.length;
        const capacity = remainingCapacity(vaultStore.getData(), vaultStore.getData().activeVaultId, limits);
        const file = app.escapeHtml(pendingFile.name);

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
          <div class="notice notice-success"><strong>${tr('Prêt à importer', 'Ready to import')}</strong> · ${parts.join(tr(' et ', ' and '))} (${file}, ${app.escapeHtml(parsed.sourceFormat)})</div>
          ${skipped ? `<div class="notice notice-warning" style="margin-top:8px;">${tr(`${skipped} élément${skipped > 1 ? 's' : ''} dépasse${skipped > 1 ? 'nt' : ''} les limites du coffre et ne ser${skipped > 1 ? 'ont' : 'a'} pas importé${skipped > 1 ? 's' : ''}.`, `${skipped} item${skipped === 1 ? '' : 's'} exceed the vault limits and will be skipped.`)}</div>` : ''}`);
        confirmBtn.disabled = false;
        confirmBtn.focus();
      } catch (err) {
        if (err instanceof PasswordRequiredError) {
          secretPanel.hidden = false;
          keyFileRow.hidden = err.kind !== 'kdbx';
          secretLabel.textContent = err.kind === 'kdbx'
            ? tr('Mot de passe de la base KeePass', 'KeePass database password')
            : err.kind === 'bitwarden-encrypted'
              ? tr('Mot de passe de l’export Bitwarden', 'Bitwarden export password')
              : tr('Mot de passe de l’export chiffré', 'Encrypted export password');
          setStatus(secrets ? `<div class="notice notice-danger">${app.escapeHtml(err.message)}</div>` : '');
          secretPwd.focus();
          return;
        }
        setStatus(`<div class="notice notice-danger"><strong>${tr('Fichier illisible', 'Unreadable file')}</strong> · ${app.escapeHtml(accountErrorMessage(err))}</div>`);
      }
    };

    const handleFile = async (file: File) => {
      /*
       * Les codes 2FA ne passent pas par les lecteurs de formats habituels : ce
       * qu'on reçoit est soit du texte (URI ou JSON), soit l'image d'un QR code —
       * une capture d'écran de la page qui l'affichait, le cas le plus courant.
       */
      if (sourceTotp) {
        if (/^image\//.test(file.type) || /\.(png|jpe?g|webp|gif|avif)$/i.test(file.name)) {
          const uri = await decodeQrFromFile(file);
          if (!uri) {
            setStatus(`<div class="notice notice-warning">${tr('Aucun QR code lisible dans cette image.', 'No readable QR code in this image.')}</div>`);
            return;
          }
          if (totpText) totpText.value = totpText.value ? `${totpText.value.trimEnd()}
${uri}` : uri;
          lireCodes(totpText?.value ?? uri);
          return;
        }
        const texte = await file.text();
        if (totpText) totpText.value = texte;
        lireCodes(texte);
        return;
      }

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

    confirmBtn.addEventListener('click', async () => {
      if (fullReady) {
        const { backup, plan } = fullReady;
        confirmBtn.disabled = true;
        try {
          const result = await applyImport(backup, plan, vaultStore.getData(), {
            // Un envoi qui échoue est retenté : une coupure brève ne fait pas perdre le fichier
            upload: async payload => {
              for (let attempt = 1; ; attempt++) {
                try {
                  return await accountService.withCloud(client => client.uploadAttachment(payload));
                } catch (err) {
                  if (attempt >= 3) throw err;
                  await new Promise(resolve => setTimeout(resolve, attempt * 1500));
                }
              }
            },
            discard: id => accountService.withCloud(client => client.deleteAttachment(id)),
            newId: prefix => randomId(prefix),
            importedSuffix: tr('(importé)', '(imported)'),
            onProgress: (done, total) => setStatus(`<div class="field-hint">${tr(`Envoi des fichiers : ${done} / ${total}`, `Uploading files: ${done} / ${total}`)}</div>`)
          });
          vaultStore.adoptImport(result.data);
          pendingFile?.bytes.fill(0);
          pendingFile = null;
          fullReady = null;
          app.closeModal();
          const skipped = result.skippedFiles.length + result.skippedVaults.length;
          app.showToast(tr(
            `Importé : ${result.imported.vaults} coffre(s), ${result.imported.credentials} identifiant(s), ${result.imported.files} fichier(s)${skipped ? ` · ${skipped} élément(s) laissé(s) dans la sauvegarde` : ''}`,
            `Imported: ${result.imported.vaults} vault(s), ${result.imported.credentials} credential(s), ${result.imported.files} file(s)${skipped ? ` · ${skipped} item(s) left in the backup` : ''}`), 'success', 6000);
        } catch (err) {
          // Rien n'est enregistré tant que tout n'est pas passé : on peut relancer sans doublon dans le coffre
          setStatus(`<div class="notice notice-danger"><strong>${tr('Import interrompu', 'Import interrupted')}</strong> · ${app.escapeHtml(accountErrorMessage(err))}. ${tr('Le coffre n’a pas été modifié ; relancez l’import quand la connexion revient.', 'The vault was not changed; run the import again once the connection is back.')}</div>`);
          confirmBtn.disabled = false;
        }
        return;
      }
      if (!ready) return;
      const result = vaultStore.importBulk(ready.credentials, ready.tasks);
      pendingFile?.bytes.fill(0);
      pendingFile = null;
      app.closeModal();
      app.showToast(tr(`${result.credentials} identifiant${result.credentials > 1 ? 's' : ''} importé${result.credentials > 1 ? 's' : ''}`, `${result.credentials} credential${result.credentials === 1 ? '' : 's'} imported`), 'success');
    });
}
