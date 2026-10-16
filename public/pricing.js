/* Pricing view: each portal's plans for employers and consultants — length (days or months), main price, and an
   optional special offer that never changes the main price. Contract: ops/briefs/2026-10-16-brc-jobs-pricing.md §3.
   The portal validates everything and does the GST maths; this page only edits and displays. */
import { esc, day } from '/shared/data.js';

const ROLES = [['employer', 'Employer'], ['consultant', 'Consultant']];
const svg = (d) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const I = {
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  bad: svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>'),
  ok: svg('<path d="m5 12 5 5 9-10"/>'),
};
const money = (c) => (c == null ? '—' : '$' + (Number(c) / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const toCents = (s) => { const v = String(s ?? '').replace(/[$,\s]/g, ''); if (!/^\d+(\.\d{1,2})?$/.test(v)) return null; return Math.round(Number(v) * 100); };
const length = (p) => `${p.period_count} ${p.period_unit === 'month' ? (p.period_count === 1 ? 'month' : 'months') : (p.period_count === 1 ? 'day' : 'days')}`;

let ROOT = null;
const S = { loaded: false, loading: false, error: null, portals: [], ui: new Map() };
// ui per portal key: { edit: null | { id?, role, name, period_count, period_unit, price, is_default }, offer: null | { id, price, label, ends }, msg: null | { ok, text }, busy: false }

async function api(path, body) {
  try {
    const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dashboard': '1' }, body: JSON.stringify(body) } : { cache: 'no-store' });
    const data = await r.json().catch(() => ({ error: `The server answered ${r.status} with no details.` }));
    return { ok: r.ok, status: r.status, data };
  } catch (e) { return { ok: false, status: 0, data: { error: `Could not reach the dashboard server (${e.message}).` } }; }
}

export function openPricing(root) {
  ROOT = root;
  if (!ROOT.dataset.wired) { ROOT.addEventListener('click', onClick); ROOT.addEventListener('submit', onSubmit); ROOT.dataset.wired = '1'; }
  if (!S.loaded && !S.loading) load();
}
export function reloadPricing() { if (ROOT && (S.loaded || S.error)) load(); }

async function load() {
  S.loading = true; if (!S.loaded) render();
  const r = await api('/api/pricing');
  S.loading = false;
  if (!r.ok) { S.error = r.data.error || 'Could not load the pricing.'; render(); return; }
  S.error = null; S.loaded = true; S.portals = r.data.portals;
  for (const p of S.portals) if (!S.ui.has(p.key)) S.ui.set(p.key, { edit: null, offer: null, msg: null, busy: false });
  render();
}

function render() {
  if (!ROOT) return;
  const intro = `<p class="set__intro">Each portal has its own plans for employers and consultants: a length in days or months and a
    price before GST. A special offer shows a lower price next to the struck-through main price without changing the main
    price, and can end on a date or be switched off any time. Changes apply to new purchases only — every posting keeps
    the price it was bought at.</p>`;
  if (S.error && !S.loaded) { ROOT.innerHTML = `${intro}<div class="notice notice--bad" role="alert">${I.bad}<p><strong>The pricing could not be loaded.</strong> ${esc(S.error)}</p><button type="button" class="btn btn--quiet" data-act="reload">Try again</button></div>`; return; }
  if (!S.loaded) { ROOT.innerHTML = `${intro}<div class="pf"><span class="sk sk--line" style="width:40%"></span><span class="sk sk--line"></span></div>`; return; }
  ROOT.innerHTML = intro + S.portals.map(section).join('');
}

function section(p) {
  const u = S.ui.get(p.key);
  const head = `<header class="pf__head"><h2 class="pf__name" id="pr-${esc(p.key)}">${esc(p.name)} <span class="m muted">${esc(p.domain)}</span></h2></header>`;
  const msg = u.msg ? (u.msg.ok ? `<p class="res res--ok" role="status">${I.ok}<span>${esc(u.msg.text)}</span></p>` : `<div class="notice notice--bad" role="alert">${I.bad}<p>${esc(u.msg.text)}</p></div>`) : '';
  if (p.error) return `<section class="pf" data-key="${esc(p.key)}" aria-labelledby="pr-${esc(p.key)}">${head}<div class="notice notice--bad" role="alert">${I.bad}<p>${esc(p.error)}</p></div></section>`;
  if (!p.available) return `<section class="pf" data-key="${esc(p.key)}" aria-labelledby="pr-${esc(p.key)}">${head}<div class="notice notice--quiet" role="status">${I.info}<p>Pricing plans are not installed on this portal yet — it still uses its single built-in price. They appear here as soon as the portal is updated.</p></div></section>`;
  const roles = ROLES.map(([role, label]) => {
    const plans = p.plans.filter((x) => x.role === role).sort((a, b) => (b.is_default - a.is_default) || (a.sort - b.sort) || (a.id - b.id));
    const rows = plans.map((x) => `<tr class="${x.active ? '' : 'off'}">
        <th scope="row">${esc(x.name)}${x.is_default ? ' <span class="tag">Default</span>' : ''}${x.active ? '' : ' <span class="tag tag--off">Off</span>'}</th>
        <td>${esc(length(x))}</td>
        <td class="n">${x.offer_active ? `<s class="muted">${money(x.price_cents)}</s>` : money(x.price_cents)}<div class="small muted">${money(x.total_cents)} with GST</div></td>
        <td>${x.offer_active ? `<strong>${money(x.offer_price_cents)}</strong>${x.offer_label ? ` · ${esc(x.offer_label)}` : ''}<div class="small muted">${money(x.offer_total_cents)} with GST${x.offer_ends_at ? ` · until ${esc(day(x.offer_ends_at))}` : ' · until switched off'}</div>` : (x.offer_price_cents ? `<span class="muted">Ended ${esc(day(x.offer_ends_at))}</span>` : '<span class="muted">—</span>')}</td>
        <td class="acts"><button type="button" class="btn btn--quiet btn--sm" data-act="edit" data-id="${x.id}">Edit</button>
          <button type="button" class="btn btn--quiet btn--sm" data-act="offer" data-id="${x.id}">Offer</button>
          <button type="button" class="btn btn--quiet btn--sm" data-act="toggle" data-id="${x.id}" data-on="${x.active ? 0 : 1}">${x.active ? 'Turn off' : 'Turn on'}</button></td>
      </tr>${u.edit && u.edit.id === x.id ? `<tr><td colspan="5">${editForm(u.edit)}</td></tr>` : ''}${u.offer && u.offer.id === x.id ? `<tr><td colspan="5">${offerForm(u.offer, x)}</td></tr>` : ''}`).join('');
    return `<h3 class="pr__role">${label} plans</h3>
      <div class="scroll"><table class="t t--plans"><thead><tr><th scope="col">Plan</th><th scope="col">Length</th><th scope="col" class="n">Price</th><th scope="col">Special offer</th><th scope="col"><span class="vh">Actions</span></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="muted">No plans yet.</td></tr>'}</tbody></table></div>
      ${u.edit && !u.edit.id && u.edit.role === role ? editForm(u.edit) : `<div class="actions"><button type="button" class="btn btn--quiet" data-act="add" data-role="${role}">Add a ${label.toLowerCase()} plan</button></div>`}`;
  }).join('');
  return `<section class="pf" data-key="${esc(p.key)}" aria-labelledby="pr-${esc(p.key)}">${head}<div aria-live="polite">${msg}</div>${roles}</section>`;
}

function editForm(e) {
  return `<form class="kform pr__form" data-form="plan">
    <div class="pr__grid">
      <label class="field"><span class="field__l">Plan name</span><input name="name" value="${esc(e.name || '')}" placeholder="e.g. Monthly, 30 days, 3 months" required maxlength="60"></label>
      <label class="field"><span class="field__l">Length</span><input name="period_count" type="number" inputmode="numeric" min="1" max="365" value="${esc(e.period_count ?? 1)}" required></label>
      <label class="field"><span class="field__l">Unit</span><select name="period_unit"><option value="month"${e.period_unit === 'month' ? ' selected' : ''}>months</option><option value="day"${e.period_unit === 'day' ? ' selected' : ''}>days</option></select></label>
      <label class="field"><span class="field__l">Price before GST (CAD)</span><input name="price" inputmode="decimal" value="${esc(e.price ?? '')}" placeholder="14.99" required></label>
    </div>
    <label class="check"><input type="checkbox" name="is_default"${e.is_default ? ' checked' : ''}> Default plan for ${e.role === 'consultant' ? 'consultants' : 'employers'} (pre-selected at checkout)</label>
    <p class="small muted">Plans renew automatically every length until the poster cancels. Months: 1–12; days: 1–365.</p>
    <div class="actions"><button type="submit" class="btn btn--primary">${e.id ? 'Save plan' : 'Add plan'}</button><button type="button" class="btn btn--quiet" data-act="cancel">Cancel</button></div>
  </form>`;
}

function offerForm(o, plan) {
  return `<form class="kform pr__form" data-form="offer">
    <p class="small">Main price stays ${money(plan.price_cents)}. The offer price is charged instead while the offer runs, and stays locked for postings bought during it.</p>
    <div class="pr__grid">
      <label class="field"><span class="field__l">Offer price before GST (CAD)</span><input name="price" inputmode="decimal" value="${esc(o.price ?? '')}" placeholder="9.99" required></label>
      <label class="field"><span class="field__l">Label shown to posters</span><input name="label" value="${esc(o.label || '')}" placeholder="e.g. Launch special" maxlength="60"></label>
      <label class="field"><span class="field__l">Ends on (optional)</span><input name="ends" type="date" value="${esc(o.ends || '')}"></label>
    </div>
    <div class="actions"><button type="submit" class="btn btn--primary">Save offer</button>
      ${plan.offer_price_cents ? '<button type="button" class="btn btn--quiet" data-act="offer-off">Switch offer off</button>' : ''}
      <button type="button" class="btn btn--quiet" data-act="cancel">Cancel</button></div>
  </form>`;
}

const keyOf = (el) => el.closest('.pf')?.dataset.key;
const planOf = (key, id) => S.portals.find((p) => p.key === key)?.plans.find((x) => x.id === Number(id));

async function act(key, path, body, okText) {
  const u = S.ui.get(key);
  u.busy = true; u.msg = null;
  const r = await api(`/api/pricing/${encodeURIComponent(key)}/${path}`, body);
  u.busy = false;
  if (!r.ok) { u.msg = { ok: false, text: r.data.error || `That failed (${r.status}).` }; render(); return; }
  u.edit = null; u.offer = null; u.msg = { ok: true, text: okText };
  await load();
}

function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act_ = b.dataset.act;
  if (act_ === 'reload') return load();
  const key = keyOf(b); if (!key) return;
  const u = S.ui.get(key);
  if (act_ === 'add') { u.edit = { role: b.dataset.role, period_unit: 'month', period_count: 1 }; u.offer = null; u.msg = null; return render(); }
  if (act_ === 'cancel') { u.edit = null; u.offer = null; return render(); }
  const plan = planOf(key, b.dataset.id);
  if (act_ === 'edit' && plan) { u.offer = null; u.msg = null; u.edit = { id: plan.id, role: plan.role, name: plan.name, period_unit: plan.period_unit, period_count: plan.period_count, price: (plan.price_cents / 100).toFixed(2), is_default: plan.is_default }; return render(); }
  if (act_ === 'offer' && plan) { u.edit = null; u.msg = null; u.offer = { id: plan.id, price: plan.offer_price_cents ? (plan.offer_price_cents / 100).toFixed(2) : '', label: plan.offer_label || '', ends: plan.offer_ends_at ? day(plan.offer_ends_at) : '' }; return render(); }
  if (act_ === 'toggle' && plan) return act(key, 'active', { id: plan.id, active: b.dataset.on === '1' }, `${plan.name} turned ${b.dataset.on === '1' ? 'on' : 'off'}.`);
  if (act_ === 'offer-off' && u.offer) return act(key, 'offer', { id: u.offer.id, offer: { offer_price_cents: null, offer_label: null, offer_ends_at: null } }, 'Offer switched off. The main price applies to new purchases again.');
}

function onSubmit(e) {
  e.preventDefault();
  const f = e.target, key = keyOf(f), u = S.ui.get(key);
  if (!key || u.busy) return;
  const v = (n) => f.elements[n]?.value?.trim() ?? '';
  if (f.dataset.form === 'plan') {
    const price = toCents(v('price'));
    if (!price) { u.msg = { ok: false, text: 'Enter the price as a number, e.g. 14.99.' }; return render(); }
    const plan = { ...(u.edit.id ? { id: u.edit.id } : {}), role: u.edit.role, name: v('name'), period_unit: v('period_unit'), period_count: Number(v('period_count')), price_cents: price, is_default: f.elements.is_default.checked };
    return act(key, 'save', { plan }, u.edit.id ? `${plan.name} saved. New purchases use it from now on.` : `${plan.name} added.`);
  }
  if (f.dataset.form === 'offer') {
    const price = toCents(v('price'));
    if (!price) { u.msg = { ok: false, text: 'Enter the offer price as a number, e.g. 9.99.' }; return render(); }
    const ends = v('ends');
    const offer = { offer_price_cents: price, offer_label: v('label') || null, offer_ends_at: ends ? new Date(`${ends}T23:59:59`).toISOString() : null };
    return act(key, 'offer', { id: u.offer.id, offer }, `Offer saved${ends ? ` until ${ends}` : ''}. The main price is unchanged.`);
  }
}
