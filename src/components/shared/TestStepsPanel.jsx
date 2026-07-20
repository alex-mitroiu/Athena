import { useState, useEffect } from "react";
import { T } from "../../tokens";
import { api } from "../../api";
import { toast } from "../../toast";
import { useAuth } from "../../AuthContext";

// ─── Test Case Steps Panel (X-Ray style) ───────────────────────────────────
// Each step: Action / Test Data / Expected Result, executed and marked
// Pass/Fail/Blocked independently of the other steps. The parent Test Case's
// overall status auto-rolls up from step results (any Fail -> Testing Failed,
// any Blocked -> Cancelled, all Pass -> Done) once at least one step exists —
// a case with none keeps behaving exactly as before, driven by its own
// Pass/Fail/Blocked buttons elsewhere. Shared between TestCasesPage and
// KanbanPage's Tests tab, same pattern as DataRowsPanel/TestCaseStoryLinksPanel.

const STEP_COLOR = {
  "Pass":         "#22c55e",
  "Fail":         "#ef4444",
  "Blocked":      "#f97316",
  "Not Executed": "#6b7280",
};

const TestStepsPanel = ({ caseId }) => {
  const { canEdit } = useAuth();
  const [steps, setSteps] = useState(null); // null = loading

  const load = () => api.testItems.steps(caseId).then(setSteps).catch(() => setSteps([]));
  useEffect(() => { load(); }, [caseId]);

  const handleAdd = async () => {
    try {
      const created = await api.testItems.addStep(caseId, { action: "", testData: "", expectedResult: "" });
      setSteps(prev => [...(prev || []), created]);
    } catch (e) { toast.error(e.message); }
  };

  const patch = async (step, fields) => {
    setSteps(prev => prev.map(s => s.id === step.id ? { ...s, ...fields } : s));
    try {
      const updated = await api.testItems.updateStep(step.id, { ...step, ...fields });
      setSteps(prev => prev.map(s => s.id === step.id ? updated : s));
    } catch (e) { toast.error(e.message); }
  };

  const handleMove = async (step, dir) => {
    const idx = steps.findIndex(s => s.id === step.id);
    const otherIdx = idx + dir;
    if (otherIdx < 0 || otherIdx >= steps.length) return;
    const other = steps[otherIdx];
    const next = [...steps];
    next[idx] = other; next[otherIdx] = step;
    setSteps(next);
    try { await api.testItems.swapSteps(step.id, other.id); }
    catch (e) { toast.error(e.message); load(); }
  };

  const handleRemove = async id => {
    try { await api.testItems.removeStep(id); setSteps(prev => prev.filter(s => s.id !== id)); }
    catch (e) { toast.error(e.message); }
  };

  const inp = { fontFamily: T.body, fontSize: 12.5, color: T.text, background: T.bg,
    border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 9px", outline: "none",
    width: "100%", boxSizing: "border-box", resize: "vertical" };
  const lbl = txt => (
    <div style={{ fontFamily: T.body, fontSize: 9.5, fontWeight: 700, color: T.textMuted,
      textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 3 }}>{txt}</div>
  );
  const sectionLbl = { fontFamily: T.body, fontSize: 10, fontWeight: 700, color: T.textMuted,
    textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8 };

  const StatusBtn = ({ label, status, step }) => (
    <button type="button" disabled={!canEdit} onClick={() => patch(step, { status })}
      style={{ fontFamily: T.body, fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 5,
        cursor: canEdit ? "pointer" : "default",
        border: `1px solid ${step.status === status ? STEP_COLOR[status] : T.border}`,
        background: step.status === status ? STEP_COLOR[status] + "22" : "transparent",
        color: step.status === status ? STEP_COLOR[status] : T.textMuted }}>
      {label}
    </button>
  );

  return (
    <div>
      <div style={sectionLbl}>Steps{steps?.length ? ` (${steps.length})` : ""}</div>
      <div style={{ fontFamily: T.body, fontSize: 11.5, color: T.textMuted, marginBottom: 10 }}>
        Break this test into individual steps — each executes and passes/fails on its own; the case's
        overall status follows automatically once any step is marked.
      </div>

      {steps === null ? (
        <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>Loading…</div>
      ) : steps.length === 0 ? (
        <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted, fontStyle: "italic", marginBottom: 8 }}>
          No steps yet — add the first one below.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
          {steps.map((step, i) => (
            <div key={step.id} style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px",
              background: T.surface }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 700, color: T.textMuted,
                  flexShrink: 0, width: 20, paddingTop: 6 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {lbl("Step")}
                  <textarea value={step.action} rows={2} disabled={!canEdit}
                    onChange={e => setSteps(prev => prev.map(s => s.id === step.id ? { ...s, action: e.target.value } : s))}
                    onBlur={e => patch(step, { action: e.target.value })}
                    placeholder="What does the tester do?" style={inp} />
                </div>
                {canEdit && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
                    <button type="button" onClick={() => handleMove(step, -1)} disabled={i === 0}
                      title="Move up" style={{ background: "none", border: "none",
                        cursor: i === 0 ? "default" : "pointer", color: i === 0 ? T.border : T.textMuted, fontSize: 12 }}>▲</button>
                    <button type="button" onClick={() => handleMove(step, 1)} disabled={i === steps.length - 1}
                      title="Move down" style={{ background: "none", border: "none",
                        cursor: i === steps.length - 1 ? "default" : "pointer",
                        color: i === steps.length - 1 ? T.border : T.textMuted, fontSize: 12 }}>▼</button>
                    <button type="button" onClick={() => handleRemove(step.id)} title="Delete step"
                      style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, fontSize: 13 }}>×</button>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {lbl("Test Data")}
                  <textarea value={step.testData} rows={2} disabled={!canEdit}
                    onChange={e => setSteps(prev => prev.map(s => s.id === step.id ? { ...s, testData: e.target.value } : s))}
                    onBlur={e => patch(step, { testData: e.target.value })}
                    placeholder="e.g. username=admin" style={inp} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {lbl("Expected Result")}
                  <textarea value={step.expectedResult} rows={2} disabled={!canEdit}
                    onChange={e => setSteps(prev => prev.map(s => s.id === step.id ? { ...s, expectedResult: e.target.value } : s))}
                    onBlur={e => patch(step, { expectedResult: e.target.value })}
                    placeholder="e.g. Dashboard loads with welcome banner" style={inp} />
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: step.actualResult != null || canEdit ? 8 : 0 }}>
                <StatusBtn label="✓ Pass"    status="Pass"         step={step} />
                <StatusBtn label="✗ Fail"    status="Fail"         step={step} />
                <StatusBtn label="⊘ Blocked" status="Blocked"      step={step} />
                <StatusBtn label="⟳ Reset"   status="Not Executed" step={step} />
                {step.executedAt && (
                  <span style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted, marginLeft: "auto" }}>
                    {step.executedBy ? `${step.executedBy} · ` : ""}{new Date(step.executedAt).toLocaleString()}
                  </span>
                )}
              </div>

              {(step.actualResult != null || canEdit) && (
                <div>
                  {lbl("Actual Result")}
                  <input value={step.actualResult || ""} disabled={!canEdit}
                    onChange={e => setSteps(prev => prev.map(s => s.id === step.id ? { ...s, actualResult: e.target.value } : s))}
                    onBlur={e => patch(step, { actualResult: e.target.value })}
                    placeholder="What actually happened, if different from expected…" style={inp} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <button onClick={handleAdd}
          style={{ fontFamily: T.body, fontSize: 12, color: T.accent, background: "none",
            border: `1px dashed ${T.accent}55`, borderRadius: 6, padding: "6px 12px",
            cursor: "pointer", width: "100%", textAlign: "center" }}>
          ＋ Add Step
        </button>
      )}
    </div>
  );
};

export default TestStepsPanel;
