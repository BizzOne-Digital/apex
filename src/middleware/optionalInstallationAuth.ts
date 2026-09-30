import type { NextFunction, Request, Response } from 'express';
import type { Env } from '../config/env.js';
import { verifyInstallationHeader } from '../services/installationToken.js';

export function optionalInstallationAuth(env: Env) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const installationId = req.header('x-installation-id');
    const token = req.header('x-installation-token');
    if (!installationId || !token) {
      req.installationId = undefined;
      next();
      return;
    }
    try {
      req.installationId = verifyInstallationHeader(installationId, token, env);
      next();
    } catch {
      req.installationId = undefined;
      next();
    }
  };
}
