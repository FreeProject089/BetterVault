# Backlog en cours

Lot 1 — bugs confirmés
- [x] La liste (identifiants / 2FA) ne défile pas quand elle est pleine
- [x] « Transformer en coffre partagé » sans effet
- [x] Icône de coffre déformée quand le nom est long
- [x] Types personnalisés affichés en tags sous « Nouveau coffre » (à retirer)
- [x] Supprimer un type depuis la liste déroulante
- [x] Marges de la modale Compte

Lot 2 — suppression et export
- [x] Onglet Données : exporter (chiffré ou non) puis supprimer, au choix
- [x] Maj enfoncé = passer la double validation (coffres, 2FA, identifiants)
- [x] Raccourcis cohérents macOS / Windows / Linux, masqués sur téléphone

Lot 3 — écran de réinitialisation et emails
- [x] Réinitialisation du mot de passe par étapes, champs inutiles masqués
- [x] Emails : mise en page soignée, anglais systématique

Lot 4 — 2FA
- [x] Import / export des codes 2FA (QR codes, JSON chiffré ou clair)
- [x] Clé de sécurité matérielle (WebAuthn, liée à chaque application)

Lot 5 — éléments
- [ ] Types enrichis (recto/verso chiffré sur une identité, etc.)
- [x] Types personnalisés : champs et contraintes au choix
- [x] Générer un mot de passe depuis le formulaire d'identifiant
- [x] Annuler depuis le bandeau de notification

Lot 6 — mise en page
- [x] Barre latérale réductible (icônes seules) sur ordinateur
- [x] Parité téléphone : liste, fiche, fenêtres, zones de toucher de 40 px
- [ ] Extension à jour des nouveautés

Lot 7 — serveurs et image
- [ ] Thèmes personnalisés (modèle téléchargeable)
- [ ] Administration : documents légaux, site officiel défini dans le code
- [ ] Annuaire de serveurs, officiels et autres, tout désactivable
- [x] Grappe de serveurs d'un même opérateur (zones, clés Ed25519, révocation)
- [ ] Page d'accueil publique
- [x] Administration au logo BetterVault, thème clair / sombre / automatique

Lot 8 — données entre serveurs
- [x] Sauvegardes vers plusieurs destinations S3, reprise, restauration contrôlée
- [x] Sauvegarde complète du compte (fichiers compris) et import avec bilan du serveur cible
- [x] Historique des versions, conflits, corbeille de 30 jours
- [ ] Envoi des fichiers par morceaux avec reprise lors d'un import
