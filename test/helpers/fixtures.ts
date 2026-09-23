import { Pool } from 'pg';

export interface TestWorkspace {
  workspaceId: string;
  stageAId: string;
  stageBId: string;
}

export async function seedWorkspace(pool: Pool, namePrefix: string): Promise<TestWorkspace> {
  const workspaceResult = await pool.query<{ id: string }>(
    `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
    [`${namePrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`],
  );
  const workspaceId = workspaceResult.rows[0].id;

  const stageAResult = await pool.query<{ id: string }>(
    `INSERT INTO stages (workspace_id, name, sort_order) VALUES ($1, 'Stage A', 1) RETURNING id`,
    [workspaceId],
  );
  const stageBResult = await pool.query<{ id: string }>(
    `INSERT INTO stages (workspace_id, name, sort_order) VALUES ($1, 'Stage B', 2) RETURNING id`,
    [workspaceId],
  );

  return {
    workspaceId,
    stageAId: stageAResult.rows[0].id,
    stageBId: stageBResult.rows[0].id,
  };
}

export async function seedOpportunities(
  pool: Pool,
  workspaceId: string,
  stageId: string,
  count: number,
  owner = 'owner-test',
): Promise<void> {
  await pool.query(
    `INSERT INTO opportunities (workspace_id, name, value, status, owner, stage_id)
     SELECT $1, 'Test Opp ' || g, 100, 'open', $3, $2
     FROM generate_series(1, $4) g`,
    [workspaceId, stageId, owner, count],
  );
}

export async function cleanupWorkspace(pool: Pool, workspaceId: string): Promise<void> {
  await pool.query(`DELETE FROM workspaces WHERE id = $1`, [workspaceId]);
}
