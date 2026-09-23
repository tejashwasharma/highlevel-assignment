import { BulkMovesRepository } from './repository';
import { BulkMoveJob, SubmitBulkMoveInput } from './types';
import { writeDedupeState } from './dedupe';

export class BulkMovesService {
  constructor(private readonly repository: BulkMovesRepository) {}

  async submitBulkMove(input: SubmitBulkMoveInput): Promise<BulkMoveJob> {
    const job = await this.repository.createJobWithSnapshot(
      input.workspaceId,
      input.filterHash,
      input.filter,
      input.targetStageId,
    );

    await writeDedupeState(input.workspaceId, input.filterHash, { id: job.id, status: job.status });

    return job;
  }

  async getBulkMoveProgress(workspaceId: string, jobId: string): Promise<BulkMoveJob> {
    return this.repository.getJob(workspaceId, jobId);
  }
}
