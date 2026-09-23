import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../server/src/db.ts';
import { createApp } from '../server/src/app.ts';
import { settingsFromEnv } from '../server/src/config.ts';
import { createEmailTemplates, EMAIL_KINDS, MAX_SUBJECT } from '../server/src/emailTemplates.ts';

/**
 * Emails dans l'administration : aperçu, personnalisation et langue d'envoi.
 *
 * La personnalisation touche le sujet et une introduction, jamais les faits
 * ni l'avertissement : c'est ce que ces tests vérifient avant tout.
 */

const TOKEN = 'jeton-de-secours-assez-long-0123456789';

describe('Emails : personnalisation (stockage)', () => {
  it('garde un sujet sur une seule ligne : un retour chariot injecterait des en-têtes', () => {
    const store = createEmailTemplates(openDatabase(':memory:'));
    const saved = store.save('newLogin', 'fr', { subject: 'Alerte\r\nBcc: tout-le-monde@exemple.fr', intro: 'Bonjour' });
    expect(saved!.subject).not.toMatch(/[\r\n]/);
    expect(saved!.subject).toBe('Alerte Bcc: tout-le-monde@exemple.fr');
  });

  it('borne les longueurs et ignore ce qui n’est pas du texte', () => {
    const store = createEmailTemplates(openDatabase(':memory:'));
    const saved = store.save('newLogin', 'en', { subject: 'x'.repeat(5000), intro: { toString: () => 'piège' } });
    expect(saved!.subject.length).toBe(MAX_SUBJECT);
    // Un objet devient sa représentation texte, jamais du code exécuté
    expect(typeof saved!.intro).toBe('string');
  });

  it('retire l’entrée quand tout est vidé, plutôt que de garder une coquille', () => {
    const store = createEmailTemplates(openDatabase(':memory:'));
    store.save('resetCode', 'fr', { subject: 'Votre code', intro: '' });
    expect(store.override('resetCode', 'fr')).toEqual({ subject: 'Votre code' });
    expect(store.save('resetCode', 'fr', { subject: '  ', intro: '' })).toBeNull();
    expect(store.override('resetCode', 'fr')).toBeUndefined();
  });

  it('a un aperçu pour chaque message, dans chaque langue', () => {
    const store = createEmailTemplates(openDatabase(':memory:'));
    for (const kind of EMAIL_KINDS) {
      for (const locale of ['fr', 'en'] as const) {
        const message = store.preview(kind.id, locale, 'https://coffre.exemple.fr');
        expect(message, `${kind.id} ${locale}`).not.toBeNull();
        expect(message!.html).toContain(`<html lang="${locale}">`);
      }
    }
    expect(store.preview('inexistant', 'fr', '')).toBeNull();
  });
});

describe('Emails : routes d’administration', () => {
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

  const call = (method: string, path: string, body?: unknown, bearer = TOKEN) => fetch(`${url}/api/v1/admin/${path}`, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });

  it('refuse sans authentification', async () => {
    expect((await call('GET', 'emails', undefined, 'mauvais-jeton')).status).toBe(401);
  });

  it('liste les messages avec leur personnalisation et la langue par défaut', async () => {
    const r = await call('GET', 'emails');
    expect(r.status).toBe(200);
    const view = await r.json() as { defaultLocale: string; kinds: Array<{ id: string }> };
    expect(view.defaultLocale).toBe('en');
    expect(view.kinds.map(k => k.id)).toEqual(EMAIL_KINDS.map(k => k.id));
  });

  it('change la langue par défaut, et refuse une langue inconnue', async () => {
    expect((await call('PUT', 'emails/locale', { locale: 'fr' })).status).toBe(200);
    expect(((await (await call('GET', 'emails')).json()) as { defaultLocale: string }).defaultLocale).toBe('fr');
    expect((await call('PUT', 'emails/locale', { locale: 'klingon' })).status).toBe(400);
  });

  it('enregistre une personnalisation et l’applique à l’aperçu', async () => {
    const saved = await call('PUT', 'emails/template', { id: 'newLogin', locale: 'fr', subject: 'Connexion à Coffre ACME', intro: 'Le service informatique vous écrit.' });
    expect(saved.status).toBe(200);
    const r = await call('POST', 'emails/preview', { id: 'newLogin', locale: 'fr' });
    const preview = await r.json() as { subject: string; html: string; text: string };
    expect(preview.subject).toBe('Connexion à Coffre ACME');
    expect(preview.html).toContain('Le service informatique vous écrit.');
    // L'avertissement de sécurité et les faits sont toujours là (sans adresse
    // publique, pas de bouton « Ce n'était pas moi » : l'aperçu reste fidèle)
    expect(preview.html).toContain('Si ce n’était pas vous, agissez maintenant.');
    expect(preview.html).toContain('Adresse IP');
  });

  it('montre un brouillon sans l’enregistrer', async () => {
    const r = await call('POST', 'emails/preview', { id: 'resetCode', locale: 'en', draft: { subject: 'Draft subject', intro: '' } });
    expect(((await r.json()) as { subject: string }).subject).toBe('Draft subject');
    const liste = await (await call('GET', 'emails')).json() as { kinds: Array<{ id: string; overrides: Record<string, { subject: string }> }> };
    expect(liste.kinds.find(k => k.id === 'resetCode')!.overrides.en.subject).toBe('');
  });

  it('échappe le HTML d’une introduction, dans l’aperçu comme dans l’envoi', async () => {
    await call('PUT', 'emails/template', { id: 'sharedInvite', locale: 'en', intro: '<a href="https://piege.example">Cliquez</a>' });
    const preview = await (await call('POST', 'emails/preview', { id: 'sharedInvite', locale: 'en' })).json() as { html: string };
    expect(preview.html).not.toContain('<a href="https://piege.example">');
    expect(preview.html).toContain('&lt;a href=&quot;https://piege.example&quot;&gt;');
  });

  it('refuse un message ou une langue inconnus', async () => {
    expect((await call('PUT', 'emails/template', { id: 'pasUnMessage', locale: 'fr', subject: 'x' })).status).toBe(400);
    expect((await call('PUT', 'emails/template', { id: 'newLogin', locale: 'xx', subject: 'x' })).status).toBe(400);
    expect((await call('POST', 'emails/preview', { id: 'pasUnMessage' })).status).toBe(400);
  });
});
