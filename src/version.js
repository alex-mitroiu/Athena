export const VERSION  = "0.2.0";
export const BUILD    = "2026-07-13";
export const CODENAME = "Genesis";

export const CHANGELOG = [
  {
    version:  "0.2.0",
    date:     "2026-07-13",
    codename: "Genesis",
    summary:  "Test artifacts (Test Folder/Plan/Run/Case) moved out of the shared tickets table into a dedicated test_items repository with its own routes and API namespace — no longer mixed with Integration Board tickets. Added a Test Case ↔ Story link (\"Tests\" / \"Is tested by\"), visible from both sides. TicketPreview footer redesigned: Backlog and prev/next status stay inline; Edit, Delete, Coverage, and Diagram moved behind the ⚙ actions menu. Added a User Manual page and an app-wide footer with version and copyright info.",
  },
  {
    version:  "0.1.1",
    date:     "2026-07-13",
    codename: "Genesis",
    summary:  "Hotfix. Fixed a crash on the login page (missing SSO config endpoint). Added admin User Management page (create/edit/deactivate/delete, role assignment). Added login lockout after repeated failed attempts, with admin unlock. Fixed a bug where a backend outage or network blip would silently wipe a valid session — the app now shows a reconnect state and auto-recovers instead of forcing re-login.",
  },
  {
    version:  "0.1.0",
    date:     "2026-07-12",
    codename: "Genesis",
    summary:  "Initial standalone release. Board, Releases, Test Plans, Test Runs, Test Cases extracted from CargoDesk. Multi-project support, structured versions, folder-tree test cases, inline TC execution.",
  },
];

export const COPYRIGHT_YEAR  = "2026";
export const COPYRIGHT_OWNER = "Athena";
