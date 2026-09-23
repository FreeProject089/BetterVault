# Espace supplémentaire payant (Stripe)

Fonction **facultative**, désactivée par défaut. Elle permet à un hébergeur de proposer plus d'espace de pièces jointes, plus de coffres ou des coffres plus gros, sans rien changer au chiffrement : les offres n'agissent que sur les limites du compte.

## Mise en route

Tout se fait depuis `/admin`, onglet **Offres** : aucun produit à préparer à la main dans Stripe.

:::steps
:::step[Clé secrète Stripe]
Stripe → **Développeurs → Clés API**. Une **clé restreinte** (`rk_…`) suffit, avec au minimum :

| Ressource | Accès |
| --- | --- |
| Products | Écriture |
| Prices | Écriture |
| Checkout Sessions | Écriture |
| Subscriptions | Lecture et écriture (renouvellement automatique) |
| Customers | Lecture |

Collez-la dans **Offres → Clé secrète Stripe**.
:::
:::step[Webhook]
Stripe → **Développeurs → Webhooks → Ajouter un endpoint**. L'onglet Offres affiche l'adresse exacte (`https://votre-domaine/api/v1/billing/webhook`, d'après `PUBLIC_URL`) et les événements à cocher :

`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.

Collez ensuite le **secret de signature** (`whsec_…`).
:::
:::step[Offres]
**Ajouter une offre** : nom, description, l'espace ajouté, puis un ou plusieurs tarifs avec **montant, devise et période** (par mois, par an, une fois).
:::
:::step[Créer dans Stripe]
Le bouton **Créer dans Stripe** enregistre les réglages, crée un produit par offre et un prix par tarif, puis note leurs identifiants. Chaque tarif affiche alors « Créé dans Stripe ».
:::
:::

:::tip[Un prix déjà créé dans Stripe ?]
Collez son identifiant `price_…` dans le champ du tarif : il est utilisé tel quel, rien n'est recréé.
:::

:::warning[Changer un montant]
Un prix Stripe ne change jamais de montant. Pour changer un tarif, ajoutez-en un nouveau et retirez l'ancien : les abonnements en cours gardent leur prix.
:::

Les offres apparaissent alors dans **Compte › Espace** dans les applications, et sur la page publique **`/tarifs`**.

Le même réglage existe par variables d'environnement, pour un serveur sans administration :

```bash
BILLING_ENABLED=true
STRIPE_SECRET_KEY=rk_live_…
STRIPE_WEBHOOK_SECRET=whsec_…
PUBLIC_URL=https://vault.exemple.fr
```

## Ce qui est envoyé à Stripe

| Donnée | Envoyée |
| --- | --- |
| Identifiant interne du compte | Oui (référence de la commande) |
| Identifiant de l'offre | Oui |
| Adresse email du compte | Non — Stripe la demande lui-même au client |
| Carte bancaire, adresse de facturation | Jamais vues par BetterVault : la saisie a lieu sur Stripe Checkout |
| Contenu des coffres | Jamais |

L'abonnement est activé et arrêté par le webhook signé de Stripe, jamais par l'application. La signature est vérifiée (HMAC-SHA256, tolérance de 5 minutes) et chaque événement n'est traité qu'une fois.

## Durées et renouvellement

Une offre propose **une ou plusieurs durées**, chacune liée à son propre tarif Stripe : mensuel, annuel, ou un achat unique qui ne se renouvelle jamais (`mode: payment`). Le compte choisit au moment de payer ; une offre à une seule durée s'affiche avec un simple bouton **Choisir**.

Dans l'application, l'onglet **Espace** du compte montre l'abonnement en cours : l'offre, la formule, la date de la prochaine échéance, et un interrupteur **Renouvellement automatique**.

Le couper ne supprime rien : l'abonnement court jusqu'au bout de la période déjà payée, et l'espace supplémentaire reste acquis d'ici là. C'est le `cancel_at_period_end` de Stripe ; le rétablir relance la reconduction. Un achat unique n'affiche pas cet interrupteur, puisqu'il n'y a rien à reconduire.

## Définir les offres sans passer par /admin

Les offres peuvent être écrites dans l'environnement, en JSON sur une ligne :

```bash
BILLING_PLANS='[{"id":"plus","name":"Espace +","prices":[{"id":"mensuel","label":"2 € / mois","stripePriceId":"price_1AbC"},{"id":"annuel","label":"20 € / an","stripePriceId":"price_1DeF"}],"boosts":{"attachmentQuotaBytes":5368709120,"maxVaults":5}}]'
```

Ce sont des **valeurs de départ** : dès qu'on enregistre les offres depuis `/admin`, ce sont celles-là qui s'appliquent, comme pour les limites. Un JSON invalide arrête le serveur au démarrage, avec le motif — plutôt que de le laisser tourner sans offres.

## Limites ajoutées

Une offre ajoute aux limites du serveur, pour le compte abonné uniquement :

- espace total des pièces jointes ;
- taille maximale d'un fichier ;
- taille maximale d'un coffre chiffré ;
- nombre de coffres ;
- nombre d'identifiants par coffre.

À la fin de l'abonnement, les limites reviennent à celles du serveur. Les données déjà stockées ne sont pas supprimées : les envois suivants sont refusés tant que l'espace dépasse le quota.
