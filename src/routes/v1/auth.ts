import crypto from 'crypto';
import express, { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import { User, type UserDocument } from '../../models/User.js';
import { StoredUpload } from '../../models/StoredUpload.js';
import { Entitlement } from '../../models/Entitlement.js';
import { hashPassword, issueUserToken, verifyPassword } from '../../services/auth.js';
import { requireUser } from '../../middleware/userAuth.js';
import { ApiError } from '../../utils/errors.js';

const AVATAR_MAX_BYTES = 8 * 1024 * 1024;
const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

const num = (min: number, max: number) => z.coerce.number().finite().min(min).max(max);

const profileSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is too short').max(80),
    age: num(18, 100).int(),
    gender: z.enum(['male', 'female', 'other']),
    weight: z.object({ value: num(1, 900), unit: z.enum(['kg', 'lbs']) }),
    height: z.object({ value: num(1, 300), unit: z.enum(['cm', 'in']) }),
  })
  .superRefine((p, ctx) => {
    const kg = p.weight.unit === 'kg' ? p.weight.value : p.weight.value * 0.45359237;
    if (kg < 20 || kg > 400) ctx.addIssue({ code: 'custom', path: ['weight', 'value'], message: 'Enter a realistic weight' });
    const cm = p.height.unit === 'cm' ? p.height.value : p.height.value * 2.54;
    if (cm < 100 || cm > 250) ctx.addIssue({ code: 'custom', path: ['height', 'value'], message: 'Enter a realistic height' });
  });

const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  profile: profileSchema,
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(128),
});

function publicUser(u: UserDocument) {
  const weightKg = u.weight?.value ? (u.weight.unit === 'lbs' ? u.weight.value * 0.45359237 : u.weight.value) : null;
  const heightCm = u.height?.value ? (u.height.unit === 'in' ? u.height.value * 2.54 : u.height.value) : null;
  return {
    id: u._id.toString(),
    email: u.email,
    name: u.name,
    age: u.age ?? null,
    gender: u.gender ?? null,
    weight: u.weight?.value ? { value: u.weight.value, unit: u.weight.unit } : null,
    height: u.height?.value ? { value: u.height.value, unit: u.height.unit } : null,
    weightKg: weightKg ? Math.round(weightKg * 10) / 10 : null,
    heightCm: heightCm ? Math.round(heightCm) : null,
    avatarUrl: u.avatarUrl || '',
  };
}

/**
 * Returns what the account owns. Purchases this device made before any login are claimed by the
 * account; from then on they are visible only while that account is logged in.
 */
async function linkEntitlements(userId: string, installationId: string | undefined): Promise<string[]> {
  if (installationId) {
    await Entitlement.updateMany(
      { installationId, userId: { $exists: false }, verificationStatus: 'verified', entitlementStatus: 'active' },
      { $set: { userId } }
    );
  }
  const rows = await Entitlement.find({ userId, verificationStatus: 'verified', entitlementStatus: 'active' }).select('programSlug');
  return [...new Set(rows.map((r) => r.programSlug))];
}

// Per-email brute-force guard (per server instance; the per-IP rate limit still applies on top).
const MAX_FAILED_LOGINS = 8;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const failedLogins = new Map<string, { count: number; resetAt: number }>();

function assertNotLocked(email: string): void {
  const f = failedLogins.get(email);
  if (f && f.resetAt > Date.now() && f.count >= MAX_FAILED_LOGINS) {
    throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts. Try again in a few minutes.');
  }
}

function recordFailedLogin(email: string): void {
  const now = Date.now();
  const f = failedLogins.get(email);
  if (!f || f.resetAt <= now) failedLogins.set(email, { count: 1, resetAt: now + LOCK_WINDOW_MS });
  else f.count++;
  if (failedLogins.size > 5000) failedLogins.clear();
}

// Real hash of a random password, used so unknown emails cost the same time as wrong passwords.
const DUMMY_HASH_PROMISE = hashPassword(crypto.randomBytes(8).toString('hex'));

function sniffImage(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.length > 6 && (buf.subarray(0, 6).toString() === 'GIF87a' || buf.subarray(0, 6).toString() === 'GIF89a')) return 'image/gif';
  return null;
}

async function deleteStoredAvatar(url: string | undefined): Promise<void> {
  const prefix = '/api/v1/uploads/avatars/';
  if (!url || !url.startsWith(prefix)) return;
  await StoredUpload.deleteOne({ folder: 'avatars', filename: url.slice(prefix.length) });
}

export function authRouter(env: Env): Router {
  const router = Router();
  const mustLogin = requireUser(env);

  router.post('/signup', async (req, res, next) => {
    try {
      const body = signupSchema.parse(req.body);
      if (await User.exists({ email: body.email })) {
        throw new ApiError(409, 'EMAIL_TAKEN', 'An account with this email already exists. Please log in.');
      }
      const user = await User.create({
        email: body.email,
        passwordHash: await hashPassword(body.password),
        name: body.profile.name,
        age: body.profile.age,
        gender: body.profile.gender,
        weight: body.profile.weight,
        height: body.profile.height,
      });
      const programs = await linkEntitlements(user._id.toString(), req.installationId);
      res.status(201).json({ token: issueUserToken(env, user._id.toString()), user: publicUser(user), programs });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) {
        next(new ApiError(409, 'EMAIL_TAKEN', 'An account with this email already exists. Please log in.'));
        return;
      }
      next(e);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const body = loginSchema.parse(req.body);
      assertNotLocked(body.email);
      const user = await User.findOne({ email: body.email });
      const ok = await verifyPassword(body.password, user ? user.passwordHash : await DUMMY_HASH_PROMISE);
      if (!user || !ok) {
        recordFailedLogin(body.email);
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      }
      failedLogins.delete(body.email);
      const programs = await linkEntitlements(user._id.toString(), req.installationId);
      res.json({ token: issueUserToken(env, user._id.toString()), user: publicUser(user), programs });
    } catch (e) {
      next(e);
    }
  });

  router.get('/me', mustLogin, async (req, res, next) => {
    try {
      const user = await User.findById(req.userId);
      if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'Account not found');
      const programs = await linkEntitlements(user._id.toString(), req.installationId);
      res.json({ user: publicUser(user), programs });
    } catch (e) {
      next(e);
    }
  });

  router.put('/profile', mustLogin, async (req, res, next) => {
    try {
      const p = profileSchema.parse(req.body);
      const user = await User.findByIdAndUpdate(
        req.userId,
        { $set: { name: p.name, age: p.age, gender: p.gender, weight: p.weight, height: p.height } },
        { new: true }
      );
      if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'Account not found');
      res.json({ user: publicUser(user) });
    } catch (e) {
      next(e);
    }
  });

  // Binary body (image/*) so no multipart dependency is needed; stored in MongoDB, not on disk.
  router.post(
    '/avatar',
    mustLogin,
    express.raw({ type: Object.keys(MIME_EXT), limit: AVATAR_MAX_BYTES }),
    async (req, res, next) => {
      try {
        const buf = req.body as Buffer;
        if (!Buffer.isBuffer(buf) || buf.length === 0) {
          throw new ApiError(400, 'VALIDATION_ERROR', 'Send the image as the request body (jpeg, png, webp or gif)');
        }
        if (buf.length > AVATAR_MAX_BYTES) throw new ApiError(413, 'TOO_LARGE', 'Image must be 8MB or smaller');
        const mimeType = sniffImage(buf);
        if (!mimeType) throw new ApiError(400, 'VALIDATION_ERROR', 'Unsupported image type');
        const user = await User.findById(req.userId);
        if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'Account not found');

        const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${MIME_EXT[mimeType]}`;
        await StoredUpload.create({ folder: 'avatars', filename, mimeType, size: buf.length, data: buf, ownerId: user._id.toString() });
        const previous = user.avatarUrl;
        user.avatarUrl = `/api/v1/uploads/avatars/${filename}`;
        await user.save();
        await deleteStoredAvatar(previous);
        res.json({ success: true, url: user.avatarUrl, filename, size: buf.length, folder: 'avatars' });
      } catch (e) {
        next(e);
      }
    }
  );

  router.delete('/avatar', mustLogin, async (req, res, next) => {
    try {
      const user = await User.findById(req.userId);
      if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'Account not found');
      await deleteStoredAvatar(user.avatarUrl);
      user.avatarUrl = '';
      await user.save();
      res.json({ success: true });
    } catch (e) {
      next(e);
    }
  });

  // Required by App Store / Play Store rules for apps that create accounts.
  router.delete('/account', mustLogin, async (req, res, next) => {
    try {
      const user = await User.findById(req.userId);
      if (user) {
        await deleteStoredAvatar(user.avatarUrl);
        await StoredUpload.deleteMany({ ownerId: user._id.toString() });
        await User.deleteOne({ _id: user._id });
      }
      res.json({ success: true });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
