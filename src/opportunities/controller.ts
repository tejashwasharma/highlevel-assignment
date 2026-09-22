import { Request, Response } from 'express';
import { OpportunitiesService } from './service';
import { ScopedRequest } from '../shared/workspace-scope';
import { HTTP_STATUS } from '../shared/constants/http-status';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';
import { MoveOpportunityDto } from './dto/move-opportunity.dto';
import { ListOpportunitiesQueryDto } from './dto/list-opportunities-query.dto';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export class OpportunitiesController {
  constructor(private readonly service: OpportunitiesService) {}

  createOpportunity = async (req: Request, res: Response): Promise<void> => {
    const { workspaceId } = req as ScopedRequest;
    const dto = req.body as CreateOpportunityDto;

    const opportunity = await this.service.createOpportunity({
      workspaceId,
      name: dto.name,
      value: dto.value,
      status: dto.status as CreateOpportunityDto['status'],
      owner: dto.owner,
      stageId: dto.stageId,
    });

    res.status(HTTP_STATUS.CREATED).json(opportunity);
  };

  moveOpportunity = async (req: Request, res: Response): Promise<void> => {
    const { workspaceId } = req as ScopedRequest;
    const dto = req.body as MoveOpportunityDto;

    const opportunity = await this.service.moveOpportunity(
      workspaceId,
      String(req.params.id),
      dto.toStageId,
      dto.expectedVersion,
      dto.movedBy ?? null,
    );

    res.status(HTTP_STATUS.OK).json(opportunity);
  };

  listOpportunitiesInStage = async (req: Request, res: Response): Promise<void> => {
    const { workspaceId } = req as ScopedRequest;
    const dto = req.query as unknown as ListOpportunitiesQueryDto;
    const cappedLimit = Math.min(dto.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);

    const page = await this.service.listOpportunitiesInStage(
      workspaceId,
      String(req.params.stageId),
      dto.cursor ?? null,
      cappedLimit,
    );

    res.status(HTTP_STATUS.OK).json(page);
  };
}
