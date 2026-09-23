import { NextFunction, Request, Response } from 'express';
import { ScopedRequest } from '../shared/workspace-scope';
import { HTTP_STATUS } from '../shared/constants/http-status';
import { CreateBulkMoveDto } from './dto/create-bulk-move.dto';
import { checkDedupe } from './dedupe';
import { computeFilterHash } from '../utils/filter-hash';

export interface FilterHashedRequest extends ScopedRequest {
  filterHash: string;
}

export function bulkMoveDedupeCheck() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { workspaceId } = req as ScopedRequest;
    const dto = req.body as CreateBulkMoveDto;
    const filterHash = computeFilterHash(workspaceId, dto.filter, dto.targetStageId);

    const cached = await checkDedupe(workspaceId, filterHash);
    if (cached) {
      res.status(HTTP_STATUS.CREATED).json(cached);
      return;
    }

    (req as FilterHashedRequest).filterHash = filterHash;
    next();
  };
}
