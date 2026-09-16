export type SupportedLocale = 'fr' | 'en';

export interface Translations {
  common: {
    new: string;
    cancel: string;
    close: string;
    searchPlaceholder: string;
    emptySelection: string;
    emptyVaultTitle: string;
    emptyVaultSub: string;
    noResultsTitle: string;
    noResultsSub: string;
    today: string;
    overdue: string;
    upcoming: string;
    noDueDate: string;
    low: string;
    medium: string;
    high: string;
    urgent: string;
    personal: string;
    add: string;
    work: string;
    team: string;
  };
  nav: {
    vaults: string;
    categories: string;
    passwordsAndLogins: string;
    twoFactorTokens: string;
    taskManager: string;
    folders: string;
    toolsAndAudit: string;
    generator: string;
    audit: string;
    importExport: string;
    shortcuts: string;
    sync: string;
    newVaultTitle: string;
  };
  vault: {
    newVaultModalTitle: string;
    vaultNameLabel: string;
    vaultTypeLabel: string;
    createVaultButton: string;
    vaultCreatedToast: string;
  };
  tasks: {
    title: string;
    viewList: string;
    viewKanban: string;
    viewCalendar: string;
    statusTodo: string;
    statusInProgress: string;
    statusBlocked: string;
    statusCompleted: string;
    emptyTasksTitle: string;
    emptyTasksSub: string;
  };
  credentials: {
    title: string;
  };
  audit: {
    title: string;
    scoreTitle: string;
    weakCount: string;
    reusedCount: string;
    hibpScanButton: string;
    scanningHibp: string;
    reusedSectionTitle: string;
  };
  importExport: {
    title: string;
    importTab: string;
    exportTab: string;
    dragDropLabel: string;
    supportedFormats: string;
  };
}

export const fr: Translations = {
  common: {
    new: 'Nouveau',
    cancel: 'Annuler',
    close: 'Fermer',
    searchPlaceholder: 'Rechercher',
    emptySelection: 'Sélectionnez un élément pour afficher son contenu',
    emptyVaultTitle: 'Aucun identifiant',
    emptyVaultSub: 'Ajoutez votre premier identifiant avec le bouton Nouveau.',
    noResultsTitle: 'Aucun résultat',
    noResultsSub: 'Essayez avec un autre mot.',
    today: 'Aujourd’hui',
    overdue: 'En retard',
    upcoming: 'À venir',
    noDueDate: 'Sans échéance',
    low: 'Basse',
    medium: 'Moyenne',
    high: 'Haute',
    urgent: 'Urgente',
    personal: 'Perso',
    add: 'Ajouter',
    work: 'Travail',
    team: 'Équipe'
  },
  nav: {
    vaults: 'Coffres',
    categories: 'Catégories',
    passwordsAndLogins: 'Identifiants',
    twoFactorTokens: 'Codes 2FA',
    taskManager: 'Tâches',
    folders: 'Dossiers',
    toolsAndAudit: 'Outils',
    generator: 'Générateur',
    audit: 'Audit de sécurité',
    importExport: 'Importer / exporter',
    shortcuts: 'Raccourcis clavier',
    sync: 'Compte et synchronisation',
    newVaultTitle: 'Nouveau coffre'
  },
  vault: {
    newVaultModalTitle: 'Nouveau coffre',
    vaultNameLabel: 'Nom',
    vaultTypeLabel: 'Type',
    createVaultButton: 'Créer le coffre',
    vaultCreatedToast: 'Coffre créé'
  },
  tasks: {
    title: 'Tâches',
    viewList: 'Liste',
    viewKanban: 'Kanban',
    viewCalendar: 'Calendrier',
    statusTodo: 'À faire',
    statusInProgress: 'En cours',
    statusBlocked: 'Bloquée',
    statusCompleted: 'Terminée',
    emptyTasksTitle: 'Aucune tâche',
    emptyTasksSub: 'Créez votre première tâche avec le bouton Nouveau.'
  },
  credentials: {
    title: 'Identifiants'
  },
  audit: {
    title: 'Audit de sécurité',
    scoreTitle: 'Score de sécurité',
    weakCount: 'Faibles',
    reusedCount: 'Réutilisés',
    hibpScanButton: 'Vérifier les fuites de données',
    scanningHibp: 'Vérification en cours…',
    reusedSectionTitle: 'Mots de passe réutilisés'
  },
  importExport: {
    title: 'Importer / exporter',
    importTab: 'Importer',
    exportTab: 'Exporter',
    dragDropLabel: 'Déposez un fichier ici ou cliquez pour le choisir',
    supportedFormats: 'Formats pris en charge : KeePass (.kdbx, .xml), 1Password (.1pux, CSV), Bitwarden (JSON, CSV), FIDO CXF, LastPass, Dashlane, Chrome, Firefox et BetterVault (JSON, JSON chiffré, CSV).'
  }
};

export const en: Translations = {
  common: {
    new: 'New',
    cancel: 'Cancel',
    close: 'Close',
    searchPlaceholder: 'Search',
    emptySelection: 'Select an item to see its details',
    emptyVaultTitle: 'No credentials yet',
    emptyVaultSub: 'Add your first credential with the New button.',
    noResultsTitle: 'No results',
    noResultsSub: 'Try a different word.',
    today: 'Today',
    overdue: 'Overdue',
    upcoming: 'Upcoming',
    noDueDate: 'No due date',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    urgent: 'Urgent',
    personal: 'Personal',
    add: 'Add',
    work: 'Work',
    team: 'Team'
  },
  nav: {
    vaults: 'Vaults',
    categories: 'Categories',
    passwordsAndLogins: 'Credentials',
    twoFactorTokens: '2FA codes',
    taskManager: 'Tasks',
    folders: 'Folders',
    toolsAndAudit: 'Tools',
    generator: 'Generator',
    audit: 'Security audit',
    importExport: 'Import / export',
    shortcuts: 'Keyboard shortcuts',
    sync: 'Account and sync',
    newVaultTitle: 'New vault'
  },
  vault: {
    newVaultModalTitle: 'New vault',
    vaultNameLabel: 'Name',
    vaultTypeLabel: 'Type',
    createVaultButton: 'Create vault',
    vaultCreatedToast: 'Vault created'
  },
  tasks: {
    title: 'Tasks',
    viewList: 'List',
    viewKanban: 'Kanban',
    viewCalendar: 'Calendar',
    statusTodo: 'To do',
    statusInProgress: 'In progress',
    statusBlocked: 'Blocked',
    statusCompleted: 'Done',
    emptyTasksTitle: 'No tasks',
    emptyTasksSub: 'Create your first task with the New button.'
  },
  credentials: {
    title: 'Credentials'
  },
  audit: {
    title: 'Security audit',
    scoreTitle: 'Security score',
    weakCount: 'Weak',
    reusedCount: 'Reused',
    hibpScanButton: 'Check for data breaches',
    scanningHibp: 'Checking…',
    reusedSectionTitle: 'Reused passwords'
  },
  importExport: {
    title: 'Import / export',
    importTab: 'Import',
    exportTab: 'Export',
    dragDropLabel: 'Drop a file here or click to choose one',
    supportedFormats: 'Supported formats: KeePass (.kdbx, .xml), 1Password (.1pux, CSV), Bitwarden (JSON, CSV), FIDO CXF, LastPass, Dashlane, Chrome, Firefox and BetterVault (JSON, encrypted JSON, CSV).'
  }
};
