import { normalizeServerUrl } from '../account/cloudClient';

/**
 * Serveurs proposés sous le champ « Adresse du serveur » : le serveur saisi publie
 * la liste que son hébergeur recommande (ses autres régions, des serveurs de
 * confiance). Un clic remplit le champ. Rien ne s'affiche si l'annuaire est coupé.
 * La liste vient d'un serveur : elle est vérifiée et échappée comme une donnée
 * extérieure, et seules des adresses https (ou locales) sont retenues.
 */

export interface DirectoryServer {
  name: string;
  url: string;
  region: string;
  official: boolean;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Lit la réponse de /api/v1/directory sans lui faire confiance */
export function parseDirectory(input: unknown): DirectoryServer[] {
  const list = (input as { enabled?: unknown; servers?: unknown } | null);
  if (!list || list.enabled !== true || !Array.isArray(list.servers)) return [];
  return list.servers.slice(0, 30).flatMap((raw): DirectoryServer[] => {
    const s = raw as Partial<DirectoryServer> | null;
    if (!s || typeof s.name !== 'string' || typeof s.url !== 'string') return [];
    let url: string;
    try {
      url = normalizeServerUrl(s.url);
    } catch {
      return [];
    }
    const name = s.name.trim().slice(0, 40);
    return name ? [{ name, url, region: typeof s.region === 'string' ? s.region.trim().slice(0, 30) : '', official: s.official === true }] : [];
  });
}

async function fetchDirectory(server: string): Promise<DirectoryServer[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`${normalizeServerUrl(server)}/api/v1/directory`, { signal: controller.signal });
    return response.ok ? parseDirectory(await response.json()) : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function wireServerSuggestions(card: HTMLElement, tr: (fr: string, en: string) => string): void {
  const input = card.querySelector<HTMLInputElement>('#auth-server');
  if (!input) return;
  const host = document.createElement('div');
  host.className = 'server-suggestions';
  host.hidden = true;
  input.insertAdjacentElement('afterend', host);

  let asked = '';
  const refresh = async () => {
    const server = input.value.trim();
    if (!server || server === asked) return;
    asked = server;
    const servers = await fetchDirectory(server);
    if (asked !== server || !host.isConnected) return;
    host.hidden = servers.length === 0;
    host.innerHTML = servers.length ? `
      <span class="field-hint">${tr('Serveurs proposés par ce serveur', 'Servers suggested by this server')}</span>
      <div class="server-chips">${servers.map(s => `
        <button type="button" class="server-chip" data-server-url="${escapeHtml(s.url)}" title="${escapeHtml(s.url)}" aria-pressed="${s.url === server.replace(/\/+$/, '')}">
          <strong>${escapeHtml(s.name)}</strong>${s.region ? `<span>${escapeHtml(s.region)}</span>` : ''}${s.official ? `<span class="server-chip-badge">${tr('officiel', 'official')}</span>` : ''}
        </button>`).join('')}</div>
      <span class="field-hint">${tr('Chaque serveur a ses propres comptes.', 'Each server has its own accounts.')}</span>` : '';
  };
  host.addEventListener('click', event => {
    const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-server-url]');
    if (!chip) return;
    input.value = chip.dataset.serverUrl!;
    // Garder la liste affichée : on ne va pas chercher celle du serveur choisi
    asked = input.value;
    // Les écouteurs existants (conditions du serveur…) voient le changement
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    host.querySelectorAll('[data-server-url]').forEach(b => b.setAttribute('aria-pressed', String(b === chip)));
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 500);
  });
  void refresh();
}
