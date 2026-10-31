import { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import { Program } from '../../models/Program.js';
import { grantEntitlement } from '../../services/entitlementService.js';
import { verifyStorePurchase } from '../../services/storeVerification.js';
import { isWebPurchaseEnabled, verifyWebPurchase } from '../../services/webPurchase.js';
import { ApiError } from '../../utils/errors.js';
import { requireUser } from '../../middleware/userAuth.js';
import { Order } from '../../models/Order.js';
import { startCheckout, toPublicOrder } from '../../services/purchaseSaga.js';
import { stripeEnabled } from '../../services/stripeClient.js';

const verifyBodySchema = z.object({
  platform: z.enum(['ios', 'android']),
  programSlug: z.string().min(1),
  productId: z.string().min(1),
  transactionId: z.string().min(1),
  receiptData: z.string().optional(),
  purchaseToken: z.string().optional(),
});

const restoreBodySchema = z.object({
  platform: z.enum(['ios', 'android']),
  purchases: z.array(
    z.object({
      productId: z.string(),
      transactionId: z.string(),
      receiptData: z.string().optional(),
      purchaseToken: z.string().optional(),
    })
  ),
});

const devSimSchema = z.object({
  programSlug: z.string().min(1),
});

const checkoutSchema = z.object({
  programSlug: z.string().trim().min(1).max(60),
});

const ORDER_ID = /^[0-9a-f-]{36}$/;

export function purchasesRouter(env: Env): Router {
  const router = Router();
  const mustLogin = requireUser(env);

  /** Tells the app how to take payment, so a server setting (not an app rebuild) switches Stripe on. */
  router.get('/config', (_req, res) => {
    res.json({
      payments: stripeEnabled(env) ? 'stripe' : 'store',
      currency: 'usd',
      taxRatePercent: env.TAX_RATE_PERCENT,
      taxLabel: env.TAX_LABEL,
    });
  });

  /** Starts a Stripe Checkout for the logged-in account. Price and tax are always computed here, never by the app. */
  router.post('/checkout', mustLogin, async (req, res, next) => {
    try {
      const body = checkoutSchema.parse(req.body);
      const { order, checkoutUrl } = await startCheckout(env, {
        userId: req.userId!,
        installationId: req.installationId!,
        programSlug: body.programSlug,
      });
      res.status(201).json({ order, checkoutUrl });
    } catch (e) {
      next(e);
    }
  });

  /** Order status for the app to poll after the payment page closes. Only the owner can see an order. */
  router.get('/orders/:orderId', mustLogin, async (req, res, next) => {
    try {
      const id = String(req.params.orderId);
      const order = ORDER_ID.test(id) ? await Order.findOne({ orderId: id, userId: req.userId }) : null;
      if (!order) throw new ApiError(404, 'NOT_FOUND', 'Order not found');
      res.json({ order: toPublicOrder(order) });
    } catch (e) {
      next(e);
    }
  });

  router.post('/verify', async (req, res, next) => {
    try {
      const installationId = req.installationId!;
      const body = verifyBodySchema.parse(req.body);

      const program = await Program.findOne({ slug: body.programSlug, published: true });
      if (!program) throw new ApiError(404, 'NOT_FOUND', 'Program not found');

      const storeIds = program.storeProductIds ?? { ios: '', android: '' };
      const expectedProduct =
        body.platform === 'ios' ? storeIds.ios : storeIds.android;
      if (expectedProduct && body.productId !== expectedProduct) {
        throw new ApiError(400, 'PRODUCT_MISMATCH', 'Product ID does not match program');
      }

      const verified = await verifyStorePurchase(env, {
        platform: body.platform,
        productId: body.productId,
        transactionId: body.transactionId,
        receiptData: body.receiptData,
        purchaseToken: body.purchaseToken,
      });

      if (!verified.ok) {
        throw new ApiError(402, 'VERIFICATION_FAILED', verified.reason);
      }

      await grantEntitlement({
        installationId,
        userId: req.userId,
        programSlug: body.programSlug,
        purchaseSource: body.platform === 'ios' ? 'apple' : 'google',
        storeTransactionId: verified.transactionId,
        rawReceiptRef: body.receiptData ?? body.purchaseToken,
      });

      res.json({ success: true, programSlug: body.programSlug });
    } catch (e) {
      next(e);
    }
  });

  router.post('/restore', async (req, res, next) => {
    try {
      const installationId = req.installationId!;
      const body = restoreBodySchema.parse(req.body);
      const restored: string[] = [];

      for (const purchase of body.purchases) {
        const program = await Program.findOne({
          $or: [
            { 'storeProductIds.ios': purchase.productId },
            { 'storeProductIds.android': purchase.productId },
          ],
          published: true,
        });
        if (!program) continue;

        const verified = await verifyStorePurchase(env, {
          platform: body.platform,
          productId: purchase.productId,
          transactionId: purchase.transactionId,
          receiptData: purchase.receiptData,
          purchaseToken: purchase.purchaseToken,
        });
        if (!verified.ok) continue;

        await grantEntitlement({
          installationId,
          userId: req.userId,
          programSlug: program.slug,
          purchaseSource: body.platform === 'ios' ? 'apple' : 'google',
          storeTransactionId: verified.transactionId,
        });
        restored.push(program.slug);
      }

      res.json({ restored: [...new Set(restored)] });
    } catch (e) {
      next(e);
    }
  });

  router.post('/dev-simulate', async (req, res, next) => {
    try {
      const allowDevSimulate =
        env.CLIENT_PREVIEW_DEMO_PURCHASES ||
        (env.NODE_ENV !== 'production' && env.ENABLE_DEV_PURCHASE_SIMULATOR);
      if (!allowDevSimulate) {
        throw new ApiError(403, 'FORBIDDEN', 'Dev purchase simulator disabled');
      }
      const installationId = req.installationId!;
      const body = devSimSchema.parse(req.body);
      const txId = `devsim_${body.programSlug}_${Date.now()}`;

      await grantEntitlement({
        installationId,
        userId: req.userId,
        programSlug: body.programSlug,
        purchaseSource: 'dev_simulator',
        storeTransactionId: txId,
        metadata: { simulated: true },
      });

      res.json({ success: true, programSlug: body.programSlug, transactionId: txId });
    } catch (e) {
      next(e);
    }
  });

  router.post('/web-verify', async (_req, res, next) => {
    try {
      if (!isWebPurchaseEnabled(env)) {
        throw new ApiError(403, 'DISABLED', 'Website purchase verification is not enabled');
      }
      const ok = await verifyWebPurchase('');
      if (!ok) throw new ApiError(402, 'VERIFICATION_FAILED', 'Web purchase not verified');
      res.json({ success: true });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
