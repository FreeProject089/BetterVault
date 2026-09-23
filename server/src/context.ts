import type { IncomingMessage } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import type { ServerLimits, ServerSettings } from './config.ts';
import type { GeoLookup } from './geoip.ts';
import type { UserRow } from './app.ts';
import type { MailMessage } from './mailer.ts';
import type { EmailContext } from './emails.ts';
import type { Reply } from './http.ts';

/** Ce que l'application met à disposition des modules de routes */
export interface RouteContext {
  db: DatabaseSync;
  now: () => number;
  limit(req: IncomingMessage, bucket: string): void;
  authenticate(req: IncomingMessage): { userId: string; tokenHash: string };
  getUser(userId: string): UserRow;
  verifyAuthHash(user: UserRow | undefined, authHash: string): Promise<boolean>;
  /** `kind` nomme le message, pour appliquer la personnalisation de l'administration */
  notify(kind: string, build: (ctx: EmailContext) => MailMessage, user: UserRow, alertKind?: string): void;
  settings(): ServerSettings;
  filesDir: string | null;
  maxBody(): number;
  consumeTotp(user: UserRow, code: string | null): boolean;
  clientAddress(req: IncomingMessage): string;
  /** Limites du compte, suppléments d'offre compris */
  limitsFor(userId: string): ServerLimits;
  audit(type: string, detail?: Record<string, unknown>, userId?: string): void;
  geo: GeoLookup | null;
}

export type RouteHandler = (req: IncomingMessage, params: Record<string, string>) => Promise<Reply>;

export interface PatternRoute {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: RouteHandler;
}

/** Route avec paramètres : route('GET', '/api/v1/shared-vaults/:id', handler) */
export function route(method: string, path: string, handler: RouteHandler): PatternRoute {
  const keys: string[] = [];
  const source = path.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { method, pattern: new RegExp(`^${source}$`), keys, handler };
}
