// Content script pour le remplissage automatique sur la page web
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'BUM_AUTOFILL') {
    const { username, password } = message;

    // Détection des champs de mot de passe
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    if (passwordInputs.length > 0) {
      const pwdField = passwordInputs[0];
      pwdField.value = password;
      pwdField.dispatchEvent(new Event('input', { bubbles: true }));
      pwdField.dispatchEvent(new Event('change', { bubbles: true }));

      // Détection du champ d'identifiant (username, email, text précédent)
      let userField = null;
      const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="email"], input:not([type])'));
      for (const input of inputs) {
        const name = (input.name || input.id || input.placeholder || '').toLowerCase();
        if (name.includes('user') || name.includes('mail') || name.includes('login') || name.includes('identifiant') || name.includes('pseudo')) {
          userField = input;
          break;
        }
      }
      if (!userField && inputs.length > 0) {
        userField = inputs[0];
      }

      if (userField && username) {
        userField.value = username;
        userField.dispatchEvent(new Event('input', { bubbles: true }));
        userField.dispatchEvent(new Event('change', { bubbles: true }));
      }

      sendResponse({ status: 'success' });
      return true;
    }
  }
});
