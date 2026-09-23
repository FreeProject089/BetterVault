/**
 * Fond de carte de l'administration : les terres émergées, en un seul tracé SVG.
 *
 * Source : world-atlas 2.0.2, land-110m.json (Natural Earth, domaine public ;
 * world-atlas sous licence ISC). Le fichier TopoJSON est converti une fois
 * pour toutes en un chemin SVG, en projection équirectangulaire (x = longitude,
 * y = latitude) : l'administration n'a ni dépendance à charger ni requête
 * extérieure à faire, et place un serveur avec la même formule.
 *
 * Usage : node scripts/build-world-map.mjs chemin/vers/land-110m.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source) throw new Error('Indiquez le fichier land-110m.json');
const topo = JSON.parse(readFileSync(source, 'utf8'));

// Largeur 360 × hauteur 180 : une unité par degré. On coupe l'Antarctique (sous -58°).
const W = 360, TOP = 84, BOTTOM = -58;
const [sx, sy] = topo.transform.scale;
const [tx, ty] = topo.transform.translate;

// Arcs quantifiés et codés en différences : on les décode en longitude / latitude
const arcs = topo.arcs.map(arc => {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; });
});
const arcPoints = i => (i >= 0 ? arcs[i] : [...arcs[~i]].reverse());

const project = ([lon, lat]) => [lon + 180, TOP - lat];
const fmt = n => (Math.round(n * 10) / 10).toString();

let d = '';
for (const geometry of topo.objects.land.geometries) {
  const polygons = geometry.type === 'Polygon' ? [geometry.arcs] : geometry.arcs;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      const raw = ring.flatMap((arc, k) => arcPoints(arc).slice(k ? 1 : 0));
      if (raw.every(([, lat]) => lat < BOTTOM)) continue;
      /*
       * Une terre à cheval sur l'antiméridien (Tchoukotka, Fidji) saute d'un
       * bord à l'autre : on « déroule » les longitudes pour garder un contour
       * continu, qui dépasse alors d'un côté, et on en dessine une copie
       * décalée d'un tour pour l'autre bord. Sans cela, le remplissage
       * inondait toute la carte.
       */
      const points = [];
      for (const [lon, lat] of raw) {
        let l = lon;
        const prev = points.at(-1);
        if (prev) while (l - prev[0] > 180) l -= 360;
        if (prev) while (prev[0] - l > 180) l += 360;
        points.push([l, lat]);
      }
      const xs = points.map(([lon]) => lon);
      const shifts = [0];
      if (Math.min(...xs) < -180) shifts.push(360);
      if (Math.max(...xs) > 180) shifts.push(-360);
      for (const shift of shifts) {
        let last = '';
        let path = '';
        for (const [i, [lon, lat]] of points.entries()) {
          const [x, y] = project([lon + shift, lat]);
          const seg = `${fmt(x)},${fmt(Math.min(y, TOP - BOTTOM))}`;
          if (seg === last) continue;
          path += (i === 0 ? 'M' : 'L') + seg;
          last = seg;
        }
        d += `${path}Z`;
      }
    }
  }
}

const out = `/**
 * Terres émergées pour la carte de l'administration — produit par
 * scripts/build-world-map.mjs, ne pas modifier à la main.
 *
 * Source : world-atlas 2.0.2 (land-110m), données Natural Earth (domaine public).
 * world-atlas : Copyright 2013-2019 Michael Bostock, licence ISC.
 *
 * Projection équirectangulaire : x = longitude + 180, y = ${TOP} − latitude,
 * dans une vue de ${W} × ${TOP - BOTTOM}.
 */
export const WORLD_VIEW = { width: ${W}, height: ${TOP - BOTTOM}, top: ${TOP} };
export const WORLD_LAND = ${JSON.stringify(d)};
`;
writeFileSync(join(root, 'server/admin/world-land.js'), out);
console.log(`Carte écrite : ${(out.length / 1024).toFixed(1)} Ko`);
