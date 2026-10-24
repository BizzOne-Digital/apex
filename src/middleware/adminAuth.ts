import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function adminAuth(env: Env) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const key = req.header('x-admin-api-key');
    if (!key || !safeEqual(key, env.ADMIN_API_KEY)) {
      next(new ApiError(401, 'UNAUTHORIZED', 'Admin API key required'));
      return;
    }
    next();
  };
}
