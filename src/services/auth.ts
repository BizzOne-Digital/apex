import crypto from 'crypto';
import { promisify } from 'util';
import type { Env } from '../config/env.js';

type ScryptOptions = { N: number; r: number; p: number; maxmem: number };
const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: ScryptOptions) => Promise<Buffer>;

// Current settings. Stored with every hash, so they can be raised later without breaking existing accounts.
const SCRYPT = { N: 32768, r: 8, p: 3 };
const maxmemFor = (o: { N: number; r: number }) => 128 * o.N * o.r * 2;
// Hashes made before the parameters were stored used Node's defaults.
const LEGACY_SCRYPT = { N: 16384, r: 8, p: 1 };

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64, { ...SCRYPT, maxmem: maxmemFor(SCRYPT) });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function parseHash(stored: string): { N: number; r: number; p: number; salt: Buffer; hash: Buffer } | null {
  const parts = stored.split('$');
  if (parts[0] !== 'scrypt') return null;
  if (parts.length === 3) return { ...LEGACY_SCRYPT, salt: Buffer.from(parts[1], 'hex'), hash: Buffer.from(parts[2], 'hex') };
  if (parts.length === 6) {
    const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    if (![N, r, p].every(Number.isInteger) || N < 2 ** 14 || N > 2 ** 20 || r < 1 || r > 16 || p < 1 || p > 8) return null;
    return { N, r, p, salt: Buffer.from(parts[4], 'hex'), hash: Buffer.from(parts[5], 'hex') };
  }
  return null;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const h = parseHash(stored);
  if (!h || h.salt.length === 0 || h.hash.length === 0) return false;
  const actual = await scrypt(password, h.salt, h.hash.length, { N: h.N, r: h.r, p: h.p, maxmem: maxmemFor(h) });
  return actual.length === h.hash.length && crypto.timingSafeEqual(actual, h.hash);
}

/** True for hashes made with weaker settings than today's; re-hash them after a successful login. */
export function needsRehash(stored: string): boolean {
  const h = parseHash(stored);
  return !h || h.N < SCRYPT.N || h.r < SCRYPT.r || h.p < SCRYPT.p;
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
