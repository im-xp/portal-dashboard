# Plan: Fever Tickets Tab - Display All Order Data

## Goal
Replace the "Sales by Plan" table in the Fever Tickets tab on `/products` with an expandable orders list showing all Fever API data.

## Current State
- Fever Tickets tab shows: metrics cards, sync status, "Sales by Plan" table
- No order-level browsing, no detail views, no filtering
- Database has rich data not being exposed in UI

## Approach
Replace "Sales by Plan" table with **expandable order cards** (like email-queue pattern).

---

## Implementation

### 1. Create API endpoint for orders list
**File:** `src/app/api/fever/orders/route.ts`

```ts
// GET /api/fever/orders?search=&status=&plan=
// Returns orders with nested items
// Joins fever_orders + fever_order_items
// Supports search by buyer_email, buyer name
// Filter by item status, plan
```

### 2. Update products page - Fever Tickets tab
**File:** `src/app/products/page.tsx`

Replace lines 537-568 (Sales by Plan Card) with expandable orders list.

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│ [EdgeOS Products] [Fever Tickets]                   │
├─────────────────────────────────────────────────────┤
│ [Tickets: 3300] [Orders: 1730] [Revenue: $2.1M]    │
│ Last synced: 5m ago [Refresh]                       │
├─────────────────────────────────────────────────────┤
│ [Search________________]  [Status ▼]  [Plan ▼]     │
├─────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐│
│ │ #85376736              Aug 13, 2025            ││
│ │ Elizabeth Du Peza • lizzmikl@gmail.com         ││
│ │ 3 items • $6,474.94 • Google Pay          [▼] ││
│ └─────────────────────────────────────────────────┘│
│   ┌───────────────────────────────────────────────┐│
│   │ ITEMS                                         ││
│   │ ┌─────────────────────────────────────────┐  ││
│   │ │ Camper (Turnkey)           $4,306.22    │  ││
│   │ │ Aug 9-15, 2026 • purchased • Addon      │  ││
│   │ │ Barcode: 13929230035218731961          │  ││
│   │ └─────────────────────────────────────────┘  ││
│   │ ┌─────────────────────────────────────────┐  ││
│   │ │ Celestial Voyager (x2)     $2,168.72    │  ││
│   │ │ Aug 12-18, 2026 • purchased             │  ││
│   │ └─────────────────────────────────────────┘  ││
│   │                                               ││
│   │ BUYER                                         ││
│   │ Chicago, IL, US • en • Marketing: Yes        ││
│   │                                               ││
│   │ BOOKING QUESTIONS                             ││
│   │ Attending with: Partner                      ││
│   │ Found via: Google search                     ││
│   │ Phone: +1 321-945-5499                       ││
│   │                                               ││
│   │ ATTRIBUTION                                   ││
│   │ Source: (not set) • Medium: (not set)        ││
│   └───────────────────────────────────────────────┘│
│ ┌─────────────────────────────────────────────────┐│
│ │ #85376735 ...                              [▼] ││
│ └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

### 3. Data sections in expanded view

**Order Header (always visible):**
- Order ID, date
- Buyer name + email
- Item count, total value, payment method
- Expand/collapse chevron

**Expanded - Items Section:**
- Each item as a card showing:
  - Session name (ticket type)
  - Price (unitary_price + surcharge)
  - Status badge (purchased/cancelled)
  - Addon/shop product badges
  - Session dates
  - Owner info (if different from buyer)
  - Barcode
  - Validation status

**Expanded - Buyer Info:**
- Location (city, region, country)
- Language, marketing preference
- DOB

**Expanded - Booking Questions:**
- Parsed from JSON array
- Display as Q&A list

**Expanded - Attribution (UTM):**
- Source, medium, campaign, term, content
- Referring domain

**Expanded - Order Meta:**
- Plan name
- Partner name
- Coupon code (if any)
- Currency
- Purchase channel

### 4. Filters & Search

- **Search:** buyer email, buyer name (client-side filter on loaded data, or server if >500 orders)
- **Status filter:** All, Purchased, Cancelled
- **Plan filter:** Dropdown of unique plan names

### 5. Client helper
**File:** `src/lib/fever-client.ts` (extend existing)

```ts
export async function getFeverOrders(params?: {
  search?: string;
  status?: string;
  planId?: string;
}): Promise<FeverOrderWithItems[]>
```

### 6. Types
**File:** `src/lib/types.ts` (extend existing)

```ts
export interface FeverOrderWithItems {
  // Order fields
  fever_order_id: string;
  order_created_at: string;
  buyer_email: string;
  buyer_first_name: string;
  buyer_last_name: string;
  currency: string;
  payment_method: string;
  purchase_channel: string;
  purchase_city: string;
  purchase_region: string;
  purchase_country: string;
  plan_name: string;
  booking_questions: BookingQuestion[];
  // ... all other order fields

  // Nested items
  items: FeverItem[];

  // Computed
  total_value: number;
  item_count: number;
}
```

---

### 7. Add missing fields to database

**Migration:** `supabase/migrations/XXX_fever_add_utm_validated.sql`

```sql
-- Add UTM tracking fields to fever_orders
ALTER TABLE fever_orders
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_content text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_term text,
  ADD COLUMN IF NOT EXISTS utm_referring_domain text;

-- Add validated_date to fever_order_items
ALTER TABLE fever_order_items
  ADD COLUMN IF NOT EXISTS validated_date timestamptz;
```

**Update `src/lib/fever.ts`:**
- Add UTM fields to `FeverOrder` interface
- Add `validatedDate` to `FeverOrderItem` interface
- Update `transformOrder()` to extract UTM data
- Update `transformItem()` to extract validated_date_utc
- Update `orderToDbRow()` and `itemToDbRow()` to include new fields

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/migrations/XXX_fever_utm_validated.sql` | CREATE - add missing columns |
| `src/lib/fever.ts` | MODIFY - add UTM + validated_date transforms |
| `src/app/api/fever/orders/route.ts` | CREATE - orders list endpoint |
| `src/app/products/page.tsx` | MODIFY - replace Sales by Plan with orders list |
| `src/lib/fever-client.ts` | MODIFY - add getFeverOrders |
| `src/lib/types.ts` | MODIFY - add FeverOrderWithItems type |

---

## Verification
1. Run migration: `psql $DATABASE_URL -f supabase/migrations/XXX_fever_utm_validated.sql`
2. Trigger full resync to populate new fields (manual sync with `?manual=true`)
3. Run `npm run dev`
4. Navigate to `/products`, click "Fever Tickets" tab
5. Verify orders load (should see ~1730 orders)
6. Test expand/collapse on order cards
7. Test search by email/name
8. Test status filter (purchased/cancelled)
9. Verify all data fields display correctly in expanded view:
   - Items with prices, dates, status, barcodes
   - Buyer info with location
   - Booking questions parsed correctly
   - UTM/attribution data (new)
   - Validated date on items (new)
