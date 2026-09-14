export interface FillResult {
  filled: boolean;
  reason?: 'domain' | 'no-fields';
}

/**
 * Injectée dans l'onglet actif au moment du clic sur « Remplir ».
 * Doit rester autonome (aucune référence extérieure) car elle est sérialisée par chrome.scripting.
 * Refuse de remplir si la page n'appartient pas au domaine de l'identifiant (protection anti-hameçonnage).
 */
export function fillLoginForm(username: string, password: string, expectedDomain: string): FillResult {
  const host = location.hostname.toLowerCase().replace(/^www\./, '');
  const domain = expectedDomain.toLowerCase().replace(/^www\./, '');
  if (!domain || !(host === domain || host.endsWith(`.${domain}`))) {
    return { filled: false, reason: 'domain' };
  }

  const isUsable = (input: HTMLInputElement) => {
    const rect = input.getBoundingClientRect();
    const style = getComputedStyle(input);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !input.disabled && !input.readOnly;
  };

  // Compatible avec les champs contrôlés (React, Vue) : passe par le setter natif puis notifie
  const setValue = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    input.focus();
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const passwordField = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]')).find(isUsable);
  const scope: ParentNode = passwordField?.form ?? document;
  const candidates = Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="email"], input[type="text"], input[type="tel"], input:not([type])')).filter(isUsable);

  let userField = candidates.find(input => /user|mail|login|identifiant|account|compte/i.test(`${input.name} ${input.id} ${input.autocomplete} ${input.placeholder}`));
  if (!userField && passwordField) {
    userField = candidates.filter(input => input.compareDocumentPosition(passwordField) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
  }
  userField ??= candidates[0];

  if (!passwordField && !userField) return { filled: false, reason: 'no-fields' };
  if (userField && username) setValue(userField, username);
  if (passwordField) setValue(passwordField, password);
  return { filled: true };
}
