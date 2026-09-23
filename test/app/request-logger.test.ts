import request from 'supertest';
import { getTestApp } from '../helpers/app';
import { getTestPool, closeTestPool } from '../helpers/db';
import { seedWorkspace, cleanupWorkspace, TestWorkspace } from '../helpers/fixtures';
import { getInteractivePool } from '../../src/db/pool';

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('request logging middleware', () => {
  const app = getTestApp();
  const pool = getTestPool();
  let workspace: TestWorkspace;
  let logSpy: jest.SpyInstance;

  beforeEach(async () => {
    workspace = await seedWorkspace(pool, 'request-logger');
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await cleanupWorkspace(pool, workspace.workspaceId);
  });

  afterAll(async () => {
    await closeTestPool();
    await getInteractivePool().end();
  });

  function findRequestLogLines(): Array<Record<string, unknown>> {
    return logSpy.mock.calls
      .map((call) => call[0])
      .filter((line): line is string => typeof line === 'string')
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => entry !== null && entry.message === 'request');
  }

  it('logs one JSON "request" line per request, with method/path/status/duration/workspaceId', async () => {
    await request(app).get(`/stages/${workspace.stageAId}/opportunities`).set(
      'X-Workspace-Id',
      workspace.workspaceId,
    );
    await flush();

    const entries = findRequestLogLines();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 'info',
      message: 'request',
      method: 'GET',
      path: '/stages/:stageId/opportunities',
      workspaceId: workspace.workspaceId,
      statusCode: 200,
    });
    expect(entries[0].durationMs).toEqual(expect.any(Number));
    expect(entries[0].durationMs as number).toBeGreaterThanOrEqual(0);
  });

  it('logs the real status code for an error response, not just 2xx requests', async () => {
    await request(app).post('/opportunities').set('X-Workspace-Id', workspace.workspaceId).send({});
    await flush();

    const entries = findRequestLogLines();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ method: 'POST', path: '/opportunities', statusCode: 400 });
  });

  it('logs workspaceId as null when the header is absent, rather than omitting the field', async () => {
    await request(app).post('/opportunities').send({});
    await flush();

    const entries = findRequestLogLines();
    expect(entries[0].workspaceId).toBeNull();
  });
});
