# Fever Import + Dashboard Filter System

## Reference Files (read these first)
- **This plan:** `/Users/jon/.claude/plans/distributed-frolicking-rain.md`
- **Full DB schema & caching strategy:** `context/plans/fever-import.md`
- **Fever API field mappings (68 fields):** `context/reference/gumloop-fever-sync.py`
- **Existing patterns:** `src/lib/nocodb.ts`, `src/lib/slack.ts`, `src/app/api/cron/`

## Overview

Implement Fever order sync with a composable filter system across data sources and popup cities.

**Data Sources:**
- **EdgeOS** (NocoDB): Applications, Products, Payments - has `popup_city_id`
- **Fever**: Order/ticket data - currently all Iceland

**Popup Cities:**
- Iceland = "The Portal" (residency program)
- Egypt = "Ripple on the Nile"

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                       Filter State (Context)                          │
│  {                                                                    │
│    edgeos: { enabled: true, cities: { 1: true, 2: true } },          │
│    fever: { enabled: true }                                           │
│  }                                                                    │
└──────────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   Overview Page        Products Page         (Future pages)
        │                     │                     │
        └─────────────────────┴─────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
      ┌───────────────┐               ┌───────────────┐
      │ EdgeOS Data   │               │ Fever Data    │
      │ (NocoDB)      │               │ (Supabase)    │
      │ - Residencies │               │ - Festival    │
      │ - Per city    │               │ - Tickets     │
      └───────────────┘               └───────────────┘
```

**Both sources available on all pages:**
- Each page shows combined data from enabled sources
- Toggle EdgeOS on/off (with per-city sub-toggles)
- Toggle Fever on/off
- Metrics aggregate based on active filters

**Independent Data Sources:**
- EdgeOS (NocoDB): Residency programs - The Portal, Ripple on the Nile, etc.
- Fever (Supabase cache): Festival/event tickets - separate product line

---

## Step-by-Step Implementation

### Step 1: Database Migration
**File:** `supabase/migrations/012_fever_orders.sql`

```sql
-- fever_orders (order-level)
CREATE TABLE fever_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fever_order_id TEXT UNIQUE NOT NULL,
  parent_order_id TEXT,
  order_created_at TIMESTAMPTZ,
  order_updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT now(),
  surcharge NUMERIC,
  currency TEXT,
  purchase_channel TEXT,
  payment_method TEXT,
  -- ... buyer fields, location fields, partner/plan/coupon/business refs
  booking_questions JSONB
);

-- fever_order_items (ticket-level)
CREATE TABLE fever_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fever_order_id TEXT REFERENCES fever_orders(fever_order_id) ON DELETE CASCADE,
  fever_item_id TEXT NOT NULL,
  -- ... item fields, owner fields, plan_code fields, session fields, venue fields
  UNIQUE(fever_order_id, fever_item_id)
);

-- fever_sync_state (singleton)
CREATE TABLE fever_sync_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_sync_at TIMESTAMPTZ,
  last_order_created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO fever_sync_state (id) VALUES (1);

-- fever_sales_flat (view for exports)
CREATE VIEW fever_sales_flat AS SELECT ... FROM fever_orders o JOIN fever_order_items i ...;
```

**Run:** `npx supabase db push`

---

### Step 2: Fever API Client
**File:** `src/lib/fever.ts`

```typescript
// Environment
const FEVER_HOST = process.env.FEVER_HOST;
const FEVER_USERNAME = process.env.FEVER_USERNAME;
const FEVER_PASSWORD = process.env.FEVER_PASSWORD;
const FEVER_PLAN_IDS = process.env.FEVER_PLAN_IDS?.split(',').map(Number);

// Functions to implement:
export async function getAuthToken(): Promise<string>
  // POST /v1/auth/token with username/password form data

export async function searchOrders(dateFrom?: string): Promise<FeverOrder[]>
  // 1. POST /v1/reports/order-items/search with plan_ids, date_from
  // 2. Poll GET /v1/reports/order-items/search/{search_id} until partition_info
  // 3. Fetch all partitions with GET ?page={n}
  // 4. Return combined orders array

export function parseOrderForDB(order: FeverAPIOrder): FeverOrderRow
export function parseItemForDB(item: FeverAPIItem, orderId: string): FeverOrderItemRow
```

---

### Step 3: Cron Sync Endpoint
**File:** `src/app/api/cron/fever-sync/route.ts`

```typescript
export async function GET(request: Request) {
  // 1. Verify CRON_SECRET header
  // 2. Get last_order_created_at from fever_sync_state
  // 3. Call searchOrders(lastSync) from fever.ts
  // 4. For each order:
  //    - Upsert to fever_orders
  //    - Upsert items to fever_order_items
  //    - Track if order is new (not existed before)
  // 5. If new orders: send Slack notification
  // 6. Update fever_sync_state with latest order timestamp
  // 7. Return stats: { ordersProcessed, newOrders, lastSyncAt }
}
```

---

### Step 4: Manual Refresh Endpoint
**File:** `src/app/api/fever/sync/route.ts`

```typescript
export async function POST(request: Request) {
  // Same logic as cron but:
  // - No CRON_SECRET required (use session auth)
  // - Return 202 Accepted immediately with syncId
  // - Could run async and allow polling for status (optional)
}
```

---

### Step 5: Slack Notification
**File:** `src/lib/slack.ts` (update)

```typescript
export function formatFeverOrderNotification(orders: FeverOrder[]): SlackMessage {
  // Format: "🎫 {count} new Fever order(s)"
  // List buyer emails, plan names, ticket counts
  // Link to dashboard
}
```

---

### Step 6: Vercel Cron Config
**File:** `vercel.json` (update)

```json
{
  "crons": [
    // ... existing crons
    { "path": "/api/cron/fever-sync", "schedule": "*/5 * * * *" }
  ]
}
```

---

### Step 7: Add PopupCity Type
**File:** `src/lib/types.ts` (update)

```typescript
export interface PopupCity {
  id: number;
  name: string;
  slug: string;
  location?: string;
}
```

---

### Step 8: Fetch Popup Cities from NocoDB
**File:** `src/lib/nocodb.ts` (update)

```typescript
// Add to TABLES config:
popups: cleanEnv(process.env.NOCODB_TABLE_POPUPS) || '<table_id>',

// New function:
export async function getPopupCities(): Promise<PopupCity[]> {
  const cached = getCached<PopupCity[]>('popups');
  if (cached) return cached;

  const data = await nocoFetch<NocoDBResponse<PopupCity>>(`/tables/${TABLES.popups}/records`);
  setCache('popups', data.list);
  return data.list;
}
```

---

### Step 9: Add City Filtering to getDashboardData
**File:** `src/lib/nocodb.ts` (update)

```typescript
export async function getDashboardData(cityIds?: number[]): Promise<DashboardData> {
  // Existing logic, but filter applications/products by popup_city_id
  // If cityIds provided, add WHERE clause: popup_city_id IN (...)
  // Recalculate metrics based on filtered data
}
```

---

### Step 10: Create Filter Context
**File:** `src/contexts/DashboardFilterContext.tsx` (create)

```typescript
interface FilterState {
  edgeos: { enabled: boolean; cities: Record<number, boolean> };
  fever: { enabled: boolean };
}

const DashboardFilterContext = createContext<{
  filters: FilterState;
  setFilters: (filters: FilterState) => void;
  popupCities: PopupCity[];
}>(null);

export function DashboardFilterProvider({ children }) {
  // Fetch popup cities on mount
  // Initialize all cities to true
  // Persist to localStorage
  // Provide context value
}

export function useFilters() {
  return useContext(DashboardFilterContext);
}
```

---

### Step 11: Create Filter Toggle Component
**File:** `src/components/dashboard/SourceFilter.tsx` (create)

```typescript
export function SourceFilter() {
  const { filters, setFilters, popupCities } = useFilters();

  return (
    <div className="flex gap-2">
      {/* EdgeOS toggle with dropdown for cities */}
      <DropdownMenu>
        <DropdownMenuTrigger>
          EdgeOS {activeCount}/{total}
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {popupCities.map(city => (
            <DropdownMenuCheckboxItem
              checked={filters.edgeos.cities[city.id]}
              onCheckedChange={...}
            >
              {city.name}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Fever toggle */}
      <Button variant={filters.fever.enabled ? 'default' : 'outline'}>
        Fever
      </Button>
    </div>
  );
}
```

---

### Step 12: Create Fever Client (Frontend)
**File:** `src/lib/fever-client.ts` (create)

```typescript
import { supabase } from './supabase';

export async function getFeverMetrics(): Promise<{
  totalRevenue: number;
  orderCount: number;
  ticketCount: number;
  lastSyncAt: string;
}> {
  // Query fever_orders and fever_order_items from Supabase
  // Aggregate totals
}

export async function getFeverOrders(): Promise<FeverOrder[]> {
  // Fetch from fever_orders with items joined
}

export async function getFeverSyncState(): Promise<{ lastSyncAt: string }> {
  // Fetch from fever_sync_state
}
```

---

### Step 13: Update Overview Page
**File:** `src/app/page.tsx` (update)

```typescript
// Convert to client component or use hybrid approach
// Wrap with DashboardFilterProvider
// Add SourceFilter to header
// Fetch data based on filters:
//   - EdgeOS data: getDashboardData(selectedCityIds)
//   - Fever data: getFeverMetrics() if fever.enabled
// Merge metrics for display
// Show "Last synced: X" for Fever
// Add refresh button that calls POST /api/fever/sync
```

---

### Step 14: Update Products Page
**File:** `src/app/products/page.tsx` (update)

```typescript
// Same filter integration as Overview
// Add "Fever Sales" section:
//   - Revenue by plan
//   - Ticket count by plan
// Filter EdgeOS products by selected cities
// Show combined revenue totals when both enabled
```

---

### Step 15: Verification
1. Run migration: `npx supabase db push`
2. Add env vars to `.env.local`
3. Test fever sync: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/fever-sync`
4. Check Supabase tables for data
5. Check Slack for notification
6. Test filter UI toggles on Overview and Products pages
7. Verify metrics change when toggling sources
8. Test manual refresh button

---

## File Changes Summary

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/012_fever_orders.sql` | Create | DB schema for Fever data |
| `src/lib/fever.ts` | Create | Fever API client |
| `src/app/api/cron/fever-sync/route.ts` | Create | Background sync cron |
| `src/app/api/fever/sync/route.ts` | Create | Manual refresh endpoint |
| `src/lib/slack.ts` | Update | Add Fever notification formatter |
| `vercel.json` | Update | Add cron schedule |
| `src/lib/types.ts` | Update | Add PopupCity interface |
| `src/lib/nocodb.ts` | Update | Add `getPopupCities()`, city filtering |
| `src/contexts/DashboardFilterContext.tsx` | Create | Filter state management |
| `src/components/dashboard/SourceFilter.tsx` | Create | Filter toggle UI |
| `src/lib/fever-client.ts` | Create | Frontend Fever data access |
| `src/app/page.tsx` | Update | Add filters, merge metrics |
| `src/app/products/page.tsx` | Update | Add filters, Fever section |

---

## Env Vars Required

```
# Fever API
FEVER_HOST=data-reporting-api.prod.feverup.com
FEVER_USERNAME=<email>
FEVER_PASSWORD=<password>
FEVER_PLAN_IDS=420002,474974,416569,480359,474902,433336
FEVER_SLACK_WEBHOOK_URL=<webhook for notifications>

# NocoDB (new)
NOCODB_TABLE_POPUPS=<table_id>  # For dynamic popup city list
```

---

## Verification

1. **Migration**: Run `npx supabase db push`, verify tables created
2. **Fever Sync**:
   - Set env vars locally
   - Hit `GET /api/cron/fever-sync` with CRON_SECRET
   - Check Supabase for data, Slack for notification
3. **Filter UI**:
   - Toggle EdgeOS off → metrics should exclude NocoDB data
   - Toggle Fever off → metrics should exclude Fever data
   - Toggle individual cities → metrics filter accordingly
4. **Products Page**:
   - Fever section shows ticket sales grouped by plan
   - EdgeOS products filter by selected cities
5. **Manual Refresh**:
   - Click refresh button → shows loading state
   - "Last synced" timestamp updates
