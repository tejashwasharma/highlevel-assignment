import { Router } from 'express';
import { OpportunitiesController } from './controller';
import { validateDto } from '../shared/validate';
import { workspaceScope } from '../shared/workspace-scope';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';
import { MoveOpportunityDto } from './dto/move-opportunity.dto';
import { ListOpportunitiesQueryDto } from './dto/list-opportunities-query.dto';

export function opportunitiesRouter(controller: OpportunitiesController): Router {
  const router = Router();

  router.post(
    '/opportunities',
    workspaceScope,
    validateDto(CreateOpportunityDto),
    controller.createOpportunity,
  );
  router.post(
    '/opportunities/:id/move',
    workspaceScope,
    validateDto(MoveOpportunityDto),
    controller.moveOpportunity,
  );
  router.get(
    '/stages/:stageId/opportunities',
    workspaceScope,
    validateDto(ListOpportunitiesQueryDto, 'query'),
    controller.listOpportunitiesInStage,
  );

  return router;
}
