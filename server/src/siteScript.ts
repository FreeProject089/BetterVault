/**
 * Script des pages publiques, servi à /site.js (même origine, aucune
 * dépendance). Il n'ajoute que du confort : chaque page reste complète sans
 * lui, et la politique de sécurité n'autorise que ce fichier.
 *
 * - apparitions au défilement et ruban des étapes qui se dessine ;
 * - porte du coffre qui s'ouvre quand il arrive à l'écran ;
 * - jauge du mot de passe d'essai (rien ne quitte la page) ;
 * - codes 2FA de démonstration qui changent toutes les 30 secondes ;
 * - colonnes du pied de page repliées sur un écran étroit.
 */
export const SITE_JS = `(() => {
  'use strict';
  const doc = document.documentElement;
  doc.classList.add('js');
  const calme = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Apparitions : une fois, quand l'élément arrive à l'écran */
  const vus = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      if (e.target.matches('[data-vault]')) e.target.classList.add('open');
      vus.unobserve(e.target);
    }
  }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('[data-reveal], [data-vault], .hl, .ul, .ci').forEach(el => vus.observe(el));

  /* Ruban des étapes : dessiné jusqu'au bas de l'écran, au fil du défilement */
  const serpent = document.querySelector('.snake');
  if (serpent) {
    const dessiner = () => {
      const r = serpent.getBoundingClientRect();
      const visible = Math.min(Math.max((innerHeight * 0.85 - r.top) / r.height, 0), 1);
      serpent.style.setProperty('--draw', (calme ? 100 : visible * 100).toFixed(1) + '%');
    };
    dessiner();
    addEventListener('scroll', dessiner, { passive: true });
    addEventListener('resize', dessiner);
  }

  /* Mot de passe d'essai : une estimation simple, calculée ici, jamais envoyée */
  const essai = document.getElementById('demo-password');
  const jauge = document.querySelector('[data-meter]');
  if (essai && jauge) {
    const niveaux = (essai.dataset.levels || '').split('|');
    const note = mdp => {
      if (!mdp) return 0;
      let s = 0;
      if (mdp.length >= 8) s++;
      if (mdp.length >= 12) s++;
      if (mdp.length >= 16) s++;
      const familles = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(mdp)).length;
      if (familles >= 3) s++;
      if (/^(.)\\1+$/.test(mdp) || /(password|motdepasse|azerty|qwerty|123456|admin)/i.test(mdp)) s = Math.min(s, 1);
      return Math.max(1, Math.min(4, s));
    };
    const maj = () => {
      const s = note(essai.value);
      jauge.dataset.score = String(s);
      jauge.querySelector('em').textContent = niveaux[s] || '';
    };
    essai.addEventListener('input', maj);
  }

  /* Codes 2FA de démonstration : alignés sur les tranches de 30 secondes, comme les vrais */
  const codes = document.querySelectorAll('[data-otp]');
  const anneau = document.querySelector('[data-ring]');
  const secondes = document.querySelector('[data-seconds]');
  if (codes.length) {
    const tirer = () => {
      const a = new Uint32Array(1);
      crypto.getRandomValues(a);
      const n = String(a[0] % 1000000).padStart(6, '0');
      return n.slice(0, 3) + ' ' + n.slice(3);
    };
    let tranche = -1;
    const tic = () => {
      const t = Date.now() / 1000;
      const reste = 30 - Math.floor(t % 30);
      if (anneau) anneau.style.setProperty('--p', ((reste / 30) * 100).toFixed(1) + '%');
      if (secondes) secondes.textContent = String(reste);
      const actuelle = Math.floor(t / 30);
      if (actuelle !== tranche) {
        const premier = tranche === -1;
        tranche = actuelle;
        codes.forEach(c => {
          if (premier || calme) { c.textContent = tirer(); return; }
          c.classList.remove('flip');
          void c.offsetWidth;
          c.classList.add('flip');
          setTimeout(() => { c.textContent = tirer(); }, 220);
        });
      }
    };
    tic();
    setInterval(tic, 1000);
  }

  /* Pied de page : un accordéon sur écran étroit, des colonnes ouvertes ailleurs */
  const colonnes = document.querySelectorAll('.site-footer-col');
  const etroit = matchMedia('(max-width: 760px)');
  const plier = () => colonnes.forEach(c => { c.open = !etroit.matches; });
  plier();
  etroit.addEventListener('change', plier);

  /* Menus (langue, navigation) : fermés par un clic ailleurs ou par Échap */
  const menus = document.querySelectorAll('.site-menu, .lang-menu');
  document.addEventListener('click', e => menus.forEach(m => { if (m.open && !m.contains(e.target)) m.open = false; }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') menus.forEach(m => { m.open = false; }); });
})();
`;
