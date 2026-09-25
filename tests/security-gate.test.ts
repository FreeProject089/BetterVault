import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error script JavaScript sans déclaration de types
import { blockLevel, evaluate, markdown } from '../scripts/security-gate.mjs';

/**
 * Porte de sécurité de la CI : seuils réglables, LOW et INFO jamais
 * bloquants, et un rapport absent n'est jamais pris pour « rien trouvé ».
 */

let dir: string;
const write = (name: string, data: unknown) => writeFileSync(join(dir, name), typeof data === 'string' ? data : JSON.stringify(data));

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bv-gate-')); });

const zap = (...risks: number[]) => ({ site: [{ '@name': 'http://localhost:8787', alerts: risks.map((r, i) => ({ alert: `Alerte ${i}`, riskcode: String(r), count: '1' })) }] });

describe('Seuils', () => {
  it('bloque HIGH et CRITICAL par défaut, MEDIUM seulement si demandé', () => {
    expect(blockLevel('zap', {})).toBe('high');
    expect(blockLevel('zap', { SECURITY_BLOCK_LEVEL: 'medium' })).toBe('medium');
    expect(blockLevel('zap', { SECURITY_BLOCK_LEVEL: 'high', SECURITY_BLOCK_LEVEL_ZAP: 'critical' })).toBe('critical');
    expect(blockLevel('zap', { SECURITY_BLOCK_LEVEL: 'none' })).toBeNull();
    expect(() => blockLevel('zap', { SECURITY_BLOCK_LEVEL: 'low' })).toThrow(/Seuil inconnu/);
  });

  it('ne bloque jamais sur LOW ni INFO', () => {
    write('zap.json', zap(0, 1, 1));
    expect(evaluate(dir, ['zap'], { SECURITY_BLOCK_LEVEL: 'medium' }).failed).toBe(false);
  });

  it('MEDIUM passe par défaut et bloque quand le seuil est à medium', () => {
    write('zap.json', zap(2));
    expect(evaluate(dir, ['zap'], {}).failed).toBe(false);
    expect(evaluate(dir, ['zap'], { SECURITY_BLOCK_LEVEL: 'medium' }).failed).toBe(true);
  });

  it('HIGH bloque, sauf seuil à none (rapport seul)', () => {
    write('zap.json', zap(3));
    expect(evaluate(dir, ['zap'], {}).failed).toBe(true);
    expect(evaluate(dir, ['zap'], { SECURITY_BLOCK_LEVEL: 'none' }).failed).toBe(false);
  });
});

describe('Rapports', () => {
  it('un rapport absent fait échouer la porte', () => {
    const result = evaluate(dir, ['sast'], {});
    expect(result.failed).toBe(true);
    expect(markdown(result)).toContain('rapport absent');
  });

  it('un secret trouvé bloque, quel que soit le seuil', () => {
    write('gitleaks-dir.json', [{ RuleID: 'stripe-access-token', Description: 'Stripe', File: 'a.ts', StartLine: 3 }]);
    expect(evaluate(dir, ['secrets'], { SECURITY_BLOCK_LEVEL: 'none' }).failed).toBe(true);
    expect(evaluate(dir, ['secrets'], { SECURITY_BLOCK_SECRETS: 'false' }).failed).toBe(false);
  });

  it('une vulnérabilité sans correctif publié est signalée, pas bloquante (réglable)', () => {
    write('trivy-image.json', { Results: [{ Target: 'alpine', Vulnerabilities: [{ VulnerabilityID: 'CVE-1', PkgName: 'x', InstalledVersion: '1', Severity: 'CRITICAL' }] }] });
    expect(evaluate(dir, ['image'], {}).failed).toBe(false);
    expect(evaluate(dir, ['image'], { SECURITY_BLOCK_UNFIXED: 'true' }).failed).toBe(true);
    write('trivy-image.json', { Results: [{ Target: 'alpine', Vulnerabilities: [{ VulnerabilityID: 'CVE-2', PkgName: 'x', InstalledVersion: '1', FixedVersion: '2', Severity: 'HIGH' }] }] });
    expect(evaluate(dir, ['image'], {}).failed).toBe(true);
  });

  it('lit Semgrep (ERROR → élevé) et Nuclei (une ligne par constat)', () => {
    write('semgrep.json', { results: [{ check_id: 'a.b.xss', path: 'src/x.ts', start: { line: 4 }, extra: { severity: 'WARNING' } }], errors: [] });
    write('nuclei.jsonl', `${JSON.stringify({ 'template-id': 't', info: { name: 'Exposé', severity: 'low' }, 'matched-at': 'http://localhost:8787/x' })}\n`);
    const result = evaluate(dir, ['sast', 'nuclei'], {});
    expect(result.failed).toBe(false);
    expect(result.rows[0].counts.medium).toBe(1);
    expect(result.rows[1].counts.low).toBe(1);
  });

  it('détaille, repliés, les constats signalés sans bloquer (du plus grave au moins grave, sans INFO)', () => {
    write('zap.json', zap(0, 1, 2));
    const md = markdown(evaluate(dir, ['zap'], {}), 'DAST (local)');
    expect(md).toContain('## DAST (local) : ✅ passée');
    expect(md).toContain('<details><summary>2 constat(s) signalé(s), non bloquant(s)</summary>');
    expect(md.indexOf('**MEDIUM**')).toBeLessThan(md.indexOf('**LOW**'));
    expect(md).not.toContain('**INFO**');
  });

  it('le résumé échappe les barres verticales des titres', () => {
    write('zap.json', { site: [{ '@name': 'x', alerts: [{ alert: 'a | b', riskcode: '3', count: '1' }] }] });
    expect(markdown(evaluate(dir, ['zap'], {}))).toContain('a \\| b');
  });
});
