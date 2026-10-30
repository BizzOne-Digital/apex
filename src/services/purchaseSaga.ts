import { randomUUID } from 'crypto';
import type Stripe from 'stripe';
import type { Env } from '../config/env.js';
import { priceBreakdown } from '../config/pricing.js';
import { Entitlement } from '../models/Entitlement.js';
import { Order, type OrderDocument, type OrderStatus } from '../models/Order.js';
import { Program } from '../models/Program.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/errors.js';
import { grantEntitlement } from './entitlementService.js';
import { getStripe } from './stripeClient.js';

/**
 * Purchase saga (orchestrated, state kept in the Order document).
 *
 *   1. order_created      create the Order                                   (undo: none, nothing charged yet)
 *   2. checkout_session   create the Stripe Checkout Session                 (undo: order -> failed)
 *   3. payment_confirmed  webhook: session paid, amount + currency verified  (undo: refund)
 *   4. entitlement        grant the program to the account                   (undo: refund the payment)
 *   5. order_fulfilled    order -> fulfilled
 *
 * Every transition is a conditional update, every Stripe call carries an idempotency key and every
 * handler can be run again, so webhook retries, replays and reconciliation can never double-grant or
 * double-refund. A payment is never left without either access or a refund.
 */

const CHECKOUT_TTL_MINUTES = 30;
const TERMINAL: OrderStatus[] = ['fulfilled', 'expired', 'failed', 'refunded', 'revoked'];

export type PublicOrder = {
  orderId: string;
  programSlug: string;
  status: OrderStatus;
  fulfilled: boolean;
  closed: boolean;
  pricing: { currency: string; subtotalCents: number; taxCents: number; totalCents: number; taxRatePercent: number };
};

export function toPublicOrder(o: OrderDocument): PublicOrder {
  return {
    orderId: o.orderId,
    programSlug: o.programSlug,
    status: o.status as OrderStatus,
    fulfilled: o.status === 'fulfilled',
    closed: TERMINAL.includes(o.status as OrderStatus),
    pricing: {
      currency: o.currency ?? 'usd',
      subtotalCents: o.subtotalCents,
      taxCents: o.taxCents,
      totalCents: o.totalCents,
      taxRatePercent: o.taxRatePercent,
    },
  };
}

function publicBase(env: Env): string {
  return (env.PUBLIC_API_URL ?? `http://localhost:${env.PORT}`).replace(/\/+$/, '');
}

async function log(orderId: string, step: string, outcome: 'ok' | 'failed' | 'compensated', detail?: string): Promise<void> {
  await Order.updateOne(
    { orderId },
    { $push: { sagaLog: { $each: [{ step, outcome, at: new Date(), detail: detail?.slice(0, 300) }], $slice: -60 } } }
  );
}

/** Moves an order forward only if it is still in one of the expected states (safe under concurrency and retries). */
async function transition(
  orderId: string,
  from: OrderStatus[],
  to: OrderStatus,
  set: Record<string, unknown> = {}
): Promise<OrderDocument | null> {
  return Order.findOneAndUpdate({ orderId, status: { $in: from } }, { $set: { status: to, ...set } }, { new: true });
}

// ---------------------------------------------------------------------------------------------- step 1 + 2

export async function startCheckout(
  env: Env,
  params: { userId: string; installationId: string; programSlug: string }
): Promise<{ order: PublicOrder; checkoutUrl: string }> {
  const program = await Program.findOne({ slug: params.programSlug, published: true });
  if (!program) throw new ApiError(404, 'NOT_FOUND', 'Program not found');

  const user = await User.findById(params.userId);
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'Account not found');

  const alreadyOwned = await Entitlement.exists({
    userId: params.userId,
    programSlug: program.slug,
    verificationStatus: 'verified',
    entitlementStatus: 'active',
  });
  if (alreadyOwned) throw new ApiError(409, 'ALREADY_OWNED', 'You already own this program');

  // One live checkout per account + program: tapping Buy twice must never open two payment pages.
  const open = await Order.findOne({
    userId: params.userId,
    programSlug: program.slug,
    status: 'checkout_open',
    expiresAt: { $gt: new Date(Date.now() + 2 * 60 * 1000) },
  });
  if (open?.checkoutUrl) return { order: toPublicOrder(open), checkoutUrl: open.checkoutUrl };

  const pricing = priceBreakdown(program.displayPriceUsd, env.TAX_RATE_PERCENT);
  if (pricing.subtotalCents < 50) throw new ApiError(400, 'PRICE_INVALID', 'This program cannot be purchased right now');

  // A crash can leave an order in `created`; release it so it cannot block this account's next attempt.
  await Order.updateMany(
    { userId: params.userId, programSlug: program.slug, status: 'created', updatedAt: { $lt: new Date(Date.now() - 2 * 60 * 1000) } },
    { $set: { status: 'failed', failureReason: 'abandoned' } }
  );

  const stripe = getStripe(env); // fail fast (503) before any order exists when payments are not configured
  const orderId = randomUUID();
  try {
    await Order.create({
      orderId,
      userId: params.userId,
      installationId: params.installationId,
      programSlug: program.slug,
      currency: pricing.currency,
      subtotalCents: pricing.subtotalCents,
      taxCents: pricing.taxCents,
      totalCents: pricing.totalCents,
      taxRatePercent: pricing.taxRatePercent,
      status: 'created',
      sagaLog: [{ step: 'order_created', outcome: 'ok', at: new Date() }],
    });
  } catch (e) {
    // Partial unique index: a second tap while the first order is still being created.
    if ((e as { code?: number }).code === 11000) {
      const inFlight = await Order.findOne({ userId: params.userId, programSlug: program.slug, status: { $in: ['created', 'checkout_open'] } });
      if (inFlight?.checkoutUrl) return { order: toPublicOrder(inFlight), checkoutUrl: inFlight.checkoutUrl };
      throw new ApiError(409, 'CHECKOUT_IN_PROGRESS', 'Your payment page is being prepared. Please try again in a moment.');
    }
    throw e;
  }

  const base = publicBase(env);
  const expiresAtSec = Math.floor(Date.now() / 1000) + CHECKOUT_TTL_MINUTES * 60;
  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        client_reference_id: orderId,
        customer_email: user.email,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: pricing.currency,
              unit_amount: pricing.subtotalCents,
              product_data: { name: `${program.name} Program`, description: 'One-time purchase' },
            },
          },
          {
            quantity: 1,
            price_data: {
              currency: pricing.currency,
              unit_amount: pricing.taxCents,
              product_data: { name: `${env.TAX_LABEL} (${pricing.taxRatePercent}%)` },
            },
          },
        ],
        metadata: { orderId, userId: params.userId, programSlug: program.slug },
        payment_intent_data: {
          description: `${program.name} Program`,
          metadata: { orderId, userId: params.userId, programSlug: program.slug },
        },
        expires_at: expiresAtSec,
        success_url: `${base}/api/v1/stripe/return?o=${orderId}&r=success`,
        cancel_url: `${base}/api/v1/stripe/return?o=${orderId}&r=cancel`,
      },
      { idempotencyKey: `order_${orderId}_session` }
    );
    if (!session.url) throw new Error('Stripe returned no checkout url');
    const updated = await transition(orderId, ['created'], 'checkout_open', {
      stripeSessionId: session.id,
      checkoutUrl: session.url,
      expiresAt: new Date(expiresAtSec * 1000),
    });
    await log(orderId, 'checkout_session', 'ok', session.id);
    return { order: toPublicOrder(updated!), checkoutUrl: session.url };
  } catch (e) {
    // Compensation: nothing was charged, so just close the order.
    await transition(orderId, ['created'], 'failed', { failureReason: 'checkout_session_failed' });
    await log(orderId, 'checkout_session', 'failed', (e as Error).message);
    console.error('[stripe] could not create checkout session', (e as Error).message);
    throw new ApiError(502, 'PAYMENT_UNAVAILABLE', 'Payments are temporarily unavailable. Please try again in a moment.');
  }
}

// ----------------------------------------------------------------------------------------- steps 3, 4, 5

/** Undo for steps 3-4: give the money back. The order stays `refund_pending` until Stripe confirms. */
async function compensateWithRefund(env: Env, order: OrderDocument, reason: string): Promise<void> {
  const claimed = await transition(order.orderId, ['paid', 'refund_pending'], 'refund_pending', { failureReason: reason });
  if (!claimed) return;
  const pi = claimed.stripePaymentIntentId;
  if (!pi) {
    await log(order.orderId, 'refund', 'failed', 'no payment intent to refund: needs manual review');
    return;
  }
  try {
    await getStripe(env).refunds.create(
      { payment_intent: pi, metadata: { orderId: order.orderId, cause: reason } },
      { idempotencyKey: `order_${order.orderId}_refund` }
    );
  } catch (e) {
    await log(order.orderId, 'refund', 'failed', (e as Error).message);
    throw e; // webhook answers 5xx so Stripe retries; reconcile also keeps trying while refund_pending
  }
  await Entitlement.updateMany(
    { storeTransactionId: pi, purchaseSource: 'stripe' },
    { $set: { entitlementStatus: 'refunded' } }
  );
  await transition(order.orderId, ['refund_pending'], 'refunded');
  await log(order.orderId, 'refund', 'compensated', reason);
}

async function fulfill(env: Env, order: OrderDocument): Promise<void> {
  try {
    await grantEntitlement({
      installationId: order.installationId,
      userId: order.userId,
      programSlug: order.programSlug,
      purchaseSource: 'stripe',
      storeTransactionId: order.stripePaymentIntentId!,
      metadata: { orderId: order.orderId, totalCents: order.totalCents, taxCents: order.taxCents },
    });
  } catch (e) {
    await log(order.orderId, 'entitlement', 'failed', (e as Error).message);
    await compensateWithRefund(env, order, 'fulfillment_failed');
    return;
  }
  await log(order.orderId, 'entitlement', 'ok');
  await transition(order.orderId, ['paid'], 'fulfilled', { fulfilledAt: new Date() });
  await log(order.orderId, 'order_fulfilled', 'ok');
}

export async function handleCheckoutCompleted(env: Env, session: Stripe.Checkout.Session): Promise<void> {
  const orderId = session.metadata?.orderId ?? session.client_reference_id;
  if (!orderId) return; // not one of our checkouts
  const order = await Order.findOne({ orderId });
  if (!order || order.stripeSessionId !== session.id) {
    console.warn('[stripe] checkout session does not match an order', session.id);
    return;
  }
  if (TERMINAL.includes(order.status as OrderStatus)) return; // already settled (replay)
  if (session.payment_status !== 'paid') return; // delayed payment method: wait for async_payment_succeeded

  const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  if (!pi) {
    await transition(orderId, ['created', 'checkout_open'], 'failed', { failureReason: 'missing_payment_intent' });
    await log(orderId, 'payment_confirmed', 'failed', 'session had no payment intent');
    return;
  }

  const paid = await transition(orderId, ['created', 'checkout_open', 'paid'], 'paid', {
    stripePaymentIntentId: pi,
    paidAt: new Date(),
  });
  if (!paid) return;

  // Never trust the redirect or the client: the charged amount must be exactly what the order says.
  if (session.amount_total !== paid.totalCents || (session.currency ?? '').toLowerCase() !== paid.currency) {
    await log(orderId, 'payment_confirmed', 'failed', `amount mismatch ${session.amount_total} ${session.currency}`);
    await compensateWithRefund(env, paid, 'amount_mismatch');
    return;
  }
  await log(orderId, 'payment_confirmed', 'ok', pi);
  await fulfill(env, paid);
}

export async function handleSessionExpired(session: Stripe.Checkout.Session): Promise<void> {
  const orderId = session.metadata?.orderId;
  if (!orderId) return;
  const o = await transition(orderId, ['created', 'checkout_open'], 'expired');
  if (o) await log(orderId, 'checkout_session', 'compensated', 'expired');
}

export async function handleAsyncPaymentFailed(session: Stripe.Checkout.Session): Promise<void> {
  const orderId = session.metadata?.orderId;
  if (!orderId) return;
  const o = await transition(orderId, ['created', 'checkout_open'], 'failed', { failureReason: 'async_payment_failed' });
  if (o) await log(orderId, 'payment_confirmed', 'failed', 'delayed payment failed');
}

function intentId(v: string | Stripe.PaymentIntent | null | undefined): string | undefined {
  return typeof v === 'string' ? v : v?.id;
}

/** Money went back to the customer (refund from the Stripe dashboard): access ends. */
export async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const pi = intentId(charge.payment_intent);
  if (!pi || !charge.refunded) return; // partial refunds do not remove access
  await Entitlement.updateMany({ storeTransactionId: pi, purchaseSource: 'stripe' }, { $set: { entitlementStatus: 'refunded' } });
  const o = await Order.findOne({ stripePaymentIntentId: pi });
  if (o && transitionable(o.status, ['fulfilled', 'paid', 'refund_pending'])) {
    await transition(o.orderId, ['fulfilled', 'paid', 'refund_pending'], 'refunded');
    await log(o.orderId, 'refund', 'ok', 'refunded in Stripe');
  }
}

/** A card dispute freezes access immediately. */
export async function handleDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
  const pi = intentId(dispute.payment_intent);
  if (!pi) return;
  await Entitlement.updateMany({ storeTransactionId: pi, purchaseSource: 'stripe' }, { $set: { entitlementStatus: 'revoked' } });
  const o = await Order.findOne({ stripePaymentIntentId: pi });
  if (o && transitionable(o.status, ['fulfilled', 'paid'])) {
    await transition(o.orderId, ['fulfilled', 'paid'], 'revoked', { failureReason: 'dispute' });
    await log(o.orderId, 'dispute', 'ok', dispute.id);
  }
}

const transitionable = (s: string, from: OrderStatus[]) => from.includes(s as OrderStatus);

// ------------------------------------------------------------------------------------------ webhook entry

export async function dispatchStripeEvent(env: Env, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return handleCheckoutCompleted(env, event.data.object as Stripe.Checkout.Session);
    case 'checkout.session.expired':
      return handleSessionExpired(event.data.object as Stripe.Checkout.Session);
    case 'checkout.session.async_payment_failed':
      return handleAsyncPaymentFailed(event.data.object as Stripe.Checkout.Session);
    case 'charge.refunded':
      return handleChargeRefunded(event.data.object as Stripe.Charge);
    case 'charge.dispute.created':
      return handleDisputeCreated(event.data.object as Stripe.Dispute);
    default:
      return; // events we did not subscribe to are acknowledged and ignored
  }
}

// ------------------------------------------------------------------------------------------- reconcile

/**
 * Safety net for lost webhooks and crashes in the middle of the saga. Run it on a schedule
 * (e.g. Vercel Cron -> POST /api/v1/admin/orders/reconcile) or by hand.
 */
export async function reconcileOrders(env: Env): Promise<{ checked: number; advanced: number; expired: number; retriedRefunds: number }> {
  const stripe = getStripe(env);
  const out = { checked: 0, advanced: 0, expired: 0, retriedRefunds: 0 };
  const cutoff = new Date(Date.now() - 5 * 60 * 1000);

  // Checkout still open but Stripe may already have the final answer.
  const open = await Order.find({ status: { $in: ['checkout_open', 'created'] }, updatedAt: { $lt: cutoff } }).limit(100);
  for (const o of open) {
    out.checked++;
    if (!o.stripeSessionId) {
      if (await transition(o.orderId, ['created'], 'failed', { failureReason: 'never_reached_stripe' })) out.expired++;
      continue;
    }
    const s = await stripe.checkout.sessions.retrieve(o.stripeSessionId);
    if (s.status === 'complete' && s.payment_status === 'paid') {
      await handleCheckoutCompleted(env, s);
      out.advanced++;
    } else if (s.status === 'expired') {
      await handleSessionExpired({ ...s, metadata: { ...(s.metadata ?? {}), orderId: o.orderId } } as Stripe.Checkout.Session);
      out.expired++;
    }
  }

  // Paid but never fulfilled (crash between steps 3 and 5): run step 4 again.
  const stuck = await Order.find({ status: 'paid', updatedAt: { $lt: cutoff } }).limit(100);
  for (const o of stuck) {
    out.checked++;
    await fulfill(env, o);
    out.advanced++;
  }

  // Refund that failed earlier: try again (idempotency key makes this safe).
  const refunds = await Order.find({ status: 'refund_pending', updatedAt: { $lt: cutoff } }).limit(100);
  for (const o of refunds) {
    out.checked++;
    try {
      await compensateWithRefund(env, o, o.failureReason ?? 'retry');
      out.retriedRefunds++;
    } catch {
      /* stays refund_pending, shows up again on the next run */
    }
  }
  return out;
}
