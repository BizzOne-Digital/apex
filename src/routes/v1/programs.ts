import { Router } from 'express';
import { Program } from '../../models/Program.js';
import { Exercise } from '../../models/Exercise.js';
import { getActiveEntitlements } from '../../services/entitlementService.js';
import { ApiError } from '../../utils/errors.js';

export function programsRouter(): Router {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const programs = await Program.find({ published: true }).sort({ displayOrder: 1 });
      let owned: string[] = [];
      if (req.installationId) {
        owned = await getActiveEntitlements(req.installationId);
      }
      res.json({
        programs: programs.map((p) => ({
          slug: p.slug,
          name: p.name,
          level: p.level,
          description: p.description,
          displayPriceUsd: p.displayPriceUsd,
          artworkUrl: p.artworkUrl,
          locked: !owned.includes(p.slug),
          owned: owned.includes(p.slug),
        })),
      });
    } catch (e) {
      next(e);
    }
  });

  router.get('/:slug', async (req, res, next) => {
    try {
      const program = await Program.findOne({ slug: req.params.slug, published: true });
      if (!program) throw new ApiError(404, 'NOT_FOUND', 'Program not found');

      let owned = false;
      if (req.installationId) {
        const entitlements = await getActiveEntitlements(req.installationId);
        owned = entitlements.includes(program.slug);
      }

      const previewExercises = await Exercise.find({
        programSlug: program.slug,
        isPreview: true,
        published: true,
      })
        .sort({ sequence: 1 })
        .select('slug name sequence category equipment');

      res.json({
        program: {
          slug: program.slug,
          name: program.name,
          level: program.level,
          description: program.description,
          displayPriceUsd: program.displayPriceUsd,
          storeProductIds: program.storeProductIds,
          artworkUrl: program.artworkUrl,
          featureFlags: program.featureFlags,
          owned,
          previewExercises,
        },
      });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
