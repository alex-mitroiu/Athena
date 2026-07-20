import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import mermaid from "mermaid";
import { T } from "../tokens";
import { inputBase } from "../components/primitives/Form";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import { Modal, ConfirmModal } from "../components/primitives/Modal";
import Btn from "../components/primitives/Btn";
import Badge from "../components/primitives/Badge";
import Spinner from "../components/primitives/Spinner";
import ActionMenu from "../components/primitives/ActionMenu";
import TestCaseStoryLinksPanel from "../components/shared/TestCaseStoryLinksPanel";
import { Inp, Sel, Textarea } from "../components/primitives/Form";
import { toast } from "../toast";
import { downloadCSV } from "../csv";

// ─── Constants ────────────────────────────────────────────────────────────────

const COLUMNS = ["Ready", "In Progress", "Done", "In Testing", "Testing Failed", "Ready to Deploy", "Released"];

const SECTIONS = [
  "General", "Shipments", "Dashboard", "Contracts", "Cost Control",
  "Vessels", "Port Locations", "Carriers", "Trade Lanes", "Countries",
  "UN Location Codes", "Customers", "API / Backend", "UI / UX", "Landing Page", "Kanban",
];

const LINK_TYPES = ["Relates to", "Blocks", "Duplicates", "Implements", "Satisfies"];
const INVERSE_LABEL = { "Blocks": "Is blocked by", "Duplicates": "Is duplicated by", "Implements": "Is implemented by", "Relates to": "Relates to", "Satisfies": "Is satisfied by" };

// Requirement (TKT-L9ZW5G) — a dedicated type distinct from Story: a Story is
// delivery work, a Requirement is the thing being satisfied. Linked via the
// existing ticket_links mechanism (new "Satisfies" type) rather than a bespoke
// relation table — no new backend concept needed beyond one more link_type value.
const TYPES = ["Epic", "Requirement", "Story", "Feature", "Bug", "Improvement", "Task", "Chore"];
const TEST_TYPES = ["Test Folder", "Test Plan", "Test Run", "Test Case"];
const TEST_STATUSES = ["Ready", "In Progress", "In Testing", "Testing Failed", "Done", "Ready to Deploy", "Released", "Cancelled"];
const TEST_PARENT_TYPES = { "Test Run": ["Test Plan"], "Test Case": ["Test Run", "Test Plan"] };

const TYPE_ICON = {
  Epic:          "⚡",
  Requirement:   "📐",
  Story:         "📖",
  Feature:       "✨",
  Bug:           "🦟",
  Improvement:   "🔨",
  Task:          "☑",
  Chore:         "🔧",
  "Test Plan":   "📋",
  "Test Run":    "▶",
  "Test Case":   "🧪",
  "Test Folder": "📁",
};

const TYPE_VARIANT = {
  Epic:          "warning",
  Requirement:   "purple",
  Story:         "info",
  Feature:       "info",
  Bug:           "danger",
  Improvement:   "success",
  Task:          "default",
  Chore:         "warning",
  "Test Plan":   "warning",
  "Test Run":    "info",
  "Test Case":   "default",
  "Test Folder": "warning",
};

const PRIORITIES = ["Critical", "High", "Medium", "Low"];

const PRIORITY_VARIANT = {
  Critical: "danger", High: "warning", Medium: "info", Low: "default",
};

const APPROVAL_COLOR = { Pending: "#f59e0b", Approved: "#22c55e", Rejected: "#ef4444" };

const PRIORITY_DOT = {
  Critical: T?.danger  || "#ef4444",
  High:     T?.warning || "#f59e0b",
  Medium:   T?.info    || "#3b82f6",
  Low:      T?.border  || "#6b7280",
};

const COL_ACCENT = {
  "Ready":          "#6366f1",
  "In Progress":    "#f59e0b",
  "Done":           "#22c55e",
  "In Testing":     "#06b6d4",
  "Testing Failed":  "#ef4444",
  "Ready to Deploy": "#f97316",
  "Released":        "#8b5cf6",
};

const PREVIEW_LIMIT = 5;

// Returns true when a due date string (YYYY-MM-DD) is strictly in the past.
const isOverdue = d => d && d < new Date().toISOString().slice(0, 10);

// Deterministic colour for an assignee avatar based on their user ID.
// Cycles through a fixed palette so the same person always gets the same colour.
const AVATAR_PALETTE = ["#6366f1","#f59e0b","#22c55e","#06b6d4","#ef4444","#8b5cf6","#ec4899","#14b8a6"];
const avatarColor = id => AVATAR_PALETTE[(id || "").split("").reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_PALETTE.length];

// ─── Mermaid Renderer ─────────────────────────────────────────────────────────
// Renders a Mermaid diagram definition to SVG client-side.
// Each instance uses a unique ID so concurrent renders don't collide.
// Re-mounts (via key) when the definition changes to avoid stale SVG.

const MermaidRenderer = ({ definition }) => {
  const [svg,   setSvg]   = useState("");
  const [error, setError] = useState(null);
  // Unique stable ID for this renderer instance
  const diagId = useRef(`mcd-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    let cancelled = false;
    setSvg("");
    setError(null);

    mermaid.initialize({
      startOnLoad: false,
      theme:       "dark",
      flowchart:   { curve: "basis", padding: 24, nodeSpacing: 48, rankSpacing: 64 },
      securityLevel: "loose",   // needed to allow <br/> in node labels
    });

    mermaid.render(diagId.current, definition)
      .then(({ svg: out }) => { if (!cancelled) setSvg(out); })
      .catch(e            => { if (!cancelled) setError(String(e)); });

    return () => { cancelled = true; };
  }, [definition]);

  if (error) return (
    <div style={{ padding: 20, fontFamily: T.mono, fontSize: 12, color: T.danger,
      background: `${T.danger}11`, borderRadius: 8, margin: 16 }}>
      ⚠ Diagram render error — check the definition syntax.<br />
      <span style={{ opacity: 0.7, fontSize: 11 }}>{error}</span>
    </div>
  );

  if (!svg) return (
    <div style={{ padding: 48, textAlign: "center", fontFamily: T.body,
      fontSize: 13, color: T.textMuted }}>
      Rendering diagram…
    </div>
  );

  return (
    <div dangerouslySetInnerHTML={{ __html: svg }}
      style={{ width: "100%", display: "flex", justifyContent: "center" }} />
  );
};

// ─── Ticket Diagram Modal ─────────────────────────────────────────────────────
// Shows two views for an Epic:
//   Hierarchy  — parent → child tree for all descendants
//   Dependencies — directed graph of Blocks / Implements / etc. links within the epic
// Links are fetched in parallel on open; the hierarchy renders immediately from props.

const TicketDiagramModal = ({ ticket, allTickets, onClose }) => {
  const [links,       setLinks]       = useState({});   // ticketId → link[]
  const [linksLoaded, setLinksLoaded] = useState(false);
  const [view,        setView]        = useState("hierarchy");

  // Collect all descendants of this Epic recursively (breadth-first).
  const descendants = useMemo(() => {
    const result = [], queue = [ticket.id], seen = new Set([ticket.id]);
    while (queue.length) {
      const pid = queue.shift();
      allTickets
        .filter(t => t.parentId === pid)
        .forEach(t => { if (!seen.has(t.id)) { seen.add(t.id); result.push(t); queue.push(t.id); } });
    }
    return result;
  }, [ticket.id, allTickets]);

  const epicGroup = useMemo(() => [ticket, ...descendants], [ticket, descendants]);

  // Fetch links for every ticket in the group in parallel.
  useEffect(() => {
    Promise.all(epicGroup.map(t =>
      api.tickets.links(t.id)
        .then(ls => ({ id: t.id, ls }))
        .catch(()  => ({ id: t.id, ls: [] }))
    )).then(results => {
      const map = {};
      results.forEach(r => { map[r.id] = r.ls; });
      setLinks(map);
      setLinksLoaded(true);
    });
  }, [ticket.id]);   // re-fetch only when the root ticket changes

  // Safe Mermaid node ID — hyphens are not allowed.
  const sid = id => id.replace(/-/g, "_");

  // ── Hierarchy diagram definition ──────────────────────────────────────────
  const hierarchyDef = useMemo(() => {
    const lines = ["flowchart TD"];
    epicGroup.forEach(t => {
      const icon  = TYPE_ICON[t.type] || "📋";
      const label = t.title.length > 38 ? t.title.slice(0, 38) + "…" : t.title;
      const done  = ["Done", "Ready to Deploy", "Released"].includes(t.status);
      // Different node shapes: Epic = stadium, Story = rect, others = rounded rect
      const [o, c] = t.type === "Epic"  ? (["([", "])"])
                   : t.type === "Story" ? (["[",  "]" ])
                   :                      (["(",  ")" ]);
      lines.push(`  ${sid(t.id)}${o}"${icon} ${t.id}\\n${label}"${c}`);
      if (done) lines.push(`  style ${sid(t.id)} opacity:0.55`);
    });
    descendants.forEach(t => {
      if (t.parentId) lines.push(`  ${sid(t.parentId)} --> ${sid(t.id)}`);
    });
    return lines.join("\n");
  }, [epicGroup, descendants]);

  // ── Dependency diagram definition ─────────────────────────────────────────
  const dependencyDef = useMemo(() => {
    if (!linksLoaded) return "flowchart LR\n  loading[\"⏳ Loading links…\"]";

    const epicIds = new Set(epicGroup.map(t => t.id));
    const edges   = [];

    epicGroup.forEach(t => {
      (links[t.id] || [])
        .filter(l => l.direction === "out" && epicIds.has(l.otherTicketId))
        .forEach(l => {
          const arrow = l.linkType === "Blocks"     ? "-->"
                      : l.linkType === "Implements" ? "-..->"
                      : l.linkType === "Duplicates" ? "==>"
                      :                               "--->";
          edges.push({ from: t.id, to: l.otherTicketId, arrow, label: l.linkType.toLowerCase() });
        });
    });

    if (edges.length === 0) return (
      "flowchart LR\n  none[\"No dependency links between\\ntickets in this Epic\"]"
    );

    const involvedIds = new Set(edges.flatMap(e => [e.from, e.to]));
    const lines = ["flowchart LR"];
    [...involvedIds].forEach(id => {
      const t     = epicGroup.find(e => e.id === id);
      if (!t) return;
      const icon  = TYPE_ICON[t.type] || "📋";
      const label = t.title.length > 30 ? t.title.slice(0, 30) + "…" : t.title;
      lines.push(`  ${sid(id)}["${icon} ${id}\\n${label}"]`);
    });
    edges.forEach(e =>
      lines.push(`  ${sid(e.from)} ${e.arrow}|"${e.label}"| ${sid(e.to)}`)
    );
    return lines.join("\n");
  }, [linksLoaded, links, epicGroup]);

  const currentDef = view === "hierarchy" ? hierarchyDef : dependencyDef;

  const TAB_BTN = active => ({
    fontFamily: T.body, fontSize: 13, fontWeight: active ? 700 : 400,
    padding: "10px 20px", background: "none", border: "none", cursor: "pointer",
    color:       active ? T.accent    : T.textMuted,
    borderBottom: active ? `2px solid ${T.accent}` : "2px solid transparent",
    transition: "color .12s",
  });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10001,
      background: "rgba(0,0,0,.65)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: "min(92vw, 900px)", maxHeight: "88vh", background: T.surface,
        border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden",
        display: "flex", flexDirection: "column", boxShadow: "0 28px 80px rgba(0,0,0,.55)" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>🏔</span>
            <div>
              <div style={{ fontFamily: T.head, fontSize: 15, fontWeight: 700, color: T.text }}>
                {ticket.title}
              </div>
              <div style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted }}>
                {ticket.id} · {epicGroup.length} ticket{epicGroup.length !== 1 ? "s" : ""}
              </div>
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer",
              color: T.textMuted, fontSize: 22, lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", alignItems: "center",
          borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <button type="button" onClick={() => setView("hierarchy")} style={TAB_BTN(view === "hierarchy")}>
            🌳 Hierarchy
          </button>
          <button type="button" onClick={() => setView("dependencies")} style={TAB_BTN(view === "dependencies")}>
            🔗 Dependencies
          </button>
          {!linksLoaded && view === "dependencies" && (
            <span style={{ fontFamily: T.body, fontSize: 11, color: T.textMuted,
              marginLeft: 8, fontStyle: "italic" }}>
              loading links…
            </span>
          )}
        </div>

        {/* Diagram canvas — key forces MermaidRenderer to remount on view/def change */}
        <div style={{ flex: 1, overflowY: "auto", overflowX: "auto",
          background: T.bg, padding: 16, display: "flex", justifyContent: "center" }}>
          <MermaidRenderer key={currentDef} definition={currentDef} />
        </div>
      </div>
    </div>
  );
};

// ─── Epic Coverage Modal ──────────────────────────────────────────────────────
// Full-screen coverage analysis for an Epic: progress bar, phase cards (one per
// direct Story child), item rows for grandchildren, and a verdict block.

const DONE_COLS    = new Set(["Done", "Released", "Ready to Deploy"]);
const PARTIAL_COLS = new Set(["In Progress", "In Testing", "Testing Failed"]);
const coverStatus  = t => DONE_COLS.has(t.status) ? "done" : PARTIAL_COLS.has(t.status) ? "partial" : "todo";
const COVER_COLORS = { done: "#34d399", partial: "#fbbf24", todo: "#f87171" };
const COVER_LABELS = { done: "Done", partial: "In Progress", todo: "Not Started" };
const COVER_ICON   = { done: "✓", partial: "⚠", todo: "✗" };

const EpicCoverageModal = ({ ticket, allTickets, onClose, onPreview }) => {
  const descendants = useMemo(() => {
    const result = [], queue = [ticket.id], seen = new Set([ticket.id]);
    while (queue.length) {
      const pid = queue.shift();
      allTickets.filter(t => t.parentId === pid).forEach(t => {
        if (!seen.has(t.id)) { seen.add(t.id); result.push(t); queue.push(t.id); }
      });
    }
    return result;
  }, [ticket.id, allTickets]);

  const directChildren = descendants.filter(t => t.parentId === ticket.id);
  const phases    = directChildren.filter(t => ["Story", "Feature"].includes(t.type));
  const ungrouped = directChildren.filter(t => !["Story", "Feature"].includes(t.type));

  const phaseItems = phases.flatMap(p => descendants.filter(t => t.parentId === p.id));
  const countItems = phaseItems.length > 0 ? phaseItems : directChildren;
  const total = countItems.length;

  const doneCount    = countItems.filter(t => coverStatus(t) === "done").length;
  const partialCount = countItems.filter(t => coverStatus(t) === "partial").length;
  const todoCount    = countItems.filter(t => coverStatus(t) === "todo").length;
  const donePct      = total ? Math.round(doneCount    / total * 100) : 0;
  const partialPct   = total ? Math.round(partialCount / total * 100) : 0;
  const todoPct      = total ? Math.round(todoCount    / total * 100) : 0;

  const phaseRollup = p => {
    const kids = descendants.filter(t => t.parentId === p.id);
    if (kids.length === 0) return coverStatus(p);
    if (kids.every(t => coverStatus(t) === "done"))  return "done";
    if (kids.some(t  => coverStatus(t) !== "todo"))  return "partial";
    return "todo";
  };

  const outstanding = countItems.filter(t => coverStatus(t) === "todo");
  const inProgress  = countItems.filter(t => coverStatus(t) === "partial");

  const CoverPill = ({ cs }) => (
    <span style={{
      fontFamily: T.mono, fontSize: 10, fontWeight: 700, letterSpacing: ".06em",
      textTransform: "uppercase", borderRadius: 4, padding: "2px 8px", flexShrink: 0,
      background: `${COVER_COLORS[cs]}18`, color: COVER_COLORS[cs],
      border: `1px solid ${COVER_COLORS[cs]}44`,
    }}>{COVER_LABELS[cs]}</span>
  );

  const ItemRow = ({ kid, isLast }) => {
    const cs = coverStatus(kid);
    return (
      <div
        onClick={() => onPreview?.(kid)}
        style={{ display: "grid", gridTemplateColumns: "20px 108px 1fr auto",
          alignItems: "start", gap: "8px 10px", padding: "10px 16px",
          borderBottom: isLast ? "none" : `1px solid ${T.border}22`,
          cursor: onPreview ? "pointer" : "default", transition: "background .1s" }}
        onMouseEnter={e => { if (onPreview) e.currentTarget.style.background = T.surfaceHover; }}
        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
        <span style={{ fontSize: 12, marginTop: 2, textAlign: "center",
          color: COVER_COLORS[cs], fontWeight: 700 }}>{COVER_ICON[cs]}</span>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.accent, paddingTop: 1 }}>{kid.id}</span>
        <div>
          <div style={{ fontFamily: T.body, fontSize: 13, color: T.text, lineHeight: 1.4 }}>{kid.title}</div>
          {kid.description && (
            <div style={{ fontFamily: T.body, fontSize: 11, color: T.textMuted, marginTop: 3,
              fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {kid.description.length > 110 ? kid.description.slice(0, 110) + "…" : kid.description}
            </div>
          )}
        </div>
        <CoverPill cs={cs} />
      </div>
    );
  };

  const PhaseCard = ({ phase }) => {
    const kids   = descendants.filter(t => t.parentId === phase.id);
    const rollup = phaseRollup(phase);
    return (
      <div style={{ background: T.bg, border: `1px solid ${T.border}`,
        borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10,
          padding: "11px 16px", borderBottom: `1px solid ${T.border}`, background: T.surface }}>
          <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700,
            letterSpacing: ".1em", textTransform: "uppercase", color: T.textMuted, flexShrink: 0 }}>
            {phase.type}
          </span>
          <span onClick={() => onPreview?.(phase)}
            style={{ fontFamily: T.mono, fontSize: 11, color: T.accent, flexShrink: 0,
              cursor: onPreview ? "pointer" : "default",
              textDecoration: onPreview ? "underline dotted" : "none" }}>
            {phase.id}
          </span>
          <span style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.text,
            flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {phase.title}
          </span>
          <CoverPill cs={rollup} />
        </div>
        {kids.length === 0 ? (
          <div style={{ padding: "10px 16px", fontFamily: T.body, fontSize: 12,
            color: T.textMuted, fontStyle: "italic" }}>No sub-tasks.</div>
        ) : kids.map((kid, idx) => (
          <ItemRow key={kid.id} kid={kid} isLast={idx === kids.length - 1} />
        ))}
      </div>
    );
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10001,
      background: "rgba(0,0,0,.65)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: "min(92vw, 860px)", maxHeight: "90vh", background: T.surface,
        border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden",
        display: "flex", flexDirection: "column", boxShadow: "0 28px 80px rgba(0,0,0,.55)" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>📊</span>
            <div>
              <div style={{ fontFamily: T.head, fontSize: 15, fontWeight: 700, color: T.text }}>
                {ticket.title}
              </div>
              <div style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted }}>
                {ticket.id} · Coverage analysis · {total} item{total !== 1 ? "s" : ""}
              </div>
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer",
              color: T.textMuted, fontSize: 22, lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 24px 32px" }}>

          {/* Coverage bar */}
          {total > 0 && (
            <div style={{ background: T.bg, border: `1px solid ${T.border}`,
              borderRadius: 10, padding: "16px 20px", marginBottom: 24,
              display: "flex", alignItems: "center", gap: 20 }}>
              <div style={{ display: "flex", gap: 22, flexShrink: 0 }}>
                {[["done", doneCount, "Done"], ["partial", partialCount, "In Progress"], ["todo", todoCount, "Not Started"]].map(([s, n, lbl]) => (
                  <div key={s} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontFamily: T.mono, fontSize: 22, fontWeight: 800,
                      fontVariantNumeric: "tabular-nums", lineHeight: 1, color: COVER_COLORS[s] }}>{n}</span>
                    <span style={{ fontFamily: T.body, fontSize: 10, fontWeight: 700,
                      letterSpacing: ".08em", textTransform: "uppercase", color: T.textMuted }}>{lbl}</span>
                  </div>
                ))}
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ height: 8, borderRadius: 4, background: T.border,
                  overflow: "hidden", display: "flex" }}>
                  <div style={{ width: `${donePct}%`,    background: COVER_COLORS.done    }} />
                  <div style={{ width: `${partialPct}%`, background: COVER_COLORS.partial }} />
                  <div style={{ width: `${todoPct}%`,    background: COVER_COLORS.todo    }} />
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  {[["done","Done"],["partial","In Progress"],["todo","Not Started"]].map(([s,lbl]) => (
                    <span key={s} style={{ display: "flex", alignItems: "center", gap: 4,
                      fontFamily: T.body, fontSize: 11, color: T.textMuted }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%",
                        background: COVER_COLORS[s], flexShrink: 0 }} />
                      {lbl}
                    </span>
                  ))}
                  <span style={{ marginLeft: "auto", fontFamily: T.mono, fontSize: 12,
                    fontWeight: 700, color: T.text }}>
                    {doneCount} / {total} · {donePct}%
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Phase cards */}
          {phases.map(phase => <PhaseCard key={phase.id} phase={phase} />)}

          {/* Ungrouped direct tasks */}
          {ungrouped.length > 0 && (
            <div style={{ background: T.bg, border: `1px solid ${T.border}`,
              borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10,
                padding: "11px 16px", borderBottom: `1px solid ${T.border}`, background: T.surface }}>
                <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700,
                  letterSpacing: ".1em", textTransform: "uppercase", color: T.textMuted }}>Tasks</span>
                <span style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600,
                  color: T.text, flex: 1 }}>Direct tasks</span>
              </div>
              {ungrouped.map((kid, idx) => (
                <ItemRow key={kid.id} kid={kid} isLast={idx === ungrouped.length - 1} />
              ))}
            </div>
          )}

          {total === 0 && (
            <div style={{ textAlign: "center", padding: "60px 24px",
              fontFamily: T.body, fontSize: 14, color: T.textMuted, fontStyle: "italic" }}>
              This Epic has no child tickets yet.
            </div>
          )}

          {/* Verdict */}
          {total > 0 && (
            <div style={{ marginTop: 24, background: T.bg, border: `1px solid ${T.border}`,
              borderRadius: 10, overflow: "hidden" }}>
              <div style={{ background: T.surface, padding: "10px 16px",
                borderBottom: `1px solid ${T.border}`, fontFamily: T.mono,
                fontSize: 10, fontWeight: 700, letterSpacing: ".12em",
                textTransform: "uppercase", color: T.textMuted }}>
                Recommendation
              </div>
              <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                {doneCount === total ? (
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline",
                    fontFamily: T.body, fontSize: 13, color: T.text }}>
                    <span style={{ color: T.textMuted, flexShrink: 0, fontSize: 15 }}>→</span>
                    <span>All {total} items are done.{" "}
                      <span style={{ color: T.success, fontWeight: 600 }}>
                        This Epic is complete — consider marking it as Released.
                      </span>
                    </span>
                  </div>
                ) : (
                  <>
                    {inProgress.length > 0 && (
                      <div style={{ display: "flex", gap: 10, alignItems: "baseline",
                        fontFamily: T.body, fontSize: 13, color: T.text }}>
                        <span style={{ color: T.textMuted, flexShrink: 0, fontSize: 15 }}>→</span>
                        <span>
                          <span style={{ color: T.warning, fontWeight: 600 }}>
                            {inProgress.length} item{inProgress.length !== 1 ? "s" : ""} in progress
                          </span>
                          {" — "}{inProgress.slice(0, 3).map(t => t.id).join(", ")}
                          {inProgress.length > 3 ? ` and ${inProgress.length - 3} more` : ""}.
                        </span>
                      </div>
                    )}
                    {outstanding.length > 0 && (
                      <div style={{ display: "flex", gap: 10, alignItems: "baseline",
                        fontFamily: T.body, fontSize: 13, color: T.text }}>
                        <span style={{ color: T.textMuted, flexShrink: 0, fontSize: 15 }}>→</span>
                        <span>
                          <span style={{ color: T.danger, fontWeight: 600 }}>
                            {outstanding.length} item{outstanding.length !== 1 ? "s" : ""} not yet started
                          </span>
                          {" — "}{outstanding.slice(0, 3).map(t => t.id).join(", ")}
                          {outstanding.length > 3 ? ` and ${outstanding.length - 3} more` : ""}.
                        </span>
                      </div>
                    )}
                    {phases.some(p => phaseRollup(p) === "done") && (
                      <div style={{ display: "flex", gap: 10, alignItems: "baseline",
                        fontFamily: T.body, fontSize: 13, color: T.textMuted, fontStyle: "italic" }}>
                        <span style={{ flexShrink: 0, fontSize: 15 }}>→</span>
                        <span>
                          {phases.filter(p => phaseRollup(p) === "done").length} phase
                          {phases.filter(p => phaseRollup(p) === "done").length !== 1 ? "s" : ""} fully
                          complete — remaining work is isolated to the other phases.
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Test Outcome Modal ───────────────────────────────────────────────────────
// Shown when a ticket leaves "In Testing". Forces an explicit Pass / Fail
// decision and captures optional (Pass) or mandatory (Fail) test notes before
// the ticket is routed to "Ready to Deploy" or "Testing Failed".

const TestOutcomeModal = ({ ticket, onConfirm, onCancel }) => {
  const [outcome, setOutcome] = useState(null);    // "pass" | "fail"
  const [notes,   setNotes]   = useState(ticket.testNotes || "");
  const [touched, setTouched] = useState(false);

  const notesRequired = outcome === "fail";
  const notesEmpty    = notes.trim() === "";
  const invalid       = notesRequired && notesEmpty;

  const submit = () => {
    setTouched(true);
    if (!outcome || invalid) return;
    onConfirm({
      newStatus: outcome === "pass" ? "Ready to Deploy" : "Testing Failed",
      testNotes: notes.trim() || null,
    });
  };

  const BTN_BASE = {
    flex: 1, padding: "18px 12px", borderRadius: 10, cursor: "pointer",
    fontFamily: T.head, fontSize: 15, fontWeight: 700, border: "2px solid",
    transition: "all .15s", display: "flex", flexDirection: "column",
    alignItems: "center", gap: 6,
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10002,
      background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center",
      justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={{ width: "min(92vw, 460px)", background: T.surface,
        border: `1px solid ${T.border}`, borderRadius: 14,
        boxShadow: "0 28px 80px rgba(0,0,0,.6)", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "18px 20px 14px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontFamily: T.head, fontSize: 16, fontWeight: 800, color: T.text }}>
            Testing outcome
          </div>
          <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, marginTop: 3 }}>
            <span style={{ fontFamily: T.mono, fontSize: 11 }}>{ticket.id}</span>
            {" · "}{ticket.title.length > 52 ? ticket.title.slice(0, 52) + "…" : ticket.title}
          </div>
        </div>

        <div style={{ padding: "20px 20px 0" }}>
          {/* Pass / Fail choice */}
          <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
            <button type="button" onClick={() => setOutcome("pass")} style={{
              ...BTN_BASE,
              background:   outcome === "pass" ? `${T.success}18` : "none",
              borderColor:  outcome === "pass" ? T.success : T.border,
              color:        outcome === "pass" ? T.success : T.textMuted,
            }}>
              <span style={{ fontSize: 28 }}>✅</span>
              <span>Pass</span>
              <span style={{ fontFamily: T.body, fontSize: 11, fontWeight: 400,
                color: outcome === "pass" ? T.success : T.textMuted, opacity: .8 }}>
                → Ready to Deploy
              </span>
            </button>

            <button type="button" onClick={() => setOutcome("fail")} style={{
              ...BTN_BASE,
              background:   outcome === "fail" ? `${T.danger}18` : "none",
              borderColor:  outcome === "fail" ? T.danger : T.border,
              color:        outcome === "fail" ? T.danger : T.textMuted,
            }}>
              <span style={{ fontSize: 28 }}>❌</span>
              <span>Fail</span>
              <span style={{ fontFamily: T.body, fontSize: 11, fontWeight: 400,
                color: outcome === "fail" ? T.danger : T.textMuted, opacity: .8 }}>
                → Testing Failed
              </span>
            </button>
          </div>

          {/* Notes field — always visible, mandatory label swaps on outcome */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600,
              color: (touched && invalid) ? T.danger : T.text,
              display: "block", marginBottom: 6 }}>
              {outcome === "fail" ? "Failure reason *" : "Test notes"}
              {outcome === "pass" && (
                <span style={{ fontWeight: 400, color: T.textMuted, marginLeft: 4 }}>(optional)</span>
              )}
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={outcome === "fail"
                ? "Describe what failed — steps to reproduce, error messages, environment…"
                : "Any notes about what was tested or verified…"}
              rows={4}
              style={{
                width: "100%", resize: "vertical", boxSizing: "border-box",
                fontFamily: T.body, fontSize: 13, color: T.text,
                background: T.bg, borderRadius: 7, padding: "9px 12px",
                border: `1px solid ${(touched && invalid) ? T.danger : T.border}`,
                outline: "none", lineHeight: 1.5,
              }}
            />
            {touched && invalid && (
              <div style={{ fontFamily: T.body, fontSize: 11, color: T.danger, marginTop: 4 }}>
                A failure reason is required before marking as failed.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "0 20px 20px", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onCancel}
            style={{ fontFamily: T.body, fontSize: 13, padding: "8px 18px",
              background: "none", border: `1px solid ${T.border}`, borderRadius: 7,
              color: T.textMuted, cursor: "pointer" }}>
            Cancel
          </button>
          <button type="button" onClick={submit}
            disabled={!outcome}
            style={{ fontFamily: T.body, fontSize: 13, fontWeight: 700,
              padding: "8px 22px", borderRadius: 7, cursor: outcome ? "pointer" : "not-allowed",
              background: !outcome    ? T.border
                        : outcome === "pass" ? T.success : T.danger,
              border: "none", color: "#fff",
              opacity: !outcome ? 0.45 : 1,
              transition: "background .15s, opacity .15s" }}>
            {!outcome      ? "Select outcome"
             : outcome === "pass" ? "✅ Move to Ready to Deploy"
             :                      "❌ Move to Testing Failed"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Ticket Links Panel ───────────────────────────────────────────────────────

const TicketLinksPanel = ({ ticketId, allTickets = [] }) => {
  const [links,    setLinks]    = useState([]);
  const [adding,   setAdding]   = useState(false);
  const [search,   setSearch]   = useState("");
  const [linkType, setLinkType] = useState("Relates to");
  const [selected, setSelected] = useState(null);

  const load = () => api.tickets.links(ticketId).then(setLinks).catch(() => {});
  useEffect(() => { load(); }, [ticketId]);

  const linkedIds = new Set(links.map(l => l.otherTicketId));
  const candidates = search.trim().length > 1
    ? allTickets.filter(t =>
        t.id !== ticketId && !linkedIds.has(t.id) &&
        (t.id.toLowerCase().includes(search.toLowerCase()) ||
         t.title.toLowerCase().includes(search.toLowerCase()))
      ).slice(0, 6)
    : [];

  const handleAdd = async () => {
    if (!selected) return;
    try {
      await api.tickets.addLink(ticketId, { toId: selected.id, linkType });
      toast.success("Link added");
      setAdding(false); setSearch(""); setSelected(null);
      load();
    } catch (e) { toast.error(e.message); }
  };

  const handleRemove = async linkId => {
    try {
      await api.tickets.removeLink(linkId);
      setLinks(l => l.filter(x => x.id !== linkId));
    } catch (e) { toast.error(e.message); }
  };

  const sectionLbl = { fontFamily: T.body, fontSize: 10, fontWeight: 700, color: T.textMuted,
    textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8 };
  const inp = { fontFamily: T.body, fontSize: 12, color: T.text, background: T.bg,
    border: `1px solid ${T.border}`, borderRadius: 7, padding: "6px 10px",
    outline: "none", width: "100%", boxSizing: "border-box" };

  return (
    <div>
      <div style={sectionLbl}>Links</div>

      {links.map(l => (
        <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 8,
          padding: "5px 10px", marginBottom: 4, borderRadius: 6,
          background: T.bg, border: `1px solid ${T.border}` }}>
          <span style={{ fontFamily: T.body, fontSize: 10, fontWeight: 600, color: T.textMuted,
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4,
            padding: "1px 6px", flexShrink: 0, whiteSpace: "nowrap" }}>
            {l.displayType}
          </span>
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.accent, flexShrink: 0 }}>
            {l.otherTicketId}
          </span>
          <span style={{ fontFamily: T.body, fontSize: 12, color: T.text, flex: 1,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {l.otherTicket?.title || ""}
          </span>
          <button onClick={() => handleRemove(l.id)} title="Remove link"
            style={{ background: "none", border: "none", cursor: "pointer",
              color: T.textMuted, fontSize: 16, lineHeight: 1, padding: "0 2px", flexShrink: 0,
              transition: "color .12s" }}
            onMouseEnter={e => e.currentTarget.style.color = T.danger}
            onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>
            ×
          </button>
        </div>
      ))}

      {links.length === 0 && !adding && (
        <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic", marginBottom: 6 }}>
          No linked tickets.
        </div>
      )}

      {adding ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
          <input value={search}
            onChange={e => { setSearch(e.target.value); setSelected(null); }}
            placeholder="Search by ticket ID or title…" style={inp} autoFocus />
          {candidates.length > 0 && (
            <div style={{ border: `1px solid ${T.border}`, borderRadius: 7, overflow: "hidden" }}>
              {candidates.map((t, i) => (
                <div key={t.id}
                  onClick={() => { setSelected(t); setSearch(`${t.id} — ${t.title}`); }}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                    cursor: "pointer", borderBottom: i < candidates.length - 1 ? `1px solid ${T.border}22` : "none",
                    background: "transparent" }}
                  onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <span style={{ fontFamily: T.mono, fontSize: 11, color: T.accent, flexShrink: 0 }}>{t.id}</span>
                  <span style={{ fontFamily: T.body, fontSize: 12, color: T.text,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={linkType} onChange={e => setLinkType(e.target.value)}
              style={{ ...inp, flex: 1, width: "auto" }}>
              {LINK_TYPES.map(lt => <option key={lt}>{lt}</option>)}
            </select>
            <Btn size="sm" disabled={!selected} onClick={handleAdd}>Link</Btn>
            <Btn size="sm" variant="secondary" onClick={() => { setAdding(false); setSearch(""); setSelected(null); }}>Cancel</Btn>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)}
          style={{ fontFamily: T.body, fontSize: 12, color: T.accent, background: "none",
            border: `1px dashed ${T.accent}55`, borderRadius: 6, padding: "5px 12px",
            cursor: "pointer", width: "100%", textAlign: "left", marginTop: links.length ? 6 : 0 }}>
          ＋ Link ticket
        </button>
      )}
    </div>
  );
};

// ─── Tested By Panel (reverse direction — shown on a Story) ──────────────────

const TestedByPanel = ({ ticketId, testItems = [] }) => {
  const [links,    setLinks]    = useState([]);
  const [adding,   setAdding]   = useState(false);
  const [search,   setSearch]   = useState("");
  const [selected, setSelected] = useState(null);

  const load = () => api.tickets.testedBy(ticketId).then(setLinks).catch(() => {});
  useEffect(() => { load(); }, [ticketId]);

  const linkedIds = new Set(links.map(l => l.caseId));
  const cases = testItems.filter(t => t.type === "Test Case");
  const candidates = search.trim().length > 1
    ? cases.filter(t =>
        !linkedIds.has(t.id) &&
        (t.id.toLowerCase().includes(search.toLowerCase()) ||
         t.title.toLowerCase().includes(search.toLowerCase()))
      ).slice(0, 6)
    : [];

  const handleAdd = async () => {
    if (!selected) return;
    try {
      await api.testItems.addStoryLink(selected.id, { ticketId });
      toast.success("Linked to test case");
      setAdding(false); setSearch(""); setSelected(null);
      load();
    } catch (e) { toast.error(e.message); }
  };

  const handleRemove = async linkId => {
    try {
      await api.testItems.removeStoryLink(linkId);
      setLinks(l => l.filter(x => x.id !== linkId));
    } catch (e) { toast.error(e.message); }
  };

  const sectionLbl = { fontFamily: T.body, fontSize: 10, fontWeight: 700, color: T.textMuted,
    textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8 };
  const inp = { fontFamily: T.body, fontSize: 12, color: T.text, background: T.bg,
    border: `1px solid ${T.border}`, borderRadius: 7, padding: "6px 10px",
    outline: "none", width: "100%", boxSizing: "border-box" };

  return (
    <div>
      <div style={sectionLbl}>Tested By</div>

      {links.map(l => (
        <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 8,
          padding: "5px 10px", marginBottom: 4, borderRadius: 6,
          background: T.bg, border: `1px solid ${T.border}` }}>
          <span style={{ fontFamily: T.body, fontSize: 10, fontWeight: 600, color: T.textMuted,
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4,
            padding: "1px 6px", flexShrink: 0, whiteSpace: "nowrap" }}>
            Is tested by
          </span>
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.accent, flexShrink: 0 }}>
            {l.caseId}
          </span>
          <span style={{ fontFamily: T.body, fontSize: 12, color: T.text, flex: 1,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {l.case?.title || ""}
          </span>
          <button onClick={() => handleRemove(l.id)} title="Remove link"
            style={{ background: "none", border: "none", cursor: "pointer",
              color: T.textMuted, fontSize: 16, lineHeight: 1, padding: "0 2px", flexShrink: 0,
              transition: "color .12s" }}
            onMouseEnter={e => e.currentTarget.style.color = T.danger}
            onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>
            ×
          </button>
        </div>
      ))}

      {links.length === 0 && !adding && (
        <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic", marginBottom: 6 }}>
          No test cases linked yet.
        </div>
      )}

      {adding ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
          <input value={search}
            onChange={e => { setSearch(e.target.value); setSelected(null); }}
            placeholder="Search test cases by ID or title…" style={inp} autoFocus />
          {candidates.length > 0 && (
            <div style={{ border: `1px solid ${T.border}`, borderRadius: 7, overflow: "hidden" }}>
              {candidates.map((t, i) => (
                <div key={t.id}
                  onClick={() => { setSelected(t); setSearch(`${t.id} — ${t.title}`); }}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                    cursor: "pointer", borderBottom: i < candidates.length - 1 ? `1px solid ${T.border}22` : "none",
                    background: "transparent" }}
                  onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <span style={{ fontFamily: T.mono, fontSize: 11, color: T.accent, flexShrink: 0 }}>{t.id}</span>
                  <span style={{ fontFamily: T.body, fontSize: 12, color: T.text,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Btn size="sm" disabled={!selected} onClick={handleAdd}>Link</Btn>
            <Btn size="sm" variant="secondary" onClick={() => { setAdding(false); setSearch(""); setSelected(null); }}>Cancel</Btn>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)}
          style={{ fontFamily: T.body, fontSize: 12, color: T.accent, background: "none",
            border: `1px dashed ${T.accent}55`, borderRadius: 6, padding: "5px 12px",
            cursor: "pointer", width: "100%", textAlign: "left", marginTop: links.length ? 6 : 0 }}>
          ＋ Link test case
        </button>
      )}
    </div>
  );
};

// ─── Ticket Comments Panel ────────────────────────────────────────────────────

const TicketCommentsPanel = ({ ticketId }) => {
  const { user, canEdit, isAdmin } = useAuth();
  const [comments, setComments] = useState(null); // null = loading
  const [body,     setBody]     = useState("");
  const [posting,  setPosting]  = useState(false);

  const load = () => api.tickets.comments(ticketId).then(setComments).catch(() => setComments([]));
  useEffect(() => { load(); }, [ticketId]);

  const handlePost = async () => {
    if (!body.trim()) return;
    setPosting(true);
    try {
      await api.tickets.addComment(ticketId, { body: body.trim() });
      setBody("");
      await load();
    } catch (e) { toast.error(e.message); }
    setPosting(false);
  };

  const handleRemove = async id => {
    try {
      await api.tickets.removeComment(ticketId, id);
      setComments(cs => cs.filter(c => c.id !== id));
    } catch (e) { toast.error(e.message); }
  };

  const sectionLbl = { fontFamily: T.body, fontSize: 10, fontWeight: 700, color: T.textMuted,
    textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8 };
  const fmtTime = iso => new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

  return (
    <div>
      <div style={sectionLbl}>Comments{comments?.length ? ` (${comments.length})` : ""}</div>

      {comments === null && (
        <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>
          Loading comments…
        </div>
      )}

      {comments !== null && comments.length === 0 && (
        <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic", marginBottom: 8 }}>
          No comments yet.
        </div>
      )}

      {comments !== null && comments.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          {comments.map(c => (
            <div key={c.id} style={{ padding: "8px 10px", borderRadius: 7,
              background: T.bg, border: `1px solid ${T.border}` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontFamily: T.body, fontSize: 12, fontWeight: 700, color: T.text }}>
                    {c.authorName || "Unknown"}
                  </span>
                  <span style={{ fontFamily: T.body, fontSize: 10.5, color: T.textMuted }}>
                    {fmtTime(c.createdAt)}
                  </span>
                </div>
                {canEdit && (c.authorId === user?.id || isAdmin) && (
                  <button onClick={() => handleRemove(c.id)} title="Delete comment"
                    style={{ background: "none", border: "none", cursor: "pointer",
                      color: T.textMuted, fontSize: 14, lineHeight: 1, padding: "0 2px", flexShrink: 0,
                      transition: "color .12s" }}
                    onMouseEnter={e => e.currentTarget.style.color = T.danger}
                    onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>
                    ×
                  </button>
                )}
              </div>
              <div style={{ fontFamily: T.body, fontSize: 12.5, color: T.text, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                {c.body}
              </div>
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Textarea value={body} onChange={setBody} placeholder="Write a comment…" rows={2} />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Btn size="sm" disabled={!body.trim() || posting} onClick={handlePost}>
              {posting ? "Posting…" : "Post"}
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Ticket Attachments Panel ─────────────────────────────────────────────────

// ─── Time Tracking / Work Log (TKT-91OLB9) ────────────────────────────────────

const TicketActivityPanel = ({ ticketId }) => {
  const [history, setHistory] = useState(null); // null = loading

  useEffect(() => {
    api.tickets.statusHistory(ticketId).then(setHistory).catch(() => setHistory([]));
  }, [ticketId]);

  const sectionLbl = { fontFamily: T.body, fontSize: 10, fontWeight: 700, color: T.textMuted,
    textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8 };
  const fmtWhen = d => new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  if (history === null) return <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>Loading…</div>;
  if (history.length === 0) return (
    <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>No status changes recorded yet.</div>
  );

  return (
    <div>
      <div style={sectionLbl}>Activity</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {history.map(h => (
          <div key={h.id} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "8px 10px",
            borderRadius: 7, background: T.bg, border: `1px solid ${T.border}` }}>
            <span style={{ fontFamily: T.body, fontSize: 12, color: T.text, flex: 1 }}>
              {h.fromStatus ? (
                <>Moved <strong>{h.fromStatus}</strong> → <strong style={{ color: T.accent }}>{h.toStatus}</strong></>
              ) : (
                <>Created in <strong style={{ color: T.accent }}>{h.toStatus}</strong></>
              )}
            </span>
            <span style={{ fontFamily: T.body, fontSize: 10.5, color: T.textMuted, whiteSpace: "nowrap" }}>
              {h.changedByName || "Someone"} · {fmtWhen(h.changedAt)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const TicketWorkLogPanel = ({ ticketId }) => {
  const { user, canEdit, isAdmin } = useAuth();
  const [logs,    setLogs]    = useState(null); // null = loading
  const [minutes, setMinutes] = useState("");
  const [note,    setNote]    = useState("");
  const [posting, setPosting] = useState(false);

  const load = () => api.workLogs.list(ticketId).then(setLogs).catch(() => setLogs([]));
  useEffect(() => { load(); }, [ticketId]);

  const totalMinutes = (logs || []).reduce((s, l) => s + l.minutes, 0);
  const fmtMin = m => m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + "m" : ""}`.trim() : `${m}m`;

  const handlePost = async () => {
    const mins = Number(minutes);
    if (!Number.isFinite(mins) || mins <= 0) return;
    setPosting(true);
    try {
      await api.workLogs.create(ticketId, { minutes: mins, note: note.trim() });
      setMinutes(""); setNote("");
      await load();
    } catch (e) { toast.error(e.message); }
    setPosting(false);
  };

  const handleRemove = async id => {
    try { await api.workLogs.remove(id); setLogs(ls => ls.filter(l => l.id !== id)); }
    catch (e) { toast.error(e.message); }
  };

  const sectionLbl = { fontFamily: T.body, fontSize: 10, fontWeight: 700, color: T.textMuted,
    textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8 };
  const fmtDate = d => new Date(d).toLocaleDateString(undefined, { dateStyle: "medium" });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={sectionLbl}>Time Logged</div>
        {totalMinutes > 0 && (
          <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 700, color: T.accent }}>{fmtMin(totalMinutes)} total</span>
        )}
      </div>

      {logs === null && (
        <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>Loading…</div>
      )}
      {logs !== null && logs.length === 0 && (
        <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic", marginBottom: 8 }}>
          No time logged yet.
        </div>
      )}
      {logs !== null && logs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {logs.map(l => (
            <div key={l.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px",
              borderRadius: 7, background: T.bg, border: `1px solid ${T.border}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontFamily: T.mono, fontSize: 12.5, fontWeight: 700, color: T.accent }}>{fmtMin(l.minutes)}</span>
                  <span style={{ fontFamily: T.body, fontSize: 11.5, color: T.text }}>{l.userName || "Someone"}</span>
                  <span style={{ fontFamily: T.body, fontSize: 10.5, color: T.textMuted }}>{fmtDate(l.loggedAt)}</span>
                </div>
                {l.note && <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, marginTop: 3 }}>{l.note}</div>}
              </div>
              {canEdit && (l.userId === user?.id || isAdmin) && (
                <button onClick={() => handleRemove(l.id)} title="Delete entry"
                  style={{ background: "none", border: "none", cursor: "pointer",
                    color: T.textMuted, fontSize: 14, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
                  onMouseEnter={e => e.currentTarget.style.color = T.danger}
                  onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>×</button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 6 }}>
            <input type="number" min="1" value={minutes} onChange={e => setMinutes(e.target.value)}
              placeholder="Minutes"
              style={{ ...inputBase, fontFamily: T.mono, fontSize: 12.5 }} />
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="What did you work on? (optional)"
              style={{ ...inputBase, fontFamily: T.body, fontSize: 12.5 }} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Btn size="sm" disabled={!minutes || Number(minutes) <= 0 || posting} onClick={handlePost}>
              {posting ? "Logging…" : "Log Time"}
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
};

const TicketAttachmentsPanel = ({ ticketId }) => {
  const { canEdit } = useAuth();
  const [attachments, setAttachments] = useState(null); // null = loading
  const [uploading,   setUploading]   = useState(false);
  const fileRef = useRef(null);

  const load = () => api.tickets.attachments(ticketId).then(setAttachments).catch(() => setAttachments([]));
  useEffect(() => { load(); }, [ticketId]);

  const handleFileChange = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async ev => {
      const base64 = ev.target.result.split(",")[1];
      try {
        await api.tickets.addAttachment(ticketId, { filename: file.name, mimeType: file.type, data: base64 });
        await load();
      } catch (err) { toast.error(err.message); }
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    };
    reader.readAsDataURL(file);
  };

  const handleDownload = a => {
    api.tickets.downloadAttachment(a.id, a.filename).catch(err => toast.error(err.message));
  };

  const handleRemove = async id => {
    try {
      await api.tickets.removeAttachment(id);
      setAttachments(list => list.filter(a => a.id !== id));
    } catch (err) { toast.error(err.message); }
  };

  const fmtSize = bytes => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const sectionLbl = { fontFamily: T.body, fontSize: 10, fontWeight: 700, color: T.textMuted,
    textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8 };

  return (
    <div>
      <div style={sectionLbl}>Attachments{attachments?.length ? ` (${attachments.length})` : ""}</div>

      {attachments === null && (
        <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>
          Loading attachments…
        </div>
      )}

      {attachments !== null && attachments.length === 0 && (
        <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic", marginBottom: 8 }}>
          No attachments yet.
        </div>
      )}

      {attachments !== null && attachments.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
          {attachments.map(a => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8,
              padding: "6px 10px", borderRadius: 6, background: T.bg, border: `1px solid ${T.border}` }}>
              <span onClick={() => handleDownload(a)} title="Download"
                style={{ fontFamily: T.body, fontSize: 12, color: T.accent, flex: 1, cursor: "pointer",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                📎 {a.filename}
              </span>
              <span style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted, flexShrink: 0 }}>
                {fmtSize(a.sizeBytes)}
              </span>
              {canEdit && (
                <button onClick={() => handleRemove(a.id)} title="Delete attachment"
                  style={{ background: "none", border: "none", cursor: "pointer",
                    color: T.textMuted, fontSize: 14, lineHeight: 1, padding: "0 2px", flexShrink: 0,
                    transition: "color .12s" }}
                  onMouseEnter={e => e.currentTarget.style.color = T.danger}
                  onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <>
          <input ref={fileRef} type="file" onChange={handleFileChange} style={{ display: "none" }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
            style={{ fontFamily: T.body, fontSize: 12, color: T.accent, background: "none",
              border: `1px dashed ${T.accent}55`, borderRadius: 6, padding: "5px 12px",
              cursor: uploading ? "default" : "pointer", width: "100%", textAlign: "left",
              opacity: uploading ? 0.6 : 1 }}>
            {uploading ? "Uploading…" : "＋ Attach file"}
          </button>
        </>
      )}
    </div>
  );
};

// ─── Ticket Labels Panel ──────────────────────────────────────────────────────

// ─── Custom Fields Editor ─────────────────────────────────────────────────────
// Free-form key/value pairs stored as JSON on the ticket — no admin-defined schema (v1).

const CustomFieldsEditor = ({ value = {}, onChange }) => {
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  const entries = Object.entries(value);

  const addField = () => {
    const key = newKey.trim();
    if (!key || Object.prototype.hasOwnProperty.call(value, key)) return;
    onChange({ ...value, [key]: newVal });
    setNewKey(""); setNewVal("");
  };
  const updateField = (key, v) => onChange({ ...value, [key]: v });
  const removeField = key => {
    const next = { ...value };
    delete next[key];
    onChange(next);
  };

  const sectionLbl = { fontFamily: T.body, fontSize: 10, fontWeight: 700, color: T.textMuted,
    textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8 };
  const inp = { fontFamily: T.body, fontSize: 12, color: T.text, background: T.bg,
    border: `1px solid ${T.border}`, borderRadius: 7, padding: "6px 10px",
    outline: "none", width: "100%", boxSizing: "border-box" };

  return (
    <div>
      <div style={sectionLbl}>Custom Fields</div>
      {entries.length === 0 && (
        <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic", marginBottom: 8 }}>
          No custom fields.
        </div>
      )}
      {entries.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
          {entries.map(([k, v]) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 600, color: T.accent,
                background: `${T.accent}14`, border: `1px solid ${T.accent}44`, borderRadius: 5,
                padding: "5px 8px", flexShrink: 0, maxWidth: 120, overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={k}>
                {k}
              </span>
              <input value={v} onChange={e => updateField(k, e.target.value)} style={{ ...inp, flex: 1 }} />
              <button type="button" onClick={() => removeField(k)} title="Remove field"
                style={{ background: "none", border: "none", cursor: "pointer",
                  color: T.textMuted, fontSize: 14, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
                onMouseEnter={e => e.currentTarget.style.color = T.danger}
                onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <input value={newKey} onChange={e => setNewKey(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addField()}
          placeholder="Field name" style={{ ...inp, flex: 1 }} />
        <input value={newVal} onChange={e => setNewVal(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addField()}
          placeholder="Value" style={{ ...inp, flex: 1 }} />
        <Btn size="sm" disabled={!newKey.trim()} onClick={addField}>Add</Btn>
      </div>
    </div>
  );
};

const TicketLabelsPanel = ({ ticketId, onChange }) => {
  const { canEdit } = useAuth();
  const [labels,    setLabels]    = useState(null); // null = loading
  const [allLabels, setAllLabels] = useState([]);
  const [adding,    setAdding]    = useState(false);
  const [input,     setInput]     = useState("");

  const load = () => api.tickets.labels(ticketId).then(setLabels).catch(() => setLabels([]));
  useEffect(() => { load(); }, [ticketId]);
  useEffect(() => { api.labels.list().then(setAllLabels).catch(() => {}); }, []);

  const suggestions = input.trim().length > 0
    ? allLabels.filter(l =>
        l.toLowerCase().includes(input.toLowerCase()) &&
        !(labels || []).some(x => x.label.toLowerCase() === l.toLowerCase())
      ).slice(0, 6)
    : [];

  const handleAdd = async value => {
    const label = (value ?? input).trim();
    if (!label) return;
    try {
      await api.tickets.addLabel(ticketId, label);
      setInput(""); setAdding(false);
      await load();
      onChange?.();
    } catch (e) { toast.error(e.message); }
  };

  const handleRemove = async labelId => {
    try {
      await api.tickets.removeLabel(labelId);
      setLabels(ls => ls.filter(l => l.id !== labelId));
      onChange?.();
    } catch (e) { toast.error(e.message); }
  };

  const sectionLbl = { fontFamily: T.body, fontSize: 10, fontWeight: 700, color: T.textMuted,
    textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8 };
  const inp = { fontFamily: T.body, fontSize: 12, color: T.text, background: T.bg,
    border: `1px solid ${T.border}`, borderRadius: 7, padding: "6px 10px",
    outline: "none", width: "100%", boxSizing: "border-box" };

  return (
    <div>
      <div style={sectionLbl}>Labels</div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        {(labels || []).map(l => (
          <span key={l.id} style={{ display: "inline-flex", alignItems: "center", gap: 5,
            fontFamily: T.body, fontSize: 11, fontWeight: 600, color: T.accent,
            background: `${T.accent}14`, border: `1px solid ${T.accent}44`,
            borderRadius: 20, padding: "3px 6px 3px 10px" }}>
            {l.label}
            {canEdit && (
              <button type="button" onClick={() => handleRemove(l.id)} title="Remove label"
                style={{ background: "none", border: "none", cursor: "pointer",
                  color: T.accent, fontSize: 13, lineHeight: 1, padding: 0 }}>
                ×
              </button>
            )}
          </span>
        ))}
        {canEdit && !adding && (
          <button type="button" onClick={() => setAdding(true)}
            style={{ fontFamily: T.body, fontSize: 11, color: T.textMuted, background: "none",
              border: `1px dashed ${T.border}`, borderRadius: 20, padding: "3px 10px", cursor: "pointer" }}>
            ＋ Label
          </button>
        )}
        {labels !== null && labels.length === 0 && !canEdit && (
          <span style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>
            No labels.
          </span>
        )}
      </div>
      {adding && (
        <div style={{ position: "relative", marginTop: 8 }}>
          <input value={input} autoFocus
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); handleAdd(); }
              if (e.key === "Escape") { setAdding(false); setInput(""); }
            }}
            onBlur={() => setTimeout(() => { setAdding(false); setInput(""); }, 150)}
            placeholder="Type a label, press Enter…" style={inp} />
          {suggestions.length > 0 && (
            <div style={{ border: `1px solid ${T.border}`, borderRadius: 7, overflow: "hidden", marginTop: 4 }}>
              {suggestions.map(s => (
                <div key={s} onMouseDown={() => handleAdd(s)}
                  style={{ padding: "6px 10px", cursor: "pointer", fontFamily: T.body, fontSize: 12, color: T.text }}
                  onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Parent Picker Modal ──────────────────────────────────────────────────────
// Full-screen picker for selecting a parent Epic or Story.
// Supports free-text search across title + ID, and one-click type filtering.

const PARENT_TYPES = ["Epic", "Story"];

const ParentPickerModal = ({ tickets = [], excludeId, onSelect, onClose, allowedTypes = PARENT_TYPES, initialTypeFilter = "" }) => {
  const [search,     setSearch]     = useState("");
  const [typeFilter, setTypeFilter] = useState(initialTypeFilter);

  const q = search.trim().toLowerCase();
  const TYPE_ORDER = { "Test Plan": 0, "Test Run": 1, Epic: 2, Story: 3 };
  const results = tickets
    .filter(t =>
      t.id !== excludeId &&
      allowedTypes.includes(t.type) &&
      (typeFilter === "" || t.type === typeFilter) &&
      (q.length === 0 ||
        t.id.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q))
    )
    .sort((a, b) => {
      const orderDiff = (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9);
      return orderDiff !== 0 ? orderDiff : a.title.localeCompare(b.title);
    });

  const btnBase = active => ({
    fontFamily: T.body, fontSize: 12, fontWeight: active ? 700 : 400,
    padding: "4px 12px", borderRadius: 6, cursor: "pointer", border: "none",
    background: active ? T.accent : T.surface,
    color:      active ? "#fff"   : T.textMuted,
    transition: "background .12s, color .12s",
  });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000,
      background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: 560, maxHeight: "80vh", background: T.surface,
        border: `1px solid ${T.border}`, borderRadius: 14,
        display: "flex", flexDirection: "column", overflow: "hidden",
        boxShadow: "0 20px 60px rgba(0,0,0,.4)" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <span style={{ fontFamily: T.head, fontSize: 15, fontWeight: 700, color: T.text }}>
            Select Parent
          </span>
          <button onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer",
              color: T.textMuted, fontSize: 20, lineHeight: 1, padding: "0 2px" }}>×</button>
        </div>

        {/* Search + type filter */}
        <div style={{ padding: "12px 18px", borderBottom: `1px solid ${T.border}`, flexShrink: 0,
          display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            autoFocus
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by type, ID, title, or keywords…"
            style={{ ...inputBase, fontFamily: T.body, fontSize: 13,
              width: "100%", boxSizing: "border-box" }} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(allowedTypes.length > 1 ? ["", ...allowedTypes] : allowedTypes).map(t => (
              <button key={t} type="button"
                onClick={() => setTypeFilter(t)}
                style={btnBase(typeFilter === t)}>
                {t === "" ? "All" : `${TYPE_ICON[t] || ""} ${t}`}
              </button>
            ))}
            <span style={{ marginLeft: "auto", fontFamily: T.mono, fontSize: 11,
              color: T.textMuted, alignSelf: "center" }}>
              {results.length} result{results.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* Results list */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {results.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", fontFamily: T.body,
              fontSize: 13, color: T.textMuted, fontStyle: "italic" }}>
              No {typeFilter || allowedTypes.join(" or ")} match your search.
            </div>
          ) : results.map((t, i) => (
            <div key={t.id}
              onClick={() => { onSelect(t); onClose(); }}
              style={{ display: "flex", alignItems: "center", gap: 10,
                padding: "11px 18px", cursor: "pointer",
                borderBottom: i < results.length - 1 ? `1px solid ${T.border}22` : "none",
                transition: "background .1s" }}
              onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>{TYPE_ICON[t.type] || "📋"}</span>
              <Badge variant={TYPE_VARIANT[t.type] || "default"}>{t.type}</Badge>
              <span style={{ fontFamily: T.mono, fontSize: 11, color: T.accent, flexShrink: 0 }}>
                {t.id}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: T.body, fontSize: 13, color: T.text, fontWeight: 500,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.title}
                </div>
                {t.description && (
                  <div style={{ fontFamily: T.body, fontSize: 11, color: T.textMuted,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
                    {t.description}
                  </div>
                )}
              </div>
              <span style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted,
                background: T.bg, border: `1px solid ${T.border}`,
                borderRadius: 4, padding: "1px 6px", flexShrink: 0 }}>
                {t.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── Ticket Modal ─────────────────────────────────────────────────────────────

const TicketModal = ({ init = {}, tickets = [], testItems = [], users = [], teams = [], versions = [], sprints = [], columns = COLUMNS, onSave, onCancel, onLabelsChanged }) => {
  const isEdit = !!init.id;
  const [f, setF] = useState({
    title:       init.title       || "",
    type:        init.type        || "Task",
    section:     init.section     || "General",
    description: init.description || "",
    priority:    init.priority    || "Medium",
    status:      init.status      || columns[0] || "Ready",
    version:     init.version     || "",
    versionId:   init.versionId   || "",
    sprintId:    init.sprintId    || "",
    assigneeId:  init.assigneeId  || "",
    teamId:      init.teamId      || "",
    startDate:   init.startDate   || "",
    dueDate:     init.dueDate     || "",
    parentId:    init.parentId    || "",
    testNotes:   init.testNotes   || "",
    storyPoints: init.storyPoints ?? "",
    customFields: init.customFields || {},
  });
  const [showParentPicker, setShowParentPicker] = useState(false);
  const set = k => v => setF(p => ({ ...p, [k]: v }));
  const valid = f.title.trim().length > 0;

  const selectedParent = f.parentId ? tickets.find(t => t.id === f.parentId) : null;
  const allowedParentTypes = PARENT_TYPES;
  const initialParentTypeFilter = "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Inp label="Title" value={f.title} onChange={set("title")} placeholder="e.g. Wire VesselCombobox to ShipmentForm" required />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Sel label="Type" value={f.type} onChange={set("type")}
          options={TYPES.map(t => ({ value: t, label: `${TYPE_ICON[t]} ${t}` }))} />
        <Sel label="Section" value={f.section} onChange={set("section")}
          options={SECTIONS.map(s => ({ value: s, label: s }))} />
        <Sel label="Priority" value={f.priority} onChange={set("priority")}
          options={PRIORITIES.map(p => ({ value: p, label: p }))} />
      </div>

      {/* Assignee + Due date + Story points on one row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 90px", gap: 12 }}>
        <Sel label="Assignee" value={f.assigneeId} onChange={set("assigneeId")}
          options={[
            { value: "", label: "— Unassigned —" },
            ...users.filter(u => u.isActive !== false).map(u => ({ value: u.id, label: u.name })),
          ]}
        />
        {/* Native date input styled to match the design system */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontFamily: T.body, fontSize: 11, fontWeight: 600, color: T.textMuted,
            textTransform: "uppercase", letterSpacing: ".06em" }}>Due Date</label>
          <input type="date" value={f.dueDate} onChange={e => set("dueDate")(e.target.value)}
            style={{ ...inputBase, fontFamily: T.mono, fontSize: 13, cursor: "pointer",
              colorScheme: "dark" }} />
        </div>
        <Inp label="Points" type="number" value={f.storyPoints}
          onChange={v => set("storyPoints")(v === "" ? "" : v.replace(/[^0-9]/g, ""))}
          placeholder="—" />
      </div>

      {f.type === "Epic" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontFamily: T.body, fontSize: 11, fontWeight: 600, color: T.textMuted,
            textTransform: "uppercase", letterSpacing: ".06em" }}>
            Start Date <span style={{ fontWeight: 400, textTransform: "none" }}>(paired with Due Date for the Roadmap Gantt view)</span>
          </label>
          <input type="date" value={f.startDate} onChange={e => set("startDate")(e.target.value)}
            style={{ ...inputBase, fontFamily: T.mono, fontSize: 13, cursor: "pointer", colorScheme: "dark" }} />
        </div>
      )}

      {teams.length > 0 && (
        <Sel label="Team" value={f.teamId} onChange={set("teamId")}
          options={[
            { value: "", label: "— No Team —" },
            ...teams.map(t => ({ value: t.id, label: t.name })),
          ]}
        />
      )}

      <CustomFieldsEditor value={f.customFields} onChange={set("customFields")} />

      {/* Parent — lookup button opens ParentPickerModal */}
      {f.type !== "Epic" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontFamily: T.body, fontSize: 11, fontWeight: 600, color: T.textMuted,
            textTransform: "uppercase", letterSpacing: ".06em" }}>
            Parent <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span>
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* Display chip when a parent is selected */}
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minHeight: 36,
              background: T.bg, border: `1px solid ${selectedParent ? T.accent + "66" : T.border}`,
              borderRadius: 7, padding: "6px 12px" }}>
              {selectedParent ? (
                <>
                  <span style={{ fontSize: 15, flexShrink: 0 }}>{TYPE_ICON[selectedParent.type] || "📋"}</span>
                  <Badge variant={TYPE_VARIANT[selectedParent.type] || "default"}>{selectedParent.type}</Badge>
                  <span style={{ fontFamily: T.mono, fontSize: 11, color: T.accent, flexShrink: 0 }}>
                    {selectedParent.id}
                  </span>
                  <span style={{ fontFamily: T.body, fontSize: 12, color: T.text, flex: 1,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {selectedParent.title}
                  </span>
                  <button type="button" onClick={() => set("parentId")("")}
                    style={{ background: "none", border: "none", cursor: "pointer",
                      color: T.textMuted, fontSize: 16, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
                    onMouseEnter={e => e.currentTarget.style.color = T.danger}
                    onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>×</button>
                </>
              ) : (
                <span style={{ fontFamily: T.body, fontSize: 12, color: T.border, fontStyle: "italic" }}>
                  None — click 🔍 to search
                </span>
              )}
            </div>
            {/* Lookup button */}
            <button type="button" onClick={() => setShowParentPicker(true)}
              title={`Search for a parent ${allowedParentTypes.join(" or ")}`}
              style={{ background: T.accentBg, border: `1px solid ${T.accent}55`, borderRadius: 7,
                color: T.accent, cursor: "pointer", fontSize: 16, padding: "6px 12px",
                lineHeight: 1, flexShrink: 0, transition: "background .12s" }}
              onMouseEnter={e => e.currentTarget.style.background = `${T.accent}33`}
              onMouseLeave={e => e.currentTarget.style.background = T.accentBg}>
              🔍
            </button>
          </div>
        </div>
      )}

      {/* Parent picker modal — rendered outside the form to avoid z-index issues */}
      {showParentPicker && (
        <ParentPickerModal
          tickets={tickets}
          excludeId={init.id}
          onSelect={t => set("parentId")(t.id)}
          onClose={() => setShowParentPicker(false)}
          allowedTypes={allowedParentTypes}
          initialTypeFilter={initialParentTypeFilter}
        />
      )}

      {versions.length > 0 && (
        <Sel label="Version (optional)" value={f.versionId} onChange={set("versionId")}
          options={[
            { value: "", label: "— Unversioned —" },
            ...versions.map(v => ({ value: v.id, label: `${v.name}${v.status ? ` · ${v.status}` : ""}${v.releaseDate ? ` · ${v.releaseDate}` : ""}` })),
          ]}
        />
      )}
      {sprints.length > 0 && (
        <Sel label="Sprint (optional)" value={f.sprintId} onChange={set("sprintId")}
          options={[
            { value: "", label: "— No Sprint —" },
            ...sprints.map(s => ({ value: s.id, label: `${s.name}${s.status ? ` · ${s.status}` : ""}` })),
          ]}
        />
      )}
      <Textarea label="Description" value={f.description} onChange={set("description")}
        placeholder="What needs to be done, acceptance criteria, notes…" rows={4} />

      {isEdit && <TicketLabelsPanel ticketId={init.id} onChange={onLabelsChanged} />}

      {isEdit && (
        <Sel label="Status" value={f.status} onChange={set("status")}
          options={columns.map(c => ({ value: c, label: c }))} />
      )}
      {isEdit && (
        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 14 }}>
          <TicketLinksPanel ticketId={init.id} allTickets={tickets} />
        </div>
      )}
      {isEdit && f.type === "Story" && (
        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 14 }}>
          <TestedByPanel ticketId={init.id} testItems={testItems} />
        </div>
      )}
      {isEdit && (
        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 14 }}>
          <TicketAttachmentsPanel ticketId={init.id} />
        </div>
      )}
      {isEdit && (
        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 14 }}>
          <TicketCommentsPanel ticketId={init.id} />
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 4 }}>
        <Btn variant="secondary" onClick={onCancel}>Cancel</Btn>
        <Btn disabled={!valid} onClick={() => onSave(f)}>
          {isEdit ? "Save Changes" : "Create Ticket"}
        </Btn>
      </div>
    </div>
  );
};

// ─── Test Item Modal (Test Folder / Plan / Run / Case) ───────────────────────

const TestItemModal = ({ init = {}, testItems = [], tickets = [], users = [], versions = [], onSave, onCancel }) => {
  const isEdit = !!init.id;
  const [f, setF] = useState({
    title:       init.title       || "",
    type:        init.type        || "Test Case",
    description: init.description || "",
    priority:    init.priority    || "Medium",
    status:      init.status      || "Ready",
    versionId:   init.versionId   || "",
    assigneeId:  init.assigneeId  || "",
    dueDate:     init.dueDate     || "",
    parentId:    init.parentId    || "",
    testNotes:   init.testNotes   || "",
  });
  const [showParentPicker, setShowParentPicker] = useState(false);
  const set = k => v => setF(p => ({ ...p, [k]: v }));
  const valid = f.title.trim().length > 0;

  const selectedParent = f.parentId ? testItems.find(t => t.id === f.parentId) : null;
  // Test Folder/Plan are always roots — nesting for those happens only via drag-and-drop
  // in the sidebar, matching the original tickets-based behavior.
  const allowedParentTypes = TEST_PARENT_TYPES[f.type] || null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Inp label="Title" value={f.title} onChange={set("title")} placeholder="e.g. Verify login with valid credentials" required />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Sel label="Type" value={f.type} onChange={set("type")}
          options={TEST_TYPES.map(t => ({ value: t, label: `${TYPE_ICON[t]} ${t}` }))} />
        <Sel label="Priority" value={f.priority} onChange={set("priority")}
          options={PRIORITIES.map(p => ({ value: p, label: p }))} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Sel label="Assignee" value={f.assigneeId} onChange={set("assigneeId")}
          options={[
            { value: "", label: "— Unassigned —" },
            ...users.filter(u => u.isActive !== false).map(u => ({ value: u.id, label: u.name })),
          ]}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontFamily: T.body, fontSize: 11, fontWeight: 600, color: T.textMuted,
            textTransform: "uppercase", letterSpacing: ".06em" }}>Due Date</label>
          <input type="date" value={f.dueDate} onChange={e => set("dueDate")(e.target.value)}
            style={{ ...inputBase, fontFamily: T.mono, fontSize: 13, cursor: "pointer",
              colorScheme: "dark" }} />
        </div>
      </div>

      {allowedParentTypes && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontFamily: T.body, fontSize: 11, fontWeight: 600, color: T.textMuted,
            textTransform: "uppercase", letterSpacing: ".06em" }}>
            Parent <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span>
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minHeight: 36,
              background: T.bg, border: `1px solid ${selectedParent ? T.accent + "66" : T.border}`,
              borderRadius: 7, padding: "6px 12px" }}>
              {selectedParent ? (
                <>
                  <span style={{ fontSize: 15, flexShrink: 0 }}>{TYPE_ICON[selectedParent.type] || "📋"}</span>
                  <Badge variant={TYPE_VARIANT[selectedParent.type] || "default"}>{selectedParent.type}</Badge>
                  <span style={{ fontFamily: T.mono, fontSize: 11, color: T.accent, flexShrink: 0 }}>
                    {selectedParent.id}
                  </span>
                  <span style={{ fontFamily: T.body, fontSize: 12, color: T.text, flex: 1,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {selectedParent.title}
                  </span>
                  <button type="button" onClick={() => set("parentId")("")}
                    style={{ background: "none", border: "none", cursor: "pointer",
                      color: T.textMuted, fontSize: 16, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
                    onMouseEnter={e => e.currentTarget.style.color = T.danger}
                    onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>×</button>
                </>
              ) : (
                <span style={{ fontFamily: T.body, fontSize: 12, color: T.border, fontStyle: "italic" }}>
                  None — click 🔍 to search
                </span>
              )}
            </div>
            <button type="button" onClick={() => setShowParentPicker(true)}
              title={`Search for a parent ${allowedParentTypes.join(" or ")}`}
              style={{ background: T.accentBg, border: `1px solid ${T.accent}55`, borderRadius: 7,
                color: T.accent, cursor: "pointer", fontSize: 16, padding: "6px 12px",
                lineHeight: 1, flexShrink: 0, transition: "background .12s" }}
              onMouseEnter={e => e.currentTarget.style.background = `${T.accent}33`}
              onMouseLeave={e => e.currentTarget.style.background = T.accentBg}>
              🔍
            </button>
          </div>
        </div>
      )}

      {showParentPicker && (
        <ParentPickerModal
          tickets={testItems}
          excludeId={init.id}
          onSelect={t => set("parentId")(t.id)}
          onClose={() => setShowParentPicker(false)}
          allowedTypes={allowedParentTypes}
          initialTypeFilter={allowedParentTypes.length === 1 ? allowedParentTypes[0] : ""}
        />
      )}

      {versions.length > 0 && (
        <Sel label="Version (optional)" value={f.versionId} onChange={set("versionId")}
          options={[
            { value: "", label: "— Unversioned —" },
            ...versions.map(v => ({ value: v.id, label: `${v.name}${v.status ? ` · ${v.status}` : ""}${v.releaseDate ? ` · ${v.releaseDate}` : ""}` })),
          ]}
        />
      )}
      <Textarea label="Description" value={f.description} onChange={set("description")}
        placeholder="What is this verifying?" rows={4} />

      {f.type === "Test Case" && (
        <Textarea label="Test Notes / Steps" value={f.testNotes} onChange={set("testNotes")}
          placeholder={"Steps to reproduce or test steps:\n1. Navigate to…\n2. Enter…\n3. Verify that…"} rows={4} />
      )}

      {isEdit && (
        <Sel label="Status" value={f.status} onChange={set("status")}
          options={TEST_STATUSES.map(s => ({ value: s, label: s }))} />
      )}

      {isEdit && f.type === "Test Case" && (
        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 14 }}>
          <TestCaseStoryLinksPanel caseId={init.id} tickets={tickets} />
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 4 }}>
        <Btn variant="secondary" onClick={onCancel}>Cancel</Btn>
        <Btn disabled={!valid} onClick={() => onSave(f)}>
          {isEdit ? "Save Changes" : "Create Test Item"}
        </Btn>
      </div>
    </div>
  );
};

// ─── Drop Indicator ───────────────────────────────────────────────────────────

const DropLine = () => (
  <div style={{
    height: 2, borderRadius: 2,
    background: T.accent,
    boxShadow: `0 0 6px ${T.accent}88`,
    margin: "2px 0",
    flexShrink: 0,
  }} />
);

// ─── Ticket Card ──────────────────────────────────────────────────────────────

const TicketCard = ({ ticket, onEdit, onDelete, onMove, onPreview, onDiagram, onCoverage, colIndex,
                      isSelected, isDragging, dropIndicator,
                      onDragStart, onDragEnd, onDragOver,
                      allTickets = [], columns = COLUMNS,
                      bulkMode = false, bulkSelected = false, onToggleBulkSelect }) => {
  const { canEdit } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const cardRef  = useRef(null);
  const dragged  = useRef(false);

  // Compute child progress for Epic cards (done / total children).
  const children   = ticket.type === "Epic" ? allTickets.filter(t => t.parentId === ticket.id) : [];
  const doneCount  = children.filter(t => ["Done","Ready to Deploy","Released"].includes(t.status)).length;
  const totalCount = children.length;
  const progress   = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : null;

  // Parent breadcrumb for non-top-level tickets.
  const parent = ticket.parentId ? allTickets.find(t => t.id === ticket.parentId) : null;

  const handleDragOver = e => {
    e.preventDefault();
    e.stopPropagation();
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const mid  = rect.top + rect.height / 2;
    onDragOver(ticket.id, e.clientY < mid ? "before" : "after");
  };

  const stop = fn => e => { e.stopPropagation(); fn(); };

  return (
    <>
      {dropIndicator === "before" && <DropLine />}

      <div
        ref={cardRef}
        draggable={canEdit}
        onDragStart={canEdit ? (e => { dragged.current = true; e.dataTransfer.setData("ticketId", ticket.id); onDragStart(ticket.id); }) : undefined}
        onDragEnd={canEdit ? (e => { dragged.current = false; onDragEnd(e); }) : undefined}
        onDragOver={canEdit ? handleDragOver : undefined}
        onClick={() => {
          if (dragged.current) return;
          if (bulkMode) { onToggleBulkSelect(ticket.id); return; }
          onPreview(ticket);
        }}
        style={{
          background: isSelected ? `${T.accent}0d` : T.bg,
          border: `1px solid ${isSelected ? T.accent + "66" : T.border}`,
          borderLeft: `3px solid ${isSelected ? T.accent : (PRIORITY_DOT[ticket.priority] || T.border)}`,
          borderRadius: 8, padding: "12px 14px", cursor: "pointer",
          opacity: isDragging ? 0.35 : 1,
          transition: "opacity .15s, box-shadow .15s, border-color .15s, background .15s",
          boxShadow: isDragging ? "none" : isSelected ? `0 0 0 1px ${T.accent}33, 0 2px 8px rgba(0,0,0,.25)` : "0 2px 8px rgba(0,0,0,.25)",
          userSelect: "none",
        }}
        onMouseEnter={e => { if (!isDragging) e.currentTarget.style.boxShadow = isSelected ? `0 0 0 1px ${T.accent}33, 0 4px 16px rgba(0,0,0,.4)` : "0 4px 16px rgba(0,0,0,.4)"; }}
        onMouseLeave={e => e.currentTarget.style.boxShadow = isDragging ? "none" : isSelected ? `0 0 0 1px ${T.accent}33, 0 2px 8px rgba(0,0,0,.25)` : "0 2px 8px rgba(0,0,0,.25)"}
      >
        {/* Parent breadcrumb — shown on tickets that have a parent */}
        {parent && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
            <Badge variant={TYPE_VARIANT[parent.type] || "default"} style={{ fontSize: 9 }}>{parent.type}</Badge>
            <span style={{ fontFamily: T.mono, fontSize: 9, color: T.textMuted,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
              {parent.title}
            </span>
          </div>
        )}

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 8 }}>
          {bulkMode && (
            <input type="checkbox" checked={bulkSelected}
              onClick={e => e.stopPropagation()}
              onChange={() => onToggleBulkSelect(ticket.id)}
              style={{ marginTop: 3, cursor: "pointer", flexShrink: 0 }} />
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.text, lineHeight: 1.4 }}>
              {ticket.title}
            </div>
            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted, marginTop: 2,
              display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 11 }}>{TYPE_ICON[ticket.type] || "📋"}</span>
              {ticket.id}
            </div>
          </div>
          {/* Epic progress ring */}
          {ticket.type === "Epic" && progress !== null && (
            <div title={`${doneCount} / ${totalCount} children done`}
              style={{ position: "relative", width: 32, height: 32, flexShrink: 0 }}>
              <svg width="32" height="32" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="16" cy="16" r="12" fill="none" stroke={T.border} strokeWidth="3" />
                <circle cx="16" cy="16" r="12" fill="none"
                  stroke={progress === 100 ? T.success : T.accent} strokeWidth="3"
                  strokeDasharray={`${2 * Math.PI * 12}`}
                  strokeDashoffset={`${2 * Math.PI * 12 * (1 - progress / 100)}`}
                  strokeLinecap="round" style={{ transition: "stroke-dashoffset .3s" }} />
              </svg>
              <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center",
                justifyContent: "center", fontFamily: T.mono, fontSize: 8, fontWeight: 700,
                color: progress === 100 ? T.success : T.text }}>
                {progress}%
              </span>
            </div>
          )}
          {/* Actions gear — top-right, stops click propagation so it doesn't open preview */}
          {canEdit && (
            <div onClick={e => e.stopPropagation()} style={{ flexShrink: 0 }}>
              <ActionMenu items={[
                ...(!["Done", "Ready to Deploy", "Released", "Backlog"].includes(ticket.status)
                  ? [{ icon: "↓", label: "Send to Backlog", onClick: () => onMove(ticket, "Backlog") }]
                  : []),
                { icon: "✎", label: "Edit", onClick: () => onEdit(ticket) },
                ...(ticket.type === "Epic"
                  ? [
                      { icon: "📊", label: "Coverage", onClick: () => onCoverage && onCoverage(ticket) },
                      { icon: "🗺", label: "Diagram",  onClick: () => onDiagram  && onDiagram(ticket)  },
                    ]
                  : []),
                { icon: "✕", label: "Delete", variant: "danger", onClick: () => setConfirm(true) },
              ]} />
            </div>
          )}
        </div>

        {/* Meta */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
          {ticket.type && ticket.type !== "Task" && (
            <Badge variant={TYPE_VARIANT[ticket.type] || "default"}>{ticket.type}</Badge>
          )}
          <Badge variant={PRIORITY_VARIANT[ticket.priority] || "default"}>{ticket.priority}</Badge>
          {ticket.storyPoints != null && (
            <span title="Story points" style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700,
              color: T.text, background: T.surface, border: `1px solid ${T.border}`,
              borderRadius: 4, padding: "1px 6px", minWidth: 14, textAlign: "center" }}>
              {ticket.storyPoints} SP
            </span>
          )}
          {ticket.section && (
            <span style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted,
              background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, padding: "1px 6px" }}>
              {ticket.section}
            </span>
          )}
          {ticket.version && (
            <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700,
              color: "#8b5cf6", background: "rgba(139,92,246,.12)",
              border: "1px solid rgba(139,92,246,.3)", borderRadius: 4, padding: "1px 6px" }}>
              v{ticket.version}
            </span>
          )}
          {(ticket.labels || []).map(l => (
            <span key={l} style={{ fontFamily: T.body, fontSize: 10, fontWeight: 600, color: T.accent,
              background: `${T.accent}14`, border: `1px solid ${T.accent}44`, borderRadius: 10, padding: "1px 7px" }}>
              {l}
            </span>
          ))}
        </div>

        {/* Description preview */}
        {ticket.description && (
          <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, lineHeight: 1.5,
            overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            marginBottom: 10 }}>
            {ticket.description}
          </div>
        )}

        {/* Assignee + due date footer */}
        {(ticket.assigneeId || ticket.dueDate) && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 8, gap: 6 }}>
            {ticket.assigneeId ? (
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                {/* Avatar circle — colour is deterministic from the user ID */}
                <div style={{
                  width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                  background: avatarColor(ticket.assigneeId),
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: T.body, fontSize: 10, fontWeight: 700, color: "#fff",
                }}>
                  {ticket.assigneeInitial || "?"}
                </div>
                <span style={{ fontFamily: T.body, fontSize: 11, color: T.textMuted }}>
                  {ticket.assigneeName || ticket.assigneeId}
                </span>
              </div>
            ) : <span />}

            {ticket.dueDate && (
              <span style={{
                fontFamily: T.mono, fontSize: 10, fontWeight: 600,
                padding: "1px 6px", borderRadius: 4,
                color:      isOverdue(ticket.dueDate) ? T.danger  : T.textMuted,
                background: isOverdue(ticket.dueDate) ? `${T.danger}15`  : T.surface,
                border:     `1px solid ${isOverdue(ticket.dueDate) ? T.danger + "55" : T.border}`,
              }}>
                {isOverdue(ticket.dueDate) ? "⚠ " : ""}{ticket.dueDate}
              </span>
            )}
          </div>
        )}

        {/* Nav arrows — back / forward only */}
        {canEdit && (colIndex > 0 || colIndex < columns.length - 1) && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 5,
          borderTop: `1px solid ${T.border}22`, paddingTop: 8 }}>
          {colIndex > 0 ? (
            <button onClick={stop(() => onMove(ticket, columns[colIndex - 1]))}
              style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 4,
                color: T.textMuted, cursor: "pointer", fontSize: 11, padding: "2px 8px", fontFamily: T.body }}>
              ← {columns[colIndex - 1].split(" ")[0]}
            </button>
          ) : <span />}
          {colIndex < columns.length - 1 && (
            <button onClick={stop(() => onMove(ticket, columns[colIndex + 1]))}
              style={{ background: T.accentBg, border: `1px solid ${T.accent}55`, borderRadius: 4,
                color: T.accent, cursor: "pointer", fontSize: 11, padding: "2px 8px",
                fontFamily: T.body, fontWeight: 600 }}>
              {columns[colIndex + 1].split(" ")[0]} →
            </button>
          )}
        </div>
        )}
      </div>

      {dropIndicator === "after" && <DropLine />}

      {confirm && (
        <ConfirmModal
          message={`Delete "${ticket.title}"?`}
          onConfirm={() => { setConfirm(false); onDelete(ticket.id); }}
          onCancel={() => setConfirm(false)} />
      )}
    </>
  );
};

// ─── Ticket Preview Panel ─────────────────────────────────────────────────────

const TicketPreview = ({ ticket, colIndex, tickets, testItems = [], users, teams = [], onClose, onEdit, onMove, onDelete, onPreview, onDiagram, onCoverage, columns = COLUMNS, onLabelsChanged, onCascade, onTicketUpdated }) => {
  const { user, canEdit } = useAuth();
  const [confirm,    setConfirm]    = useState(false);
  const [tab,        setTab]        = useState("overview"); // "overview" | "links" | "order" | "comments" | "files"
  const [links,      setLinks]      = useState(null);       // null = not yet fetched
  const [childLinks, setChildLinks] = useState(null);       // per-child link map
  const [cascadeOpen, setCascadeOpen] = useState(false);
  const [estimateOpen, setEstimateOpen] = useState(false);
  const [watching,   setWatching]   = useState(false);
  const [watcherCount, setWatcherCount] = useState(0);

  useEffect(() => {
    api.tickets.watchers(ticket.id).then(rows => {
      setWatcherCount(rows.length);
      setWatching(rows.some(w => w.userId === user?.id));
    }).catch(() => {});
  }, [ticket.id, user?.id]);

  const toggleWatch = async () => {
    try {
      if (watching) { await api.tickets.unwatch(ticket.id); setWatching(false); setWatcherCount(c => Math.max(0, c - 1)); }
      else { await api.tickets.watch(ticket.id); setWatching(true); setWatcherCount(c => c + 1); }
    } catch (e) { toast.error(e.message); }
  };

  const handleApproval = async action => {
    try {
      const updated = await api.approvals[action](ticket.id);
      onTicketUpdated?.(updated);
      toast.success(action === "request" ? "Approval requested" : action === "approve" ? "Approved" : "Rejected");
    } catch (e) { toast.error(e.message); }
  };

  const parent   = ticket.parentId ? tickets.find(t => t.id === ticket.parentId) : null;
  const children = tickets.filter(t => t.parentId === ticket.id)
    .sort((a, b) => a.position - b.position);

  const DONE_SET = new Set(["Done", "Ready to Deploy", "Released"]);

  // Reset state when the viewed ticket changes
  useEffect(() => {
    setTab("overview");
    setLinks(null);
    setChildLinks(null);
  }, [ticket.id]);

  // Fetch this ticket's links lazily on first non-overview tab open
  useEffect(() => {
    if (tab !== "overview" && links === null) {
      api.tickets.links(ticket.id).then(setLinks).catch(() => setLinks([]));
    }
  }, [tab, ticket.id, links]);

  // Fetch per-child links lazily when Order tab opens on a parent ticket
  useEffect(() => {
    if (tab === "order" && children.length > 0 && childLinks === null) {
      Promise.all(
        children.map(c =>
          api.tickets.links(c.id).then(ls => [c.id, ls]).catch(() => [c.id, []])
        )
      ).then(pairs => setChildLinks(Object.fromEntries(pairs)));
    }
  }, [tab, children.length, childLinks]);

  // Kahn's topological sort
  const topoSort = (nodeIds, edges) => {
    const inDeg = Object.fromEntries(nodeIds.map(id => [id, 0]));
    const adj   = Object.fromEntries(nodeIds.map(id => [id, []]));
    edges.forEach(({ from, to }) => {
      if (adj[from] !== undefined && inDeg[to] !== undefined) {
        adj[from].push(to); inDeg[to]++;
      }
    });
    const queue  = nodeIds.filter(id => inDeg[id] === 0);
    const result = [];
    while (queue.length) {
      const n = queue.shift(); result.push(n);
      (adj[n] || []).forEach(m => { inDeg[m]--; if (inDeg[m] === 0) queue.push(m); });
    }
    nodeIds.forEach(id => { if (!result.includes(id)) result.push(id); });
    return result;
  };

  const tabBtn = (id, label) => (
    <button key={id} type="button" onClick={() => setTab(id)} style={{
      fontFamily: T.body, fontSize: 11, fontWeight: tab === id ? 700 : 400,
      color: tab === id ? T.accent : T.textMuted,
      background: "none", border: "none", cursor: "pointer",
      borderBottom: `2px solid ${tab === id ? T.accent : "transparent"}`,
      padding: "7px 0", flex: 1, transition: "color .12s, border-color .12s",
    }}>{label}</button>
  );

  const metaRow = (label, content) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 24 }}>
      <span style={{ fontFamily: T.body, fontSize: 11, color: T.textMuted, width: 68, flexShrink: 0 }}>
        {label}
      </span>
      {content}
    </div>
  );

  // ── Overview tab ──────────────────────────────────────────────────────────────
  const renderOverview = () => (
    <>
      {parent && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: -4 }}>
          <Badge variant={TYPE_VARIANT[parent.type] || "default"}>{parent.type}</Badge>
          <button type="button" onClick={() => onPreview?.(parent)}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0,
              fontFamily: T.mono, fontSize: 11, color: T.accent, textDecoration: "underline dotted" }}>
            {parent.id}
          </button>
          <span style={{ fontFamily: T.body, fontSize: 11, color: T.textMuted,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {parent.title}
          </span>
        </div>
      )}

      <div style={{ fontFamily: T.head, fontSize: 15, fontWeight: 700, color: T.text, lineHeight: 1.45 }}>
        {ticket.title}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8,
        paddingBottom: 16, borderBottom: `1px solid ${T.border}` }}>
        {metaRow("Status",
          <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 700,
            color: COL_ACCENT[ticket.status] || T.accent,
            background: `${COL_ACCENT[ticket.status] || T.accent}22`,
            border: `1px solid ${(COL_ACCENT[ticket.status] || T.accent)}44`, borderRadius: 10, padding: "2px 10px" }}>
            {ticket.status}
          </span>
        )}
        {metaRow("Type", <Badge variant={TYPE_VARIANT[ticket.type] || "default"}>{ticket.type}</Badge>)}
        {metaRow("Priority", <Badge variant={PRIORITY_VARIANT[ticket.priority] || "default"}>{ticket.priority}</Badge>)}
        {ticket.storyPoints != null && metaRow("Story Points",
          <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 700, color: T.text,
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, padding: "2px 8px" }}>
            {ticket.storyPoints}
          </span>
        )}
        {ticket.section && metaRow("Section",
          <span style={{ fontFamily: T.mono, fontSize: 12, color: T.text }}>{ticket.section}</span>
        )}
        {ticket.version && metaRow("Version",
          <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 700,
            color: "#8b5cf6", background: "rgba(139,92,246,.12)",
            border: "1px solid rgba(139,92,246,.3)", borderRadius: 4, padding: "2px 8px" }}>
            v{ticket.version}
          </span>
        )}
        {ticket.assigneeId && metaRow("Assignee",
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
              background: avatarColor(ticket.assigneeId),
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: T.body, fontSize: 11, fontWeight: 700, color: "#fff" }}>
              {ticket.assigneeInitial || "?"}
            </div>
            <span style={{ fontFamily: T.body, fontSize: 12, color: T.text }}>
              {ticket.assigneeName || ticket.assigneeId}
            </span>
          </div>
        )}
        {ticket.teamId && metaRow("Team",
          <span style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600, color: T.text,
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 20, padding: "2px 10px" }}>
            👥 {ticket.teamName || ticket.teamId}
          </span>
        )}
        {ticket.approvalStatus && metaRow("Approval",
          <span style={{ fontFamily: T.mono, fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 10,
            color: APPROVAL_COLOR[ticket.approvalStatus] || T.textMuted,
            background: `${APPROVAL_COLOR[ticket.approvalStatus] || T.textMuted}18`,
            border: `1px solid ${APPROVAL_COLOR[ticket.approvalStatus] || T.textMuted}44` }}
            title={ticket.approvedBy ? `by ${ticket.approvedBy}${ticket.approvedAt ? " · " + new Date(ticket.approvedAt).toLocaleString() : ""}` : undefined}>
            {ticket.approvalStatus}
          </span>
        )}
        {ticket.dueDate && metaRow("Due Date",
          <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
            color:      isOverdue(ticket.dueDate) ? T.danger : T.text,
            background: isOverdue(ticket.dueDate) ? `${T.danger}15` : T.surface,
            border:     `1px solid ${isOverdue(ticket.dueDate) ? T.danger + "55" : T.border}` }}>
            {isOverdue(ticket.dueDate) ? "⚠ Overdue · " : ""}{ticket.dueDate}
          </span>
        )}
        {ticket.testNotes && metaRow("Test notes",
          <span style={{ fontFamily: T.body, fontSize: 12, color: T.text,
            lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
            {ticket.testNotes}
          </span>
        )}
        {Object.entries(ticket.customFields || {}).map(([k, v]) => metaRow(k,
          <span key={k} style={{ fontFamily: T.body, fontSize: 12, color: T.text }}>{v}</span>
        ))}
      </div>

      <TicketLabelsPanel ticketId={ticket.id} onChange={onLabelsChanged} />

      <div>
        <div style={{ fontFamily: T.body, fontSize: 10, fontWeight: 700, color: T.textMuted,
          textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8 }}>
          Description
        </div>
        {ticket.description ? (
          <div style={{ fontFamily: T.body, fontSize: 13, color: T.text, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
            {ticket.description}
          </div>
        ) : (
          <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>
            No description provided.
          </div>
        )}
      </div>

      {children.length > 0 && (
        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 16 }}>
          <div style={{ fontFamily: T.body, fontSize: 10, fontWeight: 700, color: T.textMuted,
            textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8,
            display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>Children ({children.length})</span>
            <span style={{ fontWeight: 400, color: T.border }}>
              {children.filter(c => DONE_SET.has(c.status)).length} done
            </span>
          </div>
          {(() => {
            const done = children.filter(c => DONE_SET.has(c.status)).length;
            const pct  = Math.round((done / children.length) * 100);
            return (
              <div style={{ height: 4, borderRadius: 2, background: T.border, marginBottom: 10, overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 2, width: `${pct}%`,
                  background: pct === 100 ? T.success : T.accent, transition: "width .3s" }} />
              </div>
            );
          })()}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {children.map(c => (
              <div key={c.id} onClick={() => onPreview?.(c)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                  borderRadius: 6, background: T.bg, border: `1px solid ${T.border}`,
                  cursor: "pointer", transition: "background .1s" }}
                onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover}
                onMouseLeave={e => e.currentTarget.style.background = T.bg}>
                <span style={{ fontSize: 12, flexShrink: 0, color: DONE_SET.has(c.status) ? T.success : T.border }}>
                  {DONE_SET.has(c.status) ? "✓" : "○"}
                </span>
                <span style={{ fontSize: 13, flexShrink: 0 }}>{TYPE_ICON[c.type] || "📋"}</span>
                <Badge variant={TYPE_VARIANT[c.type] || "default"}>{c.type}</Badge>
                <span style={{ fontFamily: T.body, fontSize: 12, color: T.text, flex: 1,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  textDecoration: DONE_SET.has(c.status) ? "line-through" : "none",
                  opacity: DONE_SET.has(c.status) ? 0.6 : 1 }}>
                  {c.title}
                </span>
                <span style={{ fontFamily: T.mono, fontSize: 9, color: T.textMuted, flexShrink: 0 }}>
                  {c.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );

  // ── Links tab ──────────────────────────────────────────────────────────────────
  const renderLinks = () => {
    if (links === null) return (
      <div style={{ padding: "32px 0", textAlign: "center", fontFamily: T.body,
        fontSize: 12, color: T.textMuted }}>Loading links…</div>
    );

    const GROUP_ORDER = ["Is blocked by", "Blocks", "Implements", "Is implemented by", "Relates to", "Duplicates", "Is duplicated by"];
    const GROUP_ICON  = { "Is blocked by": "🚧", "Blocks": "⛔", "Implements": "🔩",
      "Is implemented by": "📦", "Relates to": "↔", "Duplicates": "🔁", "Is duplicated by": "🔁" };
    const GROUP_COLOR = { "Is blocked by": T.warning, "Blocks": T.danger };

    const grouped = {};
    links.forEach(l => { (grouped[l.displayType] || (grouped[l.displayType] = [])).push(l); });
    const activeGroups = GROUP_ORDER.filter(g => grouped[g]?.length > 0);

    const hasBlocker = (grouped["Is blocked by"] || []).some(l => {
      const t = tickets.find(x => x.id === l.otherTicketId);
      return t && !DONE_SET.has(t.status);
    });

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {hasBlocker && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
            borderRadius: 7, background: `${T.warning}12`, border: `1px solid ${T.warning}44`,
            fontFamily: T.body, fontSize: 12, color: T.warning }}>
            🚧 This ticket has unresolved blockers.
          </div>
        )}

        {activeGroups.length === 0 && (
          <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>
            No linked tickets.
          </div>
        )}

        {activeGroups.map(groupName => (
          <div key={groupName}>
            <div style={{ fontFamily: T.body, fontSize: 10, fontWeight: 700,
              textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 6,
              color: GROUP_COLOR[groupName] || T.textMuted,
              display: "flex", alignItems: "center", gap: 5 }}>
              {GROUP_ICON[groupName] || "🔗"} {groupName} ({grouped[groupName].length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {grouped[groupName].map(l => {
                const t    = tickets.find(x => x.id === l.otherTicketId);
                const done = t && DONE_SET.has(t.status);
                return (
                  <div key={l.id} onClick={() => t && onPreview?.(t)}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                      borderRadius: 6, background: T.bg, border: `1px solid ${T.border}`,
                      cursor: t ? "pointer" : "default", opacity: done ? 0.65 : 1,
                      transition: "background .1s" }}
                    onMouseEnter={e => { if (t) e.currentTarget.style.background = T.surfaceHover; }}
                    onMouseLeave={e => { e.currentTarget.style.background = T.bg; }}>
                    <span style={{ fontSize: 11, flexShrink: 0, color: done ? T.success : T.border }}>
                      {done ? "✓" : "○"}
                    </span>
                    <span style={{ fontFamily: T.mono, fontSize: 10, color: T.accent, flexShrink: 0 }}>
                      {l.otherTicketId}
                    </span>
                    <span style={{ fontFamily: T.body, fontSize: 12, color: T.text, flex: 1,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      textDecoration: done ? "line-through" : "none" }}>
                      {l.otherTicket?.title || "Unknown ticket"}
                    </span>
                    {t?.status && (
                      <span style={{ fontFamily: T.mono, fontSize: 9, flexShrink: 0, whiteSpace: "nowrap",
                        color: COL_ACCENT[t.status] || T.textMuted,
                        background: `${COL_ACCENT[t.status] || T.border}18`,
                        border: `1px solid ${COL_ACCENT[t.status] || T.border}44`,
                        borderRadius: 4, padding: "1px 5px" }}>
                        {t.status}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {ticket.type === "Story" && (
          <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
            <TestedByPanel ticketId={ticket.id} testItems={testItems} />
          </div>
        )}

        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
          <TicketLinksPanel ticketId={ticket.id} allTickets={tickets} />
        </div>
      </div>
    );
  };

  // ── Order of Implementation tab ────────────────────────────────────────────────
  const renderOrder = () => {
    // Leaf ticket: show blocking chain (prereqs → this → unlocks)
    if (children.length === 0) {
      if (links === null) return (
        <div style={{ padding: "32px 0", textAlign: "center", fontFamily: T.body,
          fontSize: 12, color: T.textMuted }}>Loading…</div>
      );
      const prereqs = links.filter(l => l.displayType === "Is blocked by");
      const unlocks = links.filter(l => l.displayType === "Blocks");

      if (prereqs.length === 0 && unlocks.length === 0) return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ padding: "16px", borderRadius: 8, background: T.bg,
            border: `1px solid ${T.border}`, fontFamily: T.body, fontSize: 12,
            color: T.textMuted, textAlign: "center", fontStyle: "italic" }}>
            No ordering constraints defined.
          </div>
          <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, lineHeight: 1.65 }}>
            On the <strong style={{ color: T.text }}>Links</strong> tab, add a{" "}
            <strong style={{ color: T.text }}>Blocks</strong> link to mark what this ticket must be
            completed before, or <strong style={{ color: T.text }}>Is blocked by</strong> to declare
            a prerequisite.
          </div>
        </div>
      );

      const chainRow = (l, alert) => {
        const t    = tickets.find(x => x.id === l.otherTicketId);
        const done = t && DONE_SET.has(t.status);
        return (
          <div key={l.id} onClick={() => t && onPreview?.(t)}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
              borderRadius: 7, background: T.bg,
              border: `1px solid ${alert && !done ? T.warning + "55" : T.border}`,
              cursor: t ? "pointer" : "default", opacity: done ? 0.65 : 1, transition: "background .1s" }}
            onMouseEnter={e => { if (t) e.currentTarget.style.background = T.surfaceHover; }}
            onMouseLeave={e => { e.currentTarget.style.background = T.bg; }}>
            <span style={{ fontSize: 11, color: done ? T.success : (alert ? T.warning : T.border), flexShrink: 0 }}>
              {done ? "✓" : "○"}
            </span>
            <span style={{ fontFamily: T.mono, fontSize: 10, color: T.accent, flexShrink: 0 }}>
              {l.otherTicketId}
            </span>
            <span style={{ fontFamily: T.body, fontSize: 12, color: T.text, flex: 1,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {l.otherTicket?.title || ""}
            </span>
            {t?.status && (
              <span style={{ fontFamily: T.mono, fontSize: 9, color: COL_ACCENT[t.status] || T.textMuted, flexShrink: 0 }}>
                {t.status}
              </span>
            )}
          </div>
        );
      };

      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {prereqs.length > 0 && (
            <div>
              <div style={{ fontFamily: T.body, fontSize: 10, fontWeight: 700,
                textTransform: "uppercase", letterSpacing: ".07em", color: T.warning, marginBottom: 6 }}>
                🚧 Prerequisites
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {prereqs.map(l => chainRow(l, true))}
              </div>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px",
            borderRadius: 7, background: `${T.accent}12`, border: `1px solid ${T.accent}44`,
            fontFamily: T.body, fontSize: 12, fontWeight: 600, color: T.accent }}>
            <span style={{ fontFamily: T.mono, fontSize: 10, flexShrink: 0 }}>{ticket.id}</span>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {ticket.title}
            </span>
            <span style={{ fontFamily: T.mono, fontSize: 9, color: T.textMuted, fontWeight: 400, flexShrink: 0 }}>
              this
            </span>
          </div>
          {unlocks.length > 0 && (
            <div>
              <div style={{ fontFamily: T.body, fontSize: 10, fontWeight: 700,
                textTransform: "uppercase", letterSpacing: ".07em", color: T.textMuted, marginBottom: 6 }}>
                ✓ Unlocks
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {unlocks.map(l => chainRow(l, false))}
              </div>
            </div>
          )}
        </div>
      );
    }

    // Parent ticket: topological sort of children
    if (childLinks === null) return (
      <div style={{ padding: "32px 0", textAlign: "center", fontFamily: T.body,
        fontSize: 12, color: T.textMuted }}>Building order…</div>
    );

    const childIds = new Set(children.map(c => c.id));
    const edges = [];
    children.forEach(c => {
      (childLinks[c.id] || []).forEach(l => {
        if (l.direction === "out" && childIds.has(l.otherTicketId) &&
            (l.linkType === "Blocks" || l.linkType === "Implements")) {
          edges.push({ from: c.id, to: l.otherTicketId });
        }
      });
    });

    const sorted = topoSort(children.map(c => c.id), edges)
      .map(id => children.find(c => c.id === id)).filter(Boolean);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {edges.length === 0 && (
          <div style={{ fontFamily: T.body, fontSize: 11, color: T.textMuted, fontStyle: "italic",
            padding: "8px 12px", borderRadius: 7, background: T.bg, border: `1px solid ${T.border}` }}>
            No dependency links between children — ordered by position. Add{" "}
            <strong style={{ color: T.text }}>Blocks</strong> links on child tickets to define ordering.
          </div>
        )}
        {sorted.map((c, i) => {
          const done      = DONE_SET.has(c.status);
          const isBlocked = edges.filter(e => e.to === c.id)
            .some(e => !DONE_SET.has(children.find(x => x.id === e.from)?.status));
          return (
            <div key={c.id} onClick={() => onPreview?.(c)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
                borderRadius: 7, background: T.bg,
                border: `1px solid ${isBlocked ? T.warning + "55" : done ? T.success + "33" : T.border}`,
                cursor: "pointer", opacity: done ? 0.65 : 1,
                transition: "background .1s, border-color .15s" }}
              onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover}
              onMouseLeave={e => e.currentTarget.style.background = T.bg}>
              <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 700, flexShrink: 0,
                width: 22, height: 22, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: done ? `${T.success}22` : `${T.accent}22`,
                color: done ? T.success : T.accent,
                border: `1px solid ${done ? T.success + "44" : T.accent + "44"}` }}>
                {done ? "✓" : i + 1}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: T.body, fontSize: 12, color: T.text, fontWeight: 500,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  textDecoration: done ? "line-through" : "none" }}>
                  {c.title}
                </div>
                <div style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted, marginTop: 1,
                  display: "flex", gap: 5, alignItems: "center" }}>
                  {c.id}
                  {isBlocked && <span style={{ color: T.warning, fontWeight: 700 }}>· 🚧 blocked</span>}
                </div>
              </div>
              <span style={{ fontFamily: T.mono, fontSize: 9, flexShrink: 0, whiteSpace: "nowrap",
                color: COL_ACCENT[c.status] || T.textMuted,
                background: `${COL_ACCENT[c.status] || T.border}18`,
                border: `1px solid ${COL_ACCENT[c.status] || T.border}44`,
                borderRadius: 4, padding: "1px 5px" }}>
                {c.status}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={{
      width: 320, flexShrink: 0,
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderTop: `3px solid ${COL_ACCENT[ticket.status] || T.accent}`,
      borderRadius: 10,
      display: "flex", flexDirection: "column",
      overflow: "hidden",
      alignSelf: "stretch",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <span title="Click to copy ticket ID"
          onClick={() => navigator.clipboard.writeText(ticket.id).then(() => toast.success(`Copied ${ticket.id}`))}
          style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted, cursor: "pointer",
            userSelect: "none", padding: "2px 6px", borderRadius: 4, transition: "background .12s" }}
          onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          {ticket.id}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button type="button" onClick={toggleWatch} title={watching ? "Stop watching" : "Watch this ticket"}
            style={{ background: watching ? T.accentBg : "none", border: `1px solid ${watching ? T.accent + "66" : T.border}`,
              borderRadius: 6, color: watching ? T.accent : T.textMuted, cursor: "pointer", padding: "5px 10px",
              fontSize: 12, fontFamily: T.body, lineHeight: 1, display: "flex", alignItems: "center", gap: 4,
              transition: "border-color .12s, color .12s, background .12s" }}>
            👁{watcherCount > 0 && <span style={{ fontFamily: T.mono, fontSize: 10 }}>{watcherCount}</span>}
          </button>
          <button type="button" onClick={() => setEstimateOpen(true)} title="Estimate Delivery"
            style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6,
              color: T.textMuted, cursor: "pointer", padding: "5px 10px", fontSize: 14,
              fontFamily: T.body, lineHeight: 1, transition: "border-color .12s, color .12s, background .12s" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.color = T.accent; e.currentTarget.style.background = T.accentBg; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textMuted; e.currentTarget.style.background = "none"; }}>
            🎲
          </button>
          {canEdit && (
            <ActionMenu items={[
              { icon: "✎", label: "Edit", onClick: onEdit },
              ...(ticket.type === "Epic" ? [
                { icon: "📊", label: "Coverage", onClick: () => onCoverage?.(ticket) },
                { icon: "🗺", label: "Diagram",  onClick: () => onDiagram?.(ticket)  },
              ] : []),
              ...(ticket.type === "Epic" && children.length > 0 && (ticket.assigneeId || ticket.teamId) ? [
                { icon: "👥", label: "Apply to Children", onClick: () => setCascadeOpen(true) },
              ] : []),
              ...(!ticket.approvalStatus || ticket.approvalStatus === "Rejected" ? [
                { icon: "🔖", label: "Request Approval", onClick: () => handleApproval("request") },
              ] : ticket.approvalStatus === "Pending" ? [
                { icon: "✓", label: "Approve", onClick: () => handleApproval("approve") },
                { icon: "✕", label: "Reject",  onClick: () => handleApproval("reject") },
              ] : []),
              { icon: "✕", label: "Delete", variant: "danger", onClick: () => setConfirm(true) },
            ]} />
          )}
          <button onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer",
              color: T.textMuted, fontSize: 18, padding: "0 2px", lineHeight: 1 }}>×</button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        {tabBtn("overview", "Overview")}
        {tabBtn("links", "🔗 Links")}
        {tabBtn("order", "📋 Order")}
        {tabBtn("comments", "💬 Comments")}
        {tabBtn("files", "📎 Files")}
        {tabBtn("time", "⏱ Time")}
        {tabBtn("activity", "🕐 Activity")}
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px",
        display: "flex", flexDirection: "column", gap: 16 }}>
        {tab === "overview" && renderOverview()}
        {tab === "links"    && renderLinks()}
        {tab === "order"    && renderOrder()}
        {tab === "comments" && <TicketCommentsPanel ticketId={ticket.id} />}
        {tab === "files"    && <TicketAttachmentsPanel ticketId={ticket.id} />}
        {tab === "time"     && <TicketWorkLogPanel ticketId={ticket.id} />}
        {tab === "activity" && <TicketActivityPanel ticketId={ticket.id} />}
      </div>

      {/* Actions footer */}
      <div style={{ padding: "10px 14px", borderTop: `1px solid ${T.border}`,
        display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
        {canEdit && !["Done", "Ready to Deploy", "Released", "Backlog"].includes(ticket.status) && (
          <button onClick={() => onMove(ticket, "Backlog")}
            style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 5,
              color: T.textMuted, cursor: "pointer", fontSize: 11, padding: "5px 10px", fontFamily: T.body }}>
            ↓ Backlog
          </button>
        )}
        {canEdit && colIndex > 0 && (
          <button onClick={() => onMove(ticket, columns[colIndex - 1])}
            style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 5,
              color: T.textMuted, cursor: "pointer", fontSize: 11, padding: "5px 10px", fontFamily: T.body }}>
            ← {columns[colIndex - 1].split(" ")[0]}
          </button>
        )}
        <div style={{ flex: 1 }} />
        {canEdit && colIndex < columns.length - 1 && (
          <button onClick={() => onMove(ticket, columns[colIndex + 1])}
            style={{ background: T.accentBg, border: `1px solid ${T.accent}55`, borderRadius: 5,
              color: T.accent, cursor: "pointer", fontSize: 11, padding: "5px 10px",
              fontFamily: T.body, fontWeight: 600 }}>
            {columns[colIndex + 1].split(" ")[0]} →
          </button>
        )}
      </div>

      {confirm && (
        <ConfirmModal
          message={`Delete "${ticket.title}"?`}
          onConfirm={() => { setConfirm(false); onDelete(ticket.id); onClose(); }}
          onCancel={() => setConfirm(false)} />
      )}
      {cascadeOpen && (
        <ApplyToChildrenModal
          epic={ticket} children={children} teams={teams}
          onConfirm={async () => { await onCascade?.(ticket, children); setCascadeOpen(false); }}
          onClose={() => setCascadeOpen(false)} />
      )}
      {estimateOpen && (
        <EstimateModal ticket={ticket} onClose={() => setEstimateOpen(false)} />
      )}
    </div>
  );
};

// ─── Apply Epic assignment to children (TKT-4N18SL) ──────────────────────────
// Explicit, confirmed cascade — never automatic/silent. Shows exactly what will be
// pushed onto every child ticket and which ones will actually change before committing,
// so a child deliberately assigned to someone other than the epic's owner isn't
// silently clobbered without the user seeing it coming.

const ApplyToChildrenModal = ({ epic, children, teams, onConfirm, onClose }) => {
  const [applying, setApplying] = useState(false);
  const teamName = id => teams.find(t => t.id === id)?.name || id;

  const willChange = c => c.assigneeId !== (epic.assigneeId || null) || c.teamId !== (epic.teamId || null);
  const changingCount = children.filter(willChange).length;

  const handleConfirm = async () => {
    setApplying(true);
    try { await onConfirm(); } finally { setApplying(false); }
  };

  return (
    <Modal title="Apply to Children" onClose={onClose} width={520}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontFamily: T.body, fontSize: 13, color: T.text, lineHeight: 1.5 }}>
          This will set every child ticket of <strong>{epic.title}</strong> to:
        </div>
        <div style={{ display: "flex", gap: 8, padding: "10px 14px", borderRadius: 8,
          background: T.accent + "0d", border: `1px solid ${T.accent}33` }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted, textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 3 }}>Assignee</div>
            <div style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.text }}>
              {epic.assigneeName || <span style={{ color: T.textMuted, fontWeight: 400, fontStyle: "italic" }}>— Unassigned —</span>}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted, textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 3 }}>Team</div>
            <div style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.text }}>
              {epic.teamId ? `👥 ${teamName(epic.teamId)}` : <span style={{ color: T.textMuted, fontWeight: 400, fontStyle: "italic" }}>— No Team —</span>}
            </div>
          </div>
        </div>

        <div style={{ fontFamily: T.body, fontSize: 11, fontWeight: 700, color: T.textMuted,
          textTransform: "uppercase", letterSpacing: ".07em" }}>
          Affected tickets ({changingCount} of {children.length} will change)
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 280, overflowY: "auto" }}>
          {children.map(c => {
            const changes = willChange(c);
            return (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 11px",
                borderRadius: 7, background: changes ? T.warning + "0d" : T.bg,
                border: `1px solid ${changes ? T.warning + "33" : T.border}` }}>
                <span style={{ fontSize: 12, flexShrink: 0 }}>{TYPE_ICON[c.type] || "📋"}</span>
                <span style={{ fontFamily: T.body, fontSize: 12, color: T.text, flex: 1,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.title}
                </span>
                <span style={{ fontFamily: T.body, fontSize: 11, color: T.textMuted, flexShrink: 0 }}>
                  {c.assigneeName || "Unassigned"}{c.teamId ? ` · ${teamName(c.teamId)}` : ""}
                </span>
                {changes && (
                  <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 700, color: T.warning,
                    background: T.warning + "18", border: `1px solid ${T.warning}44`,
                    borderRadius: 4, padding: "1px 6px", flexShrink: 0 }}>
                    CHANGES
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 4 }}>
          <Btn variant="ghost" onClick={onClose} disabled={applying}>Cancel</Btn>
          <Btn variant="primary" onClick={handleConfirm} disabled={applying || changingCount === 0}>
            {applying ? "Applying…" : `Apply to ${changingCount} ticket${changingCount !== 1 ? "s" : ""}`}
          </Btn>
        </div>
      </div>
    </Modal>
  );
};

// ─── Estimate Delivery (Monte Carlo) ───────────────────────────────────────────
// No historical per-stage timing data exists yet, so this samples admin-calibrated
// three-point (optimistic/likely/pessimistic) days-per-story-point assumptions via a
// triangular distribution (routes/estimation.js) — directional, not a committed date.

const EST_STAGE_LABELS = { integration: "Integration", testing: "Testing", patching: "Patching", release: "Release" };

const EstimateHistogram = ({ histogram, p50, p80, p95 }) => {
  const W = 460, H = 120, PAD = 8;
  const min = histogram[0].from, max = histogram[histogram.length - 1].to;
  const span = max - min || 1;
  const maxCount = Math.max(...histogram.map(b => b.count), 1);
  const x = v => PAD + ((v - min) / span) * (W - PAD * 2);
  const barW = (W - PAD * 2) / histogram.length;

  const marker = (value, color, label) => (
    <g key={label}>
      <line x1={x(value)} y1={14} x2={x(value)} y2={H} stroke={color} strokeWidth="1.5" strokeDasharray="3,3" />
      <text x={x(value)} y={10} textAnchor="middle" fontSize="9" fill={color} fontFamily="monospace">{label}</text>
    </g>
  );

  return (
    <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 6px" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {histogram.map((b, i) => {
          const h = (b.count / maxCount) * (H - 14);
          return (
            <rect key={i} x={PAD + i * barW} y={H - h}
              width={Math.max(barW - 1, 1)} height={h} fill={T.accent} opacity="0.55" />
          );
        })}
        {marker(p50, T.accent, "P50")}
        {marker(p80, T.warning, "P80")}
        {marker(p95, T.danger, "P95")}
      </svg>
    </div>
  );
};

const EstimateModal = ({ ticket, onClose }) => {
  const [storyPoints, setStoryPoints] = useState(ticket.storyPoints ?? 1);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    const sp = parseFloat(storyPoints);
    if (!Number.isFinite(sp) || sp <= 0) { toast.error("Story points must be a positive number"); return; }
    setRunning(true);
    try {
      setResult(await api.estimation.run(sp));
    } catch (e) { toast.error(e.message); }
    finally { setRunning(false); }
  };

  const projectedDate = days => {
    const d = new Date();
    d.setDate(d.getDate() + Math.ceil(days));
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <Modal title={`🎲 Estimate Delivery — ${ticket.title}`} onClose={onClose} width={520}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700, color: T.textMuted,
              textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 5 }}>Story Points</div>
            <input type="number" min="0.5" step="0.5" value={storyPoints}
              onChange={e => setStoryPoints(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", borderRadius: 7, border: `1px solid ${T.border}`,
                background: T.bg, fontFamily: T.body, fontSize: 13, color: T.text, outline: "none", boxSizing: "border-box" }} />
          </div>
          <Btn variant="primary" onClick={run} disabled={running}>{running ? "Simulating…" : "Run Simulation"}</Btn>
        </div>

        {!ticket.storyPoints && (
          <div style={{ fontFamily: T.body, fontSize: 11.5, color: T.textMuted, fontStyle: "italic", marginTop: -10 }}>
            This ticket has no story points set — defaulted to 1. Adjust above for a more realistic estimate.
          </div>
        )}

        {result && (
          <>
            <div style={{ display: "flex", gap: 10 }}>
              {[["P50", result.p50, T.accent], ["P80", result.p80, T.warning], ["P95", result.p95, T.danger]].map(([label, days, color]) => (
                <div key={label} style={{ flex: 1, textAlign: "center", padding: "10px 6px", borderRadius: 8,
                  background: T.bg, border: `1px solid ${T.border}` }}>
                  <div style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700, color, letterSpacing: ".06em" }}>{label}</div>
                  <div style={{ fontFamily: T.head, fontSize: 20, fontWeight: 800, color: T.text, margin: "3px 0" }}>
                    {days.toFixed(1)}d
                  </div>
                  <div style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted }}>{projectedDate(days)}</div>
                </div>
              ))}
            </div>

            <EstimateHistogram histogram={result.histogram} p50={result.p50} p80={result.p80} p95={result.p95} />

            <div>
              <div style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700, color: T.textMuted,
                textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>Per-Stage Breakdown</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {Object.entries(result.stageAverages).map(([stage, days]) => {
                  const pct = Math.round((days / result.mean) * 100);
                  return (
                    <div key={stage} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 80, fontFamily: T.body, fontSize: 12, color: T.text, flexShrink: 0 }}>
                        {EST_STAGE_LABELS[stage] || stage}
                      </span>
                      <div style={{ flex: 1, height: 8, borderRadius: 4, background: T.bg, overflow: "hidden", border: `1px solid ${T.border}` }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: T.accent, borderRadius: 4 }} />
                      </div>
                      <span style={{ width: 46, textAlign: "right", fontFamily: T.mono, fontSize: 11, color: T.textMuted, flexShrink: 0 }}>
                        {days.toFixed(1)}d
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <div style={{ fontFamily: T.body, fontSize: 11, color: T.textMuted, lineHeight: 1.5 }}>
          Simulates 10,000 runs through Integration → Testing → Patching → Release using
          admin-configured day-per-point assumptions (tune these under Application Settings).
          Calendar days, not business days — treat this as directional, not a committed date.
        </div>
      </div>
    </Modal>
  );
};

// ─── Kanban Column ────────────────────────────────────────────────────────────

// ─── Bulk Action Bar ──────────────────────────────────────────────────────────

const BulkActionBar = ({ count, users = [], versions = [], columns = COLUMNS, onApply, onClear }) => {
  const [status,     setStatus]     = useState("");
  const [priority,   setPriority]   = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [versionId,  setVersionId]  = useState("");
  const [applying,   setApplying]   = useState(false);

  const hasChange = !!(status || priority || assigneeId || versionId);

  const handleApply = async () => {
    const patch = {};
    if (status)     patch.status     = status;
    if (priority)   patch.priority   = priority;
    if (assigneeId) patch.assigneeId = assigneeId === "__none__" ? null : assigneeId;
    if (versionId)  patch.versionId  = versionId  === "__none__" ? null : versionId;
    setApplying(true);
    try { await onApply(patch); setStatus(""); setPriority(""); setAssigneeId(""); setVersionId(""); }
    finally { setApplying(false); }
  };

  const selStyle = { fontFamily: T.body, fontSize: 12, color: T.text, background: T.bg,
    border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 8px", outline: "none", cursor: "pointer" };

  return (
    <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
      display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 10,
      background: T.surface, border: `1px solid ${T.border}`,
      boxShadow: "0 8px 28px rgba(0,0,0,.4)", zIndex: 60 }}>
      <span style={{ fontFamily: T.body, fontSize: 12, fontWeight: 700, color: T.accent,
        whiteSpace: "nowrap", paddingRight: 4 }}>
        {count} selected
      </span>
      <select value={status} onChange={e => setStatus(e.target.value)} style={selStyle}>
        <option value="">Status…</option>
        {columns.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <select value={priority} onChange={e => setPriority(e.target.value)} style={selStyle}>
        <option value="">Priority…</option>
        {["Critical", "High", "Medium", "Low"].map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} style={selStyle}>
        <option value="">Assignee…</option>
        <option value="__none__">— Unassigned —</option>
        {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      {versions.length > 0 && (
        <select value={versionId} onChange={e => setVersionId(e.target.value)} style={selStyle}>
          <option value="">Version…</option>
          <option value="__none__">— Unversioned —</option>
          {versions.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}
      <Btn size="sm" disabled={!hasChange || applying} onClick={handleApply}>
        {applying ? "Applying…" : `Apply to ${count}`}
      </Btn>
      <button type="button" onClick={onClear}
        style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, background: "none",
          border: "none", cursor: "pointer", padding: "4px 6px" }}>
        Clear
      </button>
    </div>
  );
};

const KanbanColumn = ({ status, tickets, allTickets, onEdit, onDelete, onMove, onPreview, onDiagram, onCoverage,
                        onDrop, colIndex, dragId, previewId, wipLimit, onSetWipLimit, columns = COLUMNS,
                        colAccent, bulkMode = false, selectedIds, onToggleBulkSelect }) => {
  const [dropTarget, setDropTarget] = useState(null);
  const [colDragOver, setColDragOver] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const [editingWip, setEditingWip] = useState(false);
  const [wipInput,   setWipInput]   = useState(wipLimit ?? "");
  const clearDrop = () => { setDropTarget(null); setColDragOver(false); };

  // WIP status: null = no limit, "ok" = under, "warn" = at limit, "over" = exceeded
  const wipStatus = wipLimit
    ? tickets.length > wipLimit  ? "over"
    : tickets.length === wipLimit ? "warn"
    : "ok"
    : null;

  const accent = colAccent || COL_ACCENT[status] || "#6366f1";

  const WIP_BADGE_COLOR = { ok: T.success, warn: T.warning, over: T.danger };

  const handleColDragOver = e => {
    e.preventDefault();
    // Only highlight column if dragging over the empty area (no card target)
    setColDragOver(true);
  };

  const handleCardDragOver = (id, side) => {
    setColDragOver(false);
    setDropTarget({ id, side });
  };

  const handleDrop = e => {
    e.preventDefault();
    const id = e.dataTransfer.getData("ticketId");
    if (id) onDrop(id, status, dropTarget?.id, dropTarget?.side);
    clearDrop();
  };

  return (
    <div
      onDragOver={handleColDragOver}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) clearDrop(); }}
      onDrop={handleDrop}
      style={{
        flex: 1, minWidth: 220,
        background: colDragOver ? `${accent}11` : T.surface,
        border:     `1px solid ${colDragOver ? accent : T.border}`,
        borderTop:  `3px solid ${accent}`,
        borderRadius: 10, padding: 14,
        transition: "background .15s, border-color .15s",
        display: "flex", flexDirection: "column", gap: 6,
      }}
    >
      {/* Column header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: T.head, fontSize: 14, fontWeight: 700, color: T.text }}>{status}</span>
          {/* Count badge — colour shifts when WIP limit is at/exceeded */}
          <span style={{
            fontFamily: T.mono, fontSize: 11, fontWeight: 700,
            color:      wipStatus ? WIP_BADGE_COLOR[wipStatus] : accent,
            background: wipStatus ? `${WIP_BADGE_COLOR[wipStatus]}22` : `${accent}22`,
            border:     `1px solid ${wipStatus ? WIP_BADGE_COLOR[wipStatus] + "55" : accent + "44"}`,
            borderRadius: 10, padding: "1px 8px",
            transition: "color .2s, background .2s, border-color .2s",
          }}>
            {tickets.length}{wipLimit ? ` / ${wipLimit}` : ""}
          </span>
          {wipStatus === "over" && (
            <span title="WIP limit exceeded" style={{ fontSize: 13 }}>⚠</span>
          )}
        </div>

        {/* WIP limit gear — admin only; shown on hover */}
        <div style={{ position: "relative" }}>
          {editingWip ? (
            <form onSubmit={e => { e.preventDefault(); onSetWipLimit(wipInput === "" ? null : Number(wipInput)); setEditingWip(false); }}
              style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input
                type="number" min="1" max="99" value={wipInput}
                onChange={e => setWipInput(e.target.value)}
                placeholder="∞"
                autoFocus
                style={{ width: 44, fontFamily: T.mono, fontSize: 12, textAlign: "center",
                  background: T.bg, border: `1px solid ${T.accent}`, borderRadius: 5,
                  color: T.text, padding: "2px 4px", outline: "none" }} />
              <button type="submit" style={{ background: T.accent, border: "none", borderRadius: 4,
                color: "#fff", cursor: "pointer", fontSize: 11, padding: "2px 6px", fontFamily: T.body }}>✓</button>
              <button type="button" onClick={() => setEditingWip(false)}
                style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 4,
                  color: T.textMuted, cursor: "pointer", fontSize: 11, padding: "2px 6px", fontFamily: T.body }}>✕</button>
            </form>
          ) : (
            <button type="button" onClick={() => { setWipInput(wipLimit ?? ""); setEditingWip(true); }}
              title={wipLimit ? `WIP limit: ${wipLimit} — click to change` : "Set WIP limit"}
              style={{ background: "none", border: "none", cursor: "pointer",
                color: wipLimit ? T.accent : T.border, fontSize: 13, lineHeight: 1,
                padding: "2px 4px", opacity: 0.7, transition: "opacity .15s, color .15s" }}
              onMouseEnter={e => e.currentTarget.style.opacity = "1"}
              onMouseLeave={e => e.currentTarget.style.opacity = "0.7"}>
              ⚙
            </button>
          )}
        </div>
      </div>

      {/* Cards */}
      {(expanded ? tickets : tickets.slice(0, PREVIEW_LIMIT)).map(t => (
        <TicketCard
          key={t.id}
          ticket={t}
          colIndex={colIndex}
          allTickets={allTickets}
          columns={columns}
          isDragging={dragId === t.id}
          isSelected={previewId === t.id}
          dropIndicator={dropTarget?.id === t.id ? dropTarget.side : null}
          bulkMode={bulkMode}
          bulkSelected={selectedIds?.has(t.id) ?? false}
          onToggleBulkSelect={onToggleBulkSelect}
          onEdit={onEdit}
          onDelete={onDelete}
          onMove={onMove}
          onPreview={onPreview}
          onDiagram={onDiagram}
          onCoverage={onCoverage}
          onDragStart={() => setDropTarget(null)}
          onDragEnd={() => clearDrop()}
          onDragOver={handleCardDragOver}
        />
      ))}

      {/* Show more / collapse */}
      {tickets.length > PREVIEW_LIMIT && !expanded && (
        <>
          <div style={{ borderTop: `1px dashed ${T.border}`, margin: "4px 0" }} />
          <button
            type="button"
            onClick={() => setExpanded(true)}
            style={{ fontFamily: T.body, fontSize: 11, color: T.textMuted, background: "none",
              border: "none", cursor: "pointer", textAlign: "center", padding: "4px 0",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}
            onMouseEnter={e => e.currentTarget.style.color = T.text}
            onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>
            <span>▾▾</span>
            <span>Show {tickets.length - PREVIEW_LIMIT} more</span>
          </button>
        </>
      )}
      {tickets.length > PREVIEW_LIMIT && expanded && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          style={{ fontFamily: T.body, fontSize: 11, color: T.textMuted, background: "none",
            border: "none", cursor: "pointer", textAlign: "center", padding: "4px 0",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}
          onMouseEnter={e => e.currentTarget.style.color = T.text}
          onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>
          <span>▴▴</span>
          <span>Collapse</span>
        </button>
      )}

      {/* Empty state / bottom drop zone */}
      {tickets.length === 0 && (
        <div style={{ fontFamily: T.body, fontSize: 12, color: T.border,
          fontStyle: "italic", textAlign: "center", padding: "20px 0" }}>
          Drop cards here
        </div>
      )}
    </div>
  );
};

// ─── Backlog Drawer ───────────────────────────────────────────────────────────

const BacklogDrawer = ({ tickets, onClose, onPromote, onEdit, onAdd }) => {
  const [sectionFilter, setSectionFilter] = useState("");
  const [search,        setSearch]        = useState("");

  const visible = tickets
    .filter(t => !sectionFilter || t.section === sectionFilter)
    .filter(t => !search || t.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const typeOrder = { Epic: 0, Story: 1, Feature: 2, Bug: 3, Improvement: 4, Task: 5, Chore: 6 };
      const pa = { Critical: 0, High: 1, Medium: 2, Low: 3 };
      return (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9)
          || (pa[a.priority] ?? 9) - (pa[b.priority] ?? 9);
    });

  // Close on Escape
  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 400 }}
      />

      {/* Drawer panel */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0,
        width: 400, zIndex: 401,
        background: T.surface, borderLeft: `1px solid ${T.border}`,
        display: "flex", flexDirection: "column",
        boxShadow: "-8px 0 32px rgba(0,0,0,.18)",
        animation: "slideInRight .18s ease-out",
      }}>
        <style>{`@keyframes slideInRight { from { transform: translateX(100%) } to { transform: translateX(0) } }`}</style>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 18px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div>
            <span style={{ fontFamily: T.head, fontSize: 16, fontWeight: 700, color: T.text }}>
              Backlog
            </span>
            <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 700,
              color: T.accent, background: T.accent + "18",
              border: `1px solid ${T.accent}44`, borderRadius: 10,
              padding: "1px 8px", marginLeft: 10 }}>
              {tickets.length}
            </span>
          </div>
          <button onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer",
              color: T.textMuted, fontSize: 20, lineHeight: 1, padding: "0 4px" }}>
            ×
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 8, padding: "10px 18px",
          borderBottom: `1px solid ${T.border}22`, flexShrink: 0 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            style={{ flex: 1, fontFamily: T.body, fontSize: 12, background: T.bg,
              border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 10px",
              color: T.text, outline: "none" }}
          />
          <select
            value={sectionFilter}
            onChange={e => setSectionFilter(e.target.value)}
            style={{ fontFamily: T.body, fontSize: 12, background: T.bg,
              border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 8px",
              color: sectionFilter ? T.text : T.textMuted, cursor: "pointer", outline: "none" }}>
            <option value="">All sections</option>
            {SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Ticket list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {visible.length === 0 ? (
            <div style={{ fontFamily: T.body, fontSize: 13, color: T.textMuted,
              textAlign: "center", padding: "32px 18px", fontStyle: "italic" }}>
              {tickets.length === 0 ? "Backlog is empty" : "No tickets match the filter"}
            </div>
          ) : visible.map(t => (
            <div key={t.id} style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              padding: "9px 18px", borderBottom: `1px solid ${T.border}11`,
              transition: "background .12s",
            }}
            onMouseEnter={e => e.currentTarget.style.background = T.bg}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>

              {/* Priority dot */}
              <div style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, marginTop: 5,
                background: PRIORITY_DOT[t.priority] || T.border }} />

              {/* Type + title */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span title={t.type} style={{ fontSize: 11 }}>{TYPE_ICON[t.type] || "📋"}</span>
                  <span style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted }}>{t.id}</span>
                  {t.section && (
                    <span style={{ fontFamily: T.body, fontSize: 10, color: T.textMuted,
                      background: T.border + "44", borderRadius: 4, padding: "0 5px" }}>
                      {t.section}
                    </span>
                  )}
                </div>
                <div style={{ fontFamily: T.body, fontSize: 13, color: T.text, lineHeight: 1.4,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={t.title}>
                  {t.title}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 5, flexShrink: 0, alignItems: "center" }}>
                <button
                  onClick={() => onEdit(t)}
                  title="Edit"
                  style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 5,
                    color: T.textMuted, cursor: "pointer", fontSize: 11, padding: "3px 7px",
                    fontFamily: T.body, transition: "color .12s, border-color .12s" }}
                  onMouseEnter={e => { e.currentTarget.style.color = T.text; e.currentTarget.style.borderColor = T.text; }}
                  onMouseLeave={e => { e.currentTarget.style.color = T.textMuted; e.currentTarget.style.borderColor = T.border; }}>
                  ✎
                </button>
                <button
                  onClick={() => onPromote(t)}
                  title="Move to Ready"
                  style={{ background: T.accent + "18", border: `1px solid ${T.accent}55`,
                    borderRadius: 5, color: T.accent, cursor: "pointer",
                    fontSize: 11, padding: "3px 8px", fontFamily: T.body, fontWeight: 600,
                    transition: "background .12s" }}
                  onMouseEnter={e => e.currentTarget.style.background = T.accent + "30"}
                  onMouseLeave={e => e.currentTarget.style.background = T.accent + "18"}>
                  Ready →
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer — add to backlog */}
        <div style={{ padding: "12px 18px", borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
          <button
            onClick={onAdd}
            style={{ width: "100%", fontFamily: T.body, fontSize: 13, fontWeight: 600,
              color: T.accent, background: T.accent + "12",
              border: `1px dashed ${T.accent}55`, borderRadius: 8,
              padding: "9px 0", cursor: "pointer", transition: "background .12s" }}
            onMouseEnter={e => e.currentTarget.style.background = T.accent + "22"}
            onMouseLeave={e => e.currentTarget.style.background = T.accent + "12"}>
            ＋ Add to Backlog
          </button>
        </div>
      </div>
    </>
  );
};

// ─── Board Manager Primitives ────────────────────────────────────────────────
// Defined at module level so React never sees new component references on re-render.

const BmFormRow = ({ label, children }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <label style={{ fontFamily: T.body, fontSize: 11, fontWeight: 600, color: T.textMuted,
      textTransform: "uppercase", letterSpacing: ".06em" }}>{label}</label>
    {children}
  </div>
);

const BmEditForm = ({ onSave, onCancel, saving, children }) => (
  <div style={{ background: T.bg, border: `1px solid ${T.accent}44`, borderRadius: 9, padding: 14,
    display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
    {children}
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
      <button type="button" onClick={onCancel}
        style={{ fontFamily: T.body, fontSize: 12, padding: "6px 14px", background: "none",
          border: `1px solid ${T.border}`, borderRadius: 6, color: T.textMuted, cursor: "pointer" }}>Cancel</button>
      <Btn size="sm" disabled={saving} onClick={onSave}>{saving ? "Saving…" : "Save"}</Btn>
    </div>
  </div>
);

// ─── Board Manager Modal ──────────────────────────────────────────────────────
// Tabbed manager for Projects, Columns, and Versions.

const BoardManagerModal = ({ currentProject, columns, versions, sprints, tickets, onClose, onRefresh }) => {
  const [tab,        setTab]        = useState("columns");
  const [editItem,   setEditItem]   = useState(null);   // item being edited or "new"
  const [form,       setForm]       = useState({});
  const [saving,     setSaving]     = useState(false);
  const [dragIdx,    setDragIdx]    = useState(null);
  const [dragOver,   setDragOver]   = useState(null);
  const [baselines,  setBaselines]  = useState([]);
  const [viewBaseline, setViewBaseline] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null); // { kind, id, message }

  useEffect(() => {
    if (currentProject) api.baselines.list(currentProject.id).then(setBaselines).catch(() => {});
  }, [currentProject?.id]);

  const sf = k => v => setForm(p => ({ ...p, [k]: v }));
  const inp = { fontFamily: T.body, fontSize: 13, color: T.text, background: T.bg,
    border: `1px solid ${T.border}`, borderRadius: 7, padding: "7px 11px", outline: "none",
    width: "100%", boxSizing: "border-box" };

  const startNew = (defaults = {}) => { setEditItem("new"); setForm(defaults); };
  const startEdit = item => { setEditItem(item); setForm({ ...item }); };
  const cancelEdit = () => { setEditItem(null); setForm({}); };

  const VERSION_STATUSES = ["Planning", "In Development", "Released", "Archived"];

  // ── Save handlers ──────────────────────────────────────────────────────────
  const saveColumn = async () => {
    if (!form.name?.trim() || !currentProject) return;
    setSaving(true);
    try {
      if (editItem === "new") await api.kbColumns.create(currentProject.id, { name: form.name, color: form.color || "#6366f1" });
      else await api.kbColumns.update(editItem.id, { name: form.name, color: form.color || editItem.color });
      cancelEdit(); onRefresh();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const deleteColumn = col => setPendingDelete({ kind: "column", id: col.id,
    message: `Delete column "${col.name}"? Tickets already in it keep their status value.` });

  const saveVersion = async () => {
    if (!form.name?.trim() || !currentProject) return;
    setSaving(true);
    try {
      if (editItem === "new") await api.kbVersions.create(currentProject.id, { name: form.name, description: form.description || "", status: form.status || "Planning", releaseDate: form.releaseDate || null });
      else await api.kbVersions.update(editItem.id, { name: form.name, description: form.description || "", status: form.status || editItem.status, releaseDate: form.releaseDate || null });
      cancelEdit(); onRefresh();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const deleteVersion = id => setPendingDelete({ kind: "version", id,
    message: "Delete this version? Tickets will be unlinked from it." });

  const SPRINT_STATUSES = ["Planning", "Active", "Completed"];

  const saveSprint = async () => {
    if (!form.name?.trim() || !currentProject) return;
    setSaving(true);
    try {
      if (editItem === "new") await api.sprints.create(currentProject.id, { name: form.name, startDate: form.startDate || null, endDate: form.endDate || null, status: form.status || "Planning" });
      else await api.sprints.update(editItem.id, { name: form.name, startDate: form.startDate || null, endDate: form.endDate || null, status: form.status || editItem.status });
      cancelEdit(); onRefresh();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const deleteSprint = id => setPendingDelete({ kind: "sprint", id,
    message: "Delete this sprint? Tickets will be unassigned from it." });

  const saveBaseline = async () => {
    if (!form.name?.trim() || !currentProject) return;
    setSaving(true);
    try {
      await api.baselines.create(currentProject.id, { name: form.name, description: form.description || "" });
      cancelEdit();
      const fresh = await api.baselines.list(currentProject.id);
      setBaselines(fresh);
      toast.success("Baseline created");
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const deleteBaseline = id => setPendingDelete({ kind: "baseline", id,
    message: "Delete this baseline? This cannot be undone." });

  const confirmPendingDelete = async () => {
    const { kind, id } = pendingDelete;
    setPendingDelete(null);
    try {
      if (kind === "column")        { await api.kbColumns.remove(id); onRefresh(); }
      else if (kind === "version")  { await api.kbVersions.remove(id); onRefresh(); }
      else if (kind === "sprint")   { await api.sprints.remove(id); onRefresh(); }
      else if (kind === "baseline") { await api.baselines.remove(id); setBaselines(prev => prev.filter(b => b.id !== id)); }
    } catch (e) { toast.error(e.message); }
  };

  // Column drag-to-reorder
  const handleColDrop = async () => {
    if (dragIdx === null || dragOver === null || dragIdx === dragOver || !currentProject) return;
    const reordered = [...columns];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(dragOver, 0, moved);
    setDragIdx(null); setDragOver(null);
    try { await api.kbColumns.reorder(currentProject.id, reordered.map(c => c.id)); onRefresh(); }
    catch (e) { toast.error(e.message); }
  };

  const TAB_BTN = active => ({
    fontFamily: T.body, fontSize: 13, fontWeight: active ? 700 : 400,
    padding: "10px 18px", background: "none", border: "none", cursor: "pointer",
    color: active ? T.accent : T.textMuted,
    borderBottom: `2px solid ${active ? T.accent : "transparent"}`,
    transition: "color .12s",
  });

  const swatch = color => (
    <div style={{ width: 14, height: 14, borderRadius: 3, background: color, flexShrink: 0, border: `1px solid ${T.border}` }} />
  );


  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.6)",
      display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: "min(92vw, 680px)", maxHeight: "88vh", background: T.surface,
        border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden",
        display: "flex", flexDirection: "column", boxShadow: "0 28px 80px rgba(0,0,0,.5)" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div style={{ fontFamily: T.head, fontSize: 16, fontWeight: 800, color: T.text }}>Board Settings</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer",
            color: T.textMuted, fontSize: 22, lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          {[["columns","⬛ Columns"], ["versions","🏷 Versions"], ["sprints","🏃 Sprints"], ["baselines","📸 Baselines"]].map(([id, label]) => (
            <button key={id} type="button" onClick={() => { cancelEdit(); setTab(id); }} style={TAB_BTN(tab === id)}>{label}</button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 28px" }}>

          {/* ── Columns tab ── */}
          {tab === "columns" && (
            <div>
              <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, marginBottom: 14 }}>
                Drag rows to reorder. Changes apply to the current project.
              </div>
              {columns.map((col, idx) => (
                editItem?.id === col.id ? (
                  <BmEditForm onCancel={cancelEdit} key={col.id} onSave={saveColumn} saving={saving}>
                    <BmFormRow label="Name"><input value={form.name} onChange={e => sf("name")(e.target.value)} style={inp} autoFocus /></BmFormRow>
                    <BmFormRow label="Accent Color">
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input type="color" value={form.color || "#6366f1"} onChange={e => sf("color")(e.target.value)}
                          style={{ width: 36, height: 30, borderRadius: 5, border: `1px solid ${T.border}`, padding: 2, cursor: "pointer", background: "none" }} />
                        <span style={{ fontFamily: T.mono, fontSize: 12, color: T.textMuted }}>{form.color || "#6366f1"}</span>
                      </div>
                    </BmFormRow>
                  </BmEditForm>
                ) : (
                  <div key={col.id}
                    draggable onDragStart={() => setDragIdx(idx)} onDragEnd={handleColDrop}
                    onDragOver={e => { e.preventDefault(); setDragOver(idx); }}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px",
                      borderRadius: 7, marginBottom: 5, cursor: "grab",
                      background: dragOver === idx ? `${T.accent}10` : T.bg,
                      border: `1px solid ${dragOver === idx ? T.accent + "44" : T.border}`,
                      transition: "background .1s" }}>
                    <span style={{ color: T.border, fontSize: 14, cursor: "grab" }}>⠿</span>
                    {swatch(col.color || "#6366f1")}
                    <span style={{ fontFamily: T.body, fontSize: 13, color: T.text, flex: 1 }}>{col.name}</span>
                    <button type="button" onClick={() => startEdit(col)} style={{ background: "none", border: "none",
                      cursor: "pointer", color: T.textMuted, fontSize: 14, padding: "2px 4px" }}>✎</button>
                    <button type="button" onClick={() => deleteColumn(col)} style={{ background: "none", border: "none",
                      cursor: "pointer", color: T.danger, fontSize: 14, padding: "2px 4px" }}>✕</button>
                  </div>
                )
              ))}
              {editItem === "new" && tab === "columns" ? (
                <BmEditForm onCancel={cancelEdit} onSave={saveColumn} saving={saving}>
                  <BmFormRow label="Column Name"><input value={form.name || ""} onChange={e => sf("name")(e.target.value)} style={inp} autoFocus placeholder="e.g. QA Review" /></BmFormRow>
                  <BmFormRow label="Accent Color">
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input type="color" value={form.color || "#6366f1"} onChange={e => sf("color")(e.target.value)}
                        style={{ width: 36, height: 30, borderRadius: 5, border: `1px solid ${T.border}`, padding: 2, cursor: "pointer", background: "none" }} />
                      <span style={{ fontFamily: T.mono, fontSize: 12, color: T.textMuted }}>{form.color || "#6366f1"}</span>
                    </div>
                  </BmFormRow>
                </BmEditForm>
              ) : (
                <button type="button" onClick={() => startNew({ color: "#6366f1" })}
                  style={{ fontFamily: T.body, fontSize: 13, color: T.accent, background: "none",
                    border: `1px dashed ${T.accent}55`, borderRadius: 7, padding: "7px 16px",
                    cursor: "pointer", width: "100%", textAlign: "left", marginTop: 8 }}>
                  ＋ Add Column
                </button>
              )}
            </div>
          )}

          {/* ── Versions tab ── */}
          {tab === "versions" && (
            <div>
              {versions.map(ver => (
                editItem?.id === ver.id ? (
                  <BmEditForm onCancel={cancelEdit} key={ver.id} onSave={saveVersion} saving={saving}>
                    <BmFormRow label="Version Name"><input value={form.name || ""} onChange={e => sf("name")(e.target.value)} style={inp} autoFocus /></BmFormRow>
                    <BmFormRow label="Status">
                      <select value={form.status || "Planning"} onChange={e => sf("status")(e.target.value)} style={inp}>
                        {VERSION_STATUSES.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </BmFormRow>
                    <BmFormRow label="Release Date">
                      <input type="date" value={form.releaseDate || ""} onChange={e => sf("releaseDate")(e.target.value)} style={{ ...inp, colorScheme: "dark" }} />
                    </BmFormRow>
                    <BmFormRow label="Description"><input value={form.description || ""} onChange={e => sf("description")(e.target.value)} style={inp} placeholder="Optional" /></BmFormRow>
                  </BmEditForm>
                ) : (
                  <div key={ver.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                    borderRadius: 7, marginBottom: 5, background: T.bg, border: `1px solid ${T.border}` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.text }}>{ver.name}</div>
                      <div style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted, display: "flex", gap: 10, marginTop: 2 }}>
                        <span style={{ color: ver.status === "Released" ? T.success : ver.status === "Archived" ? T.textMuted : T.accent }}>{ver.status}</span>
                        {ver.releaseDate && <span>Release: {ver.releaseDate}</span>}
                        {ver.description && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ver.description}</span>}
                      </div>
                    </div>
                    <button type="button" onClick={() => startEdit(ver)} style={{ background: "none", border: "none",
                      cursor: "pointer", color: T.textMuted, fontSize: 14, padding: "2px 4px" }}>✎</button>
                    <button type="button" onClick={() => deleteVersion(ver.id)} style={{ background: "none", border: "none",
                      cursor: "pointer", color: T.danger, fontSize: 14, padding: "2px 4px" }}>✕</button>
                  </div>
                )
              ))}
              {editItem === "new" && tab === "versions" ? (
                <BmEditForm onCancel={cancelEdit} onSave={saveVersion} saving={saving}>
                  <BmFormRow label="Version Name"><input value={form.name || ""} onChange={e => sf("name")(e.target.value)} style={inp} autoFocus placeholder="e.g. v1.0.0" /></BmFormRow>
                  <BmFormRow label="Status">
                    <select value={form.status || "Planning"} onChange={e => sf("status")(e.target.value)} style={inp}>
                      {VERSION_STATUSES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </BmFormRow>
                  <BmFormRow label="Release Date">
                    <input type="date" value={form.releaseDate || ""} onChange={e => sf("releaseDate")(e.target.value)} style={{ ...inp, colorScheme: "dark" }} />
                  </BmFormRow>
                  <BmFormRow label="Description"><input value={form.description || ""} onChange={e => sf("description")(e.target.value)} style={inp} placeholder="Optional" /></BmFormRow>
                </BmEditForm>
              ) : (
                <button type="button" onClick={() => startNew({ status: "Planning" })}
                  style={{ fontFamily: T.body, fontSize: 13, color: T.accent, background: "none",
                    border: `1px dashed ${T.accent}55`, borderRadius: 7, padding: "7px 16px",
                    cursor: "pointer", width: "100%", textAlign: "left", marginTop: 8 }}>
                  ＋ New Version
                </button>
              )}
            </div>
          )}

          {/* ── Sprints tab (TKT-GB8PGQ) ── */}
          {tab === "sprints" && (
            <div>
              {sprints.map(sp => (
                editItem?.id === sp.id ? (
                  <BmEditForm onCancel={cancelEdit} key={sp.id} onSave={saveSprint} saving={saving}>
                    <BmFormRow label="Sprint Name"><input value={form.name || ""} onChange={e => sf("name")(e.target.value)} style={inp} autoFocus /></BmFormRow>
                    <BmFormRow label="Status">
                      <select value={form.status || "Planning"} onChange={e => sf("status")(e.target.value)} style={inp}>
                        {SPRINT_STATUSES.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </BmFormRow>
                    <BmFormRow label="Start Date">
                      <input type="date" value={form.startDate || ""} onChange={e => sf("startDate")(e.target.value)} style={{ ...inp, colorScheme: "dark" }} />
                    </BmFormRow>
                    <BmFormRow label="End Date">
                      <input type="date" value={form.endDate || ""} onChange={e => sf("endDate")(e.target.value)} style={{ ...inp, colorScheme: "dark" }} />
                    </BmFormRow>
                  </BmEditForm>
                ) : (
                  <div key={sp.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                    borderRadius: 7, marginBottom: 5, background: T.bg, border: `1px solid ${T.border}` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.text }}>{sp.name}</div>
                      <div style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted, display: "flex", gap: 10, marginTop: 2 }}>
                        <span style={{ color: sp.status === "Active" ? T.accent : sp.status === "Completed" ? T.success : T.textMuted }}>{sp.status}</span>
                        {sp.startDate && sp.endDate && <span>{sp.startDate} → {sp.endDate}</span>}
                      </div>
                    </div>
                    <button type="button" onClick={() => startEdit(sp)} style={{ background: "none", border: "none",
                      cursor: "pointer", color: T.textMuted, fontSize: 14, padding: "2px 4px" }}>✎</button>
                    <button type="button" onClick={() => deleteSprint(sp.id)} style={{ background: "none", border: "none",
                      cursor: "pointer", color: T.danger, fontSize: 14, padding: "2px 4px" }}>✕</button>
                  </div>
                )
              ))}
              {editItem === "new" && tab === "sprints" ? (
                <BmEditForm onCancel={cancelEdit} onSave={saveSprint} saving={saving}>
                  <BmFormRow label="Sprint Name"><input value={form.name || ""} onChange={e => sf("name")(e.target.value)} style={inp} autoFocus placeholder="e.g. Sprint 12" /></BmFormRow>
                  <BmFormRow label="Status">
                    <select value={form.status || "Planning"} onChange={e => sf("status")(e.target.value)} style={inp}>
                      {SPRINT_STATUSES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </BmFormRow>
                  <BmFormRow label="Start Date">
                    <input type="date" value={form.startDate || ""} onChange={e => sf("startDate")(e.target.value)} style={{ ...inp, colorScheme: "dark" }} />
                  </BmFormRow>
                  <BmFormRow label="End Date">
                    <input type="date" value={form.endDate || ""} onChange={e => sf("endDate")(e.target.value)} style={{ ...inp, colorScheme: "dark" }} />
                  </BmFormRow>
                </BmEditForm>
              ) : (
                <button type="button" onClick={() => startNew({ status: "Planning" })}
                  style={{ fontFamily: T.body, fontSize: 13, color: T.accent, background: "none",
                    border: `1px dashed ${T.accent}55`, borderRadius: 7, padding: "7px 16px",
                    cursor: "pointer", width: "100%", textAlign: "left", marginTop: 8 }}>
                  ＋ New Sprint
                </button>
              )}
            </div>
          )}

          {/* ── Baselines tab (TKT-M6K5AP) ── */}
          {tab === "baselines" && (
            <div>
              <div style={{ fontFamily: T.body, fontSize: 11.5, color: T.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
                Freezes every ticket's title/type/status/priority/points at this moment — a reference
                to diff against later, e.g. at a release cut. Baselines are read-only once created.
              </div>
              {baselines.map(b => (
                <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                  borderRadius: 7, marginBottom: 5, background: T.bg, border: `1px solid ${T.border}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.text }}>{b.name}</div>
                    <div style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted, marginTop: 2 }}>
                      {new Date(b.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                      {b.createdBy && ` · ${b.createdBy}`}
                    </div>
                  </div>
                  <button type="button" onClick={() => setViewBaseline(b.id)} style={{ fontFamily: T.body, fontSize: 11.5,
                    color: T.accent, background: "none", border: `1px solid ${T.accent}44`, borderRadius: 6,
                    padding: "4px 10px", cursor: "pointer" }}>View</button>
                  <button type="button" onClick={() => deleteBaseline(b.id)} style={{ background: "none", border: "none",
                    cursor: "pointer", color: T.danger, fontSize: 14, padding: "2px 4px" }}>✕</button>
                </div>
              ))}
              {baselines.length === 0 && (
                <div style={{ fontFamily: T.body, fontSize: 12.5, color: T.textMuted, fontStyle: "italic", marginBottom: 10 }}>
                  No baselines yet.
                </div>
              )}
              {editItem === "new" && tab === "baselines" ? (
                <BmEditForm onCancel={cancelEdit} onSave={saveBaseline} saving={saving}>
                  <BmFormRow label="Baseline Name"><input value={form.name || ""} onChange={e => sf("name")(e.target.value)} style={inp} autoFocus placeholder="e.g. v1.0 release cut" /></BmFormRow>
                  <BmFormRow label="Description"><input value={form.description || ""} onChange={e => sf("description")(e.target.value)} style={inp} placeholder="Optional" /></BmFormRow>
                </BmEditForm>
              ) : (
                <button type="button" onClick={() => startNew({})}
                  style={{ fontFamily: T.body, fontSize: 13, color: T.accent, background: "none",
                    border: `1px dashed ${T.accent}55`, borderRadius: 7, padding: "7px 16px",
                    cursor: "pointer", width: "100%", textAlign: "left", marginTop: 8 }}>
                  📸 Create Baseline (snapshot now)
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {viewBaseline && (
        <BaselineViewModal baselineId={viewBaseline} liveTickets={tickets} onClose={() => setViewBaseline(null)} />
      )}
      {pendingDelete && (
        <ConfirmModal message={pendingDelete.message} onConfirm={confirmPendingDelete} onCancel={() => setPendingDelete(null)} />
      )}
    </div>
  );
};

// ─── Baseline View (TKT-M6K5AP) ────────────────────────────────────────────────
// Diffs the frozen snapshot against current live ticket state so a status/points
// change since the baseline was taken is visible at a glance, not just a static list.

const BaselineViewModal = ({ baselineId, liveTickets, onClose }) => {
  const [data, setData] = useState(null);

  useEffect(() => { api.baselines.get(baselineId).then(setData).catch(() => setData(null)); }, [baselineId]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10001, background: "rgba(0,0,0,.6)",
      display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: "min(94vw, 760px)", maxHeight: "86vh", background: T.surface,
        border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden",
        display: "flex", flexDirection: "column", boxShadow: "0 28px 80px rgba(0,0,0,.5)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontFamily: T.head, fontSize: 16, fontWeight: 800, color: T.text }}>
            {data ? data.name : "Baseline"}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer",
            color: T.textMuted, fontSize: 22, lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px" }}>
          {!data ? (
            <div style={{ fontFamily: T.body, fontSize: 13, color: T.textMuted, textAlign: "center", padding: 30 }}>Loading…</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {data.tickets.map(bt => {
                const live = liveTickets.find(t => t.id === bt.ticketId);
                const statusChanged = live && live.status !== bt.status;
                const deleted = !live;
                return (
                  <div key={bt.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                    borderRadius: 7, background: T.bg, border: `1px solid ${T.border}`,
                    opacity: deleted ? 0.55 : 1 }}>
                    <span style={{ fontSize: 12, flexShrink: 0 }}>{TYPE_ICON[bt.type] || "📋"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: T.body, fontSize: 12.5, color: T.text,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bt.title}</div>
                      <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.textMuted }}>{bt.ticketId}</div>
                    </div>
                    <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.textMuted }}>at baseline: {bt.status}</span>
                    {deleted ? (
                      <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700, color: T.danger,
                        background: T.danger + "18", border: `1px solid ${T.danger}44`, borderRadius: 4, padding: "1px 7px" }}>
                        DELETED SINCE
                      </span>
                    ) : statusChanged ? (
                      <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700, color: T.accent,
                        background: T.accent + "18", border: `1px solid ${T.accent}44`, borderRadius: 4, padding: "1px 7px" }}>
                        NOW: {live.status}
                      </span>
                    ) : (
                      <span style={{ fontFamily: T.mono, fontSize: 10, color: T.success }}>unchanged</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Sprint Board + Burndown (TKT-GB8PGQ) ─────────────────────────────────────

const DONE_STATUSES = new Set(["Done", "Ready to Deploy", "Released"]);

const BurndownChart = ({ sprint, data }) => {
  if (!sprint.startDate || !sprint.endDate) return (
    <div style={{ padding: "28px 18px", textAlign: "center", fontFamily: T.body, fontSize: 12.5, color: T.textMuted }}>
      Set this sprint's Start and End dates (Board Settings → Sprints) to see a burndown.
    </div>
  );

  const W = 640, H = 220, PAD = 32;
  const dayMs = 86400000;
  const start = new Date(sprint.startDate + "T00:00:00").getTime();
  const end   = new Date(sprint.endDate   + "T00:00:00").getTime();
  const totalDays = Math.max(Math.round((end - start) / dayMs), 1);
  const total = data.totalPoints;

  const x = day => PAD + (day / totalDays) * (W - PAD * 2);
  const y = pts => H - PAD - (total > 0 ? (pts / total) * (H - PAD * 2) : 0);

  const idealPath = `M ${x(0)} ${y(total)} L ${x(totalDays)} ${y(0)}`;

  const snaps = data.snapshots.map(s => {
    const day = Math.round((new Date(s.date + "T00:00:00").getTime() - start) / dayMs);
    return { day, remaining: s.remainingPoints };
  }).filter(s => s.day >= 0).sort((a, b) => a.day - b.day);
  const actualPath = snaps.map((s, i) => `${i === 0 ? "M" : "L"} ${x(s.day)} ${y(s.remaining)}`).join(" ");

  const todayDay = Math.round((Date.now() - start) / dayMs);

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 10px" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {/* Axes */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={T.border} strokeWidth="1" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke={T.border} strokeWidth="1" />
        {/* Today marker */}
        {todayDay >= 0 && todayDay <= totalDays && (
          <line x1={x(todayDay)} y1={PAD} x2={x(todayDay)} y2={H - PAD} stroke={T.accent} strokeWidth="1" strokeDasharray="3,3" />
        )}
        {/* Ideal line */}
        <path d={idealPath} fill="none" stroke={T.textMuted} strokeWidth="1.5" strokeDasharray="5,4" />
        {/* Actual line */}
        {snaps.length > 0 && <path d={actualPath} fill="none" stroke={T.accent} strokeWidth="2.5" />}
        {snaps.map(s => (
          <circle key={s.day} cx={x(s.day)} cy={y(s.remaining)} r="3.5" fill={T.accent} />
        ))}
        {/* Y axis labels */}
        <text x={PAD - 6} y={PAD + 4} textAnchor="end" fontSize="9" fill={T.textMuted} fontFamily="monospace">{total}</text>
        <text x={PAD - 6} y={H - PAD} textAnchor="end" fontSize="9" fill={T.textMuted} fontFamily="monospace">0</text>
      </svg>
      <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 4 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: T.body, fontSize: 11, color: T.textMuted }}>
          <span style={{ width: 14, height: 0, borderTop: `1.5px dashed ${T.textMuted}` }} /> Ideal
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: T.body, fontSize: 11, color: T.textMuted }}>
          <span style={{ width: 14, height: 2, background: T.accent, borderRadius: 1 }} /> Actual (remaining points)
        </span>
      </div>
    </div>
  );
};

const SprintBoardView = ({ sprints, activeSprintId, setActiveSprintId, tickets, onPreview }) => {
  const [burndown, setBurndown] = useState(null);
  const [loading,  setLoading]  = useState(true);

  const current = sprints.find(s => s.id === activeSprintId)
    || sprints.find(s => s.status === "Active")
    || sprints[0];

  useEffect(() => {
    if (current && current.id !== activeSprintId) setActiveSprintId(current.id);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!current) { setLoading(false); return; }
    setLoading(true);
    api.sprints.burndown(current.id).then(setBurndown).catch(() => setBurndown(null)).finally(() => setLoading(false));
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!current) return (
    <div style={{ padding: "60px 24px", textAlign: "center", fontFamily: T.body, fontSize: 14, color: T.textMuted }}>
      No sprints yet — create one in Board Settings → Sprints.
    </div>
  );

  const sprintTickets = tickets.filter(t => t.sprintId === current.id);
  const byCol = {};
  for (const t of sprintTickets) (byCol[t.status] ||= []).push(t);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {sprints.length > 1 && (
          <select value={current.id} onChange={e => setActiveSprintId(e.target.value)}
            style={{ ...inputBase, fontFamily: T.body, fontSize: 13, width: 220, cursor: "pointer" }}>
            {sprints.map(s => <option key={s.id} value={s.id}>{s.name} · {s.status}</option>)}
          </select>
        )}
        {current.startDate && current.endDate && (
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted }}>{current.startDate} → {current.endDate}</span>
        )}
      </div>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
          <Spinner size="md" />
        </div>
      ) : (
        <>
          {burndown && (
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 420px", minWidth: 320 }}>
                <BurndownChart sprint={current} data={burndown} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 160 }}>
                {[["Total Points", burndown.totalPoints], ["Remaining", burndown.remainingPoints], ["Tickets", burndown.ticketCount]].map(([lbl, val]) => (
                  <div key={lbl} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 9, padding: "10px 14px" }}>
                    <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.textMuted, textTransform: "uppercase", letterSpacing: ".06em" }}>{lbl}</div>
                    <div style={{ fontFamily: T.head, fontSize: 20, fontWeight: 700, color: T.text }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 12, overflowX: "auto" }}>
            {Object.entries(byCol).map(([status, tix]) => (
              <div key={status} style={{ minWidth: 220, flex: "1 0 220px", background: T.surface,
                border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
                <div style={{ padding: "8px 12px", borderBottom: `1px solid ${T.border}`, background: T.bg,
                  fontFamily: T.body, fontSize: 12, fontWeight: 700, color: T.text }}>
                  {status} <span style={{ color: T.textMuted, fontWeight: 400 }}>({tix.length})</span>
                </div>
                <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  {tix.map(t => (
                    <div key={t.id} onClick={() => onPreview?.(t)}
                      style={{ padding: "7px 10px", borderRadius: 7, background: T.bg,
                        border: `1px solid ${T.border}`, cursor: "pointer" }}>
                      <div style={{ fontFamily: T.body, fontSize: 12, color: T.text }}>{t.title}</div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
                        <span style={{ fontFamily: T.mono, fontSize: 9, color: T.textMuted }}>{t.id}</span>
                        {t.storyPoints != null && (
                          <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 700, color: T.accent }}>{t.storyPoints} pts</span>
                        )}
                      </div>
                    </div>
                  ))}
                  {tix.length === 0 && (
                    <div style={{ padding: 10, fontFamily: T.body, fontSize: 11, color: T.textMuted, fontStyle: "italic", textAlign: "center" }}>Empty</div>
                  )}
                </div>
              </div>
            ))}
            {sprintTickets.length === 0 && (
              <div style={{ padding: 30, fontFamily: T.body, fontSize: 13, color: T.textMuted, fontStyle: "italic" }}>
                No tickets assigned to this sprint yet — set a ticket's Sprint field to add it here.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

// ─── Roadmap View ─────────────────────────────────────────────────────────────
// Version swim-lanes: each version is a row with tickets grouped inside.

// ─── Roadmap Gantt mode (TKT-AGH5M7) ──────────────────────────────────────────
// Epics with both startDate and dueDate set get plotted as date-axis bars.
// Epics missing either date are listed separately rather than silently dropped,
// since a partially-dated Epic is exactly the kind of gap a roadmap should surface.

const GanttChart = ({ epics, onPreview }) => {
  const dated   = epics.filter(e => e.startDate && e.dueDate);
  const undated = epics.filter(e => !e.startDate || !e.dueDate);

  if (dated.length === 0) return (
    <div style={{ padding: "60px 24px", textAlign: "center", fontFamily: T.body, fontSize: 14, color: T.textMuted }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>📅</div>
      <div style={{ fontWeight: 600, color: T.text, marginBottom: 6 }}>No Epics have both a Start and Due Date yet</div>
      <div>Set both dates on an Epic (Edit → Start Date, paired with the existing Due Date) to plot it here.</div>
    </div>
  );

  const toMs = d => new Date(d + "T00:00:00").getTime();
  const rangeStart = Math.min(...dated.map(e => toMs(e.startDate)));
  const rangeEnd   = Math.max(...dated.map(e => toMs(e.dueDate)));
  const totalSpan  = Math.max(rangeEnd - rangeStart, 86400000);
  const todayMs    = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00").getTime();
  const todayPct   = ((todayMs - rangeStart) / totalSpan) * 100;

  const fmtAxis = ms => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 18px",
          borderBottom: `1px solid ${T.border}`, background: T.bg,
          fontFamily: T.mono, fontSize: 10.5, color: T.textMuted }}>
          <span>{fmtAxis(rangeStart)}</span>
          <span>{fmtAxis(rangeEnd)}</span>
        </div>
        <div style={{ position: "relative", padding: "16px 18px" }}>
          {todayPct >= 0 && todayPct <= 100 && (
            <div style={{ position: "absolute", top: 0, bottom: 0, left: `${todayPct}%`,
              width: 1, background: T.accent, zIndex: 1 }}
              title={`Today · ${new Date(todayMs).toLocaleDateString()}`} />
          )}
          {dated.map(epic => {
            const s = toMs(epic.startDate), e = toMs(epic.dueDate);
            const left  = ((s - rangeStart) / totalSpan) * 100;
            const width = Math.max(((e - s) / totalSpan) * 100, 1.5);
            const done  = DONE_STATUSES.has(epic.status);
            const overdue = !done && e < todayMs;
            return (
              <div key={epic.id} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{ width: 200, flexShrink: 0, minWidth: 0, fontFamily: T.body, fontSize: 12,
                  color: T.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={epic.title}>
                  {epic.title}
                </div>
                <div style={{ position: "relative", flex: 1, height: 22 }}>
                  <div onClick={() => onPreview?.(epic)}
                    style={{ position: "absolute", left: `${left}%`, width: `${width}%`, top: 2, bottom: 2,
                      borderRadius: 5, cursor: "pointer",
                      background: done ? T.success : overdue ? T.danger : T.accent,
                      opacity: done ? 0.55 : 1,
                      display: "flex", alignItems: "center", paddingLeft: 8, minWidth: 20 }}
                    title={`${epic.startDate} → ${epic.dueDate}${overdue ? " · Overdue" : ""}`}>
                    <span style={{ fontFamily: T.mono, fontSize: 9, color: "#fff", fontWeight: 700,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {epic.id}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {undated.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontFamily: T.body, fontSize: 11, fontWeight: 700, color: T.textMuted,
            textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8 }}>
            {undated.length} Epic{undated.length !== 1 ? "s" : ""} missing a Start or Due Date
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {undated.map(epic => (
              <div key={epic.id} onClick={() => onPreview?.(epic)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px",
                  borderRadius: 7, background: T.surface, border: `1px solid ${T.border}`, cursor: "pointer" }}>
                <span style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted }}>{epic.id}</span>
                <span style={{ fontFamily: T.body, fontSize: 12, color: T.text }}>{epic.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const RoadmapView = ({ tickets, versions, onPreview }) => {
  const [mode, setMode] = useState("swimlanes"); // "swimlanes" | "gantt"
  const epics = tickets.filter(t => t.type === "Epic");

  const ModeToggle = () => (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
      <div style={{ display: "flex", borderRadius: 7, border: `1px solid ${T.border}`, overflow: "hidden" }}>
        {[["swimlanes", "🏷 Swimlanes"], ["gantt", "📅 Gantt"]].map(([key, label]) => (
          <button key={key} onClick={() => setMode(key)}
            style={{ padding: "6px 12px", border: "none", cursor: "pointer",
              fontFamily: T.body, fontSize: 12, fontWeight: mode === key ? 700 : 400,
              background: mode === key ? T.accent + "22" : "transparent",
              color: mode === key ? T.accent : T.textMuted }}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );

  if (mode === "gantt") return (
    <div style={{ overflowY: "auto", paddingBottom: 24 }}>
      <ModeToggle />
      <GanttChart epics={epics} onPreview={onPreview} />
    </div>
  );

  if (versions.length === 0) return (
    <div style={{ overflowY: "auto", paddingBottom: 24 }}>
      <ModeToggle />
      <div style={{ padding: "60px 24px", textAlign: "center", fontFamily: T.body, fontSize: 14, color: T.textMuted }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🏷</div>
        <div style={{ fontWeight: 600, color: T.text, marginBottom: 6 }}>No versions defined</div>
        <div>Create versions in <strong>Board Settings → Versions</strong> to organise your roadmap.</div>
      </div>
    </div>
  );

  const versionTickets = verId => tickets.filter(t => t.versionId === verId);
  const unversioned = tickets.filter(t => !t.versionId);

  const VER_STATUS_COLOR = {
    "Planning": T.textMuted, "In Development": T.accent,
    "Released": T.success, "Archived": T.border,
  };

  const VersionLane = ({ ver, tix }) => {
    const done = tix.filter(t => DONE_STATUSES.has(t.status)).length;
    const pct  = tix.length > 0 ? Math.round(done / tix.length * 100) : 0;
    return (
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10,
        overflow: "hidden", marginBottom: 16 }}>
        {/* Lane header */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 18px",
          borderBottom: `1px solid ${T.border}`, background: T.bg }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: T.head, fontSize: 15, fontWeight: 700, color: T.text }}>{ver.name}</span>
              <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
                color: VER_STATUS_COLOR[ver.status] || T.textMuted,
                background: `${VER_STATUS_COLOR[ver.status] || T.border}18`,
                border: `1px solid ${VER_STATUS_COLOR[ver.status] || T.border}33` }}>
                {ver.status}
              </span>
              {ver.releaseDate && (
                <span style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted }}>📅 {ver.releaseDate}</span>
              )}
            </div>
            {tix.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <div style={{ height: 5, flex: 1, borderRadius: 3, background: T.border, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, borderRadius: 3,
                    background: pct === 100 ? T.success : T.accent, transition: "width .3s" }} />
                </div>
                <span style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted, flexShrink: 0 }}>
                  {done}/{tix.length} · {pct}%
                </span>
              </div>
            )}
          </div>
        </div>
        {/* Tickets */}
        {tix.length === 0 ? (
          <div style={{ padding: "16px 18px", fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>
            No tickets assigned to this version.
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 14 }}>
            {tix.map(t => {
              const done = DONE_STATUSES.has(t.status);
              return (
                <div key={t.id} onClick={() => onPreview?.(t)}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px",
                    borderRadius: 7, background: T.bg, border: `1px solid ${done ? T.success + "44" : T.border}`,
                    cursor: "pointer", opacity: done ? 0.7 : 1, transition: "background .1s",
                    minWidth: 0, maxWidth: 260 }}
                  onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover}
                  onMouseLeave={e => e.currentTarget.style.background = T.bg}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>{done ? "✓" : (TYPE_ICON[t.type] || "📋")}</span>
                  <Badge variant={TYPE_VARIANT[t.type] || "default"}>{t.type}</Badge>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: T.body, fontSize: 12, color: T.text, fontWeight: 500,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      textDecoration: done ? "line-through" : "none" }}>
                      {t.title}
                    </div>
                    <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textMuted, marginTop: 1 }}>
                      {t.id} · {t.status}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ overflowY: "auto", paddingBottom: 24 }}>
      <ModeToggle />
      {versions.map(ver => (
        <VersionLane key={ver.id} ver={ver} tix={versionTickets(ver.id)} />
      ))}
      {unversioned.length > 0 && (
        <VersionLane
          ver={{ id: "__unversioned__", name: "Unversioned", status: "Planning" }}
          tix={unversioned}
        />
      )}
    </div>
  );
};

// ─── Test Suite View ──────────────────────────────────────────────────────────
// 3-tier hierarchy: Test Plan → Test Run → Test Case.
// Uses the existing parentId FK — no schema change needed.

const TC_PASS    = new Set(["Done", "Ready to Deploy", "Released"]);
const TC_FAIL    = new Set(["Testing Failed"]);
const TC_BLOCKED = new Set(["Cancelled"]);
const TC_ACTIVE  = new Set(["In Testing", "In Progress"]);

const TC_JIRA_LABEL = {
  "Done": "Pass", "Ready to Deploy": "Pass", "Released": "Pass",
  "Testing Failed": "Fail",
  "Cancelled": "Blocked",
  "In Testing": "In Progress", "In Progress": "In Progress",
};
const tcLabel = status => TC_JIRA_LABEL[status] || "Not Executed";

const JIRA_COLOR = {
  "Pass":         "#22c55e",
  "Fail":         "#ef4444",
  "Blocked":      "#f97316",
  "In Progress":  "#3b82f6",
  "Not Executed": "#6b7280",
};

const tcStatusColor = status => JIRA_COLOR[tcLabel(status)] || "#6b7280";

const tcStatusIcon = status => {
  const lbl = tcLabel(status);
  return lbl === "Pass" ? "✓" : lbl === "Fail" ? "✗" : lbl === "Blocked" ? "⊘" : lbl === "In Progress" ? "⚡" : "○";
};

const runStats = cases => {
  const passed  = cases.filter(c => TC_PASS.has(c.status)).length;
  const failed  = cases.filter(c => TC_FAIL.has(c.status)).length;
  const blocked = cases.filter(c => TC_BLOCKED.has(c.status)).length;
  const active  = cases.filter(c => TC_ACTIVE.has(c.status)).length;
  const pending = cases.length - passed - failed - blocked - active;
  return { passed, failed, blocked, active, pending, total: cases.length };
};

// ─── Test Item Preview Panel ──────────────────────────────────────────────────
// Lightweight, purpose-built preview for Test Folder/Plan/Run/Case — deliberately
// separate from TicketPreview (which is deeply wired to board-ticket concepts like
// Coverage/Diagram/columns) rather than forking that ~600-line component.

const TestItemPreview = ({ item, testItems, tickets, onClose, onEdit, onDelete, onPreview }) => {
  const [confirm, setConfirm] = useState(false);
  const parent   = item.parentId ? testItems.find(t => t.id === item.parentId) : null;
  const children = testItems.filter(t => t.parentId === item.id).sort((a, b) => a.position - b.position);
  const lbl      = tcLabel(item.status);
  const color    = tcStatusColor(item.status);

  return (
    <div style={{ width: 320, flexShrink: 0, alignSelf: "stretch", display: "flex", flexDirection: "column",
      background: T.surface, border: `1px solid ${T.border}`, borderTop: `3px solid ${color}`,
      borderRadius: 10, overflow: "hidden" }}>

      {/* Header */}
      <div style={{ padding: "14px 16px 12px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 15 }}>{TYPE_ICON[item.type] || "📋"}</span>
            <Badge variant={TYPE_VARIANT[item.type] || "default"}>{item.type}</Badge>
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.accent }}>{item.id}</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer",
            color: T.textMuted, fontSize: 18, lineHeight: 1, padding: "0 2px" }}>×</button>
        </div>
        <div style={{ fontFamily: T.head, fontSize: 15, fontWeight: 700, color: T.text, lineHeight: 1.4 }}>
          {item.title}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {parent && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Badge variant={TYPE_VARIANT[parent.type] || "default"}>{parent.type}</Badge>
            <button type="button" onClick={() => onPreview?.(parent)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0,
                fontFamily: T.mono, fontSize: 11, color: T.accent, textDecoration: "underline dotted" }}>
              {parent.id}
            </button>
            <span style={{ fontFamily: T.body, fontSize: 11, color: T.textMuted,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{parent.title}</span>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 700, color,
            background: `${color}18`, border: `1px solid ${color}44`, borderRadius: 10, padding: "2px 10px" }}>
            {lbl}
          </span>
          <Badge variant={PRIORITY_VARIANT[item.priority] || "default"}>{item.priority}</Badge>
        </div>

        {item.assigneeName && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontFamily: T.body, fontSize: 11, color: T.textMuted }}>Assignee:</span>
            <span style={{ fontFamily: T.body, fontSize: 12, color: T.text }}>{item.assigneeName}</span>
          </div>
        )}

        {item.dueDate && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontFamily: T.body, fontSize: 11, color: T.textMuted }}>Due:</span>
            <span style={{ fontFamily: T.mono, fontSize: 12, color: T.text }}>{item.dueDate}</span>
          </div>
        )}

        {item.description && (
          <div style={{ fontFamily: T.body, fontSize: 13, color: T.text, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
            {item.description}
          </div>
        )}

        {item.testNotes && (
          <div>
            <div style={{ fontFamily: T.body, fontSize: 10, fontWeight: 700, color: T.textMuted,
              textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 6 }}>Test Steps</div>
            <div style={{ fontFamily: T.body, fontSize: 13, color: T.text, lineHeight: 1.7, whiteSpace: "pre-wrap",
              background: T.bg, border: `1px solid ${T.border}`, borderRadius: 7, padding: "10px 14px" }}>
              {item.testNotes}
            </div>
          </div>
        )}

        {item.type === "Test Case" && (
          <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
            <TestCaseStoryLinksPanel caseId={item.id} tickets={tickets} />
          </div>
        )}

        {children.length > 0 && (
          <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
            <div style={{ fontFamily: T.body, fontSize: 10, fontWeight: 700, color: T.textMuted,
              textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8 }}>
              Children ({children.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {children.map(c => (
                <div key={c.id} onClick={() => onPreview?.(c)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                    borderRadius: 6, background: T.bg, border: `1px solid ${T.border}`, cursor: "pointer" }}>
                  <span style={{ fontSize: 12 }}>{TYPE_ICON[c.type] || "📋"}</span>
                  <span style={{ fontFamily: T.body, fontSize: 12, color: T.text, flex: 1,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</span>
                  <span style={{ fontFamily: T.mono, fontSize: 9, color: T.textMuted }}>{tcLabel(c.status)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: "10px 14px", borderTop: `1px solid ${T.border}`, display: "flex", gap: 6, flexShrink: 0 }}>
        <ActionMenu items={[
          { icon: "✎", label: "Edit", onClick: () => onEdit(item) },
          { icon: "✕", label: "Delete", variant: "danger", onClick: () => setConfirm(true) },
        ]} />
      </div>

      {confirm && (
        <ConfirmModal
          message={`Delete "${item.title}"?${children.length ? ` This will also delete ${children.length} child item(s).` : ""}`}
          onConfirm={() => { setConfirm(false); onDelete(item.id); onClose(); }}
          onCancel={() => setConfirm(false)} />
      )}
    </div>
  );
};

// ─── Reports (TKT-4NYM2J, TKT-03PXD2, TKT-LN34TX, TKT-3K1DE4, TKT-SSSQBO) ────────
// Read-only project reports living under one "📊 Reports" board tab rather than
// five separate top-level tabs. Overview is pure client-side aggregation over
// tickets already loaded by the board; the other four self-fetch their own
// project-scoped report endpoint.

const ReportStatTile = ({ label, value, color }) => (
  <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10,
    padding: "14px 16px", minWidth: 130 }}>
    <div style={{ fontFamily: T.mono, fontSize: 22, fontWeight: 800, color: color || T.text }}>{value}</div>
    <div style={{ fontFamily: T.body, fontSize: 11, color: T.textMuted, marginTop: 2 }}>{label}</div>
  </div>
);

const ReportBreakdown = ({ title, counts, total }) => {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10,
      padding: 16, flex: 1, minWidth: 220 }}>
      <div style={{ fontFamily: T.body, fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 10 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {entries.length === 0 && (
          <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>No data</div>
        )}
        {entries.map(([k, v]) => (
          <div key={k}>
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: T.body,
              fontSize: 11.5, color: T.textMuted, marginBottom: 3 }}>
              <span>{k}</span><span>{v}</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: T.bg, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${total ? (v / total * 100) : 0}%`, background: T.accent, borderRadius: 3 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const ReportOverview = ({ tickets }) => {
  const total = tickets.length;
  const done  = tickets.filter(t => DONE_STATUSES.has(t.status)).length;
  const open  = total - done;
  const byType = {}, byPriority = {}, byAssignee = {};
  for (const t of tickets) {
    const type = t.type || "Task";
    byType[type] = (byType[type] || 0) + 1;
    const pr = t.priority || "Medium";
    byPriority[pr] = (byPriority[pr] || 0) + 1;
    const a = t.assigneeName || "Unassigned";
    byAssignee[a] = (byAssignee[a] || 0) + 1;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <ReportStatTile label="Total tickets" value={total} />
        <ReportStatTile label="Open" value={open} color={T.accent} />
        <ReportStatTile label="Done" value={done} color="#22c55e" />
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <ReportBreakdown title="By Type" counts={byType} total={total} />
        <ReportBreakdown title="By Priority" counts={byPriority} total={total} />
        <ReportBreakdown title="By Assignee" counts={byAssignee} total={total} />
      </div>
    </div>
  );
};

const ReportActivity = ({ projectId }) => {
  const [items, setItems] = useState(null);

  useEffect(() => {
    setItems(null);
    api.kbProjects.activity(projectId).then(r => setItems(r.items)).catch(() => setItems([]));
  }, [projectId]);

  const fmtWhen = d => new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  if (items === null) return <div style={{ padding: 40, textAlign: "center" }}><Spinner size="md" /></div>;
  if (items.length === 0) return (
    <div style={{ padding: "48px 0", textAlign: "center", fontFamily: T.body, fontSize: 13, color: T.textMuted, fontStyle: "italic" }}>
      No activity recorded yet.
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 680 }}>
      {items.map(it => (
        <div key={it.id} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "9px 12px",
          borderRadius: 8, background: T.surface, border: `1px solid ${T.border}` }}>
          <span style={{ fontFamily: T.body, fontSize: 12.5, color: T.text, flex: 1 }}>
            <strong>{it.userName}</strong>{" "}
            {it.kind === "status" ? (
              it.fromStatus
                ? <>moved <em>{it.ticketTitle}</em> from <strong>{it.fromStatus}</strong> to <strong style={{ color: T.accent }}>{it.toStatus}</strong></>
                : <>created <em>{it.ticketTitle}</em> in <strong style={{ color: T.accent }}>{it.toStatus}</strong></>
            ) : (
              <>commented on <em>{it.ticketTitle}</em></>
            )}
          </span>
          <span style={{ fontFamily: T.body, fontSize: 10.5, color: T.textMuted, whiteSpace: "nowrap" }}>
            {fmtWhen(it.at)}
          </span>
        </div>
      ))}
    </div>
  );
};

const ReportCumulativeFlow = ({ projectId, columns }) => {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    setData(null);
    api.kbProjects.cumulativeFlow(projectId, days).catch(() => null).then(d =>
      setData(d || { days: [], statuses: [], approximatedTicketCount: 0, totalTicketCount: 0 }));
  }, [projectId, days]);

  if (data === null) return <div style={{ padding: 40, textAlign: "center" }}><Spinner size="md" /></div>;

  const colAccent = columns.length > 0 ? Object.fromEntries(columns.map(c => [c.name, c.color])) : COL_ACCENT;

  const daysCtl = (
    <select value={days} onChange={e => setDays(Number(e.target.value))}
      style={{ fontFamily: T.body, fontSize: 12, padding: "4px 8px", borderRadius: 6,
        border: `1px solid ${T.border}`, background: T.bg, color: T.text, cursor: "pointer" }}>
      <option value={14}>14 days</option>
      <option value={30}>30 days</option>
      <option value={60}>60 days</option>
      <option value={90}>90 days</option>
    </select>
  );

  if (data.days.length === 0) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>{daysCtl}</div>
      <div style={{ padding: "48px 0", textAlign: "center", fontFamily: T.body, fontSize: 13, color: T.textMuted, fontStyle: "italic" }}>
        Not enough recorded status history yet to chart flow.
      </div>
    </div>
  );

  const W = 680, H = 260, PAD_L = 34, PAD_B = 22, PAD_T = 10, PAD_R = 10;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const n = data.days.length;
  const maxTotal = Math.max(...data.days.map(d => Object.values(d.counts).reduce((a, b) => a + b, 0)), 1);
  const xFor = i => PAD_L + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const yFor = v => PAD_T + plotH - (v / maxTotal) * plotH;

  // Stack bottom-up in status order so the earliest workflow status forms the
  // base band and the chart reads left-to-right, bottom-to-top like a normal CFD.
  const stackedSeries = [];
  let running = data.days.map(() => 0);
  for (const status of data.statuses) {
    const next = data.days.map((d, i) => running[i] + (d.counts[status] || 0));
    stackedSeries.push({ status, bottom: [...running], top: [...next] });
    running = next;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontFamily: T.body, fontSize: 11.5, color: T.textMuted }}>
          {data.approximatedTicketCount > 0 && (
            <>⚠ {data.approximatedTicketCount} of {data.totalTicketCount} ticket(s) predate status-history tracking
            — shown at their current status for every day rather than a real historical status.</>
          )}
        </div>
        {daysCtl}
      </div>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 10px" }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
          <line x1={PAD_L} y1={PAD_T + plotH} x2={W - PAD_R} y2={PAD_T + plotH} stroke={T.border} strokeWidth="1" />
          <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + plotH} stroke={T.border} strokeWidth="1" />
          {stackedSeries.map(s => {
            const topPath = data.days.map((_, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(s.top[i])}`).join(" ");
            const bottomPath = data.days.map((_, ri) => {
              const i = n - 1 - ri;
              return `L ${xFor(i)} ${yFor(s.bottom[i])}`;
            }).join(" ");
            return (
              <path key={s.status} d={`${topPath} ${bottomPath} Z`}
                fill={(colAccent[s.status] || T.accent) + "AA"} stroke={colAccent[s.status] || T.accent} strokeWidth="1" />
            );
          })}
          <text x={PAD_L - 6} y={PAD_T + 4} textAnchor="end" fontSize="9" fill={T.textMuted} fontFamily="monospace">{maxTotal}</text>
          <text x={PAD_L - 6} y={PAD_T + plotH} textAnchor="end" fontSize="9" fill={T.textMuted} fontFamily="monospace">0</text>
        </svg>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center", marginTop: 8 }}>
          {data.statuses.map(s => (
            <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: T.body, fontSize: 11, color: T.textMuted }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: colAccent[s] || T.accent }} /> {s}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

const rtThStyle = { textAlign: "left", padding: "8px 14px", fontFamily: T.mono, fontSize: 10.5,
  fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: ".06em",
  borderBottom: `1px solid ${T.border}` };
const rtTdStyle = { padding: "8px 14px", fontFamily: T.body, fontSize: 12.5, color: T.text,
  borderBottom: `1px solid ${T.border}` };

const ReportCycleTime = ({ projectId }) => {
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    api.kbProjects.cycleTime(projectId).then(setData).catch(() => setData(null));
  }, [projectId]);

  if (data === null) return <div style={{ padding: 40, textAlign: "center" }}><Spinner size="md" /></div>;

  const fmtDuration = ms => {
    if (ms == null) return "—";
    const hours = ms / 3600000;
    return hours < 24 ? `${hours.toFixed(1)}h` : `${(hours / 24).toFixed(1)}d`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 680 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <ReportStatTile label="Cycle time (avg)" value={fmtDuration(data.overallCycleTimeAvgMs)} />
        <ReportStatTile label="Cycle time (median)" value={fmtDuration(data.overallCycleTimeMedianMs)} />
        <ReportStatTile label="Tickets reaching Done" value={data.ticketsReachedDone} />
      </div>
      <div style={{ fontFamily: T.body, fontSize: 11.5, color: T.textMuted }}>
        Based on {data.ticketsWithHistory} of {data.totalTickets} ticket(s) with recorded status history
        {data.totalTickets > data.ticketsWithHistory ? " — older tickets created before history tracking began aren't counted." : "."}
      </div>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={rtThStyle}>Status</th>
              <th style={rtThStyle}>Tickets</th>
              <th style={rtThStyle}>Avg time</th>
              <th style={rtThStyle}>Median time</th>
            </tr>
          </thead>
          <tbody>
            {data.byStatus.length === 0 ? (
              <tr><td colSpan={4} style={{ padding: 20, textAlign: "center", fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>No data yet.</td></tr>
            ) : data.byStatus.map(s => (
              <tr key={s.status}>
                <td style={rtTdStyle}>{s.status}</td>
                <td style={rtTdStyle}>{s.count}</td>
                <td style={rtTdStyle}>{fmtDuration(s.avgMs)}</td>
                <td style={rtTdStyle}>{fmtDuration(s.medianMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const ReportVelocity = ({ projectId }) => {
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    api.kbProjects.velocity(projectId).then(setData).catch(() => setData({ sprints: [] }));
  }, [projectId]);

  if (data === null) return <div style={{ padding: 40, textAlign: "center" }}><Spinner size="md" /></div>;
  if (data.sprints.length === 0) return (
    <div style={{ padding: "48px 0", textAlign: "center", fontFamily: T.body, fontSize: 13, color: T.textMuted, fontStyle: "italic" }}>
      No sprints yet — create one in Board Settings → Sprints.
    </div>
  );

  const maxPoints = Math.max(...data.sprints.map(s => s.totalPoints), 1);
  const W = 680, H = 220, PAD_L = 34, PAD_B = 40, PAD_T = 10, PAD_R = 10;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const n = data.sprints.length;
  const gap = plotW / n;
  const barW = Math.min(gap * 0.6, 60);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 10px" }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
          <line x1={PAD_L} y1={PAD_T + plotH} x2={W - PAD_R} y2={PAD_T + plotH} stroke={T.border} strokeWidth="1" />
          <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + plotH} stroke={T.border} strokeWidth="1" />
          {data.sprints.map((s, i) => {
            const x = PAD_L + i * gap + (gap - barW) / 2;
            const totalH = (s.totalPoints / maxPoints) * plotH;
            const doneH  = (s.completedPoints / maxPoints) * plotH;
            const yBase  = PAD_T + plotH;
            return (
              <g key={s.sprintId}>
                <rect x={x} y={yBase - totalH} width={barW} height={totalH} fill={T.border} rx="2" />
                <rect x={x} y={yBase - doneH} width={barW} height={doneH} fill={T.accent} rx="2" />
                <text x={x + barW / 2} y={yBase + 14} textAnchor="middle" fontSize="9" fill={T.textMuted} fontFamily="monospace">
                  {s.sprintName.length > 10 ? s.sprintName.slice(0, 9) + "…" : s.sprintName}
                </text>
                <text x={x + barW / 2} y={yBase - totalH - 5} textAnchor="middle" fontSize="9" fill={T.textMuted} fontFamily="monospace">
                  {s.completedPoints}/{s.totalPoints}
                </text>
              </g>
            );
          })}
        </svg>
        <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 4 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: T.body, fontSize: 11, color: T.textMuted }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: T.accent }} /> Completed points
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: T.body, fontSize: 11, color: T.textMuted }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: T.border }} /> Total points
          </span>
        </div>
      </div>
    </div>
  );
};

const REPORT_TABS = [
  ["overview",  "📊 Overview"],
  ["activity",  "📰 Activity"],
  ["cfd",       "📈 Cumulative Flow"],
  ["cycletime", "⏱ Cycle Time"],
  ["velocity",  "🏁 Velocity"],
];

const ReportsView = ({ project, tickets, columns }) => {
  const [sub, setSub] = useState("overview");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, height: "100%" }}>
      <div style={{ display: "flex", borderRadius: 7, border: `1px solid ${T.border}`,
        overflow: "hidden", flexShrink: 0, width: "fit-content" }}>
        {REPORT_TABS.map(([key, label]) => (
          <button key={key} onClick={() => setSub(key)}
            style={{ padding: "6px 12px", border: "none", cursor: "pointer",
              fontFamily: T.body, fontSize: 12, fontWeight: sub === key ? 700 : 400,
              background: sub === key ? T.accent + "22" : "transparent",
              color: sub === key ? T.accent : T.textMuted, whiteSpace: "nowrap" }}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {sub === "overview"  && <ReportOverview tickets={tickets} />}
        {sub === "activity"  && <ReportActivity projectId={project.id} />}
        {sub === "cfd"       && <ReportCumulativeFlow projectId={project.id} columns={columns} />}
        {sub === "cycletime" && <ReportCycleTime projectId={project.id} />}
        {sub === "velocity"  && <ReportVelocity projectId={project.id} />}
      </div>
    </div>
  );
};

const TestSuiteView = ({ tickets, onPreview, onEdit, onAdd, onExecute, onMoveCase, canEdit }) => {
  const [search,      setSearch]      = useState("");
  // navSel: { type: "all" | "folder" | "plan", id?: string }
  const [navSel,      setNavSel]      = useState({ type: "all" });
  const [planFilt,    setPlanFilt]    = useState("");
  const [collapsed,   setCollapsed]   = useState({});
  const [folderOpen,  setFolderOpen]  = useState({});  // { folderId: true } = open
  const [dragCase,    setDragCase]    = useState(null);
  const [dropRunId,   setDropRunId]   = useState(null);
  const [dragFolder,  setDragFolder]  = useState(null);  // folder/plan id being dragged
  const [dropFolderId, setDropFolderId] = useState(null);

  const toggle = id => setCollapsed(p => ({ ...p, [id]: !p[id] }));
  const q = search.trim().toLowerCase();

  const testFolders = tickets.filter(t => t.type === "Test Folder");
  const testPlans   = tickets.filter(t => t.type === "Test Plan");
  const testRuns    = tickets.filter(t => t.type === "Test Run");
  const testCases   = tickets.filter(t => t.type === "Test Case");

  // Compute which plans are visible based on the left-nav selection
  const folderIds = new Set(testFolders.map(f => f.id));
  const visiblePlans = useMemo(() => {
    if (navSel.type === "plan")   return testPlans.filter(p => p.id === navSel.id);
    if (navSel.type === "folder") {
      // Recursively collect all folder IDs under a folder
      const collect = fid => {
        const subs = testFolders.filter(f => f.parentId === fid).map(f => f.id);
        return [fid, ...subs.flatMap(collect)];
      };
      const fids = new Set(collect(navSel.id));
      return testPlans.filter(p => fids.has(p.parentId));
    }
    return testPlans;
  }, [navSel, testPlans, testFolders]);

  const totalPass    = testCases.filter(c => TC_PASS.has(c.status)).length;
  const totalFail    = testCases.filter(c => TC_FAIL.has(c.status)).length;
  const totalBlocked = testCases.filter(c => TC_BLOCKED.has(c.status)).length;
  const totalActive  = testCases.filter(c => TC_ACTIVE.has(c.status)).length;
  const totalNotRun  = testCases.length - totalPass - totalFail - totalBlocked - totalActive;

  const childRuns   = planId   => testRuns.filter(r => r.parentId === planId);
  const childCases  = parentId => testCases.filter(c => c.parentId === parentId);
  const caseMatches = c => !q || c.id.toLowerCase().includes(q) || c.title.toLowerCase().includes(q);

  // When nav selection changes, clear the plan sub-filter
  const selectNav = sel => { setNavSel(sel); setPlanFilt(""); };

  if (testCases.length === 0 && testRuns.length === 0 && testPlans.length === 0 && testFolders.length === 0) return (
    <div style={{ padding: "60px 24px", textAlign: "center", fontFamily: T.body, fontSize: 14, color: T.textMuted }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🧪</div>
      <div style={{ fontWeight: 600, color: T.text, marginBottom: 8 }}>No test artefacts yet</div>
      <div>Use <strong>＋ Test Folder</strong> to organise, or <strong>＋ Test Plan</strong> to start executing.</div>
    </div>
  );

  // ── ExecBtn ───────────────────────────────────────────────────────────────────
  const ExecBtn = ({ label, title, color, onClick, active }) => (
    <button title={title} onClick={onClick}
      style={{ background: active ? `${color}22` : "none", border: `1px solid ${active ? color : T.border}55`,
        borderRadius: 3, color: active ? color : T.textMuted, cursor: "pointer", fontSize: 11,
        padding: "0px 5px", fontFamily: T.mono, flexShrink: 0, lineHeight: "18px", transition: "all .12s" }}
      onMouseEnter={e => { e.currentTarget.style.background = `${color}22`; e.currentTarget.style.borderColor = color; e.currentTarget.style.color = color; }}
      onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = `${T.border}55`; e.currentTarget.style.color = T.textMuted; } }}>
      {label}
    </button>
  );

  // ── SegBar ────────────────────────────────────────────────────────────────────
  const SegBar = ({ stats, width = 80 }) => {
    if (stats.total === 0) return null;
    const segs = [
      [stats.passed,  JIRA_COLOR.Pass],
      [stats.failed,  JIRA_COLOR.Fail],
      [stats.blocked, JIRA_COLOR.Blocked],
      [stats.active,  JIRA_COLOR["In Progress"]],
      [stats.pending, "#374151"],
    ];
    return (
      <div style={{ width, height: 6, borderRadius: 3, overflow: "hidden", display: "flex", flexShrink: 0, background: T.border }}>
        {segs.map(([n, color], i) => n > 0 && (
          <div key={i} style={{ height: "100%", flex: n, background: color }} />
        ))}
      </div>
    );
  };

  // ── StatChip ──────────────────────────────────────────────────────────────────
  const StatChip = ({ count, color, label }) => count === 0 ? null : (
    <span title={`${count} ${label}`} style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700,
      padding: "1px 6px", borderRadius: 3, color, background: `${color}18`, border: `1px solid ${color}33`,
      flexShrink: 0, whiteSpace: "nowrap" }}>
      {count} {label}
    </span>
  );

  // ── CaseRow ───────────────────────────────────────────────────────────────────
  const CaseRow = ({ c, depth = 0 }) => {
    const [hover, setHover] = useState(false);
    if (!caseMatches(c)) return null;
    const lbl   = tcLabel(c.status);
    const color = JIRA_COLOR[lbl] || "#6b7280";
    const icon  = tcStatusIcon(c.status);
    const isDragging = dragCase?.id === c.id;

    return (
      <div
        draggable={!!canEdit}
        onDragStart={e => { e.stopPropagation(); setDragCase({ id: c.id, parentId: c.parentId }); }}
        onDragEnd={() => { setDragCase(null); setDropRunId(null); }}
        onClick={() => !isDragging && onPreview?.(c)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{ display: "flex", alignItems: "center", gap: 8,
          paddingLeft: 10 + depth * 24, paddingRight: 10, paddingTop: 6, paddingBottom: 6,
          borderBottom: `1px solid ${T.border}18`, cursor: isDragging ? "grabbing" : "pointer",
          background: isDragging ? `${T.accent}08` : hover ? T.surfaceHover : "transparent",
          opacity: isDragging ? 0.45 : 1, transition: "background .1s" }}>

        {/* Drag handle */}
        <span style={{ color: hover ? T.textMuted : "transparent", fontSize: 11, cursor: "grab",
          flexShrink: 0, lineHeight: 1, userSelect: "none", transition: "color .1s" }}>⠿</span>

        <span style={{ fontSize: 12, color, flexShrink: 0, width: 14, textAlign: "center" }}>{icon}</span>
        <span style={{ fontFamily: T.mono, fontSize: 10, color: T.accent, flexShrink: 0 }}>{c.id}</span>
        <span style={{ fontFamily: T.body, fontSize: 13, color: T.text, flex: 1,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {c.title}
        </span>

        {/* Inline execution buttons — hover-reveal */}
        {canEdit && hover && (
          <div style={{ display: "flex", gap: 3, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <ExecBtn label="✓" title="Mark Pass"    color={JIRA_COLOR.Pass}            onClick={() => onExecute?.(c.id, "Done")}           active={TC_PASS.has(c.status)} />
            <ExecBtn label="✗" title="Mark Fail"    color={JIRA_COLOR.Fail}            onClick={() => onExecute?.(c.id, "Testing Failed")}  active={TC_FAIL.has(c.status)} />
            <ExecBtn label="⊘" title="Mark Blocked" color={JIRA_COLOR.Blocked}         onClick={() => onExecute?.(c.id, "Cancelled")}       active={TC_BLOCKED.has(c.status)} />
            <ExecBtn label="⟳" title="Reset"        color={JIRA_COLOR["Not Executed"]} onClick={() => onExecute?.(c.id, "Ready")}           active={false} />
          </div>
        )}

        {/* JIRA-style status pill */}
        <span style={{ fontFamily: T.mono, fontSize: 10, padding: "1px 7px", borderRadius: 3,
          color, background: `${color}18`, border: `1px solid ${color}40`, flexShrink: 0, letterSpacing: ".02em" }}>
          {lbl}
        </span>

        {c.assigneeName && (
          <span style={{ fontFamily: T.body, fontSize: 11, color: T.textMuted, flexShrink: 0,
            maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {c.assigneeName}
          </span>
        )}
        {canEdit && !hover && (
          <button onClick={e => { e.stopPropagation(); onEdit(c); }}
            style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 4,
              color: T.textMuted, cursor: "pointer", fontSize: 10, padding: "1px 6px",
              fontFamily: T.body, flexShrink: 0 }}>✎</button>
        )}
      </div>
    );
  };

  // ── RunBlock ──────────────────────────────────────────────────────────────────
  const RunBlock = ({ run, depth = 1 }) => {
    const cases        = childCases(run.id);
    const stats        = runStats(cases);
    const isOpen       = !collapsed[run.id];
    const pct          = stats.total > 0 ? Math.round(stats.passed / stats.total * 100) : 0;
    const runColor     = tcStatusColor(run.status);
    const isDragTarget = dropRunId === run.id && dragCase?.parentId !== run.id;

    const visibleCases = cases.filter(caseMatches);
    if (q && visibleCases.length === 0 && !run.id.toLowerCase().includes(q) && !run.title.toLowerCase().includes(q)) return null;

    return (
      <div style={{ borderBottom: `1px solid ${T.border}22` }}
        onDragOver={e => { if (dragCase && dragCase.parentId !== run.id) { e.preventDefault(); setDropRunId(run.id); } }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDropRunId(null); }}
        onDrop={e => { e.preventDefault(); if (dragCase) { onMoveCase?.(dragCase.id, run.id); setDragCase(null); setDropRunId(null); } }}>

        {isDragTarget && <div style={{ height: 3, background: T.accent, margin: "0 12px", borderRadius: 2 }} />}

        {/* Run header */}
        <div onClick={() => toggle(run.id)}
          style={{ display: "flex", alignItems: "center", gap: 8,
            paddingLeft: 12 + depth * 16, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
            cursor: "pointer", background: isDragTarget ? `${T.accent}08` : T.bg, transition: "background .1s",
            borderLeft: `3px solid ${runColor}66` }}
          onMouseEnter={e => { if (!isDragTarget) e.currentTarget.style.background = T.surfaceHover; }}
          onMouseLeave={e => { e.currentTarget.style.background = isDragTarget ? `${T.accent}08` : T.bg; }}>
          <span style={{ fontSize: 10, color: T.textMuted, flexShrink: 0, width: 10 }}>{isOpen ? "▾" : "▸"}</span>
          <span style={{ fontSize: 13 }}>▶</span>
          <span style={{ fontFamily: T.mono, fontSize: 10, color: T.accent, flexShrink: 0 }}>{run.id}</span>
          <span style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.text, flex: 1,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {run.title}
          </span>

          {stats.total > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
              <StatChip count={stats.passed}  color={JIRA_COLOR.Pass}             label="Pass" />
              <StatChip count={stats.failed}  color={JIRA_COLOR.Fail}             label="Fail" />
              <StatChip count={stats.blocked} color={JIRA_COLOR.Blocked}          label="Blocked" />
              <StatChip count={stats.active}  color={JIRA_COLOR["In Progress"]}   label="In Progress" />
              <StatChip count={stats.pending} color={JIRA_COLOR["Not Executed"]}  label="Not Executed" />
              <SegBar stats={stats} width={60} />
              <span style={{ fontFamily: T.mono, fontSize: 10, color: pct === 100 ? JIRA_COLOR.Pass : T.textMuted, flexShrink: 0 }}>
                {pct}%
              </span>
            </div>
          )}
          {stats.total === 0 && <span style={{ fontFamily: T.body, fontSize: 11, color: T.textMuted, fontStyle: "italic" }}>No cases</span>}

          {canEdit && (
            <button onClick={e => { e.stopPropagation(); onEdit(run); }}
              style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 4,
                color: T.textMuted, cursor: "pointer", fontSize: 10, padding: "1px 6px",
                fontFamily: T.body, flexShrink: 0 }}>✎</button>
          )}
        </div>

        {/* Cases + inline add */}
        {isOpen && (
          <div>
            {visibleCases.map(c => <CaseRow key={c.id} c={c} depth={depth} />)}
            {cases.length === 0 && (
              <div style={{ paddingLeft: 48 + depth * 12, paddingTop: 5, paddingBottom: 5,
                fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>
                No test cases yet.
              </div>
            )}
            {canEdit && onAdd && (
              <div style={{ paddingLeft: 14 + depth * 24, paddingTop: 4, paddingBottom: 8 }}>
                <button onClick={() => onAdd({ type: "Test Case", parentId: run.id })}
                  style={{ background: "none", border: `1px dashed ${T.border}`, borderRadius: 4,
                    color: T.textMuted, cursor: "pointer", fontSize: 11, padding: "3px 10px", fontFamily: T.body }}>
                  ＋ Add Test Case
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── PlanBlock ─────────────────────────────────────────────────────────────────
  const PlanBlock = ({ plan }) => {
    const runs        = childRuns(plan.id);
    const directCases = childCases(plan.id);
    const allCases    = [...runs.flatMap(r => childCases(r.id)), ...directCases];
    const stats       = runStats(allCases);
    const pct         = stats.total > 0 ? Math.round(stats.passed / stats.total * 100) : 0;
    const isOpen      = !collapsed[plan.id];

    const hasVisibleContent = !q || runs.some(r => {
      const cases = childCases(r.id);
      return cases.some(caseMatches) || r.title.toLowerCase().includes(q) || r.id.toLowerCase().includes(q);
    }) || directCases.some(caseMatches) || plan.title.toLowerCase().includes(q) || plan.id.toLowerCase().includes(q);
    if (!hasVisibleContent) return null;

    return (
      <div style={{ background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 10, overflow: "hidden", marginBottom: 14 }}>

        {/* Plan header */}
        <div onClick={() => toggle(plan.id)}
          style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px",
            cursor: "pointer", background: T.bg, transition: "background .1s",
            borderLeft: `4px solid ${T.accent}` }}
          onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover}
          onMouseLeave={e => e.currentTarget.style.background = T.bg}>
          <span style={{ fontSize: 11, color: T.textMuted, flexShrink: 0, width: 12 }}>{isOpen ? "▾" : "▸"}</span>
          <span style={{ fontSize: 16 }}>📋</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: T.head, fontSize: 14, fontWeight: 700, color: T.text,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{plan.title}</span>
              <span style={{ fontFamily: T.mono, fontSize: 9, color: T.textMuted }}>{plan.id}</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 5, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontFamily: T.body, fontSize: 11, color: T.textMuted }}>
                {runs.length} cycle{runs.length !== 1 ? "s" : ""} · {allCases.length} test{allCases.length !== 1 ? "s" : ""}
              </span>
              {stats.total > 0 && (
                <>
                  <SegBar stats={stats} width={100} />
                  <StatChip count={stats.passed}  color={JIRA_COLOR.Pass}            label="Pass" />
                  <StatChip count={stats.failed}  color={JIRA_COLOR.Fail}            label="Fail" />
                  <StatChip count={stats.blocked} color={JIRA_COLOR.Blocked}         label="Blocked" />
                  <StatChip count={stats.pending} color={JIRA_COLOR["Not Executed"]} label="Not Executed" />
                  <span style={{ fontFamily: T.mono, fontSize: 10, color: pct === 100 ? JIRA_COLOR.Pass : T.textMuted }}>
                    {pct === 100 ? "✓ All Passed" : `${pct}% pass rate`}
                  </span>
                </>
              )}
            </div>
          </div>
          {canEdit && (
            <button onClick={e => { e.stopPropagation(); onEdit(plan); }}
              style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 4,
                color: T.textMuted, cursor: "pointer", fontSize: 11, padding: "2px 8px",
                fontFamily: T.body, flexShrink: 0 }}>✎</button>
          )}
        </div>

        {/* Cycles + direct cases + inline add */}
        {isOpen && (
          <div>
            {runs.map(r => <RunBlock key={r.id} run={r} depth={1} />)}
            {directCases.filter(caseMatches).map(c => <CaseRow key={c.id} c={c} depth={1} />)}
            {runs.length === 0 && directCases.length === 0 && (
              <div style={{ padding: "8px 20px", fontFamily: T.body, fontSize: 12,
                color: T.textMuted, fontStyle: "italic" }}>
                No test cycles yet.
              </div>
            )}
            {canEdit && onAdd && (
              <div style={{ padding: "6px 16px 10px" }}>
                <button onClick={() => onAdd({ type: "Test Run", parentId: plan.id })}
                  style={{ background: "none", border: `1px dashed ${T.border}`, borderRadius: 4,
                    color: T.textMuted, cursor: "pointer", fontSize: 11, padding: "3px 10px", fontFamily: T.body }}>
                  ＋ Add Test Cycle
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── FolderTree (left nav sidebar) ────────────────────────────────────────────
  const FolderTree = () => {
    // Recursive folder node
    const FolderNode = ({ folder, depth = 0 }) => {
      const isOpen = folderOpen[folder.id] !== false; // open by default
      const childFolders = testFolders.filter(f => f.parentId === folder.id);
      const plansHere    = testPlans.filter(p => p.parentId === folder.id);
      const isSelected   = navSel.type === "folder" && navSel.id === folder.id;

      return (
        <div>
          {/* Folder row */}
          <div
            draggable={!!canEdit}
            onDragStart={e => { e.stopPropagation(); setDragFolder(folder.id); }}
            onDragEnd={() => { setDragFolder(null); setDropFolderId(null); }}
            onDragOver={e => {
              if (dragFolder && dragFolder !== folder.id) {
                e.preventDefault(); e.stopPropagation();
                setDropFolderId(folder.id);
              }
            }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDropFolderId(null); }}
            onDrop={e => {
              e.preventDefault(); e.stopPropagation();
              if (!dragFolder || dragFolder === folder.id) return;
              onMoveCase?.(dragFolder, folder.id);
              setDragFolder(null); setDropFolderId(null);
            }}
            onClick={() => selectNav({ type: "folder", id: folder.id })}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: `4px 8px 4px ${8 + depth * 14}px`,
              borderRadius: 5, cursor: "pointer", userSelect: "none",
              background: isSelected ? T.accent + "22"
                        : dropFolderId === folder.id ? T.accent + "11"
                        : "transparent",
              color: isSelected ? T.accent : T.text,
              fontFamily: T.body, fontSize: 12, fontWeight: isSelected ? 600 : 400,
              borderLeft: isSelected ? `2px solid ${T.accent}` : "2px solid transparent",
            }}>
            <span onClick={e => { e.stopPropagation(); setFolderOpen(p => ({ ...p, [folder.id]: !isOpen })); }}
              style={{ fontSize: 10, color: T.textMuted, width: 12, flexShrink: 0 }}>
              {(childFolders.length > 0 || plansHere.length > 0) ? (isOpen ? "▾" : "▸") : ""}
            </span>
            <span style={{ fontSize: 13, flexShrink: 0 }}>📁</span>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folder.title}</span>
            {canEdit && (
              <span onClick={e => { e.stopPropagation(); onEdit(folder); }}
                style={{ color: T.textMuted, fontSize: 10, opacity: 0.6, flexShrink: 0 }}>✎</span>
            )}
          </div>

          {/* Children */}
          {isOpen && (
            <div>
              {childFolders.map(cf => <FolderNode key={cf.id} folder={cf} depth={depth + 1} />)}
              {plansHere.map(plan => {
                const isPlanSel = navSel.type === "plan" && navSel.id === plan.id;
                return (
                  <div key={plan.id} onClick={() => selectNav({ type: "plan", id: plan.id })}
                    style={{
                      display: "flex", alignItems: "center", gap: 4,
                      padding: `3px 8px 3px ${8 + (depth + 1) * 14}px`,
                      borderRadius: 5, cursor: "pointer", userSelect: "none",
                      background: isPlanSel ? T.accent + "22" : "transparent",
                      color: isPlanSel ? T.accent : T.text,
                      fontFamily: T.body, fontSize: 12, fontWeight: isPlanSel ? 600 : 400,
                      borderLeft: isPlanSel ? `2px solid ${T.accent}` : "2px solid transparent",
                    }}>
                    <span style={{ width: 12, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, flexShrink: 0 }}>🧪</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{plan.title}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    };

    // Root-level folders (no parent or parent not a folder)
    const rootFolders = testFolders.filter(f => !f.parentId || !folderIds.has(f.parentId));
    // Plans not inside any folder
    const unfiledPlans = testPlans.filter(p => !p.parentId || !folderIds.has(p.parentId));

    return (
      <div style={{
        width: 220, flexShrink: 0, background: T.bg,
        borderRight: `1px solid ${T.border}`,
        display: "flex", flexDirection: "column",
        overflowY: "auto", overflowX: "hidden",
      }}>
        {/* Sidebar header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 8px 6px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <span style={{ fontFamily: T.body, fontSize: 11, fontWeight: 700, letterSpacing: ".07em",
            textTransform: "uppercase", color: T.textMuted }}>Repository</span>
          {canEdit && onAdd && (
            <button onClick={() => onAdd({ type: "Test Folder" })}
              title="New Test Folder"
              style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted,
                fontSize: 14, lineHeight: 1, padding: "0 2px", fontFamily: T.body }}>＋</button>
          )}
        </div>

        {/* All Tests root node */}
        <div onClick={() => selectNav({ type: "all" })}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "5px 8px 5px 10px", cursor: "pointer", userSelect: "none",
            borderRadius: 5, margin: "4px 4px 2px",
            background: navSel.type === "all" ? T.accent + "22" : "transparent",
            color: navSel.type === "all" ? T.accent : T.text,
            fontFamily: T.body, fontSize: 12, fontWeight: navSel.type === "all" ? 600 : 400,
            borderLeft: navSel.type === "all" ? `2px solid ${T.accent}` : "2px solid transparent",
          }}>
          <span style={{ fontSize: 13 }}>📂</span>
          <span>All Tests</span>
          <span style={{ marginLeft: "auto", fontFamily: T.mono, fontSize: 10, color: T.textMuted }}>{testCases.length}</span>
        </div>

        {/* Folder tree */}
        <div style={{ padding: "0 4px", flex: 1 }}>
          {rootFolders.map(f => <FolderNode key={f.id} folder={f} />)}
          {/* Unfiled plans (no folder parent) */}
          {unfiledPlans.map(plan => {
            const isPlanSel = navSel.type === "plan" && navSel.id === plan.id;
            return (
              <div key={plan.id} onClick={() => selectNav({ type: "plan", id: plan.id })}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "3px 8px 3px 8px", borderRadius: 5, cursor: "pointer", userSelect: "none",
                  background: isPlanSel ? T.accent + "22" : "transparent",
                  color: isPlanSel ? T.accent : T.text,
                  fontFamily: T.body, fontSize: 12, fontWeight: isPlanSel ? 600 : 400,
                  borderLeft: isPlanSel ? `2px solid ${T.accent}` : "2px solid transparent",
                }}>
                <span style={{ width: 12, flexShrink: 0 }} />
                <span style={{ fontSize: 12, flexShrink: 0 }}>🧪</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{plan.title}</span>
              </div>
            );
          })}
        </div>

        {/* Add Plan/Folder footer */}
        {canEdit && onAdd && (
          <div style={{ padding: "6px 8px", borderTop: `1px solid ${T.border}`, display: "flex", gap: 6, flexShrink: 0 }}>
            <button onClick={() => onAdd({ type: "Test Plan" })}
              style={{ flex: 1, background: "none", border: `1px dashed ${T.border}`, borderRadius: 4,
                color: T.textMuted, cursor: "pointer", fontSize: 10, padding: "3px 0", fontFamily: T.body }}>
              ＋ Plan
            </button>
            <button onClick={() => onAdd({ type: "Test Folder" })}
              style={{ flex: 1, background: "none", border: `1px dashed ${T.border}`, borderRadius: 4,
                color: T.textMuted, cursor: "pointer", fontSize: 10, padding: "3px 0", fontFamily: T.body }}>
              ＋ Folder
            </button>
          </div>
        )}
      </div>
    );
  };

  const planIds = new Set(testPlans.map(p => p.id));
  const runIds  = new Set(testRuns.map(r => r.id));
  const orphanRuns      = testRuns.filter(r => !r.parentId || !planIds.has(r.parentId));
  const standaloneCases = testCases.filter(c => !c.parentId || (!planIds.has(c.parentId) && !runIds.has(c.parentId)));

  // Which plans show in the right panel?
  const rightPlans = planFilt
    ? visiblePlans.filter(p => p.id === planFilt)
    : visiblePlans;

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* ── Left nav / folder tree ─────────────────────────── */}
      <FolderTree />

      {/* ── Right execution panel ──────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        {/* Toolbar */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0,
          padding: "10px 14px 10px", borderBottom: `1px solid ${T.border}`, flexWrap: "wrap" }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search cycles, test cases…"
            style={{ flex: 1, minWidth: 140, fontFamily: T.body, fontSize: 13, color: T.text, background: T.bg,
              border: `1px solid ${T.border}`, borderRadius: 7, padding: "6px 10px", outline: "none" }} />
          {visiblePlans.length > 1 && (
            <select value={planFilt} onChange={e => setPlanFilt(e.target.value)}
              style={{ fontFamily: T.body, fontSize: 12, color: T.text, background: T.bg,
                border: `1px solid ${T.border}`, borderRadius: 7, padding: "6px 10px", cursor: "pointer", outline: "none" }}>
              <option value="">All plans</option>
              {visiblePlans.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          )}
          {/* Execution summary chips */}
          <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0, flexWrap: "wrap" }}>
            <StatChip count={totalPass}    color={JIRA_COLOR.Pass}            label="Pass" />
            <StatChip count={totalFail}    color={JIRA_COLOR.Fail}            label="Fail" />
            <StatChip count={totalBlocked} color={JIRA_COLOR.Blocked}         label="Blocked" />
            <StatChip count={totalActive}  color={JIRA_COLOR["In Progress"]}  label="In Progress" />
            <StatChip count={totalNotRun}  color={JIRA_COLOR["Not Executed"]} label="Not Executed" />
            {testCases.length > 0 && (
              <span style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted }}>/ {testCases.length}</span>
            )}
          </div>
        </div>

        {/* Plan tree (right panel body) */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px" }}>
          {rightPlans.map(plan => <PlanBlock key={plan.id} plan={plan} />)}
          {navSel.type === "all" && orphanRuns.length > 0 && !planFilt && (
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 14 }}>
              <div style={{ padding: "10px 16px", background: T.bg, borderBottom: `1px solid ${T.border}`,
                fontFamily: T.body, fontSize: 12, fontWeight: 700, color: T.textMuted, letterSpacing: ".06em", textTransform: "uppercase" }}>
                Unplanned Cycles
              </div>
              {orphanRuns.map(r => <RunBlock key={r.id} run={r} depth={0} />)}
            </div>
          )}
          {navSel.type === "all" && standaloneCases.filter(caseMatches).length > 0 && !planFilt && (
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 14 }}>
              <div style={{ padding: "10px 16px", background: T.bg, borderBottom: `1px solid ${T.border}`,
                fontFamily: T.body, fontSize: 12, fontWeight: 700, color: T.textMuted, letterSpacing: ".06em", textTransform: "uppercase" }}>
                Standalone Cases
              </div>
              {standaloneCases.filter(caseMatches).map(c => <CaseRow key={c.id} c={c} depth={0} />)}
            </div>
          )}
          {rightPlans.length === 0 && orphanRuns.length === 0 && standaloneCases.length === 0 && (
            <div style={{ padding: "48px 24px", textAlign: "center", fontFamily: T.body,
              fontSize: 13, color: T.textMuted, fontStyle: "italic" }}>
              {navSel.type === "all" ? "Nothing matches your search." : "No test plans in this selection."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Saved Filters (TKT-3MD0S1) ────────────────────────────────────────────────
// Persists the current combination of type/priority/version/assignee/label/text
// filters as a named shortcut — per-user, not shared. Applying one overwrites the
// live filter state outright rather than merging, so a saved filter always
// reproduces exactly what was saved.

const EMPTY_FILTER = { priority: "", section: "", type: "", assigneeId: "", versionId: "", label: "", q: "" };

const SavedFiltersMenu = ({ open, setOpen, filter, setFilter, savedFilters, setSavedFilters }) => {
  const btnRef = useRef(null);
  const hasActiveFilter = Object.values(filter).some(v => v);

  const handleSave = async () => {
    const name = window.prompt("Name this filter:");
    if (!name || !name.trim()) return;
    try {
      const created = await api.savedFilters.create({ name: name.trim(), entityType: "ticket", query: filter });
      setSavedFilters(prev => [...prev, created]);
      toast.success(`Saved filter "${name.trim()}"`);
    } catch (e) { toast.error(e.message); }
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    try {
      await api.savedFilters.remove(id);
      setSavedFilters(prev => prev.filter(f => f.id !== id));
    } catch (e2) { toast.error(e2.message); }
  };

  return (
    <div style={{ position: "relative" }}>
      <button ref={btnRef} type="button" onClick={() => setOpen(o => !o)}
        style={{ fontFamily: T.body, fontSize: 12, cursor: "pointer",
          padding: "5px 12px", borderRadius: 7, display: "flex", alignItems: "center", gap: 6,
          border: `1px solid ${hasActiveFilter ? T.accent + "88" : T.border}`,
          background: hasActiveFilter ? T.accent + "10" : "none",
          color: hasActiveFilter ? T.accent : T.textMuted }}>
        ★ Filters
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 998 }} />
          <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 999,
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 9,
            boxShadow: "0 8px 28px rgba(0,0,0,.25)", minWidth: 230, overflow: "hidden" }}>
            <div style={{ padding: "8px 12px", borderBottom: `1px solid ${T.border}`,
              fontFamily: T.body, fontSize: 10.5, fontWeight: 700, color: T.textMuted,
              textTransform: "uppercase", letterSpacing: ".06em" }}>
              Saved Filters
            </div>
            {savedFilters.length === 0 ? (
              <div style={{ padding: "12px", fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>
                None yet.
              </div>
            ) : savedFilters.map(f => (
              <div key={f.id} onClick={() => { setFilter({ ...EMPTY_FILTER, ...f.query }); setOpen(false); }}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <span style={{ flex: 1, fontFamily: T.body, fontSize: 12.5, color: T.text }}>{f.name}</span>
                <button onClick={e => handleDelete(e, f.id)} title="Delete"
                  style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, fontSize: 13 }}>×</button>
              </div>
            ))}
            <div style={{ borderTop: `1px solid ${T.border}`, padding: 6, display: "flex", flexDirection: "column", gap: 4 }}>
              <button onClick={handleSave} disabled={!hasActiveFilter}
                style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600, textAlign: "left",
                  padding: "7px 8px", borderRadius: 6, border: "none", cursor: hasActiveFilter ? "pointer" : "default",
                  color: hasActiveFilter ? T.accent : T.textMuted, background: "none" }}>
                ＋ Save current filter…
              </button>
              {hasActiveFilter && (
                <button onClick={() => setFilter(EMPTY_FILTER)}
                  style={{ fontFamily: T.body, fontSize: 12, textAlign: "left",
                    padding: "7px 8px", borderRadius: 6, border: "none", cursor: "pointer",
                    color: T.textMuted, background: "none" }}>
                  ✕ Clear filter
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

const KanbanPage = () => {
  const { canEdit } = useAuth();
  const [tickets,       setTickets]       = useState([]);
  const [testItems,     setTestItems]     = useState([]);
  const [users,         setUsers]         = useState([]);
  const [teams,         setTeams]         = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [modal,         setModal]         = useState(null);
  const [testModal,     setTestModal]     = useState(null);
  const [testPreviewId, setTestPreviewId] = useState(null);
  const [filter,        setFilter]        = useState({ priority: "", section: "", type: "", assigneeId: "", versionId: "", label: "", q: "" });
  const [savedFilters,  setSavedFilters]  = useState([]);
  const [filtersOpen,   setFiltersOpen]   = useState(false);
  const [allLabels,     setAllLabels]     = useState([]);
  const [dragId,        setDragId]        = useState(null);
  const [previewId,     setPreviewId]     = useState(null);
  const [showReleased,  setShowReleased]  = useState(true);
  const [backlogOpen,   setBacklogOpen]   = useState(false);
  const [boardView,     setBoardView]     = useState("board"); // "board" | "roadmap" | "sprint" | "tests" | "reports"
  const [boardMgr,      setBoardMgr]      = useState(false);
  const [bulkMode,      setBulkMode]      = useState(false);
  const [selectedIds,   setSelectedIds]   = useState(() => new Set());

  // Multi-project support
  const [projects,       setProjects]       = useState([]);
  const [currentProject, setCurrentProject] = useState(null);
  const [columns,        setColumns]        = useState([]);
  const [versions,       setVersions]       = useState([]);
  const [sprints,        setSprints]        = useState([]);
  const [activeSprintId, setActiveSprintId] = useState(null);

  // colNames: ordered column names for the current project (or fallback to hardcoded)
  const colNames = columns.length > 0 ? columns.map(c => c.name) : COLUMNS;

  const [diagramTicket,      setDiagramTicket]      = useState(null);
  const [coverageTicket,     setCoverageTicket]     = useState(null);
  const [testOutcomePending, setTestOutcomePending] = useState(null);

  const [wipLimits, setWipLimits] = useState(() => {
    try { return JSON.parse(localStorage.getItem("athena_wip_limits") || "{}"); }
    catch { return {}; }
  });

  const setWipLimit = (col, limit) => {
    setWipLimits(prev => {
      const next = { ...prev };
      if (limit == null) delete next[col]; else next[col] = limit;
      localStorage.setItem("athena_wip_limits", JSON.stringify(next));
      return next;
    });
  };

  const preview     = previewId     ? tickets.find(t => t.id === previewId) ?? null : null;
  const testPreview = testPreviewId ? testItems.find(t => t.id === testPreviewId) ?? null : null;

  const loadBoard = useCallback(async (proj) => {
    setLoading(true);
    const safe = p => p.catch(() => []);
    const [tix, tst, cols, vers, sprs, lbls] = await Promise.all([
      safe(api.tickets.list(proj ? { projectId: proj.id } : {})),
      safe(api.testItems.list(proj ? { projectId: proj.id } : {})),
      proj ? safe(api.kbColumns.list(proj.id))  : Promise.resolve([]),
      proj ? safe(api.kbVersions.list(proj.id)) : Promise.resolve([]),
      proj ? safe(api.sprints.list(proj.id))    : Promise.resolve([]),
      safe(api.labels.list()),
    ]);
    setTickets(tix);
    setTestItems(tst);
    setColumns(cols);
    setVersions(vers);
    setSprints(sprs);
    setAllLabels(lbls);
    setLoading(false);
  }, []);

  const load = useCallback(async () => {
    try {
      const projs = await api.kbProjects.list();
      setProjects(projs);
      const proj = projs[0] || null;
      if (proj && !currentProject) setCurrentProject(proj);
      await loadBoard(proj || currentProject);
    } catch {
      await loadBoard(null);
    }
  }, [currentProject, loadBoard]);

  const switchProject = async proj => {
    setCurrentProject(proj);
    exitBulkMode();
    await loadBoard(proj);
  };

  useEffect(() => {
    load();
    api.users.list().then(setUsers).catch(() => {});
    api.teams.list().then(setTeams).catch(() => {});
    api.savedFilters.list("ticket").then(setSavedFilters).catch(() => {});
  }, []);

  const byStatus = status => {
    let list = tickets.filter(t => t.status === status);
    if (filter.priority)   list = list.filter(t => t.priority   === filter.priority);
    if (filter.section)    list = list.filter(t => t.section    === filter.section);
    if (filter.type)       list = list.filter(t => t.type       === filter.type);
    if (filter.assigneeId) list = list.filter(t => t.assigneeId === filter.assigneeId);
    if (filter.versionId)  list = list.filter(t => t.versionId  === filter.versionId);
    if (filter.label)      list = list.filter(t => (t.labels || []).includes(filter.label));
    if (filter.q) { const q = filter.q.trim().toLowerCase(); list = list.filter(t => t.id.toLowerCase().includes(q) || t.title.toLowerCase().includes(q)); }
    return list.sort((a, b) => a.position - b.position);
  };

  const handleExportCSV = () => {
    const rows = colNames.flatMap(byStatus).map(t => ({
      ID: t.id, Title: t.title, Type: t.type, Status: t.status, Priority: t.priority,
      Assignee: t.assigneeName || "", StoryPoints: t.storyPoints ?? "", DueDate: t.dueDate || "",
    }));
    if (rows.length === 0) { toast.error("Nothing to export — the current view is empty"); return; }
    downloadCSV(`${currentProject?.key || "athena"}-tickets.csv`, rows);
  };

  // Shared helper — executes a cross-column move, persisting testNotes when supplied.
  const commitMove = async (ticket, newStatus, testNotes = undefined) => {
    const colCards = tickets
      .filter(t => t.status === newStatus)
      .sort((a, b) => a.position - b.position);
    const newPos  = colCards.length > 0 ? colCards[colCards.length - 1].position + 1 : 0;
    const updated = {
      ...ticket,
      status:    newStatus,
      position:  newPos,
      // Only overwrite testNotes when we have a value to write (undefined = leave existing).
      ...(testNotes !== undefined ? { testNotes } : {}),
    };
    setTickets(prev => prev.map(t => t.id === ticket.id ? updated : t));
    await api.tickets.update(ticket.id, updated);
  };

  const handleDrop = async (ticketId, newStatus, targetId, side) => {
    const dragged = tickets.find(t => t.id === ticketId);
    if (!dragged) return;
    setDragId(null);

    // ── Cross-column move ──────────────────────────────────────────────────────
    if (dragged.status !== newStatus) {
      // Gate: leaving "In Testing" → show outcome modal instead of moving directly.
      if (dragged.status === "In Testing" &&
          (newStatus === "Ready to Deploy" || newStatus === "Testing Failed")) {
        setTestOutcomePending(dragged);
        return;
      }
      await commitMove(dragged, newStatus);
      return;
    }

    // ── Same-column reorder ────────────────────────────────────────────────────
    const col = tickets
      .filter(t => t.status === newStatus)
      .sort((a, b) => a.position - b.position);

    // Remove dragged card from its current position
    const without = col.filter(t => t.id !== ticketId);

    // Find insertion index
    let insertAt = without.length; // default: end
    if (targetId) {
      const targetIdx = without.findIndex(t => t.id === targetId);
      if (targetIdx !== -1) insertAt = side === "before" ? targetIdx : targetIdx + 1;
    }

    // Rebuild column order
    const reordered = [...without];
    reordered.splice(insertAt, 0, dragged);

    // Assign sequential positions
    const withPositions = reordered.map((t, i) => ({ ...t, position: i }));

    // Optimistic update
    setTickets(prev => {
      const other = prev.filter(t => t.status !== newStatus);
      return [...other, ...withPositions];
    });

    // Persist only changed positions
    const toSave = withPositions.filter(t => {
      const original = tickets.find(x => x.id === t.id);
      return original?.position !== t.position;
    });
    await Promise.all(toSave.map(t => api.tickets.update(t.id, t)));
  };

  const handleMove = async (ticket, newStatus) => {
    if (ticket.status === "In Testing" &&
        (newStatus === "Ready to Deploy" || newStatus === "Testing Failed")) {
      setTestOutcomePending(ticket);
      return;
    }
    await commitMove(ticket, newStatus);
  };

  const handleDelete = async id => {
    await api.tickets.remove(id);
    setTickets(p => p.filter(t => t.id !== id));
    setPreviewId(p => p === id ? null : p);
  };

  const toggleBulkSelect = id => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitBulkMode = () => { setBulkMode(false); setSelectedIds(new Set()); };

  const handleBulkApply = async patch => {
    const ids = Array.from(selectedIds);
    const updated = await api.tickets.bulkUpdate(ids, patch);
    const byId = Object.fromEntries(updated.map(t => [t.id, t]));
    setTickets(prev => prev.map(t => byId[t.id] || t));
    toast.success(`Updated ${ids.length} ticket${ids.length === 1 ? "" : "s"}`);
    setSelectedIds(new Set());
  };

  // Cascade an Epic's assignee/team down to its children — always explicit and
  // confirmed via ApplyToChildrenModal beforehand, never automatic (TKT-4N18SL).
  const handleApplyToChildren = async (epic, epicChildren) => {
    const ids = epicChildren.map(c => c.id);
    if (ids.length === 0) return;
    const updated = await api.tickets.bulkUpdate(ids, { assigneeId: epic.assigneeId || null, teamId: epic.teamId || null });
    const byId = Object.fromEntries(updated.map(t => [t.id, t]));
    setTickets(prev => prev.map(t => byId[t.id] || t));
    toast.success(`Applied to ${ids.length} child ticket${ids.length === 1 ? "" : "s"}`);
  };

  const handleTestOutcome = async ({ newStatus, testNotes }) => {
    const ticket = testOutcomePending;
    setTestOutcomePending(null);
    if (!ticket) return;
    await commitMove(ticket, newStatus, testNotes);
  };

  const handleSave = async form => {
    const payload = {
      ...form,
      assigneeId: form.assigneeId || null,
      teamId:     form.teamId     || null,
      startDate:  form.startDate  || null,
      dueDate:    form.dueDate    || null,
      parentId:   form.parentId   || null,
      testNotes:  form.testNotes  || null,
      versionId:  form.versionId  || null,
      sprintId:   form.sprintId   || null,
      projectId:  currentProject?.id || null,
    };
    if (modal === "add" || modal === "add-backlog") {
      await api.tickets.create(payload);
    } else {
      await api.tickets.update(modal.id, { ...modal, ...payload });
    }
    setModal(null);
    load();
  };

  const handleTestItemSave = async form => {
    const payload = {
      ...form,
      assigneeId: form.assigneeId || null,
      dueDate:    form.dueDate    || null,
      parentId:   form.parentId   || null,
      testNotes:  form.testNotes  || null,
      versionId:  form.versionId  || null,
      projectId:  currentProject?.id || null,
    };
    if (testModal?._action === "add") {
      await api.testItems.create(payload);
    } else {
      await api.testItems.update(testModal.id, { ...testModal, ...payload });
    }
    setTestModal(null);
    load();
  };

  const handleTestItemDelete = async id => {
    await api.testItems.remove(id);
    setTestItems(p => p.filter(t => t.id !== id));
    setTestPreviewId(p => p === id ? null : p);
  };

  const totalOpen      = tickets.filter(t => !["Released", "Testing Failed", "Ready to Deploy", "Done"].includes(t.status)).length;
  const backlogTickets = tickets.filter(t => t.status === "Backlog").sort((a, b) => a.position - b.position);

  // Column accent colours: prefer colour from kb_columns, fall back to hardcoded map
  const colAccentMap = columns.length > 0
    ? Object.fromEntries(columns.map(c => [c.name, c.color]))
    : COL_ACCENT;

  const VIEW_BTN = id => ({
    fontFamily: T.body, fontSize: 12, fontWeight: boardView === id ? 700 : 400,
    padding: "5px 12px", borderRadius: 6, cursor: "pointer", border: "none",
    background: boardView === id ? T.accent : T.surface,
    color:      boardView === id ? "#fff"   : T.textMuted,
    transition: "background .12s, color .12s",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, height: "100%" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div>
            <h1 style={{ fontFamily: T.head, fontSize: 22, fontWeight: 800, color: T.text, margin: 0 }}>
              {currentProject ? currentProject.name : "Integration Board"}
            </h1>
            <p style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, margin: "2px 0 0" }}>
              {tickets.length} ticket{tickets.length !== 1 ? "s" : ""} · {totalOpen} open
              {dragId && <span style={{ fontStyle: "italic" }}> · dragging…</span>}
            </p>
          </div>
          {/* Project switcher */}
          {projects.length > 1 && (
            <select value={currentProject?.id || ""}
              onChange={e => { const p = projects.find(x => x.id === e.target.value); if (p) switchProject(p); }}
              style={{ ...inputBase, fontFamily: T.body, fontSize: 12, cursor: "pointer", width: 160 }}>
              {projects.map(p => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
            </select>
          )}
          {/* View tabs */}
          <div style={{ display: "flex", gap: 4, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: 3 }}>
            <button type="button" onClick={() => setBoardView("board")}  style={VIEW_BTN("board")}>📋 Board</button>
            <button type="button" onClick={() => setBoardView("roadmap")} style={VIEW_BTN("roadmap")}>🗺 Roadmap</button>
            {sprints.length > 0 && (
              <button type="button" onClick={() => setBoardView("sprint")} style={VIEW_BTN("sprint")}>🏃 Sprint</button>
            )}
            <button type="button" onClick={() => setBoardView("tests")}  style={VIEW_BTN("tests")}>🧪 Tests</button>
            <button type="button" onClick={() => setBoardView("reports")} style={VIEW_BTN("reports")}>📊 Reports</button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Filters — only show on Board view */}
          {boardView === "board" && (
            <>
              <select value={filter.type} onChange={e => setFilter(f => ({ ...f, type: e.target.value }))}
                style={{ ...inputBase, fontFamily: T.body, fontSize: 12, width: 130, cursor: "pointer" }}>
                <option value="">All types</option>
                {TYPES.map(t => <option key={t} value={t}>{TYPE_ICON[t]} {t}</option>)}
              </select>
              <select value={filter.priority} onChange={e => setFilter(f => ({ ...f, priority: e.target.value }))}
                style={{ ...inputBase, fontFamily: T.body, fontSize: 12, width: 120, cursor: "pointer" }}>
                <option value="">All priorities</option>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              {versions.length > 0 && (
                <select value={filter.versionId} onChange={e => setFilter(f => ({ ...f, versionId: e.target.value }))}
                  style={{ ...inputBase, fontFamily: T.body, fontSize: 12, width: 140, cursor: "pointer" }}>
                  <option value="">All versions</option>
                  {versions.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              )}
              {users.length > 0 && (
                <select value={filter.assigneeId} onChange={e => setFilter(f => ({ ...f, assigneeId: e.target.value }))}
                  style={{ ...inputBase, fontFamily: T.body, fontSize: 12, width: 140, cursor: "pointer" }}>
                  <option value="">All assignees</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              )}
              {allLabels.length > 0 && (
                <select value={filter.label} onChange={e => setFilter(f => ({ ...f, label: e.target.value }))}
                  style={{ ...inputBase, fontFamily: T.body, fontSize: 12, width: 130, cursor: "pointer" }}>
                  <option value="">All labels</option>
                  {allLabels.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              )}
              <input value={filter.q} onChange={e => setFilter(f => ({ ...f, q: e.target.value }))}
                placeholder="Search title or ID…"
                style={{ ...inputBase, fontFamily: T.body, fontSize: 12, width: 150 }} />
              <SavedFiltersMenu
                open={filtersOpen} setOpen={setFiltersOpen}
                filter={filter} setFilter={setFilter}
                savedFilters={savedFilters} setSavedFilters={setSavedFilters}
              />
              <button type="button" onClick={() => setBacklogOpen(true)}
                style={{ fontFamily: T.body, fontSize: 12, cursor: "pointer",
                  padding: "5px 12px", borderRadius: 7, display: "flex", alignItems: "center", gap: 6,
                  border: `1px solid ${backlogTickets.length > 0 ? T.accent + "88" : T.border}`,
                  background: backlogTickets.length > 0 ? T.accent + "10" : "none",
                  color: backlogTickets.length > 0 ? T.accent : T.textMuted, transition: "all .15s" }}>
                Backlog
                {backlogTickets.length > 0 && (
                  <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700, background: T.accent,
                    color: "#fff", borderRadius: 10, padding: "0 6px", lineHeight: "16px" }}>
                    {backlogTickets.length}
                  </span>
                )}
              </button>
              <button type="button" onClick={() => setShowReleased(v => !v)}
                style={{ fontFamily: T.body, fontSize: 12, cursor: "pointer",
                  padding: "5px 12px", borderRadius: 7,
                  border: `1px solid ${showReleased ? "#8b5cf6" : T.border}`,
                  background: showReleased ? "rgba(139,92,246,.12)" : "none",
                  color: showReleased ? "#8b5cf6" : T.textMuted, transition: "all .15s" }}>
                {showReleased ? "● Released" : "○ Released"}
              </button>
            </>
          )}
          {canEdit && boardView === "board" && (
            <button type="button" onClick={() => bulkMode ? exitBulkMode() : setBulkMode(true)}
              style={{ fontFamily: T.body, fontSize: 12, cursor: "pointer",
                padding: "5px 12px", borderRadius: 7,
                border: `1px solid ${bulkMode ? T.accent : T.border}`,
                background: bulkMode ? T.accent + "10" : "none",
                color: bulkMode ? T.accent : T.textMuted, transition: "all .15s" }}>
              {bulkMode ? `☑ Select (${selectedIds.size})` : "☐ Select"}
            </button>
          )}
          {boardView === "board" && (
            <button type="button" onClick={handleExportCSV} title="Export the current filtered view as CSV"
              style={{ fontFamily: T.body, fontSize: 12, padding: "5px 11px", borderRadius: 7,
                background: "none", border: `1px solid ${T.border}`, color: T.textMuted,
                cursor: "pointer", transition: "color .12s, border-color .12s" }}
              onMouseEnter={e => { e.currentTarget.style.color = T.text; e.currentTarget.style.borderColor = T.text; }}
              onMouseLeave={e => { e.currentTarget.style.color = T.textMuted; e.currentTarget.style.borderColor = T.border; }}>
              ⬇ Export
            </button>
          )}
          {canEdit && (
            <button type="button" onClick={() => setBoardMgr(true)}
              title="Board settings — columns, versions, sprints, baselines"
              style={{ fontFamily: T.body, fontSize: 12, padding: "5px 11px", borderRadius: 7,
                background: "none", border: `1px solid ${T.border}`, color: T.textMuted,
                cursor: "pointer", transition: "color .12s, border-color .12s" }}
              onMouseEnter={e => { e.currentTarget.style.color = T.text; e.currentTarget.style.borderColor = T.text; }}
              onMouseLeave={e => { e.currentTarget.style.color = T.textMuted; e.currentTarget.style.borderColor = T.border; }}>
              ⚙ Board
            </button>
          )}
          {canEdit && (
            <Btn onClick={() => boardView === "tests"
              ? setTestModal({ _action: "add", type: "Test Plan" })
              : setModal("add")} size="sm">
              {boardView === "tests" ? "＋ Test Plan" : "＋ Add Ticket"}
            </Btn>
          )}
        </div>
      </div>

      {/* Views */}
      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, padding: 40 }}>
          <Spinner size="md" label="Loading board…" />
        </div>
      ) : boardView === "roadmap" ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <RoadmapView
            tickets={tickets}
            versions={versions}
            onPreview={t => setPreviewId(t.id)}
          />
        </div>
      ) : boardView === "sprint" ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <SprintBoardView
            sprints={sprints}
            activeSprintId={activeSprintId}
            setActiveSprintId={setActiveSprintId}
            tickets={tickets}
            onPreview={t => setPreviewId(t.id)}
          />
        </div>
      ) : boardView === "reports" ? (
        <ReportsView project={currentProject} tickets={tickets} columns={columns} />
      ) : boardView === "tests" ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 14 }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <TestSuiteView
              tickets={testItems}
              canEdit={canEdit}
              onPreview={t => setTestPreviewId(t.id)}
              onEdit={t => setTestModal(t)}
              onAdd={init => setTestModal({ _action: "add", ...init })}
              onExecute={async (id, status) => {
                const t = testItems.find(x => x.id === id);
                if (!t) return;
                await api.testItems.update(id, { ...t, status });
                load();
              }}
              onMoveCase={async (id, newParentId) => {
                const t = testItems.find(x => x.id === id);
                if (!t) return;
                await api.testItems.update(id, { ...t, parentId: newParentId });
                load();
              }}
            />
          </div>
          {testPreview && (
            <TestItemPreview
              item={testPreview}
              testItems={testItems}
              tickets={tickets}
              onClose={() => setTestPreviewId(null)}
              onEdit={t => setTestModal(t)}
              onDelete={handleTestItemDelete}
              onPreview={t => setTestPreviewId(t.id)}
            />
          )}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 14, flex: 1, minHeight: 0 }}>
          {/* Columns */}
          <div
            style={{ display: "flex", gap: 14, alignItems: "flex-start", overflowX: "auto", flex: 1, paddingBottom: 8 }}
            onDragEnd={() => setDragId(null)}
          >
            {colNames
              .filter(col => showReleased || col !== "Released")
              .map((col) => (
                <KanbanColumn
                  key={col} status={col} colIndex={colNames.indexOf(col)}
                  columns={colNames}
                  colAccent={colAccentMap[col]}
                  tickets={byStatus(col)}
                  allTickets={tickets}
                  onEdit={t => setModal(t)}
                  onDelete={handleDelete}
                  onMove={handleMove}
                  onDrop={handleDrop}
                  onPreview={t => setPreviewId(p => p === t.id ? null : t.id)}
                  onDiagram={t => setDiagramTicket(t)}
                  onCoverage={t => setCoverageTicket(t)}
                  dragId={dragId}
                  previewId={previewId}
                  wipLimit={wipLimits[col] ?? null}
                  onSetWipLimit={limit => setWipLimit(col, limit)}
                  bulkMode={bulkMode}
                  selectedIds={selectedIds}
                  onToggleBulkSelect={toggleBulkSelect}
                />
              ))}
          </div>

          {bulkMode && selectedIds.size > 0 && (
            <BulkActionBar
              count={selectedIds.size}
              users={users}
              versions={versions}
              columns={colNames}
              onApply={handleBulkApply}
              onClear={() => setSelectedIds(new Set())}
            />
          )}

          {/* Preview panel */}
          {preview && (
            <TicketPreview
              ticket={preview}
              colIndex={colNames.indexOf(preview.status)}
              columns={colNames}
              tickets={tickets}
              testItems={testItems}
              users={users}
              teams={teams}
              onClose={() => setPreviewId(null)}
              onEdit={() => setModal(preview)}
              onMove={handleMove}
              onDelete={handleDelete}
              onPreview={t => setPreviewId(t.id)}
              onDiagram={t => setDiagramTicket(t)}
              onCoverage={t => setCoverageTicket(t)}
              onLabelsChanged={load}
              onCascade={handleApplyToChildren}
              onTicketUpdated={updated => setTickets(prev => prev.map(t => t.id === updated.id ? updated : t))}
            />
          )}
        </div>
      )}

      {backlogOpen && (
        <BacklogDrawer
          tickets={backlogTickets}
          onClose={() => setBacklogOpen(false)}
          onPromote={async t => { await commitMove(t, colNames[0] || "Ready"); load(); }}
          onEdit={t => { setBacklogOpen(false); setModal(t); }}
          onAdd={() => { setBacklogOpen(false); setModal("add-backlog"); }}
        />
      )}

      {modal && (
        <Modal
          title={modal === "add" ? "New Ticket"
            : modal === "add-backlog" ? "New Ticket"
            : modal?._action === "add" ? `New ${modal.type || "Ticket"}`
            : `Edit — ${modal.id}`}
          onClose={() => setModal(null)} width={560}
        >
          <TicketModal
            init={modal === "add" ? {}
              : modal === "add-backlog" ? { status: "Backlog" }
              : modal?._action === "add" ? (({ _action, ...rest }) => rest)(modal)
              : modal}
            tickets={tickets}
            testItems={testItems}
            users={users}
            teams={teams}
            columns={colNames}
            versions={versions}
            sprints={sprints}
            onSave={handleSave}
            onCancel={() => setModal(null)}
            onLabelsChanged={load}
          />
        </Modal>
      )}

      {testModal && (
        <Modal
          title={testModal?._action === "add" ? `New ${testModal.type || "Test Item"}` : `Edit — ${testModal.id}`}
          onClose={() => setTestModal(null)} width={560}
        >
          <TestItemModal
            init={testModal?._action === "add" ? (({ _action, ...rest }) => rest)(testModal) : testModal}
            testItems={testItems}
            tickets={tickets}
            users={users}
            versions={versions}
            onSave={handleTestItemSave}
            onCancel={() => setTestModal(null)}
          />
        </Modal>
      )}

      {boardMgr && (
        <BoardManagerModal
          currentProject={currentProject}
          columns={columns}
          versions={versions}
          sprints={sprints}
          tickets={tickets}
          onClose={() => setBoardMgr(false)}
          onRefresh={load}
        />
      )}

      {coverageTicket && (
        <EpicCoverageModal
          ticket={coverageTicket}
          allTickets={tickets}
          onClose={() => setCoverageTicket(null)}
          onPreview={t => { setCoverageTicket(null); setPreviewId(t.id); }}
        />
      )}

      {diagramTicket && (
        <TicketDiagramModal
          ticket={diagramTicket}
          allTickets={tickets}
          onClose={() => setDiagramTicket(null)}
        />
      )}

      {testOutcomePending && (
        <TestOutcomeModal
          ticket={testOutcomePending}
          onConfirm={handleTestOutcome}
          onCancel={() => setTestOutcomePending(null)}
        />
      )}
    </div>
  );
};

export default KanbanPage;