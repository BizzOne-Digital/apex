import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import Stripe from 'stripe';
import './setup.js';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { priceBreakdown } from '../src/config/pricing.js';
import { Program } from '../src/models/Program.js';
import { Order } from '../src/models/Order.js';
import { Entitlement } from '../src/models/Entitlement.js';
import { StripeEvent } from '../src/models/StripeEvent.js';
import { issueInstallationToken } from '../src/services/installationToken.js';
import { reconcileOrders } from '../src/services/purchaseSaga.js';
import { setStripeClientForTests } from '../src/services/stripeClient.js';

const WEBHOOK_SECRET = 'whsec_' + 'a'.repeat(32);
const DEVICE = '33333333-3333-3333-3333-333333333333';

let app: Express;
let env: ReturnType<typeof loadEnv>;

// A real Stripe client (so webhook signatures are verified by the real library) with the network calls stubbed.
const stripe = new Stripe('sk_test_' + 'b'.repeat(24));
const createSession = vi.fn();
const retrieveSession = vi.fn();
const createRefund = vi.fn();
(stripe.checkout.sessions as unknown as Record<string, unknown>).create = createSession;
(stripe.checkout.sessions as unknown as Record<string, unknown>).retrieve = retrieveSession;
(stripe.refunds as unknown as Record<string, unknown>).create = createRefund;

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_' + 'b'.repeat(24);
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.PUBLIC_API_URL = 'https://api.example.test';
  env = loadEnv();
  app = createApp(env);
  setStripeClientForTests(stripe);
});

afterAll(() => setStripeClientForTests(null));

const device = () => ({ 'x-installation-id': DEVICE, 'x-installation-token': issueInstallationToken(DEVICE, env) });
const profile = { name: 'Pay Tester', age: 30, gender: 'male', weight: { value: 80, unit: 'kg' }, height: { value: 180, unit: 'cm' } };

async function login(email = 'buyer@test.com') {
  const s = await request(app).post('/api/v1/auth/signup').set(device()).send({ email, password: 'S3cure-passw0rd', profile });
  expect(s.status).toBe(201);
  return { userId: s.body.user.id as string, headers: { ...device(), Authorization: `Bearer ${s.body.token}` } };
}

function sendWebhook(event: unknown, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  const sig = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return request(app).post('/api/v1/stripe/webhook').set('Content-Type', 'application/json').set('stripe-signature', sig).send(payload);
}

let eventCounter = 0;
const evt = (type: string, object: Record<string, unknown>) => ({ id: `evt_${++eventCounter}`, object: 'event', type, data: { object } });
const paidSession = (orderId: string, over: Record<string, unknown> = {}) => ({
  id: 'cs_test_1',
  object: 'checkout.session',
  payment_status: 'paid',
  status: 'complete',
  amount_total: 22487,
  currency: 'usd',
  payment_intent: 'pi_test_1',
  client_reference_id: orderId,
  metadata: { orderId },
  ...over,
});

async function openCheckout(headers: Record<string, string>, slug = 'elite') {
  createSession.mockResolvedValueOnce({ id: 'cs_test_1', url: 'https://checkout.stripe.test/c/pay/cs_test_1' });
  const res = await request(app).post('/api/v1/purchases/checkout').set(headers).send({ programSlug: slug });
  return res;
}

const owned = async (headers: Record<string, string>) =>
  (await request(app).get('/api/v1/installation/entitlements').set(headers)).body.programs as string[];

describe('tax', () => {
  it('adds 13% to the price in whole cents, rounded half-up', () => {
    expect(priceBreakdown(99, 13)).toMatchObject({ subtotalCents: 9900, taxCents: 1287, totalCents: 11187 });
    expect(priceBreakdown(199, 13)).toMatchObject({ subtotalCents: 19900, taxCents: 2587, totalCents: 22487 });
    expect(priceBreakdown(0.99, 13).taxCents).toBe(13); // 12.87 cents -> 13
    expect(priceBreakdown(10.05, 0)).toMatchObject({ taxCents: 0, totalCents: 1005 });
  });
});

describe('stripe checkout + payment saga', () => {
  beforeEach(async () => {
    createSession.mockReset();
    retrieveSession.mockReset();
    createRefund.mockReset();
    await Program.create({
      slug: 'elite', name: 'Elite', level: 'Intermediate', description: 'Test', displayPriceUsd: 199,
      published: true, displayOrder: 2, storeProductIds: { ios: 'a', android: 'a' },
    });
  });

  it('shows price, tax and total on the program, and tells the app payments run on Stripe', async () => {
    const p = await request(app).get('/api/v1/programs/elite').set(device());
    expect(p.body.program.pricing).toMatchObject({ subtotalCents: 19900, taxCents: 2587, totalCents: 22487, taxRatePercent: 13 });
    const c = await request(app).get('/api/v1/purchases/config').set(device());
    expect(c.body).toMatchObject({ payments: 'stripe', taxRatePercent: 13, taxLabel: 'HST' });
  });

  it('needs a login, builds the session on the server with price + 13% tax, and never trusts client amounts', async () => {
    const anon = await request(app).post('/api/v1/purchases/checkout').set(device()).send({ programSlug: 'elite' });
    expect(anon.status).toBe(401);

    const { headers, userId } = await login();
    const res = await openCheckout(headers);
    expect(res.status).toBe(201);
    expect(res.body.checkoutUrl).toBe('https://checkout.stripe.test/c/pay/cs_test_1');
    expect(res.body.order.pricing).toMatchObject({ subtotalCents: 19900, taxCents: 2587, totalCents: 22487 });

    const [params, options] = createSession.mock.calls[0];
    expect(params.mode).toBe('payment');
    expect(params.line_items.map((l: { price_data: { unit_amount: number } }) => l.price_data.unit_amount)).toEqual([19900, 2587]);
    expect(params.line_items[1].price_data.product_data.name).toBe('HST (13%)');
    expect(params.metadata).toMatchObject({ orderId: res.body.order.orderId, userId, programSlug: 'elite' });
    expect(params.success_url).toContain('https://api.example.test/api/v1/stripe/return?o=');
    expect(options.idempotencyKey).toBe(`order_${res.body.order.orderId}_session`);

    const body = await request(app).post('/api/v1/purchases/checkout').set(headers).send({ programSlug: 'elite', amount: 1, totalCents: 1 });
    expect(body.status).toBe(201); // extra fields are ignored; the price still comes from the server
  });

  it('reuses the open checkout instead of creating a second payment page', async () => {
    const { headers } = await login();
    const a = await openCheckout(headers);
    const b = await request(app).post('/api/v1/purchases/checkout').set(headers).send({ programSlug: 'elite' });
    expect(b.status).toBe(201);
    expect(b.body.order.orderId).toBe(a.body.order.orderId);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it('unlocks the program only after a verified webhook, once, even if Stripe resends the event', async () => {
    const { headers } = await login();
    const o = (await openCheckout(headers)).body.order;
    expect(await owned(headers)).toEqual([]); // paying on the page is not enough: only the webhook grants access

    const event = evt('checkout.session.completed', paidSession(o.orderId));
    expect((await sendWebhook(event)).status).toBe(200);
    expect(await owned(headers)).toEqual(['elite']);
    const status = await request(app).get(`/api/v1/purchases/orders/${o.orderId}`).set(headers);
    expect(status.body.order).toMatchObject({ status: 'fulfilled', fulfilled: true, closed: true });

    const replay = await sendWebhook(event);
    expect(replay.body.duplicate).toBe(true);
    // same payment under a NEW event id (e.g. async_payment_succeeded after completed) is also a no-op
    expect((await sendWebhook(evt('checkout.session.async_payment_succeeded', paidSession(o.orderId)))).status).toBe(200);
    expect(await Entitlement.countDocuments({ purchaseSource: 'stripe' })).toBe(1);
    expect(createRefund).not.toHaveBeenCalled();

    const again = await request(app).post('/api/v1/purchases/checkout').set(headers).send({ programSlug: 'elite' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_OWNED');
  });

  it('keeps the purchase private to the buying account', async () => {
    const buyer = await login('a@test.com');
    const o = (await openCheckout(buyer.headers)).body.order;
    await sendWebhook(evt('checkout.session.completed', paidSession(o.orderId)));
    const other = await login('b@test.com');
    expect(await owned(other.headers)).toEqual([]);
    const peek = await request(app).get(`/api/v1/purchases/orders/${o.orderId}`).set(other.headers);
    expect(peek.status).toBe(404); // other accounts cannot even see that the order exists
    expect((await request(app).get('/api/v1/purchases/orders/not-a-uuid').set(buyer.headers)).status).toBe(404);
  });

  it('rejects unsigned, wrongly signed and stale webhooks', async () => {
    const event = evt('checkout.session.completed', paidSession('x'));
    const none = await request(app).post('/api/v1/stripe/webhook').set('Content-Type', 'application/json').send(JSON.stringify(event));
    expect(none.status).toBe(400);
    expect((await sendWebhook(event, 'whsec_' + 'z'.repeat(32))).status).toBe(400);
    const payload = JSON.stringify(event);
    const old = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET, timestamp: Math.floor(Date.now() / 1000) - 3600 });
    const stale = await request(app).post('/api/v1/stripe/webhook').set('Content-Type', 'application/json').set('stripe-signature', old).send(payload);
    expect(stale.status).toBe(400);
    expect(await StripeEvent.countDocuments()).toBe(0);
  });

  it('compensates: refunds the payment when the amount does not match the order', async () => {
    const { headers } = await login();
    const o = (await openCheckout(headers)).body.order;
    createRefund.mockResolvedValue({ id: 're_1' });
    await sendWebhook(evt('checkout.session.completed', paidSession(o.orderId, { amount_total: 100 })));
    expect(await owned(headers)).toEqual([]);
    expect(createRefund).toHaveBeenCalledTimes(1);
    expect(createRefund.mock.calls[0][0]).toMatchObject({ payment_intent: 'pi_test_1' });
    expect(createRefund.mock.calls[0][1].idempotencyKey).toBe(`order_${o.orderId}_refund`);
    expect((await Order.findOne({ orderId: o.orderId }))!.status).toBe('refunded');
  });

  it('compensates: refunds when granting access fails after the money was taken', async () => {
    const { headers } = await login();
    const o = (await openCheckout(headers)).body.order;
    await Program.updateOne({ slug: 'elite' }, { $set: { published: false } }); // makes the grant step fail
    createRefund.mockResolvedValue({ id: 're_2' });
    const res = await sendWebhook(evt('checkout.session.completed', paidSession(o.orderId)));
    expect(res.status).toBe(200);
    const order = (await Order.findOne({ orderId: o.orderId }))!;
    expect(order.status).toBe('refunded');
    expect(order.failureReason).toBe('fulfillment_failed');
    expect(order.sagaLog.map((s) => `${s.step}:${s.outcome}`)).toEqual(
      expect.arrayContaining(['payment_confirmed:ok', 'entitlement:failed', 'refund:compensated'])
    );
    expect(await Entitlement.countDocuments()).toBe(0);
  });

  it('keeps the order refund_pending when the refund call fails, and reconcile finishes it later', async () => {
    const { headers } = await login();
    const o = (await openCheckout(headers)).body.order;
    await Program.updateOne({ slug: 'elite' }, { $set: { published: false } });
    createRefund.mockRejectedValueOnce(new Error('stripe is down'));
    const res = await sendWebhook(evt('checkout.session.completed', paidSession(o.orderId)));
    expect(res.status).toBe(500); // Stripe will retry the event
    expect((await Order.findOne({ orderId: o.orderId }))!.status).toBe('refund_pending');
    expect((await StripeEvent.findOne({ status: 'failed' }))).toBeTruthy();

    createRefund.mockResolvedValue({ id: 're_3' });
    await Order.updateOne({ orderId: o.orderId }, { $set: { updatedAt: new Date(Date.now() - 3_600_000) } }, { timestamps: false });
    const out = await reconcileOrders(env);
    expect(out.retriedRefunds).toBe(1);
    expect((await Order.findOne({ orderId: o.orderId }))!.status).toBe('refunded');
  });

  it('waits for delayed payment methods, then unlocks on async success', async () => {
    const { headers } = await login();
    const o = (await openCheckout(headers)).body.order;
    await sendWebhook(evt('checkout.session.completed', paidSession(o.orderId, { payment_status: 'unpaid' })));
    expect(await owned(headers)).toEqual([]);
    expect((await Order.findOne({ orderId: o.orderId }))!.status).toBe('checkout_open');
    await sendWebhook(evt('checkout.session.async_payment_succeeded', paidSession(o.orderId)));
    expect(await owned(headers)).toEqual(['elite']);
  });

  it('closes expired and failed checkouts without granting anything', async () => {
    const { headers } = await login();
    const a = (await openCheckout(headers)).body.order;
    await sendWebhook(evt('checkout.session.expired', { id: 'cs_test_1', metadata: { orderId: a.orderId } }));
    expect((await Order.findOne({ orderId: a.orderId }))!.status).toBe('expired');
    expect(await owned(headers)).toEqual([]);
    // an expired order does not block a new attempt
    createSession.mockResolvedValueOnce({ id: 'cs_test_2', url: 'https://checkout.stripe.test/c/pay/cs_test_2' });
    const again = await request(app).post('/api/v1/purchases/checkout').set(headers).send({ programSlug: 'elite' });
    expect(again.status).toBe(201);
    expect(again.body.order.orderId).not.toBe(a.orderId);
  });

  it('removes access when the payment is refunded or disputed in Stripe', async () => {
    const { headers } = await login();
    const o = (await openCheckout(headers)).body.order;
    await sendWebhook(evt('checkout.session.completed', paidSession(o.orderId)));
    expect(await owned(headers)).toEqual(['elite']);
    await sendWebhook(evt('charge.refunded', { id: 'ch_1', payment_intent: 'pi_test_1', refunded: false })); // partial: keeps access
    expect(await owned(headers)).toEqual(['elite']);
    await sendWebhook(evt('charge.refunded', { id: 'ch_1', payment_intent: 'pi_test_1', refunded: true }));
    expect(await owned(headers)).toEqual([]);
    expect((await Order.findOne({ orderId: o.orderId }))!.status).toBe('refunded');
  });

  it('recovers a lost webhook through reconcile', async () => {
    const { headers } = await login();
    const o = (await openCheckout(headers)).body.order;
    await Order.updateOne({ orderId: o.orderId }, { $set: { updatedAt: new Date(Date.now() - 3_600_000) } }, { timestamps: false });
    retrieveSession.mockResolvedValue(paidSession(o.orderId));
    const out = await reconcileOrders(env);
    expect(out.advanced).toBe(1);
    expect(await owned(headers)).toEqual(['elite']);
  });

  it('only the admin key can run reconcile', async () => {
    expect((await request(app).post('/api/v1/admin/orders/reconcile')).status).toBe(401);
    const ok = await request(app).post('/api/v1/admin/orders/reconcile').set('x-admin-api-key', 'test-admin-key');
    expect(ok.status).toBe(200);
  });

  it('serves a safe return page that opens the app', async () => {
    const res = await request(app).get('/api/v1/stripe/return?o=00000000-0000-0000-0000-000000000000&r=success');
    expect(res.status).toBe(200);
    expect(res.text).toContain('apexfitness://purchase/return?order=00000000-0000-0000-0000-000000000000&result=success');
    const evil = await request(app).get('/api/v1/stripe/return?o=%22%3E%3Cscript%3E&r=%22%3E');
    expect(evil.text).not.toContain('<script>');
    expect(evil.text).toContain('order=&result=cancel');
  });
});

describe('stripe key safety', () => {
  // Each test swaps process.env for a copy and always puts the original back.
  function withEnv(over: Record<string, string>, fn: () => void) {
    const saved = process.env;
    process.env = { ...saved, ...over };
    try { fn(); } finally { process.env = saved; }
  }
  const prodBase = {
    NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_live_' + 'c'.repeat(24), ENABLE_DEV_PURCHASE_SIMULATOR: 'false',
    CLIENT_PREVIEW_DEMO_PURCHASES: 'false', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, PUBLIC_API_URL: 'https://api.example.com',
    INSTALLATION_TOKEN_SECRET: 'x'.repeat(40) + 'Q9', PLAYBACK_URL_SECRET: 'y'.repeat(40) + 'Q9',
    ADMIN_API_KEY: 'z'.repeat(30) + 'Q9', AUTH_TOKEN_SECRET: 'k'.repeat(40) + 'Q9',
  };

  it('refuses a live key outside production', () => {
    withEnv({ STRIPE_SECRET_KEY: 'sk_live_' + 'c'.repeat(24) }, () => {
      expect(() => loadEnv()).toThrow(/only allowed when NODE_ENV=production/);
    });
  });

  it('production accepts a complete live setup', () => {
    withEnv(prodBase, () => expect(loadEnv().STRIPE_SECRET_KEY).toMatch(/^sk_live_/));
  });

  it('production needs the webhook secret, an https public url, no demo purchases and a dedicated auth secret', () => {
    withEnv({ ...prodBase, STRIPE_WEBHOOK_SECRET: '' }, () => expect(() => loadEnv()).toThrow(/STRIPE_WEBHOOK_SECRET is required/));
    withEnv({ ...prodBase, PUBLIC_API_URL: 'http://api.example.com' }, () => expect(() => loadEnv()).toThrow(/PUBLIC_API_URL must be an https/));
    withEnv({ ...prodBase, CLIENT_PREVIEW_DEMO_PURCHASES: 'true' }, () => expect(() => loadEnv()).toThrow(/CLIENT_PREVIEW_DEMO_PURCHASES must be off/));
    withEnv({ ...prodBase, AUTH_TOKEN_SECRET: '' }, () => expect(() => loadEnv()).toThrow(/AUTH_TOKEN_SECRET must be a dedicated strong/));
  });
});
