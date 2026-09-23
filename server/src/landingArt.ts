import { PHOSPHOR, type PhosphorName } from './phosphorIcons.ts';

/**
 * Éléments visuels des pages publiques (accueil, serveurs).
 *
 * Les icônes viennent de Phosphor (style duotone, licence MIT), un jeu dessiné
 * à la main et cohérent : chaque icône est posée dans une tuile en relief
 * (dégradé, reflet, ombre teintée). Tout est en SVG intégré et en CSS : les
 * pages n'exécutent aucun script et n'acceptent aucune image extérieure.
 *
 * Les couleurs viennent des variables de la page (`--accent`…), elles suivent
 * donc le thème clair ou sombre. Les mouvements s'arrêtent quand la personne
 * le demande.
 */

export type IconName = PhosphorName;

/** Icône seule, en currentColor */
export function icon(name: IconName, size = 24, label?: string): string {
  return `<svg class="ph" width="${size}" height="${size}" viewBox="0 0 256 256" fill="currentColor" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${PHOSPHOR[name]}</svg>`;
}

/** Icône dans sa tuile en relief */
export function tile(name: IconName, size: 'sm' | 'md' | 'lg' = 'md'): string {
  const px = size === 'lg' ? 34 : size === 'md' ? 24 : 18;
  return `<span class="tile tile-${size}">${icon(name, px)}</span>`;
}

/**
 * Visuel de l'en-tête : une fenêtre d'application stylisée, le coffre au
 * centre, et trois cartes qui flottent autour — un code 2FA qui défile, une
 * empreinte, une clé. On montre ce que fait le produit plutôt qu'un dessin
 * abstrait.
 */
export function heroArt(labels: { code: string; unlocked: string; synced: string }): string {
  return `<div class="hero-art" aria-hidden="true">
    <div class="glow"></div>
    <div class="window">
      <div class="window-bar"><i></i><i></i><i></i></div>
      <div class="window-body">
        <span class="tile tile-xl">${icon('vault', 56)}</span>
        <div class="lines"><span></span><span></span><span class="short"></span></div>
      </div>
    </div>
    <div class="float float-a">${tile('password', 'sm')}<span><small>${labels.code}</small><b class="otp"><span>482</span> <span>913</span></b></span></div>
    <div class="float float-b">${tile('fingerprint', 'sm')}<span><small>${labels.unlocked}</small><b class="ok">●</b></span></div>
    <div class="float float-c">${tile('cloud', 'sm')}<span><small>${labels.synced}</small><b class="ok">✓</b></span></div>
  </div>`;
}

/** Les trois étapes, reliées par un trait qui s'anime */
export function stepsArt(steps: Array<{ icon: IconName; title: string; text: string }>): string {
  return `<ol class="steps">${steps.map((s, i) => `
    <li>
      <span class="step-head">${tile(s.icon, 'md')}<span class="step-num">${i + 1}</span></span>
      <strong>${s.title}</strong>
      <span>${s.text}</span>
    </li>`).join('')}
  </ol>`;
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
.tile-xl{width:104px;height:104px;border-radius:26px}

/* En-tête : deux colonnes, texte à gauche, démonstration à droite */
.hero{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr);gap:40px;align-items:center;padding:72px 0 24px}
.hero-art{position:relative;height:360px}
.glow{position:absolute;inset:10% 8%;border-radius:50%;background:radial-gradient(closest-side,color-mix(in srgb,var(--accent) 38%,transparent),transparent);filter:blur(20px);opacity:.7}
.window{position:absolute;inset:40px 30px 40px 60px;border-radius:18px;background:var(--card);border:1px solid var(--border);
  box-shadow:0 30px 60px -30px rgba(0,0,0,.55);overflow:hidden;animation:rise 6s ease-in-out infinite}
.window-bar{display:flex;gap:6px;padding:12px 14px;border-bottom:1px solid var(--border)}
.window-bar i{width:9px;height:9px;border-radius:50%;background:var(--border)}
.window-body{display:flex;flex-direction:column;align-items:center;gap:22px;padding:34px 24px}
.lines{display:flex;flex-direction:column;gap:9px;width:70%}
.lines span{height:9px;border-radius:5px;background:color-mix(in srgb,var(--muted) 22%,transparent)}
.lines .short{width:55%}
.float{position:absolute;display:flex;align-items:center;gap:10px;padding:10px 14px 10px 10px;border-radius:14px;
  background:color-mix(in srgb,var(--card) 88%,transparent);border:1px solid var(--border);backdrop-filter:blur(8px);
  box-shadow:0 18px 40px -22px rgba(0,0,0,.6);font-size:13px}
.float small{display:block;color:var(--muted);font-size:11px;line-height:1.2}
.float b{font-size:15px;letter-spacing:.02em}
.float .ok{color:#3fb950}
.otp{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.float-a{top:18px;left:0;animation:rise 5s ease-in-out infinite .4s}
.float-b{bottom:34px;left:14px;animation:rise 5.6s ease-in-out infinite 1.2s}
.float-c{top:54%;right:0;animation:rise 6.2s ease-in-out infinite .8s}
@keyframes rise{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}

/* Petite ligne de confiance sous les boutons */
.trust{display:flex;flex-wrap:wrap;gap:10px 22px;margin:22px 0 0;padding:0;list-style:none;color:var(--muted);font-size:14px}
.trust li{display:inline-flex;align-items:center;gap:8px}
.trust .ph{color:var(--accent)}

/* Fonctions */
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;padding:0;margin:24px 0 0;list-style:none}
.features li{display:flex;flex-direction:column;gap:12px;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:20px;
  transition:border-color .2s ease,transform .2s ease}
.features li:hover{border-color:color-mix(in srgb,var(--accent) 55%,var(--border));transform:translateY(-3px)}
.features h3{margin:0}
.features p{margin:0;color:var(--muted);font-size:14.5px}

/* Étapes reliées */
.steps{counter-reset:none;list-style:none;padding:0;margin:26px 0 0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;position:relative}
.steps::before{content:"";position:absolute;top:24px;left:12%;right:12%;height:2px;
  background:repeating-linear-gradient(90deg,color-mix(in srgb,var(--accent) 55%,transparent) 0 8px,transparent 8px 16px);
  background-size:16px 2px;animation:march 1.2s linear infinite}
@keyframes march{to{background-position:16px 0}}
.steps li{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px;color:var(--muted);font-size:14.5px;padding:0 8px}
.steps li::before{content:none}
.steps strong{color:var(--text);font-size:15.5px}
.step-head{position:relative;background:var(--bg);padding:0 10px}
.step-num{position:absolute;top:-6px;right:0;width:20px;height:20px;border-radius:50%;background:var(--accent);color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center}

/* Apparition au défilement, sans script, là où le navigateur le permet */
@supports (animation-timeline:view()){
  .features li,.steps li,.facts li{animation:appear linear both;animation-timeline:view();animation-range:entry 0% entry 55%}
  @keyframes appear{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
}

@media (max-width:860px){
  .hero{grid-template-columns:1fr;gap:8px;padding-top:40px}
  .hero-art{height:300px;order:-1}
  .window{inset:30px 24px 30px 44px}
  .steps{grid-template-columns:1fr;gap:22px}
  .steps::before{top:0;bottom:0;left:24px;right:auto;width:2px;height:auto;
    background:repeating-linear-gradient(180deg,color-mix(in srgb,var(--accent) 55%,transparent) 0 8px,transparent 8px 16px);animation:none}
  .steps li{flex-direction:column;align-items:flex-start;text-align:left;padding-left:0}
}
@media (max-width:420px){.float{font-size:12px}.float-c{display:none}}

@media (prefers-reduced-motion:reduce){
  .window,.float,.steps::before,.features li,.steps li,.facts li{animation:none!important}
  .features li:hover{transform:none}
}
`;
