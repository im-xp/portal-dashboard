# Fever Order Import - Agent Architecture Plan

## Code Analysis

### What the Fever code does well:
- **Complete field extraction**: 68 fields covering orders, items, buyers, sessions, venues
- **Handles async API pattern**: POST search → poll for partition_info → fetch partitions
- **Robust error handling**: Try/catch at each stage with logging
- **Date filtering support**: `DATE_FIELD`, `DATE_FROM`, `DATE_TO` params enable incremental sync

### Issues to fix:
1. **Hard-coded credentials** - Need to move to env vars
2. **No incremental sync state** - Currently fetches all matching orders every time
3. **Gumloop-specific return format** - Needs refactoring for standalone use

### API Characteristics (important for architecture):
- **Batch/reporting API, not real-time** - Each query:
  - Posts search request
  - Polls up to 60 times × 2s sleep = **up to 2 minutes** to complete
  - Then fetches paginated results
- **No webhook support** - Must poll for new orders
- **Date filtering available** - Can query `CREATED_DATE_UTC >= last_sync`

---

## Architecture Options

### Option A: Vercel Cron (Recommended)
Use the same pattern as your Gmail sync.

```
/api/cron/fever-sync (every 5-10 min)
    ↓
Query Fever API (date_from = last_sync_timestamp)
    ↓
Diff against stored orders in Supabase
    ↓
New orders? → Slack notification + store in DB
    ↓
Update sync timestamp
```

**Pros:**
- Zero new infrastructure - you already have this pattern
- Free on Vercel (within limits)
- Automatic retries, logging via Vercel dashboard

**Cons:**
- 10-second timeout on Vercel Hobby (55s on Pro) - Fever polling could exceed this
- 5-10 min polling interval (not truly "real-time")

**Workaround for timeout**: Use Vercel's `maxDuration` config (Pro plan) or split into search-start + result-fetch endpoints.

### Option B: Fly.io Background Worker
Dedicated process running a polling loop.

**Pros:**
- No timeout constraints
- Can poll more frequently (every 1-2 min)
- Can maintain persistent connection

**Cons:**
- Additional infrastructure to manage
- ~$5-10/month for minimal Fly instance
- Overkill for this use case

### Option C: Claude Agent (NOT recommended)
Running Claude to poll an API is like using a chainsaw to butter toast.

**Why it's wrong:**
- Claude costs ~$15/million input tokens - polling loops would burn money
- Claude is for reasoning/decision-making, not HTTP requests
- No persistent state between invocations
- Would need separate hosting anyway (Fly, etc.)

**When Claude WOULD make sense:**
- Analyzing order patterns for anomalies
- Generating reports/summaries from order data
- Answering questions about the data

---

## Recommended Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Vercel (existing)                        │
├─────────────────────────────────────────────────────────────┤
│  /api/cron/fever-sync        Every 5 min                    │
│       │                                                     │
│       ├──► Fever API (fetch new orders since last sync)     │
│       │                                                     │
│       ├──► Supabase: store orders + update sync state       │
│       │                                                     │
│       └──► Slack: notify on new orders                      │
│                                                             │
│  /api/fever/orders           REST endpoint for dashboard    │
│                                                             │
│  Dashboard page              View orders, stats, filters    │
└─────────────────────────────────────────────────────────────┘
```

### New files to create:
1. `src/lib/fever.ts` - Fever API client (refactored from Gumloop code)
2. `src/app/api/cron/fever-sync/route.ts` - Cron endpoint
3. `src/app/api/fever/orders/route.ts` - REST API for dashboard
4. Database migration for `fever_orders` + `fever_sync_state` tables
5. Dashboard page for viewing orders (optional)

### Data storage options:
- **Supabase** (recommended) - Already in your stack, queryable, supports dashboard
- **NocoDB** - Spreadsheet-like interface, already integrated
- **Google Sheets** - Would need new integration, but gives spreadsheet access

---

## Decisions Made
- **Storage**: Supabase (new tables) as **materialized cache**
- **Polling**: 5 minutes via Vercel cron
- **Plan**: Vercel Pro (60s timeout available)
- **Schema**: Normalized (2 tables: `fever_orders` + `fever_order_items` + flat view)
- **Notifications**: New `#fever-orders` Slack channel

---

## Caching Strategy

### Why Cache Locally?

The Fever API is a **batch reporting API**, not real-time:
- Every query requires: POST search → poll (up to 2 min) → GET results
- Rate limit: 200 requests/minute
- No webhook support for push notifications

This makes on-demand queries impractical for dashboard UX. Users would wait 2+ minutes for each page load.

### Supabase as Materialized Cache

The local database is explicitly a **cache**, not the source of truth:

| Aspect | Approach |
|--------|----------|
| Source of truth | Fever API (always) |
| Local copy | Materialized cache for fast reads |
| Staleness | 0-5 minutes (cron interval) |
| Critical actions | Verify against Fever directly (refunds, cancellations) |

### Dashboard UX Requirements

1. **Always show freshness indicator**: "Last synced: X minutes ago"
2. **Manual refresh button**: Triggers immediate sync, shows loading state
3. **Stale data warning**: If last sync > 10 min, show warning banner
4. **No edit capabilities**: Read-only display (edits happen in Fever admin)

### Sync Modes

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Background cron** | Every 5 min | Incremental sync (orders since last sync) |
| **Manual refresh** | User clicks button | Full re-sync of recent window (e.g., last 7 days) |
| **Initial load** | First deployment | Backfill historical data (configurable window) |

### Manual Refresh Endpoint

```
POST /api/fever/sync
Authorization: Bearer <session token>

Response:
{
  "status": "started" | "in_progress" | "completed",
  "syncId": "uuid",
  "ordersProcessed": 150,
  "newOrders": 3,
  "lastSyncAt": "2025-01-14T12:00:00Z"
}
```

For long-running syncs, return `202 Accepted` with `syncId`, then poll for completion.

### Data Freshness Contract

| Data Type | Max Staleness | Notes |
|-----------|---------------|-------|
| Order list | 5 min | Acceptable for dashboard browsing |
| Order details | 5 min | Show "as of X" timestamp |
| Ticket status | Verify live | For refund/cancel decisions, hit Fever API |
| Aggregate stats | 5 min | Daily/weekly reports are fine cached |

---

## Database Schema Design

### The Data Structure Problem

The Fever API returns **orders** containing **items**. One order can have multiple items (e.g., 4 tickets to the same event). The Gumloop code flattens this into one row per item, repeating order data.

**Schema options:**

### Option A: Normalized (2 tables) - Recommended

```sql
-- Order-level data (one row per order)
CREATE TABLE fever_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fever_order_id TEXT UNIQUE NOT NULL,
  parent_order_id TEXT,

  -- Timestamps
  order_created_at TIMESTAMPTZ,
  order_updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT now(),

  -- Order details
  surcharge NUMERIC,
  currency TEXT,
  purchase_channel TEXT,
  payment_method TEXT,
  billing_zip_code TEXT,
  assigned_seats TEXT,

  -- Buyer (denormalized - one buyer per order)
  buyer_id TEXT,
  buyer_email TEXT,
  buyer_first_name TEXT,
  buyer_last_name TEXT,
  buyer_dob DATE,
  buyer_language TEXT,
  buyer_marketing_pref BOOLEAN,

  -- Purchase location
  purchase_city TEXT,
  purchase_country TEXT,
  purchase_region TEXT,
  purchase_postal TEXT,
  purchase_quality TEXT,

  -- References (denormalized for query convenience)
  partner_id TEXT,
  partner_name TEXT,
  plan_id TEXT,
  plan_name TEXT,
  coupon_name TEXT,
  coupon_code TEXT,
  business_id TEXT,
  business_name TEXT,

  -- Flexible storage
  booking_questions JSONB,

  -- Indexes
  CONSTRAINT fever_orders_created_idx
);
CREATE INDEX idx_fever_orders_created ON fever_orders(order_created_at);
CREATE INDEX idx_fever_orders_plan ON fever_orders(plan_id);

-- Item-level data (one row per ticket/item)
CREATE TABLE fever_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fever_order_id TEXT NOT NULL REFERENCES fever_orders(fever_order_id),
  fever_item_id TEXT NOT NULL,

  -- Item details
  status TEXT,
  created_at TIMESTAMPTZ,
  modified_at TIMESTAMPTZ,
  purchase_date TIMESTAMPTZ,
  cancellation_date TIMESTAMPTZ,
  cancellation_type TEXT,

  -- Pricing
  discount NUMERIC,
  surcharge NUMERIC,
  unitary_price NUMERIC,
  is_invite BOOLEAN,

  -- Rating
  rating_value NUMERIC,
  rating_comment TEXT,

  -- Owner (person using this ticket, may differ from buyer)
  owner_id TEXT,
  owner_email TEXT,
  owner_first_name TEXT,
  owner_last_name TEXT,
  owner_dob DATE,
  owner_language TEXT,
  owner_marketing_pref BOOLEAN,

  -- Plan code (the actual ticket/barcode)
  plan_code_id TEXT,
  plan_code_barcode TEXT,
  plan_code_created TIMESTAMPTZ,
  plan_code_modified TIMESTAMPTZ,
  plan_code_redeemed TIMESTAMPTZ,
  plan_code_is_cancelled BOOLEAN,
  plan_code_is_validated BOOLEAN,

  -- Session (the event timeslot)
  session_id TEXT,
  session_name TEXT,
  session_start TIMESTAMPTZ,
  session_end TIMESTAMPTZ,
  session_first_purchasable TIMESTAMPTZ,
  session_is_addon BOOLEAN,
  session_is_shop_product BOOLEAN,
  session_is_wait_list BOOLEAN,

  -- Venue
  venue_name TEXT,
  venue_city TEXT,
  venue_country TEXT,
  venue_timezone TEXT,

  UNIQUE(fever_order_id, fever_item_id)
);
CREATE INDEX idx_fever_items_order ON fever_order_items(fever_order_id);
CREATE INDEX idx_fever_items_session ON fever_order_items(session_id);

-- Sync state tracking
CREATE TABLE fever_sync_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- singleton
  last_sync_at TIMESTAMPTZ,
  last_order_created_at TIMESTAMPTZ, -- watermark for incremental sync
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

**Pros:**
- Clean separation: order questions vs item questions
- No data duplication (buyer info stored once per order)
- Easy aggregations: "How many orders?" vs "How many tickets?"
- Can update order status without touching items

**Cons:**
- Joins required for full picture
- Slightly more complex insert logic

### Option B: Denormalized (1 table, spreadsheet-style)

```sql
CREATE TABLE fever_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- All 68 fields flattened, one row per item
  -- Order data repeated for each item in same order
  ...
);
```

**Pros:**
- Simple queries (no joins)
- Matches spreadsheet mental model
- Easy CSV export

**Cons:**
- Data duplication (4-ticket order = 4x buyer info)
- Harder to update order-level data
- Confusing counts (rows ≠ orders)

### Recommendation: Option A (Normalized)

For a dashboard with analytics, normalized is better. You can always create a **view** that joins them for spreadsheet-style exports:

```sql
CREATE VIEW fever_sales_flat AS
SELECT
  o.*,
  i.*
FROM fever_orders o
JOIN fever_order_items i ON o.fever_order_id = i.fever_order_id;
```

---

## Implementation Plan

### Step 1: Database Migration
Run SQL in Supabase to create:
- `fever_orders` table (order-level data)
- `fever_order_items` table (item/ticket-level data)
- `fever_sync_state` table (singleton for sync watermark)
- `fever_sales_flat` view (JOIN for spreadsheet exports)
- Indexes for common queries

### Step 2: Create `src/lib/fever.ts`
Fever API client with:
- Auth (username/password → bearer token)
- `searchOrders(dateFrom?)` - POST search, poll for results, fetch all partitions
- `parseOrder()` / `parseItem()` - Transform API response to DB schema
- Credentials from env vars

### Step 3: Create `src/app/api/cron/fever-sync/route.ts`
Cron endpoint:
- Read last sync timestamp from `fever_sync_state`
- Call Fever API with `date_from` filter
- Upsert orders + items into Supabase
- For new orders: send Slack notification to `#fever-orders`
- Update sync state watermark

### Step 4: Update `vercel.json`
Add cron entry:
```json
{ "path": "/api/cron/fever-sync", "schedule": "*/5 * * * *" }
```

### Step 5: Update `src/lib/slack.ts`
Add `formatFeverOrderNotification()` function for new order alerts.

### Env vars to add to `.env.local` and Vercel:
```
FEVER_HOST=data-reporting-api.prod.feverup.com
FEVER_USERNAME=shapiro.jon@gmail.com
FEVER_PASSWORD=<move from hardcoded>
FEVER_PLAN_IDS=420002,474974,416569,480359,474902,433336
FEVER_SLACK_WEBHOOK_URL=<webhook for #fever-orders>
```

---

## Verification

1. Run migration in Supabase SQL editor
2. Add env vars locally
3. Manually hit `GET /api/cron/fever-sync` with CRON_SECRET header
4. Check Supabase tables for data
5. Check `#fever-orders` for notification
6. Deploy to Vercel, add env vars
7. Wait 5 min, confirm cron runs automatically (check Vercel logs)
8. Query `fever_sales_flat` view for full export
