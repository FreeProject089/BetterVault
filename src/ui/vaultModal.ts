import { ACTION_ICONS, VAULT_ICON } from './icons';
import { vaultStore } from '../store/vaultStore';
import { renderItemIcon, type ItemIcon } from '../icons/iconLibrary';
import { type SharedMember, type SharedPermission, type SharedRole } from '../account/cloudClient';
import { accountErrorMessage } from '../ui/authScreen';
import { mountIconPicker } from '../ui/iconPicker';
import { tabIcon } from '../ui/tabIcons';
import { GEN_ICONS } from '../ui/icons';
import { remainingCapacity } from '../account/limits';
import { i18n } from '../i18n';
import type { AppController } from '../main';
import { accountService, sharedVaults } from '../app/services';

/** Création et modification d'un coffre, partage compris */
export function openVaultModal(app: AppController, vaultId?: string): void {
  const data = vaultStore.getData();
  const existing = vaultId ? data.vaults.find(v => v.id === vaultId) : undefined;
  const shared = existing?.shared ? sharedVaults.summary(existing.id) : undefined;
  const credentialCount = existing ? data.credentials.filter(c => c.vaultId === existing.id).length : 0;
  const taskCount = existing ? data.tasks.filter(t => t.vaultId === existing.id).length : 0;
  const limits = accountService.getLimits();
  const tr = (fr: string, en: string) => app.tr(fr, en);
  const cloud = accountService.isCloud();
  const permissions = new Set<SharedPermission>(shared?.role.permissions ?? ['write', 'attachments', 'export', 'manage_members', 'manage_roles', 'delete_vault']);
  const isOwner = !shared || shared.role.builtin === 'owner';
  const personalCount = data.vaults.filter(v => !v.shared).length;
  const typeOption = (type: 'personal' | 'work' | 'team', label: string) =>
    `<option value="${type}" ${existing?.type === type ? 'selected' : ''}>${label}</option>`;

  if (!existing && remainingCapacity(data, data.activeVaultId, limits).vaults === 0) {
    app.showToast(tr(`Limite de ${limits.maxVaults} coffres atteinte`, `Limit of ${limits.maxVaults} vaults reached`), 'error');
    return;
  }

  let icon: ItemIcon | undefined = existing?.icon;
  const box = app.openModal(`
    <div class="modal-header">
      <div class="modal-title">${existing ? app.escapeHtml(existing.name) : i18n.t.vault.newVaultModalTitle}</div>
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
        ${shared ? `<div class="notice">${tr('Coffre partagé par', 'Vault shared by')} <strong>${app.escapeHtml(shared.ownerEmail)}</strong> · ${tr('votre rôle', 'your role')} : <strong>${app.escapeHtml(app.roleLabel(shared.role))}</strong></div>` : ''}
        <div class="cred-identity">
          <button type="button" class="cred-icon-button" data-icon-button aria-expanded="false" title="${tr('Choisir une icône', 'Choose an icon')}" aria-label="${tr('Choisir une icône', 'Choose an icon')}" ${permissions.has('write') ? '' : 'disabled'}>
            <span data-icon-preview style="display:flex;"></span>
            <span class="cred-icon-edit">${ACTION_ICONS.edit}</span>
          </button>
          <div class="form-field">
            <label class="form-label" for="vault-name">${i18n.t.vault.vaultNameLabel}</label>
            <input class="form-input cred-title-input" id="vault-name" type="text" maxlength="40" value="${app.escapeHtml(existing?.name ?? '')}" placeholder="${tr('Personnel, Travail, Famille…', 'Personal, Work, Family…')}" autocomplete="off" data-autofocus ${permissions.has('write') ? '' : 'disabled'}>
          </div>
        </div>
        <div data-icon-panel hidden></div>
        <div class="form-field">
          <label class="form-label" for="vault-type">${i18n.t.vault.vaultTypeLabel}</label>
<!-- Un &lt;select&gt; natif n'accueille pas de bouton dans sa liste : la corbeille
               se place à côté et vise le type choisi, ce qui évite de répéter la liste
               des types sous le champ. -->
          <div class="select-with-action">
            <select class="form-input" id="vault-type" ${permissions.has('write') ? '' : 'disabled'}>
              ${typeOption('personal', i18n.t.common.personal)}
              ${typeOption('work', i18n.t.common.work)}
              ${typeOption('team', i18n.t.common.team)}
              ${vaultStore.getVaultTypes().map(custom => `<option value="${app.escapeHtml(custom.id)}" ${existing?.type === custom.id ? 'selected' : ''}>${app.escapeHtml(custom.name)}</option>`).join('')}
              <option value="__new__">${tr('＋ Nouveau type…', '＋ New type…')}</option>
            </select>
            <button type="button" class="icon-btn" data-delete-selected-type hidden title="${tr('Supprimer ce type', 'Delete app type')}" aria-label="${tr('Supprimer ce type', 'Delete app type')}">${GEN_ICONS.trash}</button>
          </div>
          <div class="form-row" data-new-type hidden style="grid-template-columns:minmax(0,1fr) auto;margin-top:8px;">
            <input class="form-input" id="vault-type-name" maxlength="40" placeholder="${tr('Nom du type (Famille, Association…)', 'Type name (Family, Club…)')}" autocomplete="off">
            <button type="button" class="btn-primary btn-ghost" data-cancel-type>${tr('Annuler', 'Cancel')}</button>
          </div>
        </div>

        ${!existing && cloud ? `
          <label class="switch-row">
            <span>${tr('Coffre partagé', 'Shared vault')}<small>${tr('Invitez d’autres comptes de ce serveur et choisissez leur rôle', 'Invite other accounts on app server and pick their role')}</small></span>
            <input type="checkbox" class="switch" id="vault-shared">
          </label>` : ''}

        ${existing && !shared && cloud ? `
          <section class="account-section">
            <h3 class="account-section-title">${tr('Partager ce coffre', 'Share app vault')}</h3>
            <p class="modal-text">${tr(`Ses ${credentialCount} identifiant(s) et ${taskCount} tâche(s) deviennent un coffre partagé, chiffré avec une nouvelle clé. Vous en êtes propriétaire.`, `Its ${credentialCount} credential(s) and ${taskCount} task(s) become a shared vault encrypted with a new key. You own it.`)}</p>
            <div class="account-actions account-actions-end">
              <button class="btn-primary" data-action="share-existing" ${personalCount <= 1 ? 'disabled' : ''}>${tr('Transformer en coffre partagé', 'Turn into a shared vault')}</button>
            </div>
            ${personalCount <= 1 ? `<div class="field-hint">${tr('Gardez au moins un autre coffre personnel.', 'Keep at least one other personal vault.')}</div>` : ''}
          </section>` : ''}

        ${existing && !shared && data.vaults.filter(v => !v.shared).length > 1 ? `
          <section class="account-section account-danger">
            <h3 class="account-section-title">${tr('Supprimer ce coffre', 'Delete app vault')}</h3>
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
              : tr('Vous perdez l’accès à ce coffre. Un membre autorisé pourra vous réinviter.', 'You lose access to app vault. An authorized member can invite you again.')}</p>
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
  const deleteTypeButton = box.querySelector<HTMLButtonElement>('[data-delete-selected-type]');
  let previousType = typeSelect.value;

  // La corbeille ne concerne que les types créés ici : les trois types fournis restent
  const paintTypeActions = () => {
    const custom = vaultStore.getVaultTypes().some(t => t.id === typeSelect.value);
    if (deleteTypeButton) deleteTypeButton.hidden = !custom || !permissions.has('write');
  };

  typeSelect.addEventListener('change', () => {
    const creating = typeSelect.value === '__new__';
    newTypeRow.hidden = !creating;
    if (creating) newTypeInput?.focus();
    else previousType = typeSelect.value;
    paintTypeActions();
  });
  box.querySelector('[data-cancel-type]')?.addEventListener('click', () => {
    typeSelect.value = previousType;
    newTypeRow.hidden = true;
    if (newTypeInput) newTypeInput.value = '';
    paintTypeActions();
  });
  paintTypeActions();

  deleteTypeButton?.addEventListener('click', async () => {
    const typeId = typeSelect.value;
    if (!vaultStore.getVaultTypes().some(t => t.id === typeId)) return;
    const custom = vaultStore.getVaultTypes().find(t => t.id === typeId);
    const used = vaultStore.getData().vaults.filter(v => v.type === typeId).length;
    const confirmed = await app.confirmDialog({
      title: tr('Supprimer ce type ?', 'Delete app type?'),
      message: used
        ? tr(`${used} coffre(s) repasseront en « ${i18n.t.common.personal} ».`, `${used} vault(s) will go back to "${i18n.t.common.personal}".`)
        : tr(`« ${custom?.name ?? ''} » sera retiré de la liste.`, `"${custom?.name ?? ''}" will be removed from the list.`),
      confirmLabel: tr('Supprimer', 'Delete'),
      danger: true
    });
    if (!confirmed) return;
    vaultStore.deleteVaultType(typeId);
    app.closeModal();
    app.renderSidebar();
    app.openVaultModal(vaultId);
  });

  $<HTMLButtonElement>('#modal-confirm')?.addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement;
    const name = ($<HTMLInputElement>('#vault-name')?.value ?? '').trim();
    let type = typeSelect.value;
    if (type === '__new__') {
      const typeName = newTypeInput?.value.trim() ?? '';
      if (!typeName) {
        app.showToast(tr('Donnez un nom au nouveau type', 'Name the new type'), 'error');
        newTypeInput?.focus();
        return;
      }
      try {
        type = vaultStore.createVaultType(typeName, limits.maxVaultTypes).id;
      } catch (err) {
        app.showToast(accountErrorMessage(err), 'error');
        return;
      }
    }
    if (!name) {
      app.showToast(tr('Donnez un nom au coffre', 'Give the vault a name'), 'error');
      return;
    }
    if (existing) {
      vaultStore.updateVault(existing.id, { name, type, icon });
      app.closeModal();
      app.showToast(tr('Coffre enregistré', 'Vault saved'), 'success');
      return;
    }
    if ($<HTMLInputElement>('#vault-shared')?.checked) {
      button.disabled = true;
      try {
        const id = await sharedVaults.create(name, type, icon);
        app.reloadWithShared();
        vaultStore.setActiveVault(id);
        app.closeModal();
        app.showToast(tr(`Coffre partagé ${name} créé. Invitez des membres depuis ses réglages.`, `Shared vault ${name} created. Invite members from its settings.`), 'success', 5000);
        app.openVaultModal(id);
      } catch (err) {
        button.disabled = false;
        app.showToast(accountErrorMessage(err), 'error');
      }
      return;
    }
    vaultStore.addVault(name, type, icon);
    app.selectedItemId = null;
    app.renderDetail(null);
    app.closeModal();
    app.showToast(tr(`Coffre ${name} créé`, `Vault ${name} created`), 'success');
  });

  $<HTMLButtonElement>('[data-action="share-existing"]')?.addEventListener('click', async event => {
    if (!existing) return;
    // « currentTarget » n'est renseigné que pendant la distribution de l'événement :
    // après la première attente il vaut null. On garde le bouton tout de suite.
    const button = event.currentTarget as HTMLButtonElement;
    const confirmed = await app.confirmDialog({
      title: tr('Transformer en coffre partagé ?', 'Turn into a shared vault?'),
      message: tr('Le contenu est déplacé dans un coffre partagé. Vous pourrez ensuite inviter des membres.', 'The content moves to a shared vault. You can then invite members.'),
      confirmLabel: tr('Transformer', 'Convert')
    });
    if (!confirmed) return;
    button.disabled = true;
    try {
      const id = await sharedVaults.shareExisting(vaultStore.getData(), existing.id);
      vaultStore.removeVaultSilently(existing.id);
      await accountService.flush();
      app.reloadWithShared();
      vaultStore.setActiveVault(id);
      app.closeModal();
      app.openVaultModal(id);
    } catch (err) {
      button.disabled = false;
      app.showToast(accountErrorMessage(err), 'error');
    }
  });

  $<HTMLButtonElement>('[data-action="delete-vault"]')?.addEventListener('click', async () => {
    if (!existing) return;
    const confirmed = await app.confirmDialog({
      title: tr('Supprimer le coffre ?', 'Delete vault?'),
      message: tr(`« ${existing.name} », ses ${credentialCount} identifiant(s) et ses ${taskCount} tâche(s) seront définitivement supprimés.`, `"${existing.name}", its ${credentialCount} credential(s) and ${taskCount} task(s) will be permanently deleted.`),
      confirmLabel: tr('Supprimer', 'Delete'),
      danger: true,
      skippable: true
    });
    if (!confirmed) return;
    vaultStore.deleteVault(existing.id);
    app.selectedItemId = null;
    app.renderDetail(null);
    app.closeModal();
    app.showToast(tr('Coffre supprimé', 'Vault deleted'), 'success');
  });

  const leaveOrDelete = async (kind: 'delete' | 'leave') => {
    if (!existing) return;
    const confirmed = await app.confirmDialog({
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
      app.selectedItemId = null;
      app.reloadWithShared();
      app.renderDetail(null);
      app.closeModal();
    } catch (err) {
      app.showToast(accountErrorMessage(err), 'error');
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
    .map(r => `<option value="${r.id}" ${r.id === selected ? 'selected' : ''}>${app.escapeHtml(app.roleLabel(r))}</option>`).join('');

  const renderMembers = () => {
    const host = $<HTMLElement>('[data-members]')!;
    host.innerHTML = members.map(member => {
      const role = roles.find(r => r.id === member.roleId);
      const self = member.email === myEmail;
      const editable = permissions.has('manage_members') && role?.builtin !== 'owner' && !self;
      return `
        <div class="member-row" data-user="${member.userId}">
          <div class="member-avatar">${app.escapeHtml(member.email.charAt(0).toUpperCase())}</div>
          <div class="member-main">
            <div class="member-email">${app.escapeHtml(member.email)}${self ? ` <span class="field-hint">(${tr('vous', 'you')})</span>` : ''}</div>
            <div class="field-hint">${member.status === 'invited' ? `<span class="status-pill off">${tr('Invitation envoyée', 'Invitation sent')}</span>` : ''}
              <button type="button" class="link-btn" data-fingerprint="${app.escapeHtml(member.publicKey ?? '')}">${tr('Empreinte de clé', 'Key fingerprint')}</button></div>
          </div>
          ${editable
            ? `<select class="form-input member-role" data-role-select>${roleOptions(member.roleId, isOwner && member.status === 'active')}</select>
               <button type="button" class="icon-btn" data-remove title="${tr('Retirer', 'Remove')}" aria-label="${tr('Retirer', 'Remove')}">${ACTION_ICONS.trash}</button>`
            : `<span class="vault-type-badge shared">${app.escapeHtml(role ? app.roleLabel(role) : '')}</span>`}
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
              ? `<input class="form-input" data-role-rename value="${app.escapeHtml(role.name)}" maxlength="40" style="max-width:240px;">`
              : `<div class="form-section-title">${app.escapeHtml(app.roleLabel(role))}${role.builtin ? ` <span class="field-hint">${tr('prédéfini', 'built-in')}</span>` : ''}</div>`}
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
      $<HTMLElement>('[data-members]')!.innerHTML = `<div class="notice notice-danger">${app.escapeHtml(accountErrorMessage(err))}</div>`;
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
          <div><strong>${app.escapeHtml(user.email)}</strong></div>
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
          app.showToast(tr(`Invitation envoyée à ${user.email}`, `Invitation sent to ${user.email}`), 'success');
          await loadMembers();
        } catch (err) {
          button.disabled = false;
          app.showToast(accountErrorMessage(err), 'error');
        }
      });
    } catch (err) {
      found.innerHTML = `<div class="notice notice-danger">${app.escapeHtml(accountErrorMessage(err))}</div>`;
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
    const confirmed = await app.confirmDialog({
      title: tr('Retirer ce membre ?', 'Remove app member?'),
      message: tr(`${member.email} perd l’accès. Le coffre est rechiffré avec une nouvelle clé pour les membres restants.`, `${member.email} loses access. The vault is re-encrypted with a new key for the remaining members.`),
      confirmLabel: tr('Retirer', 'Remove'),
      danger: true
    });
    if (!confirmed) return;
    try {
      await sharedVaults.removeMember(existing.id, member.userId);
      app.showToast(tr(`${member.email} retiré, nouvelle clé en place`, `${member.email} removed, new key in place`), 'success');
      await loadMembers();
    } catch (err) {
      app.showToast(accountErrorMessage(err), 'error');
    }
  });
  membersHost.addEventListener('change', async e => {
    const select = (e.target as HTMLElement).closest<HTMLSelectElement>('[data-role-select]');
    const userId = select?.closest<HTMLElement>('[data-user]')?.dataset.user;
    const member = members.find(m => m.userId === userId);
    const role = roles.find(r => r.id === select?.value);
    if (!select || !member || !role) return;
    if (role.builtin === 'owner') {
      const confirmed = await app.confirmDialog({
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
      app.reloadWithShared();
      if (role.builtin === 'owner') {
        app.closeModal();
        app.openVaultModal(existing.id);
        return;
      }
      await loadMembers();
    } catch (err) {
      select.value = member.roleId;
      app.showToast(accountErrorMessage(err), 'error');
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
        app.showToast(tr('Rôle enregistré', 'Role saved'), 'success');
        await loadMembers();
      } else if (target.closest('[data-role-delete]')) {
        await sharedVaults.deleteRole(existing.id, roleId);
        await loadMembers();
      }
    } catch (err) {
      app.showToast(accountErrorMessage(err), 'error');
    }
  });

  $<HTMLFormElement>('[data-role-create]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const name = form.querySelector<HTMLInputElement>('[data-role-name]')!.value.trim();
    const selected = [...form.querySelectorAll<HTMLInputElement>('[data-role-permissions] input:checked')].map(i => i.value as SharedPermission);
    if (!name) return app.showToast(tr('Donnez un nom au rôle', 'Give the role a name'), 'error');
    try {
      await sharedVaults.createRole(existing.id, name, selected);
      form.querySelector<HTMLInputElement>('[data-role-name]')!.value = '';
      app.showToast(tr(`Rôle ${name} créé`, `Role ${name} created`), 'success');
      await loadMembers();
    } catch (err) {
      app.showToast(accountErrorMessage(err), 'error');
    }
  });
}
