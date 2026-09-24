const { Pool } = require('pg');
const crypto = require('crypto');

function fixedId(suffix) {
  return `00000000-0000-4000-9000-${suffix.padStart(12, '0')}`;
}

const BIG_WORKSPACE_ID = fixedId('1');
const BIG_STAGE_COUNT = 12;
const BIG_STAGE_NAMES = [
  'New Lead', 'Contacted', 'Qualified', 'Discovery', 'Proposal Sent', 'Negotiation',
  'Verbal Commit', 'Contract Sent', 'Legal Review', 'Closed Won', 'Closed Lost', 'Abandoned',
];
const BIG_STAGE_IDS = '123456789abc'.split('').map((hex) => fixedId(`b${hex}`));
const BIG_OPPORTUNITY_COUNT = 500000;

const BIG_STAGE_WEIGHTS = [0.30, 0.18, 0.13, 0.10, 0.08, 0.06, 0.05, 0.04, 0.03, 0.015, 0.010, 0.005];

const SMALL_WORKSPACE_COUNT = 5;
const SMALL_WORKSPACE_OPPORTUNITY_COUNT = 3000;
const SMALL_WORKSPACES = Array.from({ length: SMALL_WORKSPACE_COUNT }, (_, k) => ({
  workspaceId: fixedId(String(2000 + k + 1)),
  name: `Small Workspace ${k + 1}`,
  stageIds: [fixedId(String(3000 + (k + 1) * 10 + 1)), fixedId(String(3000 + (k + 1) * 10 + 2))],
}));

const OWNERS = ['alice', 'bob', 'carol', 'dave'];
const STATUSES = ['open', 'open', 'open', 'won', 'lost', 'abandoned'];
const BATCH_SIZE = 1000;
const SPREAD_DAYS = 548; // ~18 months

function parseArgs(argv) {
  const args = { reset: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--reset') args.reset = true;
  }
  return args;
}

function weightedStageIndex(weights) {
  const roll = Math.random();
  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i];
    if (roll <= cumulative) return i;
  }
  return weights.length - 1;
}

function randomOpportunity(stageId) {
  const owner = OWNERS[Math.floor(Math.random() * OWNERS.length)];
  const status = STATUSES[Math.floor(Math.random() * STATUSES.length)];
  const value = Math.round((100 + Math.random() * 99900) * 100) / 100;
  const createdAt = new Date(Date.now() - Math.random() * SPREAD_DAYS * 24 * 60 * 60 * 1000);

  return {
    id: crypto.randomUUID(),
    name: `Opportunity ${owner}-${Math.floor(Math.random() * 10000000)}`,
    value,
    status,
    owner,
    stageId,
    createdAt: createdAt.toISOString(),
  };
}

async function insertBatch(pool, workspaceId, batch) {
  await pool.query(
    `INSERT INTO opportunities (id, workspace_id, name, value, status, owner, stage_id, version, created_at, updated_at)
     SELECT unnest($1::uuid[]), $2, unnest($3::text[]), unnest($4::numeric[]), unnest($5::text[]),
            unnest($6::text[]), unnest($7::uuid[]), 1, unnest($8::timestamptz[]), unnest($8::timestamptz[])`,
    [
      batch.map((o) => o.id),
      workspaceId,
      batch.map((o) => o.name),
      batch.map((o) => o.value),
      batch.map((o) => o.status),
      batch.map((o) => o.owner),
      batch.map((o) => o.stageId),
      batch.map((o) => o.createdAt),
    ],
  );
}

async function seedWorkspace(pool, workspaceId, name, stageIds, stageNames, stageWeights, targetCount) {
  await pool.query(
    `INSERT INTO workspaces (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [workspaceId, name],
  );
  for (let i = 0; i < stageIds.length; i++) {
    await pool.query(
      `INSERT INTO stages (id, workspace_id, name, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
      [stageIds[i], workspaceId, stageNames[i], i + 1],
    );
  }

  const existing = await pool.query(
    `SELECT count(*)::int AS count FROM opportunities WHERE workspace_id = $1`,
    [workspaceId],
  );
  if (existing.rows[0].count >= targetCount) {
    console.log(`  ${name}: already has ${existing.rows[0].count} opportunities (>= ${targetCount}). Skipping.`);
    return;
  }

  const remaining = targetCount - existing.rows[0].count;
  console.log(`  ${name}: seeding ${remaining} opportunities across ${stageIds.length} stage(s)...`);

  for (let inserted = 0; inserted < remaining; inserted += BATCH_SIZE) {
    const batchSize = Math.min(BATCH_SIZE, remaining - inserted);
    const batch = Array.from({ length: batchSize }, () => {
      const stageIndex = stageWeights ? weightedStageIndex(stageWeights) : Math.floor(Math.random() * stageIds.length);
      return randomOpportunity(stageIds[stageIndex]);
    });
    await insertBatch(pool, workspaceId, batch);
    process.stdout.write(`\r    ${Math.min(inserted + batchSize, remaining)}/${remaining}`);
  }
  process.stdout.write('\n');
}

async function main() {
  const { reset } = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

  try {
    if (reset) {
      console.log('Resetting seeded workspaces...');
      const workspaceIds = [BIG_WORKSPACE_ID, ...SMALL_WORKSPACES.map((ws) => ws.workspaceId)];
      for (const workspaceId of workspaceIds) {
        await pool.query(
          `DELETE FROM bulk_move_job_items WHERE job_id IN (SELECT id FROM bulk_move_jobs WHERE workspace_id = $1)`,
          [workspaceId],
        );
        await pool.query(`DELETE FROM bulk_move_jobs WHERE workspace_id = $1`, [workspaceId]);
        await pool.query(`DELETE FROM workspaces WHERE id = $1`, [workspaceId]);
      }
    }

    const startedAt = Date.now();

    console.log(`Large workspace (${BIG_OPPORTUNITY_COUNT} opportunities, ${BIG_STAGE_COUNT} stages):`);
    await seedWorkspace(pool, BIG_WORKSPACE_ID, 'Load Test Workspace', BIG_STAGE_IDS, BIG_STAGE_NAMES, BIG_STAGE_WEIGHTS, BIG_OPPORTUNITY_COUNT);

    console.log(`\nSmall workspaces (${SMALL_WORKSPACE_COUNT} x ${SMALL_WORKSPACE_OPPORTUNITY_COUNT} opportunities):`);
    for (const ws of SMALL_WORKSPACES) {
      await seedWorkspace(pool, ws.workspaceId, ws.name, ws.stageIds, ['Open', 'Closed'], null, SMALL_WORKSPACE_OPPORTUNITY_COUNT);
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(`\nDone in ${(elapsedMs / 1000).toFixed(1)}s.`);
    console.log('');
    console.log('Fixtures:');
    console.log(`  large workspace   = ${BIG_WORKSPACE_ID}`);
    console.log(`  large stage[0]    = ${BIG_STAGE_IDS[0]} (${BIG_STAGE_NAMES[0]}, bulk-move source)`);
    console.log(`  large stage[1]    = ${BIG_STAGE_IDS[1]} (${BIG_STAGE_NAMES[1]}, bulk-move target)`);
    SMALL_WORKSPACES.forEach((ws, i) => {
      console.log(`  small workspace ${i + 1} = ${ws.workspaceId} (stages: ${ws.stageIds.join(', ')})`);
    });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { BIG_WORKSPACE_ID, BIG_STAGE_IDS, BIG_STAGE_NAMES, SMALL_WORKSPACES };
