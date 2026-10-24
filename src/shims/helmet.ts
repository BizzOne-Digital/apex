import { createRequire } from 'node:module';
import type { HelmetOptions } from 'helmet';
import type { RequestHandler } from 'express';

const require = createRequire(import.meta.url);

export type HelmetMiddleware = (options?: Readonly<HelmetOptions>) => RequestHandler;

/** require() avoids Vercel TS 5.9 treating helmet's default export as a non-callable namespace. */
export const helmet: HelmetMiddleware = require('helmet');
