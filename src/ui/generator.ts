import { calculatePasswordEntropy, generateStrongPassword, generatePassphrase, MAX_PASSPHRASE_WORDS, passphraseEntropyBits, secureRandomIndex, type PassphraseCase } from '../crypto/vaultCrypto';
import { tabIcon } from '../ui/tabIcons';
import { GEN_ICONS } from '../ui/icons';
import type { AppController } from '../main';

const GENERATOR_PREFS_KEY = 'bettervault.generator-prefs';

/** Générateur réutilisable : modale dédiée ou panneau intégré au formulaire d'identifiant */
export function mountGenerator(app: AppController, host: HTMLElement, options: { onUse?: (value: string) => void } = {}): { copy: () => Promise<void> } {
  type GeneratorMode = 'password' | 'passphrase' | 'pin';
  type GeneratorPrefs = {
    mode: GeneratorMode;
    length: number;
    uppercase: boolean;
    lowercase: boolean;
    numbers: boolean;
    symbols: boolean;
    avoidAmbiguous: boolean;
    exclude: string;
    words: number;
    separator: string;
    customSeparator: string;
    wordCase: PassphraseCase;
    numberDigits: number;
    includeSymbol: boolean;
    pinLength: number;
  };
  const defaults: GeneratorPrefs = {
    mode: 'password', length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true, avoidAmbiguous: false, exclude: '',
    words: 5, separator: '-', customSeparator: '', wordCase: 'title', numberDigits: 2, includeSymbol: false,
    pinLength: 6
  };
  let prefs: GeneratorPrefs = { ...defaults };
  try {
    const saved = JSON.parse(localStorage.getItem(GENERATOR_PREFS_KEY) ?? '{}') as Partial<GeneratorPrefs> & { capitalize?: boolean; includeNumber?: boolean };
    prefs = { ...defaults, ...saved };
    // Anciennes préférences
    if (saved.wordCase === undefined && saved.capitalize === false) prefs.wordCase = 'lower';
    if (saved.numberDigits === undefined && saved.includeNumber === false) prefs.numberDigits = 0;
  } catch {
    // Préférences illisibles : valeurs par défaut
  }
  const savePrefs = () => {
    try {
      localStorage.setItem(GENERATOR_PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Stockage indisponible (navigation privée)
    }
  };

  const BOUNDS: Record<'length' | 'words' | 'pinLength', [number, number]> = {
    length: [8, 128],
    words: [3, MAX_PASSPHRASE_WORDS],
    pinLength: [4, 12]
  };

  const chip = (key: keyof GeneratorPrefs, label: string, hint: string) => `
    <label class="gen-chip" title="${hint}">
      <input type="checkbox" data-pref="${key}" ${prefs[key] ? 'checked' : ''}>
      <span>${label}</span>
    </label>`;
  const slider = (key: keyof typeof BOUNDS, label: string) => `
    <div class="gen-slider-row">
      <span class="form-label">${label}</span>
      <input type="range" min="${BOUNDS[key][0]}" max="${BOUNDS[key][1]}" value="${prefs[key]}" data-pref="${key}" aria-label="${label}">
      <input type="number" class="form-input gen-number" min="${BOUNDS[key][0]}" max="${BOUNDS[key][1]}" value="${prefs[key]}" data-pref="${key}" aria-label="${label}">
    </div>`;
  const select = (key: keyof GeneratorPrefs, label: string, choices: Array<[string | number, string]>) => `
    <div class="form-field">
      <label class="form-label">${label}</label>
      <select class="form-input" data-pref="${key}" aria-label="${label}">
        ${choices.map(([value, text]) => `<option value="${value}" ${String(prefs[key]) === String(value) ? 'selected' : ''}>${text}</option>`).join('')}
      </select>
    </div>`;

  host.innerHTML = `
    <div class="gen">
      <div class="gen-output-card">
        <div class="gen-output" data-gen="output" aria-live="polite" title="${app.tr('Cliquer pour copier', 'Click to copy')}"></div>
        <div class="gen-output-actions">
          <button type="button" class="icon-btn" data-gen="refresh" title="${app.tr('Régénérer (R)', 'Regenerate (R)')}">${GEN_ICONS.refresh}</button>
          <button type="button" class="icon-btn" data-gen="copy" title="${app.tr('Copier', 'Copy')}">${GEN_ICONS.copy}</button>
        </div>
      </div>
      <div class="gen-strength">
        <div class="strength-meter" data-gen="meter">${'<div class="strength-segment"></div>'.repeat(4)}</div>
        <span class="gen-strength-label" data-gen="strength"></span>
      </div>
      <div class="tab-btn-group" role="tablist">
        <button type="button" class="tab-btn" role="tab" data-mode="password">${tabIcon('password')}<span>${app.tr('Mot de passe', 'Password')}</span></button>
        <button type="button" class="tab-btn" role="tab" data-mode="passphrase">${tabIcon('passphrase')}<span>${app.tr('Phrase secrète', 'Passphrase')}</span></button>
        <button type="button" class="tab-btn" role="tab" data-mode="pin">${tabIcon('pin')}<span>${app.tr('Code PIN', 'PIN')}</span></button>
      </div>

      <div class="gen-section" data-section="password">
        ${slider('length', app.tr('Longueur', 'Length'))}
        <div class="gen-chips">
          ${chip('uppercase', 'A–Z', app.tr('Majuscules', 'Uppercase'))}
          ${chip('lowercase', 'a–z', app.tr('Minuscules', 'Lowercase'))}
          ${chip('numbers', '0–9', app.tr('Chiffres', 'Digits'))}
          ${chip('symbols', '!@#$', app.tr('Symboles', 'Symbols'))}
          ${chip('avoidAmbiguous', app.tr('Sans ambigus', 'No look-alikes'), app.tr('Exclut 0/O, 1/l/I', 'Excludes 0/O, 1/l/I'))}
        </div>
        <div class="form-field">
          <label class="form-label">${app.tr('Caractères à exclure', 'Characters to exclude')}</label>
          <input class="form-input" type="text" data-pref="exclude" value="${app.escapeHtml(prefs.exclude)}" placeholder="${app.tr('Ex. : {}[]<>"\'', 'E.g. {}[]<>"\'')}" spellcheck="false" autocomplete="off" style="font-family:var(--font-mono);">
        </div>
      </div>

      <div class="gen-section" data-section="passphrase">
        ${slider('words', app.tr('Mots', 'Words'))}
        <div class="gen-grid">
          ${select('separator', app.tr('Séparateur', 'Separator'), [
            ['-', app.tr('Tiret  -', 'Dash  -')],
            [' ', app.tr('Espace', 'Space')],
            ['.', app.tr('Point  .', 'Dot  .')],
            [',', app.tr('Virgule  ,', 'Comma  ,')],
            ['_', app.tr('Tiret bas  _', 'Underscore  _')],
            ['', app.tr('Aucun', 'None')],
            ['custom', app.tr('Personnalisé', 'Custom')]
          ])}
          <div class="form-field" data-custom-separator>
            <label class="form-label">${app.tr('Séparateur personnalisé', 'Custom separator')}</label>
            <input class="form-input" type="text" maxlength="5" data-pref="customSeparator" value="${app.escapeHtml(prefs.customSeparator)}" spellcheck="false" autocomplete="off" style="font-family:var(--font-mono);">
          </div>
          ${select('wordCase', app.tr('Casse des mots', 'Word case'), [
            ['lower', app.tr('minuscules', 'lowercase')],
            ['title', app.tr('Majuscule initiale', 'Capitalized')],
            ['upper', app.tr('MAJUSCULES', 'UPPERCASE')],
            ['random', app.tr('Aléatoire', 'Random')]
          ])}
          ${select('numberDigits', app.tr('Nombre ajouté', 'Added number'), [
            [0, app.tr('Aucun', 'None')],
            [1, app.tr('1 chiffre', '1 digit')],
            [2, app.tr('2 chiffres', '2 digits')],
            [3, app.tr('3 chiffres', '3 digits')],
            [4, app.tr('4 chiffres', '4 digits')]
          ])}
        </div>
        <div class="gen-chips">
          ${chip('includeSymbol', app.tr('+ symbole', '+ symbol'), app.tr('Ajoute un symbole à la fin', 'Append a symbol'))}
        </div>
        <p class="gen-mode-hint">${app.tr('Mots tirés de la liste EFF (7 776 mots) : chaque mot ajoute environ 12,9 bits. Facile à retenir et à taper.', 'Words from the EFF list (7,776 words): each word adds about 12.9 bits. Easy to remember and type.')}</p>
      </div>

      <div class="gen-section" data-section="pin">
        ${slider('pinLength', app.tr('Chiffres', 'Digits'))}
        <p class="gen-mode-hint">${app.tr('Pour un téléphone, une carte ou un cadenas. Trop court pour protéger un compte en ligne.', 'For a phone, a card or a lock. Too short to protect an online account.')}</p>
      </div>

      ${options.onUse ? `
        <div class="gen-use-row">
          <button type="button" class="btn-primary btn-accent" data-gen="use">${app.tr('Utiliser', 'Use')}</button>
        </div>` : ''}
    </div>`;

  const query = <T extends HTMLElement = HTMLElement>(selector: string) => host.querySelector(selector) as T;
  const output = query('[data-gen="output"]');
  const charsetKeys: Array<keyof GeneratorPrefs> = ['uppercase', 'lowercase', 'numbers', 'symbols'];
  let value = '';

  const passphraseOptions = () => ({
    wordCount: prefs.words,
    separator: prefs.separator === 'custom' ? prefs.customSeparator : prefs.separator,
    wordCase: prefs.wordCase,
    includeNumber: prefs.numberDigits > 0,
    numberDigits: prefs.numberDigits,
    includeSymbol: prefs.includeSymbol
  });

  const strength = () => {
    if (prefs.mode === 'password') return calculatePasswordEntropy(value);
    const bits = prefs.mode === 'pin' ? Math.round(prefs.pinLength * Math.log2(10)) : passphraseEntropyBits(passphraseOptions());
    const score = bits >= 75 ? 4 : bits >= 55 ? 3 : bits >= 36 ? 2 : 1;
    const labels = ['', app.tr('Faible', 'Weak'), app.tr('Moyen', 'Fair'), app.tr('Fort', 'Strong'), app.tr('Excellent', 'Excellent')];
    const colors = ['', '#DA3633', '#D29922', '#2EA043', '#238636'];
    return { bits, score, label: labels[score], color: colors[score] };
  };

  const render = () => {
    output.innerHTML = Array.from(value).map(ch => {
      const kind = /[0-9]/.test(ch) ? 'gen-digit' : /[A-Za-z\s]/.test(ch) ? '' : 'gen-symbol';
      const safe = app.escapeHtml(ch);
      return kind ? `<span class="${kind}">${safe}</span>` : safe;
    }).join('');
    const s = strength();
    host.querySelectorAll<HTMLElement>('[data-gen="meter"] .strength-segment').forEach((segment, i) => {
      segment.style.backgroundColor = i < s.score ? s.color : '';
    });
    const label = query('[data-gen="strength"]');
    label.textContent = value ? `${s.label} · ≈ ${s.bits} bits` : '';
    label.style.color = s.color;
  };

  const generate = () => {
    try {
      if (prefs.mode === 'password') {
        value = generateStrongPassword({
          length: prefs.length,
          uppercase: prefs.uppercase,
          lowercase: prefs.lowercase,
          numbers: prefs.numbers,
          symbols: prefs.symbols,
          avoidAmbiguous: prefs.avoidAmbiguous,
          exclude: prefs.exclude
        });
      } else if (prefs.mode === 'passphrase') {
        value = generatePassphrase(passphraseOptions());
      } else {
        value = Array.from({ length: prefs.pinLength }, () => String(secureRandomIndex(10))).join('');
      }
    } catch {
      value = '';
      app.showToast(app.tr('Trop de caractères exclus', 'Too many excluded characters'), 'error');
    }
    render();
    output.classList.remove('gen-flash');
    void output.offsetWidth;
    output.classList.add('gen-flash');
  };

  const syncControls = () => {
    host.querySelectorAll<HTMLElement>('[data-mode]').forEach(button => {
      const active = button.dataset.mode === prefs.mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    host.querySelectorAll<HTMLElement>('[data-section]').forEach(section => {
      section.hidden = section.dataset.section !== prefs.mode;
    });
    (Object.keys(BOUNDS) as Array<keyof typeof BOUNDS>).forEach(key => {
      host.querySelectorAll<HTMLInputElement>(`input[data-pref="${key}"]`).forEach(input => { input.value = String(prefs[key]); });
    });
    query('[data-custom-separator]').hidden = prefs.separator !== 'custom';
  };

  host.querySelectorAll<HTMLElement>('[data-mode]').forEach(button => {
    button.addEventListener('click', () => {
      prefs.mode = button.dataset.mode as GeneratorMode;
      syncControls();
      savePrefs();
      generate();
    });
  });

  host.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-pref]').forEach(control => {
    const key = control.dataset.pref as keyof GeneratorPrefs;
    const isNumberField = control instanceof HTMLInputElement && control.type === 'number';

    control.addEventListener('input', () => {
      if (control instanceof HTMLInputElement && control.type === 'checkbox') {
        if (charsetKeys.includes(key) && !control.checked && charsetKeys.every(k => k === key || !prefs[k])) {
          control.checked = true;
          app.showToast(app.tr('Gardez au moins un type de caractères', 'Keep at least one character type'), 'info', 1800);
          return;
        }
        (prefs as Record<string, unknown>)[key] = control.checked;
      } else if (key === 'length' || key === 'words' || key === 'pinLength') {
        const [min, max] = BOUNDS[key];
        const n = parseInt(control.value, 10);
        // Saisie en cours dans le champ numérique (ex. « 1 » avant « 16 ») : on attend une valeur valide
        if (!Number.isFinite(n) || (isNumberField && (n < min || n > max))) return;
        prefs[key] = Math.min(max, Math.max(min, n));
      } else if (key === 'numberDigits') {
        prefs.numberDigits = parseInt(control.value, 10) || 0;
      } else {
        (prefs as Record<string, unknown>)[key] = control.value;
      }
      if (!isNumberField) syncControls();
      else host.querySelectorAll<HTMLInputElement>(`input[type="range"][data-pref="${key}"]`).forEach(range => { range.value = control.value; });
      savePrefs();
      generate();
    });

    if (isNumberField) control.addEventListener('change', syncControls);
  });

  const copy = async () => {
    if (!value) return;
    await app.copyToClipboardWithAutoClear(value, app.tr('Copié', 'Copied'), true);
    const button = query('[data-gen="copy"]');
    button.classList.add('copied');
    setTimeout(() => button.classList.remove('copied'), 500);
  };

  query('[data-gen="refresh"]').addEventListener('click', generate);
  query('[data-gen="copy"]').addEventListener('click', () => void copy());
  output.addEventListener('click', () => void copy());
  if (options.onUse) query('[data-gen="use"]').addEventListener('click', () => { if (value) options.onUse?.(value); });

  host.addEventListener('keydown', e => {
    const target = e.target as HTMLElement;
    const typing = target instanceof HTMLSelectElement || (target instanceof HTMLInputElement && ['number', 'text'].includes(target.type));
    if ((e.key === 'r' || e.key === 'R') && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      generate();
    }
  });
  // La touche R fonctionne aussi quand le focus est sur le bouton Copier du pied de modale
  host.closest('.modal-box')?.querySelector('.modal-footer')?.addEventListener('keydown', e => {
    const key = (e as KeyboardEvent).key;
    if (key === 'r' || key === 'R') generate();
  });

  syncControls();
  generate();
  return { copy };
}
