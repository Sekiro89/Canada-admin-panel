// Shared data layer for every dashboard design. NO markup, NO styling here — only loading,
// formatting and the derived numbers. What counts as real / imported / test is decided in
// server.js (userKind, adOrigin); this module only aggregates the kinds it is given.
// Every design imports from here so the same number is never computed two different ways.

// ---------------------------------------------------------------- formatting
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (c) => '$' + (Number(c || 0) / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const num = (n) => Number(n || 0).toLocaleString('en-CA');
export const plural = (n, one, many = one + 's') => `${num(n)} ${Number(n) === 1 ? one : many}`;
export const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—'); // UTC calendar date
export const sum = (list, k) => list.reduce((s, x) => s + Number(x[k] || 0), 0);
const DAY = 864e5;
export const recent = (d, days) => Boolean(d) && Date.now() - new Date(d) < days * DAY;

// ---------------------------------------------------------------- labels
export const SHORT = { 'Canada Careers': 'Canada', 'Youth Careers': 'Youth', 'Newcomer Careers': 'Newcomer', 'Firstnation': 'Firstnation' };
export const short = (portalName) => SHORT[portalName] || portalName;
export const ORIGIN_LABEL = { real: 'Real', imported: 'Imported (BRC list)', jobbank: 'Job Bank', test: 'Test / demo' };
export const KIND_LABEL = { real: 'Real', test: 'Test / demo', staff: 'Staff', import: 'Import account' };
export const ROLE_LABEL = { employer: 'Employer', consultant: 'Consultant', seeker: 'Job seeker', admin: 'Admin' };
export const STATUS_LABEL = (s) => String(s || '').replace('_', ' ');
// Semantic tone per value, for designs that colour-code: 'good' | 'warn' | 'bad' | 'info' | 'neutral'
export const STATUS_TONE = { active: 'good', expired: 'warn', cancelled: 'bad' };
export const ORIGIN_TONE = { real: 'good', imported: 'info', jobbank: 'info', test: 'neutral' };
export const KIND_TONE = { real: 'good', test: 'neutral', staff: 'neutral', import: 'info' };
const POSTERS = ['employer', 'consultant'];

// ---------------------------------------------------------------- loading
// Returns { generatedAt, portals, ads, people }. ads/people carry a `portal` (full name) field.
export async function loadData() {
  const r = await fetch('/api/data', { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  return {
    generatedAt: d.generated_at,
    portals: d.portals,
    ads: d.portals.flatMap((p) => p.ads.map((a) => ({ ...a, portal: p.name }))),
    people: d.portals.flatMap((p) => p.people.map((x) => ({ ...x, portal: p.name }))),
  };
}

// ---------------------------------------------------------------- derived numbers
// Stats for any slice of ads + people (the whole platform, or one portal).
export function realStats(ads, people) {
  const rp = people.filter((p) => p.kind === 'real');
  const ra = ads.filter((a) => a.origin === 'real');
  const test = ads.filter((a) => a.origin === 'test');
  const imported = ads.filter((a) => a.origin === 'imported' || a.origin === 'jobbank');
  return {
    accounts: rp.length,                                                   // real accounts
    people: new Set(rp.map((p) => p.email.toLowerCase())).size,            // unique real people
    posters: rp.filter((p) => POSTERS.includes(p.role)).length,            // employers + consultants
    seekers: rp.filter((p) => p.role === 'seeker').length,
    postedAd: rp.filter((p) => p.ads_posted > 0).length,                   // people who posted
    paidByCard: rp.filter((p) => p.stripe_cents > 0).length,               // people who paid by card
    ads: ra.length,                                                        // ads by real people
    activeAds: ra.filter((a) => a.status === 'active').length,
    stripe: sum(ads, 'stripe_cents'),                                      // MONEY RECEIVED (cents)
    stripeN: sum(ads, 'stripe_n'),                                         // number of card payments
    lastPaid: ads.filter((a) => a.stripe_cents > 0).map((a) => a.last_paid).sort().pop() || null,
    sandboxReal: sum(rp, 'sandbox_cents'),                                 // real people's simulated checkouts (not collected)
    apps: sum(rp, 'applications'),                                         // applications by real seekers
    login7: rp.filter((p) => recent(p.last_login_at, 7)).length,
    new30: rp.filter((p) => recent(p.created_at, 30)).length,
    imported: ads.filter((a) => a.origin === 'imported').length,
    jobbank: ads.filter((a) => a.origin === 'jobbank').length,
    test: test.length,
    testLive: test.filter((a) => a.status === 'active').length,            // demo ads visible to the public
    appsToTest: sum(test, 'real_applications'),                            // real seekers applying to demo ads
    appsToImported: sum(imported, 'real_applications'),
    otherAccounts: people.filter((p) => p.kind !== 'real').length,        // test + staff + import accounts
  };
}

// One stats object per portal, in portal order: [{ portal, stats }]
export function perPortal(data) {
  return data.portals.map((p) => ({
    portal: p,
    stats: realStats(data.ads.filter((a) => a.portal === p.name), data.people.filter((x) => x.portal === p.name)),
  }));
}

// Things that need a decision. [{ tone: 'bad'|'warn', title, body }]
export function alerts(data) {
  const out = [];
  const demo = perPortal(data).filter((x) => x.stats.testLive);
  if (demo.length) {
    const total = demo.reduce((n, x) => n + x.stats.testLive, 0);
    const parts = demo.map(({ portal, stats }) => `${short(portal.name)} ${stats.testLive}${stats.appsToTest ? ` (${plural(stats.appsToTest, 'real application')})` : ''}`);
    out.push({ tone: 'bad', title: `${plural(total, 'demo ad')} ${total === 1 ? 'is' : 'are'} live on the public sites`, body: parts.join(' · ') + '.' });
  }
  const sandboxOnly = data.portals.filter((p) => !p.stripe_live && !p.error);
  if (sandboxOnly.length) {
    const lost = sum(data.people.filter((x) => x.kind === 'real' && sandboxOnly.some((p) => p.name === x.portal)), 'sandbox_cents');
    out.push({ tone: 'warn', title: `Stripe isn’t connected on ${sandboxOnly.map((p) => p.name).join(' and ')}`,
      body: `Checkouts there are simulated${lost ? `, so ${money(lost)} of real people’s checkouts was not collected` : ''}.` });
  }
  for (const p of data.portals.filter((x) => x.error)) out.push({ tone: 'bad', title: `${p.name} could not be read`, body: p.error });
  return out;
}

// Card money by month, only months/portals that had card payments.
// { portals: [portal...], rows: [{ month: 'YYYY-MM', cells: [cents per portal], total }] }
export function monthly(data) {
  const months = {};
  for (const p of data.portals) for (const m of p.monthly) (months[m.month] ??= {})[p.name] = m.stripe_cents || 0;
  const keys = Object.keys(months).filter((k) => data.portals.some((p) => months[k][p.name])).sort().reverse();
  const portals = data.portals.filter((p) => keys.some((k) => months[k][p.name]));
  return {
    portals,
    rows: keys.map((k) => { const cells = portals.map((p) => months[k][p.name] || 0); return { month: k, cells, total: cells.reduce((a, b) => a + b, 0) }; }),
  };
}

// The imported / test data, kept apart. [{ label, value, note }]
export function importedFacts(data) {
  const by = (o) => data.ads.filter((a) => a.origin === o);
  const active = (l) => l.filter((a) => a.status === 'active').length;
  const imp = by('imported'), jb = by('jobbank'), tst = by('test');
  return [
    { label: 'Imported ads (BRC list)', value: num(imp.length), note: `${num(active(imp))} active` },
    { label: 'Job Bank ads', value: num(jb.length), note: `${num(active(jb))} active` },
    { label: 'Views on imported ads', value: num(sum(imp, 'views') + sum(jb, 'views')), note: '' },
    { label: 'Import “payment” records', value: money(sum(data.ads, 'import_cents')), note: 'no money' },
    { label: 'Test / demo ads', value: num(tst.length), note: `${num(active(tst))} active` },
    { label: 'Test sandbox checkouts', value: money(sum(tst, 'sandbox_cents')), note: '' },
  ];
}

// The rows of the portal comparison, in display order. Each: { key, label, format: 'money'|'num',
// group: 'real'|'excluded', emphasis?: true, flag?: true (non-zero is a problem) }
export const COMPARE_ROWS = [
  { key: 'stripe', label: 'Money received', format: 'money', group: 'real', emphasis: true },
  { key: 'stripeN', label: 'Card payments', format: 'num', group: 'real' },
  { key: 'accounts', label: 'Real accounts', format: 'num', group: 'real' },
  { key: 'posters', label: 'Employers & consultants', format: 'num', group: 'real' },
  { key: 'seekers', label: 'Job seekers', format: 'num', group: 'real' },
  { key: 'ads', label: 'Ads posted by real people', format: 'num', group: 'real', emphasis: true },
  { key: 'activeAds', label: 'Active now', format: 'num', group: 'real' },
  { key: 'apps', label: 'Applications by real seekers', format: 'num', group: 'real' },
  { key: 'login7', label: 'Logged in, last 7 days', format: 'num', group: 'real' },
  { key: 'sandboxReal', label: 'Sandbox checkouts (not collected)', format: 'money', group: 'real' },
  { key: 'imported', label: 'Imported ads (BRC list)', format: 'num', group: 'excluded' },
  { key: 'jobbank', label: 'Job Bank ads', format: 'num', group: 'excluded' },
  { key: 'test', label: 'Test / demo ads', format: 'num', group: 'excluded' },
  { key: 'testLive', label: 'Demo ads live on the public site', format: 'num', group: 'excluded', flag: true },
  { key: 'appsToTest', label: 'Real applications to demo ads', format: 'num', group: 'excluded', flag: true },
  { key: 'appsToImported', label: 'Real applications to imported ads', format: 'num', group: 'excluded' },
  { key: 'otherAccounts', label: 'Test, staff & import accounts', format: 'num', group: 'excluded' },
];
export const fmt = (format, v) => (format === 'money' ? money(v) : num(v));

// ---------------------------------------------------------------- lists
// opts: { q, origin, portal, status, sortKey, sortDir (1|-1) }. origin '' = all.
export function filterAds(ads, { q = '', origin = '', portal = '', status = '', sortKey = 'published_at', sortDir = -1 } = {}) {
  const needle = q.trim().toLowerCase();
  const list = ads.filter((a) => (!origin || a.origin === origin) && (!portal || a.portal === portal) && (!status || a.status === status) &&
    (!needle || [a.title, a.employer, a.city, a.province, a.public_id, a.creator_email].join(' ').toLowerCase().includes(needle)));
  const numeric = ['stripe_cents', 'sandbox_cents', 'views', 'applications'].includes(sortKey);
  const val = (a) => numeric ? Number(a[sortKey] || 0)
    : sortKey.endsWith('_at') ? (a[sortKey] ? new Date(a[sortKey]).getTime() : (sortDir > 0 ? Infinity : -Infinity))
    : String(a[sortKey] || '').toLowerCase();
  return list.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sortDir);
}

// opts: { q, kind ('real' default; '' = all), portal, role }. Newest first.
export function filterPeople(people, { q = '', kind = 'real', portal = '', role = '' } = {}) {
  const needle = q.trim().toLowerCase();
  return people.filter((p) => (!portal || p.portal === portal) && (!kind || p.kind === kind) && (!role || p.role === role) &&
    (!needle || [p.email, p.name].join(' ').toLowerCase().includes(needle)))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// Public URL of an ad, or null when it is not live.
export function adUrl(ad, portals) {
  const p = portals.find((x) => x.name === ad.portal);
  return ad.status === 'active' && ad.slug && p ? `https://${p.domain}/jobs/${encodeURIComponent(ad.slug)}` : null;
}
