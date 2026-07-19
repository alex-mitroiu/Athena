import { useState, useEffect } from "react";
import { T } from "../tokens";
import { api } from "../api";
import { toast } from "../toast";
import { Modal } from "../components/primitives/Modal";
import Btn from "../components/primitives/Btn";
import Spinner from "../components/primitives/Spinner";

// ─── Constants ────────────────────────────────────────────────────────────────

const TEAM_COLORS = ["#6366f1", "#f59e0b", "#22c55e", "#06b6d4", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

const inputStyle = () => ({
  width: "100%", padding: "7px 11px", borderRadius: 7,
  border: `1px solid ${T.border}`, background: T.bg,
  fontFamily: T.body, fontSize: 12, color: T.text,
  outline: "none", boxSizing: "border-box",
});

const FieldLabel = ({ children, required }) => (
  <div style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700, color: T.textMuted,
    textTransform: "uppercase", letterSpacing: ".09em", marginBottom: 5 }}>
    {children}{required && <span style={{ color: T.danger }}> *</span>}
  </div>
);

// ─── Create / edit team modal ─────────────────────────────────────────────────

const TeamFormModal = ({ team: existing, users, onSave, onClose }) => {
  const isNew = !existing;
  const [name,      setName]      = useState(existing?.name  ?? "");
  const [color,     setColor]     = useState(existing?.color ?? TEAM_COLORS[0]);
  const [memberIds, setMemberIds] = useState(existing?.members?.map(m => m.id) ?? []);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState("");

  const toggle = id =>
    setMemberIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const handleSave = async () => {
    if (!name.trim()) return setError("Name is required");
    setError(""); setSaving(true);
    try {
      await onSave({ name: name.trim(), color, memberIds });
      onClose();
    } catch (e) {
      setError(e.message || "Save failed");
    } finally { setSaving(false); }
  };

  return (
    <Modal title={isNew ? "New Team" : "Edit Team"} onClose={onClose} width={480}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error && (
          <div style={{ padding: "9px 13px", borderRadius: 7, background: T.danger + "18",
            border: `1px solid ${T.danger}44`, fontFamily: T.body, fontSize: 13, color: T.danger }}>
            {error}
          </div>
        )}
        <div>
          <FieldLabel required>Team Name</FieldLabel>
          <input value={name} onChange={e => setName(e.target.value)} style={inputStyle()}
            placeholder="Platform Engineering"
            onFocus={e => e.currentTarget.style.borderColor = T.accent}
            onBlur={e  => e.currentTarget.style.borderColor = T.border} />
        </div>
        <div>
          <FieldLabel>Colour</FieldLabel>
          <div style={{ display: "flex", gap: 7 }}>
            {TEAM_COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)} title={c} style={{
                width: 26, height: 26, borderRadius: "50%", cursor: "pointer",
                background: c, border: color === c ? `2px solid ${T.text}` : "2px solid transparent",
                boxShadow: color === c ? `0 0 0 2px ${T.bg}` : "none",
              }} />
            ))}
          </div>
        </div>
        <div>
          <FieldLabel>Members {memberIds.length > 0 && `(${memberIds.length})`}</FieldLabel>
          <div style={{ maxHeight: 220, overflowY: "auto", border: `1px solid ${T.border}`,
            borderRadius: 8, display: "flex", flexDirection: "column" }}>
            {users.length === 0 ? (
              <div style={{ padding: 14, fontFamily: T.body, fontSize: 12, color: T.textMuted,
                fontStyle: "italic", textAlign: "center" }}>No users found.</div>
            ) : users.map(u => {
              const checked = memberIds.includes(u.id);
              return (
                <label key={u.id} onClick={() => toggle(u.id)} style={{
                  display: "flex", alignItems: "center", gap: 9, padding: "8px 12px",
                  cursor: "pointer", borderBottom: `1px solid ${T.border}`,
                  background: checked ? T.accent + "10" : "transparent",
                }}>
                  <input type="checkbox" readOnly checked={checked}
                    style={{ width: 14, height: 14, cursor: "pointer" }} />
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
          <div style={{ fontFamily: T.body, fontSize: 11, color: T.textMuted, marginTop: 6 }}>
            Users left unchecked stay a solo nomad — no team membership required.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>Cancel</Btn>
          <Btn variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : isNew ? "Create Team" : "Save Changes"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
};

// ─── Confirm delete ───────────────────────────────────────────────────────────

const ConfirmModal = ({ team, onConfirm, onClose }) => (
  <Modal title="Delete Team" onClose={onClose} width={400}>
    <div style={{ fontFamily: T.body, fontSize: 14, color: T.text, lineHeight: 1.6, marginBottom: 20 }}>
      Permanently delete <strong>{team.name}</strong>? Any tickets currently assigned to this team
      become unassigned — this cannot be undone.
    </div>
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
      <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
      <Btn variant="danger" onClick={onConfirm}>Delete</Btn>
    </div>
  </Modal>
);

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TeamsPage() {
  const [teams,        setTeams]        = useState([]);
  const [users,        setUsers]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [showCreate,   setShowCreate]   = useState(false);
  const [editTarget,   setEditTarget]   = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([api.teams.list(), api.users.list()])
      .then(([t, u]) => { setTeams(t); setUsers(u); })
      .catch(() => toast.error("Failed to load teams"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const handleCreate = async data => {
    await api.teams.create(data);
    toast.success("Team created");
    load();
  };

  const handleEdit = async data => {
    await api.teams.update(editTarget.id, data);
    toast.success("Team updated");
    load();
  };

  const handleDelete = async () => {
    try {
      await api.teams.remove(deleteTarget.id);
      setTeams(p => p.filter(t => t.id !== deleteTarget.id));
      toast.success("Team deleted");
    } catch (e) {
      toast.error(e.message);
    } finally { setDeleteTarget(null); }
  };

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
            Teams
          </div>
          <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted }}>
            Group users for quick config — assign an Epic to a team instead of clicking into every child ticket.
          </div>
        </div>
        <Btn variant="primary" onClick={() => setShowCreate(true)}>+ New Team</Btn>
      </div>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 0" }}>
          <Spinner size="md" />
        </div>
      ) : (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {colHd("Team", 220)}
                {colHd("Members", undefined)}
                {colHd("", 130)}
              </tr>
            </thead>
            <tbody>
              {teams.map((t, i) => (
                <tr key={t.id} style={{
                  borderBottom: i < teams.length - 1 ? `1px solid ${T.border}` : "none",
                  background: i % 2 === 0 ? "transparent" : T.bg + "55",
                }}>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: t.color, flexShrink: 0 }} />
                      <span style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.text }}>{t.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    {t.members.length === 0 ? (
                      <span style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>
                        No members yet
                      </span>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {t.members.map(m => (
                          <span key={m.id} style={{
                            display: "inline-block", padding: "2px 9px", borderRadius: 20,
                            fontFamily: T.body, fontSize: 11, fontWeight: 600,
                            background: T.bg, color: T.text, border: `1px solid ${T.border}`,
                          }}>
                            {m.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ display: "flex", gap: 5 }}>
                      <button onClick={() => setEditTarget(t)} title="Edit team"
                        style={{ padding: "3px 9px", borderRadius: 6, border: `1px solid ${T.border}`,
                          background: T.bg, color: T.textMuted, fontFamily: T.body, fontSize: 12,
                          cursor: "pointer" }}>
                        Edit
                      </button>
                      <button onClick={() => setDeleteTarget(t)} title="Delete team"
                        style={{ padding: "3px 9px", borderRadius: 6, border: `1px solid ${T.danger}44`,
                          background: T.danger + "10", color: T.danger, fontFamily: T.body, fontSize: 12,
                          cursor: "pointer" }}>
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {teams.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ padding: "32px", textAlign: "center",
                    fontFamily: T.body, fontSize: 13, color: T.textMuted }}>
                    No teams yet. Create one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <TeamFormModal users={users} onSave={handleCreate} onClose={() => setShowCreate(false)} />
      )}
      {editTarget && (
        <TeamFormModal team={editTarget} users={users} onSave={handleEdit} onClose={() => setEditTarget(null)} />
      )}
      {deleteTarget && (
        <ConfirmModal team={deleteTarget} onConfirm={handleDelete} onClose={() => setDeleteTarget(null)} />
      )}
    </div>
  );
}
