# Fever Sync Cron — Duplicate `Order Completed` Fix

## Context

Jameson flagged (Slack `#ie26-mktg-general`, Apr 23) an Amplitude user with 825 events and asked whether the "plan ID problem and recurring product purchase events" were solved.

Investigation (transcript Apr 23-24) found:

- The user `lovaliantpoine@gmail.com` (amplitude_id `1546717639017`) had **274 duplicate `Order Completed` events** in Amplitude for a single real Fever order (`110679138`, 2 items). Amplitude auto-expands each OC into one `Product Purchased` per product, so 274 × (1 OC + 2 PP) + 3 email events = 825 exact.
- The duplication is **not user-specific**. Every Fever buyer in Amplitude has at least 2× dupe; buyers whose most recent order is after ~Feb 2026 have far more (e.g. `gal_karniel@hotmail.com` has 586 OC for 8 real orders = 73×).
- `fever_sync_state.orders_synced = 226,579` vs. 2,650 distinct rows in `fever_orders` (85× inflation) — consistent.

Jameson confirmed only the set of users the investigation already identified are affected; scope is the whole `fever_orders` table, nothing else.

## Root cause (confirmed with live repro)

File: `src/app/api/cron/fever-sync/route.ts`

Lines 60-72 build `existingOrderIds: Set<string>` from Supabase. Line 92 checks `!existingOrderIds.has(order.feverOrderId)`. Line 157 does `orders.filter((o) => existingOrderIds.has(o.feverOrderId))` for the cancellation path.

**Type mismatch:**
- Fever's reporting API returns `id` as a JSON **number** (e.g. `111025306`).
- `src/lib/fever.ts` line 232, `transformOrder`, does `feverOrderId: apiOrder.id` with no coercion. The TypeScript type says `string`, so the mismatch is invisible at compile time.
- Supabase column `fever_order_id` is `TEXT` (`supabase/migrations/012_fever_orders.sql:6`). PostgREST implicitly casts numbers → text for `.in()` and upsert queries, so DB writes and bulk SELECT "appear" to work.
- When the DB row is read back, `e.fever_order_id` is a string. The `Set<string>` contains strings.
- `Set.has()` uses strict equality (`SameValueZero`). `set.has("111025306")` is true, but `set.has(111025306)` is **false**.

Net effect of line 92 bug: **every order is flagged "new" on every cron run** → `newOrders` contains everything in the date window → Segment fires `Order Completed` (+identify) for every run.

Net effect of line 157 bug (inverse): the cancellation filter **always returns empty**, so `trackOrderCancelled` never fires for genuinely-cancelled existing orders. Silent data gap for the refund/cancellation pipeline.

**Second stacked bug (independent): segment.ts enum mismatch.** Even if line 157 were fixed, `trackOrderCancelled` (`src/lib/segment.ts:91`) filters items by `i.status === 'CANCELLED'` — but Fever's API returns `'canceled'` (one L, lowercase), which is what DB column shows. Line 94 checks `i.cancellationType === 'REFUND'`, but actual Fever values are `'Refund Cash'`, `'Refund Coupon'`, `'Exchange Fever'`, `'Exchange User'`, `'Unknown'` — no bare `'REFUND'`. The `trackOrderCompleted` function already handles this for the purchased path (line 50 accepts both `'ACTIVE'` and `'purchased'`), so someone knew about the casing issue but never applied it to cancellations. Cancellation events have **never** fired, even pre-dating the dedup bug. Supabase scan (2026-04-24): 117 unique orders have at least one `canceled` item across the full history (Aug 2025 → Apr 20, 2026) — 65 with Refund types, 52 without — and Segment has zero `Order Cancelled` or `Order Refunded` events for any of them.

### Why volume differs across users

The cron's `dateFrom` is incremental — pulls orders from `syncState.last_order_created_at` forward. So an order only stays in-window until a later-day order advances `last_order_created_at` past it.

- Orders before ~Feb 2026: window closed before Segment tracking was added (commit `3a4c5df`, Mar 26). They were fired once by a wide-window sync on Mar 26 and once by `scripts/replay-segment-historical.ts` that same day. Total **2×**.
- Orders after ~Feb 2026: stay in the incremental window and get re-fired on every cron run until the next day's first order arrives. `lovaliantpoine`'s Apr 19 order sat in-window ~27 hours × 12 cron/hour = 324 runs; 274 fires (~85% of slots) matches observation.

### Repro (confirmed)

```ts
// against live prod Supabase, 2026-04-24
Fever IDs: [111025306,111040889,111086862]
Types: number,number,number
Returned IDs: ["111025306","111040889","111086862"]
Returned types: string,string,string
```
All three rows exist in DB; `.has()` returns false for all three → all flagged "new".

## Scope of affected code

| Location | Issue |
|---|---|
| `src/lib/fever.ts:232` (`transformOrder`) | `feverOrderId: apiOrder.id` — source of the type leak |
| `src/lib/fever.ts:275` (`transformItem`) | `feverItemId: apiItem.id \|\| ''` — same pattern; lower blast radius because item lookups use `.filter((i) => i.feverOrderId === order.feverOrderId)` (both sides are numbers from the API, so strict equality matches). Still worth coercing for hygiene. |
| `src/app/api/cron/fever-sync/route.ts:60-72, 92, 157` | Consumers of the type leak. Fix the source (fever.ts) and these start working. |
| `src/lib/segment.ts:91` (`trackOrderCancelled`) | `i.status === 'CANCELLED'` never matches; actual value is `'canceled'`. Second stacked bug, unrelated to the type leak. |
| `src/lib/segment.ts:94` (`trackOrderCancelled`) | `i.cancellationType === 'REFUND'` never matches; Fever returns `'Refund Cash'`, `'Refund Coupon'`, etc. |

**Not affected:**
- `scripts/backfill-fever.ts` — uses `String(o.feverOrderId)` and `String(e.fever_order_id)` on both sides of the Set check.
- `scripts/segment-fire-new-plans.ts` — no existence check; fires unconditionally for a scoped plan list.
- `scripts/replay-segment-historical.ts` — reads from Supabase (already strings), no Fever API involvement.
- `identifyBuyer`, `trackOrderCompleted`, `trackOrderCancelled` in `src/lib/segment.ts` — operate on the `FeverOrder` object; content is unaffected by the ID type.

## The fix

One-line change in `src/lib/fever.ts`, plus a belt-and-suspenders coercion in `transformItem`:

```ts
// Line ~232
function transformOrder(apiOrder: FeverApiOrder): FeverOrder {
  return {
    feverOrderId: String(apiOrder.id),       // was: apiOrder.id
    // ...rest unchanged
  };
}

// Line ~275
function transformItem(apiItem: FeverApiItem, orderId: string): FeverOrderItem {
  return {
    feverOrderId: orderId,                    // already a string if transformOrder is fixed
    feverItemId: String(apiItem.id ?? ''),    // was: apiItem.id || ''
    // ...rest unchanged
  };
}
```

Also fix the upstream `FeverApiOrder.id` and `FeverApiItem.id` type declarations to `string | number` to reflect reality and surface future type leaks (optional but cheap):

```ts
interface FeverApiOrder {
  id: string | number;   // was: string
  // ...
}
interface FeverApiItem {
  id?: string | number;  // was: string
  // ...
}
```

No DB migration, no data backfill on the Supabase side. Existing rows already have the right string values because PostgREST coerced them on the way in.

### segment.ts — cancellation enum fix

`src/lib/segment.ts` needs two changes to match real Fever values. Match the defensive two-string pattern already used for `'ACTIVE' || 'purchased'` on line 50:

```ts
// Line ~91 — replace
const cancelledItems = items.filter((i) => i.status === 'CANCELLED');
// with
const cancelledItems = items.filter((i) => i.status === 'canceled' || i.status === 'CANCELLED');

// Line ~94 — replace
const event = cancelledItems.some((i) => i.cancellationType === 'REFUND')
// with
const event = cancelledItems.some((i) => i.cancellationType?.startsWith('Refund'))
```

`startsWith('Refund')` over exact-match because Fever uses two refund subtypes (`Refund Cash`, `Refund Coupon`) in prod data and may add more. Non-refund cancellations (`Exchange Fever`, `Exchange User`, `Unknown`) fall through to `Order Cancelled`.

## Testing — before push

Create `tmp/verify-cron-dedup.ts` (gitignored via `/tmp/` … actually tmp is NOT in `.gitignore`; delete this file after verifying, or move under `scripts/` with a dry-run-only guard):

```ts
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchFeverOrders } from '../src/lib/fever';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: syncState } = await supabase.from('fever_sync_state').select('*').eq('id', 1).single();
  const dateFrom = syncState?.last_order_created_at?.split('T')[0];
  const dateTo = dateFrom ? new Date().toISOString().split('T')[0] : undefined;

  const { orders } = await fetchFeverOrders({ dateFrom, dateTo });
  const ids = orders.map(o => o.feverOrderId);
  console.log(`Fever returned ${orders.length} orders`);
  console.log(`Sample id: ${ids[0]} (typeof ${typeof ids[0]})`);

  const { data: existing } = await supabase.from('fever_orders').select('fever_order_id').in('fever_order_id', ids);
  const existingIds = new Set((existing ?? []).map(e => e.fever_order_id));
  const newOrders = orders.filter(o => !existingIds.has(o.feverOrderId));

  console.log(`Present in DB: ${existingIds.size}`);
  console.log(`Flagged NEW: ${newOrders.length}`);
  console.log(newOrders.length === 0 ? '✅ FIX WORKS' : '❌ STILL BROKEN');
}
main().catch(e => { console.error(e); process.exit(1); });
```

Run:
```bash
cd /Users/jon/src/imxp/iceland/dashboard
npx tsx tmp/verify-cron-dedup.ts
```

**Expected before the fix** (current state): `Sample id: 111025306 (typeof number)`, `Flagged NEW: 3` even though all 3 are in DB.
**Expected after the fix**: `typeof string`, `Flagged NEW: 0` assuming no genuinely new orders in the window.

Delete `tmp/verify-cron-dedup.ts` after confirming.

Also run:
```bash
npx tsc --noEmit
```
to confirm no type regressions (the widened `id: string | number` should compose cleanly).

## Deploy

```bash
cd /Users/jon/src/imxp/iceland/dashboard
git status                 # should show only fever.ts modified
git add src/lib/fever.ts
git diff --cached          # re-read the change
git commit -m "$(cat <<'EOF'
Fix Fever cron firing duplicate Order Completed events

The Fever API returns order `id` as a JSON number. Our TS type claimed
string and transformOrder passed it through unchanged, so the in-memory
FeverOrder had a numeric feverOrderId while Supabase stored/returned it
as TEXT. The existingOrderIds Set<string> lookup in the cron therefore
never matched, flagging every order as new on every 5-min run and re-
firing Order Completed to Segment. Symmetric bug on the cancellation
path meant refunds never fired Order Cancelled.

fever_sync_state.orders_synced had inflated to 226,579 vs. 2,650 real
rows (85x) and lovaliantpoine@gmail.com accumulated 274 Order Completed
events for a single Apr 19 order. Coercing apiOrder.id to string in
transformOrder restores the dedup check; backfill-fever.ts was already
bug-free thanks to explicit String() casts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

Vercel auto-deploys from `main`. Production cron path `*/5 * * * *` at `/api/cron/fever-sync` picks up the new code on the next invocation.

## Post-deploy verification (watch for 15 min)

1. Watch Vercel logs for `/api/cron/fever-sync`:
   ```bash
   vercel logs --follow | grep fever-sync
   ```
2. After two consecutive cron cycles, check `fever_sync_state`:
   ```sql
   SELECT last_sync_at, last_order_created_at, orders_synced, items_synced FROM fever_sync_state WHERE id = 1;
   ```
   Expect `orders_synced` to stop climbing rapidly. If there are no new Fever orders for a cycle, the counter shouldn't move at all.
3. Check Amplitude for a newly-placed Fever order (or spot-check a recent `buyer_email`): expect **exactly 1 `Order Completed` per real order**, not 2-200+.
4. If cancellations happen organically in the test window, confirm `Order Cancelled` / `Order Refunded` events start appearing in Amplitude. Both the fever.ts coercion AND the segment.ts enum fix are required — a cancellation that runs with only one of the two fixes deployed will still silently no-op.

If orders_synced keeps climbing or dupes reappear, re-run the repro script — there may be a second code path (e.g. someone later added a fire site that doesn't go through `trackOrderCompleted`).

## Cancellation backfill (separate deploy, after the fix lands)

### Customer.io trigger audit — CLEAN (2026-04-24)

Enumerated every CIO asset via App API (token at `~/.claude/credentials/customerio.json`):

| Surface | Count | Triggers on cancel/refund? |
|---|---|---|
| Active campaigns | 3 | **No.** Only `Post Purchase Campaign` is event-triggered; trigger is `Order Completed`. Other two (`Abandoned Browse`, `Utility Workflow - Move Phone Number Property`) are `seg_attr`, no event trigger. |
| Archived/paused campaigns | 0 | — |
| Broadcasts | 0 | — |
| Newsletters (manual sends) | ~15 | N/A — one-shot manual sends, no triggers. |
| Segments | 22 | Grepped every condition payload. Zero reference `Order Cancelled` / `Order Refunded` / cancel / refund. Order-related segments (`Paying Customers`, `Did Not Complete Order`, `Buyers Before April 15…`) all key on `Order Completed` or attribute changes. |
| Transactional templates | 1 | Default uncategorized placeholder with empty trigger, not wired to anything. |

**Implication:** Firing all historical `Order Cancelled` / `Order Refunded` events to Segment is safe from a Customer.io-automation perspective. No emails or SMS will go out as a side effect. Event history on profiles will reflect the cancellation for future segment/campaign authoring.

### Backfill scope

From Supabase scan (2026-04-24, across all Fever history):

- **117 unique orders** would fire one event each
- Of those: **65 fire `Order Refunded`** (at least one Refund Cash / Refund Coupon item) and **52 fire `Order Cancelled`** (only Exchange or Unknown types)
- 190 underlying cancelled items total

Trivial scale — single-script run, no batching concerns, no IP warmup considerations (Customer.io is downstream-safe per audit).

### Script

`scripts/backfill-segment-cancellations.ts` — mirrors `replay-segment-historical.ts` style. Supports `--dry-run`. Reads cancelled orders from Supabase, fires one event per order with `cancellation_date` as Segment timestamp (Segment forwards this to CIO/Amplitude as the event time, preserving historical ordering).

Run sequence:

```bash
cd /Users/jon/src/imxp/iceland/dashboard

# dry-run first to confirm counts
npx tsx scripts/backfill-segment-cancellations.ts --dry-run
# expect: "117 orders would fire (65 Refunded, 52 Cancelled)"

# fire for real — only after fever.ts + segment.ts fix is deployed and a cron cycle has passed cleanly
npx tsx scripts/backfill-segment-cancellations.ts
```

### Ordering constraints

1. **Fix must ship and verify first.** Otherwise the cron's next cycle might also discover some of these cancellations and double-fire them.
2. **Backfill should run AFTER at least one post-fix cron cycle completes cleanly.** Lets the fixed code pick up anything cancelled in the last 24h so the backfill doesn't need to race with it.
3. **Downstream fan-out.** Segment has 5 destinations wired (CIO x2, Amplitude x3). Backfill hits all of them. Amplitude receiving 117 historical cancel events is a feature (fixes refund-adjusted revenue). If Jameson wants to isolate, pass `integrations: { 'Customer.io': false }` — but given the audit came back clean, no reason to.

## Follow-up: Amplitude cleanup (separate task)

Not blocking the code fix. Scope:
- Remove duplicate `Order Completed` and auto-expanded `Product Purchased` events from Amplitude for the ~2,650 affected Fever buyers.
- Amplitude has per-event deletion via `$insert_id` in the Batch Event Delete API, or user-level event deletion via UI.
- Strategy options:
  1. Per-order: keep the earliest `Order Completed` per `(user_id, order_id)`, delete the rest via batch API.
  2. Wholesale: delete all events with `affiliation = "Fever"` and `library = "@segment/analytics-node"` older than the deploy timestamp, then re-run `scripts/replay-segment-historical.ts` to re-seed cleanly from Supabase. Safer to audit but touches more data.

Recommend (1) — narrower blast radius. Jameson should weigh in on which approach he wants before we touch Amplitude.

Also: `fever_sync_state.orders_synced` and `items_synced` counters are meaningless due to the inflation. Either reset to accurate values (SELECT COUNT FROM fever_orders/items) or stop incrementing them from the cron; they're not read by anything important.

## Files touched by this plan

- `src/lib/fever.ts` — the one-line fix (plus optional type widening).
- `src/lib/segment.ts` — enum mismatch fix (cancellation pipeline).
- `scripts/backfill-segment-cancellations.ts` — new, for historical cancellation replay.
- `tmp/verify-cron-dedup.ts` — temporary, delete after verification.

## Related reference

- Investigation transcript: fresh Claude session on 2026-04-23 21:30 CT → 2026-04-24 ~01:00 UTC. Key Amplitude URL that kicked it off: `https://app.amplitude.com/analytics/im-xp-123062/project/798363/search/amplitude_id%3D1546717639017/activity?_source=user%20lookup`
- Segment write key: `SEGMENT_WRITE_KEY` env var (Fever source: `ydbNbAikND8W7tzlfaQd1gJueaMBXfcJ`, hardcoded in the replay scripts for reference).
- Amplitude project: `im-xp-123062`, app_id `798363`.
- Supabase column: `fever_orders.fever_order_id TEXT UNIQUE NOT NULL`.
