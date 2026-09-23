import { getTestPool, getTestDatabase, closeTestPool } from '../helpers/db';
import { seedWorkspace, seedOpportunities, cleanupWorkspace, TestWorkspace } from '../helpers/fixtures';
import { BulkMovesRepository } from '../../src/bulk-moves/repository';
import { computeFilterHash } from '../../src/utils/filter-hash';
import { sleep } from '../helpers/worker-process';

describe('worker: findNextActiveJob fairness', () => {
  const pool = getTestPool();
  const repository = new BulkMovesRepository(getTestDatabase());
  let workspaceA: TestWorkspace;
  let workspaceB: TestWorkspace;

  beforeEach(async () => {
    workspaceA = await seedWorkspace(pool, 'job-picker-a');
    workspaceB = await seedWorkspace(pool, 'job-picker-b');
  });

  afterEach(async () => {
    await cleanupWorkspace(pool, workspaceA.workspaceId);
    await cleanupWorkspace(pool, workspaceB.workspaceId);
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('picks the active job least recently touched, across workspaces, round-robin style', async () => {
    const filter = { status: 'open' as const };
    await seedOpportunities(pool, workspaceA.workspaceId, workspaceA.stageAId, 3);
    await seedOpportunities(pool, workspaceB.workspaceId, workspaceB.stageAId, 3);

    const jobA = await repository.createJobWithSnapshot(
      workspaceA.workspaceId,
      computeFilterHash(workspaceA.workspaceId, filter, workspaceA.stageBId),
      filter,
      workspaceA.stageBId,
    );
    await sleep(20); // ensure a distinct, later updated_at for job B
    const jobB = await repository.createJobWithSnapshot(
      workspaceB.workspaceId,
      computeFilterHash(workspaceB.workspaceId, filter, workspaceB.stageBId),
      filter,
      workspaceB.stageBId,
    );

    const first = await repository.findNextActiveJob();
    expect(first?.id).toBe(jobA.id);

    await pool.query(`UPDATE bulk_move_jobs SET updated_at = now() WHERE id = $1`, [jobA.id]);

    const second = await repository.findNextActiveJob();
    expect(second?.id).toBe(jobB.id);
  });

  it('returns null when there is no pending or running job', async () => {
    const result = await repository.findNextActiveJob();
    expect(result).toBeNull();
  });

  it('skips completed jobs and only returns active ones', async () => {
    const filter = { status: 'open' as const };
    const job = await repository.createJobWithSnapshot(
      workspaceA.workspaceId,
      computeFilterHash(workspaceA.workspaceId, filter, workspaceA.stageBId),
      filter,
      workspaceA.stageBId,
    );
    expect(job.status).toBe('completed');

    const result = await repository.findNextActiveJob();
    expect(result).toBeNull();
  });
});
