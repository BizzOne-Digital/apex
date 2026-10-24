import type { Response } from 'express';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export function sendError(res: Response, err: unknown): void {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.flatten().fieldErrors },
    });
    return;
  }
  const status = (err as { status?: number; statusCode?: number } | null)?.status;
  if (status === 400 || status === 413) {
    res.status(status).json({
      error: { code: 'BAD_REQUEST', message: status === 413 ? 'Request too large' : 'Malformed request' },
    });
    return;
  }
  if ((err as { name?: string } | null)?.name === 'CastError') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid identifier' } });
    return;
  }
  console.error(err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}
