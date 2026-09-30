import { loadEnv } from './config/env.js';
import { createApp } from './app.js';
import { connectMongo } from './db.js';

const env = loadEnv();

async function main(): Promise<void> {
  await connectMongo(env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const app = createApp(env);

  app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`APEX Fitness API listening on http://0.0.0.0:${env.PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
