import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().min(1),
  INSTALLATION_TOKEN_SECRET: z.string().min(16),
  PLAYBACK_URL_SECRET: z.string().min(16),
  PLAYBACK_URL_TTL_SECONDS: z.coerce.number().default(300),
  ADMIN_API_KEY: z.string().min(8),
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
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
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
    if (parsed.data.CLIENT_PREVIEW_DEMO_PURCHASES) {
      console.warn(
        '[security] CLIENT_PREVIEW_DEMO_PURCHASES is ON: anyone can unlock paid programs for free. Disable before public release.'
      );
    }
  }
  return parsed.data;
}
