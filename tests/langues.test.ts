import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../server/src/db.ts';
import { createApp } from '../server/src/app.ts';
import { settingsFromEnv } from '../server/src/config.ts';
import { cleanStrings, createLanguages, MAX_ENTRIES } from '../server/src/languages.ts';

/**
 * Langues ajoutées par l'administration.
 *
 * Ces textes s'affichent là où le coffre est déchiffré : un serveur ne doit
 * pas pouvoir s'en servir pour glisser du code dans l'application. C'est la
 * première chose vérifiée ici.
 */

const TOKEN = 'jeton-de-secours-assez-long-0123456789';

describe('Langues : nettoyage', () => {
  it('écarte toute traduction qui pourrait sortir du texte', () => {
    const { strings, rejected } = cleanStrings({
      'Déverrouiller': 'Desbloquear',
      'Annuler': '<img src=x onerror=alert(1)>',
      'Fermer': 'Cerrar" onmouseover="alert(1)',
      'Copier': 'Copiar > todo',
      // Les apostrophes restent permises : les attributs sont entre guillemets doubles
      'Aide': 'l\'aide d\'abord'
    });
    expect(strings).toEqual({ 'Déverrouiller': 'Desbloquear', 'Aide': 'l\'aide d\'abord' });
    expect(rejected).toBe(3);
  });

  it('écarte les valeurs qui ne sont pas du texte, sans perdre le reste', () => {
    const { strings, rejected } = cleanStrings({ 'A': 'a', 'B': 42, 'C': { x: 1 }, 'D': '   ', '': 'vide' });
    expect(strings).toEqual({ A: 'a' });
    expect(rejected).toBe(4);
  });

  it('borne le nombre d’entrées', () => {
    const énorme = Object.fromEntries(Array.from({ length: MAX_ENTRIES + 50 }, (_, i) => [`t${i}`, `v${i}`]));
    const { strings, rejected } = cleanStrings(énorme);
    expect(Object.keys(strings).length).toBe(MAX_ENTRIES);
    expect(rejected).toBe(50);
  });

  it('refuse un code invalide, le français, l’anglais, et un nom vide', () => {
    const langues = createLanguages(openDatabase(':memory:'));
    expect(() => langues.save('../etc', 'x', { A: 'a' })).toThrow(/Code/);
    expect(() => langues.save('fr', 'Français', { A: 'a' })).toThrow(/intégrés/);
    expect(() => langues.save('es', '  ', { A: 'a' })).toThrow(/nom/);
    expect(() => langues.save('es', 'Español', { A: '<b>' })).toThrow(/Aucune traduction/);
  });

  it('retire le balisage du nom de la langue', () => {
    const langues = createLanguages(openDatabase(':memory:'));
    const { pack } = langues.save('es', 'Español<script>', { A: 'a' });
    expect(pack.name).toBe('Españolscript');
  });
});

describe('Langues : routes', () => {
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
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });

  const admin = (method: string, path: string, body?: unknown, bearer = TOKEN) => fetch(`${url}/api/v1/admin/${path}`, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });

  it('n’accepte une langue que de l’administration', async () => {
    const r = await admin('PUT', 'i18n/es', { name: 'Español', strings: { 'Annuler': 'Cancelar' } }, 'mauvais');
    expect(r.status).toBe(401);
  });

  it('ajoute une langue, la liste publiquement, et sert son dictionnaire', async () => {
    const r = await admin('PUT', 'i18n/es', { name: 'Español', strings: { 'Annuler': 'Cancelar', 'Fermer': 'Cerrar<' } });
    expect(r.status).toBe(200);
    const résultat = await r.json() as { pack: { count: number }; rejected: number };
    expect(résultat.pack.count).toBe(1);
    // L'administration apprend ce qui a été écarté, au lieu de le découvrir à l'usage
    expect(résultat.rejected).toBe(1);

    const liste = await (await fetch(`${url}/api/v1/i18n`)).json() as { languages: Array<{ code: string; name: string }> };
    expect(liste.languages).toEqual([expect.objectContaining({ code: 'es', name: 'Español' })]);

    const pack = await (await fetch(`${url}/api/v1/i18n/es`)).json() as { strings: Record<string, string> };
    expect(pack.strings).toEqual({ 'Annuler': 'Cancelar' });
  });

  it('refuse un chemin détourné comme code de langue', async () => {
    expect((await fetch(`${url}/api/v1/i18n/..%2F..%2Fsettings`)).status).toBe(404);
    expect((await fetch(`${url}/api/v1/i18n/inconnue`)).status).toBe(404);
  });

  it('retire une langue', async () => {
    expect((await admin('DELETE', 'i18n/es')).status).toBe(204);
    const liste = await (await fetch(`${url}/api/v1/i18n`)).json() as { languages: unknown[] };
    expect(liste.languages).toEqual([]);
    expect((await admin('DELETE', 'i18n/es')).status).toBe(404);
  });
});
