"use strict";

module.exports = function kanbanRoutes(app, ctx) {
  const { db, ok, err, uid, auth, requireRole, broadcast,
          mapTicket, mapTicketLink, inverseLinkLabel, mapTicketComment, mapTicketAttachment, mapTicketLabel,
          mapKbProject, mapKbVersion, mapKbColumn, mapSprint, mapSprintSnapshot, mapNotification, mapReleaseMilestone, fs, path, UPLOADS_DIR,
          isProjectMember, accessibleProjectIds, requireProjectAccess, isAdminUser,
          mapStatusHistory, mapFieldHistory, mapWatcher, mapProjectMember, mapWorkflowTransition, mapBoard, mapBoardStatus } = ctx;

  const write = requireRole(["operator", "admin"]);
  const manageMembers = requireRole(["admin"]);
  const projectAccess = requireProjectAccess("id");

  // ─── Workflow helpers (TKT-188OHK) ─────────────────────────────────────────
  // A project with zero transitions defined has no configured workflow yet —
  // status changes stay unrestricted (backward compatible for every project
  // that predates this feature). Enforcement only switches on once an admin
  // actually defines at least one transition.
  const isTransitionAllowed = (projectId, ticketType, fromStatus, toStatus) => {
    const transitions = db.prepare("SELECT * FROM workflow_transitions WHERE project_id=?").all(projectId);
    if (transitions.length === 0) return true;
    return transitions.some(t =>
      (t.from_status === null || t.from_status === fromStatus) &&
      t.to_status === toStatus &&
      (t.ticket_type === null || t.ticket_type === ticketType));
  };

  // The specific transition row a status change matches, if any — the row a
  // "custom behavior" requirement is attached to. null when the project has no
  // workflow configured yet (fully unrestricted, same case isTransitionAllowed
  // already treats as permissive).
  const findMatchingTransition = (projectId, ticketType, fromStatus, toStatus) => {
    const transitions = db.prepare("SELECT * FROM workflow_transitions WHERE project_id=?").all(projectId);
    if (transitions.length === 0) return null;
    return transitions.find(t =>
      (t.from_status === null || t.from_status === fromStatus) &&
      t.to_status === toStatus &&
      (t.ticket_type === null || t.ticket_type === ticketType)) || null;
  };

  const RULE_FIELD_LABELS = {
    versionId: "Version", assigneeId: "Assignee", storyPoints: "Story Points",
    dueDate: "Due Date", teamId: "Team", sprintId: "Sprint",
  };

  // Evaluates a matched transition's optional requirement ("custom behavior")
  // against the ticket's state AFTER the incoming change is applied — so
  // setting the required field in the same request that changes status is
  // allowed, not rejected for being "not set yet". Returns null when satisfied
  // (or when the transition carries no requirement), else a user-facing reason.
  const checkTransitionRule = (transition, ticketId, mergedFields) => {
    if (!transition || !transition.rule_type) return null;
    let cfg = {};
    try { cfg = JSON.parse(transition.rule_config || "{}"); } catch {}
    if (transition.rule_type === "require_link") {
      const hasLink = cfg.linkType
        ? db.prepare("SELECT 1 FROM ticket_links WHERE (from_id=? OR to_id=?) AND link_type=?").get(ticketId, ticketId, cfg.linkType)
        : db.prepare("SELECT 1 FROM ticket_links WHERE from_id=? OR to_id=?").get(ticketId, ticketId);
      if (!hasLink) {
        return cfg.linkType
          ? `The "${transition.name}" transition requires a "${cfg.linkType}" link first`
          : `The "${transition.name}" transition requires this ticket to be linked to another ticket first`;
      }
    }
    if (transition.rule_type === "require_field") {
      const label = RULE_FIELD_LABELS[cfg.field];
      const val = mergedFields[cfg.field];
      if (label && (val === null || val === undefined || val === "")) {
        return `The "${transition.name}" transition requires "${label}" to be set first`;
      }
    }
    return null;
  };

  // Replaces the old hardcoded DONE_STATUSES name-matching set — reads each
  // project's own kb_columns.category instead, so renaming a column no longer
  // silently breaks the reports that need to know what "done" means.
  const doneStatusesFor = projectId =>
    new Set(db.prepare("SELECT name FROM kb_columns WHERE project_id=? AND category='Done'").all(projectId).map(r => r.name));

  // ─── Ticket helpers ───────────────────────────────────────────────────────

  const TICKET_JOIN = `
    SELECT t.*, u.name AS assignee_name, tm.name AS team_name, sp.name AS sprint_name, ini.title AS initiative_title
    FROM   tickets t
    LEFT   JOIN users u ON t.assignee_id = u.id
    LEFT   JOIN teams tm ON t.team_id = tm.id
    LEFT   JOIN kb_sprints sp ON t.sprint_id = sp.id
    LEFT   JOIN tickets ini ON t.initiative_id = ini.id
  `;

  // Notifies the new assignee when a ticket's assignee changes (TKT-RZRUER) — fires
  // from both POST and PUT, skips notifying someone about assigning it to themselves.
  const notifyAssignee = (assigneeId, actingUserId, ticketId, ticketTitle) => {
    if (!assigneeId || assigneeId === actingUserId) return;
    db.prepare("INSERT INTO notifications (id,user_id,type,message,ticket_id,is_read,created_at) VALUES (?,?,?,?,?,0,?)")
      .run(`NTF-${uid()}`, assigneeId, "assigned", `You were assigned to "${ticketTitle}"`, ticketId, new Date().toISOString());
  };

  // Notifies every watcher of a ticket except the person who just made the change.
  const notifyWatchers = (ticketId, actingUserId, message) => {
    const watchers = db.prepare("SELECT user_id FROM ticket_watchers WHERE ticket_id=? AND user_id!=?").all(ticketId, actingUserId);
    const now = new Date().toISOString();
    for (const w of watchers) {
      db.prepare("INSERT INTO notifications (id,user_id,type,message,ticket_id,is_read,created_at) VALUES (?,?,?,?,?,0,?)")
        .run(`NTF-${uid()}`, w.user_id, "watched", message, ticketId, now);
    }
  };

  // Logs a real status transition (TKT-891SR2) — only when the status actually
  // changed, never a no-op "moved to the same column" call.
  const logStatusChange = (ticketId, fromStatus, toStatus, actingUserId) => {
    if (fromStatus === toStatus) return;
    db.prepare("INSERT INTO ticket_status_history (id,ticket_id,from_status,to_status,changed_by,changed_at) VALUES (?,?,?,?,?,?)")
      .run(`TSH-${uid()}`, ticketId, fromStatus || null, toStatus, actingUserId || "", new Date().toISOString());
  };

  // Generic field-change log (priority, assignee, etc.) — the Activity tab was
  // only ever showing status moves; this covers everything else a ticket edit
  // can change. Guarded the same way as logStatusChange: no-op writes of an
  // unchanged value never create a row.
  const logFieldChange = (ticketId, field, fromValue, toValue, actingUserId) => {
    if (fromValue === toValue) return;
    db.prepare("INSERT INTO ticket_field_history (id,ticket_id,field,from_value,to_value,changed_by,changed_at) VALUES (?,?,?,?,?,?,?)")
      .run(`TFH-${uid()}`, ticketId, field, fromValue ?? null, toValue ?? null, actingUserId || "", new Date().toISOString());
  };

  // Resolve id -> display name for logging purposes only (raw ids in history
  // aren't meaningful to read later) — each is a single cheap lookup, only run
  // when that specific field actually changed.
  const resolveUserName    = id => id ? (db.prepare("SELECT name FROM users WHERE id=?").get(id)?.name || id) : "Unassigned";
  const resolveTeamName    = id => id ? (db.prepare("SELECT name FROM teams WHERE id=?").get(id)?.name || id) : "No team";
  const resolveVersionName = id => id ? (db.prepare("SELECT name FROM kb_versions WHERE id=?").get(id)?.name || id) : "No version";
  const resolveSprintName  = id => id ? (db.prepare("SELECT name FROM kb_sprints WHERE id=?").get(id)?.name || id) : "No sprint";
  const resolveInitiativeName = id => id ? (db.prepare("SELECT title FROM tickets WHERE id=?").get(id)?.title || id) : "No initiative";

  // Parses @Name mentions out of a comment body and notifies each matched user
  // (case-insensitive full-name match against the users table).
  const notifyMentions = (body, actingUserId, ticketId, ticketTitle) => {
    const matches = [...body.matchAll(/@([A-Za-z][\w.'-]*(?:\s+[A-Za-z][\w.'-]*)?)/g)].map(m => m[1].trim());
    if (matches.length === 0) return;
    const users = db.prepare("SELECT id, name FROM users").all();
    const now = new Date().toISOString();
    const notified = new Set();
    for (const name of matches) {
      const user = users.find(u => u.name.toLowerCase() === name.toLowerCase());
      if (!user || user.id === actingUserId || notified.has(user.id)) continue;
      notified.add(user.id);
      db.prepare("INSERT INTO notifications (id,user_id,type,message,ticket_id,is_read,created_at) VALUES (?,?,?,?,?,0,?)")
        .run(`NTF-${uid()}`, user.id, "mentioned", `You were mentioned on "${ticketTitle}"`, ticketId, now);
    }
  };

  // ─── Tickets ──────────────────────────────────────────────────────────────

  app.get("/api/tickets", auth(), (req, res) => {
    const { projectId } = req.query;
    if (projectId && !isAdminUser(req.user) && !isProjectMember(projectId, req.user.id))
      return err(res, "Forbidden — not a member of this project", 403);

    let query  = `${TICKET_JOIN} WHERE 1=1`;
    const params = [];
    // Fix 1: no longer includes NULL project_id rows — standalone starts clean
    if (projectId) {
      query += " AND t.project_id=?"; params.push(projectId);
    } else {
      const ids = accessibleProjectIds(req.user);
      if (ids !== null) {
        if (ids.length === 0) return ok(res, []);
        query += ` AND t.project_id IN (${ids.map(() => "?").join(",")})`;
        params.push(...ids);
      }
    }
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
      initiativeId = null,
    } = req.body;
    if (!title) return err(res, "title required");
    const id  = `TKT-${uid()}`;
    const pos = (db.prepare("SELECT MAX(position) AS m FROM tickets WHERE status=?").get(status)?.m ?? -1) + 1;
    db.prepare(`
      INSERT INTO tickets
        (id, title, section, description, priority, status, position, created_at,
         external_ref, type, version, parent_id, assignee_id, team_id, start_date, due_date, test_notes,
         project_id, version_id, sprint_id, story_points, custom_fields, initiative_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, title, section, description, priority, status, pos, new Date().toISOString(),
           externalRef || null, type, version, parentId || null, assigneeId || null, teamId || null,
           startDate || null, dueDate || null, testNotes || null, projectId || null, versionId || null, sprintId || null,
           storyPoints === "" || storyPoints === null ? null : Number(storyPoints),
           JSON.stringify(customFields && typeof customFields === "object" ? customFields : {}),
           initiativeId || null);
    if (assigneeId) notifyAssignee(assigneeId, req.user.id, id, title);
    logStatusChange(id, null, status, req.user.id);
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
    const skipped = [];
    for (const id of ids) {
      const before = db.prepare("SELECT * FROM tickets WHERE id=?").get(id);
      if (!before) continue;
      if (fields.includes("status") && patch.status !== before.status) {
        if (!isTransitionAllowed(before.project_id, before.type, before.status, patch.status)) {
          skipped.push({ id, reason: `"${before.status}" → "${patch.status}" isn't an allowed transition for this project's workflow` });
          continue;
        }
        const matchedTransition = findMatchingTransition(before.project_id, before.type, before.status, patch.status);
        const merged = { versionId: before.version_id, assigneeId: before.assignee_id, storyPoints: before.story_points,
          dueDate: before.due_date, teamId: before.team_id, sprintId: before.sprint_id, ...patch };
        const ruleError = checkTransitionRule(matchedTransition, id, merged);
        if (ruleError) { skipped.push({ id, reason: ruleError }); continue; }
      }
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
      if (fields.includes("assigneeId") && patch.assigneeId && patch.assigneeId !== before.assignee_id)
        notifyAssignee(patch.assigneeId, req.user.id, id, row.title);
      if (fields.includes("status")) {
        logStatusChange(id, before.status, patch.status, req.user.id);
        if (before.status !== patch.status)
          notifyWatchers(id, req.user.id, `"${row.title}" moved from ${before.status} to ${patch.status}`);
      }
      if (fields.includes("priority") && patch.priority !== before.priority)
        logFieldChange(id, "Priority", before.priority, patch.priority, req.user.id);
      if (fields.includes("assigneeId") && (patch.assigneeId || null) !== (before.assignee_id || null))
        logFieldChange(id, "Assignee", resolveUserName(before.assignee_id), resolveUserName(patch.assigneeId), req.user.id);
      if (fields.includes("teamId") && (patch.teamId || null) !== (before.team_id || null))
        logFieldChange(id, "Team", resolveTeamName(before.team_id), resolveTeamName(patch.teamId), req.user.id);
      if (fields.includes("versionId") && (patch.versionId || null) !== (before.version_id || null))
        logFieldChange(id, "Version", resolveVersionName(before.version_id), resolveVersionName(patch.versionId), req.user.id);
      if (fields.includes("sprintId") && (patch.sprintId || null) !== (before.sprint_id || null))
        logFieldChange(id, "Sprint", resolveSprintName(before.sprint_id), resolveSprintName(patch.sprintId), req.user.id);
      if (fields.includes("storyPoints")) {
        const spBefore = before.story_points ?? null;
        const spAfter  = patch.storyPoints === "" || patch.storyPoints === null || patch.storyPoints === undefined ? null : Number(patch.storyPoints);
        if (spBefore !== spAfter) logFieldChange(id, "Story points", spBefore, spAfter, req.user.id);
      }
      updated.push(mapTicket(row));
    }
    broadcast("tickets_bulk_updated", { tickets: updated });
    ok(res, { updated, skipped });
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
      initiativeId = existing.initiative_id,
      customFields,
    } = req.body;
    const fields = customFields !== undefined
      ? (customFields && typeof customFields === "object" ? customFields : {})
      : (() => { try { return JSON.parse(existing.custom_fields || "{}"); } catch { return {}; } })();
    if (status !== existing.status) {
      if (!isTransitionAllowed(existing.project_id, type, existing.status, status))
        return err(res, `"${existing.status}" → "${status}" isn't an allowed transition for this project's workflow`, 400);
      const matchedTransition = findMatchingTransition(existing.project_id, type, existing.status, status);
      const ruleError = checkTransitionRule(matchedTransition, req.params.id, { versionId, assigneeId, storyPoints, dueDate, teamId, sprintId });
      if (ruleError) return err(res, ruleError, 400);
    }
    const info = db.prepare(`
      UPDATE tickets
      SET title=?, section=?, description=?, priority=?, status=?, position=?,
          external_ref=?, type=?, version=?, parent_id=?, assignee_id=?, team_id=?, start_date=?, due_date=?,
          test_notes=?, project_id=?, version_id=?, sprint_id=?, story_points=?, custom_fields=?, initiative_id=?
      WHERE id=?
    `).run(title, section, description, priority, status, position,
           externalRef || null, type, version, parentId || null, assigneeId || null, teamId || null,
           startDate || null, dueDate || null, testNotes || null, projectId || null, versionId || null, sprintId || null,
           storyPoints === "" || storyPoints === null || storyPoints === undefined ? null : Number(storyPoints),
           JSON.stringify(fields),
           initiativeId || null,
           req.params.id);
    if (info.changes === 0) return err(res, "Not found", 404);
    if (assigneeId && assigneeId !== existing.assignee_id) notifyAssignee(assigneeId, req.user.id, req.params.id, title);
    if (status !== existing.status) {
      logStatusChange(req.params.id, existing.status, status, req.user.id);
      notifyWatchers(req.params.id, req.user.id, `"${title}" moved from ${existing.status} to ${status}`);
    }
    if (title !== existing.title) logFieldChange(req.params.id, "Title", existing.title, title, req.user.id);
    if (priority !== existing.priority) logFieldChange(req.params.id, "Priority", existing.priority, priority, req.user.id);
    if (type !== existing.type) logFieldChange(req.params.id, "Type", existing.type, type, req.user.id);
    if ((dueDate || null) !== (existing.due_date || null)) logFieldChange(req.params.id, "Due date", existing.due_date, dueDate, req.user.id);
    if ((assigneeId || null) !== (existing.assignee_id || null))
      logFieldChange(req.params.id, "Assignee", resolveUserName(existing.assignee_id), resolveUserName(assigneeId), req.user.id);
    if ((teamId || null) !== (existing.team_id || null))
      logFieldChange(req.params.id, "Team", resolveTeamName(existing.team_id), resolveTeamName(teamId), req.user.id);
    if ((versionId || null) !== (existing.version_id || null))
      logFieldChange(req.params.id, "Version", resolveVersionName(existing.version_id), resolveVersionName(versionId), req.user.id);
    if ((sprintId || null) !== (existing.sprint_id || null))
      logFieldChange(req.params.id, "Sprint", resolveSprintName(existing.sprint_id), resolveSprintName(sprintId), req.user.id);
    if ((initiativeId || null) !== (existing.initiative_id || null))
      logFieldChange(req.params.id, "Initiative", resolveInitiativeName(existing.initiative_id), resolveInitiativeName(initiativeId), req.user.id);
    {
      const spBefore = existing.story_points ?? null;
      const spAfter  = storyPoints === "" || storyPoints === null || storyPoints === undefined ? null : Number(storyPoints);
      if (spBefore !== spAfter) logFieldChange(req.params.id, "Story points", spBefore, spAfter, req.user.id);
    }
    ok(res, mapTicket(db.prepare(`${TICKET_JOIN} WHERE t.id=?`).get(req.params.id)));
  });

  app.get("/api/tickets/:id/status-history", auth(), (req, res) => {
    const rows = db.prepare(`
      SELECT h.*, u.name AS changed_by_name FROM ticket_status_history h
      LEFT JOIN users u ON h.changed_by = u.id
      WHERE h.ticket_id=? ORDER BY h.changed_at ASC
    `).all(req.params.id);
    ok(res, rows.map(mapStatusHistory));
  });

  app.get("/api/tickets/:id/field-history", auth(), (req, res) => {
    const rows = db.prepare(`
      SELECT h.*, u.name AS changed_by_name FROM ticket_field_history h
      LEFT JOIN users u ON h.changed_by = u.id
      WHERE h.ticket_id=? ORDER BY h.changed_at ASC
    `).all(req.params.id);
    ok(res, rows.map(mapFieldHistory));
  });

  // ─── Watchers ─────────────────────────────────────────────────────────────

  app.get("/api/tickets/:id/watchers", auth(), (req, res) => {
    const rows = db.prepare(`
      SELECT w.*, u.name AS user_name FROM ticket_watchers w
      LEFT JOIN users u ON w.user_id = u.id
      WHERE w.ticket_id=? ORDER BY w.created_at ASC
    `).all(req.params.id);
    ok(res, rows.map(mapWatcher));
  });

  app.post("/api/tickets/:id/watch", auth(), (req, res) => {
    if (!db.prepare("SELECT id FROM tickets WHERE id=?").get(req.params.id)) return err(res, "Ticket not found", 404);
    db.prepare("INSERT OR IGNORE INTO ticket_watchers (id,ticket_id,user_id,created_at) VALUES (?,?,?,?)")
      .run(`WCH-${uid()}`, req.params.id, req.user.id, new Date().toISOString());
    ok(res, { watching: true });
  });

  app.delete("/api/tickets/:id/watch", auth(), (req, res) => {
    db.prepare("DELETE FROM ticket_watchers WHERE ticket_id=? AND user_id=?").run(req.params.id, req.user.id);
    ok(res, { watching: false });
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
    const ticket = db.prepare("SELECT id, title FROM tickets WHERE id=?").get(req.params.id);
    if (!ticket) return err(res, "Ticket not found", 404);
    const id  = `CMT-${uid()}`;
    const now = new Date().toISOString();
    db.prepare("INSERT INTO ticket_comments (id,ticket_id,author_id,body,created_at) VALUES (?,?,?,?,?)")
      .run(id, req.params.id, req.user.id, body.trim(), now);
    const comment = mapTicketComment(db.prepare(`${COMMENT_JOIN} WHERE c.id=?`).get(id));
    notifyMentions(body, req.user.id, req.params.id, ticket.title);
    notifyWatchers(req.params.id, req.user.id, `New comment on "${ticket.title}"`);
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

  // Dependency mapping (TKT-D01O9T) — every "Blocks" link where BOTH ends are
  // in the given id set (e.g. the Epics currently plotted on a Gantt view), in
  // one query instead of N+1 per-ticket fetches.
  app.get("/api/ticket-links/among", auth(), (req, res) => {
    const ids = (req.query.ids || "").split(",").map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) return ok(res, []);
    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(
      `SELECT * FROM ticket_links WHERE from_id IN (${placeholders}) AND to_id IN (${placeholders})`
    ).all(...ids, ...ids);
    ok(res, rows.map(mapTicketLink));
  });

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

  // Projects joined to their lead's name — used by every route that returns a
  // full project row so `mapKbProject`'s leadUserName is always populated.
  const PROJECT_SELECT = `SELECT p.*, lu.name AS lead_user_name FROM kb_projects p LEFT JOIN users lu ON p.lead_user_id = lu.id`;
  const getProjectRow = id => db.prepare(`${PROJECT_SELECT} WHERE p.id=?`).get(id);

  app.get("/api/kb/projects", auth(), (req, res) => {
    const ids = accessibleProjectIds(req.user);
    const rows = ids === null
      ? db.prepare(`${PROJECT_SELECT} ORDER BY p.created_at ASC`).all()
      : ids.length === 0 ? []
      : db.prepare(`${PROJECT_SELECT} WHERE p.id IN (${ids.map(() => "?").join(",")}) ORDER BY p.created_at ASC`).all(...ids);
    ok(res, rows.map(mapKbProject));
  });

  app.post("/api/kb/projects", write, (req, res) => {
    const { name, key = "", color = "#6366f1", description = "", leadUserId = null } = req.body || {};
    if (!name) return err(res, "name required");
    const id     = `PRJ-${uid()}`;
    const now    = new Date().toISOString();
    const keyVal = key.trim().toUpperCase() || name.slice(0, 4).toUpperCase();
    db.prepare("INSERT INTO kb_projects (id,name,key,color,description,created_at,lead_user_id) VALUES (?,?,?,?,?,?,?)")
      .run(id, name, keyVal, color, description, now, leadUserId || null);
    db.prepare("INSERT OR IGNORE INTO project_members (id,project_id,user_id,created_at) VALUES (?,?,?,?)")
      .run(`PM-${uid()}`, id, req.user.id, now);
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
    ok(res, mapKbProject(getProjectRow(id)), 201);
  });

  app.put("/api/kb/projects/:id", write, projectAccess, (req, res) => {
    const existing = db.prepare("SELECT * FROM kb_projects WHERE id=?").get(req.params.id);
    if (!existing) return err(res, "Not found", 404);
    const { name = existing.name, key = existing.key, color = existing.color, description = existing.description,
            leadUserId = existing.lead_user_id } = req.body || {};
    db.prepare("UPDATE kb_projects SET name=?,key=?,color=?,description=?,lead_user_id=? WHERE id=?")
      .run(name, key.toUpperCase(), color, description, leadUserId || null, req.params.id);
    ok(res, mapKbProject(getProjectRow(req.params.id)));
  });

  app.delete("/api/kb/projects/:id", write, projectAccess, (req, res) => {
    if (db.prepare("SELECT COUNT(*) AS n FROM kb_projects").get().n <= 1)
      return err(res, "Cannot delete the last project");
    db.prepare("DELETE FROM kb_projects WHERE id=?").run(req.params.id);
    db.prepare("DELETE FROM project_members WHERE project_id=?").run(req.params.id);
    ok(res, { deleted: req.params.id });
  });

  // ─── Project Members (access control MVP) ────────────────────────────────
  // Admin-only to manage — membership decides which projects a user can see at
  // all, so granting/revoking it is treated the same as the Users/Teams admin
  // screens rather than something any project member can do to another.

  app.get("/api/kb/projects/:id/members", manageMembers, (req, res) => {
    const rows = db.prepare(`
      SELECT m.*, u.name AS user_name, u.email AS user_email FROM project_members m
      LEFT JOIN users u ON m.user_id = u.id
      WHERE m.project_id=? ORDER BY u.name ASC
    `).all(req.params.id);
    ok(res, rows.map(mapProjectMember));
  });

  app.post("/api/kb/projects/:id/members", manageMembers, (req, res) => {
    const { userId } = req.body || {};
    if (!userId) return err(res, "userId required");
    if (!db.prepare("SELECT id FROM kb_projects WHERE id=?").get(req.params.id)) return err(res, "Project not found", 404);
    if (!db.prepare("SELECT id FROM users WHERE id=?").get(userId)) return err(res, "User not found", 404);
    db.prepare("INSERT OR IGNORE INTO project_members (id,project_id,user_id,created_at) VALUES (?,?,?,?)")
      .run(`PM-${uid()}`, req.params.id, userId, new Date().toISOString());
    ok(res, { added: userId }, 201);
  });

  app.delete("/api/kb/projects/:id/members/:userId", manageMembers, (req, res) => {
    db.prepare("DELETE FROM project_members WHERE project_id=? AND user_id=?").run(req.params.id, req.params.userId);
    ok(res, { removed: req.params.userId });
  });

  // ─── Versions ─────────────────────────────────────────────────────────────

  app.get("/api/kb/projects/:id/versions", auth(), projectAccess, (req, res) => {
    ok(res, db.prepare("SELECT * FROM kb_versions WHERE project_id=? ORDER BY created_at ASC").all(req.params.id).map(mapKbVersion));
  });

  app.post("/api/kb/projects/:id/versions", write, projectAccess, (req, res) => {
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

  // ─── Cross-project release milestones (TKT-5NQWK5) ────────────────────────
  // A milestone groups one version from each of several projects under a
  // shared target date, with a rolled-up completion percentage across all of
  // them — so "three teams all shipping against the same launch date" is one
  // thing to look at, not three separate version pages.

  const milestoneWithVersions = milestoneId => {
    const versionRows = db.prepare(`
      SELECT rmv.id AS link_id, kv.*, p.name AS project_name, p.key AS project_key
      FROM   release_milestone_versions rmv
      JOIN   kb_versions kv ON rmv.version_id = kv.id
      JOIN   kb_projects p  ON kv.project_id = p.id
      WHERE  rmv.milestone_id = ?
      ORDER  BY rmv.created_at ASC
    `).all(milestoneId);
    let grandDone = 0, grandTotal = 0;
    const versions = versionRows.map(v => {
      const doneSet = doneStatusesFor(v.project_id);
      const tix = db.prepare("SELECT status FROM tickets WHERE version_id=?").all(v.id);
      const done = tix.filter(t => doneSet.has(t.status)).length;
      grandDone += done; grandTotal += tix.length;
      return {
        linkId: v.link_id, id: v.id, name: v.name, status: v.status, releaseDate: v.release_date || null,
        projectId: v.project_id, projectName: v.project_name, projectKey: v.project_key,
        done, total: tix.length,
      };
    });
    return { versions, done: grandDone, total: grandTotal };
  };

  app.get("/api/release-milestones", auth(), (req, res) => {
    const rows = db.prepare("SELECT * FROM release_milestones ORDER BY (target_date IS NULL), target_date ASC, created_at ASC").all();
    ok(res, rows.map(r => ({ ...mapReleaseMilestone(r), ...milestoneWithVersions(r.id) })));
  });

  app.post("/api/release-milestones", write, (req, res) => {
    const { name, targetDate = null } = req.body || {};
    if (!name) return err(res, "name required");
    const id  = `MST-${uid()}`;
    const now = new Date().toISOString();
    db.prepare("INSERT INTO release_milestones (id,name,target_date,created_at) VALUES (?,?,?,?)")
      .run(id, name, targetDate || null, now);
    ok(res, { ...mapReleaseMilestone(db.prepare("SELECT * FROM release_milestones WHERE id=?").get(id)), versions: [], done: 0, total: 0 }, 201);
  });

  app.put("/api/release-milestones/:id", write, (req, res) => {
    const existing = db.prepare("SELECT * FROM release_milestones WHERE id=?").get(req.params.id);
    if (!existing) return err(res, "Not found", 404);
    const { name = existing.name, targetDate = existing.target_date } = req.body || {};
    db.prepare("UPDATE release_milestones SET name=?, target_date=? WHERE id=?").run(name, targetDate || null, req.params.id);
    ok(res, { ...mapReleaseMilestone(db.prepare("SELECT * FROM release_milestones WHERE id=?").get(req.params.id)), ...milestoneWithVersions(req.params.id) });
  });

  app.delete("/api/release-milestones/:id", write, (req, res) => {
    const info = db.prepare("DELETE FROM release_milestones WHERE id=?").run(req.params.id);
    if (info.changes === 0) return err(res, "Not found", 404);
    ok(res, { deleted: req.params.id });
  });

  app.post("/api/release-milestones/:id/versions", write, (req, res) => {
    if (!db.prepare("SELECT id FROM release_milestones WHERE id=?").get(req.params.id)) return err(res, "Milestone not found", 404);
    const { versionId } = req.body || {};
    if (!versionId) return err(res, "versionId required");
    if (!db.prepare("SELECT id FROM kb_versions WHERE id=?").get(versionId)) return err(res, "Version not found", 404);
    if (db.prepare("SELECT id FROM release_milestone_versions WHERE milestone_id=? AND version_id=?").get(req.params.id, versionId))
      return err(res, "That version is already on this milestone");
    db.prepare("INSERT INTO release_milestone_versions (id,milestone_id,version_id,created_at) VALUES (?,?,?,?)")
      .run(`RMV-${uid()}`, req.params.id, versionId, new Date().toISOString());
    ok(res, milestoneWithVersions(req.params.id), 201);
  });

  app.delete("/api/release-milestone-versions/:id", write, (req, res) => {
    const info = db.prepare("DELETE FROM release_milestone_versions WHERE id=?").run(req.params.id);
    if (info.changes === 0) return err(res, "Not found", 404);
    ok(res, { deleted: req.params.id });
  });

  // ─── Sprints & Burndown (TKT-GB8PGQ) ──────────────────────────────────────
  // No historical event log exists to derive a true burndown from, so the actual
  // line is built by snapshotting today's remaining points on every view (upsert
  // by date) — a real daily aggregate accumulates from normal usage instead of
  // requiring a background job. The ideal line is computed client-side from the
  // sprint's total points + start/end dates.

  app.get("/api/kb/projects/:id/sprints", auth(), projectAccess, (req, res) => {
    ok(res, db.prepare("SELECT * FROM kb_sprints WHERE project_id=? ORDER BY created_at ASC").all(req.params.id).map(mapSprint));
  });

  app.post("/api/kb/projects/:id/sprints", write, projectAccess, (req, res) => {
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
    const doneStatuses = doneStatusesFor(sprint.project_id);
    const totalPoints = tix.reduce((s, t) => s + (t.story_points || 0), 0);
    const remainingPoints = tix.filter(t => !doneStatuses.has(t.status)).reduce((s, t) => s + (t.story_points || 0), 0);
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO kb_sprint_snapshots (id, sprint_id, date, remaining_points, total_points, created_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(sprint_id, date) DO UPDATE SET remaining_points=excluded.remaining_points, total_points=excluded.total_points
    `).run(`SNP-${uid()}`, req.params.id, today, remainingPoints, totalPoints, new Date().toISOString());
    const snapshots = db.prepare("SELECT * FROM kb_sprint_snapshots WHERE sprint_id=? ORDER BY date ASC").all(req.params.id).map(mapSprintSnapshot);
    ok(res, { sprint: mapSprint(sprint), totalPoints, remainingPoints, ticketCount: tix.length, snapshots });
  });

  // ─── Project Reports ──────────────────────────────────────────────────────
  // Read-only aggregate views over a project's tickets, computed in JS from data
  // already logged (ticket_status_history, ticket_comments) rather than SQL window
  // functions/CTEs — node:sqlite is synchronous/in-process so there's no round-trip
  // cost to amortize by pushing the work into SQL.

  const median = arr => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const average = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  app.get("/api/kb/projects/:id/needs-attention", auth(), projectAccess, (req, res) => {
    const staleDays = Math.max(1, Number(req.query.staleDays) || 14);
    const tickets = db.prepare(`${TICKET_JOIN} WHERE t.project_id=?`).all(req.params.id).map(mapTicket);
    const doneStatuses = doneStatusesFor(req.params.id);
    const openTickets = tickets.filter(t => !doneStatuses.has(t.status));
    const ids = openTickets.map(t => t.id);
    const lastActivity = new Map();
    if (ids.length) {
      db.prepare(`SELECT ticket_id, MAX(changed_at) AS last FROM ticket_status_history WHERE ticket_id IN (${ids.map(() => "?").join(",")}) GROUP BY ticket_id`)
        .all(...ids).forEach(r => lastActivity.set(r.ticket_id, r.last));
    }
    const today  = new Date().toISOString().slice(0, 10);
    const staleMs = staleDays * 86400000;
    const now = Date.now();
    const unassigned = openTickets.filter(t => !t.assigneeId);
    const overdue     = openTickets.filter(t => t.dueDate && t.dueDate < today);
    const stale = openTickets
      .map(t => ({ ...t, lastActivityAt: lastActivity.get(t.id) || t.createdAt }))
      .filter(t => now - new Date(t.lastActivityAt).getTime() > staleMs);
    ok(res, { unassigned, overdue, stale, staleDays });
  });

  app.get("/api/kb/projects/:id/activity", auth(), projectAccess, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 300);
    const ticketRows = db.prepare("SELECT id, title FROM tickets WHERE project_id=?").all(req.params.id);
    const titleById = new Map(ticketRows.map(t => [t.id, t.title]));
    const ids = [...titleById.keys()];
    if (ids.length === 0) return ok(res, { items: [] });
    const placeholders = ids.map(() => "?").join(",");
    const statusRows = db.prepare(`
      SELECT h.id, h.ticket_id, h.from_status, h.to_status, h.changed_at, u.name AS user_name
      FROM ticket_status_history h LEFT JOIN users u ON h.changed_by = u.id
      WHERE h.ticket_id IN (${placeholders})
    `).all(...ids);
    const commentRows = db.prepare(`
      SELECT c.id, c.ticket_id, c.body, c.created_at, u.name AS user_name
      FROM ticket_comments c LEFT JOIN users u ON c.author_id = u.id
      WHERE c.ticket_id IN (${placeholders})
    `).all(...ids);
    const items = [
      ...statusRows.map(r => ({
        id: r.id, kind: "status", ticketId: r.ticket_id, ticketTitle: titleById.get(r.ticket_id) || "(deleted)",
        userName: r.user_name || "Unknown", at: r.changed_at, fromStatus: r.from_status, toStatus: r.to_status,
      })),
      ...commentRows.map(r => ({
        id: r.id, kind: "comment", ticketId: r.ticket_id, ticketTitle: titleById.get(r.ticket_id) || "(deleted)",
        userName: r.user_name || "Unknown", at: r.created_at, body: r.body,
      })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, limit);
    ok(res, { items });
  });

  app.get("/api/kb/projects/:id/cumulative-flow", auth(), projectAccess, (req, res) => {
    const tickets = db.prepare("SELECT id, status, created_at FROM tickets WHERE project_id=?").all(req.params.id);
    const statuses = db.prepare("SELECT name FROM kb_columns WHERE project_id=? ORDER BY position ASC").all(req.params.id).map(c => c.name);
    if (tickets.length === 0) return ok(res, { days: [], statuses, approximatedTicketCount: 0, totalTicketCount: 0 });

    const ids = tickets.map(t => t.id);
    const placeholders = ids.map(() => "?").join(",");
    const historyRows = db.prepare(`
      SELECT ticket_id, to_status, changed_at FROM ticket_status_history
      WHERE ticket_id IN (${placeholders}) ORDER BY ticket_id ASC, changed_at ASC
    `).all(...ids);

    const historyByTicket = new Map();
    let earliestChange = null;
    for (const row of historyRows) {
      if (!historyByTicket.has(row.ticket_id)) historyByTicket.set(row.ticket_id, []);
      historyByTicket.get(row.ticket_id).push(row);
      if (earliestChange === null || row.changed_at < earliestChange) earliestChange = row.changed_at;
    }
    const approximatedTicketCount = tickets.filter(t => !historyByTicket.has(t.id)).length;

    // Clip the range to the earliest changed_at actually recorded — a blind
    // 30/60/90-day default would open on a flat, wrong pre-history plateau for
    // however long the table predates the requested window.
    const requestedDays = Math.max(1, Math.min(Number(req.query.days) || 30, 180));
    const requestedStart = new Date();
    requestedStart.setHours(0, 0, 0, 0);
    requestedStart.setDate(requestedStart.getDate() - (requestedDays - 1));
    let startDate = requestedStart;
    if (earliestChange) {
      const earliestDate = new Date(earliestChange.slice(0, 10) + "T00:00:00");
      if (earliestDate > startDate) startDate = earliestDate;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dayList = [];
    for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) dayList.push(new Date(d));

    // Single forward sweep: one pointer per ticket, advanced across the sorted
    // day range rather than rescanning each ticket's full history per day.
    const pointers = new Map();
    for (const id of historyByTicket.keys()) pointers.set(id, 0);
    const currentStatusForTicket = new Map();

    const days = dayList.map(day => {
      const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999);
      const dayEndIso = dayEnd.toISOString();
      const counts = {};
      for (const s of statuses) counts[s] = 0;

      for (const t of tickets) {
        if (new Date(t.created_at) > dayEnd) continue; // not created yet as of this day

        if (historyByTicket.has(t.id)) {
          const hist = historyByTicket.get(t.id);
          let ptr = pointers.get(t.id);
          while (ptr < hist.length && hist[ptr].changed_at <= dayEndIso) {
            currentStatusForTicket.set(t.id, hist[ptr].to_status);
            ptr++;
          }
          pointers.set(t.id, ptr);
        } else if (!currentStatusForTicket.has(t.id)) {
          // No history at all (ticket predates the table) — disclosed
          // approximation: seed at its current status for every day in range.
          currentStatusForTicket.set(t.id, t.status);
        }

        const status = currentStatusForTicket.get(t.id);
        if (status != null) counts[status] = (counts[status] || 0) + 1;
      }

      return { date: day.toISOString().slice(0, 10), counts };
    });

    ok(res, { days, statuses, approximatedTicketCount, totalTicketCount: tickets.length });
  });

  app.get("/api/kb/projects/:id/cycle-time", auth(), projectAccess, (req, res) => {
    const tickets = db.prepare("SELECT id, status, created_at FROM tickets WHERE project_id=?").all(req.params.id);
    if (tickets.length === 0)
      return ok(res, { byStatus: [], overallCycleTimeAvgMs: null, overallCycleTimeMedianMs: null, ticketsReachedDone: 0, ticketsWithHistory: 0, totalTickets: 0 });

    const doneStatuses = doneStatusesFor(req.params.id);
    const ids = tickets.map(t => t.id);
    const placeholders = ids.map(() => "?").join(",");
    const historyRows = db.prepare(`
      SELECT ticket_id, to_status, changed_at FROM ticket_status_history
      WHERE ticket_id IN (${placeholders}) ORDER BY ticket_id ASC, changed_at ASC
    `).all(...ids);

    const historyByTicket = new Map();
    for (const row of historyRows) {
      if (!historyByTicket.has(row.ticket_id)) historyByTicket.set(row.ticket_id, []);
      historyByTicket.get(row.ticket_id).push(row);
    }

    const now = Date.now();
    const durationsByStatus = new Map();
    const addDuration = (status, ms) => {
      if (!durationsByStatus.has(status)) durationsByStatus.set(status, []);
      durationsByStatus.get(status).push(ms);
    };

    const cycleTimes = [];
    let ticketsWithHistory = 0;

    for (const t of tickets) {
      const hist = historyByTicket.get(t.id);
      if (!hist || hist.length === 0) continue;
      ticketsWithHistory++;

      for (let i = 0; i < hist.length; i++) {
        const row = hist[i];
        const startMs = new Date(row.changed_at).getTime();
        const next = hist[i + 1];
        // Gap to the next transition is time spent in this row's to_status; for
        // the most recent row, count elapsed time since then as "ongoing" only
        // if the ticket's current status still matches (it should, always).
        const endMs = next ? new Date(next.changed_at).getTime() : (t.status === row.to_status ? now : null);
        if (endMs !== null) addDuration(row.to_status, endMs - startMs);
      }

      // Overall cycle time uses the ticket's FIRST-EVER entry into a done status,
      // not the latest — otherwise a reopened-then-redone ticket is undercounted.
      const firstDone = hist.find(r => doneStatuses.has(r.to_status));
      if (firstDone) cycleTimes.push(new Date(firstDone.changed_at).getTime() - new Date(t.created_at).getTime());
    }

    const byStatus = [...durationsByStatus.entries()].map(([status, arr]) => ({
      status, count: arr.length, avgMs: average(arr), medianMs: median(arr),
    }));

    ok(res, {
      byStatus,
      overallCycleTimeAvgMs: average(cycleTimes),
      overallCycleTimeMedianMs: median(cycleTimes),
      ticketsReachedDone: cycleTimes.length,
      ticketsWithHistory,
      totalTickets: tickets.length,
    });
  });

  app.get("/api/kb/projects/:id/velocity", auth(), projectAccess, (req, res) => {
    const sprints = db.prepare("SELECT * FROM kb_sprints WHERE project_id=? ORDER BY created_at ASC").all(req.params.id);
    const doneStatuses = doneStatusesFor(req.params.id);
    const sprintStats = sprints.map(s => {
      const tix = db.prepare("SELECT status, story_points FROM tickets WHERE sprint_id=?").all(s.id);
      const totalPoints     = tix.reduce((sum, t) => sum + (t.story_points || 0), 0);
      const completedPoints = tix.filter(t => doneStatuses.has(t.status)).reduce((sum, t) => sum + (t.story_points || 0), 0);
      return { sprintId: s.id, sprintName: s.name, status: s.status, totalPoints, completedPoints, ticketCount: tix.length };
    });
    ok(res, { sprints: sprintStats });
  });

  // ─── Columns ──────────────────────────────────────────────────────────────

  app.get("/api/kb/projects/:id/columns", auth(), projectAccess, (req, res) => {
    ok(res, db.prepare("SELECT * FROM kb_columns WHERE project_id=? ORDER BY position ASC").all(req.params.id).map(mapKbColumn));
  });

  app.post("/api/kb/projects/:id/columns", write, projectAccess, (req, res) => {
    if (!db.prepare("SELECT id FROM kb_projects WHERE id=?").get(req.params.id)) return err(res, "Project not found", 404);
    const { name, color = "#6366f1", wipLimit = null, category = "In Progress" } = req.body || {};
    if (!name) return err(res, "name required");
    const maxPos = db.prepare("SELECT MAX(position) AS m FROM kb_columns WHERE project_id=?").get(req.params.id)?.m ?? -1;
    const id     = `COL-${uid()}`;
    db.prepare("INSERT INTO kb_columns (id,project_id,name,position,color,wip_limit,category,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, req.params.id, name, maxPos + 1, color, wipLimit, category, new Date().toISOString());
    ok(res, mapKbColumn(db.prepare("SELECT * FROM kb_columns WHERE id=?").get(id)), 201);
  });

  app.put("/api/kb/columns/:id", write, (req, res) => {
    const existing = db.prepare("SELECT * FROM kb_columns WHERE id=?").get(req.params.id);
    if (!existing) return err(res, "Not found", 404);
    const { name = existing.name, color = existing.color, position = existing.position, wipLimit = existing.wip_limit,
            category = existing.category, diagramX = existing.diagram_x, diagramY = existing.diagram_y } = req.body || {};
    db.prepare("UPDATE kb_columns SET name=?,color=?,position=?,wip_limit=?,category=?,diagram_x=?,diagram_y=? WHERE id=?")
      .run(name, color, position, wipLimit ?? null, category || "In Progress", diagramX ?? null, diagramY ?? null, req.params.id);
    ok(res, mapKbColumn(db.prepare("SELECT * FROM kb_columns WHERE id=?").get(req.params.id)));
  });

  app.patch("/api/kb/projects/:id/columns", write, projectAccess, (req, res) => {
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
    db.prepare("DELETE FROM workflow_transitions WHERE project_id=? AND (from_status=? OR to_status=?)")
      .run(existing.project_id, existing.name, existing.name);
    db.prepare(`DELETE FROM board_statuses WHERE status=? AND board_id IN (SELECT id FROM boards WHERE project_id=?)`)
      .run(existing.name, existing.project_id);
    ok(res, { deleted: req.params.id });
  });

  // ─── Workflow transitions (TKT-188OHK) ────────────────────────────────────
  // A transition is a named action (e.g. "Start Analysis") connecting one status
  // to another. from_status = null means the wildcard "Any" — reachable from
  // every status without enumerating each source. A project with zero rows here
  // has no configured workflow yet, so isTransitionAllowed() above stays
  // permissive until an admin defines at least one.

  app.get("/api/kb/projects/:id/transitions", auth(), projectAccess, (req, res) => {
    ok(res, db.prepare("SELECT * FROM workflow_transitions WHERE project_id=? ORDER BY created_at ASC").all(req.params.id).map(mapWorkflowTransition));
  });

  const RULE_TYPES = ["require_link", "require_field"];

  app.post("/api/kb/projects/:id/transitions", write, projectAccess, (req, res) => {
    if (!db.prepare("SELECT id FROM kb_projects WHERE id=?").get(req.params.id)) return err(res, "Project not found", 404);
    const { name, fromStatus = null, toStatus, ticketType = null, ruleType = null, ruleConfig = null } = req.body || {};
    if (!name) return err(res, "name required");
    if (!toStatus) return err(res, "toStatus required");
    if (ruleType && !RULE_TYPES.includes(ruleType)) return err(res, `ruleType must be one of: ${RULE_TYPES.join(", ")}`);
    const id = `WFT-${uid()}`;
    db.prepare("INSERT INTO workflow_transitions (id,project_id,ticket_type,name,from_status,to_status,rule_type,rule_config,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id, req.params.id, ticketType || null, name, fromStatus || null, toStatus,
           ruleType || null, ruleType ? JSON.stringify(ruleConfig || {}) : null, new Date().toISOString());
    ok(res, mapWorkflowTransition(db.prepare("SELECT * FROM workflow_transitions WHERE id=?").get(id)), 201);
  });

  app.put("/api/kb/transitions/:id", write, (req, res) => {
    const existing = db.prepare("SELECT * FROM workflow_transitions WHERE id=?").get(req.params.id);
    if (!existing) return err(res, "Not found", 404);
    const {
      name = existing.name, fromStatus = existing.from_status, toStatus = existing.to_status, ticketType = existing.ticket_type,
      ruleType = existing.rule_type, ruleConfig = (() => { try { return JSON.parse(existing.rule_config || "{}"); } catch { return {}; } })(),
    } = req.body || {};
    if (ruleType && !RULE_TYPES.includes(ruleType)) return err(res, `ruleType must be one of: ${RULE_TYPES.join(", ")}`);
    db.prepare("UPDATE workflow_transitions SET name=?,from_status=?,to_status=?,ticket_type=?,rule_type=?,rule_config=? WHERE id=?")
      .run(name, fromStatus || null, toStatus, ticketType || null,
           ruleType || null, ruleType ? JSON.stringify(ruleConfig || {}) : null, req.params.id);
    ok(res, mapWorkflowTransition(db.prepare("SELECT * FROM workflow_transitions WHERE id=?").get(req.params.id)));
  });

  app.delete("/api/kb/transitions/:id", write, (req, res) => {
    const info = db.prepare("DELETE FROM workflow_transitions WHERE id=?").run(req.params.id);
    if (info.changes === 0) return err(res, "Not found", 404);
    ok(res, { deleted: req.params.id });
  });

  // ─── Boards (TKT-G3AY4J) ───────────────────────────────────────────────────
  // A board is a filtered, admin-configurable VIEW over a subset of a project's
  // shared statuses — not a separate workflow. Ticket status stays project-wide;
  // a ticket simply appears on whichever board(s) currently include its status.

  app.get("/api/kb/projects/:id/boards", auth(), projectAccess, (req, res) => {
    ok(res, db.prepare("SELECT * FROM boards WHERE project_id=? ORDER BY created_at ASC").all(req.params.id).map(mapBoard));
  });

  app.post("/api/kb/projects/:id/boards", write, projectAccess, (req, res) => {
    if (!db.prepare("SELECT id FROM kb_projects WHERE id=?").get(req.params.id)) return err(res, "Project not found", 404);
    const { name } = req.body || {};
    if (!name) return err(res, "name required");
    const id = `BRD-${uid()}`;
    db.prepare("INSERT INTO boards (id,project_id,name,created_at) VALUES (?,?,?,?)")
      .run(id, req.params.id, name, new Date().toISOString());
    ok(res, mapBoard(db.prepare("SELECT * FROM boards WHERE id=?").get(id)), 201);
  });

  app.put("/api/kb/boards/:id", write, (req, res) => {
    const existing = db.prepare("SELECT * FROM boards WHERE id=?").get(req.params.id);
    if (!existing) return err(res, "Not found", 404);
    const { name = existing.name } = req.body || {};
    db.prepare("UPDATE boards SET name=? WHERE id=?").run(name, req.params.id);
    ok(res, mapBoard(db.prepare("SELECT * FROM boards WHERE id=?").get(req.params.id)));
  });

  app.delete("/api/kb/boards/:id", write, (req, res) => {
    const existing = db.prepare("SELECT * FROM boards WHERE id=?").get(req.params.id);
    if (!existing) return err(res, "Not found", 404);
    if (db.prepare("SELECT COUNT(*) AS n FROM boards WHERE project_id=?").get(existing.project_id).n <= 1)
      return err(res, "Cannot delete the last board");
    db.prepare("DELETE FROM boards WHERE id=?").run(req.params.id);
    ok(res, { deleted: req.params.id });
  });

  app.get("/api/kb/boards/:id/statuses", auth(), (req, res) => {
    ok(res, db.prepare("SELECT * FROM board_statuses WHERE board_id=? ORDER BY position ASC").all(req.params.id).map(mapBoardStatus));
  });

  app.put("/api/kb/boards/:id/statuses", write, (req, res) => {
    const board = db.prepare("SELECT * FROM boards WHERE id=?").get(req.params.id);
    if (!board) return err(res, "Not found", 404);
    const { statuses = [] } = req.body || {};
    if (!Array.isArray(statuses)) return err(res, "statuses array required");

    const projectStatusNames = db.prepare("SELECT name FROM kb_columns WHERE project_id=?").all(board.project_id).map(r => r.name);
    const unknown = statuses.filter(s => !projectStatusNames.includes(s));
    if (unknown.length > 0) return err(res, `Unknown status for this project: ${unknown.join(", ")}`);

    // Tie board membership to the shared workflow graph (TKT-188OHK) — a status
    // with zero transitions in or out is an unreachable dead end a board should
    // never include. Skipped when the project has no workflow defined yet,
    // matching isTransitionAllowed's own backward-compatible permissiveness.
    const hasWorkflow = db.prepare("SELECT COUNT(*) AS n FROM workflow_transitions WHERE project_id=?").get(board.project_id).n > 0;
    if (hasWorkflow) {
      const connected = new Set();
      for (const t of db.prepare("SELECT from_status, to_status FROM workflow_transitions WHERE project_id=?").all(board.project_id)) {
        if (t.from_status) connected.add(t.from_status);
        connected.add(t.to_status);
      }
      const orphans = statuses.filter(s => !connected.has(s));
      if (orphans.length > 0)
        return err(res, `These statuses have no transitions in the workflow yet, so a board can't include them: ${orphans.join(", ")}`);
    }

    db.prepare("DELETE FROM board_statuses WHERE board_id=?").run(req.params.id);
    const insert = db.prepare("INSERT INTO board_statuses (id,board_id,status,position,created_at) VALUES (?,?,?,?,?)");
    const now = new Date().toISOString();
    statuses.forEach((s, i) => insert.run(`BST-${uid()}`, req.params.id, s, i, now));
    ok(res, db.prepare("SELECT * FROM board_statuses WHERE board_id=? ORDER BY position ASC").all(req.params.id).map(mapBoardStatus));
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
