import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from '../server/src/db.ts';
import { createApp } from '../server/src/app.ts';
import { settingsFromEnv } from '../server/src/config.ts';
import { Window } from 'happy-dom';

/**
 * L'onglet « Emails » de l'administration, dans un vrai document : la page
 * d'administration réelle, branchée sur un vrai serveur en mémoire.
 *
 * Le navigateur simulé vit dans sa propre fenêtre : le serveur, lui, garde les
 * objets de Node (ses URL de fichiers ne sont pas celles d'un navigateur).
 * Le jeton est créé par le test lui-même : aucun secret réel n'est utilisé.
 */

const TOKEN = randomBytes(24).toString('base64url');
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

/** Attend qu'une condition devienne vraie, sans dépendre d'un délai fixe */
async function until(test: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!test()) {
    if (Date.now() - start > ms) throw new Error('Délai dépassé');
    await tick(20);
  }
}

describe('Administration : onglet Emails', () => {
  let server: Server;
  let origin: string;
  let window: Window;
  let document: Window['document'];

  beforeAll(async () => {
    server = createServer(createApp({
      db: openDatabase(':memory:'),
      serverSecret: 'secret-serveur-suffisamment-long-0123456789',
      settings: settingsFromEnv({}),
      adminTokenHash: createHash('sha256').update(TOKEN).digest('base64'),
      authRateLimit: { windowMs: 60_000, max: 10_000 }
    }));
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // La page réelle, puis son script, comme le navigateur les chargerait
    window = new Window({ url: `${origin}/admin` });
    document = window.document;
    const html = readFileSync(resolve(__dirname, '../server/admin/index.html'), 'utf8');
    document.documentElement.innerHTML = html.replace(/^<!DOCTYPE html>/i, '').replace(/<script[\s\S]*?<\/script>/gi, '');
    // Les appels relatifs de la page vont au serveur de test, par le fetch de Node
    const nodeFetch = globalThis.fetch;
    (window as unknown as { fetch: typeof fetch }).fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      nodeFetch(typeof input === 'string' && input.startsWith('/') ? origin + input : input, init)) as typeof fetch;
    window.sessionStorage.setItem('bettervault-admin-token', TOKEN);
    const script = readFileSync(resolve(__dirname, '../server/admin/admin.js'), 'utf8');
    (window as unknown as { eval: (code: string) => unknown }).eval(script);
    await until(() => !document.getElementById('dashboard')!.hidden);
  });
  afterAll(async () => {
    await window?.happyDOM.close();
    await new Promise<void>(r => server?.close(() => r()));
  });

  /*
   * Ouvre l'onglet et attend un affichage neuf : sans vider d'abord, on
   * trouverait les éléments de l'ouverture précédente pendant que la nouvelle
   * se charge encore, et on cliquerait sur un écran sur le point d'être remplacé.
   */
  const ouvrir = async () => {
    document.getElementById('emails-panel')!.innerHTML = '';
    (document.querySelector('[data-tab="emails"]') as unknown as { click(): void }).click();
    await until(() => !!document.querySelector('.email-item'));
  };

  it('liste chaque message que le serveur envoie', async () => {
    await ouvrir();
    const noms = [...document.querySelectorAll('.email-item-name')].map(e => e.textContent!.trim());
    expect(noms.length).toBe(8);
    expect(document.querySelector('.email-item.active')).not.toBeNull();
  });

  it('affiche l’aperçu dans un cadre cloisonné, sans script possible', async () => {
    await ouvrir();
    const cadre = document.getElementById('email-preview')!;
    await until(() => (cadre.getAttribute('srcdoc') ?? '').includes('<!DOCTYPE html>'));
    // `sandbox` vide : ni script, ni formulaire, ni même origine
    expect(cadre.getAttribute('sandbox')).toBe('');
    const sujet = document.getElementById('email-preview-subject')!.textContent;
    expect(document.getElementById('email-preview-text')!.textContent, `sujet affiché : ${sujet}`).toMatch(/\S/);
  });

  it('enregistre un sujet, le marque personnalisé, et revient à l’original', async () => {
    await ouvrir();
    (document.getElementById('email-subject') as unknown as { value: string }).value = 'Sujet ACME';
    (document.getElementById('email-save') as unknown as { click(): void }).click();
    await until(() => !!document.querySelector('.email-item.active .badge-mini')).catch(async () => {
      const serveur = await (await fetch(`${origin}/api/v1/admin/emails`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
      throw new Error(`pas de pastille ; actif : ${document.querySelector('.email-item.active')?.outerHTML} ; serveur : ${JSON.stringify((serveur as { kinds: unknown[] }).kinds[0])}`);
    });

    // Le serveur l'a bien gardé
    const vue = await (await fetch(`${origin}/api/v1/admin/emails`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json() as {
      kinds: Array<{ id: string; overrides: Record<string, { subject: string }> }>;
    };
    const actif = document.querySelector('.email-item.active')!.getAttribute('data-email')!;
    const langue = document.querySelector('[data-edit-locale].active')!.getAttribute('data-edit-locale')!;
    expect(vue.kinds.find(k => k.id === actif)!.overrides[langue].subject).toBe('Sujet ACME');

    (document.getElementById('email-reset') as unknown as { click(): void }).click();
    await until(() => !document.querySelector('.email-item.active .badge-mini'));
  });

  it('liste les langues ajoutées avec leur couverture, et en retire une', async () => {
    // Une langue posée par l'API, comme l'aurait fait l'envoi d'un fichier
    await fetch(`${origin}/api/v1/admin/i18n/es`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Español', strings: { 'Annuler': 'Cancelar', 'Fermer': 'Cerrar' } })
    });
    document.getElementById('languages-panel')!.innerHTML = '';
    (document.querySelector('[data-tab="languages"]') as unknown as { click(): void }).click();
    await until(() => !!document.querySelector('.language-row'));
    const ligne = document.querySelector('.language-row')!;
    expect(ligne.querySelector('.language-code')!.textContent).toBe('ES');
    expect(ligne.querySelector('strong')!.textContent).toBe('Español');
    expect(ligne.textContent).toContain('2');

    // Retrait : la page demande confirmation, puis la liste se vide
    (window as unknown as { confirm: () => boolean }).confirm = () => true;
    (ligne.querySelector('[data-remove-language]') as unknown as { click(): void }).click();
    await until(() => !document.querySelector('.language-row'));
    const liste = await (await fetch(`${origin}/api/v1/i18n`)).json() as { languages: unknown[] };
    expect(liste.languages).toEqual([]);
  });

  it('dessine les graphiques du tableau de bord avec un résumé lisible', async () => {
    (document.querySelector('[data-tab="overview"]') as unknown as { click(): void }).click();
    await until(() => !!document.querySelector('#activity .meter-value')).catch(() => {
      throw new Error(`tableau de bord non rendu : ${document.getElementById('stats')?.textContent}`);
    });
    // Aucune inscription dans une base neuve : un état vide explicite, pas un cadre blanc
    expect(document.querySelector('#activity .chart-empty')).not.toBeNull();
    // Les requêtes du test lui-même alimentent le graphique de performances
    const bloc = document.querySelector('#performance .chart-block');
    if (bloc) {
      expect(bloc.querySelector('.chart-summary')!.textContent).toMatch(/Total \d+/);
      expect(bloc.querySelector('svg')!.getAttribute('aria-label')).toMatch(/Total/);
      expect(bloc.querySelectorAll('.bar').length).toBeGreaterThan(0);
      // Trois dates sous l'axe, pas une par barre
      expect(bloc.querySelectorAll('.chart-axis span').length).toBe(3);
    }
    // Les parts de comptes protégés sont écrites, pas seulement dessinées
    expect(document.querySelectorAll('#activity .meter-value').length).toBe(2);
  });

  it('change la langue d’envoi par défaut', async () => {
    await ouvrir();
    (document.querySelector('[data-default-locale="fr"]') as unknown as { click(): void }).click();
    await until(() => document.querySelector('[data-default-locale="fr"]')!.classList.contains('active'));
    const vue = await (await fetch(`${origin}/api/v1/admin/emails`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json() as { defaultLocale: string };
    expect(vue.defaultLocale).toBe('fr');
  });
});
