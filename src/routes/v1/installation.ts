import { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import { installationAuth } from '../../middleware/installationAuth.js';
import { issueInstallationToken } from '../../services/installationToken.js';
import { getActiveEntitlements } from '../../services/entitlementService.js';

const registerSchema = z.object({
  installationId: z.string().uuid(),
});

export function installationRouter(env: Env): Router {
  const router = Router();

  router.post('/register', (req, res, next) => {
    try {
      const { installationId } = registerSchema.parse(req.body);
      const token = issueInstallationToken(installationId, env);
      res.json({ installationId, token });
    } catch (e) {
      next(e);
    }
  });

  router.get('/entitlements', installationAuth(env), async (req, res, next) => {
    try {
      const installationId = req.installationId!;
      const programs = await getActiveEntitlements(installationId);
      res.json({ programs });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
