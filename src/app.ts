import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import type { Env } from './config/env.js';
import { helmet } from './shims/helmet.js';
import { connectMongo } from './db.js';
import { createV1Router } from './routes/v1/index.js';
import { sendError } from './utils/errors.js';

function limiter(windowMs: number, max: number, onlyFailures = false) {
  return rateLimit({
    windowMs,
    max,
    // Failures only: many real users share one mobile-network IP, so successful requests must not use up the budget.
    skipSuccessfulRequests: onlyFailures,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' } },
  });
}

export function createApp(env: Env): express.Application {
  const app = express();

  app.disable('x-powered-by');
  // Behind Vercel / a load balancer: use the real client IP for rate limiting.
  app.set('trust proxy', 1);
  // Plain `key=value` query parsing only: blocks `?category[$ne]=x` style operator injection.
  app.set('query parser', 'simple');

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: { maxAge: 15552000, includeSubDomains: true },
    })
  );

  // Native apps do not use CORS. Only allow explicitly configured browser origins.
  const allowedOrigins = env.CORS_ORIGINS;
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        if (env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
          return cb(null, true);
        }
        return cb(null, false);
      },
      allowedHeaders: ['Content-Type', 'Authorization', 'x-installation-id', 'x-installation-token', 'x-admin-api-key'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    })
  );
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use(async (_req, _res, next) => {
    try {
      await connectMongo(env.MONGODB_URI);
      next();
    } catch (err) {
      next(err);
    }
  });

  // General API limit, plus tighter limits on abuse-prone routes.
  app.use('/api/v1', limiter(15 * 60 * 1000, env.RATE_LIMIT_MAX));
  app.use('/api/v1/installation/register', limiter(60 * 60 * 1000, 30));
  app.use('/api/v1/purchases', limiter(15 * 60 * 1000, 60));
  app.use('/api/v1/admin', limiter(15 * 60 * 1000, 60));
  // Login / account calls: only failed attempts count (the per-email lockout handles targeted guessing).
  app.use('/api/v1/auth', limiter(15 * 60 * 1000, 60, true));
  app.use('/api/v1/auth/signup', limiter(60 * 60 * 1000, 30));
  app.use('/api/v1', createV1Router(env));

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    sendError(res, err);
  });

  return app;
}
