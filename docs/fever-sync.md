# Fever Data Sync: Technical Spec

## Overview

We pull order and ticket data from Fever's Data Reporting API into our Supabase database every 5 minutes via a Vercel cron job. The dashboard reads from Supabase, never from Fever directly.

```
Fever API --> Vercel Cron (every 5min) --> Supabase --> Dashboard UI
```

## Fever API

**Host**: `data-reporting-api.prod.feverup.com`

The Fever API uses an async search pattern. You don't get results back from a single request. Instead it's a 4-step flow:

### Step 1: Authenticate

```
POST /v1/auth/token
Content-Type: application/x-www-form-urlencoded

username=<FEVER_USERNAME>&password=<FEVER_PASSWORD>
```

Returns `{ "access_token": "..." }`. Use as `Authorization: Bearer <token>` on all subsequent requests.

### Step 2: Start a search

```
POST /v1/reports/order-items/search
Authorization: Bearer <token>
Content-Type: application/json

{
  "date_field": "CREATED_DATE_UTC",
  "date_from": "2026-01-01",
  "date_to": "2026-02-13"
}
```

- `date_field` / `date_from` / `date_to` (optional): For incremental syncs, filters to orders created after last sync.
- We omit `plan_ids` so the search returns every order on the account. This way new plans (e.g. shuttles, add-ons) show up automatically without a config change.
- Other accepted filters the API supports but we don't use: `order_ids` (array of specific order IDs — handy for one-off lookups).

Returns `{ "search_id": "abc-123" }`. The search runs asynchronously on Fever's side.

### Step 3: Poll until ready

```
GET /v1/reports/order-items/search/<search_id>
Authorization: Bearer <token>
```

Keep polling every 2 seconds (max 60 attempts). Response will eventually include a `partition_info` array when results are ready. Each entry represents a page of results.

### Step 4: Fetch each partition

```
GET /v1/reports/order-items/search/<search_id>?page=<partition_number>
Authorization: Bearer <token>
```

Returns `{ "data": [...] }` where each entry is an order object with nested `order_items`. We flatten these into two separate collections: orders and items.

### Response shape

Each order contains nested objects for buyer info, purchase location, plan details, UTM tracking, and an `order_items` array. Each order item has status, pricing (unitary_price, discount, surcharge), session/venue details, and plan code info.

See `src/lib/fever.ts` for the full type definitions (`FeverApiOrder`, `FeverApiItem`).

## Sync Process

**File**: `src/app/api/cron/fever-sync/route.ts`

### Incremental vs Full Sync

- **Incremental** (cron, default): Uses `last_order_created_at` from `fever_sync_state` as `date_from`. Only fetches orders created since last sync.
- **Full** (manual via `?manual=true`): No date filter. Fetches all orders across all time.

### Upsert logic

1. Fetch orders from Fever API
2. Check which `fever_order_id` values already exist in Supabase
3. Upsert orders in batches of 100 (`ON CONFLICT fever_order_id`)
4. Upsert items in batches of 100 (`ON CONFLICT fever_order_id, fever_item_id`)
5. Send Slack notifications for new orders (up to 10 per sync)
6. Update `fever_sync_state` only if all batches succeeded; otherwise leave the watermark unchanged so the next tick retries the failed window. `last_sync_at` always advances (errored vs didn't-run stays distinguishable). The watermark itself is computed only over orders whose upsert batch succeeded — the rule is "advance no further than the data we actually wrote." This guards against the 2026-05-27 silent-data-loss class of bug.

### Sync state table

```sql
fever_sync_state (id = 1, single row)
  - last_sync_at          -- when sync last ran successfully
  - last_order_created_at -- most recent order creation date (used as date_from for incremental)
  - orders_synced         -- running total of orders inserted
  - items_synced          -- running total of items inserted
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `FEVER_USERNAME` | Fever API username |
| `FEVER_PASSWORD` | Fever API password |
| `FEVER_HOST` | API host (defaults to `data-reporting-api.prod.feverup.com`) |
| `FEVER_SLACK_WEBHOOK_URL` | Slack webhook for new order notifications |
| `CRON_SECRET` | Vercel cron authentication token |

## Database Tables

### `fever_orders`

Primary key: `fever_order_id`

Stores order-level data: buyer info (email, name, DOB, language), purchase location, payment method, plan/partner/business associations, coupon info, UTM tracking, and order-level surcharges.

### `fever_order_items`

Primary key: `(fever_order_id, fever_item_id)`

Stores item-level data: status (`purchased`, `cancelled`, etc.), pricing (unitary_price, discount, surcharge), session/venue info, plan code validation state, and owner info (can differ from buyer).

### `fever_sync_state`

Single row (id=1). Tracks sync cursor and running totals.

## Triggering a Sync

### Automatic (cron)

Vercel cron hits `GET /api/cron/fever-sync` every 5 minutes with `Authorization: Bearer <CRON_SECRET>`. Runs incremental sync.

### Manual (dashboard button)

"Sync Now" button on the overview and products pages. Calls `POST /api/fever` which proxies to the cron endpoint with the server-side `CRON_SECRET`. Runs as manual (full) sync.

### Manual (API)

```bash
curl -X POST "https://dashboard.icelandeclipse.com/api/cron/fever-sync?manual=true" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

### Manual / backfill query params

| Param | Where | Effect |
|-------|-------|--------|
| `manual=true` | GET or POST | Run as a manual sync. Without `date_from`/`date_to`, re-pulls the entire Fever archive (slow). |
| `date_from=YYYY-MM-DD` | POST + manual | Lower bound for the Fever search window. Must be paired with `date_to`. |
| `date_to=YYYY-MM-DD` | POST + manual | Upper bound. Both required together; supplying only one returns 400. |
| `skipSlack=true` | GET or POST | Suppress the new-order Slack notifications for this run. |
| `skipSegment=true` | GET or POST | Suppress the entire Segment block (identify + track for new orders, cancellation tracking for existing). Use for Supabase-only repair when Segment replay is a separate decision. |

Example targeted backfill (e.g. repairing the 2026-05-27 gap):

```bash
curl -X POST "https://dashboard.icelandeclipse.com/api/cron/fever-sync?manual=true&date_from=2026-05-26&date_to=2026-05-28&skipSegment=true" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

### Run logging

Every invocation of `runSync` writes a row to `fever_sync_runs` (schema in migration `015_fever_sync_runs.sql`):

```sql
fever_sync_runs (
  id                    bigserial PRIMARY KEY,
  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz,
  kind                  text CHECK (kind IN ('incremental','manual','health-check')),
  orders_fetched        int,
  orders_inserted       int,
  orders_updated        int,
  errors                jsonb,       -- [{index, message}]
  reconciliation        jsonb,       -- { deltas: [{day, fever_count, supabase_count, missing_ids, extra_ids}] }
  watermark_advanced_to timestamptz, -- null when an error held the watermark
  skipped_segment       boolean DEFAULT false
)
```

The `?status=true` endpoint surfaces aggregate signals from this table:

- `recent_errors_count`: runs in the last 24h with non-empty `errors`.
- `most_recent_run_at`: latest `started_at`.

Pat (hermes-side) polls this table to post failure summaries to `#pat-health`.

### Reconciliation

`/api/cron/fever-health-check` runs daily (Vercel cron `0 4 * * *`). For each of the previous 7 UTC calendar days it independently queries Fever and Supabase and reports any order-id deltas. On Sundays it additionally checks days 8..90 ("weekly deep check") for slow-developing drift.

Results write to `fever_sync_runs` with `kind='health-check'` and `reconciliation` populated. **Detect-only** — discrepancies do not auto-fire backfills. Jon decides what to do with each delta. The eventual auto-fix flow (Phase 3b v2) will always set `skipSegment=true` so Segment replay stays a human decision.

This is the only layer that doesn't trust the sync's self-reported success. It catches both silent-batch-error gaps and Fever-returned-incomplete-data gaps, which the per-run error log cannot.

### Martech replay policy

Supabase is the system of record. Segment firing is a separate decision that requires human (Jameson + Mitch) sign-off whenever it's a backfill — never automatic. Reasons:

- Late `Order Completed` events can re-trigger CIO campaigns (e.g. thank-you emails sent 5 days delayed).
- `firstTouchReferringDomain` can flip retroactively if a buyer has post-gap purchases already in CIO.
- BigQuery dupes, Amplitude funnel/retention skew, MTU billing.

Mechanism for replays: targeted Supabase repair via `?manual=true&date_from=...&date_to=...&skipSegment=true`, then a separate `scripts/segment-replay-fever-orders.ts` invocation gated on Jameson's approval (with `--skip-first-touch` on by default).

## Revenue Calculation

**File**: `src/app/api/fever/route.ts` (`getFeverMetrics`)

Only items with `status = 'purchased'` count toward revenue.

```
Per item:
  item_revenue = unitary_price + surcharge - discount

Totals:
  tickets_and_addons_revenue = sum(unitary_price)
  total_gross_revenue = tickets_and_addons_revenue + sum(surcharge)
  user_payment = total_gross_revenue - sum(discount)
```

Revenue is also broken down by `plan_id` for per-product reporting.

## File Map

| File | Purpose |
|------|---------|
| `src/lib/fever.ts` | Fever API client, auth, search/poll/fetch flow, type transforms |
| `src/app/api/cron/fever-sync/route.ts` | Cron endpoint, upsert logic, Slack notifications, Segment events, run logging |
| `src/app/api/cron/fever-health-check/route.ts` | Daily reconciliation cron — independent Fever-vs-Supabase delta check |
| `src/app/api/fever/route.ts` | Dashboard API: metrics, sync state, debug info, manual sync trigger |
| `src/lib/fever-client.ts` | Client-side helpers for fetching metrics/sync state from `/api/fever` |
| `src/lib/supabase.ts` | Supabase client |
| `supabase/migrations/015_fever_sync_runs.sql` | Per-run log table |
| `vercel.json` | Cron schedules (`*/5 * * * *` for sync, `0 4 * * *` for reconciliation) |

## Querying Fever Data Directly

You don't need to hit the Fever API yourself. The cron keeps Supabase up to date every 5 minutes, so just query the tables directly.

### Connection

Ask a project admin to create a read-only Postgres role for your service:

```sql
CREATE ROLE fever_readonly WITH LOGIN PASSWORD '<secure-password>';
GRANT USAGE ON SCHEMA public TO fever_readonly;
GRANT SELECT ON fever_orders, fever_order_items, fever_sync_state TO fever_readonly;
```

Then connect using the session pooler (note: the project ref is required in the username):

```
postgresql://fever_readonly.qnozzvniuptjzefkttgj:<password>@aws-1-us-east-2.pooler.supabase.com:5432/postgres
```

This scopes access to only the fever tables with read-only permissions.

### Useful queries

All purchased tickets with buyer and session info:

```sql
SELECT
  o.buyer_email,
  o.buyer_first_name,
  o.buyer_last_name,
  o.plan_name,
  i.unitary_price,
  i.discount,
  i.surcharge,
  i.status,
  i.session_name,
  i.session_start
FROM fever_order_items i
JOIN fever_orders o ON o.fever_order_id = i.fever_order_id
WHERE i.status = 'purchased';
```

Revenue by plan:

```sql
SELECT
  o.plan_name,
  COUNT(*) as tickets,
  SUM(i.unitary_price + COALESCE(i.surcharge, 0) - COALESCE(i.discount, 0)) as revenue
FROM fever_order_items i
JOIN fever_orders o ON o.fever_order_id = i.fever_order_id
WHERE i.status = 'purchased'
GROUP BY o.plan_name;
```

Check when data was last synced:

```sql
SELECT last_sync_at, last_order_created_at FROM fever_sync_state WHERE id = 1;
```

### Data freshness

Data is at most 5 minutes stale. The `fever_sync_state` table tracks the last successful sync time. If you need to force a refresh, hit the dashboard "Sync Now" button or call the API directly:

```bash
curl -X POST "https://dashboard.icelandeclipse.com/api/cron/fever-sync" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

## Common Issues

**Auth failures**: Fever tokens expire. Each sync run gets a fresh token, so this shouldn't be persistent. If auth fails, check that `FEVER_USERNAME` and `FEVER_PASSWORD` are still valid.

**Poll timeout**: The search can take up to 2 minutes (60 polls x 2s). If Fever's backend is slow, the sync will fail with a timeout. The next cron run will retry.

**Rate limiting**: Rapid successive syncs (e.g. spamming "Sync Now") can trigger Fever API rate limits. The cron runs every 5 minutes which is well within limits.
