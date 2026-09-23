import { createHash } from 'crypto';
import { BulkMoveFilterInput } from '../bulk-moves/types';

export function computeFilterHash(
  workspaceId: string,
  filter: BulkMoveFilterInput,
  targetStageId: string,
): string {
  const payload = JSON.stringify([
    workspaceId,
    filter.stageId ?? null,
    filter.owner ?? null,
    filter.status ?? null,
    filter.valueMin ?? null,
    filter.valueMax ?? null,
    filter.createdAfter ?? null,
    filter.createdBefore ?? null,
    targetStageId,
  ]);
  return createHash('sha256').update(payload).digest('hex');
}
