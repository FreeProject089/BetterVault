import type { Plugin } from 'vite';

/**
 * Catalogue des textes à traduire, publié avec l'application sous
 * `/i18n/source.json` : c'est le fichier que l'administration télécharge pour
 * préparer une nouvelle langue.
 *
 * Il est produit à la construction (et à la demande pendant le développement)
 * plutôt que rangé dans le dépôt : il ne peut donc pas prendre du retard sur le
 * code. Voir `scripts/i18n-catalog.mjs`.
 */
export function i18nCatalogPlugin(): Plugin {
  const build = async () => {
    // Module JavaScript sans types : chargé à l'exécution, comme en ligne de commande
    const { buildCatalog } = await import('../scripts/i18n-catalog.mjs') as { buildCatalog: () => unknown };
    return JSON.stringify(buildCatalog());
  };

  return {
    name: 'bettervault-i18n-catalog',

    // Développement : servi à la volée, toujours à jour
    configureServer(server) {
      server.middlewares.use('/i18n/source.json', (_req, res) => {
        void build().then(json => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(json);
        }).catch(err => {
          res.statusCode = 500;
          res.end(String(err));
        });
      });
    },

    // Construction : un fichier de plus dans `dist/`
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'i18n/source.json', source: await build() });
    }
  };
}
