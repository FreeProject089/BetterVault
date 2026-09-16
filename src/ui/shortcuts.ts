/**
 * Raccourcis clavier personnalisables, enregistrés sur l'appareil (préférence d'affichage, rien de sensible).
 *
 * Une combinaison s'écrit « Mod+Shift+K » : Mod vaut Ctrl sous Windows et Linux, Cmd sous macOS.
 */

export type ShortcutAction =
  | 'search'
  | 'newItem'
  | 'generator'
  | 'lock'
  | 'sync'
  | 'viewCredentials'
  | 'view2fa'
  | 'viewTasks'
  | 'importExport'
  | 'account'
  | 'help';

export type ShortcutBindings = Record<ShortcutAction, string>;

export const DEFAULT_SHORTCUTS: ShortcutBindings = {
  search: 'Mod+K',
  newItem: 'Mod+N',
  generator: 'Mod+G',
  lock: 'Mod+L',
  sync: 'Mod+Shift+S',
  viewCredentials: 'Alt+1',
  view2fa: 'Alt+2',
  viewTasks: 'Alt+3',
  importExport: 'Mod+Shift+E',
  account: 'Mod+,',
  help: '?'
};

export const SHORTCUT_ORDER: ShortcutAction[] = ['search', 'newItem', 'generator', 'lock', 'sync', 'viewCredentials', 'view2fa', 'viewTasks', 'importExport', 'account', 'help'];

/** Combinaisons que le navigateur ou le système gardent pour eux : refusées à l'enregistrement */
const RESERVED = new Set(['Mod+W', 'Mod+T', 'Mod+Q', 'Mod+R', 'Mod+Shift+T', 'Mod+Shift+N', 'Mod+Tab', 'Alt+F4', 'Mod+C', 'Mod+V', 'Mod+X', 'Mod+A', 'Mod+Z']);

const STORAGE_KEY = 'bettervault-shortcuts';
const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Shift', 'Alt', 'AltGraph', 'CapsLock', 'Fn', 'OS']);

export const isMacPlatform = () => /Mac|iPhone|iPad/i.test(globalThis.navigator?.platform || globalThis.navigator?.userAgent || '');

/** Nom de touche stable, indépendant de la disposition pour les lettres et chiffres (code physique) */
function keyName(e: Pick<KeyboardEvent, 'key' | 'code'>): string {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
  if (/^F\d{1,2}$/.test(e.key)) return e.key;
  const named: Record<string, string> = { ' ': 'Space', Escape: 'Esc', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
  if (named[e.key]) return named[e.key];
  return e.key.length === 1 ? e.key.toUpperCase() : e.key;
}

/** Combinaison correspondant à un événement, ou null pour une touche de modification seule */
export function bindingFromEvent(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const key = keyName(e);
  // « ? » s'obtient avec Shift sur la plupart des claviers : on garde le caractère seul
  const printableSymbol = e.key.length === 1 && !/[a-z0-9]/i.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey;
  if (printableSymbol) return e.key;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

export function matchesBinding(e: KeyboardEvent, binding: string): boolean {
  return !!binding && bindingFromEvent(e) === binding;
}

/** Une touche seule (sans Ctrl/Cmd/Alt) ne doit pas se déclencher pendant la saisie */
export const isPlainKey = (binding: string) => !/^(Mod|Alt)\+/.test(binding);

export function formatBinding(binding: string, mac = isMacPlatform()): string {
  if (!binding) return '—';
  if (binding.length === 1) return binding;
  return binding.split('+').map(part => {
    if (part === 'Mod') return mac ? '⌘' : 'Ctrl';
    if (part === 'Alt') return mac ? '⌥' : 'Alt';
    if (part === 'Shift') return mac ? '⇧' : 'Maj';
    return part;
  }).join(mac ? '' : ' + ');
}

export type BindingProblem = { kind: 'reserved' } | { kind: 'conflict'; action: ShortcutAction } | { kind: 'needsModifier' } | null;

/** Vérifie une combinaison avant de l'attribuer à `action` */
export function checkBinding(bindings: ShortcutBindings, action: ShortcutAction, binding: string): BindingProblem {
  if (RESERVED.has(binding)) return { kind: 'reserved' };
  // Une lettre ou un chiffre seul gênerait la saisie au clavier : Ctrl/Cmd ou Alt demandé
  if (/^[A-Z0-9]$/.test(binding) || /^Shift\+[A-Z0-9]$/.test(binding)) return { kind: 'needsModifier' };
  const other = SHORTCUT_ORDER.find(a => a !== action && bindings[a] === binding);
  return other ? { kind: 'conflict', action: other } : null;
}

export function loadShortcuts(storage: Pick<Storage, 'getItem'> | null = globalThis.localStorage ?? null): ShortcutBindings {
  const result = { ...DEFAULT_SHORTCUTS };
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}') as Partial<Record<string, unknown>>;
    for (const action of SHORTCUT_ORDER) {
      const value = saved[action];
      if (typeof value === 'string' && value.length <= 40) result[action] = value;
    }
  } catch {
    // Préférence illisible : raccourcis par défaut
  }
  return result;
}

export function saveShortcuts(bindings: ShortcutBindings, storage: Pick<Storage, 'setItem'> | null = globalThis.localStorage ?? null): void {
  const changed = Object.fromEntries(SHORTCUT_ORDER.filter(a => bindings[a] !== DEFAULT_SHORTCUTS[a]).map(a => [a, bindings[a]]));
  storage?.setItem(STORAGE_KEY, JSON.stringify(changed));
}
