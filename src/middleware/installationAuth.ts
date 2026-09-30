import type { NextFunction, Request, Response } from 'express';
import type { Env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';
import { verifyInstallationHeader } from '../services/installationToken.js';

export function installationAuth(env: Env) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const installationId = req.header('x-installation-id');
      const token = req.header('x-installation-token');
      req.installationId = verifyInstallationHeader(installationId, token, env);
      next();
    } catch {
      next(new ApiError(401, 'UNAUTHORIZED', 'Invalid or missing installation credentials'));
    }
  };
}

declare global {
  namespace Express {
    interface Request {
      installationId?: string;
    }
  }
}
