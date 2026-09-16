# Espace supplémentaire payant (Stripe)

Fonction **facultative**, désactivée par défaut. Elle permet à un hébergeur de proposer plus d'espace de pièces jointes, plus de coffres ou des coffres plus gros, sans rien changer au chiffrement : les offres n'agissent que sur les limites du compte.

## Mise en route

1. Dans Stripe, créez un produit et un **prix** (abonnement mensuel ou paiement unique). Notez son identifiant `price_…`.
2. Dans `.env` :

   ```bash
   BILLING_ENABLED=true
   STRIPE_SECRET_KEY=sk_live_…
   STRIPE_WEBHOOK_SECRET=whsec_…
   PUBLIC_URL=https://vault.exemple.fr
   ```

3. Dans Stripe, créez un webhook vers `https://votre-domaine/api/v1/billing/webhook` avec les événements :
   `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.
4. Dans `/admin`, onglet **Offres**, ajoutez chaque offre : nom, prix affiché, identifiant de prix Stripe, et l'espace ajouté.

Les offres apparaissent alors dans **Compte › Espace** dans les applications.

## Ce qui est envoyé à Stripe

| Donnée | Envoyée |
| --- | --- |
| Identifiant interne du compte | Oui (référence de la commande) |
| Identifiant de l'offre | Oui |
| Adresse email du compte | Non — Stripe la demande lui-même au client |
| Carte bancaire, adresse de facturation | Jamais vues par BetterVault : la saisie a lieu sur Stripe Checkout |
| Contenu des coffres | Jamais |

L'abonnement est activé et arrêté par le webhook signé de Stripe, jamais par l'application. La signature est vérifiée (HMAC-SHA256, tolérance de 5 minutes) et chaque événement n'est traité qu'une fois.

## Limites ajoutées

Une offre ajoute aux limites du serveur, pour le compte abonné uniquement :

- espace total des pièces jointes ;
- taille maximale d'un fichier ;
- taille maximale d'un coffre chiffré ;
- nombre de coffres ;
- nombre d'identifiants par coffre.

À la fin de l'abonnement, les limites reviennent à celles du serveur. Les données déjà stockées ne sont pas supprimées : les envois suivants sont refusés tant que l'espace dépasse le quota.
