import crypto from 'crypto';
import { promisify } from 'util';
import type { Env } from '../config/env.js';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

function authSecret(env: Env): string {
  // Dedicated secret when configured; otherwise derived from the installation secret (never reused as-is).
  return (
    env.AUTH_TOKEN_SECRET ||
    crypto.createHmac('sha256', env.INSTALLATION_TOKEN_SECRET).update('auth-token-v1').digest('hex')
  );
}

function sign(env: Env, payload: string): string {
  return crypto.createHmac('sha256', authSecret(env)).update(payload).digest('base64url');
}

export function issueUserToken(env: Env, userId: string): string {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${userId}.${exp}`;
  return `${payload}.${sign(env, payload)}`;
}

/** Returns the user id for a valid, unexpired token; otherwise null. */
export function verifyUserToken(env: Env, token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!userId || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const expected = Buffer.from(sign(env, `${userId}.${expStr}`));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  return userId;
}
