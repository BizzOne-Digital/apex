import { Router } from 'express';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Env } from '../../config/env.js';
import { ExerciseVideo } from '../../models/ExerciseVideo.js';
import { Exercise } from '../../models/Exercise.js';
import { hasProgramAccess } from '../../services/entitlementService.js';
import { buildMediaUrl, verifyPlaybackSignature } from '../../services/playbackUrl.js';
import { ApiError } from '../../utils/errors.js';

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const localMediaRoot = join(serverRoot, 'media', 'videos');

export function mediaRouter(env: Env): Router {
  const router = Router();

  router.get('/playback', async (req, res, next) => {
    try {
      const installationId = req.installationId!;
      const exerciseId = req.query.exerciseId as string;
      const videoId = req.query.videoId as string;
      const exp = Number(req.query.exp);
      const sig = req.query.sig as string;

      if (!exerciseId || !videoId || !exp || !sig) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Missing playback parameters');
      }

      if (
        !verifyPlaybackSignature(env, exerciseId, videoId, installationId, exp, sig)
      ) {
        throw new ApiError(403, 'FORBIDDEN', 'Invalid or expired playback URL');
      }

      const exercise = await Exercise.findById(exerciseId);
      if (!exercise) throw new ApiError(404, 'NOT_FOUND', 'Exercise not found');

      const owned = await hasProgramAccess(installationId, exercise.programSlug);
      if (!exercise.isPreview && !owned) {
        throw new ApiError(403, 'LOCKED', 'Entitlement required');
      }

      const video = await ExerciseVideo.findOne({
        _id: videoId,
        exerciseId: exercise._id,
        approvalStatus: 'approved',
      });
      if (!video) throw new ApiError(404, 'NOT_FOUND', 'Video not found');

      const localPath = join(localMediaRoot, video.mediaKey);
      if (existsSync(localPath)) {
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        return res.sendFile(localPath);
      }

      const streamUrl = buildMediaUrl(env, video.mediaKey);
      res.redirect(302, streamUrl);
    } catch (e) {
      next(e);
    }
  });

  return router;
}
