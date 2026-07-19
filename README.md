# 🦉 Athena

**v0.3.0 · Genesis**

Athena is a standalone integration board and test management tool. It combines a multi-project Kanban board with structured test management — test plans, test runs, test cases, and release versioning — in a single lightweight app.

Named after the Greek goddess of wisdom and strategy.

---

## Features

- **Multi-project Kanban board** — configurable columns, WIP limits, drag-to-reorder
- **Ticket hierarchy** — Epics → Stories → Tasks/Bugs/Improvements with parent picker and progress rings
- **Releases & Versions** — plan and track releases per project with status (Planning / In Development / Released / Archived)
- **Test Management** — dedicated pages for Test Plans, Test Runs, and Test Cases with folder-tree organisation and inline execution
- **Ticket links** — blocks / is blocked by / relates to / duplicates
- **Assignees & due dates** — per-ticket assignee avatar and overdue highlighting
- **Role-based access** — admin / operator / viewer with JWT auth
- **Dark / light theme** — persisted per browser
- **WebSocket broadcast** — real-time board updates across tabs

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite, JSX with inline styles |
| Backend | Express, `node:sqlite` (DatabaseSync) |
| Auth | JWT (`jsonwebtoken`) + bcrypt (`bcryptjs`) |
| Realtime | WebSocket (`ws`) |
| Diagrams | Mermaid (Epic dependency graph) |

---

## Getting started

### Prerequisites

- Node.js ≥ 22.5.0

### Install

```bash
git clone https://github.com/YOUR_USERNAME/athena.git
cd athena
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
npm run server   # serves the API; point a static host at dist/
```

---

## Project structure

```
server.js           Express entry point — schema, auth, WebSocket, ctx
routes/
  kanban.js         Tickets, ticket-links, projects, versions, columns
src/
  App.jsx           Root shell — routing, auth, nav, theme
  api.js            Fetch wrappers for all endpoints
  tokens.js         Design tokens (T.surface, T.accent, T.text, …)
  pages/
    KanbanPage.jsx      Board view + roadmap + test suite view
    ReleasesPage.jsx    Version / release management
    TestPlansPage.jsx   Test plan list and editor
    TestRunsPage.jsx    Test run execution tracker
    TestCasesPage.jsx   Test case library with folder tree
    LoginPage.jsx       Auth screen
  components/
    primitives/         Btn, Modal, Form, Badge, Spinner, ActionMenu, …
```

---

## License

MIT
