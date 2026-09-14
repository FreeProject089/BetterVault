import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { openDatabase } from './src/db.ts';
import { createApp } from './src/app.ts';

const secret = process.env.BETTERVAULT_SECRET ?? '';
if (secret.length < 32) {
  console.error('BETTERVAULT_SECRET doit être défini (32 caractères minimum). Voir server/.env.example');
  process.exit(1);
}

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
const dbPath = resolve(process.env.BETTERVAULT_DB ?? 'server/data/bettervault.db');
const staticDir = process.env.BETTERVAULT_STATIC ? resolve(process.env.BETTERVAULT_STATIC) : null;
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean)
  : '*';

mkdirSync(dirname(dbPath), { recursive: true });

const api = createApp({ db: openDatabase(dbPath), serverSecret: secret, corsOrigins });

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

/** Sert l'application web compilée (dist/) à la même origine que l'API */
function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): void {
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  const candidate = normalize(join(root, pathname));
  const insideRoot = candidate === root || candidate.startsWith(root + sep);
  const file = insideRoot && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(root, 'index.html');

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://api.pwnedpasswords.com; frame-ancestors 'none'");
  res.setHeader('Cache-Control', file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}

const server = createServer((req, res) => {
  const isApi = (req.url ?? '').startsWith('/api/');
  if (staticDir && !isApi && (req.method === 'GET' || req.method === 'HEAD')) {
    serveStatic(staticDir, req, res);
    return;
  }
  void api(req, res);
});

server.listen(port, host, () => {
  console.log(`BetterVault server: http://${host}:${port}${staticDir ? ` (application ${staticDir})` : ''} (base ${dbPath})`);
});
