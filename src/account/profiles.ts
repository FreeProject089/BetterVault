import type { KeyValueStorage } from './accountService';

/**
 * Plusieurs comptes sur un même appareil.
 *
 * Tout ce qu'un compte garde sur l'appareil — sa fiche, son coffre chiffré, sa
 * session — passe par un seul stockage clé/valeur. On en donne à chaque compte une
 * vue préfixée : le service de compte ne sait pas qu'il n'est pas seul, et aucune
 * donnée d'un compte n'est lisible sous les clés d'un autre.
 *
 * Le compte déjà présent avant cette fonction garde ses clés d'origine, sans
 * préfixe : rien à migrer, et revenir à une version antérieure le retrouve intact.
 *
 * Changer de compte recharge l'application. C'est volontaire : les clés de
 * déchiffrement ne vivent qu'en mémoire, et un rechargement est la seule façon sûre
 * de garantir qu'il n'en reste aucune du compte précédent.
 */

export const DEFAULT_PROFILE = 'principal';

const REGISTRY_KEY = 'bettervault.profiles.v1';
const ACTIVE_KEY = 'bettervault.profile.active';
const ACCOUNT_KEY = 'bettervault.account.v1';
const PROFILE_ID = /^[a-z0-9]{6,24}$/;

export interface ProfileSummary {
  id: string;
  email: string;
  mode: 'local' | 'cloud';
  serverUrl?: string;
  lastUsedAt: number;
}

interface Registry {
  profiles: ProfileSummary[];
}

const prefixOf = (id: string) => (id === DEFAULT_PROFILE ? '' : `bettervault.p.${id}.`);

/** Vue d'un stockage limitée aux clés d'un compte */
export function scopedStorage(base: KeyValueStorage, id: string): KeyValueStorage {
  const prefix = prefixOf(id);
  return {
    getItem: key => base.getItem(prefix + key),
    setItem: (key, value) => base.setItem(prefix + key, value),
    removeItem: key => base.removeItem(prefix + key)
  };
}

export class ProfileStore {
  constructor(private readonly base: KeyValueStorage, private readonly now: () => number = Date.now) {}

  private read(): Registry {
    try {
      const parsed = JSON.parse(this.base.getItem(REGISTRY_KEY) ?? 'null') as Registry | null;
      const profiles = Array.isArray(parsed?.profiles) ? parsed!.profiles : [];
      return {
        profiles: profiles.filter(p => p && typeof p.id === 'string' && (p.id === DEFAULT_PROFILE || PROFILE_ID.test(p.id)))
      };
    } catch {
      return { profiles: [] };
    }
  }

  private write(registry: Registry): void {
    this.base.setItem(REGISTRY_KEY, JSON.stringify(registry));
  }

  activeId(): string {
    const id = this.base.getItem(ACTIVE_KEY);
    if (id && (id === DEFAULT_PROFILE || this.read().profiles.some(p => p.id === id))) return id;
    return DEFAULT_PROFILE;
  }

  storageFor(id = this.activeId()): KeyValueStorage {
    return scopedStorage(this.base, id);
  }

  /** Lit la fiche du compte rangée sous ce profil, sans rien déchiffrer */
  private summaryOf(id: string, lastUsedAt: number): ProfileSummary | null {
    try {
      const account = JSON.parse(this.storageFor(id).getItem(ACCOUNT_KEY) ?? 'null') as
        { email?: string; mode?: 'local' | 'cloud'; serverUrl?: string } | null;
      if (!account?.email) return null;
      return { id, email: account.email, mode: account.mode === 'cloud' ? 'cloud' : 'local', serverUrl: account.serverUrl, lastUsedAt };
    } catch {
      return null;
    }
  }

  /**
   * Les comptes présents sur l'appareil, le plus récemment utilisé d'abord.
   * Un profil sans compte (ajout abandonné en cours de route) n'apparaît pas.
   */
  list(): ProfileSummary[] {
    const registry = this.read();
    const known = new Map(registry.profiles.map(p => [p.id, p]));
    if (!known.has(DEFAULT_PROFILE)) known.set(DEFAULT_PROFILE, { id: DEFAULT_PROFILE, email: '', mode: 'local', lastUsedAt: 0 });
    return [...known.values()]
      .map(p => this.summaryOf(p.id, p.lastUsedAt))
      .filter((p): p is ProfileSummary => !!p)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }

  /** Note l'usage du profil actif, pour trier la liste */
  touch(id = this.activeId()): void {
    const registry = this.read();
    const others = registry.profiles.filter(p => p.id !== id);
    const summary = this.summaryOf(id, this.now());
    this.write({ profiles: summary ? [...others, summary] : [...others, { id, email: '', mode: 'local', lastUsedAt: this.now() }] });
  }

  activate(id: string): void {
    if (id !== DEFAULT_PROFILE && !this.read().profiles.some(p => p.id === id)) throw new Error('Compte introuvable sur cet appareil');
    this.base.setItem(ACTIVE_KEY, id);
    this.touch(id);
  }

  /**
   * Prépare un emplacement vide pour un nouveau compte et le rend actif.
   * S'il existe déjà un emplacement vide (ajout abandonné), on le reprend.
   */
  createEmpty(random: () => string = defaultRandomId): string {
    const vide = this.read().profiles.find(p => p.id !== DEFAULT_PROFILE && !this.summaryOf(p.id, 0));
    const id = vide?.id ?? random();
    if (!PROFILE_ID.test(id)) throw new Error('Identifiant de profil invalide');
    const registry = this.read();
    if (!registry.profiles.some(p => p.id === id)) {
      registry.profiles.push({ id, email: '', mode: 'local', lastUsedAt: this.now() });
      this.write(registry);
    }
    this.base.setItem(ACTIVE_KEY, id);
    return id;
  }

  /**
   * Oublie un compte sur cet appareil. Le compte en ligne n'est pas touché : on
   * retire seulement ce que l'appareil en garde. Le profil par défaut ne peut pas
   * disparaître du registre, mais ses clés sont vidées comme les autres.
   */
  forget(id: string, accountKeys: readonly string[]): void {
    const storage = this.storageFor(id);
    for (const key of accountKeys) storage.removeItem(key);
    const registry = this.read();
    this.write({ profiles: registry.profiles.filter(p => p.id !== id) });
    if (this.activeId() === id) {
      const next = this.list()[0]?.id ?? DEFAULT_PROFILE;
      this.base.setItem(ACTIVE_KEY, next);
    }
  }
}

function defaultRandomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map(b => (b % 36).toString(36)).join('') + Date.now().toString(36).slice(-4);
}
