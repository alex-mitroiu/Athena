// ─── Delivery Estimation (Monte Carlo) ─────────────────────────────────────────
// No historical per-stage timing data exists yet (no status-transition history is
// logged anywhere), so this samples from admin-calibrated three-point estimates
// (days per story point) via a triangular distribution rather than real history.
// Both routes are read-only/stateless — any authenticated role can use them; only
// the underlying config values (written through the existing admin-gated
// PUT /api/settings) are restricted.

const STAGES = ["integration", "testing", "patching", "release"];

const DEFAULTS = {
  integration: { opt: 0.5,  likely: 1,   pess: 3   },
  testing:     { opt: 0.5,  likely: 1.5, pess: 3   },
  patching:    { opt: 0.25, likely: 1,   pess: 2   },
  release:     { opt: 0.25, likely: 0.5, pess: 1.5 },
};

function parseConfig(raw) {
  const num = (v, fallback) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fallback; };
  const config = {};
  for (const stage of STAGES) {
    const d = DEFAULTS[stage];
    config[stage] = {
      opt:    num(raw[`est_${stage}_opt`],    d.opt),
      likely: num(raw[`est_${stage}_likely`], d.likely),
      pess:   num(raw[`est_${stage}_pess`],   d.pess),
    };
  }
  return config;
}

// Inverse-CDF triangular sampling. Guards against untrusted free-text admin input:
// non-monotonic values (sorted into a<=m<=b) and a===b (would otherwise divide by zero).
function sampleTriangular(opt, likely, pess) {
  const [a, m, b] = [opt, likely, pess].sort((x, y) => x - y);
  if (a === b) return a;
  const u = Math.random();
  const f = (m - a) / (b - a);
  return u < f
    ? a + Math.sqrt(u * (b - a) * (m - a))
    : b - Math.sqrt((1 - u) * (b - a) * (b - m));
}

function buildHistogram(totals, bins = 24) {
  const min = totals[0], max = totals[totals.length - 1];
  if (min === max) return [{ from: min, to: min, count: totals.length }];
  const width = (max - min) / bins;
  const counts = new Array(bins).fill(0);
  for (const t of totals) {
    const idx = Math.min(bins - 1, Math.floor((t - min) / width));
    counts[idx]++;
  }
  return counts.map((count, i) => ({ from: min + i * width, to: min + (i + 1) * width, count }));
}

function runSimulation(storyPoints, config, iterations = 10000) {
  const totals = new Array(iterations);
  const stageSums = { integration: 0, testing: 0, patching: 0, release: 0 };

  for (let i = 0; i < iterations; i++) {
    let total = 0;
    for (const stage of STAGES) {
      const c = config[stage];
      const days = sampleTriangular(c.opt, c.likely, c.pess) * storyPoints;
      total += days;
      stageSums[stage] += days;
    }
    totals[i] = total;
  }

  totals.sort((a, b) => a - b);
  const pct = p => totals[Math.min(iterations - 1, Math.floor(p * iterations))];
  const mean = totals.reduce((a, b) => a + b, 0) / iterations;
  const stageAverages = Object.fromEntries(STAGES.map(s => [s, stageSums[s] / iterations]));

  return {
    p50: pct(0.5), p80: pct(0.8), p95: pct(0.95), mean,
    stageAverages,
    histogram: buildHistogram(totals),
  };
}

module.exports = function estimationRoutes(app, ctx) {
  const { ok, err, auth, getSettings } = ctx;

  app.get("/api/estimation/config", auth(), (req, res) => {
    ok(res, parseConfig(getSettings("est_")));
  });

  app.post("/api/estimation/run", auth(), (req, res) => {
    const storyPoints = parseFloat(req.body?.storyPoints);
    if (!Number.isFinite(storyPoints) || storyPoints <= 0)
      return err(res, "storyPoints must be a positive number");
    const config = parseConfig(getSettings("est_"));
    ok(res, runSimulation(storyPoints, config));
  });
};
