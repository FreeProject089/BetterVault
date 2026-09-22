// Page d'administration du serveur BetterVault (aucune dépendance)

const fr = navigator.language.toLowerCase().startsWith('fr');
const TEXT = {
  admin: ['Administration', 'Administration'],
  logout: ['Se déconnecter', 'Sign out'],
  loginTitle: ['Connexion administrateur', 'Administrator sign-in'],
  loginHelp: ['Affiché dans les journaux du serveur au premier démarrage, ou défini par ADMIN_TOKEN. Sert à créer le premier compte et à dépanner.', 'Printed in the server logs on first start, or set with ADMIN_TOKEN. Used to create the first account and for recovery.'],
  token: ['Jeton de secours (ADMIN_TOKEN)', 'Recovery token (ADMIN_TOKEN)'],
  email: ['Email', 'Email'],
  password: ['Mot de passe', 'Password'],
  totpCode: ['Code de l’application d’authentification', 'Authenticator app code'],
  useToken: ['Utiliser le jeton de secours', 'Use the recovery token'],
  useAccount: ['Se connecter avec un compte', 'Sign in with an account'],
  wrongCredentials: ['Email, mot de passe ou code incorrect', 'Wrong email, password or code'],
  tabAdmins: ['Administrateurs', 'Administrators'],
  tabCluster: ['Grappe', 'Cluster'],
  groupOverview: ['Aperçu', 'Overview'],
  groupConfig: ['Configuration', 'Configuration'],
  groupInfra: ['Infrastructure', 'Infrastructure'],
  groupAccess: ['Accès', 'Access'],
  docs: ['Documentation', 'Documentation'],
  adminsTitle: ['Administrateurs', 'Administrators'],
  adminsHint: ['Lecteur : consulter. Opérateur : lancer synchronisations, sauvegardes et tests. Propriétaire : tout, dont réglages, nœuds, secrets et restaurations.', 'Viewer: read only. Operator: run syncs, backups and tests. Owner: everything, including settings, nodes, secrets and restores.'],
  roleViewer: ['Lecteur', 'Viewer'],
  roleOperator: ['Opérateur', 'Operator'],
  roleOwner: ['Propriétaire', 'Owner'],
  tempPassword: ['Mot de passe provisoire (12 caractères min.)', 'Temporary password (12+ characters)'],
  add: ['Ajouter', 'Add'],
  myAccount: ['Mon compte', 'My account'],
  newPassword: ['Nouveau mot de passe', 'New password'],
  changePassword: ['Changer le mot de passe', 'Change password'],
  reauthTitle: ['Confirmez votre identité', 'Confirm it’s you'],
  reauthHint: ['Cette action est sensible : ressaisissez votre mot de passe.', 'This action is sensitive: enter your password again.'],
  cancel: ['Annuler', 'Cancel'],
  confirm: ['Confirmer', 'Confirm'],
  breakGlassWarning: ['Le jeton de secours ADMIN_TOKEN est encore actif alors que des comptes existent. Une fois un propriétaire créé, passez ADMIN_TOKEN=disabled.', 'The ADMIN_TOKEN recovery token is still active while accounts exist. Once an owner exists, set ADMIN_TOKEN=disabled.'],
  signIn: ['Se connecter', 'Sign in'],
  general: ['Général', 'General'],
  publicUrl: ['Adresse publique', 'Public address'],
  publicUrlHint: ['Affichée dans les emails envoyés aux utilisateurs.', 'Shown in emails sent to users.'],
  registrationOpen: ['Inscriptions ouvertes', 'Registration open'],
  attachmentsEnabled: ['Accepter les fichiers joints', 'Accept file attachments'],
  publicPage: ['Page publique et annuaire', 'Public page and directory'],
  landingEnabled: ['Page de présentation publique (/about)', 'Public presentation page (/about)'],
  landingTitle: ['Titre', 'Title'],
  landingDescription: ['Présentation', 'Description'],
  landingOpen: ['Voir la page', 'View the page'],
  directoryEnabled: ['Proposer d’autres serveurs dans l’application', 'Suggest other servers in the app'],
  directoryServers: ['Serveurs proposés, un par ligne', 'Suggested servers, one per line'],
  directoryHint: ['Nom | adresse https | région | « officiel » (facultatif). Chaque serveur a ses propres comptes : rien n’est partagé entre eux.', 'Name | https address | region | “official” (optional). Each server has its own accounts: nothing is shared between them.'],
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
  backupHint: ['Copie chiffrée de la base et des fichiers vers un stockage S3.', 'Encrypted copy of the database and files to S3-compatible storage.'],
  learnMore: ['En savoir plus', 'Learn more'],
  backupEnabled: ['Sauvegardes automatiques', 'Automatic backups'],
  backupInterval: ['Toutes les (heures)', 'Every (hours)'],
  backupRetention: ['Conservation (jours)', 'Retention (days)'],
  backupWhere: ['Les destinations, l’historique et les restaurations se gèrent dans l’onglet Sauvegardes.', 'Destinations, history and restores are managed in the Backups tab.'],
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
  clusterTitle: ['Grappe de serveurs', 'Server cluster'],
  clusterSync: ['Synchroniser', 'Sync now'],
  downloadTitle: ['Copie chiffrée de la base', 'Encrypted database copy'],
  downloadHint: ['Base compressée puis chiffrée (AES-256-GCM). Les coffres restent illisibles sans les mots de passe.', 'Database compressed then encrypted (AES-256-GCM). Vaults stay unreadable without the users’ passwords.'],
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
  durations: ['Durées proposées', 'Available durations'],
  addDuration: ['Ajouter une durée', 'Add a duration'],
  durationsHint: ['Une durée par tarif Stripe : mensuel, annuel… Le compte choisit au moment de payer.', 'One duration per Stripe price: monthly, yearly… The account picks one at checkout.'],
  legalTitle: ['Identité de l’hébergeur', 'Operator identity'],
  legalHint: ['Ces informations complètent les documents publiés sur /legal. Vous restez responsable de leur contenu.', 'This information fills in the documents published on /legal. You remain responsible for their content.'],
  legalEnabled: ['Publier des documents légaux sur ce serveur', 'Publish legal documents on this server'],
  legalDisabledHint: ['Décoché, /legal répond 404 et l’application ne demande plus d’accepter de conditions. À réserver à un serveur personnel, sans autre utilisateur.', 'Unchecked, /legal returns 404 and the app no longer asks anyone to accept terms. For a personal server with no other users.'],
  auditTitle: ['Journal de sécurité', 'Security log'],
  auditHint: ['Conservé 90 jours. Les comptes sont désignés par un pseudonyme (HMAC) : on peut relier des événements sans connaître l’adresse email.', 'Kept 90 days. Accounts are shown as a pseudonym (HMAC): events can be linked without knowing the email address.'],
  when: ['Date', 'Date'],
  event: ['Événement', 'Event'],
  subject: ['Compte', 'Account'],
  detail: ['Détails', 'Details'],
  avatarUploads: ['Autoriser l’envoi d’une photo de profil', 'Allow profile picture uploads'],
  avatarUrls: ['Autoriser un lien vers une image (https)', 'Allow a link to an image (https)']
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
  ['maxRolesPerSharedVault', ['Rôles par coffre partagé', 'Roles per shared vault']],
  ['maxAvatarKb', ['Photo de profil (Ko)', 'Profile picture (KB)']]
];

/** Limites saisies en Mo dans la page, stockées en octets */
const MB_FIELDS = { maxVaultMb: 'maxVaultBytes', maxAttachmentMb: 'maxAttachmentBytes', attachmentQuotaMb: 'attachmentQuotaBytes' };
/** Limites saisies en Ko */
const KB_FIELDS = { maxAvatarKb: 'maxAvatarBytes' };

const $ = id => document.getElementById(id);
const TOKEN_KEY = 'bettervault-admin-token';
let token = sessionStorage.getItem(TOKEN_KEY) ?? '';

document.documentElement.lang = fr ? 'fr' : 'en';
document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
$('limits').innerHTML = LIMITS.map(([key, labels]) => `
  <div><label for="limit-${key}">${labels[fr ? 0 : 1]}</label><input id="limit-${key}" type="number" min="1" required></div>`).join('');

async function api(method, path, body, retried = false) {
  const response = await fetch(`/api/v1/admin/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (response.status === 204) return null;
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    // Action sensible : on redemande le mot de passe, puis on rejoue une seule fois
    if (json?.error?.code === 'reauth_required' && !retried && await askReauth()) return api(method, path, body, true);
    const error = new Error(json?.error?.message ?? `HTTP ${response.status}`);
    error.status = response.status;
    error.code = json?.error?.code;
    throw error;
  }
  return json;
}

/** Demande le mot de passe (et le code 2FA si besoin) ; vrai si la reconfirmation a réussi */
function askReauth() {
  const dialog = $('reauth-dialog');
  const form = $('reauth-form');
  const error = $('reauth-error');
  const totp = $('reauth-totp');
  error.hidden = true;
  $('reauth-password').value = '';
  totp.value = '';
  totp.hidden = !me?.totpEnabled;
  dialog.showModal();
  $('reauth-password').focus();
  return new Promise(resolve => {
    const close = ok => {
      form.removeEventListener('submit', submit);
      $('reauth-cancel').removeEventListener('click', cancel);
      dialog.close();
      resolve(ok);
    };
    const cancel = () => close(false);
    const submit = async event => {
      event.preventDefault();
      const response = await fetch('/api/v1/admin/reauth', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: $('reauth-password').value, totp: totp.value || undefined })
      });
      if (response.ok) return close(true);
      const json = await response.json().catch(() => null);
      if (json?.error?.code === 'totp_required') totp.hidden = false;
      error.textContent = json?.error?.message ?? t('wrongCredentials');
      error.hidden = false;
    };
    form.addEventListener('submit', submit);
    $('reauth-cancel').addEventListener('click', cancel);
  });
}

/* ── Rôle de l'administrateur connecté ─────────────────────────────────── */
let me = null;
const PERMISSIONS = { viewer: ['view'], operator: ['view', 'operate'], owner: ['view', 'operate', 'manage'] };
const can = permission => !!me && PERMISSIONS[me.role]?.includes(permission);

/** Ce que le rôle ne permet pas n'est pas proposé : pas de bouton qui mène à un refus */
function applyRole() {
  document.querySelectorAll('[data-requires]').forEach(el => { el.hidden = !can(el.dataset.requires); });
  document.querySelectorAll('#settings-form input, #settings-form select, #settings-form textarea, #save-bar button')
    .forEach(el => { el.disabled = !can('manage'); });
  $('break-glass-warning').hidden = !(me?.breakGlassActive && me.accounts > 0);
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
  $('attachmentsEnabled').checked = settings.attachmentsEnabled !== false;
  const page = settings.publicPage ?? {};
  $('landingEnabled').checked = page.landingEnabled !== false;
  $('landingTitle').value = page.title ?? '';
  $('landingDescription').value = page.description ?? '';
  $('directoryEnabled').checked = !!page.directoryEnabled;
  $('directoryServers').value = (page.servers ?? []).map(s => [s.name, s.url, s.region, s.official ? (fr ? 'officiel' : 'official') : ''].filter((v, i) => i < 3 || v).join(' | ')).join('\n');
  for (const [key] of LIMITS) {
    $(`limit-${key}`).value = MB_FIELDS[key]
      ? Math.round(settings.limits[MB_FIELDS[key]] / 1048576)
      : KB_FIELDS[key] ? Math.round(settings.limits[KB_FIELDS[key]] / 1024) : settings.limits[key];
  }
  $('avatarUploads').checked = settings.avatars?.uploads !== false;
  $('avatarUrls').checked = settings.avatars?.remoteUrls !== false;
  const backup = settings.backup ?? {};
  $('backupEnabled').checked = !!backup.enabled;
  $('backupInterval').value = backup.intervalHours ?? 24;
  $('backupRetention').value = backup.retentionDays ?? 30;
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
    me = await api('GET', 'me');
    applyRole();
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

let tokenMode = false;
$('login-mode').addEventListener('click', () => {
  tokenMode = !tokenMode;
  $('login-account').hidden = tokenMode;
  $('login-token-row').hidden = !tokenMode;
  $('login-mode').textContent = t(tokenMode ? 'useAccount' : 'useToken');
});

$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('login-error').hidden = true;
  if (tokenMode) {
    token = $('token').value.trim();
  } else {
    const response = await fetch('/api/v1/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('login-email').value, password: $('login-password').value, totp: $('login-totp').value || undefined })
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      if (json?.error?.code === 'totp_required') {
        $('login-totp-row').hidden = false;
        $('login-totp').focus();
      }
      $('login-error').textContent = json?.error?.message ?? t('wrongCredentials');
      $('login-error').hidden = false;
      return;
    }
    token = json.token;
  }
  sessionStorage.setItem(TOKEN_KEY, token);
  await load();
});

$('logout').addEventListener('click', async () => {
  await fetch('/api/v1/admin/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  sessionStorage.removeItem(TOKEN_KEY);
  location.reload();
});

$('settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  const limits = {};
  for (const [key] of LIMITS) {
    const value = Number($(`limit-${key}`).value);
    if (MB_FIELDS[key]) limits[MB_FIELDS[key]] = value * 1048576;
    else if (KB_FIELDS[key]) limits[KB_FIELDS[key]] = value * 1024;
    else limits[key] = value;
  }
  const backup = {
    enabled: $('backupEnabled').checked,
    intervalHours: Number($('backupInterval').value),
    retentionDays: Number($('backupRetention').value)
  };
  const host = $('smtpHost').value.trim();
  const body = {
    publicUrl: $('publicUrl').value,
    registrationOpen: $('registrationOpen').checked,
    attachmentsEnabled: $('attachmentsEnabled').checked,
    publicPage: {
      landingEnabled: $('landingEnabled').checked,
      title: $('landingTitle').value,
      description: $('landingDescription').value,
      directoryEnabled: $('directoryEnabled').checked,
      // Une ligne par serveur ; le serveur écarte ce qui n'est pas une adresse https valide
      servers: $('directoryServers').value.split('\n').map(line => line.split('|').map(part => part.trim())).filter(parts => parts[0] && parts[1])
        .map(([name, url, region = '', flag = '']) => ({ name, url, region, official: /^(officiel|official)$/i.test(flag) }))
    },
    limits,
    backup,
    avatars: { uploads: $('avatarUploads').checked, remoteUrls: $('avatarUrls').checked },
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

/* ── Onglets ─────────────────────────────────────────────────────────── */
const FORM_TABS = new Set(['settings', 'billing', 'legal']);
document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
  const name = tab.dataset.tab;
  document.querySelectorAll('.tab').forEach(other => other.classList.toggle('active', other === tab));
  document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
  $('save-bar').hidden = !FORM_TABS.has(name);
  if (name === 'overview') void loadOverview();
  if (name === 'audit') void loadAudit();
  if (name === 'admins') void loadAdmins();
  if (name === 'cluster') void loadCluster();
  if (name === 'backups') void loadBackups();
}));

/* ── Administrateurs ───────────────────────────────────────────────────── */
const ROLE_LABEL = { viewer: 'roleViewer', operator: 'roleOperator', owner: 'roleOwner' };

async function loadAdmins() {
  $('my-account-line').textContent = me?.breakGlass
    ? t('token')
    : `${me?.email ?? ''} · ${t(ROLE_LABEL[me?.role] ?? 'roleViewer')}`;
  $('my-password').hidden = !!me?.breakGlass;
  renderMyTotp();
  if (!can('manage')) return;
  const { accounts } = await api('GET', 'accounts');
  $('admin-list').innerHTML = accounts.map(a => `
    <li class="admin-row${a.disabled ? ' disabled' : ''}" data-id="${escapeHtml(a.id)}">
      <div class="admin-who">
        <strong>${escapeHtml(a.email)}</strong>
        <span class="hint">${a.totpEnabled ? '2FA ✓' : (fr ? 'Sans 2FA' : 'No 2FA')}${a.disabled ? ` · ${fr ? 'désactivé' : 'disabled'}` : ''}${a.lastLoginAt ? ` · ${new Date(a.lastLoginAt).toLocaleString(locale)}` : ''}</span>
      </div>
      <div class="admin-actions">
        <select data-role aria-label="${escapeHtml(t('tabAdmins'))}">
          ${['viewer', 'operator', 'owner'].map(r => `<option value="${r}" ${a.role === r ? 'selected' : ''}>${t(ROLE_LABEL[r])}</option>`).join('')}
        </select>
        <button class="btn" type="button" data-toggle>${a.disabled ? (fr ? 'Réactiver' : 'Enable') : (fr ? 'Désactiver' : 'Disable')}</button>
        ${a.totpEnabled ? `<button class="btn ghost" type="button" data-reset-totp>${fr ? 'Réinitialiser la 2FA' : 'Reset 2FA'}</button>` : ''}
        <button class="btn danger" type="button" data-delete>${fr ? 'Supprimer' : 'Delete'}</button>
      </div>
    </li>`).join('');
}

$('admin-list').addEventListener('change', async event => {
  const select = event.target.closest('[data-role]');
  if (!select) return;
  const id = select.closest('[data-id]').dataset.id;
  try {
    await api('PATCH', `accounts/${id}`, { role: select.value });
  } catch (err) {
    alert(err.message);
  }
  void loadAdmins();
});

$('admin-list').addEventListener('click', async event => {
  const row = event.target.closest('[data-id]');
  if (!row) return;
  const id = row.dataset.id;
  try {
    if (event.target.closest('[data-toggle]')) await api('PATCH', `accounts/${id}`, { disabled: !row.classList.contains('disabled') });
    else if (event.target.closest('[data-reset-totp]')) await api('PATCH', `accounts/${id}`, { resetTotp: true });
    else if (event.target.closest('[data-delete]')) {
      if (!confirm(fr ? 'Supprimer cet administrateur ?' : 'Delete this administrator?')) return;
      await api('DELETE', `accounts/${id}`);
    } else return;
  } catch (err) {
    alert(err.message);
  }
  void loadAdmins();
});

$('admin-add').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await api('POST', 'accounts', { email: $('admin-add-email').value, password: $('admin-add-password').value, role: $('admin-add-role').value });
    $('admin-add').reset();
    setStatus($('admin-add-status'), fr ? 'Administrateur ajouté. Transmettez-lui le mot de passe provisoire par un canal sûr.' : 'Administrator added. Share the temporary password over a safe channel.', 'ok');
    me = await api('GET', 'me');
    applyRole();
    void loadAdmins();
  } catch (err) {
    setStatus($('admin-add-status'), err.message, 'fail');
  }
});

$('my-password').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await api('POST', 'password', { password: $('my-password-new').value });
    $('my-password').reset();
    setStatus($('my-status'), fr ? 'Mot de passe changé. Vos autres sessions sont fermées.' : 'Password changed. Your other sessions are closed.', 'ok');
  } catch (err) {
    setStatus($('my-status'), err.message, 'fail');
  }
});

function renderMyTotp() {
  const host = $('my-totp');
  if (me?.breakGlass) { host.innerHTML = ''; return; }
  if (me?.totpEnabled) {
    host.innerHTML = `<p class="status ok">${fr ? 'Double authentification activée' : 'Two-factor authentication on'}</p>`;
    return;
  }
  host.innerHTML = `<button class="btn" type="button" id="totp-start">${fr ? 'Activer la double authentification' : 'Turn on two-factor authentication'}</button>`;
  $('totp-start').addEventListener('click', async () => {
    try {
      const { secret, uri } = await api('POST', 'totp/setup', {});
      host.innerHTML = `
        <p class="hint">${fr ? 'Ajoutez cette clé dans votre application (Aegis, 2FAS…), puis saisissez le code affiché.' : 'Add this key to your app (Aegis, 2FAS…), then enter the code shown.'}</p>
        <code class="secret">${escapeHtml(secret)}</code>
        <a class="hint" href="${escapeHtml(uri)}">${fr ? 'Ouvrir dans l’application' : 'Open in the app'}</a>
        <form id="totp-confirm" class="admin-add">
          <input id="totp-code" inputmode="numeric" maxlength="6" required autocomplete="one-time-code" placeholder="000000">
          <button class="btn primary" type="submit">${fr ? 'Activer' : 'Enable'}</button>
        </form>`;
      $('totp-confirm').addEventListener('submit', async e => {
        e.preventDefault();
        try {
          await api('POST', 'totp/enable', { code: $('totp-code').value });
          me = await api('GET', 'me');
          renderMyTotp();
        } catch (err) {
          setStatus($('my-status'), err.message, 'fail');
        }
      });
    } catch (err) {
      setStatus($('my-status'), err.message, 'fail');
    }
  });
}

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
    ...(security.legalEnabled === false ? [] : [[security.legalConfigured, fr ? 'Documents légaux complétés' : 'Legal documents filled in']]),
    [security.geoEnabled, fr ? 'Lieu des sessions (base locale)' : 'Session location (local database)'],
    [!security.registrationOpen, fr ? 'Inscriptions fermées (serveur privé)' : 'Registration closed (private server)']
  ];
  $('checks').innerHTML = checks.map(([ok, label]) => `<li class="${ok ? 'ok' : 'todo'}">${label}</li>`).join('');
  renderClusterSummary(data.cluster);
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

/** Une durée d'une offre : son identifiant, son prix affiché et le prix Stripe correspondant */
function priceRow(price = {}) {
  const row = document.createElement('div');
  row.className = 'price-row row';
  row.innerHTML = `
    <div class="small"><label>${fr ? 'Identifiant' : 'ID'}</label><input data-price="id" value="${escapeHtml(price.id)}" placeholder="mensuel" pattern="[a-z0-9-]{2,32}"></div>
    <div class="small"><label>${fr ? 'Prix affiché' : 'Price label'}</label><input data-price="label" value="${escapeHtml(price.label)}" placeholder="2 € / mois" maxlength="40"></div>
    <div><label>${fr ? 'Prix Stripe' : 'Stripe price'}</label><input data-price="stripePriceId" value="${escapeHtml(price.stripePriceId)}" placeholder="price_…"></div>
    <div class="small"><label>${fr ? 'Paiement' : 'Billing'}</label><select data-price="mode">
      <option value="subscription">${fr ? 'Renouvelé' : 'Recurring'}</option>
      <option value="payment" ${price.mode === 'payment' ? 'selected' : ''}>${fr ? 'Une fois' : 'One-time'}</option>
    </select></div>
    <button type="button" class="btn ghost" data-remove-price aria-label="${fr ? 'Retirer cette durée' : 'Remove this duration'}">✕</button>`;
  row.querySelector('[data-remove-price]').addEventListener('click', () => {
    const list = row.parentElement;
    row.remove();
    // Une offre sans durée ne peut pas être achetée : on en garde toujours une
    if (!list.querySelector('.price-row')) list.appendChild(priceRow());
  });
  return row;
}

function planRow(plan = {}) {
  const row = document.createElement('div');
  row.className = 'plan';
  row.innerHTML = `
    <div class="row">
      <div class="small"><label>${fr ? 'Identifiant' : 'ID'}</label><input data-plan="id" value="${escapeHtml(plan.id)}" placeholder="plus" pattern="[a-z0-9-]{2,32}"></div>
      <div><label>${fr ? 'Nom' : 'Name'}</label><input data-plan="name" value="${escapeHtml(plan.name)}" maxlength="60"></div>
    </div>
    <label>${fr ? 'Description' : 'Description'}</label><input data-plan="description" value="${escapeHtml(plan.description)}" maxlength="300">

    <div class="panel-head" style="margin-top:14px;">
      <label style="margin:0;">${t('durations')}</label>
      <button type="button" class="btn ghost" data-add-price>${t('addDuration')}</button>
    </div>
    <p class="hint" style="margin-top:0;">${t('durationsHint')}</p>
    <div data-prices></div>

    <div class="limits">${BOOSTS.map(([key, label, unit]) => `<div><label>${label}</label><input type="number" min="0" data-boost="${key}" data-unit="${unit}" value="${plan.boosts?.[key] ? plan.boosts[key] / unit : ''}"></div>`).join('')}</div>
    <div class="row test"><button type="button" class="btn ghost" data-remove>${fr ? 'Retirer cette offre' : 'Remove this plan'}</button></div>`;

  const prices = row.querySelector('[data-prices]');
  // Relit aussi l'ancienne forme à un seul tarif, enregistrée avant les durées
  const existing = plan.prices?.length
    ? plan.prices
    : (plan.stripePriceId ? [{ id: 'defaut', label: plan.priceLabel, stripePriceId: plan.stripePriceId, mode: plan.mode }] : []);
  for (const price of existing) prices.appendChild(priceRow(price));
  if (!existing.length) prices.appendChild(priceRow());

  row.querySelector('[data-add-price]').addEventListener('click', () => prices.appendChild(priceRow()));
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
      const prices = [...row.querySelectorAll('.price-row')].map(priceEl => {
        const value = name => priceEl.querySelector(`[data-price="${name}"]`).value.trim();
        return { id: value('id'), label: value('label'), stripePriceId: value('stripePriceId'), mode: value('mode') };
      });
      return { id: field('id'), name: field('name'), description: field('description'), prices, boosts };
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
  // Réglage absent : un serveur mis à jour depuis une version sans l'interrupteur publiait, on garde cela
  $('legalEnabled').checked = legal.enabled !== false;
  for (const [key] of LEGAL_FIELDS) $(`legal-${key}`).value = legal[key] ?? '';
  applyLegalEnabled();
}

/** Les champs d'identité n'ont plus d'objet quand rien n'est publié */
function applyLegalEnabled() {
  const on = $('legalEnabled').checked;
  $('legal-fields').hidden = !on;
  $('legal-preview').hidden = !on;
}
$('legalEnabled').addEventListener('change', applyLegalEnabled);

function readLegal() {
  return {
    enabled: $('legalEnabled').checked,
    ...Object.fromEntries(LEGAL_FIELDS.map(([key]) => [key, $(`legal-${key}`).value.trim()]))
  };
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


/* ── Grappe de serveurs ────────────────────────────────────────────────── */

const HEALTH = {
  self: ['Ce nœud', 'This node', 'ok'],
  ok: ['Synchronisé', 'In sync', 'ok'],
  offline: ['Hors ligne', 'Offline', 'fail'],
  error: ['En erreur', 'Failing', 'fail'],
  unknown: ['Jamais joint', 'Not reached yet', 'warn'],
  disabled: ['Désactivé', 'Disabled', 'warn'],
  revoked: ['Révoqué', 'Revoked', 'fail'],
  'other-zone': ['Autre zone', 'Other zone', 'muted']
};
/* L'état vient du manifeste d'un autre nœud : un état inconnu s'affiche comme
   du texte, jamais comme du HTML. */
const healthBadge = health => {
  const connu = HEALTH[Object.prototype.hasOwnProperty.call(HEALTH, health) ? health : ''];
  const [f, e, tone] = connu ?? [escapeHtml(String(health)), escapeHtml(String(health)), 'muted'];
  return `<span class="badge ${tone}">${fr ? f : e}</span>`;
};
const when = ms => (ms ? new Date(ms).toLocaleString(locale) : '—');
/** Lien « En savoir plus » vers la documentation servie par ce serveur */
const aide = page => `<a class="aide" href="/docs/${page}" target="_blank" rel="noopener">${fr ? 'En savoir plus' : 'Learn more'}</a>`;


/** Résumé du tableau de bord : ce qui demande une intervention se voit d'un coup d'œil */
function renderClusterSummary(view) {
  const card = $('cluster-card');
  const cluster = view?.cluster;
  card.hidden = !cluster;
  if (!cluster) return;
  const others = cluster.nodes.filter(n => !n.self);
  const count = h => others.filter(n => n.health === h).length;
  const problems = count('offline') + count('error');
  $('cluster-summary').innerHTML = `
    <p class="hint">${escapeHtml(cluster.name)} · ${fr ? 'zone' : 'zone'} ${escapeHtml(view.self.zone ?? '—')} · ${cluster.nodes.length} ${fr ? 'nœud(s)' : 'node(s)'}</p>
    <ul class="checks">
      <li class="${problems ? 'todo' : 'ok'}">${problems
        ? (fr ? `${problems} nœud(s) demandent une intervention` : `${problems} node(s) need attention`)
        : (fr ? 'Tous les nœuds de la zone sont synchronisés' : 'Every node in the zone is in sync')}</li>
      ${view.pending?.length ? `<li class="todo">${view.pending.length} ${fr ? 'demande(s) d’adhésion à examiner' : 'join request(s) to review'}</li>` : ''}
      ${view.pendingConflicts ? `<li class="todo">${view.pendingConflicts} ${fr ? 'version(s) concurrente(s) en attente de fusion' : 'concurrent version(s) awaiting merge'}</li>` : ''}
    </ul>`;
}

async function loadCluster() {
  const host = $('cluster-panel');
  try {
    renderClusterPanel(await api('GET', 'cluster'));
  } catch (err) {
    host.innerHTML = `<p class="status fail">${escapeHtml(err.message)}</p>`;
  }
}

/** Lance une action de grappe puis redessine ; les erreurs s'affichent à côté */
async function clusterAction(method, path, body, success) {
  try {
    const result = await api(method, path, body);
    // Une action qui affiche son propre résultat (le code d'invitation) ne doit pas être effacée
    if (success) return success(result);
    if (result && result.cluster !== undefined && result.self) renderClusterPanel(result);
    else await loadCluster();
  } catch (err) {
    alert(err.message);
  }
}

function nodeFieldsHtml(prefix, defaults = {}) {
  return `
    <div class="grid-2">
      <div><label for="${prefix}-name">${fr ? 'Nom du nœud' : 'Node name'}</label><input id="${prefix}-name" required maxlength="40" placeholder="EU-W" value="${escapeHtml(defaults.name ?? '')}"></div>
      <div><label for="${prefix}-zone">${fr ? 'Zone de résidence' : 'Residency zone'}</label><input id="${prefix}-zone" required maxlength="10" placeholder="EU" value="${escapeHtml(defaults.zone ?? '')}"></div>
      <div><label for="${prefix}-region">${fr ? 'Région' : 'Region'}</label><input id="${prefix}-region" required maxlength="20" placeholder="eu-west" value="${escapeHtml(defaults.region ?? '')}"></div>
      <div><label for="${prefix}-url">${fr ? 'Adresse publique du nœud' : 'Node public address'}</label><input id="${prefix}-url" type="url" required value="${escapeHtml(defaults.url ?? location.origin)}"></div>
    </div>
    <p class="hint">${fr
      ? 'Les comptes ne sont répliqués qu’entre nœuds de la même zone (EU, US, CH…). Ils ne franchissent jamais les zones.'
      : 'Accounts are only replicated between nodes of the same zone (EU, US, CH…). They never cross zones.'}</p>`;
}
const readNodeFields = prefix => ({
  name: $(`${prefix}-name`).value.trim(),
  zone: $(`${prefix}-zone`).value.trim().toUpperCase(),
  region: $(`${prefix}-region`).value.trim(),
  url: $(`${prefix}-url`).value.trim()
});

/* ── Carte de la grappe ──────────────────────────────────────────────────
   Une rangée par zone : les nœuds y sont posés côte à côte, reliés entre eux
   par les liens de réplication (la réplication n'a lieu qu'à l'intérieur d'une
   zone). La couleur dit l'état, l'épaisseur du lien dit s'il sert. */

const MAP_TONE = {
  self: 'var(--accent)',
  ok: 'var(--ok)',
  late: 'var(--accent)',
  offline: 'var(--danger)',
  error: 'var(--danger)',
  unknown: '#d29922',
  disabled: '#d29922',
  revoked: 'var(--danger)',
  'other-zone': 'var(--muted)'
};

function clusterMap(view) {
  const nodes = view.cluster.nodes;
  const zones = [...new Set(nodes.map(n => n.zone))].sort();
  const width = 640;
  const rowHeight = 132;
  const height = zones.length * rowHeight + 16;

  const rows = zones.map((zone, index) => {
    const inZone = nodes.filter(n => n.zone === zone);
    const y = index * rowHeight + 70;
    const step = inZone.length > 1 ? Math.min(200, (width - 140) / (inZone.length - 1)) : 0;
    const startX = width / 2 - (step * (inZone.length - 1)) / 2;
    const placed = inZone.map((node, i) => ({ node, x: startX + i * step, y }));

    // Liens : chaque couple de nœuds actifs de la zone se réplique.
    // Au-delà de 16 nœuds dans une zone, on ne dessine plus le maillage complet :
    // il compterait des centaines de traits pour une lisibilité nulle.
    const links = [];
    const maille = placed.length <= 16;
    for (let a = 0; maille && a < placed.length; a++) {
      for (let b = a + 1; b < placed.length; b++) {
        const live = placed[a].node.status === 'active' && placed[b].node.status === 'active';
        const touche = placed[a].node.self || placed[b].node.self;
        const casse = [placed[a].node, placed[b].node].some(n => n.health === 'offline' || n.health === 'error');
        links.push(`<line x1="${placed[a].x}" y1="${placed[a].y}" x2="${placed[b].x}" y2="${placed[b].y}"
          stroke="${casse ? 'var(--danger)' : live ? 'var(--ok)' : 'var(--border)'}"
          stroke-width="${touche ? 2 : 1}" stroke-dasharray="${live ? '' : '4 4'}" opacity="${live ? 0.75 : 0.4}"></line>`);
      }
    }

    const marks = placed.map(({ node, x, y: ny }) => {
      const tone = MAP_TONE[node.self ? 'self' : node.health] ?? 'var(--muted)';
      const retard = node.lag ? `${node.lag}` : '';
      return `<g class="map-node" tabindex="0" role="img"
        aria-label="${escapeHtml(`${node.name} · ${node.region} · ${node.host ?? ''} ${node.ip ? `(${node.ip})` : ''}`)}">
        <title>${escapeHtml([node.name, node.region, node.host, node.ip, node.lastError].filter(Boolean).join(' · '))}</title>
        <circle cx="${x}" cy="${ny}" r="21" fill="var(--card)" stroke="${tone}" stroke-width="${node.self ? 3 : 2}"></circle>
        ${node.self ? `<circle cx="${x}" cy="${ny}" r="7" fill="${tone}"></circle>` : ''}
        ${node.status === 'revoked' ? `<path d="M${x - 9} ${ny - 9} L${x + 9} ${ny + 9} M${x + 9} ${ny - 9} L${x - 9} ${ny + 9}" stroke="var(--danger)" stroke-width="2"></path>` : ''}
        <text x="${x}" y="${ny + 40}" text-anchor="middle" class="map-name">${escapeHtml(node.name)}</text>
        <text x="${x}" y="${ny + 55}" text-anchor="middle" class="map-meta">${escapeHtml(node.ip || node.host || node.region)}</text>
        ${retard ? `<text x="${x + 24}" y="${ny - 18}" class="map-lag">+${escapeHtml(retard)}</text>` : ''}
      </g>`;
    }).join('');

    return `
      <text x="12" y="${y - 34}" class="map-zone">${escapeHtml(zone)}${zone === view.self.zone ? ` · ${fr ? 'ce nœud' : 'this node'}` : ''}</text>
      <line x1="12" y1="${y - 26}" x2="${width - 12}" y2="${y - 26}" stroke="var(--border)" stroke-width="1" opacity="0.6"></line>
      ${links.join('')}${marks}`;
  }).join('');

  const legende = [
    ['self', fr ? 'ce nœud' : 'this node'],
    ['ok', fr ? 'synchronisé' : 'in sync'],
    ['offline', fr ? 'hors ligne ou en erreur' : 'offline or failing'],
    ['disabled', fr ? 'désactivé' : 'disabled'],
    ['revoked', fr ? 'révoqué' : 'revoked']
  ].map(([key, label]) => `<span class="map-key"><span class="map-dot" style="border-color:${MAP_TONE[key]}"></span>${label}</span>`).join('');

  return `
    <section class="card">
      <div class="panel-head">
        <h2>${fr ? 'Vue d’ensemble' : 'Overview'}</h2>
        <span class="hint">${fr ? 'La réplication reste à l’intérieur d’une zone' : 'Replication stays inside a zone'}</span>
      </div>
      <div class="map-wrap">
        <svg viewBox="0 0 ${width} ${height}" class="cluster-map" role="group" aria-label="${fr ? 'Carte de la grappe' : 'Cluster map'}">${rows}</svg>
      </div>
      <div class="map-legend">${legende}</div>
    </section>`;
}

function renderClusterPanel(view) {
  const host = $('cluster-panel');
  const cluster = view.cluster;
  const manage = can('manage');
  const selfLine = `<p class="hint">${fr ? 'Empreinte de la clé de ce nœud' : 'This node’s key fingerprint'} : <code class="fp">${escapeHtml(view.self.fingerprint)}</code></p>`;

  // ── Pas de grappe : la créer, ou en rejoindre une ──
  if (!cluster) {
    host.innerHTML = `
      <section class="card">
        <h2>${fr ? 'Ce serveur fonctionne seul' : 'This server runs on its own'}</h2>
        <p class="hint">${fr
          ? 'Plusieurs serveurs à vous, qui se répliquent par zone et prennent le relais l’un de l’autre.'
          : 'Several servers of yours, replicating within a zone and taking over for each other.'} ${aide('deploiement/grappe')}</p>
        ${selfLine}
      </section>
      ${manage ? `
      <section class="card">
        <h2>${fr ? 'Créer une grappe' : 'Create a cluster'}</h2>
        <p class="hint">${fr ? 'Ce serveur deviendra le nœud racine : il détiendra la clé qui autorise les autres nœuds.' : 'This server becomes the root node: it holds the key that authorises the other nodes.'}</p>
        <form id="cluster-create" class="stack">
          <label for="cc-cluster">${fr ? 'Nom de la grappe' : 'Cluster name'}</label>
          <input id="cc-cluster" required maxlength="40" placeholder="Primary">
          ${nodeFieldsHtml('cc')}
          <button class="btn primary" type="submit">${fr ? 'Créer la grappe' : 'Create cluster'}</button>
        </form>
      </section>
      <section class="card">
        <h2>${fr ? 'Rejoindre une grappe' : 'Join a cluster'}</h2>
        <p class="hint">${fr ? 'Collez le code d’invitation créé sur le nœud racine. Il est valable une heure et ne sert qu’une fois.' : 'Paste the invitation code created on the root node. It is valid for one hour and works once.'}</p>
        <form id="cluster-join" class="stack">
          <label for="cj-code">${fr ? 'Code d’invitation' : 'Invitation code'}</label>
          <textarea id="cj-code" rows="3" required spellcheck="false"></textarea>
          ${nodeFieldsHtml('cj')}
          <button class="btn primary" type="submit">${fr ? 'Envoyer la demande' : 'Send request'}</button>
        </form>
      </section>` : ''}`;
    $('cluster-create')?.addEventListener('submit', e => {
      e.preventDefault();
      void clusterAction('POST', 'cluster', { clusterName: $('cc-cluster').value.trim(), ...readNodeFields('cc') });
    });
    $('cluster-join')?.addEventListener('submit', e => {
      e.preventDefault();
      void clusterAction('POST', 'cluster/join', { code: $('cj-code').value.trim(), ...readNodeFields('cj') });
    });
    return;
  }

  // ── Demande envoyée, approbation attendue ──
  if (cluster.state === 'joining') {
    host.innerHTML = `
      <section class="card">
        <h2>${fr ? 'En attente d’approbation' : 'Waiting for approval'}</h2>
        <p class="hint">${fr
          ? 'Sur le nœud racine, onglet Grappe, vérifiez que l’empreinte affichée pour cette demande est bien celle-ci, puis approuvez.'
          : 'On the root node, Cluster tab, check that the fingerprint shown for this request is this one, then approve.'}</p>
        <p><code class="fp big">${escapeHtml(view.self.fingerprint)}</code></p>
        <div class="row-end"><button class="btn" type="button" id="cluster-refresh">${fr ? 'Vérifier' : 'Check'}</button></div>
      </section>`;
    $('cluster-refresh').addEventListener('click', () => void clusterAction('POST', 'cluster/sync', {}));
    return;
  }

  // ── Membre ──
  const zones = [...new Set(cluster.nodes.map(n => n.zone))].sort();
  const root = cluster.isRoot && manage;
  const nodeRow = node => `
    <li class="node-row" data-node="${escapeHtml(node.id)}">
      <div class="node-main">
        <div class="node-title"><strong>${escapeHtml(node.name)}</strong> ${healthBadge(node.self ? 'self' : node.health)}</div>
        <div class="hint">${escapeHtml(node.region)} · ${escapeHtml(node.url)}${node.ip ? ` · ${escapeHtml(node.ip)}` : ''}</div>
        <div class="hint">${node.self ? (cluster.isRoot ? (fr ? 'Détient la clé racine' : 'Holds the root key') : '')
          : node.zone === view.self.zone && node.status === 'active'
            ? `${fr ? 'Dernière synchro' : 'Last sync'} : ${when(node.lastOkAt)}${node.lag ? ` · ${fr ? 'retard' : 'lag'} : ${node.lag}` : ''}`
            : ''}</div>
        ${node.lastError ? `<div class="hint fail">${escapeHtml(node.lastError)} (${when(node.lastErrorAt)})</div>` : ''}
        <details class="fp-details"><summary>${fr ? 'Empreinte' : 'Fingerprint'}</summary><code class="fp">${escapeHtml(node.fingerprint)}</code></details>
      </div>
      ${root && !node.self ? `
      <div class="node-actions">
        ${node.status === 'active' ? `<button class="btn" type="button" data-node-action="disable">${fr ? 'Désactiver' : 'Disable'}</button>` : ''}
        ${node.status === 'disabled' ? `<button class="btn" type="button" data-node-action="enable">${fr ? 'Réactiver' : 'Enable'}</button>` : ''}
        ${node.status !== 'revoked' ? `<button class="btn danger" type="button" data-node-action="revoke">${fr ? 'Révoquer' : 'Revoke'}</button>` : ''}
        ${node.status === 'revoked' ? `<button class="btn danger" type="button" data-node-action="remove">${fr ? 'Retirer' : 'Remove'}</button>` : ''}
      </div>` : ''}
    </li>`;

  host.innerHTML = `
    ${clusterMap(view)}
    <section class="card">
      <div class="panel-head">
        <h2>${escapeHtml(cluster.name)}</h2>
        ${can('operate') ? `<button class="btn" type="button" id="cluster-sync-now">${fr ? 'Synchroniser maintenant' : 'Sync now'}</button>` : ''}
      </div>
      <p class="hint">${fr ? 'Époque du manifeste' : 'Manifest epoch'} ${cluster.epoch} · ${fr ? 'racine' : 'root'} <code class="fp">${escapeHtml(cluster.rootFingerprint)}</code></p>
      ${selfLine}
      ${view.pendingConflicts ? `<p class="hint">${view.pendingConflicts} ${fr ? 'version(s) concurrente(s) attendent d’être fusionnées par les appareils des utilisateurs.' : 'concurrent version(s) are waiting to be merged by users’ devices.'}</p>` : ''}
    </section>

    ${view.pending?.length && root ? `
    <section class="card attention">
      <h2>${fr ? 'Demandes d’adhésion' : 'Join requests'}</h2>
      <p class="hint">${fr ? 'Comparez l’empreinte avec celle affichée sur le nœud demandeur avant d’approuver.' : 'Compare the fingerprint with the one shown on the requesting node before approving.'}</p>
      <ul class="node-list">${view.pending.map(r => `
        <li class="node-row" data-request="${escapeHtml(r.id)}">
          <div class="node-main">
            <strong>${escapeHtml(r.name)}</strong> <span class="badge muted">${escapeHtml(r.zone)}</span>
            <div class="hint">${escapeHtml(r.region)} · ${escapeHtml(r.url)} · ${when(r.requestedAt)}</div>
            <code class="fp">${escapeHtml(r.fingerprint)}</code>
          </div>
          <div class="node-actions">
            <button class="btn primary" type="button" data-request-action="approve">${fr ? 'Approuver' : 'Approve'}</button>
            <button class="btn" type="button" data-request-action="reject">${fr ? 'Refuser' : 'Reject'}</button>
          </div>
        </li>`).join('')}</ul>
    </section>` : ''}

    ${zones.map(zone => `
    <section class="card">
      <h2>${fr ? 'Zone' : 'Zone'} ${escapeHtml(zone)}${zone === view.self.zone ? ` <span class="badge muted">${fr ? 'celle de ce nœud' : 'this node’s'}</span>` : ''}</h2>
      <ul class="node-list">${cluster.nodes.filter(n => n.zone === zone).map(nodeRow).join('')}</ul>
    </section>`).join('')}

    ${manage ? `
    <section class="card">
      <h2>${fr ? 'Nœuds et clés' : 'Nodes and keys'}</h2>
      <div class="stack">
        ${root ? `<div class="row-split"><span>${fr ? 'Ajouter un nœud à la grappe' : 'Add a node to the cluster'}</span><button class="btn primary" type="button" id="cluster-invite">${fr ? 'Créer une invitation' : 'Create invitation'}</button></div><div id="cluster-invite-out"></div>` : ''}
        <div class="row-split"><span>${fr ? 'Renouveler la clé de ce nœud' : 'Renew this node’s key'}</span><button class="btn" type="button" id="cluster-rotate-node">${fr ? 'Renouveler' : 'Renew'}</button></div>
        ${root ? `
        <div class="row-split"><span>${fr ? 'Renouveler la clé racine' : 'Renew the root key'}</span><button class="btn" type="button" id="cluster-rotate-root">${fr ? 'Renouveler' : 'Renew'}</button></div>
        <div class="row-split"><span>${fr ? 'Copie de secours de la clé racine (chiffrée)' : 'Backup of the root key (encrypted)'}</span><button class="btn" type="button" id="cluster-export-root">${fr ? 'Exporter' : 'Export'}</button></div>` : `
        <div class="row-split"><span>${fr ? 'Reprendre la clé racine sur ce nœud (si le nœud racine est perdu)' : 'Take over the root key on this node (if the root node is lost)'}</span>
          <label class="btn">${fr ? 'Importer…' : 'Import…'}<input type="file" id="cluster-import-root" accept="application/json" hidden></label></div>`}
        <div class="row-split"><span>${fr ? 'Quitter la grappe (les données restent)' : 'Leave the cluster (data stays)'}</span><button class="btn danger" type="button" id="cluster-leave">${fr ? 'Quitter' : 'Leave'}</button></div>
      </div>
    </section>` : ''}

    <section class="card">
      <h2>${fr ? 'Événements' : 'Events'}</h2>
      <ul class="events">${(view.events ?? []).map(ev => `
        <li class="${escapeHtml(ev.level)}"><span class="hint">${when(ev.at)}</span> ${escapeHtml(ev.message)}</li>`).join('') || `<li class="hint">${fr ? 'Rien à signaler' : 'Nothing to report'}</li>`}</ul>
    </section>`;

  $('cluster-sync-now')?.addEventListener('click', () => void clusterAction('POST', 'cluster/sync', {}));

  host.querySelectorAll('[data-node-action]').forEach(button => button.addEventListener('click', () => {
    const id = button.closest('[data-node]').dataset.node;
    const node = cluster.nodes.find(n => n.id === id);
    const action = button.dataset.nodeAction;
    if (action === 'enable' || action === 'disable') {
      return void clusterAction('PATCH', `cluster/nodes/${id}`, { status: action === 'enable' ? 'active' : 'disabled' });
    }
    if (action === 'revoke') {
      const candidates = cluster.nodes.filter(n => n.id !== id && n.status === 'active' && n.zone === node.zone);
      const replacement = candidates.length
        ? prompt(fr
          ? `Révoquer ${node.name} ? Il ne pourra plus échanger avec la grappe.\nRemplaçant (facultatif), parmi : ${candidates.map(c => c.name).join(', ')}`
          : `Revoke ${node.name}? It will no longer talk to the cluster.\nReplacement (optional), among: ${candidates.map(c => c.name).join(', ')}`, '')
        : (confirm(fr ? `Révoquer ${node.name} ?` : `Revoke ${node.name}?`) ? '' : null);
      if (replacement === null) return;
      const by = candidates.find(c => c.name.toLowerCase() === replacement.trim().toLowerCase());
      return void clusterAction('POST', `cluster/nodes/${id}/revoke`, by ? { replacedBy: by.id } : {});
    }
    if (action === 'remove' && confirm(fr ? `Retirer ${node.name} du manifeste ?` : `Remove ${node.name} from the manifest?`)) {
      return void clusterAction('DELETE', `cluster/nodes/${id}`);
    }
  }));

  host.querySelectorAll('[data-request-action]').forEach(button => button.addEventListener('click', () => {
    const id = button.closest('[data-request]').dataset.request;
    void clusterAction('POST', `cluster/requests/${id}/${button.dataset.requestAction}`, {});
  }));

  $('cluster-invite')?.addEventListener('click', () => void clusterAction('POST', 'cluster/invites', {}, result => {
    {
      $('cluster-invite-out').innerHTML = `
        <p class="hint">${fr ? 'À coller sur le nouveau nœud, onglet Grappe → Rejoindre. Valable jusqu’à' : 'Paste on the new node, Cluster tab → Join. Valid until'} ${when(result.expiresAt)}.</p>
        <code class="secret">${escapeHtml(result.code)}</code>`;
    }
  }));
  $('cluster-rotate-node')?.addEventListener('click', () => {
    if (confirm(fr ? 'Renouveler la clé de ce nœud ? Les autres nœuds l’adoptent automatiquement.' : 'Renew this node’s key? Other nodes adopt it automatically.')) {
      void clusterAction('POST', 'cluster/node-key/rotate', {});
    }
  });
  $('cluster-rotate-root')?.addEventListener('click', () => {
    if (confirm(fr ? 'Renouveler la clé racine ? Pensez à refaire ensuite la copie de secours.' : 'Renew the root key? Remember to redo the backup afterwards.')) {
      void clusterAction('POST', 'cluster/root-key/rotate', {});
    }
  });
  $('cluster-export-root')?.addEventListener('click', async () => {
    const passphrase = prompt(fr ? 'Phrase de passe pour chiffrer la copie (16 caractères au moins). Sans elle, la copie est inutilisable.' : 'Passphrase to encrypt the backup (16+ characters). Without it the backup is useless.');
    if (!passphrase) return;
    try {
      const backup = await api('POST', 'cluster/root-key/export', { passphrase });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      link.download = `bettervault-cluster-root-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      alert(err.message);
    }
  });
  $('cluster-import-root')?.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const passphrase = prompt(fr ? 'Phrase de passe de la copie' : 'Backup passphrase');
    if (!passphrase) return;
    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      return alert(fr ? 'Fichier illisible' : 'Unreadable file');
    }
    void clusterAction('POST', 'cluster/root-key/import', { backup, passphrase });
  });
  $('cluster-leave')?.addEventListener('click', () => {
    if (confirm(fr ? 'Quitter la grappe ? Ce serveur garde ses données mais ne réplique plus.' : 'Leave the cluster? This server keeps its data but stops replicating.')) {
      void clusterAction('POST', 'cluster/leave', {});
    }
  });
}

/* ── Sauvegardes : destinations, historique, restauration ──────────────── */

const BACKUP_HEALTH = {
  ok: ['À jour', 'Up to date', 'ok'],
  late: ['En retard', 'Late', 'warn'],
  error: ['En erreur', 'Failing', 'fail'],
  never: ['Jamais sauvegardé', 'Never backed up', 'warn'],
  disabled: ['Désactivée', 'Disabled', 'warn'],
  revoked: ['Révoquée', 'Revoked', 'fail']
};
const backupBadge = health => {
  const [f, e, tone] = BACKUP_HEALTH[health] ?? [health, health, 'muted'];
  return `<span class="badge ${tone}">${fr ? f : e}</span>`;
};
const gb = bytes => `${(bytes / 1e9).toFixed(bytes < 1e10 ? 2 : 1)} ${fr ? 'Go' : 'GB'}`;

let backupState = null;

async function loadBackups() {
  const host = $('backups-panel');
  try {
    renderBackups(await api('GET', 'backup'));
  } catch (err) {
    host.innerHTML = `<p class="status fail">${escapeHtml(err.message)}</p>`;
  }
}

/** Lance une action ; la vue renvoyée redessine l'onglet, l'erreur s'affiche près du bouton */
async function backupAction(button, method, path, body) {
  const status = button?.closest('.card')?.querySelector('.status');
  if (button) button.disabled = true;
  try {
    const result = await api(method, path, body);
    if (result && Array.isArray(result.destinations)) renderBackups(result);
    return result;
  } catch (err) {
    if (status) setStatus(status, err.message, 'fail');
    else alert(err.message);
    return null;
  } finally {
    if (button) button.disabled = false;
  }
}

function destinationFieldsHtml(d = {}) {
  return `
    <div class="grid-2">
      <div><label for="bd-name">${fr ? 'Nom' : 'Name'}</label><input id="bd-name" required maxlength="40" placeholder="Scaleway Paris" value="${escapeHtml(d.name ?? '')}"></div>
      <div><label for="bd-region">${fr ? 'Région' : 'Region'}</label><input id="bd-region" maxlength="30" placeholder="fr-par" value="${escapeHtml(d.region ?? '')}"></div>
      <div><label for="bd-endpoint">${fr ? 'Adresse S3' : 'S3 endpoint'}</label><input id="bd-endpoint" type="url" required placeholder="https://s3.fr-par.scw.cloud" value="${escapeHtml(d.endpoint ?? '')}"></div>
      <div><label for="bd-bucket">Bucket</label><input id="bd-bucket" required placeholder="bettervault-backups" value="${escapeHtml(d.bucket ?? '')}"></div>
      <div><label for="bd-prefix">${fr ? 'Préfixe' : 'Prefix'}</label><input id="bd-prefix" placeholder="bettervault" value="${escapeHtml(d.prefix ?? '')}"></div>
      <div><label for="bd-quota">${fr ? 'Capacité (Go, facultatif)' : 'Capacity (GB, optional)'}</label><input id="bd-quota" type="number" min="0" step="1" value="${d.quotaBytes ? Math.round(d.quotaBytes / 1e9) : ''}"></div>
      <div><label for="bd-access">${fr ? 'Clé d’accès' : 'Access key'}</label><input id="bd-access" required autocomplete="off"></div>
      <div><label for="bd-secret">${fr ? 'Clé secrète' : 'Secret key'}</label><input id="bd-secret" type="password" required autocomplete="new-password"></div>
    </div>
    <label class="check"><input id="bd-path" type="checkbox" checked> <span>${fr ? 'Adresse par chemin (MinIO, Garage)' : 'Path-style addressing (MinIO, Garage)'}</span></label>`;
}
const readDestinationFields = () => ({
  name: $('bd-name').value.trim(),
  region: $('bd-region').value.trim(),
  quotaGb: Number($('bd-quota').value) || 0,
  s3: {
    endpoint: $('bd-endpoint').value.trim(),
    bucket: $('bd-bucket').value.trim(),
    prefix: $('bd-prefix').value.trim(),
    region: $('bd-region').value.trim(),
    accessKeyId: $('bd-access').value.trim(),
    secretAccessKey: $('bd-secret').value,
    pathStyle: $('bd-path').checked
  }
});

function renderBackups(view) {
  backupState = view;
  const host = $('backups-panel');
  const manage = can('manage');
  const operate = can('operate');
  const live = view.destinations.filter(d => d.status === 'active');
  const nameOf = id => view.destinations.find(d => d.id === id)?.name ?? id;

  const destinationRow = d => {
    const st = d.state ?? {};
    const usage = d.usage != null
      ? `<div class="meter${d.usage > 0.9 ? ' fail' : d.usage > 0.75 ? ' warn' : ''}" role="img" aria-label="${Math.round(d.usage * 100)} %"><span style="width:${Math.min(100, Math.round(d.usage * 100))}%"></span></div>`
      : '';
    return `
    <li class="node-row" data-destination="${escapeHtml(d.id)}">
      <div class="node-main">
        <div class="node-title"><strong>${escapeHtml(d.name)}</strong> ${backupBadge(d.health)}</div>
        <div class="hint">${escapeHtml(d.region)} · ${escapeHtml(d.endpoint)} · ${escapeHtml(d.bucket)}${d.prefix ? `/${escapeHtml(d.prefix)}` : ''}</div>
        ${d.status === 'revoked' ? `<div class="hint">${fr ? 'Identifiants effacés' : 'Credentials wiped'}${d.replacedBy ? ` · ${fr ? 'remplacée par' : 'replaced by'} ${escapeHtml(nameOf(d.replacedBy))}` : ''}</div>` : `
        <div class="hint">${fr ? 'Dernière réussite' : 'Last success'} : ${when(st.lastSuccessAt)}${st.snapshots != null ? ` · ${st.snapshots} ${fr ? 'copie(s)' : 'snapshot(s)'}` : ''}${st.usedBytes != null ? ` · ${gb(st.usedBytes)}${d.quotaBytes ? ` / ${gb(d.quotaBytes)}` : ''}` : ''}</div>
        ${usage}
        ${st.lastError && (!st.lastSuccessAt || st.lastErrorAt > st.lastSuccessAt) ? `<div class="hint fail">${escapeHtml(st.lastError)} (${when(st.lastErrorAt)}) — ${fr ? 'nouvel essai automatique dans l’heure' : 'automatic retry within the hour'}</div>` : ''}`}
      </div>
      <div class="node-actions">
        ${operate && d.status === 'active' ? `
          <button class="btn" type="button" data-dst-action="run">${fr ? 'Sauvegarder' : 'Back up'}</button>
          <button class="btn" type="button" data-dst-action="test">${fr ? 'Tester' : 'Test'}</button>` : ''}
        ${manage && d.status === 'active' ? `<button class="btn" type="button" data-dst-action="disable">${fr ? 'Désactiver' : 'Disable'}</button>` : ''}
        ${manage && d.status === 'disabled' ? `<button class="btn" type="button" data-dst-action="enable">${fr ? 'Réactiver' : 'Enable'}</button>` : ''}
        ${manage && d.status !== 'revoked' ? `<button class="btn danger" type="button" data-dst-action="revoke">${fr ? 'Révoquer' : 'Revoke'}</button>` : ''}
        ${manage && d.status === 'revoked' ? `<button class="btn danger" type="button" data-dst-action="remove">${fr ? 'Retirer' : 'Remove'}</button>` : ''}
      </div>
    </li>`;
  };

  const runs = view.runs.slice(0, 30);
  host.innerHTML = `
    ${!view.available ? `<p class="notice">${fr ? 'Les sauvegardes sont indisponibles sur ce serveur.' : 'Backups are unavailable on this server.'}</p>` : ''}
    <p class="status ${view.encrypted ? 'ok' : 'fail'}">${view.encrypted ? t('encryptedOn') : t('encryptedOff')}</p>
    <section class="card">
      <div class="panel-head">
        <h2>${fr ? 'Destinations' : 'Destinations'}</h2>
        ${operate && live.length ? `<button class="btn primary" type="button" id="backup-run-all"${view.running ? ' disabled' : ''}>${view.running ? (fr ? 'Sauvegarde en cours…' : 'Backup running…') : (fr ? 'Tout sauvegarder maintenant' : 'Back up everything now')}</button>` : ''}
      </div>
      <p class="hint">${fr
        ? `Chaque destination reçoit sa propre copie chiffrée, indépendamment des autres et de la grappe. ${view.enabled ? `Automatique toutes les ${view.intervalHours} h, conservée ${view.retentionDays} jours.` : 'Sauvegarde automatique désactivée (Réglages).'}`
        : `Each destination gets its own encrypted copy, independently of the others and of the cluster. ${view.enabled ? `Automatic every ${view.intervalHours} h, kept ${view.retentionDays} days.` : 'Automatic backups are off (Settings).'}`}</p>
      ${view.destinations.length
        ? `<ul class="node-list">${view.destinations.map(destinationRow).join('')}</ul>`
        : `<p class="hint">${fr ? 'Aucune destination : rien n’est sauvegardé hors de ce serveur.' : 'No destination: nothing is backed up off this server.'}</p>`}
      <p class="status" role="status"></p>
    </section>

    ${manage ? `
    <section class="card">
      <h2>${fr ? 'Ajouter une destination' : 'Add a destination'}</h2>
      <p class="hint">${fr ? 'Tout stockage compatible S3 (MinIO, AWS, Backblaze, Scaleway, Garage…). La connexion est testée avant l’enregistrement ; le secret ne ressort jamais du serveur.' : 'Any S3-compatible storage (MinIO, AWS, Backblaze, Scaleway, Garage…). The connection is tested before saving; the secret never leaves the server.'}</p>
      <form id="backup-add" class="stack">
        ${destinationFieldsHtml()}
        <div class="row-end">
          <button class="btn" type="button" id="backup-add-test">${fr ? 'Tester' : 'Test'}</button>
          <button class="btn primary" type="submit">${fr ? 'Ajouter' : 'Add'}</button>
        </div>
      </form>
      <p class="status" role="status"></p>
    </section>

    <section class="card">
      <h2>${fr ? 'Restaurer' : 'Restore'}</h2>
      <p class="hint">${fr
        ? 'Un aperçu montre ce que contient la copie. Rien ne change avant votre confirmation.'
        : 'A preview shows what the copy holds. Nothing changes before you confirm.'} ${aide('deploiement/sauvegardes')}</p>
      ${view.destinations.every(d => d.status === 'revoked') ? `<p class="hint">${fr ? 'Ajoutez d’abord une destination.' : 'Add a destination first.'}</p>` : `<div class="grid-2">
        <div><label for="restore-dst">${fr ? 'Destination' : 'Destination'}</label>
          <select id="restore-dst">${view.destinations.filter(d => d.status !== 'revoked').map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}</option>`).join('')}</select></div>
        <div><label for="restore-point">${fr ? 'Copie' : 'Snapshot'}</label><select id="restore-point" disabled></select></div>
      </div>
      <div class="row-end">
        <button class="btn" type="button" id="restore-list">${fr ? 'Lister les copies' : 'List snapshots'}</button>
        <button class="btn primary" type="button" id="restore-preview" disabled>${fr ? 'Aperçu' : 'Preview'}</button>
      </div>`}
      <div id="restore-result"></div>
      <p class="status" role="status"></p>
    </section>` : ''}

    <section class="card">
      <h2>${fr ? 'Historique' : 'History'}</h2>
      ${runs.length === 0 ? `<p class="hint">${t('noRuns')}</p>` : `<div class="runs">${runs.map(run => `
        <div class="run">
          <span>${when(run.startedAt)}</span>
          <span class="${run.status === 'success' ? 'ok' : run.status === 'error' ? 'fail' : ''}">${escapeHtml(run.status)}${run.bytes ? ` · ${formatBytes(run.bytes)}` : ''}</span>
          <span class="muted">${run.destinationId ? `${escapeHtml(nameOf(run.destinationId))} · ` : ''}${run.message ? escapeHtml(run.message) : run.files ? `+${run.files} ${fr ? 'fichier(s)' : 'file(s)'}` : ''}</span>
        </div>`).join('')}</div>`}
    </section>`;

  $('backup-run-all')?.addEventListener('click', e => void backupAction(e.currentTarget, 'POST', 'backup/run', {}));

  host.querySelectorAll('[data-dst-action]').forEach(button => button.addEventListener('click', async () => {
    const id = button.closest('[data-destination]').dataset.destination;
    const d = view.destinations.find(x => x.id === id);
    const status = button.closest('.card').querySelector('.status');
    const action = button.dataset.dstAction;
    if (action === 'run') return void backupAction(button, 'POST', 'backup/run', { destinationId: id });
    if (action === 'test') {
      setStatus(status, t('testing'));
      const ok = await backupAction(button, 'POST', 'backup/test', { destinationId: id });
      if (ok !== null) setStatus(status, `${d.name} : ${t('storageOk')}`, 'ok');
      return;
    }
    if (action === 'enable' || action === 'disable') {
      return void backupAction(button, 'PATCH', `backup/destinations/${encodeURIComponent(id)}`, { status: action === 'enable' ? 'active' : 'disabled' });
    }
    if (action === 'revoke') {
      const others = view.destinations.filter(x => x.id !== id && x.status === 'active');
      if (!confirm(fr
        ? `Révoquer « ${d.name} » ? Ses identifiants sont effacés tout de suite et elle ne recevra plus rien. Pensez aussi à retirer la clé côté fournisseur.`
        : `Revoke “${d.name}”? Its credentials are wiped now and it will receive nothing more. Also remove the key at the provider.`)) return;
      let replacedBy;
      if (others.length) {
        const pick = prompt(fr
          ? `Remplacée par (facultatif) : ${others.map((o, i) => `${i + 1}. ${o.name}`).join(' · ')}\nNuméro, ou vide :`
          : `Replaced by (optional): ${others.map((o, i) => `${i + 1}. ${o.name}`).join(' · ')}\nNumber, or empty:`, '');
        if (pick === null) return;
        replacedBy = others[Number(pick) - 1]?.id;
      }
      return void backupAction(button, 'POST', `backup/destinations/${encodeURIComponent(id)}/revoke`, replacedBy ? { replacedBy } : {});
    }
    if (action === 'remove') {
      if (!confirm(fr ? `Retirer « ${d.name} » de la liste ? Les copies déjà envoyées restent chez le fournisseur.` : `Remove “${d.name}” from the list? Copies already sent stay at the provider.`)) return;
      return void backupAction(button, 'DELETE', `backup/destinations/${encodeURIComponent(id)}`);
    }
  }));

  const addForm = $('backup-add');
  if (addForm) {
    const addStatus = addForm.closest('.card').querySelector('.status');
    $('backup-add-test').addEventListener('click', async e => {
      if (!addForm.reportValidity()) return;
      setStatus(addStatus, t('testing'));
      const ok = await backupAction(e.currentTarget, 'POST', 'backup/test', { s3: readDestinationFields().s3 });
      if (ok !== null) setStatus(addStatus, t('storageOk'), 'ok');
    });
    addForm.addEventListener('submit', async e => {
      e.preventDefault();
      setStatus(addStatus, t('testing'));
      await backupAction(e.submitter, 'POST', 'backup/destinations', readDestinationFields());
    });
  }

  wireRestore();
}

function wireRestore() {
  const list = $('restore-list');
  if (!list) return;
  const card = list.closest('.card');
  const status = card.querySelector('.status');
  const pointSelect = $('restore-point');
  const previewButton = $('restore-preview');
  const result = $('restore-result');

  list.addEventListener('click', async () => {
    list.disabled = true;
    result.innerHTML = '';
    setStatus(status, fr ? 'Lecture des copies…' : 'Reading snapshots…');
    try {
      const { points } = await api('GET', `backup/destinations/${encodeURIComponent($('restore-dst').value)}/points`);
      pointSelect.innerHTML = points.map(p => `<option value="${escapeHtml(p.key)}">${when(p.takenAt)} · ${formatBytes(p.bytes)}</option>`).join('');
      pointSelect.disabled = previewButton.disabled = points.length === 0;
      setStatus(status, points.length ? '' : (fr ? 'Aucune copie sur cette destination.' : 'No snapshot on this destination.'), points.length ? undefined : 'fail');
    } catch (err) {
      setStatus(status, err.message, 'fail');
    } finally {
      list.disabled = false;
    }
  });

  previewButton.addEventListener('click', async () => {
    previewButton.disabled = true;
    setStatus(status, fr ? 'Téléchargement et vérification de la copie…' : 'Downloading and checking the snapshot…');
    try {
      const p = await api('POST', 'backup/restore/preview', { destinationId: $('restore-dst').value, key: pointSelect.value });
      setStatus(status, '');
      result.innerHTML = `
        <ul class="restore-facts">
          <li>${fr ? 'Copie du' : 'Snapshot from'} <strong>${when(p.takenAt)}</strong></li>
          <li>${p.accounts} ${fr ? 'compte(s)' : 'account(s)'} · ${p.sharedVaults} ${fr ? 'coffre(s) partagé(s)' : 'shared vault(s)'} · ${p.attachments} ${fr ? 'fichier(s)' : 'file(s)'}</li>
          ${p.newerNow ? `<li class="warn">${p.newerNow} ${fr ? 'compte(s) ont un coffre plus récent aujourd’hui : restaurer le serveur les ramènerait en arrière.' : 'account(s) have a newer vault today: restoring the server would roll them back.'}</li>` : ''}
          ${p.createdSince ? `<li>${p.createdSince} ${fr ? 'compte(s) créé(s) depuis : ils ne sont pas touchés.' : 'account(s) created since: they are left untouched.'}</li>` : ''}
        </ul>
        <div class="grid-2 restore-choices">
          <form id="restore-account" class="stack">
            <h3>${fr ? 'Un seul compte' : 'One account'}</h3>
            <p class="hint">${fr ? 'Recommandé. Le coffre actuel du compte est gardé de côté avant d’être remplacé.' : 'Recommended. The account’s current vault is kept aside before being replaced.'}</p>
            <label for="restore-email">${fr ? 'Adresse du compte' : 'Account email'}</label>
            <input id="restore-email" type="email" required autocomplete="off">
            <button class="btn primary" type="submit">${fr ? 'Restaurer ce compte' : 'Restore this account'}</button>
          </form>
          <form id="restore-server" class="stack">
            <h3>${fr ? 'Tout le serveur' : 'The whole server'}</h3>
            <p class="hint">${fr ? 'Une copie de sécurité de l’état actuel est faite d’abord. Réglages, administrateurs et grappe ne sont pas touchés.' : 'A safety copy of the current state is taken first. Settings, admins and cluster are left alone.'}</p>
            <label for="restore-confirm">${fr ? 'Tapez RESTAURER pour confirmer' : 'Type RESTAURER to confirm'}</label>
            <input id="restore-confirm" required autocomplete="off" pattern="RESTAURER">
            <button class="btn danger" type="submit">${fr ? 'Restaurer le serveur' : 'Restore the server'}</button>
          </form>
        </div>`;
      $('restore-account').addEventListener('submit', async e => {
        e.preventDefault();
        e.submitter.disabled = true;
        try {
          const r = await api('POST', 'backup/restore/account', { token: p.token, email: $('restore-email').value.trim() });
          setStatus(status, r.restored
            ? (fr ? `Compte restauré (${r.files} fichier(s)). L’ancien coffre est conservé côté serveur.` : `Account restored (${r.files} file(s)). The previous vault is kept on the server.`)
            : (fr ? 'Ce compte n’existe pas dans cette copie.' : 'This account is not in this snapshot.'), r.restored ? 'ok' : 'fail');
        } catch (err) {
          setStatus(status, err.message, 'fail');
        } finally {
          e.submitter.disabled = false;
        }
      });
      $('restore-server').addEventListener('submit', async e => {
        e.preventDefault();
        e.submitter.disabled = true;
        try {
          const r = await api('POST', 'backup/restore/server', { token: p.token, confirm: $('restore-confirm').value });
          result.innerHTML = '';
          setStatus(status, fr
            ? `Serveur restauré : ${r.accounts} compte(s), ${r.files} fichier(s)${r.skipped ? `, ${r.skipped} ignoré(s) car leur adresse sert à un compte plus récent` : ''}. Copie de sécurité : ${r.safetyKey}`
            : `Server restored: ${r.accounts} account(s), ${r.files} file(s)${r.skipped ? `, ${r.skipped} skipped because a newer account uses their email` : ''}. Safety copy: ${r.safetyKey}`, 'ok');
        } catch (err) {
          setStatus(status, err.message, 'fail');
          e.submitter.disabled = false;
        }
      });
    } catch (err) {
      setStatus(status, err.message, 'fail');
    } finally {
      previewButton.disabled = false;
    }
  });
}

/* ── Thème : automatique, clair ou sombre, retenu sur cet appareil ──── */
{
  const THEME_KEY = 'bv-admin-theme';
  const order = ['auto', 'light', 'dark'];
  const icons = { auto: '◐', light: '☀', dark: '☾' };
  const labels = { auto: ['Thème : automatique', 'Theme: automatic'], light: ['Thème : clair', 'Theme: light'], dark: ['Thème : sombre', 'Theme: dark'] };
  const read = () => { try { return localStorage.getItem(THEME_KEY) ?? 'auto'; } catch { return 'auto'; } };
  const apply = theme => {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    const button = $('theme-toggle');
    button.textContent = icons[theme];
    button.title = button.ariaLabel = labels[theme][fr ? 0 : 1];
  };
  let theme = order.includes(read()) ? read() : 'auto';
  apply(theme);
  $('theme-toggle').addEventListener('click', () => {
    theme = order[(order.indexOf(theme) + 1) % order.length];
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* navigation privée : le choix vaut pour la session */ }
    apply(theme);
  });
}