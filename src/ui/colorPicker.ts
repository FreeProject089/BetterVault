export interface ColorPickerHandle {
  getValue(): string;
  setValue(color: string): void;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Nuancier + sélecteur de couleur exacte + saisie hexadécimale */
export function mountColorPicker(host: HTMLElement, options: {
  value: string;
  presets: readonly string[];
  label: string;
  customLabel: string;
  onChange?: (color: string) => void;
}): ColorPickerHandle {
  let value = HEX.test(options.value) ? options.value.toLowerCase() : options.presets[0];

  host.classList.add('color-picker');
  host.innerHTML = `
    <div class="color-swatches" role="radiogroup">
      ${options.presets.map(color => `<button type="button" class="color-swatch" role="radio" data-color="${color}" style="--swatch:${color}" aria-label="${color}"></button>`).join('')}
    </div>
    <label class="color-custom" title="">
      <input type="color" class="color-native">
      <span class="color-custom-preview"></span>
    </label>
    <input type="text" class="form-input color-hex" maxlength="7" spellcheck="false" autocomplete="off">`;

  const swatches = host.querySelector('.color-swatches') as HTMLElement;
  const native = host.querySelector('.color-native') as HTMLInputElement;
  const hex = host.querySelector('.color-hex') as HTMLInputElement;
  const custom = host.querySelector('.color-custom') as HTMLElement;
  swatches.setAttribute('aria-label', options.label);
  custom.title = options.customLabel;
  native.setAttribute('aria-label', options.customLabel);
  hex.setAttribute('aria-label', `${options.label} (hex)`);

  const render = () => {
    swatches.querySelectorAll<HTMLElement>('.color-swatch').forEach(swatch => {
      const selected = swatch.dataset.color === value;
      swatch.classList.toggle('selected', selected);
      swatch.setAttribute('aria-checked', String(selected));
    });
    const isCustom = !options.presets.includes(value);
    custom.classList.toggle('selected', isCustom);
    custom.style.setProperty('--swatch', value);
    native.value = value;
    if (document.activeElement !== hex) hex.value = value;
  };

  const set = (color: string, notify = true) => {
    if (!HEX.test(color)) return;
    value = color.toLowerCase();
    render();
    if (notify) options.onChange?.(value);
  };

  swatches.addEventListener('click', e => {
    const color = (e.target as HTMLElement).closest<HTMLElement>('.color-swatch')?.dataset.color;
    if (color) set(color);
  });
  native.addEventListener('input', () => set(native.value));
  hex.addEventListener('input', () => {
    const typed = hex.value.startsWith('#') ? hex.value : `#${hex.value}`;
    hex.classList.toggle('invalid', !HEX.test(typed) && typed.length === 7);
    if (HEX.test(typed)) set(typed);
  });
  hex.addEventListener('blur', () => {
    hex.classList.remove('invalid');
    hex.value = value;
  });

  render();
  return { getValue: () => value, setValue: color => set(color, false) };
}
