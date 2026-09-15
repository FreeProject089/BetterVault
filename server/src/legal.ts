import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Documents légaux publiés par chaque serveur (/legal) : conditions d'utilisation, confidentialité,
 * accord de traitement des données (DPA, art. 28 RGPD), mesures de sécurité, sous-traitants.
 * Ce sont des modèles : l'hébergeur renseigne son identité dans /admin et reste responsable de leur contenu.
 */

export interface LegalSettings {
  operatorName: string;
  operatorAddress: string;
  contactEmail: string;
  dpoContact: string;
  hostingProvider: string;
  hostingLocation: string;
  supervisoryAuthority: string;
  jurisdiction: string;
  effectiveDate: string;
}

export const DEFAULT_LEGAL: LegalSettings = {
  operatorName: '',
  operatorAddress: '',
  contactEmail: '',
  dpoContact: '',
  hostingProvider: '',
  hostingLocation: '',
  supervisoryAuthority: 'Commission nationale de l’informatique et des libertés (CNIL), www.cnil.fr',
  jurisdiction: 'France',
  effectiveDate: ''
};

export const LEGAL_DOCUMENTS = [
  { slug: 'terms', title: 'Conditions d’utilisation' },
  { slug: 'privacy', title: 'Politique de confidentialité' },
  { slug: 'dpa', title: 'Accord de traitement des données (DPA)' },
  { slug: 'security', title: 'Mesures de sécurité' },
  { slug: 'subprocessors', title: 'Sous-traitants' }
] as const;

export function legalFromEnv(env: Record<string, string | undefined>): LegalSettings {
  return {
    ...DEFAULT_LEGAL,
    operatorName: env.LEGAL_OPERATOR_NAME ?? '',
    operatorAddress: env.LEGAL_OPERATOR_ADDRESS ?? '',
    contactEmail: env.LEGAL_CONTACT_EMAIL ?? '',
    dpoContact: env.LEGAL_DPO_CONTACT ?? '',
    hostingProvider: env.LEGAL_HOSTING_PROVIDER ?? '',
    hostingLocation: env.LEGAL_HOSTING_LOCATION ?? '',
    effectiveDate: env.LEGAL_EFFECTIVE_DATE ?? ''
  };
}

export function parseLegalUpdate(input: unknown, current: LegalSettings): LegalSettings {
  const body = (input ?? {}) as Partial<Record<keyof LegalSettings, unknown>>;
  const next = { ...current };
  for (const key of Object.keys(DEFAULT_LEGAL) as Array<keyof LegalSettings>) {
    if (typeof body[key] === 'string') next[key] = (body[key] as string).trim().slice(0, 500);
  }
  if (next.effectiveDate && !/^\d{4}-\d{2}-\d{2}$/.test(next.effectiveDate)) throw new Error('Date d’entrée en vigueur au format AAAA-MM-JJ');
  return next;
}

export const legalConfigured = (legal: LegalSettings) => !!legal.operatorName && !!legal.contactEmail;

export interface LegalContext {
  legal: LegalSettings;
  retentionDays: number;
  backupsEnabled: boolean;
  emailEnabled: boolean;
  billingEnabled: boolean;
  geoEnabled: boolean;
  sessionDays: number;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|mailto:)[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

/** Markdown restreint (titres, listes, tableaux, paragraphes) : suffisant pour les modèles, sans HTML brut */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let table: string[][] | null = null;

  const flush = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
    if (list) out.push(`<${list.ordered ? 'ol' : 'ul'}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.ordered ? 'ol' : 'ul'}>`);
    list = null;
    if (table) {
      const [head, , ...rows] = table;
      out.push(`<div class="table"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    }
    table = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (!trimmed) {
      flush();
    } else if (heading) {
      flush();
      const level = heading[1].length;
      const id = heading[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      out.push(`<h${level} id="${id}">${inline(heading[2])}</h${level}>`);
    } else if (trimmed === '---') {
      flush();
      out.push('<hr>');
    } else if (trimmed.startsWith('|')) {
      if (!table) flush();
      table ??= [];
      table.push(trimmed.replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
    } else if (bullet || numbered) {
      const ordered = !!numbered;
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]);
    } else {
      if (list || table) flush();
      paragraph.push(trimmed);
    }
  }
  flush();
  return out.join('\n');
}

/** Remplace {{variable}} et garde ou retire les blocs {{#si condition}} … {{/si}} */
export function fillTemplate(template: string, values: Record<string, string>, flags: Record<string, boolean>): string {
  let text = template;
  for (;;) {
    const next = text.replace(/\{\{#si (\w+)\}\}([\s\S]*?)\{\{\/si\}\}/g, (_, flag: string, content: string) => (flags[flag] ? content : ''));
    if (next === text) break;
    text = next;
  }
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] || `[${key} à compléter]`);
}

export function renderLegalPage(root: string, slug: string, context: LegalContext): string | null {
  const doc = LEGAL_DOCUMENTS.find(d => d.slug === slug);
  const templatePath = join(root, `${slug}.fr.md`);
  if (!doc || !existsSync(templatePath)) return null;
  const { legal } = context;
  const values: Record<string, string> = {
    ...legal,
    effectiveDate: legal.effectiveDate || new Date().toISOString().slice(0, 10),
    retentionDays: String(context.retentionDays),
    sessionDays: String(context.sessionDays)
  };
  const flags = {
    backups: context.backupsEnabled,
    emails: context.emailEnabled,
    billing: context.billingEnabled,
    geo: context.geoEnabled,
    dpo: !!legal.dpoContact
  };
  const body = markdownToHtml(fillTemplate(readFileSync(templatePath, 'utf8'), values, flags));
  const nav = LEGAL_DOCUMENTS.map(d => `<a href="/legal/${d.slug}"${d.slug === slug ? ' aria-current="page"' : ''}>${escapeHtml(d.title)}</a>`).join('');
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(doc.title)} · ${escapeHtml(legal.operatorName || 'BetterVault')}</title>
<style>
:root{--bg:#0d1117;--card:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e;--accent:#7773e8;color-scheme:dark}
@media (prefers-color-scheme:light){:root{--bg:#f6f8fa;--card:#fff;--border:#d0d7de;--text:#1f2328;--muted:#656d76;--accent:#5754c7;color-scheme:light}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
header{border-bottom:1px solid var(--border);background:var(--card)}header div{max-width:860px;margin:0 auto;padding:14px 16px;display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center}
header strong{margin-right:auto}nav{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:13px}nav a{color:var(--muted);text-decoration:none}nav a[aria-current]{color:var(--accent);font-weight:600}
main{max-width:860px;margin:0 auto;padding:24px 16px 64px}h1{font-size:28px;line-height:1.25}h2{margin-top:32px;font-size:20px}h3{font-size:16px}
a{color:var(--accent)}code{font-size:13px;padding:1px 5px;border:1px solid var(--border);border-radius:5px}
.table{overflow-x:auto}table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}th,td{border:1px solid var(--border);padding:8px 10px;text-align:left;vertical-align:top}th{background:var(--card)}
hr{border:none;border-top:1px solid var(--border);margin:32px 0}.meta{color:var(--muted);font-size:13px}
</style>
</head>
<body>
<header><div><strong>${escapeHtml(legal.operatorName || 'BetterVault')}</strong><nav>${nav}</nav></div></header>
<main>
${legalConfigured(legal) ? '' : '<p class="meta"><strong>Modèle non complété :</strong> l’hébergeur de ce serveur doit renseigner ses informations dans la page d’administration.</p>'}
${body}
</main>
</body>
</html>`;
}
