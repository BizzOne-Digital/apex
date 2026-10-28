import { Router } from 'express';
import { StoredUpload } from '../../models/StoredUpload.js';
import { ApiError } from '../../utils/errors.js';

export function uploadsRouter(): Router {
  const router = Router();

  router.get('/:folder/:filename', async (req, res, next) => {
    try {
      const { folder, filename } = req.params;
      if (!['avatars', 'misc'].includes(folder) || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        throw new ApiError(404, 'NOT_FOUND', 'File not found');
      }
      const doc = await StoredUpload.findOne({ folder, filename });
      if (!doc) throw new ApiError(404, 'NOT_FOUND', 'File not found');
      const data = Buffer.from(doc.data as unknown as Buffer);
      res.setHeader('Content-Type', doc.mimeType);
      res.setHeader('Content-Length', String(data.length));
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end(data);
    } catch (e) {
      next(e);
    }
  });

  return router;
}
