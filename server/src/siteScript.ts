import { createHash } from 'node:crypto';

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

  /*
   * Ruban des étapes, sur grand écran : tracé d'après la place réelle de
   * chaque maquette. Il fait le tour de chacune par l'extérieur, traverse
   * entre deux étapes, puis descend se jeter dans le bandeau. Sa couleur est
   * celle de l'étape qu'il entoure, et finit dans celle du bandeau.
   * Il se dessine au fil du défilement (longueur de trait), jusqu'au bas de
   * l'écran.
   */
  const serpent = document.querySelector('.snake');
  const large = serpent && serpent.querySelector('.snake-wide');
  if (serpent && large) {
    const NS = 'http://www.w3.org/2000/svg';
    const bandeau = document.querySelector('.band');
    let chemin = null, longueur = 0;
    const tracer = () => {
      if (innerWidth <= 860) { serpent.classList.remove('measured'); return; }
      const box = serpent.getBoundingClientRect();
      const W = box.width;
      const etapes = [...serpent.querySelectorAll('.snake-step')];
      const cartes = etapes.map(e => {
        const r = e.querySelector('.mock').getBoundingClientRect();
        return { l: r.left - box.left, r: r.right - box.left, t: r.top - box.top, b: r.bottom - box.top, gauche: e.classList.contains('art-left'), c: getComputedStyle(e).getPropertyValue('--c').trim() };
      });
      if (!cartes.length) return;
      const fin = bandeau ? bandeau.getBoundingClientRect().top - box.top + 14 : box.height + 60;
      const M = 34, R = 58, cx = W / 2;
      let d = '';
      cartes.forEach((k, i) => {
        const haut = k.t - M, bas = k.b + M, milieu = (k.l + k.r) / 2;
        const bord = k.gauche ? k.l - M : k.r + M, s = k.gauche ? 1 : -1;
        // Première maquette : le ruban arrive par le haut ; les suivantes, par la traversée
        if (i === 0) d += 'M' + (milieu + s * 70) + ',' + haut + ' H' + (bord + s * R);
        // Le tour de la maquette par l'extérieur, coins arrondis
        d += ' Q' + bord + ',' + haut + ' ' + bord + ',' + (haut + R)
          + ' V' + (bas - R) + ' Q' + bord + ',' + bas + ' ' + (bord + s * R) + ',' + bas;
        const x0 = bord + s * R;
        const suite = cartes[i + 1];
        if (suite) {
          /*
           * Traversée vers la maquette suivante, de l'autre côté : un seul S
           * large, d'un coin à l'autre, tangentes horizontales aux deux bouts.
           * Avant, un S serré dans un petit écart vertical faisait une marche.
           */
          const haut2 = suite.t - M;
          const bord2 = suite.gauche ? suite.l - M : suite.r + M;
          const x1 = bord2 - s * R;
          const mx = (x0 + x1) / 2;
          d += ' C' + mx + ',' + bas + ' ' + mx + ',' + haut2 + ' ' + x1 + ',' + haut2;
        } else {
          // Dernière : un quart de tour vers le centre, puis tout droit dans le bandeau
          const D = Math.min(90, Math.abs(cx - x0));
          d += ' H' + (cx - s * D) + ' Q' + cx + ',' + bas + ' ' + cx + ',' + (bas + D) + ' V' + fin;
        }
      });
      large.setAttribute('viewBox', '0 0 ' + W + ' ' + fin);
      large.setAttribute('preserveAspectRatio', 'xMinYMin meet');
      large.style.height = fin + 'px';
      // Dégradé : chaque couleur au niveau de son étape, puis celle du bandeau
      let grad = large.querySelector('linearGradient');
      grad.setAttribute('y2', String(fin));
      grad.replaceChildren(...cartes.map(k => {
        const stop = document.createElementNS(NS, 'stop');
        stop.setAttribute('offset', (((k.t + k.b) / 2) / fin).toFixed(3));
        stop.setAttribute('stop-color', k.c);
        return stop;
      }), (() => {
        const stop = document.createElementNS(NS, 'stop');
        stop.setAttribute('offset', '1');
        stop.setAttribute('stop-color', '#4a3ad1');
        return stop;
      })());
      chemin = large.querySelector('path');
      chemin.setAttribute('d', d);
      chemin.removeAttribute('vector-effect');
      longueur = chemin.getTotalLength();
      chemin.style.strokeDasharray = String(longueur);
      serpent.classList.add('measured');
      dessiner();
    };
    const dessiner = () => {
      if (!chemin || calme) { if (chemin) chemin.style.strokeDashoffset = '0'; return; }
      const r = serpent.getBoundingClientRect();
      const vu = Math.min(Math.max((innerHeight * 0.9 - r.top) / (r.height + 80), 0), 1);
      chemin.style.strokeDashoffset = String(longueur * (1 - vu));
    };
    tracer();
    addEventListener('load', tracer);
    let attente = 0;
    addEventListener('resize', () => { clearTimeout(attente); attente = setTimeout(tracer, 120); });
    addEventListener('scroll', dessiner, { passive: true });
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

/**
 * Balise du script, avec l'empreinte de son contenu dans l'adresse : le
 * navigateur garde /site.js en cache, et une nouvelle version doit être
 * prise tout de suite, pas à l'expiration du cache.
 */
export const SITE_JS_TAG = `<script src="/site.js?v=${createHash('sha256').update(SITE_JS).digest('hex').slice(0, 10)}" defer></script>`;
