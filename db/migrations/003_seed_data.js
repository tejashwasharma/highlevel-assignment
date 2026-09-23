const data = require('../seed/data.json');

exports.up = async (pgm) => {
  const { workspace, stages, opportunities } = data;

  await pgm.db.query(
    `INSERT INTO workspaces (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [workspace.id, workspace.name],
  );

  for (const stage of stages) {
    await pgm.db.query(
      `INSERT INTO stages (id, workspace_id, name, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [stage.id, workspace.id, stage.name, stage.sortOrder],
    );
  }

  for (const opp of opportunities) {
    await pgm.db.query(
      `INSERT INTO opportunities (id, workspace_id, name, value, status, owner, stage_id, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $8)
       ON CONFLICT (id) DO NOTHING`,
      [opp.id, workspace.id, opp.name, opp.value, opp.status, opp.owner, opp.stageId, opp.createdAt],
    );
  }
};

exports.down = async (pgm) => {
  await pgm.db.query(`DELETE FROM workspaces WHERE id = $1`, [data.workspace.id]);
};
