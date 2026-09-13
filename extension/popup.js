// Logique de popup de l'extension BUM
document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('credential-container');
  const searchInput = document.getElementById('search-box');

  // Récupération de l'onglet actif et de son domaine
  let currentDomain = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      currentDomain = new URL(tab.url).hostname.replace('www.', '');
    }
  } catch {}

  // Simulation / Lecture du stockage chiffré synchronisé
  chrome.storage.local.get(['bum_credentials'], (res) => {
    let creds = res.bum_credentials || [
      { id: '1', title: 'GitHub', username: 'dev@bum-vault.io', password: 'SuperSecretGitHubPassword123!', website: 'https://github.com' },
      { id: '2', title: 'AWS Console', username: 'admin-bum', password: 'AwsSecurePassword999#', website: 'https://aws.amazon.com' },
      { id: '3', title: 'Google Workspace', username: 'contact@bum.com', password: 'WorkspaceSecure2026@', website: 'https://google.com' }
    ];

    const render = (items) => {
      container.innerHTML = '';
      if (items.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:24px;color:#8B949E;font-size:12px;">Aucun compte trouvé.</div>';
        return;
      }

      items.forEach(c => {
        const card = document.createElement('div');
        card.className = 'cred-card';
        card.innerHTML = `
          <div class="cred-info">
            <div class="cred-title">${c.title}</div>
            <div class="cred-user">${c.username}</div>
          </div>
          <button class="autofill-btn" data-id="${c.id}">Remplir</button>
        `;

        card.querySelector('.autofill-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (activeTab?.id) {
            chrome.tabs.sendMessage(activeTab.id, {
              action: 'BUM_AUTOFILL',
              username: c.username,
              password: c.password
            });
            window.close();
          }
        });

        container.appendChild(card);
      });
    };

    // Tri pour mettre en tête le domaine actif
    if (currentDomain) {
      creds.sort((a, b) => {
        const aMatches = (a.website || '').includes(currentDomain);
        const bMatches = (b.website || '').includes(currentDomain);
        return aMatches === bMatches ? 0 : aMatches ? -1 : 1;
      });
    }

    render(creds);

    searchInput?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = creds.filter(c => c.title.toLowerCase().includes(q) || c.username.toLowerCase().includes(q));
      render(filtered);
    });
  });
});
