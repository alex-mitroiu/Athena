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

  tickets: {
    list:    (p = {})   => req("GET",    `/tickets${Object.keys(p).length ? "?" + new URLSearchParams(p) : ""}`),
    create:  (data)     => req("POST",   "/tickets", data),
    update:  (id, data) => req("PUT",    `/tickets/${id}`, data),
    remove:  (id)       => req("DELETE", `/tickets/${id}`),
    links:   (id)       => req("GET",    `/tickets/${id}/links`),
    addLink: (id, data) => req("POST",   `/tickets/${id}/links`, data),
    removeLink: (id)    => req("DELETE", `/ticket-links/${id}`),
    testedBy: (id)      => req("GET",    `/tickets/${id}/tested-by`),
  },

  testItems: {
    list:    (p = {})   => req("GET",    `/test-items${Object.keys(p).length ? "?" + new URLSearchParams(p) : ""}`),
    create:  (data)     => req("POST",   "/test-items", data),
    update:  (id, data) => req("PUT",    `/test-items/${id}`, data),
    remove:  (id)       => req("DELETE", `/test-items/${id}`),
    storyLinks:      (id)       => req("GET",    `/test-items/${id}/story-links`),
    addStoryLink:    (id, data) => req("POST",   `/test-items/${id}/story-links`, data),
    removeStoryLink: (id)       => req("DELETE", `/test-case-links/${id}`),
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
};

// Aliases — KanbanPage uses api.kbVersions; ReleasesPage uses api.projects
api.kbVersions = api.versions;
api.projects   = api.kbProjects;
