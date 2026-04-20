/**
 * One-shot backfill: pulls every Fever order (no date filter, no plan filter)
 * and upserts to prod Supabase. Skips Slack + Segment notifications.
 *
 * Use this to catch up orders on plans we weren't previously syncing
 * (Shuttle, Off-site Lodging, ATOMIKA, etc.).
 *
 * Usage: npx tsx scripts/backfill-fever.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import {
  fetchFeverOrders,
  orderToDbRow,
  itemToDbRow,
  FeverOrder,
} from '../src/lib/fever';
import { identifyBuyer, trackOrderCompleted, flushSegment } from '../src/lib/segment';

const DATE_FROM = '2025-01-01';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const UPSERT_BATCH = 100;
const EXISTS_BATCH = 500;

async function main() {
  const startedAt = Date.now();
  const dateTo = new Date().toISOString().split('T')[0];
  console.log(`[Backfill] Starting Fever pull from ${DATE_FROM} to ${dateTo}...`);

  const { orders, items } = await fetchFeverOrders({ dateFrom: DATE_FROM, dateTo });
  console.log(`[Backfill] Fetched ${orders.length} orders, ${items.length} items from Fever`);

  const existingOrderIds = new Set<string>();
  const orderIds = orders.map((o) => String(o.feverOrderId));
  for (let i = 0; i < orderIds.length; i += EXISTS_BATCH) {
    const batch = orderIds.slice(i, i + EXISTS_BATCH);
    const { data, error } = await supabase
      .from('fever_orders')
      .select('fever_order_id')
      .in('fever_order_id', batch);
    if (error) throw new Error(`Existence check failed: ${error.message}`);
    data?.forEach((e) => existingOrderIds.add(String(e.fever_order_id)));
  }
  console.log(`[Backfill] ${existingOrderIds.size} already in DB, ${orders.length - existingOrderIds.size} net new`);

  const planCounts = new Map<string, { name: string; total: number; new: number }>();
  const newOrders: FeverOrder[] = [];
  for (const o of orders) {
    const key = String(o.planId || 'unknown');
    const entry = planCounts.get(key) || { name: o.planName || '(no name)', total: 0, new: 0 };
    entry.total++;
    if (!existingOrderIds.has(String(o.feverOrderId))) {
      entry.new++;
      newOrders.push(o);
    }
    planCounts.set(key, entry);
  }

  console.log('\n[Backfill] Orders by plan (total / newly captured):');
  for (const [id, { name, total, new: n }] of [...planCounts.entries()].sort(
    (a, b) => b[1].total - a[1].total
  )) {
    console.log(`  ${id.padEnd(8)} total=${String(total).padStart(5)}  new=${String(n).padStart(5)}  ${name}`);
  }

  let ordersInserted = 0;
  let ordersUpdated = 0;
  console.log('\n[Backfill] Upserting orders...');
  for (let i = 0; i < orders.length; i += UPSERT_BATCH) {
    const batch = orders.slice(i, i + UPSERT_BATCH);
    const rows = batch.map(orderToDbRow);
    const { error } = await supabase.from('fever_orders').upsert(rows, {
      onConflict: 'fever_order_id',
    });
    if (error) throw new Error(`Order batch ${i}: ${error.message}`);
    for (const o of batch) {
      if (existingOrderIds.has(String(o.feverOrderId))) ordersUpdated++;
      else ordersInserted++;
    }
  }

  let itemsUpserted = 0;
  console.log('[Backfill] Upserting items...');
  for (let i = 0; i < items.length; i += UPSERT_BATCH) {
    const batch = items.slice(i, i + UPSERT_BATCH);
    const rows = batch.map(itemToDbRow);
    const { error } = await supabase.from('fever_order_items').upsert(rows, {
      onConflict: 'fever_order_id,fever_item_id',
    });
    if (error) throw new Error(`Item batch ${i}: ${error.message}`);
    itemsUpserted += batch.length;
  }

  if (process.env.SEGMENT_WRITE_KEY && newOrders.length > 0) {
    console.log(`\n[Backfill] Firing Segment events for ${newOrders.length} new orders...`);
    for (const order of newOrders) {
      const orderItems = items.filter((i) => String(i.feverOrderId) === String(order.feverOrderId));
      try {
        identifyBuyer(order, orderItems);
        trackOrderCompleted(order, orderItems);
      } catch (err) {
        console.error(`[Segment] Failed for order ${order.feverOrderId}:`, err);
      }
    }
    await flushSegment();
    console.log('[Backfill] Segment flushed');
  } else {
    console.log('\n[Backfill] Segment: skipped (no new orders or SEGMENT_WRITE_KEY unset)');
  }

  let latestOrderCreated: string | null = null;
  for (const o of orders) {
    if (o.orderCreatedAt) {
      const ts = o.orderCreatedAt.toISOString();
      if (!latestOrderCreated || ts > latestOrderCreated) latestOrderCreated = ts;
    }
  }

  const { data: state } = await supabase
    .from('fever_sync_state')
    .select('*')
    .eq('id', 1)
    .single();

  await supabase
    .from('fever_sync_state')
    .update({
      last_sync_at: new Date().toISOString(),
      last_order_created_at: latestOrderCreated,
      orders_synced: (state?.orders_synced || 0) + ordersInserted,
      items_synced: (state?.items_synced || 0) + itemsUpserted,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('\n[Backfill] Done.');
  console.log(`  orders inserted: ${ordersInserted}`);
  console.log(`  orders updated:  ${ordersUpdated}`);
  console.log(`  items upserted:  ${itemsUpserted}`);
  console.log(`  new plans captured: ${newOrders.length > 0 ? [...new Set(newOrders.map((o) => String(o.planId)))].join(', ') : '(none)'}`);
  console.log(`  last_order_created_at set to ${latestOrderCreated}`);
  console.log(`  elapsed: ${elapsed}s`);
}

main().catch((err) => {
  console.error('[Backfill] FAILED:', err);
  process.exit(1);
});
