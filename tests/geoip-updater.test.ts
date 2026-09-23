import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { downloadGeoDatabase, startGeoUpdates, swappableGeo } from '../server/src/geoipUpdater.ts';

// Base MaxMind DB minimale : 0.0.0.0/1 → FR, Lyon
const str = (s: string) => Buffer.concat([Buffer.from([(2 << 5) | Buffer.byteLength(s)]), Buffer.from(s)]);
const map = (entries: Array<[string, Buffer]>) => Buffer.concat([Buffer.from([(7 << 5) | entries.length]), ...entries.flatMap(([k, v]) => [str(k), v])]);
const uint16 = (n: number) => Buffer.from([(5 << 5) | 2, n >> 8, n & 0xff]);
const uint32 = (n: number) => Buffer.from([(6 << 5) | 4, n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
const MMDB = Buffer.concat([
  Buffer.from([0, 0, 17, 0, 0, 1]), Buffer.alloc(16),
  map([['country', map([['iso_code', str('FR')]])], ['city', map([['names', map([['fr', str('Lyon')]])]])]]),
  Buffer.from([0xab, 0xcd, 0xef]), Buffer.from('MaxMind.com'),
  map([['node_count', uint32(1)], ['record_size', uint16(24)], ['ip_version', uint16(4)]])
]);

describe('Mise à jour de la base de localisation', () => {
  it('prend le mois précédent si celui en cours n’est pas publié', async () => {
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => {
      asked.push(url);
      return url.includes('2027-03') ? new Response(new Uint8Array(gzipSync(MMDB))) : new Response('absent', { status: 404 });
    }) as unknown as typeof fetch;
    const result = await downloadGeoDatabase(fetchImpl, new Date(Date.UTC(2027, 3, 2)));
    expect(result.month).toBe('2027-03');
    expect(asked[0]).toContain('dbip-city-lite-2027-04.mmdb.gz');
  });

  it('refuse un fichier qui n’est pas une base', async () => {
    const fetchImpl = (async () => new Response(new Uint8Array(gzipSync(Buffer.from('<html>erreur</html>'))))) as unknown as typeof fetch;
    await expect(downloadGeoDatabase(fetchImpl)).rejects.toThrow();
  });

  it('installe la base et l’utilise sans redémarrer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bv-geo-'));
    try {
      const geo = swappableGeo(null);
      expect(geo.available()).toBe(false);
      expect(geo.lookup('10.0.0.1')).toBeNull();
      const fetchImpl = (async () => new Response(new Uint8Array(gzipSync(MMDB)))) as unknown as typeof fetch;
      const updates = startGeoUpdates({ path: join(dir, 'geoip.mmdb'), geo, fetchImpl, log: () => undefined });
      await updates.check();
      await new Promise(r => setTimeout(r, 50));
      updates.stop();
      expect(existsSync(join(dir, 'geoip.mmdb'))).toBe(true);
      expect(geo.available()).toBe(true);
      expect(geo.lookup('10.0.0.1')).toEqual({ country: 'FR', city: 'Lyon', lat: null, lon: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
