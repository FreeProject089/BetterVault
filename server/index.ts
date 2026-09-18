import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { openDatabase } from './src/db.ts';
import { createApp } from './src/app.ts';
import { settingsFromEnv, type ServerSettings } from './src/config.ts';
import { createBackupService } from './src/backup.ts';
import { openGeoDatabase, type GeoLookup } from './src/geoip.ts';
import { startGeoUpdates, swappableGeo } from './src/geoipUpdater.ts';
import { createMetrics } from './src/metrics.ts';

const secret = process.env.BETTERVAULT_SECRET ?? '';
if (secret.length < 32) {
  console.error('BETTERVAULT_SECRET doit être défini (32 caractères minimum). Voir server/.env.example');
  process.exit(1);
}

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
const dbPath = resolve(process.env.BETTERVAULT_DB ?? 'server/data/bettervault.db');
const staticDir = process.env.BETTERVAULT_STATIC ? resolve(process.env.BETTERVAULT_STATIC) : null;
const adminDir = resolve(import.meta.dirname, 'admin');
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean)
  : '*';

let settings: ServerSettings;
try {
  settings = settingsFromEnv(process.env);
} catch (err) {
  console.error(`Configuration invalide : ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

mkdirSync(dirname(dbPath), { recursive: true });
const db = openDatabase(dbPath);

// Pièces jointes chiffrées : à côté de la base par défaut (volume /data dans Docker)
const filesDir = resolve(process.env.BETTERVAULT_FILES ?? join(dirname(dbPath), 'files'));
mkdirSync(filesDir, { recursive: true });

// Base de localisation facultative (scripts/download-geoip.mjs) : lieu approximatif des sessions, calculé sur le serveur
const geoPath = resolve(process.env.GEOIP_DB ?? join(dirname(dbPath), 'geoip.mmdb'));
let initialGeo: GeoLookup | null = null;
if (existsSync(geoPath)) {
  try {
    initialGeo = openGeoDatabase(geoPath);
  } catch (err) {
    console.warn(`Base de localisation ignorée : ${err instanceof Error ? err.message : err}`);
  }
}
const geo = swappableGeo(initialGeo);
// GEOIP_AUTO_UPDATE=true : le serveur télécharge la base puis la renouvelle chaque mois
const geoUpdates = process.env.GEOIP_AUTO_UPDATE === 'true' ? startGeoUpdates({ path: geoPath, geo }) : null;
const metrics = createMetrics();

const backupKey = process.env.BACKUP_ENCRYPTION_KEY || null;
if (settings.backup.enabled && !backupKey) {
  console.warn('Sauvegardes activées sans BACKUP_ENCRYPTION_KEY : les copies de la base ne seront pas chiffrées en plus.');
}

/**
 * Jeton de la page d'administration : ADMIN_TOKEN s'il est défini,
 * sinon généré au premier démarrage et affiché une seule fois dans les journaux.
 */
function adminTokenHash(): string | null {
  const sha256 = (value: string) => createHash('sha256').update(value).digest('base64');
  if (process.env.ADMIN_TOKEN === 'disabled') return null;
  if (process.env.ADMIN_TOKEN) {
    if (process.env.ADMIN_TOKEN.length < 16) {
      console.error('ADMIN_TOKEN doit contenir au moins 16 caractères');
      process.exit(1);
    }
    return sha256(process.env.ADMIN_TOKEN);
  }
  const stored = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_token_hash') as { value: string } | undefined;
  if (stored) return stored.value;
  const token = randomBytes(24).toString('base64url');
  const hash = sha256(token);
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('admin_token_hash', hash);
  console.log(`\nJeton d'administration (affiché une seule fois, à conserver) : ${token}\nPage d'administration : /admin\n`);
  return hash;
}

const api = createApp({
  db,
  serverSecret: secret,
  corsOrigins,
  trustProxy: process.env.TRUST_PROXY === 'true',
  settings,
  adminTokenHash: adminTokenHash(),
  filesDir,
  geo,
  metrics,
  dbPath,
  backupFactory: getSettings => createBackupService({ db, filesDir, settings: getSettings, encryptionKey: backupKey })
});

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// Aperçu des pièces jointes (blob:), aucun script tiers, pas d'intégration dans un autre site
const CSP = "default-src 'self'; script-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob:; frame-src blob:; object-src 'none'; base-uri 'self'; form-action 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://api.pwnedpasswords.com; frame-ancestors 'none'";

/** Sert un dossier de fichiers statiques ; les chemins inconnus renvoient index.html */
function serveStatic(root: string, pathname: string, res: ServerResponse): void {
  const candidate = normalize(join(root, pathname));
  const insideRoot = candidate === root || candidate.startsWith(root + sep);
  const file = insideRoot && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(root, 'index.html');

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (settings.publicUrl.startsWith('https://')) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  res.setHeader('Cache-Control', file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = req.url ?? '/';
  const isRead = req.method === 'GET' || req.method === 'HEAD';
  if (!url.startsWith('/api/') && isRead) {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (pathname === '/legal' || pathname.startsWith('/legal/')) {
      void api(req, res);
      return;
    }
    // Les pages « ce n'était pas moi » sont rendues par l'API, pas par l'application
    if (pathname.startsWith('/security/')) {
      void api(req, res);
      return;
    }
    if (pathname === '/admin' || pathname.startsWith('/admin/')) {
      serveStatic(adminDir, pathname.slice('/admin'.length) || '/', res);
      return;
    }
    if (staticDir) {
      serveStatic(staticDir, pathname, res);
      return;
    }
  }
  void api(req, res);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Le port ${port} est déjà utilisé sur ${host}. Arrêtez l'autre processus ou changez PORT (server/.env ou .env).`);
  } else if (err.code === 'EACCES') {
    console.error(`Accès refusé au port ${port} sur ${host}. Choisissez un port supérieur à 1024.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`BetterVault server: http://${host}:${port}${staticDir ? ` (application ${staticDir})` : ''} (base ${dbPath})`);
  console.log(settings.smtp ? `Emails : ${settings.smtp.host}:${settings.smtp.port}` : 'Emails désactivés (SMTP_HOST non défini)');
});

// Arrêt propre (docker stop, Ctrl+C) : fin des requêtes en cours puis fermeture de la base
function shutdown(): void {
  api.close();
  geoUpdates?.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 5000).unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
