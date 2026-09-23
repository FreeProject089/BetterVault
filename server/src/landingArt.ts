import { PHOSPHOR, type PhosphorName } from './phosphorIcons.ts';

/**
 * Éléments visuels des pages publiques (accueil, serveurs).
 *
 * Les icônes viennent de Phosphor (style duotone, licence MIT), sauf le coffre
 * de l'en-tête : « Money Safe Safebox » de wishforge.games (SVG Repo, licence
 * CC BY — crédité dans le pied de page). Tout est en SVG intégré et en CSS :
 * les pages n'exécutent aucun script et n'acceptent aucune image extérieure.
 * Les éléments interactifs (bascule, questions) reposent sur des boutons
 * radio et des <details>.
 *
 * Les couleurs viennent des variables de la page (`--accent`…), elles suivent
 * donc le thème clair ou sombre. Les mouvements s'arrêtent quand la personne
 * le demande.
 */

/** Coffre-fort — wishforge.games, CC BY (https://www.svgrepo.com/svg/384889/money-safe-safebox) */
const SAFE = '<path d="M28,3H4C2.3,3,1,4.3,1,6v18c0,1.7,1.3,3,3,3h24c1.7,0,3-1.3,3-3V6C31,4.3,29.7,3,28,3z M27,21c0,1.1-0.9,2-2,2H7c-1.1,0-2-0.9-2-2v-1c-0.6,0-1-0.4-1-1s0.4-1,1-1v-6c-0.6,0-1-0.4-1-1s0.4-1,1-1V9c0-1.1,0.9-2,2-2h18c1.1,0,2,0.9,2,2V21z"/><path d="M25,15c0-3.3-2.7-6-6-6H7v1c0.6,0,1,0.4,1,1s-0.4,1-1,1v6c0.6,0,1,0.4,1,1s-0.4,1-1,1v1h12C22.3,21,25,18.3,25,15L25,15z M19,18c-1.3,0-2.4-0.8-2.8-2H14c-0.6,0-1-0.4-1-1s0.4-1,1-1h2.2c0.4-1.2,1.5-2,2.8-2c1.7,0,3,1.3,3,3S20.7,18,19,18z"/><path d="M7,30H4c-0.6,0-1-0.4-1-1v-3c0-0.6,0.4-1,1-1h4c0.3,0,0.6,0.2,0.8,0.4C9,25.7,9.1,26,8.9,26.3l-1,3C7.8,29.7,7.4,30,7,30z"/><path d="M28,30h-3c-0.4,0-0.8-0.3-0.9-0.7l-1-3c-0.1-0.3-0.1-0.6,0.1-0.9c0.2-0.3,0.5-0.4,0.8-0.4h4c0.6,0,1,0.4,1,1v3C29,29.6,28.6,30,28,30z"/>';

export type IconName = PhosphorName | 'safe';

/** Icône seule, en currentColor */
export function icon(name: IconName, size = 24, label?: string): string {
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  if (name === 'safe') return `<svg class="ph" width="${size}" height="${size}" viewBox="0 0 32 32" fill="currentColor" ${a11y}>${SAFE}</svg>`;
  return `<svg class="ph" width="${size}" height="${size}" viewBox="0 0 256 256" fill="currentColor" ${a11y}>${PHOSPHOR[name]}</svg>`;
}

/** Icône dans sa tuile en relief */
export function tile(name: IconName, size: 'sm' | 'md' | 'lg' = 'md'): string {
  const px = size === 'lg' ? 34 : size === 'md' ? 24 : 18;
  return `<span class="tile tile-${size}">${icon(name, px)}</span>`;
}

/**
 * Visuel de l'en-tête : une fenêtre d'application stylisée, le coffre au
 * centre, et trois cartes qui flottent autour.
 */
export function heroArt(labels: { code: string; unlocked: string; synced: string }): string {
  return `<div class="hero-art" aria-hidden="true">
    <div class="glow"></div>
    <div class="window">
      <div class="window-bar"><i></i><i></i><i></i></div>
      <div class="window-body">
        <span class="safe">${icon('safe', 76)}</span>
        <div class="lines"><span></span><span></span><span class="short"></span></div>
      </div>
    </div>
    <div class="float float-a">${tile('password', 'sm')}<span><small>${labels.code}</small><b class="otp"><span>482</span> <span>913</span></b></span></div>
    <div class="float float-b">${tile('fingerprint', 'sm')}<span><small>${labels.unlocked}</small><b class="ok">●</b></span></div>
    <div class="float float-c">${tile('cloud', 'sm')}<span><small>${labels.synced}</small><b class="ok">✓</b></span></div>
  </div>`;
}

export interface SnakeStep { title: string; subtitle: string; text: string; art: string }

/**
 * « Comment ça marche » : les étapes, reliées par un ruban épais qui serpente
 * derrière les illustrations et change de couleur à chaque étape, avant de
 * se jeter dans le bandeau qui suit.
 *
 * Le ruban est un SVG étiré sur toute la hauteur (preserveAspectRatio="none") :
 * l'épaisseur reste fixe grâce à vector-effect. Il se dessine au défilement
 * là où le navigateur le permet, sinon il est simplement là.
 */
export function snakeSteps(steps: SnakeStep[], stepLabel: string): string {
  const n = steps.length;
  const colors = ['#6cb6f5', '#ffc62e', '#f05a5f', '#8b87f0'];
  // Chaque rangée : le ruban arrive au-dessus de l'illustration, en fait le
  // tour par le bord de la page, repasse dessous, puis traverse en diagonale
  // vers l'illustration suivante (de l'autre côté). La dernière boucle
  // descend se jeter dans le bandeau.
  const cx = (i: number) => (i % 2 === 0 ? 25 : 75);
  const seg = (i: number) => {
    const y0 = i * 100, y1 = y0 + 100;
    const c = cx(i), side = c < 50 ? -6 : 106;
    const loop = `M${c},${y0 + 4} C${side},${y0 + 2} ${side},${y0 + 90} ${c},${y0 + 92}`;
    if (i === n - 1) return `${loop} C${c + (50 - c) * 0.8},${y0 + 94} 50,${y1 + 4} 50,${y1 + 18}`;
    const c2 = cx(i + 1);
    return `${loop} C${c2},${y0 + 93} ${c2},${y1 - 6} ${c2},${y1 + 4}`;
  };
  const paths = steps.map((_, i) =>
    `<path d="${seg(i)}" stroke="${colors[i % colors.length]}" vector-effect="non-scaling-stroke"/>`).join('');
  return `<div class="snake" style="--rows:${n};--k:${((n * 100 + 18) / (n * 100)).toFixed(4)}">
    <svg class="snake-path" viewBox="0 0 100 ${n * 100 + 18}" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>
    <ol class="snake-steps">${steps.map((s, i) => `
      <li class="snake-step ${i % 2 === 0 ? 'art-left' : 'art-right'}" style="--c:${colors[i % colors.length]}">
        <div class="snake-art">${s.art}</div>
        <div class="snake-text">
          <span class="snake-num">${stepLabel} ${i + 1}</span>
          <h3>${s.title}</h3>
          <p class="snake-sub">${s.subtitle}</p>
          <p>${s.text}</p>
        </div>
      </li>`).join('')}
    </ol>
  </div>`;
}

/* ── Illustrations des étapes : de petites maquettes de l'application ── */

export function artAccount(l: { email: string; password: string; strong: string; button: string; chip: string }): string {
  return `<div class="mock mock-account" aria-hidden="true">
    <div class="mock-field"><small>${l.email}</small><span>marie@exemple.fr</span></div>
    <div class="mock-field"><small>${l.password}</small><span class="dots">••••••••••••••</span></div>
    <div class="meter"><i></i><i></i><i></i><i></i><em>${l.strong}</em></div>
    <div class="mock-btn">${l.button}</div>
    <div class="mock-chip">${icon('key', 16)}${l.chip}</div>
  </div>`;
}

/** Bascule interactive : ce que vous voyez / ce que voit le serveur */
export function artCipher(l: { you: string; server: string; rows: Array<[string, string]> }): string {
  return `<div class="mock mock-cipher">
    <input type="radio" name="vue" id="vue-moi" checked><input type="radio" name="vue" id="vue-serveur">
    <div class="seg"><label for="vue-moi">${l.you}</label><label for="vue-serveur">${l.server}</label></div>
    <ul>${l.rows.map(([site, user], i) => `
      <li><span class="fav">${site[0]}</span><span class="plain"><b>${site}</b><small>${user}</small></span><code class="cipher">${['9f2c·a81e·77d0·e4b3', 'c03a·5be1·f9d2·18aa', '6e7f·02cd·b4a9·3f51'][i % 3]}</code></li>`).join('')}
    </ul>
  </div>`;
}

export function artDevices(l: { synced: string }): string {
  return `<div class="mock mock-devices" aria-hidden="true">
    <div class="dev dev-laptop">${icon('devices', 34)}<span>Windows · macOS · Linux</span></div>
    <div class="dev dev-phone">${icon('password', 28)}<span>Android · iOS</span></div>
    <div class="dev dev-web">${icon('globe', 28)}<span>Web</span></div>
    <div class="sync-badge">${icon('sync', 18)}${l.synced}</div>
  </div>`;
}

export function artUnlock(l: { code: string; unlocked: string }): string {
  return `<div class="mock mock-unlock" aria-hidden="true">
    <div class="ring"><span>30s</span></div>
    <div class="unlock-card">
      <span class="tile tile-md">${icon('fingerprint', 24)}</span>
      <span><small>${l.code}</small><b class="otp">482 913</b></span>
    </div>
    <div class="unlock-ok">✓ ${l.unlocked}</div>
  </div>`;
}

/** Styles des pages publiques illustrées */
export const ART_CSS = `
.ph{display:block;flex:0 0 auto}
.tile{display:inline-grid;place-items:center;flex:0 0 auto;border-radius:14px;color:var(--accent);
  background:linear-gradient(150deg,color-mix(in srgb,var(--accent) 26%,var(--card)),color-mix(in srgb,var(--accent) 8%,var(--card)));
  border:1px solid color-mix(in srgb,var(--accent) 30%,var(--border));
  box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 10%,transparent),0 10px 24px -14px color-mix(in srgb,var(--accent) 80%,transparent)}
.tile-sm{width:34px;height:34px;border-radius:10px}
.tile-md{width:48px;height:48px}
.tile-lg{width:60px;height:60px;border-radius:16px}

/* En-tête : deux colonnes, texte à gauche, démonstration à droite */
.hero{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr);gap:40px;align-items:center;padding:72px 0 24px}
.hero-art{position:relative;height:380px}
.glow{position:absolute;inset:10% 8%;border-radius:50%;background:radial-gradient(closest-side,color-mix(in srgb,var(--accent) 38%,transparent),transparent);filter:blur(20px);opacity:.7}
.window{position:absolute;inset:40px 30px 40px 60px;border-radius:18px;background:var(--card);border:1px solid var(--border);
  box-shadow:0 30px 60px -30px rgba(0,0,0,.55);overflow:hidden;animation:rise 6s ease-in-out infinite}
.window-bar{display:flex;gap:6px;padding:12px 14px;border-bottom:1px solid var(--border)}
.window-bar i{width:9px;height:9px;border-radius:50%;background:var(--border)}
.window-body{display:flex;flex-direction:column;align-items:center;gap:22px;padding:30px 24px}
.safe{display:grid;place-items:center;width:124px;height:124px;border-radius:30px;color:var(--accent);
  background:radial-gradient(circle at 30% 20%,color-mix(in srgb,var(--accent) 30%,var(--card)),color-mix(in srgb,var(--accent) 8%,var(--card)));
  border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border));box-shadow:0 18px 40px -20px var(--accent)}
.lines{display:flex;flex-direction:column;gap:9px;width:70%}
.lines span{height:9px;border-radius:5px;background:color-mix(in srgb,var(--muted) 22%,transparent)}
.lines .short{width:55%}
.float{position:absolute;display:flex;align-items:center;gap:10px;padding:10px 14px 10px 10px;border-radius:14px;
  background:color-mix(in srgb,var(--card) 88%,transparent);border:1px solid var(--border);backdrop-filter:blur(8px);
  box-shadow:0 18px 40px -22px rgba(0,0,0,.6);font-size:13px}
.float small{display:block;color:var(--muted);font-size:11px;line-height:1.2}
.float b{font-size:15px;letter-spacing:.02em}
.ok{color:#3fb950}
.otp{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.float-a{top:18px;left:0;animation:rise 5s ease-in-out infinite .4s}
.float-b{bottom:34px;left:14px;animation:rise 5.6s ease-in-out infinite 1.2s}
.float-c{top:54%;right:0;animation:rise 6.2s ease-in-out infinite .8s}
@keyframes rise{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}

.trust{display:flex;flex-wrap:wrap;gap:10px 22px;margin:22px 0 0;padding:0;list-style:none;color:var(--muted);font-size:14px}
.trust li{display:inline-flex;align-items:center;gap:8px}
.trust .ph{color:var(--accent)}

/* Fonctions */
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;padding:0;margin:28px 0 0;list-style:none}
.features li{display:flex;flex-direction:column;gap:12px;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:20px;
  transition:border-color .2s ease,transform .2s ease,box-shadow .2s ease}
.features li:hover{border-color:color-mix(in srgb,var(--accent) 55%,var(--border));transform:translateY(-3px);box-shadow:0 18px 40px -26px var(--accent)}
.features h3{margin:0}
.features p{margin:0;color:var(--muted);font-size:14.5px}

/* Serpent des étapes */
.snake{position:relative;margin:36px 0 0}
.snake-path{position:absolute;left:0;top:0;width:100%;height:calc(100% * var(--k));overflow:visible;pointer-events:none}
.snake-path path{fill:none;stroke-width:26px;stroke-linecap:round}
.snake-steps{position:relative;list-style:none;margin:0;padding:0;display:grid;grid-template-rows:repeat(var(--rows),minmax(340px,auto))}
.snake-step{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:56px}
.snake-step.art-right .snake-art{order:2}
.snake-art{display:flex;justify-content:center;position:relative;z-index:1}
.snake-text{position:relative;z-index:1;max-width:44ch;padding:18px 20px}
.snake-step.art-right .snake-text{justify-self:end}
.snake-num{display:inline-block;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--c);
  padding:3px 10px;border-radius:999px;background:color-mix(in srgb,var(--c) 16%,transparent)}
.snake-text h3{font-size:clamp(24px,3vw,32px);letter-spacing:-.02em;line-height:1.15;margin:12px 0 6px}
.snake-sub{color:var(--accent);font-weight:600;margin:0 0 10px}
.snake-text p:last-child{color:var(--muted);margin:0}

/* Maquettes */
.mock{position:relative;width:min(340px,100%);padding:20px;border-radius:20px;background:var(--card);border:1px solid var(--border);
  box-shadow:0 30px 60px -32px rgba(0,0,0,.55),0 0 0 6px color-mix(in srgb,var(--card) 60%,transparent)}
.mock-field{display:flex;flex-direction:column;gap:2px;padding:9px 12px;margin-bottom:10px;border-radius:10px;border:1px solid var(--border);background:var(--bg);font-size:14px}
.mock-field small{color:var(--muted);font-size:11px}
.dots{letter-spacing:.12em}
.meter{display:flex;align-items:center;gap:5px;margin:2px 0 14px}
.meter i{flex:1;height:5px;border-radius:3px;background:#3fb950;animation:fill 2.4s ease-out infinite}
.meter i:nth-child(2){animation-delay:.15s}.meter i:nth-child(3){animation-delay:.3s}.meter i:nth-child(4){animation-delay:.45s}
.meter em{font-style:normal;font-size:11.5px;color:#3fb950;font-weight:600;margin-left:6px}
@keyframes fill{0%{opacity:.2}30%,100%{opacity:1}}
.mock-btn{display:grid;place-items:center;height:40px;border-radius:10px;background:var(--accent);color:#fff;font-weight:600;font-size:14px}
.mock-chip{position:absolute;right:-18px;bottom:-18px;display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:12px;
  background:var(--card);border:1px solid var(--border);font-size:12.5px;font-weight:600;color:var(--accent);box-shadow:0 14px 30px -18px rgba(0,0,0,.6);animation:rise 5s ease-in-out infinite}

.mock-cipher>input{position:absolute;opacity:0;pointer-events:none}
.seg{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;margin-bottom:12px;border-radius:12px;background:var(--bg);border:1px solid var(--border)}
.seg label{display:grid;place-items:center;min-height:36px;border-radius:9px;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer;transition:background-color .2s,color .2s}
#vue-moi:checked~.seg label[for=vue-moi],#vue-serveur:checked~.seg label[for=vue-serveur]{background:var(--card);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.25)}
#vue-moi:focus-visible~.seg label[for=vue-moi],#vue-serveur:focus-visible~.seg label[for=vue-serveur]{outline:2px solid var(--accent)}
.mock-cipher ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.mock-cipher li{position:relative;display:flex;align-items:center;gap:10px;min-height:48px;padding:8px 10px;border-radius:12px;border:1px solid var(--border);background:var(--bg)}
.fav{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:color-mix(in srgb,var(--accent) 20%,var(--card));color:var(--accent);font-weight:700;font-size:13px;flex:0 0 auto}
.plain{display:flex;flex-direction:column;line-height:1.25;font-size:13.5px;transition:opacity .25s,transform .25s}
.plain small{color:var(--muted);font-size:12px}
.cipher{position:absolute;left:50px;right:10px;top:50%;transform:translateY(-50%) scale(.96);opacity:0;font:600 12.5px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#f0883e;transition:opacity .25s,transform .25s;white-space:nowrap;overflow:hidden}
#vue-serveur:checked~ul .plain{opacity:0;transform:translateX(-6px)}
#vue-serveur:checked~ul .cipher{opacity:1;transform:translateY(-50%)}
#vue-serveur:checked~ul .fav{background:color-mix(in srgb,#f0883e 18%,var(--card));color:#f0883e}

.mock-devices{display:grid;grid-template-columns:1.3fr 1fr;grid-template-rows:auto auto;gap:10px}
.dev{display:flex;flex-direction:column;align-items:flex-start;gap:10px;padding:14px;border-radius:14px;border:1px solid var(--border);background:var(--bg);color:var(--accent)}
.dev span{color:var(--muted);font-size:12px}
.dev-laptop{grid-row:1/3;justify-content:space-between}
.sync-badge{position:absolute;left:50%;bottom:-16px;transform:translateX(-50%);display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;
  background:#3fb950;color:#fff;font-size:12.5px;font-weight:700;box-shadow:0 12px 26px -12px #3fb950;white-space:nowrap}
.sync-badge .ph{animation:spin 2.4s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

.mock-unlock{display:flex;flex-direction:column;align-items:center;gap:14px;padding-top:28px}
.ring{position:absolute;top:-26px;right:-18px;width:78px;height:78px;border-radius:50%;display:grid;place-items:center;background:var(--card);
  box-shadow:0 14px 30px -16px rgba(0,0,0,.6)}
.ring::before{content:"";position:absolute;inset:6px;border-radius:50%;background:conic-gradient(var(--accent) var(--p,75%),color-mix(in srgb,var(--muted) 18%,transparent) 0);
  -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 7px),#000 calc(100% - 6px));mask:radial-gradient(farthest-side,transparent calc(100% - 7px),#000 calc(100% - 6px));animation:count 30s linear infinite}
.ring span{position:relative;font-weight:800;font-size:15px}
@property --p{syntax:"<percentage>";inherits:false;initial-value:100%}
@keyframes count{from{--p:100%}to{--p:0%}}
.unlock-card{display:flex;align-items:center;gap:12px;width:100%;padding:12px;border-radius:14px;border:1px solid var(--border);background:var(--bg)}
.unlock-card small{display:block;color:var(--muted);font-size:11.5px}
.unlock-card b{font-size:22px;letter-spacing:.06em}
.unlock-ok{align-self:stretch;text-align:center;padding:9px;border-radius:10px;background:color-mix(in srgb,#3fb950 14%,transparent);color:#3fb950;font-weight:700;font-size:13.5px}

/* Bandeau qui reçoit le ruban */
.band{position:relative;margin:60px calc(50% - 50vw) 0;padding:72px 20px;background:linear-gradient(120deg,#2b1f9e,#4a3ad1 60%,#5b4ee6);color:#fff;overflow:hidden}
.band::before{content:"";position:absolute;inset:0;background:radial-gradient(600px 300px at 85% 0%,rgba(255,255,255,.14),transparent 70%)}
.band-in{position:relative;max-width:1120px;margin:0 auto;display:grid;grid-template-columns:auto 1fr;gap:36px;align-items:center}
.band .safe{width:132px;height:132px;color:#fff;background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.25);box-shadow:0 20px 50px -20px rgba(0,0,0,.5)}
.band h2{color:#fff;font-size:clamp(26px,3.6vw,38px);margin:0 0 8px}
.band p{margin:0 0 22px;color:rgba(255,255,255,.82);max-width:60ch}
.band .btn{background:#fff;border-color:#fff;color:#2b1f9e}
.band .btn:hover{filter:brightness(.95)}

/* Questions */
.faq{display:flex;flex-direction:column;gap:10px;margin:24px 0 0;max-width:820px}
.faq details{border:1px solid var(--border);border-radius:14px;background:var(--card);transition:border-color .2s}
.faq details[open]{border-color:color-mix(in srgb,var(--accent) 50%,var(--border))}
.faq summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:56px;padding:0 18px;cursor:pointer;font-weight:600}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";font-size:22px;font-weight:400;color:var(--accent);transition:transform .2s}
.faq details[open] summary::after{transform:rotate(45deg)}
.faq details p{margin:0;padding:0 18px 16px;color:var(--muted)}

/* Apparition au défilement, sans script, là où le navigateur le permet */
@supports (animation-timeline:view()){
  .features li,.facts li{animation:appear linear both;animation-timeline:view();animation-range:entry 0% entry 55%}
  .snake-art,.snake-text{animation:appear linear both;animation-timeline:view();animation-range:entry 5% entry 60%}
  .snake-path{animation:draw linear both;animation-timeline:--snake;animation-range:entry 10% exit 0%}
  .snake{view-timeline-name:--snake}
  @keyframes appear{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
  @keyframes draw{from{clip-path:inset(0 0 100% 0)}to{clip-path:inset(0 0 -10% 0)}}
}

@media (max-width:860px){
  .hero{grid-template-columns:1fr;gap:8px;padding-top:40px}
  .hero-art{height:300px;order:-1}
  .window{inset:30px 24px 30px 44px}
  .safe{width:100px;height:100px}
  .snake-path{display:none}
  .snake-steps{grid-template-rows:none;gap:28px;padding-left:26px;border-left:0}
  .snake-steps::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:8px;border-radius:8px;background:linear-gradient(#6cb6f5,#ffc62e,#f05a5f,#8b87f0)}
  .snake-step{grid-template-columns:1fr;gap:18px}
  .snake-step.art-right .snake-art{order:0}
  .snake-art{justify-content:flex-start}
  .snake-text{padding:0;background:none;backdrop-filter:none}
  .band-in{grid-template-columns:1fr;gap:20px}
  .band .safe{width:96px;height:96px}
}
@media (max-width:420px){.float{font-size:12px}.float-c{display:none}.mock-chip{right:-6px}.ring{right:-6px}}

@media (prefers-reduced-motion:reduce){
  .window,.float,.features li,.facts li,.snake-art,.snake-text,.snake-path,.meter i,.mock-chip,.sync-badge .ph,.ring::before{animation:none!important}
  .features li:hover{transform:none}
}
`;
