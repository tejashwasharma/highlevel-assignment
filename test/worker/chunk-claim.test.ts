import { getTestPool, getTestDatabase, closeTestPool } from '../helpers/db';
import { seedWorkspace, seedOpportunities, cleanupWorkspace, TestWorkspace } from '../helpers/fixtures';
import { BulkMovesRepository } from '../../src/bulk-moves/repository';
import { computeFilterHash } from '../../src/utils/filter-hash';

describe('worker: claimNextChunk keyset pagination', () => {
  const pool = getTestPool();
  const repository = new BulkMovesRepository(getTestDatabase());
  let workspace: TestWorkspace;

  beforeEach(async () => {
    workspace = await seedWorkspace(pool, 'chunk-claim');
  });

  afterEach(async () => {
    await cleanupWorkspace(pool, workspace.workspaceId);
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('claims items in order, respects the limit, and never repeats an item already past the cursor', async () => {
    await seedOpportunities(pool, workspace.workspaceId, workspace.stageAId, 12);
    const filter = { status: 'open' as const };
    const job = await repository.createJobWithSnapshot(
      workspace.workspaceId,
      computeFilterHash(workspace.workspaceId, filter, workspace.stageBId),
      filter,
      workspace.stageBId,
    );
    expect(job.totalItems).toBe(12);

    const chunk1 = await repository.claimNextChunk(job.id, null, 5);
    expect(chunk1).toHaveLength(5);
    expect(chunk1.map((item) => item.id)).toEqual([...chunk1.map((item) => item.id)].sort((a, b) => a - b));

    const chunk1LastId = chunk1[chunk1.length - 1].id;
    const chunk2 = await repository.claimNextChunk(job.id, chunk1LastId, 5);
    expect(chunk2).toHaveLength(5);
    expect(chunk2.every((item) => item.id > chunk1LastId)).toBe(true);

    const chunk1Ids = new Set(chunk1.map((item) => item.id));
    expect(chunk2.some((item) => chunk1Ids.has(item.id))).toBe(false);

    const chunk3 = await repository.claimNextChunk(job.id, chunk2[chunk2.length - 1].id, 5);
    expect(chunk3).toHaveLength(2); // 12 total - 5 - 5 = 2 remaining

    const chunk4 = await repository.claimNextChunk(job.id, chunk3[chunk3.length - 1].id, 5);
    expect(chunk4).toHaveLength(0);
  });

  it('starts from the beginning when cursorId is null', async () => {
    await seedOpportunities(pool, workspace.workspaceId, workspace.stageAId, 3);
    const filter = { status: 'open' as const };
    const job = await repository.createJobWithSnapshot(
      workspace.workspaceId,
      computeFilterHash(workspace.workspaceId, filter, workspace.stageBId),
      filter,
      workspace.stageBId,
    );

    const chunk = await repository.claimNextChunk(job.id, null, 500);
    expect(chunk).toHaveLength(3);
    expect(chunk.every((item) => item.jobId === job.id)).toBe(true);
  });
});
