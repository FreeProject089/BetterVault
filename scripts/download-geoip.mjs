// Télécharge la base de localisation DB-IP City Lite (licence CC BY 4.0) pour afficher le lieu approximatif des sessions.
// La base reste sur le serveur : aucune adresse IP n'est envoyée à un service tiers.
// Le serveur peut aussi la tenir à jour tout seul : GEOIP_AUTO_UPDATE=true.
// Usage : node scripts/download-geoip.mjs [chemin de sortie, défaut server/data/geoip.mmdb]
import { resolve } from 'node:path';
import { downloadGeoDatabase, writeGeoDatabase } from '../server/src/geoipUpdater.ts';

const output = resolve(process.argv[2] ?? 'server/data/geoip.mmdb');
const { month, data } = await downloadGeoDatabase();
writeGeoDatabase(output, data);
console.log(`Base DB-IP City Lite ${month} enregistrée dans ${output} (${Math.round(data.length / 1048576)} Mo).`);
console.log('Attribution requise : « IP Geolocation by DB-IP » (https://db-ip.com).');
