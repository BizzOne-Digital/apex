import { Router } from 'express';
import type { Env } from '../../config/env.js';
import { installationAuth } from '../../middleware/installationAuth.js';
import { optionalInstallationAuth } from '../../middleware/optionalInstallationAuth.js';
import { adminAuth } from '../../middleware/adminAuth.js';
import { programsRouter } from './programs.js';
import { exercisesRouter } from './exercises.js';
import { purchasesRouter } from './purchases.js';
import { contentRouter } from './content.js';
import { installationRouter } from './installation.js';
import { mediaRouter } from './media.js';
import { adminRouter } from './admin.js';
import { authRouter } from './auth.js';
import { uploadsRouter } from './uploads.js';
import { optionalUser } from '../../middleware/userAuth.js';

export function createV1Router(env: Env): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      name: 'APEX Fitness API',
      version: 'v1',
      status: 'ok',
      endpoints: {
        health: '/health',
        programs: 'GET /api/v1/programs',
        content: 'GET /api/v1/content/safety',
        register: 'POST /api/v1/installation/register',
      },
    });
  });

  const requiredInstall = installationAuth(env);
  const optionalInstall = optionalInstallationAuth(env);

  // Accounts are optional: a valid Bearer token sets req.userId, otherwise the device acts anonymously.
  router.use(optionalUser(env));

  router.use('/installation', installationRouter(env));
  router.use('/auth', optionalInstall, authRouter(env));
  router.use('/uploads', uploadsRouter());

  router.use('/programs', optionalInstall, programsRouter(env));

  router.use('/content', contentRouter());

  router.use('/exercises', requiredInstall, exercisesRouter(env));
  router.use('/purchases', requiredInstall, purchasesRouter(env));
  // Signed playback URLs include installationId; native players often omit auth headers on GET.
  router.use('/media', optionalInstall, mediaRouter(env));

  router.use('/admin', adminAuth(env), adminRouter(env));

  return router;
}
