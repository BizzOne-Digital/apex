import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const optionalTrimmed = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  /** Requests per IP per 15 minutes for the general API limiter. */
  RATE_LIMIT_MAX: z.coerce.number().default(600),
  MONGODB_URI: z.string().min(1),
  INSTALLATION_TOKEN_SECRET: z.string().min(16),
  PLAYBACK_URL_SECRET: z.string().min(16),
  PLAYBACK_URL_TTL_SECONDS: z.coerce.number().default(300),
  ADMIN_API_KEY: z.string().min(8),
  /** Optional dedicated secret for user login tokens (defaults to a value derived from INSTALLATION_TOKEN_SECRET). */
  AUTH_TOKEN_SECRET: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined))
    .refine((v) => v === undefined || v.length >= 16, 'AUTH_TOKEN_SECRET must be at least 16 characters'),
  /** Comma-separated browser origins allowed by CORS (native apps do not need this). */
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((v) => (v ?? '').split(',').map((o) => o.trim()).filter(Boolean)),
  ENABLE_DEV_PURCHASE_SIMULATOR: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  /** Allows POST /purchases/dev-simulate in production for client preview APKs (not real IAP). */
  CLIENT_PREVIEW_DEMO_PURCHASES: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  APPLE_SHARED_SECRET: z.string().optional(),
  APPLE_BUNDLE_ID: z.string().optional(),
  GOOGLE_PLAY_PACKAGE_NAME: z.string().optional(),
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH: z.string().optional(),
  MEDIA_CDN_BASE_URL: z.string().optional(),
  WEB_PURCHASE_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  /** Stripe secret key. sk_live_ keys are only accepted when NODE_ENV=production. Never put it in the app or in git. */
  STRIPE_SECRET_KEY: optionalTrimmed,
  /** Signing secret of the Stripe webhook endpoint (whsec_...). Required in production when Stripe is on. */
  STRIPE_WEBHOOK_SECRET: optionalTrimmed,
  /** Public https base URL of this API, used for Stripe's return page (e.g. https://api.example.com). */
  PUBLIC_API_URL: optionalTrimmed,
  /** Purchase confirmation emails (customer + owner). Leave SMTP_HOST empty to turn emails off. */
  SMTP_HOST: optionalTrimmed,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
  SMTP_USER: optionalTrimmed,
  SMTP_PASS: optionalTrimmed,
  /** Sender shown to customers, e.g. Elite Body Fitness Pros <art@yourdomain.com>. Defaults to SMTP_USER. */
  MAIL_FROM: optionalTrimmed,
  /** Who gets the new-purchase email. Defaults to MAIL_FROM. */
  OWNER_NOTIFY_EMAIL: optionalTrimmed,
  /** Development/test only: send Stripe API calls to a local mock instead of api.stripe.com. Refused in production. */
  STRIPE_API_BASE: optionalTrimmed,
  /** Bearer secret for the scheduled reconcile job (GET /api/v1/cron/reconcile). The route is off when unset. */
  CRON_SECRET: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined))
    .refine((v) => v === undefined || v.length >= 16, 'CRON_SECRET must be at least 16 characters'),
  /** Sales tax added on top of the program price, in percent (8.75 = Sacramento, CA sales tax). */
  TAX_RATE_PERCENT: z.coerce.number().min(0).max(30).default(8.75),
  TAX_LABEL: z.string().trim().min(1).max(20).default('Sales Tax'),
  /**
   * Accounts are looked up through the sharded email directory. Keep true until scripts/backfill-user-emails.ts
   * has run; then set false so unknown emails never trigger a cluster-wide scan.
   */
  USER_LEGACY_EMAIL_LOOKUP: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }
  const stripeKey = parsed.data.STRIPE_SECRET_KEY;
  if (stripeKey) {
    if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/.test(stripeKey)) {
      throw new Error('STRIPE_SECRET_KEY is not a valid Stripe secret key');
    }
    // A live key on a dev machine or test run could charge real cards: only production may use one.
    if (/^(sk|rk)_live_/.test(stripeKey) && parsed.data.NODE_ENV !== 'production') {
      throw new Error('Live Stripe keys are only allowed when NODE_ENV=production (use an sk_test_ key here)');
    }
    if (parsed.data.STRIPE_WEBHOOK_SECRET && !/^whsec_/.test(parsed.data.STRIPE_WEBHOOK_SECRET)) {
      throw new Error('STRIPE_WEBHOOK_SECRET must start with whsec_');
    }
  }
  if (parsed.data.STRIPE_API_BASE && parsed.data.NODE_ENV === 'production') {
    throw new Error('STRIPE_API_BASE must not be set in production');
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.ENABLE_DEV_PURCHASE_SIMULATOR) {
    throw new Error('ENABLE_DEV_PURCHASE_SIMULATOR must be false in production');
  }
  if (parsed.data.NODE_ENV === 'production') {
    const weak = (v: string) => /change-?me|example|secret|password/i.test(v);
    if (parsed.data.INSTALLATION_TOKEN_SECRET.length < 32 || weak(parsed.data.INSTALLATION_TOKEN_SECRET)) {
      throw new Error('INSTALLATION_TOKEN_SECRET must be a strong random value (32+ chars) in production');
    }
    if (parsed.data.PLAYBACK_URL_SECRET.length < 32 || weak(parsed.data.PLAYBACK_URL_SECRET)) {
      throw new Error('PLAYBACK_URL_SECRET must be a strong random value (32+ chars) in production');
    }
    if (parsed.data.ADMIN_API_KEY.length < 24 || weak(parsed.data.ADMIN_API_KEY)) {
      throw new Error('ADMIN_API_KEY must be a strong random value (24+ chars) in production');
    }
    if (!parsed.data.AUTH_TOKEN_SECRET || parsed.data.AUTH_TOKEN_SECRET.length < 32 || weak(parsed.data.AUTH_TOKEN_SECRET)) {
      throw new Error('AUTH_TOKEN_SECRET must be a dedicated strong random value (32+ chars) in production');
    }
    if (stripeKey) {
      // STRIPE_WEBHOOK_SECRET is optional: without it, payments are confirmed by asking Stripe directly when the app returns.
      if (!parsed.data.PUBLIC_API_URL?.startsWith('https://')) throw new Error('PUBLIC_API_URL must be an https:// URL in production when Stripe is enabled');
      if (parsed.data.CLIENT_PREVIEW_DEMO_PURCHASES) {
        throw new Error('CLIENT_PREVIEW_DEMO_PURCHASES must be off when Stripe payments are enabled in production');
      }
    }
    if (parsed.data.CLIENT_PREVIEW_DEMO_PURCHASES) {
      console.warn(
        '[security] CLIENT_PREVIEW_DEMO_PURCHASES is ON: anyone can unlock paid programs for free. Disable before public release.'
      );
    }
  }
  return parsed.data;
}
