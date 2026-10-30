import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import './setup.js';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { Program } from '../src/models/Program.js';
import { Exercise } from '../src/models/Exercise.js';
import { issueInstallationToken } from '../src/services/installationToken.js';
import { User } from '../src/models/User.js';
import { UserEmail } from '../src/models/UserEmail.js';
import { hashPassword, needsRehash, verifyPassword } from '../src/services/auth.js';
import crypto from 'crypto';
import { vi } from 'vitest';

let app: Express;
let env: ReturnType<typeof loadEnv>;

beforeAll(() => {
  env = loadEnv();
  app = createApp(env);
});

const DEVICE_A = '11111111-1111-1111-1111-111111111111';
const DEVICE_B = '22222222-2222-2222-2222-222222222222';

function device(id: string) {
  return { 'x-installation-id': id, 'x-installation-token': issueInstallationToken(id, env) };
}

const profile = {
  name: 'Test User',
  age: 30,
  gender: 'male',
  weight: { value: 80, unit: 'kg' },
  height: { value: 180, unit: 'cm' },
};

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

describe('accounts', () => {
  beforeEach(async () => {
    await Program.create({
      slug: 'starter', name: 'Starter', level: 'Beginner', description: 'Test', displayPriceUsd: 99,
      published: true, displayOrder: 1, storeProductIds: { ios: 'a', android: 'a' },
    });
    await Exercise.create({ programSlug: 'starter', slug: 'ex1', name: 'Ex1', sequence: 1, published: true, isPreview: false });
  });

  it('signs up, rejects duplicates, logs in and rejects bad passwords', async () => {
    const s = await request(app).post('/api/v1/auth/signup').send({ email: 'A@Test.com', password: 'Gym-Strong-77', profile });
    expect(s.status).toBe(201);
    expect(s.body.token).toBeTruthy();
    expect(s.body.user.email).toBe('a@test.com');
    expect(s.body.user.weightKg).toBe(80);
    expect(JSON.stringify(s.body)).not.toContain('passwordHash');

    const dup = await request(app).post('/api/v1/auth/signup').send({ email: 'a@test.com', password: 'Gym-Strong-77', profile });
    expect(dup.status).toBe(409);

    const bad = await request(app).post('/api/v1/auth/login').send({ email: 'a@test.com', password: 'wrong-password' });
    expect(bad.status).toBe(401);
    const unknown = await request(app).post('/api/v1/auth/login').send({ email: 'nobody@test.com', password: 'Gym-Strong-77' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(bad.body.error.message);

    const ok = await request(app).post('/api/v1/auth/login').send({ email: 'a@test.com', password: 'Gym-Strong-77' });
    expect(ok.status).toBe(200);
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${ok.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.name).toBe('Test User');
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer x.y.z')).status).toBe(401);
  });

  it('validates profile fields and unit conversion', async () => {
    const bad = await request(app).post('/api/v1/auth/signup').send({
      email: 'b@test.com', password: 'Gym-Strong-77', profile: { ...profile, age: 12, weight: { value: 5, unit: 'kg' } },
    });
    expect(bad.status).toBe(400);
    const lbs = await request(app).post('/api/v1/auth/signup').send({
      email: 'c@test.com', password: 'Gym-Strong-77',
      profile: { ...profile, weight: { value: 176, unit: 'lbs' }, height: { value: 70, unit: 'in' } },
    });
    expect(lbs.status).toBe(201);
    expect(lbs.body.user.weightKg).toBeCloseTo(79.8, 0);
    expect(lbs.body.user.heightCm).toBe(178);
    const upd = await request(app).put('/api/v1/auth/profile').set('Authorization', `Bearer ${lbs.body.token}`)
      .send({ ...profile, name: 'Renamed' });
    expect(upd.status).toBe(200);
    expect(upd.body.user.name).toBe('Renamed');
  });

  it('stores avatars in the database, serves them and removes the old one', async () => {
    const s = await request(app).post('/api/v1/auth/signup').send({ email: 'd@test.com', password: 'Gym-Strong-77', profile });
    const auth = { Authorization: `Bearer ${s.body.token}` };

    const noAuth = await request(app).post('/api/v1/auth/avatar').set('Content-Type', 'image/png').send(PNG);
    expect(noAuth.status).toBe(401);
    const fake = await request(app).post('/api/v1/auth/avatar').set(auth).set('Content-Type', 'image/png').send(Buffer.from('not an image at all'));
    expect(fake.status).toBe(400);

    const up = await request(app).post('/api/v1/auth/avatar').set(auth).set('Content-Type', 'image/png').send(PNG);
    expect(up.status).toBe(200);
    expect(up.body.url).toMatch(/^\/api\/v1\/uploads\/avatars\/\d+-[0-9a-f]{12}\.png$/);

    const get = await request(app).get(up.body.url).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(get.status).toBe(200);
    expect(get.headers['content-type']).toBe('image/png');
    expect(get.headers['cache-control']).toContain('immutable');
    expect((get.body as Buffer).equals(PNG)).toBe(true);

    expect((await request(app).get('/api/v1/uploads/avatars/..%2Fx.png')).status).toBe(404);

    const up2 = await request(app).post('/api/v1/auth/avatar').set(auth).set('Content-Type', 'image/png').send(PNG);
    expect(up2.body.url).not.toBe(up.body.url);
    expect((await request(app).get(up.body.url)).status).toBe(404);

    expect((await request(app).delete('/api/v1/auth/avatar').set(auth)).status).toBe(200);
    expect((await request(app).get(up2.body.url)).status).toBe(404);
  });

  it('keeps an account purchase private to the account: visible when logged in, locked after logout', async () => {
    const s = await request(app).post('/api/v1/auth/signup').set(device(DEVICE_A)).send({ email: 'e@test.com', password: 'Gym-Strong-77', profile });
    const authA = { ...device(DEVICE_A), Authorization: `Bearer ${s.body.token}` };
    expect((await request(app).post('/api/v1/purchases/dev-simulate').set(authA).send({ programSlug: 'starter' })).status).toBe(200);

    // logged in: owned, library opens, program says owned
    expect((await request(app).get('/api/v1/exercises/program/starter').set(authA)).status).toBe(200);
    const owned = await request(app).get('/api/v1/programs/starter').set(authA);
    expect(owned.body.program.owned).toBe(true);
    expect((await request(app).get('/api/v1/installation/entitlements').set(authA)).body.programs).toEqual(['starter']);

    // logged out (same device, no token): looks like a fresh install
    const out = device(DEVICE_A);
    expect((await request(app).get('/api/v1/exercises/program/starter').set(out)).status).toBe(403);
    expect((await request(app).get('/api/v1/programs/starter').set(out)).body.program.owned).toBe(false);
    expect((await request(app).get('/api/v1/installation/entitlements').set(out)).body.programs).toEqual([]);

    // another device is locked until it logs in, then it sees the purchase
    expect((await request(app).get('/api/v1/exercises/program/starter').set(device(DEVICE_B))).status).toBe(403);
    const login = await request(app).post('/api/v1/auth/login').set(device(DEVICE_B)).send({ email: 'e@test.com', password: 'Gym-Strong-77' });
    expect(login.body.programs).toEqual(['starter']);
    const authB = { ...device(DEVICE_B), Authorization: `Bearer ${login.body.token}` };
    expect((await request(app).get('/api/v1/exercises/program/starter').set(authB)).status).toBe(200);
    expect((await request(app).get('/api/v1/exercises/program/starter').set(device(DEVICE_B))).status).toBe(403);

    // a different account on the same device does not inherit it
    const other = await request(app).post('/api/v1/auth/signup').set(device(DEVICE_A)).send({ email: 'other@test.com', password: 'Gym-Strong-77', profile });
    const authOther = { ...device(DEVICE_A), Authorization: `Bearer ${other.body.token}` };
    expect((await request(app).get('/api/v1/exercises/program/starter').set(authOther)).status).toBe(403);

    const del = await request(app).delete('/api/v1/auth/account').set({ Authorization: `Bearer ${login.body.token}` });
    expect(del.status).toBe(200);
    expect((await request(app).post('/api/v1/auth/login').send({ email: 'e@test.com', password: 'Gym-Strong-77' })).status).toBe(401);
  });

  it('claims a purchase made before any login, then hides it after logout', async () => {
    const anon = device(DEVICE_A);
    await request(app).post('/api/v1/purchases/dev-simulate').set(anon).send({ programSlug: 'starter' });
    expect((await request(app).get('/api/v1/exercises/program/starter').set(anon)).status).toBe(200);
    const s = await request(app).post('/api/v1/auth/signup').set(anon).send({ email: 'h@test.com', password: 'Gym-Strong-77', profile });
    expect(s.body.programs).toEqual(['starter']);
    expect((await request(app).get('/api/v1/exercises/program/starter').set(anon)).status).toBe(403);
    expect((await request(app).get('/api/v1/exercises/program/starter').set({ ...anon, Authorization: `Bearer ${s.body.token}` })).status).toBe(200);
  });

  it('rejects tampered / expired tokens and wrong upload types', async () => {
    const s = await request(app).post('/api/v1/auth/signup').send({ email: 'f@test.com', password: 'Gym-Strong-77', profile });
    const [id, exp, sig] = s.body.token.split('.');
    const tampered = `${id.slice(0, -1)}${id.endsWith('a') ? 'b' : 'a'}.${exp}.${sig}`;
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${tampered}`)).status).toBe(401);
    const expired = `${id}.${Math.floor(Date.now() / 1000) - 10}.${sig}`;
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${expired}`)).status).toBe(401);
    const auth = { Authorization: `Bearer ${s.body.token}` };
    const wrongType = await request(app).post('/api/v1/auth/avatar').set(auth).set('Content-Type', 'text/plain').send('hello');
    expect(wrongType.status).toBe(400);
    const dup = await request(app).post('/api/v1/auth/signup').send({ email: 'F@TEST.com', password: 'Gym-Strong-77', profile });
    expect(dup.status).toBe(409);
  });

  it('locks an email after repeated wrong passwords', async () => {
    await request(app).post('/api/v1/auth/signup').send({ email: 'g@test.com', password: 'Gym-Strong-77', profile });
    let last = 0;
    for (let i = 0; i < 9; i++) {
      last = (await request(app).post('/api/v1/auth/login').send({ email: 'g@test.com', password: 'bad-password-' + i })).status;
    }
    expect(last).toBe(429);
    expect((await request(app).post('/api/v1/auth/login').send({ email: 'g@test.com', password: 'Gym-Strong-77' })).status).toBe(429);
  });

  it('rejects the most common passwords even when they are long enough', async () => {
    for (const pw of ['password123', '12345678', 'qwerty123', 'aaaaaaaa', 'h@test.com']) {
      const r = await request(app).post('/api/v1/auth/signup').send({ email: 'h@test.com', password: pw, profile });
      expect(r.status, pw).toBe(400);
    }
    const ok = await request(app).post('/api/v1/auth/signup').send({ email: 'h@test.com', password: 'Gym-Strong-77', profile });
    expect(ok.status).toBe(201);
  });

  describe('sharded email directory', () => {
    it('lets exactly one of two simultaneous signups with the same email win', async () => {
      const send = () => request(app).post('/api/v1/auth/signup').send({ email: 'race@test.com', password: 'Gym-Strong-77', profile });
      const results = await Promise.all([send(), send(), send()]);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);
      expect(await User.countDocuments({ email: 'race@test.com' })).toBe(1);
      expect(await UserEmail.countDocuments({ email: 'race@test.com' })).toBe(1);
    });

    it('releases the email again when creating the user fails (saga compensation)', async () => {
      const spy = vi.spyOn(User, 'create').mockRejectedValueOnce(new Error('database went away') as never);
      const failed = await request(app).post('/api/v1/auth/signup').send({ email: 'undo@test.com', password: 'Gym-Strong-77', profile });
      expect(failed.status).toBe(500);
      spy.mockRestore();
      expect(await UserEmail.countDocuments({ email: 'undo@test.com' })).toBe(0);
      const retry = await request(app).post('/api/v1/auth/signup').send({ email: 'undo@test.com', password: 'Gym-Strong-77', profile });
      expect(retry.status).toBe(201);
    });

    it('takes over a reservation left behind by a crash, but never one that belongs to a real account', async () => {
      await UserEmail.create({ email: 'orphan@test.com', userId: new (await import('mongoose')).default.Types.ObjectId().toString() });
      const claimed = await request(app).post('/api/v1/auth/signup').send({ email: 'orphan@test.com', password: 'Gym-Strong-77', profile });
      expect(claimed.status).toBe(201);
      const dup = await request(app).post('/api/v1/auth/signup').send({ email: 'orphan@test.com', password: 'Gym-Strong-77', profile });
      expect(dup.status).toBe(409);
    });

    it('logs in accounts created before the directory existed, and adds them to it', async () => {
      await User.create({ email: 'legacy@test.com', passwordHash: await hashPassword('Gym-Strong-77'), name: 'Legacy User' });
      expect(await UserEmail.countDocuments({ email: 'legacy@test.com' })).toBe(0);
      const ok = await request(app).post('/api/v1/auth/login').send({ email: 'legacy@test.com', password: 'Gym-Strong-77' });
      expect(ok.status).toBe(200);
      expect(await UserEmail.countDocuments({ email: 'legacy@test.com' })).toBe(1);
    });

    it('with the legacy fallback off, only directory accounts can log in (no cluster-wide scan)', async () => {
      const strictApp = createApp({ ...env, USER_LEGACY_EMAIL_LOOKUP: false });
      await User.create({ email: 'old@test.com', passwordHash: await hashPassword('Gym-Strong-77'), name: 'Old User' });
      const miss = await request(strictApp).post('/api/v1/auth/login').send({ email: 'old@test.com', password: 'Gym-Strong-77' });
      expect(miss.status).toBe(401);
      const s = await request(strictApp).post('/api/v1/auth/signup').send({ email: 'new@test.com', password: 'Gym-Strong-77', profile });
      expect(s.status).toBe(201);
      const hit = await request(strictApp).post('/api/v1/auth/login').send({ email: 'new@test.com', password: 'Gym-Strong-77' });
      expect(hit.status).toBe(200);
    });

    it('frees the email when the account is deleted', async () => {
      const s = await request(app).post('/api/v1/auth/signup').send({ email: 'bye@test.com', password: 'Gym-Strong-77', profile });
      const del = await request(app).delete('/api/v1/auth/account').set('Authorization', `Bearer ${s.body.token}`);
      expect(del.status).toBe(200);
      expect(await UserEmail.countDocuments({ email: 'bye@test.com' })).toBe(0);
      const again = await request(app).post('/api/v1/auth/signup').send({ email: 'bye@test.com', password: 'Gym-Strong-77', profile });
      expect(again.status).toBe(201);
    });
  });

  describe('password hashing', () => {
    it('uses the stronger stored-parameter format and still verifies older hashes', async () => {
      const fresh = await hashPassword('Gym-Strong-77');
      expect(fresh).toMatch(/^scrypt\$32768\$8\$3\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
      expect(await verifyPassword('Gym-Strong-77', fresh)).toBe(true);
      expect(await verifyPassword('Gym-Strong-78', fresh)).toBe(false);
      expect(needsRehash(fresh)).toBe(false);

      const salt = crypto.randomBytes(16);
      const legacy = `scrypt$${salt.toString('hex')}$${crypto.scryptSync('Gym-Strong-77', salt, 64).toString('hex')}`;
      expect(await verifyPassword('Gym-Strong-77', legacy)).toBe(true);
      expect(await verifyPassword('nope-nope-nope', legacy)).toBe(false);
      expect(needsRehash(legacy)).toBe(true);
      expect(await verifyPassword('x', 'scrypt$999999999$8$3$00$00')).toBe(false); // absurd parameters are refused
    });

    it('upgrades an old hash the next time its owner logs in', async () => {
      const salt = crypto.randomBytes(16);
      const legacy = `scrypt$${salt.toString('hex')}$${crypto.scryptSync('Gym-Strong-77', salt, 64).toString('hex')}`;
      const u = await User.create({ email: 'rehash@test.com', passwordHash: legacy, name: 'Rehash' });
      const res = await request(app).post('/api/v1/auth/login').send({ email: 'rehash@test.com', password: 'Gym-Strong-77' });
      expect(res.status).toBe(200);
      const stored = (await User.findById(u._id))!.passwordHash;
      expect(stored.startsWith('scrypt$32768$8$3$')).toBe(true);
      expect((await request(app).post('/api/v1/auth/login').send({ email: 'rehash@test.com', password: 'Gym-Strong-77' })).status).toBe(200);
    });
  });

});
