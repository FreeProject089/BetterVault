import { describe, it, expect, afterEach } from 'vitest';
import { createCredential, platformAuthenticatorAvailable, securityKeysSupported } from '../src/account/securityKey';

/**
 * Clé portée par l'appareil (Windows Hello, Touch ID, empreinte Android) : ce
 * que l'application demande au navigateur, et quand elle s'abstient.
 *
 * Proposer un bouton qui ne peut pas aboutir est pire que ne rien proposer :
 * ces vérifications gardent la détection stricte.
 */

const CHALLENGE = 'AAAA';

interface Demande {
  publicKey: {
    authenticatorSelection?: { authenticatorAttachment?: string; userVerification?: string };
  };
}

const options = {
  challenge: CHALLENGE,
  rp: { id: 'app.exemple.fr', name: 'BetterVault' },
  user: { id: CHALLENGE, name: 'a@exemple.fr', displayName: 'a@exemple.fr' },
  pubKeyCredParams: [{ type: 'public-key' as const, alg: -7 }],
  excludeCredentials: []
};

const globalAny = globalThis as Record<string, unknown>;
/* `navigator` et `location` sont en lecture seule sous Node : on les redéfinit */
const pose = (nom: string, valeur: unknown) =>
  Object.defineProperty(globalThis, nom, { value: valeur, configurable: true, writable: true });
const initial = { pkc: globalAny.PublicKeyCredential, nav: globalAny.navigator, loc: globalAny.location, secure: globalAny.isSecureContext };

/** Navigateur simulé : on note la demande faite, sans authentificateur réel */
function fakeBrowser(opts: { probe?: (() => Promise<boolean>) | null; secure?: boolean } = {}): { demandes: Demande[] } {
  const demandes: Demande[] = [];
  const pkc = function () {} as unknown as Record<string, unknown>;
  if (opts.probe !== null) pkc.isUserVerifyingPlatformAuthenticatorAvailable = opts.probe ?? (async () => true);
  globalAny.PublicKeyCredential = pkc;
  pose('isSecureContext', opts.secure ?? true);
  pose('location', { hostname: 'App.Exemple.FR' });
  pose('navigator', {
    credentials: {
      create: async (demande: Demande) => {
        demandes.push(demande);
        return {
          rawId: new ArrayBuffer(4),
          response: { clientDataJSON: new ArrayBuffer(4), attestationObject: new ArrayBuffer(4) }
        };
      }
    }
  });
  return { demandes };
}

afterEach(() => {
  globalAny.PublicKeyCredential = initial.pkc;
  pose('navigator', initial.nav);
  pose('location', initial.loc);
  pose('isSecureContext', initial.secure);
});

describe('Clé portée par l’appareil', () => {
  it('ne se propose pas hors contexte sécurisé, même si l’objet existe', () => {
    fakeBrowser({ secure: false });
    expect(securityKeysSupported()).toBe(false);
    // Donc pas de sondage non plus : rien à proposer
    return expect(platformAuthenticatorAvailable()).resolves.toBe(false);
  });

  it('suit la réponse de l’appareil, et reste prudente s’il n’y a pas de sonde', async () => {
    fakeBrowser({ probe: async () => true });
    await expect(platformAuthenticatorAvailable()).resolves.toBe(true);

    fakeBrowser({ probe: async () => false });
    await expect(platformAuthenticatorAvailable()).resolves.toBe(false);

    fakeBrowser({ probe: null });
    await expect(platformAuthenticatorAvailable()).resolves.toBe(false);
  });

  it('ne laisse pas une sonde qui échoue bloquer la fenêtre', async () => {
    fakeBrowser({ probe: async () => { throw new Error('vue native sans WebAuthn'); } });
    await expect(platformAuthenticatorAvailable()).resolves.toBe(false);
  });

  it('exige la vérification de la personne pour une clé de l’appareil', async () => {
    const { demandes } = fakeBrowser();
    await createCredential(options, 'platform');
    expect(demandes[0].publicKey.authenticatorSelection).toMatchObject({
      authenticatorAttachment: 'platform',
      // Sans cette exigence, l'appareil pourrait signer sans empreinte ni visage
      userVerification: 'required'
    });
  });

  it('demande une clé branchée dans l’autre cas', async () => {
    const { demandes } = fakeBrowser();
    await createCredential(options, 'roaming');
    expect(demandes[0].publicKey.authenticatorSelection).toMatchObject({ authenticatorAttachment: 'cross-platform' });
  });

  it('demande une clé branchée par défaut', async () => {
    const { demandes } = fakeBrowser();
    await createCredential(options);
    expect(demandes[0].publicKey.authenticatorSelection).toMatchObject({ authenticatorAttachment: 'cross-platform' });
  });
});
