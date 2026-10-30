import { Router } from 'express';
import { z } from 'zod';
import { Exercise } from '../../models/Exercise.js';
import { ExerciseVideo } from '../../models/ExerciseVideo.js';
import { Program } from '../../models/Program.js';
import { AppContent } from '../../models/AppContent.js';
import { ApiError } from '../../utils/errors.js';
import type { Env } from '../../config/env.js';
import { reconcileOrders } from '../../services/purchaseSaga.js';

const upsertExerciseSchema = z.object({
  programSlug: z.string(),
  slug: z.string(),
  name: z.string(),
  sequence: z.number(),
  category: z.string().optional(),
  equipment: z.array(z.string()).optional(),
  sets: z.number().optional(),
  reps: z.string().optional(),
  durationSeconds: z.number().optional(),
  restSeconds: z.number().optional(),
  instructions: z.array(z.string()).optional(),
  formTips: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
  alternatives: z.array(z.string()).optional(),
  isPreview: z.boolean().optional(),
  published: z.boolean().optional(),
  contentApprovalStatus: z.enum(['pending', 'approved']).optional(),
});

const upsertVideoSchema = z.object({
  exerciseSlug: z.string(),
  programSlug: z.string(),
  avatarPresentation: z.enum(['male', 'female']),
  mediaKey: z
    .string()
    .min(1)
    .max(300)
    .refine((k) => !k.includes('..') && !k.startsWith('/') && !k.includes('\\'), 'Invalid media key'),
  thumbnailKey: z.string().optional(),
  durationSeconds: z.number().optional(),
  approvalStatus: z.enum(['pending', 'approved']).optional(),
});

const upsertProgramSchema = z
  .object({
    slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
    published: z.boolean().optional(),
  })
  .passthrough();

const upsertContentSchema = z.object({
  key: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
  value: z.unknown(),
});

export function adminRouter(env: Env): Router {
  const router = Router();

  /** Safety net for lost webhooks / crashed sagas. Safe to call repeatedly (e.g. from a scheduled job). */
  router.post('/orders/reconcile', async (_req, res, next) => {
    try {
      res.json({ success: true, ...(await reconcileOrders(env)) });
    } catch (e) {
      next(e);
    }
  });

  router.post('/programs/upsert', async (req, res, next) => {
    try {
      const program = upsertProgramSchema.parse(req.body);
      // $set only: blocks Mongo operator keys ($where, $rename...) coming from the body.
      const safe = Object.fromEntries(Object.entries(program).filter(([k]) => !k.startsWith('$') && !k.includes('.')));
      await Program.findOneAndUpdate({ slug: program.slug }, { $set: safe }, {
        upsert: true,
        new: true,
      });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  router.post('/exercises/upsert', async (req, res, next) => {
    try {
      const data = upsertExerciseSchema.parse(req.body);
      const doc = await Exercise.findOneAndUpdate(
        { programSlug: data.programSlug, slug: data.slug },
        { $set: data },
        { upsert: true, new: true }
      );
      res.json({ id: doc._id.toString() });
    } catch (e) {
      next(e);
    }
  });

  router.post('/videos/upsert', async (req, res, next) => {
    try {
      const data = upsertVideoSchema.parse(req.body);
      const exercise = await Exercise.findOne({
        programSlug: data.programSlug,
        slug: data.exerciseSlug,
      });
      if (!exercise) throw new ApiError(404, 'NOT_FOUND', 'Exercise not found');

      const doc = await ExerciseVideo.findOneAndUpdate(
        { exerciseId: exercise._id, avatarPresentation: data.avatarPresentation },
        {
          $set: {
            mediaKey: data.mediaKey,
            thumbnailKey: data.thumbnailKey ?? '',
            durationSeconds: data.durationSeconds,
            approvalStatus: data.approvalStatus ?? 'pending',
          },
        },
        { upsert: true, new: true }
      );
      res.json({ id: doc._id.toString() });
    } catch (e) {
      next(e);
    }
  });

  router.post('/content/upsert', async (req, res, next) => {
    try {
      const { key, value } = upsertContentSchema.parse(req.body);
      await AppContent.findOneAndUpdate({ key }, { value }, { upsert: true });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
