import { NextFunction, Request, Response } from 'express';
import { ValidationError } from './errors';
import { ERROR_CODES } from './constants/error-codes';

export interface ScopedRequest extends Request {
  workspaceId: string;
}

export function workspaceScope(req: Request, _res: Response, next: NextFunction): void {
  const workspaceId = req.header('X-Workspace-Id');

  if (!workspaceId) {
    throw new ValidationError(ERROR_CODES.WORKSPACE_ID_REQUIRED);
  }

  (req as ScopedRequest).workspaceId = workspaceId;
  next();
}
