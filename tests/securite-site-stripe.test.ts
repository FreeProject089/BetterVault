import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../server/src/db.ts';
import { createApp } from '../server/src/app.ts';
import { settingsFromEnv } from '../server/src/config.ts';
import { createSiteLinks, parseSiteLinks } from '../server/src/siteLinks.ts';
import { DEFAULT_LINKS } from '../server/src/siteChrome.ts';
import { createMissingStripePrices, normalizePlan, redactStripeSecrets, stripeClient, type StripeCall } from '../server/src/billing.ts';

/** Revue de sécurité : liens communautaires, pages légales, appels Stripe */

describe('Liens communautaires lus à distance', () => {
  it('ignore un corps plus grand que la limite, même sans Content-Length', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (pulled > 10_000) { controller.close(); return; }
        controller.enqueue(new Uint8Array(4096).fill(32));
      }
    });
    const fetchImpl = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
    const links = await createSiteLinks({ url: () => 'https://liens.exemple/l.json', fetchImpl })();
    expect(links).toEqual(DEFAULT_LINKS);
    // La lecture s'arrête dès la limite dépassée, sans tout aspirer
    expect(pulled).toBeLessThan(20);
  });

  it('refuse d’emblée un Content-Length annoncé trop grand', async () => {
    // Corps valide, mais annoncé géant : il n'est pas lu du tout
    const fetchImpl = (async () => new Response('{"discord":"https://discord.gg/abc"}', { status: 200, headers: { 'content-length': '999999999' } })) as unknown as typeof fetch;
    expect(await createSiteLinks({ url: () => 'https://liens.exemple/l.json', fetchImpl })()).toEqual(DEFAULT_LINKS);
  });

  it('ne garde que des adresses https, et refuse les redirections', async () => {
    expect(parseSiteLinks({ discord: 'javascript:alert(1)', github: 'http://x.org', status: 'https://u:p@x.org', community: 'data:text/html,x' })).toEqual({});
    let init: RequestInit | undefined;
    const fetchImpl = (async (_u: string, i: RequestInit) => { init = i; return new Response('{"discord":"https://discord.gg/\\"><x"}'); }) as unknown as typeof fetch;
    const links = await createSiteLinks({ url: () => 'https://liens.exemple/l.json', fetchImpl })();
    expect(init?.redirect).toBe('error');
    expect(links.discord).toBe('https://discord.gg/%22%3E%3Cx');
  });
});

describe('Stripe', () => {
  it('ne relaie jamais la clé secrète dans un message d’erreur', async () => {
    const key = 'STRIPE_TEST_SECRET_REMOVED';
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: `Invalid API Key provided: ${key} (rk_live_zzzzzzzzzz)` } }), { status: 401 })) as unknown as typeof fetch;
    const call = stripeClient({ settings: () => ({ billing: { stripeSecretKey: key } }) } as never, fetchImpl);
    const err = await call('GET', 'products').catch(e => e as Error);
    expect(err.message).not.toContain(key);
    expect(err.message).not.toContain('rk_live_zzzzzzzzzz');
    expect(redactStripeSecrets('whsec_abcdefgh0123', '')).toBe('[clé masquée]');
  });

  it('refuse un identifiant renvoyé par Stripe qui ne ressemble pas à un prix', async () => {
    const plan = normalizePlan({ id: 'plus', name: 'Plus', prices: [{ id: 'mensuel', amount: 490, currency: 'eur', interval: 'month' }] });
    const stripe: StripeCall = async <T>(_m: 'GET' | 'POST', path: string) => ({ id: path === 'products' ? 'prod_A1' : 'price_"><script>' }) as T;
    // L'erreur est renvoyée (pour enregistrer ce qui a déjà été créé), et l'identifiant n'est pas gardé
    const { error, plans } = await createMissingStripePrices([plan], stripe);
    expect(String(error)).toMatch(/identifiant de prix inattendu/);
    expect(plans[0].prices[0].stripePriceId).toBe('');
  });
});

describe('Pages légales', () => {
  let server: Server;
  let url: string;
  beforeAll(async () => {
    server = createServer(createApp({
      db: openDatabase(':memory:'),
      serverSecret: 'secret-de-test-suffisamment-long-0123456789',
      minKdfMemoryKib: 8,
      settings: settingsFromEnv({ LEGAL_ENABLED: 'true' }),
      clusterAutoStart: false
    }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

  it('portent la même politique de contenu que les autres pages', async () => {
    const res = await fetch(`${url}/legal/privacy`);
    expect(res.status).toBe(200);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("default-src 'none'");
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
