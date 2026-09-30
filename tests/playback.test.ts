import { describe, it, expect } from 'vitest';
import { signPlaybackUrl, verifyPlaybackSignature } from '../src/services/playbackUrl.js';
import type { Env } from '../src/config/env.js';

const env: Env = {
  NODE_ENV: 'test',
  PORT: 4000,
  MONGODB_URI: 'mongodb://localhost',
  INSTALLATION_TOKEN_SECRET: 'test-installation-secret-32chars',
  PLAYBACK_URL_SECRET: 'test-playback-secret-32chars',
  PLAYBACK_URL_TTL_SECONDS: 300,
  ADMIN_API_KEY: 'test-admin-key',
  ENABLE_DEV_PURCHASE_SIMULATOR: true,
  WEB_PURCHASE_ENABLED: false,
};

describe('playback signatures', () => {
  it('signs and verifies playback URLs', () => {
    const signed = signPlaybackUrl(env, 'ex1', 'vid1', 'inst1');
    const url = new URL(signed.url, 'http://localhost');
    const exp = Number(url.searchParams.get('exp'));
    const sig = url.searchParams.get('sig')!;
    expect(
      verifyPlaybackSignature(env, 'ex1', 'vid1', 'inst1', exp, sig)
    ).toBe(true);
  });
});
