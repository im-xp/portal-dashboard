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
  "plan_ids": [123, 456],
  "date_field": "CREATED_DATE_UTC",
  "date_from": "2026-01-01",
  "date_to": "2026-02-13"
}
```

- `plan_ids` (required): From `FEVER_PLAN_IDS` env var, comma-separated integers. These are the specific Fever event plans we track.
- `date_field` / `date_from` / `date_to` (optional): For incremental syncs, filters to orders created after last sync.

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
6. Update `fever_sync_state` with current timestamp and latest `order_created_at`

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
| `FEVER_PLAN_IDS` | Comma-separated plan IDs to fetch (e.g. `123,456,789`) |
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
| `src/app/api/cron/fever-sync/route.ts` | Cron endpoint, upsert logic, Slack notifications |
| `src/app/api/fever/route.ts` | Dashboard API: metrics, sync state, debug info, manual sync trigger |
| `src/lib/fever-client.ts` | Client-side helpers for fetching metrics/sync state from `/api/fever` |
| `src/lib/supabase.ts` | Supabase client |
| `vercel.json` | Cron schedule (`*/5 * * * *`) |

## Querying Fever Data Directly

You don't need to hit the Fever API yourself. The cron keeps Supabase up to date every 5 minutes, so just query the tables directly.

### Connection

Ask a project admin to create you a Supabase account with read-only access. Go to the Supabase dashboard > Project Settings > Database > Roles to set this up. This keeps access scoped and auditable rather than sharing a single service role credential.

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

**Missing plan IDs**: If `FEVER_PLAN_IDS` is empty or wrong, the search will return no results. You need the numeric plan IDs from Fever's dashboard.

**Rate limiting**: Rapid successive syncs (e.g. spamming "Sync Now") can trigger Fever API rate limits. The cron runs every 5 minutes which is well within limits.
