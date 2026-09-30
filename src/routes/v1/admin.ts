import { Router } from 'express';
import { z } from 'zod';
import { Exercise } from '../../models/Exercise.js';
import { ExerciseVideo } from '../../models/ExerciseVideo.js';
import { Program } from '../../models/Program.js';
import { AppContent } from '../../models/AppContent.js';
import { ApiError } from '../../utils/errors.js';

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
  mediaKey: z.string(),
  thumbnailKey: z.string().optional(),
  durationSeconds: z.number().optional(),
  approvalStatus: z.enum(['pending', 'approved']).optional(),
});

export function adminRouter(): Router {
  const router = Router();

  router.post('/programs/upsert', async (req, res, next) => {
    try {
      const program = req.body;
      await Program.findOneAndUpdate({ slug: program.slug }, program, {
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
      const { key, value } = req.body as { key: string; value: unknown };
      await AppContent.findOneAndUpdate({ key }, { value }, { upsert: true });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
