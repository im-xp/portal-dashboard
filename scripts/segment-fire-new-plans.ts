/**
 * One-shot Segment replay for the 3 plans that were never synced before
 * (Shuttle 570327, Off-site Lodging 568222, ATOMIKA 598046). These orders
 * were just backfilled into Supabase but have never been sent through Segment.
 *
 * Uses original order/cancellation timestamps so Amplitude places events in
 * the correct historical window.
 *
 * Usage: npx tsx scripts/segment-fire-new-plans.ts
 *        npx tsx scripts/segment-fire-new-plans.ts --dry-run
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { Analytics } from '@segment/analytics-node';

const SEGMENT_WRITE_KEY = 'ydbNbAikND8W7tzlfaQd1gJueaMBXfcJ';
const NEW_PLAN_IDS = ['570327', '568222', '598046'];
const DRY_RUN = process.argv.includes('--dry-run');

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  if (DRY_RUN) console.log('=== DRY RUN (no events will be sent) ===\n');

  const { data: orders, error } = await supabase
    .from('fever_orders')
    .select('*')
    .in('plan_id', NEW_PLAN_IDS)
    .not('buyer_email', 'is', null)
    .order('order_created_at', { ascending: true });

  if (error) throw new Error(`Supabase: ${error.message}`);
  console.log(`Fetched ${orders?.length ?? 0} orders on plans ${NEW_PLAN_IDS.join(', ')}`);

  const orderIds = (orders ?? []).map((o) => o.fever_order_id);
  const { data: items } = await supabase
    .from('fever_order_items')
    .select('*')
    .in('fever_order_id', orderIds);

  const itemsByOrder = new Map<string, Record<string, unknown>[]>();
  for (const item of items ?? []) {
    const list = itemsByOrder.get(item.fever_order_id) ?? [];
    list.push(item);
    itemsByOrder.set(item.fever_order_id, list);
  }

  const client = DRY_RUN ? null : new Analytics({ writeKey: SEGMENT_WRITE_KEY, maxEventsInBatch: 15 });
  const seenEmails = new Set<string>();
  let sent = 0;
  let skipped = 0;

  for (const order of orders ?? []) {
    const userId = order.buyer_email;
    const orderItems = itemsByOrder.get(order.fever_order_id) ?? [];
    const activeItems = orderItems.filter(
      (i) => i.status === 'ACTIVE' || i.status === 'purchased'
    );

    if (activeItems.length === 0) {
      skipped++;
      continue;
    }

    const ts = order.order_created_at ? new Date(order.order_created_at) : undefined;

    if (!DRY_RUN && client) {
      if (!seenEmails.has(userId)) {
        client.identify({
          userId,
          traits: {
            email: order.buyer_email,
            first_name: order.buyer_first_name,
            last_name: order.buyer_last_name,
            birthday: order.buyer_dob,
            language: order.buyer_language,
            marketing_opt_in: order.buyer_marketing_pref,
          },
          timestamp: ts,
        });
        seenEmails.add(userId);
      }

      const revenue = activeItems.reduce((s, i) => s + ((i.unitary_price as number) ?? 0), 0);
      const discount = activeItems.reduce((s, i) => s + ((i.discount as number) ?? 0), 0);
      const surcharge = activeItems.reduce((s, i) => s + ((i.surcharge as number) ?? 0), 0);
      const total = revenue + surcharge + (order.surcharge ?? 0) - discount;

      const products = activeItems.map((item) => ({
        product_id: item.session_id,
        sku: item.fever_item_id,
        name: item.session_name,
        category: order.plan_name,
        price: item.unitary_price ?? 0,
        quantity: 1,
        variant: item.session_is_addon ? 'addon' : 'ticket',
      }));

      client.track({
        userId,
        event: 'Order Completed',
        properties: {
          order_id: `fever_${order.fever_order_id}`,
          affiliation: 'Fever',
          total,
          revenue,
          discount,
          coupon: order.coupon_code,
          currency: order.currency ?? 'USD',
          products,
        },
        timestamp: ts,
      });
    }

    sent++;
  }

  if (!DRY_RUN && client) {
    console.log('Flushing Segment...');
    await client.closeAndFlush({ timeout: 15000 });
  }

  console.log(`\nDone.`);
  console.log(`  Orders sent:    ${sent}`);
  console.log(`  Skipped (no active items): ${skipped}`);
  console.log(`  Unique buyers:  ${seenEmails.size}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
