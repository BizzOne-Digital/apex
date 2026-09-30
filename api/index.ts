import type { IncomingMessage, ServerResponse } from 'node:http';
import serverless from 'serverless-http';
import { loadEnv } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { connectMongo } from '../src/db.js';

const env = loadEnv();
const app = createApp(env);
const serverlessHandler = serverless(app);

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await connectMongo(env.MONGODB_URI);
  return serverlessHandler(req, res);
}
