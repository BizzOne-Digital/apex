import crypto from 'crypto';
import type { Env } from '../config/env.js';

export function buildMediaUrl(env: Env, mediaKey: string): string {
  if (env.MEDIA_CDN_BASE_URL) {
    return `${env.MEDIA_CDN_BASE_URL.replace(/\/$/, '')}/${mediaKey}`;
  }
  return mediaKey;
}

export function signPlaybackUrl(
  env: Env,
  exerciseId: string,
  videoId: string,
  installationId: string
): { url: string; expiresAt: number } {
  const expiresAt = Math.floor(Date.now() / 1000) + env.PLAYBACK_URL_TTL_SECONDS;
  const payload = `${exerciseId}:${videoId}:${installationId}:${expiresAt}`;
  const sig = crypto
    .createHmac('sha256', env.PLAYBACK_URL_SECRET)
    .update(payload)
    .digest('hex');
  const base = `/api/v1/media/playback?exerciseId=${encodeURIComponent(exerciseId)}&videoId=${encodeURIComponent(videoId)}&exp=${expiresAt}&sig=${sig}`;
  return { url: base, expiresAt };
}

export function verifyPlaybackSignature(
  env: Env,
  exerciseId: string,
  videoId: string,
  installationId: string,
  exp: number,
  sig: string
): boolean {
  if (exp < Math.floor(Date.now() / 1000)) return false;
  const payload = `${exerciseId}:${videoId}:${installationId}:${exp}`;
  const expected = crypto
    .createHmac('sha256', env.PLAYBACK_URL_SECRET)
    .update(payload)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
