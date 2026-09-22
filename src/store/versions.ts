/**
 * Versions des éléments du coffre : historique, ancêtre commun, fusion à trois voies.
 *
 * Chaque identifiant et chaque tâche porte :
 *   - `rev`      : l'identifiant de sa version courante ;
 *   - `history`  : ses versions précédentes, les plus récentes à la fin ;
 *   - `conflicts`: les valeurs écartées lors d'une modification simultanée du même
 *                  champ sur deux appareils, en attente d'une décision.
 *
 * Tout cela vit dans le coffre, donc chiffré avec lui : le serveur n'en voit rien.
 *
 * Fusion
 *   Si l'une des versions descend de l'autre, elle l'emporte telle quelle. Sinon on
 *   cherche leur dernier ancêtre commun et l'on fusionne champ par champ : un champ
 *   modifié d'un seul côté passe sans bruit ; modifié des deux côtés, la valeur la
 *   plus récente est retenue et l'autre gardée comme conflit. Rien n'est écrasé en
 *   silence. Le résultat ne dépend pas de l'ordre des arguments ni de l'appareil qui
 *   fusionne : deux appareils qui fusionnent la même paire obtiennent le même élément.
 */

export type VersionOp = 'create' | 'update' | 'merge' | 'restore';

export interface ItemVersion {
  rev: string;
  at: number;
  op: VersionOp;
  /** Contenu de l'élément à cette version, sans son historique */
  snapshot: Record<string, unknown>;
}

export interface ItemConflict {
  field: string;
  /** Valeur écartée ; la valeur retenue est celle de l'élément */
  value: unknown;
  /** Version d'où vient la valeur écartée */
  rev: string;
  at: number;
}

export interface Versioned {
  id: string;
  updatedAt: number;
  rev?: string;
  history?: ItemVersion[];
  conflicts?: ItemConflict[];
}

export const MAX_VERSIONS = 20;
/** Au-delà, les versions les plus anciennes partent : l'historique ne doit pas gonfler le coffre */
export const MAX_HISTORY_BYTES = 64 * 1024;
export const MAX_CONFLICTS = 20;

const META = new Set(['rev', 'history', 'conflicts']);

/** Tableaux d'éléments identifiés : fusionnés comme des ensembles, pas remplacés en bloc */
const ID_SETS = new Set(['attachments', 'fields', 'passkeys', 'subtasks']);

/* ── Outils ────────────────────────────────────────────────────────────── */

/** JSON à clés triées : deux contenus égaux donnent la même chaîne, quel que soit l'ordre d'écriture */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** Empreinte courte et déterministe (FNV-1a 64 bits) : identifie, ne protège pas */
export function shortHash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/**
 * Contenu versionné d'un élément. Les fichiers gardés dans le coffre y perdent leur
 * contenu (jusqu'à 1 Mo chacun) : une version ne garde que leur fiche, sans quoi vingt
 * versions d'un élément avec pièce jointe pèseraient vingt fois le fichier.
 */
export function contentOf(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (META.has(key) || value === undefined) continue;
    out[key] = key === 'attachments' && Array.isArray(value)
      ? value.map(a => {
          const { data: _data, ...meta } = a as Record<string, unknown>;
          return meta;
        })
      : value;
  }
  return out;
}

export const fingerprintOf = (item: Record<string, unknown>) => stableStringify(contentOf(item));

const equal = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);

/** Garde les versions les plus récentes, dans la limite du nombre et de la taille */
export function capHistory(history: ItemVersion[]): ItemVersion[] {
  const kept: ItemVersion[] = [];
  let bytes = 0;
  for (let i = history.length - 1; i >= 0 && kept.length < MAX_VERSIONS; i--) {
    const size = stableStringify(history[i]).length;
    if (bytes + size > MAX_HISTORY_BYTES && kept.length) break;
    bytes += size;
    kept.unshift(history[i]);
  }
  return kept;
}

/* ── Enregistrement d'une modification ─────────────────────────────────── */

/**
 * Donne une nouvelle version à un élément modifié, en rangeant l'ancienne dans son
 * historique. `previous` est l'élément tel qu'il était au dernier enregistrement.
 */
export function stampVersion<T extends Versioned>(item: T, previous: T | undefined, newRev: () => string): T {
  if (previous && fingerprintOf(previous as unknown as Record<string, unknown>) === fingerprintOf(item as unknown as Record<string, unknown>)) {
    // Contenu inchangé : on garde la version et l'historique connus
    return { ...item, rev: previous.rev ?? item.rev, history: previous.history ?? item.history };
  }
  const history = [...(item.history ?? previous?.history ?? [])];
  if (previous?.rev) {
    history.push({ rev: previous.rev, at: previous.updatedAt, op: 'update', snapshot: contentOf(previous as unknown as Record<string, unknown>) });
  }
  const dedup = dedupeHistory(history);
  return { ...item, rev: newRev(), history: capHistory(dedup) };
}

function dedupeHistory(history: ItemVersion[]): ItemVersion[] {
  const byRev = new Map<string, ItemVersion>();
  for (const version of history) if (!byRev.has(version.rev)) byRev.set(version.rev, version);
  return [...byRev.values()].sort((a, b) => a.at - b.at || (a.rev < b.rev ? -1 : 1));
}

/* ── Fusion ────────────────────────────────────────────────────────────── */

/** Versions connues d'un élément, de la plus récente à la plus ancienne */
const lineage = (item: Versioned): string[] =>
  [item.rev, ...[...(item.history ?? [])].reverse().map(v => v.rev)].filter((r): r is string => !!r);

function snapshotOf(rev: string, ...items: Versioned[]): Record<string, unknown> | null {
  for (const item of items) {
    if (item.rev === rev) return contentOf(item as unknown as Record<string, unknown>);
    const found = item.history?.find(v => v.rev === rev);
    if (found) return found.snapshot;
  }
  return null;
}

/** Côté retenu quand les deux ont changé le même champ : le plus récent, puis la version la plus grande */
function newer(a: Versioned, b: Versioned): 'a' | 'b' {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? 'a' : 'b';
  return (a.rev ?? fingerprintOf(a as never)) >= (b.rev ?? fingerprintOf(b as never)) ? 'a' : 'b';
}

/** Fusion d'un tableau d'éléments identifiés : ajouts des deux côtés, retraits des deux côtés */
function mergeIdSet(base: unknown, a: unknown, b: unknown, preferA: boolean): unknown[] {
  const list = (v: unknown) => (Array.isArray(v) ? v as Array<Record<string, unknown>> : []);
  const key = (v: Record<string, unknown>) => String(v.id ?? stableStringify(v));
  const baseMap = new Map(list(base).map(v => [key(v), v]));
  const aMap = new Map(list(a).map(v => [key(v), v]));
  const bMap = new Map(list(b).map(v => [key(v), v]));
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const k of [...aMap.keys(), ...bMap.keys()]) {
    if (seen.has(k)) continue;
    seen.add(k);
    const inBase = baseMap.has(k);
    const va = aMap.get(k);
    const vb = bMap.get(k);
    // Retiré d'un côté, intact de l'autre : le retrait l'emporte
    if (inBase && (!va || !vb)) {
      const remaining = va ?? vb;
      if (equal(remaining, baseMap.get(k))) continue;
    }
    if (va && vb) {
      if (equal(va, vb)) out.push(va);
      else if (inBase && equal(va, baseMap.get(k))) out.push(vb);
      else if (inBase && equal(vb, baseMap.get(k))) out.push(va);
      else out.push(preferA ? va : vb);
    } else out.push(va ?? vb);
  }
  return out;
}

/** Tags : ensemble de chaînes, même logique */
function mergeStringSet(base: unknown, a: unknown, b: unknown): string[] {
  const set = (v: unknown) => new Set(Array.isArray(v) ? v.map(String) : []);
  const [s0, sa, sb] = [set(base), set(a), set(b)];
  const out = new Set<string>([...sa, ...sb]);
  for (const tag of s0) if (!sa.has(tag) || !sb.has(tag)) out.delete(tag);
  return [...out].sort();
}

/**
 * Fusionne deux versions d'un même élément. Commutative : merge(a, b) et merge(b, a)
 * donnent le même résultat, pour que tous les appareils convergent.
 */
export function mergeItem<T extends Versioned>(a: T, b: T): T {
  if (a.rev && a.rev === b.rev) return mergeMeta(a, b, a);
  const la = lineage(a);
  const lb = lineage(b);
  if (a.rev && lb.includes(a.rev)) return mergeMeta(b, a, b);
  if (b.rev && la.includes(b.rev)) return mergeMeta(a, b, a);

  // Ordre canonique : le résultat ne doit pas dépendre de qui appelle
  const [x, y] = newer(a, b) === 'a' ? [a, b] : [b, a];
  const baseRev = lineage(x).find(rev => lineage(y).includes(rev));
  const base = baseRev ? snapshotOf(baseRev, x, y) : null;

  const cx = contentOf(x as unknown as Record<string, unknown>);
  const cy = contentOf(y as unknown as Record<string, unknown>);
  const merged: Record<string, unknown> = {};
  const conflicts: ItemConflict[] = [];

  for (const field of new Set([...Object.keys(cx), ...Object.keys(cy), ...Object.keys(base ?? {})])) {
    const vx = cx[field];
    const vy = cy[field];
    const vb = base?.[field];
    if (field === 'updatedAt') {
      merged[field] = Math.max(Number(vx) || 0, Number(vy) || 0);
    } else if (field === 'tags') {
      merged[field] = mergeStringSet(vb, vx, vy);
    } else if (ID_SETS.has(field)) {
      const set = mergeIdSet(vb, vx, vy, true);
      if (set.length || vx !== undefined || vy !== undefined) merged[field] = set;
    } else if (field === 'passwordHistory') {
      const all = [...(Array.isArray(vx) ? vx : []), ...(Array.isArray(vy) ? vy : [])] as Array<{ changedAt: number }>;
      const unique = new Map(all.map(h => [stableStringify(h), h]));
      merged[field] = [...unique.values()].sort((p, q) => p.changedAt - q.changedAt).slice(-20);
    } else if (equal(vx, vy)) {
      if (vx !== undefined) merged[field] = vx;
    } else if (base && equal(vx, vb)) {
      if (vy !== undefined) merged[field] = vy;
    } else if (base && equal(vy, vb)) {
      if (vx !== undefined) merged[field] = vx;
    } else {
      // Changé des deux côtés, ou pas d'ancêtre connu : la plus récente gagne, l'autre est gardée
      if (vx !== undefined) merged[field] = vx;
      if (y.rev || vy !== undefined) conflicts.push({ field, value: vy ?? null, rev: y.rev ?? 'inconnue', at: y.updatedAt });
    }
  }

  // La comparaison se fait sans le contenu des fichiers gardés dans le coffre ; on le rattache ici
  if (Array.isArray(merged.attachments)) {
    const inline = new Map<string, string>();
    for (const side of [y, x]) {
      for (const file of ((side as unknown as { attachments?: Array<{ id: string; data?: string }> }).attachments ?? [])) {
        if (file.data) inline.set(file.id, file.data);
      }
    }
    merged.attachments = (merged.attachments as Array<{ id: string }>).map(file => (inline.has(file.id) ? { ...file, data: inline.get(file.id) } : file));
  }

  const parents = [x, y]
    .filter(v => v.rev)
    .map(v => ({ rev: v.rev!, at: v.updatedAt, op: 'update' as VersionOp, snapshot: contentOf(v as unknown as Record<string, unknown>) }));
  const history = capHistory(dedupeHistory([...(x.history ?? []), ...(y.history ?? []), ...parents]));
  const allConflicts = mergeConflicts([...(x.conflicts ?? []), ...(y.conflicts ?? []), ...conflicts]);

  return {
    ...(merged as unknown as T),
    rev: `m-${shortHash([a.rev ?? fingerprintOf(a as never), b.rev ?? fingerprintOf(b as never)].sort().join('|'))}`,
    history,
    ...(allConflicts.length ? { conflicts: allConflicts } : {})
  };
}

/** Même contenu : on garde `keep`, avec l'historique et les conflits connus des deux côtés */
function mergeMeta<T extends Versioned>(a: T, b: T, keep: T): T {
  const history = capHistory(dedupeHistory([...(a.history ?? []), ...(b.history ?? [])]).filter(v => v.rev !== keep.rev));
  const conflicts = mergeConflicts([...(keep.conflicts ?? [])]);
  const { conflicts: _drop, ...rest } = keep;
  return { ...(rest as T), history, ...(conflicts.length ? { conflicts } : {}) };
}

function mergeConflicts(list: ItemConflict[]): ItemConflict[] {
  const byKey = new Map<string, ItemConflict>();
  for (const c of list) byKey.set(`${c.field}|${c.rev}`, c);
  return [...byKey.values()].sort((p, q) => p.at - q.at).slice(-MAX_CONFLICTS);
}

/* ── Restauration ──────────────────────────────────────────────────────── */

/**
 * Revient au contenu d'une version passée. C'est une nouvelle version, pas un
 * effacement de ce qui a suivi : la version courante rejoint l'historique et reste
 * restaurable à son tour.
 */
export function restoreVersion<T extends Versioned>(item: T, rev: string, now: number, newRev: () => string): T | null {
  const version = item.history?.find(v => v.rev === rev);
  if (!version) return null;
  const current = item as unknown as Record<string, unknown>;
  const snapshot = { ...version.snapshot };

  // Les fichiers gardés dans le coffre ont perdu leur contenu dans la version : on le reprend
  if (Array.isArray(snapshot.attachments) && Array.isArray(current.attachments)) {
    const data = new Map((current.attachments as Array<{ id: string; data?: string }>).map(a => [a.id, a.data]));
    snapshot.attachments = (snapshot.attachments as Array<{ id: string }>).map(a => (data.get(a.id) ? { ...a, data: data.get(a.id) } : a));
  }

  const restored = { ...(snapshot as unknown as T), id: item.id, updatedAt: now, history: item.history };
  return stampVersion(restored, item, newRev);
}

/** Retire un conflit en gardant la valeur écartée ou la valeur retenue */
export function resolveConflict<T extends Versioned>(item: T, conflict: ItemConflict, keep: 'current' | 'other'): Record<string, unknown> {
  const remaining = (item.conflicts ?? []).filter(c => !(c.field === conflict.field && c.rev === conflict.rev));
  return {
    ...(keep === 'other' ? { [conflict.field]: conflict.value } : {}),
    conflicts: remaining.length ? remaining : undefined
  };
}
