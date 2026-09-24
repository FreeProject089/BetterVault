/**
 * Diagrammes de la documentation, dessinés par le serveur en SVG.
 *
 * La syntaxe est celle de Mermaid, comme le prévoit B.MD (`:::mermaid` ou un
 * bloc ```mermaid) : un autre lecteur B.MD les affiche avec Mermaid lui-même.
 * Ici, pas de script ni de dépendance : la page reste sous sa politique de
 * sécurité stricte, et le diagramme suit le thème par les variables CSS.
 *
 * Reconnu : les organigrammes (`graph` / `flowchart`, sens TD, TB, BT, LR, RL),
 * les formes [boîte] (arrondie) ([pilule]) ((cercle)) {losange} [(base)],
 * les liens --> --- -.-> ==> avec libellé (-- texte --> ou -->|texte|), les
 * enchaînements A --> B --> C, A & B --> C, et les sous-graphes. Le reste
 * (classDef, style, click…) est ignoré. Un texte illisible rend null, et
 * l'appelant affiche alors le code tel quel.
 */

type Shape = 'rect' | 'round' | 'stadium' | 'circle' | 'diamond' | 'db';
interface Node { id: string; label: string; shape: Shape; group?: string; w: number; h: number; x: number; y: number; rank: number; order: number }
interface Edge { from: string; to: string; label: string; style: 'solid' | 'dotted' | 'thick'; arrow: boolean; both?: boolean }
interface Group { id: string; title: string; nodes: string[] }

const escapeXml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const SHAPES: Array<[RegExp, Shape]> = [
  [/^\(\((.*)\)\)$/, 'circle'], [/^\(\[(.*)\]\)$/, 'stadium'], [/^\[\((.*)\)\]$/, 'db'],
  [/^\[(.*)\]$/, 'rect'], [/^\((.*)\)$/, 'round'], [/^\{(.*)\}$/, 'diamond']
];
const LINK = /\s*(<-->|<==>|<-\.->|-->|---|-\.->|-\.-|==>|===)(?:\|([^|]*)\|)?\s*|\s+--\s+(.+?)\s+(-->|---)\s*|\s+-\.\s+(.+?)\s+\.->\s*|\s+==\s+(.+?)\s+==>\s*/;

const cleanLabel = (raw: string) => raw.trim().replace(/^"(.*)"$/, '$1').replace(/<br\s*\/?>/gi, '\n').replace(/\\n/g, '\n').slice(0, 120);

export function parseFlowchart(source: string): { dir: 'TD' | 'LR' | 'BT' | 'RL'; nodes: Map<string, Node>; edges: Edge[]; groups: Group[] } | null {
  const lines = source.replace(/%%.*$/gm, '').split(/\n|;/).map(l => l.trim()).filter(Boolean);
  const head = /^(?:graph|flowchart)\s+(TD|TB|BT|LR|RL)\b/i.exec(lines.shift() ?? '');
  if (!head) return null;
  const d = head[1].toUpperCase();
  const dir = (d === 'TB' ? 'TD' : d) as 'TD' | 'LR' | 'BT' | 'RL';
  const nodes = new Map<string, Node>();
  const edges: Edge[] = [];
  const groups: Group[] = [];
  const stack: Group[] = [];

  // « A[Texte] » : déclare (ou complète) un nœud, et rend son identifiant
  const node = (token: string): string | null => {
    const m = /^([\w.-]+)\s*(.*)$/.exec(token.trim());
    if (!m) return null;
    const [, id, rest] = m;
    let label = id, shape: Shape = 'rect', given = false;
    if (rest) {
      const found = SHAPES.find(([re]) => re.test(rest));
      if (!found) return null;
      label = cleanLabel(found[0].exec(rest)![1]);
      shape = found[1];
      given = true;
    }
    const known = nodes.get(id);
    if (known) { if (given) { known.label = label; known.shape = shape; } }
    else nodes.set(id, { id, label, shape, w: 0, h: 0, x: 0, y: 0, rank: 0, order: 0 });
    const group = stack[stack.length - 1];
    if (group && !group.nodes.includes(id) && !groups.some(g => g !== group && g.nodes.includes(id))) group.nodes.push(id);
    return id;
  };

  for (const line of lines) {
    if (/^(classDef|class|style|linkStyle|click|direction)\b/.test(line)) continue;
    const sub = /^subgraph\s+([\w.-]+)?\s*(?:\[(.*)\])?\s*(.*)$/.exec(line);
    if (sub) {
      const g: Group = { id: sub[1] ?? `g${groups.length}`, title: cleanLabel(sub[2] ?? sub[3] ?? sub[1] ?? ''), nodes: [] };
      groups.push(g); stack.push(g);
      continue;
    }
    if (line === 'end') { stack.pop(); continue; }
    // Découpe en maillons : A --> B -- texte --> C
    const parts: string[] = [];
    const links: Array<{ kind: string; label: string }> = [];
    let rest = line;
    for (let guard = 0; guard < 50; guard++) {
      const m = LINK.exec(rest);
      if (!m) { parts.push(rest); break; }
      parts.push(rest.slice(0, m.index));
      const kind = m[1] ?? (m[4] ? m[4] : m[5] !== undefined ? '-.->' : '==>');
      links.push({ kind, label: cleanLabel(m[2] ?? m[3] ?? m[5] ?? m[6] ?? '') });
      rest = rest.slice(m.index + m[0].length);
    }
    const ids = parts.map(p => p.split('&').map(t => node(t)));
    if (ids.some(list => list.some(id => id === null))) return null;
    links.forEach((link, i) => {
      for (const from of ids[i]) for (const to of ids[i + 1] ?? []) {
        edges.push({
          from: from!, to: to!, label: link.label,
          style: link.kind.includes('.') ? 'dotted' : link.kind.includes('=') ? 'thick' : 'solid',
          arrow: link.kind.endsWith('>'), both: link.kind.startsWith('<')
        });
      }
    });
  }
  if (!nodes.size || nodes.size > 60) return null;
  for (const g of groups) for (const id of g.nodes) { const n = nodes.get(id); if (n) n.group = g.id; }
  return { dir, nodes, edges, groups };
}

/* Mesure approchée du texte (police système, 13 px) */
const textWidth = (s: string) => [...s].reduce((w, c) => w + (/[A-Z0-9@#%&MWmw]/.test(c) ? 8.4 : /[il.,:;'|! ]/.test(c) ? 4 : 7), 0);

let serial = 0;

export function renderDiagram(source: string, caption = ''): string | null {
  const graph = parseFlowchart(source);
  if (!graph) return null;
  const { dir, nodes, edges, groups } = graph;
  const vertical = dir === 'TD' || dir === 'BT';
  const id = ++serial;

  // Taille de chaque nœud d'après son texte
  for (const n of nodes.values()) {
    const lines = n.label.split('\n');
    const tw = Math.max(...lines.map(textWidth));
    n.w = Math.max(n.shape === 'circle' ? 64 : 96, tw + (n.shape === 'diamond' ? 56 : n.shape === 'circle' ? 28 : 32));
    n.h = lines.length * 17 + (n.shape === 'diamond' ? 34 : n.shape === 'db' ? 30 : 22);
    if (n.shape === 'circle') n.w = n.h = Math.max(n.w, n.h);
  }

  // Rangs : plus long chemin depuis les sources, en ignorant les retours en arrière
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const state = new Map<string, number>();
  const back = new Set<Edge>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const e of edges.filter(x => x.from === id)) {
      if (state.get(e.to) === 1) back.add(e);
      else if (!state.has(e.to)) visit(e.to);
    }
    state.set(id, 2);
  };
  for (const id of nodes.keys()) if (!state.has(id)) visit(id);
  const forward = edges.filter(e => !back.has(e) && e.from !== e.to);
  /*
   * Un lien d'un sous-graphe vers un autre place ce dernier entièrement après
   * le premier : leurs cadres ne se chevauchent pas.
   */
  const maxRank = (group: string) => Math.max(...[...nodes.values()].filter(n => n.group === group).map(n => n.rank));
  for (let pass = 0; pass < nodes.size * 2; pass++) {
    let moved = false;
    for (const e of forward) {
      const a = nodes.get(e.from)!, b = nodes.get(e.to)!;
      const floor = a.group && b.group && a.group !== b.group ? maxRank(a.group) + 1 : a.rank + 1;
      if (b.rank < floor) { b.rank = floor; moved = true; }
    }
    if (!moved) break;
  }
  // Les nœuds d'un sous-graphe placé après un autre démarrent tous après lui
  for (const g of groups) {
    const first = Math.min(...g.nodes.map(id => nodes.get(id)?.rank ?? Infinity));
    for (const other of groups) {
      if (other === g || !forward.some(e => nodes.get(e.from)?.group === other.id && nodes.get(e.to)?.group === g.id)) continue;
      const shift = maxRank(other.id) + 1 - first;
      if (shift > 0) for (const id of g.nodes) { const n = nodes.get(id); if (n) n.rank += shift; }
    }
  }
  const ranks: Node[][] = [];
  for (const n of nodes.values()) (ranks[n.rank] ??= []).push(n);
  for (let r = 0; r < ranks.length; r++) ranks[r] ??= [];

  // Ordre dans chaque rang : barycentre des voisins, deux allers-retours
  ranks.forEach(rank => rank.forEach((n, i) => { n.order = i; }));
  const bary = (n: Node, side: 'up' | 'down') => {
    const near = forward.filter(e => (side === 'up' ? e.to === n.id : e.from === n.id)).map(e => nodes.get(side === 'up' ? e.from : e.to)!.order);
    return near.length ? near.reduce((a, b) => a + b, 0) / near.length : n.order;
  };
  for (let sweep = 0; sweep < 4; sweep++) {
    const list = sweep % 2 === 0 ? ranks.slice(1) : ranks.slice(0, -1).reverse();
    for (const rank of list) {
      const keyed = rank.map(n => [bary(n, sweep % 2 === 0 ? 'up' : 'down'), n.group ?? '', n] as const);
      keyed.sort((a, b) => a[1].localeCompare(b[1]) || a[0] - b[0]);
      keyed.forEach(([, , n], i) => { n.order = i; rank[i] = n; });
    }
  }

  // Placement : rangs le long du sens du diagramme, nœuds centrés dans leur rang
  const GAP = 40, RANK_GAP = 58, PAD = 24;
  const cross = (n: Node) => (vertical ? n.w : n.h);
  const along = (n: Node) => (vertical ? n.h : n.w);
  const rankSize = ranks.map(r => Math.max(0, ...r.map(along)));
  // Deux voisins de sous-graphes différents : de la place pour les deux cadres et leur titre
  const between = (a: Node, b: Node) => GAP + (a.group !== b.group && (a.group || b.group) ? 52 : 0);
  const rankSpan = ranks.map(r => r.reduce((s, n, i) => s + cross(n) + (i ? between(r[i - 1], n) : 0), 0));
  const width = Math.max(...rankSpan);
  // Un sous-graphe qui commence ou finit entre deux rangs : un écart plus grand
  const groupsOf = (r: Node[]) => [...new Set(r.map(n => n.group ?? ''))].sort().join('|');
  let pos = 0;
  ranks.forEach((rank, r) => {
    let c = (width - rankSpan[r]) / 2;
    rank.forEach((n, i) => {
      if (i) c += between(rank[i - 1], n);
      const mid = pos + rankSize[r] / 2;
      if (vertical) { n.x = c + n.w / 2; n.y = mid; } else { n.x = mid; n.y = c + n.h / 2; }
      c += cross(n);
    });
    pos += rankSize[r] + RANK_GAP + (ranks[r + 1] && groupsOf(rank) !== groupsOf(ranks[r + 1]) ? 36 : 0);
  });
  const length = pos - RANK_GAP;
  if (dir === 'BT' || dir === 'RL') for (const n of nodes.values()) { if (dir === 'BT') n.y = length - n.y; else n.x = length - n.x; }

  // Sous-graphes : un cadre autour de leurs nœuds, avec leur titre
  const frames = groups.filter(g => g.nodes.length).map(g => {
    const list = g.nodes.map(id => nodes.get(id)!).filter(Boolean);
    const x0 = Math.min(...list.map(n => n.x - n.w / 2)) - 16, x1 = Math.max(...list.map(n => n.x + n.w / 2)) + 16;
    const y0 = Math.min(...list.map(n => n.y - n.h / 2)) - (g.title ? 34 : 16), y1 = Math.max(...list.map(n => n.y + n.h / 2)) + 16;
    return { g, x0, x1, y0, y1 };
  });

  const all = [...nodes.values()];
  const minX = Math.min(...all.map(n => n.x - n.w / 2), ...frames.map(f => f.x0)) - PAD;
  const minY = Math.min(...all.map(n => n.y - n.h / 2), ...frames.map(f => f.y0)) - PAD;
  const maxX = Math.max(...all.map(n => n.x + n.w / 2), ...frames.map(f => f.x1)) + PAD;
  const maxY = Math.max(...all.map(n => n.y + n.h / 2), ...frames.map(f => f.y1)) + PAD;

  const text = (n: Node) => {
    const lines = n.label.split('\n');
    const first = n.y - ((lines.length - 1) * 17) / 2 + (n.shape === 'db' ? 5 : 0);
    return `<text x="${n.x}" y="${first}" class="dg-text">${lines.map((l, i) => `<tspan x="${n.x}" ${i ? 'dy="17"' : ''}>${escapeXml(l)}</tspan>`).join('')}</text>`;
  };
  const shape = (n: Node) => {
    const { x, y, w, h } = n;
    const l = x - w / 2, t = y - h / 2;
    switch (n.shape) {
      case 'round': return `<rect x="${l}" y="${t}" width="${w}" height="${h}" rx="12" class="dg-node"/>`;
      case 'stadium': return `<rect x="${l}" y="${t}" width="${w}" height="${h}" rx="${h / 2}" class="dg-node"/>`;
      case 'circle': return `<circle cx="${x}" cy="${y}" r="${w / 2}" class="dg-node"/>`;
      case 'diamond': return `<polygon points="${x},${t} ${l + w},${y} ${x},${t + h} ${l},${y}" class="dg-node dg-choice"/>`;
      case 'db': return `<path d="M${l},${t + 8} a${w / 2},8 0 0 0 ${w},0 a${w / 2},8 0 0 0 ${-w},0 v${h - 16} a${w / 2},8 0 0 0 ${w},0 v${-(h - 16)}" class="dg-node dg-db"/>`;
      default: return `<rect x="${l}" y="${t}" width="${w}" height="${h}" rx="6" class="dg-node"/>`;
    }
  };

  // Point de sortie sur le bord d'un nœud, vers un autre point
  const border = (n: Node, tx: number, ty: number): [number, number] => {
    const dx = tx - n.x, dy = ty - n.y;
    if (!dx && !dy) return [n.x, n.y];
    if (n.shape === 'circle') { const k = n.w / 2 / Math.hypot(dx, dy); return [n.x + dx * k, n.y + dy * k]; }
    if (n.shape === 'diamond') { const k = 1 / (Math.abs(dx) / (n.w / 2) + Math.abs(dy) / (n.h / 2)); return [n.x + dx * k, n.y + dy * k]; }
    const k = Math.min((n.w / 2) / Math.abs(dx || 1e-9), (n.h / 2) / Math.abs(dy || 1e-9));
    return [n.x + dx * k, n.y + dy * k];
  };
  /*
   * Libellés des liens : au milieu de la courbe si la place est libre, sinon
   * un peu plus loin le long d'elle — jamais sur un nœud, un titre de cadre
   * ou un autre libellé.
   */
  type Box = [number, number, number, number];
  const taken: Box[] = [
    ...all.map((n): Box => [n.x - n.w / 2 - 4, n.y - n.h / 2 - 4, n.x + n.w / 2 + 4, n.y + n.h / 2 + 4]),
    ...frames.filter(f => f.g.title).map((f): Box => [f.x0, f.y0, f.x0 + textWidth(f.g.title) * 1.05 + 28, f.y0 + 30])
  ];
  const hits = (b: Box) => taken.some(o => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
  const bezier = (p: number[], t: number): [number, number] => {
    const u = 1 - t;
    return [u * u * u * p[0] + 3 * u * u * t * p[2] + 3 * u * t * t * p[4] + t * t * t * p[6], u * u * u * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t * t * t * p[7]];
  };
  const placeLabel = (curve: number[], text: string) => {
    const lw = textWidth(text) + 14;
    let best: [number, number] | null = null;
    for (const t of [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8]) {
      const [x, y] = bezier(curve, t);
      const box: Box = [x - lw / 2, y - 11, x + lw / 2, y + 11];
      if (!hits(box)) { best = [x, y]; taken.push(box); break; }
    }
    const [mx, my] = best ?? bezier(curve, 0.5);
    return `<g class="dg-label"><rect x="${mx - lw / 2}" y="${my - 11}" width="${lw}" height="22" rx="11"/><text x="${mx}" y="${my}">${escapeXml(text)}</text></g>`;
  };

  // Point le plus éloigné atteint par un lien qui contourne : le cadre du dessin s'élargit d'autant
  let reach = -Infinity, reachMin = Infinity;
  const links = edges.map(e => {
    const a = nodes.get(e.from)!, b = nodes.get(e.to)!;
    const isBack = back.has(e);
    // Sortie et entrée sur les faces qui se regardent ; un retour contourne par le côté
    let [sx, sy] = vertical ? [a.x, a.y + (b.y >= a.y ? a.h / 2 : -a.h / 2)] : [a.x + (b.x >= a.x ? a.w / 2 : -a.w / 2), a.y];
    let [ex, ey] = vertical ? [b.x, b.y + (b.y >= a.y ? -b.h / 2 : b.h / 2)] : [b.x + (b.x >= a.x ? -b.w / 2 : b.w / 2), b.y];
    if (a.shape === 'circle' || a.shape === 'diamond') [sx, sy] = border(a, b.x, b.y);
    if (b.shape === 'circle' || b.shape === 'diamond') [ex, ey] = border(b, a.x, a.y);
    let curve: number[];
    if (isBack) {
      // Un retour remonte par le côté libre : à gauche s'il part de la moitié gauche du dessin
      const centre = vertical ? (Math.min(...all.map(n => n.x)) + Math.max(...all.map(n => n.x))) / 2 : (Math.min(...all.map(n => n.y)) + Math.max(...all.map(n => n.y))) / 2;
      const left = (vertical ? a.x : a.y) < centre;
      const s = left ? -1 : 1;
      const span = all.filter(n => n.rank >= Math.min(a.rank, b.rank) && n.rank <= Math.max(a.rank, b.rank));
      const outer = vertical
        ? (left ? Math.min(...span.map(n => n.x - n.w / 2)) : Math.max(...span.map(n => n.x + n.w / 2)))
        : (left ? Math.min(...span.map(n => n.y - n.h / 2)) : Math.max(...span.map(n => n.y + n.h / 2)));
      const side = outer + s * 44;
      [sx, sy] = vertical ? [a.x + s * a.w / 2, a.y] : [a.x, a.y + s * a.h / 2];
      [ex, ey] = vertical ? [b.x + s * b.w / 2, b.y] : [b.x, b.y + s * b.h / 2];
      if (left) reachMin = Math.min(reachMin, outer + s * 36); else reach = Math.max(reach, outer + s * 36);
      curve = vertical ? [sx, sy, side, sy, side, ey, ex, ey] : [sx, sy, sx, side, ex, side, ex, ey];
    } else {
      const k = vertical ? (ey - sy) / 2 : (ex - sx) / 2;
      curve = vertical ? [sx, sy, sx, sy + k, ex, ey - k, ex, ey] : [sx, sy, sx + k, sy, ex - k, ey, ex, ey];
      /*
       * Un lien qui saute des rangs contourne les nœuds posés sur son trajet :
       * la courbe s'écarte assez pour passer à côté (une cubique n'atteint
       * que les trois quarts de l'écart de ses points de contrôle).
       */
      if (b.rank - a.rank > 1) {
        const line = vertical ? (sx + ex) / 2 : (sy + ey) / 2;
        const blocked = all.filter(n => n.rank > a.rank && n.rank < b.rank
          && (vertical ? Math.abs(n.x - line) < n.w / 2 + 12 : Math.abs(n.y - line) < n.h / 2 + 12));
        if (blocked.length) {
          const edge = vertical ? Math.max(...blocked.map(n => n.x + n.w / 2)) : Math.max(...blocked.map(n => n.y + n.h / 2));
          const side = line + (edge + 28 - line) / 0.75;
          reach = Math.max(reach, line + (edge + 28 - line));
          curve = vertical
            ? [sx, sy, side, sy + (ey - sy) * 0.15, side, ey - (ey - sy) * 0.15, ex, ey]
            : [sx, sy, sx + (ex - sx) * 0.15, side, ex - (ex - sx) * 0.15, side, ex, ey];
        }
      }
    }
    const c = curve.map(v => Math.round(v * 10) / 10);
    const d = `M${c[0]},${c[1]} C${c[2]},${c[3]} ${c[4]},${c[5]} ${c[6]},${c[7]}`;
    const label = e.label ? placeLabel(curve, e.label) : '';
    return { path: `<path d="${d}" class="dg-edge dg-${e.style}"${e.arrow ? ` marker-end="url(#dg-arrow-${id})"` : ''}${e.both ? ` marker-start="url(#dg-arrow-${id})"` : ''}/>`, label };
  });

  const round = (v: number) => Math.round(v * 10) / 10;
  const [fullX, fullY] = vertical ? [Math.max(maxX, reach + PAD), maxY] : [maxX, Math.max(maxY, reach + PAD)];
  const [startX, startY] = vertical ? [Math.min(minX, reachMin - PAD), minY] : [minX, Math.min(minY, reachMin - PAD)];
  const svg = `<svg class="dg" viewBox="${round(startX)} ${round(startY)} ${round(fullX - startX)} ${round(fullY - startY)}" width="${round(fullX - startX)}" style="--dgw:${round(fullX - startX)}px" role="img" aria-label="${escapeXml(caption || 'Diagramme')}">
<defs><marker id="dg-arrow-${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="dg-head"/></marker></defs>
${frames.map(f => `<g class="dg-group"><rect x="${f.x0}" y="${f.y0}" width="${f.x1 - f.x0}" height="${f.y1 - f.y0}" rx="10"/></g>`).join('')}
${links.map(l => l.path).join('')}
${frames.filter(f => f.g.title).map(f => {
    // Le titre passe par-dessus les liens qui entrent dans le cadre, sur une pastille opaque
    const tw = textWidth(f.g.title.toUpperCase()) * 0.92 + 18;
    return `<g class="dg-gtitle"><rect x="${f.x0 + 8}" y="${f.y0 + 7}" width="${tw}" height="20" rx="10"/><text x="${f.x0 + 17}" y="${f.y0 + 17}">${escapeXml(f.g.title)}</text></g>`;
  }).join('')}
${all.map(n => `<g class="dg-n">${shape(n)}${text(n)}</g>`).join('')}
${links.map(l => l.label).join('')}
</svg>`;
  return `<figure class="diagram">${svg.replace(/\n/g, '')}${caption ? `<figcaption>${escapeXml(caption)}</figcaption>` : ''}</figure>`;
}
