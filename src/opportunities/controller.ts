import { Request, Response } from 'express';
import { OpportunitiesService } from './service';
import { ScopedRequest } from '../shared/workspace-scope';
import { HTTP_STATUS } from '../shared/constants/http-status';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export class OpportunitiesController {
  constructor(private readonly service: OpportunitiesService) {}

  createOpportunity = async (req: Request, res: Response): Promise<void> => {
    const { workspaceId } = req as ScopedRequest;
    const { name, value, status, owner, stageId } = req.body;

    const opportunity = await this.service.createOpportunity({
      workspaceId,
      name,
      value,
      status,
      owner,
      stageId,
    });

    res.status(HTTP_STATUS.CREATED).json(opportunity);
  };

  moveOpportunity = async (req: Request, res: Response): Promise<void> => {
    const { workspaceId } = req as ScopedRequest;
    const { toStageId, expectedVersion, movedBy } = req.body;

    const opportunity = await this.service.moveOpportunity(
      workspaceId,
      String(req.params.id),
      toStageId,
      Number(expectedVersion),
      movedBy ?? null,
    );

    res.status(HTTP_STATUS.OK).json(opportunity);
  };

  listOpportunitiesInStage = async (req: Request, res: Response): Promise<void> => {
    const { workspaceId } = req as ScopedRequest;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;
    const limit = req.query.limit ? Number(req.query.limit) : DEFAULT_LIST_LIMIT;
    const cappedLimit = Math.min(Math.max(limit, 1), MAX_LIST_LIMIT);

    const page = await this.service.listOpportunitiesInStage(
      workspaceId,
      String(req.params.stageId),
      cursor,
      cappedLimit,
    );

    res.status(HTTP_STATUS.OK).json(page);
  };
}
