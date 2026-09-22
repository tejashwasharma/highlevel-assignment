import { NextFunction, Request, Response } from 'express';
import { AppError } from './errors';
import { HTTP_STATUS } from './constants/http-status';
import { ERROR_CODES } from './constants/error-codes';
import { ERROR_MESSAGES } from './constants/messages';
import { logger } from '../utils/logger';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }

  logger.error('unhandled error', { err });
  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    error: {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: ERROR_MESSAGES[ERROR_CODES.INTERNAL_ERROR],
    },
  });
}
