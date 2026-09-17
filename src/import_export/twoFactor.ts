import { normalizeTotpInput, parseOtpAuthUri, toOtpAuthUri } from '../crypto/otpauthUri';
import type { CredentialItem } from '../types/vault';

/**
 * Échange des codes 2FA avec le reste du monde.
 *
 * Un secret TOTP se transporte partout sous la même forme : l'URI `otpauth://`
 * du Key Uri Format de Google, celle que contiennent les QR codes affichés par
 * les sites. Aegis, 2FAS, Bitwarden, KeePassXC, Authenticator Pro : tous savent
 * la lire. C'est donc elle que l'on écrit, quel que soit l'emballage choisi —
 * liste de lignes, JSON, ou planche de QR codes à scanner.
 *
 * Rien n'est chiffré ici. Un fichier produit par ce module donne accès au second
 * facteur de chaque compte qu'il contient, et l'appelant doit soit le chiffrer
 * (encryptedExport), soit prévenir clairement.
 */

export interface TwoFactorEntry {
  /** Nom de l'identifiant dans BetterVault */
  title: string;
  /** Compte tel qu'il apparaîtra dans l'application d'authentification */
  account: string;
  issuer: string;
  uri: string;
}

export interface TwoFactorJson {
  format: 'bettervault.2fa';
  version: 1;
  exportedAt: string;
  entries: Array<{ title: string; account: string; issuer: string; uri: string }>;
}

/** Domaine d'un site, utilisé comme émetteur quand l'URI n'en porte pas */
function domainOf(website?: string): string {
  if (!website) return '';
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(website) ? website : `https://${website}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Les identifiants qui portent un secret 2FA, mis en forme pour l'export */
export function collectTwoFactor(credentials: CredentialItem[]): TwoFactorEntry[] {
  const entries: TwoFactorEntry[] = [];
  for (const credential of credentials) {
    const secret = credential.totpSecret?.trim();
    if (!secret) continue;

    // L'émetteur et le compte de l'URI d'origine priment : ils viennent du site
    const existant = /^otpauth:\/\//i.test(secret) ? parseOtpAuthUri(secret) : null;
    const account = existant?.account || credential.username || credential.title;
    const issuer = existant?.issuer || domainOf(credential.website) || credential.title;
    entries.push({
      title: credential.title,
      account,
      issuer,
      uri: toOtpAuthUri(secret, account, issuer)
    });
  }
  return entries;
}

/** Une URI par ligne : le format que lisent le plus d'applications, y compris à la main */
export function exportAsUriList(entries: TwoFactorEntry[]): string {
  return entries.map(e => e.uri).join('\n') + (entries.length ? '\n' : '');
}

export function exportAsJson(entries: TwoFactorEntry[], now = new Date()): string {
  const contenu: TwoFactorJson = {
    format: 'bettervault.2fa',
    version: 1,
    exportedAt: now.toISOString(),
    entries: entries.map(({ title, account, issuer, uri }) => ({ title, account, issuer, uri }))
  };
  return JSON.stringify(contenu, null, 2);
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);

/**
 * Planche de QR codes, à imprimer ou à afficher pour rescanner depuis un téléphone.
 *
 * Le SVG est fabriqué par l'appelant : le rendu du QR code vit dans l'interface, et
 * ce module reste utilisable sans navigateur — donc testable.
 */
export function exportAsQrSheet(
  entries: TwoFactorEntry[],
  renderQr: (uri: string) => string,
  labels: { title: string; warning: string; empty: string }
): string {
  const cartes = entries.map(entry => `
    <figure class="code">
      <div class="qr">${renderQr(entry.uri)}</div>
      <figcaption>
        <strong>${escapeHtml(entry.title)}</strong>
        <span>${escapeHtml(entry.account)}</span>
        ${entry.issuer && entry.issuer !== entry.title ? `<span class="issuer">${escapeHtml(entry.issuer)}</span>` : ''}
      </figcaption>
    </figure>`).join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(labels.title)}</title>
<style>
  :root { color-scheme: light }
  body { margin:0; padding:24px; background:#fff; color:#1f2328;
         font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif }
  h1 { font-size:19px; margin:0 0 6px }
  .warning { margin:0 0 20px; padding:11px 13px; border:1px solid #d4a72c; background:#fff8c5;
             border-radius:8px; font-size:13px; color:#4d2d00 }
  .sheet { display:grid; gap:16px; grid-template-columns:repeat(auto-fill,minmax(170px,1fr)) }
  .code { margin:0; padding:12px; border:1px solid #d8dee4; border-radius:10px; text-align:center;
          break-inside:avoid }
  .qr { display:grid; place-items:center }
  .qr svg { width:100%; height:auto; max-width:150px }
  figcaption { margin-top:8px; display:flex; flex-direction:column; gap:1px; word-break:break-word }
  figcaption strong { font-size:13px }
  figcaption span { font-size:11.5px; color:#656d76 }
  .empty { color:#656d76 }
  /* À l'impression, l'avertissement compte plus que les couleurs de fond */
  @media print {
    body { padding:0 }
    .warning { border-color:#000; background:transparent }
  }
</style>
</head>
<body>
<h1>${escapeHtml(labels.title)}</h1>
<p class="warning">${escapeHtml(labels.warning)}</p>
${entries.length ? `<div class="sheet">${cartes}</div>` : `<p class="empty">${escapeHtml(labels.empty)}</p>`}
</body>
</html>`;
}

/* ── Import ─────────────────────────────────────────────────────────────── */

export interface ImportedTwoFactor {
  title: string;
  account: string;
  issuer: string;
  /** Valeur prête à ranger dans `totpSecret` : Base32 si standard, URI sinon */
  secret: string;
}

export interface TwoFactorImportResult {
  entries: ImportedTwoFactor[];
  /** Lignes non reconnues, rendues telles quelles pour que l'on puisse les corriger */
  rejected: string[];
}

function fromUri(uri: string, titreSuggere?: string): ImportedTwoFactor | null {
  const secret = normalizeTotpInput(uri);
  if (!secret) return null;
  const info = parseOtpAuthUri(uri);
  const account = info?.account ?? '';
  const issuer = info?.issuer ?? '';
  return {
    title: titreSuggere?.trim() || issuer || account || 'Code 2FA',
    account,
    issuer,
    secret
  };
}

/**
 * Lit ce qui a été collé ou déposé : notre JSON, une liste d'URI, ou un secret nu.
 *
 * On accepte volontairement large. Le contenu vient d'un export fait ailleurs, et
 * exiger un format précis obligerait à le remettre en forme à la main — alors que
 * tout ce dont on a besoin, un secret Base32, se reconnaît sans ambiguïté.
 */
export function parseTwoFactorImport(raw: string): TwoFactorImportResult {
  const texte = raw.trim();
  const entries: ImportedTwoFactor[] = [];
  const rejected: string[] = [];
  if (!texte) return { entries, rejected };

  // Notre JSON, ou tout JSON qui expose des entrées avec une URI
  if (texte.startsWith('{') || texte.startsWith('[')) {
    try {
      const parsed = JSON.parse(texte) as unknown;
      const liste = Array.isArray(parsed)
        ? parsed
        : ((parsed as { entries?: unknown }).entries ?? []) as unknown[];
      for (const brut of Array.isArray(liste) ? liste : []) {
        const item = brut as { uri?: unknown; url?: unknown; secret?: unknown; title?: unknown; name?: unknown; issuer?: unknown };
        const source = [item.uri, item.url, item.secret].find(v => typeof v === 'string' && v.trim()) as string | undefined;
        if (!source) {
          rejected.push(JSON.stringify(brut).slice(0, 80));
          continue;
        }
        const titre = (typeof item.title === 'string' && item.title)
          || (typeof item.name === 'string' && item.name)
          || (typeof item.issuer === 'string' && item.issuer)
          || undefined;
        const entree = fromUri(source, titre || undefined);
        if (entree) entries.push(entree);
        else rejected.push(source.slice(0, 80));
      }
      return { entries, rejected };
    } catch {
      // Pas du JSON valide : on retombe sur la lecture ligne à ligne
    }
  }

  for (const ligne of texte.split(/\r?\n/)) {
    const valeur = ligne.trim();
    if (!valeur || valeur.startsWith('#')) continue;
    const entree = fromUri(valeur);
    if (entree) entries.push(entree);
    else rejected.push(valeur.slice(0, 80));
  }
  return { entries, rejected };
}

/** Écarte ce que le coffre possède déjà, pour ne pas créer de doublon au second import */
export function withoutKnown(entries: ImportedTwoFactor[], existing: CredentialItem[]): ImportedTwoFactor[] {
  const connus = new Set(
    existing
      .map(c => c.totpSecret?.trim())
      .filter((s): s is string => !!s)
      .map(s => (parseOtpAuthUri(s)?.secret ?? s).toUpperCase().replace(/[\s-]/g, ''))
  );
  return entries.filter(entry => {
    const nu = (parseOtpAuthUri(entry.secret)?.secret ?? entry.secret).toUpperCase().replace(/[\s-]/g, '');
    if (connus.has(nu)) return false;
    connus.add(nu);
    return true;
  });
}
