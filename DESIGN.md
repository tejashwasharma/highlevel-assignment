# DESIGN.md: Bulk Stage Move

Opportunities move through a workspace's pipeline one at a time or in bulk. A bulk move
runs as a background job: the client gets a handle back right away and polls for progress
separately, it never waits on the actual move. This doc covers that job: how it's chunked,
how it survives a restart, its idempotency model, what happens when a human and the job
touch the same record, snapshot vs. live filtering, isolation, what breaks at scale, and
what's next.

## Chunking, and how the cursor survives a restart

The filter runs exactly once, when the worker materializes the job (why that's not at
submission time is in "what breaks at 10x" below): every matching opportunity id, plus its
current `version`, gets written into `bulk_move_job_items` as a `pending` row. That's the
job's full scope, fixed from that moment on.

The worker then claims a bounded chunk at a time:

```sql
SELECT id, opportunity_id, expected_version
FROM bulk_move_job_items
WHERE job_id = $1 AND id > $2
ORDER BY id
LIMIT 500;
```

`$2` is `bulk_move_jobs.cursor_id`. The index that makes this cheap is `(job_id, id)` on
`bulk_move_job_items`, so the scan stays a tight range lookup no matter how deep into a
50,000-row job the worker already is. `bulk_move_job_items.id` is a `BIGSERIAL`, not a
UUID, on purpose: sequential ids are what make that index useful for keyset pagination in
the first place.

Each chunk is applied and its bookkeeping updated in one transaction: matching
`opportunities` rows get updated, `transitions` get inserted, and `cursor_id` moves
forward to the chunk's last item id, all together. That commit is the checkpoint. If the
worker dies mid-chunk, the transaction rolls back and nothing partial survives; the next
worker just claims from `cursor_id` again. Nothing already committed gets touched twice,
nothing half-applied is left behind.

Proven, not just argued: a real 50,000-item job (`BENCHMARKS.md`) was `SIGKILL`ed at
30,500 done, sat frozen at that count with `status: running` while the worker was dead,
then finished the remaining ~19,000 items in 5.7s after restart. Every job item ended
`done` exactly once, no opportunity's `version` showed a double move, and `transitions`
had exactly one row per opportunity for that job.

## Idempotency model

The key is derived from the request itself, not supplied by the client: a SHA-256 hash of
`workspaceId + filter + targetStageId`, with the filter's keys sorted so field order
doesn't change the hash. Nothing for the client to generate or store.

It lives in two places. `GET /bulk-moves/:id` is deliberately kept out of the cache and
always reads Postgres, so a poll never depends on Redis being up. Redis holds a small hash
at `bulkmove:{workspaceId}:{hash}` with just `id` and `status`, cheap to write and read
since the create endpoint only ever needs to answer "does a job for this content already
exist, and is it done yet." Status moves `materializing` → `pending` → `running` →
`completed` as the job actually progresses, so a duplicate submitted at any point sees the
real current phase, not a stale value. The durable copy is a `filter_hash` column with a
partial unique index:

```sql
CREATE UNIQUE INDEX idx_bulk_move_jobs_dedupe
  ON bulk_move_jobs (workspace_id, filter_hash)
  WHERE status IN ('materializing', 'pending', 'running');
```

Hit the key or the constraint while a matching job is active, and you get that job's
handle back instead of a second one starting. No override flag, no way to force a
duplicate through.

Where it can slip through: the Redis key carries a 5 minute TTL, refreshed on every write.
A retry that shows up after that window, once the job has finished, finds nothing to match
and looks like a brand new request. Accepted, not fixed, five minutes covers a flaky
client's realistic retry storm without holding the slot open indefinitely. If Redis is
down, the Postgres constraint still catches an in-flight duplicate, just later, at insert
time instead of at the door.

## Concurrency on a single opportunity

Every opportunity carries a `version`, bumped on every write. A manual move takes the row
with `FOR UPDATE`, checks the caller's `expectedVersion`, and only proceeds on a match:

```sql
SELECT * FROM opportunities WHERE id = $1 AND workspace_id = $2 FOR UPDATE;
-- mismatch -> 409, caller re-reads and retries
UPDATE opportunities SET stage_id = $1, version = version + 1 WHERE id = $2;
```

The bulk worker applies the same rule at chunk scale, in one statement rather than a loop:

```sql
WITH matched AS (
  SELECT o.id FROM opportunities o
  JOIN (candidate ids and expected versions) c
    ON o.id = c.id AND o.version = c.expected_version
  FOR UPDATE OF o
)
UPDATE opportunities SET stage_id = $1, version = version + 1
WHERE id IN (SELECT id FROM matched)
RETURNING id;
```

Whatever `RETURNING` doesn't include gets marked `skipped_conflict`. If a person moves an
opportunity by hand while the job is mid-run, the snapshot's copy of that record's version
is now stale, the conditional update touches zero rows for it, and the job skips it
instead of overwriting the edit. Deliberate: the bulk action reflects intent captured at
submission, a later manual edit is more recent and more specific, and it should win.
Skipped items are counted and listed on the job, so nothing silently disappears.

## Snapshot vs. live filter set

Snapshot. The filter runs once, when the job materializes, and the exact set of matching
ids gets frozen into `bulk_move_job_items`, not re-derived later. A record that starts
matching afterward never gets touched, it wasn't part of what the user acted on. A record
that was captured but later stops matching through some unrelated edit still gets
processed, the job works off the id list it captured, not the live predicate.

The alternative, re-querying the filter live per chunk, was rejected because it makes the
job's size and resume story fuzzy: `total_items` wouldn't be knowable upfront, and
"resume" would mean re-deriving a moving target instead of continuing a fixed list.

Honest consequence of materializing asynchronously: "when they submitted it" isn't quite
"when the snapshot was taken" anymore. An idle worker picks up a fresh `materializing` job
within about 100ms worst case; a busy one queues it behind whatever's running. Either way
there's a real, bounded gap where an edit could land before the filter runs and get swept
into a job whose submitter never saw it match. A genuine trade against the old synchronous
version, made worth it by not blocking the response on the filter's cost (see "what breaks
at 10x").

That gap exists specifically because pickup is a poll, not a push. The right architecture
is event-driven: submission publishes a `BulkMoveSubmitted` event, a separate materializer
service consumes it and reacts immediately, no interval to wait out, and scales
independently of the chunk-processing worker since the two jobs share no resources.
`worker-loop.ts` already has a comment saying as much; a single polling process doing both
was the fast way to build this correctly now, not the way it should stay.

## Isolation, and the hole it leaves

The worker runs its own connection pool (max 5), separate from the API's (max 20), so a
bulk job can't starve requests sharing the API's pool. Chunks are 500 rows, each pausing
100ms before the next, so the worker never runs flat out against the same Postgres
instance serving interactive traffic. Dedup and concurrency are scoped to workspace and
filter together, not the whole workspace, so two different moves can run side by side.

Every request is timed (`scripts/calc-percentiles.js` computes p50/p95/p99 from the logs,
filterable by workspace), so this claim is measured, not asserted, and the measurement
itself turned up something worth reporting honestly: results varied by run. Against a
500,000-opportunity workspace with a 50,000-item job running (`BENCHMARKS.md` has both
runs), one run showed interactive p95 at 41ms in the job's own workspace against 4.8ms in
an idle one; a later run on freshly rebuilt tables showed no meaningful gap at all. The
likely cause isn't the isolation mechanism, it's Postgres table health: the bloated run's
tables had absorbed several cycles of large inserts and deletes, which degrades exactly
the row-lookup-heavy queries both the chunk apply's `FOR UPDATE OF o` and interactive
list/create requests depend on. This mechanism bounds the job's own resource use; it says
nothing about the underlying table's maintenance, and that turned out to matter more than
expected.

There's a second, structural gap underneath, unrelated to table health: this is
shared-pool containment, not a hard per-tenant ceiling. Several jobs at once, in one
workspace or spread across many, still compete for the same worker pool and Postgres
instance.

## What breaks at 10x

Submission used to be the first thing to give out: materializing ran inside the
`POST /bulk-moves` transaction, so a filter matching a lot of rows meant a slow response.
Fixed now, submission only inserts the job row and returns; the worker materializes off
the request path. Latency no longer depends on match count. The 50,000-item cap
(`MAX_SNAPSHOT_ITEMS`) is unchanged, that's the brief's own scope, not something this
change tried to lift, but it's what makes raising that cap even worth discussing later.

A 20 million opportunity workspace still breaks the filter query itself, unless the
filter's columns are covered by the right composite indexes. Past a certain size,
partitioning `opportunities` by `workspace_id` is probably necessary too. Not fixed.

The in-process worker is the next ceiling either way: one job's worth of work happens at a
time, materializing or chunk-applying, so a slow filter query or a large job blocks
whatever's queued behind it.

## What I'd do with another week

1. Replace polling with events: submission publishes to Kafka (or similar), a separate
   materializer service consumes and reacts immediately, no poll interval, and
   materializing scales independently of chunk-applying.
2. Adaptive pacing instead of a fixed delay, back off when interactive latency climbs,
   speed up when it's quiet.
3. Multiple worker processes claiming chunks via `FOR UPDATE SKIP LOCKED`, for real
   horizontal scale and crash tolerance beyond single-process resume.
4. Per-tenant resource quotas, not just shared-pool containment.
5. Composite indexes on `opportunities` for the filter's real field combinations, so
   materialize itself stays fast on a workspace with millions of rows, not just off the
   request path.
6. A real Redis failover story. An outage degrades to Postgres-only correctly today, but
   Redis has no redundancy of its own.
