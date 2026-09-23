import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../server/src/db.ts';
import { createApp } from '../server/src/app.ts';
import { settingsFromEnv } from '../server/src/config.ts';
import { legalConfigured, legalFromEnv, parseLegalUpdate, DEFAULT_LEGAL } from '../server/src/legal.ts';

/**
 * Chaque serveur décide s'il publie des documents légaux. Un serveur personnel
 * n'a personne à informer : il doit pouvoir les retirer entièrement, sans que
 * l'application continue d'exiger l'acceptation de conditions inexistantes.
 */

const ADMIN_TOKEN = 'jeton-admin-de-test-0123456789';

describe('Documents légaux désactivables', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    server = createServer(createApp({
      db: openDatabase(':memory:'),
      serverSecret: 'secret-de-test-suffisamment-long-0123456789',
      minKdfMemoryKib: 8,
      decoyKdf: { t: 1, m: 64, p: 1 },
      settings: settingsFromEnv({ LEGAL_ENABLED: 'false' }),
      adminTokenHash: createHash('sha256').update(ADMIN_TOKEN).digest('base64')
    }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('n’annonce aucun document et répond 404 sur /legal', async () => {
    const info = await (await fetch(`${url}/api/v1/legal`)).json();
    expect(info.enabled).toBe(false);
    expect(info.documents).toEqual([]);

    for (const slug of ['terms', 'privacy', 'dpa', 'security', 'subprocessors']) {
      expect((await fetch(`${url}/legal/${slug}`)).status).toBe(404);
    }
    expect((await fetch(`${url}/legal`)).status).toBe(404);
  });

  it('ne réclame plus de compléter une identité d’hébergeur', async () => {
    const dashboard = await (await fetch(`${url}/api/v1/admin/dashboard`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
    })).json();
    expect(dashboard.security.legalEnabled).toBe(false);
    // La case de la liste de contrôle n'a plus lieu d'être signalée en retard
    expect(dashboard.security.legalConfigured).toBe(true);
  });

  it('se réactive depuis la page d’administration', async () => {
    const res = await fetch(`${url}/api/v1/admin/settings`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ legal: { enabled: true, operatorName: 'Association Exemple', contactEmail: 'contact@exemple.fr' } })
    });
    expect(res.status).toBeLessThan(300);

    const info = await (await fetch(`${url}/api/v1/legal`)).json();
    expect(info.enabled).toBe(true);
    expect(info.documents).toHaveLength(5);
    expect((await fetch(`${url}/legal/terms`)).status).toBe(200);
  });
});

describe('Lecture du réglage', () => {
  it('publie par défaut, et accepte les formes usuelles du non', () => {
    expect(legalFromEnv({}).enabled).toBe(true);
    expect(legalFromEnv({ LEGAL_ENABLED: '' }).enabled).toBe(true);
    expect(legalFromEnv({ LEGAL_ENABLED: 'true' }).enabled).toBe(true);
    for (const value of ['false', '0', 'off', 'no', 'NON', ' False ']) {
      expect(legalFromEnv({ LEGAL_ENABLED: value }).enabled).toBe(false);
    }
  });

  it('garde le réglage courant quand la mise à jour ne le mentionne pas', () => {
    const courant = { ...DEFAULT_LEGAL, enabled: false };
    expect(parseLegalUpdate({ operatorName: 'Exemple' }, courant).enabled).toBe(false);
    expect(parseLegalUpdate({ enabled: true }, courant).enabled).toBe(true);
    // Une valeur non booléenne ne fait pas basculer le réglage
    expect(parseLegalUpdate({ enabled: 'oui' }, courant).enabled).toBe(false);
  });

  it('ne réclame rien à compléter quand rien n’est publié', () => {
    expect(legalConfigured({ ...DEFAULT_LEGAL, enabled: false })).toBe(true);
    expect(legalConfigured({ ...DEFAULT_LEGAL, enabled: true })).toBe(false);
  });
});
