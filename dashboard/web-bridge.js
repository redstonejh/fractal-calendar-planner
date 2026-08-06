'use strict';

// Browser equivalents of the APIs normally supplied by Electron's preload.
// Load this before auth-ui.js; Electron skips it because those APIs already exist.
(() => {
  const request = async (path, options = {}) => {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    let body;
    try { body = await response.json(); } catch { body = { ok: false, error: 'Invalid server response' }; }
    if (!response.ok && body.ok === undefined) body.ok = false;
    return body;
  };

  if (!window.auth) {
    const listeners = new Set();
    const emit = (session) => listeners.forEach((callback) => {
      try { callback(session); } catch {}
    });
    window.auth = {
      session: () => request('/api/auth/session'),
      login: async (username, password) => {
        const result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
        if (result.ok) {
          localStorage.setItem('fractal-auth-username', result.user.username);
          emit({ user: result.user });
        }
        return result;
      },
      register: async (username, password) => {
        const result = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) });
        if (result.ok) {
          localStorage.setItem('fractal-auth-username', result.user.username);
          emit({ user: result.user });
        }
        return result;
      },
      setPassword: async (password) => {
        const result = await request('/api/auth/set-password', { method: 'POST', body: JSON.stringify({ password }) });
        if (result.ok) emit({ user: result.user });
        return result;
      },
      logout: async () => {
        const result = await request('/api/auth/logout', { method: 'POST', body: '{}' });
        if (result.ok) {
          localStorage.removeItem('fractal-auth-username');
          emit({ user: null });
        }
        return result;
      },
      listUsers: () => request('/api/auth/users'),
      createUser: (payload) => request('/api/auth/users', { method: 'POST', body: JSON.stringify(payload) }),
      updateUser: (username, data) => request(`/api/auth/users/${encodeURIComponent(username)}`, { method: 'PATCH', body: JSON.stringify(data) }),
      deleteUser: (username) => request(`/api/auth/users/${encodeURIComponent(username)}`, { method: 'DELETE' }),
      onChanged: (callback) => { if (typeof callback === 'function') listeners.add(callback); },
    };
  }

  if (!window.dashboard) {
    window.dashboard = {
      getStatus: async () => ({ status: null, connectionState: 'live' }),
      onStatus: () => {},
      onConnection: () => {},
      onCheck: () => {},
      onSetCompany: () => {},
      getHistory: async () => ({ ok: true, history: [] }),
      getCompanies: async () => [],
      getCompanyHistory: async () => ({ results: [], rollups: [] }),
      getViewerIps: async () => ({}),
      consumeCompanyFocus: async () => null,
      getSettings: async () => ({}),
      saveSettings: async () => ({ ok: true }),
      openExternal: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
      closeDashboard: () => window.close(),
      minimize: () => {},
    };
  }

  if (!window.tickets) {
    window.tickets = {
      list: async () => [],
      connectionState: async () => 'live',
      onChanged: () => {},
      onConnection: () => {},
      claim: async () => ({ ok: false, error: 'Tickets are not enabled' }),
      unclaim: async () => ({ ok: false, error: 'Tickets are not enabled' }),
      assign: async () => ({ ok: false, error: 'Tickets are not enabled' }),
      resolve: async () => ({ ok: false, error: 'Tickets are not enabled' }),
      reopen: async () => ({ ok: false, error: 'Tickets are not enabled' }),
      comment: async () => ({ ok: false, error: 'Tickets are not enabled' }),
      update: async () => ({ ok: false, error: 'Tickets are not enabled' }),
      create: async () => ({ ok: false, error: 'Tickets are not enabled' }),
      remove: async () => ({ ok: false, error: 'Tickets are not enabled' }),
    };
  }

  if (!window.electron) {
    window.electron = {
      platform: 'web',
      getSettings: async () => ({}),
      saveSettings: async () => ({ ok: true }),
      openExternal: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
      openDashboard: async () => ({ ok: true }),
    };
  }

  if (!window.dashboardPersistence) {
    // The existing consumer expects synchronous storage. Authentication writes
    // the username before reloading, matching Electron's per-load namespace.
    const username = String(localStorage.getItem('fractal-auth-username') || '_anon').replace(/[^a-z0-9_-]/gi, '_');
    const namespace = `fractal-layout--${username || '_anon'}--`;
    const key = (name) => `${namespace}${name}`;
    window.dashboardPersistence = {
      getItem: (name) => localStorage.getItem(key(name)),
      setItem: (name, value) => localStorage.setItem(key(name), String(value)),
      removeItem: (name) => localStorage.removeItem(key(name)),
      keys: () => {
        const result = [];
        for (let index = 0; index < localStorage.length; index += 1) {
          const item = localStorage.key(index);
          if (item?.startsWith(namespace)) result.push(item.slice(namespace.length));
        }
        return result;
      },
      clear: () => {
        for (const name of window.dashboardPersistence.keys()) localStorage.removeItem(key(name));
      },
    };
  }

  if (!window.dashboardWindowControls) {
    window.dashboardWindowControls = {
      reload: () => window.location.reload(),
      minimize: () => {},
      close: () => window.close(),
    };
  }
})();
