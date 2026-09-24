# Apparence

## Clair, sombre, et thèmes

Le bouton en bas de la barre latérale bascule entre clair et sombre. Pour choisir un thème : *Compte* → onglet **Général** → **Apparence** → la liste **Thème**.

- **Thèmes fournis** : Nord, Sable, Contraste élevé.
- **Importer un thème** : un fichier JSON décrivant les couleurs. Il prend sa place dans la liste, sous son nom.
- **Télécharger le modèle** : le thème courant, prêt à modifier.
- **Thème par défaut** : revient aux couleurs BetterVault.

!!! note "Chaque thème a son mode clair et son mode sombre"
    Un thème porte **deux jeux de couleurs**. Le bouton clair / sombre change de jeu **sans quitter le thème** : Nord sombre devient Nord clair, pas BetterVault clair. Un thème écrit pour l'ancien format n'en a qu'un ; il reste utilisable, et l'application le dit quand vous basculez.

Le thème est gardé sur l'appareil : il ne part pas sur le serveur et ne suit pas vos autres appareils.

## Écrire un thème

Le modèle téléchargé contient la liste complète des couleurs :

```json
{
  "format": "bettervault.theme",
  "version": 2,
  "name": "Mon thème",
  "variants": {
    "dark": {
      "bg-primary": "#101418",
      "text-primary": "#e8eef5",
      "accent": "#7773e8"
    },
    "light": {
      "bg-primary": "#ffffff",
      "text-primary": "#1f2328",
      "accent": "#4b45c6"
    }
  }
}
```

Les fichiers `"version": 1` (un seul jeu, annoncé par `"base"`) restent acceptés.

Règles appliquées à l'import :

| Règle | Pourquoi |
| --- | --- |
| Couleurs `#rrggbb` (ou `#rgb`) uniquement | Un thème ne peut ni charger une image, ni injecter du style |
| Liste fermée de 14 variables | Le reste de l'interface garde sa cohérence |
| Contraste texte/fond d'au moins 4,5:1, **dans chaque jeu** | Un thème illisible est refusé, et le message nomme le mode à corriger |
| 16 Ko au plus | Un fichier de thème n'a pas besoin de plus |

## Barre latérale

Le bouton en haut de la barre la réduit aux icônes seules, sur ordinateur. Le nom de chaque entrée apparaît au survol, et le choix est retenu.
