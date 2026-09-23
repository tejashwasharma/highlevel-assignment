// Phase 2: bulk stage move job tables. Depends on workspaces/stages/opportunities
// from 001_init.js.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE bulk_move_jobs (
      id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id            UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      filter_hash             TEXT NOT NULL,
      filter                  JSONB NOT NULL,
      target_stage_id         UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
      status                  TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'running', 'completed', 'failed')),
      total_items             INTEGER NOT NULL DEFAULT 0,
      done_count              INTEGER NOT NULL DEFAULT 0,
      skipped_count           INTEGER NOT NULL DEFAULT 0,
      skipped_opportunity_ids UUID[] NOT NULL DEFAULT '{}',
      cursor_id               BIGINT,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX idx_bulk_move_jobs_dedupe
      ON bulk_move_jobs (workspace_id, filter_hash)
      WHERE status IN ('pending', 'running');

    CREATE TABLE bulk_move_job_items (
      id                BIGSERIAL PRIMARY KEY,
      job_id            UUID NOT NULL REFERENCES bulk_move_jobs(id) ON DELETE CASCADE,
      opportunity_id    UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
      status            TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'done', 'skipped_conflict', 'failed')),
      expected_version  INTEGER NOT NULL,
      processed_at      TIMESTAMPTZ
    );

    CREATE INDEX idx_job_items_job_id ON bulk_move_job_items (job_id, id);
    CREATE INDEX idx_job_items_job_status ON bulk_move_job_items (job_id, status);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS bulk_move_job_items CASCADE;
    DROP TABLE IF EXISTS bulk_move_jobs CASCADE;
  `);
};
