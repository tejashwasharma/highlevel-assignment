import { BulkMovesRepository } from './repository';
import { BulkMoveJob, SubmitBulkMoveInput } from './types';
import { computeFilterHash } from '../utils/filter-hash';

export class BulkMovesService {
  constructor(private readonly repository: BulkMovesRepository) {}

  async submitBulkMove(input: SubmitBulkMoveInput): Promise<BulkMoveJob> {
    const filterHash = computeFilterHash(input.workspaceId, input.filter, input.targetStageId);

    return this.repository.createJobWithSnapshot(
      input.workspaceId,
      filterHash,
      input.filter,
      input.targetStageId,
    );
  }
}
