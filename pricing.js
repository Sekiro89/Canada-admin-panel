// Pricing plans for every portal — HTTP side. Each portal owns its plans (pricing_plans table + lib/plans.js,
// contract in /root/projects/ops/briefs/2026-10-16-brc-jobs-pricing.md §3); this module only relays through the
// same per-portal bridge as settings.js, so validation and GST maths live in ONE place: the portal.
//
//   GET  /api/pricing                      → { portals: [{ key, name, domain, available, plans, error }] }
//   POST /api/pricing/:key/save    { plan }                       → { plan }
//   POST /api/pricing/:key/active  { id, active }                 → { plan }
//   POST /api/pricing/:key/offer   { id, offer: { offer_price_cents|null, offer_label, offer_ends_at } } → { plan }
// Plan changes affect NEW purchases only (each subscription keeps its own price snapshot), so no live-change
// password; every change is audited.
const fs = require('fs');
const path = require('path');
const PORTALS = require('./portals');
const { bridge } = require('./settings');

const AUDIT = path.join(__dirname, 'data', 'pricing-audit.jsonl');
const BODY_LIMIT = 16 * 1024;

function audit(entry) {
  try {
    fs.mkdirSync(path.dirname(AUDIT), { recursive: true, mode: 0o700 });
    fs.appendFileSync(AUDIT, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 });
  } catch (e) { console.error('[pricing] audit write failed', e.message); }
}
function whoami(req) {
  const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!m) return null;
  try { return Buffer.from(m[1], 'base64').toString('utf8').split(':')[0] || null; } catch { return null; }
}
function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  res.end(JSON.stringify(body));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0, buf = '';
    req.on('data', (c) => { size += c.length; if (size > BODY_LIMIT) { reject(new Error('too large')); req.destroy(); } else buf += c; });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}
// Same CSRF guard as settings.js: custom header + JSON + same origin.
function csrfOk(req) {
  if (req.headers['x-dashboard'] !== '1') return false;
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return false;
  const origin = req.headers.origin;
  return !origin || origin === `https://${req.headers.host}`;
}

async function portalPlans(p) {
  const base = { key: p.key, name: p.name, domain: p.domain };
  try { const r = await bridge(p, 'plansList'); return { ...base, available: r.available, plans: r.plans, error: null }; }
  catch (e) { return { ...base, available: false, plans: [], error: e.message }; }
}

async function handle(req, res, portals = PORTALS) {
  const url = req.url.split('?')[0];
  if (url === '/api/pricing' && req.method === 'GET') {
    send(res, 200, { portals: await Promise.all(portals.map(portalPlans)) });
    return true;
  }
  const m = /^\/api\/pricing\/([a-z0-9]+)\/(save|active|offer)$/.exec(url);
  if (!m) return false;
  if (req.method !== 'POST') { send(res, 405, { error: 'Use POST.' }); return true; }
  if (!csrfOk(req)) { send(res, 403, { error: 'This request did not come from the dashboard page.' }); return true; }
  const p = portals.find((x) => x.key === m[1]);
  if (!p) { send(res, 404, { error: 'Unknown portal.' }); return true; }
  let body;
  try { body = await readJson(req); } catch { send(res, 400, { error: 'The request body was not valid JSON.' }); return true; }
  const user = whoami(req), action = m[2];
  try {
    let r;
    if (action === 'save') r = await bridge(p, 'planSave', { plan: body.plan || {} });
    else if (action === 'active') r = await bridge(p, 'planActive', { id: body.id, active: body.active });
    else r = await bridge(p, 'planOffer', { id: body.id, offer: body.offer || {} });
    audit({ user, portal: p.key, action, input: action === 'save' ? body.plan : body, result: 'ok', plan: r.plan });
    send(res, 200, r);
  } catch (e) {
    audit({ user, portal: p.key, action, input: action === 'save' ? body.plan : body, result: 'error', error: e.message });
    send(res, 400, { error: e.message });
  }
  return true;
}

module.exports = { handle };
