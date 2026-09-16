import { describe, it, expect } from 'vitest';
import { bindingFromEvent, checkBinding, DEFAULT_SHORTCUTS, formatBinding, isPlainKey, loadShortcuts, saveShortcuts } from '../src/ui/shortcuts';

const key = (over: Partial<KeyboardEvent>) => ({ key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over }) as KeyboardEvent;

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

describe('Raccourcis clavier', () => {
  it('lit la combinaison indépendamment de la disposition du clavier', () => {
    // AZERTY : la touche physique Q (code KeyA côté QWERTY) produit « q » mais reste « A »
    expect(bindingFromEvent(key({ key: 'q', code: 'KeyA', ctrlKey: true }))).toBe('Mod+A');
    expect(bindingFromEvent(key({ key: 'k', code: 'KeyK', metaKey: true, shiftKey: true }))).toBe('Mod+Shift+K');
    expect(bindingFromEvent(key({ key: '&', code: 'Digit1', altKey: true }))).toBe('Alt+1');
    expect(bindingFromEvent(key({ key: '?', code: 'Comma', shiftKey: true }))).toBe('?');
    expect(bindingFromEvent(key({ key: 'Control', code: 'ControlLeft', ctrlKey: true }))).toBeNull();
  });

  it('refuse les combinaisons réservées, en double ou sans modificateur', () => {
    expect(checkBinding(DEFAULT_SHORTCUTS, 'search', 'Mod+W')).toEqual({ kind: 'reserved' });
    expect(checkBinding(DEFAULT_SHORTCUTS, 'search', 'Mod+L')).toEqual({ kind: 'conflict', action: 'lock' });
    expect(checkBinding(DEFAULT_SHORTCUTS, 'search', 'J')).toEqual({ kind: 'needsModifier' });
    expect(checkBinding(DEFAULT_SHORTCUTS, 'search', 'Mod+J')).toBeNull();
    expect(checkBinding(DEFAULT_SHORTCUTS, 'search', 'Mod+K')).toBeNull();
  });

  it('enregistre seulement les changements et ignore une préférence invalide', () => {
    const storage = new MemoryStorage();
    saveShortcuts({ ...DEFAULT_SHORTCUTS, lock: 'Mod+Shift+L' }, storage);
    expect(JSON.parse(storage.getItem('bettervault-shortcuts')!)).toEqual({ lock: 'Mod+Shift+L' });
    expect(loadShortcuts(storage).lock).toBe('Mod+Shift+L');
    expect(loadShortcuts(storage).search).toBe('Mod+K');
    storage.setItem('bettervault-shortcuts', '{pas du json');
    expect(loadShortcuts(storage)).toEqual(DEFAULT_SHORTCUTS);
  });

  it('affiche la combinaison selon le système', () => {
    expect(formatBinding('Mod+Shift+K', true)).toBe('⌘⇧K');
    expect(formatBinding('Mod+Shift+K', false)).toBe('Ctrl + Maj + K');
    expect(formatBinding('', false)).toBe('—');
    expect(isPlainKey('?')).toBe(true);
    expect(isPlainKey('Alt+1')).toBe(false);
  });
});
