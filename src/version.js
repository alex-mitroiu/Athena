export const VERSION  = "0.8.0";
export const BUILD    = "2026-07-20";
export const CODENAME = "Genesis";

export const CHANGELOG = [
  {
    version:  "0.8.0",
    date:     "2026-07-20",
    codename: "Genesis",
    summary:  "Project management & reporting wave: Projects moved off the Kanban board's Board Settings modal into their own dedicated admin-only Projects page (create/edit, description, Project Lead, and Members/access) — Columns/Versions/Sprints/Baselines stay in Board Settings since those are day-to-day working config, not admin setup. Project Lead is a designation only, no new permission logic. A new \"📊 Reports\" board tab (visible to every role, read-only) adds five project reports: Overview (stat tiles + type/priority/assignee breakdown), Activity (a unified feed of status changes and comments across the project), Cumulative Flow Diagram, Time-in-Status / Cycle Time (with a sample-size disclosure for tickets that predate status-history tracking), and Velocity (completed vs. total story points per sprint). A new Needs-Attention Dashboard widget surfaces unassigned, overdue, and stale (no recent activity) tickets across every accessible project. Releases gets an \"⚠ Overdue\" badge when a version's release date has passed without reaching 100% done. Component-based ticket routing (TKT-S5K2ZC) was deliberately deferred as a bigger, separate lift.",
  },
  {
    version:  "0.7.0",
    date:     "2026-07-20",
    codename: "Genesis",
    summary:  "JIRA-parity wave: issue activity/history log (every real status transition, visible on a ticket's new Activity tab), Watchers (follow any ticket without being assigned), @Mentions in comments, and CSV export on the board/Test Cases/Test Plans. Project access control (MVP) — a new project_members model gates which projects a user can see at all (admin-managed via a new Members picker in Board Settings), enforced on the project list and the two ticket/test-item \"list everything\" endpoints; ticket sub-resource routes are a documented follow-up, not yet covered. GUI consistency pass: every dialog now closes on Escape or a backdrop click, all destructive actions use the same styled confirm dialog (no more native browser confirm popups), loading states are visually consistent across pages, and a few silent successful actions now show feedback.",
  },
  {
    version:  "0.6.0",
    date:     "2026-07-19",
    codename: "Genesis",
    summary:  "Top header on every page — breadcrumb, relocated notification bell, and a user-avatar dropdown (profile, theme toggle, User Manual, Sign Out). Azure AD / Entra ID SSO — a real, admin-configurable switch between Microsoft sign-in and local login (new Application Settings page), replacing the permanent stub; local email/password always remains available as a fallback. Delivery Estimation (Monte Carlo) — a new 🎲 action on any ticket runs 10,000 simulated passes through Integration/Testing/Patching/Release using admin-calibrated three-point (optimistic/likely/pessimistic) day-per-story-point assumptions, since no historical per-stage timing data exists yet to derive real distributions from — returns P50/P80/P95 day estimates, projected calendar dates, a histogram, and a per-stage breakdown. Estimates are directional (calendar days, not business days) and meant to be tuned as real delivery experience accumulates, not treated as calibrated from day one.",
  },
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
