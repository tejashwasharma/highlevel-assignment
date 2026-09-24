import { BulkMovesRepository } from './repository';
import { writeDedupeState } from './dedupe';
import { sleep } from '../utils/sleep';
import { logger } from '../utils/logger';

const CHUNK_SIZE = 500;
const CHUNK_PACING_DELAY_MS = 100;
const IDLE_POLL_INTERVAL_MS = 100;

export async function runWorkerLoop(
  repository: BulkMovesRepository,
  shouldContinue: () => boolean = () => true,
): Promise<void> {
  while (shouldContinue()) {
    const job = await repository.findNextActiveJob();

    if (!job) {
      await sleep(IDLE_POLL_INTERVAL_MS);
      continue;
    }

    if (job.status === 'materializing') {
      const materialized = await repository.materializeSnapshot(job);
      await writeDedupeState(materialized.workspaceId, materialized.filterHash, {
        id: materialized.id,
        status: materialized.status,
      });
      logger.info('materialized bulk move snapshot', {
        jobId: job.id,
        workspaceId: job.workspaceId,
        totalItems: materialized.totalItems,
      });
      continue;
    }

    const items = await repository.claimNextChunk(job.id, job.cursorId, CHUNK_SIZE);

    if (items.length === 0) {
      const completed = await repository.markJobCompleted(job.id);
      await writeDedupeState(completed.workspaceId, completed.filterHash, {
        id: completed.id,
        status: completed.status,
      });
      logger.info('bulk move job completed', { jobId: job.id, workspaceId: job.workspaceId });
      continue;
    }

    const result = await repository.applyChunk(job, items);
    logger.info('applied bulk move chunk', {
      jobId: job.id,
      doneCount: result.doneCount,
      skippedCount: result.skippedCount,
      lastItemId: result.lastItemId,
    });

    await writeDedupeState(job.workspaceId, job.filterHash, { id: job.id, status: 'running' });

    await sleep(CHUNK_PACING_DELAY_MS);
  }
}
