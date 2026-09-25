#!/usr/bin/env node
/**
 * Porte de sécurité de la CI : lit les rapports des scanners, les résume, et
 * fait échouer le job selon des seuils de sévérité réglables.
 *
 *   node scripts/security-gate.mjs <dossier-des-rapports> [outil ...]
 *
 * Les outils attendus sont nommés en argument (secrets, sast, deps, image,
 * nuclei, zap). Un rapport attendu mais absent fait échouer la porte : un
 * scanner qui n'a pas tourné n'est pas un scanner qui n'a rien trouvé.
 *
 * Seuils (variables d'environnement, voir docs/development/ci-cd.md) :
 *   SECURITY_BLOCK_LEVEL         critical | high (défaut) | medium | none
 *   SECURITY_BLOCK_LEVEL_<OUTIL> la même chose pour un seul outil (ex. _ZAP)
 *   SECURITY_BLOCK_SECRETS       true (défaut) : tout secret trouvé bloque
 *   SECURITY_BLOCK_UNFIXED       false (défaut) : une vulnérabilité sans
 *                                correctif publié est signalée, pas bloquante
 * LOW et INFO ne bloquent jamais.
 */
import { readFileSync, existsSync, readdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const LEVELS = ['info', 'low', 'medium', 'high', 'critical'];
const rank = level => LEVELS.indexOf(level);

/** Niveau à partir duquel un outil bloque ; LOW et INFO ne bloquent jamais */
export function blockLevel(tool, env = process.env) {
  const raw = String(env[`SECURITY_BLOCK_LEVEL_${tool.toUpperCase()}`] ?? env.SECURITY_BLOCK_LEVEL ?? 'high').trim().toLowerCase();
  if (raw === 'none' || raw === 'off') return null;
  if (!['medium', 'high', 'critical'].includes(raw)) throw new Error(`Seuil inconnu « ${raw} » pour ${tool} : critical, high, medium ou none`);
  return raw;
}

const norm = value => {
  const v = String(value ?? '').toLowerCase();
  if (v === 'error') return 'high';
  if (v === 'warning') return 'medium';
  if (v === 'unknown' || v === 'note' || v === 'informational' || v === 'inventory' || v === 'experiment') return 'info';
  return LEVELS.includes(v) ? v : 'info';
};

const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const files = (dir, re) => (existsSync(dir) ? readdirSync(dir).filter(f => re.test(f)).map(f => join(dir, f)) : []);

/*
 * Chaque lecteur rend une liste de constats { level, title, where, blocking? }.
 * blocking: false marque un constat signalé mais jamais bloquant.
 */
export const READERS = {
  // Gitleaks : un secret n'a pas de sévérité, il est critique
  secrets(dir, env) {
    const list = files(dir, /^gitleaks(-dir|-git)?\.json$/);
    if (!list.length) return null;
    const blocking = String(env.SECURITY_BLOCK_SECRETS ?? 'true') !== 'false';
    return list.flatMap(f => (readJson(f) ?? []).map(s => ({
      level: 'critical', blocking,
      title: `${s.RuleID ?? 'secret'} : ${s.Description ?? ''}`.trim(),
      where: `${s.File ?? '?'}:${s.StartLine ?? '?'}${s.Commit ? ` (${String(s.Commit).slice(0, 7)})` : ''}`
    })));
  },
  // Historique complet (tâche planifiée) : signalé, jamais bloquant — une fuite ancienne se règle en révoquant le secret
  'secrets-history'(dir) {
    const f = join(dir, 'gitleaks-history.json');
    if (!existsSync(f)) return null;
    return (readJson(f) ?? []).map(s => ({ level: 'critical', blocking: false, title: `${s.RuleID} (historique)`, where: `${s.File}:${s.StartLine} (${String(s.Commit ?? '').slice(0, 7)})` }));
  },
  // Semgrep : ERROR → high, WARNING → medium, INFO → info (ou la sévérité explicite des règles récentes)
  sast(dir) {
    const f = join(dir, 'semgrep.json');
    if (!existsSync(f)) return null;
    const data = readJson(f);
    if (Array.isArray(data.errors) && data.errors.some(e => e.level === 'error' && /config|rule/i.test(e.type ?? ''))) {
      throw new Error('Semgrep n’a pas pu charger ses règles : le rapport ne vaut pas un « rien trouvé »');
    }
    return (data.results ?? []).map(r => ({
      level: norm(r.extra?.severity),
      title: r.check_id?.split('.').pop() ?? 'règle',
      where: `${r.path}:${r.start?.line ?? '?'}`
    }));
  },
  deps: (dir, env) => trivy(join(dir, 'trivy-fs.json'), env),
  image: (dir, env) => trivy(join(dir, 'trivy-image.json'), env),
  // Nuclei : une ligne JSON par constat
  nuclei(dir) {
    const list = files(dir, /^nuclei.*\.jsonl$/);
    if (!list.length) return null;
    return list.flatMap(f => readFileSync(f, 'utf8').split('\n').filter(Boolean).map(line => {
      const r = JSON.parse(line);
      return { level: norm(r.info?.severity), title: r.info?.name ?? r['template-id'], where: r['matched-at'] ?? r.host };
    }));
  },
  // ZAP : riskcode 3 élevé, 2 moyen, 1 faible, 0 information
  zap(dir) {
    const list = files(dir, /^zap.*\.json$/);
    if (!list.length) return null;
    const byRisk = ['info', 'low', 'medium', 'high'];
    return list.flatMap(f => (readJson(f).site ?? []).flatMap(site => (site.alerts ?? []).map(a => ({
      level: byRisk[Number(a.riskcode)] ?? 'info',
      title: `${a.alert ?? a.name} (${a.count ?? a.instances?.length ?? 1} occurrence(s))`,
      where: a.instances?.[0]?.uri ?? site['@name']
    }))));
  }
};

function trivy(file, env) {
  if (!existsSync(file)) return null;
  const blockUnfixed = String(env.SECURITY_BLOCK_UNFIXED ?? 'false') === 'true';
  return (readJson(file).Results ?? []).flatMap(res => [
    ...(res.Vulnerabilities ?? []).map(v => ({
      level: norm(v.Severity),
      blocking: blockUnfixed || Boolean(v.FixedVersion),
      title: `${v.VulnerabilityID} ${v.PkgName} ${v.InstalledVersion}${v.FixedVersion ? ` → ${v.FixedVersion}` : ' (pas de correctif publié)'}`,
      where: res.Target
    })),
    ...(res.Misconfigurations ?? []).filter(m => m.Status !== 'PASS').map(m => ({ level: norm(m.Severity), title: `${m.ID} ${m.Title}`, where: res.Target })),
    ...(res.Secrets ?? []).map(s => ({ level: norm(s.Severity), title: `${s.RuleID} ${s.Title}`, where: `${res.Target}:${s.StartLine}` }))
  ]);
}

/** Évalue les rapports : un résumé par outil et la décision globale */
export function evaluate(dir, tools, env = process.env) {
  const rows = [];
  let failed = false;
  for (const tool of tools) {
    const reader = READERS[tool];
    if (!reader) throw new Error(`Outil inconnu : ${tool}`);
    let findings;
    try {
      findings = reader(dir, env);
    } catch (err) {
      rows.push({ tool, error: err.message });
      failed = true;
      continue;
    }
    if (findings === null) {
      rows.push({ tool, error: 'rapport absent : le scan n’a pas tourné' });
      failed = true;
      continue;
    }
    const threshold = tool === 'secrets' || tool === 'secrets-history' ? 'critical' : blockLevel(tool, env);
    const counts = Object.fromEntries(LEVELS.map(l => [l, findings.filter(f => f.level === l).length]));
    const blockers = threshold === null ? [] : findings.filter(f => f.blocking !== false && rank(f.level) >= rank(threshold) && rank(f.level) >= rank('medium'));
    if (blockers.length) failed = true;
    rows.push({ tool, threshold, counts, blockers, findings });
  }
  return { failed, rows };
}

const cell = text => String(text).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');

export function markdown({ failed, rows }, title = 'Porte de sécurité') {
  const lines = [
    `## ${title} : ${failed ? '❌ bloquée' : '✅ passée'}`,
    '',
    '| Outil | Seuil | Critique | Élevé | Moyen | Faible | Info | Bloquants |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |'
  ];
  for (const r of rows) {
    if (r.error) { lines.push(`| ${r.tool} | — | — | — | — | — | — | ⚠️ ${r.error} |`); continue; }
    const c = r.counts;
    lines.push(`| ${r.tool} | ${r.threshold ?? 'aucun'} | ${c.critical} | ${c.high} | ${c.medium} | ${c.low} | ${c.info} | ${r.blockers.length} |`);
  }
  for (const r of rows.filter(x => x.blockers?.length)) {
    lines.push('', `### ${r.tool} : constats bloquants`, '');
    for (const f of r.blockers.slice(0, 20)) lines.push(`- **${f.level.toUpperCase()}** ${cell(f.title)} — \`${cell(String(f.where).slice(0, 160))}\``);
    if (r.blockers.length > 20) lines.push(`- … et ${r.blockers.length - 20} autre(s), voir l’artefact des rapports`);
  }
  // Signalés sans bloquer : le détail, replié, du plus grave au moins grave (INFO omis)
  const signales = rows.filter(r => r.findings).flatMap(r => r.findings
    .filter(f => !r.blockers.includes(f) && rank(f.level) >= rank('low'))
    .map(f => ({ ...f, tool: r.tool })))
    .sort((a, b) => rank(b.level) - rank(a.level));
  if (signales.length) {
    lines.push('', `<details><summary>${signales.length} constat(s) signalé(s), non bloquant(s)</summary>`, '');
    for (const f of signales.slice(0, 40)) lines.push(`- ${f.tool} · **${f.level.toUpperCase()}**${f.blocking === false ? ' (sans correctif ou non bloquant)' : ''} ${cell(f.title)} — \`${cell(String(f.where).slice(0, 160))}\``);
    if (signales.length > 40) lines.push(`- … et ${signales.length - 40} autre(s), voir l’artefact des rapports`);
    lines.push('', '</details>');
  }
  return lines.join('\n');
}

// Exécution directe (pas lors d'un import par les tests)
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('security-gate.mjs')) {
  const [dir = 'reports', ...tools] = process.argv.slice(2);
  if (!tools.length) {
    console.error('Usage : node scripts/security-gate.mjs <dossier> <outil> [...] (secrets, secrets-history, sast, deps, image, nuclei, zap)');
    process.exit(2);
  }
  const result = evaluate(dir, tools);
  const md = markdown(result, process.env.SECURITY_GATE_TITLE || undefined);
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  // Copie pour le commentaire de la demande de fusion
  if (process.env.SECURITY_GATE_REPORT) writeFileSync(process.env.SECURITY_GATE_REPORT, `${md}\n`);
  process.exit(result.failed ? 1 : 0);
}
