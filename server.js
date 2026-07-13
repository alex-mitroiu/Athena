"use strict";
const express = require("express");
const http    = require("http");
const path    = require("path");
const { WebSocketServer } = require("ws");
const { DatabaseSync }    = require("node:sqlite");
const bcrypt = require("bcryptjs");
const jwt    = require("jsonwebtoken");

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
`);

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

      const linkRows = db.prepare(`
        SELECT id FROM ticket_links WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})
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
  dueDate:         r.due_date        || null,
  testNotes:       r.test_notes      || null,
  projectId:       r.project_id      || null,
  versionId:       r.version_id      || null,
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

const mapKbProject  = r => ({ id: r.id, name: r.name, key: r.key, color: r.color || "#6366f1", description: r.description || "", createdAt: r.created_at });
const mapKbVersion  = r => ({ id: r.id, projectId: r.project_id, name: r.name, description: r.description || "", status: r.status || "Planning", releaseDate: r.release_date || null, createdAt: r.created_at });
const mapKbColumn   = r => ({ id: r.id, projectId: r.project_id, name: r.name, position: r.position ?? 0, color: r.color || "#6366f1", wipLimit: r.wip_limit ?? null, createdAt: r.created_at });

const inverseLinkLabel = lbl =>
  ({ "blocks": "is blocked by", "is blocked by": "blocks",
     "clones": "is cloned by", "is cloned by": "clones",
     "duplicates": "is duplicated by", "is duplicated by": "duplicates",
     "relates to": "relates to" }[lbl] ?? lbl);

// ─── Shared context ────────────────────────────────────────────────────────────

const ctx = {
  db, uid, ok, err, isUniqueViolation,
  auth, requireRole,
  mapTicket, mapTicketLink, inverseLinkLabel,
  mapTestItem, mapTestCaseLink,
  mapKbProject, mapKbVersion, mapKbColumn,
  bcrypt, jwt, JWT_SECRET,
};

// ─── Routes ───────────────────────────────────────────────────────────────────

require("./routes/kanban")(app, ctx);
require("./routes/testcases")(app, ctx);

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

app.get("/api/auth/sso/config", (req, res) => ok(res, { enabled: false }));

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

// ─── WebSocket (live board updates) ───────────────────────────────────────────

const wss = new WebSocketServer({ server, path: "/ws" });
const subs = new Map();

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload });
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}
ctx.broadcast = broadcast;

wss.on("connection", ws => {
  ws.on("error", () => {});
  ws.on("close",  () => {});
});

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
