// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initCustomSelects } from '../src/ui/customSelect';

/**
 * Liste déroulante dessinée par l'application. La vraie <select> reste la
 * source de vérité : les formulaires et les écouteurs existants ne doivent
 * voir aucune différence.
 */

const tick = () => new Promise(r => setTimeout(r, 0));
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

let select: HTMLSelectElement;

beforeEach(() => {
  document.body.innerHTML = `
    <label for="choix">Rythme</label>
    <select class="form-input" id="choix">
      <option value="m">Mensuel</option>
      <option value="a" selected>Annuel</option>
      <option value="v">À vie</option>
      <option value="x" hidden>Caché</option>
    </select>`;
  select = document.getElementById('choix') as HTMLSelectElement;
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('fine'), media: q, addEventListener() {}, removeEventListener() {} }));
});

describe('Liste déroulante', () => {
  it('montre la valeur en cours et reprend le nom de son libellé', () => {
    initCustomSelects();
    const button = document.querySelector('.cselect-button')!;
    expect(button.textContent).toBe('Annuel');
    expect(button.getAttribute('aria-label')).toBe('Rythme');
  });

  it('change la vraie liste et prévient ses écouteurs', () => {
    initCustomSelects();
    const onChange = vi.fn();
    select.addEventListener('change', onChange);
    (document.querySelector('.cselect-button') as HTMLButtonElement).click();
    const options = [...document.querySelectorAll('.cselect-option')];
    // L'option cachée ne s'affiche pas
    expect(options.map(o => o.textContent)).toEqual(['Mensuel', 'Annuel', 'À vie']);
    (options[2] as HTMLElement).click();
    expect(select.value).toBe('v');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.cselect-list')).toBeNull();
    expect(document.querySelector('.cselect-button')!.textContent).toBe('À vie');
  });

  it('se commande au clavier, comme une liste native', () => {
    initCustomSelects();
    const button = document.querySelector('.cselect-button')!;
    key(button, 'ArrowDown');
    expect(document.querySelector('.cselect-list')).not.toBeNull();
    key(button, 'ArrowDown');
    key(button, 'Enter');
    expect(select.value).toBe('v');
    key(button, 'ArrowDown');
    key(button, 'm');
    key(button, 'Enter');
    expect(select.value).toBe('m');
    key(button, 'ArrowDown');
    key(button, 'Escape');
    expect(document.querySelector('.cselect-list')).toBeNull();
  });

  it('suit une valeur changée par le code', async () => {
    initCustomSelects();
    select.value = 'm';
    select.dispatchEvent(new Event('change'));
    expect(document.querySelector('.cselect-button')!.textContent).toBe('Mensuel');
  });

  it('affiche les options comme du texte', () => {
    select.innerHTML = '<option>&lt;img src=x onerror=alert(1)&gt;</option>';
    initCustomSelects();
    (document.querySelector('.cselect-button') as HTMLButtonElement).click();
    expect(document.querySelector('.cselect-list img')).toBeNull();
  });

  it('améliore aussi les listes ajoutées après coup', async () => {
    initCustomSelects();
    const autre = document.createElement('select');
    autre.className = 'form-input';
    autre.innerHTML = '<option>Un</option>';
    document.body.append(autre);
    await tick();
    expect(autre.hasAttribute('data-custom-select')).toBe(true);
  });

  it('laisse la liste native au doigt, même pour une liste ajoutée après coup', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
    const tactile = document.createElement('select');
    tactile.className = 'form-input';
    tactile.innerHTML = '<option>Un</option>';
    document.body.append(tactile);
    await tick();
    initCustomSelects();
    expect(tactile.hasAttribute('data-custom-select')).toBe(false);
    expect(tactile.closest('.cselect')).toBeNull();
  });
});
