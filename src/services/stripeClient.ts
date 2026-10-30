import Stripe from 'stripe';
import type { Env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';

let cached: Stripe | null = null;
let override: Stripe | null = null;

export function stripeEnabled(env: Env): boolean {
  return Boolean(override || env.STRIPE_SECRET_KEY);
}

export function getStripe(env: Env): Stripe {
  if (override) return override;
  if (!env.STRIPE_SECRET_KEY) {
    throw new ApiError(503, 'PAYMENTS_UNAVAILABLE', 'Online payments are not available right now');
  }
  if (!cached) {
    const mock = env.STRIPE_API_BASE ? new URL(env.STRIPE_API_BASE) : null; // dev/test only (refused in production by loadEnv)
    cached = new Stripe(env.STRIPE_SECRET_KEY, {
      maxNetworkRetries: 2,
      timeout: 20_000,
      appInfo: { name: 'elite-body-fitness-pros-api' },
      ...(mock ? { host: mock.hostname, port: mock.port || undefined, protocol: mock.protocol.replace(':', '') as 'http' | 'https' } : {}),
    });
  }
  return cached;
}

/** Tests inject a client whose network calls are stubbed. */
export function setStripeClientForTests(client: Stripe | null): void {
  override = client;
}
