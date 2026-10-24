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
 * SECURITY: fails closed. Receipts / purchase tokens are NOT trusted until real server-side
 * verification (App Store Server API / Google Play Developer API) is implemented below.
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
    if (!input.receiptData) {
      return { ok: false, reason: 'MISSING_RECEIPT' };
    }
    // TODO: verify with @apple/app-store-server-library, then return ok:true with the verified transaction id.
    return { ok: false, reason: 'APPLE_VERIFICATION_NOT_IMPLEMENTED' };
  }

  if (input.platform === 'android') {
    if (!env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH) {
      return { ok: false, reason: 'GOOGLE_VERIFICATION_NOT_CONFIGURED' };
    }
    if (!input.purchaseToken) {
      return { ok: false, reason: 'MISSING_PURCHASE_TOKEN' };
    }
    // TODO: verify with the Google Play Developer API (purchases.products.get), then return ok:true.
    return { ok: false, reason: 'GOOGLE_VERIFICATION_NOT_IMPLEMENTED' };
  }

  return { ok: false, reason: 'UNSUPPORTED_PLATFORM' };
}
