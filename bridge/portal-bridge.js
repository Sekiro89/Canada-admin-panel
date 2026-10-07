'use strict';
// Portal bridge — runs INSIDE one portal's tree (cwd = that tree, env = that portal's .env), so every
// read and write goes through the portal's own lib/settings.js (its encryption, its cache rules) and
// lib/billing.js (its webhook URL, events, prices, Stripe client). The dashboard never re-implements
// any of that. One JSON request on stdin → one JSON line on stdout. Secrets are never printed.
//
//   actions: status | check | testKey {key} | save {values} | clear | webhook | prices
const path = require('path');

const root = process.cwd();
const settings = require(path.join(root, 'lib/settings'));
const billing = require(path.join(root, 'lib/billing'));
const db = require(path.join(root, 'lib/db'));

const KEYS = ['stripe_secret_key', 'stripe_publishable_key', 'stripe_webhook_secret'];
const errMessage = (e) => (e && (e.message || String(e))) || 'unknown error';

async function status() {
  const keys = {};
  for (const k of KEYS) {
    const v = await settings.get(k);
    keys[k] = { set: !!v, masked: settings.mask(v), source: v ? await settings.source(k) : 'default' };
  }
  const secret = await settings.get('stripe_secret_key');
  const publicUrl = await billing.publicUrl();
  const row = await db.one(`SELECT max(updated_at) AS at FROM settings WHERE key = ANY($1)`, [KEYS]);
  return {
    billingMode: await billing.mode(),
    keyMode: billing.keyMode(secret),
    publicUrl,
    webhookUrl: `${publicUrl}/billing/webhook`,
    webhookEvents: billing.WEBHOOK_EVENTS,
    keys,
    updatedAt: row && row.at ? new Date(row.at).toISOString() : null,
  };
}

async function check() {
  const connection = await billing.testConnection();
  const url = `${await billing.publicUrl()}/billing/webhook`;
  const webhook = { ok: false, exists: false, id: null, status: null, url, missingEvents: [], secretSaved: !!(await settings.get('stripe_webhook_secret')), error: null };
  const client = await billing.stripe();
  if (!client) webhook.error = 'No Stripe secret key is saved for this portal.';
  else {
    try {
      const ep = await billing.ensureWebhook(client, url, { create: false, log: () => {} });
      if (ep) {
        const ev = ep.enabled_events || [];
        Object.assign(webhook, { exists: true, id: ep.id, status: ep.status || null,
          missingEvents: billing.WEBHOOK_EVENTS.filter((e) => !ev.includes(e) && !ev.includes('*')) });
        webhook.ok = webhook.missingEvents.length === 0 && webhook.secretSaved && ep.status !== 'disabled';
      } else webhook.error = 'No webhook for this portal exists in its Stripe account yet.';
    } catch (e) { webhook.error = errMessage(e); }
  }
  const cat = await billing.catalogStatus();
  return { connection, webhook, prices: { ok: !!cat.ok, missing: cat.missing || [], error: cat.error || null } };
}

// Ask Stripe whether a key works BEFORE it is saved. Uses the portal's own stripe package.
async function testKey({ key }) {
  const Stripe = require(path.join(root, 'node_modules/stripe'));
  const client = Stripe(String(key || ''));
  try {
    const a = await client.accounts.retrieve();
    const bp = a.business_profile || {};
    return { ok: true, account: { id: a.id, business_name: bp.name || (a.settings && a.settings.dashboard && a.settings.dashboard.display_name) || null, email: a.email || null } };
  } catch (e) {
    if (e && (e.type === 'StripeAuthenticationError' || e.statusCode === 401)) return { ok: false, error: `Stripe rejected this key: ${errMessage(e)}` };
    try { await client.balance.retrieve(); return { ok: true, account: null }; }   // restricted keys
    catch (e2) { return { ok: false, error: errMessage(e2) }; }
  }
}

async function save({ values }) {
  const saved = [];
  for (const k of KEYS) {
    if (typeof values[k] === 'string' && values[k] !== '') { await settings.set(k, values[k], null); saved.push(k); }
  }
  return { saved };
}

async function clear() {
  for (const k of KEYS) await settings.set(k, '', null);
  return { envFallback: !!(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_WEBHOOK_SECRET) };
}

async function webhook() {
  const r = await billing.createWebhookEndpoint(null, { saveSecret: true });
  return { ok: !!r.ok, id: r.id || null, url: r.url, created: !!r.created, secretSaved: !!r.secret_saved || (!!r.ok && !r.created && !!(await settings.get('stripe_webhook_secret'))),
    events: r.events || billing.WEBHOOK_EVENTS, note: r.note || null, error: r.error || null };   // r.secret is deliberately dropped
}

async function prices() {
  const r = await billing.setupCatalog();
  return { ok: !!r.ok, created: r.created || [], existing: r.existing || [], error: r.error || null };
}

const ACTIONS = { status, check, testKey, save, clear, webhook, prices };

let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', async () => {
  let out;
  try {
    const req = JSON.parse(input || '{}');
    const fn = ACTIONS[req.action];
    if (!fn) throw new Error(`unknown action ${req.action}`);
    out = { ok: true, result: await fn(req.args || {}) };
  } catch (e) { out = { ok: false, error: errMessage(e) }; }
  process.stdout.write('\n' + JSON.stringify(out) + '\n');
  try { await db.pool.end(); } catch {}
  process.exit(0);   // billing/mail may hold timers; this is a one-shot process
});
