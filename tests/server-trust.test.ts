import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash, createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';
import { openDatabase } from '../server/src/db.ts';
import { createApp } from '../server/src/app.ts';
import { settingsFromEnv, type ServerSettings } from '../server/src/config.ts';
import { decryptBackup } from '../server/src/backup.ts';
import { createGeoLookup, describeUserAgent, truncateIp } from '../server/src/geoip.ts';
import { normalizePlan, verifyStripeSignature } from '../server/src/billing.ts';
import { fillTemplate } from '../server/src/legal.ts';
import { AccountService, type KeyValueStorage } from '../src/account/accountService';
import { WrongPasswordError } from '../src/account/accountCrypto';
import { createEmptyVaultData } from '../src/store/vaultStore';

const FAST_KDF = { t: 1, m: 64, p: 1 };
const PASSWORD = 'correct horse battery staple';
const SECRET = 'secret-de-test-suffisamment-long-0123456789';
const ADMIN_TOKEN = 'jeton-admin-de-test-0123456789';
const WEBHOOK_SECRET = 'whsec_test_0123456789';

class MemoryStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

const newService = () => new AccountService({ storage: new MemoryStorage(), kdf: FAST_KDF, pushDelayMs: 60_000, locale: () => 'fr' });
const uniqueEmail = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.fr`;

const stripeCalls: Array<{ url: string; body: string }> = [];
const fakeStripe: typeof fetch = async (input, init) => {
  const url = String(input);
  stripeCalls.push({ url, body: String(init?.body ?? '') });
  if (url.endsWith('/checkout/sessions')) return Response.json({ url: 'https://checkout.stripe.com/c/pay/test' });
  if (url.includes('/subscriptions/')) {
    // Stripe renvoie l'abonnement mis à jour : le faux serveur reflète ce qui lui est envoyé
    const sent = new URLSearchParams(String(init?.body ?? ''));
    return Response.json({
      id: url.split('/subscriptions/')[1],
      cancel_at_period_end: sent.get('cancel_at_period_end') === 'true',
      current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30
    });
  }
  return Response.json({ error: { message: 'inconnu' } }, { status: 404 });
};

async function startServer(settings: Partial<ServerSettings> = {}) {
  const db = openDatabase(':memory:');
  const server: Server = createServer(createApp({
    db,
    serverSecret: SECRET,
    minKdfMemoryKib: 8,
    authRateLimit: { windowMs: 60_000, max: 1000 },
    settings: { ...settingsFromEnv({}), ...settings },
    adminTokenHash: createHash('sha256').update(ADMIN_TOKEN).digest('base64'),
    mailerFactory: () => ({ send: async () => {} }),
    geo: { lookup: () => ({ country: 'FR', city: 'Lyon' }) },
    fetchImpl: fakeStripe
  }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, url, db, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

const adminFetch = (url: string, method = 'GET', body?: unknown) => fetch(url, {
  method,
  headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined
});

describe('Serveur : sessions, offres, documents légaux, tableau de bord', () => {
  let ctx: Awaited<ReturnType<typeof startServer>>;

  beforeAll(async () => {
    const base = settingsFromEnv({});
    ctx = await startServer({
      publicUrl: 'https://vault.exemple.fr',
      billing: {
        enabled: true,
        stripeSecretKey: 'STRIPE_TEST_SECRET_REMOVED',
        stripeWebhookSecret: WEBHOOK_SECRET,
        plans: [normalizePlan({
          id: 'plus',
          name: 'Plus',
          description: '',
          prices: [
            { id: 'mensuel', label: '2 € / mois', stripePriceId: 'price_plus', mode: 'subscription' },
            { id: 'annuel', label: '20 € / an', stripePriceId: 'price_plusAnnuel', mode: 'subscription' }
          ],
          boosts: { attachmentQuotaBytes: 1024 * 1024 * 1024, maxVaults: 5 }
        })]
      },
      legal: { ...base.legal, operatorName: 'Association Exemple', contactEmail: 'contact@exemple.fr' }
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('liste les sessions avec appareil, IP tronquée et lieu, puis les ferme avec le mot de passe', async () => {
    const email = uniqueEmail('sessions');
    const first = newService();
    await first.createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: ctx.url }, createEmptyVaultData());
    const second = newService();
    await second.signIn(ctx.url, email, PASSWORD);

    const sessions = await first.listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions.filter(s => s.current)).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ ipPrefix: '127.0.0.x', country: 'FR', city: 'Lyon' });
    expect(sessions[0].id).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(sessions)).not.toContain('127.0.0.1');

    const other = sessions.find(s => !s.current)!;
    await expect(first.revokeSessions('mauvais mot de passe', { sessionId: other.id })).rejects.toBeInstanceOf(WrongPasswordError);
    expect(await first.revokeSessions(PASSWORD, { sessionId: other.id })).toBe(1);
    expect(await first.listSessions()).toHaveLength(1);
  });

  it('ouvre Stripe Checkout et applique l’espace en plus après le webhook signé', async () => {
    const email = uniqueEmail('offre');
    const device = newService();
    await device.createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: ctx.url }, createEmptyVaultData());
    const before = await device.getBilling();
    expect(before.enabled).toBe(true);
    expect(before.plans[0]).not.toHaveProperty('stripePriceId');

    // Sans durée précisée, la première de l'offre
    const { url } = await device.startCheckout('plus');
    expect(url).toContain('checkout.stripe.com');
    const call = stripeCalls.find(c => c.url.endsWith('/checkout/sessions'))!;
    expect(call.body).toContain('price_plus');
    expect(call.body).not.toContain(encodeURIComponent(email));

    // La durée choisie décide du prix Stripe envoyé
    stripeCalls.length = 0;
    await device.startCheckout('plus', 'annuel');
    expect(stripeCalls.find(c => c.url.endsWith('/checkout/sessions'))!.body).toContain('price_plusAnnuel');

    const userId = new URLSearchParams(call.body).get('client_reference_id')!;
    const event = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { client_reference_id: userId, customer: 'cus_1', subscription: 'sub_1', metadata: { plan_id: 'plus' } } } });
    const sign = (payload: string, secret = WEBHOOK_SECRET) => {
      const t = Math.floor(Date.now() / 1000);
      return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;
    };
    const post = (signature: string) => fetch(`${ctx.url}/api/v1/billing/webhook`, { method: 'POST', headers: { 'Stripe-Signature': signature, 'Content-Type': 'application/json' }, body: event });

    expect((await post(sign(event, 'whsec_autre'))).status).toBe(400);
    expect((await post(sign(event))).status).toBe(200);
    expect(await (await post(sign(event))).json()).toMatchObject({ duplicate: true });

    const after = await device.getBilling();
    expect(after.subscription).toMatchObject({ planId: 'plus', planName: 'Plus', active: true, autoRenew: true, renewable: true });
    expect(after.limits.attachmentQuotaBytes).toBe(before.limits.attachmentQuotaBytes + 1024 * 1024 * 1024);
    expect(after.limits.maxVaults).toBe(before.limits.maxVaults + 5);
  });

  it('coupe et rétablit le renouvellement automatique sans rien supprimer', async () => {
    const email = uniqueEmail('renouvellement');
    const device = newService();
    await device.createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: ctx.url }, createEmptyVaultData());

    // Sans abonnement, il n'y a rien à renouveler
    await expect(device.setAutoRenew(false)).rejects.toThrow();

    // Les appels du test précédent fausseraient la recherche ci-dessous
    stripeCalls.length = 0;
    await device.startCheckout('plus', 'mensuel');
    const call = stripeCalls.find(c => c.url.endsWith('/checkout/sessions'))!;
    const userId = new URLSearchParams(call.body).get('client_reference_id')!;
    const event = JSON.stringify({
      id: 'evt_renew',
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: userId, customer: 'cus_2', subscription: 'sub_2', metadata: { plan_id: 'plus', price_id: 'mensuel' } } }
    });
    const t = Math.floor(Date.now() / 1000);
    await fetch(`${ctx.url}/api/v1/billing/webhook`, {
      method: 'POST',
      headers: { 'Stripe-Signature': `t=${t},v1=${createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${event}`).digest('hex')}`, 'Content-Type': 'application/json' },
      body: event
    });

    const started = await device.getBilling();
    expect(started.subscription).toMatchObject({ priceId: 'mensuel', priceLabel: '2 € / mois', autoRenew: true });

    stripeCalls.length = 0;
    const off = await device.setAutoRenew(false);
    expect(off.autoRenew).toBe(false);
    expect(stripeCalls.find(c => c.url.includes('/subscriptions/sub_2'))!.body).toContain('cancel_at_period_end=true');

    // L'espace reste acquis jusqu'à l'échéance : couper le renouvellement ne retire rien
    const paused = await device.getBilling();
    expect(paused.subscription).toMatchObject({ autoRenew: false, active: true });
    expect(paused.limits.maxVaults).toBe(started.limits.maxVaults);

    const on = await device.setAutoRenew(true);
    expect(on.autoRenew).toBe(true);
    expect((await device.getBilling()).subscription).toMatchObject({ autoRenew: true });
  });

  it('vérifie la signature Stripe et refuse un horodatage trop ancien', () => {
    const payload = Buffer.from('{}');
    const old = Math.floor(Date.now() / 1000) - 3600;
    const header = `t=${old},v1=${createHmac('sha256', WEBHOOK_SECRET).update(`${old}.{}`).digest('hex')}`;
    expect(verifyStripeSignature(payload, header, WEBHOOK_SECRET, Date.now())).toBe(false);
    expect(verifyStripeSignature(payload, header, WEBHOOK_SECRET, old * 1000)).toBe(true);
  });

  it('publie les documents légaux remplis avec l’identité de l’hébergeur', async () => {
    const list = await (await fetch(`${ctx.url}/api/v1/legal`)).json();
    expect(list).toMatchObject({ configured: true, operatorName: 'Association Exemple' });
    for (const doc of list.documents as Array<{ url: string }>) {
      const res = await fetch(`${ctx.url}${doc.url}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Association Exemple');
      expect(html).not.toMatch(/\{\{/);
    }
    expect((await fetch(`${ctx.url}/legal/inconnu`)).status).toBe(404);

    // Version anglaise : ?lang=en ou navigateur en anglais
    const english = await (await fetch(`${ctx.url}/legal/dpa?lang=en`)).text();
    expect(english).toContain('<html lang="en">');
    expect(english).toContain('Data processing agreement');
    expect(english).toContain('href="/legal/security?lang=en"');
    const byHeader = await (await fetch(`${ctx.url}/legal/terms`, { headers: { 'Accept-Language': 'en-GB' } })).text();
    expect(byHeader).toContain('Terms of use');
    const listEn = await (await fetch(`${ctx.url}/api/v1/legal`, { headers: { 'Accept-Language': 'en' } })).json();
    expect(listEn.documents[0]).toMatchObject({ title: 'Terms of use', url: '/legal/terms?lang=en' });
    expect(fillTemplate('{{a}}{{#si b}} oui{{/si}}{{#si c}} non{{/si}}', { a: '<x>' }, { b: true, c: false })).toBe('<x> oui');
  });

  it('tableau de bord anonyme et copie chiffrée de la base', async () => {
    expect((await fetch(`${ctx.url}/api/v1/admin/dashboard`)).status).toBe(401);
    const dashboard = await (await adminFetch(`${ctx.url}/api/v1/admin/dashboard`)).json();
    expect(dashboard.analytics.users.total).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(dashboard)).not.toContain('@exemple.fr');

    const audit = await (await adminFetch(`${ctx.url}/api/v1/admin/audit`)).json();
    expect(audit.events.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain('@exemple.fr');

    expect((await adminFetch(`${ctx.url}/api/v1/admin/backup/download`, 'POST', { passphrase: 'court' })).status).toBe(400);
    const res = await adminFetch(`${ctx.url}/api/v1/admin/backup/download`, 'POST', { passphrase: 'phrase de chiffrement longue' });
    expect(res.status).toBe(200);
    const sqlite = gunzipSync(decryptBackup(Buffer.from(await res.arrayBuffer()), 'phrase de chiffrement longue'));
    expect(sqlite.subarray(0, 15).toString()).toBe('SQLite format 3');
  });

  it('envoie les en-têtes de sécurité', async () => {
    const res = await fetch(`${ctx.url}/api/v1/health`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
  });
});

describe('Localisation locale des sessions', () => {
  const str = (s: string) => Buffer.concat([Buffer.from([(2 << 5) | Buffer.byteLength(s)]), Buffer.from(s)]);
  const map = (entries: Array<[string, Buffer]>) => Buffer.concat([Buffer.from([(7 << 5) | entries.length]), ...entries.flatMap(([k, v]) => [str(k), v])]);
  const uint16 = (n: number) => Buffer.from([(5 << 5) | 2, n >> 8, n & 0xff]);
  const uint32 = (n: number) => Buffer.from([(6 << 5) | 4, n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);

  it('lit une base mmdb sans service externe', () => {
    // Un seul nœud : les adresses dont le premier bit est 0 (0.0.0.0 à 127.255.255.255) pointent vers l'enregistrement
    const tree = Buffer.from([0, 0, 17, 0, 0, 1]);
    const data = map([['country', map([['iso_code', str('FR')]])], ['city', map([['names', map([['fr', str('Lyon')]])]])]]);
    const metadata = map([['node_count', uint32(1)], ['record_size', uint16(24)], ['ip_version', uint16(4)]]);
    const db = Buffer.concat([tree, Buffer.alloc(16), data, Buffer.from([0xab, 0xcd, 0xef]), Buffer.from('MaxMind.com'), metadata]);
    const geo = createGeoLookup(db);
    expect(geo.lookup('10.1.2.3')).toEqual({ country: 'FR', city: 'Lyon' });
    expect(geo.lookup('200.1.2.3')).toBeNull();
    expect(geo.lookup('pas une ip')).toBeNull();
  });

  it('tronque les adresses et résume le navigateur', () => {
    expect(truncateIp('203.0.113.42')).toBe('203.0.113.x');
    expect(truncateIp('::ffff:203.0.113.42')).toBe('203.0.113.x');
    expect(truncateIp('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8:85a3::/48');
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36')).toBe('Chrome · Windows');
  });
});

describe('Photo de profil', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
  let ctx: Awaited<ReturnType<typeof startServer>>;

  afterAll(async () => {
    await ctx?.close();
  });

  it('accepte une image ou un lien selon les réglages du serveur', async () => {
    const base = settingsFromEnv({});
    ctx = await startServer({ avatars: { uploads: true, remoteUrls: false }, limits: { ...base.limits, maxAvatarBytes: 1024 } });
    const device = newService();
    await device.createAccount({ email: uniqueEmail('photo'), password: PASSWORD, mode: 'cloud', serverUrl: ctx.url }, createEmptyVaultData());

    expect(await device.getAvatarPolicy()).toEqual({ uploads: true, remoteUrls: false, maxBytes: 1024 });
    expect(await device.getAvatarSource()).toBeNull();

    await device.setAvatarImage(new Uint8Array(PNG), '');
    const src = await device.getAvatarSource();
    expect(src).toMatch(/^blob:/);

    await expect(device.setAvatarImage(new Uint8Array(Buffer.from('<svg onload=alert(1)>')), '')).rejects.toMatchObject({ code: 'invalid_image' });
    await expect(device.setAvatarImage(new Uint8Array(Buffer.concat([PNG, Buffer.alloc(2048)])), '')).rejects.toMatchObject({ status: 413 });
    await expect(device.setAvatarUrl('https://exemple.fr/photo.png')).rejects.toMatchObject({ code: 'avatar_urls_disabled' });

    await device.removeAvatar();
    expect(await device.getAvatarSource()).toBeNull();
  });

  it('refuse un lien non https et garde la photo d’un compte local sur l’appareil', async () => {
    const local = newService();
    await local.createAccount({ email: uniqueEmail('local'), password: PASSWORD, mode: 'local' }, createEmptyVaultData());
    await expect(local.setAvatarUrl('http://exemple.fr/a.png')).rejects.toThrow(/https/);
    await local.setAvatarUrl('https://exemple.fr/a.png');
    expect(await local.getAvatarSource()).toBe('https://exemple.fr/a.png');
    await local.setAvatarImage(new Uint8Array(PNG), 'data:image/png;base64,AAAA');
    expect(await local.getAvatarSource()).toBe('data:image/png;base64,AAAA');
    await local.removeAvatar();
    expect(await local.getAvatarSource()).toBeNull();
  });
});
