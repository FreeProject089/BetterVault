import { vaultStore } from '../store/vaultStore';
import { exportVaultAsJson, downloadExportFile } from '../import_export/importEngine';
import { encryptExport, MIN_EXPORT_PASSWORD_LENGTH } from '../import_export/encryptedExport';
import { accountErrorMessage } from '../ui/authScreen';
import { mountStepper } from '../ui/stepper';
import { GEN_ICONS } from '../ui/icons';
import type { AppController } from '../main';

/**
 * Effacement choisi, en trois temps : ce qui part, la sauvegarde, la confirmation.
 *
 * L'ordre n'est pas décoratif. Effacer est sans retour, et une sauvegarde proposée
 * après coup n'aurait plus rien à sauvegarder : l'étape d'export vient donc avant,
 * et le bouton d'effacement reste inerte tant qu'aucun fichier n'a été obtenu — ou
 * que l'on n'a pas déclaré en avoir déjà un.
 */
export function openEraseModal(app: AppController): void {
  const tr = app.tr.bind(app);
  const data = vaultStore.getData();
  // Les coffres partagés appartiennent aussi aux autres membres : ils ne sont pas concernés
  const coffres = data.vaults.filter(v => !v.shared);
  let sauvegarde: 'chiffre' | 'clair' | 'deja' | null = null;

  const box = app.openModal(`
    <div class="modal-header">
      <div class="modal-title">${tr('Effacer mes données', 'Erase my data')}</div>
      <button class="modal-close" type="button">${GEN_ICONS.close}</button>
    </div>
    <div class="stepper-track" data-erase-track></div>
    <div class="modal-body">
      <section data-step="choix">
        <p class="modal-text">${tr('Cochez ce qui doit disparaître de cet appareil et du serveur.', 'Tick what should disappear from app device and from the server.')}</p>
        <div class="erase-choices">
          <label class="check-row"><input type="checkbox" data-erase="credentials" checked><span>${tr('Identifiants et codes 2FA', 'Credentials and 2FA codes')}<small data-count="credentials"></small></span></label>
          <label class="check-row"><input type="checkbox" data-erase="tasks" checked><span>${tr('Tâches', 'Tasks')}<small data-count="tasks"></small></span></label>
          <label class="check-row"><input type="checkbox" data-erase="folders"><span>${tr('Dossiers', 'Folders')}<small>${tr('Leur contenu remonte d’un niveau s’il en reste', 'Anything left inside moves up one level')}</small></span></label>
          <label class="check-row"><input type="checkbox" data-erase="tags"><span>${tr('Tags devenus inutilisés', 'Tags left unused')}<small>${tr('Ceux encore portés par un élément restent', 'Those still carried by an item stay')}</small></span></label>
        </div>
        <div class="form-field">
          <label class="form-label">${tr('Dans quels coffres ?', 'In which vaults?')}</label>
          <div class="erase-choices" data-vault-choices>
            ${coffres.map(v => `<label class="check-row"><input type="checkbox" data-erase-vault="${app.escapeHtml(v.id)}" checked><span>${app.escapeHtml(v.name)}</span></label>`).join('')}
          </div>
        </div>
        <div class="form-error" data-erase-error role="alert" hidden></div>
      </section>

      <section data-step="sauvegarde" hidden>
        <p class="modal-text">${tr('Une fois effacé, rien ne se récupère. Prenez une copie avant.', 'Once erased, nothing comes back. Take a copy first.')}</p>
        <div class="account-actions">
          <button type="button" class="btn-primary btn-accent" data-backup="chiffre">${tr('Exporter chiffré', 'Export encrypted')}</button>
          <button type="button" class="btn-primary" data-backup="clair">${tr('Exporter en clair', 'Export in plain text')}</button>
        </div>
        <span class="field-hint">${tr('L’export chiffré demande un mot de passe dédié (Argon2id, AES-256-GCM). L’export en clair se lit par quiconque obtient le fichier.', 'The encrypted export asks for a dedicated password (Argon2id, AES-256-GCM). A plain export is readable by anyone who gets the file.')}</span>
        <label class="check-row"><input type="checkbox" data-backup-skip><span>${tr('J’ai déjà une sauvegarde', 'I already have a backup')}</span></label>
        <div class="form-section" data-backup-password hidden>
          <div class="form-section-title">${tr('Mot de passe de l’export', 'Export password')}</div>
          <div class="form-row">
            <input class="form-input" type="password" data-backup-pwd autocomplete="new-password" placeholder="${tr(`Au moins ${MIN_EXPORT_PASSWORD_LENGTH} caractères`, `At least ${MIN_EXPORT_PASSWORD_LENGTH} characters`)}">
            <button type="button" class="btn-primary btn-accent" data-backup-go>${tr('Chiffrer et enregistrer', 'Encrypt and save')}</button>
          </div>
        </div>
        <div class="notice notice-success" data-backup-done hidden></div>
        <div class="form-error" data-backup-error role="alert" hidden></div>
      </section>

      <section data-step="confirmation" hidden>
        <div class="notice notice-warning" data-erase-summary></div>
        <p class="modal-text">${tr('Saisissez EFFACER pour confirmer.', 'Type ERASE to confirm.')}</p>
        <input class="form-input" data-erase-word autocomplete="off" spellcheck="false" placeholder="${tr('EFFACER', 'ERASE')}">
      </section>
    </div>
    <div class="modal-footer" data-erase-footer></div>
  `);

  const $ = <T extends HTMLElement>(sel: string) => box.querySelector(sel) as T | null;
  const coche = (nom: string) => !!box.querySelector<HTMLInputElement>(`[data-erase="${nom}"]`)?.checked;
  const coffresChoisis = () => [...box.querySelectorAll<HTMLInputElement>('[data-erase-vault]')]
    .filter(i => i.checked).map(i => i.dataset.eraseVault!);

  const peindreCompteurs = () => {
    const ids = new Set(coffresChoisis());
    const nbCreds = data.credentials.filter(c => ids.has(c.vaultId)).length;
    const nbTaches = data.tasks.filter(t => ids.has(t.vaultId)).length;
    const c = $('[data-count="credentials"]');
    const t = $('[data-count="tasks"]');
    if (c) c.textContent = tr(`${nbCreds} élément(s)`, `${nbCreds} item(s)`);
    if (t) t.textContent = tr(`${nbTaches} tâche(s)`, `${nbTaches} task(s)`);
  };
  box.addEventListener('change', peindreCompteurs);
  peindreCompteurs();

  const erreur = (sel: string, message?: string) => {
    const el = $(sel);
    if (!el) return;
    el.textContent = message ?? '';
    el.hidden = !message;
  };

  const contenuAExporter = () => {
    const ids = new Set(coffresChoisis());
    return {
      creds: data.credentials.filter(c => ids.has(c.vaultId)),
      taches: data.tasks.filter(t => ids.has(t.vaultId))
    };
  };

  const marquerSauvegarde = (mode: 'chiffre' | 'clair' | 'deja') => {
    sauvegarde = mode;
    const done = $('[data-backup-done]');
    if (done) {
      done.hidden = false;
      done.textContent = mode === 'deja'
        ? tr('Vous déclarez avoir déjà une sauvegarde.', 'You state you already have a backup.')
        : tr('Fichier enregistré. Vérifiez qu’il s’ouvre avant de continuer.', 'File saved. Check that it opens before continuing.');
    }
  };

  box.querySelector('[data-backup="clair"]')?.addEventListener('click', async () => {
    const ok = await app.confirmDialog({
      title: tr('Exporter en clair ?', 'Export in plain text?'),
      message: tr('Toute personne qui obtient ce fichier pourra lire vos mots de passe, codes 2FA et passkeys.', 'Anyone who gets app file can read your passwords, 2FA codes and passkeys.'),
      confirmLabel: tr('Exporter', 'Export'),
      danger: true
    });
    if (!ok) return;
    const { creds, taches } = contenuAExporter();
    downloadExportFile(exportVaultAsJson(creds, taches), `bettervault-avant-effacement-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    marquerSauvegarde('clair');
  });

  box.querySelector('[data-backup="chiffre"]')?.addEventListener('click', () => {
    const panneau = $('[data-backup-password]');
    if (panneau) panneau.hidden = false;
    $<HTMLInputElement>('[data-backup-pwd]')?.focus();
  });

  box.querySelector('[data-backup-go]')?.addEventListener('click', async () => {
    const mot = $<HTMLInputElement>('[data-backup-pwd]')?.value ?? '';
    if (mot.length < MIN_EXPORT_PASSWORD_LENGTH) {
      return erreur('[data-backup-error]', tr(`Le mot de passe doit contenir au moins ${MIN_EXPORT_PASSWORD_LENGTH} caractères`, `The password must be at least ${MIN_EXPORT_PASSWORD_LENGTH} characters`));
    }
    erreur('[data-backup-error]');
    try {
      const { creds, taches } = contenuAExporter();
      const fichier = await encryptExport(exportVaultAsJson(creds, taches), mot);
      downloadExportFile(fichier, `bettervault-avant-effacement-${new Date().toISOString().slice(0, 10)}.encrypted.json`, 'application/json');
      marquerSauvegarde('chiffre');
    } catch (err) {
      erreur('[data-backup-error]', accountErrorMessage(err));
    }
  });

  box.querySelector<HTMLInputElement>('[data-backup-skip]')?.addEventListener('change', event => {
    if ((event.target as HTMLInputElement).checked) marquerSauvegarde('deja');
    else {
      sauvegarde = null;
      const done = $('[data-backup-done]');
      if (done) done.hidden = true;
    }
  });

  const resume = () => {
    const ids = new Set(coffresChoisis());
    const parties: string[] = [];
    if (coche('credentials')) {
      const n = data.credentials.filter(c => ids.has(c.vaultId)).length;
      parties.push(tr(`${n} identifiant(s) et code(s) 2FA`, `${n} credential(s) and 2FA code(s)`));
    }
    if (coche('tasks')) {
      const n = data.tasks.filter(t => ids.has(t.vaultId)).length;
      parties.push(tr(`${n} tâche(s)`, `${n} task(s)`));
    }
    if (coche('folders')) {
      const n = data.folders.filter(f => ids.has(f.vaultId)).length;
      parties.push(tr(`${n} dossier(s)`, `${n} folder(s)`));
    }
    if (coche('tags')) parties.push(tr('les tags devenus inutilisés', 'tags left unused'));
    const el = $('[data-erase-summary]');
    if (el) el.textContent = tr(`Seront effacés : ${parties.join(', ')}.`, `Will be erased: ${parties.join(', ')}.`);
  };

  mountStepper({
    body: box.querySelector('.modal-body') as HTMLElement,
    header: box.querySelector('[data-erase-track]') as HTMLElement,
    footer: box.querySelector('[data-erase-footer]') as HTMLElement,
    tr,
    finishLabel: tr('Effacer définitivement', 'Erase permanently'),
    cancelLabel: tr('Annuler', 'Cancel'),
    onCancel: () => app.closeModal(),
    onError: message => app.showToast(message, 'error'),
    onStepChange: id => { if (id === 'confirmation') resume(); },
    steps: [
      {
        id: 'choix',
        label: tr('Quoi', 'What'),
        validate: () => {
          if (!coche('credentials') && !coche('tasks') && !coche('folders') && !coche('tags')) {
            return tr('Choisissez au moins une catégorie', 'Pick at least one category');
          }
          if (!coffresChoisis().length) return tr('Choisissez au moins un coffre', 'Pick at least one vault');
          return undefined;
        }
      },
      {
        id: 'sauvegarde',
        label: tr('Sauvegarde', 'Backup'),
        validate: () => sauvegarde ? undefined : tr('Prenez une sauvegarde, ou déclarez en avoir déjà une', 'Take a backup, or state that you already have one')
      },
      {
        id: 'confirmation',
        label: tr('Confirmation', 'Confirm'),
        validate: () => {
          const mot = ($<HTMLInputElement>('[data-erase-word]')?.value ?? '').trim().toUpperCase();
          return mot === tr('EFFACER', 'ERASE') ? undefined : tr('Saisissez EFFACER pour confirmer', 'Type ERASE to confirm');
        }
      }
    ],
    onFinish: () => {
      const bilan = vaultStore.eraseData({
        vaultIds: coffresChoisis(),
        credentials: coche('credentials'),
        tasks: coche('tasks'),
        folders: coche('folders'),
        tags: coche('tags')
      });
      app.selectedItemId = null;
      app.renderDetail(null);
      app.closeModal();
      app.renderSidebar();
      app.renderList();
      app.showToast(tr(
        `Effacé : ${bilan.credentials} identifiant(s), ${bilan.tasks} tâche(s), ${bilan.folders} dossier(s), ${bilan.tags} tag(s)`,
        `Erased: ${bilan.credentials} credential(s), ${bilan.tasks} task(s), ${bilan.folders} folder(s), ${bilan.tags} tag(s)`
      ), 'info', 6000);
    }
  });
}
