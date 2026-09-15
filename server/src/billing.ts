import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import type { ServerLimits, ServerSettings } from './config.ts';
import { HttpError, readJson, readRaw, type Reply } from './http.ts';
import type { RouteContext } from './context.ts';

/**
 * Espace supplémentaire payant, optionnel et configuré par chaque serveur.
 *
 * - Offres définies dans /admin : prix Stripe, espace de pièces jointes, coffres, taille de coffre en plus.
 * - Paiement sur Stripe Checkout : BetterVault ne voit ni la carte ni l'adresse de facturation,
 *   et n'envoie pas l'email du compte à Stripe (Stripe le demande lui-même au client).
 * - Webhook signé : l'abonnement est activé ou arrêté par Stripe, jamais par l'application.
 */

export type BoostKey = 'attachmentQuotaBytes' | 'maxAttachmentBytes' | 'maxVaultBytes' | 'maxVaults' | 'maxCredentialsPerVault';

export const BOOST_KEYS: BoostKey[] = ['attachmentQuotaBytes', 'maxAttachmentBytes', 'maxVaultBytes', 'maxVaults', 'maxCredentialsPerVault'];

export interface BillingPlan {
  id: string;
  name: string;
  description: string;
  /** Texte affiché, ex. « 2 € / mois » */
  priceLabel: string;
  stripePriceId: string;
  mode: 'subscription' | 'payment';
  boosts: Partial<Record<BoostKey, number>>;
}

export interface BillingSettings {
  enabled: boolean;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  plans: BillingPlan[];
}

export const DEFAULT_BILLING: BillingSettings = { enabled: false, stripeSecretKey: '', stripeWebhookSecret: '', plans: [] };

export function billingFromEnv(env: Record<string, string | undefined>): BillingSettings {
  return {
    enabled: env.BILLING_ENABLED === 'true',
    stripeSecretKey: env.STRIPE_SECRET_KEY ?? '',
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '',
    plans: []
  };
}

export function parseBillingUpdate(input: unknown, current: BillingSettings): BillingSettings {
  const body = (input ?? {}) as Partial<BillingSettings>;
  const next: BillingSettings = { ...current, plans: [...current.plans] };
  if (typeof body.enabled === 'boolean') next.enabled = body.enabled;
  if (typeof body.stripeSecretKey === 'string' && body.stripeSecretKey) {
    if (!/^(sk|rk)_(test|live)_/.test(body.stripeSecretKey)) throw new Error('Clé secrète Stripe invalide (sk_… ou rk_…)');
    next.stripeSecretKey = body.stripeSecretKey;
  }
  if (typeof body.stripeWebhookSecret === 'string' && body.stripeWebhookSecret) {
    if (!body.stripeWebhookSecret.startsWith('whsec_')) throw new Error('Secret de webhook Stripe invalide (whsec_…)');
    next.stripeWebhookSecret = body.stripeWebhookSecret;
  }
  if (Array.isArray(body.plans)) {
    if (body.plans.length > 20) throw new Error('20 offres maximum');
    const ids = new Set<string>();
    next.plans = body.plans.map((raw, index) => {
      const plan = raw as Partial<BillingPlan>;
      const id = String(plan.id ?? '').trim();
      if (!/^[a-z0-9-]{2,32}$/.test(id) || ids.has(id)) throw new Error(`Offre ${index + 1} : identifiant invalide ou en double`);
      ids.add(id);
      const name = String(plan.name ?? '').trim();
      if (!name || name.length > 60) throw new Error(`Offre ${id} : nom requis (60 caractères max.)`);
      const stripePriceId = String(plan.stripePriceId ?? '').trim();
      if (!/^price_[A-Za-z0-9]+$/.test(stripePriceId)) throw new Error(`Offre ${id} : identifiant de prix Stripe invalide (price_…)`);
      const boosts: BillingPlan['boosts'] = {};
      for (const key of BOOST_KEYS) {
        const value = (plan.boosts as Record<string, unknown> | undefined)?.[key];
        if (value === undefined || value === null || value === 0) continue;
        if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`Offre ${id} : valeur « ${key} » invalide`);
        boosts[key] = value as number;
      }
      return {
        id,
        name,
        description: String(plan.description ?? '').trim().slice(0, 300),
        priceLabel: String(plan.priceLabel ?? '').trim().slice(0, 40),
        stripePriceId,
        mode: plan.mode === 'payment' ? 'payment' : 'subscription',
        boosts
      };
    });
  }
  return next;
}

export function publicBilling(billing: BillingSettings): unknown {
  return { ...billing, stripeSecretKey: '', stripeWebhookSecret: '', hasSecretKey: !!billing.stripeSecretKey, hasWebhookSecret: !!billing.stripeWebhookSecret };
}

interface SubscriptionRow {
  user_id: string;
  plan_id: string;
  status: string;
  current_period_end: number | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

export function activeSubscription(db: DatabaseSync, userId: string, now: number): SubscriptionRow | null {
  const row = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId) as SubscriptionRow | undefined;
  if (!row || !ACTIVE_STATUSES.has(row.status)) return null;
  if (row.current_period_end !== null && row.current_period_end < now) return null;
  return row;
}

/** Limites d'un compte : celles du serveur, plus les suppléments de son offre active */
export function createLimitsResolver(db: DatabaseSync, settings: () => ServerSettings, now: () => number): (userId: string) => ServerLimits {
  return userId => {
    const current = settings();
    const limits = { ...current.limits };
    if (!current.billing.enabled) return limits;
    const subscription = activeSubscription(db, userId, now());
    const plan = subscription && current.billing.plans.find(p => p.id === subscription.plan_id);
    if (plan) for (const key of BOOST_KEYS) limits[key] += plan.boosts[key] ?? 0;
    return limits;
  };
}

/** Vérifie l'en-tête Stripe-Signature (HMAC-SHA256 de « horodatage.corps », tolérance de 5 minutes) */
export function verifyStripeSignature(payload: Buffer, header: string, secret: string, nowMs: number, toleranceSeconds = 300): boolean {
  const parts = Object.fromEntries(header.split(',').map(part => part.split('=') as [string, string]).filter(([k, v]) => k && v).map(([k, v]) => [k.trim(), v]));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(nowMs / 1000 - timestamp) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(payload).digest();
  return header.split(',').filter(p => p.trim().startsWith('v1=')).some(p => {
    const candidate = Buffer.from(p.trim().slice(3), 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

export function billingRoutes(ctx: RouteContext, fetchImpl: typeof fetch): Record<string, (req: IncomingMessage) => Promise<Reply>> {
  const billing = () => ctx.settings().billing;

  const stripe = async <T>(method: 'GET' | 'POST', path: string, form?: Record<string, string>): Promise<T> => {
    const key = billing().stripeSecretKey;
    if (!key) throw new HttpError(503, 'billing_unavailable', 'Paiement non configuré sur ce serveur');
    let response: Response;
    try {
      response = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        body: form ? new URLSearchParams(form).toString() : undefined
      });
    } catch {
      throw new HttpError(502, 'stripe_unreachable', 'Stripe injoignable');
    }
    const json = await response.json().catch(() => null) as T & { error?: { message?: string } } | null;
    if (!response.ok || !json) throw new HttpError(502, 'stripe_error', `Stripe : ${json?.error?.message ?? `HTTP ${response.status}`}`);
    return json;
  };

  const returnUrl = (path: string) => {
    const base = ctx.settings().publicUrl;
    if (!base) throw new HttpError(503, 'public_url_missing', 'Adresse publique du serveur non configurée (PUBLIC_URL)');
    return `${base}${path}`;
  };

  const upsert = ctx.db.prepare(`
    INSERT INTO subscriptions (user_id, plan_id, status, current_period_end, stripe_customer_id, stripe_subscription_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET plan_id = excluded.plan_id, status = excluded.status, current_period_end = excluded.current_period_end,
      stripe_customer_id = excluded.stripe_customer_id, stripe_subscription_id = excluded.stripe_subscription_id, updated_at = excluded.updated_at`);

  const periodEnd = (subscription: Record<string, unknown>): number | null => {
    const direct = subscription.current_period_end as number | undefined;
    const item = (subscription.items as { data?: Array<{ current_period_end?: number }> } | undefined)?.data?.[0]?.current_period_end;
    const value = direct ?? item;
    return typeof value === 'number' ? value * 1000 : null;
  };

  return {
    'GET /api/v1/billing': async req => {
      const { userId } = ctx.authenticate(req);
      const settings = billing();
      const row = ctx.db.prepare('SELECT plan_id, status, current_period_end FROM subscriptions WHERE user_id = ?').get(userId) as Pick<SubscriptionRow, 'plan_id' | 'status' | 'current_period_end'> | undefined;
      return {
        status: 200,
        body: {
          enabled: settings.enabled && !!settings.stripeSecretKey,
          plans: settings.enabled ? settings.plans.map(({ stripePriceId: _price, ...plan }) => plan) : [],
          subscription: row ? { planId: row.plan_id, status: row.status, currentPeriodEnd: row.current_period_end, active: !!activeSubscription(ctx.db, userId, ctx.now()) } : null,
          limits: ctx.limitsFor(userId)
        }
      };
    },

    'POST /api/v1/billing/checkout': async req => {
      const { userId } = ctx.authenticate(req);
      ctx.limit(req, 'billing');
      if (!billing().enabled) throw new HttpError(404, 'billing_disabled', 'Offres désactivées sur ce serveur');
      const planId = String((await readJson(req, 1024)).planId ?? '');
      const plan = billing().plans.find(p => p.id === planId);
      if (!plan) throw new HttpError(400, 'invalid_plan', 'Offre inconnue');
      const session = await stripe<{ url: string }>('POST', 'checkout/sessions', {
        mode: plan.mode,
        'line_items[0][price]': plan.stripePriceId,
        'line_items[0][quantity]': '1',
        client_reference_id: userId,
        'metadata[user_id]': userId,
        'metadata[plan_id]': plan.id,
        ...(plan.mode === 'subscription' ? { 'subscription_data[metadata][user_id]': userId, 'subscription_data[metadata][plan_id]': plan.id } : {}),
        success_url: returnUrl('/?billing=success'),
        cancel_url: returnUrl('/?billing=cancel')
      });
      return { status: 200, body: { url: session.url } };
    },

    'POST /api/v1/billing/portal': async req => {
      const { userId } = ctx.authenticate(req);
      ctx.limit(req, 'billing');
      const row = ctx.db.prepare('SELECT stripe_customer_id FROM subscriptions WHERE user_id = ?').get(userId) as { stripe_customer_id: string | null } | undefined;
      if (!row?.stripe_customer_id) throw new HttpError(404, 'no_customer', 'Aucun abonnement à gérer');
      const portal = await stripe<{ url: string }>('POST', 'billing_portal/sessions', { customer: row.stripe_customer_id, return_url: returnUrl('/') });
      return { status: 200, body: { url: portal.url } };
    },

    'POST /api/v1/billing/webhook': async req => {
      const secret = billing().stripeWebhookSecret;
      if (!secret) throw new HttpError(404, 'not_found', 'Route inconnue');
      const payload = await readRaw(req, 512 * 1024);
      if (!verifyStripeSignature(payload, String(req.headers['stripe-signature'] ?? ''), secret, ctx.now())) {
        throw new HttpError(400, 'invalid_signature', 'Signature Stripe invalide');
      }
      const event = JSON.parse(payload.toString('utf8')) as { id: string; type: string; data: { object: Record<string, unknown> } };
      // Idempotence : Stripe peut renvoyer le même événement
      const inserted = ctx.db.prepare('INSERT OR IGNORE INTO billing_events (id, received_at) VALUES (?, ?)').run(event.id, ctx.now());
      if (Number(inserted.changes) === 0) return { status: 200, body: { received: true, duplicate: true } };

      const object = event.data.object;
      const metadata = (object.metadata ?? {}) as Record<string, string>;

      if (event.type === 'checkout.session.completed') {
        const userId = (object.client_reference_id as string | null) ?? metadata.user_id;
        const planId = metadata.plan_id;
        if (userId && planId && ctx.db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) {
          let end: number | null = null;
          if (typeof object.subscription === 'string') {
            end = periodEnd(await stripe<Record<string, unknown>>('GET', `subscriptions/${encodeURIComponent(object.subscription)}`));
          }
          upsert.run(userId, planId, 'active', end, (object.customer as string | null) ?? null, (object.subscription as string | null) ?? null, ctx.now());
          ctx.audit('billing.subscription_started', { plan: planId }, userId);
        }
      } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
        const row = ctx.db.prepare('SELECT user_id FROM subscriptions WHERE stripe_subscription_id = ?').get(object.id as string) as { user_id: string } | undefined;
        if (row) {
          const status = event.type === 'customer.subscription.deleted' ? 'canceled' : String(object.status ?? 'active');
          ctx.db.prepare('UPDATE subscriptions SET status = ?, current_period_end = ?, updated_at = ? WHERE user_id = ?').run(status, periodEnd(object), ctx.now(), row.user_id);
          ctx.audit('billing.subscription_updated', { status }, row.user_id);
        }
      } else if (event.type === 'invoice.payment_failed' && typeof object.subscription === 'string') {
        ctx.db.prepare("UPDATE subscriptions SET status = 'past_due', updated_at = ? WHERE stripe_subscription_id = ?").run(ctx.now(), object.subscription);
      }
      return { status: 200, body: { received: true } };
    }
  };
}
