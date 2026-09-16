// Page d'administration du serveur BetterVault (aucune dépendance)

const fr = navigator.language.toLowerCase().startsWith('fr');
const TEXT = {
  admin: ['Administration', 'Administration'],
  logout: ['Se déconnecter', 'Sign out'],
  loginTitle: ['Connexion administrateur', 'Administrator sign-in'],
  loginHelp: ['Le jeton est affiché dans les journaux du serveur au premier démarrage, ou défini par ADMIN_TOKEN.', 'The token is printed in the server logs on first start, or set with ADMIN_TOKEN.'],
  token: ['Jeton d’administration', 'Admin token'],
  signIn: ['Se connecter', 'Sign in'],
  general: ['Général', 'General'],
  publicUrl: ['Adresse publique', 'Public address'],
  publicUrlHint: ['Affichée dans les emails envoyés aux utilisateurs.', 'Shown in emails sent to users.'],
  registrationOpen: ['Inscriptions ouvertes', 'Registration open'],
  limits: ['Limites', 'Limits'],
  limitsHint: ['Les coffres sont chiffrés : les applications appliquent ces limites avant l’envoi, le serveur vérifie la taille.', 'Vaults are encrypted: apps enforce these limits before upload, the server checks the size.'],
  smtpHint: ['Sert aux codes de réinitialisation et aux alertes de sécurité. Laissez l’hôte vide pour désactiver les emails.', 'Used for reset codes and security alerts. Leave the host empty to turn emails off.'],
  host: ['Hôte', 'Host'],
  security: ['Sécurité', 'Security'],
  none: ['Aucune', 'None'],
  user: ['Utilisateur', 'Username'],
  password: ['Mot de passe', 'Password'],
  from: ['Expéditeur', 'Sender'],
  allowInvalid: ['Accepter un certificat non valide (serveur interne)', 'Accept an invalid certificate (internal server)'],
  testTo: ['Envoyer un email de test à', 'Send a test email to'],
  sendTest: ['Envoyer', 'Send'],
  save: ['Enregistrer', 'Save'],
  saved: ['Réglages enregistrés', 'Settings saved'],
  sending: ['Envoi…', 'Sending…'],
  testSent: ['Email de test envoyé', 'Test email sent'],
  saveFirst: ['Enregistrez d’abord les réglages SMTP', 'Save the SMTP settings first'],
  passwordKept: ['Laisser vide pour garder le mot de passe actuel', 'Leave empty to keep the current password'],
  users: ['Comptes', 'Accounts'],
  twoFactor: ['Avec double authentification', 'With two-factor'],
  storage: ['Coffres stockés', 'Stored vaults'],
  version: ['Version du serveur', 'Server version'],
  wrongToken: ['Jeton incorrect', 'Wrong token'],
  backups: ['Sauvegardes', 'Backups'],
  backupHint: ['Copie de la base et des pièces jointes vers un stockage S3 (MinIO fourni avec Docker, ou AWS, Backblaze, Scaleway…). Les anciennes copies sont supprimées après la durée de conservation.', 'Copies the database and attachments to S3 storage (MinIO bundled with Docker, or AWS, Backblaze, Scaleway…). Old copies are deleted after the retention period.'],
  backupEnabled: ['Sauvegardes automatiques', 'Automatic backups'],
  backupInterval: ['Toutes les (heures)', 'Every (hours)'],
  backupRetention: ['Conservation (jours)', 'Retention (days)'],
  s3Endpoint: ['Adresse S3', 'S3 endpoint'],
  s3Region: ['Région', 'Region'],
  s3Bucket: ['Bucket', 'Bucket'],
  s3Prefix: ['Préfixe', 'Prefix'],
  s3Access: ['Clé d’accès', 'Access key'],
  s3Secret: ['Clé secrète', 'Secret key'],
  s3PathStyle: ['Adresse par chemin (MinIO, Garage)', 'Path-style addressing (MinIO, Garage)'],
  backupTest: ['Tester le stockage', 'Test storage'],
  backupRun: ['Sauvegarder maintenant', 'Back up now'],
  testing: ['Test…', 'Testing…'],
  storageOk: ['Stockage joignable, écriture et suppression réussies', 'Storage reachable, write and delete succeeded'],
  running: ['Sauvegarde en cours…', 'Backing up…'],
  backupDone: ['Sauvegarde terminée', 'Backup finished'],
  encryptedOn: ['Copies de la base chiffrées (BACKUP_ENCRYPTION_KEY défini)', 'Database copies encrypted (BACKUP_ENCRYPTION_KEY set)'],
  encryptedOff: ['Copies de la base non chiffrées : définissez BACKUP_ENCRYPTION_KEY dans le .env', 'Database copies not encrypted: set BACKUP_ENCRYPTION_KEY in .env'],
  noRuns: ['Aucune sauvegarde pour l’instant', 'No backups yet'],
  secretKept: ['Laisser vide pour garder la clé actuelle', 'Leave empty to keep the current key'],
  tabOverview: ['Tableau de bord', 'Overview'],
  tabSettings: ['Réglages', 'Settings'],
  tabBilling: ['Offres', 'Plans'],
  tabLegal: ['Documents légaux', 'Legal documents'],
  tabAudit: ['Journal', 'Audit log'],
  overviewHint: ['Totaux anonymes : aucune adresse email, adresse IP ni contenu de coffre n’est affiché ici.', 'Anonymous totals: no email address, IP address or vault content is shown here.'],
  refresh: ['Actualiser', 'Refresh'],
  activity: ['Activité', 'Activity'],
  storageTitle: ['Stockage', 'Storage'],
  performance: ['Performances', 'Performance'],
  securityChecks: ['Contrôles de sécurité', 'Security checks'],
  downloadTitle: ['Copie chiffrée de la base', 'Encrypted database copy'],
  downloadHint: ['Base complète compressée puis chiffrée (AES-256-GCM, clé dérivée par scrypt). Les coffres restent illisibles sans les mots de passe des utilisateurs. Restauration : node server/tools/decrypt-backup.ts.', 'Full database, compressed then encrypted (AES-256-GCM, scrypt-derived key). Vaults stay unreadable without users’ passwords. Restore with: node server/tools/decrypt-backup.ts.'],
  passphrase: ['Phrase de chiffrement (12 caractères minimum)', 'Encryption passphrase (12 characters minimum)'],
  download: ['Télécharger', 'Download'],
  preparing: ['Préparation…', 'Preparing…'],
  downloaded: ['Copie téléchargée. Gardez la phrase à part : sans elle, le fichier est inutilisable.', 'Copy downloaded. Keep the passphrase separately: without it the file is useless.'],
  billingTitle: ['Espace supplémentaire payant', 'Paid extra space'],
  billingHint: ['Facultatif. Paiement sur Stripe Checkout : le serveur ne voit ni carte ni adresse, et n’envoie pas l’email du compte à Stripe. Webhook à créer dans Stripe :', 'Optional. Payment on Stripe Checkout: the server never sees cards or addresses, and does not send the account email to Stripe. Webhook to create in Stripe:'],
  billingEnabled: ['Proposer les offres dans les applications', 'Offer plans in the apps'],
  stripeSecret: ['Clé secrète Stripe (sk_… ou rk_…)', 'Stripe secret key (sk_… or rk_…)'],
  stripeWebhook: ['Secret du webhook (whsec_…)', 'Webhook secret (whsec_…)'],
  webhookEvents: ['Événements : checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed.', 'Events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed.'],
  plans: ['Offres', 'Plans'],
  addPlan: ['Ajouter une offre', 'Add a plan'],
  noPlans: ['Aucune offre. Créez un prix dans Stripe, puis ajoutez-le ici.', 'No plans. Create a price in Stripe, then add it here.'],
  legalTitle: ['Identité de l’hébergeur', 'Operator identity'],
  legalHint: ['Ces informations complètent les modèles publiés sur /legal (conditions, confidentialité, DPA, mesures de sécurité, sous-traitants). Relisez-les : vous restez responsable de leur contenu.', 'This information fills the templates published at /legal (terms, privacy, DPA, security measures, subprocessors). Review them: you remain responsible for their content.'],
  auditTitle: ['Journal de sécurité', 'Security log'],
  auditHint: ['Conservé 90 jours. Les comptes sont désignés par un pseudonyme (HMAC) : on peut relier des événements sans connaître l’adresse email.', 'Kept 90 days. Accounts are shown as a pseudonym (HMAC): events can be linked without knowing the email address.'],
  when: ['Date', 'Date'],
  event: ['Événement', 'Event'],
  subject: ['Compte', 'Account'],
  detail: ['Détails', 'Details']
};
const t = key => TEXT[key]?.[fr ? 0 : 1] ?? key;

const LIMITS = [
  ['maxVaults', ['Coffres par compte', 'Vaults per account']],
  ['maxCredentialsPerVault', ['Identifiants par coffre', 'Credentials per vault']],
  ['maxTasksPerVault', ['Tâches par coffre', 'Tasks per vault']],
  ['maxTitleLength', ['Caractères d’un nom', 'Name length']],
  ['maxUsernameLength', ['Caractères d’un identifiant', 'Username length']],
  ['maxPasswordLength', ['Caractères d’un mot de passe', 'Password length']],
  ['maxUrlLength', ['Caractères d’une URL', 'URL length']],
  ['maxNoteLength', ['Caractères d’une note', 'Note length']],
  ['maxCustomFields', ['Champs personnalisés', 'Custom fields']],
  ['maxTagsPerItem', ['Tags par élément', 'Tags per item']],
  ['maxVaultMb', ['Taille d’un coffre (Mo)', 'Vault size (MB)']],
  ['maxAttachmentMb', ['Taille d’une pièce jointe (Mo)', 'Attachment size (MB)']],
  ['attachmentQuotaMb', ['Espace fichiers par compte (Mo)', 'File space per account (MB)']],
  ['maxVaultTypes', ['Types de coffres', 'Vault types']],
  ['maxMembersPerSharedVault', ['Membres par coffre partagé', 'Members per shared vault']],
  ['maxRolesPerSharedVault', ['Rôles par coffre partagé', 'Roles per shared vault']]
];

/** Limites saisies en Mo dans la page, stockées en octets */
const MB_FIELDS = { maxVaultMb: 'maxVaultBytes', maxAttachmentMb: 'maxAttachmentBytes', attachmentQuotaMb: 'attachmentQuotaBytes' };

const $ = id => document.getElementById(id);
const TOKEN_KEY = 'bettervault-admin-token';
let token = sessionStorage.getItem(TOKEN_KEY) ?? '';

document.documentElement.lang = fr ? 'fr' : 'en';
document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
$('limits').innerHTML = LIMITS.map(([key, labels]) => `
  <div><label for="limit-${key}">${labels[fr ? 0 : 1]}</label><input id="limit-${key}" type="number" min="1" required></div>`).join('');

async function api(method, path, body) {
  const response = await fetch(`/api/v1/admin/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (response.status === 204) return null;
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(json?.error?.message ?? `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return json;
}

const formatBytes = bytes => bytes < 1048576 ? `${(bytes / 1024).toFixed(0)} Ko` : `${(bytes / 1048576).toFixed(1)} Mo`;

function setStatus(el, text, kind) {
  el.textContent = text;
  el.className = `status ${kind ?? ''}`;
}

function fill({ settings }) {
  fillBilling(settings.billing ?? { enabled: false, plans: [] });
  fillLegal(settings.legal ?? {});

  $('publicUrl').value = settings.publicUrl ?? '';
  $('registrationOpen').checked = settings.registrationOpen;
  for (const [key] of LIMITS) {
    $(`limit-${key}`).value = MB_FIELDS[key] ? Math.round(settings.limits[MB_FIELDS[key]] / 1048576) : settings.limits[key];
  }
  const backup = settings.backup ?? {};
  const s3 = backup.s3;
  $('backupEnabled').checked = !!backup.enabled;
  $('backupInterval').value = backup.intervalHours ?? 24;
  $('backupRetention').value = backup.retentionDays ?? 30;
  $('s3Endpoint').value = s3?.endpoint ?? '';
  $('s3Region').value = s3?.region ?? '';
  $('s3Bucket').value = s3?.bucket ?? '';
  $('s3Prefix').value = s3?.prefix ?? '';
  $('s3Access').value = s3?.accessKeyId ?? '';
  $('s3Secret').value = '';
  $('s3Secret').placeholder = s3?.hasSecret ? t('secretKept') : '';
  $('s3PathStyle').checked = s3 ? s3.pathStyle !== false : true;
  const smtp = settings.smtp;
  $('smtpHost').value = smtp?.host ?? '';
  $('smtpPort').value = smtp?.port ?? 587;
  $('smtpSecurity').value = smtp?.security ?? 'starttls';
  $('smtpUser').value = smtp?.user ?? '';
  $('smtpPassword').value = '';
  $('smtpPassword').placeholder = smtp?.hasPassword ? t('passwordKept') : '';
  $('smtpFrom').value = smtp?.from ?? '';
  $('smtpAllowInvalid').checked = !!smtp?.allowInvalidCertificate;
}

async function load() {
  try {
    fill(await api('GET', 'settings'));
    $('login-card').hidden = true;
    $('dashboard').hidden = false;
    $('logout').hidden = false;
    void loadOverview();
  } catch (err) {
    sessionStorage.removeItem(TOKEN_KEY);
    token = '';
    $('login-card').hidden = false;
    $('dashboard').hidden = true;
    $('logout').hidden = true;
    if (err.status === 401) {
      $('login-error').textContent = t('wrongToken');
      $('login-error').hidden = false;
    }
  }
}

$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('login-error').hidden = true;
  token = $('token').value.trim();
  sessionStorage.setItem(TOKEN_KEY, token);
  await load();
});

$('logout').addEventListener('click', () => {
  sessionStorage.removeItem(TOKEN_KEY);
  location.reload();
});

$('settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  const limits = {};
  for (const [key] of LIMITS) {
    const value = Number($(`limit-${key}`).value);
    if (MB_FIELDS[key]) limits[MB_FIELDS[key]] = value * 1048576;
    else limits[key] = value;
  }
  const s3Endpoint = $('s3Endpoint').value.trim();
  const backup = {
    enabled: $('backupEnabled').checked,
    intervalHours: Number($('backupInterval').value),
    retentionDays: Number($('backupRetention').value),
    s3: s3Endpoint ? {
      endpoint: s3Endpoint,
      region: $('s3Region').value,
      bucket: $('s3Bucket').value,
      prefix: $('s3Prefix').value,
      accessKeyId: $('s3Access').value,
      secretAccessKey: $('s3Secret').value,
      pathStyle: $('s3PathStyle').checked
    } : null
  };
  const host = $('smtpHost').value.trim();
  const body = {
    publicUrl: $('publicUrl').value,
    registrationOpen: $('registrationOpen').checked,
    limits,
    backup,
    billing: readBilling(),
    legal: readLegal(),
    smtp: host ? {
      host,
      port: Number($('smtpPort').value),
      security: $('smtpSecurity').value,
      user: $('smtpUser').value,
      password: $('smtpPassword').value,
      from: $('smtpFrom').value,
      allowInvalidCertificate: $('smtpAllowInvalid').checked
    } : null
  };
  const button = event.submitter;
  button.disabled = true;
  try {
    await api('PUT', 'settings', body);
    fill(await api('GET', 'settings'));
    setStatus($('save-status'), t('saved'), 'ok');
  } catch (err) {
    setStatus($('save-status'), err.message, 'fail');
  } finally {
    button.disabled = false;
  }
});

$('smtp-test').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  setStatus($('smtp-status'), t('sending'));
  try {
    await api('POST', 'smtp-test', { to: $('testTo').value, locale: fr ? 'fr' : 'en' });
    setStatus($('smtp-status'), t('testSent'), 'ok');
  } catch (err) {
    setStatus($('smtp-status'), err.status === 400 ? `${err.message} — ${t('saveFirst')}` : err.message, 'fail');
  } finally {
    button.disabled = false;
  }
});

async function loadBackups() {
  try {
    const info = await api('GET', 'backup');
    $('backup-encryption').textContent = info.encrypted ? t('encryptedOn') : t('encryptedOff');
    $('backup-encryption').className = `status ${info.encrypted ? 'ok' : 'fail'}`;
    const locale = fr ? 'fr-FR' : 'en-GB';
    $('backup-runs').innerHTML = info.runs.length === 0
      ? `<p class="hint">${t('noRuns')}</p>`
      : info.runs.map(run => `
        <div class="run">
          <span>${new Date(run.startedAt).toLocaleString(locale)}</span>
          <span class="${run.status === 'success' ? 'ok' : run.status === 'error' ? 'fail' : ''}">${run.status}${run.bytes ? ` · ${formatBytes(run.bytes)}` : ''}</span>
          <span class="muted">${run.message ? run.message.replace(/</g, '&lt;') : run.files ? `+${run.files} fichier(s)` : ''}</span>
        </div>`).join('');
  } catch {
    $('backup-runs').innerHTML = '';
  }
}

$('backup-test').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  setStatus($('backup-status'), t('testing'));
  try {
    await api('POST', 'backup/test');
    setStatus($('backup-status'), t('storageOk'), 'ok');
  } catch (err) {
    setStatus($('backup-status'), err.status === 400 || err.status === 502 ? `${err.message} — ${t('saveFirst')}` : err.message, 'fail');
  } finally {
    button.disabled = false;
  }
});

$('backup-run').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  setStatus($('backup-status'), t('running'));
  try {
    await api('POST', 'backup/run');
    setStatus($('backup-status'), t('backupDone'), 'ok');
  } catch (err) {
    setStatus($('backup-status'), err.message, 'fail');
  } finally {
    button.disabled = false;
    void loadBackups();
  }
});

const originalFill = fill;
fill = data => {
  originalFill(data);
  void loadBackups();
};

/* ── Onglets ─────────────────────────────────────────────────────────── */
const FORM_TABS = new Set(['settings', 'billing', 'legal']);
document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
  const name = tab.dataset.tab;
  document.querySelectorAll('.tab').forEach(other => other.classList.toggle('active', other === tab));
  document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
  $('save-bar').hidden = !FORM_TABS.has(name);
  if (name === 'overview') void loadOverview();
  if (name === 'audit') void loadAudit();
}));

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const locale = fr ? 'fr-FR' : 'en-GB';
const bytes = value => {
  if (!value) return fr ? '0 o' : '0 B';
  const units = fr ? ['o', 'Ko', 'Mo', 'Go', 'To'] : ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** i).toLocaleString(locale, { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`;
};
const duration = seconds => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d ? `${d} j ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
};

/** Histogramme SVG simple, sans bibliothèque */
function bars(values, { height = 64, labels = [], color = 'var(--accent)', errors = [] } = {}) {
  const max = Math.max(1, ...values);
  const width = 100 / values.length;
  return `<svg class="chart" viewBox="0 0 100 ${height}" preserveAspectRatio="none" role="img">
    ${values.map((v, i) => {
      const h = (v / max) * (height - 2);
      const e = errors[i] ? (errors[i] / max) * (height - 2) : 0;
      return `<rect x="${i * width + width * 0.12}" y="${height - h}" width="${width * 0.76}" height="${h}" fill="${color}" rx="0.4"><title>${escapeHtml(labels[i] ?? '')} : ${v}</title></rect>${e ? `<rect x="${i * width + width * 0.12}" y="${height - e}" width="${width * 0.76}" height="${e}" fill="var(--danger)"/>` : ''}`;
    }).join('')}
  </svg>`;
}

const meter = (used, total) => `<div class="meter"><span style="width:${total ? Math.min(100, (used / total) * 100).toFixed(1) : 0}%"></span></div>`;
const kv = rows => `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;

async function loadOverview() {
  $('stats').innerHTML = '<div class="stat skeleton"></div>'.repeat(4);
  let data;
  try {
    data = await api('GET', 'dashboard');
  } catch (err) {
    $('stats').innerHTML = `<p class="status fail">${escapeHtml(err.message)}</p>`;
    return;
  }
  const { analytics: a, system: s, security, version } = data;
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

  $('stats').innerHTML = [
    [a.users.total.toLocaleString(locale), t('users')],
    [a.users.active7d.toLocaleString(locale), fr ? 'Actifs sur 7 jours' : 'Active in 7 days'],
    [`${pct(a.users.withTwoFactor, a.users.total)} %`, t('twoFactor')],
    [bytes(a.storage.vaultBytes + a.storage.sharedVaultBytes + a.storage.attachmentBytes), fr ? 'Données chiffrées' : 'Encrypted data'],
    [version, t('version')]
  ].map(([value, label]) => `<div class="stat"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`).join('');

  const days = a.users.signupsPerDay.map((_, i) => new Date(Date.now() - (29 - i) * 86_400_000).toLocaleDateString(locale, { day: 'numeric', month: 'short' }));
  $('activity').innerHTML = kv([
    [fr ? 'Actifs sur 24 h' : 'Active in 24 h', a.users.active24h],
    [fr ? 'Actifs sur 30 jours' : 'Active in 30 days', a.users.active30d],
    [fr ? 'Sessions ouvertes' : 'Open sessions', a.sessions.active],
    [fr ? 'Avec clé de secours' : 'With recovery key', `${pct(a.users.withRecoveryKey, a.users.total)} %`],
    [fr ? 'Coffres partagés' : 'Shared vaults', a.storage.sharedVaults],
    [fr ? 'Abonnements actifs' : 'Active subscriptions', a.billing.activeSubscriptions]
  ]) + `<p class="chart-title">${fr ? 'Inscriptions, 30 derniers jours' : 'Sign-ups, last 30 days'}</p>${bars(a.users.signupsPerDay, { labels: days })}`;

  const disk = a.storage.disk;
  $('storage').innerHTML = kv([
    [fr ? 'Coffres personnels' : 'Personal vaults', bytes(a.storage.vaultBytes)],
    [fr ? 'Coffres partagés' : 'Shared vaults', bytes(a.storage.sharedVaultBytes)],
    [fr ? 'Pièces jointes' : 'Attachments', `${bytes(a.storage.attachmentBytes)} · ${a.storage.attachments}`],
    [fr ? 'Fichier de base' : 'Database file', bytes(a.storage.databaseBytes)]
  ]) + (disk ? `<p class="chart-title">${fr ? 'Disque' : 'Disk'} · ${bytes(disk.totalBytes - disk.freeBytes)} / ${bytes(disk.totalBytes)}</p>${meter(disk.totalBytes - disk.freeBytes, disk.totalBytes)}` : '');

  if (s) {
    const minutes = s.requests.lastHour.map(b => new Date(b.minute).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }));
    $('performance').innerHTML = `
      <div class="perf">
        ${kv([
          [fr ? 'En service depuis' : 'Uptime', duration(s.uptimeSeconds)],
          ['CPU', `${s.cpu.processPercent} % · ${s.cpu.cores} ${fr ? 'cœurs' : 'cores'}`],
          [fr ? 'Mémoire du serveur' : 'Server memory', bytes(s.memory.rssBytes)],
          [fr ? 'Mémoire système libre' : 'Free system memory', `${bytes(s.memory.systemFreeBytes)} / ${bytes(s.memory.systemTotalBytes)}`],
          [fr ? 'Latence (p50 / p95 / p99)' : 'Latency (p50 / p95 / p99)', `${s.requests.latencyMs.p50} / ${s.requests.latencyMs.p95} / ${s.requests.latencyMs.p99} ms`],
          [fr ? 'Retard de la boucle (p99)' : 'Event loop lag (p99)', `${s.eventLoopLagMs.p99} ms`],
          [fr ? 'Requêtes depuis le démarrage' : 'Requests since start', `${s.requests.total.toLocaleString(locale)} · ${s.requests.errorRate} % ${fr ? 'erreurs' : 'errors'}`]
        ])}
        <div>
          <p class="chart-title">${fr ? 'Requêtes par minute, dernière heure' : 'Requests per minute, last hour'}</p>
          ${bars(s.requests.lastHour.map(b => b.count), { labels: minutes, errors: s.requests.lastHour.map(b => b.errors) })}
          <div class="table-wrap"><table class="audit compact"><thead><tr><th>Route</th><th>${fr ? 'Appels' : 'Calls'}</th><th>${fr ? 'Moyenne' : 'Average'}</th></tr></thead>
          <tbody>${s.requests.topRoutes.map(r => `<tr><td><code>${escapeHtml(r.route)}</code></td><td>${r.count}</td><td>${r.avgMs} ms</td></tr>`).join('')}</tbody></table></div>
        </div>
      </div>`;
  }

  const checks = [
    [location.protocol === 'https:', fr ? 'Page servie en HTTPS' : 'Page served over HTTPS'],
    [security.backupEncrypted, fr ? 'Sauvegardes chiffrées (BACKUP_ENCRYPTION_KEY)' : 'Encrypted backups (BACKUP_ENCRYPTION_KEY)'],
    [data.backups.enabled, fr ? 'Sauvegardes automatiques activées' : 'Automatic backups on'],
    [security.emailEnabled, fr ? 'Emails de sécurité (SMTP)' : 'Security emails (SMTP)'],
    [security.legalConfigured, fr ? 'Documents légaux complétés' : 'Legal documents filled in'],
    [security.geoEnabled, fr ? 'Lieu des sessions (base locale)' : 'Session location (local database)'],
    [!security.registrationOpen, fr ? 'Inscriptions fermées (serveur privé)' : 'Registration closed (private server)']
  ];
  $('checks').innerHTML = checks.map(([ok, label]) => `<li class="${ok ? 'ok' : 'todo'}">${label}</li>`).join('');
}

$('refresh-overview').addEventListener('click', () => void loadOverview());

$('download-backup').addEventListener('click', async event => {
  const button = event.currentTarget;
  const passphrase = $('download-passphrase').value;
  button.disabled = true;
  setStatus($('download-status'), t('preparing'));
  try {
    const response = await fetch('/api/v1/admin/backup/download', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase })
    });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error?.message ?? `HTTP ${response.status}`);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `bettervault-${new Date().toISOString().slice(0, 10)}.db.gz.enc`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    $('download-passphrase').value = '';
    setStatus($('download-status'), t('downloaded'), 'ok');
  } catch (err) {
    setStatus($('download-status'), err.message, 'fail');
  } finally {
    button.disabled = false;
  }
});

/* ── Offres ──────────────────────────────────────────────────────────── */
const BOOSTS = [
  ['attachmentQuotaBytes', fr ? 'Espace fichiers en plus (Go)' : 'Extra file space (GB)', 1073741824],
  ['maxAttachmentBytes', fr ? 'Taille de fichier en plus (Mo)' : 'Extra file size (MB)', 1048576],
  ['maxVaultBytes', fr ? 'Taille de coffre en plus (Mo)' : 'Extra vault size (MB)', 1048576],
  ['maxVaults', fr ? 'Coffres en plus' : 'Extra vaults', 1],
  ['maxCredentialsPerVault', fr ? 'Identifiants par coffre en plus' : 'Extra credentials per vault', 1]
];

function planRow(plan = {}) {
  const row = document.createElement('div');
  row.className = 'plan';
  row.innerHTML = `
    <div class="row">
      <div class="small"><label>${fr ? 'Identifiant' : 'ID'}</label><input data-plan="id" value="${escapeHtml(plan.id)}" placeholder="plus" pattern="[a-z0-9-]{2,32}"></div>
      <div><label>${fr ? 'Nom' : 'Name'}</label><input data-plan="name" value="${escapeHtml(plan.name)}" maxlength="60"></div>
      <div class="small"><label>${fr ? 'Prix affiché' : 'Price label'}</label><input data-plan="priceLabel" value="${escapeHtml(plan.priceLabel)}" placeholder="2 € / mois"></div>
    </div>
    <div class="row">
      <div><label>${fr ? 'Prix Stripe' : 'Stripe price'}</label><input data-plan="stripePriceId" value="${escapeHtml(plan.stripePriceId)}" placeholder="price_…"></div>
      <div class="small"><label>${fr ? 'Paiement' : 'Billing'}</label><select data-plan="mode"><option value="subscription">${fr ? 'Abonnement' : 'Subscription'}</option><option value="payment" ${plan.mode === 'payment' ? 'selected' : ''}>${fr ? 'Une fois' : 'One-time'}</option></select></div>
    </div>
    <label>${fr ? 'Description' : 'Description'}</label><input data-plan="description" value="${escapeHtml(plan.description)}" maxlength="300">
    <div class="limits">${BOOSTS.map(([key, label, unit]) => `<div><label>${label}</label><input type="number" min="0" data-boost="${key}" data-unit="${unit}" value="${plan.boosts?.[key] ? plan.boosts[key] / unit : ''}"></div>`).join('')}</div>
    <div class="row test"><button type="button" class="btn ghost" data-remove>${fr ? 'Retirer cette offre' : 'Remove this plan'}</button></div>`;
  row.querySelector('[data-remove]').addEventListener('click', () => {
    row.remove();
    renderEmptyPlans();
  });
  return row;
}

function renderEmptyPlans() {
  const list = $('plans');
  const empty = list.querySelector('.empty');
  if (!list.querySelector('.plan') && !empty) list.insertAdjacentHTML('beforeend', `<p class="hint empty">${t('noPlans')}</p>`);
  if (list.querySelector('.plan') && empty) empty.remove();
}

function fillBilling(billing) {
  $('webhook-url').textContent = `${location.origin}/api/v1/billing/webhook`;
  $('billingEnabled').checked = !!billing.enabled;
  $('stripeSecret').value = '';
  $('stripeSecret').placeholder = billing.hasSecretKey ? t('secretKept') : 'sk_live_…';
  $('stripeWebhook').value = '';
  $('stripeWebhook').placeholder = billing.hasWebhookSecret ? t('secretKept') : 'whsec_…';
  $('plans').innerHTML = '';
  for (const plan of billing.plans ?? []) $('plans').appendChild(planRow(plan));
  renderEmptyPlans();
}

function readBilling() {
  return {
    enabled: $('billingEnabled').checked,
    stripeSecretKey: $('stripeSecret').value.trim(),
    stripeWebhookSecret: $('stripeWebhook').value.trim(),
    plans: [...document.querySelectorAll('#plans .plan')].map(row => {
      const field = name => row.querySelector(`[data-plan="${name}"]`).value.trim();
      const boosts = {};
      row.querySelectorAll('[data-boost]').forEach(input => {
        if (input.value) boosts[input.dataset.boost] = Math.round(Number(input.value) * Number(input.dataset.unit));
      });
      return { id: field('id'), name: field('name'), priceLabel: field('priceLabel'), stripePriceId: field('stripePriceId'), mode: field('mode'), description: field('description'), boosts };
    })
  };
}

$('add-plan').addEventListener('click', () => {
  $('plans').appendChild(planRow());
  renderEmptyPlans();
});

/* ── Documents légaux ────────────────────────────────────────────────── */
const LEGAL_FIELDS = [
  ['operatorName', fr ? 'Nom ou raison sociale' : 'Name or company'],
  ['operatorAddress', fr ? 'Adresse' : 'Address'],
  ['contactEmail', fr ? 'Email de contact' : 'Contact email'],
  ['dpoContact', fr ? 'Délégué à la protection des données (facultatif)' : 'Data protection officer (optional)'],
  ['hostingProvider', fr ? 'Hébergeur (ex. OVHcloud, Scaleway)' : 'Hosting provider (e.g. OVHcloud, Scaleway)'],
  ['hostingLocation', fr ? 'Pays ou région des serveurs' : 'Server country or region'],
  ['supervisoryAuthority', fr ? 'Autorité de contrôle' : 'Supervisory authority'],
  ['jurisdiction', fr ? 'Droit applicable' : 'Governing law'],
  ['effectiveDate', fr ? 'Date d’entrée en vigueur' : 'Effective date']
];
$('legal-fields').innerHTML = LEGAL_FIELDS.map(([key, label]) => `
  <div><label for="legal-${key}">${label}</label><input id="legal-${key}" ${key === 'effectiveDate' ? 'type="date"' : key === 'contactEmail' ? 'type="email"' : ''} maxlength="500"></div>`).join('');
$('legal-preview').innerHTML = ['terms', 'privacy', 'dpa', 'security', 'subprocessors']
  .map(slug => `<a href="/legal/${slug}" target="_blank" rel="noopener">/legal/${slug}</a>`).join('');

function fillLegal(legal) {
  for (const [key] of LEGAL_FIELDS) $(`legal-${key}`).value = legal[key] ?? '';
}

function readLegal() {
  return Object.fromEntries(LEGAL_FIELDS.map(([key]) => [key, $(`legal-${key}`).value.trim()]));
}

/* ── Journal ─────────────────────────────────────────────────────────── */
async function loadAudit() {
  const tbody = $('audit-rows');
  tbody.innerHTML = '<tr><td colspan="4"><div class="skeleton line"></div></td></tr>';
  try {
    const { events } = await api('GET', 'audit');
    tbody.innerHTML = events.length === 0
      ? `<tr><td colspan="4" class="muted">${fr ? 'Aucun événement' : 'No events'}</td></tr>`
      : events.map(e => `
        <tr>
          <td class="nowrap">${new Date(e.at).toLocaleString(locale)}</td>
          <td><code>${escapeHtml(e.type)}</code></td>
          <td>${e.subject ? `<code>${escapeHtml(e.subject)}</code>` : '<span class="muted">—</span>'}</td>
          <td class="muted">${escapeHtml(Object.entries(e.detail ?? {}).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · '))}</td>
        </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="status fail">${escapeHtml(err.message)}</td></tr>`;
  }
}

$('refresh-audit').addEventListener('click', () => void loadAudit());

if (token) void load();
