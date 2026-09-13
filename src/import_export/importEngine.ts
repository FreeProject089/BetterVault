import { CredentialItem, Task } from '../types/vault';

export interface ImportResult {
  credentials: Partial<CredentialItem>[];
  tasks: Partial<Task>[];
  sourceFormat: string;
  count: number;
}

/**
 * Détecte et parse les formats de coffres (Bitwarden, 1Password, KeePass, CSV générique)
 */
export function parseImportFile(fileContent: string, fileName = ''): ImportResult {
  const trimmed = fileContent.trim();

  // 1. Tenter le format JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);

      // A. Format Bitwarden JSON
      if (parsed.items && Array.isArray(parsed.items)) {
        const credentials: Partial<CredentialItem>[] = parsed.items.map((item: any) => {
          const login = item.login || {};
          const uri = (login.uris && login.uris[0] && login.uris[0].uri) || '';
          return {
            title: item.name || 'Identifiant sans nom',
            username: login.username || '',
            password: login.password || '',
            website: uri,
            totpSecret: login.totp || undefined,
            notes: item.notes || '',
            tags: item.folderId ? ['Import Bitwarden'] : [],
            createdAt: item.creationDate ? new Date(item.creationDate).getTime() : Date.now(),
            updatedAt: item.revisionDate ? new Date(item.revisionDate).getTime() : Date.now()
          };
        });

        return {
          credentials,
          tasks: [],
          sourceFormat: 'Bitwarden JSON',
          count: credentials.length
        };
      }

      // B. Format standard BUM / Canonique
      if (parsed.credentials && Array.isArray(parsed.credentials)) {
        return {
          credentials: parsed.credentials,
          tasks: parsed.tasks || [],
          sourceFormat: 'BUM Canonical Vault',
          count: parsed.credentials.length + (parsed.tasks ? parsed.tasks.length : 0)
        };
      }

      // C. Liste brute d'identifiants
      if (Array.isArray(parsed)) {
        const credentials: Partial<CredentialItem>[] = parsed.map((item: any) => ({
          title: item.title || item.name || 'Identifiant',
          username: item.username || item.login || item.email || '',
          password: item.password || item.pass || '',
          website: item.website || item.url || '',
          totpSecret: item.totp || item.totpSecret || undefined,
          notes: item.notes || ''
        }));
        return {
          credentials,
          tasks: [],
          sourceFormat: 'JSON Array',
          count: credentials.length
        };
      }
    } catch (e) {
      console.warn('Échec parsing JSON, tentative en CSV...', e);
    }
  }

  // 2. Format CSV (Bitwarden, 1Password, Chrome, Firefox)
  const lines = trimmed.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length > 1) {
    const header = lines[0].toLowerCase();
    const rows = lines.slice(1);
    const credentials: Partial<CredentialItem>[] = [];

    // Séparateur (virgule ou point-virgule)
    const delimiter = header.includes(';') ? ';' : ',';
    const headerCols = header.split(delimiter).map(c => c.replace(/"/g, '').trim());

    // Détection des index de colonnes avec précision
    const titleIdx = headerCols.findIndex(c => c === 'name' || c === 'title' || c.includes('name') || c.includes('title'));
    const urlIdx = headerCols.findIndex(c => c.includes('uri') || c.includes('url') || c.includes('website'));
    const userIdx = headerCols.findIndex(c => c === 'login_username' || c === 'username' || c === 'email' || c.includes('username') || c.includes('email') || (c.includes('user') && !c.includes('uri')));
    const passIdx = headerCols.findIndex(c => c === 'login_password' || c === 'password' || c.includes('password') || c.includes('pass'));
    const totpIdx = headerCols.findIndex(c => c.includes('totp') || c.includes('otp') || c.includes('2fa'));
    const notesIdx = headerCols.findIndex(c => c.includes('note') || c.includes('comment'));

    for (const row of rows) {
      // Parse CSV basique avec gestion des guillemets
      const cols = parseCsvLine(row, delimiter);
      if (cols.length >= 2) {
        credentials.push({
          title: (titleIdx >= 0 ? cols[titleIdx] : cols[0]) || 'Compte sans titre',
          website: urlIdx >= 0 ? cols[urlIdx] : '',
          username: userIdx >= 0 ? cols[userIdx] : '',
          password: passIdx >= 0 ? cols[passIdx] : '',
          totpSecret: totpIdx >= 0 ? cols[totpIdx] : undefined,
          notes: notesIdx >= 0 ? cols[notesIdx] : ''
        });
      }
    }

    if (credentials.length > 0) {
      return {
        credentials,
        tasks: [],
        sourceFormat: `CSV (${fileName || 'Tableur/Navigateur'})`,
        count: credentials.length
      };
    }
  }

  throw new Error('Format de fichier non reconnu. Prise en charge : JSON (Bitwarden, 1Password, BUM), CSV.');
}

function parseCsvLine(text: string, delimiter: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += char;
    }
  }
  result.push(cur.trim());
  return result;
}

/**
 * Exporte les données du coffre au format JSON standard BUM
 */
export function exportVaultAsJson(credentials: CredentialItem[], tasks: Task[]): string {
  const exportPayload = {
    generator: 'BUM Zero-Knowledge Vault Manager',
    exportedAt: new Date().toISOString(),
    version: 1,
    credentials,
    tasks
  };
  return JSON.stringify(exportPayload, null, 2);
}

/**
 * Exporte les identifiants au format CSV universel (compatible Bitwarden / Chrome / 1Password)
 */
export function exportVaultAsCsv(credentials: CredentialItem[]): string {
  const headers = ['folder', 'favorite', 'type', 'name', 'notes', 'fields', 'reprompt', 'login_uri', 'login_username', 'login_password', 'login_totp'];
  const rows = credentials.map(c => {
    const sanitize = (val?: string) => `"${(val || '').replace(/"/g, '""')}"`;
    return [
      sanitize('BUM Vault'),
      sanitize(c.isFavorite ? '1' : '0'),
      sanitize('login'),
      sanitize(c.title),
      sanitize(c.notes),
      sanitize(''),
      sanitize('0'),
      sanitize(c.website),
      sanitize(c.username),
      sanitize(c.password),
      sanitize(c.totpSecret)
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\r\n');
}

/**
 * Déclenche le téléchargement du fichier généré dans le navigateur
 */
export function downloadExportFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

