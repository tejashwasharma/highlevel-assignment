import 'reflect-metadata';
import express, { Express } from 'express';
import { getInteractivePool } from './db/pool';
import { Database } from './db/database';
import { errorHandler } from './shared/error-handler';
import { opportunitiesRouter } from './opportunities/routes';
import { OpportunitiesController } from './opportunities/controller';
import { OpportunitiesService } from './opportunities/service';
import { OpportunitiesRepository } from './opportunities/repository';
import { bulkMovesRouter } from './bulk-moves/routes';
import { BulkMovesController } from './bulk-moves/controller';
import { BulkMovesService } from './bulk-moves/service';
import { BulkMovesRepository } from './bulk-moves/repository';

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

  const bulkMovesRepository = new BulkMovesRepository(db);
  const bulkMovesService = new BulkMovesService(bulkMovesRepository);
  const bulkMovesController = new BulkMovesController(bulkMovesService);

  app.use(opportunitiesRouter(opportunitiesController));
  app.use(bulkMovesRouter(bulkMovesController));

  app.use(errorHandler);

  return app;
}
