import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { beforeAll, afterAll, afterEach } from 'vitest';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.INSTALLATION_TOKEN_SECRET = 'test-installation-secret-32chars';
  process.env.PLAYBACK_URL_SECRET = 'test-playback-secret-32chars';
  process.env.ADMIN_API_KEY = 'test-admin-key';
  process.env.ENABLE_DEV_PURCHASE_SIMULATOR = 'true';
  await mongoose.connect(process.env.MONGODB_URI);
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
