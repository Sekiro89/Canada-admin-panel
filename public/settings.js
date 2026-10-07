/* Direction A — Settings view: Stripe per portal. Contract: docs/SETTINGS-API.md. `?mock=1` uses an inline fixture and never touches the network for POSTs. */
import { esc, day } from '/shared/data.js';

const MOCK = new URLSearchParams(location.search).get('mock') === '1';
const FIELDS = [
  { id: 'stripe_secret_key', label: 'Secret key', secret: true, name: 'secret key' },
  { id: 'stripe_publishable_key', label: 'Publishable key', secret: false, name: 'publishable key' },
  { id: 'stripe_webhook_secret', label: 'Webhook signing secret', secret: true, name: 'webhook signing secret' },
];
const SOURCE = { db: 'saved here, encrypted in the portal', env: 'from the portal’s .env file', default: 'not set' };
const RX = {
  stripe_secret_key: /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/,
  stripe_publishable_key: /^pk_(test|live)_[A-Za-z0-9]+$/,
  stripe_webhook_secret: /^whsec_[A-Za-z0-9]+$/,
};
const modeOf = (v) => (/_(live)_/.test(v) ? 'live' : /_(test)_/.test(v) ? 'test' : null);

const svg = (d, cls = 'icon') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const I = {
  spin: svg('<path d="M20 11a8 8 0 1 0-2.34 5.66"/><path d="M20 4v7h-7"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  bad: svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>'),
  ok: svg('<path d="m5 12 5 5 9-10"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.1 6.1A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.5-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>'),
};

// ---------------------------------------------------------------- state
let ROOT = null;
let PORTALS = () => [];   // [{ name, domain }] from /api/data, for the fallback links
const S = { loaded: false, loading: false, error: null, order: [], P: new Map() };
// per portal: { p, check, busy: {}, msg: {}, confirm: null | { action, body } }

// ---------------------------------------------------------------- transport
async function getSettings() {
  if (MOCK) { await wait(400); return structuredClone(FIXTURE); }
  const r = await fetch('/api/settings', { cache: 'no-store' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || `The server answered ${r.status}.`), { off: r.status === 404 });
  if (d.enabled === false || !Array.isArray(d.portals)) throw Object.assign(new Error('off'), { off: true });
  return d;
}
async function post(key, action, body = {}) {
  if (MOCK) return mockPost(key, action, body);
  try {
    const r = await fetch(`/api/settings/${encodeURIComponent(key)}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dashboard': '1' }, body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({ error: `The server answered ${r.status} with no details.` }));
    return { status: r.status, ok: r.ok, data };
  } catch (e) {
    return { status: 0, ok: false, data: { error: `Could not reach the dashboard server (${e.message}).` } };
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- public API
export function openSettings(root, portals) {
  ROOT = root;
  if (portals) PORTALS = portals;
  if (!ROOT.dataset.wired) { wire(); ROOT.dataset.wired = '1'; }
  if (!S.loaded && !S.loading) load();
}
export function settingsDataReady() { if (ROOT && S.error && !S.loaded) renderAll(); }
export function reloadSettings() { if (ROOT && (S.loaded || S.error)) load(true); }

async function load(quiet = false) {
  S.loading = true;
  if (!quiet || !S.loaded) { S.error = null; renderAll(); }
  try {
    const d = await getSettings();
    const keys = d.portals.map((p) => p.key);
    const same = S.loaded && keys.join() === S.order.join();
    for (const p of d.portals) {
      const st = S.P.get(p.key);
      if (st) st.p = p; else S.P.set(p.key, { p, check: null, busy: {}, msg: {}, confirm: null });
    }
    S.order = keys; S.loaded = true; S.error = null;
    if (same) keys.forEach((k) => paint(k)); else renderAll();
  } catch (e) {
    S.error = { off: Boolean(e.off), text: e.off ? '' : (e.message || String(e)) };
    renderAll();
  } finally {
    S.loading = false;
    if (!S.error) ROOT.querySelector('[data-part=top-error]')?.replaceChildren();
  }
}

// ---------------------------------------------------------------- rendering
function renderAll() {
  if (!ROOT) return;
  const intro = `<p class="set__intro">Each portal has its own Stripe account. Keys are stored encrypted inside that portal,
    changes take effect within a few seconds, and secret keys are never shown again after you save them.</p>`;
  const mock = MOCK ? `<div class="notice notice--quiet" role="note">${I.info}<p><strong>Practice mode.</strong> This page is showing made-up settings; nothing you do here is sent to Stripe or the portals.</p></div>` : '';
  if (S.error && !S.loaded) { ROOT.innerHTML = offHTML(); return; }
  const err = S.error ? `<div class="notice notice--bad" role="alert">${I.bad}<p><strong>Could not refresh the payment settings.</strong> ${esc(S.error.text)}</p>
    <button type="button" class="btn btn--quiet" data-act="reload">Try again</button></div>` : '';
  let body;
  if (!S.loaded && !S.error) {
    body = Array.from({ length: 4 }, () => `<div class="pf"><div class="pf__head"><span class="sk sk--line" style="width:40%"></span></div>
      <span class="sk sk--line"></span><span class="sk sk--line sk--short"></span></div>`).join('');
  } else body = S.order.map(sectionHTML).join('');
  ROOT.innerHTML = `${intro}${mock}<div data-part="top-error">${err}</div><div class="pfs">${body}</div>`;
  if (S.loaded) S.order.forEach((k) => paint(k));
}

// Shown while the settings API is not switched on (404) or cannot be read: no forms, just where to go instead.
function offHTML() {
  const list = PORTALS();
  return `<div class="notice notice--quiet" role="status">${I.info}<p><strong>Payment settings aren’t switched on yet.</strong>
      Each portal’s Stripe keys are still managed in that portal’s own /admin/integrations page.</p></div>
    ${S.error.text ? `<p class="muted small set__why">${esc(S.error.text)} <button type="button" class="linkbtn" data-act="reload">Try again</button></p>` : ''}
    ${list.length ? `<ul class="offlinks">${list.map((p) => `<li><span>${esc(p.name)}</span>
      <a class="m" href="https://${esc(p.domain)}/admin/integrations" target="_blank" rel="noopener">${esc(p.domain)}/admin/integrations</a></li>`).join('')}</ul>` : ''}`;
}

function sectionHTML(key) {
  const { p } = S.P.get(key);
  const k = esc(key);
  const field = (f) => `<div class="kf">
      <div class="kf__top"><label class="field__l" for="${k}-${f.id}">${f.label}</label>
        <span class="kf__cur" data-part="cur-${f.id}"></span></div>
      <div class="kf__in">
        <input id="${k}-${f.id}" name="${f.id}" type="${f.secret ? 'password' : 'text'}" autocomplete="off" spellcheck="false"
          autocapitalize="off" autocorrect="off" placeholder="Leave empty to keep the current value" aria-describedby="${k}-${f.id}-hint">
        ${f.secret ? `<button type="button" class="btn btn--icon" data-act="toggle" data-for="${k}-${f.id}" aria-pressed="false" aria-label="Show ${f.name}">${I.eye}</button>` : ''}
      </div>
      <p class="kf__hint" id="${k}-${f.id}-hint" data-hint="${f.id}"></p>
    </div>`;
  return `<section class="pf" data-key="${k}" aria-labelledby="${k}-h">
    <header class="pf__head" data-part="head"></header>
    <div data-part="notes"></div>
    <div class="pf__row"><h3>Stripe account</h3><div data-part="check"></div></div>
    <div class="pf__row"><h3>API keys</h3>
      <form class="kform" data-form="keys" novalidate>
        <p class="kform__lead">Only fill in what you want to change — empty fields stay as they are. Copy keys from the Stripe dashboard under Developers → API keys.</p>
        ${FIELDS.map(field).join('')}
        <div class="actions"><button type="submit" class="btn btn--primary" data-act="save">Save keys</button></div>
        <div data-part="keys-msg" aria-live="polite"></div>
        <div data-part="keys-confirm"></div>
      </form>
    </div>
    <div class="pf__row"><h3>Webhook</h3><div data-part="webhook"></div></div>
    <div class="pf__row"><h3>Prices</h3><div data-part="prices"></div></div>
    <div class="pf__row pf__row--end"><h3><span class="vh">Disconnect ${esc(p.name)}</span></h3><div data-part="disconnect"></div></div>
  </section>`;
}

const sec = (key) => ROOT.querySelector(`.pf[data-key="${CSS.escape(key)}"]`);
function paint(key, parts) {
  const el = sec(key);
  if (!el) return;
  const st = S.P.get(key);
  const R = { head, notes, check, webhook, prices, disconnect, 'keys-msg': keysMsg, 'keys-confirm': (s) => confirmBox(s, 'keys') };
  for (const f of FIELDS) R[`cur-${f.id}`] = (s) => current(s, f);
  for (const name of parts || Object.keys(R)) {
    const box = el.querySelector(`[data-part="${name}"]`);
    if (box) box.innerHTML = R[name](st);
  }
  const save = el.querySelector('[data-act=save]');
  save.disabled = Boolean(st.busy.keys || st.confirm?.action === 'keys');
  save.innerHTML = st.busy.keys ? `${I.spin}<span>Saving…</span>` : 'Save keys';
  save.toggleAttribute('aria-busy', Boolean(st.busy.keys));
}

function status(p) {
  if (p.billingMode === 'sandbox') return `<span class="tag tag--neutral">Sandbox — payments are simulated</span>`;
  if (p.keyMode === 'live') return `<span class="tag tag--good">Live payments</span>`;
  if (p.keyMode === 'test') return `<span class="tag tag--info">Test mode</span>`;
  return `<span class="tag tag--neutral">Stripe, mode unknown</span>`;
}
function head({ p }) {
  return `<div class="pf__name"><h2 id="${esc(p.key)}-h">${esc(p.name)}</h2>
      <a class="pf__dom m" href="${esc(p.publicUrl || 'https://' + p.domain)}" target="_blank" rel="noopener">${esc(p.domain)}</a></div>
    <div class="pf__state">${status(p)}${p.liveMoney ? '<span class="live">Taking real payments</span>' : ''}
      ${p.updatedAt ? `<span class="pf__upd">Keys changed <span class="m">${esc(day(p.updatedAt))}</span></span>` : ''}</div>`;
}
function notes({ p }) {
  const list = [...(p.notes || []).map((n) => ['quiet', n])];
  if (p.error) list.unshift(['bad', p.error]);
  return list.length ? `<div class="pf__notes">${list.map(([t, n]) =>
    `<div class="notice notice--${t}" role="${t === 'bad' ? 'alert' : 'note'}">${t === 'bad' ? I.bad : I.info}<p>${esc(n)}</p></div>`).join('')}</div>` : '';
}
function current({ p }, f) {
  const k = p.keys?.[f.id] || { set: false, source: 'default' };
  return k.set ? `<span class="m">${esc(k.masked)}</span> <span class="muted">· ${esc(SOURCE[k.source] || k.source)}</span>` : '<span class="muted">Not set</span>';
}
const btn = (act, label, busyLabel, { busy, disabled, cls = '' } = {}) =>
  `<button type="button" class="btn ${cls}" data-act="${act}"${busy || disabled ? ' disabled' : ''}${busy ? ' aria-busy="true"' : ''}>${busy ? `${I.spin}<span>${busyLabel}</span>` : label}</button>`;
const line = (ok, text) => `<p class="res res--${ok ? 'ok' : 'bad'}">${ok ? I.ok : I.bad}<span>${text}</span></p>`;
const hasSecret = (p) => Boolean(p.keys?.stripe_secret_key?.set);
const noSecret = '<p class="muted small">Add a secret key under API keys first.</p>';

function check(st) {
  const c = st.check;
  let out = `<div class="actions">${btn('check', 'Check connection', 'Checking with Stripe…', { busy: st.busy.check })}
    ${c && !st.busy.check ? `<span class="muted small">Checked at <span class="m">${esc(c.at)}</span></span>` : ''}</div>`;
  if (st.busy.check) return out + '<div class="res-sk" aria-hidden="true"><span class="sk sk--line"></span><span class="sk sk--line sk--short"></span><span class="sk sk--line"></span></div>';
  if (c?.failed) return out + `<div class="notice notice--bad" role="alert">${I.bad}<p>${esc(c.failed)}</p></div>`;
  if (!c) return out + '<p class="muted small">Asks Stripe which account these keys belong to and whether the webhook and prices are in place. Takes a few seconds.</p>';
  const { connection: cn = {}, webhook: wh = {}, prices: pr = {} } = c.data;
  const a = cn.account || {};
  out += cn.ok ? `<dl class="kv kv--tight">
      <div><dt>Business</dt><dd>${esc(a.business_name || '—')}</dd></div>
      <div><dt>Email</dt><dd>${esc(a.email || '—')}</dd></div>
      <div><dt>Country</dt><dd>${esc(a.country || '—')}${a.default_currency ? ` <span class="muted">· ${esc(String(a.default_currency).toUpperCase())}</span>` : ''}</dd></div>
      <div><dt>Card payments</dt><dd>${a.charges_enabled ? 'Enabled' : '<span class="bad">Not enabled in Stripe yet</span>'}</dd></div>
      <div><dt>Mode</dt><dd>${a.livemode || cn.mode === 'live' ? 'Live' : 'Test'}</dd></div></dl>`
    : line(false, esc(cn.error || 'Stripe could not be reached with these keys.'));
  // webhook + prices from the same response
  let w;
  if (wh.error) w = line(false, `Webhook: ${esc(wh.error)}`);
  else if (!wh.exists) w = line(false, 'Webhook: not created in Stripe yet.');
  else {
    const issues = [];
    if (wh.status && wh.status !== 'enabled') issues.push(`it is ${esc(wh.status)}`);
    if (wh.missingEvents?.length) issues.push(`missing ${esc(wh.missingEvents.join(', '))}`);
    if (!wh.secretSaved) issues.push('its signing secret is not saved here');
    w = line(wh.ok && !issues.length, issues.length ? `Webhook exists, but ${issues.join('; ')}.` : 'Webhook is set up and enabled.');
  }
  const pl = pr.error ? line(false, `Prices: ${esc(pr.error)}`)
    : pr.missing?.length ? line(false, `Prices missing in Stripe: <span class="m">${esc(pr.missing.join(', '))}</span>`)
    : line(Boolean(pr.ok), pr.ok ? 'All prices are in Stripe.' : 'Prices could not be checked.');
  return out + w + pl;
}

function keysMsg(st) {
  const m = st.msg.keys;
  if (!m) return '';
  return m.ok ? `<p class="res res--ok">${I.ok}<span>${esc(m.text)}</span></p>` : `<div class="notice notice--bad" role="alert">${I.bad}<p>${esc(m.text)}</p></div>`;
}

function confirmBox(st, action) {
  const c = st.confirm;
  if (!c || c.action !== action) return '';
  const p = st.p, k = esc(p.key);
  const lead = action === 'disconnect'
    ? `This turns off Stripe on ${esc(p.domain)}. Checkouts there will be simulated until new keys are saved.`
    : p.liveMoney ? `This changes live payments on ${esc(p.domain)}.`
    : `This switches ${esc(p.domain)} to live payments — real cards will be charged.`;
  return `<div class="confirm" role="group" aria-labelledby="${k}-${action}-cl">
    <p id="${k}-${action}-cl"><strong>${lead}</strong> Type the domain to confirm.</p>
    ${c.serverError ? `<p class="small muted">${esc(c.serverError)}</p>` : ''}
    <label class="field"><span class="field__l">Domain</span>
      <input data-confirm="${action}" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="${esc(p.domain)}"></label>
    <div class="actions">
      ${btn(`confirm-${action}`, action === 'disconnect' ? 'Disconnect' : 'Confirm and save', action === 'disconnect' ? 'Disconnecting…' : 'Saving…', { busy: st.busy[action], disabled: true, cls: 'btn--danger' })}
      <button type="button" class="btn btn--quiet" data-act="cancel">Cancel</button>
    </div></div>`;
}

function webhook(st) {
  const p = st.p, ev = p.webhookEvents || [];
  const whs = p.keys?.stripe_webhook_secret;
  const m = st.msg.webhook;
  return `<p class="field__l">Webhook address</p>
    <div class="copyrow"><code class="m">${esc(p.webhookUrl || '')}</code>
      <button type="button" class="btn btn--quiet btn--sm" data-act="copy" data-copy="${esc(p.webhookUrl || '')}">${I.copy}<span>Copy</span></button></div>
    <p class="small">Stripe tells the portal about ${ev.length === 1 ? 'this event' : `these ${ev.length} events`}:</p>
    <ul class="events">${ev.map((e) => `<li class="m">${esc(e)}</li>`).join('')}</ul>
    <p class="small">Signing secret: ${whs?.set ? `saved <span class="muted">(${esc(SOURCE[whs.source] || whs.source)})</span>` : '<span class="bad">not saved yet</span>'}</p>
    <div class="actions">${btn('webhook', 'Create webhook in Stripe', 'Creating…', { busy: st.busy.webhook, disabled: !hasSecret(p) })}</div>
    ${hasSecret(p) ? '<p class="muted small">Creates the webhook in this portal’s Stripe account and saves its signing secret here. Safe to press again; it never makes a duplicate.</p>' : noSecret}
    ${m ? (m.note ? line(true, esc(m.note)) : '') + (m.error ? `<div class="notice notice--bad" role="alert">${I.bad}<p>${esc(m.error)}</p></div>` : '') : ''}`;
}

function prices(st) {
  const p = st.p, m = st.msg.prices;
  const list = (l) => `<span class="m">${esc(l.join(', '))}</span>`;
  return `<div class="actions">${btn('prices', 'Create prices in Stripe', 'Creating…', { busy: st.busy.prices, disabled: !hasSecret(p) })}</div>
    ${hasSecret(p) ? '<p class="muted small">Makes sure this portal’s ad prices exist in its Stripe account. Safe to press again.</p>' : noSecret}
    ${m ? (m.created?.length ? line(true, `Created: ${list(m.created)}`) : '') + (m.existing?.length ? line(true, `Already there: ${list(m.existing)}`) : '')
      + (m.ok && !m.created?.length && !m.existing?.length ? line(true, 'Done.') : '')
      + (m.error ? `<div class="notice notice--bad" role="alert">${I.bad}<p>${esc(m.error)}</p></div>` : '') : ''}`;
}

function disconnect(st) {
  const p = st.p, m = st.msg.disconnect;
  const any = FIELDS.some((f) => p.keys?.[f.id]?.set);
  const msg = m ? (m.ok ? line(true, esc(m.text)) : `<div class="notice notice--bad" role="alert">${I.bad}<p>${esc(m.text)}</p></div>`) : '';
  if (!any) return msg + '<p class="muted small">No Stripe keys are saved for this portal, so there is nothing to disconnect.</p>';
  return `${msg}<div class="actions">${st.confirm?.action === 'disconnect' ? '' : btn('disconnect', 'Disconnect (back to sandbox)', '', { cls: 'btn--ghost-danger' })}</div>
    ${confirmBox(st, 'disconnect')}`;
}

// ---------------------------------------------------------------- behaviour
function wire() {
  ROOT.addEventListener('click', onClick);
  ROOT.addEventListener('submit', (e) => {
    e.preventDefault();
    const s = e.target.closest('.pf');
    if (!s) return;
    const st = S.P.get(s.dataset.key);
    if (st.busy.keys) return;
    if (st.confirm?.action === 'keys') {   // Enter inside the confirmation box
      const typed = s.querySelector('[data-confirm=keys]')?.value.trim().toLowerCase();
      if (typed === st.p.domain.toLowerCase()) saveKeys(s.dataset.key, true);
      return;
    }
    saveKeys(s.dataset.key);
  });
  ROOT.addEventListener('input', onInput);
}

function onInput(e) {
  const t = e.target, s = t.closest('.pf');
  if (!s) return;
  if (t.dataset.confirm) {
    const st = S.P.get(s.dataset.key);
    const b = s.querySelector(`[data-act="confirm-${t.dataset.confirm}"]`);
    if (b && !st.busy[t.dataset.confirm]) b.disabled = t.value.trim().toLowerCase() !== st.p.domain.toLowerCase();
    return;
  }
  if (RX[t.name]) hint(s);
}

function hint(s) {
  const val = (id) => s.querySelector(`input[name=${id}]`).value.trim();
  const sk = val('stripe_secret_key'), pk = val('stripe_publishable_key'), wh = val('stripe_webhook_secret');
  const set = (id, text, bad) => { const h = s.querySelector(`[data-hint=${id}]`); h.textContent = text; h.classList.toggle('bad', bad); };
  set('stripe_secret_key', !sk ? '' : RX.stripe_secret_key.test(sk) ? `Looks like a ${modeOf(sk)} secret key.` : 'Stripe secret keys start with sk_test_, sk_live_, rk_test_ or rk_live_.', Boolean(sk) && !RX.stripe_secret_key.test(sk));
  const mismatch = sk && pk && modeOf(sk) && modeOf(pk) && modeOf(sk) !== modeOf(pk);
  set('stripe_publishable_key', !pk ? '' : !RX.stripe_publishable_key.test(pk) ? 'Publishable keys start with pk_test_ or pk_live_.'
    : mismatch ? 'This is a ' + modeOf(pk) + ' key but the secret key is ' + modeOf(sk) + ' — both must be the same mode.' : `Looks like a ${modeOf(pk)} publishable key.`,
  Boolean(pk) && (!RX.stripe_publishable_key.test(pk) || Boolean(mismatch)));
  set('stripe_webhook_secret', !wh ? '' : RX.stripe_webhook_secret.test(wh) ? 'Looks like a webhook signing secret.' : 'Webhook signing secrets start with whsec_.', Boolean(wh) && !RX.stripe_webhook_secret.test(wh));
}

async function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'reload') return load();
  const s = b.closest('.pf');
  if (!s) return;
  const key = s.dataset.key, st = S.P.get(key);

  if (act === 'toggle') {
    const input = document.getElementById(b.dataset.for);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.setAttribute('aria-pressed', String(show));
    b.setAttribute('aria-label', b.getAttribute('aria-label').replace(show ? 'Show' : 'Hide', show ? 'Hide' : 'Show'));
    b.innerHTML = show ? I.eyeOff : I.eye;
    return;
  }
  if (act === 'copy') {
    const text = b.dataset.copy, label = b.querySelector('span');
    try { await navigator.clipboard.writeText(text); label.textContent = 'Copied'; }
    catch { const r = document.createRange(); r.selectNodeContents(b.previousElementSibling); getSelection().removeAllRanges(); getSelection().addRange(r); label.textContent = 'Selected'; }
    setTimeout(() => { label.textContent = 'Copy'; }, 1600);
    return;
  }
  if (act === 'cancel') { st.confirm = null; paint(key); s.querySelector('[data-act=save]')?.focus(); return; }
  if (act === 'check') return runCheck(key);
  if (act === 'webhook') return runSimple(key, 'webhook');
  if (act === 'prices') return runSimple(key, 'prices');
  if (act === 'disconnect') {
    st.confirm = { action: 'disconnect' }; st.msg.disconnect = null; paint(key, ['disconnect']);
    s.querySelector('[data-confirm=disconnect]')?.focus();
    return;
  }
  if (act === 'confirm-keys') return saveKeys(key, true);
  if (act === 'confirm-disconnect') return runDisconnect(key);
}

async function runCheck(key) {
  const st = S.P.get(key);
  st.busy.check = true; paint(key, ['check']);
  const r = await post(key, 'check');
  st.busy.check = false;
  const at = new Date().toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
  st.check = r.ok ? { data: r.data, at } : { failed: r.data.error || `The check failed (${r.status}).`, at };
  paint(key, ['check']);
  sec(key).querySelector('[data-act=check]')?.focus();
}

async function saveKeys(key, confirmed = false) {
  const st = S.P.get(key), s = sec(key);
  let body;
  if (confirmed) body = { ...st.confirm.body, confirm: true };
  else {
    body = {};
    for (const f of FIELDS) { const v = s.querySelector(`input[name=${f.id}]`).value.trim(); if (v) body[f.id] = v; }
    if (!Object.keys(body).length) { st.msg.keys = { ok: false, text: 'Nothing to save — type a new key into at least one field.' }; paint(key, ['keys-msg']); return; }
  }
  st.busy.keys = true; st.msg.keys = null;
  paint(key, confirmed ? ['keys-confirm', 'keys-msg'] : ['keys-msg']);
  const r = await post(key, 'keys', body);
  st.busy.keys = false;
  if (r.status === 409 && r.data.needsConfirm) {
    st.confirm = { action: 'keys', body, serverError: r.data.error };
    paint(key, ['keys-confirm', 'keys-msg']);
    s.querySelector('[data-confirm=keys]')?.focus();
    return;
  }
  st.confirm = null;
  if (r.ok) {
    for (const f of FIELDS) { const i = s.querySelector(`input[name=${f.id}]`); i.value = ''; i.type = f.secret ? 'password' : 'text'; }
    s.querySelectorAll('[data-act=toggle]').forEach((t) => { t.setAttribute('aria-pressed', 'false'); t.innerHTML = I.eye; t.setAttribute('aria-label', t.getAttribute('aria-label').replace('Hide', 'Show')); });
    hint(s);
    const names = (r.data.saved || []).map((id) => FIELDS.find((f) => f.id === id)?.name || id);
    st.msg.keys = { ok: true, text: `Saved ${names.length ? names.join(' and ') : 'your changes'}. The portal starts using ${names.length === 1 ? 'it' : 'them'} within a few seconds.` };
    if (r.data.portal) st.p = r.data.portal;
    st.check = null;
    paint(key);
  } else {
    st.msg.keys = { ok: false, text: r.data.error || `Saving failed (${r.status}).` };
    paint(key, ['keys-confirm', 'keys-msg']);
  }
}

async function runDisconnect(key) {
  const st = S.P.get(key);
  st.busy.disconnect = true; paint(key, ['disconnect']);
  const r = await post(key, 'disconnect', { confirm: true });
  st.busy.disconnect = false; st.confirm = null;
  if (r.ok) {
    if (r.data.portal) st.p = r.data.portal;
    st.check = null; st.msg.webhook = null; st.msg.prices = null;
    st.msg.disconnect = { ok: true, text: r.data.envFallback
      ? 'The keys saved here were removed, but the portal’s .env file also has Stripe keys, and those are now in use. To go fully back to sandbox, they must be removed from the .env file on the server.'
      : 'Disconnected. Checkouts on this portal are simulated again.' };
    paint(key);
  } else {
    st.msg.disconnect = { ok: false, text: r.data.error || `Disconnect failed (${r.status}).` };
    paint(key, ['disconnect']);
  }
}

async function runSimple(key, action) {
  const st = S.P.get(key);
  st.busy[action] = true; st.msg[action] = null; paint(key, [action]);
  const r = await post(key, action, {});
  st.busy[action] = false;
  st.msg[action] = r.ok ? r.data : { error: r.data.error || `That failed (${r.status}).` };
  if (r.ok && action === 'webhook') {
    // the response has no portal object; re-read it so "signing secret saved" is current
    try { const d = await getSettings(); const p = d.portals.find((x) => x.key === key); if (p) st.p = p; } catch { /* keep old view */ }
    if (MOCK && r.data.secretSaved) st.p.keys.stripe_webhook_secret = { set: true, masked: 'whsec_••••Mk9Q', source: 'db' };
    paint(key);
  } else paint(key, [action]);
  sec(key).querySelector(`[data-act=${action}]`)?.focus();
}

// ---------------------------------------------------------------- mock (?mock=1 only)
const EVENTS = ['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'];
const none = { set: false, masked: '', source: 'default' };
const mk = (key, name, domain, extra) => ({
  key, name, domain, liveMoney: false, notes: [], billingMode: 'sandbox', keyMode: null,
  publicUrl: `https://${domain}`, webhookUrl: `https://${domain}/billing/webhook`, webhookEvents: EVENTS,
  keys: { stripe_secret_key: none, stripe_publishable_key: none, stripe_webhook_secret: none }, updatedAt: null, error: null, ...extra,
});
const FIXTURE = { portals: [
  mk('cc', 'Canada Careers', 'canadacareers.jobs', {
    liveMoney: true, billingMode: 'stripe', keyMode: 'test', updatedAt: '2026-10-07T12:00:00Z',
    notes: ['Real customers have paid on this portal. Changing its keys affects their subscriptions.'],
    keys: { stripe_secret_key: { set: true, masked: 'sk_test_••••Ab12', source: 'db' },
      stripe_publishable_key: { set: true, masked: 'pk_test_••••Cd34', source: 'db' },
      stripe_webhook_secret: { set: true, masked: 'whsec_••••Ef56', source: 'env' } } }),
  mk('ycc', 'Youth Careers', 'youthfuturejobs.ca'),
  mk('nwc', 'Newcomer Careers', 'newcomer.work'),
  mk('fn', 'Firstnation', 'firstnationsemployment.ca', { notes: ['This portal only has demo ads so far.'] }),
] };
const mask = (v) => `${v.match(/^[a-z]+_(?:(?:test|live)_)?/)[0]}••••${v.slice(-4)}`;
async function mockPost(key, action, body) {
  await wait(action === 'check' ? 2200 : 1100);
  const p = FIXTURE.portals.find((x) => x.key === key);
  const res = (status, data) => ({ status, ok: status < 400, data: structuredClone(data) });
  const sk = p.keys.stripe_secret_key.set;
  if (action === 'check') {
    if (!sk) {
      const error = 'No secret key is set for this portal, so Stripe cannot be reached.';
      return res(200, { connection: { ok: false, mode: null, error }, webhook: { ok: false, exists: false, error }, prices: { ok: false, missing: [], error } });
    }
    return res(200, { connection: { ok: true, mode: p.keyMode, error: null, account: { id: 'acct_1MOCK', business_name: `${p.name} (practice)`, email: `billing@${p.domain}`, country: 'CA', default_currency: 'cad', charges_enabled: true, livemode: p.keyMode === 'live' } },
      webhook: { ok: true, exists: true, id: 'we_1MOCK', status: 'enabled', url: p.webhookUrl, missingEvents: [], secretSaved: p.keys.stripe_webhook_secret.set, error: null },
      prices: { ok: false, missing: [`${key}_employer_monthly`], error: null } });
  }
  if (action === 'keys') {
    const s = body.stripe_secret_key, pk = body.stripe_publishable_key, wh = body.stripe_webhook_secret;
    if (s && !RX.stripe_secret_key.test(s)) return res(400, { error: 'That secret key is not in the right format. It should start with sk_test_, sk_live_, rk_test_ or rk_live_.' });
    if (pk && !RX.stripe_publishable_key.test(pk)) return res(400, { error: 'That publishable key is not in the right format. It should start with pk_test_ or pk_live_.' });
    if (wh && !RX.stripe_webhook_secret.test(wh)) return res(400, { error: 'That webhook signing secret should start with whsec_.' });
    if (s && pk && modeOf(s) !== modeOf(pk)) return res(400, { error: 'The secret key and publishable key must both be test keys or both be live keys.' });
    if ((p.liveMoney || modeOf(s || '') === 'live') && !body.confirm) return res(409, { error: 'This portal takes real payments, so this change needs confirming.', needsConfirm: true });
    const saved = [];
    for (const f of FIELDS) if (body[f.id]) { p.keys[f.id] = { set: true, masked: mask(body[f.id]), source: 'db' }; saved.push(f.id); }
    if (s) { p.billingMode = 'stripe'; p.keyMode = modeOf(s); }
    p.updatedAt = new Date().toISOString();
    return res(200, { ok: true, saved, portal: p });
  }
  if (action === 'disconnect') {
    for (const f of FIELDS) p.keys[f.id] = none;
    Object.assign(p, { billingMode: 'sandbox', keyMode: null, updatedAt: new Date().toISOString() });
    return res(200, { ok: true, portal: p, envFallback: false });
  }
  if (!sk) return res(400, { error: 'No secret key is set for this portal.' });
  if (action === 'webhook') {
    p.keys.stripe_webhook_secret = { set: true, masked: 'whsec_••••Mk9Q', source: 'db' };
    return res(200, { ok: true, id: 'we_1MOCK', url: p.webhookUrl, created: true, secretSaved: true, events: EVENTS, note: 'Created endpoint we_1MOCK. The signing secret has been saved into the portal.', error: null });
  }
  if (action === 'prices') return res(200, { ok: true, created: [`${key}_employer_monthly`], existing: [`${key}_single_ad`], error: null });
  return res(404, { error: 'Unknown action.' });
}
