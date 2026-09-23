# Emails et langues

Deux onglets de l'administration, dans **Configuration** : ce que le serveur écrit à vos utilisateurs, et la langue de l'application.

## Emails

L'onglet **Emails** liste les huit messages que le serveur envoie : code de réinitialisation, nouvelle connexion, mot de passe changé, compte réinitialisé, double authentification, nouvelle clé de secours, invitation à un coffre partagé, email de test.

Pour chacun, et dans chaque langue :

- l'**aperçu** montre le vrai message, tel qu'il part, avec des valeurs d'exemple ;
- le **sujet** peut être remplacé ;
- une **introduction** peut être ajoutée en tête — « Le service informatique d'ACME vous écrit », par exemple.

L'aperçu suit votre saisie en direct ; rien n'est enregistré avant **Enregistrer**. **Revenir au texte d'origine** efface la personnalisation de cette langue.

!!! note "Ce qui ne se change pas"
    Le code, la date, l'adresse IP, l'appareil et l'avertissement de sécurité restent produits par le serveur. Un gestionnaire de mots de passe qui laisserait retirer ses avertissements, ou glisser du HTML dans ses emails, deviendrait un outil d'hameçonnage parfait depuis votre propre domaine. L'introduction est du texte simple : une balise s'affiche telle quelle, elle n'est pas interprétée.

Le sujet tient sur une ligne : un saut de ligne y ouvrirait un nouvel en-tête d'email (`Bcc: …`), il est donc remplacé par une espace.

### Langue d'envoi

Chaque email part dans la langue du compte. Pour les comptes qui n'en ont pas choisi, c'est la **langue d'envoi par défaut**, réglée en haut de l'onglet (anglais tant que vous n'avez rien choisi).

Les emails existent en français et en anglais. Une langue ajoutée à l'application (voir plus bas) ne traduit pas les emails : ils partent alors dans la langue d'envoi par défaut.

## Langues de l'application

Le français et l'anglais sont intégrés. L'onglet **Langues** en ajoute d'autres, sans reconstruire l'application.

1. **Télécharger le modèle à traduire** : un fichier JSON avec chaque texte de l'application, en français, déjà rempli en anglais.
2. Remplacez l'anglais par votre langue. Ce que vous laissez tel quel reste en anglais : une traduction partielle est donc utilisable tout de suite.
3. Renseignez le **code** (`es`, `de`, `pt-BR`…) et le **nom, écrit dans cette langue** (« Español »), choisissez le fichier, puis **Envoyer**.

La liste indique pour chaque langue combien de textes sont traduits, avec une barre de couverture. Envoyer à nouveau le même code remplace la langue.

```json
{
  "format": "bettervault.i18n-pack",
  "code": "es",
  "name": "Español",
  "strings": {
    "Annuler": "Cancelar",
    "Déverrouiller": "Desbloquear"
  }
}
```

!!! warning "Trois caractères refusés : `<`, `>` et `\"`"
    Les traductions s'affichent là où le coffre est déchiffré. Sans ces trois caractères, un texte ne peut ni ouvrir une balise ni sortir d'un attribut : même un serveur compromis ne pourrait pas s'en servir pour glisser du code dans l'application. Les entrées qui en contiennent sont écartées une à une — le reste du fichier est gardé, et l'onglet vous dit combien ont été écartées. Pour des guillemets, utilisez « » ou “ ”.

    L'application refait ce tri elle-même en chargeant la langue : elle ne fait pas confiance au serveur sur ce point.

### Ce qui reste en anglais

Environ 160 textes sont construits à l'affichage (« 3 fichiers », « Expire dans 5 jours ») : ils changent à chaque fois et ne peuvent pas servir de clé. Ils restent en anglais dans une langue ajoutée. Les dates et les nombres, eux, suivent bien la langue choisie.

### Côté utilisateurs

Le bouton de langue de l'en-tête s'adapte :

- **deux langues** (français, anglais) : il bascule directement de l'une à l'autre ;
- **davantage** : il ouvre une liste avec un champ de recherche, utilisable au clavier (Entrée choisit la première langue trouvée, flèches pour parcourir, Échap pour fermer).

Une langue choisie est gardée sur l'appareil : elle s'affiche dès l'ouverture suivante, même hors ligne. Les langues viennent du serveur du compte synchronisé, ou de celui qui sert l'application web ; l'application de bureau sans compte garde le français et l'anglais.

Le catalogue des textes est publié avec l'application, sous `/i18n/source.json`, à chaque construction : il ne peut pas prendre de retard sur le code.
