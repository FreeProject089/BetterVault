import { describe, it, expect } from 'vitest';
import { emails } from '../server/src/emails.ts';
import { buildMessage } from '../server/src/mailer.ts';

/**
 * Les emails partent dans la langue du compte, en deux versions. La version
 * texte est celle qui reste quand le client refuse le HTML : elle doit porter
 * la même information.
 */

const ctx = { to: 'moi@exemple.fr', locale: 'fr' as const, publicUrl: 'https://vault.exemple.fr' };

describe('Emails', () => {
  it('suivent la langue du destinataire', () => {
    expect(emails.resetCode(ctx, '123456', 15).subject).toBe('Code de réinitialisation BetterVault : 123456');
    expect(emails.resetCode({ ...ctx, locale: 'en' }, '123456', 15).subject).toBe('BetterVault reset code: 123456');
    // La langue voyage aussi dans le document, pour les lecteurs d'écran
    expect(emails.resetCode(ctx, '123456', 15).html).toContain('<html lang="fr">');
    expect(emails.resetCode({ ...ctx, locale: 'en' }, '123456', 15).html).toContain('<html lang="en">');
  });

  it('portent le code dans les deux versions', () => {
    const message = emails.resetCode(ctx, '902824', 15);
    expect(message.text).toContain('902824');
    expect(message.html).toContain('902824');
    expect(message.html).toContain('<!DOCTYPE html>');
  });

  it('échappent ce qui vient d’un tiers', () => {
    const message = emails.sharedInvite(ctx, 'mallory<script>alert(1)</script>@exemple.fr');
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
  });

  it('assemblent un message à deux parties, texte en premier', () => {
    const brut = buildMessage('BetterVault <no-reply@exemple.fr>', emails.resetCode(ctx, '123456', 15));
    expect(brut).toMatch(/Content-Type: multipart\/alternative; boundary="bettervault-/);
    // Le client retient la dernière partie qu'il sait afficher : le HTML doit venir après
    expect(brut.indexOf('text/plain')).toBeLessThan(brut.indexOf('text/html'));
    expect(brut.trimEnd()).toMatch(/--bettervault-[\w-]+--$/);
  });

  it('restent en une seule partie quand il n’y a pas de mise en forme', () => {
    const brut = buildMessage('BetterVault <no-reply@exemple.fr>', { to: ctx.to, subject: 'Test', text: 'Bonjour' });
    expect(brut).toContain('Content-Type: text/plain; charset=utf-8');
    expect(brut).not.toContain('multipart/alternative');
  });

  it('donnent les faits à vérifier après une connexion', () => {
    const message = emails.newLogin({ ...ctx, locale: 'en' }, Date.UTC(2026, 0, 15, 9, 30), '81.250.12.0', 'Firefox');
    for (const attendu of ['IP address', '81.250.12.0', 'Firefox', 'January 2026']) {
      expect(message.html).toContain(attendu);
    }
    expect(message.text).toContain('81.250.12.0');

    const fr = emails.newLogin(ctx, Date.UTC(2026, 0, 15, 9, 30), '81.250.12.0', 'Firefox');
    expect(fr.html).toContain('Adresse IP');
    expect(fr.html).toContain('janvier 2026');
    // Les faits sont produits par le serveur : ils ne dépendent pas de la langue
    expect(fr.text).toContain('81.250.12.0');
  });

  it('acceptent un sujet et une introduction de l’administration, sans les laisser injecter du HTML', () => {
    const message = emails.resetCode(
      { ...ctx, override: { subject: 'Votre code Coffre Interne', intro: 'Service informatique <b>ACME</b>' } },
      '123456', 15
    );
    expect(message.subject).toBe('Votre code Coffre Interne');
    expect(message.text.startsWith('Service informatique <b>ACME</b>')).toBe(true);
    // Le HTML de l'administration reste du texte : sinon la mise en page part en morceaux
    expect(message.html).toContain('Service informatique &lt;b&gt;ACME&lt;/b&gt;');
    expect(message.html).not.toContain('<b>ACME</b>');
    // Le code et l'avertissement restent produits par le serveur
    expect(message.html).toContain('123456');
    expect(message.text).toContain('123456');
  });

  it('gardent le sujet d’origine quand la personnalisation est vide', () => {
    const message = emails.resetCode({ ...ctx, override: { subject: '   ', intro: '  ' } }, '123456', 15);
    expect(message.subject).toBe('Code de réinitialisation BetterVault : 123456');
    // Pas de paragraphe vide en tête : une personnalisation blanche n'ajoute rien
    expect(message.html).not.toMatch(/<p[^>]*><\/p>/);
  });
});
