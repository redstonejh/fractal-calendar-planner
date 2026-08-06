'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PORT = positiveInteger(process.env.FRACTAL_WEB_PORT, 8080);
const DATA_DIR = path.resolve(process.env.FRACTAL_DATA_DIR || path.join(__dirname, 'data'));
const SESSION_TTL_MS = positiveInteger(process.env.FRACTAL_SESSION_TTL_MS, 24 * 60 * 60 * 1000);
const COOKIE_SECURE = /^(1|true|yes)$/i.test(process.env.FRACTAL_COOKIE_SECURE || '');
const ADMIN_USERNAME = String(process.env.FRACTAL_ADMIN_USERNAME || 'admin').trim();
const ADMIN_PASSWORD = String(process.env.FRACTAL_ADMIN_PASSWORD || 'admin1');
const PUBLIC_DIR = path.resolve(__dirname, '..', 'dashboard');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const sessions = new Map();

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 64).toString('hex') };
}

function verifyPassword(password, user) {
  if (!user?.salt || !user?.hash) return false;
  const actual = Buffer.from(hashPassword(password, user.salt).hash, 'hex');
  const expected = Buffer.from(user.hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    const parsed = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    if (Array.isArray(parsed.users) && parsed.users.length) return parsed;
  } catch {}
  const store = {
    users: [{
      username: ADMIN_USERNAME || 'admin',
      isAdmin: true,
      permissions: { canManageUsers: true },
      visibleCompanies: null,
      mustChangePassword: false,
      ...hashPassword(ADMIN_PASSWORD),
    }],
  };
  writeStore(store);
  return store;
}

function writeStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${USERS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, USERS_FILE);
}

function findUser(store, username) {
  const key = String(username || '').trim().toLowerCase();
  return store.users.find((user) => user.username.toLowerCase() === key) || null;
}

function publicUser(user) {
  if (!user) return null;
  const canManageUsers = !!(user.isAdmin || user.permissions?.canManageUsers);
  return {
    username: user.username,
    isAdmin: !!user.isAdmin,
    permissions: { canManageUsers },
    visibleCompanies: canManageUsers ? null : (Array.isArray(user.visibleCompanies) ? user.visibleCompanies : []),
    mustChangePassword: !!user.mustChangePassword,
  };
}

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? ['', ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function currentUser(req) {
  const token = cookies(req).fractal_session;
  const session = token && sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return findUser(ensureStore(), session.username);
}

function createSession(res, username) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { username, expiresAt: Date.now() + SESSION_TTL_MS });
  res.setHeader('Set-Cookie', `fractal_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${COOKIE_SECURE ? '; Secure' : ''}`);
}

function clearSession(req, res) {
  const token = cookies(req).fractal_session;
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', `fractal_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${COOKIE_SECURE ? '; Secure' : ''}`);
}

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw Object.assign(new Error('Request is too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 });
  }
}

function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) json(res, 401, { ok: false, error: 'Not signed in' });
  return user;
}

function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (!(user.isAdmin || user.permissions?.canManageUsers)) {
    json(res, 403, { ok: false, error: 'Administrator access is required' });
    return null;
  }
  return user;
}

function validateCredentials(username, password) {
  const name = String(username || '').trim();
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name)) return { error: 'Username must use 1-64 letters, numbers, dots, dashes, or underscores' };
  if (String(password || '').length < 8) return { error: 'Password must be at least 8 characters' };
  return { name };
}

async function authRoute(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/auth/session') {
    return json(res, 200, { user: publicUser(currentUser(req)) });
  }
  if (req.method === 'POST' && pathname === '/api/auth/login') {
    const body = await readBody(req);
    const user = findUser(ensureStore(), body.username);
    if (!user || !verifyPassword(body.password, user)) return json(res, 401, { ok: false, error: 'Incorrect username or password' });
    createSession(res, user.username);
    return json(res, 200, { ok: true, user: publicUser(user) });
  }
  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    clearSession(req, res);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && pathname === '/api/auth/register') {
    const body = await readBody(req);
    const check = validateCredentials(body.username, body.password);
    if (check.error) return json(res, 400, { ok: false, error: check.error });
    const store = ensureStore();
    if (findUser(store, check.name)) return json(res, 409, { ok: false, error: 'That username is already taken' });
    const user = {
      username: check.name,
      isAdmin: false,
      permissions: { canManageUsers: false },
      visibleCompanies: [],
      mustChangePassword: false,
      ...hashPassword(body.password),
    };
    store.users.push(user);
    writeStore(store);
    createSession(res, user.username);
    return json(res, 201, { ok: true, user: publicUser(user) });
  }
  return usersRoute(req, res, pathname);
}

// Kept separate so a password request body is consumed exactly once.
async function setPassword(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  const body = await readBody(req);
  if (String(body.password || '').length < 8) return json(res, 400, { ok: false, error: 'Password must be at least 8 characters' });
  const store = ensureStore();
  const target = findUser(store, user.username);
  Object.assign(target, hashPassword(body.password), { mustChangePassword: false });
  writeStore(store);
  return json(res, 200, { ok: true, user: publicUser(target) });
}

async function usersRoute(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/auth/users') {
    if (!requireAdmin(req, res)) return;
    return json(res, 200, { ok: true, users: ensureStore().users.map(publicUser) });
  }
  if (req.method === 'POST' && pathname === '/api/auth/users') {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const check = validateCredentials(body.username, body.password);
    if (check.error) return json(res, 400, { ok: false, error: check.error });
    const store = ensureStore();
    if (findUser(store, check.name)) return json(res, 409, { ok: false, error: 'That username is already taken' });
    store.users.push({
      username: check.name,
      isAdmin: false,
      permissions: { canManageUsers: !!body.canManageUsers },
      visibleCompanies: Array.isArray(body.visibleCompanies) ? body.visibleCompanies.map(String) : [],
      mustChangePassword: true,
      ...hashPassword(body.password),
    });
    writeStore(store);
    return json(res, 201, { ok: true });
  }
  const match = pathname.match(/^\/api\/auth\/users\/([^/]+)$/);
  if (!match || !['PATCH', 'DELETE'].includes(req.method)) return json(res, 404, { ok: false, error: 'Not found' });
  if (!requireAdmin(req, res)) return;
  const username = decodeURIComponent(match[1]);
  const store = ensureStore();
  const target = findUser(store, username);
  if (!target) return json(res, 404, { ok: false, error: 'No such account' });
  if (req.method === 'DELETE') {
    if (target.isAdmin) return json(res, 400, { ok: false, error: 'The primary administrator cannot be deleted' });
    store.users = store.users.filter((user) => user !== target);
    writeStore(store);
    return json(res, 200, { ok: true });
  }
  const body = await readBody(req);
  if (!target.isAdmin && body.canManageUsers !== undefined) target.permissions = { canManageUsers: !!body.canManageUsers };
  if (!target.isAdmin && Array.isArray(body.visibleCompanies)) target.visibleCompanies = body.visibleCompanies.map(String);
  if (body.password !== undefined) {
    if (String(body.password).length < 8) return json(res, 400, { ok: false, error: 'Password must be at least 8 characters' });
    Object.assign(target, hashPassword(body.password));
  }
  writeStore(store);
  return json(res, 200, { ok: true });
}

function serveStatic(req, res, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return json(res, 400, { ok: false, error: 'Bad path' }); }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const target = path.resolve(PUBLIC_DIR, relative);
  if (target !== PUBLIC_DIR && !target.startsWith(`${PUBLIC_DIR}${path.sep}`)) return json(res, 403, { ok: false, error: 'Forbidden' });
  let stat;
  try { stat = fs.statSync(target); } catch { return json(res, 404, { ok: false, error: 'Not found' }); }
  if (!stat.isFile()) return json(res, 404, { ok: false, error: 'Not found' });
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': path.basename(target) === 'index.html' ? 'no-cache' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(target).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { ok: true, status: 'live' });
    if (url.pathname === '/api/auth/set-password' && req.method === 'POST') return setPassword(req, res);
    if (url.pathname.startsWith('/api/auth/')) return authRoute(req, res, url.pathname);
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { ok: false, error: 'Method not allowed' }, { Allow: 'GET, HEAD' });
    return serveStatic(req, res, url.pathname);
  } catch (error) {
    return json(res, error.statusCode || 500, { ok: false, error: error.statusCode ? error.message : 'Internal server error' });
  }
});

ensureStore();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Fractal Calendar web server listening on 0.0.0.0:${PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
