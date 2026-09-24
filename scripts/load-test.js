const { BIG_WORKSPACE_ID, BIG_STAGE_IDS, SMALL_WORKSPACES } = require('./seed-load-test');

function parseArgs(argv) {
  const args = {
    baseUrl: 'http://localhost:3000',
    mode: 'isolation',
    concurrency: 20,
    requests: 500,
    isolationConcurrency: 5,
    workspaceId: BIG_WORKSPACE_ID,
    stageAId: BIG_STAGE_IDS[0],
    stageBId: BIG_STAGE_IDS[1],
    otherWorkspaceId: SMALL_WORKSPACES[0].workspaceId,
    otherStageId: SMALL_WORKSPACES[0].stageIds[0],
    pollIntervalMs: 250,
    timeoutMs: 10 * 60 * 1000,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--base-url') args.baseUrl = argv[++i];
    else if (flag === '--mode') args.mode = argv[++i];
    else if (flag === '--concurrency') args.concurrency = Number(argv[++i]);
    else if (flag === '--requests') args.requests = Number(argv[++i]);
    else if (flag === '--isolation-concurrency') args.isolationConcurrency = Number(argv[++i]);
    else if (flag === '--workspace') args.workspaceId = argv[++i];
    else if (flag === '--stage-a') args.stageAId = argv[++i];
    else if (flag === '--stage-b') args.stageBId = argv[++i];
    else if (flag === '--other-workspace') args.otherWorkspaceId = argv[++i];
    else if (flag === '--other-stage') args.otherStageId = argv[++i];
  }
  return args;
}

async function interactiveRequest(baseUrl, workspaceId, stageId) {
  const doWrite = Math.random() < 0.3;
  if (doWrite) {
    return fetch(`${baseUrl}/opportunities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspaceId },
      body: JSON.stringify({
        name: `Interactive Opp ${Date.now()}-${Math.random().toString(36).slice(2)}`,
        value: Math.round(Math.random() * 10000),
        owner: 'load-test',
        stageId,
      }),
    });
  }
  return fetch(`${baseUrl}/stages/${stageId}/opportunities?limit=20`, {
    headers: { 'X-Workspace-Id': workspaceId },
  });
}

async function runMixedLoad(args) {
  console.log(`\nMixed load: ${args.requests} requests, concurrency ${args.concurrency}`);
  let issued = 0;
  let errors = 0;
  const startedAt = Date.now();

  async function worker() {
    while (issued < args.requests) {
      issued += 1;
      try {
        const res = await interactiveRequest(args.baseUrl, args.workspaceId, args.stageAId);
        if (!res.ok) errors += 1;
      } catch {
        errors += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, worker));

  const elapsedMs = Date.now() - startedAt;
  console.log(`Completed ${args.requests} requests in ${(elapsedMs / 1000).toFixed(1)}s ` +
    `(${(args.requests / (elapsedMs / 1000)).toFixed(1)} req/s), ${errors} errors.`);
}

async function submitBulkMove(args) {
  const submitStartedAt = Date.now();
  const submitRes = await fetch(`${args.baseUrl}/bulk-moves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': args.workspaceId },
    body: JSON.stringify({
      filter: { stageId: args.stageAId, status: 'open' },
      targetStageId: args.stageBId,
    }),
  });

  if (!submitRes.ok) {
    throw new Error(`Submit failed: ${submitRes.status} ${await submitRes.text()}`);
  }

  const { id: jobId } = await submitRes.json();
  console.log(`Job ${jobId} submitted in ${Date.now() - submitStartedAt}ms.`);
  return { jobId, submitStartedAt };
}

async function pollBulkMove(args, jobId, submitStartedAt) {
  const pollStartedAt = Date.now();
  let job;
  while (Date.now() - pollStartedAt < args.timeoutMs) {
    const res = await fetch(`${args.baseUrl}/bulk-moves/${jobId}`, {
      headers: { 'X-Workspace-Id': args.workspaceId },
    });
    job = await res.json();

    process.stdout.write(
      `\r  status=${job.status} done=${job.doneCount} skipped=${job.skippedCount} total=${job.totalItems}   `,
    );

    if (job.status === 'completed' || job.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, args.pollIntervalMs));
  }
  process.stdout.write('\n');

  const totalElapsedMs = Date.now() - submitStartedAt;
  const throughput = job.totalItems > 0 ? job.totalItems / (totalElapsedMs / 1000) : 0;

  console.log(`Final status: ${job.status}`);
  console.log(`total_items=${job.totalItems} done=${job.doneCount} skipped=${job.skippedCount}`);
  console.log(`Submit-to-completion time: ${(totalElapsedMs / 1000).toFixed(1)}s (${throughput.toFixed(1)} items/s)`);
  return job;
}

async function runBulkLoad(args) {
  console.log(`\nBulk move load: submitting a job over ${args.stageAId} (status=open) -> ${args.stageBId}`);
  const { jobId, submitStartedAt } = await submitBulkMove(args);
  console.log('Polling progress...');
  return pollBulkMove(args, jobId, submitStartedAt);
}

async function runIsolationLoad(args) {
  console.log(`\nIsolation load: bulk move on ${args.workspaceId}, concurrent interactive traffic ` +
    `on the same workspace and on ${args.otherWorkspaceId} (different workspace).`);
  console.log('Requests are logged with workspaceId; after this run, extract p95/p99 per workspace with:');
  console.log(`  node scripts/calc-percentiles.js <logfile> --workspace ${args.workspaceId}`);
  console.log(`  node scripts/calc-percentiles.js <logfile> --workspace ${args.otherWorkspaceId}`);

  const { jobId, submitStartedAt } = await submitBulkMove(args);

  let stop = false;
  let sameWorkspaceCount = 0;
  let otherWorkspaceCount = 0;

  async function interactiveWorker(workspaceId, stageId, counter) {
    while (!stop) {
      try {
        await interactiveRequest(args.baseUrl, workspaceId, stageId);
        counter.count += 1;
      } catch {
        // best-effort load generator; a failed interactive request doesn't stop the run
      }
    }
  }

  const sameCounter = { count: 0 };
  const otherCounter = { count: 0 };
  const workers = [
    ...Array.from({ length: args.isolationConcurrency }, () =>
      interactiveWorker(args.workspaceId, args.stageAId, sameCounter)),
    ...Array.from({ length: args.isolationConcurrency }, () =>
      interactiveWorker(args.otherWorkspaceId, args.otherStageId, otherCounter)),
  ];

  console.log('Polling progress (interactive traffic running in the background)...');
  const job = await pollBulkMove(args, jobId, submitStartedAt);

  stop = true;
  await Promise.all(workers);

  console.log(`Interactive requests during the run: ${sameCounter.count} in the bulk job's workspace, ` +
    `${otherCounter.count} in the separate workspace.`);
  return job;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.mode === 'mixed') await runMixedLoad(args);
  else if (args.mode === 'bulk') await runBulkLoad(args);
  else if (args.mode === 'isolation') await runIsolationLoad(args);
  else throw new Error(`Unknown --mode ${args.mode} (expected mixed | bulk | isolation)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
