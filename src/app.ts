import express, { Express } from 'express';
import { getInteractivePool } from './db/pool';
import { Database } from './db/database';
import { workspaceScope } from './shared/workspace-scope';
import { errorHandler } from './shared/error-handler';
import { opportunitiesRouter } from './opportunities/routes';
import { OpportunitiesController } from './opportunities/controller';
import { OpportunitiesService } from './opportunities/service';
import { OpportunitiesRepository } from './opportunities/repository';

export function createApp(): Express {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const db = new Database(getInteractivePool());
  const opportunitiesRepository = new OpportunitiesRepository(db);
  const opportunitiesService = new OpportunitiesService(opportunitiesRepository);
  const opportunitiesController = new OpportunitiesController(opportunitiesService);

  app.use(workspaceScope, opportunitiesRouter(opportunitiesController));

  app.use(errorHandler);

  return app;
}
