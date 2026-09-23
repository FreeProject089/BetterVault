# Page publique et annuaire

## Plan du site

| Adresse | Contenu |
| --- | --- |
| `/` | Page d'accueil : ce que fait BetterVault, comment c'est chiffré, ce serveur |
| `/app` | L'application ; `/auth` et `/connexion` y mènent |
| `/serveurs` | Serveurs recommandés par l'hébergeur, par région |
| `/docs` | Cette documentation |
| `/legal` | Documents légaux, s'ils sont activés |
| `/admin` | Administration |

L'ancienne adresse `/about` renvoie vers `/`. Une application installée depuis le navigateur s'ouvre directement sur `/app`.

## Page d'accueil (`/`)

Chaque serveur publie une page d'accueil : titre, description, accès à l'application, à la documentation et aux documents légaux, et l'état des inscriptions. Les icônes viennent de Phosphor (licence MIT) ; tout est intégré à la page, qui n'exécute aucun script et ne charge rien d'extérieur.

Réglages, dans l'administration, section **Page publique et annuaire** :

| Champ | Effet |
| --- | --- |
| Page d'accueil publique | Coupe la page : `/` mène alors directement à l'application |
| Titre | Remplace « BetterVault » en haut de la page |
| Présentation | Un ou plusieurs paragraphes, à la place du texte par défaut |

## Documentation (`/docs`)

La documentation est servie directement par le serveur, depuis les fichiers Markdown de l'image : rien à générer, et elle correspond toujours à la version qui tourne. L'application y renvoie depuis ses explications (« En savoir plus »).

## Annuaire de serveurs

L'annuaire permet de recommander d'autres serveurs BetterVault — les vôtres dans d'autres régions, ou ceux de confiance. Il est **coupé par défaut**.

Activé et rempli, il apparaît à trois endroits : la page **`/serveurs`** (regroupée par région, les serveurs officiels d'abord), un lien dans l'en-tête et le pied de la page d'accueil, et les propositions de l'application au moment de choisir un serveur.

Un serveur par ligne :

```text
BetterVault US | https://us.exemple.org | Amérique du Nord | officiel
```

Nom, adresse `https`, région, puis le mot `officiel` si vous voulez le distinguer. Les deux premiers champs sont obligatoires ; une adresse non `https` est écartée.

L'application affiche ces serveurs sous le champ **Adresse du serveur**, au moment de créer un compte ou de se connecter : un clic remplit le champ.

!!! warning "Un compte n'existe que sur son serveur"
    L'annuaire ne partage aucune donnée entre serveurs : il ne fait que proposer des adresses. Pour déplacer un compte, voir [Changer de compte ou de serveur](../guide/changer-de-serveur.md).

!!! tip "Version web hébergée"
    Quand l'application web est servie par un serveur, sa politique de sécurité ne l'autorise à contacter que ce serveur. Les serveurs proposés se choisissent donc depuis l'application de bureau, l'extension, ou une installation que vous hébergez.


## Tarifs (`/tarifs`)

Dès qu'une offre payante a un tarif créé dans Stripe, la page **`/tarifs`** apparaît, avec un lien dans la barre du haut et le pied de page. Elle montre le compte gratuit et ses limites, chaque offre avec l'espace qu'elle ajoute, et une bascule **par an / par mois** quand les offres proposent les deux. Voir [Espace payant](offres-stripe.md).

## Langue des pages

Les pages publiques (accueil, tarifs, serveurs, documentation, documents légaux) sont écrites en français et en anglais. La langue suit celle du navigateur ; le sélecteur de la barre du haut l'impose et la retient un an (cookie `bv_lang`, sans autre contenu).

Les **packs de langue** ajoutés dans **/admin → Langues** servent aussi aux pages publiques : chaque pack apparaît dans le sélecteur. Un texte que le pack traduit (clé = texte français, par exemple `"Premiers pas": "Erste Schritte"`) s'affiche dans sa langue ; un texte qu'il ne connaît pas encore s'affiche en anglais. Le contenu de la documentation et des documents légaux reste en français ou en anglais.

| Langues proposées | Sélecteur |
| --- | --- |
| Une seule | Aucun |
| Deux (français, anglais) | Une bascule `FR / EN` |
| Trois ou plus | Un menu déroulant |

## Liens communautaires

La barre du haut et le pied de page montrent toujours **GitHub** (le code source) et **BetterCommunity**. Discord et une page d'état s'ajoutent quand ils sont connus : ils sont lus dans un **fichier JSON hébergé ailleurs**, dont l'adresse se règle dans **/admin → Réglages → Liens communautaires**. Un seul fichier peut servir plusieurs serveurs : changer l'invitation Discord ne demande de toucher à aucun d'eux.

```json
{
  "discord": "https://discord.gg/xxxxxxx",
  "github": "https://github.com/FreeProject089/BetterVault",
  "status": "https://status.exemple.org",
  "community": "https://bettercommunity.ch"
}
```

| Clé | Rôle |
| --- | --- |
| `discord` | Invitation Discord : bouton dans la barre, le pied et la FAQ |
| `github` | Remplace le lien du code source |
| `status` | Page d'état du service, dans le pied de page |
| `community` | Remplace le lien BetterCommunity |

Toutes les clés sont facultatives ; seules les adresses `https://` sont gardées. Le fichier est relu au plus une fois par heure. S'il est injoignable, les pages gardent les derniers liens connus : l'accueil ne dépend jamais d'un serveur tiers pour s'afficher.
