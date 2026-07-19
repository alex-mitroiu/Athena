"use strict";

module.exports = function kanbanRoutes(app, ctx) {
  const { db, ok, err, uid, auth, requireRole, broadcast,
          mapTicket, mapTicketLink, inverseLinkLabel, mapTicketComment, mapTicketAttachment, mapTicketLabel,
          mapKbProject, mapKbVersion, mapKbColumn, mapSprint, mapSprintSnapshot, mapNotification, fs, path, UPLOADS_DIR } = ctx;

  const write = requireRole(["operator", "admin"]);

  // ─── Ticket helpers ───────────────────────────────────────────────────────

  const TICKET_JOIN = `
    SELECT t.*, u.name AS assignee_name, tm.name AS team_name, sp.name AS sprint_name
    FROM   tickets t
    LEFT   JOIN users u ON t.assignee_id = u.id
    LEFT   JOIN teams tm ON t.team_id = tm.id
    LEFT   JOIN kb_sprints sp ON t.sprint_id = sp.id
  `;

  // Notifies the new assignee when a ticket's assignee changes (TKT-RZRUER) — fires
  // from both POST and PUT, skips notifying someone about assigning it to themselves.
  const notifyAssignee = (assigneeId, actingUserId, ticketId, ticketTitle) => {
    if (!assigneeId || assigneeId === actingUserId) return;
    db.prepare("INSERT INTO notifications (id,user_id,type,message,ticket_id,is_read,created_at) VALUES (?,?,?,?,?,0,?)")
      .run(`NTF-${uid()}`, assigneeId, "assigned", `You were assigned to "${ticketTitle}"`, ticketId, new Date().toISOString());
  };

  // ─── Tickets ──────────────────────────────────────────────────────────────

  app.get("/api/tickets", auth(), (req, res) => {
    const { projectId } = req.query;
    let query  = `${TICKET_JOIN} WHERE 1=1`;
    const params = [];
    // Fix 1: no longer includes NULL project_id rows — standalone starts clean
    if (projectId) { query += " AND t.project_id=?"; params.push(projectId); }
    query += " ORDER BY t.status, t.position, t.created_at";
    const rows = db.prepare(query).all(...params);
    const labelsByTicket = {};
    for (const l of db.prepare("SELECT ticket_id, label FROM ticket_labels ORDER BY label").all())
      (labelsByTicket[l.ticket_id] ||= []).push(l.label);
    ok(res, rows.map(r => ({ ...mapTicket(r), labels: labelsByTicket[r.id] || [] })));
  });

  app.post("/api/tickets", write, (req, res) => {
    const {
      title, section = "", description = "", priority = "Medium", status = "Ready",
      externalRef = null, type = "Task", version = "",
      parentId = null, assigneeId = null, teamId = null, startDate = null, dueDate = null, testNotes = null,
      projectId = null, versionId = null, sprintId = null, storyPoints = null, customFields = null,
    } = req.body;
    if (!title) return err(res, "title required");
    const id  = `TKT-${uid()}`;
    const pos = (db.prepare("SELECT MAX(position) AS m FROM tickets WHERE status=?").get(status)?.m ?? -1) + 1;
    db.prepare(`
      INSERT INTO tickets
        (id, title, section, description, priority, status, position, created_at,
         external_ref, type, version, parent_id, assignee_id, team_id, start_date, due_date, test_notes,
         project_id, version_id, sprint_id, story_points, custom_fields)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, title, section, description, priority, status, pos, new Date().toISOString(),
           externalRef || null, type, version, parentId || null, assigneeId || null, teamId || null,
           startDate || null, dueDate || null, testNotes || null, projectId || null, versionId || null, sprintId || null,
           storyPoints === "" || storyPoints === null ? null : Number(storyPoints),
           JSON.stringify(customFields && typeof customFields === "object" ? customFields : {}));
    if (assigneeId) notifyAssignee(assigneeId, req.user.id, id, title);
    ok(res, mapTicket(db.prepare(`${TICKET_JOIN} WHERE t.id=?`).get(id)), 201);
  });

  app.patch("/api/tickets/bulk", write, (req, res) => {
    const { ids, patch } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return err(res, "ids array required");
    const ALLOWED = { status: "status", priority: "priority", assigneeId: "assignee_id", teamId: "team_id", versionId: "version_id", sprintId: "sprint_id", storyPoints: "story_points" };
    const fields = Object.keys(patch || {}).filter(k => ALLOWED[k]);
    if (fields.length === 0) return err(res, `patch must include at least one of: ${Object.keys(ALLOWED).join(", ")}`);

    const nextPosByStatus = {};
    const updated = [];
    for (const id of ids) {
      if (!db.prepare("SELECT id FROM tickets WHERE id=?").get(id)) continue;
      const sets = [], vals = [];
      for (const f of fields) {
        const value = patch[f];
        sets.push(`${ALLOWED[f]}=?`);
        vals.push(f === "status" || f === "priority" ? value : f === "storyPoints" ? (value === "" || value === null ? null : Number(value)) : (value || null));
        if (f === "status") {
          if (nextPosByStatus[value] === undefined) {
            nextPosByStatus[value] = (db.prepare("SELECT MAX(position) AS m FROM tickets WHERE status=?").get(value)?.m ?? -1) + 1;
          }
          sets.push("position=?");
          vals.push(nextPosByStatus[value]++);
        }
      }
      vals.push(id);
      db.prepare(`UPDATE tickets SET ${sets.join(",")} WHERE id=?`).run(...vals);
      const row = db.prepare(`${TICKET_JOIN} WHERE t.id=?`).get(id);
      if (fields.includes("assigneeId") && patch.assigneeId) notifyAssignee(patch.assigneeId, req.user.id, id, row.title);
      updated.push(mapTicket(row));
    }
    broadcast("tickets_bulk_updated", { tickets: updated });
    ok(res, updated);
  });

  app.put("/api/tickets/:id", write, (req, res) => {
    const existing = db.prepare("SELECT * FROM tickets WHERE id=?").get(req.params.id);
    if (!existing) return err(res, "Not found", 404);
    const {
      title       = existing.title,
      section     = existing.section     ?? "",
      description = existing.description ?? "",
      priority    = existing.priority    ?? "Medium",
      status      = existing.status      ?? "Ready",
      position    = existing.position    ?? 0,
      externalRef = existing.external_ref,
      type        = existing.type        ?? "Task",
      version     = existing.version     ?? "",
      parentId    = existing.parent_id,
      assigneeId  = existing.assignee_id,
      teamId      = existing.team_id,
      startDate   = existing.start_date,
      dueDate     = existing.due_date,
      testNotes   = existing.test_notes,
      projectId   = existing.project_id,
      versionId   = existing.version_id,
      sprintId    = existing.sprint_id,
      storyPoints = existing.story_points,
      customFields,
    } = req.body;
    const fields = customFields !== undefined
      ? (customFields && typeof customFields === "object" ? customFields : {})
      : (() => { try { return JSON.parse(existing.custom_fields || "{}"); } catch { return {}; } })();
    const info = db.prepare(`
      UPDATE tickets
      SET title=?, section=?, description=?, priority=?, status=?, position=?,
          external_ref=?, type=?, version=?, parent_id=?, assignee_id=?, team_id=?, start_date=?, due_date=?,
          test_notes=?, project_id=?, version_id=?, sprint_id=?, story_points=?, custom_fields=?
      WHERE id=?
    `).run(title, section, description, priority, status, position,
           externalRef || null, type, version, parentId || null, assigneeId || null, teamId || null,
           startDate || null, dueDate || null, testNotes || null, projectId || null, versionId || null, sprintId || null,
           storyPoints === "" || storyPoints === null || storyPoints === undefined ? null : Number(storyPoints),
           JSON.stringify(fields),
           req.params.id);
    if (info.changes === 0) return err(res, "Not found", 404);
    if (assigneeId && assigneeId !== existing.assignee_id) notifyAssignee(assigneeId, req.user.id, req.params.id, title);
    ok(res, mapTicket(db.prepare(`${TICKET_JOIN} WHERE t.id=?`).get(req.params.id)));
  });

  app.delete("/api/tickets/:id", write, (req, res) => {
    const info = db.prepare("DELETE FROM tickets WHERE id=?").run(req.params.id);
    if (info.changes === 0) return err(res, "Not found", 404);
    ok(res, { deleted: req.params.id });
  });

  // ─── Ticket Comments ──────────────────────────────────────────────────────

  const COMMENT_JOIN = `
    SELECT c.*, u.name AS author_name
    FROM   ticket_comments c
    LEFT   JOIN users u ON c.author_id = u.id
  `;

  app.get("/api/tickets/:id/comments", auth(), (req, res) => {
    const rows = db.prepare(`${COMMENT_JOIN} WHERE c.ticket_id=? ORDER BY c.created_at ASC`).all(req.params.id);
    ok(res, rows.map(mapTicketComment));
  });

  app.post("/api/tickets/:id/comments", write, (req, res) => {
    const { body } = req.body || {};
    if (!body || !body.trim()) return err(res, "body required");
    if (!db.prepare("SELECT id FROM tickets WHERE id=?").get(req.params.id)) return err(res, "Ticket not found", 404);
    const id  = `CMT-${uid()}`;
    const now = new Date().toISOString();
    db.prepare("INSERT INTO ticket_comments (id,ticket_id,author_id,body,created_at) VALUES (?,?,?,?,?)")
      .run(id, req.params.id, req.user.id, body.trim(), now);
    const comment = mapTicketComment(db.prepare(`${COMMENT_JOIN} WHERE c.id=?`).get(id));
    broadcast("ticket_comment_added", { ticketId: req.params.id, comment });
    ok(res, comment, 201);
  });

  app.delete("/api/tickets/:id/comments/:commentId", write, (req, res) => {
    const c = db.prepare("SELECT * FROM ticket_comments WHERE id=? AND ticket_id=?").get(req.params.commentId, req.params.id);
    if (!c) return err(res, "Not found", 404);
    if (c.author_id !== req.user.id && !(req.user.roles || []).includes("admin"))
      return err(res, "Only the author or an admin can delete this comment", 403);
    db.prepare("DELETE FROM ticket_comments WHERE id=?").run(req.params.commentId);
    broadcast("ticket_comment_removed", { ticketId: req.params.id, commentId: req.params.commentId });
    ok(res, { deleted: req.params.commentId });
  });

  // ─── Ticket Attachments ───────────────────────────────────────────────────

  app.get("/api/tickets/:id/attachments", auth(), (req, res) => {
    const rows = db.prepare("SELECT * FROM ticket_attachments WHERE ticket_id=? ORDER BY created_at DESC").all(req.params.id);
    ok(res, rows.map(mapTicketAttachment));
  });

  app.post("/api/tickets/:id/attachments", write, (req, res) => {
    const { filename, mimeType, data } = req.body || {};
    if (!filename || !data) return err(res, "filename and data are required");
    if (!db.prepare("SELECT id FROM tickets WHERE id=?").get(req.params.id)) return err(res, "Ticket not found", 404);
    try {
      const buf        = Buffer.from(data, "base64");
      const ext        = path.extname(filename) || "";
      const storedName = `${Date.now()}_${uid()}${ext}`;
      fs.writeFileSync(path.join(UPLOADS_DIR, storedName), buf);
      const id      = `ATT-${uid()}`;
      const now     = new Date().toISOString();
      const uploader = req.user?.name || req.user?.email || "";
      db.prepare(`INSERT INTO ticket_attachments
        (id, ticket_id, filename, stored_name, mime_type, size_bytes, uploaded_by, created_at)
        VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, req.params.id, filename, storedName, mimeType || "", buf.length, uploader, now);
      const attachment = mapTicketAttachment(db.prepare("SELECT * FROM ticket_attachments WHERE id=?").get(id));
      broadcast("ticket_attachment_added", { ticketId: req.params.id, attachment });
      ok(res, attachment, 201);
    } catch (e) { err(res, e.message, 500); }
  });

  app.get("/api/attachments/:id/download", auth(), (req, res) => {
    const a = db.prepare("SELECT * FROM ticket_attachments WHERE id=?").get(req.params.id);
    if (!a) return err(res, "Not found", 404);
    const filePath = path.join(UPLOADS_DIR, a.stored_name);
    if (!fs.existsSync(filePath)) return err(res, "File not found on disk", 404);
    const inline = (a.mime_type || "").startsWith("image/") || a.mime_type === "application/pdf";
    res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${a.filename}"`);
    res.setHeader("Content-Type", a.mime_type || "application/octet-stream");
    fs.createReadStream(filePath).pipe(res);
  });

  app.delete("/api/attachments/:id", write, (req, res) => {
    const a = db.prepare("SELECT * FROM ticket_attachments WHERE id=?").get(req.params.id);
    if (!a) return err(res, "Not found", 404);
    try { fs.unlinkSync(path.join(UPLOADS_DIR, a.stored_name)); } catch {}
    db.prepare("DELETE FROM ticket_attachments WHERE id=?").run(req.params.id);
    broadcast("ticket_attachment_removed", { ticketId: a.ticket_id, attachmentId: req.params.id });
    ok(res, { deleted: req.params.id });
  });

  // ─── Ticket Labels ────────────────────────────────────────────────────────

  app.get("/api/labels", auth(), (req, res) => {
    const rows = db.prepare("SELECT DISTINCT label FROM ticket_labels ORDER BY label").all();
    ok(res, rows.map(r => r.label));
  });

  app.get("/api/tickets/:id/labels", auth(), (req, res) => {
    const rows = db.prepare("SELECT * FROM ticket_labels WHERE ticket_id=? ORDER BY label").all(req.params.id);
    ok(res, rows.map(mapTicketLabel));
  });

  app.post("/api/tickets/:id/labels", write, (req, res) => {
    const label = (req.body?.label || "").trim();
    if (!label) return err(res, "label required");
    if (!db.prepare("SELECT id FROM tickets WHERE id=?").get(req.params.id)) return err(res, "Ticket not found", 404);
    if (db.prepare("SELECT id FROM ticket_labels WHERE ticket_id=? AND label=?").get(req.params.id, label))
      return err(res, "Label already applied");
    const id = `LBL-${uid()}`;
    db.prepare("INSERT INTO ticket_labels (id,ticket_id,label,created_at) VALUES (?,?,?,?)")
      .run(id, req.params.id, label, new Date().toISOString());
    const created = mapTicketLabel(db.prepare("SELECT * FROM ticket_labels WHERE id=?").get(id));
    broadcast("ticket_label_added", { ticketId: req.params.id, label: created });
    ok(res, created, 201);
  });

  app.delete("/api/ticket-labels/:id", write, (req, res) => {
    const l = db.prepare("SELECT * FROM ticket_labels WHERE id=?").get(req.params.id);
    if (!l) return err(res, "Not found", 404);
    db.prepare("DELETE FROM ticket_labels WHERE id=?").run(req.params.id);
    broadcast("ticket_label_removed", { ticketId: l.ticket_id, labelId: req.params.id });
    ok(res, { deleted: req.params.id });
  });

  // ─── Ticket Links ─────────────────────────────────────────────────────────

  app.get("/api/tickets/:id/links", auth(), (req, res) => {
    const rows = db.prepare("SELECT * FROM ticket_links WHERE from_id=? OR to_id=?").all(req.params.id, req.params.id);
    ok(res, rows.map(l => {
      const isOut   = l.from_id === req.params.id;
      const otherId = isOut ? l.to_id : l.from_id;
      const other   = db.prepare("SELECT id, title, status, type FROM tickets WHERE id=?").get(otherId);
      return { ...mapTicketLink(l), direction: isOut ? "out" : "in",
        displayType: isOut ? l.link_type : inverseLinkLabel(l.link_type),
        otherTicketId: otherId, otherTicket: other || { id: otherId, title: otherId, status: "", type: "" } };
    }));
  });

  app.post("/api/tickets/:id/links", write, (req, res) => {
    const { toId, linkType } = req.body || {};
    if (!toId || !linkType) return err(res, "toId and linkType required");
    if (!db.prepare("SELECT id FROM tickets WHERE id=?").get(toId)) return err(res, "Target ticket not found", 404);
    if (db.prepare("SELECT id FROM ticket_links WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)").get(req.params.id, toId, toId, req.params.id))
      return err(res, "Link already exists");
    const id = `LNK-${uid()}`;
    db.prepare("INSERT INTO ticket_links (id,from_id,to_id,link_type,created_at) VALUES (?,?,?,?,?)")
      .run(id, req.params.id, toId, linkType, new Date().toISOString());
    ok(res, { id, fromId: req.params.id, toId, linkType }, 201);
  });

  app.delete("/api/ticket-links/:id", write, (req, res) => {
    const info = db.prepare("DELETE FROM ticket_links WHERE id=?").run(req.params.id);
    if (info.changes === 0) return err(res, "Not found", 404);
    ok(res, { deleted: req.params.id });
  });

  // ─── Projects ─────────────────────────────────────────────────────────────

  app.get("/api/kb/projects", auth(), (req, res) => {
    ok(res, db.prepare("SELECT * FROM kb_projects ORDER BY created_at ASC").all().map(mapKbProject));
  });

  app.post("/api/kb/projects", write, (req, res) => {
    const { name, key = "", color = "#6366f1", description = "" } = req.body || {};
    if (!name) return err(res, "name required");
    const id     = `PRJ-${uid()}`;
    const now    = new Date().toISOString();
    const keyVal = key.trim().toUpperCase() || name.slice(0, 4).toUpperCase();
    db.prepare("INSERT INTO kb_projects (id,name,key,color,description,created_at) VALUES (?,?,?,?,?,?)")
      .run(id, name, keyVal, color, description, now);
    const DEFAULT_COLUMNS = [
      { name: "Ready",           color: "#6366f1" },
      { name: "In Progress",     color: "#f59e0b" },
      { name: "In Testing",      color: "#06b6d4" },
      { name: "Testing Failed",  color: "#ef4444" },
      { name: "Ready to Deploy", color: "#f97316" },
      { name: "Done",            color: "#22c55e" },
      { name: "Released",        color: "#8b5cf6" },
    ];
    for (let i = 0; i < DEFAULT_COLUMNS.length; i++) {
      db.prepare("INSERT INTO kb_columns (id,project_id,name,position,color,created_at) VALUES (?,?,?,?,?,?)")
        .run(`COL-${uid()}`, id, DEFAULT_COLUMNS[i].name, i, DEFAULT_COLUMNS[i].color, now);
    }
    ok(res, mapKbProject(db.prepare("SELECT * FROM kb_projects WHERE id=?").get(id)), 201);
  });

  app.put("/api/kb/projects/:id", write, (req, res) => {
    const existing = db.prepare("SELECT * FROM kb_projects WHERE id=?").get(req.params.id);
    if (!existing) return err(res, "Not found", 404);
    const { name = existing.name, key = existing.key, color = existing.color, description = existing.description } = req.body || {};
    db.prepare("UPDATE kb_projects SET name=?,key=?,color=?,description=? WHERE id=?")
      .run(name, key.toUpperCase(), color, description, req.params.id);
    ok(res, mapKbProject(db.prepare("SELECT * FROM kb_projects WHERE id=?").get(req.params.id)));
  });

  app.delete("/api/kb/projects/:id", write, (req, res) => {
    if (db.prepare("SELECT COUNT(*) AS n FROM kb_projects").get().n <= 1)
      return err(res, "Cannot delete the last project");
    db.prepare("DELETE FROM kb_projects WHERE id=?").run(req.params.id);
    ok(res, { deleted: req.params.id });
  });

  // ─── Versions ─────────────────────────────────────────────────────────────

  app.get("/api/kb/projects/:id/versions", auth(), (req, res) => {
    ok(res, db.prepare("SELECT * FROM kb_versions WHERE project_id=? ORDER BY created_at ASC").all(req.params.id).map(mapKbVersion));
  });

  app.post("/api/kb/projects/:id/versions", write, (req, res) => {
    if (!db.prepare("SELECT id FROM kb_projects WHERE id=?").get(req.params.id)) return err(res, "Project not found", 404);
    const { name, description = "", status = "Planning", releaseDate = null } = req.body || {};
    if (!name) return err(res, "name required");
    const id  = `VER-${uid()}`;
    const now = new Date().toISOString();
    db.prepare("INSERT INTO kb_versions (id,project_id,name,description,status,release_date,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(id, req.params.id, name, description, status, releaseDate || null, now);
    ok(res, mapKbVersion(db.prepare("SELECT * FROM kb_versions WHERE id=?").get(id)), 201);
  });

  app.put("/api/kb/versions/:id", write, (req, res) => {
    const existing = db.prepare("SELECT * FROM kb_versions WHERE id=?").get(req.params.id);
    if (!existing) return err(res, "Not found", 404);
    const { name = existing.name, description = existing.description, status = existing.status, releaseDate = existing.release_date } = req.body || {};
    db.prepare("UPDATE kb_versions SET name=?,description=?,status=?,release_date=? WHERE id=?")
      .run(name, description, status, releaseDate || null, req.params.id);
    ok(res, mapKbVersion(db.prepare("SELECT * FROM kb_versions WHERE id=?").get(req.params.id)));
  });

  app.delete("/api/kb/versions/:id", write, (req, res) => {
    if (!db.prepare("SELECT id FROM kb_versions WHERE id=?").get(req.params.id)) return err(res, "Not found", 404);
    db.prepare("UPDATE tickets SET version_id=NULL WHERE version_id=?").run(req.params.id);
    db.prepare("DELETE FROM kb_versions WHERE id=?").run(req.params.id);
    ok(res, { deleted: req.params.id });
  });

  // ─── Sprints & Burndown (TKT-GB8PGQ) ──────────────────────────────────────
  // No historical event log exists to derive a true burndown from, so the actual
  // line is built by snapshotting today's remaining points on every view (upsert
  // by date) — a real daily aggregate accumulates from normal usage instead of
  // requiring a background job. The ideal line is computed client-side from the
  // sprint's total points + start/end dates.

  const DONE_STATUSES = new Set(["Done", "Ready to Deploy", "Released"]);

  app.get("/api/kb/projects/:id/sprints", auth(), (req, res) => {
    ok(res, db.prepare("SELECT * FROM kb_sprints WHERE project_id=? ORDER BY created_at ASC").all(req.params.id).map(mapSprint));
  });

  app.post("/api/kb/projects/:id/sprints", write, (req, res) => {
    if (!db.prepare("SELECT id FROM kb_projects WHERE id=?").get(req.params.id)) return err(res, "Project not found", 404);
    const { name, startDate = null, endDate = null, status = "Planning" } = req.body || {};
    if (!name) return err(res, "name required");
    const id  = `SPR-${uid()}`;
    const now = new Date().toISOString();
    db.prepare("INSERT INTO kb_sprints (id,project_id,name,start_date,end_date,status,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(id, req.params.id, name, startDate || null, endDate || null, status, now);
    ok(res, mapSprint(db.prepare("SELECT * FROM kb_sprints WHERE id=?").get(id)), 201);
  });

  app.put("/api/kb/sprints/:id", write, (req, res) => {
    const existing = db.prepare("SELECT * FROM kb_sprints WHERE id=?").get(req.params.id);
    if (!existing) return err(res, "Not found", 404);
    const { name = existing.name, startDate = existing.start_date, endDate = existing.end_date, status = existing.status } = req.body || {};
    db.prepare("UPDATE kb_sprints SET name=?,start_date=?,end_date=?,status=? WHERE id=?")
      .run(name, startDate || null, endDate || null, status, req.params.id);
    ok(res, mapSprint(db.prepare("SELECT * FROM kb_sprints WHERE id=?").get(req.params.id)));
  });

  app.delete("/api/kb/sprints/:id", write, (req, res) => {
    if (!db.prepare("SELECT id FROM kb_sprints WHERE id=?").get(req.params.id)) return err(res, "Not found", 404);
    db.prepare("UPDATE tickets SET sprint_id=NULL WHERE sprint_id=?").run(req.params.id);
    db.prepare("DELETE FROM kb_sprints WHERE id=?").run(req.params.id);
    ok(res, { deleted: req.params.id });
  });

  app.get("/api/kb/sprints/:id/burndown", auth(), (req, res) => {
    const sprint = db.prepare("SELECT * FROM kb_sprints WHERE id=?").get(req.params.id);
    if (!sprint) return err(res, "Not found", 404);
    const tix = db.prepare("SELECT status, story_points FROM tickets WHERE sprint_id=?").all(req.params.id);
    const totalPoints = tix.reduce((s, t) => s + (t.story_points || 0), 0);
    const remainingPoints = tix.filter(t => !DONE_STATUSES.has(t.status)).reduce((s, t) => s + (t.story_points || 0), 0);
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO kb_sprint_snapshots (id, sprint_id, date, remaining_points, total_points, created_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(sprint_id, date) DO UPDATE SET remaining_points=excluded.remaining_points, total_points=excluded.total_points
    `).run(`SNP-${uid()}`, req.params.id, today, remainingPoints, totalPoints, new Date().toISOString());
    const snapshots = db.prepare("SELECT * FROM kb_sprint_snapshots WHERE sprint_id=? ORDER BY date ASC").all(req.params.id).map(mapSprintSnapshot);
    ok(res, { sprint: mapSprint(sprint), totalPoints, remainingPoints, ticketCount: tix.length, snapshots });
  });

  // ─── Columns ──────────────────────────────────────────────────────────────

  app.get("/api/kb/projects/:id/columns", auth(), (req, res) => {
    ok(res, db.prepare("SELECT * FROM kb_columns WHERE project_id=? ORDER BY position ASC").all(req.params.id).map(mapKbColumn));
  });

  app.post("/api/kb/projects/:id/columns", write, (req, res) => {
    if (!db.prepare("SELECT id FROM kb_projects WHERE id=?").get(req.params.id)) return err(res, "Project not found", 404);
    const { name, color = "#6366f1", wipLimit = null } = req.body || {};
    if (!name) return err(res, "name required");
    const maxPos = db.prepare("SELECT MAX(position) AS m FROM kb_columns WHERE project_id=?").get(req.params.id)?.m ?? -1;
    const id     = `COL-${uid()}`;
    db.prepare("INSERT INTO kb_columns (id,project_id,name,position,color,wip_limit,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(id, req.params.id, name, maxPos + 1, color, wipLimit, new Date().toISOString());
    ok(res, mapKbColumn(db.prepare("SELECT * FROM kb_columns WHERE id=?").get(id)), 201);
  });

  app.put("/api/kb/columns/:id", write, (req, res) => {
    const existing = db.prepare("SELECT * FROM kb_columns WHERE id=?").get(req.params.id);
    if (!existing) return err(res, "Not found", 404);
    const { name = existing.name, color = existing.color, position = existing.position, wipLimit = existing.wip_limit } = req.body || {};
    db.prepare("UPDATE kb_columns SET name=?,color=?,position=?,wip_limit=? WHERE id=?")
      .run(name, color, position, wipLimit ?? null, req.params.id);
    ok(res, mapKbColumn(db.prepare("SELECT * FROM kb_columns WHERE id=?").get(req.params.id)));
  });

  app.patch("/api/kb/projects/:id/columns", write, (req, res) => {
    const { order = [] } = req.body || {};
    for (let i = 0; i < order.length; i++) {
      db.prepare("UPDATE kb_columns SET position=? WHERE id=? AND project_id=?").run(i, order[i], req.params.id);
    }
    ok(res, db.prepare("SELECT * FROM kb_columns WHERE project_id=? ORDER BY position ASC").all(req.params.id).map(mapKbColumn));
  });

  app.delete("/api/kb/columns/:id", write, (req, res) => {
    const existing = db.prepare("SELECT * FROM kb_columns WHERE id=?").get(req.params.id);
    if (!existing) return err(res, "Not found", 404);
    if (db.prepare("SELECT COUNT(*) AS n FROM kb_columns WHERE project_id=?").get(existing.project_id).n <= 1)
      return err(res, "Cannot delete the last column");
    const ticketCount = db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE status=?").get(existing.name).n;
    if (ticketCount > 0) return err(res, `Column has ${ticketCount} ticket(s) — move them first`);
    db.prepare("DELETE FROM kb_columns WHERE id=?").run(req.params.id);
    ok(res, { deleted: req.params.id });
  });

  // ─── Notifications (TKT-RZRUER) ───────────────────────────────────────────

  app.get("/api/notifications", auth(), (req, res) => {
    const rows = db.prepare("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50").all(req.user.id);
    ok(res, rows.map(mapNotification));
  });

  app.patch("/api/notifications/:id/read", auth(), (req, res) => {
    const n = db.prepare("SELECT * FROM notifications WHERE id=?").get(req.params.id);
    if (!n || n.user_id !== req.user.id) return err(res, "Not found", 404);
    db.prepare("UPDATE notifications SET is_read=1 WHERE id=?").run(req.params.id);
    ok(res, { ok: true });
  });

  app.patch("/api/notifications/read-all", auth(), (req, res) => {
    db.prepare("UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0").run(req.user.id);
    ok(res, { ok: true });
  });

  // ─── Approval workflows (TKT-S5RZ6D) ──────────────────────────────────────
  // Generic state machine on any ticket: null -> Pending -> Approved | Rejected.
  // Requesting again after a rejection resets to Pending (a fresh review cycle),
  // matching how a review-then-fix-then-resubmit loop actually works.

  app.patch("/api/tickets/:id/request-approval", write, (req, res) => {
    const t = db.prepare("SELECT * FROM tickets WHERE id=?").get(req.params.id);
    if (!t) return err(res, "Not found", 404);
    db.prepare("UPDATE tickets SET approval_status='Pending', approved_by='', approved_at=NULL WHERE id=?").run(req.params.id);
    ok(res, mapTicket(db.prepare(`${TICKET_JOIN} WHERE t.id=?`).get(req.params.id)));
  });

  app.patch("/api/tickets/:id/approve", write, (req, res) => {
    const t = db.prepare("SELECT * FROM tickets WHERE id=?").get(req.params.id);
    if (!t) return err(res, "Not found", 404);
    if (t.approval_status !== "Pending") return err(res, "This ticket has no pending approval request", 409);
    const now = new Date().toISOString();
    const reviewer = req.user.name || req.user.email || "";
    db.prepare("UPDATE tickets SET approval_status='Approved', approved_by=?, approved_at=? WHERE id=?").run(reviewer, now, req.params.id);
    ok(res, mapTicket(db.prepare(`${TICKET_JOIN} WHERE t.id=?`).get(req.params.id)));
  });

  app.patch("/api/tickets/:id/reject", write, (req, res) => {
    const t = db.prepare("SELECT * FROM tickets WHERE id=?").get(req.params.id);
    if (!t) return err(res, "Not found", 404);
    if (t.approval_status !== "Pending") return err(res, "This ticket has no pending approval request", 409);
    const now = new Date().toISOString();
    const reviewer = req.user.name || req.user.email || "";
    db.prepare("UPDATE tickets SET approval_status='Rejected', approved_by=?, approved_at=? WHERE id=?").run(reviewer, now, req.params.id);
    ok(res, mapTicket(db.prepare(`${TICKET_JOIN} WHERE t.id=?`).get(req.params.id)));
  });
};
