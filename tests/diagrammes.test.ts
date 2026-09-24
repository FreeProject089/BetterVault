import { describe, it, expect } from 'vitest';
import { parseFlowchart, renderDiagram, wrapText } from '../server/src/diagram.ts';
import { renderMarkdown } from '../server/src/docs.ts';

/**
 * Diagrammes de la documentation : syntaxe Mermaid (comme B.MD), dessinés
 * en SVG par le serveur, sans script, et sans laisser passer de HTML.
 */

const CLES = [
  'graph TD',
  '  A[Mot de passe principal] -->|Argon2id| B[Clé principale]',
  '  B -- HKDF --> C[Clé de chiffrement]',
  '  B -- HKDF --> D([Preuve])',
  '  C --> E[(Coffre chiffré)]',
  '  D -.-> F{Serveur}'
].join('\n');

describe('Organigrammes', () => {
  it('lit les nœuds, leurs formes et les libellés des liens', () => {
    const g = parseFlowchart(CLES)!;
    expect(g.dir).toBe('TD');
    expect([...g.nodes.values()].map(n => [n.id, n.shape])).toEqual([['A', 'rect'], ['B', 'rect'], ['C', 'rect'], ['D', 'stadium'], ['E', 'db'], ['F', 'diamond']]);
    expect(g.edges.map(e => [e.from, e.to, e.label, e.style])).toEqual([
      ['A', 'B', 'Argon2id', 'solid'], ['B', 'C', 'HKDF', 'solid'], ['B', 'D', 'HKDF', 'solid'], ['C', 'E', '', 'solid'], ['D', 'F', '', 'dotted']
    ]);
  });

  it('comprend les enchaînements, le & et les sous-graphes', () => {
    const g = parseFlowchart('flowchart LR\nsubgraph app [Application]\n  a[UI] --> b[Store]\nend\na & b --> s[Serveur]')!;
    expect(g.dir).toBe('LR');
    expect(g.groups).toEqual([{ id: 'app', title: 'Application', nodes: ['a', 'b'] }]);
    expect(g.edges.filter(e => e.to === 's').map(e => e.from)).toEqual(['a', 'b']);
  });

  it('place chaque rang sous le précédent, sans chevauchement', () => {
    const svg = renderDiagram(CLES, 'Clés')!;
    expect(svg).toContain('<figure class="diagram"><svg class="dg"');
    expect(svg).toContain('<figcaption>Clés</figcaption>');
    expect(svg.match(/<g class="dg-n">/g)).toHaveLength(6);
    expect(svg).toContain('marker-end="url(#dg-arrow-');
  });

  it('échappe tout texte, et refuse ce qui n’est pas un organigramme', () => {
    const svg = renderDiagram('graph TD\n  A["<img src=x onerror=alert(1)>"] --> B[<script>]')!;
    expect(svg).not.toMatch(/<img|<script/);
    expect(svg).toContain('&lt;img');
    expect(renderDiagram('sequenceDiagram\n A->>B: salut')).toBeNull();
    expect(renderDiagram('graph TD\n A[ouvert --> B')).toBeNull();
  });
});

describe('Textes longs', () => {
  it('passe à la ligne entre les mots, sans laisser un mot seul', () => {
    const lignes = wrapText('Argon2id avec 64 Mio de mémoire et 3 itérations', 150);
    expect(lignes.length).toBe(2);
    expect(lignes.join(' ')).toBe('Argon2id avec 64 Mio de mémoire et 3 itérations');
    expect(lignes.every(l => l.split(' ').length > 1)).toBe(true);
    // Un mot trop long (une adresse) se coupe après un séparateur
    expect(wrapText('https://vault.exemple.fr/api/v1/vault/attachments', 120).length).toBeGreaterThan(1);
    // Les retours voulus sont gardés
    expect(wrapText('main.ts\nécrans', 200)).toEqual(['main.ts', 'écrans']);
  });

  it('découpe les nœuds et les libellés longs en plusieurs lignes', () => {
    const svg = renderDiagram('graph TD\n  A[L’utilisateur saisit son mot de passe principal sur l’appareil de confiance] -->|Argon2id avec 64 Mio de mémoire et 3 itérations| B[Clé]')!;
    const largeur = Number(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+)/.exec(svg)![1]);
    expect(largeur).toBeLessThan(320);
    expect(svg.match(/<tspan/g)!.length).toBeGreaterThan(4);
  });

  it('ajoute une version verticale d’un diagramme large pour les téléphones', () => {
    const large = renderDiagram('flowchart LR\n  a[Interface utilisateur] --> b[Magasin local chiffré] --> c[API de synchronisation] --> d[(Base de données)]')!;
    expect(large).toContain('<figure class="diagram has-narrow">');
    expect(large).toContain('<svg class="dg dg-wide"');
    expect(large).toContain('<svg class="dg dg-narrow"');
    expect(renderDiagram('graph LR\n  a --> b')).not.toContain('dg-narrow');
  });
});

describe('Diagrammes dans la documentation', () => {
  it('dessine un bloc ```mermaid, et garde le code d’un diagramme illisible', () => {
    expect(renderMarkdown('```mermaid\ngraph LR\n  a --> b\n```\n')).toContain('<svg class="dg"');
    expect(renderMarkdown('```mermaid\npie title x\n```\n')).toContain('<span class="code-lang">mermaid</span>');
  });

  it('accepte la forme B.MD :::mermaid[Légende]', () => {
    const html = renderMarkdown(':::mermaid[Flux des clés]\n```mermaid\ngraph TD\n  a --> b\n```\n:::\n');
    expect(html).toContain('<div class="diagram-block"><figure class="diagram">');
    expect(html).toContain('<p class="diagram-caption">Flux des clés</p>');
  });

  it('rend une frise et une comparaison B.MD', () => {
    const frise = renderMarkdown(':::timeline\n:::event[Tag]{state=done}\nCréé.\n:::\n:::event[Brouillon]{state=now}\nÀ publier.\n:::\n:::\n');
    expect(frise).toContain('<li class="tl-done">');
    expect(frise).toContain('<li class="tl-now">');
    const cmp = renderMarkdown(':::compare\n:::before[Sans relais]\nIP exacte.\n:::\n:::after[Avec Cloudflare]\nIP du relais.\n:::\n:::\n');
    expect(cmp).toContain('<div class="cmp-before"><span>Sans relais</span>');
  });
});
