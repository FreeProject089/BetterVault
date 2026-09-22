type Tr = (fr: string, en: string) => string;

/** Clé affichée par groupes de 4 séparés par des espaces (retour à la ligne naturel) */
export function formatRecoveryKey(key: string): string {
  return key.replace(/-/g, ' ');
}

/**
 * Feuille imprimable : la clé en gros caractères, à ranger hors de l'appareil.
 * Une fenêtre séparée est utilisée pour ne rien imprimer de l'application elle-même.
 */
export function printRecoveryKey(email: string, key: string): void {
  const escape = (value: string) => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
  const french = document.documentElement.lang !== 'en';
  const t = (fr: string, en: string) => (french ? fr : en);
  const groups = key.replace(/[\s-]/g, '').match(/.{1,4}/g) ?? [];
  const win = window.open('', '_blank', 'width=720,height=900');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html lang="${french ? 'fr' : 'en'}"><head><meta charset="UTF-8">
<title>${t('Clé de secours BetterVault', 'BetterVault recovery key')}</title>
<style>
  body{margin:0;padding:48px;font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111}
  h1{font-size:22px;margin:0 0 4px}p{margin:4px 0;color:#444}
  .key{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:28px 0;padding:24px;border:2px dashed #666;border-radius:12px}
  .key span{font-family:ui-monospace,Consolas,monospace;font-size:20px;font-weight:700;letter-spacing:2px;text-align:center}
  .note{margin-top:24px;padding:14px;border-left:4px solid #666;background:#f4f4f5;font-size:14px}
</style></head><body>
<h1>${t('Clé de secours BetterVault', 'BetterVault recovery key')}</h1>
<p>${t('Compte', 'Account')} : ${escape(email)}</p>
<p>${t('Créée le', 'Created on')} : ${escape(new Date().toLocaleString(french ? 'fr-FR' : 'en-US'))}</p>
<div class="key">${groups.map(group => `<span>${escape(group)}</span>`).join('')}</div>
<div class="note">${t(
    'Cette clé rouvre le coffre si le mot de passe principal est oublié. Elle donne accès au compte : gardez-la hors de l’ordinateur.',
    'This key lets you set a new master password without losing the vault. It grants access to the account: keep this sheet somewhere safe, away from the computer.'
  )}</div>
</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 250);
}

/** Contenu du fichier .txt proposé à l'enregistrement */
export function recoveryKeyFile(email: string, key: string, tr: Tr, locale: string): string {
  return [
    tr('BetterVault : clé de secours', 'BetterVault: recovery key'),
    '',
    `${tr('Compte', 'Account')} : ${email}`,
    `${tr('Créée le', 'Created on')} : ${new Date().toLocaleString(locale)}`,
    '',
    key,
    '',
    tr(
      'Elle permet de choisir un nouveau mot de passe principal si vous l’oubliez, sans perdre le coffre.\nGardez ce fichier hors de BetterVault, dans un endroit sûr.',
      'It lets you set a new master password if you forget it, without losing the vault.\nKeep this file outside BetterVault, somewhere safe.'
    ),
    ''
  ].join('\n');
}
