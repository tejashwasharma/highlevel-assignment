import { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1000000;

    logger.info('request', {
      method: req.method,
      path: req.route ? req.baseUrl + req.route.path : req.originalUrl.split('?')[0],
      workspaceId: req.header('X-Workspace-Id') ?? null,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 1000) / 1000,
    });
  });

  next();
}
