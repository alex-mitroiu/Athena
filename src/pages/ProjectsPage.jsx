import { useState, useEffect, useRef } from "react";
import { T } from "../tokens";
import { api } from "../api";
import { toast } from "../toast";
import { Modal, ConfirmModal } from "../components/primitives/Modal";
import Btn from "../components/primitives/Btn";
import Spinner from "../components/primitives/Spinner";

// ─── Project admin page ────────────────────────────────────────────────────────
// Moved out of the Kanban board's Board Settings modal — Users and Teams already
// live on dedicated admin pages, so Projects (create/edit/lead/access) belongs
// here too. Columns/Versions/Sprints/Baselines stay in Board Settings since
// those are day-to-day working config people adjust while actively using the
// board, not admin setup.

const swatch = color => (
  <div style={{ width: 14, height: 14, borderRadius: 4, background: color, flexShrink: 0 }} />
);

// ─── Create / edit project modal ───────────────────────────────────────────────

const ProjectFormModal = ({ project: existing, users, onSave, onClose }) => {
  const isNew = !existing;

  // Recomputed on every render (not module-level constants) so they re-read T
  // fresh on a theme switch instead of freezing whatever was active on load.
  const fieldLabel = {
    display: "block", fontFamily: T.body, fontSize: 11, fontWeight: 600,
    color: T.textMuted, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5,
  };
  const inputStyle = {
    width: "100%", padding: "7px 11px", borderRadius: 7,
    border: `1px solid ${T.border}`, background: T.bg,
    fontFamily: T.body, fontSize: 12, color: T.text,
    outline: "none", boxSizing: "border-box",
  };
  const [name,        setName]        = useState(existing?.name ?? "");
  const [key,         setKey]         = useState(existing?.key ?? "");
  const [color,       setColor]       = useState(existing?.color ?? "#6366f1");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [leadUserId,  setLeadUserId]  = useState(existing?.leadUserId ?? "");
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState("");

  const handleSave = async () => {
    if (!name.trim()) return setError("Name is required");
    setError(""); setSaving(true);
    try {
      await onSave({ name: name.trim(), key: key.trim().toUpperCase(), color, description, leadUserId: leadUserId || null });
      onClose();
    } catch (e) {
      setError(e.message || "Save failed");
    } finally { setSaving(false); }
  };

  return (
    <Modal title={isNew ? "New Project" : "Edit Project"} onClose={onClose} width={480}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error && (
          <div style={{ padding: "9px 13px", borderRadius: 7, background: T.danger + "18",
            border: `1px solid ${T.danger}44`, fontFamily: T.body, fontSize: 13, color: T.danger }}>
            {error}
          </div>
        )}
        <div>
          <label style={fieldLabel}>Project Name</label>
          <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} autoFocus
            placeholder="e.g. Athena Platform" />
        </div>
        <div>
          <label style={fieldLabel}>Key (short code)</label>
          <input value={key} onChange={e => setKey(e.target.value.toUpperCase().slice(0, 6))} style={inputStyle}
            placeholder="e.g. ATH" maxLength={6} />
        </div>
        <div>
          <label style={fieldLabel}>Color</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="color" value={color} onChange={e => setColor(e.target.value)}
              style={{ width: 36, height: 30, borderRadius: 5, border: `1px solid ${T.border}`, padding: 2, cursor: "pointer", background: "none" }} />
            <span style={{ fontFamily: T.mono, fontSize: 12, color: T.textMuted }}>{color}</span>
          </div>
        </div>
        <div>
          <label style={fieldLabel}>Description</label>
          <input value={description} onChange={e => setDescription(e.target.value)} style={inputStyle} placeholder="Optional" />
        </div>
        <div>
          <label style={fieldLabel}>Project Lead</label>
          <select value={leadUserId} onChange={e => setLeadUserId(e.target.value)}
            style={{ ...inputStyle, cursor: "pointer" }}>
            <option value="">No lead assigned</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <div style={{ fontFamily: T.body, fontSize: 11, color: T.textMuted, marginTop: 5 }}>
            A designation only — the lead's actual permissions still come from their role.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>Cancel</Btn>
          <Btn variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : isNew ? "Create Project" : "Save Changes"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
};

// ─── Members (access control) modal ────────────────────────────────────────────
// Binary membership only — capabilities within a project still come from a
// user's existing global role. This only decides which projects they can see.

const ProjectMembersModal = ({ projectId, projectName, onClose }) => {
  const [allUsers, setAllUsers] = useState([]);
  const [members,  setMembers]  = useState(null); // null = loading
  const [busyId,   setBusyId]   = useState(null);

  const load = () => api.kbProjects.members(projectId).then(setMembers).catch(() => setMembers([]));
  useEffect(() => {
    api.users.list().then(setAllUsers).catch(() => {});
    load();
  }, [projectId]);

  const memberIds = new Set((members || []).map(m => m.userId));

  const toggle = async user => {
    setBusyId(user.id);
    try {
      if (memberIds.has(user.id)) await api.kbProjects.removeMember(projectId, user.id);
      else await api.kbProjects.addMember(projectId, user.id);
      await load();
    } catch (e) { toast.error(e.message); }
    finally { setBusyId(null); }
  };

  return (
    <Modal title={`👥 Members — ${projectName}`} onClose={onClose} width={440}>
      <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
        Only members can see this project at all. A member's actual permissions within it
        still come from their admin/operator/viewer role — this just controls visibility.
      </div>
      {members === null ? (
        <div style={{ padding: "20px 0", textAlign: "center" }}><Spinner size="sm" /></div>
      ) : (
        <div style={{ maxHeight: 320, overflowY: "auto", border: `1px solid ${T.border}`, borderRadius: 8 }}>
          {allUsers.map(u => {
            const checked = memberIds.has(u.id);
            return (
              <label key={u.id} onClick={() => !busyId && toggle(u)} style={{
                display: "flex", alignItems: "center", gap: 9, padding: "8px 12px",
                cursor: busyId ? "default" : "pointer", borderBottom: `1px solid ${T.border}`,
                background: checked ? T.accent + "10" : "transparent", opacity: busyId === u.id ? 0.5 : 1 }}>
                <input type="checkbox" readOnly checked={checked} style={{ width: 14, height: 14, cursor: "pointer" }} />
                <div style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                  background: T.accent + "18", border: `1px solid ${T.accent}44`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: T.mono, fontSize: 10, fontWeight: 700, color: T.accent }}>
                  {u.name?.[0]?.toUpperCase() ?? "?"}
                </div>
                <span style={{ fontFamily: T.body, fontSize: 13, color: T.text }}>{u.name}</span>
                <span style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted, marginLeft: "auto" }}>{u.email}</span>
              </label>
            );
          })}
        </div>
      )}
    </Modal>
  );
};

// ─── Workflow (TKT-188OHK) ──────────────────────────────────────────────────────
// Named transitions between statuses, an "Any"-source wildcard, and a category
// (To Do / In Progress / Done) per status — replacing the old hardcoded
// DONE_STATUSES name-matching that broke silently if a column was renamed. A
// project with zero transitions has no configured workflow yet, so every move
// stays allowed (enforced server-side) until an admin defines at least one.
// Lives here (not the Kanban board's Board Settings) because it's structural,
// rarely-changed project config — the same tier as Project Lead/Members, not
// day-to-day working config like Columns/Versions/Sprints.

const WORKFLOW_CATEGORIES = ["To Do", "In Progress", "Done"];

const wfInputStyle = { padding: "6px 10px", borderRadius: 6, border: "1px solid", fontFamily: "inherit", fontSize: 12.5, outline: "none" };

// ─── Transition requirements ("custom behaviors", TKT-*) ───────────────────
// A transition can optionally demand a link or a field be set before it's
// allowed to fire — e.g. "moving to Test Failed requires a linked ticket" or
// "moving to Released requires a Version already set."
const RULE_LINK_TYPES = ["Relates to", "Blocks", "Duplicates", "Implements", "Satisfies"];
const RULE_FIELD_OPTIONS = [
  { value: "versionId",   label: "Version" },
  { value: "assigneeId",  label: "Assignee" },
  { value: "storyPoints", label: "Story Points" },
  { value: "dueDate",     label: "Due Date" },
  { value: "teamId",      label: "Team" },
  { value: "sprintId",    label: "Sprint" },
];
const ruleSummary = t => {
  if (!t.ruleType) return "";
  if (t.ruleType === "require_link")
    return t.ruleConfig?.linkType ? `Requires a "${t.ruleConfig.linkType}" link` : "Requires a linked ticket";
  if (t.ruleType === "require_field")
    return `Requires ${RULE_FIELD_OPTIONS.find(f => f.value === t.ruleConfig?.field)?.label || t.ruleConfig?.field} to be set`;
  return "";
};

const WorkflowInspector = ({ status, columns, transitions, onClose, onCategoryChange, onDeleteTransition, onDeleteStatus, onEditTransition }) => {
  const col = columns.find(c => c.name === status);
  const incoming = transitions.filter(t => t.toStatus === status);
  const outgoing = transitions.filter(t => t.fromStatus === status);
  const label = { fontFamily: T.mono, fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 };

  const TransitionRow = ({ t, text }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 9px",
      borderRadius: 6, background: T.bg, marginBottom: 4, gap: 6 }}>
      <span style={{ fontFamily: T.body, fontSize: 12, color: T.text, display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
        {t.ruleType && <span title={ruleSummary(t)} style={{ flexShrink: 0 }}>🔒</span>}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
      </span>
      <span style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        <button onClick={() => onEditTransition(t)} title="Edit transition"
          style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 12, lineHeight: 1 }}
          onMouseEnter={e => e.currentTarget.style.color = T.accent}
          onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>✎</button>
        <button onClick={() => onDeleteTransition(t.id)} title="Delete transition"
          style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 13, lineHeight: 1 }}
          onMouseEnter={e => e.currentTarget.style.color = T.danger}
          onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>×</button>
      </span>
    </div>
  );

  return (
    <div style={{ width: 250, flexShrink: 0, borderLeft: `1px solid ${T.border}`, padding: 16,
      display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", background: T.surface }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontFamily: T.head, fontSize: 14, fontWeight: 700, color: T.text }}>Status</div>
        <button onClick={onClose} title="Collapse" style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, fontSize: 15 }}>›</button>
      </div>
      <div>
        <div style={label}>Name</div>
        <div style={{ fontFamily: T.body, fontSize: 14, fontWeight: 600, color: T.text }}>{status}</div>
      </div>
      <div>
        <div style={label}>Category</div>
        <select value={col?.category || "In Progress"} onChange={e => onCategoryChange(col.id, e.target.value)}
          style={{ ...wfInputStyle, width: "100%", borderColor: T.border, background: T.bg, color: T.text, cursor: "pointer", boxSizing: "border-box" }}>
          {WORKFLOW_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <div style={label}>Incoming ({incoming.length})</div>
        {incoming.length === 0 && <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>None</div>}
        {incoming.map(t => <TransitionRow key={t.id} t={t} text={`${t.fromStatus || "Any"} → ${t.name}`} />)}
      </div>
      <div>
        <div style={label}>Outgoing ({outgoing.length})</div>
        {outgoing.length === 0 && <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>None</div>}
        {outgoing.map(t => <TransitionRow key={t.id} t={t} text={`${t.name} → ${t.toStatus}`} />)}
      </div>
      <div style={{ marginTop: "auto", paddingTop: 14, borderTop: `1px solid ${T.border}` }}>
        <button onClick={() => onDeleteStatus(status)}
          style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: `1px solid ${T.danger}44`,
            background: T.danger + "10", color: T.danger, fontFamily: T.body, fontSize: 12.5, cursor: "pointer" }}>
          Delete status
        </button>
      </div>
    </div>
  );
};

// mode="inspect" (default, Workflow tab): click a node to fold out its details;
// drag from a node's connector handle to another node to create a transition
// between them directly on the diagram ("connecting the dots").
// mode="select" (Boards tab): click toggles the node's membership in the board
// currently being edited; nodes with no transitions at all are disabled, tied
// directly to the shared workflow graph rather than a free-picked status list.
const WorkflowDiagram = ({ columns, transitions, onColumnUpdated, onCategoryChange, onDeleteTransition, onDeleteStatus,
                           mode = "inspect", selectedStatuses, ineligibleStatuses, onToggleStatus, onConnect, onEditTransition }) => {
  const [selected, setSelected] = useState(null);
  const [localPositions, setLocalPositions] = useState({});
  const [connecting, setConnecting] = useState(null); // { fromName, x, y } in SVG-local coords while dragging a connector
  const dragRef = useRef(null);
  const movedRef = useRef(false);
  const connectingRef = useRef(null);
  const svgRef = useRef(null);

  const CATEGORY_COLOR = { "To Do": T.textMuted, "In Progress": T.accent, Done: T.success };
  const NODE_W = 140, NODE_H = 36;

  const nodeFor = col => {
    const idx = columns.findIndex(c => c.id === col.id);
    if (localPositions[col.id]) return localPositions[col.id];
    if (col.diagramX != null && col.diagramY != null) return { x: col.diagramX, y: col.diagramY };
    return { x: 40 + idx * 190, y: 160 };
  };

  const svgPointFor = e => {
    const rect = svgRef.current.getBoundingClientRect();
    const scroller = svgRef.current.parentElement;
    return { x: e.clientX - rect.left + scroller.scrollLeft, y: e.clientY - rect.top + scroller.scrollTop };
  };

  const startDrag = (e, col) => {
    e.preventDefault();
    movedRef.current = false;
    const pos = nodeFor(col);
    dragRef.current = { colId: col.id, startX: e.clientX, startY: e.clientY, startNodeX: pos.x, startNodeY: pos.y };
  };

  const startConnect = (e, col) => {
    e.preventDefault();
    e.stopPropagation();
    const pt = svgPointFor(e);
    const start = { fromName: col.name, x: pt.x, y: pt.y };
    connectingRef.current = start;
    setConnecting(start);
  };

  useEffect(() => {
    const onMove = e => {
      if (connectingRef.current) {
        const pt = svgPointFor(e);
        const next = { ...connectingRef.current, x: pt.x, y: pt.y };
        connectingRef.current = next;
        setConnecting(next);
        return;
      }
      if (!dragRef.current) return;
      const { colId, startX, startY, startNodeX, startNodeY } = dragRef.current;
      if (Math.abs(e.clientX - startX) > 3 || Math.abs(e.clientY - startY) > 3) movedRef.current = true;
      const nx = Math.max(10, startNodeX + (e.clientX - startX));
      const ny = Math.max(10, startNodeY + (e.clientY - startY));
      setLocalPositions(p => ({ ...p, [colId]: { x: nx, y: ny } }));
    };
    const onUp = e => {
      if (connectingRef.current) {
        const fromName = connectingRef.current.fromName;
        connectingRef.current = null;
        setConnecting(null);
        const hit = document.elementsFromPoint(e.clientX, e.clientY)
          .map(el => el.closest?.("[data-wf-node]")).find(Boolean);
        const toName = hit?.getAttribute("data-wf-node");
        if (toName && toName !== fromName) onConnect?.(fromName, toName);
        return;
      }
      if (!dragRef.current) return;
      const { colId } = dragRef.current;
      dragRef.current = null;
      const pos = localPositions[colId];
      if (pos && movedRef.current) onColumnUpdated?.(colId, { diagramX: pos.x, diagramY: pos.y });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [localPositions, onColumnUpdated, onConnect]);

  const handleNodeClick = col => {
    // A connector-drag landing on this node fires this node's own onMouseUp
    // (bubbling before the global mouseup below sees it and clears the ref) —
    // suppress the plain-click behavior so dropping a connection doesn't also
    // pop open the inspector for the drop target.
    if (connectingRef.current) return;
    if (movedRef.current) return;
    if (mode === "select") {
      if (ineligibleStatuses?.has(col.name)) return;
      onToggleStatus?.(col.name);
    } else {
      setSelected(col.name);
    }
  };

  const W = Math.max(900, columns.length * 200);
  const H = 420;

  return (
    <div style={{ display: "flex", border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ flex: 1, minWidth: 0, overflow: "auto", background: T.bg }}>
        <svg ref={svgRef} width={W} height={H} style={{ display: "block" }}>
          <defs>
            <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={T.textMuted} />
            </marker>
          </defs>
          {transitions.filter(t => t.fromStatus).map(t => {
            const fromCol = columns.find(c => c.name === t.fromStatus);
            const toCol   = columns.find(c => c.name === t.toStatus);
            if (!fromCol || !toCol || fromCol.id === toCol.id) return null;
            const p1 = nodeFor(fromCol), p2 = nodeFor(toCol);
            const x1 = p1.x + NODE_W / 2, y1 = p1.y + NODE_H / 2;
            const x2 = p2.x + NODE_W / 2, y2 = p2.y + NODE_H / 2;
            const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
            const labelW = t.name.length * 6 + 10;
            return (
              <g key={t.id}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={T.textMuted} strokeWidth="1.5" markerEnd="url(#wf-arrow)" />
                <rect x={midX - labelW / 2} y={midY - 9} width={labelW} height={16} rx={3} fill={T.bg} />
                <text x={midX} y={midY + 3} textAnchor="middle" fontSize="10" fill={T.textMuted}>{t.name}</text>
              </g>
            );
          })}
          {connecting && (() => {
            const fromCol = columns.find(c => c.name === connecting.fromName);
            if (!fromCol) return null;
            const p = nodeFor(fromCol);
            return (
              <line x1={p.x + NODE_W} y1={p.y + NODE_H / 2} x2={connecting.x} y2={connecting.y}
                stroke={T.accent} strokeWidth="2" strokeDasharray="5,4" markerEnd="url(#wf-arrow)" />
            );
          })()}
          {columns.map(col => {
            const p = nodeFor(col);
            const anyIncoming = transitions.filter(t => !t.fromStatus && t.toStatus === col.name);
            const isIneligible = mode === "select" && ineligibleStatuses?.has(col.name);
            const isIncluded   = mode === "select" && selectedStatuses?.has(col.name);
            return (
              <g key={col.id} data-wf-node={col.name} transform={`translate(${p.x},${p.y})`} style={{ cursor: isIneligible ? "not-allowed" : "grab" }}
                opacity={isIneligible ? 0.4 : 1}
                onMouseDown={e => !isIneligible && startDrag(e, col)}
                onMouseUp={() => handleNodeClick(col)}>
                <rect width={NODE_W} height={NODE_H} rx={7}
                  fill={isIncluded ? (CATEGORY_COLOR[col.category] || T.accent) + "22" : T.surface}
                  stroke={selected === col.name ? T.accent : (CATEGORY_COLOR[col.category] || T.border)}
                  strokeWidth={selected === col.name || isIncluded ? 2.5 : 1.5}
                  strokeDasharray={isIneligible ? "4,3" : undefined} />
                <text x={NODE_W / 2} y={NODE_H / 2 + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill={T.text}>{col.name}</text>
                {isIncluded && (
                  <text x={NODE_W - 12} y={13} textAnchor="end" fontSize="12" fontWeight="700" fill={T.success}>✓</text>
                )}
                {mode === "inspect" && (
                  <circle cx={NODE_W} cy={NODE_H / 2} r="6" fill={T.accent} stroke={T.surface} strokeWidth="1.5"
                    style={{ cursor: "crosshair" }} onMouseDown={e => startConnect(e, col)}>
                    <title>Drag to another status to create a transition</title>
                  </circle>
                )}
                {anyIncoming.length > 0 && (
                  <g transform={`translate(${NODE_W},0)`}>
                    <title>{`Reachable from any status (${anyIncoming.map(t => t.name).join(", ")})`}</title>
                    <circle r="12" fill={T.bg} stroke={T.accent} strokeWidth="1.5" />
                    <text textAnchor="middle" y="3" fontSize="8" fontWeight="700" fill={T.accent}>Any</text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      {mode === "inspect" && selected && (
        <WorkflowInspector status={selected} columns={columns} transitions={transitions}
          onClose={() => setSelected(null)} onCategoryChange={onCategoryChange} onDeleteTransition={onDeleteTransition}
          onEditTransition={onEditTransition}
          onDeleteStatus={name => { onDeleteStatus?.(name); setSelected(null); }} />
      )}
    </div>
  );
};

const WorkflowTextView = ({ columns, transitions, onCategoryChange, onDeleteTransition, onDeleteStatus, onEditTransition }) => {
  const th = { textAlign: "left", padding: "7px 10px", fontFamily: T.mono, fontSize: 10, fontWeight: 700,
    color: T.textMuted, textTransform: "uppercase", letterSpacing: ".05em", borderBottom: `1px solid ${T.border}` };
  const td = { padding: "7px 10px", fontFamily: T.body, fontSize: 12.5, color: T.text, borderBottom: `1px solid ${T.border}` };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div>
        <div style={{ fontFamily: T.body, fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 8 }}>Statuses</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Status</th><th style={th}>Category</th><th style={th} /></tr></thead>
          <tbody>
            {columns.map(c => (
              <tr key={c.id}>
                <td style={td}>{c.name}</td>
                <td style={td}>
                  <select value={c.category || "In Progress"} onChange={e => onCategoryChange(c.id, e.target.value)}
                    style={{ ...wfInputStyle, borderColor: T.border, background: T.bg, color: T.text, cursor: "pointer" }}>
                    {WORKFLOW_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </td>
                <td style={{ ...td, textAlign: "right" }}>
                  <button onClick={() => onDeleteStatus(c.name)} title="Delete status"
                    style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 13 }}
                    onMouseEnter={e => e.currentTarget.style.color = T.danger}
                    onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <div style={{ fontFamily: T.body, fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 8 }}>Transitions</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Name</th><th style={th}>From</th><th style={th}>To</th><th style={th}>Requirement</th><th style={th} /></tr></thead>
          <tbody>
            {transitions.length === 0 ? (
              <tr><td colSpan={5} style={{ ...td, textAlign: "center", fontStyle: "italic", color: T.textMuted }}>
                No transitions yet — every status change is currently allowed.
              </td></tr>
            ) : transitions.map(t => (
              <tr key={t.id}>
                <td style={td}>{t.name}</td>
                <td style={td}>{t.fromStatus || "Any"}</td>
                <td style={td}>{t.toStatus}</td>
                <td style={{ ...td, color: t.ruleType ? T.text : T.textMuted, fontStyle: t.ruleType ? "normal" : "italic" }}>
                  {t.ruleType ? <>🔒 {ruleSummary(t)}</> : "None"}
                </td>
                <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                  <button onClick={() => onEditTransition(t)} title="Edit transition"
                    style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 12, marginRight: 8 }}
                    onMouseEnter={e => e.currentTarget.style.color = T.accent}
                    onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>✎</button>
                  <button onClick={() => onDeleteTransition(t.id)} title="Delete transition"
                    style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 13 }}
                    onMouseEnter={e => e.currentTarget.style.color = T.danger}
                    onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const EMPTY_TXN_FORM = { name: "", fromStatus: "", toStatus: "", ruleType: "", ruleLinkType: "", ruleField: "" };

const WorkflowTab = ({ project, columns, onRefresh }) => {
  const [transitions,    setTransitions]    = useState([]);
  const [subView,        setSubView]        = useState("diagram");
  const [addStatusOpen,  setAddStatusOpen]  = useState(false);
  const [newStatusName,  setNewStatusName]  = useState("");
  const [addTxnOpen,     setAddTxnOpen]     = useState(false);
  const [editingTxnId,   setEditingTxnId]   = useState(null); // transition id being edited, null = adding a new one
  const [form,           setForm]           = useState(EMPTY_TXN_FORM);
  const [saving,         setSaving]         = useState(false);
  const [deleteStatusTarget, setDeleteStatusTarget] = useState(null); // status name pending delete confirmation

  const load = () => api.workflowTransitions.list(project.id).then(setTransitions).catch(() => setTransitions([]));
  useEffect(() => { if (project) load(); }, [project?.id]);

  const handleCategoryChange = async (colId, category) => {
    try { await api.kbColumns.update(colId, { category }); onRefresh(); }
    catch (e) { toast.error(e.message); }
  };

  const handleColumnUpdated = async (colId, patch) => {
    try { await api.kbColumns.update(colId, patch); onRefresh(); }
    catch (e) { toast.error(e.message); }
  };

  const handleDeleteTransition = async id => {
    try { await api.workflowTransitions.remove(id); setTransitions(prev => prev.filter(t => t.id !== id)); }
    catch (e) { toast.error(e.message); }
  };

  const handleAddStatus = async () => {
    if (!newStatusName.trim()) return;
    setSaving(true);
    try {
      await api.kbColumns.create(project.id, { name: newStatusName.trim(), category: "In Progress" });
      setNewStatusName(""); setAddStatusOpen(false);
      onRefresh();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const handleSaveTransition = async () => {
    if (!form.name.trim() || !form.toStatus) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(), fromStatus: form.fromStatus || null, toStatus: form.toStatus,
        ruleType: form.ruleType || null,
        ruleConfig: form.ruleType === "require_link" ? { linkType: form.ruleLinkType || null }
                  : form.ruleType === "require_field" ? { field: form.ruleField || null }
                  : null,
      };
      if (editingTxnId) {
        const updated = await api.workflowTransitions.update(editingTxnId, payload);
        setTransitions(prev => prev.map(t => t.id === editingTxnId ? updated : t));
      } else {
        const created = await api.workflowTransitions.create(project.id, payload);
        setTransitions(prev => [...prev, created]);
      }
      setForm(EMPTY_TXN_FORM);
      setEditingTxnId(null);
      setAddTxnOpen(false);
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const openAddTransition = () => { setEditingTxnId(null); setForm(EMPTY_TXN_FORM); setAddTxnOpen(true); };
  const cancelTransitionForm = () => { setAddTxnOpen(false); setEditingTxnId(null); setForm(EMPTY_TXN_FORM); };

  const handleEditTransition = t => {
    setEditingTxnId(t.id);
    setForm({
      name: t.name, fromStatus: t.fromStatus || "", toStatus: t.toStatus,
      ruleType: t.ruleType || "",
      ruleLinkType: t.ruleType === "require_link" ? (t.ruleConfig?.linkType || "") : "",
      ruleField: t.ruleType === "require_field" ? (t.ruleConfig?.field || "") : "",
    });
    setAddTxnOpen(true);
  };

  // Dragging from a node's connector handle to another node ("connecting the
  // dots" directly on the diagram) pre-fills the same add-transition form
  // rather than silently creating an unnamed transition — a transition is a
  // named action, not just an edge.
  const handleConnect = (fromName, toName) => {
    setEditingTxnId(null);
    setForm({ ...EMPTY_TXN_FORM, fromStatus: fromName, toStatus: toName });
    setAddTxnOpen(true);
  };

  const confirmDeleteStatus = async () => {
    const col = columns.find(c => c.name === deleteStatusTarget);
    setDeleteStatusTarget(null);
    if (!col) return;
    try {
      await api.kbColumns.remove(col.id);
      toast.success("Status deleted");
      onRefresh();
    } catch (e) { toast.error(e.message); }
  };

  const pillBtn = {
    fontFamily: T.body, fontSize: 12, padding: "6px 12px", borderRadius: 7,
    border: `1px solid ${T.border}`, background: "none", color: T.textMuted, cursor: "pointer",
  };
  const inp = { ...wfInputStyle, borderColor: T.border, background: T.bg, color: T.text };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, maxWidth: 420 }}>
          {transitions.length === 0
            ? "No workflow configured yet — every status change is currently allowed. Add a transition to start restricting movement."
            : `${transitions.length} transition${transitions.length !== 1 ? "s" : ""} configured — moves outside these are now rejected.`}
        </div>
        <div style={{ display: "flex", borderRadius: 7, border: `1px solid ${T.border}`, overflow: "hidden", flexShrink: 0 }}>
          {[["diagram", "📊 Diagram"], ["text", "📃 Text"]].map(([key, label]) => (
            <button key={key} onClick={() => setSubView(key)}
              style={{ padding: "6px 12px", border: "none", cursor: "pointer",
                fontFamily: T.body, fontSize: 12, fontWeight: subView === key ? 700 : 400,
                background: subView === key ? T.accent + "22" : "transparent",
                color: subView === key ? T.accent : T.textMuted }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {addStatusOpen ? (
          <>
            <input value={newStatusName} onChange={e => setNewStatusName(e.target.value)} placeholder="Status name" autoFocus
              style={{ ...inp, width: 150 }} onKeyDown={e => e.key === "Enter" && handleAddStatus()} />
            <Btn size="sm" onClick={handleAddStatus} disabled={saving || !newStatusName.trim()}>Add</Btn>
            <button onClick={() => { setAddStatusOpen(false); setNewStatusName(""); }} style={pillBtn}>Cancel</button>
          </>
        ) : (
          <button onClick={() => setAddStatusOpen(true)} style={pillBtn}>+ Add status</button>
        )}
        {!addTxnOpen && (
          <button onClick={openAddTransition} style={pillBtn}>+ Add transition</button>
        )}
      </div>

      {addTxnOpen && (
        <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Transition name" autoFocus
              style={{ ...inp, width: 160 }} />
            <select value={form.fromStatus} onChange={e => setForm(f => ({ ...f, fromStatus: e.target.value }))}
              style={{ ...inp, width: 110, cursor: "pointer" }}>
              <option value="">Any</option>
              {columns.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            <span style={{ color: T.textMuted, fontSize: 12 }}>→</span>
            <select value={form.toStatus} onChange={e => setForm(f => ({ ...f, toStatus: e.target.value }))}
              style={{ ...inp, width: 110, cursor: "pointer" }}>
              <option value="">Select…</option>
              {columns.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>

          <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 12, marginBottom: 12 }}>
            <div style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700, color: T.textMuted,
              textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>
              Requirement (optional) — a "custom behavior" that must be satisfied before this transition can fire
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select value={form.ruleType} onChange={e => setForm(f => ({ ...f, ruleType: e.target.value }))}
                style={{ ...inp, width: 220, cursor: "pointer" }}>
                <option value="">No requirement</option>
                <option value="require_link">Require a linked ticket</option>
                <option value="require_field">Require a field to be set</option>
              </select>
              {form.ruleType === "require_link" && (
                <select value={form.ruleLinkType} onChange={e => setForm(f => ({ ...f, ruleLinkType: e.target.value }))}
                  style={{ ...inp, width: 150, cursor: "pointer" }}>
                  <option value="">Any link type</option>
                  {RULE_LINK_TYPES.map(lt => <option key={lt} value={lt}>{lt}</option>)}
                </select>
              )}
              {form.ruleType === "require_field" && (
                <select value={form.ruleField} onChange={e => setForm(f => ({ ...f, ruleField: e.target.value }))}
                  style={{ ...inp, width: 150, cursor: "pointer" }}>
                  <option value="">Select field…</option>
                  {RULE_FIELD_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <Btn size="sm" onClick={handleSaveTransition}
              disabled={saving || !form.name.trim() || !form.toStatus || (form.ruleType === "require_field" && !form.ruleField)}>
              {editingTxnId ? "Save Changes" : "Save"}
            </Btn>
            <button onClick={cancelTransitionForm} style={pillBtn}>Cancel</button>
          </div>
        </div>
      )}

      {subView === "diagram" ? (
        <WorkflowDiagram columns={columns} transitions={transitions}
          onColumnUpdated={handleColumnUpdated} onCategoryChange={handleCategoryChange} onDeleteTransition={handleDeleteTransition}
          onDeleteStatus={setDeleteStatusTarget} onConnect={handleConnect} onEditTransition={handleEditTransition} />
      ) : (
        <WorkflowTextView columns={columns} transitions={transitions}
          onCategoryChange={handleCategoryChange} onDeleteTransition={handleDeleteTransition} onDeleteStatus={setDeleteStatusTarget}
          onEditTransition={handleEditTransition} />
      )}

      {deleteStatusTarget && (
        <ConfirmModal
          message={`Delete status "${deleteStatusTarget}"? This also removes any transitions and board assignments referencing it. Tickets currently in this status must be moved first.`}
          onConfirm={confirmDeleteStatus}
          onCancel={() => setDeleteStatusTarget(null)}
        />
      )}
    </div>
  );
};

// ─── Boards (TKT-G3AY4J) ────────────────────────────────────────────────────────
// A board is a filtered VIEW over a subset of the project's shared workflow —
// same tickets, same statuses, same transitions, just a different slice of
// columns per team. Board membership is a SELECTION over the same diagram used
// by the Workflow tab (not a free-picked list), so a status can't end up on a
// board without at least one transition connecting it to the graph.

const BoardsTab = ({ project, columns }) => {
  const [boards,         setBoards]         = useState([]);
  const [transitions,    setTransitions]    = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [editingBoardId, setEditingBoardId] = useState(null);
  const [editingStatuses, setEditingStatuses] = useState(new Set());
  const [renamingId,     setRenamingId]     = useState(null);
  const [renameValue,    setRenameValue]    = useState("");
  const [addOpen,        setAddOpen]        = useState(false);
  const [newBoardName,   setNewBoardName]   = useState("");
  const [saving,         setSaving]         = useState(false);

  const load = () => Promise.all([api.boards.list(project.id), api.workflowTransitions.list(project.id)])
    .then(([b, t]) => { setBoards(b); setTransitions(t); })
    .catch(() => { setBoards([]); setTransitions([]); })
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, [project.id]);

  // Which statuses have at least one transition in or out — ineligible for any
  // board when the project has a workflow defined at all. Skipped entirely (no
  // status ineligible) when there are zero transitions, matching the server's
  // own backward-compatible permissiveness.
  const connected = new Set();
  for (const t of transitions) {
    if (t.fromStatus) connected.add(t.fromStatus);
    connected.add(t.toStatus);
  }
  const ineligible = transitions.length > 0
    ? new Set(columns.map(c => c.name).filter(n => !connected.has(n)))
    : new Set();

  const startEditingBoard = async board => {
    setEditingBoardId(board.id);
    try {
      const statuses = await api.boards.statuses(board.id);
      setEditingStatuses(new Set(statuses.map(s => s.status)));
    } catch { setEditingStatuses(new Set()); }
  };

  const toggleStatus = name => {
    setEditingStatuses(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const saveBoardStatuses = async () => {
    setSaving(true);
    try {
      const ordered = columns.map(c => c.name).filter(n => editingStatuses.has(n));
      await api.boards.updateStatuses(editingBoardId, ordered);
      toast.success("Board updated");
      setEditingBoardId(null);
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const handleAddBoard = async () => {
    if (!newBoardName.trim()) return;
    setSaving(true);
    try {
      await api.boards.create(project.id, { name: newBoardName.trim() });
      setNewBoardName(""); setAddOpen(false);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const commitRename = async board => {
    if (!renameValue.trim()) return;
    try { await api.boards.update(board.id, { name: renameValue.trim() }); setRenamingId(null); load(); }
    catch (e) { toast.error(e.message); }
  };

  const handleDeleteBoard = async board => {
    try { await api.boards.remove(board.id); setBoards(prev => prev.filter(b => b.id !== board.id)); }
    catch (e) { toast.error(e.message); }
  };

  const pillBtn = {
    fontFamily: T.body, fontSize: 12, padding: "6px 12px", borderRadius: 7,
    border: `1px solid ${T.border}`, background: "none", color: T.textMuted, cursor: "pointer",
  };
  const inp = { ...wfInputStyle, borderColor: T.border, background: T.bg, color: T.text };

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}><Spinner size="md" /></div>;

  const editingBoard = boards.find(b => b.id === editingBoardId);

  return (
    <div>
      <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, marginBottom: 14, maxWidth: 640 }}>
        Each board is a filtered view over this project's shared workflow — the same tickets, statuses, and
        transitions, just a different slice of columns per team. A status needs at least one transition
        (Workflow tab) before it can be added to a board.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
        {boards.map(b => (
          <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px",
            borderRadius: 7, border: `1px solid ${editingBoardId === b.id ? T.accent : T.border}`,
            background: editingBoardId === b.id ? T.accent + "0a" : T.bg }}>
            {renamingId === b.id ? (
              <>
                <input value={renameValue} onChange={e => setRenameValue(e.target.value)} autoFocus
                  style={{ ...inp, flex: 1 }} onKeyDown={e => e.key === "Enter" && commitRename(b)} />
                <Btn size="sm" onClick={() => commitRename(b)}>Save</Btn>
                <button onClick={() => setRenamingId(null)} style={pillBtn}>Cancel</button>
              </>
            ) : (
              <>
                <span style={{ fontFamily: T.body, fontSize: 13, color: T.text, fontWeight: 600, flex: 1 }}>{b.name}</span>
                <button onClick={() => (editingBoardId === b.id ? setEditingBoardId(null) : startEditingBoard(b))} style={pillBtn}>
                  {editingBoardId === b.id ? "Close" : "Edit statuses"}
                </button>
                <button onClick={() => { setRenamingId(b.id); setRenameValue(b.name); }} style={pillBtn}>Rename</button>
                <button onClick={() => handleDeleteBoard(b)} title="Delete board"
                  style={{ ...pillBtn, borderColor: T.danger + "44", color: T.danger }}>✕</button>
              </>
            )}
          </div>
        ))}
      </div>

      {addOpen ? (
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <input value={newBoardName} onChange={e => setNewBoardName(e.target.value)} placeholder="Board name" autoFocus
            style={{ ...inp, width: 200 }} onKeyDown={e => e.key === "Enter" && handleAddBoard()} />
          <Btn size="sm" onClick={handleAddBoard} disabled={saving || !newBoardName.trim()}>Add</Btn>
          <button onClick={() => { setAddOpen(false); setNewBoardName(""); }} style={pillBtn}>Cancel</button>
        </div>
      ) : (
        <button onClick={() => setAddOpen(true)} style={{ ...pillBtn, marginBottom: 18 }}>+ Add board</button>
      )}

      {editingBoard && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted }}>
              Click statuses to include them on <strong style={{ color: T.text }}>{editingBoard.name}</strong>.
              {ineligible.size > 0 && " Dashed/dimmed statuses have no workflow transitions yet."}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn size="sm" onClick={saveBoardStatuses} disabled={saving}>Save</Btn>
              <button onClick={() => setEditingBoardId(null)} style={pillBtn}>Cancel</button>
            </div>
          </div>
          <WorkflowDiagram columns={columns} transitions={transitions}
            mode="select" selectedStatuses={editingStatuses} ineligibleStatuses={ineligible} onToggleStatus={toggleStatus} />
        </div>
      )}
    </div>
  );
};

// ─── Workflow & Boards modal (wraps both tabs) ─────────────────────────────────

const ProjectWorkflowModal = ({ project, onClose }) => {
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState("workflow");

  const loadColumns = () => api.kbColumns.list(project.id).then(setColumns).catch(() => setColumns([]));
  useEffect(() => { loadColumns().finally(() => setLoading(false)); }, [project.id]);

  return (
    <Modal title={`🔀 Workflow & Boards — ${project.name}`} onClose={onClose} width={1180}>
      <div style={{ display: "flex", borderRadius: 7, border: `1px solid ${T.border}`, overflow: "hidden", width: "fit-content", marginBottom: 18 }}>
        {[["workflow", "🔀 Workflow"], ["boards", "🗂 Boards"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ padding: "7px 14px", border: "none", cursor: "pointer",
              fontFamily: T.body, fontSize: 12.5, fontWeight: tab === key ? 700 : 400,
              background: tab === key ? T.accent + "22" : "transparent",
              color: tab === key ? T.accent : T.textMuted }}>
            {label}
          </button>
        ))}
      </div>
      {loading ? (
        <div style={{ padding: 40, textAlign: "center" }}><Spinner size="md" /></div>
      ) : tab === "workflow" ? (
        <WorkflowTab project={project} columns={columns} onRefresh={loadColumns} />
      ) : (
        <BoardsTab project={project} columns={columns} />
      )}
    </Modal>
  );
};

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const [projects,     setProjects]     = useState([]);
  const [users,        setUsers]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [showCreate,   setShowCreate]   = useState(false);
  const [editTarget,   setEditTarget]   = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [membersTarget, setMembersTarget] = useState(null);
  const [workflowTarget, setWorkflowTarget] = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([api.kbProjects.list(), api.users.list()])
      .then(([p, u]) => { setProjects(p); setUsers(u); })
      .catch(() => toast.error("Failed to load projects"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const handleCreate = async data => {
    await api.kbProjects.create(data);
    toast.success("Project created");
    load();
  };

  const handleEdit = async data => {
    await api.kbProjects.update(editTarget.id, data);
    toast.success("Project updated");
    load();
  };

  const handleDelete = async () => {
    try {
      await api.kbProjects.remove(deleteTarget.id);
      setProjects(p => p.filter(x => x.id !== deleteTarget.id));
      toast.success("Project deleted");
    } catch (e) {
      toast.error(e.message);
    } finally { setDeleteTarget(null); }
  };

  const userName = id => users.find(u => u.id === id)?.name || "";

  const colHd = (label, width) => (
    <th style={{ textAlign: "left", padding: "8px 14px", fontFamily: T.mono, fontSize: 11,
      fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: ".08em",
      borderBottom: `1px solid ${T.border}`, width }}>
      {label}
    </th>
  );

  return (
    <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: T.head, fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 4 }}>
            Projects
          </div>
          <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted }}>
            Create projects, assign a lead, control access, and configure each project's workflow
            and boards. Columns, versions, sprints, and baselines are still managed from the board
            itself (⚙ Board).
          </div>
        </div>
        <Btn variant="primary" onClick={() => setShowCreate(true)}>+ New Project</Btn>
      </div>

      {loading ? (
        <div style={{ padding: "40px 0", display: "flex", justifyContent: "center" }}>
          <Spinner size="md" />
        </div>
      ) : (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {colHd("Project", 240)}
                {colHd("Description", undefined)}
                {colHd("Lead", 140)}
                {colHd("", 290)}
              </tr>
            </thead>
            <tbody>
              {projects.map((p, i) => (
                <tr key={p.id} style={{
                  borderBottom: i < projects.length - 1 ? `1px solid ${T.border}` : "none",
                  background: i % 2 === 0 ? "transparent" : T.bg + "55",
                }}>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {swatch(p.color)}
                      <div>
                        <div style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.text }}>{p.name}</div>
                        <div style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted }}>{p.key}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    {p.description ? (
                      <span style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted }}>{p.description}</span>
                    ) : (
                      <span style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    {p.leadUserName || userName(p.leadUserId) ? (
                      <span style={{ fontFamily: T.body, fontSize: 12, color: T.text }}>
                        {p.leadUserName || userName(p.leadUserId)}
                      </span>
                    ) : (
                      <span style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>No lead</span>
                    )}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
                      <button onClick={() => setMembersTarget(p)} title="Manage access"
                        style={{ padding: "3px 9px", borderRadius: 6, border: `1px solid ${T.border}`,
                          background: T.bg, color: T.textMuted, fontFamily: T.body, fontSize: 12,
                          cursor: "pointer" }}>
                        👥 Members
                      </button>
                      <button onClick={() => setWorkflowTarget(p)} title="Configure workflow and boards"
                        style={{ padding: "3px 9px", borderRadius: 6, border: `1px solid ${T.border}`,
                          background: T.bg, color: T.textMuted, fontFamily: T.body, fontSize: 12,
                          cursor: "pointer" }}>
                        🔀 Workflow
                      </button>
                      <button onClick={() => setEditTarget(p)} title="Edit project"
                        style={{ padding: "3px 9px", borderRadius: 6, border: `1px solid ${T.border}`,
                          background: T.bg, color: T.textMuted, fontFamily: T.body, fontSize: 12,
                          cursor: "pointer" }}>
                        Edit
                      </button>
                      <button onClick={() => setDeleteTarget(p)} title="Delete project"
                        style={{ padding: "3px 9px", borderRadius: 6, border: `1px solid ${T.danger}44`,
                          background: T.danger + "10", color: T.danger, fontFamily: T.body, fontSize: 12,
                          cursor: "pointer" }}>
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {projects.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: "32px", textAlign: "center",
                    fontFamily: T.body, fontSize: 13, color: T.textMuted }}>
                    No projects yet. Create one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <ProjectFormModal users={users} onSave={handleCreate} onClose={() => setShowCreate(false)} />
      )}
      {editTarget && (
        <ProjectFormModal project={editTarget} users={users} onSave={handleEdit} onClose={() => setEditTarget(null)} />
      )}
      {membersTarget && (
        <ProjectMembersModal projectId={membersTarget.id} projectName={membersTarget.name}
          onClose={() => setMembersTarget(null)} />
      )}
      {workflowTarget && (
        <ProjectWorkflowModal project={workflowTarget} onClose={() => setWorkflowTarget(null)} />
      )}
      {deleteTarget && (
        <ConfirmModal
          message={`Delete "${deleteTarget.name}"? Tickets in it will keep their project_id but the project will be gone.`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
