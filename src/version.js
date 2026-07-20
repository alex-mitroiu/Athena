export const VERSION  = "0.14.7";
export const BUILD    = "2026-07-20";
export const CODENAME = "Genesis";

export const CHANGELOG = [
  {
    version:  "0.14.7",
    date:     "2026-07-20",
    codename: "Genesis",
    summary:  "Inline image paste and embed (TKT-8LE2SZ): pasting or dragging an image straight into a ticket description or comment now uploads it through the existing ticket_attachments pipeline and embeds it inline as standard Markdown image syntax, instead of only being addable as a separate attachment below the ticket — an \"Uploading…\" placeholder shows immediately and swaps for the real image reference once the upload resolves. Only available once a ticket actually exists to attach to (same constraint the separate Attachments panel already had for a not-yet-created ticket), so it's wired into the comment box and the ticket edit form's description field, not test items' or releases' free-text fields. Rendering required its own fix: the upload endpoint is auth-gated (correctly — anyone with a guessed URL shouldn't be able to view attachments), but a plain <img src> can't attach a bearer token, so the Markdown renderer now fetches uploaded images itself and hands the <img> a blob URL rather than the raw API path directly; externally-linked image URLs still render as a normal <img src> unchanged.",
  },
  {
    version:  "0.14.6",
    date:     "2026-07-20",
    codename: "Genesis",
    summary:  "At-mention autocomplete (TKT-LQCH4B): the shared Textarea (every description, comment, and notes field) now offers a real @-triggered typeahead instead of requiring a user to type someone's exact name blind — type @ plus a few letters, pick from a caret-anchored dropdown (arrow keys + Enter/Tab, or a click), and it inserts the same \"@Full Name\" text the existing comment-mention notifier already parses, so notifications keep firing exactly as before. The admin-only GET /api/users was the wrong data source for this (locked to admin role, and returns far more than a name), so this added one small GET /api/users/mentionable endpoint — any logged-in user, id+name only — rather than exposing the admin user list or leaving the feature broken for non-admins.",
  },
  {
    version:  "0.14.5",
    date:     "2026-07-20",
    codename: "Genesis",
    summary:  "Team capacity planning per sprint (TKT-638U24): the Sprint board now shows a capacity row per team with tickets in the active sprint — headcount (from the team's existing member roster) times a new admin-configurable \"points per person per sprint\" constant (Application Settings' new Sprint Capacity panel, same tuned-guess idiom as the Monte Carlo estimator), compared against that team's own allocated story points for the sprint, with an over-allocated team flagged with a red bar and an ⚠ Over badge.",
  },
  {
    version:  "0.14.4",
    date:     "2026-07-20",
    codename: "Genesis",
    summary:  "Three roadmap-adjacent features, all building on the cross-project Roadmap page. Initiative hierarchy (TKT-U2SCAK): a new Initiative ticket type sits above Epic — a program spanning several Epics, potentially across projects — with an Epic gaining an optional Initiative picker (plus inline \"+ New\") in its edit form, and a new \"By Initiative\" grouped view alongside the Roadmap's existing Swimlanes/Gantt toggle. Dependency mapping and critical path (TKT-D01O9T): the Gantt view now surfaces the existing \"Blocks\" ticket-link graph among the Epics it's plotting — a 🔗 indicator with a blocked-by/blocks tooltip on any Epic with dependencies, a ring highlight on Epics sitting on the critical path, and a callout above the chart naming the longest blocking chain so a slipping upstream Epic visibly threatens everything after it. Cross-project release milestones (TKT-5NQWK5): a new milestone groups one version from each of several projects under a shared target date with a rolled-up completion percentage — e.g. three teams all shipping against the same launch date — shown as its own panel on both the Roadmap and Releases pages.",
  },
  {
    version:  "0.14.3",
    date:     "2026-07-20",
    codename: "Genesis",
    summary:  "X-Ray-style structured test steps: a Test Case's old free-text \"Test Steps\" field is replaced by a proper Step / Test Data / Expected Result table (new test_case_steps table, shared TestStepsPanel component), where each step is executed and marked Pass/Fail/Blocked independently — the case's overall status now rolls up automatically from its steps (any Fail → Testing Failed, any Blocked → Cancelled, all Pass → Done) once at least one step exists, leaving cases with no steps driven exactly as before by their own manual buttons. Existing free-text notes are kept visible read-only (labelled Legacy Notes) rather than discarded, since there's no reliable way to auto-parse them into steps. Configurable transition requirements (\"custom behaviors\"): a workflow transition can now optionally demand a linked ticket or a specific field be set before it's allowed to fire — e.g. moving to Test Failed can require a link, moving to Released can require Version already set — configured per-transition in the Projects page's Workflow tab (new Requirement builder on the add/edit transition form, plus the edit affordance that tab was missing until now) and enforced server-side on every ticket status change, including bulk moves. Fixed a real, previously-silent gap this surfaced: rejected status changes (from either this or the existing workflow-transition graph) were unhandled on the frontend — a dragged card would stay visually in the wrong column with no explanation, and a bulk action's success toast always claimed every ticket updated even when some were silently skipped. Both now report exactly which tickets were skipped and why, and a rejected drag/move reverts and explains itself instead of going silent.",
  },
  {
    version:  "0.14.2",
    date:     "2026-07-20",
    codename: "Genesis",
    summary:  "Sidebar icon set replaced: every nav item's emoji swapped for a proper line-style icon from MingCute (Apache-2.0), rendered as real SVG via a new shared Icon component (components/primitives/Icon.jsx) instead of relying on the OS's emoji font. The ⚙ settings/cog glyph got the same treatment everywhere it appears — the shared ActionMenu trigger (used on every ticket card and elsewhere), the header's Application Settings menu item, the Kanban WIP-limit and Board Settings buttons — using MingCute's actual gear-shaped settings icon rather than its sliders-style alternate, to stay a literal cog. Only the source SVGs actually used were kept in the vendored mingcute-icons-main reference folder (~24MB trimmed to under 1MB); everything else was removed since the paths are now self-contained in Icon.jsx. Scoped to sidebar navigation and the settings icon for this pass; smaller inline symbols elsewhere (edit/delete/warning glyphs, status badges) remain emoji for now.",
  },
  {
    version:  "0.14.1",
    date:     "2026-07-20",
    codename: "Genesis",
    summary:  "Hotfix: Test Plans and Test Runs had no way to create a new one from their own dedicated pages — that capability only ever existed on the Kanban board's Tests tab (TestSuiteView), which isn't where a user looking at the Test Plans or Test Runs nav page would think to look. Both pages now have their own \"+ New\" button and create/edit modal (Test Plans also gets \"+ New Folder\"), matching the create flow Test Cases already had. A Test Run's modal requires picking its parent Test Plan since a run can't exist without one; if no plans exist yet, it explains that instead of showing a broken picker.",
  },
  {
    version:  "0.14.0",
    date:     "2026-07-20",
    codename: "Genesis",
    summary:  "Cross-project Roadmap (TKT-NWEV3B): a new top-level Roadmap page (admin/operator visible) aggregates Epics and versions across every project you can access into the same Swimlanes/Gantt view the per-project board tab already used — reusing that rendering logic rather than duplicating it — with project filter chips to narrow back down when the combined view gets noisy. Clicking a ticket opens a lightweight read-only summary rather than the board's full ticket preview, since that component is deeply wired into the single-project Kanban board's own state and pulling it out was a bigger lift than this ticket asked for.",
  },
  {
    version:  "0.13.0",
    date:     "2026-07-20",
    codename: "Genesis",
    summary:  "Rich text rollout (TKT-943ZKJ): the Markdown toolbar and renderer now cover every remaining text field — version descriptions on Releases and description/test steps on Test Cases — completing the wave started by the shared-Textarea foundation. Every long-form text box in Athena now supports the same formatting, and every read-only display of that text renders it the same way.",
  },
  {
    version:  "0.12.0",
    date:     "2026-07-20",
    codename: "Genesis",
    summary:  "Rich text formatting (TKT-H2FCMK): the shared Textarea used for ticket descriptions, comments, and test notes gained a Markdown toolbar — bold, italic, strikethrough, heading, bullet/numbered/checkbox lists, link, inline code, code block, quote, table — instead of staying plain prose. A new Markdown renderer displays that formatting everywhere the text was already shown read-only, built as real React elements (never raw HTML) since this is user-authored content. No schema change — same TEXT columns, just Markdown syntax inside them, and existing plain-text tickets/comments still render correctly since a paragraph with no markdown just renders as itself. Version description and test case fields don't have the toolbar yet — they're on their own textareas, a separate follow-on.",
  },
  {
    version:  "0.11.1",
    date:     "2026-07-20",
    codename: "Genesis",
    summary:  "Links joins Comments and Files on the ticket preview's Overview page instead of its own tab, with a matching quick-nav entry — the same Jira-aligned move from the previous release, now covering all three. Links now load as soon as the preview opens rather than only once the (now-removed) tab was clicked.",
  },
  {
    version:  "0.11.0",
    date:     "2026-07-20",
    codename: "Genesis",
    summary:  "Ticket preview redesign, matching Jira's own layout: Comments and Files (Attachments) moved off their own tabs onto the main Overview view — the things people check most often no longer need an extra click — alongside a quick-nav rail on the panel's edge to jump straight to Description, Children, Comments, or Files instead of scrolling. Links, Order, Time, and Activity remain separate tabs. Also fixed a real gap: the Activity tab only ever showed status moves, so a priority bump (or any other field edit) silently vanished from a ticket's history. A new generic field-change log now captures title/priority/type/assignee/team/version/sprint/story-point edits and merges them into the same chronological Activity feed as status changes.",
  },
  {
    version:  "0.10.1",
    date:     "2026-07-20",
    codename: "Genesis",
    summary:  "Two gaps closed in the Workflow diagram editor: a \"Delete status\" action (inspector panel and Text view both), wired to the existing safeguards — the last status in a project and any status still holding tickets can't be deleted. And transitions can now be created by connecting the dots directly on the diagram: drag from a status node's connector handle to another node, and the Add Transition form opens pre-filled with that From/To pair, cursor in the name field, instead of only being addable through the separate form.",
  },
  {
    version:  "0.10.0",
    date:     "2026-07-20",
    codename: "Genesis",
    summary:  "Multiple boards per project (TKT-G3AY4J): a project keeps one continuous shared workflow, but different teams can now each work their own filtered slice of it — e.g. a business team's board shows Created through Analysis Done (and later, UAT), while the dev team's board shows Ready through In Testing. A board is a selection over the same workflow graph, not an independent status list: assigning statuses to a board happens by clicking nodes directly on the Workflow diagram, and a status with no transitions in the project's workflow can't be added to any board. Every existing project got a \"Main Board\" covering all of its current statuses at migration time, so nothing changes until an admin deliberately creates more boards. The Kanban board's project switcher is now a two-level Project → Board switcher. Also relocated: Workflow configuration (added last wave) moved from the Kanban board's Board Settings modal to the Projects admin page, alongside the new Boards management — both are structural, rarely-changed project config, the same tier as Project Lead/Members, not day-to-day working config like Columns/Versions/Sprints.",
  },
  {
    version:  "0.9.0",
    date:     "2026-07-20",
    codename: "Genesis",
    summary:  "Resizable ticket preview panel — drag the left edge to widen or narrow it, width persists across sessions. Configurable workflows (TKT-188OHK): a project's statuses now carry a category (To Do / In Progress / Done) that drives report logic project-wide, replacing the hardcoded status-name matching that silently broke if a column was renamed. A new \"Workflow\" tab in Board Settings adds named transitions between statuses (not just free drag-and-drop) with an \"Any\"-source wildcard for statuses reachable from anywhere, enforced server-side on every status change — a project with no transitions defined stays fully unrestricted, so this ships as an opt-in tightening, not a retroactive lockout. Configuration happens in a visual node-graph diagram (draggable, persisted status positions, category-colored borders, an Any badge, click a node to fold out its details/incoming/outgoing transitions) or a simpler Text/table view, matching Jira's own Diagram/Text toggle. Multiple boards per project and the richer text-entry/formatting wave remain planned but not yet built.",
  },
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
