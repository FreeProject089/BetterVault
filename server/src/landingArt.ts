import { PHOSPHOR, type PhosphorName } from './phosphorIcons.ts';

/**
 * Éléments visuels des pages publiques (accueil, tarifs, serveurs).
 *
 * Les icônes viennent de Phosphor (style duotone, licence MIT), sauf le coffre :
 * « Money Safe Safebox » de wishforge.games (SVG Repo, licence CC BY — crédité
 * dans le pied de page). Tout est en SVG intégré et en CSS ; /site.js ajoute
 * l'interactivité (force du mot de passe, code 2FA qui tourne, apparitions),
 * mais chaque élément reste lisible sans lui.
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
export function tile(name: IconName, size: 'sm' | 'md' = 'md'): string {
  const px = size === 'md' ? 24 : 18;
  return `<span class="tile tile-${size}">${icon(name, px)}</span>`;
}

/* ── Traits à main levée ───────────────────────────────────────────────
   Des tracés volontairement irréguliers (bords qui bavent, épaisseur qui
   varie) : un surligneur ou un stylo, pas un rectangle parfait. */

/** Coup de surligneur derrière un mot ou une expression */
export function highlight(html: string, color = 'accent'): string {
  return `<span class="hl hl-${color}"><svg class="hl-brush" viewBox="0 0 400 60" preserveAspectRatio="none" aria-hidden="true"><path d="M6 20c28-7 70-9 118-8 60 1 108-4 170-3 38 1 70 0 96 4 3 6 2 12-2 19 4 6 3 14-3 20-40 5-96 3-150 5-64 2-120 1-176 1-22 0-40-1-54-4-4-5-2-11 1-17-4-5-4-12 0-17z"/><path class="hl-tail" d="M384 12c6 2 10 4 11 8-2 3-6 5-11 5" /></svg><span class="hl-text">${html}</span></span>`;
}

/** Trait de stylo sous un mot */
export function underline(html: string, color = 'blue'): string {
  return `<span class="ul ul-${color}"><span class="ul-text">${html}</span><svg class="ul-line" viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden="true"><path d="M3 12c30-6 62-8 96-7 36 1 66 2 98-2-30 7-66 9-100 9-32 0-62 1-92 5z"/></svg></span>`;
}

/** Cercle tracé à la main autour d'un mot */
export function circled(html: string): string {
  return `<span class="ci"><span class="ci-text">${html}</span><svg class="ci-loop" viewBox="0 0 200 80" preserveAspectRatio="none" aria-hidden="true"><path d="M150 10C118 2 50 4 22 20 2 32 6 58 40 68c38 11 108 9 138-6 22-11 20-34-6-47-24-12-72-14-110-8"/></svg></span>`;
}

/**
 * Visuel de l'en-tête : une fenêtre d'application stylisée, le coffre au
 * centre, et trois cartes qui flottent autour. La carte du déverrouillage
 * passe d'une méthode à l'autre (empreinte, visage, clé de sécurité).
 */
export function heroArt(labels: { code: string; synced: string; unlock: [string, string, string] }): string {
  const methods: Array<[IconName, string]> = [['fingerprint', labels.unlock[0]], ['face', labels.unlock[1]], ['usb', labels.unlock[2]]];
  return `<div class="hero-art" aria-hidden="true">
    <div class="glow"></div>
    <div class="window">
      <div class="window-bar"><i></i><i></i><i></i></div>
      <div class="window-body">
        <span class="safe">${icon('safe', 76)}</span>
        <div class="lines"><span></span><span></span><span class="short"></span></div>
      </div>
    </div>
    <div class="float float-a">${tile('password', 'sm')}<span><small>${labels.code}</small><b class="otp" data-otp>482 913</b></span></div>
    <div class="float float-b"><span class="cycle">${methods.map(([ic, text], i) =>
      `<span class="cycle-item" style="--i:${i}">${tile(ic, 'sm')}<span><small>${text}</small><b class="ok">●</b></span></span>`).join('')}</span></div>
    <div class="float float-c">${tile('cloud', 'sm')}<span><small>${labels.synced}</small><b class="ok">✓</b></span></div>
  </div>`;
}

/* ── Fonctionnalités : le coffre ouvert ─────────────────────────────────
   Un coffre-fort à deux battants : fermé, on voit la molette et le volant ;
   à son arrivée à l'écran, les battants pivotent sur leurs gonds et
   découvrent les casiers, un par fonction. Chaque casier mène à sa page de
   documentation. */
export function vaultFeatures(items: Array<{ icon: IconName; title: string; text: string; href: string }>, more: string): string {
  return `<div class="vault" data-vault>
    <div class="vault-frame">
      <span class="rivet r1"></span><span class="rivet r2"></span><span class="rivet r3"></span><span class="rivet r4"></span>
      <div class="vault-opening">
        <div class="vault-light" aria-hidden="true"></div>
        <ul class="vault-inner">${items.map((f, i) => `
          <li style="--i:${i}"><a class="locker" href="${f.href}">${tile(f.icon, 'md')}<h3>${f.title}</h3><p>${f.text}</p><span class="locker-more">${more}<span aria-hidden="true">→</span></span></a></li>`).join('')}
        </ul>
        <div class="door door-l" aria-hidden="true">
          <div class="door-face"><span class="door-bolts"></span><div class="dial"><span class="dial-ticks"></span><span class="dial-knob">${icon('safe', 34)}</span></div></div>
          <div class="door-edge"></div>
          <div class="door-back"><i></i><i></i><i></i><i></i></div>
        </div>
        <div class="door door-r" aria-hidden="true">
          <div class="door-face"><span class="door-bolts"></span><div class="wheel"><i></i><i></i><i></i><span></span></div></div>
          <div class="door-edge"></div>
          <div class="door-back"><i></i><i></i><i></i><i></i></div>
        </div>
      </div>
    </div>
    <div class="vault-feet"><i></i><i></i></div>
  </div>`;
}

export interface SnakeStep { title: string; subtitle: string; text: string; art: string }

/**
 * « Comment ça marche » : les étapes, reliées par un seul ruban continu qui
 * serpente derrière les illustrations — sa couleur change d'une étape à
 * l'autre par un dégradé — avant de se jeter dans le bandeau qui suit.
 *
 * Deux tracés : un large sur ordinateur (le ruban contourne chaque
 * illustration), un étroit sur téléphone (il ondule dans la marge gauche).
 * preserveAspectRatio="none" étire le SVG sur toute la hauteur ; l'épaisseur
 * reste fixe grâce à vector-effect.
 */
export function snakeSteps(steps: SnakeStep[], stepLabel: string): string {
  const n = steps.length;
  const colors = ['#6cb6f5', '#ffc62e', '#f05a5f', '#8b87f0'];
  const H = n * 100 + 18;
  const cx = (i: number) => (i % 2 === 0 ? 25 : 75);
  let d = '';
  for (let i = 0; i < n; i++) {
    const y0 = i * 100, y1 = y0 + 100;
    const c = cx(i), side = c < 50 ? -6 : 106;
    d += `${i === 0 ? `M${c},${y0 + 4}` : ''} C${side},${y0 + 2} ${side},${y0 + 90} ${c},${y0 + 92}`;
    d += i === n - 1
      ? ` C${c + (50 - c) * 0.8},${y0 + 94} 50,${y1 + 4} 50,${H}`
      : ` C${cx(i + 1)},${y0 + 93} ${cx(i + 1)},${y1 - 6} ${cx(i + 1)},${y1 + 4}`;
  }
  // Téléphone : une ondulation dans la marge, une boucle par étape
  let m = 'M50,0';
  for (let i = 0; i < n; i++) {
    const y0 = i * 100;
    m += ` C92,${y0 + 14} 92,${y0 + 36} 50,${y0 + 50} C8,${y0 + 64} 8,${y0 + 86} 50,${y0 + 100}`;
  }
  m += ` L50,${H}`;
  const stops = colors.slice(0, n).map((col, i) => `<stop offset="${((i + 0.5) / n).toFixed(3)}" stop-color="${col}"/>`).join('');
  const grad = (id: string) => `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${H}">${stops}</linearGradient></defs>`;
  return `<div class="snake" style="--rows:${n};--k:${(H / (n * 100)).toFixed(4)}">
    <svg class="snake-path snake-wide" viewBox="0 0 100 ${H}" preserveAspectRatio="none" aria-hidden="true">${grad('snake-a')}<path d="${d}" stroke="url(#snake-a)" vector-effect="non-scaling-stroke"/></svg>
    <svg class="snake-path snake-narrow" viewBox="0 0 100 ${H}" preserveAspectRatio="none" aria-hidden="true">${grad('snake-b')}<path d="${m}" stroke="url(#snake-b)" vector-effect="non-scaling-stroke"/></svg>
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

/* ── Illustrations des étapes : de petites maquettes, qu'on peut essayer ── */

/** Mot de passe à essayer : la jauge se met à jour à la frappe (rien ne quitte la page) */
export function artAccount(l: { email: string; password: string; placeholder: string; levels: [string, string, string, string, string]; button: string; chip: string }): string {
  return `<div class="mock mock-account">
    <div class="mock-field"><small>${l.email}</small><span>marie@exemple.fr</span></div>
    <label class="mock-field mock-input"><small>${l.password}</small><input type="password" id="demo-password" autocomplete="off" spellcheck="false" placeholder="${l.placeholder}" data-levels="${l.levels.join('|')}"></label>
    <div class="meter" data-meter data-score="0"><i></i><i></i><i></i><i></i><em></em></div>
    <div class="mock-btn">${l.button}</div>
    <div class="mock-chip">${icon('key', 15)}${l.chip}</div>
  </div>`;
}

/** Bascule : ce que vous voyez / ce que voit le serveur */
export function artCipher(l: { you: string; server: string; rows: Array<[string, string]> }): string {
  return `<div class="mock mock-cipher">
    <input type="radio" name="vue" id="vue-moi" checked><input type="radio" name="vue" id="vue-serveur">
    <div class="seg"><label for="vue-moi">${l.you}</label><label for="vue-serveur">${l.server}</label></div>
    <ul>${l.rows.map(([site, user], i) => `
      <li><span class="fav">${site[0]}</span><span class="plain"><b>${site}</b><small>${user}</small></span><code class="cipher">${['9f2c·a81e·77d0·e4b3', 'c03a·5be1·f9d2·18aa', '6e7f·02cd·b4a9·3f51'][i % 3]}</code></li>`).join('')}
    </ul>
  </div>`;
}

/** Les plateformes réellement publiées */
export function artDevices(l: { synced: string; desktop: string; phone: string; web: string }): string {
  return `<div class="mock mock-devices" aria-hidden="true">
    <div class="dev dev-laptop">${icon('monitor', 34)}<span>${l.desktop}</span></div>
    <div class="dev dev-phone">${icon('phone', 28)}<span>${l.phone}</span></div>
    <div class="dev dev-web">${icon('globe', 28)}<span>${l.web}</span></div>
    <div class="sync-badge">${icon('sync', 18)}${l.synced}</div>
  </div>`;
}

/** Code 2FA : un nouveau code toutes les 30 secondes, l'anneau décompte le temps */
export function artUnlock(l: { code: string; unlocked: string; seconds: string }): string {
  return `<div class="mock mock-unlock" aria-hidden="true">
    <div class="ring" data-ring><span data-seconds>30</span><small>${l.seconds}</small></div>
    <div class="unlock-card">
      <span class="tile tile-md">${icon('password', 24)}</span>
      <span><small>${l.code}</small><b class="otp" data-otp>482 913</b></span>
    </div>
    <div class="unlock-ok">✓ ${l.unlocked}</div>
  </div>`;
}

/** Questions fréquentes : un seul bloc, des séparateurs, un chevron qui tourne */
export function faqList(items: Array<[string, string]>): string {
  return `<div class="faq">${items.map(([q, a]) => `
    <details><summary><span>${q}</span><span class="faq-chev" aria-hidden="true"></span></summary><div class="faq-a"><p>${a}</p></div></details>`).join('')}
  </div>`;
}

/** Styles des pages publiques illustrées */
export const ART_CSS = `
.ph{display:block;flex:0 0 auto}
.tile{display:inline-grid;place-items:center;flex:0 0 auto;border-radius:8px;color:var(--accent);
  background:linear-gradient(150deg,color-mix(in srgb,var(--accent) 26%,var(--card)),color-mix(in srgb,var(--accent) 8%,var(--card)));
  border:1px solid color-mix(in srgb,var(--accent) 30%,var(--border));
  box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 10%,transparent),0 10px 24px -14px color-mix(in srgb,var(--accent) 80%,transparent)}
.tile-sm{width:34px;height:34px;border-radius:7px}
.tile-md{width:46px;height:46px}

/* Traits à main levée */
.hl{position:relative;display:inline-block;padding:0 .12em;white-space:nowrap}
.hl-text{position:relative;z-index:1}
.hl-brush{position:absolute;z-index:0;left:-.08em;top:.16em;width:calc(100% + .2em);height:.9em;margin-top:.12em;overflow:visible;transform:rotate(-1.2deg)}
.hl-brush path{fill:var(--hl,#ffc62e)}.hl-brush .hl-tail{fill:none;stroke:var(--hl,#ffc62e);stroke-width:5;stroke-linecap:round}
.hl-accent{--hl:color-mix(in srgb,var(--accent) 78%,transparent)}
.hl-accent .hl-text{color:#fff}
.hl-yellow{--hl:#ffc62e}.hl-yellow .hl-text{color:#1a1530}
.ul{position:relative;display:inline-block;white-space:nowrap}
.ul-line{position:absolute;left:-2%;bottom:-.14em;width:104%;height:.3em;overflow:visible}
.ul-line path{fill:var(--ul,#3aa0f0)}
.ul-blue{--ul:#3aa0f0}.ul-red{--ul:#f05a5f}.ul-yellow{--ul:#ffb21e}
.ci{position:relative;display:inline-block;white-space:nowrap;padding:0 .1em}
.ci-loop{position:absolute;left:-12%;top:-22%;width:124%;height:144%;overflow:visible;pointer-events:none}
.ci-loop path{fill:none;stroke:#1fc7b0;stroke-width:5;stroke-linecap:round}
/* Le trait se dessine à l'arrivée */
.js .hl-brush{clip-path:inset(0 100% 0 0);transition:clip-path .9s cubic-bezier(.3,.7,.2,1) .25s}
.js .in .hl-brush,.js .hl.in .hl-brush{clip-path:inset(0 -5% 0 0)}
.js .ul-line{clip-path:inset(0 100% 0 0);transition:clip-path .7s ease-out .2s}
.js .in .ul-line,.js .ul.in .ul-line{clip-path:inset(0 -5% 0 0)}
.js .ci-loop path{stroke-dasharray:520;stroke-dashoffset:520;transition:stroke-dashoffset 1s ease-out .2s}
.js .in .ci-loop path,.js .ci.in .ci-loop path{stroke-dashoffset:0}

/* En-tête : deux colonnes, texte à gauche, démonstration à droite */
.hero{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr);gap:40px;align-items:center;padding:72px 0 24px}
.hero-art{position:relative;height:380px}
.glow{position:absolute;inset:10% 8%;border-radius:50%;background:radial-gradient(closest-side,color-mix(in srgb,var(--accent) 38%,transparent),transparent);filter:blur(20px);opacity:.7}
.window{position:absolute;inset:40px 30px 40px 60px;border-radius:9px;background:var(--card);border:1px solid var(--border);
  box-shadow:0 30px 60px -30px rgba(0,0,0,.55);overflow:hidden;animation:rise 6s ease-in-out infinite}
.window-bar{display:flex;gap:6px;padding:12px 14px;border-bottom:1px solid var(--border)}
.window-bar i{width:9px;height:9px;border-radius:50%;background:var(--border)}
.window-body{display:flex;flex-direction:column;align-items:center;gap:22px;padding:30px 24px}
.safe{display:grid;place-items:center;width:124px;height:124px;border-radius:9px;color:var(--accent);
  background:radial-gradient(circle at 30% 20%,color-mix(in srgb,var(--accent) 30%,var(--card)),color-mix(in srgb,var(--accent) 8%,var(--card)));
  border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border));box-shadow:0 18px 40px -20px var(--accent)}
.lines{display:flex;flex-direction:column;gap:9px;width:70%}
.lines span{height:9px;border-radius:5px;background:color-mix(in srgb,var(--muted) 22%,transparent)}
.lines .short{width:55%}
.float{position:absolute;display:flex;align-items:center;gap:10px;padding:10px 14px 10px 10px;border-radius:8px;
  background:color-mix(in srgb,var(--card) 90%,transparent);border:1px solid var(--border);backdrop-filter:blur(8px);
  box-shadow:0 18px 40px -22px rgba(0,0,0,.6);font-size:13px}
.float small{display:block;color:var(--muted);font-size:11px;line-height:1.2}
.float b{font-size:15px;letter-spacing:.02em}
.ok{color:#3fb950}
.otp{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.otp.flip{animation:flip .45s ease}
@keyframes flip{0%{opacity:1;transform:none}45%{opacity:0;transform:translateY(-6px)}55%{opacity:0;transform:translateY(6px)}100%{opacity:1;transform:none}}
.float-a{top:18px;left:0;animation:rise 5s ease-in-out infinite .4s}
.float-b{bottom:34px;left:14px;animation:rise 5.6s ease-in-out infinite 1.2s;min-width:236px;height:56px}
.float-c{top:54%;right:0;animation:rise 6.2s ease-in-out infinite .8s}
.cycle{position:relative;display:block;width:100%;height:100%}
.cycle-item{position:absolute;inset:0;display:flex;align-items:center;gap:10px;opacity:0;animation:cycle 9s infinite;animation-delay:calc(var(--i) * 3s)}
.cycle-item:first-child{opacity:1}
@keyframes cycle{0%{opacity:0;transform:translateY(8px)}4%,30%{opacity:1;transform:none}34%,100%{opacity:0;transform:translateY(-8px)}}
@keyframes rise{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}

.trust{display:flex;flex-wrap:wrap;gap:10px 22px;margin:22px 0 0;padding:0;list-style:none;color:var(--muted);font-size:14px}
.trust li{display:inline-flex;align-items:center;gap:8px}
.trust .ph{color:var(--accent)}

/* Le coffre des fonctionnalités */
.vault{position:relative;margin:52px auto 0;max-width:940px}
.vault-frame{position:relative;padding:18px;border-radius:9px;
  background:linear-gradient(160deg,color-mix(in srgb,var(--muted) 34%,var(--card)),color-mix(in srgb,var(--muted) 14%,var(--card)) 55%,color-mix(in srgb,var(--muted) 26%,var(--card)));
  border:1px solid color-mix(in srgb,var(--muted) 38%,var(--border));box-shadow:0 50px 90px -50px rgba(0,0,0,.75),inset 0 1px 0 rgba(255,255,255,.08),inset 0 -2px 0 rgba(0,0,0,.25)}
.rivet{position:absolute;width:9px;height:9px;border-radius:50%;background:color-mix(in srgb,var(--muted) 55%,var(--card));box-shadow:inset 0 -2px 0 rgba(0,0,0,.3)}
.r1{top:6px;left:6px}.r2{top:6px;right:6px}.r3{bottom:6px;left:6px}.r4{bottom:6px;right:6px}
.vault-opening{position:relative;border-radius:7px;perspective:2400px;perspective-origin:50% 40%;background:var(--bg);box-shadow:inset 0 14px 34px rgba(0,0,0,.55)}
.vault-light{position:absolute;inset:0;border-radius:7px;background:radial-gradient(70% 60% at 50% 0%,color-mix(in srgb,var(--accent) 26%,transparent),transparent 70%);transition:opacity 1.2s ease .5s;pointer-events:none}
.vault-inner{position:relative;list-style:none;margin:0;padding:14px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.vault-inner>li{display:flex}
.locker{position:relative;display:flex;flex-direction:column;gap:10px;width:100%;padding:16px 16px 40px;border-radius:8px;background:var(--card);border:1px solid var(--border);
  color:var(--text);text-decoration:none;transition:border-color .2s,transform .2s,box-shadow .2s,background-color .2s}
.locker:hover,.locker:focus-visible{border-color:color-mix(in srgb,var(--accent) 60%,var(--border));transform:translateY(-3px);box-shadow:0 18px 36px -22px var(--accent);outline:none}
.locker h3{margin:0;font-size:15px}
.locker p{margin:0;color:var(--muted);font-size:13.5px;line-height:1.5}
.locker-more{position:absolute;left:16px;bottom:12px;display:inline-flex;gap:6px;font-size:12.5px;font-weight:650;color:var(--accent);opacity:.75;transition:opacity .2s}
.locker-more span{transition:transform .2s}
.locker:hover .locker-more,.locker:focus-visible .locker-more{opacity:1}
.locker:hover .locker-more span{transform:translateX(3px)}
/* Battants : ouverts par défaut (sans script, tout est visible) */
.door{position:absolute;top:0;bottom:0;width:50%;transform-style:preserve-3d;transition:transform 1.5s cubic-bezier(.55,0,.15,1) .15s;pointer-events:none}
.door-l{left:0;transform-origin:left center;transform:rotateY(-100deg)}
.door-r{right:0;transform-origin:right center;transform:rotateY(100deg)}
.door-face{position:absolute;inset:0;display:grid;place-items:center;backface-visibility:hidden;
  background:linear-gradient(135deg,color-mix(in srgb,var(--muted) 40%,var(--card)),color-mix(in srgb,var(--muted) 20%,var(--card)));
  border:1px solid color-mix(in srgb,var(--muted) 45%,var(--border));box-shadow:inset 0 0 0 8px color-mix(in srgb,var(--muted) 10%,transparent),inset 0 0 40px rgba(0,0,0,.25)}
.door-l .door-face{border-radius:6px 2px 2px 6px}.door-r .door-face{border-radius:2px 6px 6px 2px}
.door-edge{position:absolute;top:0;bottom:0;width:18px;background:linear-gradient(90deg,color-mix(in srgb,var(--muted) 30%,var(--card)),color-mix(in srgb,var(--muted) 50%,var(--card)))}
.door-l .door-edge{right:0;transform-origin:right center;transform:rotateY(90deg)}
.door-r .door-edge{left:0;transform-origin:left center;transform:rotateY(-90deg)}
.door-back{position:absolute;inset:0;border-radius:6px;transform:rotateY(180deg);backface-visibility:hidden;display:flex;flex-direction:column;justify-content:space-evenly;padding:0 12px;
  background:linear-gradient(90deg,color-mix(in srgb,var(--muted) 18%,var(--card)),color-mix(in srgb,var(--muted) 34%,var(--card)));border:1px solid color-mix(in srgb,var(--muted) 40%,var(--border))}
.door-l .door-back{align-items:flex-start}.door-r .door-back{align-items:flex-end}
.door-back i{width:34px;height:12px;border-radius:3px;background:color-mix(in srgb,var(--muted) 60%,var(--card));box-shadow:inset 0 -2px 0 rgba(0,0,0,.25)}
.door-bolts{position:absolute;inset:18px;border-radius:4px;border:2px dashed color-mix(in srgb,var(--muted) 30%,transparent)}
.dial{position:relative;display:grid;place-items:center;width:150px;height:150px;border-radius:50%;background:var(--card);border:6px solid color-mix(in srgb,var(--muted) 45%,var(--border));box-shadow:0 18px 36px -18px rgba(0,0,0,.7)}
.dial-ticks{position:absolute;inset:8px;border-radius:50%;background:repeating-conic-gradient(color-mix(in srgb,var(--muted) 70%,transparent) 0 1.5deg,transparent 1.5deg 12deg);
  -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 10px),#000 calc(100% - 9px));mask:radial-gradient(farthest-side,transparent calc(100% - 10px),#000 calc(100% - 9px))}
.dial-knob{display:grid;place-items:center;width:78px;height:78px;border-radius:50%;color:var(--accent);background:radial-gradient(circle at 35% 30%,color-mix(in srgb,var(--accent) 24%,var(--card)),var(--card));border:1px solid var(--border);transition:transform 1.3s ease}
.wheel{position:relative;width:140px;height:140px;border-radius:50%;border:8px solid color-mix(in srgb,var(--muted) 55%,var(--card));transition:transform 1.3s ease}
.wheel i{position:absolute;left:50%;top:50%;width:132px;height:10px;margin:-5px 0 0 -66px;border-radius:5px;background:color-mix(in srgb,var(--muted) 55%,var(--card))}
.wheel i:nth-child(2){transform:rotate(60deg)}.wheel i:nth-child(3){transform:rotate(120deg)}
.wheel span{position:absolute;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:var(--card);border:4px solid color-mix(in srgb,var(--muted) 55%,var(--card))}
.vault-feet{display:flex;justify-content:space-between;padding:0 48px}
.vault-feet i{width:70px;height:12px;border-radius:0 0 6px 6px;background:color-mix(in srgb,var(--muted) 30%,var(--card))}
/* Avec le script : fermé, puis la molette tourne, le volant aussi, et les battants s'ouvrent */
.js .door-l,.js .door-r{transform:rotateY(0)}
.js .vault.open .door-l{transform:rotateY(-100deg)}
.js .vault.open .door-r{transform:rotateY(100deg)}
.js .vault.open .dial-knob{transform:rotate(-200deg)}
.js .vault.open .wheel{transform:rotate(180deg)}
.js .vault-light{opacity:0}
.js .vault.open .vault-light{opacity:1}
.js .vault-inner>li{opacity:0;transform:translateY(10px) scale(.98);transition:opacity .45s ease,transform .45s ease}
.js .vault.open .vault-inner>li{opacity:1;transform:none;transition-delay:calc(1.1s + var(--i) * 70ms)}

/* Serpent des étapes : un seul ruban */
.snake{position:relative;margin:36px 0 0}
.snake-path{position:absolute;left:0;top:0;width:100%;height:calc(100% * var(--k));overflow:visible;pointer-events:none}
.snake-path path{fill:none;stroke-linecap:round}
.snake-wide path{stroke-width:26px;transition:stroke-dashoffset .15s linear}
.snake-narrow{display:none}
.snake-narrow path{stroke-width:12px}
.snake-steps{position:relative;list-style:none;margin:0;padding:0;display:grid;grid-template-rows:repeat(var(--rows),minmax(340px,auto))}
.snake-step{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:56px}
.snake-step.art-right .snake-art{order:2}
.snake-art{display:flex;justify-content:center;position:relative;z-index:1}
.snake-text{position:relative;z-index:1;max-width:44ch;padding:18px 20px}
.snake-step.art-right .snake-text{justify-self:end}
.snake-num{display:inline-block;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--c);
  padding:3px 9px;border-radius:6px;background:color-mix(in srgb,var(--c) 16%,transparent)}
.snake-text h3{font-size:clamp(24px,3vw,32px);letter-spacing:-.02em;line-height:1.15;margin:12px 0 6px}
.snake-sub{color:var(--accent);font-weight:600;margin:0 0 10px}
.snake-text p:last-child{color:var(--muted);margin:0}

/* Maquettes */
.mock{position:relative;width:min(340px,100%);padding:20px;border-radius:9px;background:var(--card);border:1px solid var(--border);
  box-shadow:0 30px 60px -32px rgba(0,0,0,.55),0 0 0 6px color-mix(in srgb,var(--card) 60%,transparent)}
.mock-field{display:flex;flex-direction:column;gap:2px;padding:9px 12px;margin-bottom:10px;border-radius:7px;border:1px solid var(--border);background:var(--bg);font-size:14px}
.mock-field small{color:var(--muted);font-size:11px}
.mock-input{cursor:text;transition:border-color .15s,box-shadow .15s}
.mock-input:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 25%,transparent)}
.mock-input input{all:unset;font:inherit;font-size:15px;letter-spacing:.06em;color:var(--text);width:100%}
.mock-input input::placeholder{letter-spacing:0;color:color-mix(in srgb,var(--muted) 80%,transparent)}
.meter{display:flex;align-items:center;gap:5px;margin:2px 0 14px}
.meter i{flex:1;height:5px;border-radius:3px;background:color-mix(in srgb,var(--muted) 25%,transparent);transition:background-color .25s}
.meter em{font-style:normal;font-size:11.5px;font-weight:700;margin-left:6px;min-width:62px;text-align:right;color:var(--mc,#3fb950);transition:color .25s}
.meter[data-score="0"]{--mc:var(--muted)}.meter[data-score="1"]{--mc:#f05a5f}.meter[data-score="2"]{--mc:#f0883e}.meter[data-score="3"]{--mc:#d4b106}.meter[data-score="4"]{--mc:#3fb950}
.meter[data-score="1"] i:nth-child(-n+1),.meter[data-score="2"] i:nth-child(-n+2),.meter[data-score="3"] i:nth-child(-n+3),.meter[data-score="4"] i:nth-child(-n+4){background:var(--mc)}
.mock-btn{display:grid;place-items:center;height:40px;border-radius:7px;background:var(--accent);color:#fff;font-weight:600;font-size:14px}
.mock-chip{position:absolute;right:-16px;bottom:-16px;display:inline-flex;align-items:center;gap:6px;padding:7px 11px;border-radius:7px;transform:rotate(-4deg);
  background:var(--card);border:1px solid var(--border);font-size:12.5px;font-weight:600;color:var(--accent);box-shadow:0 14px 30px -18px rgba(0,0,0,.6)}

.mock-cipher>input{position:absolute;opacity:0;pointer-events:none}
.seg{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;margin-bottom:12px;border-radius:8px;background:var(--bg);border:1px solid var(--border)}
.seg label{display:grid;place-items:center;min-height:36px;border-radius:6px;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer;transition:background-color .2s,color .2s}
.seg label:hover{color:var(--text)}
#vue-moi:checked~.seg label[for=vue-moi],#vue-serveur:checked~.seg label[for=vue-serveur]{background:var(--card);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.25)}
#vue-moi:focus-visible~.seg label[for=vue-moi],#vue-serveur:focus-visible~.seg label[for=vue-serveur]{outline:2px solid var(--accent)}
.mock-cipher ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.mock-cipher li{position:relative;display:flex;align-items:center;gap:10px;min-height:48px;padding:8px 10px;border-radius:7px;border:1px solid var(--border);background:var(--bg)}
.fav{display:grid;place-items:center;width:30px;height:30px;border-radius:6px;background:color-mix(in srgb,var(--accent) 20%,var(--card));color:var(--accent);font-weight:700;font-size:13px;flex:0 0 auto;transition:background-color .25s,color .25s}
.plain{display:flex;flex-direction:column;line-height:1.25;font-size:13.5px;transition:opacity .25s,transform .25s}
.plain small{color:var(--muted);font-size:12px}
.cipher{position:absolute;left:50px;right:10px;top:50%;transform:translateY(-50%) scale(.96);opacity:0;font:600 12.5px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#f0883e;transition:opacity .25s,transform .25s;white-space:nowrap;overflow:hidden}
#vue-serveur:checked~ul .plain{opacity:0;transform:translateX(-6px)}
#vue-serveur:checked~ul .cipher{opacity:1;transform:translateY(-50%)}
#vue-serveur:checked~ul .fav{background:color-mix(in srgb,#f0883e 18%,var(--card));color:#f0883e}

.mock-devices{display:grid;grid-template-columns:1.3fr 1fr;grid-template-rows:auto auto;gap:10px}
.dev{display:flex;flex-direction:column;align-items:flex-start;gap:10px;padding:14px;border-radius:7px;border:1px solid var(--border);background:var(--bg);color:var(--accent);transition:border-color .2s,transform .2s}
.dev:hover{border-color:var(--accent);transform:translateY(-2px)}
.dev span{color:var(--muted);font-size:12px}
.dev-laptop{grid-row:1/3;justify-content:space-between}
.sync-badge{position:absolute;left:50%;bottom:-16px;transform:translateX(-50%);display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:7px;
  background:#2ea043;color:#fff;font-size:12.5px;font-weight:700;box-shadow:0 12px 26px -12px #3fb950;white-space:nowrap}
.sync-badge .ph{animation:spin 2.4s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

.mock-unlock{display:flex;flex-direction:column;align-items:center;gap:14px;padding-top:30px}
.ring{position:absolute;top:-28px;right:-18px;width:80px;height:80px;border-radius:50%;display:grid;place-content:center;justify-items:center;background:var(--card);
  box-shadow:0 14px 30px -16px rgba(0,0,0,.6);line-height:1}
.ring::before{content:"";position:absolute;inset:6px;border-radius:50%;background:conic-gradient(var(--accent) var(--p,75%),color-mix(in srgb,var(--muted) 18%,transparent) 0);
  -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 7px),#000 calc(100% - 6px));mask:radial-gradient(farthest-side,transparent calc(100% - 7px),#000 calc(100% - 6px));transition:--p 1s linear}
.ring span{position:relative;font-weight:800;font-size:18px;font-variant-numeric:tabular-nums}
.ring small{position:relative;font-size:10px;color:var(--muted);margin-top:2px}
@property --p{syntax:"<percentage>";inherits:false;initial-value:100%}
.unlock-card{display:flex;align-items:center;gap:12px;width:100%;padding:12px;border-radius:7px;border:1px solid var(--border);background:var(--bg)}
.unlock-card small{display:block;color:var(--muted);font-size:11.5px}
.unlock-card b{font-size:24px;letter-spacing:.08em}
.unlock-ok{align-self:stretch;text-align:center;padding:9px;border-radius:7px;background:color-mix(in srgb,#3fb950 14%,transparent);color:#3fb950;font-weight:700;font-size:13.5px}

/* Bandeau qui reçoit le ruban */
.band{position:relative;margin:60px calc(50% - 50vw) 0;padding:72px 20px;background:linear-gradient(120deg,#2b1f9e,#4a3ad1 60%,#5b4ee6);color:#fff;overflow:hidden}
.band::before{content:"";position:absolute;inset:0;background:radial-gradient(600px 300px at 85% 0%,rgba(255,255,255,.14),transparent 70%)}
.band-in{position:relative;max-width:1080px;margin:0 auto;display:grid;grid-template-columns:auto 1fr;gap:36px;align-items:center}
.band .safe{width:132px;height:132px;color:#fff;background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.25);box-shadow:0 20px 50px -20px rgba(0,0,0,.5)}
.band h2{color:#fff;font-size:clamp(26px,3.6vw,38px);margin:0 0 8px}
.band p{margin:0 0 22px;color:rgba(255,255,255,.84);max-width:60ch}
.band .actions{margin:0}
.band .btn{background:#fff;border-color:#fff;color:#2b1f9e}
.band .btn.ghost{background:transparent;color:#fff;border-color:rgba(255,255,255,.45)}
.band .btn:hover{filter:brightness(.96)}

/* Questions */
.faq-head{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:48px;align-items:start}
.faq-head .section-lede a{color:var(--accent);font-weight:600}
.faq{border:1px solid var(--border);border-radius:9px;background:var(--card);overflow:hidden}
.faq details{border-top:1px solid var(--border)}
.faq details:first-child{border-top:0}
.faq summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:18px;min-height:60px;padding:14px 20px;cursor:pointer;font-weight:600;font-size:15.5px;transition:background-color .15s}
.faq summary::-webkit-details-marker{display:none}
.faq summary:hover{background:color-mix(in srgb,var(--muted) 7%,transparent)}
.faq summary:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.faq-chev{flex:0 0 auto;width:28px;height:28px;border-radius:7px;display:grid;place-items:center;background:color-mix(in srgb,var(--muted) 10%,transparent);transition:transform .25s,background-color .25s}
.faq-chev::before{content:"";width:7px;height:7px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:translateY(-2px) rotate(45deg)}
.faq details[open] .faq-chev{transform:rotate(180deg);background:color-mix(in srgb,var(--accent) 16%,transparent)}
.faq details[open] .faq-chev::before{border-color:var(--accent)}
.faq details[open] summary{color:var(--accent)}
.faq-a p{margin:0;padding:0 20px 18px;color:var(--muted);line-height:1.65;max-width:68ch}
.faq details::details-content{block-size:0;overflow:hidden;transition:block-size .3s ease,content-visibility .3s allow-discrete}
.faq details[open]::details-content{block-size:auto}
:root{interpolate-size:allow-keywords}

/* Serveurs officiels */
.official{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;list-style:none;padding:0;margin:24px 0 0}
.official li{display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:8px;background:var(--card);border:1px solid var(--border)}
.official strong{display:block}
.official .meta{font-size:13px}
.dot{width:9px;height:9px;border-radius:50%;background:#3fb950;box-shadow:0 0 0 4px color-mix(in srgb,#3fb950 20%,transparent);margin-left:auto;flex:0 0 auto}
.dot.off{background:var(--muted);box-shadow:none}

/* Apparition à l'arrivée (avec le script ; sans lui, tout est simplement là) */
.js [data-reveal]{opacity:0;transform:translateY(18px);transition:opacity .6s ease,transform .6s cubic-bezier(.2,.7,.2,1)}
.js [data-reveal].in{opacity:1;transform:none}

@media (max-width:960px){
  .door{display:none}
  .js .vault-inner>li{opacity:1;transform:none}
  .js .vault-light{opacity:1}
  .vault-inner{grid-template-columns:repeat(2,minmax(0,1fr))}
  .faq-head{grid-template-columns:1fr;gap:18px}
}
@media (max-width:860px){
  .hero{grid-template-columns:1fr;gap:8px;padding-top:40px}
  .hero-art{height:300px;order:-1}
  .window{inset:30px 24px 30px 44px}
  .safe{width:100px;height:100px}
  .snake-wide{display:none}
  .snake-narrow{display:block;left:0;width:44px}
  .snake-steps{grid-template-rows:none;gap:44px;padding-left:52px}
  .snake-step{grid-template-columns:1fr;gap:18px}
  .snake-step.art-right .snake-art{order:0}
  .snake-art{justify-content:flex-start}
  .snake-text{padding:0}
  .band-in{grid-template-columns:1fr;gap:20px}
  .band .safe{width:96px;height:96px}
}
@media (max-width:560px){
  .vault-frame{padding:10px}
  .vault-inner{grid-template-columns:1fr;padding:10px}
  .mock-chip{right:-6px}
  .ring{right:-6px}
}
@media (max-width:420px){.float{font-size:12px}.float-c{display:none}.float-b{min-width:210px}}

@media (prefers-reduced-motion:reduce){
  .window,.float,.cycle-item,.sync-badge .ph,.otp.flip,.site-menu nav{animation:none!important}
  .js [data-reveal],.js .vault-inner>li{opacity:1!important;transform:none!important;transition:none!important}
  .door,.dial-knob,.wheel{transition:none!important}
  .js .hl-brush,.js .ul-line{clip-path:none;transition:none}
  .js .ci-loop path{stroke-dashoffset:0;transition:none}
  .locker:hover,.dev:hover{transform:none}
}
`;
