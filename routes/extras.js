"use strict";

module.exports = function extrasRoutes(app, ctx) {
  const { db, ok, err, uid, auth, requireRole, requireProjectAccess,
          mapSavedFilter, mapDashboardWidget, mapWorkLog, mapBaseline, mapBaselineTicket } = ctx;

  const write = requireRole(["operator", "admin"]);
  const projectAccess = requireProjectAccess("id");

  // ─── Saved Filters (TKT-3MD0S1) ────────────────────────────────────────────
  // Per-user, not shared — a saved filter is a personal shortcut, not a team-wide
  // view definition (no "shared with team" concept requested).

  app.get("/api/saved-filters", auth(), (req, res) => {
    const { entityType } = req.query;
    let query = "SELECT * FROM saved_filters WHERE user_id=?";
    const params = [req.user.id];
    if (entityType) { query += " AND entity_type=?"; params.push(entityType); }
    query += " ORDER BY created_at ASC";
    ok(res, db.prepare(query).all(...params).map(mapSavedFilter));
  });

  app.post("/api/saved-filters", auth(), (req, res) => {
    const { name, entityType = "ticket", query = {} } = req.body || {};
    if (!name || !name.trim()) return err(res, "name required");
    const id  = `FLT-${uid()}`;
    const now = new Date().toISOString();
    db.prepare("INSERT INTO saved_filters (id,user_id,name,entity_type,query,created_at) VALUES (?,?,?,?,?,?)")
      .run(id, req.user.id, name.trim(), entityType, JSON.stringify(query || {}), now);
    ok(res, mapSavedFilter(db.prepare("SELECT * FROM saved_filters WHERE id=?").get(id)), 201);
  });

  app.delete("/api/saved-filters/:id", auth(), (req, res) => {
    const f = db.prepare("SELECT * FROM saved_filters WHERE id=?").get(req.params.id);
    if (!f) return err(res, "Not found", 404);
    if (f.user_id !== req.user.id) return err(res, "Not your filter", 403);
    db.prepare("DELETE FROM saved_filters WHERE id=?").run(req.params.id);
    ok(res, { deleted: req.params.id });
  });

  // ─── Dashboard Widgets (TKT-RKTB6L) ────────────────────────────────────────
  // Per-user widget layout — add/remove/reorder a fixed catalog of widget types.

  app.get("/api/dashboard/widgets", auth(), (req, res) => {
    const rows = db.prepare("SELECT * FROM dashboard_widgets WHERE user_id=? ORDER BY position ASC").all(req.user.id);
    ok(res, rows.map(mapDashboardWidget));
  });

  app.post("/api/dashboard/widgets", auth(), (req, res) => {
    const { widgetType, config = {} } = req.body || {};
    if (!widgetType) return err(res, "widgetType required");
    const maxPos = db.prepare("SELECT MAX(position) AS m FROM dashboard_widgets WHERE user_id=?").get(req.user.id)?.m ?? -1;
    const id  = `WID-${uid()}`;
    const now = new Date().toISOString();
    db.prepare("INSERT INTO dashboard_widgets (id,user_id,widget_type,position,config,created_at) VALUES (?,?,?,?,?,?)")
      .run(id, req.user.id, widgetType, maxPos + 1, JSON.stringify(config || {}), now);
    ok(res, mapDashboardWidget(db.prepare("SELECT * FROM dashboard_widgets WHERE id=?").get(id)), 201);
  });

  app.patch("/api/dashboard/widgets/reorder", auth(), (req, res) => {
    const { order = [] } = req.body || {};
    for (let i = 0; i < order.length; i++) {
      db.prepare("UPDATE dashboard_widgets SET position=? WHERE id=? AND user_id=?").run(i, order[i], req.user.id);
    }
    ok(res, db.prepare("SELECT * FROM dashboard_widgets WHERE user_id=? ORDER BY position ASC").all(req.user.id).map(mapDashboardWidget));
  });

  app.delete("/api/dashboard/widgets/:id", auth(), (req, res) => {
    const w = db.prepare("SELECT * FROM dashboard_widgets WHERE id=?").get(req.params.id);
    if (!w || w.user_id !== req.user.id) return err(res, "Not found", 404);
    db.prepare("DELETE FROM dashboard_widgets WHERE id=?").run(req.params.id);
    ok(res, { deleted: req.params.id });
  });

  // ─── Time Tracking / Work Log (TKT-91OLB9) ────────────────────────────────

  app.get("/api/tickets/:id/work-logs", auth(), (req, res) => {
    const rows = db.prepare(`
      SELECT w.*, u.name AS user_name FROM work_logs w
      LEFT JOIN users u ON w.user_id = u.id
      WHERE w.ticket_id=? ORDER BY w.logged_at DESC
    `).all(req.params.id);
    ok(res, rows.map(mapWorkLog));
  });

  app.post("/api/tickets/:id/work-logs", write, (req, res) => {
    const { minutes, loggedAt = null, note = "" } = req.body || {};
    const mins = Number(minutes);
    if (!Number.isFinite(mins) || mins <= 0) return err(res, "minutes must be a positive number");
    if (!db.prepare("SELECT id FROM tickets WHERE id=?").get(req.params.id)) return err(res, "Ticket not found", 404);
    const id  = `WL-${uid()}`;
    const now = new Date().toISOString();
    db.prepare("INSERT INTO work_logs (id,ticket_id,user_id,minutes,logged_at,note,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(id, req.params.id, req.user.id, Math.round(mins), loggedAt || now.slice(0, 10), note.trim(), now);
    const row = db.prepare(`
      SELECT w.*, u.name AS user_name FROM work_logs w LEFT JOIN users u ON w.user_id = u.id WHERE w.id=?
    `).get(id);
    ok(res, mapWorkLog(row), 201);
  });

  app.delete("/api/work-logs/:id", write, (req, res) => {
    const wl = db.prepare("SELECT * FROM work_logs WHERE id=?").get(req.params.id);
    if (!wl) return err(res, "Not found", 404);
    if (wl.user_id !== req.user.id && !(req.user.roles || []).includes("admin"))
      return err(res, "Only the logger or an admin can delete this entry", 403);
    db.prepare("DELETE FROM work_logs WHERE id=?").run(req.params.id);
    ok(res, { deleted: req.params.id });
  });

  // Per-user rollup across all tickets — "how much time have I logged" summary.
  app.get("/api/work-logs/summary", auth(), (req, res) => {
    const rows = db.prepare(`
      SELECT t.id AS ticket_id, t.title AS ticket_title, SUM(w.minutes) AS total_minutes
      FROM work_logs w JOIN tickets t ON w.ticket_id = t.id
      WHERE w.user_id=?
      GROUP BY w.ticket_id
      ORDER BY total_minutes DESC
    `).all(req.user.id);
    ok(res, rows.map(r => ({ ticketId: r.ticket_id, ticketTitle: r.ticket_title, totalMinutes: r.total_minutes })));
  });

  // ─── Baselines & Snapshots (TKT-M6K5AP) ───────────────────────────────────
  // Freezes each current ticket's key fields at a point in time — a reference to
  // diff against later, e.g. at a release cut. Read-only once created (no edit
  // route) since a baseline that can drift after the fact defeats its purpose.

  app.get("/api/kb/projects/:id/baselines", auth(), projectAccess, (req, res) => {
    ok(res, db.prepare("SELECT * FROM baselines WHERE project_id=? ORDER BY created_at DESC").all(req.params.id).map(mapBaseline));
  });

  app.post("/api/kb/projects/:id/baselines", write, projectAccess, (req, res) => {
    if (!db.prepare("SELECT id FROM kb_projects WHERE id=?").get(req.params.id)) return err(res, "Project not found", 404);
    const { name, description = "" } = req.body || {};
    if (!name || !name.trim()) return err(res, "name required");
    const id  = `BSL-${uid()}`;
    const now = new Date().toISOString();
    const creator = req.user.name || req.user.email || "";
    db.prepare("INSERT INTO baselines (id,project_id,name,description,created_by,created_at) VALUES (?,?,?,?,?,?)")
      .run(id, req.params.id, name.trim(), description, creator, now);
    const tix = db.prepare(`
      SELECT t.*, u.name AS assignee_name FROM tickets t LEFT JOIN users u ON t.assignee_id = u.id WHERE t.project_id=?
    `).all(req.params.id);
    const insert = db.prepare(`
      INSERT INTO baseline_tickets (id,baseline_id,ticket_id,title,type,status,priority,story_points,assignee_name)
      VALUES (?,?,?,?,?,?,?,?,?)
    `);
    for (const t of tix) {
      insert.run(`BT-${uid()}`, id, t.id, t.title, t.type, t.status, t.priority, t.story_points ?? null, t.assignee_name || "");
    }
    ok(res, { ...mapBaseline(db.prepare("SELECT * FROM baselines WHERE id=?").get(id)), ticketCount: tix.length }, 201);
  });

  app.get("/api/baselines/:id", auth(), (req, res) => {
    const b = db.prepare("SELECT * FROM baselines WHERE id=?").get(req.params.id);
    if (!b) return err(res, "Not found", 404);
    const rows = db.prepare("SELECT * FROM baseline_tickets WHERE baseline_id=?").all(req.params.id).map(mapBaselineTicket);
    ok(res, { ...mapBaseline(b), tickets: rows });
  });

  app.delete("/api/baselines/:id", write, (req, res) => {
    if (!db.prepare("SELECT id FROM baselines WHERE id=?").get(req.params.id)) return err(res, "Not found", 404);
    db.prepare("DELETE FROM baselines WHERE id=?").run(req.params.id); // baseline_tickets cascades via FK
    ok(res, { deleted: req.params.id });
  });
};
