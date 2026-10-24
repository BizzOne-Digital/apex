import { Router } from 'express';
import { existsSync } from 'fs';
import { join, resolve, sep } from 'path';
import type { Env } from '../../config/env.js';
import { ExerciseVideo } from '../../models/ExerciseVideo.js';
import { Exercise } from '../../models/Exercise.js';
import { hasProgramAccess } from '../../services/entitlementService.js';
import { buildMediaUrl, verifyPlaybackSignature } from '../../services/playbackUrl.js';
import { ApiError } from '../../utils/errors.js';

/** `media/videos` lives at server repo root (works for `tsx src` and Vercel `cwd=server`). */
const localMediaRoot = join(process.cwd(), 'media', 'videos');

export function mediaRouter(env: Env): Router {
  const router = Router();

  router.get('/playback', async (req, res, next) => {
    try {
      const exerciseId = req.query.exerciseId as string;
      const installationId =
        (req.query.installationId as string) || req.installationId;
      if (!installationId) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Missing installation for playback');
      }
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

      const localPath = resolve(localMediaRoot, video.mediaKey);
      // Path-traversal guard: file must stay inside media/videos.
      const insideRoot = localPath.startsWith(resolve(localMediaRoot) + sep);
      if (insideRoot && existsSync(localPath)) {
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.sendFile(localPath);
      }

      const streamUrl = buildMediaUrl(env, video.mediaKey);
      if (!env.MEDIA_CDN_BASE_URL || streamUrl === video.mediaKey) {
        throw new ApiError(
          503,
          'MEDIA_NOT_HOSTED',
          'Video file is not on this server. Run the API locally with server/media/videos, or set MEDIA_CDN_BASE_URL on production.'
        );
      }
      res.redirect(302, streamUrl);
    } catch (e) {
      next(e);
    }
  });

  return router;
}
