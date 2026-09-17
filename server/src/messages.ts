import type { IncomingMessage } from 'node:http';

/**
 * Messages d'erreur de l'API dans la langue de l'application.
 * Les messages sont écrits en français dans le code ; la traduction anglaise est appliquée à la réponse
 * quand la requête demande l'anglais (en-tête Accept-Language).
 */

export type ApiLocale = 'fr' | 'en';

export function requestLocale(req: IncomingMessage): ApiLocale {
  const header = String(req.headers['accept-language'] ?? '').toLowerCase();
  const first = header.split(',')[0]?.trim() ?? '';
  return first.startsWith('fr') ? 'fr' : first ? 'en' : 'fr';
}

const EXACT: Record<string, string> = {
  'Cette personne fait déjà partie du coffre': 'This person is already a member of the vault',
  'Le fichier n’est plus disponible sur le serveur': 'The file is no longer available on the server',
  'Pièce jointe introuvable': 'Attachment not found',
  'Les pièces jointes ne sont pas activées sur ce serveur': 'Attachments are not enabled on this server',
  'Ce serveur n’accepte pas l’envoi d’images': 'This server does not accept image uploads',
  'Ce serveur n’accepte pas les liens vers une image': 'This server does not accept image links',
  'Sauvegardes indisponibles sur ce serveur': 'Backups are unavailable on this server',
  'Offres désactivées sur ce serveur': 'Plans are disabled on this server',
  'Paiement non configuré sur ce serveur': 'Payment is not configured on this server',
  'Les rôles prédéfinis ne peuvent pas être supprimés': 'Built-in roles cannot be deleted',
  'Les rôles prédéfinis ne sont pas modifiables': 'Built-in roles cannot be changed',
  'Le coffre a été modifié sur un autre appareil': 'The vault was changed on another device',
  'Le coffre partagé a été modifié entre-temps': 'The shared vault was changed in the meantime',
  'Le coffre partagé a été modifié par un autre membre': 'The shared vault was changed by another member',
  'Un compte existe déjà pour cet email': 'An account already exists for this email',
  'Fichier vide': 'Empty file',
  'Le propriétaire ne peut pas être retiré': 'The owner cannot be removed',
  'Le rôle du propriétaire ne peut pas être changé': 'The owner’s role cannot be changed',
  'Seul le propriétaire peut transférer la propriété': 'Only the owner can transfer ownership',
  'Votre rôle ne permet pas cette action': 'Your role does not allow this action',
  'Adresse d’image invalide': 'Invalid image address',
  'L’image doit être servie en https': 'The image must be served over https',
  'Email ou mot de passe incorrect': 'Incorrect email or password',
  'Mot de passe incorrect': 'Incorrect password',
  'Mot de passe principal actuel incorrect': 'Incorrect current master password',
  'Mot de passe principal incorrect': 'Incorrect master password',
  'Image PNG, JPEG ou WebP attendue': 'PNG, JPEG or WebP image expected',
  'JSON invalide': 'Invalid JSON',
  'Objet JSON attendu': 'JSON object expected',
  'La nouvelle clé doit inclure le propriétaire et vous-même': 'The new key must include the owner and yourself',
  'Liste des membres obsolète, rechargez le coffre': 'Member list is out of date, reload the vault',
  'Seul le rôle Propriétaire peut supprimer le coffre': 'Only the Owner role can delete the vault',
  'Offre inconnue': 'Unknown plan',
  'Durée inconnue pour cette offre': 'Unknown duration for this plan',
  'Aucun abonnement à renouveler': 'No subscription to renew',
  'Valeur attendue : true ou false': 'Expected value: true or false',
  'Rôle inconnu pour ce coffre': 'Unknown role for this vault',
  'Transférez la propriété depuis la liste des membres': 'Transfer ownership from the member list',
  'Signature Stripe invalide': 'Invalid Stripe signature',
  'Invitation introuvable': 'Invitation not found',
  'Quittez vos coffres partagés avant de remplacer vos clés de partage': 'Leave your shared vaults before replacing your sharing keys',
  'Clés de partage manquantes': 'Sharing keys missing',
  'Le membre doit d’abord accepter l’invitation': 'The member must accept the invitation first',
  'Membre introuvable': 'Member not found',
  'Aucune photo de profil': 'No profile picture',
  'Aucun abonnement à gérer': 'No subscription to manage',
  'Document inconnu': 'Unknown document',
  'Route inconnue': 'Unknown route',
  'Transférez la propriété ou supprimez le coffre avant de le quitter': 'Transfer ownership or delete the vault before leaving it',
  'Requête trop volumineuse': 'Request too large',
  'Adresse publique du serveur non configurée (PUBLIC_URL)': 'Server public address not configured (PUBLIC_URL)',
  'Trop de tentatives, réessayez dans une minute': 'Too many attempts, try again in a minute',
  'La récupération a expiré, recommencez': 'Recovery expired, start again',
  'Sans clé de secours, la réinitialisation demande un code email ou la double authentification': 'Without a recovery key, resetting requires an email code or two-factor authentication',
  'Les inscriptions sont fermées sur ce serveur': 'Registration is closed on this server',
  'Ce rôle est encore attribué à des membres': 'This role is still assigned to members',
  'Coffre partagé introuvable': 'Shared vault not found',
  'Configurez d’abord le serveur SMTP': 'Configure the SMTP server first',
  'Stripe injoignable': 'Stripe unreachable',
  'La double authentification est déjà activée': 'Two-factor authentication is already on',
  'Code incorrect ou déjà utilisé': 'Incorrect or already used code',
  'Code incorrect. Vérifiez l’heure de votre téléphone.': 'Incorrect code. Check your phone’s clock.',
  'Recommencez la configuration de la double authentification': 'Start the two-factor setup again',
  'Code de l’application d’authentification requis': 'Authenticator app code required',
  'Compte introuvable': 'Account not found',
  'Jeton d’administration incorrect': 'Incorrect admin token',
  'Session expirée': 'Session expired',
  'Session requise': 'Session required',
  'Corps JSON attendu': 'JSON body expected',
  'Aucun compte avec cet email sur ce serveur': 'No account with this email on this server',
  'Ce compte doit d’abord se connecter avec une version récente de BetterVault': 'This account must first sign in with a recent version of BetterVault',
  'Phrase de chiffrement de 12 caractères minimum': 'Encryption passphrase of at least 12 characters',
  'Erreur interne du serveur': 'Internal server error',
  'Code incorrect': 'Incorrect code',
  'Code expiré, demandez-en un nouveau': 'Code expired, request a new one'
};

const PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^Champ « (.+) » invalide$/, m => `Invalid field "${m[1]}"`],
  [/^(\d+) membres maximum par coffre partagé$/, m => `${m[1]} members maximum per shared vault`],
  [/^(\d+) rôles maximum par coffre$/, m => `${m[1]} roles maximum per vault`],
  [/^Limite de (\d+) coffres partagés atteinte$/, m => `Limit of ${m[1]} shared vaults reached`],
  [/^Espace de stockage plein \((\d+) Mo\)$/, m => `Storage full (${m[1]} MB)`],
  [/^Le coffre dépasse la taille autorisée \((\d+) Mo\)$/, m => `The vault exceeds the allowed size (${m[1]} MB)`],
  [/^Envoi impossible : (.*)$/s, m => `Sending failed: ${m[1]}`],
  [/^Limite « (.+) » invalide$/, m => `Invalid limit "${m[1]}"`]
];

export function localizeMessage(message: string, locale: ApiLocale): string {
  if (locale === 'fr') return message;
  if (EXACT[message]) return EXACT[message];
  for (const [pattern, build] of PATTERNS) {
    const match = message.match(pattern);
    if (match) return build(match);
  }
  return message;
}

/** Tous les messages connus, pour vérifier qu'aucun message d'erreur n'est oublié */
export const KNOWN_MESSAGES = Object.keys(EXACT);
