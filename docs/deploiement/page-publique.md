# Page publique et annuaire

## Page de présentation (`/about`)

Chaque serveur publie une page de présentation : titre, description, lien vers l'application, vers la documentation et vers les documents légaux, et l'état des inscriptions.

Réglages, dans l'administration, section **Page publique et annuaire** :

| Champ | Effet |
| --- | --- |
| Page de présentation publique | Coupe la page : `/about` renvoie alors « introuvable » |
| Titre | Remplace « BetterVault » en haut de la page |
| Présentation | Un ou plusieurs paragraphes, à la place du texte par défaut |

## Documentation (`/docs`)

La documentation est servie directement par le serveur, depuis les fichiers Markdown de l'image : rien à générer, et elle correspond toujours à la version qui tourne. L'application y renvoie depuis ses explications (« En savoir plus »).

## Annuaire de serveurs

L'annuaire permet de recommander d'autres serveurs BetterVault — les vôtres dans d'autres régions, ou ceux de confiance. Il est **coupé par défaut**.

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
