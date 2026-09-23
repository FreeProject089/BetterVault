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
