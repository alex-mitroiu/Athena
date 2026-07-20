import { useState, useEffect } from "react";
import { T } from "../tokens";
import { api } from "../api";
import { toast } from "../toast";
import Spinner from "../components/primitives/Spinner";
import Badge from "../components/primitives/Badge";
import { Modal } from "../components/primitives/Modal";
import { MarkdownView } from "../markdown";
import { RoadmapView } from "./KanbanPage";
import ReleaseMilestonesPanel from "../components/shared/ReleaseMilestonesPanel";

const DONE_ISH = new Set(["Done", "Ready to Deploy", "Released"]);

// ─── Grouped-by-Initiative view (TKT-U2SCAK) ───────────────────────────────
// An Initiative sits above Epic — a program that can span several Epics,
// potentially across projects. This is a separate view mode from the shared
// RoadmapView's Swimlanes/Gantt (which groups by Version, a different axis
// that doesn't compose cleanly with initiative grouping), not a change to
// that shared component.
const InitiativeGroupedView = ({ tickets, projectName, onPreview, onCreateInitiative, creating }) => {
  const epics = tickets.filter(t => t.type === "Epic");
  const initiatives = tickets.filter(t => t.type === "Initiative");
  const ungrouped = epics.filter(e => !e.initiativeId || !initiatives.some(i => i.id === e.initiativeId));

  const EpicRow = ({ e }) => {
    const done = DONE_ISH.has(e.status);
    return (
      <div key={e.id} onClick={() => onPreview(e)}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px",
          borderRadius: 7, background: T.bg, border: `1px solid ${T.border}`, cursor: "pointer",
          opacity: done ? 0.7 : 1 }}>
        <span style={{ fontSize: 13, flexShrink: 0 }}>⚡</span>
        <span style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted, flexShrink: 0 }}>{e.id}</span>
        <span style={{ fontFamily: T.body, fontSize: 12.5, color: T.text, flex: 1, minWidth: 0,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          textDecoration: done ? "line-through" : "none" }}>{e.title}</span>
        <span style={{ fontFamily: T.body, fontSize: 10, color: T.textMuted, flexShrink: 0 }}>{projectName(e.projectId)}</span>
        <Badge variant={done ? "success" : "default"}>{e.status}</Badge>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {initiatives.length === 0 && ungrouped.length === 0 ? (
        <div style={{ padding: "60px 24px", textAlign: "center", fontFamily: T.body, fontSize: 14, color: T.textMuted }}>
          No Epics in the selected projects yet.
        </div>
      ) : (
        <>
          {initiatives.map(ini => {
            const children = epics.filter(e => e.initiativeId === ini.id);
            if (children.length === 0) return null;
            const doneCount = children.filter(e => DONE_ISH.has(e.status)).length;
            return (
              <div key={ini.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px",
                  background: T.bg, borderBottom: `1px solid ${T.border}` }}>
                  <span style={{ fontSize: 15 }}>🧭</span>
                  <span style={{ fontFamily: T.head, fontSize: 14, fontWeight: 700, color: T.text }}>{ini.title}</span>
                  <span style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted }}>{ini.id}</span>
                  <span style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted, marginLeft: "auto" }}>
                    {doneCount}/{children.length} done
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 12 }}>
                  {children.map(e => <EpicRow key={e.id} e={e} />)}
                </div>
              </div>
            );
          })}

          {ungrouped.length > 0 && (
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "11px 16px", background: T.bg, borderBottom: `1px solid ${T.border}`,
                fontFamily: T.head, fontSize: 14, fontWeight: 700, color: T.text }}>
                Ungrouped
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 12 }}>
                {ungrouped.map(e => <EpicRow key={e.id} e={e} />)}
              </div>
            </div>
          )}
        </>
      )}

      <button onClick={onCreateInitiative} disabled={creating} type="button"
        style={{ fontFamily: T.body, fontSize: 12, color: T.accent, background: "none",
          border: `1px dashed ${T.accent}55`, borderRadius: 8, padding: "10px 14px",
          cursor: "pointer", textAlign: "center" }}>
        ＋ New Initiative
      </button>
    </div>
  );
};

// ─── Cross-project Roadmap (TKT-NWEV3B) ────────────────────────────────────
// The per-project Roadmap tab on the Kanban board only ever sees one project's
// tickets/versions. This page aggregates every project the user can access into
// the same RoadmapView (Swimlanes/Gantt) instead of duplicating that rendering
// logic, with a project filter to narrow back down.
//
// Clicking an Epic/ticket here can't reuse the board's own TicketPreview — that
// component is wired into KanbanPage's per-project column/sprint/label state and
// pulling it out is a much bigger lift than this ticket asked for. Rendering a
// lightweight read-only summary instead is a deliberate scope boundary, not an
// oversight.

const EpicSummaryModal = ({ ticket, projectName, onClose }) => (
  <Modal title={ticket.title} onClose={onClose} width={560}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
      <Badge variant="default">{ticket.type}</Badge>
      <Badge variant="info">{ticket.status}</Badge>
      <span style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted }}>{ticket.id}</span>
      <span style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted }}>· {projectName}</span>
    </div>
    {(ticket.startDate || ticket.dueDate) && (
      <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.textMuted, marginBottom: 14 }}>
        {ticket.startDate || "?"} → {ticket.dueDate || "?"}
      </div>
    )}
    {ticket.description ? (
      <MarkdownView text={ticket.description} style={{ fontSize: 13 }} />
    ) : (
      <div style={{ fontFamily: T.body, fontSize: 13, color: T.textMuted, fontStyle: "italic" }}>
        No description.
      </div>
    )}
  </Modal>
);

export default function RoadmapPage() {
  const [projects, setProjects]   = useState([]);
  const [tickets, setTickets]     = useState([]);
  const [versions, setVersions]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [activeIds, setActiveIds] = useState(new Set());
  const [previewTicket, setPreviewTicket] = useState(null);
  const [groupMode, setGroupMode] = useState("standard"); // "standard" (Swimlanes/Gantt) | "initiative"
  const [creatingInitiative, setCreatingInitiative] = useState(false);

  const load = () => {
    setLoading(true);
    return Promise.all([api.kbProjects.list(), api.tickets.list({})])
      .then(async ([projs, tix]) => {
        setProjects(projs);
        setTickets(tix);
        setActiveIds(prev => prev.size === 0 ? new Set(projs.map(p => p.id)) : prev);
        const verLists = await Promise.all(projs.map(p => api.kbVersions.list(p.id)));
        setVersions(verLists.flat());
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleCreateInitiative = async () => {
    const name = window.prompt("New initiative name:");
    if (!name || !name.trim()) return;
    const homeProjectId = activeIds.size > 0 ? Array.from(activeIds)[0] : projects[0]?.id;
    if (!homeProjectId) return;
    setCreatingInitiative(true);
    try {
      await api.tickets.create({ title: name.trim(), type: "Initiative", projectId: homeProjectId });
      await load();
    } catch (e) { toast.error(e.message); }
    finally { setCreatingInitiative(false); }
  };

  const toggleProject = id => {
    setActiveIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const showAll = () => setActiveIds(new Set(projects.map(p => p.id)));

  const filteredTickets  = tickets.filter(t => activeIds.has(t.projectId));
  const filteredVersions = versions.filter(v => activeIds.has(v.projectId));
  const projectName = id => projects.find(p => p.id === id)?.name || "Unknown project";

  return (
    <div style={{ padding: 24, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: T.head, fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 4 }}>
          🗺 Roadmap
        </div>
        <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted }}>
          Epics and versions aggregated across every project you can access, in one Swimlanes/Gantt
          view. Narrow to specific projects below when the combined view gets noisy.
        </div>
      </div>

      <ReleaseMilestonesPanel />

      {loading ? (
        <div style={{ padding: "40px 0", display: "flex", justifyContent: "center" }}>
          <Spinner size="md" />
        </div>
      ) : projects.length === 0 ? (
        <div style={{ padding: "60px 24px", textAlign: "center", fontFamily: T.body, fontSize: 14, color: T.textMuted }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🗺</div>
          <div style={{ fontWeight: 600, color: T.text, marginBottom: 6 }}>No accessible projects yet</div>
          <div>Ask an admin to add you as a project member.</div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
            <div style={{ display: "flex", borderRadius: 7, border: `1px solid ${T.border}`, overflow: "hidden" }}>
              {[["standard", "🏷 Swimlanes/Gantt"], ["initiative", "🧭 By Initiative"]].map(([key, label]) => (
                <button key={key} onClick={() => setGroupMode(key)} type="button"
                  style={{ padding: "6px 12px", border: "none", cursor: "pointer",
                    fontFamily: T.body, fontSize: 12, fontWeight: groupMode === key ? 700 : 400,
                    background: groupMode === key ? T.accent + "22" : "transparent",
                    color: groupMode === key ? T.accent : T.textMuted }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
            <button onClick={showAll} type="button"
              style={{ padding: "5px 12px", borderRadius: 20, cursor: "pointer",
                fontFamily: T.body, fontSize: 12, fontWeight: 600,
                border: `1px solid ${activeIds.size === projects.length ? T.accent : T.border}`,
                background: activeIds.size === projects.length ? T.accent + "22" : "transparent",
                color: activeIds.size === projects.length ? T.accent : T.textMuted }}>
              All projects
            </button>
            {projects.map(p => {
              const on = activeIds.has(p.id);
              return (
                <button key={p.id} onClick={() => toggleProject(p.id)} type="button"
                  style={{ padding: "5px 12px", borderRadius: 20, cursor: "pointer",
                    fontFamily: T.body, fontSize: 12, fontWeight: 600,
                    border: `1px solid ${on ? p.color : T.border}`,
                    background: on ? p.color + "22" : "transparent",
                    color: on ? p.color : T.textMuted }}>
                  {p.key} · {p.name}
                </button>
              );
            })}
          </div>

          {activeIds.size === 0 ? (
            <div style={{ padding: "60px 24px", textAlign: "center", fontFamily: T.body, fontSize: 14, color: T.textMuted }}>
              No projects selected. Choose at least one above.
            </div>
          ) : groupMode === "initiative" ? (
            <InitiativeGroupedView tickets={filteredTickets} projectName={projectName} onPreview={setPreviewTicket}
              onCreateInitiative={handleCreateInitiative} creating={creatingInitiative} />
          ) : (
            <RoadmapView tickets={filteredTickets} versions={filteredVersions} onPreview={setPreviewTicket} />
          )}
        </>
      )}

      {previewTicket && (
        <EpicSummaryModal
          ticket={previewTicket}
          projectName={projectName(previewTicket.projectId)}
          onClose={() => setPreviewTicket(null)}
        />
      )}
    </div>
  );
}
