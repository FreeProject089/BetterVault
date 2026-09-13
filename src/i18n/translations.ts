export type SupportedLocale = 'fr' | 'en';

export interface Translations {
  common: {
    new: string;
    save: string;
    cancel: string;
    delete: string;
    edit: string;
    close: string;
    copy: string;
    copied: string;
    locked: string;
    unlocked: string;
    searchPlaceholder: string;
    searchShortcut: string;
    emptySelection: string;
    emptyVaultTitle: string;
    emptyVaultSub: string;
    noResultsTitle: string;
    noResultsSub: string;
    date: string;
    today: string;
    overdue: string;
    upcoming: string;
    noDueDate: string;
    low: string;
    medium: string;
    high: string;
    urgent: string;
    personal: string;
    work: string;
    team: string;
  };
  nav: {
    vaults: string;
    categories: string;
    passwordsAndLogins: string;
    twoFactorTokens: string;
    taskManager: string;
    toolsAndAudit: string;
    generator: string;
    audit: string;
    importExport: string;
    shortcuts: string;
    sync: string;
    newVaultTitle: string;
  };
  vault: {
    lockedBannerTitle: string;
    lockedBannerSub: string;
    unlockButton: string;
    unlockModalTitle: string;
    unlockModalSub: string;
    masterPasswordPlaceholder: string;
    unlockAction: string;
    lockActionTitle: string;
    unlockActionTitle: string;
    newVaultModalTitle: string;
    vaultNameLabel: string;
    vaultTypeLabel: string;
    passwordProtectLabel: string;
    passwordOptionalLabel: string;
    createVaultButton: string;
    vaultCreatedToast: string;
    vaultLockedToast: string;
    vaultUnlockedToast: string;
    invalidPasswordToast: string;
  };
  tasks: {
    title: string;
    viewList: string;
    viewKanban: string;
    viewCalendar: string;
    newTaskTitle: string;
    editTaskTitle: string;
    taskTitleLabel: string;
    priorityLabel: string;
    statusLabel: string;
    dueDateLabel: string;
    descriptionLabel: string;
    linkedCredentialLabel: string;
    noneLinked: string;
    subtasksTitle: string;
    subtaskPlaceholder: string;
    addSubtaskButton: string;
    statusTodo: string;
    statusInProgress: string;
    statusBlocked: string;
    statusCompleted: string;
    emptyTasksTitle: string;
    emptyTasksSub: string;
    completionRatio: string;
  };
  credentials: {
    title: string;
    newCredentialTitle: string;
    editCredentialTitle: string;
    itemTitleLabel: string;
    websiteLabel: string;
    usernameLabel: string;
    passwordLabel: string;
    generatePasswordTooltip: string;
    totpLabel: string;
    totpHelper: string;
    notesLabel: string;
    tagsLabel: string;
    customFieldsTitle: string;
    addFieldButton: string;
    fieldNamePlaceholder: string;
    fieldValuePlaceholder: string;
    revealPassword: string;
    hidePassword: string;
    copyPassword: string;
    copyUsername: string;
    copyTotp: string;
    passwordHistoryTitle: string;
    entropyBits: string;
    pwnedWarning: string;
    passkeysTitle: string;
    emptyStateTitle: string;
    emptyStateSub: string;
  };
  generator: {
    title: string;
    modePassword: string;
    modePassphrase: string;
    lengthLabel: string;
    includeUpper: string;
    includeLower: string;
    includeNumbers: string;
    includeSymbols: string;
    wordsCountLabel: string;
    separatorLabel: string;
    capitalizeWords: string;
    entropyLabel: string;
    copyAndUse: string;
  };
  audit: {
    title: string;
    scoreTitle: string;
    totalVaults: string;
    compromisedCount: string;
    weakCount: string;
    reusedCount: string;
    hibpScanButton: string;
    scanningHibp: string;
    compromisedSectionTitle: string;
    weakSectionTitle: string;
    reusedSectionTitle: string;
    goodHealthTitle: string;
    goodHealthSub: string;
  };
  importExport: {
    title: string;
    importTab: string;
    exportTab: string;
    dragDropLabel: string;
    supportedFormats: string;
    importSuccessToast: string;
    exportJsonButton: string;
    exportCsvButton: string;
    exportWarning: string;
  };
  shortcutsModal: {
    title: string;
    description: string;
    search: string;
    newItem: string;
    lockVault: string;
    generator: string;
    help: string;
    escape: string;
  };
  syncModal: {
    title: string;
    description: string;
    enableSync: string;
    serverUrlLabel: string;
    passphraseLabel: string;
    passphrasePlaceholder: string;
    syncNowButton: string;
    statusIdle: string;
    statusSyncing: string;
    statusSuccess: string;
    statusError: string;
    neverSynced: string;
    lastSynced: string;
  };
}

export const fr: Translations = {
  common: {
    new: 'Nouveau',
    save: 'Enregistrer',
    cancel: 'Annuler',
    delete: 'Supprimer',
    edit: 'Modifier',
    close: 'Fermer',
    copy: 'Copier',
    copied: 'Copié !',
    locked: 'Verrouillé',
    unlocked: 'Déverrouillé',
    searchPlaceholder: 'Rechercher des identifiants ou tâches...',
    searchShortcut: '⌘K',
    emptySelection: 'Sélectionnez un identifiant ou une tâche pour afficher les détails sécurisés',
    emptyVaultTitle: 'Coffre vide',
    emptyVaultSub: 'Créez votre premier identifiant avec le bouton Nouveau.',
    noResultsTitle: 'Aucun résultat',
    noResultsSub: 'Aucun élément ne correspond à votre recherche.',
    date: 'Date',
    today: "Aujourd'hui",
    overdue: 'En retard / Dépassées',
    upcoming: 'À venir',
    noDueDate: 'Sans échéance',
    low: 'Basse',
    medium: 'Moyenne',
    high: 'Haute',
    urgent: 'Urgente',
    personal: 'Perso',
    work: 'Pro',
    team: 'Équipe'
  },
  nav: {
    vaults: 'Coffres-forts',
    categories: 'Catégories',
    passwordsAndLogins: 'Mots de passe & Logins',
    twoFactorTokens: 'Codes 2FA (TOTP)',
    taskManager: 'Gestionnaire de Tâches',
    toolsAndAudit: 'Outils & Audit',
    generator: 'Générateur Sécurisé',
    audit: 'Audit de Sécurité',
    importExport: 'Importer / Exporter',
    shortcuts: 'Raccourcis Clavier',
    sync: 'Synchronisation Chiffrée',
    newVaultTitle: 'Nouveau coffre fort'
  },
  vault: {
    lockedBannerTitle: 'Ce coffre-fort est verrouillé',
    lockedBannerSub: 'Saisissez le mot de passe de déverrouillage pour déchiffrer vos données en mémoire locale.',
    unlockButton: 'Déverrouiller le coffre',
    unlockModalTitle: 'Déverrouiller le coffre',
    unlockModalSub: 'Entrez le mot de passe maître de ce coffre pour dériver la clé AES-256 en mémoire locale.',
    masterPasswordPlaceholder: 'Mot de passe du coffre',
    unlockAction: 'Déverrouiller',
    lockActionTitle: 'Cliquer pour verrouiller ce coffre',
    unlockActionTitle: 'Cliquer pour déverrouiller',
    newVaultModalTitle: 'Créer un nouveau coffre-fort',
    vaultNameLabel: 'Nom du coffre-fort',
    vaultTypeLabel: 'Type de coffre',
    passwordProtectLabel: 'Protéger ce coffre par un mot de passe dédié',
    passwordOptionalLabel: 'Mot de passe maître du coffre (optionnel)',
    createVaultButton: 'Créer le coffre-fort',
    vaultCreatedToast: 'Coffre créé avec succès',
    vaultLockedToast: 'Coffre verrouillé',
    vaultUnlockedToast: 'Coffre déverrouillé avec succès',
    invalidPasswordToast: 'Mot de passe de coffre incorrect'
  },
  tasks: {
    title: 'Gestionnaire de Tâches',
    viewList: 'Vue Liste',
    viewKanban: 'Vue Kanban',
    viewCalendar: 'Vue Calendrier / Échéances',
    newTaskTitle: 'Nouvelle Tâche',
    editTaskTitle: 'Modifier la Tâche',
    taskTitleLabel: 'Titre de la tâche',
    priorityLabel: 'Priorité',
    statusLabel: 'Statut',
    dueDateLabel: 'Date d’échéance',
    descriptionLabel: 'Notes & Description',
    linkedCredentialLabel: 'Identifiant associé',
    noneLinked: '— Aucun identifiant associé —',
    subtasksTitle: 'Sous-tâches & Checklist',
    subtaskPlaceholder: 'Ajouter une sous-tâche...',
    addSubtaskButton: 'Ajouter',
    statusTodo: 'À faire',
    statusInProgress: 'En cours',
    statusBlocked: 'Bloquée',
    statusCompleted: 'Terminée',
    emptyTasksTitle: 'Aucune tâche',
    emptyTasksSub: 'Créez votre première tâche avec le bouton Nouveau.',
    completionRatio: 'complétée(s)'
  },
  credentials: {
    title: 'Identifiants',
    newCredentialTitle: 'Nouvel Identifiant',
    editCredentialTitle: 'Modifier l’Identifiant',
    itemTitleLabel: 'Titre du service',
    websiteLabel: 'URL du site web',
    usernameLabel: 'Identifiant / Nom d’utilisateur / Email',
    passwordLabel: 'Mot de passe chiffré',
    generatePasswordTooltip: 'Générer un mot de passe fort',
    totpLabel: 'Clé secrète 2FA (TOTP RFC 6238)',
    totpHelper: 'Génère automatiquement les codes à 6 chiffres avec compte à rebours',
    notesLabel: 'Notes sécurisées (chiffrées de bout en bout)',
    tagsLabel: 'Tags (séparés par des virgules)',
    customFieldsTitle: 'Champs personnalisés',
    addFieldButton: '+ Ajouter un champ',
    fieldNamePlaceholder: 'Libellé du champ',
    fieldValuePlaceholder: 'Valeur',
    revealPassword: 'Voir / Masquer',
    hidePassword: 'Cacher',
    copyPassword: 'Copier le mot de passe',
    copyUsername: 'Copier le login',
    copyTotp: 'Copier le code 2FA',
    passwordHistoryTitle: 'Historique des versions de mots de passe',
    entropyBits: 'bits d’entropie',
    pwnedWarning: 'Ce mot de passe apparaît dans les fuites HIBP !',
    passkeysTitle: 'Passkeys FIDO2 / WebAuthn enregistrés',
    emptyStateTitle: 'Sélectionnez un élément',
    emptyStateSub: 'Détails chiffrés Zero-Knowledge'
  },
  generator: {
    title: 'Générateur de Clés & Mots de Passe',
    modePassword: 'Mot de passe aléatoire',
    modePassphrase: 'Phrase de passe Diceware',
    lengthLabel: 'Longueur',
    includeUpper: 'Majuscules (A-Z)',
    includeLower: 'Minuscules (a-z)',
    includeNumbers: 'Chiffres (0-9)',
    includeSymbols: 'Caractères spéciaux (!@#$%^&*)',
    wordsCountLabel: 'Nombre de mots',
    separatorLabel: 'Séparateur',
    capitalizeWords: 'Majuscule au début de chaque mot',
    entropyLabel: 'Entropie estimée',
    copyAndUse: 'Copier dans le presse-papiers'
  },
  audit: {
    title: 'Audit de Sécurité du Coffre-Fort',
    scoreTitle: 'Score Global de Santé',
    totalVaults: 'Total analysé',
    compromisedCount: 'Compromis (HIBP)',
    weakCount: 'Faibles (<50b)',
    reusedCount: 'Dupliqués',
    hibpScanButton: 'Lancer l’analyse des fuites mondiales (HIBP k-Anonymity)',
    scanningHibp: 'Analyse sécurisée k-Anonymity en cours...',
    compromisedSectionTitle: 'Mots de passe compromis (Détectés par HIBP)',
    weakSectionTitle: 'Mots de passe vulnérables ou faibles',
    reusedSectionTitle: 'Mots de passe réutilisés',
    goodHealthTitle: 'Coffre-fort en excellente santé',
    goodHealthSub: 'Aucun mot de passe faible, réutilisé ou compromis n’a été détecté.'
  },
  importExport: {
    title: 'Centre d’Importation & Exportation Sécurisé',
    importTab: 'Importer un fichier',
    exportTab: 'Exporter le coffre',
    dragDropLabel: 'Glissez-déposez un fichier de coffre-fort ici ou cliquez pour parcourir',
    supportedFormats: 'Supporté : Bitwarden (JSON/CSV), 1Password (.1pux, CSV), KeePass (.xml), LastPass, Dashlane, Passky, Chrome, Firefox, BUM JSON.',
    importSuccessToast: 'Éléments importés avec succès',
    exportJsonButton: 'Exporter en JSON BUM (Complet avec métadonnées)',
    exportCsvButton: 'Exporter en CSV Universel',
    exportWarning: 'Attention : Les exports en clair ne sont pas chiffrés. Stockez-les dans un endroit sécurisé ou supprimez-les après usage.'
  },
  shortcutsModal: {
    title: 'Raccourcis Clavier Rapides',
    description: 'Accélérez votre flux de travail et naviguez dans BUM sans toucher la souris.',
    search: 'Recherche globale',
    newItem: 'Nouvel identifiant ou tâche',
    lockVault: 'Verrouillage immédiat du coffre',
    generator: 'Générateur de mot de passe',
    help: 'Ouvrir cette aide clavier',
    escape: 'Fermer la boîte de dialogue'
  },
  syncModal: {
    title: 'Synchronisation Chiffrée (E2EE)',
    description: 'Synchronisez vos coffres-forts avec un relais distant sécurisé en Zero-Knowledge.',
    enableSync: 'Activer la synchronisation automatique',
    serverUrlLabel: 'URL du relais distant (WebDAV / API)',
    passphraseLabel: 'Clé secrète de synchronisation (E2EE)',
    passphrasePlaceholder: 'Clé secrète partagée...',
    syncNowButton: 'Synchroniser maintenant',
    statusIdle: 'En attente',
    statusSyncing: 'Synchronisation chiffrée en cours...',
    statusSuccess: 'Dernière synchronisation réussie',
    statusError: 'Erreur de synchronisation',
    neverSynced: 'Jamais synchronisé',
    lastSynced: 'Dernière synchro :'
  }
};

export const en: Translations = {
  common: {
    new: 'New',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    close: 'Close',
    copy: 'Copy',
    copied: 'Copied!',
    locked: 'Locked',
    unlocked: 'Unlocked',
    searchPlaceholder: 'Search credentials or tasks...',
    searchShortcut: '⌘K',
    emptySelection: 'Select a credential or task to view secure details',
    emptyVaultTitle: 'Empty Vault',
    emptyVaultSub: 'Create your first item with the New button.',
    noResultsTitle: 'No results',
    noResultsSub: 'No items match your search.',
    date: 'Date',
    today: 'Today',
    overdue: 'Overdue',
    upcoming: 'Upcoming',
    noDueDate: 'No due date',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    urgent: 'Urgent',
    personal: 'Personal',
    work: 'Work',
    team: 'Team'
  },
  nav: {
    vaults: 'Vaults',
    categories: 'Categories',
    passwordsAndLogins: 'Passwords & Logins',
    twoFactorTokens: '2FA Codes (TOTP)',
    taskManager: 'Task Manager',
    toolsAndAudit: 'Tools & Audit',
    generator: 'Secure Generator',
    audit: 'Security Audit',
    importExport: 'Import / Export',
    shortcuts: 'Keyboard Shortcuts',
    sync: 'Encrypted Sync',
    newVaultTitle: 'New Vault'
  },
  vault: {
    lockedBannerTitle: 'This vault is locked',
    lockedBannerSub: 'Enter the unlock password to decrypt your data in local memory.',
    unlockButton: 'Unlock Vault',
    unlockModalTitle: 'Unlock Vault',
    unlockModalSub: 'Enter master password to derive the AES-256 key in local memory.',
    masterPasswordPlaceholder: 'Vault Master Password',
    unlockAction: 'Unlock',
    lockActionTitle: 'Click to lock this vault',
    unlockActionTitle: 'Click to unlock',
    newVaultModalTitle: 'Create New Vault',
    vaultNameLabel: 'Vault Name',
    vaultTypeLabel: 'Vault Type',
    passwordProtectLabel: 'Protect this vault with a dedicated password',
    passwordOptionalLabel: 'Vault Master Password (optional)',
    createVaultButton: 'Create Vault',
    vaultCreatedToast: 'Vault created successfully',
    vaultLockedToast: 'Vault locked',
    vaultUnlockedToast: 'Vault unlocked successfully',
    invalidPasswordToast: 'Incorrect vault password'
  },
  tasks: {
    title: 'Task Manager',
    viewList: 'List View',
    viewKanban: 'Kanban View',
    viewCalendar: 'Calendar / Due Dates View',
    newTaskTitle: 'New Task',
    editTaskTitle: 'Edit Task',
    taskTitleLabel: 'Task Title',
    priorityLabel: 'Priority',
    statusLabel: 'Status',
    dueDateLabel: 'Due Date',
    descriptionLabel: 'Notes & Description',
    linkedCredentialLabel: 'Linked Credential',
    noneLinked: '— No linked credential —',
    subtasksTitle: 'Subtasks & Checklist',
    subtaskPlaceholder: 'Add a subtask...',
    addSubtaskButton: 'Add',
    statusTodo: 'To Do',
    statusInProgress: 'In Progress',
    statusBlocked: 'Blocked',
    statusCompleted: 'Completed',
    emptyTasksTitle: 'No tasks',
    emptyTasksSub: 'Create your first task using the New button.',
    completionRatio: 'completed'
  },
  credentials: {
    title: 'Credentials',
    newCredentialTitle: 'New Credential',
    editCredentialTitle: 'Edit Credential',
    itemTitleLabel: 'Service Title',
    websiteLabel: 'Website URL',
    usernameLabel: 'Username / Login / Email',
    passwordLabel: 'Encrypted Password',
    generatePasswordTooltip: 'Generate strong password',
    totpLabel: '2FA Secret Key (TOTP RFC 6238)',
    totpHelper: 'Automatically generates 6-digit codes with live countdown',
    notesLabel: 'Secure Notes (end-to-end encrypted)',
    tagsLabel: 'Tags (comma separated)',
    customFieldsTitle: 'Custom Fields',
    addFieldButton: '+ Add Field',
    fieldNamePlaceholder: 'Field Label',
    fieldValuePlaceholder: 'Value',
    revealPassword: 'Show / Hide',
    hidePassword: 'Hide',
    copyPassword: 'Copy password',
    copyUsername: 'Copy username',
    copyTotp: 'Copy 2FA code',
    passwordHistoryTitle: 'Password Version History',
    entropyBits: 'bits of entropy',
    pwnedWarning: 'This password has been exposed in data breaches (HIBP)!',
    passkeysTitle: 'Registered FIDO2 / WebAuthn Passkeys',
    emptyStateTitle: 'Select an item',
    emptyStateSub: 'Zero-Knowledge Encrypted Details'
  },
  generator: {
    title: 'Key & Password Generator',
    modePassword: 'Random Password',
    modePassphrase: 'Diceware Passphrase',
    lengthLabel: 'Length',
    includeUpper: 'Uppercase (A-Z)',
    includeLower: 'Lowercase (a-z)',
    includeNumbers: 'Numbers (0-9)',
    includeSymbols: 'Special Characters (!@#$%^&*)',
    wordsCountLabel: 'Word Count',
    separatorLabel: 'Separator',
    capitalizeWords: 'Capitalize each word',
    entropyLabel: 'Estimated Entropy',
    copyAndUse: 'Copy to clipboard'
  },
  audit: {
    title: 'Vault Security Audit',
    scoreTitle: 'Overall Health Score',
    totalVaults: 'Total analyzed',
    compromisedCount: 'Compromised (HIBP)',
    weakCount: 'Weak (<50b)',
    reusedCount: 'Reused',
    hibpScanButton: 'Scan global data breaches (HIBP k-Anonymity)',
    scanningHibp: 'Performing secure k-Anonymity scan...',
    compromisedSectionTitle: 'Compromised Passwords (Found in breaches)',
    weakSectionTitle: 'Vulnerable or Weak Passwords',
    reusedSectionTitle: 'Reused Passwords',
    goodHealthTitle: 'Vault in excellent health',
    goodHealthSub: 'No weak, reused or compromised passwords were found.'
  },
  importExport: {
    title: 'Secure Import & Export Center',
    importTab: 'Import File',
    exportTab: 'Export Vault',
    dragDropLabel: 'Drag and drop your vault file here or click to browse',
    supportedFormats: 'Supported: Bitwarden (JSON/CSV), 1Password (.1pux, CSV), KeePass (.xml), LastPass, Dashlane, Passky, Chrome, Firefox, BUM JSON.',
    importSuccessToast: 'Items imported successfully',
    exportJsonButton: 'Export as BUM JSON (Full with metadata)',
    exportCsvButton: 'Export as Universal CSV',
    exportWarning: 'Caution: Unencrypted exports are in plain text. Store securely or delete after use.'
  },
  shortcutsModal: {
    title: 'Keyboard Shortcuts',
    description: 'Boost your productivity and navigate BUM swiftly without a mouse.',
    search: 'Global search',
    newItem: 'New credential or task',
    lockVault: 'Lock active vault instantly',
    generator: 'Open password generator',
    help: 'Open this keyboard shortcuts help',
    escape: 'Close active modal'
  },
  syncModal: {
    title: 'End-to-End Encrypted Sync (E2EE)',
    description: 'Synchronize your vaults with a secure remote relay in zero-knowledge.',
    enableSync: 'Enable automatic background sync',
    serverUrlLabel: 'Remote relay URL (WebDAV / API)',
    passphraseLabel: 'Sync secret passphrase (E2EE)',
    passphrasePlaceholder: 'Shared secret passphrase...',
    syncNowButton: 'Sync Now',
    statusIdle: 'Idle',
    statusSyncing: 'Encrypted sync in progress...',
    statusSuccess: 'Last sync succeeded',
    statusError: 'Sync failed',
    neverSynced: 'Never synced',
    lastSynced: 'Last synced:'
  }
};
