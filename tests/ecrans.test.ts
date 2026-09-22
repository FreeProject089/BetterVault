// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderVersioning, renderTrash, wireVersioning, type VersionsContext } from '../src/ui/versionsPanel';
import { mountTemplateEditor } from '../src/ui/itemTemplatesUi';
import { wireSecurityKeys } from '../src/ui/securityKeysPanel';
import { wireServerSuggestions } from '../src/ui/serverDirectory';
import { profileRowsHtml, wireProfileRows, type ProfileActions } from '../src/ui/accountSwitcher';
import type { CredentialItem, ItemTemplate, TrashEntry } from '../src/types/vault';

/**
 * Écrans, dans un navigateur simulé. Chacun reçoit des données hostiles — elles
 * peuvent venir d'un autre appareil, d'un membre d'un coffre partagé, d'un serveur
 * ou d'un import — et ne doit rien créer d'autre que ce qu'il affiche lui-même.
 */

const XSS = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const tr = (fr: string) => fr;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

/** Rien d'injecté : ni image, ni script, ni attribut d'événement */
function expectClean(root: HTMLElement): void {
  expect(root.querySelector('img, script, iframe')).toBeNull();
  expect([...root.querySelectorAll('*')].some(el => [...el.attributes].some(a => a.name.startsWith('on')))).toBe(false);
  expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
}

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => {
  host.remove();
  vi.restoreAllMocks();
});

describe('Historique et conflits', () => {
  const ctx = (over: Partial<VersionsContext> = {}): VersionsContext => ({
    tr, esc, locale: () => 'fr-FR',
    confirm: async () => true,
    restoreVersion: () => true,
    resolveConflict: () => undefined,
    toast: () => undefined,
    ...over
  });
  const item = {
    id: 'cred-00000001', vaultId: 'vault-0000001', title: 'Banque', username: 'moi', password: 'secret', website: '', tags: [],
    createdAt: 1, updatedAt: 3, rev: 'r3',
    history: [{ rev: 'r1', at: 1, snapshot: { title: XSS, username: XSS } }],
    conflicts: [{ field: 'username', value: XSS, rev: 'r2', at: 2 }]
  } as unknown as CredentialItem;

  it('affiche une valeur concurrente hostile comme du texte', () => {
    host.innerHTML = renderVersioning(item, ctx());
    expectClean(host);
    expect(host.textContent).toContain('deux appareils');
  });

  it('les boutons résolvent le bon conflit et restaurent la bonne version', async () => {
    const resolveConflict = vi.fn();
    const restoreVersion = vi.fn(() => true);
    const c = ctx({ resolveConflict, restoreVersion });
    host.innerHTML = renderVersioning(item, c);
    wireVersioning(host, item, c);
    host.querySelector<HTMLButtonElement>('[data-keep="other"]')!.click();
    await tick();
    expect(resolveConflict).toHaveBeenCalledWith(item.conflicts![0], 'other');
    host.querySelector<HTMLButtonElement>('[data-restore-rev="r1"]')!.click();
    await tick();
    expect(restoreVersion).toHaveBeenCalledWith('r1');
  });

  it('la corbeille échappe les titres', () => {
    const entries = [{ kind: 'credential', item: { id: 'cred-00000002', title: XSS }, deletedAt: Date.now() }] as unknown as TrashEntry[];
    host.innerHTML = renderTrash(entries, ctx(), 30);
    expectClean(host);
    expect(host.querySelector('.trash-title')!.textContent).toBe(XSS);
  });
});

describe('Éditeur de types personnalisés', () => {
  it('crée un type depuis l’écran et montre l’erreur du coffre', async () => {
    let templates: ItemTemplate[] = [];
    const save = vi.fn((input: { name: string; fields: Array<{ label: string }> }) => {
      if (!input.fields.some(f => f.label.trim())) throw new Error('Ajoutez au moins un champ');
      const t = { id: 'tpl-00000001', name: input.name, fields: [], createdAt: 1, updatedAt: 1 } as ItemTemplate;
      templates = [t];
      return t;
    });
    mountTemplateEditor(host, {
      templates: () => templates, save, remove: () => undefined, usage: () => 0,
      confirm: async () => true, toast: () => undefined, errorMessage: e => (e as Error).message, tr, escape: esc
    });
    host.querySelector<HTMLButtonElement>('[data-new]')!.click();
    host.querySelector<HTMLInputElement>('#tpl-name')!.value = XSS;
    host.querySelector<HTMLButtonElement>('[data-save]')!.click();
    expect(host.querySelector('[data-tpl-error]')!.textContent).toBe('Ajoutez au moins un champ');

    host.querySelector<HTMLInputElement>('[data-f="label"]')!.value = 'Clé';
    host.querySelector<HTMLSelectElement>('[data-f="kind"]')!.value = 'secret';
    host.querySelector<HTMLInputElement>('[data-f="required"]')!.checked = true;
    host.querySelector<HTMLButtonElement>('[data-save]')!.click();
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ fields: [expect.objectContaining({ label: 'Clé', kind: 'secret', required: true })] }));
    // Retour à la liste : le nom hostile y est du texte
    expect(host.querySelector('.template-row')).not.toBeNull();
    expectClean(host);
  });
});

describe('Clés de sécurité', () => {
  it('liste des noms hostiles sans les exécuter, et retire avec le mot de passe', async () => {
    host.innerHTML = `<span data-keys-status></span><ul data-keys-list></ul><div data-keys-add hidden></div><button data-action="add-key"></button>`;
    const remove = vi.fn(async () => undefined);
    wireSecurityKeys(host, {
      list: async () => [{ id: 'k1', name: XSS, rpId: 'autre.exemple', createdAt: 1, lastUsedAt: null }],
      add: async () => { throw new Error('non'); },
      remove, tr, escape: esc, errorMessage: e => String(e), toast: () => undefined, locale: 'fr-FR'
    });
    await tick();
    expectClean(host);
    expect(host.querySelector('.security-key strong')!.textContent).toBe(XSS);
    host.querySelector<HTMLButtonElement>('[data-key-remove]')!.click();
    host.querySelector<HTMLInputElement>('[data-key-password]')!.value = 'mot de passe';
    host.querySelector<HTMLButtonElement>('[data-key-confirm]')!.click();
    await tick();
    expect(remove).toHaveBeenCalledWith('mot de passe', 'k1');
    expect(host.querySelector('.security-key')).toBeNull();
  });
});

describe('Serveurs proposés', () => {
  it('n’affiche que les serveurs valides, échappés, et remplit le champ au clic', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      enabled: true,
      servers: [
        { name: XSS, url: 'https://bon.exemple.org', region: XSS, official: true },
        { name: 'Piège', url: 'javascript:alert(1)' }
      ]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    host.innerHTML = '<input id="auth-server" value="https://serveur.exemple.org">';
    wireServerSuggestions(host, tr);
    await tick(); await tick();
    const chips = host.querySelectorAll<HTMLButtonElement>('[data-server-url]');
    expect(chips).toHaveLength(1);
    expectClean(host);
    chips[0].click();
    expect(host.querySelector<HTMLInputElement>('#auth-server')!.value).toBe('https://bon.exemple.org');
  });

  it('reste invisible si le serveur ne répond pas', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('réseau'));
    host.innerHTML = '<input id="auth-server" value="https://serveur.exemple.org">';
    wireServerSuggestions(host, tr);
    await tick(); await tick();
    expect(host.querySelector<HTMLElement>('.server-suggestions')!.hidden).toBe(true);
  });
});

describe('Comptes de l’appareil', () => {
  it('échappe l’adresse et bascule vers le compte choisi', async () => {
    const actions: ProfileActions = {
      list: () => [
        { id: 'principal', email: 'moi@exemple.fr', mode: 'local', lastUsedAt: 2 },
        { id: 'autre0000001', email: XSS, mode: 'cloud', serverUrl: 'https://s.exemple.org', lastUsedAt: 1 }
      ],
      activeId: () => 'principal',
      switchTo: vi.fn(),
      addNew: vi.fn(),
      forget: vi.fn()
    } as unknown as ProfileActions;
    host.innerHTML = profileRowsHtml(actions, tr);
    wireProfileRows(host, actions, async () => true);
    expectClean(host);
    const other = [...host.querySelectorAll<HTMLElement>('button')].find(b => b.textContent!.includes('<img'));
    other!.click();
    await tick();
    expect(actions.switchTo).toHaveBeenCalledWith('autre0000001');
  });
});
