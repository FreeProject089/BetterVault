import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../server/src/db.ts';
import { createApp } from '../server/src/app.ts';
import { settingsFromEnv } from '../server/src/config.ts';
import type { MailMessage } from '../server/src/mailer.ts';
import { AccountService, type KeyValueStorage } from '../src/account/accountService';
import { createEmptyVaultData } from '../src/store/vaultStore';

/**
 * « Ce n'était pas moi » : le lien joint aux emails de sécurité ferme toutes les
 * sessions sans qu'il soit besoin de se connecter. Le jeton reçu par email est la
 * seule preuve, et il ne doit rien ouvrir d'autre.
 */

const PASSWORD = 'correct horse battery staple';
const FAST_KDF = { t: 1, m: 64, p: 1 };
const PUBLIC_URL = 'https://vault.exemple.fr';

class MemoryStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

const newService = () => new AccountService({ storage: new MemoryStorage(), kdf: FAST_KDF, pushDelayMs: 60_000 });

/** Même chose, mais en gardant le stockage sous la main pour y relire le jeton de session */
const serviceAvecStockage = () => {
  const storage = new MemoryStorage();
  return { service: new AccountService({ storage, kdf: FAST_KDF, pushDelayMs: 60_000 }), storage };
};

describe('Lien « ce n’était pas moi »', () => {
  let server: Server;
  let url: string;
  const sent: MailMessage[] = [];

  beforeAll(async () => {
    const base = settingsFromEnv({});
    server = createServer(createApp({
      db: openDatabase(':memory:'),
      serverSecret: 'secret-de-test-suffisamment-long-0123456789',
      minKdfMemoryKib: 8,
      authRateLimit: { windowMs: 60_000, max: 10_000 },
      settings: {
        ...base,
        publicUrl: PUBLIC_URL,
        smtp: { host: 'localhost', port: 25, security: 'none', from: 'BetterVault <no-reply@exemple.fr>', user: '', password: '', allowInvalidCert: false }
      },
      mailerFactory: () => ({ send: async message => { sent.push(message); } })
    }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  /** Crée un compte, se reconnecte pour déclencher l'email de nouvelle connexion */
  const compteAvecAlerte = async (prefix: string) => {
    const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.fr`;
    await newService().createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: url }, createEmptyVaultData());
    const { service: second, storage } = serviceAvecStockage();
    await second.signIn(url, email, PASSWORD);

    const message = sent.filter(m => m.to === email).at(-1)!;
    const lien = /https:\/\/vault\.exemple\.fr(\/security\/not-me\/[\w-]+)/.exec(message.html ?? '')?.[1];
    const jeton = JSON.parse(storage.getItem('bettervault.session.v1') ?? '{}').token as string;
    return { email, message, chemin: lien, service: second, jeton };
  };

  it('joint un lien à l’email de nouvelle connexion, dans les deux versions', async () => {
    const { message, chemin } = await compteAvecAlerte('alerte');
    // Le compte est créé par l'application en français : l'email l'est aussi
    expect(message.subject).toBe('Nouvelle connexion à votre compte BetterVault');
    expect(chemin).toBeTruthy();
    // La version texte porte le même lien : certains clients n'affichent qu'elle
    expect(message.text).toContain('/security/not-me/');
    expect(message.html).toContain('Ce n’était pas moi');
  });

  it('montre une page de confirmation sans rien faire', async () => {
    const { chemin, service } = await compteAvecAlerte('confirmation');
    const page = await fetch(`${url}${chemin}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Was this you?');
    expect(html).toContain('A sign-in to your account');

    // Les anti-spam suivent les liens : la simple lecture ne doit déconnecter personne
    await expect(service.getCloudAccountInfo()).resolves.toBeTruthy();
  });

  it('invalide les jetons de session quand on confirme', async () => {
    const { chemin, jeton } = await compteAvecAlerte('fermeture');
    // Le jeton fonctionne avant
    expect((await fetch(`${url}/api/v1/accounts/me`, { headers: { Authorization: `Bearer ${jeton}` } })).status).toBe(200);

    const reponse = await fetch(`${url}${chemin}`, { method: 'POST' });
    expect(reponse.status).toBe(200);
    expect(await reponse.text()).toContain('Devices signed out');

    // Et plus après : c'est ce qui arrête celui qui a volé une session
    expect((await fetch(`${url}/api/v1/accounts/me`, { headers: { Authorization: `Bearer ${jeton}` } })).status).toBe(401);
  });

  it('n’enferme pas dehors celui qui connaît le mot de passe', async () => {
    const { chemin, service } = await compteAvecAlerte('proprietaire');
    await fetch(`${url}${chemin}`, { method: 'POST' });

    /*
     * Une session fermée ne peut pas empêcher le propriétaire de revenir : son
     * appareil détient encore la preuve dérivée du mot de passe principal et
     * ouvre une nouvelle session. Le lien arrête les jetons volés, pas quelqu'un
     * qui connaît le mot de passe — d'où le conseil de le changer.
     */
    await expect(service.getCloudAccountInfo()).resolves.toBeTruthy();
  });

  it('ne sert qu’une fois', async () => {
    const { chemin } = await compteAvecAlerte('unique');
    expect((await fetch(`${url}${chemin}`, { method: 'POST' })).status).toBe(200);

    const seconde = await fetch(`${url}${chemin}`, { method: 'POST' });
    expect(seconde.status).toBe(410);
    expect(await seconde.text()).toContain('Link no longer valid');

    // Et la page de confirmation ne se rouvre plus non plus
    expect((await fetch(`${url}${chemin}`)).status).toBe(410);
  });

  it('refuse un jeton inventé', async () => {
    const invente = '/security/not-me/' + 'a'.repeat(43);
    expect((await fetch(`${url}${invente}`)).status).toBe(410);
    expect((await fetch(`${url}${invente}`, { method: 'POST' })).status).toBe(410);
  });

  it('annule une réinitialisation en cours', async () => {
    const { email } = await compteAvecAlerte('annulation');
    await newService().requestRecoveryCode(url, email);

    const demande = sent.filter(m => m.to === email && (m.subject.includes('reset code') || m.subject.includes('Code de réinitialisation'))).at(-1)!;
    const code = /(\d{6})/.exec(demande.subject)![1];
    const chemin = /https:\/\/vault\.exemple\.fr(\/security\/not-me\/[\w-]+)/.exec(demande.html ?? '')![1];

    await fetch(`${url}${chemin}`, { method: 'POST' });

    // Le code reçu ne vaut plus rien : celui qui a demandé la réinitialisation est bloqué
    await expect(newService().recoverCloudAccount({
      serverUrl: url, email, newPassword: 'un autre mot de passe entier', emailCode: code
    })).rejects.toThrow();
  });

  it('n’ajoute pas de lien quand le serveur n’a pas d’adresse publique', async () => {
    const sansUrl: MailMessage[] = [];
    const base = settingsFromEnv({});
    const autre = createServer(createApp({
      db: openDatabase(':memory:'),
      serverSecret: 'secret-de-test-suffisamment-long-0123456789',
      minKdfMemoryKib: 8,
      settings: {
        ...base,
        publicUrl: '',
        smtp: { host: 'localhost', port: 25, security: 'none', from: 'x@exemple.fr', user: '', password: '', allowInvalidCert: false }
      },
      mailerFactory: () => ({ send: async message => { sansUrl.push(message); } })
    }));
    await new Promise<void>(resolve => autre.listen(0, '127.0.0.1', resolve));
    const autreUrl = `http://127.0.0.1:${(autre.address() as AddressInfo).port}`;

    const email = `sans-url-${Date.now()}@exemple.fr`;
    await newService().createAccount({ email, password: PASSWORD, mode: 'cloud', serverUrl: autreUrl }, createEmptyVaultData());
    await newService().signIn(autreUrl, email, PASSWORD);

    const message = sansUrl.filter(m => m.to === email).at(-1)!;
    expect(message.html).not.toContain('/security/not-me/');
    expect(message.text).not.toContain('/security/not-me/');
    // L'en-tête reste lisible : l'initiale remplace le logo faute d'URL où le chercher
    expect(message.html).toContain('>B</span>');

    await new Promise<void>(resolve => autre.close(() => resolve()));
  });
});
