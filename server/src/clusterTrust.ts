import {
  createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, generateKeyPairSync,
  hkdfSync, randomBytes, scryptSync, sign, timingSafeEqual, verify, type KeyObject
} from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { HttpError, readJson, type Reply } from './http.ts';
import { route, type PatternRoute } from './context.ts';
import { parsePlace, type Place } from './serverPlace.ts';

/**
 * Identité et confiance d'une grappe de serveurs.
 *
 * Il n'y a plus de secret partagé. Chaque nœud possède une paire de clés Ed25519 ;
 * sa clé privée ne quitte pas le nœud et y est chiffrée au repos. La grappe a une
 * clé racine, gardée par le premier nœud, qui signe un **manifeste** : la liste des
 * nœuds autorisés (identité, zone, région, adresse, clé publique, statut) et un
 * numéro d'époque qui ne fait que croître.
 *
 * - Rejoindre : un code d'invitation à usage unique, valable une heure, apporté au
 *   nouveau nœud, qui y lit l'empreinte de la clé racine et l'épingle. L'administrateur
 *   approuve ensuite la demande après avoir comparé l'empreinte de la clé du nœud.
 * - Parler : chaque requête entre nœuds est signée par la clé de l'émetteur ; elle
 *   n'est acceptée que d'un nœud **actif** du manifeste courant. Heure, nombre unique
 *   et empreinte du corps sont signés : pas de rejeu, pas de corps modifié.
 * - Révoquer, désactiver, remplacer, déplacer : une nouvelle époque du manifeste,
 *   signée, diffusée aux nœuds et récupérée au retour par ceux qui étaient absents.
 * - Rotation : un nœud change de clé en signant la demande avec l'ancienne ; la clé
 *   racine change par un manifeste signé avec l'ancienne racine.
 *
 * Zones : un compte a une zone d'origine (EU, US, CH…) et n'est répliqué que vers les
 * nœuds de cette zone. Plusieurs nœuds d'une zone se relaient en cas de panne ; les
 * données ne franchissent pas les zones.
 */

export type NodeStatus = 'active' | 'disabled' | 'revoked';

export interface ManifestNode {
  id: string;
  name: string;
  zone: string;
  region: string;
  url: string;
  publicKey: string;
  status: NodeStatus;
  addedAt: number;
  replacedBy?: string;
  /** Emplacement réglé par l'opérateur, pour la carte (sinon : géolocalisation de l'adresse) */
  place?: Place;
}

export interface Manifest {
  clusterId: string;
  clusterName: string;
  epoch: number;
  issuedAt: number;
  /** Clé racine à reconnaître à partir de cette époque (rotation) */
  rootKey: string;
  /** Nœud qui détient la clé racine, auprès duquel les autres se remettent à jour */
  rootUrl: string;
  nodes: ManifestNode[];
}

export interface SignedManifest {
  manifest: Manifest;
  signature: string;
}

export interface ClusterPeer {
  id: string;
  url: string;
}

const NAME = /^[\p{L}\p{N} ._-]{1,40}$/u;
const ZONE = /^[A-Z][A-Z0-9]{1,9}$/;
const REGION = /^[A-Za-z0-9-]{1,20}$/;
const NODE_ID = /^n-[a-f0-9]{16}$/;
const MAX_SKEW_MS = 5 * 60 * 1000;
/** Nombre de nœuds accepté dans un manifeste : une grappe en compte quelques-uns */
const MAX_NODES = 64;
const INVITE_TTL_MS = 60 * 60 * 1000;
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

/* ── Clés ──────────────────────────────────────────────────────────────── */

const rawPublic = (key: KeyObject) => (key.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32).toString('base64url');
const publicFromRaw = (raw: string) => createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(raw, 'base64url')]), format: 'der', type: 'spki' });

/** Empreinte lisible, à comparer à voix haute ou côte à côte : « 3F2A 91C0 … » */
export const fingerprint = (publicKey: string) =>
  createHash('sha256').update(Buffer.from(publicKey, 'base64url')).digest('hex').slice(0, 32).toUpperCase().match(/.{4}/g)!.join(' ');
const rootPin = (publicKey: string) => createHash('sha256').update(Buffer.from(publicKey, 'base64url')).digest('base64url');

/** JSON à clés triées : la signature porte sur un texte que tout nœud reconstruit à l'identique */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value as object).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined)
    .map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

/** Chiffrement au repos des clés privées, avec une clé dérivée du secret du serveur */
function sealer(serverSecret: string) {
  const key = Buffer.from(hkdfSync('sha256', serverSecret, 'bettervault', 'bettervault/cluster-key-at-rest', 32));
  return {
    seal(plain: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
    },
    open(sealed: string): string {
      const raw = Buffer.from(sealed, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    }
  };
}

const newKeyPair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicKey: rawPublic(publicKey), privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }) as string };
};

/* ── Schéma ────────────────────────────────────────────────────────────── */

function installTrustSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS node_identity (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      node_id TEXT NOT NULL,
      public_key TEXT NOT NULL,
      private_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cluster_membership (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cluster_id TEXT NOT NULL,
      root_key TEXT NOT NULL,
      root_url TEXT NOT NULL,
      state TEXT NOT NULL,
      manifest TEXT,
      signature TEXT,
      epoch INTEGER NOT NULL DEFAULT 0,
      root_private_key TEXT,
      zone TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cluster_invites (
      token_hash TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS cluster_join_requests (
      node_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      zone TEXT NOT NULL,
      region TEXT NOT NULL,
      url TEXT NOT NULL,
      public_key TEXT NOT NULL,
      requested_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cluster_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      level TEXT NOT NULL,
      node_id TEXT,
      message TEXT NOT NULL
    );
  `);
}

/* ── Validation ────────────────────────────────────────────────────────── */

function parseUrl(value: unknown): string {
  let url: URL;
  try {
    url = new URL(String(value ?? ''));
  } catch {
    throw new HttpError(400, 'invalid_url', 'Adresse de nœud invalide');
  }
  // En clair, les requêtes signées resteraient intègres mais tout le contenu serait lisible
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new HttpError(400, 'insecure_url', 'Un nœud doit être joignable en https://');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

function parseNodeFields(body: Record<string, unknown>) {
  const name = String(body.name ?? '').trim();
  const zone = String(body.zone ?? '').trim().toUpperCase();
  const region = String(body.region ?? '').trim();
  if (!NAME.test(name)) throw new HttpError(400, 'invalid_name', 'Nom de nœud invalide (40 caractères au plus)');
  if (!ZONE.test(zone)) throw new HttpError(400, 'invalid_zone', 'Zone invalide : lettres majuscules, ex. EU, US, CH');
  if (!REGION.test(region)) throw new HttpError(400, 'invalid_region', 'Région invalide : ex. eu-west, us-east');
  return { name, zone, region, url: parseUrl(body.url) };
}

/* ── Service ───────────────────────────────────────────────────────────── */

export function createClusterTrust(options: {
  db: DatabaseSync;
  serverSecret: string;
  now: () => number;
  fetchImpl?: typeof fetch;
  audit: (type: string, detail?: Record<string, unknown>) => void;
  /** Appelé quand ce nœud devient membre : installer la réplication */
  onMember: (nodeId: string, zone: string) => void;
}) {
  const { db, now, audit } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const crypt = sealer(options.serverSecret);
  installTrustSchema(db);

  /* Identité de ce nœud, créée au premier démarrage */
  let identity = db.prepare('SELECT * FROM node_identity WHERE id = 1').get() as { node_id: string; public_key: string; private_key: string } | undefined;
  if (!identity) {
    const pair = newKeyPair();
    identity = { node_id: `n-${randomBytes(8).toString('hex')}`, public_key: pair.publicKey, private_key: crypt.seal(pair.privatePem) };
    db.prepare('INSERT INTO node_identity (id, node_id, public_key, private_key, created_at) VALUES (1, ?, ?, ?, ?)')
      .run(identity.node_id, identity.public_key, identity.private_key, now());
  }
  let selfKey = createPrivateKey(crypt.open(identity.private_key));
  let selfPublic = identity.public_key;
  const selfId = identity.node_id;

  type Membership = {
    cluster_id: string; root_key: string; root_url: string; state: 'joining' | 'member';
    manifest: string | null; signature: string | null; epoch: number; root_private_key: string | null; zone: string | null;
  };
  const membership = () => db.prepare('SELECT * FROM cluster_membership WHERE id = 1').get() as Membership | undefined;
  const manifest = (): Manifest | null => {
    const m = membership();
    return m?.manifest ? JSON.parse(m.manifest) as Manifest : null;
  };
  const selfNode = () => manifest()?.nodes.find(n => n.id === selfId) ?? null;
  const isRoot = () => !!membership()?.root_private_key;
  const zone = () => selfNode()?.zone ?? membership()?.zone ?? null;

  const event = (level: 'info' | 'warn' | 'error', message: string, nodeId?: string) => {
    db.prepare('INSERT INTO cluster_events (at, level, node_id, message) VALUES (?, ?, ?, ?)').run(now(), level, nodeId ?? null, message.slice(0, 500));
    db.exec('DELETE FROM cluster_events WHERE id NOT IN (SELECT id FROM cluster_events ORDER BY id DESC LIMIT 500)');
  };

  /* ── Signature des requêtes ── */

  const bodyHash = (body: string) => createHash('sha256').update(body).digest('base64url');

  function signedHeaders(method: string, pathWithQuery: string, body = ''): Record<string, string> {
    const time = String(now());
    const nonce = randomBytes(16).toString('hex');
    const payload = [selfId, time, nonce, method.toUpperCase(), pathWithQuery, bodyHash(body)].join('\n');
    return {
      'X-BV-Node': selfId,
      'X-BV-Time': time,
      'X-BV-Nonce': nonce,
      'X-BV-Signature': sign(null, Buffer.from(payload), selfKey).toString('base64url')
    };
  }

  /*
   * Nonces déjà vus, gardés en base : un redémarrage ne rouvre pas la fenêtre de
   * cinq minutes pendant laquelle une requête capturée pourrait être rejouée.
   */
  db.exec('CREATE TABLE IF NOT EXISTS cluster_nonces (key TEXT PRIMARY KEY, at INTEGER NOT NULL)');
  const rememberNonce = db.prepare('INSERT OR IGNORE INTO cluster_nonces (key, at) VALUES (?, ?)');
  const forgetNonces = db.prepare('DELETE FROM cluster_nonces WHERE at < ?');
  let lastNoncePurge = 0;
  let lastForgedWarning = 0;
  /**
   * Vérifie une requête signée. `allow` choisit qui peut parler : les nœuds actifs
   * (réplication), tout nœud connu du manifeste (lire le manifeste, changer de clé),
   * ou aussi un nœud en attente d'approbation (suivre sa demande).
   */
  function verifyRequest(req: IncomingMessage, body: string, allow: 'active' | 'known' | 'known-or-pending'): ManifestNode | { id: string; publicKey: string; pending: true } {
    const node = String(req.headers['x-bv-node'] ?? '');
    const time = String(req.headers['x-bv-time'] ?? '');
    const nonce = String(req.headers['x-bv-nonce'] ?? '');
    const signature = Buffer.from(String(req.headers['x-bv-signature'] ?? ''), 'base64url');
    const refuse = () => new HttpError(401, 'cluster_unauthorized', 'Nœud non reconnu');
    if (!NODE_ID.test(node) || !/^[0-9a-f]{32}$/.test(nonce)) throw refuse();
    const at = Number(time);
    if (!Number.isFinite(at) || Math.abs(now() - at) > MAX_SKEW_MS) throw refuse();

    let publicKey: string | null = null;
    let found: ManifestNode | null = null;
    const listed = manifest()?.nodes.find(n => n.id === node);
    if (listed && (allow !== 'active' || listed.status === 'active') && listed.status !== 'revoked') {
      found = listed;
      publicKey = listed.publicKey;
    } else if (allow === 'known-or-pending') {
      const pending = db.prepare('SELECT public_key FROM cluster_join_requests WHERE node_id = ?').get(node) as { public_key: string } | undefined;
      publicKey = pending?.public_key ?? null;
    }
    if (!publicKey) throw refuse();

    const payload = [node, time, nonce, String(req.method).toUpperCase(), req.url ?? '', bodyHash(body)].join('\n');
    let valid = false;
    try {
      valid = verify(null, Buffer.from(payload), publicFromRaw(publicKey), signature);
    } catch {
      valid = false;
    }
    if (!valid) throw refuse();

    if (now() - lastNoncePurge > 60_000) {
      lastNoncePurge = now();
      forgetNonces.run(now() - 2 * MAX_SKEW_MS);
    }
    if (Number(rememberNonce.run(`${node}:${nonce}`, at).changes) === 0) throw refuse();
    return found ?? { id: node, publicKey, pending: true };
  }

  /* ── Manifeste ── */

  function signManifest(next: Manifest, rootPrivatePem: string): SignedManifest {
    return { manifest: next, signature: sign(null, Buffer.from(canonical(next)), createPrivateKey(rootPrivatePem)).toString('base64url') };
  }

  /**
   * Accepte un manifeste s'il est signé par la racine connue et plus récent. Une
   * rotation de la racine arrive signée par l'ancienne : on adopte alors la nouvelle.
   */
  function acceptManifest(signed: SignedManifest): boolean {
    const m = membership();
    if (!m) return false;
    const { manifest: next, signature } = signed;
    if (!next || next.clusterId !== m.cluster_id || !Number.isInteger(next.epoch) || next.epoch <= m.epoch) return false;
    if (!Array.isArray(next.nodes) || next.nodes.length > MAX_NODES) return false;
    let valid = false;
    try {
      valid = verify(null, Buffer.from(canonical(next)), publicFromRaw(m.root_key), Buffer.from(String(signature), 'base64url'));
    } catch {
      valid = false;
    }
    if (!valid) {
      // Route ouverte à tous : on note au plus un refus par minute, pour ne pas noyer le journal
      if (now() - lastForgedWarning > 60_000) {
        lastForgedWarning = now();
        event('warn', `Manifeste d’époque ${next.epoch} refusé : signature invalide`);
      }
      return false;
    }
    const becameMember = m.state === 'joining' && next.nodes.some(n => n.id === selfId && n.status === 'active');
    db.prepare(`UPDATE cluster_membership SET manifest = ?, signature = ?, epoch = ?, root_key = ?, root_url = ?, state = ?, updated_at = ? WHERE id = 1`)
      .run(JSON.stringify(next), signature, next.epoch, next.rootKey, next.rootUrl || m.root_url, becameMember ? 'member' : m.state, now());
    const me = next.nodes.find(n => n.id === selfId);
    if (becameMember) {
      event('info', `Ce nœud a rejoint la grappe « ${next.clusterName} »`);
      options.onMember(selfId, me!.zone);
    }
    if (me?.status === 'revoked') event('error', 'Ce nœud a été révoqué : il ne réplique plus');
    return true;
  }

  /** Nouvelle époque, signée, enregistrée puis diffusée à tous les nœuds, y compris révoqués */
  async function publish(change: (nodes: ManifestNode[]) => ManifestNode[], extra: Partial<Manifest> = {}): Promise<Manifest> {
    const m = membership();
    const current = manifest();
    if (!m?.root_private_key || !current) throw new HttpError(403, 'not_root', 'Seul le nœud qui détient la clé racine peut modifier la grappe');
    const rootPem = crypt.open(m.root_private_key);
    const next: Manifest = { ...current, ...extra, epoch: current.epoch + 1, issuedAt: now(), nodes: change(current.nodes.map(n => ({ ...n }))) };
    const signed = signManifest(next, rootPem);
    db.prepare('UPDATE cluster_membership SET manifest = ?, signature = ?, epoch = ?, root_key = ?, updated_at = ? WHERE id = 1')
      .run(JSON.stringify(next), signed.signature, next.epoch, next.rootKey, now());
    await broadcast(signed);
    return next;
  }

  async function broadcast(signed: SignedManifest): Promise<void> {
    const body = JSON.stringify(signed);
    await Promise.all(signed.manifest.nodes.filter(n => n.id !== selfId).map(async node => {
      const path = '/api/v1/cluster/manifest';
      try {
        const response = await fetchImpl(node.url + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...signedHeaders('POST', path, body) },
          body,
          signal: AbortSignal.timeout(10_000)
        });
        if (!response.ok && response.status !== 409) throw new Error(`HTTP ${response.status}`);
      } catch (err) {
        // Un nœud absent récupérera le manifeste à son retour, en le tirant de la racine
        event('warn', `Manifeste non remis à ${node.name} : ${err instanceof Error ? err.message : err}`, node.id);
      }
    }));
  }

  /** Tire le manifeste de la racine : c'est ainsi qu'un nœud absent se remet à jour */
  async function refreshManifest(): Promise<void> {
    const m = membership();
    if (!m || m.root_private_key) return;
    const path = '/api/v1/cluster/manifest';
    try {
      const response = await fetchImpl(m.root_url + path, { headers: signedHeaders('GET', path), signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      acceptManifest(await response.json() as SignedManifest);
    } catch (err) {
      if (m.state === 'joining') return;
      event('warn', `Racine injoignable : ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Nœuds avec lesquels ce nœud réplique : actifs, et de la même zone */
  function peers(): ClusterPeer[] {
    const m = manifest();
    const me = selfNode();
    if (!m || !me || me.status !== 'active' || membership()?.state !== 'member') return [];
    return m.nodes.filter(n => n.id !== selfId && n.status === 'active' && n.zone === me.zone).map(n => ({ id: n.id, url: n.url }));
  }

  /* ── Routes entre nœuds ── */

  const nodeRoutes: PatternRoute[] = [
    // Demande d'adhésion : la seule route sans signature, protégée par le code d'invitation
    route('POST', '/api/v1/cluster/join', async req => {
      const body = await readJson(req, 8192);
      const m = membership();
      if (!m?.root_private_key) throw new HttpError(404, 'not_found', 'Route inconnue');
      const token = String(body.token ?? '');
      const invite = db.prepare('SELECT * FROM cluster_invites WHERE token_hash = ?').get(createHash('sha256').update(token).digest('base64')) as { expires_at: number; used_at: number | null } | undefined;
      if (!invite || invite.used_at || invite.expires_at < now()) throw new HttpError(401, 'invite_invalid', 'Invitation inconnue, expirée ou déjà utilisée');
      const nodeId = String(body.nodeId ?? '');
      const publicKey = String(body.publicKey ?? '');
      if (!NODE_ID.test(nodeId) || !/^[A-Za-z0-9_-]{43}$/.test(publicKey)) throw new HttpError(400, 'invalid_node', 'Identité de nœud invalide');
      if (manifest()?.nodes.some(n => n.id === nodeId)) throw new HttpError(409, 'node_exists', 'Ce nœud fait déjà partie de la grappe');
      const fields = parseNodeFields(body);
      db.prepare(`INSERT OR REPLACE INTO cluster_join_requests (node_id, name, zone, region, url, public_key, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(nodeId, fields.name, fields.zone, fields.region, fields.url, publicKey, now());
      db.prepare('UPDATE cluster_invites SET used_at = ? WHERE token_hash = ?').run(now(), createHash('sha256').update(token).digest('base64'));
      event('info', `Demande d’adhésion de ${fields.name} (${fields.zone}), empreinte ${fingerprint(publicKey)}`, nodeId);
      audit('cluster.join_requested', { node: nodeId });
      const current = manifest()!;
      return { status: 200, body: { clusterId: current.clusterId, clusterName: current.clusterName, rootKey: current.rootKey } };
    }),

    route('GET', '/api/v1/cluster/manifest', async req => {
      verifyRequest(req, '', 'known-or-pending');
      const m = membership();
      if (!m?.manifest) throw new HttpError(404, 'not_found', 'Aucune grappe');
      return { status: 200, body: { manifest: JSON.parse(m.manifest), signature: m.signature } };
    }),

    // Seule la signature de la racine compte : un nœud qui rejoint la grappe n'a pas encore
    // de manifeste pour reconnaître l'expéditeur, mais il a épinglé la clé racine
    route('POST', '/api/v1/cluster/manifest', async req => {
      const raw = await readRaw(req, 256 * 1024);
      let signed: SignedManifest;
      try {
        signed = JSON.parse(raw) as SignedManifest;
      } catch {
        throw new HttpError(400, 'invalid_request', 'Manifeste illisible');
      }
      return acceptManifest(signed) ? { status: 204 } : { status: 409, body: { error: { code: 'stale', message: 'Manifeste ignoré' } } };
    }),

    // Rotation de la clé d'un nœud : la demande est signée avec l'ancienne clé
    route('POST', '/api/v1/cluster/rekey', async req => {
      const raw = await readRaw(req, 4096);
      const node = verifyRequest(req, raw, 'known') as ManifestNode;
      const publicKey = String((JSON.parse(raw) as { publicKey?: unknown }).publicKey ?? '');
      if (!/^[A-Za-z0-9_-]{43}$/.test(publicKey)) throw new HttpError(400, 'invalid_key', 'Clé invalide');
      await publish(nodes => nodes.map(n => (n.id === node.id ? { ...n, publicKey } : n)));
      event('info', `Clé de ${node.name} renouvelée, nouvelle empreinte ${fingerprint(publicKey)}`, node.id);
      audit('cluster.node_rekeyed', { node: node.id });
      return { status: 204 };
    }),

    route('GET', '/api/v1/cluster/health', async req => {
      const node = verifyRequest(req, '', 'known') as ManifestNode;
      return { status: 200, body: { node: selfId, epoch: membership()?.epoch ?? 0, ok: true, peer: node.id } };
    })
  ];

  /* ── Actions d'administration ── */

  const actions = {
    async create(body: Record<string, unknown>) {
      if (membership()) throw new HttpError(409, 'already_member', 'Ce nœud fait déjà partie d’une grappe');
      const clusterName = String(body.clusterName ?? '').trim();
      if (!NAME.test(clusterName)) throw new HttpError(400, 'invalid_name', 'Nom de grappe invalide');
      const fields = parseNodeFields(body);
      const root = newKeyPair();
      const initial: Manifest = {
        clusterId: `c-${randomBytes(8).toString('hex')}`,
        clusterName,
        epoch: 1,
        issuedAt: now(),
        rootKey: root.publicKey,
        rootUrl: fields.url,
        nodes: [{ id: selfId, ...fields, publicKey: selfPublic, status: 'active', addedAt: now() }]
      };
      const signed = signManifest(initial, root.privatePem);
      db.prepare(`INSERT INTO cluster_membership (id, cluster_id, root_key, root_url, state, manifest, signature, epoch, root_private_key, zone, updated_at)
        VALUES (1, ?, ?, ?, 'member', ?, ?, 1, ?, ?, ?)`)
        .run(initial.clusterId, root.publicKey, fields.url, JSON.stringify(initial), signed.signature, crypt.seal(root.privatePem), fields.zone, now());
      event('info', `Grappe « ${clusterName} » créée ; ce nœud détient la clé racine`);
      options.onMember(selfId, fields.zone);
      return initial;
    },

    invite() {
      const m = membership();
      if (!m?.root_private_key) throw new HttpError(403, 'not_root', 'Seul le nœud qui détient la clé racine peut inviter');
      const token = randomBytes(24).toString('base64url');
      db.prepare('INSERT INTO cluster_invites (token_hash, created_at, expires_at) VALUES (?, ?, ?)')
        .run(createHash('sha256').update(token).digest('base64'), now(), now() + INVITE_TTL_MS);
      const self = selfNode()!;
      const code = Buffer.from(JSON.stringify({ v: 1, c: m.cluster_id, u: self.url, p: rootPin(m.root_key), t: token })).toString('base64url');
      return { code, expiresAt: now() + INVITE_TTL_MS };
    },

    async join(body: Record<string, unknown>) {
      if (membership()) throw new HttpError(409, 'already_member', 'Ce nœud fait déjà partie d’une grappe');
      let code: { v: number; c: string; u: string; p: string; t: string };
      try {
        code = JSON.parse(Buffer.from(String(body.code ?? '').trim(), 'base64url').toString('utf8'));
      } catch {
        throw new HttpError(400, 'invalid_code', 'Code d’invitation illisible');
      }
      if (code?.v !== 1 || typeof code.t !== 'string') throw new HttpError(400, 'invalid_code', 'Code d’invitation illisible');
      const rootUrl = parseUrl(code.u);
      const fields = parseNodeFields(body);
      const response = await fetchImpl(`${rootUrl}/api/v1/cluster/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: code.t, nodeId: selfId, publicKey: selfPublic, ...fields }),
        signal: AbortSignal.timeout(10_000)
      }).catch(() => null);
      if (!response) throw new HttpError(502, 'root_unreachable', 'Le nœud racine est injoignable');
      const answer = await response.json().catch(() => null) as { clusterId?: string; rootKey?: string; error?: { message?: string } } | null;
      if (!response.ok || !answer?.rootKey) throw new HttpError(response.status === 401 ? 401 : 502, 'join_refused', answer?.error?.message ?? 'Adhésion refusée');
      // L'empreinte vient du code, remis par l'administrateur : un intermédiaire ne peut pas substituer sa racine
      if (rootPin(answer.rootKey) !== code.p || answer.clusterId !== code.c) {
        throw new HttpError(409, 'root_mismatch', 'La clé racine ne correspond pas au code d’invitation');
      }
      db.prepare(`INSERT INTO cluster_membership (id, cluster_id, root_key, root_url, state, epoch, zone, updated_at) VALUES (1, ?, ?, ?, 'joining', 0, ?, ?)`)
        .run(answer.clusterId, answer.rootKey, rootUrl, fields.zone, now());
      event('info', 'Demande d’adhésion envoyée ; en attente d’approbation sur le nœud racine');
      return { fingerprint: fingerprint(selfPublic) };
    },

    async approve(nodeId: string) {
      const request = db.prepare('SELECT * FROM cluster_join_requests WHERE node_id = ?').get(nodeId) as
        { name: string; zone: string; region: string; url: string; public_key: string } | undefined;
      if (!request) throw new HttpError(404, 'not_found', 'Demande inconnue');
      const next = await publish(nodes => [...nodes, {
        id: nodeId, name: request.name, zone: request.zone, region: request.region, url: request.url,
        publicKey: request.public_key, status: 'active', addedAt: now()
      }]);
      db.prepare('DELETE FROM cluster_join_requests WHERE node_id = ?').run(nodeId);
      event('info', `${request.name} approuvé et ajouté à la grappe`, nodeId);
      return next;
    },

    reject(nodeId: string) {
      db.prepare('DELETE FROM cluster_join_requests WHERE node_id = ?').run(nodeId);
      event('info', 'Demande d’adhésion refusée', nodeId);
    },

    async update(nodeId: string, body: Record<string, unknown>) {
      const target = manifest()?.nodes.find(n => n.id === nodeId);
      if (!target) throw new HttpError(404, 'not_found', 'Nœud inconnu');
      const patch: Partial<ManifestNode> = {};
      if (body.status !== undefined) {
        if (body.status !== 'active' && body.status !== 'disabled') throw new HttpError(400, 'invalid_status', 'Statut invalide');
        if (target.status === 'revoked') throw new HttpError(409, 'revoked', 'Un nœud révoqué doit rejoindre la grappe à nouveau');
        if (nodeId === selfId && body.status === 'disabled') throw new HttpError(409, 'self', 'Le nœud racine ne peut pas se désactiver lui-même');
        patch.status = body.status;
      }
      if (body.name !== undefined || body.zone !== undefined || body.region !== undefined || body.url !== undefined) {
        const fields = parseNodeFields({ name: target.name, zone: target.zone, region: target.region, url: target.url, ...body });
        // Changer la zone d'un nœud qui porte des comptes les ferait passer d'une zone à l'autre
        if (fields.zone !== target.zone && nodeId === selfId) throw new HttpError(409, 'zone_locked', 'La zone du nœud racine ne se change pas');
        Object.assign(patch, fields);
      }
      // Emplacement pour la carte : null ou vide l'efface, et la position redevient celle de l'adresse IP
      if (body.place !== undefined) {
        const place = parsePlace(body.place);
        if (body.place !== null && !place) throw new HttpError(400, 'invalid_place', 'Emplacement invalide : latitude entre -90 et 90, longitude entre -180 et 180');
        patch.place = place ?? undefined;
      }
      await publish(nodes => nodes.map(n => (n.id === nodeId ? { ...n, ...patch } : n)));
      event('info', `${target.name} modifié${patch.status ? ` (${patch.status === 'active' ? 'activé' : 'désactivé'})` : ''}`, nodeId);
    },

    async revoke(nodeId: string, replacedBy?: string) {
      const target = manifest()?.nodes.find(n => n.id === nodeId);
      if (!target) throw new HttpError(404, 'not_found', 'Nœud inconnu');
      if (nodeId === selfId) throw new HttpError(409, 'self', 'Le nœud racine ne peut pas se révoquer lui-même');
      if (replacedBy && !manifest()?.nodes.some(n => n.id === replacedBy && n.status === 'active')) {
        throw new HttpError(400, 'invalid_replacement', 'Le remplaçant doit être un nœud actif de la grappe');
      }
      await publish(nodes => nodes.map(n => (n.id === nodeId ? { ...n, status: 'revoked', ...(replacedBy ? { replacedBy } : {}) } : n)));
      event('warn', `${target.name} révoqué${replacedBy ? ', remplacé' : ''}`, nodeId);
    },

    async remove(nodeId: string) {
      const target = manifest()?.nodes.find(n => n.id === nodeId);
      if (!target) throw new HttpError(404, 'not_found', 'Nœud inconnu');
      if (target.status !== 'revoked') throw new HttpError(409, 'not_revoked', 'Révoquez d’abord le nœud');
      await publish(nodes => nodes.filter(n => n.id !== nodeId));
      event('info', `${target.name} retiré du manifeste`, nodeId);
    },

    async rotateNodeKey() {
      const m = membership();
      if (!m || m.state !== 'member') throw new HttpError(409, 'not_member', 'Ce nœud ne fait pas partie d’une grappe');
      const pair = newKeyPair();
      if (m.root_private_key) {
        await publish(nodes => nodes.map(n => (n.id === selfId ? { ...n, publicKey: pair.publicKey } : n)));
      } else {
        const path = '/api/v1/cluster/rekey';
        const body = JSON.stringify({ publicKey: pair.publicKey });
        const response = await fetchImpl(m.root_url + path, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...signedHeaders('POST', path, body) }, body, signal: AbortSignal.timeout(10_000)
        }).catch(() => null);
        if (!response?.ok) throw new HttpError(502, 'root_unreachable', 'Le nœud racine n’a pas accepté la nouvelle clé');
      }
      // La nouvelle clé n'est adoptée qu'une fois la racine d'accord
      db.prepare('UPDATE node_identity SET public_key = ?, private_key = ? WHERE id = 1').run(pair.publicKey, crypt.seal(pair.privatePem));
      selfKey = createPrivateKey(pair.privatePem);
      selfPublic = pair.publicKey;
      await refreshManifest();
      event('info', `Clé de ce nœud renouvelée, nouvelle empreinte ${fingerprint(pair.publicKey)}`);
      return { fingerprint: fingerprint(pair.publicKey) };
    },

    async rotateRootKey() {
      const m = membership();
      if (!m?.root_private_key) throw new HttpError(403, 'not_root', 'Seul le nœud racine détient la clé racine');
      const pair = newKeyPair();
      // Signé par l'ANCIENNE racine : c'est ce qui autorise les nœuds à adopter la nouvelle
      await publish(nodes => nodes, { rootKey: pair.publicKey });
      db.prepare('UPDATE cluster_membership SET root_private_key = ?, root_key = ? WHERE id = 1').run(crypt.seal(pair.privatePem), pair.publicKey);
      event('warn', `Clé racine renouvelée, nouvelle empreinte ${fingerprint(pair.publicKey)}`);
      return { fingerprint: fingerprint(pair.publicKey) };
    },

    /** Copie de secours de la clé racine, chiffrée par une phrase de passe */
    exportRoot(passphrase: string) {
      const m = membership();
      if (!m?.root_private_key) throw new HttpError(403, 'not_root', 'Seul le nœud racine détient la clé racine');
      if (passphrase.length < 16) throw new HttpError(400, 'weak_passphrase', 'La phrase de passe doit contenir au moins 16 caractères');
      const salt = randomBytes(16);
      const key = scryptSync(passphrase.normalize('NFKC'), salt, 32, { N: 1 << 16, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(crypt.open(m.root_private_key), 'utf8'), cipher.final()]);
      return {
        format: 'bettervault.cluster-root', version: 1, clusterId: m.cluster_id, rootKey: m.root_key,
        salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64')
      };
    },

    /** Reprend la clé racine sur ce nœud, par exemple quand le nœud racine est perdu */
    async importRoot(blob: Record<string, unknown>, passphrase: string) {
      const m = membership();
      if (!m || m.state !== 'member') throw new HttpError(409, 'not_member', 'Ce nœud doit d’abord faire partie de la grappe');
      if (blob.clusterId !== m.cluster_id || blob.rootKey !== m.root_key) throw new HttpError(409, 'root_mismatch', 'Cette clé racine n’est pas celle de la grappe');
      let pem: string;
      try {
        const key = scryptSync(passphrase.normalize('NFKC'), Buffer.from(String(blob.salt), 'base64'), 32, { N: 1 << 16, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(String(blob.iv), 'base64'));
        decipher.setAuthTag(Buffer.from(String(blob.tag), 'base64'));
        pem = Buffer.concat([decipher.update(Buffer.from(String(blob.data), 'base64')), decipher.final()]).toString('utf8');
      } catch {
        throw new HttpError(401, 'wrong_passphrase', 'Phrase de passe incorrecte');
      }
      if (rawPublic(createPublicKey(createPrivateKey(pem))) !== m.root_key) throw new HttpError(409, 'root_mismatch', 'Cette clé racine n’est pas celle de la grappe');
      db.prepare('UPDATE cluster_membership SET root_private_key = ?, root_url = ? WHERE id = 1').run(crypt.seal(pem), selfNode()?.url ?? m.root_url);
      // Les autres nœuds apprennent par un manifeste signé où se trouve désormais la racine
      await publish(nodes => nodes, { rootUrl: selfNode()?.url ?? m.root_url });
      event('warn', 'Clé racine reprise sur ce nœud : il devient le nœud racine');
    },

    /** Quitte la grappe : les données restent, la réplication s'arrête */
    leave() {
      const m = membership();
      if (!m) return;
      if (m.root_private_key && (manifest()?.nodes.filter(n => n.status !== 'revoked').length ?? 0) > 1) {
        throw new HttpError(409, 'root_with_members', 'Révoquez d’abord les autres nœuds, ou transférez la clé racine');
      }
      db.prepare('DELETE FROM cluster_membership').run();
      db.prepare('DELETE FROM cluster_join_requests').run();
      event('warn', 'Ce nœud a quitté la grappe');
    }
  };

  function snapshot() {
    const m = membership();
    const current = manifest();
    return {
      self: { id: selfId, fingerprint: fingerprint(selfPublic), zone: zone() },
      cluster: m ? {
        id: m.cluster_id,
        name: current?.clusterName ?? null,
        state: m.state,
        epoch: m.epoch,
        isRoot: !!m.root_private_key,
        rootUrl: m.root_url,
        rootFingerprint: fingerprint(m.root_key),
        nodes: (current?.nodes ?? []).map(n => ({ ...n, fingerprint: fingerprint(n.publicKey), self: n.id === selfId }))
      } : null,
      pending: (db.prepare('SELECT * FROM cluster_join_requests ORDER BY requested_at').all() as Array<Record<string, unknown>>)
        .map(r => ({ id: r.node_id, name: r.name, zone: r.zone, region: r.region, url: r.url, fingerprint: fingerprint(String(r.public_key)), requestedAt: r.requested_at })),
      events: db.prepare('SELECT at, level, node_id AS nodeId, message FROM cluster_events ORDER BY id DESC LIMIT 50').all()
    };
  }

  return {
    selfId,
    zone,
    peers,
    signedHeaders,
    verifyRequest,
    refreshManifest,
    isMember: () => membership()?.state === 'member',
    isRoot,
    manifest,
    snapshot,
    actions,
    nodeRoutes,
    event
  };
}

export type ClusterTrust = ReturnType<typeof createClusterTrust>;

/** Corps brut d'une requête, pour vérifier sa signature avant de l'interpréter */
async function readRaw(req: IncomingMessage, max: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new HttpError(413, 'too_large', 'Requête trop volumineuse');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export type { Reply };
export const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
