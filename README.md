# highlevel-assignment

SDE-3 take-home: an opportunities pipeline where the real exercise is one operation, bulk
stage move. Move up to 50,000 opportunities matching a filter into a new stage in one
request; it runs as a background job that survives a crash, never double-applies, and
never starves other requests in the workspace it's running in.

Stack: Node 20 + TypeScript + Express 5, PostgreSQL (source of truth), Redis (fast-path
dedupe cache, not required for correctness).

**Start here for the actual design reasoning:** `DESIGN.md` (chunking/resume,
idempotency, concurrency, snapshot semantics, isolation, what breaks at 10x, what's next)
and `BENCHMARKS.md` (real measured numbers for all of it). This file covers running it,
seeding it, testing it, and what is and isn't built, not the *why*.

## Architecture

Two Node processes, one Postgres, one Redis:

```
client --> API (Express, pool of 20) --> Postgres
                  |                         ^
                  | insert job row          |
                  v                         |
             bulk_move_jobs  <----  Worker (poll loop, pool of 5)
                                         |
                                         v
                                     Redis (id/status cache, submit-path only)
```

A bulk move's job record moves through one state machine, entirely driven by the worker,
never by the API after the initial insert:

```
POST /bulk-moves
      |
      v
 materializing  --(worker runs the filter query, snapshots matches)-->  pending
      |                                                                    |
      |                                                    (worker claims/applies
      |                                                     500-row chunks, repeats)
      v                                                                    v
  completed  <----------------------------------------------------  running
   (0 matches)
```

`GET /bulk-moves/:id` only ever reads this row from Postgres, so a poll always reflects
real committed state, never an in-memory counter. Why it's split into `materializing` as
its own state, why chunking works the way it does, and what the worker's poll loop should
really be (events, not polling) are all in `DESIGN.md`.

Part 1 (`opportunities`, `stages`, `workspaces`, `transitions`) is intentionally thin CRUD,
just enough surface for Part 2 to be real, tenant-scoped by an `X-Workspace-Id` header, no
auth.

## Quick start

```bash
npm install
cp .env.example .env
npm run migrate        # schema + fixed-UUID demo dataset (see "Seed data" below)
npm start               # API on :3000
npm run start:worker    # separate process, required for anything to actually run
```

Or, one command, with the full test suite as a hard gate before `api`/`worker` start:

```bash
docker compose up --build
```

If a port's already taken locally, override it: `POSTGRES_PORT=5433 REDIS_PORT=6380
docker compose up --build`. If `npm test` fails inside the `test` service, `api` and
`worker` never start, `docker compose ps` will show why.

## Seed data

`003_seed_data` loads a small, fixed-UUID dataset automatically on migrate, so the API is
testable without creating a workspace first:

| Entity | id |
|---|---|
| workspace `Demo Workspace` | `00000000-0000-4000-8000-000000000001` |
| stage `New Lead` (12 opportunities) | `00000000-0000-4000-8000-000000000065` |
| stage `Qualified` (4 opportunities) | `00000000-0000-4000-8000-000000000066` |
| stage `Proposal Sent` (3 opportunities) | `00000000-0000-4000-8000-000000000067` |
| stage `Closed Won` (1 opportunity) | `00000000-0000-4000-8000-000000000068` |

Every endpoint requires `X-Workspace-Id`. For 500,000 opportunities + 5 small workspaces
(what the brief actually asks for to test isolation and scale), see "Load testing at
scale" below.

## API surface

| | | |
|---|---|---|
| `POST` | `/opportunities` | create |
| `POST` | `/opportunities/:id/move` | move one, optimistic-locked via `version`, `409` on conflict |
| `GET` | `/stages/:stageId/opportunities` | list, cursor-paginated |
| `POST` | `/bulk-moves` | submit a bulk move, returns `{id, status}` immediately |
| `GET` | `/bulk-moves/:id` | full job state, always live from Postgres |

Full request/response shapes for every endpoint, pre-wired to the seed ids above, are in
the Postman collection (`postman/HighLevel-Assignment.postman_collection.json` +
`.local.postman_environment.json`), that's the reference for the full surface, not
duplicated here. Two worth seeing inline, since they're the actual exercise:

```bash
# submit
curl -X POST http://localhost:3000/bulk-moves \
  -H "Content-Type: application/json" \
  -H "X-Workspace-Id: 00000000-0000-4000-8000-000000000001" \
  -d '{"filter":{"stageId":"00000000-0000-4000-8000-000000000066","status":"open"},"targetStageId":"00000000-0000-4000-8000-000000000067"}'
# -> {"id":"...","status":"materializing"}

# poll
curl http://localhost:3000/bulk-moves/{jobId} \
  -H "X-Workspace-Id: 00000000-0000-4000-8000-000000000001"
```

Submitting the identical `{filter, targetStageId}` again while that job is still active
returns the same `id` (content-hash dedupe, no client-supplied idempotency key). See
`DESIGN.md`'s idempotency section for where that key lives and where a retry could still
slip through.

## Testing

```bash
npm test
```

13 suites / 63 tests (`test/unit`, `test/app`, `test/worker`), including the parts that
are actually hard to get right: resume after a real `SIGKILL` mid-job, a manual move
racing a bulk job on the same record, dedupe with and without Redis up, and a real worker
process picking up a `materializing` job. Verified clean across a full `migrate down` /
`migrate up` cycle.

## Load testing at scale

```bash
npm run seed:load-test -- --reset   # 500,000 opportunities across 12 stages + 5 small workspaces
npm run load-test                    # 50k bulk move + concurrent same/different-workspace traffic
```

This is what produces the numbers in `BENCHMARKS.md`. `npm run load-test` also accepts
`--mode mixed|bulk|isolation`, `--concurrency`, `--requests`, `--isolation-concurrency`,
and `--workspace`/`--stage-a`/`--stage-b`/`--other-workspace`/`--other-stage` to point it
at different fixtures; see `parseArgs` at the top of `scripts/load-test.js` for the exact
list.

To turn the request logs any of the above generate into p50/p95/p99:

```bash
docker compose logs api --no-color --no-log-prefix > api.log   # or redirect stdout locally
node scripts/calc-percentiles.js api.log --workspace <id>       # --path, --method also supported
```

## What is and is not implemented

Implemented: Part 1 (create/move/list) and Part 2 in full, everything the brief's five
properties ask for (idempotent, resumable, observably progressing, correct under
concurrent edits, well-behaved), the required 500k+5-workspace seed script, and benchmark
numbers for all of it. Details and reasoning in `DESIGN.md` / `BENCHMARKS.md`, not
repeated here.

Deliberately not implemented, per the brief's out-of-scope list: any UI, real auth, a
board/pipeline view, per-stage rollups, filtering beyond the bulk filter's fields,
downstream event consumers, CI/Kubernetes, custom fields/contacts/notes/tasks, exhaustive
validation.

Known gaps, named honestly in `DESIGN.md`: no per-tenant resource quota (shared-pool
containment only), the materialize step's own filter query isn't sped up by being async,
just moved off the request path, and the worker should be event-driven (Kafka or similar)
rather than polling, not built here for time.
