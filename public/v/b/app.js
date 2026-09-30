/* Direction B — warm editorial / paper report. All numbers and rules come from /shared/data.js;
   this file only arranges them into a written brief and newspaper-set tables. */
import {
  loadData, realStats, perPortal, alerts, monthly, importedFacts, COMPARE_ROWS, fmt, filterAds, filterPeople,
  adUrl, money, num, plural, day, esc, short, sum, ORIGIN_LABEL, KIND_LABEL, ROLE_LABEL, STATUS_LABEL,
} from '/shared/data.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const ICON = {
  bad: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4M12 16.5v.01"/><path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg>',
  warn: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16v.01"/></svg>',
  ext: '<svg class="icon ext" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
};

const VIEWS = ['overview', 'people', 'ads'];
const PAGE = 60;
let DATA = null;
let shown = PAGE, sortKey = 'published_at', sortDir = -1;

// ---------------------------------------------------------------- small helpers (presentation only)
const zero = (v, text) => (Number(v) ? text : `<span class="zero">${text}</span>`);
const monthName = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' }); };
const longDay = (d) => new Date(d).toLocaleDateString('en-CA', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
const where = (a) => [a.city, a.province].filter(Boolean).join(', ');

// ---------------------------------------------------------------- overview: the brief
function renderOverview() {
  const t = realStats(DATA.ads, DATA.people);
  const per = perPortal(DATA);
  const mon = monthly(DATA);

  // Headline
  let when = '';
  if (mon.rows.length === 1) {
    const nowYm = new Date().toISOString().slice(0, 7);
    when = mon.rows[0].month === nowYm ? ' this month' : ` in ${monthName(mon.rows[0].month)}`;
  } else if (mon.rows.length > 1) when = ' so far';
  $('#headline').innerHTML = t.stripe
    ? `<span class="money">${esc(money(t.stripe))}</span> received from ${esc(plural(t.stripeN, 'card payment'))}${when}`
    : 'No card money has been received yet';

  // Standfirst: every clause is read off the numbers.
  const s = [];
  const payers = per.filter((x) => x.stats.stripe > 0);
  if (payers.length === 1 && per.length > 1) s.push(`<strong>${esc(payers[0].portal.name)}</strong> brought in all of it, the last payment on ${esc(longDay(t.lastPaid))}.`);
  else if (payers.length > 1) s.push(`${list(payers.map((x) => `<strong>${esc(x.portal.name)}</strong> ${esc(money(x.stats.stripe))}`))}; the last payment came on ${esc(longDay(t.lastPaid))}.`);
  const off = per.filter((x) => !x.portal.stripe_live && !x.portal.error);
  if (off.length) {
    const names = list(off.map((x) => esc(x.portal.name)));
    const noCard = off.every((x) => !x.stats.stripe);
    const lost = off.reduce((n, x) => n + x.stats.sandboxReal, 0);
    s.push(`${names} ${noCard ? `${off.length === 1 ? 'has' : 'have'} no card payments because` : 'take no live card payments:'} Stripe isn’t connected there` +
      (lost ? `, so ${esc(money(lost))} of checkouts by real people was simulated and not collected.` : '.'));
  }
  s.push(`${esc(plural(t.people, 'real person', 'real people'))} ${t.people === 1 ? 'holds' : 'hold'} ${esc(plural(t.accounts, 'account'))}; ` +
    (t.ads ? `${esc(plural(t.postedAd, 'account'))} posted ${esc(plural(t.ads, 'ad'))}, ${t.activeAds === t.ads ? (t.ads === 1 ? 'still active' : 'all still active') : `${esc(num(t.activeAds))} still active`}.` : 'none has posted an ad yet.'));
  s.push(`Real job seekers sent ${esc(plural(t.apps, 'application'))}, and ${esc(plural(t.login7, 'real account'))} logged in during the last seven days.`);
  $('#standfirst').innerHTML = s.join(' ');

  // Alerts
  $('#alerts').innerHTML = alerts(DATA).map((a) => `<div class="notice notice--${a.tone === 'bad' ? 'bad' : 'warn'}" role="status">${ICON[a.tone === 'bad' ? 'bad' : 'warn']}
    <p><span class="notice__title">${esc(a.title)}.</span> <span class="notice__body">${esc(a.body)}</span></p></div>`).join('');

  // In figures
  const fig = (label, value, note, cls = '') => `<div class="figlist__row"><dt>${label}</dt><dd class="${cls}">${value}</dd><span class="fig-note">${note}</span></div>`;
  $('#figures').innerHTML = [
    fig('Money received', esc(money(t.stripe)), t.stripeN ? `${esc(plural(t.stripeN, 'card payment'))} · last ${esc(day(t.lastPaid))}` : 'No card payments yet', t.stripe ? 'is-money' : 'zero'),
    fig('Real people', esc(num(t.people)), esc(plural(t.accounts, 'account'))),
    fig('Ads by real people', esc(num(t.ads)), `${esc(num(t.activeAds))} active now`),
    fig('Applications', esc(num(t.apps)), 'by real job seekers'),
    fig('Logged in, last 7 days', esc(num(t.login7)), 'real accounts'),
  ].join('');

  // Comparison table
  const cols = per.length + 2;
  const row = (r) => {
    const vals = per.map((x) => Number(x.stats[r.key] || 0));
    const total = vals.reduce((a, b) => a + b, 0);
    const cell = (v, cls = '') => `<td class="${cls}${!v ? ' zero-cell' : ''}${r.flag && v ? ' flag' : ''}">${zero(v, esc(fmt(r.format, v)))}</td>`;
    const cls = [r.emphasis && 'row--em', r.key === 'stripe' && 'money-row'].filter(Boolean).join(' ');
    return `<tr class="${cls}"><th scope="row" class="rowh">${esc(r.label)}</th>${vals.map((v) => cell(v)).join('')}${cell(total, 'col-total')}</tr>`;
  };
  const head = `<thead><tr><th scope="col"><span class="sr">Measure</span></th>${per.map((x) => `<th scope="col" title="${esc(x.portal.name)}">${esc(short(x.portal.name))}</th>`).join('')}<th scope="col" class="col-total">Total</th></tr></thead>`;
  const group = (label, cls) => `<tr class="group ${cls}"><td colspan="${cols}">${label}</td></tr>`;
  $('#compare').innerHTML = head +
    `<tbody>${group('Real activity', 'group--real')}${COMPARE_ROWS.filter((r) => r.group === 'real').map(row).join('')}</tbody>` +
    `<tbody class="excluded">${group('Imported &amp; test — excluded above', 'group--excluded')}${COMPARE_ROWS.filter((r) => r.group === 'excluded').map(row).join('')}</tbody>`;

  // Money by month
  $('#monthly').innerHTML = mon.rows.length
    ? `<thead><tr><th scope="col">Month</th>${mon.portals.map((p) => `<th scope="col" class="n">${esc(short(p.name))}</th>`).join('')}<th scope="col" class="n">Total</th></tr></thead><tbody>` +
      mon.rows.map((r) => `<tr><th scope="row" class="rowh">${esc(monthName(r.month))}</th>${r.cells.map((c) => `<td class="n">${c ? esc(money(c)) : '<span class="zero">—</span>'}</td>`).join('')}<td class="n"><strong>${esc(money(r.total))}</strong></td></tr>`).join('') + '</tbody>'
    : '<tbody><tr><td class="muted">No card payments yet.</td></tr></tbody>';

  // Imported & test ledger
  $('#imported').innerHTML = importedFacts(DATA).map((f) =>
    `<div class="ledger__row"><dt>${esc(f.label)}</dt><dd>${esc(f.value)}${f.note ? ` <span class="muted">· ${esc(f.note)}</span>` : ''}</dd></div>`).join('');
}

// ---------------------------------------------------------------- people
const peopleOpts = () => ({ q: $('#pq').value, kind: $('#pKind').value, portal: $('#pPortal').value, role: $('#pRole').value });

function renderPeople() {
  const o = peopleOpts();
  const rows = filterPeople(DATA.people, o);
  $('#pSummary').innerHTML = `<strong>${esc(plural(rows.length, 'account'))}</strong> · ${esc(plural(sum(rows, 'ads_posted'), 'ad'))} posted · ${esc(money(sum(rows, 'stripe_cents')))} paid by card · ${esc(plural(sum(rows, 'applications'), 'application'))}`;

  const role = (p) => esc(ROLE_LABEL[p.role] || p.role);
  const kind = (p) => (p.kind === 'real' ? esc(KIND_LABEL[p.kind]) : `<span class="muted">${esc(KIND_LABEL[p.kind] || p.kind)}</span>`);
  const ads = (p) => `${zero(p.ads_posted, esc(num(p.ads_posted)))}${p.ads_imported ? ` <span class="muted">+${esc(num(p.ads_imported))} imported</span>` : ''}`;
  const paid = (p) => (Number(p.stripe_cents) ? esc(money(p.stripe_cents)) : '<span class="zero">—</span>');
  const sandbox = (p) => `<span class="muted">${Number(p.sandbox_cents) ? esc(money(p.sandbox_cents)) : '—'}</span>`;

  $('#pBody').innerHTML = rows.map((p) => `<tr>
    <td><div class="cell-main"><strong>${esc(p.email)}</strong>${p.name ? `<span class="cell-sub">${esc(p.name)}</span>` : ''}</div></td>
    <td class="nowrap">${role(p)}</td><td>${esc(short(p.portal))}</td><td class="nowrap">${kind(p)}</td>
    <td class="nowrap">${esc(day(p.created_at))}</td><td class="nowrap">${p.last_login_at ? esc(day(p.last_login_at)) : '<span class="zero">never</span>'}</td>
    <td class="n">${ads(p)}</td><td class="n">${paid(p)}</td><td class="n">${sandbox(p)}</td><td class="n">${zero(p.applications, esc(num(p.applications)))}</td></tr>`).join('');

  $('#pItems').innerHTML = rows.map((p) => `<li class="item">
    <div class="item__top"><div class="item__title">${esc(p.email)}</div><div class="item__money">${Number(p.stripe_cents) ? esc(money(p.stripe_cents)) : Number(p.sandbox_cents) ? `<span class="muted">${esc(money(p.sandbox_cents))} sandbox</span>` : '<span class="zero">—</span>'}</div></div>
    <div class="item__meta">${p.name ? `${esc(p.name)} · ` : ''}${role(p)} · ${esc(short(p.portal))} · ${kind(p)}</div>
    <div class="item__facts"><span><b>${esc(num(p.ads_posted))}</b> ${p.ads_posted === 1 ? 'ad' : 'ads'} posted${p.ads_imported ? ` +${esc(num(p.ads_imported))} imported` : ''}</span><span><b>${esc(num(p.applications))}</b> ${Number(p.applications) === 1 ? 'application' : 'applications'}</span><span>Joined ${esc(day(p.created_at))}</span><span>Last login ${p.last_login_at ? esc(day(p.last_login_at)) : 'never'}</span></div>
  </li>`).join('');

  const tbl = $('#v-people .desk-only');
  tbl.hidden = !rows.length; $('#pItems').hidden = !rows.length;
  $('#pEmpty').innerHTML = rows.length ? '' : emptyState('Nobody matches these filters', [
    o.q && `search “${esc(o.q.trim())}”`,
    o.kind && `Kind: ${esc($('#pKind').selectedOptions[0].text)}`,
    o.portal && `Portal: ${esc(o.portal)}`,
    o.role && `Role: ${esc($('#pRole').selectedOptions[0].text)}`,
  ], 'Show everyone', 'clearPeople');
}

// ---------------------------------------------------------------- ads
const adsOpts = () => ({ q: $('#q').value, origin: $('#fOrigin').value, portal: $('#fPortal').value, status: $('#fStatus').value, sortKey, sortDir });

function adTitle(a) {
  const url = adUrl(a, DATA.portals);
  return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(a.title)}${ICON.ext}<span class="sr"> (opens in a new tab)</span></a>` : esc(a.title);
}
const adPaid = (a) => (Number(a.stripe_cents) > 0 ? esc(money(a.stripe_cents))
  : Number(a.sandbox_cents) > 0 ? `<span class="muted">${esc(money(a.sandbox_cents))} sandbox</span>` : '<span class="zero">—</span>');
const status = (a) => (a.status === 'active' ? esc(STATUS_LABEL(a.status)) : `<span class="muted">${esc(STATUS_LABEL(a.status))}</span>`);

function renderAds() {
  const o = adsOpts();
  const rows = filterAds(DATA.ads, o);
  const page = rows.slice(0, shown);
  $('#aSummary').innerHTML = `<strong>${esc(plural(rows.length, 'ad'))}</strong> · ${esc(num(rows.filter((a) => a.status === 'active').length))} active · ${esc(money(sum(rows, 'stripe_cents')))} received · ${esc(plural(sum(rows, 'applications'), 'application'))}`;

  $('#aBody').innerHTML = page.map((a) => `<tr>
    <td><div class="cell-main"><strong>${adTitle(a)}</strong><span class="cell-sub">${esc(a.employer || '—')}${where(a) ? ` · ${esc(where(a))}` : ''}</span></div></td>
    <td>${esc(short(a.portal))}</td><td class="muted">${esc(a.creator_email || '—')}</td>
    <td class="nowrap">${esc(ORIGIN_LABEL[a.origin] || a.origin)}</td><td class="nowrap">${status(a)}</td>
    <td class="n">${adPaid(a)}</td><td class="n">${zero(a.applications, esc(num(a.applications)))}</td><td class="n">${zero(a.views, esc(num(a.views)))}</td>
    <td class="nowrap">${esc(day(a.published_at))}</td><td class="nowrap">${esc(day(a.expires_at))}</td></tr>`).join('');

  $('#aItems').innerHTML = page.map((a) => `<li class="item">
    <div class="item__top"><div class="item__title">${adTitle(a)}</div><div class="item__money">${adPaid(a)}</div></div>
    <div class="item__meta">${esc(a.employer || '—')}${where(a) ? ` · ${esc(where(a))}` : ''}</div>
    <div class="item__facts"><span>${esc(short(a.portal))}</span><span>${status(a)}</span><span>${esc(ORIGIN_LABEL[a.origin] || a.origin)}</span>${a.creator_email ? `<span>${esc(a.creator_email)}</span>` : ''}</div>
    <div class="item__facts"><span><b>${esc(num(a.applications))}</b> apps</span><span><b>${esc(num(a.views))}</b> views</span><span>Published ${esc(day(a.published_at))}</span><span>Expires ${esc(day(a.expires_at))}</span></div>
  </li>`).join('');

  $('#v-ads .desk-only').hidden = !rows.length; $('#aItems').hidden = !rows.length;
  $('#aEmpty').innerHTML = rows.length ? '' : emptyState('No ads match these filters', [
    o.q && `search “${esc(o.q.trim())}”`,
    o.origin && `Origin: ${esc($('#fOrigin').selectedOptions[0].text)}`,
    o.portal && `Portal: ${esc(o.portal)}`,
    o.status && `Status: ${esc($('#fStatus').selectedOptions[0].text)}`,
  ], 'Show all ads', 'clearAds');

  const more = $('#more');
  more.hidden = rows.length <= shown;
  more.textContent = `Show more (${num(rows.length - shown)} left)`;
  $$('#adsTable th[data-k]').forEach((th) => th.setAttribute('aria-sort', th.dataset.k === sortKey ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'));
  const sel = $('#fSort');
  sel.value = [...sel.options].some((op) => op.value === sortKey && !op.disabled) && (sortDir === (sortKey === 'expires_at' ? 1 : -1)) ? sortKey : '';
}

function emptyState(title, reasons, action, id) {
  const r = reasons.filter(Boolean);
  const body = r.length ? `Filtered by ${r.join('; ')}. Loosen one of these, or reset them all.` : 'There is nothing here yet.';
  return `<div class="empty" role="status"><p class="empty__title">${title}</p><p class="empty__body">${body}</p>${r.length ? `<button type="button" class="btn btn--small" data-act="${id}">${action}</button>` : ''}</div>`;
}

// ---------------------------------------------------------------- views + tabs
function show(view, focus = false) {
  if (!VIEWS.includes(view)) view = 'overview';
  for (const v of VIEWS) {
    const on = v === view, tab = $('#t-' + v);
    tab.setAttribute('aria-selected', on); tab.tabIndex = on ? 0 : -1;
    $('#v-' + v).hidden = !on;
  }
  if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  if (focus) $('#t-' + view).focus();
}
$$('.tab').forEach((tab, i, tabs) => {
  tab.addEventListener('click', () => show(tab.id.slice(2)));
  tab.addEventListener('keydown', (e) => {
    const k = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (k === undefined) return;
    e.preventDefault();
    show(tabs[(k + tabs.length) % tabs.length].id.slice(2), true);
  });
});
window.addEventListener('hashchange', () => show(location.hash.slice(1)));

// ---------------------------------------------------------------- filters, sorting, paging
['#pq', '#pKind', '#pPortal', '#pRole'].forEach((id) => $(id).addEventListener('input', () => DATA && renderPeople()));
['#q', '#fOrigin', '#fPortal', '#fStatus'].forEach((id) => $(id).addEventListener('input', () => { shown = PAGE; DATA && renderAds(); }));
$('#fSort').addEventListener('change', (e) => { sortKey = e.target.value; sortDir = sortKey === 'expires_at' ? 1 : -1; shown = PAGE; DATA && renderAds(); });
$$('#adsTable th[data-k] .sort').forEach((b) => b.addEventListener('click', () => {
  const k = b.parentElement.dataset.k;
  sortDir = sortKey === k ? -sortDir : (['title', 'portal', 'creator_email', 'origin', 'status', 'expires_at'].includes(k) ? 1 : -1);
  sortKey = k; shown = PAGE; renderAds();
}));
$('#more').addEventListener('click', () => { shown += PAGE; renderAds(); });
document.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'clearPeople') { $('#pq').value = ''; $('#pKind').value = ''; $('#pPortal').value = ''; $('#pRole').value = ''; renderPeople(); }
  if (act === 'clearAds') { $('#q').value = ''; $('#fOrigin').value = ''; $('#fPortal').value = ''; $('#fStatus').value = ''; shown = PAGE; renderAds(); }
  if (act === 'retry') load();
});

// ---------------------------------------------------------------- loading
let optionsFilled = false;
async function load() {
  const btn = $('#refresh');
  btn.classList.add('is-loading'); btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  btn.querySelector('.btn__label').textContent = 'Refreshing';
  try {
    DATA = await loadData();
    if (!optionsFilled) {
      const opts = DATA.portals.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
      $('#fPortal').insertAdjacentHTML('beforeend', opts); $('#pPortal').insertAdjacentHTML('beforeend', opts);
      $('#fStatus').insertAdjacentHTML('beforeend', [...new Set(DATA.ads.map((a) => a.status))].sort()
        .map((s) => `<option value="${esc(s)}">${esc(STATUS_LABEL(s))}</option>`).join(''));
      optionsFilled = true;
    }
    const t = realStats(DATA.ads, DATA.people);
    $('#nPeople').textContent = num(t.accounts);
    $('#nPeople').setAttribute('aria-label', `(${plural(t.accounts, 'real account')})`);
    $('#nAds').textContent = num(t.ads);
    $('#nAds').setAttribute('aria-label', `(${plural(t.ads, 'ad')} by real people)`);
    $('#stamp').textContent = 'Updated ' + new Date(DATA.generatedAt).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
    $('#notice').innerHTML = ''; document.body.classList.remove('is-error');
    renderOverview(); renderPeople(); renderAds();
  } catch (err) {
    $('#notice').innerHTML = `<div class="notice notice--bad" role="alert">${ICON.bad}<div><p><span class="notice__title">The figures could not be loaded.</span> <span class="notice__body">${esc(err.message || 'Network error')}. ${DATA ? 'What you see is from the last successful load.' : ''}</span></p>
      <div class="notice__action"><button type="button" class="btn btn--small" data-act="retry">Try again</button></div></div></div>`;
    $('#stamp').textContent = DATA ? 'Refresh failed' : 'Not loaded';
    document.body.classList.add('is-error');
  } finally {
    btn.classList.remove('is-loading'); btn.disabled = false; btn.removeAttribute('aria-busy');
    btn.querySelector('.btn__label').textContent = 'Refresh';
  }
}
$('#refresh').addEventListener('click', load);

show(location.hash.slice(1) || 'overview');
load();
