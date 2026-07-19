# 🦉 Athena

**v0.5.0 · Genesis**

Athena is a standalone Integration Board and ALM (Application Lifecycle Management)
tool. It combines a multi-project Kanban board — with sprints, roadmap, and approval
workflows — with structured test management and a configurable reporting dashboard, in
a single lightweight, self-hosted app.

Named after the Greek goddess of wisdom and strategy.

For how the app is built internally (module map, data model, API surface, subsystem
deep-dives), see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Features

**Board**
- Multi-project Kanban board — configurable columns, WIP limits, drag-to-reorder
- Full ticket hierarchy — Epic → Story / **Requirement** / Feature / Bug / Improvement /
  Task / Chore, with parent picker and progress rings
- **Teams** — group users so an Epic can be assigned to a team, with an explicit,
  confirmed cascade of that assignment down to every child ticket
- **Sprints & burndown** — a filtered sprint board with a live burndown chart, built
  from daily snapshots taken automatically as the board is used
- **Roadmap** — swimlane view or Gantt-style date-axis view for Epics
- **Approval / sign-off workflow** — request → approve/reject on any ticket
- **Assignee notifications** — an in-app bell, updated automatically on assignment
- **Time tracking** — per-ticket work log with per-user rollups
- **Baselines & snapshots** — freeze a project's ticket state at a point in time, then
  diff it against live state to see exactly what changed
- **Advanced search & saved filters** — per-user named filter presets
- Ticket links — blocks / is blocked by / relates to / duplicates / satisfies / is
  satisfied by
- Comments, attachments, labels, bulk operations, story points, custom fields

**Test Management**
- Test Folder → Test Plan → Test Run → Test Case, with folder-tree organisation and
  inline execution
- **Parameterized test cases** — data-driven input/expected rows per case
- Test Case ↔ Story linking, with cross-project copy
- **Traceability matrix** — Story × Test Case coverage view
- Project-wide test coverage rollup dashboard

**Reporting & Admin**
- **Configurable dashboard** — per-user widget layout (My Tickets, Sprint Burndown,
  Recent Notifications, Work Log Summary), add/remove/reorder
- Releases & Versions — plan and track releases per project
- Role-based access — admin / operator / viewer with JWT auth, login lockout
- User & team management (admin)
- Dark / light theme, persisted per browser
- WebSocket broadcast — real-time board updates across tabs

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite, JSX with inline styles |
| Backend | Express, `node:sqlite` (DatabaseSync) |
| Auth | JWT (`jsonwebtoken`) + bcrypt (`bcryptjs`) |
| Realtime | WebSocket (`ws`) |
| Diagrams | Mermaid (Epic dependency graph) |

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full breakdown, including why state
management is deliberately simple (no Redux/React Query) and how the SQLite schema is
organised.

---

## Getting started

### Prerequisites

- Node.js ≥ 22.5.0

### Install

```bash
git clone https://github.com/alex-mitroiu/Athena.git
cd Athena
npm install
```

### Run (development)

```bash
npm run dev
```

- Backend: [http://localhost:3001](http://localhost:3001)
- Frontend (Vite): [http://localhost:5173](http://localhost:5173)

### Default admin credentials

```
Email:    admin@athena.local
Password: admin123
```

> Change these immediately after first login via the Users panel.

### Build for production

```bash
npm run build
npm run server   # serves the API + dist/ on one port
```

`JWT_SECRET` should be set via environment variable before any real deployment —
without it, the app boots with an insecure dev default and prints a warning.

---

## Project structure

```
server.js             Express entry point — schema, auth, mappers, WebSocket, ctx
routes/
  kanban.js            Tickets, links, projects, versions, columns, sprints, notifications, approvals
  teams.js             Team CRUD + membership
  testcases.js         Test items, story links, parameterized data rows
  extras.js            Saved filters, dashboard widgets, work logs, baselines
src/
  App.jsx              Root shell — auth gate, sidebar nav, theme, page switch, notification bell
  AuthContext.jsx       Role/permission context (canEdit, isAdmin, isViewer, …)
  api.js               Fetch wrappers, one namespace per resource
  tokens.js            Design tokens (T.surface, T.accent, T.text, …)
  version.js           VERSION, BUILD, CODENAME, CHANGELOG[]
  pages/
    KanbanPage.jsx        Board, Roadmap, Sprint board + burndown, Board Manager modal
    ReleasesPage.jsx      Version / release management
    TestPlansPage.jsx     Test plan list, coverage rollup
    TestRunsPage.jsx      Test run execution tracker
    TestCasesPage.jsx     Test case library, folder tree, parameterization
    TraceabilityPage.jsx  Story × Test Case matrix
    DashboardPage.jsx     Configurable per-user widget dashboard
    TeamsPage.jsx         Admin: teams
    UsersPage.jsx         Admin: users
    UserManualPage.jsx    In-app docs + changelog
    LoginPage.jsx         Auth screen
  components/
    primitives/          Btn, Modal, Form, Badge, Spinner, ActionMenu, Pagination, ToastContainer
    shared/              Cross-page components (e.g. TestCaseStoryLinksPanel)
```

---

## License

MIT
