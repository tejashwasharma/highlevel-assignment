import { getTestPool, getTestDatabase, closeTestPool } from '../helpers/db';
import { seedWorkspace, seedOpportunities, cleanupWorkspace, TestWorkspace } from '../helpers/fixtures';
import { spawnWorker, killWorker, sleep } from '../helpers/worker-process';
import { BulkMovesRepository } from '../../src/bulk-moves/repository';
import { computeFilterHash } from '../../src/utils/filter-hash';
import { BulkMoveJob } from '../../src/bulk-moves/types';

const ITEM_COUNT = 1200;

async function waitForCompletion(
  repository: BulkMovesRepository,
  workspaceId: string,
  jobId: string,
  timeoutMs: number,
): Promise<BulkMoveJob> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await repository.getJob(workspaceId, jobId);
    if (job.status === 'completed' || job.status === 'failed') {
      return job;
    }
    if (Date.now() > deadline) {
      throw new Error(`job ${jobId} did not complete within ${timeoutMs}ms (status=${job.status})`);
    }
    await sleep(100);
  }
}

describe('bulk move worker: kill mid-job and resume', () => {
  const pool = getTestPool();
  const repository = new BulkMovesRepository(getTestDatabase());
  let workspace: TestWorkspace;

  beforeEach(async () => {
    workspace = await seedWorkspace(pool, 'resume-after-kill');
    await seedOpportunities(pool, workspace.workspaceId, workspace.stageAId, ITEM_COUNT, 'owner-resume');
  });

  afterEach(async () => {
    await cleanupWorkspace(pool, workspace.workspaceId);
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('finishes correctly after the worker process is SIGKILLed mid-job and restarted', async () => {
    const filter = { status: 'open' as const, owner: 'owner-resume' };
    const job = await repository.createJobWithSnapshot(
      workspace.workspaceId,
      computeFilterHash(workspace.workspaceId, filter, workspace.stageBId),
      filter,
      workspace.stageBId,
    );
    expect(job.totalItems).toBe(ITEM_COUNT);

    const firstRun = spawnWorker();
    await sleep(200);
    await killWorker(firstRun);

    const midState = await repository.getJob(workspace.workspaceId, job.id);
    expect(midState.status).toBe('running');
    expect(midState.doneCount).toBeGreaterThan(0);
    expect(midState.doneCount).toBeLessThan(ITEM_COUNT);
    const doneAtKill = midState.doneCount;
    const cursorAtKill = midState.cursorId;

    const secondRun = spawnWorker();
    const finished = await waitForCompletion(repository, workspace.workspaceId, job.id, 15000);
    await killWorker(secondRun);

    expect(finished.status).toBe('completed');
    expect(finished.doneCount).toBe(ITEM_COUNT);
    expect(finished.skippedCount).toBe(0);

    const itemStatusCounts = await pool.query<{ status: string; count: string }>(
      `SELECT status, count(*) FROM bulk_move_job_items WHERE job_id = $1 GROUP BY status`,
      [job.id],
    );
    expect(itemStatusCounts.rows).toEqual([{ status: 'done', count: String(ITEM_COUNT) }]);

    const duplicateTransitions = await pool.query(
      `SELECT opportunity_id, count(*) FROM transitions
       WHERE moved_by = $1
       GROUP BY opportunity_id
       HAVING count(*) > 1`,
      [`bulk-move:${job.id}`],
    );
    expect(duplicateTransitions.rowCount).toBe(0);

    const totalTransitions = await pool.query(
      `SELECT count(*) FROM transitions WHERE moved_by = $1`,
      [`bulk-move:${job.id}`],
    );
    expect(Number(totalTransitions.rows[0].count)).toBe(ITEM_COUNT);

    const preKillDone = await pool.query(
      `SELECT count(*) FROM bulk_move_job_items WHERE job_id = $1 AND id <= $2 AND status = 'done'`,
      [job.id, cursorAtKill],
    );
    expect(Number(preKillDone.rows[0].count)).toBe(doneAtKill);
  });
});
