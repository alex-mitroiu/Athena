// ─── App Settings (Azure AD SSO config) ────────────────────────────────────────
// A generic key/value store, admin-only. Tighter than a straight port would be:
// the value set can include sso_client_secret in plaintext, so both verbs require
// admin — there is no legitimate reason for operator/viewer to read or write this.

module.exports = function settingsRoutes(app, ctx) {
  const { db, ok, err, requireRole, getSettings } = ctx;
  const write = requireRole(["admin"]);

  app.get("/api/settings", write, (req, res) => ok(res, getSettings()));

  app.put("/api/settings", write, (req, res) => {
    const updates = req.body;
    if (!updates || typeof updates !== "object" || Array.isArray(updates))
      return err(res, "Expected a JSON object of { key: value } pairs");
    const stmt = db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)");
    db.exec("BEGIN");
    try {
      for (const [k, v] of Object.entries(updates)) stmt.run(String(k), String(v));
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      return err(res, e.message);
    }
    ok(res, getSettings());
  });
};
