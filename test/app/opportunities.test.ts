import request from 'supertest';
import { getTestApp } from '../helpers/app';
import { getTestPool, closeTestPool } from '../helpers/db';
import { seedWorkspace, cleanupWorkspace, TestWorkspace } from '../helpers/fixtures';
import { getInteractivePool } from '../../src/db/pool';

describe('opportunities API', () => {
  const app = getTestApp();
  const pool = getTestPool();
  let workspace: TestWorkspace;

  beforeEach(async () => {
    workspace = await seedWorkspace(pool, 'opportunities-api');
  });

  afterEach(async () => {
    await cleanupWorkspace(pool, workspace.workspaceId);
  });

  afterAll(async () => {
    await closeTestPool();
    await getInteractivePool().end();
  });

  describe('workspace scoping', () => {
    it('rejects every route with 400 when X-Workspace-Id is missing', async () => {
      const createRes = await request(app).post('/opportunities').send({});
      expect(createRes.status).toBe(400);
      expect(createRes.body.error.code).toBe('WORKSPACE_ID_REQUIRED');

      const listRes = await request(app).get(`/stages/${workspace.stageAId}/opportunities`);
      expect(listRes.status).toBe(400);
      expect(listRes.body.error.code).toBe('WORKSPACE_ID_REQUIRED');
    });
  });

  describe('POST /opportunities', () => {
    it('creates an opportunity and returns it', async () => {
      const res = await request(app)
        .post('/opportunities')
        .set('X-Workspace-Id', workspace.workspaceId)
        .send({ name: 'Acme deal', value: 5000, owner: 'alice', stageId: workspace.stageAId });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        workspaceId: workspace.workspaceId,
        name: 'Acme deal',
        value: 5000,
        status: 'open',
        owner: 'alice',
        stageId: workspace.stageAId,
        version: 1,
      });
      expect(res.body.id).toEqual(expect.any(String));
    });

    it('rejects a missing required field with 400 and field-level details', async () => {
      const res = await request(app)
        .post('/opportunities')
        .set('X-Workspace-Id', workspace.workspaceId)
        .send({ value: 5000, owner: 'alice', stageId: workspace.stageAId });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('DTO_VALIDATION_FAILED');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'name' })]),
      );
    });

    it('rejects a stage that belongs to a different workspace', async () => {
      const otherWorkspace = await seedWorkspace(pool, 'opportunities-api-other');
      try {
        const res = await request(app)
          .post('/opportunities')
          .set('X-Workspace-Id', workspace.workspaceId)
          .send({ name: 'x', value: 1, owner: 'o', stageId: otherWorkspace.stageAId });

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('STAGE_NOT_FOUND');
      } finally {
        await cleanupWorkspace(pool, otherWorkspace.workspaceId);
      }
    });
  });

  describe('POST /opportunities/:id/move', () => {
    async function createOpportunity() {
      const res = await request(app)
        .post('/opportunities')
        .set('X-Workspace-Id', workspace.workspaceId)
        .send({ name: 'Movable deal', value: 100, owner: 'bob', stageId: workspace.stageAId });
      return res.body;
    }

    it('moves an opportunity, bumps its version, and records a transition', async () => {
      const opp = await createOpportunity();

      const res = await request(app)
        .post(`/opportunities/${opp.id}/move`)
        .set('X-Workspace-Id', workspace.workspaceId)
        .send({ toStageId: workspace.stageBId, expectedVersion: 1, movedBy: 'alice' });

      expect(res.status).toBe(200);
      expect(res.body.stageId).toBe(workspace.stageBId);
      expect(res.body.version).toBe(2);

      const transitions = await pool.query(
        `SELECT from_stage_id, to_stage_id, moved_by FROM transitions WHERE opportunity_id = $1`,
        [opp.id],
      );
      expect(transitions.rows).toEqual([
        { from_stage_id: workspace.stageAId, to_stage_id: workspace.stageBId, moved_by: 'alice' },
      ]);
    });

    it('rejects a stale expectedVersion with 409, and does not move the record', async () => {
      const opp = await createOpportunity();

      await request(app)
        .post(`/opportunities/${opp.id}/move`)
        .set('X-Workspace-Id', workspace.workspaceId)
        .send({ toStageId: workspace.stageBId, expectedVersion: 1 });

      const staleRetry = await request(app)
        .post(`/opportunities/${opp.id}/move`)
        .set('X-Workspace-Id', workspace.workspaceId)
        .send({ toStageId: workspace.stageAId, expectedVersion: 1 });

      expect(staleRetry.status).toBe(409);
      expect(staleRetry.body.error.code).toBe('VERSION_CONFLICT');

      const current = await pool.query(`SELECT stage_id FROM opportunities WHERE id = $1`, [opp.id]);
      expect(current.rows[0].stage_id).toBe(workspace.stageBId);
    });

    it('returns 404 for an opportunity that does not exist', async () => {
      const res = await request(app)
        .post('/opportunities/00000000-0000-0000-0000-000000000000/move')
        .set('X-Workspace-Id', workspace.workspaceId)
        .send({ toStageId: workspace.stageBId, expectedVersion: 1 });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('OPPORTUNITY_NOT_FOUND');
    });
  });

  describe('GET /stages/:stageId/opportunities', () => {
    it('paginates with a cursor, returning distinct items on each page in creation order', async () => {
      for (let i = 0; i < 5; i += 1) {
        await request(app)
          .post('/opportunities')
          .set('X-Workspace-Id', workspace.workspaceId)
          .send({ name: `Deal ${i}`, value: 1, owner: 'o', stageId: workspace.stageAId });
      }

      const page1 = await request(app)
        .get(`/stages/${workspace.stageAId}/opportunities?limit=3`)
        .set('X-Workspace-Id', workspace.workspaceId);
      expect(page1.status).toBe(200);
      expect(page1.body.items).toHaveLength(3);
      expect(page1.body.nextCursor).toEqual(expect.any(String));

      const page2 = await request(app)
        .get(`/stages/${workspace.stageAId}/opportunities?limit=3&cursor=${page1.body.nextCursor}`)
        .set('X-Workspace-Id', workspace.workspaceId);
      expect(page2.status).toBe(200);
      expect(page2.body.items).toHaveLength(2);
      expect(page2.body.nextCursor).toBeNull();

      const page1Ids = page1.body.items.map((item: { id: string }) => item.id);
      const page2Ids = page2.body.items.map((item: { id: string }) => item.id);
      expect(page1Ids.filter((id: string) => page2Ids.includes(id))).toHaveLength(0);
    });

    it('rejects a malformed cursor with 400', async () => {
      const res = await request(app)
        .get(`/stages/${workspace.stageAId}/opportunities?cursor=not-valid-base64url-json`)
        .set('X-Workspace-Id', workspace.workspaceId);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CURSOR');
    });

    it('returns 404 for a stage that does not exist in the workspace', async () => {
      const res = await request(app)
        .get('/stages/00000000-0000-0000-0000-000000000000/opportunities')
        .set('X-Workspace-Id', workspace.workspaceId);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('STAGE_NOT_FOUND');
    });
  });
});
