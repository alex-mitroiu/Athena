import { useState, useEffect } from "react";
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

// ─── Create / edit project modal ───────────────────────────────────────────────

const ProjectFormModal = ({ project: existing, users, onSave, onClose }) => {
  const isNew = !existing;
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

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const [projects,     setProjects]     = useState([]);
  const [users,        setUsers]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [showCreate,   setShowCreate]   = useState(false);
  const [editTarget,   setEditTarget]   = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [membersTarget, setMembersTarget] = useState(null);

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
            Create projects, assign a lead, and control who can access each one. Columns,
            versions, sprints, and baselines are managed from the board itself (⚙ Board).
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
                {colHd("", 220)}
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
