const TOKEN_KEY = "athena_token";

const getToken = () => localStorage.getItem(TOKEN_KEY);

async function req(method, path, body) {
  const token = getToken();
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(`/api${path}`, opts);
  if (res.status === 401) {
    window.dispatchEvent(new Event("athena:logout"));
    throw new Error("Unauthorised");
  }
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export { TOKEN_KEY };

export const api = {
  auth: {
    login:     (email, password) => req("POST", "/auth/login", { email, password }),
    me:        ()                => req("GET",  "/auth/me"),
    logout:    ()                => req("POST", "/auth/logout"),
    ssoConfig: ()                => req("GET",  "/auth/sso/config"),
  },

  users: {
    list:   ()                => req("GET",    "/users"),
    create: (data)            => req("POST",   "/users", data),
    update: (id, data)        => req("PATCH",  `/users/${id}`, data),
    remove: (id)              => req("DELETE", `/users/${id}`),
  },

  labels: {
    list: () => req("GET", "/labels"),
  },

  testCaseLinks: {
    list: () => req("GET", "/test-case-links"),
  },

  teams: {
    list:   ()     => req("GET",    "/teams"),
    create: (data) => req("POST",   "/teams", data),
    update: (id, data) => req("PUT", `/teams/${id}`, data),
    remove: (id)   => req("DELETE", `/teams/${id}`),
  },

  tickets: {
    list:    (p = {})   => req("GET",    `/tickets${Object.keys(p).length ? "?" + new URLSearchParams(p) : ""}`),
    create:  (data)     => req("POST",   "/tickets", data),
    update:  (id, data) => req("PUT",    `/tickets/${id}`, data),
    remove:  (id)       => req("DELETE", `/tickets/${id}`),
    bulkUpdate: (ids, patch) => req("PATCH", "/tickets/bulk", { ids, patch }),
    links:   (id)       => req("GET",    `/tickets/${id}/links`),
    addLink: (id, data) => req("POST",   `/tickets/${id}/links`, data),
    removeLink: (id)    => req("DELETE", `/ticket-links/${id}`),
    testedBy: (id)      => req("GET",    `/tickets/${id}/tested-by`),
    comments:      (id)       => req("GET",    `/tickets/${id}/comments`),
    addComment:    (id, data) => req("POST",   `/tickets/${id}/comments`, data),
    removeComment: (id, cid)  => req("DELETE", `/tickets/${id}/comments/${cid}`),
    attachments:      (id)       => req("GET",    `/tickets/${id}/attachments`),
    addAttachment:    (id, data) => req("POST",   `/tickets/${id}/attachments`, data),
    removeAttachment: (attId)    => req("DELETE", `/attachments/${attId}`),
    labels:      (id)          => req("GET",    `/tickets/${id}/labels`),
    addLabel:    (id, label)   => req("POST",   `/tickets/${id}/labels`, { label }),
    removeLabel: (labelId)     => req("DELETE", `/ticket-labels/${labelId}`),
    downloadAttachment: async (attId, filename) => {
      const res = await fetch(`/api/attachments/${attId}/download`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    },
  },

  testItems: {
    list:    (p = {})   => req("GET",    `/test-items${Object.keys(p).length ? "?" + new URLSearchParams(p) : ""}`),
    create:  (data)     => req("POST",   "/test-items", data),
    update:  (id, data) => req("PUT",    `/test-items/${id}`, data),
    remove:  (id)       => req("DELETE", `/test-items/${id}`),
    storyLinks:      (id)       => req("GET",    `/test-items/${id}/story-links`),
    addStoryLink:    (id, data) => req("POST",   `/test-items/${id}/story-links`, data),
    removeStoryLink: (id)       => req("DELETE", `/test-case-links/${id}`),
    copy:            (ids, projectId) => req("POST", "/test-items/copy", { ids, projectId }),
    dataRows:      (id)       => req("GET",    `/test-items/${id}/data-rows`),
    addDataRow:    (id, data) => req("POST",   `/test-items/${id}/data-rows`, data),
    updateDataRow: (id, data) => req("PUT",    `/data-rows/${id}`, data),
    removeDataRow: (id)       => req("DELETE", `/data-rows/${id}`),
  },

  kbProjects: {
    list:   ()           => req("GET",    "/kb/projects"),
    create: (data)       => req("POST",   "/kb/projects", data),
    update: (id, data)   => req("PUT",    `/kb/projects/${id}`, data),
    remove: (id)         => req("DELETE", `/kb/projects/${id}`),
  },

  versions: {
    list:   (projectId)       => req("GET",    `/kb/projects/${projectId}/versions`),
    create: (projectId, data) => req("POST",   `/kb/projects/${projectId}/versions`, data),
    update: (id, data)        => req("PUT",    `/kb/versions/${id}`, data),
    remove: (id)              => req("DELETE", `/kb/versions/${id}`),
  },

  kbColumns: {
    list:    (projectId)            => req("GET",   `/kb/projects/${projectId}/columns`),
    create:  (projectId, data)      => req("POST",  `/kb/projects/${projectId}/columns`, data),
    update:  (id, data)             => req("PUT",   `/kb/columns/${id}`, data),
    reorder: (projectId, order)     => req("PATCH", `/kb/projects/${projectId}/columns`, { order }),
    remove:  (id)                   => req("DELETE", `/kb/columns/${id}`),
  },

  sprints: {
    list:      (projectId)       => req("GET",   `/kb/projects/${projectId}/sprints`),
    create:    (projectId, data) => req("POST",  `/kb/projects/${projectId}/sprints`, data),
    update:    (id, data)        => req("PUT",   `/kb/sprints/${id}`, data),
    remove:    (id)              => req("DELETE", `/kb/sprints/${id}`),
    burndown:  (id)               => req("GET",   `/kb/sprints/${id}/burndown`),
  },

  notifications: {
    list:        ()     => req("GET",   "/notifications"),
    markRead:    (id)   => req("PATCH", `/notifications/${id}/read`, {}),
    markAllRead: ()     => req("PATCH", "/notifications/read-all", {}),
  },

  approvals: {
    request: id => req("PATCH", `/tickets/${id}/request-approval`, {}),
    approve: id => req("PATCH", `/tickets/${id}/approve`, {}),
    reject:  id => req("PATCH", `/tickets/${id}/reject`, {}),
  },

  savedFilters: {
    list:   (entityType) => req("GET", `/saved-filters${entityType ? "?entityType=" + entityType : ""}`),
    create: (data)        => req("POST", "/saved-filters", data),
    remove: (id)           => req("DELETE", `/saved-filters/${id}`),
  },

  dashboardWidgets: {
    list:    ()          => req("GET",    "/dashboard/widgets"),
    create:  (data)      => req("POST",   "/dashboard/widgets", data),
    reorder: (order)     => req("PATCH",  "/dashboard/widgets/reorder", { order }),
    remove:  (id)        => req("DELETE", `/dashboard/widgets/${id}`),
  },

  workLogs: {
    list:    (ticketId)       => req("GET",    `/tickets/${ticketId}/work-logs`),
    create:  (ticketId, data) => req("POST",   `/tickets/${ticketId}/work-logs`, data),
    remove:  (id)             => req("DELETE", `/work-logs/${id}`),
    summary: ()               => req("GET",    "/work-logs/summary"),
  },

  baselines: {
    list:   (projectId)       => req("GET",  `/kb/projects/${projectId}/baselines`),
    create: (projectId, data) => req("POST", `/kb/projects/${projectId}/baselines`, data),
    get:    (id)               => req("GET",  `/baselines/${id}`),
    remove: (id)               => req("DELETE", `/baselines/${id}`),
  },
};

// Aliases — KanbanPage uses api.kbVersions; ReleasesPage uses api.projects
api.kbVersions = api.versions;
api.projects   = api.kbProjects;
