"use strict";
const express = require("express");
const http    = require("http");
const path    = require("path");
const fs      = require("fs");
const { WebSocketServer } = require("ws");
const { DatabaseSync }    = require("node:sqlite");
const bcrypt = require("bcryptjs");
const jwt    = require("jsonwebtoken");
const crypto = require("crypto");

const PORT       = process.env.PORT       || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "athena-dev-secret-do-not-use-in-prod";
if (!process.env.JWT_SECRET)
  console.warn("⚠  JWT_SECRET not set — using insecure dev default. Set it before deploying.");

const app    = express();
const server = http.createServer(app);
const db     = new DatabaseSync(path.join(__dirname, "athena.db"));

app.use(express.json({ limit: "10mb" }));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const ok  = (res, data, status = 200) => res.status(status).json(data);
const err = (res, msg, status = 400) => res.status(status).json({ error: msg });
const isUniqueViolation = e => e?.message?.includes("UNIQUE constraint");

// ─── Schema ───────────────────────────────────────────────────────────────────

db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'viewer',
    roles         TEXT DEFAULT NULL,
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    last_login    TEXT,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until    TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    section      TEXT DEFAULT '',
    description  TEXT DEFAULT '',
    priority     TEXT DEFAULT 'Medium',
    status       TEXT DEFAULT 'Ready',
    position     INTEGER DEFAULT 0,
    created_at   TEXT NOT NULL,
    external_ref TEXT DEFAULT NULL,
    type         TEXT DEFAULT 'Task',
    version      TEXT DEFAULT '',
    parent_id    TEXT DEFAULT NULL,
    assignee_id  TEXT DEFAULT NULL,
    due_date     TEXT DEFAULT NULL,
    test_notes   TEXT DEFAULT NULL,
    project_id   TEXT DEFAULT NULL,
    version_id   TEXT DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS ticket_links (
    id         TEXT PRIMARY KEY,
    from_id    TEXT NOT NULL,
    to_id      TEXT NOT NULL,
    link_type  TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS kb_projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    key         TEXT NOT NULL,
    color       TEXT DEFAULT '#6366f1',
    description TEXT DEFAULT '',
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS kb_versions (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES kb_projects(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    description  TEXT DEFAULT '',
    status       TEXT DEFAULT 'Planning',
    release_date TEXT DEFAULT NULL,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS kb_columns (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES kb_projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    color      TEXT DEFAULT '#6366f1',
    wip_limit  INTEGER DEFAULT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS test_items (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL,
    title        TEXT NOT NULL,
    description  TEXT DEFAULT '',
    priority     TEXT DEFAULT 'Medium',
    status       TEXT DEFAULT 'Ready',
    position     INTEGER DEFAULT 0,
    created_at   TEXT NOT NULL,
    parent_id    TEXT DEFAULT NULL,
    assignee_id  TEXT DEFAULT NULL,
    due_date     TEXT DEFAULT NULL,
    test_notes   TEXT DEFAULT NULL,
    project_id   TEXT DEFAULT NULL,
    version_id   TEXT DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS test_case_links (
    id         TEXT PRIMARY KEY,
    case_id    TEXT NOT NULL,
    ticket_id  TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ticket_comments (
    id         TEXT PRIMARY KEY,
    ticket_id  TEXT NOT NULL,
    author_id  TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ticket_attachments (
    id          TEXT PRIMARY KEY,
    ticket_id   TEXT NOT NULL,
    filename    TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type   TEXT NOT NULL DEFAULT '',
    size_bytes  INTEGER NOT NULL DEFAULT 0,
    uploaded_by TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ticket_labels (
    id         TEXT PRIMARY KEY,
    ticket_id  TEXT NOT NULL,
    label      TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS teams (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    color      TEXT DEFAULT '#6366f1',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS kb_sprints (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES kb_projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    start_date TEXT DEFAULT NULL,
    end_date   TEXT DEFAULT NULL,
    status     TEXT NOT NULL DEFAULT 'Planning',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS kb_sprint_snapshots (
    id               TEXT PRIMARY KEY,
    sprint_id        TEXT NOT NULL REFERENCES kb_sprints(id) ON DELETE CASCADE,
    date             TEXT NOT NULL,
    remaining_points INTEGER NOT NULL DEFAULT 0,
    total_points     INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    UNIQUE(sprint_id, date)
  );

  CREATE TABLE IF NOT EXISTS saved_filters (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    name        TEXT NOT NULL,
    entity_type TEXT NOT NULL DEFAULT 'ticket',
    query       TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS test_case_data_rows (
    id         TEXT PRIMARY KEY,
    case_id    TEXT NOT NULL,
    row_data   TEXT NOT NULL DEFAULT '{}',
    status     TEXT NOT NULL DEFAULT 'Ready',
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    type       TEXT NOT NULL,
    message    TEXT NOT NULL,
    ticket_id  TEXT DEFAULT NULL,
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dashboard_widgets (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    widget_type TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    config     TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS work_logs (
    id         TEXT PRIMARY KEY,
    ticket_id  TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    minutes    INTEGER NOT NULL,
    logged_at  TEXT NOT NULL,
    note       TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS baselines (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_by  TEXT DEFAULT '',
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS baseline_tickets (
    id          TEXT PRIMARY KEY,
    baseline_id TEXT NOT NULL REFERENCES baselines(id) ON DELETE CASCADE,
    ticket_id   TEXT NOT NULL,
    title       TEXT NOT NULL,
    type        TEXT NOT NULL,
    status      TEXT NOT NULL,
    priority    TEXT NOT NULL,
    story_points INTEGER DEFAULT NULL,
    assignee_name TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS team_members (
    id         TEXT PRIMARY KEY,
    team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    UNIQUE(team_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Azure AD SSO — seeded once via INSERT OR IGNORE so a saved value is never clobbered.
for (const [k, v] of [
  ["sso_enabled", "0"], ["sso_tenant_id", ""], ["sso_client_id", ""],
  ["sso_client_secret", ""], ["sso_redirect_uri", ""],
  ["sso_default_role", "operator"], ["sso_frontend_url", "http://localhost:5173"],
]) db.prepare("INSERT OR IGNORE INTO app_settings (key,value) VALUES (?,?)").run(k, v);

// Delivery estimation (Monte Carlo) — admin-calibrated days-per-story-point, since no
// historical per-stage timing data exists yet to derive these from (see routes/estimation.js).
for (const [k, v] of [
  ["est_integration_opt", "0.5"], ["est_integration_likely", "1"],   ["est_integration_pess", "3"],
  ["est_testing_opt",     "0.5"], ["est_testing_likely",     "1.5"], ["est_testing_pess",     "3"],
  ["est_patching_opt",    "0.25"],["est_patching_likely",    "1"],   ["est_patching_pess",    "2"],
  ["est_release_opt",     "0.25"],["est_release_likely",     "0.5"], ["est_release_pess",     "1.5"],
]) db.prepare("INSERT OR IGNORE INTO app_settings (key,value) VALUES (?,?)").run(k, v);

// ─── Incremental migrations (existing DBs — CREATE TABLE IF NOT EXISTS above only helps fresh ones) ──
try { db.exec("ALTER TABLE tickets ADD COLUMN story_points INTEGER DEFAULT NULL"); } catch {}
try { db.exec("ALTER TABLE tickets ADD COLUMN custom_fields TEXT DEFAULT '{}'"); } catch {}
// Teams (TKT-4N18SL): a ticket — primarily an Epic — can carry a team_id alongside the
// existing assignee_id, so ownership can be assigned to a group rather than one person.
try { db.exec("ALTER TABLE tickets ADD COLUMN team_id TEXT DEFAULT NULL"); } catch {}
// Roadmap Gantt mode (TKT-AGH5M7): start_date pairs with the existing due_date to
// let RoadmapView plot Epics as date-axis bars instead of only progress swimlanes.
try { db.exec("ALTER TABLE tickets ADD COLUMN start_date TEXT DEFAULT NULL"); } catch {}
// Sprints (TKT-GB8PGQ) — story_points already exists; sprint_id is the missing piece.
try { db.exec("ALTER TABLE tickets ADD COLUMN sprint_id TEXT DEFAULT NULL"); } catch {}
// Approval workflows (TKT-S5RZ6D) — generic, applies to any ticket type.
try { db.exec("ALTER TABLE tickets ADD COLUMN approval_status TEXT DEFAULT NULL"); } catch {}
try { db.exec("ALTER TABLE tickets ADD COLUMN approved_by TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE tickets ADD COLUMN approved_at TEXT DEFAULT NULL"); } catch {}

// ─── One-time migration: move test artifacts out of tickets into test_items ────
{
  const testTypes = ["Test Folder", "Test Plan", "Test Run", "Test Case"];
  const placeholders = testTypes.map(() => "?").join(",");
  const rows = db.prepare(`SELECT * FROM tickets WHERE type IN (${placeholders})`).all(...testTypes);

  if (rows.length > 0) {
    const migratedIds = new Set(rows.map(r => r.id));
    db.exec("BEGIN");
    try {
      const insertTestItem = db.prepare(`
        INSERT INTO test_items
          (id, type, title, description, priority, status, position, created_at,
           parent_id, assignee_id, due_date, test_notes, project_id, version_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      let severedParents = 0;
      for (const r of rows) {
        const parentId = r.parent_id && migratedIds.has(r.parent_id) ? r.parent_id : null;
        if (r.parent_id && !parentId) severedParents++;
        insertTestItem.run(
          r.id, r.type, r.title, r.description, r.priority, r.status, r.position, r.created_at,
          parentId, r.assignee_id, r.due_date, r.test_notes, r.project_id, r.version_id
        );
      }

      const idPlaceholders = rows.map(() => "?").join(",");
      const linkRows = db.prepare(`
        SELECT id FROM ticket_links WHERE from_id IN (${idPlaceholders}) OR to_id IN (${idPlaceholders})
      `).all(...rows.map(r => r.id), ...rows.map(r => r.id));
      const deleteLink = db.prepare("DELETE FROM ticket_links WHERE id=?");
      for (const l of linkRows) deleteLink.run(l.id);

      const deleteTicket = db.prepare("DELETE FROM tickets WHERE id=?");
      for (const r of rows) deleteTicket.run(r.id);

      db.exec("COMMIT");
      console.log(`  ✔ Migrated ${rows.length} test artifact(s) to test_items` +
        (severedParents ? `; severed ${severedParents} dangling parent link(s)` : "") +
        (linkRows.length ? `; dropped ${linkRows.length} stale ticket_link(s)` : ""));
    } catch (e) {
      db.exec("ROLLBACK");
      console.error("  ✘ test_items migration failed, rolled back:", e.message);
    }
  }
}

// ─── Migrations ───────────────────────────────────────────────────────────────
// Safe try/catch — each runs once; subsequent startups no-op on "duplicate column".
for (const m of [
  "ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN locked_until TEXT NOT NULL DEFAULT ''",
]) {
  try { db.exec(m); } catch {}
}

// ─── Auth middleware ───────────────────────────────────────────────────────────

const VALID_ROLES = ["admin", "operator", "viewer"];

const parseUserRoles = r =>
  Array.isArray(r.roles) ? r.roles :
  (r.roles ? JSON.parse(r.roles) : [r.role || "viewer"]);

const primaryRoleSV = roles => {
  const rank = { admin: 2, operator: 1, viewer: 0 };
  return [...roles].sort((a, b) => (rank[b] ?? -1) - (rank[a] ?? -1))[0];
};

function auth() {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token  = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return err(res, "Unauthorised", 401);
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch {
      err(res, "Token invalid or expired", 401);
    }
  };
}

function requireRole(roles) {
  return (req, res, next) => {
    auth()(req, res, () => {
      const userRoles = Array.isArray(req.user.roles) ? req.user.roles : [req.user.role];
      if (roles.some(r => userRoles.includes(r))) return next();
      err(res, "Forbidden", 403);
    });
  };
}

// Global auth guard — exempt /api/auth/* and /api/health
app.use("/api", (req, res, next) =>
  req.path.startsWith("/auth/") || req.path === "/health" ? next() : auth()(req, res, next)
);

// ─── Mappers ──────────────────────────────────────────────────────────────────

const mapTicket = r => ({
  id:              r.id,
  title:           r.title,
  section:         r.section         || "",
  description:     r.description     || "",
  priority:        r.priority        || "Medium",
  status:          r.status          || "Ready",
  position:        r.position        ?? 0,
  createdAt:       r.created_at,
  externalRef:     r.external_ref    || null,
  type:            r.type            || "Task",
  version:         r.version         || "",
  parentId:        r.parent_id       || null,
  assigneeId:      r.assignee_id     || null,
  assigneeName:    r.assignee_name   || null,
  assigneeInitial: r.assignee_name   ? r.assignee_name.trim()[0].toUpperCase() : null,
  teamId:          r.team_id         || null,
  teamName:        r.team_name       || null,
  startDate:       r.start_date      || null,
  dueDate:         r.due_date        || null,
  testNotes:       r.test_notes      || null,
  projectId:       r.project_id      || null,
  versionId:       r.version_id      || null,
  sprintId:        r.sprint_id       || null,
  sprintName:      r.sprint_name     || null,
  storyPoints:     r.story_points    ?? null,
  approvalStatus:  r.approval_status || null,
  approvedBy:      r.approved_by     || "",
  approvedAt:      r.approved_at     || null,
  customFields:    (() => { try { return JSON.parse(r.custom_fields || "{}"); } catch { return {}; } })(),
});

const mapTicketLink = r => ({ id: r.id, fromId: r.from_id, toId: r.to_id, linkType: r.link_type, createdAt: r.created_at });

const mapTestItem = r => ({
  id:              r.id,
  type:            r.type,
  title:           r.title,
  description:     r.description     || "",
  priority:        r.priority        || "Medium",
  status:          r.status          || "Ready",
  position:        r.position        ?? 0,
  createdAt:       r.created_at,
  parentId:        r.parent_id       || null,
  assigneeId:      r.assignee_id     || null,
  assigneeName:    r.assignee_name   || null,
  assigneeInitial: r.assignee_name   ? r.assignee_name.trim()[0].toUpperCase() : null,
  dueDate:         r.due_date        || null,
  testNotes:       r.test_notes      || null,
  projectId:       r.project_id      || null,
  versionId:       r.version_id      || null,
});
const mapTestCaseLink = r => ({ id: r.id, caseId: r.case_id, ticketId: r.ticket_id, createdAt: r.created_at });

const mapTicketComment = r => ({
  id: r.id, ticketId: r.ticket_id, authorId: r.author_id,
  authorName: r.author_name || null, body: r.body, createdAt: r.created_at,
});

const mapTicketAttachment = r => ({
  id: r.id, ticketId: r.ticket_id, filename: r.filename,
  mimeType: r.mime_type || "", sizeBytes: r.size_bytes || 0,
  uploadedBy: r.uploaded_by || "", createdAt: r.created_at,
});

const mapTicketLabel = r => ({ id: r.id, ticketId: r.ticket_id, label: r.label, createdAt: r.created_at });

const mapTeam = (r, members = []) => ({ id: r.id, name: r.name, color: r.color || "#6366f1", createdAt: r.created_at, members });

const mapSprint = r => ({ id: r.id, projectId: r.project_id, name: r.name, startDate: r.start_date || null, endDate: r.end_date || null, status: r.status || "Planning", createdAt: r.created_at });
const mapSprintSnapshot = r => ({ id: r.id, sprintId: r.sprint_id, date: r.date, remainingPoints: r.remaining_points, totalPoints: r.total_points });
const mapSavedFilter = r => ({ id: r.id, userId: r.user_id, name: r.name, entityType: r.entity_type, query: (() => { try { return JSON.parse(r.query || "{}"); } catch { return {}; } })(), createdAt: r.created_at });
const mapTestDataRow = r => ({ id: r.id, caseId: r.case_id, rowData: (() => { try { return JSON.parse(r.row_data || "{}"); } catch { return {}; } })(), status: r.status || "Ready", position: r.position ?? 0, createdAt: r.created_at });
const mapNotification = r => ({ id: r.id, userId: r.user_id, type: r.type, message: r.message, ticketId: r.ticket_id || null, isRead: r.is_read === 1, createdAt: r.created_at });
const mapDashboardWidget = r => ({ id: r.id, userId: r.user_id, widgetType: r.widget_type, position: r.position ?? 0, config: (() => { try { return JSON.parse(r.config || "{}"); } catch { return {}; } })(), createdAt: r.created_at });
const mapWorkLog = r => ({ id: r.id, ticketId: r.ticket_id, userId: r.user_id, userName: r.user_name || null, minutes: r.minutes, loggedAt: r.logged_at, note: r.note || "", createdAt: r.created_at });
const mapBaseline = r => ({ id: r.id, projectId: r.project_id, name: r.name, description: r.description || "", createdBy: r.created_by || "", createdAt: r.created_at });
const mapBaselineTicket = r => ({ id: r.id, baselineId: r.baseline_id, ticketId: r.ticket_id, title: r.title, type: r.type, status: r.status, priority: r.priority, storyPoints: r.story_points ?? null, assigneeName: r.assignee_name || "" });

const mapKbProject  = r => ({ id: r.id, name: r.name, key: r.key, color: r.color || "#6366f1", description: r.description || "", createdAt: r.created_at });
const mapKbVersion  = r => ({ id: r.id, projectId: r.project_id, name: r.name, description: r.description || "", status: r.status || "Planning", releaseDate: r.release_date || null, createdAt: r.created_at });
const mapKbColumn   = r => ({ id: r.id, projectId: r.project_id, name: r.name, position: r.position ?? 0, color: r.color || "#6366f1", wipLimit: r.wip_limit ?? null, createdAt: r.created_at });

const inverseLinkLabel = lbl =>
  ({ "blocks": "is blocked by", "is blocked by": "blocks",
     "clones": "is cloned by", "is cloned by": "clones",
     "duplicates": "is duplicated by", "is duplicated by": "duplicates",
     "relates to": "relates to" }[lbl] ?? lbl);

// ─── Uploads ───────────────────────────────────────────────────────────────────

const UPLOADS_DIR = path.join(__dirname, "uploads", "ticket-attachments");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ─── WebSocket (live board updates) ───────────────────────────────────────────

const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload });
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

wss.on("connection", ws => {
  ws.on("error", () => {});
  ws.on("close",  () => {});
});

// ─── App settings + SSO (TKT: Azure AD / local login switch) ─────────────────

const getSettings = (prefix) => {
  try {
    const rows = prefix
      ? db.prepare("SELECT key, value FROM app_settings WHERE key LIKE ?").all(prefix + "%")
      : db.prepare("SELECT key, value FROM app_settings").all();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  } catch { return {}; }
};

// In-memory OAuth2 "state" nonce store (CSRF protection), 5-minute TTL.
const ssoNonces = new Map();
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [k, v] of ssoNonces) if (v.ts < cutoff) ssoNonces.delete(k);
}, 60_000);

// ─── Shared context ────────────────────────────────────────────────────────────

const ctx = {
  db, uid, ok, err, isUniqueViolation,
  auth, requireRole, broadcast,
  mapTicket, mapTicketLink, inverseLinkLabel,
  mapTestItem, mapTestCaseLink,
  mapKbProject, mapKbVersion, mapKbColumn,
  mapTicketComment, mapTicketAttachment, mapTicketLabel,
  mapTeam,
  mapSprint, mapSprintSnapshot, mapSavedFilter, mapTestDataRow, mapNotification,
  mapDashboardWidget, mapWorkLog, mapBaseline, mapBaselineTicket,
  bcrypt, jwt, JWT_SECRET,
  fs, path, UPLOADS_DIR,
  getSettings,
};

// ─── Routes ───────────────────────────────────────────────────────────────────

require("./routes/kanban")(app, ctx);
require("./routes/teams")(app, ctx);
require("./routes/extras")(app, ctx);
require("./routes/testcases")(app, ctx);
require("./routes/settings")(app, ctx);
require("./routes/estimation")(app, ctx);

// ── Auth ──────────────────────────────────────────────────────────────────────

app.get("/api/health", (req, res) => ok(res, { status: "ok", version: require("./package.json").version }));

const LOGIN_MAX_ATTEMPTS    = 5;
const LOGIN_LOCKOUT_MINUTES = 30;

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return err(res, "Email and password required");
  const user = db.prepare("SELECT * FROM users WHERE email=? AND is_active=1").get(email.toLowerCase().trim());
  if (!user) return err(res, "Invalid email or password", 401);

  const now = new Date().toISOString();
  if (user.locked_until && user.locked_until > now) {
    const mins = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
    return err(res, `Account locked. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, 423);
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    const attempts = (user.failed_attempts || 0) + 1;
    if (attempts >= LOGIN_MAX_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOGIN_LOCKOUT_MINUTES * 60_000).toISOString();
      db.prepare("UPDATE users SET failed_attempts=?, locked_until=? WHERE id=?").run(attempts, lockedUntil, user.id);
      return err(res, `Too many failed attempts. Account locked for ${LOGIN_LOCKOUT_MINUTES} minutes.`, 423);
    }
    db.prepare("UPDATE users SET failed_attempts=? WHERE id=?").run(attempts, user.id);
    return err(res, "Invalid email or password", 401);
  }

  db.prepare("UPDATE users SET failed_attempts=0, locked_until='', last_login=datetime('now') WHERE id=?").run(user.id);
  const roles = parseUserRoles(user);
  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role, roles },
    JWT_SECRET, { expiresIn: "8h" }
  );
  ok(res, { token, user: { id: user.id, email: user.email, name: user.name, role: user.role, roles } });
});

app.get("/api/auth/me", auth(), (req, res) => {
  const user = db.prepare("SELECT id, email, name, role, roles, is_active, last_login FROM users WHERE id=?").get(req.user.id);
  if (!user || !user.is_active) return err(res, "User not found", 404);
  ok(res, { ...user, roles: parseUserRoles(user) });
});

app.post("/api/auth/logout", (req, res) => ok(res, { ok: true }));

app.get("/api/auth/sso/config", (req, res) => {
  const s = getSettings();
  ok(res, {
    enabled:  s.sso_enabled === '1',
    tenantId: s.sso_tenant_id || '',
    clientId: s.sso_client_id || '',
  });
});

app.get("/api/auth/sso/init", (req, res) => {
  const s = getSettings();
  if (s.sso_enabled !== '1') return err(res, "SSO not enabled", 404);
  const { sso_tenant_id: tenantId, sso_client_id: clientId, sso_redirect_uri: redirectUri } = s;
  if (!tenantId || !clientId || !redirectUri)
    return err(res, "SSO not configured — set tenant ID, client ID, and redirect URI in Settings", 500);

  const state = crypto.randomBytes(16).toString("hex");
  ssoNonces.set(state, { ts: Date.now() });

  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: "code",
    redirect_uri:  redirectUri,
    response_mode: "query",
    scope:         "openid email profile",
    state,
  });
  res.redirect(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`);
});

app.get("/api/auth/sso/callback", async (req, res) => {
  const s = getSettings();
  if (s.sso_enabled !== '1') return err(res, "SSO not enabled", 404);

  const { code, state, error: oauthError } = req.query;
  if (oauthError) return err(res, `SSO error: ${oauthError}`, 400);
  if (!code || !state) return err(res, "Missing code or state", 400);
  if (!ssoNonces.has(state)) return err(res, "Invalid or expired state", 400);
  ssoNonces.delete(state);

  const {
    sso_tenant_id: tenantId, sso_client_id: clientId,
    sso_client_secret: clientSecret, sso_redirect_uri: redirectUri,
    sso_default_role: defaultRole = 'operator',
    sso_frontend_url: frontendUrl = 'http://localhost:5173',
  } = s;

  try {
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body:    new URLSearchParams({
          client_id: clientId, client_secret: clientSecret,
          code, redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`);
    const tokens = await tokenRes.json();

    const userRes = await fetch("https://graph.microsoft.com/oidc/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal:  AbortSignal.timeout(8_000),
    });
    if (!userRes.ok) throw new Error("Failed to fetch user info");
    const profile = await userRes.json();

    const email = (profile.email || profile.preferred_username || '').toLowerCase().trim();
    const name  = profile.name || profile.given_name || email;
    if (!email) throw new Error("No email in SSO profile");

    let user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
    if (!user) {
      const id    = `USR-${uid()}`;
      const roles = [VALID_ROLES.includes(defaultRole) ? defaultRole : 'operator'];
      const primary = primaryRoleSV(roles);
      db.prepare(`INSERT INTO users (id,email,name,password_hash,role,roles,is_active,created_at)
        VALUES (?,?,?,?,?,?,1,datetime('now'))`)
        .run(id, email, name, '', primary, JSON.stringify(roles));
      user = db.prepare("SELECT * FROM users WHERE id=?").get(id);
    }

    if (!user.is_active) return res.redirect(`${frontendUrl}?sso_error=${encodeURIComponent("Account deactivated")}`);

    db.prepare("UPDATE users SET last_login=datetime('now') WHERE id=?").run(user.id);

    const roles = parseUserRoles(user);
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role, roles, sso: true },
      JWT_SECRET, { expiresIn: "8h" }
    );

    res.redirect(`${frontendUrl}?sso_token=${encodeURIComponent(token)}`);
  } catch (e) {
    console.error("SSO callback error:", e.message);
    res.redirect(`${s.sso_frontend_url || 'http://localhost:5173'}?sso_error=${encodeURIComponent(e.message)}`);
  }
});

// ── Users ─────────────────────────────────────────────────────────────────────

app.get("/api/users", requireRole(["admin"]), (req, res) => {
  const rows = db.prepare("SELECT id, email, name, role, roles, is_active, created_at, last_login, failed_attempts, locked_until FROM users ORDER BY created_at").all();
  ok(res, rows.map(r => ({ ...r, roles: parseUserRoles(r) })));
});

app.post("/api/users", requireRole(["admin"]), (req, res) => {
  const { email, name, roles = ["viewer"], password } = req.body || {};
  if (!email || !name || !password) return err(res, "email, name, and password required");
  if (!roles.length || !roles.every(r => VALID_ROLES.includes(r))) return err(res, "Invalid roles");
  const primary = primaryRoleSV(roles);
  try {
    db.prepare("INSERT INTO users (id,email,name,password_hash,role,roles,is_active,created_at) VALUES (?,?,?,?,?,?,1,datetime('now'))")
      .run(`USR-${uid()}`, email.toLowerCase().trim(), name, bcrypt.hashSync(password, 10), primary, JSON.stringify(roles));
    ok(res, { ok: true }, 201);
  } catch (e) {
    if (isUniqueViolation(e)) return err(res, "Email already in use");
    throw e;
  }
});

app.patch("/api/users/:id", requireRole(["admin"]), (req, res) => {
  const { name, roles, is_active, password, unlock } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if (!user) return err(res, "User not found", 404);
  if (req.params.id === req.user.id && is_active === 0)
    return err(res, "Cannot deactivate your own account");
  const sets = [], vals = [];
  if (name      !== undefined) { sets.push("name=?");          vals.push(name); }
  if (roles     !== undefined) {
    if (!Array.isArray(roles) || !roles.every(r => VALID_ROLES.includes(r))) return err(res, "Invalid roles");
    sets.push("role=?", "roles=?"); vals.push(primaryRoleSV(roles), JSON.stringify(roles));
  }
  if (is_active !== undefined) { sets.push("is_active=?");     vals.push(is_active ? 1 : 0); }
  if (password)                { sets.push("password_hash=?"); vals.push(bcrypt.hashSync(password, 10)); }
  if (unlock)                  { sets.push("failed_attempts=0", "locked_until=''"); }
  if (!sets.length) return err(res, "Nothing to update");
  vals.push(req.params.id);
  db.prepare(`UPDATE users SET ${sets.join(",")} WHERE id=?`).run(...vals);
  ok(res, { ok: true });
});

app.delete("/api/users/:id", requireRole(["admin"]), (req, res) => {
  if (req.params.id === req.user.id) return err(res, "Cannot delete your own account");
  const r = db.prepare("DELETE FROM users WHERE id=?").run(req.params.id);
  if (!r.changes) return err(res, "User not found", 404);
  ok(res, { ok: true });
});

// ─── Serve frontend in production ─────────────────────────────────────────────

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "dist")));
  app.get("*", (req, res) => res.sendFile(path.join(__dirname, "dist", "index.html")));
}

// ─── Seed default admin if no users exist ────────────────────────────────────

const userCount = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
if (userCount === 0) {
  const adminId = `USR-${uid()}`;
  db.prepare(
    "INSERT INTO users (id,email,name,password_hash,role,roles,is_active) VALUES (?,?,?,?,?,?,1)"
  ).run(adminId, "admin@athena.local", "Admin", bcrypt.hashSync("admin123", 10), "admin", JSON.stringify(["admin"]));
  console.log("  ✔ Default admin created: admin@athena.local / admin123");
  console.log("  ⚠  Change this password immediately after first login.");

  // Seed default project
  const projId = `PRJ-${uid()}`;
  const now    = new Date().toISOString();
  db.prepare("INSERT INTO kb_projects (id,name,key,color,description,created_at) VALUES (?,?,?,?,?,?)")
    .run(projId, "My Project", "MYP", "#6366f1", "Default project", now);
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
      .run(`COL-${uid()}`, projId, DEFAULT_COLUMNS[i].name, i, DEFAULT_COLUMNS[i].color, now);
  }
  console.log(`  ✔ Default project "${projId}" seeded with ${DEFAULT_COLUMNS.length} columns.`);
}

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () =>
  console.log(`\n  Athena v${require("./package.json").version} running on http://localhost:${PORT}\n`)
);
