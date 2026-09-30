import type { Env } from '../config/env.js';

/**
 * Disabled-by-default integration for future verified website purchases.
 * Do not expose UI until WEB_PURCHASE_ENABLED and compliance are approved.
 */
export function isWebPurchaseEnabled(env: Env): boolean {
  return env.WEB_PURCHASE_ENABLED === true;
}

export async function verifyWebPurchase(_webPurchaseId: string): Promise<boolean> {
  return false;
}
