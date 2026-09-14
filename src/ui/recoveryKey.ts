type Tr = (fr: string, en: string) => string;

/** Clé affichée par groupes de 4 séparés par des espaces (retour à la ligne naturel) */
export function formatRecoveryKey(key: string): string {
  return key.replace(/-/g, ' ');
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
