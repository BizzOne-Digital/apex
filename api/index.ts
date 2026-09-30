import { loadEnv } from '../src/config/env.js';
import { createApp } from '../src/app.js';

/** Default export for Vercel (@vercel/node treats Express apps as HTTP handlers). */
const app = createApp(loadEnv());

export default app;
