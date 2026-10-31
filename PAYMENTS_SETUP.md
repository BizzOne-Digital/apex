# Payments (Stripe), tax and account sharding: setup checklist

Never put a Stripe key in the app, in git, or in a chat. Keys live only in the server's environment
(Vercel > Project > Settings > Environment Variables).

## 1. Environment variables (production)

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `STRIPE_SECRET_KEY` | your live secret key (`sk_live_...`). The server refuses a live key anywhere except `NODE_ENV=production`. |
| `STRIPE_WEBHOOK_SECRET` | OPTIONAL. Not needed: after paying, the app asks the server and the server verifies the payment with Stripe directly. Add it only if you create the webhook in step 2. |
| `PUBLIC_API_URL` | `https://<your-api-domain>` (must be https) |
| `AUTH_TOKEN_SECRET` | 32+ random characters (now required in production) |
| `INSTALLATION_TOKEN_SECRET`, `PLAYBACK_URL_SECRET` | 32+ random characters |
| `ADMIN_API_KEY` | 24+ random characters |
| `CRON_SECRET` | 16+ random characters (turns on the daily reconcile job) |
| `TAX_RATE_PERCENT` / `TAX_LABEL` | `8.75` / `Sales Tax` (Sacramento, CA; these are the defaults) |
| `ENABLE_DEV_PURCHASE_SIMULATOR`, `CLIENT_PREVIEW_DEMO_PURCHASES` | `false` (the server refuses to start with demo purchases on while Stripe is on) |
| `MEDIA_CDN_BASE_URL` | where the videos are hosted (Vercel cannot hold 500 MB of video) |

Random value: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## 2. Stripe dashboard (OPTIONAL: skip it if the client does not want a webhook)

Without a webhook everything works for normal purchases. Only refunds/disputes made in the Stripe dashboard will not remove access automatically.

1. Developers > Webhooks > Add endpoint: `https://<your-api-domain>/api/v1/stripe/webhook`
2. Select exactly these events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`,
   `charge.refunded`, `charge.dispute.created`
3. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

## 3. Test before real money

Deploy first with TEST values (`sk_test_...` and the test-mode webhook secret), then:
1. Buy a program in the app with card `4242 4242 4242 4242` (any future date, any CVC).
2. The program must unlock by itself within a few seconds. In Stripe > Webhooks the event shows `200`.
3. Refund it from the Stripe dashboard: access must disappear.
4. Only then switch the environment variables to the live key and live webhook secret and redeploy.

Note: a preview APK that talks to a server with live keys charges real cards.

## 4. How a payment flows (saga)

`order created > Stripe Checkout session > customer pays > signed webhook > amount verified > access granted > order fulfilled`

- If anything fails after the money is taken (wrong amount, access cannot be granted) the server refunds automatically.
- Webhooks are signature-checked, de-duplicated by event id and safe to retry.
- A daily job (`GET /api/v1/cron/reconcile`, needs `CRON_SECRET`) finishes anything a lost webhook left behind.
  You can also run it by hand: `POST /api/v1/admin/orders/reconcile` with the `x-admin-api-key` header.
  (Vercel Hobby only allows a daily cron; on Pro you can change the schedule in `vercel.json`.)
- Refunds and card disputes made in the Stripe dashboard remove access automatically.

## 5. Sharding the accounts (only on a sharded cluster)

Needs a sharded MongoDB cluster (Atlas M30+ sharded or self-managed). It does not work on M0/M2/M5.
Do it once, in this order:

1. `npm run backfill:user-emails`  (creates the email directory for existing accounts; safe to repeat)
2. `npm run shard:users`           (dry run: prints the plan)
3. `npm run shard:users -- --confirm`
4. Set `USERS_SHARDED=true` and `USER_LEGACY_EMAIL_LOOKUP=false`, redeploy.

`users` is sharded on hashed `_id`; `useremails` (email to account) on `email` with a unique index, which is what
guarantees one account per email across all shards.

## 6. Store rules

Apple (3.1.1) and Google Play require their own in-app purchase for digital content sold inside an app.
Stripe is fine for a client-demo APK or sideloaded builds; check the store rules before publishing there.
