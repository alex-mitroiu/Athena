"use strict";

module.exports = function teamsRoutes(app, ctx) {
  const { db, ok, err, uid, requireRole, mapTeam } = ctx;

  const write = requireRole(["admin"]);

  const getMembers = teamId =>
    db.prepare(`
      SELECT u.id, u.name FROM team_members tm
      JOIN users u ON tm.user_id = u.id
      WHERE tm.team_id=? ORDER BY u.name
    `).all(teamId);

  // ─── Teams ────────────────────────────────────────────────────────────────

  app.get("/api/teams", (req, res) => {
    const rows = db.prepare("SELECT * FROM teams ORDER BY name").all();
    ok(res, rows.map(r => mapTeam(r, getMembers(r.id))));
  });

  app.post("/api/teams", write, (req, res) => {
    const { name, memberIds = [], color = "#6366f1" } = req.body || {};
    if (!name || !name.trim()) return err(res, "name required");
    const id  = `TEAM-${uid()}`;
    const now = new Date().toISOString();
    db.prepare("INSERT INTO teams (id,name,color,created_at) VALUES (?,?,?,?)")
      .run(id, name.trim(), color, now);
    for (const userId of memberIds) {
      if (!db.prepare("SELECT id FROM users WHERE id=?").get(userId)) continue;
      db.prepare("INSERT INTO team_members (id,team_id,user_id,created_at) VALUES (?,?,?,?)")
        .run(`TM-${uid()}`, id, userId, now);
    }
    ok(res, mapTeam(db.prepare("SELECT * FROM teams WHERE id=?").get(id), getMembers(id)), 201);
  });

  app.put("/api/teams/:id", write, (req, res) => {
    const existing = db.prepare("SELECT * FROM teams WHERE id=?").get(req.params.id);
    if (!existing) return err(res, "Not found", 404);
    const { name = existing.name, memberIds, color = existing.color } = req.body || {};
    if (!name || !name.trim()) return err(res, "name required");
    db.prepare("UPDATE teams SET name=?,color=? WHERE id=?").run(name.trim(), color, req.params.id);
    if (Array.isArray(memberIds)) {
      db.prepare("DELETE FROM team_members WHERE team_id=?").run(req.params.id);
      const now = new Date().toISOString();
      for (const userId of memberIds) {
        if (!db.prepare("SELECT id FROM users WHERE id=?").get(userId)) continue;
        db.prepare("INSERT INTO team_members (id,team_id,user_id,created_at) VALUES (?,?,?,?)")
          .run(`TM-${uid()}`, req.params.id, userId, now);
      }
    }
    ok(res, mapTeam(db.prepare("SELECT * FROM teams WHERE id=?").get(req.params.id), getMembers(req.params.id)));
  });

  app.delete("/api/teams/:id", write, (req, res) => {
    if (!db.prepare("SELECT id FROM teams WHERE id=?").get(req.params.id)) return err(res, "Not found", 404);
    // team_id on tickets has no FK — clear it explicitly so a deleted team doesn't
    // leave tickets pointing at a dangling id (same pattern as deleting a kb_version).
    db.prepare("UPDATE tickets SET team_id=NULL WHERE team_id=?").run(req.params.id);
    db.prepare("DELETE FROM teams WHERE id=?").run(req.params.id); // team_members cascades via FK
    ok(res, { deleted: req.params.id });
  });
};
