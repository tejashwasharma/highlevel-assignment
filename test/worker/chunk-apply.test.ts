import { getTestPool, getTestDatabase, closeTestPool } from '../helpers/db';
import { seedWorkspace, seedOpportunities, cleanupWorkspace, TestWorkspace } from '../helpers/fixtures';
import { BulkMovesRepository } from '../../src/bulk-moves/repository';
import { OpportunitiesRepository } from '../../src/opportunities/repository';
import { computeFilterHash } from '../../src/utils/filter-hash';
import { BulkMoveJob } from '../../src/bulk-moves/types';

async function drainJob(repository: BulkMovesRepository, job: BulkMoveJob): Promise<BulkMoveJob> {
  let cursorId = job.cursorId;
  for (;;) {
    const items = await repository.claimNextChunk(job.id, cursorId, 500);
    if (items.length === 0) {
      return repository.markJobCompleted(job.id);
    }
    const current = { ...job, cursorId };
    const result = await repository.applyChunk(current, items);
    cursorId = result.lastItemId;
  }
}

describe('bulk move vs. a manual edit on the same record', () => {
  const pool = getTestPool();
  const bulkMoves = new BulkMovesRepository(getTestDatabase());
  const opportunities = new OpportunitiesRepository(getTestDatabase());
  let workspace: TestWorkspace;

  beforeEach(async () => {
    workspace = await seedWorkspace(pool, 'chunk-apply');
    await seedOpportunities(pool, workspace.workspaceId, workspace.stageAId, 20, 'owner-collision');
  });

  afterEach(async () => {
    await cleanupWorkspace(pool, workspace.workspaceId);
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('skips a record that was manually moved after the job snapshotted it, and does not overwrite the human edit', async () => {
    const filter = { status: 'open' as const, owner: 'owner-collision' };
    const job = await bulkMoves.createJobWithSnapshot(
      workspace.workspaceId,
      computeFilterHash(workspace.workspaceId, filter, workspace.stageBId),
      filter,
      workspace.stageBId,
    );
    expect(job.totalItems).toBe(20);

    const victimRow = await pool.query<{ opportunity_id: string }>(
      `SELECT opportunity_id FROM bulk_move_job_items WHERE job_id = $1 LIMIT 1`,
      [job.id],
    );
    const victimId = victimRow.rows[0].opportunity_id;

    // A human moves the victim to Stage A (a no-op stage-wise, but it bumps `version`)
    // after the job's snapshot was taken, before the "worker" (drainJob) ever runs.
    const humanEdit = await opportunities.moveOpportunity(
      workspace.workspaceId,
      victimId,
      workspace.stageAId,
      1,
      'human-alice',
    );
    expect(humanEdit.version).toBe(2);

    const completed = await drainJob(bulkMoves, job);

    expect(completed.status).toBe('completed');
    expect(completed.doneCount).toBe(19);
    expect(completed.skippedCount).toBe(1);
    expect(completed.skippedOpportunityIds).toEqual([victimId]);

    // The defining assertion: the bulk job did not overwrite the human's edit. The victim
    // is still wherever the human put it, not the job's target stage.
    const victimNow = await pool.query<{ stage_id: string; version: number }>(
      `SELECT stage_id, version FROM opportunities WHERE id = $1`,
      [victimId],
    );
    expect(victimNow.rows[0].stage_id).toBe(workspace.stageAId);
    expect(victimNow.rows[0].version).toBe(2);

    // And the skip is auditable: no transitions row was written for this job/opportunity.
    const transitions = await pool.query(
      `SELECT count(*) FROM transitions WHERE opportunity_id = $1 AND moved_by = $2`,
      [victimId, `bulk-move:${job.id}`],
    );
    expect(Number(transitions.rows[0].count)).toBe(0);
  });
});
