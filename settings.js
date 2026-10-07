// Payment settings for every portal — the HTTP side of docs/SETTINGS-API.md.
// Reads and writes happen in bridge/portal-bridge.js, run inside each portal's own tree with its own
// .env, so each portal's encryption, webhook and price logic stays the single source of truth.
//
// Anything that touches LIVE payments (a portal taking real money, or a live sk_/rk_ key, old or new)
// needs the second "live-change" password (scrypt hash in .env as LIVE_PASSWORD_HASH), checked here.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const PORTALS = require('./portals');

const BRIDGE = path.join(__dirname, 'bridge', 'portal-bridge.js');
const AUDIT = path.join(__dirname, 'data', 'settings-audit.jsonl');
const BODY_LIMIT = 16 * 1024;

// ---------------------------------------------------------------- the bridge
// The portal's .env exactly as its systemd unit reads it (EnvironmentFile: KEY=VALUE, optional quotes).
// Built from scratch so the dashboard's own database login never reaches portal code.
function portalEnv(p) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME || '/root' };
  for (const line of fs.readFileSync(p.envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  if (p.envOverride) Object.assign(env, p.envOverride);   // tests only: point at a scratch database
  env.NODE_ENV = 'production';   // the units run production; never let the bridge use fake Stripe
  return env;
}

// One request at a time per portal, so two clicks cannot interleave writes.
const queues = new Map();
function bridge(p, action, args = {}, timeoutMs = 30000) {
  const prev = queues.get(p.key) || Promise.resolve();
  const run = prev.catch(() => {}).then(() => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BRIDGE], { cwd: p.tree, env: portalEnv(p), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${p.name} did not answer within ${timeoutMs / 1000}s`)); }, timeoutMs);
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', () => {
      clearTimeout(timer);
      const last = out.trim().split('\n').pop() || '';
      let msg;
      try { msg = JSON.parse(last); } catch { console.error(`[settings] ${p.key} ${action}: no JSON answer`, err.slice(-500)); return reject(new Error(`${p.name}: no answer from its code`)); }
      if (!msg.ok) return reject(new Error(msg.error || 'failed'));
      resolve(msg.result);
    });
    child.stdin.end(JSON.stringify({ action, args }));
  }));
  queues.set(p.key, run);
  return run;
}

// ---------------------------------------------------------------- live-change password
// Stored as "scrypt:<salt b64>:<hash b64>". Five wrong tries from one address locks it for 15 minutes.
const FAILS = new Map();
const LOCK_AFTER = 5, LOCK_MS = 15 * 60 * 1000;
function locked(ip) {
  const f = FAILS.get(ip);
  return !!f && f.count >= LOCK_AFTER && Date.now() - f.at < LOCK_MS;
}
function checkPassword(ip, given) {
  const [, salt, hash] = (process.env.LIVE_PASSWORD_HASH || '').split(':');
  if (!salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(String(given || ''), Buffer.from(salt, 'base64'), want.length);
  const ok = crypto.timingSafeEqual(got, want);
  if (ok) FAILS.delete(ip);
  else {
    const f = FAILS.get(ip) || { count: 0, at: 0 };
    f.count = Date.now() - f.at > LOCK_MS ? 1 : f.count + 1; f.at = Date.now();
    FAILS.set(ip, f);
  }
  return ok;
}
// Caddy appends the address it saw as the LAST X-Forwarded-For entry; earlier entries can be forged by the browser.
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').pop().trim();

// Returns null when allowed, or [status, body] to send.
function liveGate(req, body, why) {
  if (!body.password) return [409, { error: `${why} Enter the live-change password to continue.`, needsPassword: true }];
  const ip = clientIp(req);
  if (locked(ip)) return [429, { error: 'Too many wrong passwords. Try again in 15 minutes.', needsPassword: true }];
  if (!checkPassword(ip, body.password)) return [403, { error: 'That live-change password is not right.', needsPassword: true }];
  return null;
}

// ---------------------------------------------------------------- helpers
const publicPortal = (p, status, error = null) => ({
  key: p.key, name: p.name, domain: p.domain, liveMoney: !!p.liveMoney, notes: p.notes || [],
  ...(status || { billingMode: null, keyMode: null, publicUrl: null, webhookUrl: null, webhookEvents: [], keys: {}, updatedAt: null }),
  error,
});
async function portalStatus(p) {
  try { return publicPortal(p, await bridge(p, 'status')); }
  catch (e) { return publicPortal(p, null, e.message); }
}

const FORMATS = {
  stripe_secret_key: { re: /^(sk|rk)_(test|live)_[0-9A-Za-z]{10,}$/, hint: 'a secret key starts with sk_test_, sk_live_, rk_test_ or rk_live_' },
  stripe_publishable_key: { re: /^pk_(test|live)_[0-9A-Za-z]{10,}$/, hint: 'a publishable key starts with pk_test_ or pk_live_' },
  stripe_webhook_secret: { re: /^whsec_[0-9A-Za-z+/=]{10,}$/, hint: 'a webhook signing secret starts with whsec_' },
};
const modeOf = (v) => { const m = /^(?:sk|rk|pk)_(test|live)/.exec(v || ''); return m ? m[1] : null; };
const maskOf = (v) => (!v ? '' : v.length <= 8 ? '••••' : `${v.slice(0, 7)}••••${v.slice(-4)}`);
const isLive = (p, status) => !!p.liveMoney || status.keyMode === 'live';

function audit(entry) {
  try {
    fs.mkdirSync(path.dirname(AUDIT), { recursive: true, mode: 0o700 });
    fs.appendFileSync(AUDIT, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 });
  } catch (e) { console.error('[settings] audit write failed', e.message); }
}
// Basic-auth user that Caddy let through (username only, never the password).
function whoami(req) {
  const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!m) return null;
  try { return Buffer.from(m[1], 'base64').toString('utf8').split(':')[0] || null; } catch { return null; }
}

// The portals' own messages point at their /admin/integrations page; everything is done here instead.
const reword = (v) => (typeof v === 'string' ? v.replace(/No Stripe secret key configured[^.]*?save first\./g, 'No Stripe secret key is saved for this portal yet. Add its secret key under API keys first.') : v);
const scrub = (o) => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? reword(v) : Array.isArray(v) ? v : scrub(v)])) : o);

function send(res, code, body) {
  body = scrub(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  res.end(JSON.stringify(body));
}
const fail = (res, code, error, extra = {}) => send(res, code, { error, ...extra });

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0, buf = '';
    req.on('data', (c) => { size += c.length; if (size > BODY_LIMIT) { reject(new Error('too large')); req.destroy(); } else buf += c; });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

// CSRF guard: basic auth is sent by the browser automatically, so a POST must also prove it came from
// our own page (custom header + JSON + same origin).
function csrfOk(req) {
  if (req.headers['x-dashboard'] !== '1') return false;
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return false;
  const origin = req.headers.origin;
  if (origin && origin !== `https://${req.headers.host}`) return false;
  return true;
}

// ---------------------------------------------------------------- routes
// Returns true when it handled the request.
async function handle(req, res, portals = PORTALS) {
  const url = req.url.split('?')[0];
  if (url === '/api/settings' && req.method === 'GET') {
    send(res, 200, { enabled: true, portals: await Promise.all(portals.map(portalStatus)) });
    return true;
  }
  const m = /^\/api\/settings\/([a-z0-9]+)\/(check|keys|disconnect|webhook|prices)$/.exec(url);
  if (!m) return false;
  if (req.method !== 'POST') { fail(res, 405, 'Use POST.'); return true; }
  if (!csrfOk(req)) { fail(res, 403, 'This request did not come from the dashboard page.'); return true; }
  const p = portals.find((x) => x.key === m[1]);
  if (!p) { fail(res, 404, 'Unknown portal.'); return true; }
  let body;
  try { body = await readJson(req); } catch { fail(res, 400, 'The request body was not valid JSON.'); return true; }
  const action = m[2];
  const user = whoami(req);

  try {
    if (action === 'check') { send(res, 200, await bridge(p, 'check', {}, 45000)); return true; }

    const current = await bridge(p, 'status');

    if (action === 'keys') {
      const values = {};
      for (const k of Object.keys(FORMATS)) {
        const v = typeof body[k] === 'string' ? body[k].trim() : '';
        if (!v) continue;
        if (!FORMATS[k].re.test(v)) { fail(res, 400, `That doesn’t look right: ${FORMATS[k].hint}.`); return true; }
        values[k] = v;
      }
      if (!Object.keys(values).length) { fail(res, 400, 'Nothing to save: every field was empty.'); return true; }
      const curPubMode = modeOf(current.keys.stripe_publishable_key && current.keys.stripe_publishable_key.masked);
      const newSecretMode = values.stripe_secret_key ? modeOf(values.stripe_secret_key) : current.keyMode;
      const newPubMode = values.stripe_publishable_key ? modeOf(values.stripe_publishable_key) : curPubMode;
      if (newSecretMode && newPubMode && newSecretMode !== newPubMode) {
        fail(res, 400, `The secret key is a ${newSecretMode} key but the publishable key is a ${newPubMode} key. Use both from the same mode (both test or both live).`);
        return true;
      }
      if (isLive(p, current) || newSecretMode === 'live') {
        const gate = liveGate(req, body, `This changes live payments on ${p.domain}.`);
        if (gate) { audit({ user, portal: p.key, action: 'keys', result: `blocked ${gate[0]}` }); send(res, ...gate); return true; }
      }
      if (values.stripe_secret_key) {
        const t = await bridge(p, 'testKey', { key: values.stripe_secret_key });
        if (!t.ok) {
          audit({ user, portal: p.key, action: 'keys', result: 'rejected by Stripe', error: t.error, keys: { stripe_secret_key: maskOf(values.stripe_secret_key) } });
          fail(res, 400, t.error);
          return true;
        }
      }
      const r = await bridge(p, 'save', { values });
      audit({ user, portal: p.key, action: 'keys', result: 'saved', keys: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, maskOf(v)])) });
      send(res, 200, { ok: true, saved: r.saved, portal: await portalStatus(p) });
      return true;
    }

    if (action === 'disconnect') {
      if (isLive(p, current)) {
        const gate = liveGate(req, body, `This stops live payments on ${p.domain}.`);
        if (gate) { audit({ user, portal: p.key, action: 'disconnect', result: `blocked ${gate[0]}` }); send(res, ...gate); return true; }
      } else if (body.confirm !== true) {
        fail(res, 409, `This switches ${p.domain} back to simulated payments. Confirm to continue.`, { needsConfirm: true });
        return true;
      }
      const r = await bridge(p, 'clear');
      audit({ user, portal: p.key, action: 'disconnect', result: 'cleared', envFallback: r.envFallback });
      send(res, 200, { ok: true, envFallback: r.envFallback, portal: await portalStatus(p) });
      return true;
    }

    // webhook | prices
    if (current.keyMode === 'live') {
      const gate = liveGate(req, body, `This writes to the live Stripe account of ${p.domain}.`);
      if (gate) { audit({ user, portal: p.key, action, result: `blocked ${gate[0]}` }); send(res, ...gate); return true; }
    }
    const r = await bridge(p, action, {}, 60000);
    audit(action === 'webhook'
      ? { user, portal: p.key, action, result: r.ok ? (r.created ? 'created' : 'exists') : 'error', id: r.id, url: r.url, secretSaved: r.secretSaved, error: r.error }
      : { user, portal: p.key, action, result: r.ok ? 'ok' : 'error', created: r.created, error: r.error });
    send(res, r.ok ? 200 : 400, r.ok ? r : { ...r, error: r.error || `Could not create the ${action}.` });
    return true;
  } catch (e) {
    console.error(`[settings] ${p.key} ${action}`, e.message);
    fail(res, 502, e.message);
    return true;
  }
}

module.exports = { handle, bridge };
