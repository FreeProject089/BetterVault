import { normalizeServerUrl } from '../account/cloudClient';

/**
 * Choix du serveur, sous le champ « Adresse du serveur » : une liste
 * déroulante des serveurs que publie le serveur saisi — les nœuds de sa
 * grappe, puis l'annuaire de son hébergeur —, rangés par région, avec leur
 * temps de réponse. « Auto » prend le plus rapide.
 *
 * Un compte n'existe que dans sa zone (les nœuds d'une même zone le partagent).
 * Pour se connecter, Auto ne choisit donc que parmi les serveurs qui ont déjà
 * le compte ; pour en créer un, parmi tous.
 *
 * La liste vient d'un serveur : elle est vérifiée et échappée comme une donnée
 * extérieure, et seules des adresses https (ou locales) sont retenues.
 */

export interface DirectoryServer {
  name: string;
  url: string;
  region: string;
  official: boolean;
  /** Zone de la grappe (EU, US…) : les serveurs d'une même zone partagent les comptes */
  zone?: string;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function parseEntries(list: unknown[], cluster: boolean): DirectoryServer[] {
  return list.slice(0, 30).flatMap((raw): DirectoryServer[] => {
    const s = raw as (Partial<DirectoryServer> & { zone?: unknown }) | null;
    if (!s || typeof s.name !== 'string' || typeof s.url !== 'string') return [];
    let url: string;
    try {
      url = normalizeServerUrl(s.url);
    } catch {
      return [];
    }
    const name = s.name.trim().slice(0, 40);
    const zone = cluster && typeof s.zone === 'string' && /^[A-Z0-9-]{1,12}$/.test(s.zone) ? s.zone : undefined;
    return name ? [{ name, url, region: typeof s.region === 'string' ? s.region.trim().slice(0, 30) : '', official: cluster || s.official === true, ...(zone ? { zone } : {}) }] : [];
  });
}

/** Lit la réponse de /api/v1/directory sans lui faire confiance : nœuds de la grappe, puis annuaire */
export function parseDirectory(input: unknown): DirectoryServer[] {
  const list = input as { enabled?: unknown; servers?: unknown; cluster?: unknown } | null;
  if (!list || typeof list !== 'object') return [];
  const all = [
    ...(Array.isArray(list.cluster) ? parseEntries(list.cluster, true) : []),
    ...(list.enabled === true && Array.isArray(list.servers) ? parseEntries(list.servers, false) : [])
  ];
  const seen = new Set<string>();
  return all.filter(s => !seen.has(s.url) && seen.add(s.url));
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

/** Temps de réponse d'un serveur (le meilleur de deux essais), ou null s'il ne répond pas */
export async function measureLatency(url: string, timeoutMs = 3000): Promise<number | null> {
  let best: number | null = null;
  for (let i = 0; i < 2; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = performance.now();
    try {
      const response = await fetch(`${url}/api/v1/health`, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) return best;
      const ms = Math.round(performance.now() - start);
      best = best === null ? ms : Math.min(best, ms);
    } catch {
      return best;
    } finally {
      clearTimeout(timer);
    }
  }
  return best;
}

/**
 * Serveurs parmi lesquels Auto choisit. Connexion : ceux qui partagent les
 * comptes du serveur saisi (même zone de grappe), lui compris. Création : tous.
 */
export function autoCandidates(servers: DirectoryServer[], current: string, mode: 'signin' | 'create'): DirectoryServer[] {
  if (mode === 'create') return servers;
  const here = servers.find(s => s.url === current.replace(/\/+$/, ''));
  if (!here?.zone) return servers.filter(s => s.url === here?.url);
  return servers.filter(s => s.zone === here.zone);
}

const CHEVRON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const BOLT = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>';

export function wireServerSuggestions(card: HTMLElement, tr: (fr: string, en: string) => string, mode: 'signin' | 'create' = 'signin'): void {
  const input = card.querySelector<HTMLInputElement>('#auth-server');
  if (!input) return;

  // Bouton qui ouvre la liste, à droite du champ
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'icon-btn server-toggle';
  toggle.hidden = true;
  toggle.setAttribute('aria-haspopup', 'listbox');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', tr('Choisir un serveur', 'Choose a server'));
  toggle.innerHTML = CHEVRON;
  const wrap = document.createElement('div');
  wrap.className = 'input-with-actions server-picker';
  input.replaceWith(wrap);
  wrap.append(input, toggle);

  const host = document.createElement('div');
  host.className = 'server-suggestions';
  host.hidden = true;
  host.setAttribute('role', 'listbox');
  host.setAttribute('aria-label', tr('Serveurs disponibles', 'Available servers'));
  const note = document.createElement('span');
  note.className = 'field-hint server-note';
  note.hidden = true;
  wrap.insertAdjacentElement('afterend', host);
  host.insertAdjacentElement('afterend', note);

  let servers: DirectoryServer[] = [];
  const latency = new Map<string, number | null>();
  let asked = '';

  const current = () => input.value.trim().replace(/\/+$/, '');
  const pill = (url: string) => {
    if (!latency.has(url)) return `<span class="server-ping" data-ping="${escapeHtml(url)}">…</span>`;
    const ms = latency.get(url);
    return ms === null
      ? `<span class="server-ping off" data-ping="${escapeHtml(url)}">${tr('injoignable', 'unreachable')}</span>`
      : `<span class="server-ping ${ms! < 80 ? 'good' : ms! < 200 ? 'ok' : 'slow'}" data-ping="${escapeHtml(url)}">${ms} ms</span>`;
  };

  const draw = () => {
    host.innerHTML = '';
    if (!servers.length) return;
    // Par région (ou par zone), les serveurs officiels d'abord
    const groups = new Map<string, DirectoryServer[]>();
    for (const s of [...servers].sort((a, b) => Number(b.official) - Number(a.official) || a.name.localeCompare(b.name))) {
      const key = s.region || (s.zone ? `${tr('Zone', 'Zone')} ${s.zone}` : tr('Autres serveurs', 'Other servers'));
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };
    host.innerHTML = `
      <button type="button" class="server-option server-auto" role="option" data-server-auto>
        <span class="server-auto-icon">${BOLT}</span>
        <span class="server-option-text"><strong>${tr('Auto — le plus rapide', 'Auto — the fastest')}</strong>
          <small>${mode === 'create'
            ? tr('Mesure chaque serveur et prend celui qui répond le plus vite.', 'Measures each server and picks the one that answers fastest.')
            : tr('Parmi les serveurs qui ont déjà votre compte.', 'Among the servers that already hold your account.')}</small></span>
      </button>
      ${[...groups].map(([region, list]) => `
        <div class="server-group" role="group" aria-label="${escapeHtml(region)}">
          <span class="server-group-label">${escapeHtml(region)}</span>
          ${list.map(s => `
            <button type="button" class="server-option" role="option" data-server-url="${escapeHtml(s.url)}" aria-selected="${s.url === current()}" title="${escapeHtml(s.url)}">
              <span class="server-option-text"><strong>${escapeHtml(s.name)}</strong><small>${escapeHtml(hostOf(s.url))}${s.zone ? ` · ${tr('zone', 'zone')} ${escapeHtml(s.zone)}` : ''}</small></span>
              ${s.official ? `<span class="server-chip-badge">${tr('officiel', 'official')}</span>` : ''}
              ${pill(s.url)}
            </button>`).join('')}
        </div>`).join('')}
      <span class="field-hint server-menu-hint">${servers.some(s => s.zone) && new Set(servers.map(s => s.zone ?? s.url)).size > 1
        ? tr('Chaque zone a ses propres comptes : un compte créé en Europe n’existe pas aux États-Unis.', 'Each zone has its own accounts: an account created in Europe does not exist in the US.')
        : tr('Chaque serveur a ses propres comptes.', 'Each server has its own accounts.')}</span>`;
  };

  const measureAll = async () => {
    const todo = servers.filter(s => !latency.has(s.url));
    await Promise.all(todo.map(async s => {
      const ms = await measureLatency(s.url);
      latency.set(s.url, ms);
      const el = [...host.querySelectorAll<HTMLElement>('[data-ping]')].find(e => e.dataset.ping === s.url);
      if (el) el.outerHTML = pill(s.url);
    }));
  };

  const choose = (url: string) => {
    input.value = url;
    asked = url;
    // Les écouteurs existants (conditions du serveur…) voient le changement
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    host.querySelectorAll('[data-server-url]').forEach(b => b.setAttribute('aria-selected', String(b.getAttribute('data-server-url') === url)));
  };

  const open = (show: boolean) => {
    host.hidden = !show || !servers.length;
    toggle.setAttribute('aria-expanded', String(!host.hidden));
    wrap.classList.toggle('open', !host.hidden);
    if (!host.hidden) void measureAll();
  };

  const refresh = async () => {
    const server = input.value.trim();
    if (!server || server === asked) return;
    asked = server;
    const found = await fetchDirectory(server);
    if (asked !== server || !host.isConnected) return;
    servers = found;
    toggle.hidden = !servers.length;
    draw();
    if (!servers.length) open(false);
  };

  toggle.addEventListener('click', () => open(host.hidden !== false));
  host.addEventListener('click', async event => {
    const target = event.target as HTMLElement;
    const option = target.closest<HTMLElement>('[data-server-url]');
    if (option) {
      choose(option.dataset.serverUrl!);
      note.hidden = true;
      open(false);
      return;
    }
    if (target.closest('[data-server-auto]')) {
      const auto = host.querySelector<HTMLButtonElement>('[data-server-auto]')!;
      auto.disabled = true;
      auto.querySelector('strong')!.textContent = tr('Mesure en cours…', 'Measuring…');
      await measureAll();
      const pool = autoCandidates(servers, current(), mode).filter(s => typeof latency.get(s.url) === 'number');
      const best = pool.sort((a, b) => latency.get(a.url)! - latency.get(b.url)!)[0];
      auto.disabled = false;
      auto.querySelector('strong')!.textContent = tr('Auto — le plus rapide', 'Auto — the fastest');
      if (best) {
        choose(best.url);
        note.textContent = tr(`Auto : ${best.name}, ${latency.get(best.url)} ms`, `Auto: ${best.name}, ${latency.get(best.url)} ms`);
      } else {
        note.textContent = tr('Aucun serveur n’a répondu : l’adresse saisie est gardée.', 'No server answered: the address you typed is kept.');
      }
      note.hidden = false;
      open(false);
    }
  });
  // Fermer par Échap ou par un clic ailleurs
  card.addEventListener('keydown', event => { if (event.key === 'Escape' && !host.hidden) { open(false); toggle.focus(); } });
  const outside = (event: MouseEvent) => {
    // L'écran a changé : l'écouteur part avec lui
    if (!host.isConnected) { document.removeEventListener('click', outside); return; }
    if (!host.hidden && !host.contains(event.target as Node) && !wrap.contains(event.target as Node)) open(false);
  };
  document.addEventListener('click', outside);

  let timer: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener('input', () => {
    if (input.value.trim() === asked) return;
    note.hidden = true;
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 500);
  });
  void refresh();
}
