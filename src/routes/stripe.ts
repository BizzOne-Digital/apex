import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import type Stripe from 'stripe';
import type { Env } from '../config/env.js';
import { connectMongo } from '../db.js';
import { StripeEvent } from '../models/StripeEvent.js';
import { dispatchStripeEvent, reconcileOrders } from '../services/purchaseSaga.js';
import { getStripe } from '../services/stripeClient.js';

export type WebhookResult = { status: number; body: Record<string, unknown> };

/**
 * Framework-free webhook processing, shared by the Express route (local/tests) and the standalone Vercel
 * function (api/stripe-webhook.ts) that reads the raw request stream itself.
 */
export async function processStripeWebhook(env: Env, rawBody: Buffer, signature: string | undefined): Promise<WebhookResult> {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !signature || !Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    return { status: 400, body: { error: { code: 'BAD_REQUEST', message: 'Invalid webhook request' } } };
  }

  let event: Stripe.Event;
  try {
    // Verifies the HMAC over the exact bytes and rejects anything older than 5 minutes (replay protection).
    event = getStripe(env).webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return { status: 400, body: { error: { code: 'BAD_SIGNATURE', message: 'Invalid signature' } } };
  }

  try {
    await connectMongo(env.MONGODB_URI);
    // Insert-first dedupe: an event that is already done is acknowledged without running again.
    const prior = await StripeEvent.findOneAndUpdate(
      { eventId: event.id },
      { $setOnInsert: { eventId: event.id, type: event.type, status: 'processing', receivedAt: new Date() } },
      { upsert: true, new: false }
    );
    if (prior?.status === 'done') return { status: 200, body: { received: true, duplicate: true } };

    await dispatchStripeEvent(env, event);
    await StripeEvent.updateOne({ eventId: event.id }, { $set: { status: 'done' }, $unset: { error: '' } });
    return { status: 200, body: { received: true } };
  } catch (e) {
    console.error('[stripe] webhook handler failed', event.type, event.id, (e as Error).message);
    await StripeEvent.updateOne({ eventId: event.id }, { $set: { status: 'failed', error: (e as Error).message.slice(0, 300) } }).catch(() => undefined);
    // 5xx makes Stripe retry with backoff; every saga step is idempotent so retries are safe.
    return { status: 500, body: { error: { code: 'WEBHOOK_FAILED', message: 'Processing failed, will retry' } } };
  }
}

/** POST /api/v1/stripe/webhook as an Express route: registered in app.ts BEFORE express.json() with express.raw(). */
export function stripeWebhookHandler(env: Env) {
  return async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { status, body } = await processStripeWebhook(env, req.body as Buffer, req.header('stripe-signature'));
    res.status(status).json(body);
  };
}

const safeEqual = (a: string, b: string) =>
  crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());

/** Scheduled safety net (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`). Disabled unless CRON_SECRET is set. */
export function cronReconcileHandler(env: Env) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = req.header('authorization') ?? '';
      if (!env.CRON_SECRET || !auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), env.CRON_SECRET)) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
        return;
      }
      res.json({ success: true, ...(await reconcileOrders(env)) });
    } catch (e) {
      next(e);
    }
  };
}

const ORDER_ID = /^[0-9a-f-]{36}$/;

/** Page Stripe sends the customer to after paying/cancelling; it hands them back to the app. */
export function stripeReturnRouter(): Router {
  const router = Router();
  router.get('/return', (req, res) => {
    const order = String(req.query.o ?? '');
    const result = req.query.r === 'success' ? 'success' : 'cancel';
    const safeOrder = ORDER_ID.test(order) ? order : '';
    const deepLink = `apexfitness://purchase/return?order=${safeOrder}&result=${result}`;
    const title = result === 'success' ? 'Payment received' : 'Payment cancelled';
    const text =
      result === 'success'
        ? 'Thank you. Return to the Elite Body Fitness Pros app: your program unlocks as soon as the payment is confirmed.'
        : 'No payment was taken. Return to the app whenever you are ready.';
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>${title}</title><style>body{margin:0;background:#020617;color:#f1f5f9;font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px}` +
        `main{max-width:420px}h1{font-size:22px;margin:0 0 12px}p{color:#94a3b8;line-height:1.5}a{display:inline-block;margin-top:20px;background:#19b8ff;color:#020617;font-weight:700;padding:14px 24px;border-radius:999px;text-decoration:none}</style></head>` +
        `<body><main><h1>${title}</h1><p>${text}</p><a href="${deepLink}">OPEN THE APP</a></main></body></html>`
    );
  });
  return router;
}
