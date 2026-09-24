import { isIP } from 'node:net';

/**
 * Emplacement d'un serveur, pour la carte de l'administration.
 *
 * La géolocalisation de l'adresse IP se trompe dès qu'un serveur est derrière
 * un relais (Cloudflare, tunnel, proxy) : elle donne alors l'emplacement du
 * relais. L'hébergeur peut donc régler l'emplacement lui-même ; à défaut, on
 * géolocalise l'adresse, mais jamais celle d'un relais connu ni une adresse
 * locale, qui ne diraient rien de vrai.
 */

export interface Place {
  lat: number;
  lon: number;
  /** Ville ou description libre (« Genève », « OVH Gravelines ») */
  label: string;
}

/** Emplacement valide, sinon null (vide, hors bornes, mal formé) */
export function parsePlace(value: unknown): Place | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const lat = Number(v.lat), lon = Number(v.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const label = String(v.label ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  // Trois décimales : une centaine de mètres, bien assez pour une carte du monde
  return { lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000, label };
}

/* Plages publiées par Cloudflare (cloudflare.com/ips) : l'adresse d'un domaine proxifié */
const CLOUDFLARE_V4 = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
  '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14',
  '172.64.0.0/13', '131.0.72.0/22'];
const CLOUDFLARE_V6 = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'];
const LOCAL_V4 = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '169.254.0.0/16', '100.64.0.0/10', '0.0.0.0/8'];
const LOCAL_V6 = ['::1/128', 'fc00::/7', 'fe80::/10', '::/128'];

const v4 = (ip: string) => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
const v6 = (ip: string): bigint => {
  const [head, tail = ''] = ip.split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b] : a;
  return groups.reduce((n, g) => (n << 16n) + BigInt(parseInt(g || '0', 16)), 0n);
};
const inRange = (ip: string, cidr: string) => {
  const [base, bitsText] = cidr.split('/');
  const bits = Number(bitsText);
  if (isIP(ip) === 4 && isIP(base) === 4) {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((v4(ip) & mask) >>> 0) === ((v4(base) & mask) >>> 0);
  }
  if (isIP(ip) === 6 && isIP(base) === 6) {
    const shift = BigInt(128 - bits);
    return (v6(ip) >> shift) === (v6(base) >> shift);
  }
  return false;
};

/** Pourquoi une adresse ne dit rien de l'emplacement du serveur : relais, réseau local, ou rien à redire */
export function addressKind(ip: string): 'proxy' | 'local' | null {
  const plain = ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
  if (!isIP(plain)) return null;
  const family = isIP(plain);
  if ((family === 4 ? LOCAL_V4 : LOCAL_V6).some(c => inRange(plain, c))) return 'local';
  if ((family === 4 ? CLOUDFLARE_V4 : CLOUDFLARE_V6).some(c => inRange(plain, c))) return 'proxy';
  return null;
}
