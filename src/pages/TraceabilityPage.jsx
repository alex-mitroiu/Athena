import { useState, useEffect, useMemo } from "react";
import { T } from "../tokens";
import { api } from "../api";
import { toast } from "../toast";
import Spinner from "../components/primitives/Spinner";

// ─── Traceability Matrix (TKT-CWFZPB) ─────────────────────────────────────────
// Rows = Stories, columns = their linked Test Cases (via test_case_links) with
// status dots, coverage % per row. test_case_links + the Tests/Is-tested-by
// links already exist (TestCaseStoryLinksPanel) — this is purely a grid view
// over that data, no new relation type needed. A Defect relation to close the
// requirements->test->defect loop is a natural fast-follow, not required here.

const TC_PASS    = new Set(["Done", "Ready to Deploy", "Released"]);
const TC_FAIL    = new Set(["Testing Failed"]);
const TC_BLOCKED = new Set(["Cancelled"]);
const TC_ACTIVE  = new Set(["In Testing", "In Progress"]);
const tcColor = s =>
  TC_PASS.has(s) ? "#22c55e" : TC_FAIL.has(s) ? "#ef4444" :
  TC_BLOCKED.has(s) ? "#f97316" : TC_ACTIVE.has(s) ? "#3b82f6" : "#6b7280";
const tcLabel = s =>
  TC_PASS.has(s) ? "Pass" : TC_FAIL.has(s) ? "Fail" :
  TC_BLOCKED.has(s) ? "Blocked" : TC_ACTIVE.has(s) ? "In Progress" : "Not Executed";

export default function TraceabilityPage() {
  const [tickets, setTickets] = useState([]);
  const [links,   setLinks]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");
  const [onlyGaps, setOnlyGaps] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.tickets.list(), api.testCaseLinks.list()])
      .then(([t, l]) => { setTickets(t); setLinks(l); })
      .catch(() => toast.error("Failed to load traceability data"))
      .finally(() => setLoading(false));
  }, []);

  const stories = useMemo(() => tickets.filter(t => t.type === "Story"), [tickets]);

  const linksByStory = useMemo(() => {
    const map = new Map();
    for (const l of links) {
      if (!map.has(l.ticketId)) map.set(l.ticketId, []);
      map.get(l.ticketId).push(l);
    }
    return map;
  }, [links]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stories
      .filter(s => !q || s.id.toLowerCase().includes(q) || s.title.toLowerCase().includes(q))
      .map(story => {
        const storyLinks = linksByStory.get(story.id) || [];
        const passed = storyLinks.filter(l => TC_PASS.has(l.caseStatus)).length;
        const pct = storyLinks.length > 0 ? Math.round(passed / storyLinks.length * 100) : null;
        return { story, links: storyLinks, pct };
      })
      .filter(r => !onlyGaps || r.links.length === 0)
      .sort((a, b) => (a.pct ?? -1) - (b.pct ?? -1));
  }, [stories, linksByStory, search, onlyGaps]);

  const gapCount = useMemo(() => stories.filter(s => !(linksByStory.get(s.id) || []).length).length, [stories, linksByStory]);

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: T.textMuted }}>
      <Spinner size="md" />
    </div>
  );

  return (
    <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: T.head, fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 4 }}>
            Traceability Matrix
          </div>
          <div style={{ fontFamily: T.body, fontSize: 12, color: T.textMuted }}>
            {stories.length} Stor{stories.length !== 1 ? "ies" : "y"} · {links.length} Story↔Test Case link{links.length !== 1 ? "s" : ""}
            {gapCount > 0 && <span style={{ color: "#f97316", fontWeight: 600 }}> · {gapCount} with no test coverage</span>}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search stories…"
          style={{ flex: 1, maxWidth: 340, fontFamily: T.body, fontSize: 13, color: T.text,
            background: T.bg, border: `1px solid ${T.border}`, borderRadius: 7,
            padding: "7px 11px", outline: "none" }} />
        <button onClick={() => setOnlyGaps(v => !v)}
          style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600, cursor: "pointer",
            padding: "6px 12px", borderRadius: 7,
            border: `1px solid ${onlyGaps ? "#f97316" : T.border}`,
            background: onlyGaps ? "#f9731618" : "transparent",
            color: onlyGaps ? "#f97316" : T.textMuted }}>
          ⚠ Coverage gaps only
        </button>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: "48px 0", textAlign: "center", fontSize: 13, color: T.textMuted, fontStyle: "italic" }}>
          {stories.length === 0 ? "No Stories yet." : "No stories match this view."}
        </div>
      ) : (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "8px 16px",
            borderBottom: `1px solid ${T.border}`, background: T.bg }}>
            <div style={{ width: 260, flexShrink: 0, fontFamily: T.mono, fontSize: 10, fontWeight: 700,
              color: T.textMuted, textTransform: "uppercase", letterSpacing: ".06em" }}>Story</div>
            <div style={{ flex: 1, fontFamily: T.mono, fontSize: 10, fontWeight: 700, color: T.textMuted,
              textTransform: "uppercase", letterSpacing: ".06em" }}>Linked Test Cases</div>
            <div style={{ width: 90, textAlign: "right", fontFamily: T.mono, fontSize: 10, fontWeight: 700,
              color: T.textMuted, textTransform: "uppercase", letterSpacing: ".06em" }}>Coverage</div>
          </div>
          {rows.map(({ story, links: storyLinks, pct }) => (
            <div key={story.id} style={{ display: "flex", alignItems: "center", padding: "10px 16px",
              borderBottom: `1px solid ${T.border}22` }}>
              <div style={{ width: 260, flexShrink: 0, minWidth: 0 }}>
                <div style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.text,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{story.title}</div>
                <div style={{ fontFamily: T.mono, fontSize: 10, color: T.textMuted, marginTop: 1 }}>{story.id}</div>
              </div>
              <div style={{ flex: 1, display: "flex", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
                {storyLinks.length === 0 ? (
                  <span style={{ fontFamily: T.body, fontSize: 12, color: "#f97316", fontStyle: "italic" }}>
                    No test cases linked
                  </span>
                ) : storyLinks.map(l => (
                  <span key={l.id} title={`${l.caseId} · ${tcLabel(l.caseStatus)}`}
                    style={{ display: "inline-flex", alignItems: "center", gap: 5,
                      padding: "2px 8px", borderRadius: 10, background: T.bg,
                      border: `1px solid ${T.border}`, fontFamily: T.body, fontSize: 11, color: T.text,
                      maxWidth: 180 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: tcColor(l.caseStatus), flexShrink: 0 }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.caseTitle}</span>
                  </span>
                ))}
              </div>
              <div style={{ width: 90, textAlign: "right", fontFamily: T.mono, fontSize: 13, fontWeight: 700,
                color: pct == null ? "#f97316" : pct === 100 ? "#22c55e" : pct >= 50 ? "#3b82f6" : "#ef4444" }}>
                {pct != null ? `${pct}%` : "—"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
