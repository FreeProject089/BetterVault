/**
 * Illustrations de la page d'accueil : icônes 2,5D et petites animations.
 *
 * Tout est dessiné ici, en SVG intégré à la page, et animé en CSS pur :
 * - la page n'exécute aucun script (sa politique de sécurité l'interdit) ;
 * - elle n'accepte aucune image venue d'ailleurs ;
 * - aucune licence d'icône à suivre, et le rendu reste net à toute taille.
 *
 * Le principe 2,5D : une dalle isométrique (dessus clair, deux flancs plus
 * sombres) sur laquelle un pictogramme 2D est couché par une transformation
 * isométrique. Un seul gabarit, donc huit icônes du même style.
 *
 * Les couleurs viennent des variables de la page (`--accent`…) : les
 * illustrations suivent le thème clair ou sombre sans rien dupliquer.
 * Quand la personne demande moins de mouvement, tout s'arrête.
 */

/** Pictogrammes 24 × 24, en traits : ils seront couchés sur la dalle */
const GLYPHS: Record<string, string> = {
  key: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M21 12v2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  devices: '<rect x="3" y="5" width="13" height="10" rx="1.5"/><rect x="17.5" y="9" width="4.5" height="10" rx="1"/><path d="M7 19h5"/>',
  sync: '<path d="M4 12a8 8 0 0 1 14-5M18 3v4h-4M20 12a8 8 0 0 1-14 5M6 21v-4h4"/>',
  files: '<path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5"/>',
  share: '<circle cx="9" cy="9" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5M15 15c3 0 6 1.5 6 4"/>',
  securityKey: '<rect x="3" y="9" width="12" height="6" rx="2"/><circle cx="7" cy="12" r="1.3"/><path d="M15 12h6M19 12v2.5"/>',
  export: '<path d="M12 3v11M8 10l4 4 4-4M4 16v4h16v-4"/>',
  server: '<rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/><path d="M8 7h.01M8 17h.01"/>'
};

export type GlyphName = keyof typeof GLYPHS;

/*
 * Géométrie de la dalle, pour une vue de 72 × 64.
 * Le pictogramme de 24 unités est couché par une matrice isométrique :
 * l'axe x part vers la droite et le bas, l'axe y vers la gauche et le bas.
 */
const U = 0.996; // cos 30° × échelle
const V = 0.575; // sin 30° × échelle
const CX = 36;
const TOP = 10;
const SIDE = 8; // épaisseur de la dalle

const pt = (x: number, y: number) => `${(CX + (x - y) * U).toFixed(1)},${(TOP + (x + y) * V).toFixed(1)}`;

/** Une icône 2,5D : dalle isométrique, pictogramme couché dessus, ombre portée */
export function isoIcon(name: GlyphName, options: { size?: number; delay?: number; label?: string } = {}): string {
  const size = options.size ?? 72;
  const T = pt(0, 0);
  const R = pt(24, 0);
  const B = pt(24, 24);
  const L = pt(0, 24);
  const down = (p: string) => p.replace(/,([\d.]+)$/, (_, y) => `,${(Number(y) + SIDE).toFixed(1)}`);
  const title = options.label ? `<title>${options.label}</title>` : '';
  // Cadrage serré sur la dalle et son ombre : pas de marge perdue autour
  return `<svg class="iso" width="${size}" height="${Math.round(size * 56 / 52)}" viewBox="10 5 52 56" ${options.label ? 'role="img"' : 'aria-hidden="true"'} style="--delay:${options.delay ?? 0}s">${title}
    <ellipse class="iso-shadow" cx="36" cy="57" rx="21" ry="4"/>
    <g class="iso-body">
      <polygon class="iso-left" points="${L} ${B} ${down(B)} ${down(L)}"/>
      <polygon class="iso-right" points="${B} ${R} ${down(R)} ${down(B)}"/>
      <polygon class="iso-top" points="${T} ${R} ${B} ${L}"/>
      <g class="iso-glyph" transform="matrix(${U} ${V} ${-U} ${V} ${CX} ${TOP})">${GLYPHS[name]}</g>
    </g>
  </svg>`;
}

/**
 * Coffre-fort isométrique de l'en-tête : un cube, sa porte ronde, et deux
 * dalles qui flottent autour (une clé, un cadenas).
 */
export function heroArt(label: string): string {
  // Cube : 3 faces vues de trois quarts
  const c = { x: 150, y: 60, w: 96, h: 96 };
  const dx = c.w * 0.866;
  const dy = c.w * 0.5;
  const top = `${c.x},${c.y} ${c.x + dx},${c.y + dy} ${c.x},${c.y + 2 * dy} ${c.x - dx},${c.y + dy}`;
  const left = `${c.x - dx},${c.y + dy} ${c.x},${c.y + 2 * dy} ${c.x},${c.y + 2 * dy + c.h} ${c.x - dx},${c.y + dy + c.h}`;
  const right = `${c.x},${c.y + 2 * dy} ${c.x + dx},${c.y + dy} ${c.x + dx},${c.y + dy + c.h} ${c.x},${c.y + 2 * dy + c.h}`;
  // Centre de la porte, au milieu de la face droite
  const px = c.x + dx / 2;
  const py = c.y + 1.5 * dy + c.h / 2;
  return `<div class="hero-art" role="img" aria-label="${label}">
    <svg viewBox="0 0 300 300" aria-hidden="true">
      <defs>
        <linearGradient id="hero-top" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="var(--accent)" stop-opacity=".55"/>
          <stop offset="1" stop-color="var(--accent)" stop-opacity=".25"/>
        </linearGradient>
      </defs>
      <ellipse class="hero-shadow" cx="150" cy="276" rx="104" ry="14"/>
      <g class="hero-vault">
        <polygon class="vault-left" points="${left}"/>
        <polygon class="vault-right" points="${right}"/>
        <polygon points="${top}" fill="url(#hero-top)" class="vault-top"/>
        <!-- Porte : une ellipse inclinée comme la face qui la porte -->
        <g transform="translate(${px} ${py}) matrix(0.866 -0.5 0 1 0 0)">
          <circle class="vault-door" r="30"/>
          <circle class="vault-ring" r="22"/>
          <g class="vault-dial">
            <circle r="8"/>
            <path d="M0 -22v8M0 14v8M-22 0h8M14 0h8"/>
          </g>
        </g>
      </g>
      <g class="hero-chip chip-a" transform="translate(28 44)">${chip('key')}</g>
      <g class="hero-chip chip-b" transform="translate(214 150)">${chip('lock')}</g>
      <g class="hero-spark"><circle cx="248" cy="58" r="3"/><circle cx="40" cy="190" r="2.5"/><circle cx="262" cy="96" r="1.8"/></g>
    </svg>
  </div>`;
}

/** Petite dalle pour l'illustration de l'en-tête (même géométrie, à l'échelle) */
function chip(name: GlyphName): string {
  const T = pt(0, 0);
  const R = pt(24, 0);
  const B = pt(24, 24);
  const L = pt(0, 24);
  const down = (p: string) => p.replace(/,([\d.]+)$/, (_, y) => `,${(Number(y) + SIDE).toFixed(1)}`);
  return `<g transform="scale(.8)">
    <polygon class="iso-left" points="${L} ${B} ${down(B)} ${down(L)}"/>
    <polygon class="iso-right" points="${B} ${R} ${down(R)} ${down(B)}"/>
    <polygon class="iso-top" points="${T} ${R} ${B} ${L}"/>
    <g class="iso-glyph" transform="matrix(${U} ${V} ${-U} ${V} ${CX} ${TOP})">${GLYPHS[name]}</g>
  </g>`;
}

/**
 * Le trajet des données, en trois dalles : l'appareil chiffre, un bloc
 * illisible voyage, le serveur le range. Le pointillé avance pour montrer
 * le sens ; le bloc qui voyage porte un cadenas.
 */
export function flowArt(labels: [string, string, string]): string {
  return `<div class="flow" role="img" aria-label="${labels.join(' → ')}">
    <div class="flow-step">${isoIcon('devices', { size: 84 })}<span>${labels[0]}</span></div>
    <div class="flow-link" aria-hidden="true"><span class="flow-packet">${isoIcon('lock', { size: 36 })}</span></div>
    <div class="flow-step">${isoIcon('lock', { size: 84, delay: 0.4 })}<span>${labels[1]}</span></div>
    <div class="flow-link" aria-hidden="true"><span class="flow-packet" style="animation-delay:1.1s">${isoIcon('lock', { size: 36 })}</span></div>
    <div class="flow-step">${isoIcon('server', { size: 84, delay: 0.8 })}<span>${labels[2]}</span></div>
  </div>`;
}

/** Styles des illustrations : couleurs du thème, mouvements doux, arrêt si demandé */
export const ART_CSS = `
.iso{display:block;overflow:visible}
.iso-top{fill:color-mix(in srgb,var(--accent) 34%,var(--card))}
.iso-left{fill:color-mix(in srgb,var(--accent) 58%,#000)}
.iso-right{fill:color-mix(in srgb,var(--accent) 44%,#000)}
.iso-glyph{fill:none;stroke:#fff;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.iso-shadow{fill:#000;opacity:.22}
.iso-body{animation:iso-float 4.2s ease-in-out infinite;animation-delay:var(--delay,0s)}
@keyframes iso-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
/* En clair, le dessus de la dalle est pâle : un trait blanc y disparaîtrait */
@media (prefers-color-scheme:light){.iso-glyph{stroke:color-mix(in srgb,var(--accent) 70%,#000)}.iso-shadow{opacity:.12}}

.hero-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:24px;align-items:center}
.hero-art svg{width:100%;height:auto;max-width:360px;display:block;margin:0 auto;overflow:visible}
.vault-top{stroke:color-mix(in srgb,var(--accent) 60%,transparent);stroke-width:1}
.vault-left{fill:color-mix(in srgb,var(--accent) 30%,var(--card))}
.vault-right{fill:color-mix(in srgb,var(--accent) 18%,var(--card))}
.vault-door{fill:var(--card);stroke:color-mix(in srgb,var(--accent) 70%,transparent);stroke-width:2}
.vault-ring{fill:none;stroke:var(--border);stroke-width:2;stroke-dasharray:3 5}
.vault-dial{fill:var(--accent);stroke:var(--accent);stroke-width:3;stroke-linecap:round;transform-box:fill-box;transform-origin:center;animation:dial 9s cubic-bezier(.6,0,.4,1) infinite}
@keyframes dial{0%,12%{transform:rotate(0)}30%,42%{transform:rotate(110deg)}62%,74%{transform:rotate(-40deg)}100%{transform:rotate(0)}}
.hero-vault{animation:iso-float 6s ease-in-out infinite}
.hero-shadow{fill:#000;opacity:.25}
.hero-chip{animation:chip-a 5s ease-in-out infinite}
.chip-b{animation-name:chip-b;animation-duration:5.6s}
@keyframes chip-a{0%,100%{transform:translate(28px,44px)}50%{transform:translate(28px,34px)}}
@keyframes chip-b{0%,100%{transform:translate(214px,150px)}50%{transform:translate(214px,160px)}}
.hero-spark circle{fill:var(--accent);animation:spark 3s ease-in-out infinite}
.hero-spark circle:nth-child(2){animation-delay:1s}.hero-spark circle:nth-child(3){animation-delay:2s}
@keyframes spark{0%,100%{opacity:.15}50%{opacity:.9}}

.features.illustrated li{display:flex;flex-direction:column;gap:10px}
.features.illustrated .iso{margin:-4px 0 0 -6px}
.features.illustrated li{transition:border-color .2s ease,transform .2s ease}
.features.illustrated li:hover{border-color:color-mix(in srgb,var(--accent) 60%,var(--border));transform:translateY(-2px)}

.flow{display:grid;grid-template-columns:auto minmax(24px,1fr) auto minmax(24px,1fr) auto;align-items:center;gap:6px;margin:24px 0 8px}
.flow-step{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;font-size:13px;color:var(--muted);max-width:140px}
.flow-link{position:relative;height:2px;background:repeating-linear-gradient(90deg,var(--border) 0 6px,transparent 6px 12px);background-size:12px 2px;animation:dash 1s linear infinite}
@keyframes dash{to{background-position:12px 0}}
.flow-packet{position:absolute;top:-22px;left:0;animation:packet 2.2s ease-in-out infinite}
@keyframes packet{0%{left:0;opacity:0}15%{opacity:1}85%{opacity:1}100%{left:calc(100% - 36px);opacity:0}}

/* Apparition au défilement, seulement là où le navigateur sait le faire sans script */
@supports (animation-timeline:view()){
  .features.illustrated li,.flow{animation:appear linear both;animation-timeline:view();animation-range:entry 0% entry 60%}
  @keyframes appear{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
}

@media (max-width:760px){
  .hero-grid{grid-template-columns:1fr}
  .hero-art{order:-1}
  .hero-art svg{max-width:220px}
  .flow{grid-template-columns:1fr;justify-items:center}
  .flow-link{width:2px;height:28px;background:repeating-linear-gradient(180deg,var(--border) 0 6px,transparent 6px 12px);animation:none}
  .flow-packet{display:none}
}

@media (prefers-reduced-motion:reduce){
  .iso-body,.hero-vault,.hero-chip,.vault-dial,.hero-spark circle,.flow-link,.flow-packet,.features.illustrated li,.flow{animation:none!important}
  .features.illustrated li:hover{transform:none}
}
`;
