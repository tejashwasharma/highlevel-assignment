import { Request, Response } from 'express';
import { OpportunitiesService } from './service';
import { ScopedRequest } from '../shared/workspace-scope';
import { HTTP_STATUS } from '../shared/constants/http-status';

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
}
