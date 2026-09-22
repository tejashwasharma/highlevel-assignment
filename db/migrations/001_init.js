exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE workspaces (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE stages (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      sort_order   INTEGER NOT NULL
    );

    CREATE INDEX idx_stages_workspace ON stages (workspace_id, sort_order);

    CREATE TABLE opportunities (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      value        NUMERIC(14, 2) NOT NULL DEFAULT 0,
      status       TEXT NOT NULL CHECK (status IN ('open', 'won', 'lost', 'abandoned')),
      owner        TEXT NOT NULL,
      stage_id     UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
      version      INTEGER NOT NULL DEFAULT 1,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_opportunities_workspace_stage ON opportunities (workspace_id, stage_id);
    CREATE INDEX idx_opportunities_workspace_owner ON opportunities (workspace_id, owner);
    CREATE INDEX idx_opportunities_workspace_status ON opportunities (workspace_id, status);
    CREATE INDEX idx_opportunities_workspace_created ON opportunities (workspace_id, created_at);

    CREATE TABLE transitions (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      opportunity_id  UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
      from_stage_id   UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
      to_stage_id     UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
      moved_by        TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_transitions_opportunity ON transitions (opportunity_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS transitions CASCADE;
    DROP TABLE IF EXISTS opportunities CASCADE;
    DROP TABLE IF EXISTS stages CASCADE;
    DROP TABLE IF EXISTS workspaces CASCADE;
  `);
};
