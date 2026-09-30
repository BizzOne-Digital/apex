import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import './setup.js';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { Program } from '../src/models/Program.js';
import { Exercise } from '../src/models/Exercise.js';
import { issueInstallationToken } from '../src/services/installationToken.js';

let app: Express;
let testEnv: ReturnType<typeof loadEnv>;

beforeAll(() => {
  testEnv = loadEnv();
  app = createApp(testEnv);
});

async function registerInstallation(id: string) {
  const token = issueInstallationToken(id, testEnv);
  return { id, token };
}

describe('program entitlements', () => {
  beforeEach(async () => {
    await Program.create({
      slug: 'starter',
      name: 'Starter',
      level: 'Beginner',
      description: 'Test',
      displayPriceUsd: 99,
      published: true,
      displayOrder: 1,
      storeProductIds: { ios: 'com.apex.fitness.starter', android: 'com.apex.fitness.starter' },
    });
    await Program.create({
      slug: 'elite',
      name: 'Elite',
      level: 'Intermediate',
      description: 'Test',
      displayPriceUsd: 199,
      published: true,
      displayOrder: 2,
      storeProductIds: { ios: 'com.apex.fitness.elite', android: 'com.apex.fitness.elite' },
    });
    await Exercise.create({
      programSlug: 'starter',
      slug: 'ex1',
      name: 'Ex1',
      sequence: 1,
      published: true,
      isPreview: false,
      instructions: ['secret'],
    });
    await Exercise.create({
      programSlug: 'elite',
      slug: 'ex2',
      name: 'Ex2',
      sequence: 1,
      published: true,
      isPreview: false,
      instructions: ['elite secret'],
    });
  });

  it('blocks library without purchase', async () => {
    const { id, token } = await registerInstallation('11111111-1111-1111-1111-111111111111');
    const res = await request(app)
      .get('/api/v1/exercises/program/starter')
      .set('x-installation-id', id)
      .set('x-installation-token', token);
    expect(res.status).toBe(403);
  });

  it('grants only purchased program', async () => {
    const { id, token } = await registerInstallation('22222222-2222-2222-2222-222222222222');

    await request(app)
      .post('/api/v1/purchases/dev-simulate')
      .set('x-installation-id', id)
      .set('x-installation-token', token)
      .send({ programSlug: 'starter' })
      .expect(200);

    const starterLib = await request(app)
      .get('/api/v1/exercises/program/starter')
      .set('x-installation-id', id)
      .set('x-installation-token', token);
    expect(starterLib.status).toBe(200);
    expect(starterLib.body.exercises).toHaveLength(1);

    const eliteLib = await request(app)
      .get('/api/v1/exercises/program/elite')
      .set('x-installation-id', id)
      .set('x-installation-token', token);
    expect(eliteLib.status).toBe(403);
  });

  it('purchase verify is idempotent', async () => {
    const { id, token } = await registerInstallation('33333333-3333-3333-3333-333333333333');
    const tx = 'devsim_starter_test_1'; // dev verifier requires devsim_ prefix
    const body = {
      platform: 'ios',
      programSlug: 'starter',
      productId: 'com.apex.fitness.starter',
      transactionId: tx,
    };
    await request(app)
      .post('/api/v1/purchases/verify')
      .set('x-installation-id', id)
      .set('x-installation-token', token)
      .send(body)
      .expect(200);
    const v1 = await request(app)
      .post('/api/v1/purchases/verify')
      .set('x-installation-id', id)
      .set('x-installation-token', token)
      .send(body);
    expect(v1.status).toBe(200);

    const ent = await request(app)
      .get('/api/v1/installation/entitlements')
      .set('x-installation-id', id)
      .set('x-installation-token', token);
    expect(ent.body.programs).toEqual(['starter']);
  });
});
