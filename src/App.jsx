import { useState, useEffect, useCallback } from "react";
import { T, applyTheme } from "./tokens";
import { toast } from "./toast";
import ToastContainer from "./components/primitives/ToastContainer";
import { api, TOKEN_KEY } from "./api";
import { AuthContext } from "./AuthContext";
import { VERSION, CODENAME, COPYRIGHT_YEAR, COPYRIGHT_OWNER } from "./version";

import LoginPage      from "./pages/LoginPage";
import KanbanPage     from "./pages/KanbanPage";
import ReleasesPage   from "./pages/ReleasesPage";
import TestPlansPage  from "./pages/TestPlansPage";
import TestRunsPage   from "./pages/TestRunsPage";
import TestCasesPage  from "./pages/TestCasesPage";
import UsersPage      from "./pages/UsersPage";
import UserManualPage from "./pages/UserManualPage";

// ─── Theme ────────────────────────────────────────────────────────────────────

const THEME_KEY = "athena_theme";

// ─── Nav button ───────────────────────────────────────────────────────────────

const NavBtn = ({ pageKey, icon, label, page, setPage, indent = false }) => {
  const active = page === pageKey;
  return (
    <button
      onClick={() => setPage(pageKey)}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        width: "100%", padding: indent ? "7px 14px 7px 28px" : "7px 14px",
        background: active ? `${T.accent}1A` : "transparent",
        border: "none", borderRadius: 7,
        borderLeft: active ? `3px solid ${T.accent}` : "3px solid transparent",
        color: active ? T.accent : T.text,
        cursor: "pointer", fontFamily: T.body, fontSize: 13, fontWeight: active ? 600 : 400,
        textAlign: "left", transition: "background .12s",
      }}>
      <span style={{ fontSize: indent ? 12 : 14 }}>{icon}</span>
      {label}
    </button>
  );
};

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [token,     setToken]     = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user,      setUser]      = useState(null);
  const [page,      setPage]      = useState("kanban");
  const [unreachable, setUnreachable] = useState(false);
  const [retryTick,   setRetryTick]   = useState(0);
  const [isDark,    setIsDark]    = useState(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return saved !== null ? saved === "dark" : true;
  });

  // Apply theme on mount and change
  useEffect(() => {
    applyTheme(isDark);
    localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
  }, [isDark]);

  // Restore session on mount (and on manual/auto retry). A genuinely invalid
  // session (401 → "Unauthorised") clears the token via the logout event below;
  // any other failure means the server itself is unreachable — keep the token
  // so a valid session survives a transient outage instead of forcing re-login.
  useEffect(() => {
    if (!token) return;
    api.auth.me()
      .then(u => { setUser(u); setUnreachable(false); })
      .catch(e => setUnreachable(e.message !== "Unauthorised"));
  }, [token, retryTick]);

  // While the server is unreachable, poll every 5s until it comes back
  useEffect(() => {
    if (!unreachable) return;
    const id = setInterval(() => setRetryTick(t => t + 1), 5000);
    return () => clearInterval(id);
  }, [unreachable]);

  // Global logout event (401)
  useEffect(() => {
    const handler = () => handleLogout();
    window.addEventListener("athena:logout", handler);
    return () => window.removeEventListener("athena:logout", handler);
  }, []);

  const handleLogin = useCallback((tok, usr) => {
    localStorage.setItem(TOKEN_KEY, tok);
    setToken(tok);
    setUser(usr);
    setPage("kanban");
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setUnreachable(false);
    setPage("kanban");
    api.auth.logout().catch(() => {});
  }, []);

  // Role helpers
  const roles     = user?.roles ?? (user?.role ? [user.role] : ["viewer"]);
  const isAdmin   = roles.includes("admin");
  const isViewer  = !roles.includes("admin") && !roles.includes("operator");
  const canEdit   = !isViewer;
  const activeRole = isAdmin ? "admin" : roles.includes("operator") ? "operator" : "viewer";

  const authCtx = {
    user, activeRole, activeRoles: roles,
    canEdit, isAdmin, isViewer,
    canEditShipments: canEdit,
    canManageConfigs: isAdmin,
    activeOffice: null, userOffices: [], allOffices: true,
    setActiveOffice: () => {},
  };

  // Have a token but can't reach the server — keep the session, show a
  // reconnect state instead of silently sitting there or forcing a re-login.
  if (token && unreachable) {
    return (
      <AuthContext.Provider value={authCtx}>
        <div style={{ minHeight: "100vh", background: T.bg, color: T.text,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ textAlign: "center", maxWidth: 360 }}>
            <div style={{ fontSize: 30, marginBottom: 14 }}>🦉</div>
            <div style={{ fontFamily: T.head, fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
              Can't reach the server
            </div>
            <div style={{ fontFamily: T.body, fontSize: 13, color: T.textMuted, marginBottom: 18, lineHeight: 1.5 }}>
              Your session is still saved — retrying automatically every few seconds.
            </div>
            <button onClick={() => setRetryTick(t => t + 1)} style={{
              padding: "8px 18px", borderRadius: 7, border: `1px solid ${T.border}`,
              background: "transparent", color: T.text, cursor: "pointer",
              fontFamily: T.body, fontSize: 13 }}>
              Retry now
            </button>
          </div>
          <ToastContainer />
        </div>
      </AuthContext.Provider>
    );
  }

  // Not logged in → show login
  if (!token || !user) {
    return (
      <AuthContext.Provider value={authCtx}>
        <div style={{ minHeight: "100vh", background: T.bg, color: T.text }}>
          <LoginPage onLogin={handleLogin} />
          <ToastContainer />
        </div>
      </AuthContext.Provider>
    );
  }

  const NavSection = ({ label }) => (
    <div style={{ fontFamily: T.body, fontSize: 10, fontWeight: 700, color: T.textMuted,
      textTransform: "uppercase", letterSpacing: ".08em", padding: "12px 14px 4px" }}>
      {label}
    </div>
  );

  const nb = (key, icon, label, indent = false) => (
    <NavBtn key={key} pageKey={key} icon={icon} label={label} page={page} setPage={setPage} indent={indent} />
  );

  return (
    <AuthContext.Provider value={authCtx}>
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: T.bg, color: T.text, overflow: "hidden" }}>
      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>

        {/* ── Sidebar ── */}
        <div style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column",
          borderRight: `1px solid ${T.border}`, background: T.bg, overflow: "hidden" }}>

          {/* Logo */}
          <div style={{ padding: "16px 16px 12px", display: "flex", alignItems: "center", gap: 10,
            borderBottom: `1px solid ${T.border}` }}>
            <span style={{ fontSize: 22 }}>🦉</span>
            <div>
              <div style={{ fontFamily: T.head, fontSize: 15, fontWeight: 800, color: T.text }}>Athena</div>
              <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textMuted, letterSpacing: ".05em" }}>v{VERSION} · {CODENAME}</div>
            </div>
          </div>

          {/* Nav */}
          <nav style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
            <NavSection label="Board" />
            {nb("kanban",     "📋", "Integration Board")}
            {nb("releases",   "🏷", "Releases", true)}
            {nb("test-plans", "🧪", "Test Plans", true)}
            {nb("test-runs",  "🔄", "Test Runs", true)}
            {nb("test-cases", "✓",  "Test Cases", true)}
            {isAdmin && <NavSection label="Admin" />}
            {isAdmin && nb("users", "👤", "Users")}
          </nav>

          {/* Footer */}
          <div style={{ padding: "10px 10px 12px", borderTop: `1px solid ${T.border}`,
            display: "flex", flexDirection: "column", gap: 8 }}>
            {/* User chip */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px",
              borderRadius: 7, background: T.surface }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: T.accent,
                color: "#fff", fontFamily: T.mono, fontSize: 12, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {user.name?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600, color: T.text,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {user.name}
                </div>
                <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textMuted }}>{activeRole}</div>
              </div>
            </div>
            {/* Controls row */}
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setIsDark(d => !d)}
                title="Toggle theme"
                style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: `1px solid ${T.border}`,
                  background: "transparent", color: T.textMuted, cursor: "pointer",
                  fontFamily: T.body, fontSize: 12 }}>
                {isDark ? "☀ Light" : "☾ Dark"}
              </button>
              <button onClick={handleLogout}
                style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: `1px solid ${T.border}`,
                  background: "transparent", color: T.textMuted, cursor: "pointer",
                  fontFamily: T.body, fontSize: 12 }}>
                Sign out
              </button>
            </div>
          </div>
        </div>

        {/* ── Main ── */}
        <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: "0 20px" }}>
          {page === "kanban"       && <KanbanPage />}
          {page === "releases"     && <ReleasesPage />}
          {page === "test-plans"   && <TestPlansPage />}
          {page === "test-runs"    && <TestRunsPage />}
          {page === "test-cases"   && <TestCasesPage />}
          {page === "users"        && isAdmin && <UsersPage />}
          {page === "user-manual"  && <UserManualPage />}
        </main>

      </div>

      {/* ── Footer ── */}
      <footer style={{
        flexShrink: 0, borderTop: `1px solid ${T.border}`,
        padding: "7px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
        background: T.bg,
      }}>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.textMuted }}>
          🦉 Athena · v{VERSION}
        </span>
        <span style={{ fontFamily: T.body, fontSize: 11, color: T.textMuted }}>
          © {COPYRIGHT_YEAR} {COPYRIGHT_OWNER}
        </span>
        <button type="button" onClick={() => setPage("user-manual")}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 0,
            fontFamily: T.body, fontSize: 11, color: T.textMuted, textDecoration: "underline dotted" }}>
          User Manual
        </button>
      </footer>
      </div>
      <ToastContainer />
    </AuthContext.Provider>
  );
}
