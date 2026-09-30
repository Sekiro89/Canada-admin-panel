// Ads dashboard — read-only view of job ads + payments across the three portals.
// Listens on 127.0.0.1 only; Caddy fronts it with HTTPS + basic auth.
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

// One row per ad. Money: only status='paid' payments count. "real" = stripe + import
// (import = historical payments migrated from the old system); sandbox = simulated.
const ADS_SQL = `
  select j.id, j.public_id, j.title, j.slug, j.status, coalesce(j.source,'direct') as source,
         coalesce(e.company_name, j.source_employer, j.operating_name) as employer,
         j.city, j.province, j.views, j.created_at, j.published_at, j.expires_at,
         coalesce(p.real_cents,0)::bigint as real_cents,
         coalesce(p.sandbox_cents,0)::bigint as sandbox_cents,
         coalesce(p.n,0)::int as payments, p.last_paid, p.providers,
         s.status as sub_status, s.current_period_end, s.cancel_at_period_end
  from jobs j
  left join employer_profiles e on e.id = j.employer_profile_id
  left join (
    select job_id,
           sum(total_cents) filter (where provider <> 'sandbox') as real_cents,
           sum(total_cents) filter (where provider = 'sandbox') as sandbox_cents,
           count(*) as n, max(paid_at) as last_paid,
           string_agg(distinct provider, ',') as providers
    from payments where status = 'paid' group by job_id
  ) p on p.job_id = j.id
  left join lateral (
    select status, current_period_end, cancel_at_period_end from subscriptions
    where job_id = j.id order by created_at desc limit 1
  ) s on true
  order by j.created_at desc`;

const MONTHLY_SQL = `
  select to_char(date_trunc('month', paid_at at time zone 'UTC'), 'YYYY-MM') as month,
         sum(total_cents) filter (where provider <> 'sandbox')::bigint as real_cents,
         sum(total_cents) filter (where provider = 'sandbox')::bigint as sandbox_cents,
         count(*)::int as n
  from payments where status = 'paid' and paid_at is not null
  group by 1 order by 1`;

async function load() {
  const out = { generated_at: new Date().toISOString(), portals: [] };
  await Promise.all(PORTALS.map(async (p) => {
    try {
      const [ads, monthly] = await Promise.all([p.pool.query(ADS_SQL), p.pool.query(MONTHLY_SQL)]);
      out.portals.push({ key: p.key, name: p.name, domain: p.domain, ads: ads.rows, monthly: monthly.rows });
    } catch (err) {
      console.error(p.db, err.message);
      out.portals.push({ key: p.key, name: p.name, domain: p.domain, ads: [], monthly: [], error: 'Could not read ' + p.db });
    }
  }));
  out.portals.sort((a, b) => PORTALS.findIndex(x => x.key === a.key) - PORTALS.findIndex(x => x.key === b.key));
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
