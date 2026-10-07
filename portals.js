// The four portals on this server — the ONE list both the stats (server.js) and the payment
// settings (settings.js) read. Add a portal here and nowhere else.
//
//   key      short id used in URLs (/api/settings/<key>/…)
//   db       its Postgres database (read with the SELECT-only role adsdash)
//   tree     the directory its systemd unit runs; settings are written by THAT tree's own code
//   envFile  the unit's EnvironmentFile (SESSION_SECRET there encrypts its stored Stripe keys)
//   liveMoney  true when the portal is already taking real card payments: changing its keys
//              needs an explicit confirmation in the settings page
//   notes    shown on the settings page above that portal's keys (plain English, why it matters)
module.exports = [
  {
    key: 'cc', name: 'Canada Careers', domain: 'canadacareers.jobs', db: 'cc_main',
    tree: '/home/ubuntu/projects/canada-careers', envFile: '/home/ubuntu/projects/canada-careers/.env',
    liveMoney: true,
    notes: ['This portal is taking real card payments. Changing or removing its keys affects live checkouts immediately.'],
  },
  {
    key: 'ycc', name: 'Youth Careers', domain: 'youthfuturejobs.ca', db: 'ycc_main',
    tree: '/root/projects/youth-careers-live', envFile: '/root/projects/youth-careers-live/.env',
    liveMoney: false,
    notes: ['Use a Stripe account that belongs to this portal only: Youth does not yet ignore other portals’ Stripe events (task T-020).'],
  },
  {
    key: 'nwc', name: 'Newcomer Careers', domain: 'newcomer.work', db: 'nwc_main',
    tree: '/root/projects/newcomers-live', envFile: '/root/projects/newcomers-live/.env',
    liveMoney: false,
    notes: [],
  },
  {
    key: 'fn', name: 'Firstnation', domain: 'firstnationsemployment.ca', db: 'fn_main',
    tree: '/root/projects/firstnation-live', envFile: '/root/projects/firstnation-live/.env',
    liveMoney: false,
    notes: ['Still carries Canada Careers’ Stripe names (cc_* prices, webhook described as “Youth Careers Canada”) and does not ignore other portals’ events (task T-028). Fine on its own Stripe account; fix T-028 before real customers pay.'],
  },
];
