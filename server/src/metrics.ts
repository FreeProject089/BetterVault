import { createHmac } from 'node:crypto';
import { existsSync, readdirSync, statfsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cpus, freemem, loadavg, totalmem } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { DatabaseSync } from 'node:sqlite';

/**
 * Supervision du serveur, sans données personnelles :
 * compteurs de requêtes, latences, ressources système, totaux anonymes, journal de sécurité pseudonymisé.
 */

export interface Metrics {
  record(route: string, status: number, durationMs: number): void;
  snapshot(): SystemSnapshot;
}

export interface SystemSnapshot {
  uptimeSeconds: number;
  memory: { rssBytes: number; heapUsedBytes: number; systemTotalBytes: number; systemFreeBytes: number };
  cpu: { processPercent: number; loadAverage: number[]; cores: number };
  eventLoopLagMs: { p50: number; p99: number };
  requests: {
    lastHour: Array<{ minute: number; count: number; errors: number; avgMs: number }>;
    latencyMs: { p50: number; p95: number; p99: number };
    total: number;
    errorRate: number;
    topRoutes: Array<{ route: string; count: number; avgMs: number }>;
  };
}

export function createMetrics(now: () => number = Date.now): Metrics {
  const minutes = new Map<number, { count: number; errors: number; totalMs: number }>();
  const durations: number[] = [];
  const routes = new Map<string, { count: number; totalMs: number }>();
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  let total = 0;
  let errors = 0;
  let lastCpu = process.cpuUsage();
  let lastCpuAt = now();

  const percentile = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);

  return {
    record(route, status, durationMs) {
      total++;
      if (status >= 500) errors++;
      const minute = Math.floor(now() / 60_000);
      const bucket = minutes.get(minute) ?? { count: 0, errors: 0, totalMs: 0 };
      bucket.count++;
      if (status >= 500) bucket.errors++;
      bucket.totalMs += durationMs;
      minutes.set(minute, bucket);
      for (const key of minutes.keys()) if (key < minute - 60) minutes.delete(key);

      durations.push(durationMs);
      if (durations.length > 2000) durations.splice(0, durations.length - 2000);

      const entry = routes.get(route) ?? { count: 0, totalMs: 0 };
      entry.count++;
      entry.totalMs += durationMs;
      routes.set(route, entry);
    },

    snapshot() {
      const cpu = process.cpuUsage(lastCpu);
      const elapsedMs = Math.max(1, now() - lastCpuAt);
      lastCpu = process.cpuUsage();
      lastCpuAt = now();
      const sorted = [...durations].sort((a, b) => a - b);
      const currentMinute = Math.floor(now() / 60_000);
      const round = (value: number) => Math.round(value * 10) / 10;
      return {
        uptimeSeconds: Math.round(process.uptime()),
        memory: {
          rssBytes: process.memoryUsage().rss,
          heapUsedBytes: process.memoryUsage().heapUsed,
          systemTotalBytes: totalmem(),
          systemFreeBytes: freemem()
        },
        cpu: {
          processPercent: round(((cpu.user + cpu.system) / 1000 / elapsedMs) * 100),
          loadAverage: loadavg().map(round),
          cores: cpus().length
        },
        eventLoopLagMs: { p50: round(loop.percentile(50) / 1e6), p99: round(loop.percentile(99) / 1e6) },
        requests: {
          lastHour: Array.from({ length: 60 }, (_, i) => {
            const minute = currentMinute - 59 + i;
            const bucket = minutes.get(minute);
            return { minute: minute * 60_000, count: bucket?.count ?? 0, errors: bucket?.errors ?? 0, avgMs: bucket ? round(bucket.totalMs / bucket.count) : 0 };
          }),
          latencyMs: { p50: round(percentile(sorted, 0.5)), p95: round(percentile(sorted, 0.95)), p99: round(percentile(sorted, 0.99)) },
          total,
          errorRate: total ? round((errors / total) * 100) : 0,
          topRoutes: [...routes].map(([route, v]) => ({ route, count: v.count, avgMs: round(v.totalMs / v.count) })).sort((a, b) => b.count - a.count).slice(0, 10)
        }
      };
    }
  };
}

/* ── Journal de sécurité ─────────────────────────────────────────────────── */

export type AuditFn = (type: string, detail?: Record<string, unknown>, userId?: string) => void;

const AUDIT_RETENTION_MS = 90 * 86_400_000;

/** Identifiant de compte pseudonymisé (HMAC) : permet de relier des événements sans révéler le compte */
export function createAudit(db: DatabaseSync, secret: string, now: () => number): AuditFn {
  const insert = db.prepare('INSERT INTO audit_events (at, type, subject, detail) VALUES (?, ?, ?, ?)');
  let lastPrune = 0;
  return (type, detail = {}, userId) => {
    const subject = userId ? createHmac('sha256', secret).update(`audit:${userId}`).digest('hex').slice(0, 16) : null;
    insert.run(now(), type, subject, JSON.stringify(detail));
    if (now() - lastPrune > 3_600_000) {
      lastPrune = now();
      db.prepare('DELETE FROM audit_events WHERE at < ?').run(now() - AUDIT_RETENTION_MS);
    }
  };
}

/* ── Statistiques anonymes ───────────────────────────────────────────────── */

const DAY_MS = 86_400_000;

export function analytics(db: DatabaseSync, options: { now: number; filesDir: string | null; dbPath: string | null }) {
  const count = (sql: string, ...params: Array<string | number>) => (db.prepare(sql).get(...params) as { n: number | null }).n ?? 0;
  const { now } = options;

  const signups = db.prepare('SELECT created_at FROM users WHERE created_at >= ?').all(now - 30 * DAY_MS) as Array<{ created_at: number }>;
  const perDay = Array.from({ length: 30 }, () => 0);
  for (const { created_at } of signups) {
    const index = 29 - Math.floor((now - created_at) / DAY_MS);
    if (index >= 0 && index < 30) perDay[index]++;
  }

  let disk: { totalBytes: number; freeBytes: number } | null = null;
  const dataDir = options.filesDir ?? (options.dbPath ? join(options.dbPath, '..') : null);
  if (dataDir && existsSync(dataDir)) {
    try {
      const stats = statfsSync(dataDir);
      disk = { totalBytes: stats.blocks * stats.bsize, freeBytes: stats.bavail * stats.bsize };
    } catch {
      disk = null;
    }
  }

  const fileBytes = (path: string | null) => {
    if (!path) return 0;
    return ['', '-wal', '-shm'].reduce((sum, suffix) => sum + (existsSync(path + suffix) ? statSync(path + suffix).size : 0), 0);
  };

  return {
    users: {
      total: count('SELECT COUNT(*) AS n FROM users'),
      active24h: count('SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE COALESCE(last_seen_at, created_at) >= ?', now - DAY_MS),
      active7d: count('SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE COALESCE(last_seen_at, created_at) >= ?', now - 7 * DAY_MS),
      active30d: count('SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE COALESCE(last_seen_at, created_at) >= ?', now - 30 * DAY_MS),
      withTwoFactor: count('SELECT COUNT(*) AS n FROM users WHERE totp_enabled = 1'),
      withRecoveryKey: count('SELECT COUNT(*) AS n FROM users WHERE recovery_verifier IS NOT NULL'),
      signupsPerDay: perDay
    },
    storage: {
      vaultBytes: count('SELECT SUM(LENGTH(blob)) AS n FROM vaults'),
      sharedVaultBytes: count('SELECT SUM(LENGTH(blob)) AS n FROM shared_vaults'),
      sharedVaults: count('SELECT COUNT(*) AS n FROM shared_vaults'),
      attachmentBytes: count('SELECT SUM(size) AS n FROM attachments'),
      attachments: count('SELECT COUNT(*) AS n FROM attachments'),
      filesOnDisk: options.filesDir && existsSync(options.filesDir) ? readdirSync(options.filesDir).length : 0,
      databaseBytes: fileBytes(options.dbPath),
      disk
    },
    sessions: {
      active: count('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?', now)
    },
    billing: {
      activeSubscriptions: count("SELECT COUNT(*) AS n FROM subscriptions WHERE status IN ('active', 'trialing') AND (current_period_end IS NULL OR current_period_end > ?)", now),
      byPlan: db.prepare("SELECT plan_id AS plan, COUNT(*) AS count FROM subscriptions WHERE status IN ('active', 'trialing') GROUP BY plan_id").all()
    }
  };
}
