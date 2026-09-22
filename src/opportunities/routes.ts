import { Router } from 'express';
import { OpportunitiesController } from './controller';

export function opportunitiesRouter(controller: OpportunitiesController): Router {
  const router = Router();

  router.post('/opportunities', controller.createOpportunity);
  router.get('/stages/:stageId/opportunities', controller.listOpportunitiesInStage);

  return router;
}
