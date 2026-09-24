# BENCHMARKS.md

Numbers below are all from real runs against this repo's Docker stack (`docker compose up`),
not estimates. Method and raw commands are in the last section so they can be reproduced.
Re-run after the async-materialization change (submission no longer runs the filter query),
so these reflect the current architecture, not an earlier version of it.

## Hardware

- Apple M5 Pro, 15 cores, 24 GB RAM
- macOS (Darwin 27.0.0 kernel), Docker Desktop, Engine 29.8.0
- Containers: `postgres:16-alpine`, `redis:7-alpine`, app on `node:20-alpine`
- API connection pool: 20. Worker connection pool: 5. Chunk size: 500. Chunk pacing: 100ms.
  Idle poll interval: 100ms.

## Dataset

Seeded with `npm run seed:load-test`: one workspace with 500,000 opportunities across 12
stages (funnel-weighted, so early stages hold more), spread over ~18 months, plus 5 small
workspaces of 3,000 opportunities each. The bulk move below filters `stageId=New Lead,
status=open`, which matched ~75,000 opportunities in these runs, comfortably over the
50,000-per-job cap, so every number below reflects a job that actually hit that cap.

## Submission latency

`POST /bulk-moves` returned in 30ms against the full 500k-opportunity workspace, one
insert, no filter query on the request path. The job came back as `{"status":
"materializing"}`, then reached `running` with the first chunk already applied within
about 100-150ms of submission when the worker was idle beforehand, consistent with the
100ms idle poll interval.

## Bulk move of 50,000

| | |
|---|---|
| total_items | 50,000 (capped; ~75,000 matched the filter) |
| done / skipped | 50,000 / 0 |
| submit-to-completion | 13.7s |
| sustained throughput | 3,637.7 items/s |

No manual edits were racing this particular run, so `skipped=0` is expected; the
concurrent-edit collision path is covered separately by a dedicated test, not by this
timing run.

## Interactive requests during the bulk run

Same bulk move as above, with concurrent interactive traffic (mixed `GET` list /
`POST` create, 8 concurrent workers per workspace) run against two workspaces for the
job's full duration: the workspace the job is running in, and one of the 5 small,
unrelated workspaces.

| | same workspace | different workspace |
|---|---|---|
| requests completed | 32,778 | 24,722 |
| p50 | 1.7 ms | 3.0 ms |
| p95 | 3.0 ms | 4.7 ms |
| p99 | 4.3 ms | 5.7 ms |
| max | 68.1 ms | 70.9 ms |
| mean | 1.9 ms | 2.9 ms |

No meaningful isolation gap in this run, if anything the job's own workspace did slightly
better. That's a real, reproduced result, not a typo, but it isn't the whole story: an
earlier run against this same setup (before the tables here had gone through a full
migration rebuild) measured p95 at 41ms in the job's workspace against 4.8ms in the idle
one, an 8-9x gap. The most likely explanation is table health, not the isolation
mechanism: that earlier run's tables had absorbed several cycles of 500k-row inserts and
deletes over the course of building this out, and Postgres index/heap bloat from that kind
of churn degrades exactly the row-lookup-heavy queries both the chunk apply and the
interactive list/create requests are doing. A freshly created table (which `migrate down`
+ `migrate up` produces, versus `DELETE FROM`) doesn't have that bloat.

This doesn't retract the isolation section's claim in `DESIGN.md`, shared-pool containment
is still not a hard per-tenant ceiling, and the mechanism only bounds the job's own
resource use, not Postgres's general health under churn. It does mean the actual size of
the interactive-latency gap is more sensitive to table maintenance (autovacuum tuning,
periodic reindexing under heavy churn) than to the isolation mechanism itself, which is a
more useful thing to know than either number alone.

## Kill and resume

The worker was `SIGKILL`ed mid-job and restarted, using the same filter as above
(50,000-item job).

| | |
|---|---|
| killed at | 30,500 / 50,000 done (61%) |
| job state while worker was down | `status: running`, `doneCount` frozen at the last committed chunk, `updatedAt` unchanged, confirmed by polling `GET /bulk-moves/:id` repeatedly with the worker dead |
| worker restarted | resumed from `cursor_id`, no flag or manual intervention needed |
| time to completion after restart | 5.5s for the remaining ~19,500 items |

**Proof of correctness**, queried directly against Postgres after completion:
- `bulk_move_job_items`: all 50,000 rows `status = 'done'`, none left `pending` or
  reprocessed into a different terminal state.
- 0 opportunities among the done items have `version != 2`, none were moved twice.
- exactly 50,000 rows in `transitions` for this job (`moved_by = 'bulk-move:<job id>'`),
  and exactly 50,000 *distinct* `opportunity_id`s among them, no opportunity got a
  duplicate transition recorded from work done before the kill being redone after restart.

That's the concrete meaning of "correctly" from `DESIGN.md`'s resume section: every item
processed exactly once, nothing skipped that should have been done, nothing double-applied.

## Method

```bash
# 1. seed, run from inside a container so it hits the docker postgres directly
# instead of racing the host's own port 5432 if something else is bound there too
docker compose up --build
docker cp scripts/seed-load-test.js highlevel-assignment-api-1:/app/seed-load-test.js
docker exec -e DATABASE_URL=postgres://app:app@postgres:5432/highlevel-assignment \
  highlevel-assignment-api-1 node /app/seed-load-test.js --reset

# 2. submission latency + bulk-move-of-50k + same/different-workspace isolation numbers
node scripts/load-test.js --isolation-concurrency 8
docker compose logs api --no-color --no-log-prefix > api.log
node scripts/calc-percentiles.js api.log --workspace 00000000-0000-4000-9000-000000000001
node scripts/calc-percentiles.js api.log --workspace 00000000-0000-4000-9000-000000002001

# 3. kill and resume (manual, to control exactly when the kill happens)
JOB_ID=$(curl -s -X POST http://localhost:3000/bulk-moves \
  -H "Content-Type: application/json" \
  -H "X-Workspace-Id: 00000000-0000-4000-9000-000000000001" \
  -d '{"filter":{"stageId":"00000000-0000-4000-9000-0000000000b1","status":"open"},"targetStageId":"00000000-0000-4000-9000-0000000000b2"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

# poll until doneCount is around 60% of totalItems, then kill
until [ "$(curl -s http://localhost:3000/bulk-moves/$JOB_ID -H "X-Workspace-Id: 00000000-0000-4000-9000-000000000001" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d['doneCount']>=30000 else 0)")" = "1" ]; do sleep 0.2; done
docker kill -s SIGKILL highlevel-assignment-worker-1

# confirm doneCount is frozen and status is still "running" while the worker is dead
curl -s http://localhost:3000/bulk-moves/$JOB_ID -H "X-Workspace-Id: 00000000-0000-4000-9000-000000000001"

# confirm the container is actually back up before trusting anything it reports
docker start highlevel-assignment-worker-1
docker ps --filter name=highlevel-assignment-worker-1 --format '{{.Status}}'   # expect "Up ..."

# poll until the job itself reports done, not just the container being up
until [ "$(curl -s http://localhost:3000/bulk-moves/$JOB_ID -H "X-Workspace-Id: 00000000-0000-4000-9000-000000000001" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if d['status'] in ('completed','failed') else 0)")" = "1" ]; do sleep 0.2; done
curl -s http://localhost:3000/bulk-moves/$JOB_ID -H "X-Workspace-Id: 00000000-0000-4000-9000-000000000001"
# timestamps around the docker start / final poll give resume time
```
