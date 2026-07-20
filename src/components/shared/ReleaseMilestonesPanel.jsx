import { useState, useEffect } from "react";
import { T } from "../../tokens";
import { api } from "../../api";
import { toast } from "../../toast";
import { useAuth } from "../../AuthContext";
import { Modal, ConfirmModal } from "../primitives/Modal";
import Btn from "../primitives/Btn";

// ─── Cross-project release milestones (TKT-5NQWK5) ─────────────────────────
// kb_versions is project-scoped only — a milestone groups one version from
// each of several projects under a shared target date with a rolled-up
// completion percentage, so "three teams all shipping against the same
// launch date" is one thing to look at. Self-contained/self-fetching so it
// can be dropped onto both the cross-project Roadmap and the Releases page
// without either host needing to thread data through.

const MilestoneFormModal = ({ init, onSave, onCancel }) => {
  const [name, setName] = useState(init?.name || "");
  const [targetDate, setTargetDate] = useState(init?.targetDate || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const saved = init?.id
        ? await api.releaseMilestones.update(init.id, { name: name.trim(), targetDate: targetDate || null })
        : await api.releaseMilestones.create({ name: name.trim(), targetDate: targetDate || null });
      onSave(saved);
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const inp = { fontFamily: T.body, fontSize: 13, color: T.text, background: T.bg,
    border: `1px solid ${T.border}`, borderRadius: 7, padding: "7px 10px", outline: "none", width: "100%", boxSizing: "border-box" };
  const lbl = txt => (
    <div style={{ fontFamily: T.body, fontSize: 10, fontWeight: 700, color: T.textMuted,
      textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 4 }}>{txt}</div>
  );

  return (
    <Modal title={init ? "Edit Milestone" : "New Release Milestone"} onClose={onCancel} width={420}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          {lbl("Name")}
          <input autoFocus value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Q3 Platform Launch" style={inp} />
        </div>
        <div>
          {lbl("Target date (optional)")}
          <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}
            style={{ ...inp, fontFamily: T.mono, cursor: "pointer" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <button type="button" onClick={onCancel}
            style={{ fontFamily: T.body, fontSize: 13, color: T.textMuted, background: "none",
              border: `1px solid ${T.border}`, borderRadius: 7, padding: "7px 16px", cursor: "pointer" }}>
            Cancel
          </button>
          <Btn onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? "Saving…" : init ? "Save Changes" : "Create Milestone"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
};

const AddVersionPicker = ({ milestone, projects, versionsByProject, onAdded, onClose }) => {
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const [versionId, setVersionId] = useState("");
  const [saving, setSaving] = useState(false);
  const linkedIds = new Set(milestone.versions.map(v => v.id));
  const available = (versionsByProject[projectId] || []).filter(v => !linkedIds.has(v.id));

  const handleAdd = async () => {
    if (!versionId) return;
    setSaving(true);
    try {
      const updated = await api.releaseMilestones.addVersion(milestone.id, versionId);
      onAdded(updated);
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const sel = { fontFamily: T.body, fontSize: 12.5, color: T.text, background: T.bg,
    border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 8px", outline: "none", cursor: "pointer" };

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <select value={projectId} onChange={e => { setProjectId(e.target.value); setVersionId(""); }} style={sel}>
        {projects.map(p => <option key={p.id} value={p.id}>{p.key}</option>)}
      </select>
      <select value={versionId} onChange={e => setVersionId(e.target.value)} style={{ ...sel, minWidth: 140 }}>
        <option value="">Select version…</option>
        {available.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      <button type="button" onClick={handleAdd} disabled={saving || !versionId}
        style={{ fontFamily: T.body, fontSize: 12, color: "#fff", background: T.accent, border: "none",
          borderRadius: 6, padding: "5px 12px", cursor: versionId ? "pointer" : "default", opacity: versionId ? 1 : 0.5 }}>
        Add
      </button>
      <button type="button" onClick={onClose}
        style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, background: "none", border: "none", cursor: "pointer" }}>
        Cancel
      </button>
    </div>
  );
};

const MilestoneCard = ({ milestone, projects, versionsByProject, onUpdated, onDeleted, canEdit }) => {
  const [addingVersion, setAddingVersion] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pct = milestone.total > 0 ? Math.round(milestone.done / milestone.total * 100) : 0;
  const todayStr = new Date().toISOString().slice(0, 10);
  const overdue = milestone.targetDate && milestone.targetDate < todayStr && milestone.total > 0 && milestone.done < milestone.total;

  const handleRemoveVersion = async linkId => {
    try {
      const updated = await api.releaseMilestones.removeVersion(linkId);
      onUpdated({ ...milestone, ...updated });
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, background: T.bg }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15 }}>🎯</span>
          <span style={{ fontFamily: T.head, fontSize: 14, fontWeight: 700, color: T.text }}>{milestone.name}</span>
          {milestone.targetDate && (
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted }}>📅 {milestone.targetDate}</span>
          )}
          {overdue && (
            <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700, color: T.danger,
              background: T.dangerBg, border: `1px solid ${T.danger}44`, borderRadius: 4, padding: "2px 7px" }}>
              ⚠ Overdue
            </span>
          )}
          {canEdit && (
            <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
              <button onClick={() => setEditing(true)} title="Edit milestone"
                style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 12 }}>✎</button>
              <button onClick={() => setConfirmDelete(true)} title="Delete milestone"
                style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 13 }}>✕</button>
            </span>
          )}
        </div>
        {milestone.total > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: T.border, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, borderRadius: 3,
                background: pct === 100 ? T.success : T.accent, transition: "width .3s" }} />
            </div>
            <span style={{ fontFamily: T.mono, fontSize: 11, color: pct === 100 ? T.success : T.textMuted, flexShrink: 0 }}>
              {milestone.done}/{milestone.total} · {pct}%
            </span>
          </div>
        )}
      </div>
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        {milestone.versions.length === 0 ? (
          <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>
            No versions linked yet.
          </div>
        ) : milestone.versions.map(v => (
          <div key={v.linkId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
            borderRadius: 6, background: T.bg, border: `1px solid ${T.border}` }}>
            <span style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted, flexShrink: 0 }}>{v.projectKey}</span>
            <span style={{ fontFamily: T.body, fontSize: 12.5, color: T.text, flex: 1, minWidth: 0,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</span>
            {v.total > 0 && (
              <span style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted, flexShrink: 0 }}>{v.done}/{v.total}</span>
            )}
            {canEdit && (
              <button onClick={() => handleRemoveVersion(v.linkId)} title="Remove from milestone"
                style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 12, flexShrink: 0 }}>×</button>
            )}
          </div>
        ))}

        {canEdit && (
          addingVersion ? (
            <AddVersionPicker milestone={milestone} projects={projects} versionsByProject={versionsByProject}
              onAdded={updated => { onUpdated({ ...milestone, ...updated }); setAddingVersion(false); }}
              onClose={() => setAddingVersion(false)} />
          ) : (
            <button onClick={() => setAddingVersion(true)}
              style={{ fontFamily: T.body, fontSize: 11.5, color: T.accent, background: "none",
                border: `1px dashed ${T.accent}55`, borderRadius: 6, padding: "5px 10px", cursor: "pointer",
                alignSelf: "flex-start" }}>
              ＋ Add Version
            </button>
          )
        )}
      </div>

      {editing && (
        <MilestoneFormModal init={milestone}
          onSave={updated => { onUpdated({ ...milestone, ...updated }); setEditing(false); }}
          onCancel={() => setEditing(false)} />
      )}
      {confirmDelete && (
        <ConfirmModal message={`Delete milestone "${milestone.name}"? Linked versions are unaffected — only the grouping is removed.`}
          onConfirm={async () => {
            try { await api.releaseMilestones.remove(milestone.id); onDeleted(milestone.id); }
            catch (e) { toast.error(e.message); }
            finally { setConfirmDelete(false); }
          }}
          onCancel={() => setConfirmDelete(false)} />
      )}
    </div>
  );
};

const ReleaseMilestonesPanel = () => {
  const { canEdit } = useAuth();
  const [milestones, setMilestones] = useState(null); // null = loading
  const [projects, setProjects] = useState([]);
  const [versionsByProject, setVersionsByProject] = useState({});
  const [showNew, setShowNew] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const load = () => {
    Promise.all([api.releaseMilestones.list(), api.kbProjects.list()])
      .then(async ([ms, projs]) => {
        setMilestones(ms);
        setProjects(projs);
        const lists = await Promise.all(projs.map(p => api.kbVersions.list(p.id)));
        setVersionsByProject(Object.fromEntries(projs.map((p, i) => [p.id, lists[i]])));
      })
      .catch(() => setMilestones([]));
  };
  useEffect(() => { load(); }, []);

  const updateOne = updated => setMilestones(prev => prev.map(m => m.id === updated.id ? updated : m));
  const removeOne = id => setMilestones(prev => prev.filter(m => m.id !== id));

  if (milestones === null) return null; // quiet while loading — avoids a flash of an empty section
  if (milestones.length === 0 && !canEdit) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: collapsed ? 0 : 10 }}>
        <button onClick={() => setCollapsed(c => !c)} type="button"
          style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, fontSize: 11, padding: 0 }}>
          {collapsed ? "▸" : "▾"}
        </button>
        <span style={{ fontFamily: T.head, fontSize: 14, fontWeight: 700, color: T.text }}>
          🎯 Release Milestones
        </span>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted }}>
          {milestones.length > 0 ? `(${milestones.length})` : ""}
        </span>
        {canEdit && (
          <button onClick={() => setShowNew(true)}
            style={{ marginLeft: "auto", fontFamily: T.body, fontSize: 11.5, color: T.accent, background: "none",
              border: `1px dashed ${T.accent}55`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
            ＋ New Milestone
          </button>
        )}
      </div>

      {!collapsed && (
        milestones.length === 0 ? (
          <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>
            No cross-project milestones yet — group versions from several projects under one shared target date.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
            {milestones.map(m => (
              <MilestoneCard key={m.id} milestone={m} projects={projects} versionsByProject={versionsByProject}
                onUpdated={updateOne} onDeleted={removeOne} canEdit={canEdit} />
            ))}
          </div>
        )
      )}

      {showNew && (
        <MilestoneFormModal
          onSave={created => { setMilestones(prev => [...prev, created]); setShowNew(false); }}
          onCancel={() => setShowNew(false)}
        />
      )}
    </div>
  );
};

export default ReleaseMilestonesPanel;
