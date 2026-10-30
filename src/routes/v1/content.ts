import { Router } from 'express';
import { AppContent } from '../../models/AppContent.js';
import { ApiError } from '../../utils/errors.js';

export function contentRouter(): Router {
  const router = Router();

  router.get('/legal/:type', async (req, res, next) => {
    try {
      const type = req.params.type;
      if (!['terms', 'privacy', 'refund'].includes(type)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid legal document type');
      }
      const doc = await AppContent.findOne({ key: `legal.${type}` });
      res.json({
        type,
        title: doc?.value?.title ?? `[CLIENT CONTENT PENDING: ${type}]`,
        body: doc?.value?.body ?? 'Replace with client-approved legal copy via admin import.',
        approvalStatus: doc?.value?.approvalStatus ?? 'pending',
      });
    } catch (e) {
      next(e);
    }
  });

  router.get('/safety', async (_req, res, next) => {
    try {
      const doc = await AppContent.findOne({ key: 'safety.disclaimer' });
      res.json({
        title: doc?.value?.title ?? 'Safety disclaimer',
        body:
          doc?.value?.body ??
          'Consult a physician before beginning any exercise program. Stop if you feel pain or discomfort.',
        approvalStatus: doc?.value?.approvalStatus ?? 'pending',
      });
    } catch (e) {
      next(e);
    }
  });

  router.get('/support', async (_req, res, next) => {
    try {
      const doc = await AppContent.findOne({ key: 'support.contact' });
      res.json({
        email: doc?.value?.email ?? 'art@elitebodyfitnesspros.com',
        hours: doc?.value?.hours ?? '',
        playbackHelp: doc?.value?.playbackHelp ?? 'For video issues, check your connection and try again.',
        purchaseHelp:
          doc?.value?.purchaseHelp ??
          'Log in with the account you bought the program with and it unlocks automatically.',
      });
    } catch (e) {
      next(e);
    }
  });

  router.get('/branding', async (_req, res, next) => {
    try {
      const doc = await AppContent.findOne({ key: 'branding' });
      res.json(
        doc?.value ?? {
          appName: 'ELITE BODY FITNESS PROS',
          tagline: 'Train with precision',
          approvalStatus: 'pending',
        }
      );
    } catch (e) {
      next(e);
    }
  });

  return router;
}
