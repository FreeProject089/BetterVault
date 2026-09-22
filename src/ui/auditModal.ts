import { vaultStore } from '../store/vaultStore';
import type { CredentialItem } from '../types/vault';
import { calculatePasswordEntropy, auditVaultSecurity, checkPasswordPwnedHIBP, HibpUnavailableError } from '../crypto/vaultCrypto';
import { EXPIRY_SOON_DAYS, expiryInfo } from '../ui/expiry';
import { GEN_ICONS } from '../ui/icons';
import { reusedPasswords } from '../store/credentialFilters';
import { i18n } from '../i18n';
import type { AppController } from '../main';

/** Audit de sécurité : mots de passe faibles, réutilisés ou compromis */
export function openAuditModal(app: AppController): void {
  const data = vaultStore.getData();
  const creds = data.credentials.filter(c => c.vaultId === data.activeVaultId);
  const report = auditVaultSecurity(creds);
  const now = Date.now();
  const reused = reusedPasswords(creds);

  const groups = {
    weak: { label: app.tr('Mots de passe faibles', 'Weak passwords'), tone: 'var(--accent-red)', items: creds.filter(c => !c.password || calculatePasswordEntropy(c.password).score <= 2) },
    reused: { label: app.tr('Réutilisés', 'Reused'), tone: 'var(--accent-orange)', items: creds.filter(c => c.password && reused.has(c.password)) },
    no2fa: { label: app.tr('Sans 2FA', 'No 2FA'), tone: 'var(--accent)', items: creds.filter(c => !c.totpSecret) },
    expiry: { label: app.tr('À renouveler', 'To renew'), tone: '#f0883e', items: creds.filter(c => c.expiresAt && c.expiresAt - now <= EXPIRY_SOON_DAYS * 86_400_000) }
  };
  type GroupKey = keyof typeof groups;

  const scoreTone = report.score >= 80 ? 'var(--accent-green-bright)' : report.score >= 50 ? 'var(--accent-orange)' : 'var(--accent-red)';
  const scoreLabel = creds.length === 0
    ? app.tr('Rien à analyser', 'Nothing to check')
    : report.score >= 80 ? app.tr('Bonne santé', 'Healthy') : report.score >= 50 ? app.tr('À améliorer', 'Needs work') : app.tr('À risque', 'At risk');
  const radius = 40;
  const circumference = 2 * Math.PI * radius;

  const itemRow = (cred: CredentialItem, sub: string) => `
    <button type="button" class="audit-item" data-cred-id="${cred.id}">
      <span class="record-icon">${app.credentialIcon(cred, 16)}</span>
      <span class="audit-item-text">
        <span class="audit-item-title" style="display:block;">${app.escapeHtml(cred.title)}</span>
        <span class="audit-item-sub">${sub}</span>
      </span>
    </button>`;

  const describe = (key: GroupKey, cred: CredentialItem) => {
    if (key === 'weak') {
      if (!cred.password) return app.tr('Aucun mot de passe', 'No password');
      const s = calculatePasswordEntropy(cred.password);
      return `${s.label} · ${s.bits} bits`;
    }
    if (key === 'reused') {
      const count = creds.filter(c => c.password === cred.password).length;
      return app.tr(`Utilisé par ${count} identifiants`, `Used by ${count} credentials`);
    }
    if (key === 'no2fa') return app.escapeHtml(cred.username || cred.domain || '');
    return expiryInfo(cred.expiresAt, (fr, en) => app.tr(fr, en), app.dateLocale())?.long ?? '';
  };

  const box = app.openModal(`
    <div class="modal-header">
      <div class="modal-title">${i18n.t.audit.title}</div>
      <button class="modal-close">${GEN_ICONS.close}</button>
    </div>
    <div class="modal-body">
      <div class="audit-hero">
        <div class="audit-ring" role="img" aria-label="${app.tr('Score', 'Score')} ${report.score} / 100">
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
            ? app.tr('Ajoutez des identifiants pour voir leur niveau de sécurité.', 'Add credentials to see how secure they are.')
            : app.tr(`${creds.length} identifiant${creds.length > 1 ? 's' : ''} analysé${creds.length > 1 ? 's' : ''} dans ce coffre. Le score tient compte de la force, de la réutilisation et de la 2FA.`, `${creds.length} credential${creds.length > 1 ? 's' : ''} checked in app vault. The score reflects strength, reuse and 2FA.`)}</div>
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
            <div class="form-section-title">${app.tr('Fuites de données', 'Data breaches')}</div>
            <div class="field-hint">${app.tr('Compare chaque mot de passe à la base Have I Been Pwned. Seuls 5 caractères de son empreinte sont envoyés.', 'Checks each password against Have I Been Pwned. Only 5 characters of its hash are sent.')}</div>
          </div>
          <button class="btn-primary" type="button" id="btn-run-hibp" ${creds.some(c => c.password) ? '' : 'disabled'}>${app.tr('Vérifier', 'Check')}</button>
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
    app.closeModal();
    app.activeView = 'all-credentials';
    app.credentialFilters.clear();
    app.selectedItemId = id;
    app.renderList();
    app.renderDetail(id);
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
    btnHibp.textContent = app.tr('Vérifier à nouveau', 'Check again');
    const compromisedList = compromised.map(({ cred, hits }) => itemRow(cred, app.tr(`Vu ${i18n.formatNumber(hits)} fois dans des fuites`, `Seen ${i18n.formatNumber(hits)} times in breaches`))).join('');

    if (serviceError !== null) {
      hibpResults.innerHTML = `
        <div class="notice notice-warning">
          <strong>${app.tr('Vérification interrompue', 'Check interrupted')}</strong><br>
          ${app.escapeHtml(serviceError)}. ${app.tr(`${scanned} vérifié(s), ${toScan.length - scanned} restant(s).`, `${scanned} checked, ${toScan.length - scanned} left.`)}
        </div>
        ${compromisedList ? `<div class="audit-list" style="margin-top:8px;">${compromisedList}</div>` : ''}`;
    } else if (compromised.length > 0) {
      hibpResults.innerHTML = `
        <div class="notice notice-danger"><strong>${app.tr(`${compromised.length} mot${compromised.length > 1 ? 's' : ''} de passe présent${compromised.length > 1 ? 's' : ''} dans des fuites`, `${compromised.length} password${compromised.length > 1 ? 's' : ''} found in breaches`)}</strong> · ${app.tr('changez-les dès que possible.', 'change them as soon as possible.')}</div>
        <div class="audit-list" style="margin-top:8px;">${compromisedList}</div>`;
    } else {
      hibpResults.innerHTML = `<div class="notice notice-success">${app.tr('Aucun mot de passe trouvé dans les fuites connues.', 'No password found in known breaches.')}</div>`;
    }
    window.setTimeout(() => { progress.hidden = true; }, 600);
  });
}
