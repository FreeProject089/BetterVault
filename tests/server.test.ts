import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../server/src/db.ts';
import { createApp } from '../server/src/app.ts';
import { settingsFromEnv, type ServerSettings } from '../server/src/config.ts';
import { sendMail, type MailMessage } from '../server/src/mailer.ts';
import { base32Decode, currentStep, totpCode } from '../server/src/totp.ts';
import { AccountService, type KeyValueStorage } from '../src/account/accountService';
import { InvalidRecoveryKeyError, WrongPasswordError, parseRecoveryKey } from '../src/account/accountCrypto';
import { VaultStore, createEmptyVaultData } from '../src/store/vaultStore';
import { checkCredential, DEFAULT_VAULT_LIMITS } from '../src/account/limits';

const FAST_KDF = { t: 1, m: 64, p: 1 };
const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'nouveau mot de passe principal';
const SECRET = 'secret-de-test-suffisamment-long-0123456789';
const ADMIN_TOKEN = 'jeton-admin-de-test-0123456789';

class MemoryStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

const newService = () => new AccountService({ storage: new MemoryStorage(), kdf: FAST_KDF, pushDelayMs: 60_000, locale: () => 'fr' });
const uniqueEmail = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.fr`;

async function startServer(settings: Partial<ServerSettings> = {}, db = openDatabase(':memory:')) {
  const sent: MailMessage[] = [];
  const server: Server = createServer(createApp({
    db,
    serverSecret: SECRET,
    minKdfMemoryKib: 8,
    decoyKdf: FAST_KDF,
    authRateLimit: { windowMs: 60_000, max: 1000 },
    settings: { ...settingsFromEnv({}), ...settings },
    adminTokenHash: createHash('sha256').update(ADMIN_TOKEN).digest('base64'),
    mailerFactory: () => ({ send: async message => { sent.push(message); } })
  }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, url, sent, db, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

const SMTP = { host: 'smtp.test', port: 25, security: 'none' as const, user: '', password: '', from: 'BetterVault <no-reply@exemple.fr>' };
/*
 * Les emails suivent la langue du compte : les comptes de ces tests sont créés
 * par l'application en français, leurs emails arrivent donc en français.
 */
const isResetCode = (m: MailMessage) => m.subject.includes('reset code') || m.subject.includes('Code de réinitialisation');
const lastCode = (sent: MailMessage[]) => /(\d{6})/.exec(sent.filter(isResetCode).at(-1)?.subject ?? '')?.[1];
/** Le sujet attendu, dans l'une ou l'autre langue */
const sujet = (m: MailMessage, fr: string, en: string) => m.subject === fr || m.subject === en;
const totpFor = (secret: string, offset = 0) => totpCode(base32Decode(secret), currentStep(Date.now()) + offset);

describe('Serveur : double authentification, récupération, emails', () => {
  let ctx: Awaited<ReturnType<typeof startServer>>;

  beforeAll(async () => {
    ctx = await startServer({ smtp: SMTP, publicUrl: 'https://vault.exemple.fr' });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('publie les limites et la disponibilité des emails', async () => {
    const config = await (await fetch(`${ctx.url}/api/v1/config`)).json();
    expect(config).toMatchObject({ emailEnabled: true, registrationOpen: true, limits: { maxNoteLength: DEFAULT_VAULT_LIMITS.maxNoteLength } });
  });

  it('exige le code de l’application d’authentification et refuse un code déjà utilisé', async () => {
    const email = uniqueEmail('2fa');
    const device = newService();
    const { recoveryKey } = await device.createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: ctx.url }, createEmptyVaultData());
    expect(recoveryKey).toMatch(/^([A-Z2-7]{4}-){12}[A-Z2-7]{4}$/);

    await expect(device.beginTotpSetup('mauvais mot de passe')).rejects.toBeInstanceOf(WrongPasswordError);
    const setup = await device.beginTotpSetup(PASSWORD);
    expect(setup.uri).toContain('otpauth://totp/');
    await expect(device.enableTotp('000000')).rejects.toMatchObject({ code: 'totp_invalid' });
    await device.enableTotp(totpFor(setup.secret));
    expect(await device.getCloudAccountInfo()).toMatchObject({ totpEnabled: true, hasRecoveryKey: true });
    expect(ctx.sent.some(m => m.to === email && sujet(m, 'Double authentification activée', 'Two-factor authentication turned on'))).toBe(true);

    await expect(newService().signIn(ctx.url, email, PASSWORD)).rejects.toMatchObject({ code: 'totp_required' });
    await expect(newService().signIn(ctx.url, email, 'mauvais mot de passe', totpFor(setup.secret, 1))).rejects.toBeInstanceOf(WrongPasswordError);

    const code = totpFor(setup.secret, 1);
    await newService().signIn(ctx.url, email, PASSWORD, code);
    await expect(newService().signIn(ctx.url, email, PASSWORD, code)).rejects.toMatchObject({ code: 'totp_invalid' });
    expect(ctx.sent.some(m => m.to === email && (m.subject.startsWith('New sign-in') || m.subject.startsWith('Nouvelle connexion')))).toBe(true);
  });

  it('récupère un compte avec la clé de secours et le code email, sans perdre le coffre', async () => {
    const email = uniqueEmail('secours');
    const deviceA = newService();
    const store = new VaultStore();
    store.load(createEmptyVaultData());
    const { recoveryKey } = await deviceA.createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: ctx.url }, store.getData());
    store.setPersistence(data => void deviceA.save(data));
    store.addCredential({ vaultId: store.getData().activeVaultId, title: 'Gardé', username: '', password: 'x', website: '', domain: '', tags: [] });
    await deviceA.syncNow();

    expect(await deviceA.requestRecoveryCode(ctx.url, email)).toEqual({ emailCodeRequired: true });
    const emailCode = lastCode(ctx.sent)!;
    expect(emailCode).toMatch(/^\d{6}$/);

    const wrongKey = recoveryKey.replace(/^.{4}/, recoveryKey.startsWith('AAAA') ? 'BBBB' : 'AAAA');
    await expect(newService().recoverCloudAccount({ serverUrl: ctx.url, email, newPassword: NEW_PASSWORD, recoveryKey: wrongKey, emailCode }))
      .rejects.toMatchObject({ code: 'recovery_invalid' });
    await expect(newService().recoverCloudAccount({ serverUrl: ctx.url, email, newPassword: NEW_PASSWORD, recoveryKey, emailCode: '000000' }))
      .rejects.toMatchObject({ code: 'recovery_invalid' });

    const deviceB = newService();
    const result = await deviceB.recoverCloudAccount({ serverUrl: ctx.url, email, newPassword: NEW_PASSWORD, recoveryKey, emailCode });
    expect(result.vaultReset).toBe(false);
    expect(result.newRecoveryKey).toBeNull();
    expect(result.data.credentials.map(c => c.title)).toEqual(['Gardé']);

    await expect(newService().signIn(ctx.url, email, PASSWORD)).rejects.toBeInstanceOf(WrongPasswordError);
    expect((await newService().signIn(ctx.url, email, NEW_PASSWORD)).credentials.map(c => c.title)).toEqual(['Gardé']);
    expect(ctx.sent.some(m => m.to === email && sujet(m, 'Mot de passe principal changé', 'Master password changed'))).toBe(true);

    // Le code email ne sert qu'une fois
    await expect(newService().recoverCloudAccount({ serverUrl: ctx.url, email, newPassword: PASSWORD, recoveryKey, emailCode }))
      .rejects.toMatchObject({ code: 'recovery_invalid' });

    // Une nouvelle clé de secours remplace l'ancienne
    const renewed = await deviceB.regenerateRecoveryKey(NEW_PASSWORD);
    expect(renewed).not.toBe(recoveryKey);
    await deviceA.requestRecoveryCode(ctx.url, email);
    await expect(newService().recoverCloudAccount({ serverUrl: ctx.url, email, newPassword: PASSWORD, recoveryKey, emailCode: lastCode(ctx.sent) }))
      .rejects.toMatchObject({ code: 'recovery_invalid' });
  });

  it('réinitialise sans clé de secours avec le code email : coffre vide et nouvelle clé', async () => {
    const email = uniqueEmail('vide');
    const device = newService();
    const store = new VaultStore();
    store.load(createEmptyVaultData());
    await device.createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: ctx.url }, store.getData());
    store.setPersistence(data => void device.save(data));
    store.addCredential({ vaultId: store.getData().activeVaultId, title: 'Perdu', username: '', password: 'x', website: '', domain: '', tags: [] });
    await device.syncNow();

    await device.requestRecoveryCode(ctx.url, email);
    const result = await newService().recoverCloudAccount({ serverUrl: ctx.url, email, newPassword: NEW_PASSWORD, emailCode: lastCode(ctx.sent) });
    expect(result.vaultReset).toBe(true);
    expect(result.data.credentials).toEqual([]);
    expect(parseRecoveryKey(result.newRecoveryKey!)).toHaveLength(32);
    expect(ctx.sent.some(m => m.to === email && sujet(m, 'Compte BetterVault réinitialisé', 'BetterVault account reset'))).toBe(true);

    // Le premier appareil doit se reconnecter : ses sessions ont été fermées
    await device.syncNow();
    expect(device.getSyncState().status).toBe('error');
  });

  it('ne révèle pas si un compte existe lors d’une demande de code', async () => {
    const before = ctx.sent.length;
    const response = await fetch(`${ctx.url}/api/v1/recovery/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'personne@exemple.fr' })
    });
    expect(await response.json()).toEqual({ emailCodeRequired: true });
    expect(ctx.sent.length).toBe(before);
  });
});

describe('Serveur sans SMTP', () => {
  it('refuse d’effacer un coffre sans second facteur mais accepte la clé de secours seule', async () => {
    const ctx = await startServer();
    try {
      const email = uniqueEmail('sans-smtp');
      const device = newService();
      const { recoveryKey } = await device.createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: ctx.url }, createEmptyVaultData());

      expect(await device.requestRecoveryCode(ctx.url, email)).toEqual({ emailCodeRequired: false });
      await expect(newService().recoverCloudAccount({ serverUrl: ctx.url, email, newPassword: NEW_PASSWORD }))
        .rejects.toMatchObject({ code: 'recovery_unavailable' });

      const result = await newService().recoverCloudAccount({ serverUrl: ctx.url, email, newPassword: NEW_PASSWORD, recoveryKey });
      expect(result.vaultReset).toBe(false);
      await newService().signIn(ctx.url, email, NEW_PASSWORD);
    } finally {
      await ctx.close();
    }
  });

  it('applique la taille maximale du coffre et la fermeture des inscriptions', async () => {
    const ctx = await startServer({ limits: { ...DEFAULT_VAULT_LIMITS, maxVaultBytes: 2048 } });
    try {
      const device = newService();
      const store = new VaultStore();
      store.load(createEmptyVaultData());
      await device.createAccount({ email: uniqueEmail('taille'), password: PASSWORD, mode: 'cloud', serverUrl: ctx.url }, store.getData());
      store.setPersistence(data => void device.save(data));
      store.addCredential({ vaultId: store.getData().activeVaultId, title: 'Gros', username: '', password: 'x', website: '', domain: '', tags: [], notes: 'n'.repeat(5000) });
      await device.syncNow();
      expect(device.getSyncState()).toMatchObject({ status: 'error' });
      expect(device.getSyncState().message).toContain('taille autorisée');
      expect(device.getLimits().maxVaultBytes).toBe(2048);
    } finally {
      await ctx.close();
    }

    const closed = await startServer({ registrationOpen: false });
    try {
      await expect(newService().createAccount({ email: uniqueEmail('ferme'), password: PASSWORD, mode: 'cloud', serverUrl: closed.url }, createEmptyVaultData()))
        .rejects.toMatchObject({ code: 'registration_closed' });
    } finally {
      await closed.close();
    }
  });
});

describe('Compte local : clé de secours', () => {
  it('rouvre le coffre avec la clé de secours et un nouveau mot de passe', async () => {
    const device = newService();
    const store = new VaultStore();
    store.load(createEmptyVaultData());
    const { recoveryKey } = await device.createAccount({ email: 'local-secours@exemple.fr', password: PASSWORD, mode: 'local' }, store.getData());
    store.setPersistence(data => void device.save(data));
    store.addCredential({ vaultId: store.getData().activeVaultId, title: 'Local', username: '', password: 'x', website: '', domain: '', tags: [] });
    await device.flush();
    device.lock();

    await expect(device.recoverLocalAccount('ABCD-'.repeat(13).slice(0, 64), NEW_PASSWORD)).rejects.toBeInstanceOf(InvalidRecoveryKeyError);
    const data = await device.recoverLocalAccount(recoveryKey.toLowerCase().replace(/-/g, ' '), NEW_PASSWORD);
    expect(data.credentials.map(c => c.title)).toEqual(['Local']);

    device.lock();
    await expect(device.unlock(PASSWORD)).rejects.toBeInstanceOf(WrongPasswordError);
    expect((await device.unlock(NEW_PASSWORD)).credentials.map(c => c.title)).toEqual(['Local']);
  });

  it('vérifie les limites d’un identifiant avant enregistrement', () => {
    const limits = { ...DEFAULT_VAULT_LIMITS, maxNoteLength: 10, maxUrlLength: 20 };
    expect(checkCredential({ title: 'A', notes: 'court' }, limits)).toBeNull();
    expect(checkCredential({ title: 'A', notes: 'beaucoup trop long' }, limits)).toContain('Notes');
    expect(checkCredential({ title: 'A', website: 'https://exemple.fr/un/chemin/long' }, limits)).toContain('Adresse du site');
  });
});

describe('Administration du serveur', () => {
  it('protège les réglages par jeton et les conserve après redémarrage', async () => {
    const db = openDatabase(':memory:');
    const ctx = await startServer({}, db);
    try {
      const admin = (method: string, token: string, body?: unknown) => fetch(`${ctx.url}/api/v1/admin/settings`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });

      expect((await admin('GET', 'mauvais-jeton-0123456789')).status).toBe(401);
      const current = await (await admin('GET', ADMIN_TOKEN)).json();
      expect(current.stats).toMatchObject({ users: 0 });

      const updated = await admin('PUT', ADMIN_TOKEN, { limits: { maxNoteLength: 123 }, registrationOpen: false, smtp: { ...SMTP, password: 'secret-smtp' } });
      expect(updated.status).toBe(200);
      const saved = await updated.json();
      expect(saved.settings.smtp).toMatchObject({ host: 'smtp.test', password: '', hasPassword: true });
      expect((await admin('PUT', ADMIN_TOKEN, { limits: { maxNoteLength: -1 } })).status).toBe(400);
    } finally {
      await ctx.close();
    }

    const restarted = await startServer({}, db);
    try {
      const config = await (await fetch(`${restarted.url}/api/v1/config`)).json();
      expect(config).toMatchObject({ registrationOpen: false, emailEnabled: true, limits: { maxNoteLength: 123 } });
    } finally {
      await restarted.close();
    }
  });
});

describe('Client SMTP', () => {
  it('envoie un message complet à un serveur SMTP', async () => {
    const received: { commands: string[]; data: string } = { commands: [], data: '' };
    const smtp = createTcpServer(socket => {
      let inData = false;
      let buffer = '';
      socket.write('220 test ESMTP\r\n');
      socket.on('data', chunk => {
        buffer += chunk.toString('utf8');
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end === -1) return;
          received.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          socket.write('250 OK queued\r\n');
        }
        let index: number;
        while (!inData && (index = buffer.indexOf('\r\n')) !== -1) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          received.commands.push(line);
          if (line.startsWith('EHLO')) socket.write('250-test\r\n250 AUTH PLAIN\r\n');
          else if (line.startsWith('AUTH PLAIN')) socket.write('235 Authenticated\r\n');
          else if (line.startsWith('MAIL FROM') || line.startsWith('RCPT TO')) socket.write('250 OK\r\n');
          else if (line === 'DATA') { inData = true; socket.write('354 Go ahead\r\n'); }
          else if (line === 'QUIT') { socket.end('221 Bye\r\n'); }
        }
      });
    });
    await new Promise<void>(resolve => smtp.listen(0, '127.0.0.1', resolve));
    try {
      await sendMail(
        { host: '127.0.0.1', port: (smtp.address() as AddressInfo).port, security: 'none', user: 'bv', password: 'pw', from: 'BetterVault <no-reply@exemple.fr>' },
        { to: 'moi@exemple.fr', subject: 'Code de réinitialisation : 123456', text: 'Votre code : 123456\n.ligne commençant par un point' }
      );
    } finally {
      smtp.close();
    }

    expect(received.commands).toContain('MAIL FROM:<no-reply@exemple.fr>');
    expect(received.commands).toContain('RCPT TO:<moi@exemple.fr>');
    expect(Buffer.from(received.commands.find(c => c.startsWith('AUTH PLAIN'))!.slice(11), 'base64').toString()).toBe('\0bv\0pw');
    const [headers, body] = received.data.split('\r\n\r\n');
    expect(headers).toContain('Subject: =?UTF-8?B?');
    expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')).toContain('.ligne commençant par un point');
  });
});
