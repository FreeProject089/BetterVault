import { readFileSync } from 'node:fs';
import { isIPv4, isIPv6 } from 'node:net';

/**
 * Localisation approximative des sessions, entièrement sur le serveur :
 * lecture d'une base MaxMind DB (.mmdb, ex. DB-IP City Lite) sans dépendance ni appel à un service tiers.
 * Seuls le pays, la ville et l'adresse IP tronquée sont conservés, jamais l'adresse complète.
 */

export interface GeoResult {
  country: string | null;
  city: string | null;
  /** Position approximative, quand la base la fournit (bases « city ») */
  lat?: number | null;
  lon?: number | null;
}

export interface GeoLookup {
  lookup(ip: string): GeoResult | null;
  /** Base réellement chargée (une localisation remplaçable peut être vide pour l'instant) */
  available?(): boolean;
}

const MARKER = Buffer.concat([Buffer.from([0xab, 0xcd, 0xef]), Buffer.from('MaxMind.com')]);

class Decoder {
  private readonly buf: Buffer;
  private readonly base: number;

  constructor(buf: Buffer, base: number) {
    this.buf = buf;
    this.base = base;
  }

  decode(start: number, depth = 0): [unknown, number] {
    if (depth > 32) throw new Error('Base GeoIP trop imbriquée');
    const buf = this.buf;
    let offset = start;
    const ctrl = buf[offset++];
    let type = ctrl >> 5;

    if (type === 1) {
      const size = (ctrl >> 3) & 0x3;
      const high = ctrl & 0x7;
      let pointer: number;
      if (size === 0) {
        pointer = (high << 8) | buf[offset];
        offset += 1;
      } else if (size === 1) {
        pointer = ((high << 16) | buf.readUInt16BE(offset)) + 2048;
        offset += 2;
      } else if (size === 2) {
        pointer = (high * 0x1000000 + (buf[offset] << 16) + buf.readUInt16BE(offset + 1)) + 526336;
        offset += 3;
      } else {
        pointer = buf.readUInt32BE(offset);
        offset += 4;
      }
      return [this.decode(this.base + pointer, depth + 1)[0], offset];
    }

    if (type === 0) type = 7 + buf[offset++];
    let size = ctrl & 0x1f;
    if (size === 29) {
      size = 29 + buf[offset++];
    } else if (size === 30) {
      size = 285 + buf.readUInt16BE(offset);
      offset += 2;
    } else if (size === 31) {
      size = 65821 + (buf[offset] << 16) + buf.readUInt16BE(offset + 1);
      offset += 3;
    }

    switch (type) {
      case 2:
        return [buf.toString('utf8', offset, offset + size), offset + size];
      case 3:
        return [buf.readDoubleBE(offset), offset + 8];
      case 4:
        return [buf.subarray(offset, offset + size), offset + size];
      case 5:
      case 6:
      case 9:
      case 10: {
        let value = 0;
        for (let i = 0; i < size; i++) value = value * 256 + buf[offset + i];
        return [value, offset + size];
      }
      case 7: {
        const map: Record<string, unknown> = {};
        for (let i = 0; i < size; i++) {
          const [key, afterKey] = this.decode(offset, depth + 1);
          const [value, afterValue] = this.decode(afterKey, depth + 1);
          map[String(key)] = value;
          offset = afterValue;
        }
        return [map, offset];
      }
      case 8: {
        let value = 0;
        for (let i = 0; i < size; i++) value = (value << 8) | buf[offset + i];
        return [size === 4 ? value | 0 : value, offset + size];
      }
      case 11: {
        const list: unknown[] = [];
        for (let i = 0; i < size; i++) {
          const [value, next] = this.decode(offset, depth + 1);
          list.push(value);
          offset = next;
        }
        return [list, offset];
      }
      case 14:
        return [size !== 0, offset];
      case 15:
        return [buf.readFloatBE(offset), offset + 4];
      default:
        return [null, offset + size];
    }
  }
}

function ipBytes(ip: string): Uint8Array | null {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1];
  if (isIPv4(ip)) return Uint8Array.from(ip.split('.').map(Number));
  if (!isIPv6(ip)) return null;
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = ip.includes('::') ? (tail ? tail.split(':') : []) : [];
  const groups = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  const bytes = new Uint8Array(16);
  groups.slice(0, 8).forEach((group, i) => {
    const value = parseInt(group || '0', 16);
    bytes[i * 2] = value >> 8;
    bytes[i * 2 + 1] = value & 0xff;
  });
  return bytes;
}

export function openGeoDatabase(path: string): GeoLookup {
  return createGeoLookup(readFileSync(path));
}

export function createGeoLookup(buf: Buffer): GeoLookup {
  const markerAt = buf.lastIndexOf(MARKER);
  if (markerAt < 0) throw new Error('Base GeoIP invalide (métadonnées introuvables)');
  const metaStart = markerAt + MARKER.length;
  const metadata = new Decoder(buf, metaStart).decode(metaStart)[0] as Record<string, number>;
  const nodeCount = metadata.node_count;
  const recordSize = metadata.record_size;
  if (![24, 28, 32].includes(recordSize)) throw new Error(`Taille d'enregistrement GeoIP non prise en charge : ${recordSize}`);
  const nodeBytes = (recordSize * 2) / 8;
  const dataBase = nodeCount * nodeBytes + 16;
  const decoder = new Decoder(buf, dataBase);

  const readNode = (node: number, bit: number): number => {
    const offset = node * nodeBytes;
    if (recordSize === 24) return buf.readUIntBE(offset + bit * 3, 3);
    if (recordSize === 32) return buf.readUInt32BE(offset + bit * 4);
    const middle = buf[offset + 3];
    return bit === 0
      ? ((middle >> 4) * 0x1000000) + buf.readUIntBE(offset, 3)
      : ((middle & 0x0f) * 0x1000000) + buf.readUIntBE(offset + 4, 3);
  };

  // Dans une base IPv6, les adresses IPv4 commencent après 96 bits à zéro
  let ipv4Start = 0;
  if (metadata.ip_version === 6) {
    for (let i = 0; i < 96 && ipv4Start < nodeCount; i++) ipv4Start = readNode(ipv4Start, 0);
  }

  return {
    lookup(ip) {
      const bytes = ipBytes(ip);
      if (!bytes) return null;
      if (bytes.length === 16 && metadata.ip_version === 4) return null;
      let node = bytes.length === 4 ? ipv4Start : 0;
      const bits = bytes.length * 8;
      for (let i = 0; i < bits && node < nodeCount; i++) {
        node = readNode(node, (bytes[i >> 3] >> (7 - (i % 8))) & 1);
      }
      if (node <= nodeCount) return null;
      const record = decoder.decode(dataBase + (node - nodeCount - 16))[0] as {
        country?: { iso_code?: string };
        city?: { names?: Record<string, string> };
        location?: { latitude?: number; longitude?: number };
      } | null;
      if (!record) return null;
      return {
        country: record.country?.iso_code ?? null,
        city: record.city?.names?.fr ?? record.city?.names?.en ?? null,
        lat: typeof record.location?.latitude === 'number' ? record.location.latitude : null,
        lon: typeof record.location?.longitude === 'number' ? record.location.longitude : null
      };
    }
  };
}

/** IP tronquée pour l'affichage et le stockage : 203.0.113.x, 2001:db8:85a3::/48 */
export function truncateIp(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1];
  if (isIPv4(ip)) return ip.split('.').slice(0, 3).join('.') + '.x';
  if (isIPv6(ip)) {
    const bytes = ipBytes(ip)!;
    const groups = [0, 2, 4].map(i => ((bytes[i] << 8) | bytes[i + 1]).toString(16));
    return `${groups.join(':')}::/48`;
  }
  return 'inconnue';
}

/** Appareil lisible à partir du User-Agent, sans conserver la chaîne complète */
export function describeUserAgent(userAgent: string): string {
  const ua = userAgent || '';
  const os = /Android/i.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
    : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(ua) ? 'macOS'
    : /Linux/i.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : /node|undici/i.test(ua) ? 'Script' : '';
  const app = /Tauri|wry/i.test(ua) ? 'Application BetterVault' : '';
  return [app || browser || 'Navigateur inconnu', os].filter(Boolean).join(' · ');
}
