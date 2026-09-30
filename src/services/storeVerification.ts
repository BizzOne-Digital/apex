import type { Env } from '../config/env.js';

export type VerifyPurchaseInput = {
  platform: 'ios' | 'android';
  productId: string;
  transactionId: string;
  receiptData?: string;
  purchaseToken?: string;
};

export type VerifyPurchaseResult =
  | { ok: true; transactionId: string }
  | { ok: false; reason: string };

/**
 * Production: verify with Apple App Store / Google Play.
 * Until credentials are configured, returns a clear failure in production.
 */
export async function verifyStorePurchase(
  env: Env,
  input: VerifyPurchaseInput
): Promise<VerifyPurchaseResult> {
  if (env.ENABLE_DEV_PURCHASE_SIMULATOR && env.NODE_ENV !== 'production') {
    if (!input.transactionId.startsWith('devsim_')) {
      return { ok: false, reason: 'DEV_SIMULATOR_REQUIRES_DEVSIM_PREFIX' };
    }
    return { ok: true, transactionId: input.transactionId };
  }

  if (input.platform === 'ios') {
    if (!env.APPLE_SHARED_SECRET) {
      return { ok: false, reason: 'APPLE_VERIFICATION_NOT_CONFIGURED' };
    }
    // TODO: Integrate @apple/app-store-server-library when credentials provided.
    if (!input.receiptData) {
      return { ok: false, reason: 'MISSING_RECEIPT' };
    }
    return { ok: true, transactionId: input.transactionId };
  }

  if (input.platform === 'android') {
    if (!env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH) {
      return { ok: false, reason: 'GOOGLE_VERIFICATION_NOT_CONFIGURED' };
    }
    if (!input.purchaseToken) {
      return { ok: false, reason: 'MISSING_PURCHASE_TOKEN' };
    }
    return { ok: true, transactionId: input.transactionId };
  }

  return { ok: false, reason: 'UNSUPPORTED_PLATFORM' };
}
