import { Router } from 'express';
import { OpportunitiesController } from './controller';

export function opportunitiesRouter(controller: OpportunitiesController): Router {
  const router = Router();

  router.post('/opportunities', controller.createOpportunity);

  return router;
}
