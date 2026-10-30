import type { IncomingMessage, ServerResponse } from 'http';
import { loadEnv } from '../src/config/env.js';
import { processStripeWebhook } from '../src/routes/stripe.js';

/**
 * Stripe webhook as its own Vercel function (vercel.json rewrites /api/v1/stripe/webhook here).
 * It reads the raw request stream itself and never touches `req.body`, so Vercel's body helpers can
 * not alter the bytes Stripe signed.
 */
const env = loadEnv();
const MAX_BYTES = 1_000_000;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const send = (status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'POST') return send(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST only' } });

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BYTES) return send(413, { error: { code: 'BAD_REQUEST', message: 'Request too large' } });
    chunks.push(chunk as Buffer);
  }
  const sig = req.headers['stripe-signature'];
  const { status, body } = await processStripeWebhook(env, Buffer.concat(chunks), Array.isArray(sig) ? sig[0] : sig);
  send(status, body);
}
