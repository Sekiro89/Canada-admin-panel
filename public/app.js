// Ads dashboard — renders /api/data. What counts as real / imported / test is decided in
// server.js (userKind, adOrigin); this file only displays those kinds.
import { init } from '/kds/ui/ui.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => '$' + (Number(c || 0) / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n) => Number(n || 0).toLocaleString('en-CA');
const plural = (n, one, many = one + 's') => `${num(n)} ${n === 1 ? one : many}`;
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—'); // UTC calendar date
const sum = (list, k) => list.reduce((s, x) => s + Number(x[k] || 0), 0);
const DAY = 864e5;
const recent = (d, days) => d && Date.now() - new Date(d) < days * DAY;

const SHORT = { 'Canada Careers': 'Canada', 'Youth Careers': 'Youth', 'Newcomer Careers': 'Newcomer' };
const ORIGIN = { real: ['Real', 'positive'], imported: ['Imported', 'info'], jobbank: ['Job Bank', 'info'], test: ['Test / demo', ''] };
const KIND = { real: ['Real', 'positive'], test: ['Test / demo', ''], staff: ['Staff', 'brand'], import: ['Import', 'info'] };
const STATUS = { active: 'positive', expired: 'warning', cancelled: 'danger' };
const ROLE = { employer: 'Employer', consultant: 'Consultant', seeker: 'Job seeker', admin: 'Admin' };
const POSTERS = ['employer', 'consultant'];

const badge = (label, tone) => `<span class="kds-badge${tone ? ' kds-badge--' + tone : ''}">${esc(label)}</span>`;
const statusBadge = (s) => badge(String(s).replace('_', ' '), STATUS[s]);
const originBadge = (o) => badge(...ORIGIN[o]);
const kindBadge = (k) => badge(...KIND[k]);
const zero = (v, text) => (Number(v) ? text : `<span class="zero">${text}</span>`);
const ICON = {
  danger: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
  info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
};

let ADS = [], PEOPLE = [], PORTALS = [], shown = 60, sortKey = 'published_at', sortDir = -1;

// ---------------------------------------------------------------- stats
function realStats(ads, people) {
  const rp = people.filter((p) => p.kind === 'real');
  const ra = ads.filter((a) => a.origin === 'real');
  const test = ads.filter((a) => a.origin === 'test');
  const imported = ads.filter((a) => a.origin === 'imported' || a.origin === 'jobbank');
  return {
    accounts: rp.length,
    people: new Set(rp.map((p) => p.email.toLowerCase())).size,
    posters: rp.filter((p) => POSTERS.includes(p.role)).length,
    seekers: rp.filter((p) => p.role === 'seeker').length,
    ads: ra.length,
    activeAds: ra.filter((a) => a.status === 'active').length,
    stripe: sum(ads, 'stripe_cents'),
    stripeN: sum(ads, 'stripe_n'),
    lastPaid: ads.filter((a) => a.stripe_cents > 0).map((a) => a.last_paid).sort().pop(),
    sandboxReal: sum(rp, 'sandbox_cents'),
    apps: sum(rp, 'applications'),
    login7: rp.filter((p) => recent(p.last_login_at, 7)).length,
    imported: ads.filter((a) => a.origin === 'imported').length,
    jobbank: ads.filter((a) => a.origin === 'jobbank').length,
    test: test.length,
    testLive: test.filter((a) => a.status === 'active').length,
    appsToTest: sum(test, 'real_applications'),
    appsToImported: sum(imported, 'real_applications'),
    otherAccounts: people.filter((p) => p.kind !== 'real').length,
  };
}

// ---------------------------------------------------------------- overview
function renderOverview() {
  const t = realStats(ADS, PEOPLE);
  $('#heroMoney').textContent = money(t.stripe);
  $('#heroMoneySub').textContent = t.stripeN
    ? `${plural(t.stripeN, 'card payment')} through Stripe · last ${day(t.lastPaid)}`
    : 'No card payments yet';

  const kpi = (v, label, sub) => `<div class="kpi"><span class="kpi__value">${v}</span><span class="kpi__label">${label}</span><span class="kpi__sub">${sub}</span></div>`;
  $('#kpis').innerHTML = [
    kpi(num(t.people), 'Real people', plural(t.accounts, 'account')),
    kpi(num(t.ads), 'Ads by real people', `${num(t.activeAds)} active`),
    kpi(num(t.apps), 'Applications', 'by real seekers'),
    kpi(num(t.login7), 'Active this week', 'logged in, 7 days'),
  ].join('');

  // Alerts: things that need a decision, not information.
  const alerts = [];
  const demo = PORTALS.map((p) => ({ p, s: realStats(ADS.filter((a) => a.portal === p.name), []) })).filter((x) => x.s.testLive);
  if (demo.length) {
    const total = demo.reduce((n, x) => n + x.s.testLive, 0);
    const parts = demo.map(({ p, s }) => `${SHORT[p.name] || p.name} ${s.testLive}${s.appsToTest ? ` (${plural(s.appsToTest, 'real application')})` : ''}`);
    alerts.push(['danger', `${plural(total, 'demo ad')} ${total === 1 ? 'is' : 'are'} live on the public sites`, parts.join(' · ') + '.']);
  }
  const sandboxOnly = PORTALS.filter((p) => !p.stripe_live && !p.error);
  if (sandboxOnly.length) {
    const lost = sum(PEOPLE.filter((x) => x.kind === 'real' && sandboxOnly.some((p) => p.name === x.portal)), 'sandbox_cents');
    alerts.push(['warning', `Stripe isn’t connected on ${sandboxOnly.map((p) => p.name).join(' and ')}`,
      `Checkouts there are simulated${lost ? ` — ${money(lost)} of real people’s checkouts was not collected` : ''}.`]);
  }
  for (const p of PORTALS.filter((x) => x.error)) alerts.push(['danger', `${p.name} could not be read`, p.error]);
  $('#alerts').innerHTML = alerts.map(([tone, title, body]) =>
    `<div class="kds-alert kds-alert--${tone}" role="status">${ICON[tone === 'danger' ? 'danger' : 'info']}<div><span class="kds-alert__title">${esc(title)}</span> ${esc(body)}</div></div>`).join('');

  // Side-by-side portal table.
  const per = PORTALS.map((p) => realStats(ADS.filter((a) => a.portal === p.name), PEOPLE.filter((x) => x.portal === p.name)));
  const row = (label, key, fmt = num, cls = '', flagIf) => {
    const vals = per.map((s) => s[key]);
    const total = key === 'people' ? t.people : vals.reduce((a, b) => a + b, 0);
    const cell = (v) => `<td class="${flagIf && v ? 'flag' : ''}">${zero(v, fmt(v))}</td>`;
    return `<tr class="${cls}"><td>${label}</td>${vals.map(cell).join('')}<td class="hide-sm">${zero(total, fmt(total))}</td></tr>`;
  };
  const group = (label) => `<tr class="group"><td colspan="${PORTALS.length + 2}">${label}</td></tr>`;
  $('#compare').innerHTML =
    `<thead><tr><th>Real activity</th>${PORTALS.map((p) => `<th>${esc(SHORT[p.name] || p.name)}</th>`).join('')}<th class="hide-sm">Total</th></tr></thead><tbody>` +
    row('Money received', 'stripe', money, 'strong') +
    row('Card payments', 'stripeN') +
    row('Real accounts', 'accounts') +
    row('Employers &amp; consultants', 'posters') +
    row('Job seekers', 'seekers') +
    row('Ads posted by real people', 'ads', num, 'strong') +
    row('…active now', 'activeAds') +
    row('Applications by real seekers', 'apps') +
    row('Logged in, last 7 days', 'login7') +
    row('Sandbox checkouts (not collected)', 'sandboxReal', money, 'dim') +
    group('Imported &amp; test — excluded above') +
    row('Imported ads (BRC list)', 'imported', num, 'dim') +
    row('Job Bank ads', 'jobbank', num, 'dim') +
    row('Test / demo ads', 'test', num, 'dim') +
    row('…live on the public site', 'testLive', num, '', true) +
    row('Real applications to demo ads', 'appsToTest', num, '', true) +
    row('Real applications to imported ads', 'appsToImported', num, 'dim') +
    row('Test, staff &amp; import accounts', 'otherAccounts', num, 'dim') +
    '</tbody>';

  // Money by month.
  const months = {};
  for (const p of PORTALS) for (const m of p.monthly) (months[m.month] ??= {})[p.name] = m;
  const keys = Object.keys(months).filter((k) => PORTALS.some((p) => months[k][p.name]?.stripe_cents)).sort().reverse();
  const paying = PORTALS.filter((p) => keys.some((k) => months[k][p.name]?.stripe_cents));
  $('#monthly').innerHTML =
    `<thead><tr><th>Month</th>${paying.map((p) => `<th class="kds-table__num">${esc(SHORT[p.name] || p.name)}</th>`).join('')}<th class="kds-table__num">Total</th></tr></thead><tbody>` +
    (keys.map((k) => {
      let tot = 0;
      const cells = paying.map((p) => { const c = months[k][p.name]?.stripe_cents || 0; tot += c; return `<td class="kds-table__num num">${zero(c, c ? money(c) : '—')}</td>`; }).join('');
      return `<tr><td class="num">${k}</td>${cells}<td class="kds-table__num num"><strong>${money(tot)}</strong></td></tr>`;
    }).join('') || '<tr><td colspan="2" class="muted">No card payments yet</td></tr>') + '</tbody>';

  const imp = ADS.filter((a) => a.origin === 'imported'), jb = ADS.filter((a) => a.origin === 'jobbank'), tst = ADS.filter((a) => a.origin === 'test');
  const active = (l) => l.filter((a) => a.status === 'active').length;
  $('#imported').innerHTML = [
    ['Imported ads (BRC list)', `${num(imp.length)} <span class="muted">· ${num(active(imp))} active</span>`],
    ['Job Bank ads', `${num(jb.length)} <span class="muted">· ${num(active(jb))} active</span>`],
    ['Views on imported ads', num(sum(imp, 'views') + sum(jb, 'views'))],
    ['Import “payment” records', `${money(sum(ADS, 'import_cents'))} <span class="muted">· no money</span>`],
    ['Test / demo ads', `${num(tst.length)} <span class="muted">· ${num(active(tst))} active</span>`],
    ['Test sandbox checkouts', money(sum(tst, 'sandbox_cents'))],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

// ---------------------------------------------------------------- people
function renderPeople() {
  const q = $('#pq').value.trim().toLowerCase(), fp = $('#pPortal').value, fk = $('#pKind').value, fr = $('#pRole').value;
  const list = PEOPLE.filter((p) => (!fp || p.portal === fp) && (!fk || p.kind === fk) && (!fr || p.role === fr) &&
    (!q || [p.email, p.name].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  $('#pSummary').textContent = `${plural(list.length, 'account')} · ${plural(sum(list, 'ads_posted'), 'ad')} posted · ${money(sum(list, 'stripe_cents'))} paid by card · ${plural(sum(list, 'applications'), 'application')}`;
  const empty = '<div class="kds-empty"><p class="kds-empty__title">Nobody matches</p><p class="kds-empty__body">Try “All accounts” or clear the search.</p></div>';

  $('#pBody').innerHTML = list.map((p) => `<tr>
    <td><div class="cell-main"><strong>${esc(p.email)}</strong>${p.name ? `<span class="cell-sub">${esc(p.name)}</span>` : ''}</div></td>
    <td>${esc(ROLE[p.role] || p.role)}</td><td>${esc(SHORT[p.portal] || p.portal)}</td><td>${kindBadge(p.kind)}</td>
    <td class="num">${day(p.created_at)}</td><td class="num">${day(p.last_login_at)}</td>
    <td class="kds-table__num num">${zero(p.ads_posted, num(p.ads_posted))}${p.ads_imported ? `<div class="cell-sub">+${num(p.ads_imported)} imported</div>` : ''}</td>
    <td class="kds-table__num num">${zero(p.stripe_cents, p.stripe_cents ? money(p.stripe_cents) : '—')}</td>
    <td class="kds-table__num num muted">${p.sandbox_cents ? money(p.sandbox_cents) : '—'}</td>
    <td class="kds-table__num num">${zero(p.applications, num(p.applications))}</td></tr>`).join('') ||
    `<tr><td colspan="10">${empty}</td></tr>`;

  $('#pCards').innerHTML = list.map((p) => `<article class="card">
    <div class="card__top"><div><div class="card__title">${esc(p.email)}</div>
      <div class="card__meta">${esc(ROLE[p.role] || p.role)} · ${esc(SHORT[p.portal] || p.portal)}${p.name ? ' · ' + esc(p.name) : ''}</div></div>${kindBadge(p.kind)}</div>
    <div class="card__row"><span>${plural(p.ads_posted, 'ad')} posted${p.ads_imported ? ` <span class="muted">+${num(p.ads_imported)} imported</span>` : ''} · ${plural(p.applications, 'application')}</span>
      <span class="card__money">${p.stripe_cents ? money(p.stripe_cents) : p.sandbox_cents ? `<span class="muted">${money(p.sandbox_cents)} sandbox</span>` : '<span class="zero">—</span>'}</span></div>
    <div class="card__facts"><span>Joined ${day(p.created_at)}</span><span>Last login ${day(p.last_login_at)}</span></div>
  </article>`).join('') || empty;
}

// ---------------------------------------------------------------- ads
function filteredAds() {
  const q = $('#q').value.trim().toLowerCase(), fo = $('#fOrigin').value, fp = $('#fPortal').value, fs = $('#fStatus').value;
  const list = ADS.filter((a) => (!fo || a.origin === fo) && (!fp || a.portal === fp) && (!fs || a.status === fs) &&
    (!q || [a.title, a.employer, a.city, a.province, a.public_id, a.creator_email].join(' ').toLowerCase().includes(q)));
  const k = sortKey, d = sortDir;
  const val = (a) => ['stripe_cents', 'views', 'applications'].includes(k) ? Number(a[k] || 0)
    : k.endsWith('_at') ? (a[k] ? new Date(a[k]).getTime() : (d > 0 ? Infinity : -Infinity)) : String(a[k] || '').toLowerCase();
  return list.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * d);
}

function adLink(a) {
  const p = PORTALS.find((x) => x.name === a.portal);
  return a.status === 'active' && a.slug
    ? `<a href="https://${esc(p.domain)}/jobs/${esc(a.slug)}" target="_blank" rel="noopener">${esc(a.title)}</a>`
    : esc(a.title);
}
const adMoney = (a) => a.stripe_cents > 0 ? money(a.stripe_cents)
  : a.sandbox_cents > 0 ? `<span class="muted">${money(a.sandbox_cents)} sandbox</span>` : '<span class="zero">—</span>';

function renderAds() {
  const list = filteredAds(), page = list.slice(0, shown);
  $('#summary').textContent = `${plural(list.length, 'ad')} · ${num(list.filter((a) => a.status === 'active').length)} active · ${money(sum(list, 'stripe_cents'))} received · ${plural(sum(list, 'applications'), 'application')}`;
  const where = (a) => esc([a.city, a.province].filter(Boolean).join(', '));
  const empty = '<div class="kds-empty"><p class="kds-empty__title">No ads match</p><p class="kds-empty__body">Try “All ads” or clear the search.</p></div>';

  $('#adsBody').innerHTML = page.map((a) => `<tr>
    <td><div class="cell-main"><strong>${adLink(a)}</strong><span class="cell-sub">${esc(a.employer || '—')} · ${where(a)}</span></div></td>
    <td>${esc(SHORT[a.portal] || a.portal)}</td><td class="muted">${esc(a.creator_email || '—')}</td>
    <td>${originBadge(a.origin)}</td><td>${statusBadge(a.status)}</td>
    <td class="kds-table__num num">${adMoney(a)}</td>
    <td class="kds-table__num num">${zero(a.applications, num(a.applications))}</td><td class="kds-table__num num">${zero(a.views, num(a.views))}</td>
    <td class="num">${day(a.published_at)}</td><td class="num">${day(a.expires_at)}</td></tr>`).join('') ||
    `<tr><td colspan="10">${empty}</td></tr>`;

  $('#adsCards').innerHTML = page.map((a) => `<article class="card">
    <div class="card__top"><div><div class="card__title">${adLink(a)}</div><div class="card__meta">${esc(a.employer || '—')} · ${where(a)}</div></div>
      <span class="card__money">${adMoney(a)}</span></div>
    <div class="card__row"><div class="card__badges">${statusBadge(a.status)}${originBadge(a.origin)}${badge(SHORT[a.portal] || a.portal)}</div></div>
    <div class="card__facts">${a.creator_email ? `<span>${esc(a.creator_email)}</span>` : ''}<span>Published ${day(a.published_at)}</span>
      <span>Expires ${day(a.expires_at)}</span><span>${plural(a.applications, 'app')}</span><span>${plural(a.views, 'view')}</span></div>
  </article>`).join('') || empty;

  $('#more').hidden = list.length <= shown;
  $('#more').textContent = `Show more (${num(list.length - shown)} left)`;
  document.querySelectorAll('#p-ads th[data-k]').forEach((th) =>
    th.setAttribute('aria-sort', th.dataset.k === sortKey ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'));
}

// ---------------------------------------------------------------- wiring
$('#more').onclick = () => { shown += 60; renderAds(); };
['#q', '#fOrigin', '#fPortal', '#fStatus'].forEach((id) => $(id).addEventListener('input', () => { shown = 60; renderAds(); }));
['#pq', '#pPortal', '#pKind', '#pRole'].forEach((id) => $(id).addEventListener('input', renderPeople));
$('#fSort').onchange = (e) => { sortKey = e.target.value; sortDir = sortKey === 'expires_at' ? 1 : -1; shown = 60; renderAds(); };
document.querySelectorAll('#p-ads th[data-k]').forEach((th) => {
  th.tabIndex = 0;
  const go = () => { sortDir = sortKey === th.dataset.k ? -sortDir : -1; sortKey = th.dataset.k; renderAds(); };
  th.onclick = go;
  th.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
});

let optionsFilled = false;
async function load() {
  const btn = $('#refresh');
  btn.classList.add('is-loading');
  try {
    const d = await fetch('/api/data', { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
    PORTALS = d.portals;
    ADS = d.portals.flatMap((p) => p.ads.map((a) => ({ ...a, portal: p.name })));
    PEOPLE = d.portals.flatMap((p) => p.people.map((x) => ({ ...x, portal: p.name })));
    if (!optionsFilled) {
      const opts = PORTALS.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
      $('#fPortal').insertAdjacentHTML('beforeend', opts); $('#pPortal').insertAdjacentHTML('beforeend', opts);
      $('#fStatus').insertAdjacentHTML('beforeend', [...new Set(ADS.map((a) => a.status))].sort().map((s) => `<option value="${esc(s)}">${esc(s.replace('_', ' '))}</option>`).join(''));
      optionsFilled = true;
    }
    $('#nPeople').textContent = num(PEOPLE.filter((p) => p.kind === 'real').length);
    $('#nAds').textContent = num(ADS.filter((a) => a.origin === 'real').length);
    $('#stamp').textContent = 'Updated ' + new Date(d.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    renderOverview(); renderPeople(); renderAds();
  } catch (err) {
    $('#alerts').innerHTML = `<div class="kds-alert kds-alert--danger" role="alert">${ICON.danger}<div><span class="kds-alert__title">Could not load data.</span> Try refreshing.</div></div>`;
    $('#stamp').textContent = 'Load failed';
  } finally {
    btn.classList.remove('is-loading');
  }
}
$('#refresh').onclick = load;

init();
load();
