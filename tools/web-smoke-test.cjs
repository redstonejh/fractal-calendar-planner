'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const port = 43000 + Math.floor(Math.random() * 1000);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractal-web-test-'));
const root = path.resolve(__dirname, '..');
const adminPassword = 'Test-Admin-2026!';
const child = spawn(process.execPath, ['status-monitor-web/server.js'], {
  cwd: root,
  env: {
    ...process.env,
    FRACTAL_WEB_PORT: String(port),
    FRACTAL_DATA_DIR: dataDir,
    FRACTAL_ADMIN_USERNAME: 'admin',
    FRACTAL_ADMIN_PASSWORD: adminPassword,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', (chunk) => { output += chunk; });
child.stderr.on('data', (chunk) => { output += chunk; });

const base = `http://127.0.0.1:${port}`;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) return;
    } catch {}
    if (child.exitCode !== null) throw new Error(`Server exited early:\n${output}`);
    await sleep(100);
  }
  throw new Error(`Server did not become ready:\n${output}`);
}

function client() {
  let cookie = '';
  return async (pathname, options = {}) => {
    const response = await fetch(`${base}${pathname}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(options.headers || {}),
      },
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';', 1)[0];
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await response.json() : await response.text();
    return { response, body };
  };
}

const jsonBody = (value) => JSON.stringify(value);

(async () => {
  try {
    await waitForServer();
    const anonymous = client();

    let result = await anonymous('/healthz');
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body, { ok: true, status: 'live' });

    result = await anonymous('/');
    assert.equal(result.response.status, 200);
    assert.match(result.body, /<title>Fractal Calendar<\/title>/);
    assert.match(result.body, /web-bridge\.js/);

    result = await anonymous('/web-bridge.js');
    assert.equal(result.response.status, 200);
    assert.match(result.body, /window\.auth/);

    result = await anonymous('/missing-file');
    assert.equal(result.response.status, 404);

    result = await anonymous('/api/auth/session');
    assert.equal(result.body.user, null);

    result = await anonymous('/api/auth/login', {
      method: 'POST',
      body: jsonBody({ username: 'admin', password: 'wrong-password' }),
    });
    assert.equal(result.response.status, 401);

    const admin = client();
    result = await admin('/api/auth/login', {
      method: 'POST',
      body: jsonBody({ username: 'admin', password: adminPassword }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.user.isAdmin, true);

    result = await admin('/api/auth/session');
    assert.equal(result.body.user.username, 'admin');

    result = await admin('/api/auth/users', {
      method: 'POST',
      body: jsonBody({
        username: 'managed-viewer',
        password: 'Temporary-2026!',
        canManageUsers: false,
        visibleCompanies: ['example'],
      }),
    });
    assert.equal(result.response.status, 201);

    result = await admin('/api/auth/users');
    assert.equal(result.response.status, 200);
    assert.ok(result.body.users.some((user) => user.username === 'managed-viewer' && user.mustChangePassword));

    const viewer = client();
    result = await viewer('/api/auth/login', {
      method: 'POST',
      body: jsonBody({ username: 'managed-viewer', password: 'Temporary-2026!' }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.user.mustChangePassword, true);

    result = await viewer('/api/auth/set-password', {
      method: 'POST',
      body: jsonBody({ password: 'Viewer-Changed-2026!' }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.user.mustChangePassword, false);

    result = await viewer('/api/auth/users');
    assert.equal(result.response.status, 403);

    result = await admin('/api/auth/users/managed-viewer', {
      method: 'PATCH',
      body: jsonBody({ canManageUsers: true }),
    });
    assert.equal(result.response.status, 200);

    result = await admin('/api/auth/users/managed-viewer', { method: 'DELETE' });
    assert.equal(result.response.status, 200);

    const registered = client();
    result = await registered('/api/auth/register', {
      method: 'POST',
      body: jsonBody({ username: 'self-viewer', password: 'Self-Register-2026!' }),
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.user.mustChangePassword, false);

    result = await registered('/api/auth/logout', { method: 'POST', body: '{}' });
    assert.equal(result.response.status, 200);
    result = await registered('/api/auth/session');
    assert.equal(result.body.user, null);

    const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8'));
    assert.ok(persisted.users.some((user) => user.username === 'self-viewer'));
    assert.ok(!persisted.users.some((user) => user.username === 'managed-viewer'));

    console.log('Web smoke tests passed: static HTTP, health, authentication, authorization, account management, and persistence.');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else {
        child.once('exit', resolve);
        setTimeout(resolve, 1500);
      }
    });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
