import { getTestPool, getTestDatabase, closeTestPool } from '../helpers/db';
import { seedWorkspace, seedOpportunities, cleanupWorkspace, TestWorkspace } from '../helpers/fixtures';
import { spawnWorker, killWorker, sleep } from '../helpers/worker-process';
import { BulkMovesRepository } from '../../src/bulk-moves/repository';
import { computeFilterHash } from '../../src/utils/filter-hash';
import { BulkMoveJob } from '../../src/bulk-moves/types';

async function waitForStatusChange(
  repository: BulkMovesRepository,
  workspaceId: string,
  jobId: string,
  timeoutMs: number,
): Promise<BulkMoveJob> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await repository.getJob(workspaceId, jobId);
    if (job.status !== 'materializing') {
      return job;
    }
    if (Date.now() > deadline) {
      throw new Error(`job ${jobId} never left materializing within ${timeoutMs}ms`);
    }
    await sleep(20);
  }
}

describe('bulk move snapshot materialization', () => {
  const pool = getTestPool();
  const repository = new BulkMovesRepository(getTestDatabase());
  let workspace: TestWorkspace;

  beforeEach(async () => {
    workspace = await seedWorkspace(pool, 'materialization');
  });

  afterEach(async () => {
    await cleanupWorkspace(pool, workspace.workspaceId);
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('createJobPending returns immediately with no snapshot taken yet', async () => {
    await seedOpportunities(pool, workspace.workspaceId, workspace.stageAId, 9);
    const filter = { status: 'open' as const };

    const job = await repository.createJobPending(
      workspace.workspaceId,
      computeFilterHash(workspace.workspaceId, filter, workspace.stageBId),
      filter,
      workspace.stageBId,
    );

    expect(job.status).toBe('materializing');
    expect(job.totalItems).toBe(0);

    const itemCount = await pool.query(`SELECT count(*) FROM bulk_move_job_items WHERE job_id = $1`, [job.id]);
    expect(Number(itemCount.rows[0].count)).toBe(0);
  });

  it('materializeSnapshot snapshots the matching set and moves the job to pending', async () => {
    await seedOpportunities(pool, workspace.workspaceId, workspace.stageAId, 9);
    const filter = { status: 'open' as const };

    const pending = await repository.createJobPending(
      workspace.workspaceId,
      computeFilterHash(workspace.workspaceId, filter, workspace.stageBId),
      filter,
      workspace.stageBId,
    );
    const materialized = await repository.materializeSnapshot(pending);

    expect(materialized.status).toBe('pending');
    expect(materialized.totalItems).toBe(9);

    const itemCount = await pool.query(`SELECT count(*) FROM bulk_move_job_items WHERE job_id = $1`, [pending.id]);
    expect(Number(itemCount.rows[0].count)).toBe(9);
  });

  it('materializeSnapshot moves a zero-match job straight to completed', async () => {
    const filter = { owner: 'nobody-matches' };

    const pending = await repository.createJobPending(
      workspace.workspaceId,
      computeFilterHash(workspace.workspaceId, filter, workspace.stageBId),
      filter,
      workspace.stageBId,
    );
    const materialized = await repository.materializeSnapshot(pending);

    expect(materialized.status).toBe('completed');
    expect(materialized.totalItems).toBe(0);
  });

  it('dedupes a second submission against a job that is still materializing', async () => {
    await seedOpportunities(pool, workspace.workspaceId, workspace.stageAId, 5);
    const filter = { status: 'open' as const };
    const filterHash = computeFilterHash(workspace.workspaceId, filter, workspace.stageBId);

    const first = await repository.createJobPending(workspace.workspaceId, filterHash, filter, workspace.stageBId);
    expect(first.status).toBe('materializing');

    const second = await repository.createJobPending(workspace.workspaceId, filterHash, filter, workspace.stageBId);
    expect(second.id).toBe(first.id);
    expect(second.status).toBe('materializing');

    const rowCount = await pool.query(`SELECT count(*) FROM bulk_move_jobs WHERE workspace_id = $1`, [
      workspace.workspaceId,
    ]);
    expect(Number(rowCount.rows[0].count)).toBe(1);
  });

  it('a real worker process picks up a materializing job and completes the snapshot', async () => {
    await seedOpportunities(pool, workspace.workspaceId, workspace.stageAId, 6);
    const filter = { status: 'open' as const };

    const job = await repository.createJobPending(
      workspace.workspaceId,
      computeFilterHash(workspace.workspaceId, filter, workspace.stageBId),
      filter,
      workspace.stageBId,
    );
    expect(job.status).toBe('materializing');

    const worker = spawnWorker();
    const materialized = await waitForStatusChange(repository, workspace.workspaceId, job.id, 5000);
    await killWorker(worker);

    // 6 items fit in a single 500-item chunk, so the worker can claim and apply that
    // chunk (status -> 'running') before this test's next poll even runs. Assert the
    // thing that's actually invariant here (left materializing with the right snapshot),
    // not the exact transient status, which can legitimately race past 'pending'.
    expect(['pending', 'running', 'completed']).toContain(materialized.status);
    expect(materialized.totalItems).toBe(6);

    const itemCount = await pool.query(`SELECT count(*) FROM bulk_move_job_items WHERE job_id = $1`, [job.id]);
    expect(Number(itemCount.rows[0].count)).toBe(6);
  });
});
