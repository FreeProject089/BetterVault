import { i18n } from '../i18n';
import { vaultStore } from '../store/vaultStore';
import { extractDomain } from '../icons/serviceIcons';
import { type ItemIcon } from '../icons/iconLibrary';
import { generateTOTP } from '../crypto/totpEngine';
import { calculatePasswordEntropy } from '../crypto/vaultCrypto';
import { normalizeTotpInput, parseOtpAuthUri } from '../crypto/otpauthUri';
import { CameraQrScanner, decodeQrFromFile } from '../crypto/qrScanner';
import { formatLimit, MAX_LOCAL_ATTACHMENT_BYTES } from '../account/attachmentCrypto';
import { accountErrorMessage } from '../ui/authScreen';
import { mountTagInput } from '../ui/tagInput';
import { mountIconPicker } from '../ui/iconPicker';
import { mountDateField } from '../ui/dateField';
import { tabIcon } from '../ui/tabIcons';
import { mountStepper, type StepDef } from '../ui/stepper';
import { ACTION_ICONS, GEN_ICONS } from '../ui/icons';
import { readTemplateValues, templateCardsHtml, templateFieldsHtml } from '../ui/itemTemplatesUi';
import { checkTemplateValues, mergeTemplateFields } from '../store/itemTemplates';
import { cardBrand, formatCardNumber, isLuhnValid, isFileType, itemTypeOf, looksLikePrivateKey, ITEM_TYPES, ITEM_TYPE_INFO, type ItemType } from '../types/itemTypes';
import { checkCredential, remainingCapacity } from '../account/limits';
import type { AppController } from '../main';

const formatFileSize = (bytes: number) => i18n.formatBytes(bytes);
import { accountService } from '../app/services';

/** Création ou modification d'un élément du coffre */
export function openCreateCredentialModal(app: AppController, existingCredId?: string, options: { renew?: boolean } = {}): void {
  const data = vaultStore.getData();
  const existing = existingCredId ? data.credentials.find(c => c.id === existingCredId) : null;
  const isEdit = !!existing;
  const limits = accountService.getLimits();
  const tr = (fr: string, en: string) => app.tr(fr, en);
  const attr = (value?: string) => app.escapeHtml(value ?? '');
  if (!app.canEdit(existing?.vaultId ?? data.activeVaultId)) return;

  if (!isEdit && remainingCapacity(data, data.activeVaultId, limits).credentials === 0) {
    app.showToast(tr(`Ce coffre contient déjà ${limits.maxCredentialsPerVault} identifiants, la limite du serveur`, `This vault already holds ${limits.maxCredentialsPerVault} credentials, the server limit`), 'error');
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

  const box = app.openModal(`
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

        <section class="form-section" id="section-template" hidden></section>

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
          <div class="id-scans" role="group" aria-label="${tr('Scan de la pièce', 'Document scan')}">
            ${(['front', 'back'] as const).map(side => `
              <label class="id-scan" data-scan="${side}" tabindex="0">
                <input type="file" accept="image/*,application/pdf" capture="environment" hidden data-scan-input="${side}">
                <span class="id-scan-title">${side === 'front' ? tr('Recto', 'Front') : tr('Verso', 'Back')}</span>
                <span class="id-scan-state" data-scan-state="${side}"></span>
              </label>`).join('')}
          </div>
          <p class="field-hint">${tr('Photo ou PDF, chiffré sur cet appareil avant l’envoi.', 'Photo or PDF, encrypted on app device before upload.')}</p>
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
          <label class="switch-row">
            <span>${tr('Favori', 'Favorite')}<small>${tr('Affiché en haut de la liste', 'Shown at the top of the list')}</small></span>
            <input type="checkbox" class="switch" id="field-favorite" ${existing?.isFavorite ? 'checked' : ''}>
          </label>
          <div class="form-field" id="attachments-field">
            <label class="form-label" id="attachments-label">${tr('Pièces jointes', 'Attachments')}</label>
            <div class="pending-files" id="field-files"></div>
            <label class="btn-primary btn-ghost" style="align-self:flex-start;cursor:pointer;">+ ${tr('Ajouter un fichier', 'Add a file')}<input type="file" id="field-files-input" multiple hidden></label>
            <span class="field-hint">${accountService.isCloud()
              ? tr('Chiffrés sur cet appareil, puis envoyés à votre serveur.', 'Encrypted on app device, then uploaded to your server.')
              : tr(`Chiffrés et gardés dans le coffre, sur cet appareil. ${formatLimit(MAX_LOCAL_ATTACHMENT_BYTES, 'fr')} par fichier ; la synchronisation lève cette limite.`,
                   `Encrypted and kept inside the vault, on app device. ${formatLimit(MAX_LOCAL_ATTACHMENT_BYTES, 'en')} per file; syncing lifts that limit.`)}</span>
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
  const templates = vaultStore.getTemplates();
  let template = existing?.templateId ? templates.find(t => t.id === existing.templateId) : undefined;

  const typeGrid = $<HTMLElement>('#cred-type-grid');
  const renderTypeGrid = () => {
    typeGrid.innerHTML = ITEM_TYPES.map(type => {
      const info = ITEM_TYPE_INFO[type];
      return `<button type="button" class="type-card" data-type="${type}" aria-pressed="${!template && type === itemType}">
        ${tabIcon(info.icon, 18)}
        <span class="type-card-text">
          <span class="type-card-name">${app.escapeHtml(tr(info.fr, info.en))}</span>
          <span class="type-card-hint">${app.escapeHtml(tr(info.hintFr, info.hintEn))}</span>
        </span>
      </button>`;
    }).join('') + templateCardsHtml(templates, template?.id, tr, value => app.escapeHtml(value));
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
    $<HTMLElement>('#cred-icon-preview').innerHTML = app.credentialIcon({ icon: chosenIcon, website: websiteInput.value, title: titleInput.value, type: itemType }, 28);
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
    locale: app.dateLocale(),
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
      app.mountGenerator(genPanel, {
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
    counter.textContent = `${length.toLocaleString(app.dateLocale())} / ${limits.maxNoteLength.toLocaleString(app.dateLocale())}`;
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
        <span class="attachment-name">${app.escapeHtml(file.name)}</span>
        <span class="field-hint">${formatFileSize(file.size)}</span>
        <button type="button" class="icon-btn" data-remove-file="${index}" aria-label="${tr('Retirer', 'Remove')} ${app.escapeHtml(file.name)}">${GEN_ICONS.close}</button>
      </div>`).join('');
  };
  box.querySelector<HTMLInputElement>('#field-files-input')?.addEventListener('change', event => {
    const input = event.target as HTMLInputElement;
    for (const file of [...(input.files ?? [])]) {
      const maxBytes = app.attachmentSizeLimit(existing?.vaultId ?? vaultStore.getData().activeVaultId);
      if (file.size > maxBytes) {
        app.showToast(app.attachmentTooLargeMessage(file.name, maxBytes), 'error', 5000);
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

  /* Recto et verso d'une pièce d'identité : un fichier par face, remplacé si on en choisit un autre */
  const pendingSides: Partial<Record<'front' | 'back', File>> = {};
  const paintScans = () => {
    for (const side of ['front', 'back'] as const) {
      const state = box.querySelector<HTMLElement>(`[data-scan-state="${side}"]`);
      if (!state) continue;
      const pending = pendingSides[side];
      const saved = existing?.attachments?.find(a => a.side === side);
      state.textContent = pending ? pending.name : saved ? saved.name : tr('Photographier ou choisir', 'Take a photo or choose');
      state.closest('.id-scan')?.classList.toggle('filled', !!(pending || saved));
    }
  };
  box.querySelectorAll<HTMLInputElement>('[data-scan-input]').forEach(input => input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const maxBytes = app.attachmentSizeLimit(existing?.vaultId ?? vaultStore.getData().activeVaultId);
    if (file.size > maxBytes) return app.showToast(app.attachmentTooLargeMessage(file.name, maxBytes), 'error', 5000);
    pendingSides[input.dataset.scanInput as 'front' | 'back'] = file;
    box.querySelectorAll<HTMLElement>('.id-scan').forEach(slot => slot.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    slot.querySelector<HTMLInputElement>('input')?.click();
  }));
  paintScans();
  }));
  box.querySelectorAll<HTMLElement>('.id-scan').forEach(slot => slot.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    slot.querySelector<HTMLInputElement>('input')?.click();
  }));
  paintScans();

  /** Envoi des fichiers en attente, une fois l'identifiant enregistré */
  const uploadPendingFiles = async (credentialId: string, vaultId: string) => {
    for (const side of ['front', 'back'] as const) {
      const file = pendingSides[side];
      if (!file || itemType !== 'identity') continue;
      try {
        const meta = { ...(await app.storeAttachment(file, vaultId)), side };
        const current = vaultStore.getData().credentials.find(c => c.id === credentialId);
        const previous = current?.attachments?.find(a => a.side === side);
        vaultStore.updateCredential(credentialId, { attachments: [...(current?.attachments ?? []).filter(a => a.side !== side), meta] });
        if (previous) await app.removeAttachment(previous).catch(() => undefined);
      } catch (err) {
        app.showToast(`${file.name} : ${accountErrorMessage(err)}`, 'error');
      }
    }
    if (!pendingFiles.length) {
      if (app.selectedItemId === credentialId) app.renderDetail(credentialId);
      return;
    }
    for (const file of pendingFiles) {
      try {
        const meta = await app.storeAttachment(file, vaultId);
        const current = vaultStore.getData().credentials.find(c => c.id === credentialId);
        vaultStore.updateCredential(credentialId, { attachments: [...(current?.attachments ?? []), meta] });
      } catch (err) {
        app.showToast(`${file.name} : ${accountErrorMessage(err)}`, 'error');
      }
    }
    if (app.selectedItemId === credentialId) app.renderDetail(credentialId);
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
    const templateSection = $<HTMLElement>('#section-template');
    templateSection.hidden = !template;
    templateSection.innerHTML = template ? templateFieldsHtml(template, existing?.fields, tr, value => app.escapeHtml(value)) : '';
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
      const typeName = template?.name ?? tr(info.fr, info.en);
      $<HTMLElement>('.modal-title').textContent = isEdit
        ? tr(`Modifier : ${typeName}`, `Edit ${typeName}`)
        : tr(`Nouveau : ${typeName}`, `New ${typeName}`);
    }

    updateIconPreview();
  };

  typeGrid.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-manage-templates]')) {
      stopScanner();
      app.closeModal();
      app.openTemplatesModal();
      return;
    }
    const templateChoice = target.closest<HTMLElement>('[data-template]')?.dataset.template;
    const choice = templateChoice ? 'note' : target.closest<HTMLElement>('[data-type]')?.dataset.type;
    if (!choice) return;
    template = templateChoice ? templates.find(t => t.id === templateChoice) : undefined;
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
      ? tr('Donnez un nom à cet identifiant', 'Give app credential a name')
      : tr('Donnez un nom à cet élément', 'Give app item a name');
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
    if (template) {
      const { error } = checkTemplateValues(template, readTemplateValues($<HTMLElement>('#section-template')), tr);
      if (error) {
        box.querySelector<HTMLElement>(`[data-tpl-field="${CSS.escape(error.fieldId)}"]`)?.focus();
        return error.message;
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
      icon: chosenIcon,
      // Les champs de l'ancien type sont effacés quand le type change
      card: undefined,
      identity: undefined,
      sshKey: undefined,
      ...payloadForItemType(),
      templateId: template?.id,
      ...(template ? { fields: mergeTemplateFields(template, readTemplateValues($<HTMLElement>('#section-template')), existing?.fields) } : {})
    };

    const problem = checkCredential({ ...item, fields: item.fields ?? existing?.fields }, limits, tr);
    if (problem) return fail(problem);

    stopScanner();
    if (isEdit && existing) {
      vaultStore.updateCredential(existing.id, item);
      app.closeModal();
      app.showToast(tr('Modifications enregistrées', 'Changes saved'), 'success');
      void uploadPendingFiles(existing.id, existing.vaultId);
    } else {
      const vaultId = vaultStore.getData().activeVaultId;
      const id = vaultStore.addCredential({ ...item, vaultId });
      app.closeModal();
      app.selectedItemId = id;
      app.renderList();
      app.renderDetail(id);
      app.showToast(tr(`${title} ajouté`, `${title} added`), 'success');
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
    onCancel: () => { stopScanner(); app.closeModal(); }
  });
}
