import { useState, useEffect } from "react";
import { T } from "../tokens";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import { toast } from "../toast";
import Spinner from "../components/primitives/Spinner";

// ─── Configurable Dashboard (TKT-RKTB6L) ───────────────────────────────────────
// Per-user widget layout backed by dashboard_widgets. Each widget type is
// self-fetching (same idiom as TicketWorkLogPanel / NotificationBell) so this
// page only owns the catalog + layout, not any widget's data.

const DONE_STATUSES = new Set(["Done", "Ready to Deploy", "Released"]);

const WIDGET_CATALOG = [
  { type: "my-tickets",    icon: "📋", label: "My Tickets" },
  { type: "burndown",      icon: "🔥", label: "Sprint Burndown" },
  { type: "notifications", icon: "🔔", label: "Recent Notifications" },
  { type: "worklog",       icon: "⏱", label: "Work Log Summary" },
];

const PRIORITY_DOT = { Critical: "#ef4444", High: "#f59e0b", Medium: "#6366f1", Low: "#6b7280" };

const cardStyle = {
  background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10,
  display: "flex", flexDirection: "column", minWidth: 0,
};

const WidgetChrome = ({ icon, label, onMoveUp, onMoveDown, onRemove, canUp, canDown, children }) => (
  <div style={cardStyle}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
      borderBottom: `1px solid ${T.border}` }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <div style={{ flex: 1, fontFamily: T.head, fontSize: 13, fontWeight: 700, color: T.text }}>{label}</div>
      <button onClick={onMoveUp} disabled={!canUp} title="Move up" style={{ background: "none", border: "none",
        cursor: canUp ? "pointer" : "default", color: canUp ? T.textMuted : T.border, fontSize: 12, padding: "2px 5px" }}>▲</button>
      <button onClick={onMoveDown} disabled={!canDown} title="Move down" style={{ background: "none", border: "none",
        cursor: canDown ? "pointer" : "default", color: canDown ? T.textMuted : T.border, fontSize: 12, padding: "2px 5px" }}>▼</button>
      <button onClick={onRemove} title="Remove widget" style={{ background: "none", border: "none",
        cursor: "pointer", color: T.danger, fontSize: 13, padding: "2px 5px" }}>✕</button>
    </div>
    <div style={{ padding: 14, overflowY: "auto", maxHeight: 340 }}>{children}</div>
  </div>
);

const EmptyNote = ({ children }) => (
  <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic", textAlign: "center", padding: "16px 0" }}>
    {children}
  </div>
);

// ─── Widget: My Tickets ─────────────────────────────────────────────────────────

const MyTicketsWidget = () => {
  const { user } = useAuth();
  const [tickets, setTickets] = useState(null);

  useEffect(() => {
    api.tickets.list().then(all => {
      setTickets(all.filter(t => t.assigneeId === user?.id && !DONE_STATUSES.has(t.status)));
    }).catch(() => setTickets([]));
  }, [user?.id]);

  if (tickets === null) return <div style={{ display: "flex", justifyContent: "center", padding: 20 }}><Spinner size="sm" /></div>;
  if (tickets.length === 0) return <EmptyNote>No open tickets assigned to you.</EmptyNote>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {tickets.slice(0, 8).map(t => (
        <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px",
          borderRadius: 6, background: T.bg, borderLeft: `3px solid ${PRIORITY_DOT[t.priority] || T.border}` }}>
          <div style={{ flex: 1, minWidth: 0, fontFamily: T.body, fontSize: 12.5, color: T.text,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
          <span style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted, flexShrink: 0 }}>{t.status}</span>
        </div>
      ))}
    </div>
  );
};

// ─── Widget: Sprint Burndown (mini) ─────────────────────────────────────────────

const BurndownWidget = () => {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const projects = await api.kbProjects.list();
        for (const p of projects) {
          const sprints = await api.sprints.list(p.id);
          const active = sprints.find(s => s.status === "Active");
          if (active) {
            const bd = await api.sprints.burndown(active.id);
            if (!cancelled) setState({ loading: false, projectName: p.name, ...bd });
            return;
          }
        }
        if (!cancelled) setState({ loading: false, sprint: null });
      } catch {
        if (!cancelled) setState({ loading: false, sprint: null });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (state.loading) return <div style={{ display: "flex", justifyContent: "center", padding: 20 }}><Spinner size="sm" /></div>;
  if (!state.sprint) return <EmptyNote>No active sprint.</EmptyNote>;

  const pct = state.totalPoints > 0 ? Math.round(((state.totalPoints - state.remainingPoints) / state.totalPoints) * 100) : 0;

  return (
    <div>
      <div style={{ fontFamily: T.body, fontSize: 12, color: T.text, marginBottom: 2 }}>
        <strong>{state.sprint.name}</strong> <span style={{ color: T.textMuted }}>· {state.projectName}</span>
      </div>
      <div style={{ fontFamily: T.mono, fontSize: 10.5, color: T.textMuted, marginBottom: 10 }}>
        {state.totalPoints - state.remainingPoints} of {state.totalPoints} pts done · {state.ticketCount} tickets
      </div>
      <div style={{ height: 8, borderRadius: 5, background: T.bg, overflow: "hidden", border: `1px solid ${T.border}` }}>
        <div style={{ height: "100%", width: `${pct}%`, background: T.accent, borderRadius: 5, transition: "width .3s" }} />
      </div>
      <div style={{ fontFamily: T.mono, fontSize: 10.5, color: T.accent, marginTop: 6, textAlign: "right" }}>{pct}%</div>
    </div>
  );
};

// ─── Widget: Recent Notifications ───────────────────────────────────────────────

const NotificationsWidget = () => {
  const [items, setItems] = useState(null);

  const load = () => api.notifications.list().then(setItems).catch(() => setItems([]));
  useEffect(() => { load(); }, []);

  const markRead = id => {
    api.notifications.markRead(id).then(() =>
      setItems(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n)));
  };

  if (items === null) return <div style={{ display: "flex", justifyContent: "center", padding: 20 }}><Spinner size="sm" /></div>;
  if (items.length === 0) return <EmptyNote>No notifications yet.</EmptyNote>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {items.slice(0, 6).map(n => (
        <div key={n.id} onClick={() => !n.isRead && markRead(n.id)}
          style={{ padding: "7px 9px", borderRadius: 6, cursor: n.isRead ? "default" : "pointer",
            background: n.isRead ? "transparent" : T.accent + "10", display: "flex", gap: 7, alignItems: "flex-start" }}>
          {!n.isRead && <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.accent, flexShrink: 0, marginTop: 5 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: T.body, fontSize: 12, color: T.text }}>{n.message}</div>
            <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.textMuted, marginTop: 1 }}>
              {new Date(n.createdAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

// ─── Widget: Work Log Summary ───────────────────────────────────────────────────

const fmtHrs = mins => `${(mins / 60).toFixed(1)}h`;

const WorkLogWidget = () => {
  const [rows, setRows] = useState(null);

  useEffect(() => { api.workLogs.summary().then(setRows).catch(() => setRows([])); }, []);

  if (rows === null) return <div style={{ display: "flex", justifyContent: "center", padding: 20 }}><Spinner size="sm" /></div>;
  if (rows.length === 0) return <EmptyNote>No time logged yet.</EmptyNote>;

  const total = rows.reduce((s, r) => s + r.totalMinutes, 0);

  return (
    <div>
      <div style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted, marginBottom: 8 }}>
        Total logged: <strong style={{ color: T.text }}>{fmtHrs(total)}</strong>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {rows.slice(0, 6).map(r => (
          <div key={r.ticketId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0, fontFamily: T.body, fontSize: 12, color: T.text,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.ticketTitle}</div>
            <span style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted, flexShrink: 0 }}>{fmtHrs(r.totalMinutes)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const WIDGET_BODY = {
  "my-tickets": MyTicketsWidget,
  "burndown": BurndownWidget,
  "notifications": NotificationsWidget,
  "worklog": WorkLogWidget,
};

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [widgets, setWidgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const load = () => {
    setLoading(true);
    api.dashboardWidgets.list().then(setWidgets).catch(() => toast.error("Failed to load dashboard")).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const addWidget = async type => {
    setAddOpen(false);
    try {
      await api.dashboardWidgets.create({ widgetType: type });
      load();
    } catch (e) { toast.error(e.message); }
  };

  const removeWidget = async id => {
    try {
      await api.dashboardWidgets.remove(id);
      setWidgets(prev => prev.filter(w => w.id !== id));
    } catch (e) { toast.error(e.message); }
  };

  const move = async (index, dir) => {
    const next = [...widgets];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setWidgets(next);
    try { await api.dashboardWidgets.reorder(next.map(w => w.id)); }
    catch (e) { toast.error(e.message); load(); }
  };

  const availableTypes = WIDGET_CATALOG.filter(c => !widgets.some(w => w.widgetType === c.type));

  return (
    <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 18, position: "relative" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: T.head, fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 4 }}>
            Dashboard
          </div>
          <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted }}>
            Your personal layout — add, remove, and reorder widgets. Saved per user.
          </div>
        </div>
        <button onClick={() => setAddOpen(o => !o)} disabled={availableTypes.length === 0}
          style={{ fontFamily: T.body, fontSize: 12.5, fontWeight: 600, color: "#fff",
            background: availableTypes.length === 0 ? T.textMuted : T.accent, border: "none",
            borderRadius: 7, padding: "8px 16px", cursor: availableTypes.length === 0 ? "default" : "pointer" }}>
          + Add Widget
        </button>
        {addOpen && (
          <div style={{ position: "absolute", top: 40, right: 0, zIndex: 20, width: 220,
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 9,
            boxShadow: "0 12px 32px rgba(0,0,0,.25)", overflow: "hidden" }}>
            {availableTypes.map(c => (
              <button key={c.type} onClick={() => addWidget(c.type)} style={{
                width: "100%", textAlign: "left", padding: "9px 13px", background: "none", border: "none",
                borderBottom: `1px solid ${T.border}`, cursor: "pointer", fontFamily: T.body, fontSize: 12.5,
                color: T.text, display: "flex", alignItems: "center", gap: 8 }}>
                <span>{c.icon}</span>{c.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 0" }}>
          <Spinner size="md" />
        </div>
      ) : widgets.length === 0 ? (
        <div style={{ padding: "50px 20px", textAlign: "center", border: `1px dashed ${T.border}`, borderRadius: 10 }}>
          <div style={{ fontSize: 26, marginBottom: 8 }}>📊</div>
          <div style={{ fontFamily: T.body, fontSize: 13, color: T.textMuted, marginBottom: 14 }}>
            No widgets yet — add one to get started.
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            {WIDGET_CATALOG.map(c => (
              <button key={c.type} onClick={() => addWidget(c.type)} style={{
                fontFamily: T.body, fontSize: 12.5, color: T.text, background: T.surface,
                border: `1px solid ${T.border}`, borderRadius: 7, padding: "8px 14px", cursor: "pointer" }}>
                {c.icon} {c.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {widgets.map((w, i) => {
            const cat = WIDGET_CATALOG.find(c => c.type === w.widgetType);
            const Body = WIDGET_BODY[w.widgetType];
            if (!Body) return null;
            return (
              <WidgetChrome key={w.id} icon={cat?.icon || "▫"} label={cat?.label || w.widgetType}
                canUp={i > 0} canDown={i < widgets.length - 1}
                onMoveUp={() => move(i, -1)} onMoveDown={() => move(i, 1)} onRemove={() => removeWidget(w.id)}>
                <Body />
              </WidgetChrome>
            );
          })}
        </div>
      )}
    </div>
  );
}
