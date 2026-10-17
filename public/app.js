/* Direction A — Swiss monochrome. Rendering only: every number and rule comes from /shared/data.js. */
import {
  loadData, realStats, perPortal, alerts, monthly, importedFacts, COMPARE_ROWS, fmt, acquisition, TRACKING_SINCE,
  filterAds, filterPeople, adUrl, money, num, plural, day, esc, short,
  ORIGIN_LABEL, KIND_LABEL, ROLE_LABEL, STATUS_LABEL, STATUS_TONE, ORIGIN_TONE, KIND_TONE,
} from '/shared/data.js';
import { openSettings, reloadSettings, settingsDataReady } from './settings.js';
import { openPricing, reloadPricing } from './pricing.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const PAGE = 60;
const VIEWS = ['overview', 'people', 'ads', 'pricing', 'settings'];

let DATA = null;
let shown = PAGE;
const adSort = { key: 'published_at', dir: -1 };

// ---------------------------------------------------------------- small pieces
const svg = (d, cls = 'icon') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  bad: svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>'),
  warn: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>'),
  ext: svg('<path d="M14 5h5v5M19 5l-8 8M17 14v5H5V7h5"/>', 'icon icon--ext'),
  sort: svg('<path d="m8 10 4-4 4 4M8 14l4 4 4-4"/>', 'icon icon--sort'),
};
const z = (v, text) => (Number(v) ? text : `<span class="z">${text}</span>`);            // zero = muted
const dash = '<span class="z" aria-label="none">—</span>';
const tag = (label, tone) => `<span class="tag tag--${tone || 'neutral'}">${esc(label)}</span>`;
const mono = (s) => `<span class="m">${s}</span>`;
const clock = (d) => new Date(d).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false });

// ---------------------------------------------------------------- overview
function renderOverview() {
  const d = DATA, t = realStats(d.ads, d.people);

  // Every clause must be literally true: postedAd counts accounts, so the sentence speaks of ads.
  const first = t.stripe
    ? `${money(t.stripe)} received from ${plural(t.stripeN, 'card payment')}.`
    : 'No card money received yet.';
  const second = t.ads
    ? `${plural(t.ads, 'ad')} posted by real people, ${t.activeAds === t.ads ? (t.ads === 1 ? 'and it is' : 'all') : t.activeAds ? num(t.activeAds) : 'none'} active now.`
    : 'No ads posted by real people yet.';
  $('#lede').innerHTML = `<span class="lede__a">${esc(first)}</span> <span class="lede__b">${esc(second)}</span>`;

  const fact = (label, value, sub) => `<div><dt>${label}</dt><dd>${mono(value)}${sub ? `<span class="facts__sub">${sub}</span>` : ''}</dd></div>`;
  $('#facts').innerHTML = [
    fact('Money received', money(t.stripe), t.stripeN ? `${plural(t.stripeN, 'card payment')} · last ${mono(day(t.lastPaid))}` : 'no card payments'),
    fact('Real people', num(t.people), plural(t.accounts, 'account')),
    fact('Ads by real people', num(t.ads), `${num(t.activeAds)} active`),
    fact('Applications', num(t.apps), 'by real seekers'),
    fact('Logged in', num(t.login7), 'last 7 days'),
  ].join('');

  $('#alerts').innerHTML = alerts(d).map((a) =>
    `<div class="notice notice--${a.tone}" role="status">${ICON[a.tone] || ICON.warn}<p><strong>${esc(a.title)}.</strong> ${esc(a.body)}</p></div>`).join('');

  // Portal comparison. Explicit ARIA roles because phones restyle rows as grids (label above, figures below).
  const per = perPortal(d);
  const cols = per.length;
  const compare = $('#compare');
  compare.style.setProperty('--cols', cols);
  const head = `<thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col" class="t__label"><span class="vh">Measure</span></th>${per.map(({ portal }) =>
    `<th role="columnheader" scope="col" class="n">${esc(short(portal.name))}</th>`).join('')}<th role="columnheader" scope="col" class="n t__total">Total</th></tr></thead>`;
  const group = (label) => `<tr role="row" class="t__group"><th role="rowheader" scope="rowgroup" colspan="${cols + 2}">${label}</th></tr>`;
  const row = (r) => {
    const cell = (v, extra = '', name = '') => `<td role="cell" class="n m${extra}${r.flag && v ? ' flag' : ''}"${name ? ` data-col="${esc(name)}"` : ''}>${z(v, esc(fmt(r.format, v)))}</td>`;
    return `<tr role="row" class="${r.emphasis ? 'em' : ''}${r.group === 'excluded' ? ' ex' : ''}"><th role="rowheader" scope="row" class="t__label">${esc(r.label)}</th>${
      per.map(({ portal, stats }) => cell(stats[r.key], '', short(portal.name))).join('')}${cell(t[r.key], ' t__total', 'Total')}</tr>`;
  };
  compare.innerHTML = head + '<tbody role="rowgroup">' +
    group('Real activity') + COMPARE_ROWS.filter((r) => r.group === 'real').map(row).join('') +
    group('Imported &amp; test — excluded above') + COMPARE_ROWS.filter((r) => r.group === 'excluded').map(row).join('') +
    '</tbody>';

  // Money by month (only portals that have taken card money; a Total column once there are two or more)
  const mo = monthly(d);
  const withTotal = mo.portals.length > 1;
  const mt = $('#monthly');
  mt.classList.toggle('t--grid', mo.portals.length + (withTotal ? 1 : 0) >= 3);
  mt.style.setProperty('--cols', mo.portals.length + (withTotal ? 1 : 0));
  mt.innerHTML = mo.rows.length
    ? `<thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col" class="t__label">Month</th>${mo.portals.map((p) => `<th role="columnheader" scope="col" class="n">${esc(short(p.name))}</th>`).join('')}${
      withTotal ? '<th role="columnheader" scope="col" class="n">Total</th>' : ''}</tr></thead><tbody role="rowgroup">${mo.rows.map((r) =>
      `<tr role="row"><th role="rowheader" scope="row" class="m t__label">${esc(r.month)}</th>${r.cells.map((c) => `<td role="cell" class="n m">${c ? money(c) : dash}</td>`).join('')}${
        withTotal ? `<td role="cell" class="n m em">${money(r.total)}</td>` : ''}</tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="empty-inline">No card payments yet. Months appear here once Stripe records one.</td></tr></tbody>';

  const acq = acquisition(d);
  const kv = (rows) => `<dl class="kv">${rows.map(([k, n]) => `<div><dt>${esc(k)}</dt><dd>${mono(String(n))}</dd></div>`).join('')}</dl>`;
  $('#acquisition').innerHTML = acq.total
    ? `<p class="note">${acq.total} real ${acq.total === 1 ? 'person has' : 'people have'} signed up since tracking began on ${TRACKING_SINCE} (${acq.byPortal.filter((x) => x.n).map((x) => `${esc(x.name)} ${x.n}`).join(', ')}).</p>
       <h3 class="kv__h">What they told us</h3>${kv(acq.heard)}
       <h3 class="kv__h">Where their first visit came from</h3>${kv(acq.source)}
       ${acq.others.length ? `<h3 class="kv__h">“Other” answers</h3><ul class="kv__list">${acq.others.map((o) => `<li>${esc(o.text)} <span class="kv__note">${esc(o.portal)}</span></li>`).join('')}</ul>` : ''}`
    : `<p class="note">Tracking started on ${TRACKING_SINCE}. Every new sign-up on the four portals records how they heard about us and where their first visit came from; the first ones will appear here.</p>`;

  $('#imported').innerHTML = importedFacts(d).map((f) =>
    `<div><dt>${esc(f.label)}</dt><dd>${mono(esc(f.value))}${f.note ? ` <span class="kv__note">${esc(f.note)}</span>` : ''}</dd></div>`).join('');
}

// ---------------------------------------------------------------- empty state
function empty(what, form, defaults) {
  const name = (el) => el.closest('label').querySelector('.field__l').textContent;
  const hints = [];
  if (form.querySelector('input').value.trim()) hints.push('shorten or clear the search');
  for (const el of form.querySelectorAll('select')) {
    if (el.id === 'aSort') continue;
    const def = defaults[el.id] ?? '';
    if (el.value !== def) hints.push(`set ${name(el)} back to “${[...el.options].find((o) => o.value === def)?.text}”`);
  }
  const first = form.querySelector('select');
  if (first.value === defaults[first.id]) hints.push(`choose “${first.options[1].text}” under ${name(first)}`);
  return `<div class="empty"><p class="empty__t">No ${what} match these filters.</p>
    <p class="empty__b">To see more, ${esc(hints.join(', or '))}.</p>
    <button type="button" class="btn btn--quiet" data-reset="${form.id}">Clear filters</button></div>`;
}
const DEFAULTS = { pKind: 'real', aOrigin: 'real', aSort: 'published_at' };

// ---------------------------------------------------------------- people
function renderPeople() {
  const f = { q: $('#pq').value, kind: $('#pKind').value, portal: $('#pPortal').value, role: $('#pRole').value };
  const list = filterPeople(DATA.people, f);
  const tot = (k) => list.reduce((s, x) => s + Number(x[k] || 0), 0);
  const uniq = new Set(list.map((p) => p.email.toLowerCase())).size;
  $('#pSummary').innerHTML = list.length
    ? `${plural(list.length, 'account')}${uniq !== list.length ? ` (${plural(uniq, 'person', 'people')})` : ''} · ${plural(tot('ads_posted'), 'ad')} posted · ${mono(money(tot('stripe_cents')))} paid by card · ${plural(tot('applications'), 'application')}`
    : '';
  if (!list.length) { $('#pList').innerHTML = empty('people', $('#pForm'), DEFAULTS); return; }

  const ads = (p) => `${z(p.ads_posted, num(p.ads_posted))}${p.ads_imported ? `<span class="sub">+${num(p.ads_imported)} imported</span>` : ''}`;
  const paid = (p) => (p.stripe_cents ? money(p.stripe_cents) : dash);
  const sandbox = (p) => (p.sandbox_cents ? `<span class="muted">${money(p.sandbox_cents)}</span>` : dash);
  const who = (p) => `<span class="who"><span class="who__e">${esc(p.email)}</span>${p.name ? `<span class="sub">${esc(p.name)}</span>` : ''}</span>`;

  const table = `<table class="t t--list"><thead><tr>
      <th scope="col">Person</th><th scope="col">Role</th><th scope="col">Portal</th><th scope="col">Kind</th>
      <th scope="col">Joined</th><th scope="col">Last login</th><th scope="col" class="n">Ads</th>
      <th scope="col" class="n">Paid by card</th><th scope="col" class="n">Sandbox</th><th scope="col" class="n">Apps</th></tr></thead><tbody>${
    list.map((p) => `<tr><td>${who(p)}</td><td>${esc(ROLE_LABEL[p.role] || p.role)}</td><td>${esc(short(p.portal))}</td>
      <td>${tag(KIND_LABEL[p.kind] || p.kind, KIND_TONE[p.kind])}</td>
      <td class="m">${day(p.created_at)}</td><td class="m">${p.last_login_at ? day(p.last_login_at) : dash}</td>
      <td class="n m">${ads(p)}</td><td class="n m">${paid(p)}</td><td class="n m">${sandbox(p)}</td>
      <td class="n m">${z(p.applications, num(p.applications))}</td></tr>`).join('')}</tbody></table>`;

  const cards = `<ul class="rows">${list.map((p) => `<li class="r">
      <div class="r__top">${who(p)}${tag(KIND_LABEL[p.kind] || p.kind, KIND_TONE[p.kind])}</div>
      <p class="r__meta">${esc(ROLE_LABEL[p.role] || p.role)} · ${esc(short(p.portal))} · joined ${mono(day(p.created_at))} · last login ${mono(p.last_login_at ? day(p.last_login_at) : '—')}</p>
      <dl class="r__nums">
        <div><dt>Ads</dt><dd class="m">${ads(p)}</dd></div>
        <div><dt>Paid by card</dt><dd class="m">${paid(p)}</dd></div>
        <div><dt>Sandbox</dt><dd class="m">${sandbox(p)}</dd></div>
        <div><dt>Apps</dt><dd class="m">${z(p.applications, num(p.applications))}</dd></div>
      </dl></li>`).join('')}</ul>`;

  $('#pList').innerHTML = `<div class="desk">${table}</div><div class="phone">${cards}</div>`;
}

// ---------------------------------------------------------------- ads
const AD_COLS = [
  ['title', 'Ad'], ['portal', 'Portal'], [null, 'Posted by'], ['origin', 'Origin'], ['status', 'Status'],
  ['stripe_cents', 'Paid', 'n'], ['applications', 'Apps', 'n'], ['views', 'Views', 'n'],
  ['published_at', 'Published'], ['expires_at', 'Expires'],
];

function renderAds() {
  const f = { q: $('#aq').value, origin: $('#aOrigin').value, portal: $('#aPortal').value, status: $('#aStatus').value, sortKey: adSort.key, sortDir: adSort.dir };
  const list = filterAds(DATA.ads, f), page = list.slice(0, shown);
  const tot = (k) => list.reduce((s, x) => s + Number(x[k] || 0), 0);
  $('#aSummary').innerHTML = list.length
    ? `${plural(list.length, 'ad')} · ${num(list.filter((a) => a.status === 'active').length)} active · ${mono(money(tot('stripe_cents')))} received · ${plural(tot('applications'), 'application')}`
    : '';
  const more = $('#more');
  more.hidden = list.length <= shown;
  more.textContent = `Show more (${num(list.length - shown)} left)`;
  if (!list.length) { $('#aList').innerHTML = empty('ads', $('#aForm'), DEFAULTS); return; }

  const title = (a) => {
    const url = adUrl(a, DATA.portals);
    return url ? `<a class="ad__t" href="${esc(url)}" target="_blank" rel="noopener">${esc(a.title)}${ICON.ext}<span class="vh"> (opens in new tab)</span></a>`
      : `<span class="ad__t">${esc(a.title)}</span>`;
  };
  const where = (a) => esc([a.employer || '—', [a.city, a.province].filter(Boolean).join(', ')].filter(Boolean).join(' · '));
  const paid = (a) => (a.stripe_cents > 0 ? money(a.stripe_cents)
    : a.sandbox_cents > 0 ? `<span class="muted">${money(a.sandbox_cents)} <span class="lbl">sandbox</span></span>` : dash);
  const status = (a) => tag(STATUS_LABEL(a.status), STATUS_TONE[a.status]);
  const origin = (a) => tag(ORIGIN_LABEL[a.origin] || a.origin, ORIGIN_TONE[a.origin]);

  const th = ([k, label, cls]) => {
    if (!k) return `<th scope="col">${label}</th>`;
    const on = adSort.key === k;
    return `<th scope="col" class="${cls || ''}" aria-sort="${on ? (adSort.dir > 0 ? 'ascending' : 'descending') : 'none'}">
      <button type="button" class="sort${on ? ' is-on' : ''}" data-k="${k}">${label}${ICON.sort}</button></th>`;
  };
  const table = `<table class="t t--list t--ads"><thead><tr>${AD_COLS.map(th).join('')}</tr></thead><tbody>${
    page.map((a) => `<tr><td class="ad-cell"><span class="ad">${title(a)}<span class="sub">${where(a)}</span></span></td>
      <td>${esc(short(a.portal))}</td><td class="muted ellip" title="${esc(a.creator_email || '')}">${esc(a.creator_email || '—')}</td>
      <td>${origin(a)}</td><td>${status(a)}</td>
      <td class="n m">${paid(a)}</td><td class="n m">${z(a.applications, num(a.applications))}</td><td class="n m">${z(a.views, num(a.views))}</td>
      <td class="m">${day(a.published_at)}</td><td class="m">${day(a.expires_at)}</td></tr>`).join('')}</tbody></table>`;

  const cards = `<ul class="rows">${page.map((a) => `<li class="r">
      <div class="r__top"><span class="ad">${title(a)}<span class="sub">${where(a)}</span></span><span class="r__money m">${paid(a)}</span></div>
      <p class="r__tags">${status(a)}${origin(a)}<span class="tag tag--plain">${esc(short(a.portal))}</span></p>
      <p class="r__meta">${a.creator_email ? `${esc(a.creator_email)} · ` : ''}published ${mono(day(a.published_at))} · expires ${mono(day(a.expires_at))}</p>
      <dl class="r__nums r__nums--2">
        <div><dt>Apps</dt><dd class="m">${z(a.applications, num(a.applications))}</dd></div>
        <div><dt>Views</dt><dd class="m">${z(a.views, num(a.views))}</dd></div>
      </dl></li>`).join('')}</ul>`;

  $('#aList').innerHTML = `<div class="desk">${table}</div><div class="phone">${cards}</div>`;
}

function syncSortSelect() {
  const sel = $('#aSort');
  const preset = { published_at: -1, stripe_cents: -1, views: -1, applications: -1, expires_at: 1 };
  let col = sel.querySelector('option[data-col]');
  if (preset[adSort.key] === adSort.dir) { col?.remove(); sel.value = adSort.key; return; }
  if (!col) { col = document.createElement('option'); col.dataset.col = '1'; col.value = '__col'; sel.append(col); }
  const label = AD_COLS.find((c) => c[0] === adSort.key)?.[1] || adSort.key;
  col.textContent = `${label}, ${adSort.dir > 0 ? 'ascending' : 'descending'}`;
  sel.value = '__col';
}

// ---------------------------------------------------------------- views / tabs
function show(view, focus = false) {
  if (!VIEWS.includes(view)) view = 'overview';
  for (const v of VIEWS) {
    const on = v === view, tab = $(`#tab-${v}`);
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $(`#panel-${v}`).hidden = !on;
  }
  if (focus) $(`#tab-${view}`).focus();
  if (view === 'pricing') openPricing($('#pricingRoot'));
  if (view === 'settings') openSettings($('#settingsRoot'), () => DATA?.portals || []);
  if (location.hash.slice(1) !== view) history.replaceState(null, '', `#${view}`);
}

$('.tabs').addEventListener('click', (e) => { const t = e.target.closest('[role=tab]'); if (t) show(t.dataset.view); });
$('.tabs').addEventListener('keydown', (e) => {
  const i = VIEWS.indexOf(document.activeElement?.dataset?.view);
  if (i < 0) return;
  const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: VIEWS.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  show(VIEWS[(next + VIEWS.length) % VIEWS.length], true);
});
addEventListener('hashchange', () => show(location.hash.slice(1)));

// ---------------------------------------------------------------- filters
$('#pForm').addEventListener('input', () => DATA && renderPeople());
$('#aForm').addEventListener('input', (e) => {
  if (!DATA) return;
  if (e.target.id === 'aSort') {
    if (e.target.value === '__col') return;
    adSort.key = e.target.value; adSort.dir = adSort.key === 'expires_at' ? 1 : -1;
    syncSortSelect();
  }
  shown = PAGE; renderAds();
});
$('#aList').addEventListener('click', (e) => {
  const b = e.target.closest('button.sort');
  if (!b) return;
  const k = b.dataset.k;
  adSort.dir = adSort.key === k ? -adSort.dir : (['title', 'portal', 'origin', 'status'].includes(k) ? 1 : -1);
  adSort.key = k;
  syncSortSelect(); shown = PAGE; renderAds();
  $(`#aList button.sort[data-k="${k}"]`)?.focus();
});
$('#more').addEventListener('click', () => { shown += PAGE; renderAds(); });
document.addEventListener('click', (e) => {
  const r = e.target.closest('[data-reset]');
  if (!r) return;
  const form = document.getElementById(r.dataset.reset);
  for (const el of form.querySelectorAll('input, select')) el.value = DEFAULTS[el.id] ?? '';
  if (form.id === 'aForm') { adSort.key = 'published_at'; adSort.dir = -1; syncSortSelect(); shown = PAGE; renderAds(); } else renderPeople();
  form.querySelector('input').focus();
});

// ---------------------------------------------------------------- loading
function skeletonLists() {
  const rows = Array.from({ length: 6 }, () => '<div class="sk-row"><span class="sk sk--line"></span><span class="sk sk--line sk--short"></span></div>').join('');
  $('#pList').innerHTML = rows; $('#aList').innerHTML = rows;
}

let optionsFilled = false;
async function load() {
  const btn = $('#refresh');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.querySelector('.btn__label').textContent = 'Refreshing…';
  try {
    DATA = await loadData();
    if (!optionsFilled) {
      const opts = DATA.portals.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
      $$('[data-portals]').forEach((s) => s.insertAdjacentHTML('beforeend', opts));
      $('#aStatus').insertAdjacentHTML('beforeend', [...new Set(DATA.ads.map((a) => a.status))].sort()
        .map((s) => `<option value="${esc(s)}">${esc(STATUS_LABEL(s))}</option>`).join(''));
      optionsFilled = true;
    }
    const t = realStats(DATA.ads, DATA.people);
    $('#nPeople').textContent = num(filterPeople(DATA.people).length);
    $('#nPeople').setAttribute('aria-label', `(${plural(filterPeople(DATA.people).length, 'real account')})`);
    $('#nAds').textContent = num(t.ads);
    $('#nAds').setAttribute('aria-label', `(${plural(t.ads, 'ad')} by real people)`);
    $('#stamp').innerHTML = `Updated ${mono(clock(DATA.generatedAt))}`;
    $('#fatal').innerHTML = '';
    renderOverview(); renderPeople(); renderAds();
    settingsDataReady();
  } catch (err) {
    $('#fatal').innerHTML = `<div class="notice notice--bad" role="alert">${ICON.bad}<p><strong>Could not load the data${DATA ? ' — showing the last copy' : ''}.</strong> ${esc(err.message || err)}.</p>
      <button type="button" class="btn btn--quiet" id="retry">Try again</button></div>`;
    $('#retry').addEventListener('click', load);
    $('#stamp').textContent = DATA ? `Refresh failed · last ${clock(DATA.generatedAt)}` : 'Load failed';
    if (!DATA) { $('#lede').innerHTML = ''; $('#facts').innerHTML = ''; $('#compare').innerHTML = ''; $('#monthly').innerHTML = ''; $('#pList').innerHTML = ''; $('#aList').innerHTML = ''; }
  } finally {
    btn.disabled = false; btn.removeAttribute('aria-busy'); btn.querySelector('.btn__label').textContent = 'Refresh';
  }
}
$('#refresh').addEventListener('click', () => { load(); reloadSettings(); reloadPricing(); });

show(location.hash.slice(1));
skeletonLists();
load();
