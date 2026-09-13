import * as simpleIcons from 'simple-icons';

/**
 * Fallback SVG : Globe monochrome épuré (Zéro emoji, design suisse ultra-pro)
 */
export const GLOBE_ICON_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="10"></circle>
  <line x1="2" y1="12" x2="22" y2="12"></line>
  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
</svg>`;

// Mapping commun pour normaliser les noms de domaines connus vers SimpleIcons
const DOMAIN_TO_SLUG: Record<string, string> = {
  'github.com': 'siGithub',
  'gitlab.com': 'siGitlab',
  'google.com': 'siGoogle',
  'accounts.google.com': 'siGoogle',
  'apple.com': 'siApple',
  'microsoft.com': 'siMicrosoft',
  'aws.amazon.com': 'siAmazonwebservices',
  'amazon.com': 'siAmazon',
  'cloudflare.com': 'siCloudflare',
  'discord.com': 'siDiscord',
  'twitter.com': 'siX',
  'x.com': 'siX',
  'linkedin.com': 'siLinkedin',
  'facebook.com': 'siFacebook',
  'slack.com': 'siSlack',
  'notion.so': 'siNotion',
  'figma.com': 'siFigma',
  'spotify.com': 'siSpotify',
  'netflix.com': 'siNetflix',
  'proton.me': 'siProton',
  'paypal.com': 'siPaypal',
  'stripe.com': 'siStripe',
  'openai.com': 'siOpenai',
  'docker.com': 'siDocker',
  'bitbucket.org': 'siBitbucket',
  'reddit.com': 'siReddit'
};

/**
 * Extrait le domaine racine d'une URL
 */
export function extractDomain(url: string): string {
  if (!url) return '';
  try {
    let cleanUrl = url.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }
    const parsed = new URL(cleanUrl);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase().replace(/^www\./, '').split('/')[0];
  }
}

/**
 * Retourne le SVG vectoriel SimpleIcons ou le fallback globe 🌐 monochrome
 */
export function getServiceIconSvg(domainOrTitle: string, customColor = '#E6EDF3'): string {
  const domain = extractDomain(domainOrTitle);

  // Vérifier le mapping direct de domaine
  let iconSlug = DOMAIN_TO_SLUG[domain];

  // Si non trouvé, tenter par le slug calculé
  if (!iconSlug) {
    const candidateName = domain.split('.')[0] || domainOrTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
    const titleCase = 'si' + candidateName.charAt(0).toUpperCase() + candidateName.slice(1);
    if ((simpleIcons as Record<string, any>)[titleCase]) {
      iconSlug = titleCase;
    }
  }

  if (iconSlug && (simpleIcons as Record<string, any>)[iconSlug]) {
    const iconObj = (simpleIcons as Record<string, any>)[iconSlug];
    // Remplacer le fill par currentColor ou la couleur passée
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="${customColor}" role="img" aria-label="${iconObj.title}">
      <path d="${iconObj.path}" />
    </svg>`;
  }

  // Fallback vectoriel épuré (Globe)
  return GLOBE_ICON_SVG;
}
