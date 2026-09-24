import request from 'supertest';
import { getTestApp } from '../helpers/app';
import { getTestPool, getTestDatabase, closeTestPool } from '../helpers/db';
import { seedWorkspace, seedOpportunities, cleanupWorkspace, TestWorkspace } from '../helpers/fixtures';
import { getInteractivePool } from '../../src/db/pool';
import { readDedupeHash, isRedisAvailable } from '../helpers/redis';
import { getRedisClient } from '../../src/redis/client';
import { BulkMovesRepository } from '../../src/bulk-moves/repository';

describe('bulk-moves API', () => {
  const app = getTestApp();
  const pool = getTestPool();
  const repository = new BulkMovesRepository(getTestDatabase());
  let workspace: TestWorkspace;
  let redisAvailable = false;

  beforeAll(async () => {
    redisAvailable = await isRedisAvailable();
    if (!redisAvailable) {
      console.warn('Redis not reachable - dedupe still correct via Postgres, cache-specific assertions skipped.');
    }
  });

  beforeEach(async () => {
    workspace = await seedWorkspace(pool, 'bulk-moves-api');
  });

  afterEach(async () => {
    await cleanupWorkspace(pool, workspace.workspaceId);
  });

  afterAll(async () => {
    await closeTestPool();
    await getInteractivePool().end();
    if (redisAvailable) {
      const client = await getRedisClient();
      await client.quit();
    }
  });

  describe('POST /bulk-moves', () => {
    it('returns a minimal job handle immediately, without waiting for the snapshot', async () => {
      await seedOpportunities(pool, workspace.workspaceId, workspace.stageAId, 7, 'owner-a');

      const res = await request(app)
        .post('/bulk-moves')
        .set('X-Workspace-Id', workspace.workspaceId)
        .send({ filter: { owner: 'owner-a' }, targetStageId: workspace.stageBId });

      expect(res.status).toBe(201);
      expect(Object.keys(res.body).sort()).toEqual(['id', 'status']);
      expect(res.body.status).toBe('materializing');
      expect(res.body.id).toEqual(expect.any(String));

      const itemCount = await pool.query(`SELECT count(*) FROM bulk_move_job_items WHERE job_id = $1`, [
        res.body.id,
      ]);
      expect(Number(itemCount.rows[0].count)).toBe(0);
    });

    it('snapshots every currently-matching opportunity once materialized (verified in Postgres, since the response is minimal)', async () => {
      await seedOpportunities(pool, workspace.workspaceId, workspace.stageAId, 7, 'owner-a');
      await seedOpportunities(pool, workspace.workspaceId, workspace.stageAId, 3, 'owner-b');

      const res = await request(app)
        .post('/bulk-moves')
        .set('X-Workspace-Id', workspace.workspaceId)
        .send({ filter: { owner: 'owner-a' }, targetStageId: workspace.stageBId });

      // simulates the worker picking up the materializing job
      const job = await repository.getJob(workspace.workspaceId, res.body.id);
      await repository.materializeSnapshot(job);

      const jobRow = await pool.query(
        `SELECT total_items, done_count FROM bulk_move_jobs WHERE id = $1`,
        [res.body.id],
      );
      expect(jobRow.rows[0].total_items).toBe(7);
      expect(jobRow.rows[0].done_count).toBe(0);

      const itemCount = await pool.query(`SELECT count(*) FROM bulk_move_job_items WHERE job_id = $1`, [
        res.body.id,
      ]);
      expect(Number(itemCount.rows[0].count)).toBe(7);
    });

    it('marks a job with zero matches completed once materialized, rather than leaving it pending forever', async () => {
      const res = await request(app)
        .post('/bulk-moves')
        .set('X-Workspace-Id', workspace.workspaceId)
        .send({ filter: { owner: 'nobody-matches-this' }, targetStageId: workspace.stageBId });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('materializing');

      const job = await repository.getJob(workspace.workspaceId, res.body.id);
      const materialized = await repository.materializeSnapshot(job);
      expect(materialized.status).toBe('completed');
    });

    it('returns the same job handle for a duplicate submission while the original is still active', async () => {
      await seedOpportunities(pool, workspace.workspaceId, workspace.stageAId, 2);

      const filter = { status: 'open' };
      const first = await request(app)
        .post('/bulk-moves')
        .set('X-Workspace-Id', workspace.workspaceId)
        .send({ filter, targetStageId: workspace.stageBId });

      const second = await request(app)
        .post('/bulk-moves')
        .set('X-Workspace-Id', workspace.workspaceId)
        .send({ filter, targetStageId: workspace.stageBId });

      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body);

      const rowCount = await pool.query(
        `SELECT count(*) FROM bulk_move_jobs WHERE workspace_id = $1`,
        [workspace.workspaceId],
      );
      expect(Number(rowCount.rows[0].count)).toBe(1);
    });

    it('does not dedupe two different filters in the same workspace', async () => {
      await seedOpportunities(pool, workspace.workspaceId, workspace.stageAId, 2, 'owner-a');
      await seedOpportunities(pool, workspace.workspaceId, workspace.stageAId, 2, 'owner-b');

      const jobA = await request(app)
        .post('/bulk-moves')
        .set('X-Workspace-Id', workspace.workspaceId)
        .send({ filter: { owner: 'owner-a' }, targetStageId: workspace.stageBId });
      const jobB = await request(app)
        .post('/bulk-moves')
        .set('X-Workspace-Id', workspace.workspaceId)
        .send({ filter: { owner: 'owner-b' }, targetStageId: workspace.stageBId });

      expect(jobB.body.id).not.toBe(jobA.body.id);
    });

    it('rejects a target stage from a different workspace with 404', async () => {
      const otherWorkspace = await seedWorkspace(pool, 'bulk-moves-api-other');
      try {
        const res = await request(app)
          .post('/bulk-moves')
          .set('X-Workspace-Id', workspace.workspaceId)
          .send({ filter: {}, targetStageId: otherWorkspace.stageAId });

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('STAGE_NOT_FOUND');
      } finally {
        await cleanupWorkspace(pool, otherWorkspace.workspaceId);
      }
    });

    it('rejects a malformed filter field with 400', async () => {
      const res = await request(app)
        .post('/bulk-moves')
        .set('X-Workspace-Id', workspace.workspaceId)
        .send({ filter: { status: 'not-a-real-status' }, targetStageId: workspace.stageAId });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('DTO_VALIDATION_FAILED');
    });

    it('rejects a missing targetStageId with 400', async () => {
      const res = await request(app)
        .post('/bulk-moves')
        .set('X-Workspace-Id', workspace.workspaceId)
        .send({ filter: {} });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('DTO_VALIDATION_FAILED');
    });

    it('writes exactly { id, status } to the Redis dedupe cache on submission', async () => {
      if (!redisAvailable) {
        return;
      }
      await seedOpportunities(pool, workspace.workspaceId, workspace.stageAId, 1);

      const res = await request(app)
        .post('/bulk-moves')
        .set('X-Workspace-Id', workspace.workspaceId)
        .send({ filter: { status: 'open' }, targetStageId: workspace.stageBId });

      const filterHash = res.body.id
        ? (
            await pool.query(`SELECT filter_hash FROM bulk_move_jobs WHERE id = $1`, [res.body.id])
          ).rows[0].filter_hash
        : null;

      const hash = await readDedupeHash(workspace.workspaceId, filterHash);
      expect(hash).toEqual({ id: res.body.id, status: 'materializing' });
    });
  });

  describe('GET /bulk-moves/:id', () => {
    it('reports the full job state, not the minimal handle shape', async () => {
      await seedOpportunities(pool, workspace.workspaceId, workspace.stageAId, 4);
      const submit = await request(app)
        .post('/bulk-moves')
        .set('X-Workspace-Id', workspace.workspaceId)
        .send({ filter: { status: 'open' }, targetStageId: workspace.stageBId });

      const unmaterializedRes = await request(app)
        .get(`/bulk-moves/${submit.body.id}`)
        .set('X-Workspace-Id', workspace.workspaceId);
      expect(unmaterializedRes.body.status).toBe('materializing');
      expect(unmaterializedRes.body.totalItems).toBe(0);

      const job = await repository.getJob(workspace.workspaceId, submit.body.id);
      await repository.materializeSnapshot(job);

      const res = await request(app)
        .get(`/bulk-moves/${submit.body.id}`)
        .set('X-Workspace-Id', workspace.workspaceId);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: submit.body.id,
        workspaceId: workspace.workspaceId,
        status: 'pending',
        totalItems: 4,
        doneCount: 0,
        skippedCount: 0,
        skippedOpportunityIds: [],
      });
      expect(res.body.filter).toBeDefined();
      expect(res.body.createdAt).toBeDefined();
    });

    it('returns 404 for a job id that does not exist', async () => {
      const res = await request(app)
        .get('/bulk-moves/00000000-0000-0000-0000-000000000000')
        .set('X-Workspace-Id', workspace.workspaceId);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('BULK_MOVE_JOB_NOT_FOUND');
    });

    it('returns 404 (not the job) when polled from a different workspace, so no cross-tenant leak', async () => {
      await seedOpportunities(pool, workspace.workspaceId, workspace.stageAId, 1);
      const submit = await request(app)
        .post('/bulk-moves')
        .set('X-Workspace-Id', workspace.workspaceId)
        .send({ filter: { status: 'open' }, targetStageId: workspace.stageBId });

      const otherWorkspace = await seedWorkspace(pool, 'bulk-moves-api-cross-tenant');
      try {
        const res = await request(app)
          .get(`/bulk-moves/${submit.body.id}`)
          .set('X-Workspace-Id', otherWorkspace.workspaceId);

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('BULK_MOVE_JOB_NOT_FOUND');
      } finally {
        await cleanupWorkspace(pool, otherWorkspace.workspaceId);
      }
    });
  });
});
