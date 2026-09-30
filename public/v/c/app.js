/* Direction C — Businessweek editorial. Renders the shared data layer; never recomputes its rules. */
import {
  loadData, realStats, perPortal, alerts, monthly, importedFacts, COMPARE_ROWS, fmt, filterAds, filterPeople, adUrl,
  money, num, plural, day, esc, short, sum, ORIGIN_LABEL, KIND_LABEL, ROLE_LABEL, STATUS_LABEL, STATUS_TONE, ORIGIN_TONE, KIND_TONE,
} from '/shared/data.js';

const $ = (s) => document.querySelector(s);
const PAGE = 60;
let DATA = null, shown = PAGE, sortKey = 'published_at', sortDir = -1, filled = false;

// ---------------------------------------------------------------- small helpers (presentation only)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceDay = (d) => { // '2026-09-29' -> '29 Sep' (UTC calendar date from day())
  const s = day(d); if (s === '—') return s;
  const [y, m, dd] = s.split('-');
  return `${Number(dd)} ${MON[Number(m) - 1]}${y !== String(new Date().getUTCFullYear()) ? ' ' + y : ''}`;
};
const niceMonth = (k) => { const [y, m] = k.split('-'); return `${MON[Number(m) - 1]} ${y}`; };
const zero = (v, text) => (Number(v) ? text : `<span class="zero">${text}</span>`);
const date = (d) => `<span class="date">${day(d)}</span>`;
const TONE_CLASS = { good: 'tag--strong', warn: 'tag--line', bad: 'tag--bad', info: 'tag--line', neutral: '' };
const tag = (label, tone) => `<span class="tag ${TONE_CLASS[tone] || ''}">${esc(label)}</span>`;
const kindTag = (k) => tag(KIND_LABEL[k] || k, KIND_TONE[k]);
const originTag = (o) => tag(ORIGIN_LABEL[o] || o, ORIGIN_TONE[o]);
const statusTag = (s) => tag(STATUS_LABEL(s), STATUS_TONE[s]);

const SVG = (d, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${d}</svg>`;
const ICON = {
  bad: SVG('<path d="M12 3 2 21h20L12 3Z"/><path d="M12 10v5M12 18v.5"/>'),
  warn: SVG('<rect x="3" y="3" width="18" height="18"/><path d="M12 7v6M12 16v.5"/>'),
  sort: SVG('<path d="M12 5v14M6 13l6 6 6-6"/>', 12),
};

// ---------------------------------------------------------------- overview
function moneyFigure(cents) {
  const s = money(cents); const i = s.lastIndexOf('.');
  const whole = s.slice(0, i), frac = s.slice(i);
  const chars = whole.length + frac.length * 0.5 - (whole.split(',').length - 1) * 0.6;
  return `<span class="fig-money fig" style="--chars:${chars.toFixed(2)}" aria-label="${esc(s)}">${esc(whole)}<span class="cents" aria-hidden="true">${esc(frac)}</span></span>`;
}

function renderOverview() {
  const t = realStats(DATA.ads, DATA.people);
  const per = perPortal(DATA);
  const al = alerts(DATA);
  const mo = monthly(DATA);
  const facts = importedFacts(DATA);

  const say = t.stripeN
    ? `received&nbsp;— <span class="em">${plural(t.stripeN, 'card payment')}</span>, last ${esc(niceDay(t.lastPaid))}`
    : 'received&nbsp;— no card payments yet';

  const cell = (n, label, sub) => `<div class="strip__cell"><span class="strip__n fig">${n}</span><span class="strip__l">${label}<span class="strip__s">${sub}</span></span></div>`;

  const notices = al.length ? `<div class="notices">${al.map((a) => `<div class="notice notice--${a.tone === 'bad' ? 'bad' : 'warn'}" role="status">
      <span class="notice__icon">${ICON[a.tone === 'bad' ? 'bad' : 'warn']}</span>
      <div><p class="notice__t"><span class="notice__tag">${a.tone === 'bad' ? 'Fix' : 'Check'}</span>${esc(a.title)}</p><p class="notice__b">${esc(a.body)}</p></div>
    </div>`).join('')}</div>` : '';

  // portal comparison
  const cols = per.length + 2;
  const row = (r) => {
    const vals = per.map((x) => x.stats[r.key]);
    const total = vals.reduce((a, b) => a + Number(b || 0), 0);
    const td = (v, extra = '') => {
      const f = r.flag && Number(v) ? ' flag' : '';
      return `<td class="n${f}${r.format === 'money' ? ' money' : ''}${Number(v) ? '' : ' zero'}${extra}">${fmt(r.format, v)}</td>`;
    };
    return `<tr class="${r.emphasis ? 'emph' : ''}${r.group === 'excluded' ? ' excl' : ''}"><td>${esc(r.label)}</td>${vals.map((v) => td(v)).join('')}${td(total, ' tot')}</tr>`;
  };
  const group = (label, rows) => `<tr class="grp"><td colspan="${cols}">${label}</td></tr>${rows.map(row).join('')}`;
  const compare = `<div class="tbl-wrap"><table class="tbl cmp">
    <thead><tr><th scope="col"><span class="sr">Measure</span></th>${per.map((x) => `<th scope="col" class="n">${esc(short(x.portal.name))}</th>`).join('')}<th scope="col" class="n tot">Total</th></tr></thead>
    <tbody>${group('Real activity', COMPARE_ROWS.filter((r) => r.group === 'real'))}${group('Imported &amp; test — excluded above', COMPARE_ROWS.filter((r) => r.group === 'excluded'))}</tbody></table></div>`;

  const monthTable = mo.rows.length ? `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th scope="col">Month</th>${mo.portals.map((p) => `<th scope="col" class="n">${esc(short(p.name))}</th>`).join('')}${mo.portals.length > 1 ? '<th scope="col" class="n">Total</th>' : ''}</tr></thead>
    <tbody>${mo.rows.map((r) => `<tr><td>${esc(niceMonth(r.month))}</td>${r.cells.map((c) => `<td class="n${c ? ' strong' : ' zero'}">${c ? money(c) : '—'}</td>`).join('')}${mo.portals.length > 1 ? `<td class="n strong">${money(r.total)}</td>` : ''}</tr>`).join('')}</tbody>
  </table></div>` : '<div class="empty"><p class="empty__t">No card payments yet</p><p class="empty__b">Months appear here once Stripe records a payment.</p></div>';

  $('#ov').innerHTML = `
    <div class="lede">
      <div class="lede__fig">${moneyFigure(t.stripe)}</div>
      <div class="lede__text">
        <p class="lede__say">${say}</p>
        <p class="lede__small">Card money through Stripe, CAD incl. tax. Real activity only — imported and test data are counted apart, further down.</p>
      </div>
    </div>
    <div class="strip">
      ${cell(num(t.people), 'Real people', plural(t.accounts, 'account'))}
      ${cell(num(t.ads), 'Ads by real people', `${num(t.activeAds)} active`)}
      ${cell(num(t.apps), 'Applications', 'by real seekers')}
      ${cell(num(t.login7), 'Logged in', 'in the last 7 days')}
    </div>
    ${notices}
    <section class="sec" aria-labelledby="h-cmp">
      <div class="sec__head"><h2 class="sec__h" id="h-cmp">Three boards, side by side</h2>
        <p class="sec__dek">Real activity first. Imports, Job Bank, demo ads and test or staff accounts sit underneath and are left out of every number above. A red figure needs fixing.</p></div>
      ${compare}
    </section>
    <div class="duo">
      <section class="sec" aria-labelledby="h-mo">
        <div class="sec__head"><h2 class="sec__h3" id="h-mo">Money by month</h2><p class="sec__dek">Stripe card payments only.</p></div>
        ${monthTable}
      </section>
      <section class="sec" aria-labelledby="h-imp">
        <div class="sec__head"><h2 class="sec__h3" id="h-imp">Imported &amp; test data</h2><p class="sec__dek">Kept out of every number above.</p></div>
        <dl class="facts">${facts.map((f) => `<div class="facts__row"><dt>${esc(f.label)}</dt><dd>${esc(f.value)}${f.note ? `<span class="muted">${esc(f.note)}</span>` : ''}</dd></div>`).join('')}</dl>
        <p class="note">The import scripts wrote payment records so imported ads show as paid in admin. <strong>No money was collected for them.</strong></p>
      </section>
    </div>`;
}

// ---------------------------------------------------------------- people
const emptyState = (title, body, resetId) => `<div class="empty"><p class="empty__t">${title}</p><p class="empty__b">${body}</p>${resetId ? `<button type="button" class="btn" data-reset="${resetId}">Clear filters</button>` : ''}</div>`;

function peopleOpts() { return { q: $('#pq').value, kind: $('#pKind').value, portal: $('#pPortal').value, role: $('#pRole').value }; }
function renderPeople() {
  const o = peopleOpts();
  const list = filterPeople(DATA.people, o);
  $('#pSummary').innerHTML = `<span class="num">${num(list.length)}</span> ${list.length === 1 ? 'account' : 'accounts'} · <span class="num">${num(sum(list, 'ads_posted'))}</span> ${sum(list, 'ads_posted') === 1 ? 'ad' : 'ads'} posted · <span class="num">${money(sum(list, 'stripe_cents'))}</span> paid by card · <span class="num">${num(sum(list, 'applications'))}</span> ${sum(list, 'applications') === 1 ? 'application' : 'applications'}`;

  const hint = o.q ? 'Nothing matches that search. Clear the search box, or set Type to Everyone.'
    : o.kind ? 'Set Type to Everyone, or widen the portal and role filters.' : 'Widen the portal and role filters.';
  const empty = emptyState('Nobody matches', hint, 'people');

  const paid = (p) => (Number(p.stripe_cents) ? `<span class="strong">${money(p.stripe_cents)}</span>` : '<span class="zero">—</span>');
  const adsN = (p) => `${zero(p.ads_posted, num(p.ads_posted))}${p.ads_imported ? `<span class="sub">+${num(p.ads_imported)} imported</span>` : ''}`;

  $('#pBody').innerHTML = list.map((p) => `<tr>
      <td><span class="strong">${esc(p.email)}</span>${p.name ? `<span class="sub">${esc(p.name)}</span>` : ''}</td>
      <td>${esc(ROLE_LABEL[p.role] || p.role)}</td><td>${esc(short(p.portal))}</td><td>${kindTag(p.kind)}</td>
      <td>${date(p.created_at)}</td><td>${date(p.last_login_at)}</td>
      <td class="n">${adsN(p)}</td><td class="n">${paid(p)}</td>
      <td class="n muted">${Number(p.sandbox_cents) ? money(p.sandbox_cents) : '—'}</td>
      <td class="n">${zero(p.applications, num(p.applications))}</td></tr>`).join('') || `<tr><td colspan="10" class="empty-cell">${empty}</td></tr>`;

  $('#pList').innerHTML = list.map((p) => `<li class="row">
      <div class="row__top"><div><p class="row__t">${esc(p.email)}</p><p class="row__m">${[p.name, ROLE_LABEL[p.role] || p.role, short(p.portal)].filter(Boolean).map(esc).join(' · ')}</p></div>
        <span class="row__money">${Number(p.stripe_cents) ? money(p.stripe_cents) : Number(p.sandbox_cents) ? `<span class="muted">${money(p.sandbox_cents)} sandbox</span>` : '<span class="zero">—</span>'}</span></div>
      <div class="row__facts">${kindTag(p.kind)}<span><b>${num(p.ads_posted)}</b> ads${p.ads_imported ? ` <span class="muted">+${num(p.ads_imported)} imported</span>` : ''}</span><span><b>${num(p.applications)}</b> applied</span></div>
      <div class="row__facts"><span>Joined ${date(p.created_at)}</span><span>Last login ${date(p.last_login_at)}</span></div>
    </li>`).join('') || `<li>${empty}</li>`;
}

// ---------------------------------------------------------------- ads
function adOpts() { return { q: $('#q').value, origin: $('#fOrigin').value, portal: $('#fPortal').value, status: $('#fStatus').value, sortKey, sortDir }; }
const adTitle = (a) => { const u = adUrl(a, DATA.portals); return u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(a.title)}</a>` : esc(a.title); };
const adMoney = (a) => (Number(a.stripe_cents) > 0 ? `<span class="strong">${money(a.stripe_cents)}</span>`
  : Number(a.sandbox_cents) > 0 ? `<span class="muted">${money(a.sandbox_cents)} sandbox</span>` : '<span class="zero">—</span>');
const where = (a) => [a.employer || '—', [a.city, a.province].filter(Boolean).join(', ')].filter(Boolean).map(esc).join(' · ');

const PRESETS = { published_at: -1, stripe_cents: -1, views: -1, applications: -1, expires_at: 1 };
function syncSortUI() {
  const sel = $('#fSort');
  sel.value = PRESETS[sortKey] === sortDir ? sortKey : 'custom';
  document.querySelectorAll('#ads th[data-k]').forEach((th) =>
    th.setAttribute('aria-sort', th.dataset.k === sortKey ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'));
}

function renderAds() {
  const o = adOpts();
  const list = filterAds(DATA.ads, o), page = list.slice(0, shown);
  $('#aSummary').innerHTML = `<span class="num">${num(list.length)}</span> ${list.length === 1 ? 'ad' : 'ads'} · <span class="num">${num(list.filter((a) => a.status === 'active').length)}</span> active · <span class="num">${money(sum(list, 'stripe_cents'))}</span> received · <span class="num">${num(sum(list, 'applications'))}</span> ${sum(list, 'applications') === 1 ? 'application' : 'applications'}`;

  const hint = o.q ? 'Nothing matches that search. Clear the search box, or set Origin to All.'
    : o.origin ? 'Set Origin to All, or widen the portal and status filters.' : 'Widen the portal and status filters.';
  const empty = emptyState('No ads match', hint, 'ads');

  $('#aBody').innerHTML = page.map((a) => `<tr>
      <td><span class="strong">${adTitle(a)}</span><span class="sub">${where(a)}</span></td>
      <td>${esc(short(a.portal))}</td><td class="muted">${esc(a.creator_email || '—')}</td>
      <td>${originTag(a.origin)}</td><td>${statusTag(a.status)}</td>
      <td class="n">${adMoney(a)}</td><td class="n">${zero(a.applications, num(a.applications))}</td><td class="n">${zero(a.views, num(a.views))}</td>
      <td>${date(a.published_at)}</td><td>${date(a.expires_at)}</td></tr>`).join('') || `<tr><td colspan="10" class="empty-cell">${empty}</td></tr>`;

  $('#aList').innerHTML = page.map((a) => `<li class="row">
      <div class="row__top"><div><p class="row__t">${adTitle(a)}</p><p class="row__m">${where(a)}</p></div><span class="row__money">${adMoney(a)}</span></div>
      <div class="row__tags">${statusTag(a.status)}${originTag(a.origin)}${tag(short(a.portal), 'neutral')}</div>
      <div class="row__facts"><span><b>${num(a.applications)}</b> apps</span><span><b>${num(a.views)}</b> views</span>${a.creator_email ? `<span class="muted">${esc(a.creator_email)}</span>` : ''}</div>
      <div class="row__facts"><span>Published ${date(a.published_at)}</span><span>Expires ${date(a.expires_at)}</span></div>
    </li>`).join('') || `<li>${empty}</li>`;

  const left = list.length - shown;
  $('#more').hidden = left <= 0;
  $('#more').textContent = `Show more (${num(left)} left)`;
  syncSortUI();
}

// ---------------------------------------------------------------- views (tabs + hash)
const VIEWS = ['overview', 'people', 'ads'];
function show(view, focus = false) {
  if (!VIEWS.includes(view)) view = 'overview';
  VIEWS.forEach((v) => {
    const on = v === view, tab = $('#t-' + v);
    tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1;
    $('#' + v).hidden = !on;
  });
  if (focus) $('#t-' + view).focus();
  if (location.hash.slice(1) !== view) history.replaceState(null, '', '#' + view);
}
document.querySelectorAll('[role="tab"]').forEach((tab, i, tabs) => {
  tab.addEventListener('click', () => { show(tab.id.slice(2)); window.scrollTo({ top: 0 }); });
  tab.addEventListener('keydown', (e) => {
    const k = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (k === undefined) return;
    e.preventDefault();
    show(tabs[(k + tabs.length) % tabs.length].id.slice(2), true);
  });
});
window.addEventListener('hashchange', () => show(location.hash.slice(1)));

// ---------------------------------------------------------------- wiring
['#pq', '#pKind', '#pPortal', '#pRole'].forEach((id) => $(id).addEventListener('input', () => DATA && renderPeople()));
['#q', '#fOrigin', '#fPortal', '#fStatus'].forEach((id) => $(id).addEventListener('input', () => { shown = PAGE; DATA && renderAds(); }));
$('#fSort').addEventListener('change', (e) => { if (e.target.value in PRESETS) { sortKey = e.target.value; sortDir = PRESETS[sortKey]; } shown = PAGE; DATA && renderAds(); });
$('#more').addEventListener('click', () => { shown += PAGE; renderAds(); });
document.querySelectorAll('#ads th[data-k]').forEach((th) => {
  th.innerHTML = `<button type="button" class="th-btn">${th.textContent}${ICON.sort}</button>`;
  th.querySelector('button').addEventListener('click', () => {
    const k = th.dataset.k;
    sortDir = sortKey === k ? -sortDir : (['title', 'portal', 'creator_email', 'origin', 'status', 'expires_at'].includes(k) ? 1 : -1);
    sortKey = k; shown = PAGE; renderAds();
  });
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-reset]'); if (!b) return;
  if (b.dataset.reset === 'people') { $('#pq').value = ''; $('#pKind').value = ''; $('#pPortal').value = ''; $('#pRole').value = ''; renderPeople(); }
  else { $('#q').value = ''; $('#fOrigin').value = ''; $('#fPortal').value = ''; $('#fStatus').value = ''; shown = PAGE; renderAds(); }
});

function fillOptions() {
  if (filled) return;
  const opts = DATA.portals.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
  $('#pPortal').insertAdjacentHTML('beforeend', opts); $('#fPortal').insertAdjacentHTML('beforeend', opts);
  $('#fStatus').insertAdjacentHTML('beforeend', [...new Set(DATA.ads.map((a) => a.status))].sort()
    .map((s) => `<option value="${esc(s)}">${esc(STATUS_LABEL(s))}</option>`).join(''));
  filled = true;
}

async function load() {
  const btn = $('#refresh');
  btn.setAttribute('aria-busy', 'true'); btn.disabled = true;
  btn.querySelector('.btn__label').textContent = 'Refreshing';
  try {
    DATA = await loadData();
    fillOptions();
    const t = realStats(DATA.ads, DATA.people);
    $('#nPeople').textContent = num(t.accounts); $('#nPeople').setAttribute('aria-label', `${plural(t.accounts, 'real account')}`);
    $('#nAds').textContent = num(t.ads); $('#nAds').setAttribute('aria-label', `${plural(t.ads, 'ad')} by real people`);
    $('#stamp').textContent = 'Updated ' + new Date(DATA.generatedAt).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
    $('#error').innerHTML = '';
    renderOverview(); renderPeople(); renderAds();
  } catch (err) {
    $('#stamp').textContent = 'Load failed';
    $('#error').innerHTML = `<div class="notice notice--bad"><span class="notice__icon">${ICON.bad}</span><div>
      <p class="notice__t"><span class="notice__tag">Error</span>Could not load the dashboard data</p>
      <p class="notice__b">${esc(err.message)}. ${DATA ? 'The figures below are from the last successful load.' : 'Check the connection, then try again.'}</p>
      <button type="button" class="btn" id="retry">Try again</button></div></div>`;
    $('#retry').addEventListener('click', load);
  } finally {
    btn.removeAttribute('aria-busy'); btn.disabled = false;
    btn.querySelector('.btn__label').textContent = 'Refresh';
  }
}
$('#refresh').addEventListener('click', load);

show(location.hash.slice(1) || 'overview');
load();
