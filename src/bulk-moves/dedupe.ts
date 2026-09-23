import { getRedisClient } from '../redis/client';
import { logger } from '../utils/logger';
import { BulkMoveJobStatus } from './types';

const DEDUPE_TTL_SECONDS = 300;

export interface DedupedJob {
  id: string;
  status: BulkMoveJobStatus;
}

function bulkJobKey(workspaceId: string, filterHash: string): string {
  return `bulkmove:${workspaceId}:${filterHash}`;
}

export async function checkDedupe(workspaceId: string, filterHash: string): Promise<DedupedJob | null> {
  try {
    const client = await getRedisClient();
    const hash = await client.hGetAll(bulkJobKey(workspaceId, filterHash));
    if (!hash.id) {
      return null;
    }
    return { id: hash.id, status: hash.status as BulkMoveJobStatus };
  } catch (err) {
    logger.warn('redis dedupe check failed, falling back to Postgres', {
      err: err instanceof Error ? err.message : err,
    });
    return null;
  }
}

export async function writeDedupeState(
  workspaceId: string,
  filterHash: string,
  job: DedupedJob,
): Promise<void> {
  try {
    const client = await getRedisClient();
    const key = bulkJobKey(workspaceId, filterHash);
    await client.hSet(key, { id: job.id, status: job.status });
    await client.expire(key, DEDUPE_TTL_SECONDS);
  } catch (err) {
    logger.warn('redis dedupe write failed', { err: err instanceof Error ? err.message : err });
  }
}
