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
  secretKept: ['Laisser vide pour garder la clé actuelle', 'Leave empty to keep the current key']
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
  ['attachmentQuotaMb', ['Espace fichiers par compte (Mo)', 'File space per account (MB)']]
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

function fill({ settings, stats, version }) {
  $('stats').innerHTML = [
    [stats.users, t('users')],
    [stats.twoFactorUsers, t('twoFactor')],
    [formatBytes(stats.storedBytes), t('storage')],
    [version, t('version')]
  ].map(([value, label]) => `<div class="stat"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`).join('');

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

if (token) void load();
