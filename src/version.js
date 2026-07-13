export const VERSION  = "0.1.1";
export const BUILD    = "2026-07-13";
export const CODENAME = "Genesis";

export const CHANGELOG = [
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
