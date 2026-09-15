// Restaure une sauvegarde BetterVault téléchargée depuis le stockage S3.
// Usage : node server/tools/decrypt-backup.ts <sauvegarde .db.gz ou .db.gz.enc> <fichier .db de sortie>
// La clé est lue dans BACKUP_ENCRYPTION_KEY pour les sauvegardes chiffrées.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decryptBackup } from '../src/backup.ts';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage : node server/tools/decrypt-backup.ts <sauvegarde> <sortie.db>');
  process.exit(1);
}

let data: Buffer = readFileSync(input);
if (input.endsWith('.enc')) {
  const key = process.env.BACKUP_ENCRYPTION_KEY;
  if (!key) {
    console.error('Définissez BACKUP_ENCRYPTION_KEY avec la clé utilisée par le serveur');
    process.exit(1);
  }
  data = decryptBackup(data, key);
}
writeFileSync(output, gunzipSync(data));
console.log(`Base restaurée dans ${output}. Arrêtez le serveur, remplacez le fichier de base par celui-ci, puis redémarrez.`);
