/**
 * Utilitaires pour les secrets 2FA : URI otpauth:// (Google Key URI Format),
 * secrets Base32 bruts et format hérité KeePassXC (key=...&step=...&size=...).
 */

export interface OtpAuthInfo {
  type: 'totp' | 'hotp';
  secret: string;
  issuer?: string;
  account?: string;
  algorithm: string;
  digits: number;
  period: number;
}

export function isValidBase32(secret: string): boolean {
  return /^[A-Z2-7]+=*$/.test(secret) && secret.replace(/=+$/, '').length >= 8;
}

function cleanSecret(secret: string | null | undefined): string {
  return (secret ?? '').replace(/[\s-]/g, '').toUpperCase();
}

export function parseOtpAuthUri(input: string): OtpAuthInfo | null {
  const raw = input.trim();
  if (!/^otpauth:\/\//i.test(raw)) return null;

  let url: URL;
  let label: string;
  try {
    url = new URL(raw);
    label = decodeURIComponent(url.pathname.replace(/^\//, ''));
  } catch {
    return null;
  }

  const type = url.hostname.toLowerCase();
  if (type !== 'totp' && type !== 'hotp') return null;

  const secret = cleanSecret(url.searchParams.get('secret'));
  if (!isValidBase32(secret)) return null;

  const sep = label.indexOf(':');
  const labelIssuer = sep >= 0 ? label.slice(0, sep).trim() : undefined;
  const account = (sep >= 0 ? label.slice(sep + 1) : label).trim() || undefined;
  const issuer = url.searchParams.get('issuer')?.trim() || labelIssuer || undefined;
  const digits = parseInt(url.searchParams.get('digits') ?? '6', 10);
  const period = parseInt(url.searchParams.get('period') ?? '30', 10);

  return {
    type,
    secret,
    issuer,
    account,
    algorithm: (url.searchParams.get('algorithm') ?? 'SHA1').toUpperCase(),
    digits: Number.isFinite(digits) && digits > 0 ? digits : 6,
    period: Number.isFinite(period) && period > 0 ? period : 30
  };
}

export function buildOtpAuthUri(info: Omit<OtpAuthInfo, 'type'>): string {
  const label = info.issuer ? `${info.issuer}:${info.account ?? ''}` : (info.account || 'BetterVault');
  const params = new URLSearchParams({
    secret: info.secret,
    algorithm: info.algorithm,
    digits: String(info.digits),
    period: String(info.period)
  });
  if (info.issuer) params.set('issuer', info.issuer);
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

function isDefaultTotp(info: Pick<OtpAuthInfo, 'algorithm' | 'digits' | 'period'>): boolean {
  return info.algorithm === 'SHA1' && info.digits === 6 && info.period === 30;
}

/**
 * Normalise une saisie 2FA en valeur stockable : secret Base32 si les paramètres
 * sont standards, sinon URI otpauth:// complète. Retourne null si invalide.
 */
export function normalizeTotpInput(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  if (/^otpauth:\/\//i.test(raw)) {
    const info = parseOtpAuthUri(raw);
    if (!info || info.type !== 'totp') return null;
    return isDefaultTotp(info) ? info.secret : buildOtpAuthUri(info);
  }

  if (/(^|&)key=/.test(raw)) {
    const params = new URLSearchParams(raw);
    const secret = cleanSecret(params.get('key'));
    if (!isValidBase32(secret)) return null;
    const period = parseInt(params.get('step') ?? '30', 10) || 30;
    const digits = parseInt(params.get('size') ?? '6', 10) || 6;
    const info = { secret, algorithm: 'SHA1', digits, period };
    return isDefaultTotp(info) ? secret : buildOtpAuthUri(info);
  }

  const secret = cleanSecret(raw);
  return isValidBase32(secret) ? secret : null;
}

/** Convertit un secret stocké (Base32 ou URI) en URI otpauth:// pour l'export */
export function toOtpAuthUri(secretOrUri: string, account?: string, issuer?: string): string {
  if (/^otpauth:\/\//i.test(secretOrUri.trim())) return secretOrUri.trim();
  return buildOtpAuthUri({ secret: cleanSecret(secretOrUri), account, issuer, algorithm: 'SHA1', digits: 6, period: 30 });
}
