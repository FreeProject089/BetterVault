import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../server/src/db.ts';
import { createApp } from '../server/src/app.ts';
import { settingsFromEnv } from '../server/src/config.ts';
import { totpCode, base32Decode, currentStep } from '../server/src/totp.ts';

/**
 * Comptes administrateurs : chacun ne fait que ce que son rôle permet, les actions
 * sensibles demandent une reconfirmation, et l'on ne peut pas se retrouver sans
 * propriétaire.
 */

const TOKEN = 'jeton-de-secours-assez-long-0123456789';
const PASS = 'mot de passe admin solide';

describe('Administration : rôles', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    server = createServer(createApp({
      db: openDatabase(':memory:'),
      serverSecret: 'secret-serveur-suffisamment-long-0123456789',
      settings: settingsFromEnv({}),
      adminTokenHash: createHash('sha256').update(TOKEN).digest('base64'),
      authRateLimit: { windowMs: 60_000, max: 10_000 }
    }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

  const call = (method: string, path: string, bearer: string, body?: unknown) => fetch(`${url}/api/v1/admin/${path}`, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const login = async (email: string, password = PASS, totp?: string) => {
    const r = await fetch(`${url}/api/v1/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, totp }) });
    return { status: r.status, body: await r.json().catch(() => null) as { token: string } | null };
  };

  it('crée le premier propriétaire avec le jeton de secours', async () => {
    const r = await call('POST', 'accounts', TOKEN, { email: 'owner@exemple.fr', password: PASS, role: 'owner' });
    expect(r.status).toBe(201);
    expect((await login('owner@exemple.fr')).status).toBe(200);
  });

  it('refuse un mauvais mot de passe sans dire si le compte existe', async () => {
    const faux = await login('owner@exemple.fr', 'pas le bon mot de passe');
    const inconnu = await login('personne@exemple.fr', 'pas le bon mot de passe');
    expect(faux.status).toBe(401);
    expect(inconnu.status).toBe(401);
  });

  it('limite chaque rôle à ses permissions', async () => {
    const owner = (await login('owner@exemple.fr')).body!.token;
    await call('POST', 'accounts', owner, { email: 'lecteur@exemple.fr', password: PASS, role: 'viewer' });
    await call('POST', 'accounts', owner, { email: 'operateur@exemple.fr', password: PASS, role: 'operator' });
    const viewer = (await login('lecteur@exemple.fr')).body!.token;
    const operator = (await login('operateur@exemple.fr')).body!.token;

    expect((await call('GET', 'dashboard', viewer)).status).toBe(200);
    expect((await call('POST', 'smtp-test', viewer, {})).status).toBe(403);
    expect((await call('PUT', 'settings', operator, { registrationOpen: false })).status).toBe(403);
    expect((await call('GET', 'accounts', operator)).status).toBe(403);
    expect((await call('GET', 'accounts', owner)).status).toBe(200);
  });

  it('exige une reconfirmation récente pour une action sensible', async () => {
    const t0 = Date.now();
    let fakeNow = t0;
    const s = createServer(createApp({
      db: openDatabase(':memory:'),
      serverSecret: 'secret-serveur-suffisamment-long-0123456789',
      settings: settingsFromEnv({}),
      adminTokenHash: createHash('sha256').update(TOKEN).digest('base64'),
      authRateLimit: { windowMs: 60_000, max: 10_000 },
      now: () => fakeNow
    }));
    await new Promise<void>(resolve => s.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/v1/admin`;
    const post = (path: string, bearer: string, body: unknown, method = 'POST') => fetch(`${base}/${path}`, { method, headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    try {
      await post('accounts', TOKEN, { email: 'o@exemple.fr', password: PASS, role: 'owner' });
      const token = (await (await post('login', '', { email: 'o@exemple.fr', password: PASS })).json() as { token: string }).token;

      // Juste après la connexion : c'est une confirmation récente
      expect((await post('settings', token, { registrationOpen: false }, 'PUT')).status).toBe(200);

      // Dix minutes plus tard, la session vit encore mais ne suffit plus
      fakeNow = t0 + 10 * 60_000;
      const refus = await post('settings', token, { registrationOpen: true }, 'PUT');
      expect(refus.status).toBe(403);
      expect((await refus.json() as { error: { code: string } }).error.code).toBe('reauth_required');
      expect((await fetch(`${base}/dashboard`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);

      expect((await post('reauth', token, { password: 'mauvais mot de passe' })).status).toBe(401);
      expect((await post('reauth', token, { password: PASS })).status).toBe(204);
      expect((await post('settings', token, { registrationOpen: true }, 'PUT')).status).toBe(200);
    } finally {
      await new Promise<void>(resolve => s.close(() => resolve()));
    }
  });

  it('ne laisse pas supprimer, désactiver ni rétrograder le dernier propriétaire', async () => {
    const owner = (await login('owner@exemple.fr')).body!.token;
    const accounts = (await (await call('GET', 'accounts', owner)).json() as { accounts: Array<{ id: string; email: string }> }).accounts;
    const id = accounts.find(a => a.email === 'owner@exemple.fr')!.id;
    expect((await call('DELETE', `accounts/${id}`, owner)).status).toBe(409);
    expect((await call('PATCH', `accounts/${id}`, owner, { disabled: true })).status).toBe(409);
    expect((await call('PATCH', `accounts/${id}`, owner, { role: 'viewer' })).status).toBe(409);
  });

  it('ferme les sessions d’un compte désactivé', async () => {
    const owner = (await login('owner@exemple.fr')).body!.token;
    const viewer = (await login('lecteur@exemple.fr')).body!.token;
    const accounts = (await (await call('GET', 'accounts', owner)).json() as { accounts: Array<{ id: string; email: string }> }).accounts;
    const id = accounts.find(a => a.email === 'lecteur@exemple.fr')!.id;
    expect((await call('PATCH', `accounts/${id}`, owner, { disabled: true })).status).toBe(200);
    expect((await call('GET', 'dashboard', viewer)).status).toBe(401);
    expect((await login('lecteur@exemple.fr')).status).toBe(401);
  });

  it('demande le code 2FA une fois activé', async () => {
    const owner = (await login('owner@exemple.fr')).body!.token;
    const { secret } = await (await call('POST', 'totp/setup', owner, {})).json() as { secret: string };
    const code = totpCode(base32Decode(secret), currentStep(Date.now()));
    expect((await call('POST', 'totp/enable', owner, { code })).status).toBe(204);

    expect((await login('owner@exemple.fr')).status).toBe(401);
    const next = totpCode(base32Decode(secret), currentStep(Date.now()) + 1);
    expect((await login('owner@exemple.fr', PASS, next)).status).toBe(200);
  });

  it('refuse un mot de passe administrateur trop court', async () => {
    const r = await call('POST', 'accounts', TOKEN, { email: 'court@exemple.fr', password: 'court', role: 'viewer' });
    expect(r.status).toBe(400);
  });
});
