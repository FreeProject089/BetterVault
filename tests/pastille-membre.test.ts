// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { memberAvatarHtml, memberChipHtml, memberHue, memberInitial } from '../src/ui/memberChip';

/**
 * Pastille d'une personne : la couleur est calculée, donc deux appareils
 * affichent la même sans rien synchroniser. Et une adresse vient d'un autre
 * membre du coffre : elle ne doit pas pouvoir sortir de son attribut.
 */

const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

describe('Pastille d’un membre', () => {
  it('donne la même teinte pour la même adresse, quelle que soit la casse', () => {
    expect(memberHue('Bob@Exemple.FR')).toBe(memberHue('bob@exemple.fr'));
    // Deux adresses proches ne doivent pas se confondre
    expect(memberHue('bob@exemple.fr')).not.toBe(memberHue('bib@exemple.fr'));
  });

  it('reste hors de la plage rouge, réservée aux alertes', () => {
    for (const nom of ['a', 'bob@exemple.fr', 'zoe.martin@societe.example', '0@1', 'éric@exemple.fr']) {
      const teinte = memberHue(nom);
      expect(teinte).toBeGreaterThanOrEqual(30);
      expect(teinte).toBeLessThanOrEqual(329);
    }
  });

  it('prend la première lettre ou chiffre, même derrière de la ponctuation', () => {
    expect(memberInitial('bob@exemple.fr')).toBe('B');
    expect(memberInitial('  éric@exemple.fr')).toBe('É');
    expect(memberInitial('"><img>@x')).toBe('I');
    expect(memberInitial('7ico@x.fr')).toBe('7');
    expect(memberInitial('   ')).toBe('?');
  });

  it('échappe l’adresse partout où elle apparaît', () => {
    const hostile = '"><img src=x onerror=alert(1)>@exemple.fr';
    for (const html of [memberAvatarHtml(hostile, esc), memberChipHtml(hostile, esc)]) {
      // On juge sur le document obtenu, pas sur le texte : c'est ce que voit le navigateur
      const hote = document.createElement('div');
      hote.innerHTML = html;
      expect(hote.querySelector('img, script, iframe')).toBeNull();
      expect([...hote.querySelectorAll('*')].some(el => [...el.attributes].some(a => a.name.startsWith('on')))).toBe(false);
      // L'adresse hostile est bien là, mais comme texte dans un attribut
      expect(hote.querySelector('.member-dot')!.getAttribute('title')).toBe(hostile);
    }
    // La version avec l'adresse écrite en clair l'affiche comme texte, pas comme balise
    const chip = document.createElement('div');
    chip.innerHTML = memberChipHtml(hostile, esc);
    expect(chip.querySelector('.member-chip-text')!.textContent).toBe(hostile);
  });

  it('marque sa propre pastille, pour se retrouver dans une liste', () => {
    const mien = memberAvatarHtml('moi@exemple.fr', esc, { me: 'MOI@exemple.fr' });
    const autre = memberAvatarHtml('bob@exemple.fr', esc, { me: 'moi@exemple.fr' });
    expect(mien).toContain('member-dot-self');
    expect(autre).not.toContain('member-dot-self');
  });
});
