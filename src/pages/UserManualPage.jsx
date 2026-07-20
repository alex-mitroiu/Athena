import { useState } from "react";
import { T } from "../tokens";

// ─── User Manual Page ─────────────────────────────────────────────────────────

const SECTIONS = [
  { id: "overview",  label: "Overview" },
  { id: "board",     label: "Integration Board" },
  { id: "testing",   label: "Test Management" },
  { id: "releases",  label: "Releases" },
  { id: "users",     label: "User Management" },
];

const SectionBtn = ({ id, active, label, onClick }) => (
  <button onClick={() => onClick(id)} style={{
    display: "block", width: "100%", textAlign: "left", padding: "8px 14px",
    background: active ? T.accentBg : "transparent",
    border: "none", borderLeft: `3px solid ${active ? T.accent : "transparent"}`,
    color: active ? T.accent : T.textMuted,
    fontFamily: T.body, fontSize: 13, fontWeight: active ? 600 : 400,
    cursor: "pointer", borderRadius: "0 6px 6px 0", marginBottom: 2,
  }}>{label}</button>
);

const H2 = ({ children }) => (
  <h2 style={{ fontFamily: T.head, fontSize: 20, fontWeight: 700, color: T.text, margin: "0 0 10px" }}>{children}</h2>
);
const H3 = ({ children }) => (
  <h3 style={{ fontFamily: T.head, fontSize: 15, fontWeight: 700, color: T.accent, margin: "20px 0 6px" }}>{children}</h3>
);
const P = ({ children }) => (
  <p style={{ fontFamily: T.body, fontSize: 14, color: T.text, lineHeight: 1.75, margin: "0 0 10px" }}>{children}</p>
);
const Tag = ({ children }) => (
  <code style={{ fontFamily: T.mono, fontSize: 12, color: T.accent, background: T.bg,
    border: `1px solid ${T.border}`, borderRadius: 4, padding: "1px 6px" }}>{children}</code>
);

const UserManualPage = () => {
  const [section, setSection] = useState("overview");

  const content = {
    overview: (
      <div>
        <H2>Athena — User Manual</H2>
        <P>Athena is an integration board and test management tool: an Epic → Story → Task Kanban board for tracking work, and a separate test repository (Folders → Plans → Runs → Cases) for tracking test coverage and execution — with a direct link between the two, so you can see exactly which test cases verify which story.</P>
        <H3>Navigation</H3>
        <P>The sidebar is split into <strong>Board</strong> (Integration Board, Releases, Test Plans, Test Runs, Test Cases) and, for admins, an <strong>Admin</strong> section (Users). Multiple projects are supported via the project switcher at the top of the Integration Board when more than one exists.</P>
        <H3>Roles</H3>
        <P><Tag>admin</Tag> — full access, including user management. <Tag>operator</Tag> — can create, edit, and delete tickets and test items. <Tag>viewer</Tag> — read-only.</P>
      </div>
    ),
    board: (
      <div>
        <H2>Integration Board</H2>
        <P>The Integration Board is a Kanban board for work-tracking items: <Tag>Epic</Tag>, <Tag>Story</Tag>, <Tag>Feature</Tag>, <Tag>Bug</Tag>, <Tag>Improvement</Tag>, <Tag>Task</Tag>, and <Tag>Chore</Tag>. It has three views, switchable from the tabs at the top: <Tag>📋 Board</Tag>, <Tag>🗺 Roadmap</Tag>, and <Tag>🧪 Tests</Tag> (see Test Management).</P>
        <H3>Creating and moving tickets</H3>
        <P>Click <strong>＋ Add Ticket</strong> to create one. Drag a card between columns to change its status, or use the <strong>←</strong> / <strong>→</strong> buttons in the preview panel footer to step it one column at a time. Moving a ticket out of <Tag>In Testing</Tag> prompts a Pass/Fail outcome first.</P>
        <H3>Preview panel actions</H3>
        <P>Clicking a card opens a preview on the right. Backlog and the previous/next status buttons stay directly in the footer since they're used constantly; everything else — <strong>Edit</strong>, <strong>Delete</strong>, and (for Epics) <strong>Coverage</strong> and <strong>Diagram</strong> — lives one click away behind the settings button.</P>
        <H3>Links</H3>
        <P>Open a ticket's Edit modal or its preview's Links tab to connect it to other tickets — <Tag>Relates to</Tag>, <Tag>Blocks</Tag>, <Tag>Duplicates</Tag>, or <Tag>Implements</Tag>. A Story also shows a read-only <strong>Tested By</strong> list of any Test Cases linked to it — see Test Management for how that link is created.</P>
        <H3>Backlog and WIP limits</H3>
        <P>Click <strong>Backlog</strong> in the toolbar to see tickets parked outside the active columns. Set a per-column WIP limit via the column header — it turns amber at the limit and red when exceeded.</P>
      </div>
    ),
    testing: (
      <div>
        <H2>Test Management</H2>
        <P>Test artifacts — <Tag>Test Folder</Tag>, <Tag>Test Plan</Tag>, <Tag>Test Run</Tag>, and <Tag>Test Case</Tag> — live in their own repository, completely separate from Integration Board tickets. You can manage them either from the board's <Tag>🧪 Tests</Tag> tab, or from the dedicated <strong>Test Plans</strong>, <strong>Test Runs</strong>, and <strong>Test Cases</strong> pages in the sidebar — both surfaces read and write the same data.</P>
        <H3>Hierarchy</H3>
        <P>A <Tag>Test Folder</Tag> organises Test Plans (and can nest other folders). A <Tag>Test Plan</Tag> contains <Tag>Test Runs</Tag> (execution cycles) or Test Cases directly. A <Tag>Test Run</Tag> contains the Test Cases being executed in that cycle. Reorganize by dragging a folder, plan, run, or case onto a new parent in the Tests tab.</P>
        <H3>Executing a test case</H3>
        <P>Hover a test case row to reveal <Tag>✓ Pass</Tag>, <Tag>✗ Fail</Tag>, <Tag>⊘ Blocked</Tag>, and <Tag>⟳ Reset</Tag> — these set its execution status directly. Pass/fail/blocked counts and a pass-rate bar roll up automatically at the Run and Plan level.</P>
        <H3>Linking a Test Case to a Story</H3>
        <P>Open a Test Case (edit or preview) and use the <strong>Tests (Story)</strong> panel to search for and link a Story — this is a fixed, one-directional-by-design relationship: the Test Case <Tag>Tests</Tag> the Story, and the Story shows it as <Tag>Is tested by</Tag> in its own Links section. Use this to track which stories have test coverage and which don't.</P>
      </div>
    ),
    releases: (
      <div>
        <H2>Releases</H2>
        <P>Releases track versions for the current project. Each version has a status (<Tag>Planning</Tag>, etc.) and an optional release date. Assign a ticket to a version from its Edit modal — the version then shows as a badge on the card and can be used to filter the board.</P>
      </div>
    ),
    users: (
      <div>
        <H2>User Management</H2>
        <P>Admins can manage users from the <strong>Users</strong> page under the Admin section of the sidebar.</P>
        <H3>Creating and editing users</H3>
        <P>Click <strong>+ New User</strong> to create an account (name, email, password, roles). Edit an existing user to change their name, roles, active status, or reset their password.</P>
        <H3>Account lockout</H3>
        <P>After 5 failed login attempts, an account locks for 30 minutes. A locked account shows a <Tag>Locked</Tag> badge with the attempt count; an admin can click <strong>Unlock</strong> to clear it immediately.</P>
      </div>
    ),
  };

  return (
    <div style={{ display: "flex", gap: 28, padding: 24, overflowY: "auto", flex: 1 }}>
      {/* Sidebar TOC */}
      <div style={{ width: 180, flexShrink: 0 }}>
        <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.textMuted, fontWeight: 700,
          textTransform: "uppercase", letterSpacing: ".1em", padding: "0 14px 8px" }}>Contents</div>
        {SECTIONS.map(s => (
          <SectionBtn key={s.id} id={s.id} label={s.label} active={section === s.id} onClick={setSection} />
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0, maxWidth: 720 }}>
        {content[section]}
      </div>
    </div>
  );
};

export default UserManualPage;
