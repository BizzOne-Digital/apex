import type { NextFunction, Request, Response } from 'express';
import type { Env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';

export function adminAuth(env: Env) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const key = req.header('x-admin-api-key');
    if (!key || key !== env.ADMIN_API_KEY) {
      next(new ApiError(401, 'UNAUTHORIZED', 'Admin API key required'));
      return;
    }
    next();
  };
}
