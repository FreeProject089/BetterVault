import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../server/src/db.ts';
import { createApp } from '../server/src/app.ts';
import { settingsFromEnv } from '../server/src/config.ts';

/**
 * Limites de tentatives.
 *
 * L'usage normal ne doit pas buter dessus (l'administration fait plusieurs
 * appels par écran), alors que deviner un jeton doit l'être vite. Et quand on
 * est bloqué, la réponse dit exactement combien de temps attendre.
 */

const TOKEN = 'jeton-de-secours-assez-long-0123456789';

describe('Limites de tentatives', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    // Sans « authRateLimit » : ce sont les vraies règles par action qui s'appliquent
    server = createServer(createApp({
      db: openDatabase(':memory:'),
      serverSecret: 'secret-serveur-suffisamment-long-0123456789',
      settings: settingsFromEnv({}),
      adminTokenHash: createHash('sha256').update(TOKEN).digest('base64'),
      clusterAutoStart: false
    }));
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });

  const admin = (bearer: string) => fetch(`${url}/api/v1/admin/emails`, { headers: { Authorization: `Bearer ${bearer}` } });

  it('laisse l’administration naviguer : 60 appels valides d’affilée passent', async () => {
    for (let i = 0; i < 60; i++) {
      const r = await admin(TOKEN);
      expect(r.status, `appel ${i + 1}`).toBe(200);
    }
  });

  it('bloque vite les jetons faux, puis refuse même le bon jeton pendant le blocage', async () => {
    const statuts: number[] = [];
    for (let i = 0; i < 12; i++) statuts.push((await admin('faux-jeton')).status);
    // Les dix premiers échecs sont des 401, la suite est bloquée
    expect(statuts.slice(0, 10).every(s => s === 401)).toBe(true);
    expect(statuts.at(-1)).toBe(429);
    // Deviner juste pendant le blocage ne sert à rien
    expect((await admin(TOKEN)).status).toBe(429);
  });

  it('dit exactement combien de temps attendre', async () => {
    const r = await fetch(`${url}/api/v1/admin/emails`, { headers: { Authorization: 'Bearer faux-jeton', 'Accept-Language': 'fr' } });
    expect(r.status).toBe(429);
    const attente = Number(r.headers.get('retry-after'));
    expect(attente).toBeGreaterThan(0);
    expect(attente).toBeLessThanOrEqual(15 * 60);
    const corps = await r.json() as { error: { message: string; details: { retryAfterSeconds: number } } };
    expect(corps.error.details.retryAfterSeconds).toBe(attente);
    expect(corps.error.message).toMatch(/réessayez dans \d+ (s|min)/);
  });

  it('traduit le délai en anglais', async () => {
    const r = await fetch(`${url}/api/v1/admin/emails`, { headers: { Authorization: 'Bearer faux', 'Accept-Language': 'en' } });
    expect((await r.json() as { error: { message: string } }).error.message).toMatch(/^Too many attempts, try again in \d+ (s|min)$/);
  });
});
