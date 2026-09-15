// Télécharge la base de localisation DB-IP City Lite (licence CC BY 4.0) pour afficher le lieu approximatif des sessions.
// La base reste sur le serveur : aucune adresse IP n'est envoyée à un service tiers.
// Usage : node scripts/download-geoip.mjs [chemin de sortie, défaut server/data/geoip.mmdb]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const output = resolve(process.argv[2] ?? 'server/data/geoip.mmdb');
const now = new Date();

async function fetchMonth(date) {
  const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  const url = `https://download.db-ip.com/free/dbip-city-lite-${month}.mmdb.gz`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} : HTTP ${response.status}`);
  return { month, data: gunzipSync(Buffer.from(await response.arrayBuffer())) };
}

let result;
try {
  result = await fetchMonth(now);
} catch {
  // La base du mois peut ne pas être encore publiée : on prend celle du mois précédent
  result = await fetchMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, result.data);
console.log(`Base DB-IP City Lite ${result.month} enregistrée dans ${output} (${Math.round(result.data.length / 1048576)} Mo).`);
console.log('Attribution requise : « IP Geolocation by DB-IP » (https://db-ip.com).');
