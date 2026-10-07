# Payment settings API (dashboard ↔ portals)

Each portal keeps its Stripe keys in its own `settings` table, encrypted with its own
SESSION_SECRET. The dashboard never touches those tables directly: every read and write runs
that portal's own `lib/settings.js` and `lib/billing.js` (see `bridge/portal-bridge.js`), so the
encryption, the webhook URL, the events and the prices are exactly what the portal itself uses.
A saved key takes effect in the portal within 5 seconds (its settings cache), no restart.

Secrets never come back to the browser: only masked values (`sk_live_••••1234`).

## Rules for every POST
- Body is JSON, header `Content-Type: application/json` and `X-Dashboard: 1` (CSRF guard; the
  server also checks Origin). Missing → 403.
- Errors: HTTP 4xx/5xx with `{ "error": "plain-English message" }`.
- `:key` is the portal key from `portals.js`: `cc`, `ycc`, `nwc`, `fn`.

## GET /api/settings  — fast, no Stripe calls
```json
{ "enabled": true, "portals": [ {
  "key": "nwc", "name": "Newcomer Careers", "domain": "newcomer.work",
  "liveMoney": false, "notes": ["…"],
  "billingMode": "stripe" | "sandbox",          // sandbox = checkouts are simulated
  "keyMode": "live" | "test" | null,            // from the secret key prefix
  "publicUrl": "https://newcomer.work",
  "webhookUrl": "https://newcomer.work/billing/webhook",
  "webhookEvents": ["checkout.session.completed", "…"],
  "keys": {
    "stripe_secret_key":      { "set": true,  "masked": "sk_test_••••Ab12", "source": "db" | "env" | "default" },
    "stripe_publishable_key": { "set": true,  "masked": "pk_test_••••Cd34", "source": "db" },
    "stripe_webhook_secret":  { "set": false, "masked": "",                 "source": "default" }
  },
  "updatedAt": "2026-10-07T12:00:00Z" | null,   // last change to any stripe_* row
  "error": null                                  // set if this portal could not be read
} ] }
```
`source: "env"` means the value comes from the portal's .env file; saving here overrides it
(the database value wins), clearing here falls back to it.

## POST /api/settings/:key/check  — live Stripe calls (2–5 s)
```json
{ "connection": { "ok": true, "mode": "test", "error": null,
                  "account": { "id": "acct_…", "business_name": "…", "email": "…", "country": "CA",
                               "default_currency": "cad", "charges_enabled": true, "livemode": false } },
  "webhook":    { "ok": true, "exists": true, "id": "we_…", "status": "enabled", "url": "…",
                  "missingEvents": [], "secretSaved": true, "error": null },
  "prices":     { "ok": false, "missing": ["nwc_employer_monthly"], "error": null } }
```
When no secret key is set every part has `ok:false` and an `error` saying so.

## POST /api/settings/:key/keys  — save API keys
Body (send only the fields being changed; empty/omitted = leave as is):
```json
{ "stripe_secret_key": "sk_test_…", "stripe_publishable_key": "pk_test_…",
  "stripe_webhook_secret": "whsec_…", "confirm": true }
```
- **Live-change password** (`password` in the body) is REQUIRED when the portal has `liveMoney: true`,
  its current key is live, or the new secret key is live. Missing → 409 `{ error, needsPassword: true }`;
  wrong → 403; five wrong tries from one address → 429 for 15 minutes. The password is separate from
  the login; only its scrypt hash is stored (`LIVE_PASSWORD_HASH` in the dashboard .env).
- Validation (400): secret `sk_(test|live)_…` or `rk_(test|live)_…`; publishable `pk_(test|live)_…`;
  webhook `whsec_…`; secret and publishable must be the same mode (both test or both live).
- The secret key is tested against Stripe BEFORE saving; a key Stripe rejects is not saved (400).
- Response: `{ "ok": true, "saved": ["stripe_secret_key", …], "portal": <same object as GET> }`

## POST /api/settings/:key/disconnect  — back to sandbox
Body `{ "confirm": true }`; on a live portal also `"password"` (same rule as above), otherwise 409 `needsConfirm`. Clears all three keys in the portal's database.
If the portal's .env also has keys, those take over again — the response says so.
Response: `{ "ok": true, "portal": <GET object>, "envFallback": false }`

## POST /api/settings/:key/webhook  — create this portal's webhook in its Stripe account
Body `{}` (with a live key: `{ "password": … }`, else 409 `needsPassword`). Creates `<publicUrl>/billing/webhook` with the 5 events and saves the signing secret
into the portal automatically. If the endpoint already exists it is NOT duplicated.
```json
{ "ok": true, "id": "we_…", "url": "…", "created": true, "secretSaved": true,
  "events": ["…"], "note": "Created endpoint we_…. The signing secret has been saved…", "error": null }
```
(The signing secret itself is never returned.)

## POST /api/settings/:key/prices  — create this portal's prices in its Stripe account
Body `{}` (with a live key: `{ "password": … }`). Idempotent.
`{ "ok": true, "created": ["…"], "existing": ["…"], "error": null }`

## Audit
Every POST that changes something appends one line to `data/settings-audit.jsonl` (time, portal,
action, which keys, masked values, result). Never the secrets.
