import { useState, useEffect, useRef, useCallback } from "react";
import { T } from "../tokens";
import { api } from "../api";
import { toast } from "../toast";
import Spinner from "../components/primitives/Spinner";

// ─── Small inline switch — no shared Toggle primitive exists yet, and this is ──
// its only user today, so it isn't worth promoting to components/primitives/.

const Toggle = ({ on, onChange }) => (
  <button type="button" onClick={onChange} title={on ? "Enabled" : "Disabled"} style={{
    width: 40, height: 22, borderRadius: 11, position: "relative", flexShrink: 0,
    background: on ? T.accent : T.border, border: "none", cursor: "pointer",
    transition: "background .2s", padding: 0,
  }}>
    <span style={{
      position: "absolute", top: 2, left: on ? 20 : 2,
      width: 18, height: 18, borderRadius: "50%", background: "#fff",
      boxShadow: "0 1px 3px rgba(0,0,0,.35)", transition: "left .2s",
    }} />
  </button>
);

// A function (like its inputStyle sibling below), not a frozen object literal —
// re-reads T fresh on each use instead of freezing whatever was active on load.
const fieldLabel = () => ({
  display: "block", fontFamily: T.body, fontSize: 11, fontWeight: 600,
  color: T.textMuted, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5,
});

const inputStyle = disabled => ({
  width: "100%", padding: "8px 12px", borderRadius: 7,
  border: `1px solid ${T.border}`, background: disabled ? T.bg + "80" : T.bg,
  fontFamily: T.body, fontSize: 13, color: T.text,
  outline: "none", boxSizing: "border-box",
});

// ─── SSO panel ──────────────────────────────────────────────────────────────────

const SsoPanel = ({ settings, onChange }) => {
  const [showSecret, setShowSecret] = useState(false);
  const enabled = settings.sso_enabled === "1";

  const FIELDS = [
    { key: "sso_tenant_id",    label: "Tenant ID",    placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
    { key: "sso_client_id",    label: "Client ID",    placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
    { key: "sso_redirect_uri", label: "Redirect URI", placeholder: "https://yourapp.com/api/auth/sso/callback" },
    { key: "sso_frontend_url", label: "Frontend URL", placeholder: "http://localhost:5173" },
  ];

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <div style={{ fontFamily: T.head, fontSize: 15, fontWeight: 700, color: T.text }}>
            Azure AD / Entra ID SSO
          </div>
          <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, marginTop: 2 }}>
            Let users sign in with a Microsoft work account instead of (or alongside) a local password.
          </div>
        </div>
        <Toggle on={enabled} onChange={() => onChange("sso_enabled", enabled ? "0" : "1")} />
      </div>

      {!enabled && (
        <div style={{ padding: "11px 15px", borderRadius: 8, background: T.border + "30",
          fontFamily: T.body, fontSize: 12.5, color: T.textMuted, marginBottom: 18 }}>
          Enable the toggle above to activate SSO. Local email/password login always remains
          available as a fallback.
        </div>
      )}

      {FIELDS.map(({ key, label, placeholder }) => (
        <div key={key} style={{ marginBottom: 14 }}>
          <label style={fieldLabel()}>{label}</label>
          <input value={settings[key] || ""} placeholder={placeholder} disabled={!enabled}
            onChange={e => onChange(key, e.target.value)} style={inputStyle(!enabled)} />
        </div>
      ))}

      <div style={{ marginBottom: 14 }}>
        <label style={fieldLabel()}>Client Secret</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input type={showSecret ? "text" : "password"} value={settings.sso_client_secret || ""}
            placeholder="Paste client secret…" disabled={!enabled}
            onChange={e => onChange("sso_client_secret", e.target.value)}
            style={{ ...inputStyle(!enabled), flex: 1 }} />
          <button type="button" onClick={() => setShowSecret(x => !x)} style={{
            ...inputStyle(false), width: 64, cursor: "pointer", flexShrink: 0,
            background: T.surface, textAlign: "center" }}>
            {showSecret ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 4 }}>
        <label style={fieldLabel()}>Default role for new SSO users</label>
        <select value={settings.sso_default_role || "operator"} disabled={!enabled}
          onChange={e => onChange("sso_default_role", e.target.value)}
          style={{ ...inputStyle(!enabled), width: 180, cursor: enabled ? "pointer" : "default" }}>
          <option value="operator">Operator</option>
          <option value="viewer">Viewer</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      {enabled && (
        <div style={{ marginTop: 16, padding: "11px 15px", borderRadius: 8,
          border: `1px solid ${T.accent}44`, background: T.accent + "0a",
          fontFamily: T.body, fontSize: 12, color: T.textMuted }}>
          <strong style={{ color: T.text }}>Login URL:</strong>{" "}
          <code style={{ fontFamily: T.mono, fontSize: 11 }}>/api/auth/sso/init</code>
          {" "}— register this as the redirect target in your Azure App Registration, and
          make sure Redirect URI above points back at{" "}
          <code style={{ fontFamily: T.mono, fontSize: 11 }}>/api/auth/sso/callback</code>.
        </div>
      )}
    </div>
  );
};

// ─── Delivery Estimation (Monte Carlo) panel ───────────────────────────────────
// No historical per-stage timing data exists yet, so these are admin-calibrated
// three-point (optimistic/likely/pessimistic) days-per-story-point estimates,
// sampled via a triangular distribution by routes/estimation.js. Purely guesses
// until real history accumulates — meant to be tuned, not treated as calibrated.

const EST_STAGES = [
  { key: "integration", label: "Integration" },
  { key: "testing",     label: "Testing" },
  { key: "patching",    label: "Patching" },
  { key: "release",     label: "Release" },
];

const estColHd = label => (
  <th style={{ textAlign: "left", padding: "0 10px 8px", fontFamily: T.mono, fontSize: 10,
    fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: ".07em" }}>
    {label}
  </th>
);

const EstimationPanel = ({ settings, onChange }) => (
  <div style={{ maxWidth: 560 }}>
    <div style={{ fontFamily: T.head, fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>
      Delivery Estimation (Monte Carlo)
    </div>
    <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, marginBottom: 16 }}>
      Days per story point for each stage, used by the 🎲 estimator on any ticket. These are
      your best guesses, not measured history — tune them as real delivery data suggests better numbers.
    </div>
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          {estColHd("Stage")}
          {estColHd("Optimistic")}
          {estColHd("Likely")}
          {estColHd("Pessimistic")}
        </tr>
      </thead>
      <tbody>
        {EST_STAGES.map(({ key, label }) => (
          <tr key={key}>
            <td style={{ padding: "5px 10px 5px 0", fontFamily: T.body, fontSize: 13, color: T.text, fontWeight: 600 }}>
              {label}
            </td>
            {["opt", "likely", "pess"].map(field => (
              <td key={field} style={{ padding: "5px 10px 5px 0" }}>
                <input type="number" min="0" step="0.25" value={settings[`est_${key}_${field}`] ?? ""}
                  onChange={e => onChange(`est_${key}_${field}`, e.target.value)}
                  style={{ ...inputStyle(false), width: 90 }} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// ─── Sprint Capacity panel ──────────────────────────────────────────────────────
// One admin-calibrated constant — story points a single team member can absorb
// in a sprint — used by SprintBoardView to flag over-allocated teams. Same
// guess-until-real-data-suggests-better idiom as EstimationPanel above.

const CapacityPanel = ({ settings, onChange }) => (
  <div style={{ maxWidth: 560 }}>
    <div style={{ fontFamily: T.head, fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>
      Sprint Capacity
    </div>
    <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, marginBottom: 16 }}>
      Story points a single team member can absorb per sprint. The Sprint board multiplies
      this by each team's headcount to flag over-allocated teams.
    </div>
    <div>
      <label style={fieldLabel()}>Points per person per sprint</label>
      <input type="number" min="0" step="1" value={settings.capacity_points_per_person_per_sprint ?? ""}
        placeholder="8" onChange={e => onChange("capacity_points_per_person_per_sprint", e.target.value)}
        style={{ ...inputStyle(false), width: 90 }} />
    </div>
  </div>
);

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const saveTimers = useRef({});

  useEffect(() => {
    api.settings.get().then(setSettings).catch(() => toast.error("Failed to load settings"));
  }, []);

  const saveSetting = useCallback((key, value) => {
    clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => {
      api.settings.update({ [key]: value }).catch(() => toast.error("Failed to save setting"));
    }, 400);
  }, []);

  const handleChange = (key, value) => {
    setSettings(s => ({ ...s, [key]: value }));
    saveSetting(key, value);
  };

  return (
    <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: T.head, fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 4 }}>
          Application Settings
        </div>
        <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted }}>
          Admin-only configuration. Changes save automatically.
        </div>
      </div>

      {!settings ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 0" }}>
          <Spinner size="md" />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 22 }}>
            <SsoPanel settings={settings} onChange={handleChange} />
          </div>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 22 }}>
            <EstimationPanel settings={settings} onChange={handleChange} />
          </div>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 22 }}>
            <CapacityPanel settings={settings} onChange={handleChange} />
          </div>
        </div>
      )}
    </div>
  );
}
