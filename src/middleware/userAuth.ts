import type { NextFunction, Request, Response } from 'express';
import type { Env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';
import { verifyUserToken } from '../services/auth.js';

function bearer(req: Request): string | undefined {
  const h = req.header('authorization');
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
}

/** Sets req.userId when a valid Bearer token is present; never rejects. */
export function optionalUser(env: Env) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.userId = verifyUserToken(env, bearer(req)) ?? undefined;
    next();
  };
}

export function requireUser(env: Env) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const id = verifyUserToken(env, bearer(req));
    if (!id) {
      next(new ApiError(401, 'UNAUTHORIZED', 'Please log in to continue'));
      return;
    }
    req.userId = id;
    next();
  };
}

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}
