// Ads dashboard — read-only view of ads, people and payments across the three portals.
// Listens on 127.0.0.1 only; Caddy fronts it with HTTPS + basic auth.
//
// The one place that decides what is "real" vs imported vs test. The page only displays
// the kinds computed here — never re-derive them client-side.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const PORTALS = [
  { key: 'cc', name: 'Canada Careers', domain: 'canadacareers.jobs', db: 'cc_main' },
  { key: 'ycc', name: 'Youth Careers', domain: 'youthfuturejobs.ca', db: 'ycc_main' },
  { key: 'nwc', name: 'Newcomer Careers', domain: 'newcomer.work', db: 'nwc_main' },
];
for (const p of PORTALS) p.pool = new Pool({ database: p.db, max: 2 });

// --- Classification rules ------------------------------------------------------------
// Accounts: the Job Bank import account, test/demo addresses, and our own staff are not
// "real people". Everyone else is.
const IMPORT_EMAIL = /^jobbank-import@/i;
const TEST_EMAIL = /@(example\.com|example\.invalid|test\.com)$|\.(test|local)$/i;
const STAFF_EMAIL = /@khoshasystems\.com$/i;

function userKind(u) {
  if (IMPORT_EMAIL.test(u.email)) return 'import';
  if (TEST_EMAIL.test(u.email)) return 'test';
  if (STAFF_EMAIL.test(u.email) || u.role === 'admin') return 'staff';
  return 'real';
}

// Ads: Job Bank feed rows carry source='jobbank'. The BRC list (scripts/import-brc.js) and
// scripts/mark-imported-paid.js leave source NULL but give each posting a provider='import'
// subscription — that is the marker. Otherwise the ad is real only if a real person made it.
function adOrigin(ad, creatorKind) {
  if (ad.source === 'jobbank') return 'jobbank';
  if (ad.has_import_sub) return 'imported';
  if (creatorKind === 'real') return 'real';
  return 'test';   // demo seed, test accounts, staff
}

// Money: only provider='stripe' is money received. 'import' rows are book-keeping written
// by the import scripts (no money taken); 'sandbox' is simulated checkout.
const ADS_SQL = `
  select j.id, j.public_id, j.title, j.slug, j.status, j.source, j.created_by,
         coalesce(e.company_name, j.source_employer, j.operating_name) as employer,
         j.city, j.province, j.views, j.created_at, j.published_at, j.expires_at,
         coalesce(p.stripe_cents,0)::bigint as stripe_cents,
         coalesce(p.sandbox_cents,0)::bigint as sandbox_cents,
         coalesce(p.import_cents,0)::bigint as import_cents,
         coalesce(p.stripe_n,0)::int as stripe_n, p.last_paid,
         exists (select 1 from subscriptions s where s.job_id = j.id and s.provider = 'import') as has_import_sub,
         s.status as sub_status, s.provider as sub_provider, s.cancel_at_period_end
  from jobs j
  left join employer_profiles e on e.id = j.employer_profile_id
  left join (
    select job_id,
           sum(total_cents) filter (where provider = 'stripe') as stripe_cents,
           sum(total_cents) filter (where provider = 'sandbox') as sandbox_cents,
           sum(total_cents) filter (where provider = 'import') as import_cents,
           count(*) filter (where provider = 'stripe') as stripe_n,
           max(paid_at) as last_paid
    from payments where status = 'paid' group by job_id
  ) p on p.job_id = j.id
  left join lateral (
    select status, provider, cancel_at_period_end from subscriptions
    where job_id = j.id order by created_at desc limit 1
  ) s on true
  order by coalesce(j.published_at, j.created_at) desc`;

const USERS_SQL = `select id, email, role, name, created_at, last_login_at, is_active from users order by created_at desc`;
const APPS_SQL = `select job_id, seeker_user_id, status, created_at from applications`;
const PAYMENTS_SQL = `
  select job_id, payer_user_id, provider, total_cents, paid_at
  from payments where status = 'paid' and provider in ('stripe', 'sandbox')`;

async function loadPortal(p) {
  const [ads, users, apps, pays] = await Promise.all(
    [ADS_SQL, USERS_SQL, APPS_SQL, PAYMENTS_SQL].map(sql => p.pool.query(sql).then(r => r.rows)));

  const byId = new Map(users.map(u => [u.id, u]));
  for (const u of users) u.kind = userKind(u);
  for (const a of ads) {
    const creator = byId.get(a.created_by);
    a.creator_email = creator?.email || null;
    a.origin = adOrigin(a, creator?.kind);
    a.applications = 0; a.real_applications = 0;
  }
  const adById = new Map(ads.map(a => [a.id, a]));
  for (const ap of apps) {
    const ad = adById.get(ap.job_id);
    if (!ad) continue;
    ad.applications++;
    if (byId.get(ap.seeker_user_id)?.kind === 'real') ad.real_applications++;
  }

  // Per-person activity (every account; the page shows real ones by default).
  const people = users.map(u => {
    const mine = ads.filter(a => a.created_by === u.id);
    const myPays = pays.filter(x => x.payer_user_id === u.id);
    return {
      email: u.email, name: u.name, role: u.role, kind: u.kind, is_active: u.is_active,
      created_at: u.created_at, last_login_at: u.last_login_at,
      ads_posted: mine.filter(a => a.origin !== 'imported' && a.origin !== 'jobbank').length,
      ads_imported: mine.filter(a => a.origin === 'imported' || a.origin === 'jobbank').length,
      stripe_cents: myPays.filter(x => x.provider === 'stripe').reduce((s, x) => s + x.total_cents, 0),
      sandbox_cents: myPays.filter(x => x.provider === 'sandbox').reduce((s, x) => s + x.total_cents, 0),
      applications: apps.filter(x => x.seeker_user_id === u.id).length,
    };
  });

  // Real-money and simulated payments by month, attributed by the payer's account kind.
  const monthly = {};
  for (const x of pays) {
    if (!x.paid_at) continue;
    const m = new Date(x.paid_at).toISOString().slice(0, 7);   // UTC month
    monthly[m] ??= { month: m, stripe_cents: 0, sandbox_real_cents: 0, n_stripe: 0 };
    if (x.provider === 'stripe') { monthly[m].stripe_cents += x.total_cents; monthly[m].n_stripe++; }
    else if (byId.get(x.payer_user_id)?.kind === 'real') monthly[m].sandbox_real_cents += x.total_cents;
  }

  for (const a of ads) { delete a.created_by; delete a.has_import_sub; }
  return { ads, people, monthly: Object.values(monthly),
           stripe_live: pays.some(x => x.provider === 'stripe') };
}

async function load() {
  const out = { generated_at: new Date().toISOString(), portals: [] };
  out.portals = await Promise.all(PORTALS.map(async (p) => {
    const base = { key: p.key, name: p.name, domain: p.domain };
    try {
      return { ...base, ...(await loadPortal(p)) };
    } catch (err) {
      console.error(p.db, err.message);
      return { ...base, ads: [], people: [], monthly: [], error: 'Could not read ' + p.db };
    }
  }));
  return out;
}

const page = fs.readFileSync(path.join(__dirname, 'index.html'));

http.createServer(async (req, res) => {
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
  if (req.url === '/api/data') {
    try {
      const data = await load();
      res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      console.error(err);
      res.writeHead(500, headers); res.end('error');
    }
  } else if (req.url === '/' || req.url.startsWith('/?')) {
    res.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page);
  } else {
    res.writeHead(404, headers); res.end('not found');
  }
}).listen(Number(process.env.PORT) || 3950, '127.0.0.1', () => console.log('ads-dashboard on', process.env.PORT));
