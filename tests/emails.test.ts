import { describe, it, expect } from 'vitest';
import { emails } from '../server/src/emails.ts';
import { buildMessage } from '../server/src/mailer.ts';

/**
 * Les emails partent en anglais et en deux versions. La version texte est celle
 * qui reste quand le client refuse le HTML : elle doit porter la même information.
 */

const ctx = { to: 'moi@exemple.fr', locale: 'fr' as const, publicUrl: 'https://vault.exemple.fr' };

describe('Emails', () => {
  it('sont en anglais même pour un destinataire francophone', () => {
    const message = emails.resetCode(ctx, '123456', 15);
    expect(message.subject).toBe('BetterVault reset code: 123456');
    expect(message.text).not.toMatch(/[àâéèêîïôùûç]/i);
    expect(message.subject).not.toMatch(/[àâéèêîïôùûç]/i);
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
    const message = emails.newLogin(ctx, Date.UTC(2026, 0, 15, 9, 30), '81.250.12.0', 'Firefox');
    for (const attendu of ['IP address', '81.250.12.0', 'Firefox', 'January 2026']) {
      expect(message.html).toContain(attendu);
    }
    expect(message.text).toContain('81.250.12.0');
  });
});
