export const VERSION  = "0.5.0";
export const BUILD    = "2026-07-19";
export const CODENAME = "Genesis";

export const CHANGELOG = [
  {
    version:  "0.5.0",
    date:     "2026-07-19",
    codename: "Genesis",
    summary:  "ALM capability assessment, Tier B (the remaining gaps): Sprints & burndown (TKT-GB8PGQ) — new kb_sprints table, a Sprint board view with a mini-JIRA burndown chart built by upserting a daily points snapshot every time it's viewed (no cron job needed). Advanced search + saved filters (TKT-3MD0S1) — per-user named filter presets on the Kanban board. Test case parameterization (TKT-TM7OGI) — data-driven rows (input/expected/status) attached to a Test Case. Requirements ticket type (TKT-L9ZW5G) — a Requirement peer to Story, linked via a new Satisfies/Is satisfied by pair. Approval workflows (TKT-S5RZ6D) — a Pending/Approved/Rejected state machine on any ticket, requestable and actionable from the ticket preview's actions menu. Assignee notifications (TKT-RZRUER) — an in-app bell with unread badge, polling every 30s. Time tracking (TKT-91OLB9) — per-ticket work log with per-user rollups. Baselines & snapshots (TKT-M6K5AP) — freeze every ticket's title/type/status/priority/points at a point in time, then diff a baseline against live state to see what changed. Configurable dashboards (TKT-RKTB6L) — a new Dashboard page with an add/remove/reorder widget catalog (My Tickets, Sprint Burndown, Recent Notifications, Work Log Summary), saved per user.",
  },
  {
    version:  "0.4.0",
    date:     "2026-07-19",
    codename: "Genesis",
    summary:  "ALM capability assessment, Tier A (\"compounds what's already built\"): project-wide test coverage dashboard (TKT-S84WRE) — a new Coverage tab on Test Plans rolling up the existing per-plan runStats() math into one sortable, worst-first list instead of requiring the tree to be expanded plan-by-plan. Cross-project test case copy (TKT-LZOXXE) — multi-select in Test Cases plus a new POST /api/test-items/copy route clones selected cases as fresh, unfiled, status-reset copies into another project. Traceability matrix (TKT-CWFZPB) — new Traceability page/nav item, rows = Stories, columns = linked Test Cases with status dots and a coverage % per row, backed by a new GET /api/test-case-links endpoint that joins all links in one query instead of fetching per-Story. Roadmap Gantt mode (TKT-AGH5M7) — Epics gain an optional start_date (paired with the existing due_date); Roadmap view gets a Swimlanes/Gantt toggle, plotting dated Epics as date-axis bars with a today marker and listing any Epic missing either date separately rather than silently dropping it.",
  },
  {
    version:  "0.3.0",
    date:     "2026-07-19",
    codename: "Genesis",
    summary:  "Teams (TKT-4N18SL): group users into teams (new admin-only Teams page) so an Epic can be assigned to a team as well as a single user. A new \"Apply to Children\" action on an Epic's preview panel cascades its assignee/team down to every child ticket — always an explicit, confirmed action showing exactly which children will change before committing, never automatic or silent, so a child deliberately assigned to someone else isn't clobbered without the user seeing it coming first.",
  },
  {
    version:  "0.2.0",
    date:     "2026-07-13",
    codename: "Genesis",
    summary:  "Test artifacts (Test Folder/Plan/Run/Case) moved out of the shared tickets table into a dedicated test_items repository with its own routes and API namespace — no longer mixed with Integration Board tickets. Added a Test Case ↔ Story link (\"Tests\" / \"Is tested by\"), visible from both sides. TicketPreview footer redesigned: Backlog and prev/next status stay inline; Edit, Delete, Coverage, and Diagram moved behind the ⚙ actions menu. Added a User Manual page and an app-wide footer with version and copyright info.",
  },
  {
    version:  "0.1.1",
    date:     "2026-07-13",
    codename: "Genesis",
    summary:  "Hotfix. Fixed a crash on the login page (missing SSO config endpoint). Added admin User Management page (create/edit/deactivate/delete, role assignment). Added login lockout after repeated failed attempts, with admin unlock. Fixed a bug where a backend outage or network blip would silently wipe a valid session — the app now shows a reconnect state and auto-recovers instead of forcing re-login.",
  },
  {
    version:  "0.1.0",
    date:     "2026-07-12",
    codename: "Genesis",
    summary:  "Initial standalone release. Board, Releases, Test Plans, Test Runs, Test Cases extracted from CargoDesk. Multi-project support, structured versions, folder-tree test cases, inline TC execution.",
  },
];

export const COPYRIGHT_YEAR  = "2026";
export const COPYRIGHT_OWNER = "Athena";
