import { getWorkerPool } from './db/pool';
import { Database } from './db/database';
import { BulkMovesRepository } from './bulk-moves/repository';
import { runWorkerLoop } from './bulk-moves/worker-loop';
import { logger } from './utils/logger';

const db = new Database(getWorkerPool());
const repository = new BulkMovesRepository(db);

logger.info('bulk move worker starting');

runWorkerLoop(repository).catch((err) => {
  logger.error('worker loop crashed', { err });
  process.exit(1);
});
