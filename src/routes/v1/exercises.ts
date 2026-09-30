import { Router } from 'express';
import { Exercise } from '../../models/Exercise.js';
import { ExerciseVideo } from '../../models/ExerciseVideo.js';
import { hasProgramAccess } from '../../services/entitlementService.js';
import { ApiError } from '../../utils/errors.js';
import type { Env } from '../../config/env.js';
import { signPlaybackUrl } from '../../services/playbackUrl.js';

export function exercisesRouter(env: Env): Router {
  const router = Router();

  router.get('/program/:programSlug', async (req, res, next) => {
    try {
      const { programSlug } = req.params;
      const installationId = req.installationId!;
      const owned = await hasProgramAccess(installationId, programSlug);
      if (!owned) {
        throw new ApiError(403, 'LOCKED', 'Purchase this program to access the exercise library');
      }

      const category = req.query.category as string | undefined;
      const filter: Record<string, unknown> = {
        programSlug,
        published: true,
        isPreview: false,
      };
      if (category) filter.category = category;

      const exercises = await Exercise.find(filter).sort({ sequence: 1 }).select(
        'slug name sequence workoutDay workoutDayLabel category equipment sets reps durationSeconds restSeconds isPreview contentApprovalStatus'
      );

      res.json({
        exercises: exercises.map((e) => ({
          id: e._id.toString(),
          slug: e.slug,
          name: e.name,
          sequence: e.sequence,
          workoutDay: e.workoutDay,
          workoutDayLabel: e.workoutDayLabel,
          category: e.category,
          equipment: e.equipment,
          sets: e.sets,
          reps: e.reps,
          durationSeconds: e.durationSeconds,
          restSeconds: e.restSeconds,
          isPreview: e.isPreview,
          contentApprovalStatus: e.contentApprovalStatus,
        })),
      });
    } catch (e) {
      next(e);
    }
  });

  router.get('/:exerciseId', async (req, res, next) => {
    try {
      const installationId = req.installationId!;
      const exercise = await Exercise.findById(req.params.exerciseId);
      if (!exercise || !exercise.published) {
        throw new ApiError(404, 'NOT_FOUND', 'Exercise not found');
      }

      const owned = await hasProgramAccess(installationId, exercise.programSlug);
      if (!exercise.isPreview && !owned) {
        throw new ApiError(403, 'LOCKED', 'Purchase required for full exercise details');
      }

      const videos = await ExerciseVideo.find({
        exerciseId: exercise._id,
        approvalStatus: 'approved',
      }).select('avatarPresentation cameraAngle durationSeconds thumbnailKey version');

      res.json({
        exercise: {
          id: exercise._id.toString(),
          programSlug: exercise.programSlug,
          slug: exercise.slug,
          name: exercise.name,
          sequence: exercise.sequence,
          category: exercise.category,
          equipment: exercise.equipment,
          sets: exercise.sets,
          reps: exercise.reps,
          durationSeconds: exercise.durationSeconds,
          restSeconds: exercise.restSeconds,
          instructions: exercise.instructions,
          formTips: exercise.formTips,
          warnings: exercise.warnings,
          alternatives: exercise.alternatives,
          isPreview: exercise.isPreview,
          contentApprovalStatus: exercise.contentApprovalStatus,
          videos: videos.map((v) => ({
            id: v._id.toString(),
            avatarPresentation: v.avatarPresentation,
            cameraAngle: v.cameraAngle,
            durationSeconds: v.durationSeconds,
            thumbnailKey: v.thumbnailKey,
            version: v.version,
          })),
        },
      });
    } catch (e) {
      next(e);
    }
  });

  router.post('/:exerciseId/playback', async (req, res, next) => {
    try {
      const installationId = req.installationId!;
      const { videoId } = req.body as { videoId?: string };
      if (!videoId) throw new ApiError(400, 'VALIDATION_ERROR', 'videoId required');

      const exercise = await Exercise.findById(req.params.exerciseId);
      if (!exercise) throw new ApiError(404, 'NOT_FOUND', 'Exercise not found');

      const owned = await hasProgramAccess(installationId, exercise.programSlug);
      if (!exercise.isPreview && !owned) {
        throw new ApiError(403, 'LOCKED', 'Purchase required for video playback');
      }

      const video = await ExerciseVideo.findOne({
        _id: videoId,
        exerciseId: exercise._id,
        approvalStatus: 'approved',
      });
      if (!video) throw new ApiError(404, 'NOT_FOUND', 'Video not found');

      const signed = signPlaybackUrl(env, exercise._id.toString(), video._id.toString(), installationId);
      res.json({
        playbackPath: signed.url,
        expiresAt: signed.expiresAt,
        mediaKey: video.mediaKey,
      });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
