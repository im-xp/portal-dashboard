/**
 * Historical backfill: fires Order Cancelled / Order Refunded events for every
 * Fever order with at least one canceled item. Covers the gap created by two
 * stacked bugs (see context/plans/fever-cron-dedup-fix.md):
 *   1. fever.ts numeric-id type leak prevented the cron's cancellation filter
 *      from matching on line 157.
 *   2. segment.ts:91 filtered for status === 'CANCELLED' but real value is
 *      'canceled', so trackOrderCancelled returned empty even when invoked.
 *
 * Run ONLY after both fixes are deployed and one clean cron cycle has passed.
 *
 * Usage:
 *   npx tsx scripts/backfill-segment-cancellations.ts --dry-run
 *   npx tsx scripts/backfill-segment-cancellations.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { Analytics } from '@segment/analytics-node';

const SEGMENT_WRITE_KEY = 'ydbNbAikND8W7tzlfaQd1gJueaMBXfcJ';
const DRY_RUN = process.argv.includes('--dry-run');

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function createSegmentClient(): Analytics {
  return new Analytics({ writeKey: SEGMENT_WRITE_KEY, maxEventsInBatch: 15 });
}

function isCanceled(status: string | null | undefined): boolean {
  return status === 'canceled' || status === 'CANCELLED';
}

function isRefund(cancellationType: string | null | undefined): boolean {
  return !!cancellationType && cancellationType.startsWith('Refund');
}

async function main() {
  if (DRY_RUN) console.log('=== DRY RUN (no events will be sent) ===\n');

  const { data: cancelledItems, error: itemErr } = await supabase
    .from('fever_order_items')
    .select('*')
    .eq('status', 'canceled');

  if (itemErr) { console.error('item fetch failed:', itemErr.message); process.exit(1); }
  if (!cancelledItems || cancelledItems.length === 0) {
    console.log('No canceled items in fever_order_items. Nothing to do.');
    return;
  }

  const orderIds = Array.from(new Set(cancelledItems.map((i: any) => i.fever_order_id)));
  console.log(`Canceled items: ${cancelledItems.length}`);
  console.log(`Unique orders with cancellations: ${orderIds.length}`);

  const { data: orders, error: orderErr } = await supabase
    .from('fever_orders')
    .select('*')
    .in('fever_order_id', orderIds);

  if (orderErr) { console.error('order fetch failed:', orderErr.message); process.exit(1); }
  if (!orders || orders.length === 0) {
    console.log('No matching orders found — data integrity issue.');
    return;
  }

  const cancelledByOrder = new Map<string, any[]>();
  for (const item of cancelledItems) {
    const list = cancelledByOrder.get(item.fever_order_id) ?? [];
    list.push(item);
    cancelledByOrder.set(item.fever_order_id, list);
  }

  let client = DRY_RUN ? null : createSegmentClient();
  let refundedCount = 0;
  let cancelledCount = 0;
  let skippedNoUser = 0;
  let errors = 0;
  const eventsByType: Record<string, number> = {};

  for (const order of orders) {
    const items = cancelledByOrder.get(order.fever_order_id) ?? [];
    if (items.length === 0) continue;

    const userId: string | null =
      order.buyer_email || items.find((i: any) => i.owner_email)?.owner_email || null;

    if (!userId) {
      skippedNoUser++;
      continue;
    }

    const hasRefund = items.some((i: any) => isRefund(i.cancellation_type));
    const event = hasRefund ? 'Order Refunded' : 'Order Cancelled';
    if (hasRefund) refundedCount++; else cancelledCount++;

    for (const i of items) {
      const key = i.cancellation_type || '(null)';
      eventsByType[key] = (eventsByType[key] ?? 0) + 1;
    }

    const ts = (() => {
      const dates = items
        .map((i: any) => i.cancellation_date)
        .filter((d: any): d is string => !!d)
        .map((d: string) => new Date(d));
      if (dates.length === 0) return undefined;
      return new Date(Math.min(...dates.map((d: Date) => d.getTime())));
    })();

    const products = items.map((i: any) => ({
      product_id: i.session_id,
      sku: i.fever_item_id,
      name: i.session_name,
      category: order.plan_name,
      price: i.unitary_price ?? 0,
      quantity: 1,
    }));

    if (!DRY_RUN && client) {
      try {
        client.track({
          userId,
          event,
          properties: {
            order_id: `fever_${order.fever_order_id}`,
            products,
          },
          timestamp: ts,
        });
      } catch (err) {
        errors++;
        console.error(`track failed for order ${order.fever_order_id}:`, err);
      }
    }
  }

  if (!DRY_RUN && client) {
    console.log('\nFlushing Segment...');
    await client.closeAndFlush({ timeout: 15000 });
  }

  console.log('\nDone.');
  console.log(`  Order Refunded events: ${refundedCount}`);
  console.log(`  Order Cancelled events: ${cancelledCount}`);
  console.log(`  Total events: ${refundedCount + cancelledCount}`);
  console.log(`  Skipped (no user id): ${skippedNoUser}`);
  if (errors > 0) console.log(`  Errors: ${errors}`);
  console.log('\nCanceled item breakdown:');
  for (const [type, count] of Object.entries(eventsByType).sort()) {
    console.log(`  ${type}: ${count}`);
  }
  if (DRY_RUN) console.log('\n(dry-run — no events fired)');
}

main().catch((err) => { console.error(err); process.exit(1); });
