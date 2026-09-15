# Sous-traitants

Mise à jour : {{effectiveDate}}

| Sous-traitant | Rôle | Données | Localisation |
| --- | --- | --- | --- |
| {{hostingProvider}} | Hébergement du serveur | Données chiffrées, emails, métadonnées de session | {{hostingLocation}} |
{{#si billing}}| Stripe Payments Europe, Ltd. | Paiement des offres | Identifiants client et abonnement Stripe, données de paiement saisies directement chez Stripe | Irlande (UE) |{{/si}}
{{#si emails}}| Fournisseur SMTP de l’Exploitant | Envoi des emails de sécurité | Adresse email, contenu des emails de sécurité | À préciser par l’Exploitant |{{/si}}
{{#si backups}}| Fournisseur de stockage S3 de l’Exploitant | Sauvegardes | Copies chiffrées de la base et des pièces jointes | À préciser par l’Exploitant |{{/si}}

La localisation du lieu des sessions utilise une base installée sur le serveur : aucune donnée n’est transmise à un service de géolocalisation.

Toute modification de cette liste est annoncée au moins 30 jours à l’avance aux organisations clientes, qui peuvent s’y opposer.
