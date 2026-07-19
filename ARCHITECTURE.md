# Athena — Architecture Reference

**Version:** 0.5.0 · **Last updated:** 2026-07-19

This document describes how Athena is built: the module layout, the data model, the
API surface, and the subsystems worth understanding before making a non-trivial change.
It is a companion to [README.md](README.md) (which covers what Athena does and how to
run it) — this file covers *how* it does it.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Tech Stack](#2-tech-stack)
3. [Process & Deployment Topology](#3-process--deployment-topology)
4. [Frontend Architecture](#4-frontend-architecture)
5. [Backend Architecture](#5-backend-architecture)
6. [Data Model](#6-data-model)
7. [API Layer](#7-api-layer)
8. [Key Subsystems](#8-key-subsystems)
9. [Cross-Cutting Concerns](#9-cross-cutting-concerns)
10. [Known Debts & Improvement Opportunities](#10-known-debts--improvement-opportunities)
11. [Appendix — Codebase Metrics](#appendix--codebase-metrics)

---

## 1. System Overview

Athena is a single-tenant, self-hosted Integration Board + ALM (Application Lifecycle
Management) tool. It was forked from CargoDesk's internal Kanban/test-management module
and grown into a standalone product covering four bounded contexts:

- **Board** — multi-project Kanban with a full ticket-type hierarchy (Epic → Story /
  Requirement / Feature / Bug / Improvement / Task / Chore), sprints, roadmap, and
  traceability.
- **Test Management** — Test Folder → Test Plan → Test Run → Test Case, with
  parameterized (data-driven) test cases and Story↔TestCase linkage.
- **Reporting** — a per-user configurable dashboard, sprint burndown, and point-in-time
  baselines/snapshots for auditability.
- **Admin** — users, roles, and teams.

There is no external database server, no message queue, and no microservices — it is
one Express process and one SQLite file, which is intentional: Athena targets small
teams that want a lightweight, single-binary-feeling deployment.

### Bounded contexts (logical domains)

| Domain | Owns | Entry points |
|---|---|---|
| Board | Tickets, links, labels, comments, attachments, teams, sprints, columns, versions, notifications, approvals | `routes/kanban.js`, `routes/teams.js` |
| Test Management | Test items (folder/plan/run/case), data rows, story links | `routes/testcases.js` |
| Reporting | Saved filters, dashboard widgets, work logs, baselines | `routes/extras.js` |
| Admin/Auth | Users, JWT issuance, RBAC | `server.js` (inline — never split out) |

---

## 2. Tech Stack

| Layer | Tech | Notes |
|---|---|---|
| Frontend | React 18, Vite 5 | JSX with inline `style={{}}` objects — no CSS framework, no CSS Modules |
| Backend | Express 4 | Single process, no clustering |
| Database | `node:sqlite` (`DatabaseSync`) | Node's built-in SQLite binding — no `better-sqlite3` or ORM dependency |
| Auth | `jsonwebtoken` + `bcryptjs` | Stateless JWT, 3 roles |
| Realtime | `ws` | Raw WebSocket, one broadcast channel |
| Diagrams | `mermaid` | Epic dependency graph only |
| Build | Vite | Single-page app, `vite build` emits `dist/` |

State management is deliberately minimal: no Redux/Zustand/React Query. Every page
component owns its own `useState`/`useEffect` fetch-on-mount, and self-contained panels
(`TicketWorkLogPanel`, `NotificationBell`, `SavedFiltersMenu`, dashboard widgets) fetch
their own data independently rather than receiving it as props. This trades some
duplicate network calls for zero cross-component coupling — acceptable at Athena's
scale (single-tenant, small teams).

---

## 3. Process & Deployment Topology

### Development

```
npm run dev
 ├─ npm run server   → node server.js        (Express API,  :3001)
 └─ npm run client   → vite                  (React dev server, :5173, HMR)
```

Vite proxies `/api/*` and `/ws` to `:3001` in dev (see `vite.config.js`). The frontend
always talks to a relative `/api/...` path — it never hardcodes a port, so the same
built bundle works whether Express is serving it directly (production) or Vite is
proxying to it (dev).

### Production

```
npm run build     # vite build → dist/
npm run server    # node server.js — also serves dist/ as static files + API on one port
```

One process, one port. There is no separate frontend host in production — `server.js`
falls back to serving `dist/index.html` for any non-`/api` GET request (SPA routing).

### Data files

- `athena.db` — the live SQLite database (WAL mode: `athena.db-shm` / `athena.db-wal`
  alongside it). Gitignored.
- `uploads/` — ticket attachment blobs, referenced by `ticket_attachments.stored_name`.
- No `.env` is required to boot; `JWT_SECRET` defaults to an insecure dev value with a
  startup warning if unset — **must** be set via environment variable before any
  real deployment.

---

## 4. Frontend Architecture

### Module map

```
src/
  main.jsx              ReactDOM.createRoot entry point
  App.jsx               Root shell: auth gate, sidebar nav, theme toggle, page switch
  AuthContext.jsx        React context — user, roles, canEdit/isAdmin/isViewer booleans
  api.js                 Fetch wrapper + one namespace object per resource (api.tickets, api.sprints, …)
  tokens.js              Design tokens — T.bg / T.surface / T.accent / T.text / T.mono / T.head / T.body, etc.
  toast.js               Tiny pub/sub toast queue (success/error), rendered by ToastContainer
  version.js             VERSION, BUILD, CODENAME, CHANGELOG[] — powers the footer + User Manual "What's New"

  pages/
    KanbanPage.jsx        Board, Roadmap, Sprint board, embedded Test Suite view, Board Manager modal — see note below
    ReleasesPage.jsx      Version/release planning per project
    TestPlansPage.jsx     Test plan list, coverage rollup tab
    TestRunsPage.jsx      Test run execution tracker
    TestCasesPage.jsx     Test case folder tree, data-row (parameterization) panel
    TraceabilityPage.jsx  Story × Test Case matrix
    DashboardPage.jsx     Per-user configurable widget dashboard
    TeamsPage.jsx         Admin: team CRUD + membership
    UsersPage.jsx         Admin: user CRUD, role assignment, lockout/unlock
    UserManualPage.jsx    In-app documentation + changelog viewer
    LoginPage.jsx         Auth screen

  components/
    primitives/           Btn, Modal, ConfirmModal, Form (Inp/Sel/Textarea/inputBase), Badge, Spinner, ActionMenu, Pagination, ToastContainer
    shared/
      TestCaseStoryLinksPanel.jsx   Reused by both TestCasesPage and KanbanPage's TicketPreview
```

**`KanbanPage.jsx` is 5,700+ lines and is the single largest file in the codebase by a
wide margin** — see [§10 Known Debts](#10-known-debts--improvement-opportunities). It
contains not just the board but the Roadmap view, the Sprint board + burndown chart, the
entire Board Manager modal (Columns/Projects/Versions/Sprints/Baselines tabs), the
Ticket modal/preview/diagram/coverage modals, and the embedded Test Suite view. Nothing
in it is *wrong* — the coupling is real (most of these views share the same `tickets`
array and mutation handlers) — but it is the first place to look when a change feels
harder than it should.

### Routing

There is no router library and no hash-based routing. `App.jsx` holds a single
`const [page, setPage] = useState("kanban")` string, and the sidebar's `NavBtn` calls
`setPage(key)` directly. The main area is a flat sequence of
`{page === "x" && <XPage />}` conditionals. This is sufficient because every page is a
top-level destination — there is no deep-linkable sub-resource URL (e.g. no
`/tickets/:id`), so there has been no pressure to add a router.

### State management

- **Auth**: `AuthContext` — populated once in `App.jsx` after login/`/api/auth/me`,
  consumed via `useAuth()` everywhere. Carries `user`, `activeRole`, `activeRoles`,
  `canEdit`, `isAdmin`, `isViewer`.
- **Page-local state**: each page fetches its own data in a `useEffect(load, [])` on
  mount and re-fetches after mutations. No caching layer, no stale-while-revalidate —
  every mutation is followed by an explicit reload of the affected list.
- **Self-fetching panels**: components like `NotificationBell`, `TicketWorkLogPanel`,
  `SavedFiltersMenu`, and every Dashboard widget fetch their own data independently of
  their parent. This means a ticket preview panel and the dashboard's "My Tickets"
  widget each hit `GET /api/tickets` separately rather than sharing a cache — an
  accepted tradeoff at this scale (see §2).

  > **Gotcha (fixed 2026-07-19):** an effect passed directly as
  > `useEffect(load, [])` where `load` is an *expression-bodied* arrow function
  > (`const load = () => api.x.list().then(...)`) implicitly returns the fetch
  > Promise. React treats whatever an effect returns as its cleanup function, so on
  > unmount it tries to call the Promise as a function and throws
  > `TypeError: destroy is not a function`. Always wrap in a block body —
  > `useEffect(() => { load(); }, [])` — or give `load` a `{ }` body with no
  > `return` (the existing convention in `TeamsPage`/`UsersPage`).

### Design token system

`tokens.js` exports a single `T` object (dark/light aware) consumed as
`style={{ color: T.text, background: T.surface }}` throughout — there is no
Tailwind/CSS-in-JS library. `applyTheme()` toggles a small set of CSS custom properties
on `<html>`; `T` itself reads from those at module scope, so every already-mounted
component picks up a theme switch without a remount.

---

## 5. Backend Architecture

### `server.js` structure (651 lines)

```
Imports & app setup
Helpers (ok/err response wrappers, id generator)
Schema (21 CREATE TABLE IF NOT EXISTS statements)
Incremental migrations (ALTER TABLE ... — for DBs created before a column existed)
One-time migration (legacy tickets-typed-as-tests → test_items, run once, idempotent)
Auth middleware (JWT verify, requireRole, global /api guard)
Mappers (row → API-shape object, one per entity)
Uploads (multer-less raw base64-to-disk handler for attachments)
WebSocket (broadcast(type, payload) → all connected clients)
Shared ctx object (db, mappers, auth, requireRole, broadcast — passed into every route module)
Route registration (require("./routes/X")(app, ctx))
Inline routes (health, auth/login, auth/me, users CRUD — never extracted to routes/)
Static file fallback (serve dist/ in production)
Seed default admin (if users table is empty)
Listen
```

**Route factory pattern**: every file under `routes/` exports
`module.exports = function xRoutes(app, ctx) { ... }`. `server.js` builds one `ctx`
object carrying the shared `db` handle, every mapper function, `auth`/`requireRole`
middleware, and `broadcast`, then calls each factory once at boot. This means adding a
new route module never touches `server.js` beyond one `require(...)(app, ctx)` line —
schema and mappers are the only things that live centrally.

### Route modules

| File | Lines | Owns |
|---|---|---|
| `routes/kanban.js` | 535 | Tickets (CRUD, bulk patch, links, labels, comments, attachments), projects, versions, columns, **sprints + burndown**, **notifications**, **approvals** |
| `routes/teams.js` | 63 | Teams CRUD + membership |
| `routes/testcases.js` | 240 | Test items (CRUD, cross-project copy), story links, **data rows (parameterization)** |
| `routes/extras.js` | 164 | Saved filters, dashboard widgets, work logs, baselines |

### Request lifecycle

```
Request → app.use("/api", auth-or-exempt) → route-specific middleware (auth()/requireRole([...]))
        → handler → db.prepare(...).run()/get()/all() → mapper(s) → ok(res, data)
```

Every route in `routes/*.js` receives `write` — a per-file constant, usually
`requireRole(["admin", "operator"])` — for mutating endpoints, and bare `auth()` for
reads. There is no per-route rate limiting or request validation library (e.g. no
Joi/Zod) — payload shape is trusted and destructured with defaults inline
(`const { title, priority = "Medium", ... } = req.body || {}`).

---

## 6. Data Model

### Entity-Relationship Overview

```
users ──< tickets (assignee_id)          users ──< team_members >── teams
users ──< ticket_comments (author_id)    teams ──< tickets (team_id)
users ──< notifications                  users ──< saved_filters
users ──< dashboard_widgets              users ──< work_logs

kb_projects ──< kb_versions              kb_projects ──< kb_columns
kb_projects ──< kb_sprints ──< kb_sprint_snapshots
kb_projects ──< tickets (project_id)     kb_versions ──< tickets (version_id)
kb_sprints  ──< tickets (sprint_id)

tickets ──< tickets (parent_id, self-reference — Epic → children)
tickets ──< ticket_links >── tickets (from_id/to_id, typed: Blocks/Is blocked by/Relates to/Duplicates/Satisfies/Is satisfied by)
tickets ──< ticket_comments / ticket_attachments / ticket_labels
tickets ──< work_logs
tickets ──< test_case_links >── test_items   (Story ↔ Test Case)

test_items ──< test_items (parent_id — Test Folder → Test Plan → Test Run → Test Case)
test_items ──< test_case_data_rows           (parameterized rows)

baselines ──< baseline_tickets               (frozen snapshot, no FK back to tickets by design)
```

`tickets` and `test_items` are structurally identical (same column set) but live in
separate tables — a one-time migration (`server.js`, "One-time migration" section)
moved legacy Test Folder/Plan/Run/Case rows that used to share the `tickets` table into
`test_items`, so the Integration Board and the Test Management pages no longer compete
for the same ID space or list endpoints.

### Core tables

| Table | Purpose |
|---|---|
| `users` | Auth + role(s); `roles` is a JSON array (multi-role), `role` is the legacy single-value fallback |
| `tickets` | Board items — Epic/Requirement/Story/Feature/Bug/Improvement/Task/Chore |
| `ticket_links` | Typed relationships between two tickets |
| `ticket_comments`, `ticket_attachments`, `ticket_labels` | Per-ticket collateral |
| `kb_projects`, `kb_versions`, `kb_columns` | Multi-project scaffolding — columns are per-project, not global |
| `kb_sprints`, `kb_sprint_snapshots` | Sprint definition + daily burndown snapshot (see §8.2) |
| `teams`, `team_members` | Team grouping for Epic-level assignment |
| `test_items` | Test Folder/Plan/Run/Case hierarchy (`type` discriminator + `parent_id` self-reference) |
| `test_case_links` | Story ↔ Test Case linkage, feeds the Traceability matrix |
| `test_case_data_rows` | Parameterized input/expected rows for a Test Case |
| `saved_filters` | Per-user named filter presets (JSON query blob) |
| `notifications` | In-app notification feed (assignment events today) |
| `dashboard_widgets` | Per-user widget layout — type + position + JSON config |
| `work_logs` | Per-ticket time entries (minutes, note, user, timestamp) |
| `baselines`, `baseline_tickets` | Point-in-time frozen ticket snapshots (no FK to live tickets — see §8.7) |

### ID format

Every entity uses a human-readable prefixed random ID, generated inline
(`` `TKT-${uid()}` ``, `` `WID-${uid()}` ``, etc.) rather than an autoincrement integer
or UUID — this is what makes ticket IDs like `TKT-GB8PGQ` copy-pasteable and
grep-friendly in logs/screenshots. Prefixes in use: `TKT` (tickets/test items share the
scheme), `PRJ`, `VER`, `COL`, `TM` (teams), `SPR`, `NTF`, `WID`, `WL`, `BSL`/`BT`,
`SF` (saved filters), `USR`.

---

## 7. API Layer

All endpoints are namespaced under `/api`. There is no API versioning (`/api/v1/...`)
— acceptable for a single-tenant app with a bundled frontend that always ships in
lockstep with the backend.

| Group | Base path | Notes |
|---|---|---|
| Auth | `/api/auth/*` | login, me, logout, sso/config (stub — SSO not implemented, returns `{enabled:false}`) |
| Users (admin) | `/api/users` | CRUD, gated `requireRole(["admin"])` |
| Tickets | `/api/tickets*` | CRUD, bulk patch, links, labels, comments, attachments, `tested-by` |
| Sprints | `/api/kb/projects/:id/sprints`, `/api/kb/sprints/:id`, `/api/kb/sprints/:id/burndown` | Burndown upserts a snapshot as a side effect of every GET (see §8.2) |
| Notifications | `/api/notifications*` | list, mark-read, mark-all-read |
| Approvals | `/api/tickets/:id/{request-approval,approve,reject}` | State-machine transitions, 409 on invalid transition |
| Projects/Versions/Columns | `/api/kb/projects/*`, `/api/kb/versions/:id`, `/api/kb/columns/:id` | Multi-project scaffolding |
| Teams | `/api/teams*` | CRUD + membership |
| Test Items | `/api/test-items*`, `/api/data-rows/:id`, `/api/test-case-links` | Test hierarchy, copy, parameterization rows, story links |
| Saved Filters | `/api/saved-filters*` | Per-user, scoped by `user_id` on every read/delete |
| Dashboard Widgets | `/api/dashboard/widgets*` | list/create/reorder/remove, per-user |
| Work Logs | `/api/tickets/:id/work-logs`, `/api/work-logs/:id`, `/api/work-logs/summary` | Summary is scoped to the requesting user |
| Baselines | `/api/kb/projects/:id/baselines`, `/api/baselines/:id` | Create snapshots every current project ticket; no edit route (read-only once created) |

### Naming inconsistency (known, low priority)

Some resources nest under `/api/kb/...` (projects, versions, columns, sprints,
baselines) — a holdover from this module's original name (`kb` = "kanban board") inside
CargoDesk — while others added later sit flat at `/api/...` (teams, notifications,
saved-filters, dashboard/widgets, work-logs). Not worth a breaking rename; new
resources should default to the flat, un-prefixed style.

---

## 8. Key Subsystems

### 8.1 Ticket Type Hierarchy & Requirements

`tickets.type ∈ {Epic, Requirement, Story, Feature, Bug, Improvement, Task, Chore}`.
Epic is the only type that can be a parent (`parent_id`); all others are leaf or
epic-children. **Requirement** was added as a peer to Story rather than a new subsystem
— it reuses the existing `type` column and gets traceability via a new
`ticket_links` pair (`"Satisfies"` / inverse `"Is satisfied by"`) rather than a
dedicated requirements table. `TYPE_ICON`/`TYPE_VARIANT` maps in `KanbanPage.jsx`
control the icon and `Badge` color per type.

### 8.2 Sprints & Burndown (snapshot-on-view)

There is no historical event log for ticket status changes, so a classic
"burndown = query the event log for any past day" approach isn't available. Instead,
`GET /api/kb/sprints/:id/burndown` computes today's `remainingPoints` (sum of
`story_points` for tickets in the sprint not in
`DONE_STATUSES = {Done, Ready to Deploy, Released}`) and `totalPoints`, then
`INSERT ... ON CONFLICT(sprint_id, date) DO UPDATE` upserts a row into
`kb_sprint_snapshots` keyed by `(sprint_id, today's date)`. Real daily history builds up
purely from normal usage — anyone opening the Sprint board that day writes (or
overwrites) that day's snapshot. No cron job, no background worker.

### 8.3 Approval Workflow

Generic per-ticket state machine: `approval_status ∈ {NULL, Pending, Approved, Rejected}`.
- `NULL`/`Rejected` → `request-approval` → `Pending`
- `Pending` → `approve` → `Approved`
- `Pending` → `reject` → `Rejected`

Any other transition attempt (e.g. approving a ticket that's still `NULL`) returns
`409`. Re-requesting after `Rejected` resets to `Pending` — there is no separate
"re-review" state. The UI exposes the valid next actions only (via `ActionMenu`'s
conditional item list in `TicketPreview`), so an invalid transition normally can't be
triggered from the board — the 409 exists for API callers, not as a UI safety net.

### 8.4 Notifications

`notifications` is a flat, append-only feed. Today the only writer is
`notifyAssignee()` in `routes/kanban.js`, called whenever a ticket's `assignee_id`
changes to someone other than the actor themselves (create, update, or bulk-patch).
`NotificationBell` (in `App.jsx`) polls `GET /api/notifications` every 30 seconds — there
is no WebSocket push for notifications specifically, even though a `broadcast()`
mechanism already exists for board updates (see §8.6). Wiring notifications through the
existing WebSocket channel instead of polling is a natural next step, not yet done.

### 8.5 Baselines & Snapshots

A baseline is a **read-only-once-created** copy: `POST /api/kb/projects/:id/baselines`
snapshots every current ticket in the project into `baseline_tickets`, freezing
`title/type/status/priority/story_points/assignee_name` at that instant. There is
deliberately no update route — a baseline that can drift after creation defeats its
purpose as a fixed reference point. `BaselineViewModal` (in `KanbanPage.jsx`) diffs a
baseline's frozen rows against the *live* `tickets` array passed down from
`KanbanPage`, flagging:
- a ticket whose live `status` differs from the frozen one (`NOW: <status>`)
- a ticket that no longer exists in the live set at all (`DELETED SINCE`)

The diff is computed client-side, in-memory — no server-side diff endpoint exists,
since the live ticket list is already loaded by the page hosting the modal.

### 8.6 WebSocket

One `WebSocketServer` at `/ws`, one `broadcast(type, payload)` helper in `server.js`'s
`ctx`, called from mutating ticket routes to push `{type: "ticket_updated", ...}`-shaped
messages to every connected client so multiple open tabs/browsers stay in sync on board
changes. There is no per-client subscription/room concept — every connected client
receives every broadcast, filtered client-side if needed. Notifications do not yet flow
through this channel (see §8.4).

### 8.7 Configurable Dashboards

`dashboard_widgets` stores a flat, per-user, ordered list of `{widget_type, position,
config}`. The widget catalog is a fixed, hardcoded set (`WIDGET_CATALOG` in
`DashboardPage.jsx`): My Tickets, Sprint Burndown, Recent Notifications, Work Log
Summary — one instance of each type max (the "+ Add Widget" menu hides types already
present, rather than supporting duplicates). Reordering is two buttons (▲/▼) that swap
adjacent `position` values via `PATCH /api/dashboard/widgets/reorder`, not a drag-and-drop
surface — kept simple since the catalog is small and a full DnD library wasn't
justified for four widget types. Each widget component is fully self-fetching (see §4,
State management) — `DashboardPage` itself only owns the catalog and layout, not any
widget's data.

### 8.8 Test Management Hierarchy & Parameterization

`test_items` uses the same generic parent/child + `type` discriminator pattern as
`tickets`: Test Folder → Test Plan → Test Run → Test Case. `runStats()` — a function
that tallies pass/fail/blocked/active/pending counts from a case list — is **duplicated**
independently in `TestPlansPage.jsx`, `TestCasesPage.jsx`, and `KanbanPage.jsx`'s
embedded `TestSuiteView` rather than shared from one module; each copy is small and the
three views evolved at different times, so this hasn't yet been worth unifying.
Parameterization (`test_case_data_rows`) deliberately uses a fixed `{input, expected,
status}` shape rather than a dynamic column-definition system — scope-limited on
purpose, matching the originating ticket's framing ("no existing groundwork, lower
priority").

### 8.9 Traceability Matrix

`TraceabilityPage.jsx` renders Stories as rows and their linked Test Cases (via
`test_case_links`) as columns, with a per-row coverage percentage. Backed by
`GET /api/test-case-links`, which joins every link in one query rather than the
page fetching per-Story — the join was added specifically so this page doesn't do
N+1 requests for a project with many stories.

### 8.10 Authentication & RBAC

Three roles: `admin > operator > viewer` (rank order matters for
`primaryRoleSV()`). A user's `roles` column is a JSON array supporting multiple roles;
`role` is a single-value legacy fallback still populated for compatibility. JWT is
issued on login with a configurable-but-defaulted `JWT_SECRET` and no refresh-token
flow — a token is valid until it expires or the frontend explicitly logs out. Login
lockout: `failed_attempts` increments on bad password, `locked_until` gates further
attempts once a threshold is hit (admin can unlock via the Users page).

---

## 9. Cross-Cutting Concerns

### Error handling
Every route uses a shared `ok(res, data, status?)` / `err(res, message, status?)`
response-shape helper from `server.js`'s "Helpers" section — consistent
`{data}` / `{error}` JSON envelopes across all ~90 endpoints. No global Express error
middleware; handlers `try/catch` where a failure is expected (JSON parsing, DB
constraint violations) and let genuinely unexpected exceptions surface as a 500 with a
stack trace in dev.

### Transactions
Multi-statement writes that must be atomic (e.g. the legacy tickets→test_items
migration, baseline creation snapshotting N tickets) wrap in explicit
`db.exec("BEGIN")` / `COMMIT` blocks. Single-row CRUD does not need explicit
transactions — `node:sqlite`'s synchronous API makes each `.run()` call atomic on its
own.

### Concurrency
`node:sqlite`'s `DatabaseSync` is synchronous and single-connection — there is no
connection pool and no risk of two requests racing on the same write, because Node's
event loop only ever has one JS-level statement executing at a time. WAL mode
(`athena.db-wal`/`-shm`) allows concurrent reads during a write.

### Authentication & authorization
See §8.10. Every `/api/*` route is auth-gated by default (global middleware in
`server.js`); routes opt out (`/auth/*`, `/health`) rather than opting in — a
newly-added route is secure by default, not insecure until someone remembers a guard.

### Pagination
None. Every list endpoint (`GET /api/tickets`, `GET /api/test-items`, etc.) returns the
full result set. Acceptable at current expected data volumes (single-tenant, hundreds
not millions of tickets); would need addressing before Athena could serve a
much larger single project.

### Data integrity
Foreign keys are declared (`REFERENCES ... ON DELETE CASCADE`) on newer tables
(`kb_versions`, `kb_columns`, `kb_sprints`, `team_members`, `baseline_tickets`) but
**not enforced** — `node:sqlite` does not turn on `PRAGMA foreign_keys` by default and
Athena does not explicitly enable it. The `REFERENCES` clauses are documentation of
intent more than an enforced constraint today.

---

## 10. Known Debts & Improvement Opportunities

### High
- **`KanbanPage.jsx` at 5,700+ lines** carries board, roadmap, sprint board, board
  manager, and multiple modals in one file. The natural split points are the Board
  Manager modal (already a semi-independent component) and the Sprint/Burndown view —
  both could move to their own files without touching shared state much.
- **No pagination** on any list endpoint (see §9) — fine today, a real limit at scale.
- **Foreign keys declared but not enforced** (see §9, Data integrity) — turning on
  `PRAGMA foreign_keys = ON` is a small change but should be paired with an audit of
  existing data for orphaned rows first.

### Medium
- **Notifications poll instead of push** (§8.4) — the WebSocket broadcast channel
  already exists and could carry notification events instead of a 30s client poll.
- **`runStats()` duplicated three times** (§8.8) — worth extracting to a shared module
  once a fourth consumer appears, not urgent before that.
- **No request validation library** — payload shape is trusted; a malformed request
  currently fails as a generic 500 (e.g. missing required field) rather than a
  descriptive 400 in most routes.

### Low / Enhancement
- **`/api/kb/...` vs flat `/api/...` naming inconsistency** (§7) — cosmetic, not worth
  a breaking rename.
- **No API versioning** — acceptable while frontend and backend always ship together.
- **Dashboard widget catalog is hardcoded** (§8.7) — fine for 4 widget types; a plugin
  registry would be over-engineering at this size.
- **SSO endpoint is a stub** (`/api/auth/sso/config` always returns `{enabled:false}`)
  — present only so the login page doesn't crash checking for it; no real SSO
  provider is wired up.

---

## Appendix — Codebase Metrics

_As of v0.5.0 (2026-07-19):_

| Area | Files | Lines |
|---|---|---|
| Backend (`server.js` + `routes/*.js`) | 5 | ~1,650 |
| Frontend pages (`src/pages/*.jsx`) | 11 | ~9,600 |
| Frontend shared (`App.jsx`, `AuthContext.jsx`, `api.js`, `tokens.js`, `toast.js`, `version.js`, `main.jsx`) | 7 | ~1,000 |
| Frontend components (`src/components/**/*.jsx`) | 9 | ~460 |
| **Total** | **32** | **~12,700** |

Largest files: `src/pages/KanbanPage.jsx` (5,775), `src/pages/TestCasesPage.jsx` (869),
`server.js` (651), `src/pages/TestPlansPage.jsx` (591).

Database: 21 tables, no external database dependency (`node:sqlite`, ships with Node
≥ 22.5).
