import { CredentialItem, Task } from '../types/vault';
import { isTauri, saveFileNative } from '../platform/tauriBridge';

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
          const passkeys = (login.fido2Credentials || [])
            .filter((f: any) => f.credentialId && f.rpId)
            .map((f: any) => ({
              credentialId: f.credentialId,
              publicKey: '',
              privateKey: f.keyValue || undefined,
              signCount: Number(f.counter) || 0,
              rpId: f.rpId,
              userName: f.userName || login.username || '',
              userDisplayName: f.userDisplayName || undefined,
              userHandle: f.userHandle || undefined,
              createdAt: f.creationDate ? new Date(f.creationDate).getTime() : Date.now()
            }));
          const fields = (item.fields || [])
            .filter((f: any) => f.name && f.value)
            .map((f: any) => ({
              id: 'cf-' + Math.random().toString(36).substring(2, 8),
              label: f.name,
              value: String(f.value),
              isMasked: f.type === 1
            }));
          return {
            title: item.name || 'Identifiant sans nom',
            username: login.username || '',
            password: login.password || '',
            website: uri,
            totpSecret: login.totp || undefined,
            notes: item.notes || '',
            passkeys: passkeys.length ? passkeys : undefined,
            fields: fields.length ? fields : undefined,
            isFavorite: !!item.favorite,
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

      // B. Format BetterVault
      if (parsed.credentials && Array.isArray(parsed.credentials)) {
        return {
          credentials: parsed.credentials,
          tasks: parsed.tasks || [],
          sourceFormat: 'BetterVault JSON',
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
  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const table = parseCsv(trimmed, delimiter).filter(row => row.some(cell => cell.trim()));
  if (table.length > 1) {
    const rows = table.slice(1);
    const credentials: Partial<CredentialItem>[] = [];
    const headerCols = table[0].map(c => c.trim().toLowerCase());

    // Détection des index de colonnes avec précision
    // Priorité aux colonnes exactes : chez Dashlane, "username" précède "title" et contient "name"
    const exactTitleIdx = headerCols.findIndex(c => c === 'name' || c === 'title');
    const titleIdx = exactTitleIdx >= 0 ? exactTitleIdx : headerCols.findIndex(c => (c.includes('name') && !c.includes('user')) || c.includes('title'));
    const urlIdx = headerCols.findIndex(c => c.includes('uri') || c.includes('url') || c.includes('website'));
    const userIdx = headerCols.findIndex(c => c === 'login_username' || c === 'username' || c === 'email' || c.includes('username') || c.includes('email') || (c.includes('user') && !c.includes('uri')));
    const passIdx = headerCols.findIndex(c => c === 'login_password' || c === 'password' || c.includes('password') || c.includes('pass'));
    const totpIdx = headerCols.findIndex(c => c.includes('totp') || c.includes('otp') || c.includes('2fa'));
    const notesIdx = headerCols.findIndex(c => c.includes('note') || c.includes('comment') || c === 'extra');
    const tagsIdx = headerCols.findIndex(c => c === 'tags' || c === 'tag');

    for (const row of rows) {
      // Parse CSV basique avec gestion des guillemets
      const cols = row;
      if (cols.length >= 2) {
        credentials.push({
          title: (titleIdx >= 0 ? cols[titleIdx] : cols[0]) || 'Compte sans titre',
          website: urlIdx >= 0 ? cols[urlIdx] : '',
          username: userIdx >= 0 ? cols[userIdx] : '',
          password: passIdx >= 0 ? cols[passIdx] : '',
          totpSecret: totpIdx >= 0 ? cols[totpIdx] : undefined,
          notes: notesIdx >= 0 ? cols[notesIdx] : '',
          tags: tagsIdx >= 0 && cols[tagsIdx] ? cols[tagsIdx].split(/[;,]/).map(t => t.trim()).filter(Boolean) : undefined
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

  throw new Error('Format de fichier non reconnu. Formats pris en charge : KeePass, 1Password, Bitwarden, FIDO CXF, BetterVault, CSV.');
}

/** Lecteur CSV RFC 4180 : guillemets doublés, séparateurs et retours à la ligne à l'intérieur des champs entre guillemets */
function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

/**
 * Exporte les données du coffre au format JSON BetterVault
 */
export function exportVaultAsJson(credentials: CredentialItem[], tasks: Task[]): string {
  const exportPayload = {
    generator: 'BetterVault',
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
  // Colonnes Bitwarden, plus « tags » en dernier (ignorée par les autres gestionnaires, relue par BetterVault)
  const headers = ['folder', 'favorite', 'type', 'name', 'notes', 'fields', 'reprompt', 'login_uri', 'login_username', 'login_password', 'login_totp', 'tags'];
  const rows = credentials.map(c => {
    const sanitize = (val?: string) => `"${(val || '').replace(/"/g, '""')}"`;
    return [
      sanitize('BetterVault'),
      sanitize(c.isFavorite ? '1' : '0'),
      sanitize('login'),
      sanitize(c.title),
      sanitize(c.notes),
      sanitize(''),
      sanitize('0'),
      sanitize(c.website),
      sanitize(c.username),
      sanitize(c.password),
      sanitize(c.totpSecret),
      sanitize((c.tags ?? []).join(';'))
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\r\n');
}

/**
 * Déclenche le téléchargement du fichier généré dans le navigateur
 */
export function downloadExportFile(content: string | Uint8Array, filename: string, mimeType: string): void {
  if (isTauri()) {
    // La webview de bureau ignore les liens de téléchargement : écriture native dans Téléchargements
    saveFileNative(filename, content)
      .then(path => window.dispatchEvent(new CustomEvent('bettervault:file-saved', { detail: path })))
      .catch(err => window.dispatchEvent(new CustomEvent('bettervault:file-save-error', { detail: String(err) })));
    return;
  }

  const part = typeof content === 'string' ? content : (content.slice().buffer as ArrayBuffer);
  const blob = new Blob([part], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Révocation différée : une révocation immédiate annule le téléchargement sur certains navigateurs
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

