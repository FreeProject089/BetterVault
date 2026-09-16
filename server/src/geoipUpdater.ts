import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createGeoLookup, openGeoDatabase, type GeoLookup } from './geoip.ts';

/**
 * Base de localisation DB-IP City Lite (licence CC BY 4.0), téléchargée par le serveur lui-même.
 * Seul le serveur contacte db-ip.com pour récupérer le fichier : aucune adresse IP d'utilisateur n'est envoyée.
 */

const MAX_AGE_MS = 32 * 86_400_000;
const CHECK_EVERY_MS = 24 * 3_600_000;

const monthOf = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

/** Base du mois, ou celle du mois précédent si elle n'est pas encore publiée */
export async function downloadGeoDatabase(fetchImpl: typeof fetch = fetch, now = new Date()): Promise<{ month: string; data: Buffer }> {
  const months = [now, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))].map(monthOf);
  let lastError: unknown;
  for (const month of months) {
    const url = `https://download.db-ip.com/free/dbip-city-lite-${month}.mmdb.gz`;
    try {
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`${url} : HTTP ${response.status}`);
      const data = gunzipSync(Buffer.from(await response.arrayBuffer()));
      createGeoLookup(data); // refuse un fichier qui n'est pas une base MaxMind DB
      return { month, data };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Écriture atomique : le serveur ne lit jamais un fichier à moitié écrit */
export function writeGeoDatabase(path: string, data: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.download`;
  writeFileSync(temp, data);
  renameSync(temp, path);
}

/**
 * Localisation remplaçable à chaud : la base peut apparaître ou être mise à jour pendant que le serveur tourne.
 */
export interface SwappableGeo extends GeoLookup {
  available(): boolean;
  replace(next: GeoLookup | null): void;
}

export function swappableGeo(initial: GeoLookup | null): SwappableGeo {
  let current = initial;
  return {
    lookup: ip => current?.lookup(ip) ?? null,
    available: () => current !== null,
    replace: next => { current = next; }
  };
}

export function startGeoUpdates(options: {
  path: string;
  geo: SwappableGeo;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}): { stop(): void; check(): Promise<void> } {
  const log = options.log ?? (message => console.log(message));
  let running = false;

  const check = async () => {
    if (running) return;
    const fresh = existsSync(options.path) && Date.now() - statSync(options.path).mtimeMs < MAX_AGE_MS;
    if (fresh) return;
    running = true;
    try {
      const { month, data } = await downloadGeoDatabase(options.fetchImpl);
      writeGeoDatabase(options.path, data);
      options.geo.replace(openGeoDatabase(options.path));
      log(`Base de localisation DB-IP ${month} installée (${Math.round(data.length / 1048576)} Mo). Attribution : IP Geolocation by DB-IP.`);
    } catch (err) {
      log(`Mise à jour de la base de localisation impossible : ${err instanceof Error ? err.message : err}`);
    } finally {
      running = false;
    }
  };

  void check();
  const timer = setInterval(() => void check(), CHECK_EVERY_MS);
  timer.unref?.();
  return { stop: () => clearInterval(timer), check };
}
