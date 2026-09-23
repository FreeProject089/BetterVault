import { describe, it, expect } from 'vitest';
import { createMissingStripePrices, normalizePlan, type StripeCall } from '../server/src/billing.ts';

/**
 * Offres créées de zéro dans /admin : le serveur crée lui-même produit et prix
 * dans Stripe. On vérifie ce qui est envoyé, et qu'un prix existant n'est
 * jamais recréé.
 */

function fakeStripe() {
  const calls: Array<{ path: string; form: Record<string, string> }> = [];
  let n = 0;
  const stripe: StripeCall = async <T>(_method: 'GET' | 'POST', path: string, form: Record<string, string> = {}) => {
    calls.push({ path, form });
    n++;
    return { id: path === 'products' ? `prod_T${n}` : `price_T${n}` } as T;
  };
  return { stripe, calls };
}

describe('Offres créées dans Stripe', () => {
  it('accepte un tarif défini par son montant, sans prix Stripe', () => {
    const plan = normalizePlan({ id: 'plus', name: 'Plus', prices: [{ id: 'mensuel', amount: 490, currency: 'EUR', interval: 'month' }] });
    expect(plan.prices[0]).toMatchObject({ stripePriceId: '', amount: 490, currency: 'eur', interval: 'month', mode: 'subscription' });
  });

  it('refuse un tarif sans prix Stripe ni montant complet', () => {
    expect(() => normalizePlan({ id: 'plus', name: 'Plus', prices: [{ id: 'mensuel', amount: 490 }] })).toThrow(/montant, une devise et une période/);
    expect(() => normalizePlan({ id: 'plus', name: 'Plus', prices: [{ id: 'mensuel', amount: 10, currency: 'eur', interval: 'month' }] })).toThrow(/montant invalide/);
  });

  it('crée un produit par offre et un prix par tarif, puis garde leurs identifiants', async () => {
    const plan = normalizePlan({ id: 'plus', name: 'Plus', description: 'Plus d’espace', prices: [
      { id: 'mensuel', amount: 490, currency: 'eur', interval: 'month' },
      { id: 'annuel', amount: 4900, currency: 'eur', interval: 'year' },
      { id: 'vie', amount: 9900, currency: 'eur', interval: 'once' }
    ] });
    const { stripe, calls } = fakeStripe();
    const { plans, created } = await createMissingStripePrices([plan], stripe);

    expect(created).toBe(3);
    expect(calls.filter(c => c.path === 'products')).toHaveLength(1);
    expect(calls[0].form).toMatchObject({ name: 'Plus', description: 'Plus d’espace', 'metadata[bettervault_plan]': 'plus' });
    const prix = calls.filter(c => c.path === 'prices');
    expect(prix[0].form).toMatchObject({ product: 'prod_T1', unit_amount: '490', currency: 'eur', 'recurring[interval]': 'month' });
    expect(prix[1].form['recurring[interval]']).toBe('year');
    // Un achat unique n'a pas de récurrence et devient un paiement
    expect(prix[2].form['recurring[interval]']).toBeUndefined();
    expect(plans[0].prices[2].mode).toBe('payment');
    expect(plans[0].stripeProductId).toBe('prod_T1');
    expect(plans[0].prices.every(p => p.stripePriceId.startsWith('price_'))).toBe(true);
  });

  it('ne recrée rien de ce qui existe déjà', async () => {
    const plan = normalizePlan({ id: 'plus', name: 'Plus', stripeProductId: 'prod_Existe', prices: [
      { id: 'mensuel', stripePriceId: 'price_Existe' },
      { id: 'annuel', amount: 4900, currency: 'eur', interval: 'year' }
    ] });
    const { stripe, calls } = fakeStripe();
    const { created } = await createMissingStripePrices([plan], stripe);
    expect(created).toBe(1);
    expect(calls.map(c => c.path)).toEqual(['prices']);
    expect(calls[0].form.product).toBe('prod_Existe');
  });
});
