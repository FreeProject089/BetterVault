# Apparence

## Clair, sombre, et thèmes

Le bouton en bas de la barre latérale bascule entre clair et sombre. Pour aller plus loin : *Compte* → onglet **Général** → **Apparence**.

- **Thèmes fournis** : Nord, Sable, Contraste élevé.
- **Importer un thème** : un fichier JSON décrivant les couleurs.
- **Télécharger le modèle** : le thème courant, prêt à modifier.
- **Thème par défaut** : revient aux couleurs BetterVault et à votre choix clair/sombre.

Le thème est gardé sur l'appareil : il ne part pas sur le serveur et ne suit pas vos autres appareils.

## Écrire un thème

Le modèle téléchargé contient la liste complète des couleurs :

```json
{
  "format": "bettervault.theme",
  "version": 1,
  "name": "Mon thème",
  "base": "dark",
  "colors": {
    "bg-primary": "#101418",
    "text-primary": "#e8eef5",
    "accent": "#7773e8"
  }
}
```

Règles appliquées à l'import :

| Règle | Pourquoi |
| --- | --- |
| Couleurs `#rrggbb` (ou `#rgb`) uniquement | Un thème ne peut ni charger une image, ni injecter du style |
| Liste fermée de 14 variables | Le reste de l'interface garde sa cohérence |
| Contraste texte/fond d'au moins 4,5:1 | Un thème illisible est refusé |
| 16 Ko au plus | Un fichier de thème n'a pas besoin de plus |

## Barre latérale

Le bouton en haut de la barre la réduit aux icônes seules, sur ordinateur. Le nom de chaque entrée apparaît au survol, et le choix est retenu.
