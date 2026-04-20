/**
 * Dry-run the updated Fever sync. Pulls orders via fetchFeverOrders() but does
 * NOT write to Supabase or fire Slack notifications.
 *
 * Verifies:
 *   1. Order 110187807 (shuttle) now appears in the result
 *   2. What plan_ids come back vs. what was in the old FEVER_PLAN_IDS list
 *
 * Usage: npx tsx scripts/dryrun-fever-sync.ts [dateFrom] [dateTo]
 *   defaults to the last 30 days
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { fetchFeverOrders } from '../src/lib/fever';

const OLD_PLAN_IDS = ['420002', '474974', '416569', '480359', '474902', '433336'];
const PROBE_ORDER_ID = '110187807';

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split('T')[0];
}

async function main() {
  const dateFrom = process.argv[2] || daysAgo(30);
  const dateTo = process.argv[3] || new Date().toISOString().split('T')[0];

  console.log(`Fetching orders from ${dateFrom} to ${dateTo}...`);
  const { orders, items } = await fetchFeverOrders({ dateFrom, dateTo });

  console.log(`\nTotal orders: ${orders.length}`);
  console.log(`Total items:  ${items.length}`);

  const byPlan = new Map<string, { name: string; count: number }>();
  for (const o of orders) {
    const id = o.planId || 'unknown';
    const entry = byPlan.get(id) || { name: o.planName || '(no name)', count: 0 };
    entry.count++;
    byPlan.set(id, entry);
  }

  const sorted = [...byPlan.entries()].sort((a, b) => b[1].count - a[1].count);

  console.log('\nOrders by plan:');
  for (const [id, { name, count }] of sorted) {
    const tracked = OLD_PLAN_IDS.includes(id) ? '  (previously tracked)' : '  *** NEW ***';
    console.log(`  ${id.padEnd(8)} ${String(count).padStart(5)}  ${name}${tracked}`);
  }

  const newPlans = sorted.filter(([id]) => !OLD_PLAN_IDS.includes(id));
  const newOrderCount = newPlans.reduce((sum, [, v]) => sum + v.count, 0);
  console.log(
    `\nPlans not in old FEVER_PLAN_IDS: ${newPlans.length} (${newOrderCount} orders would be newly captured)`
  );

  const probe = orders.find((o) => String(o.feverOrderId) === PROBE_ORDER_ID);
  console.log(`\nProbe order ${PROBE_ORDER_ID}: ${probe ? 'FOUND' : 'MISSING'}`);
  if (probe) {
    console.log(`  plan:  ${probe.planId} (${probe.planName})`);
    console.log(`  buyer: ${probe.buyerEmail}`);
  } else {
    console.log(
      `  (if the probe is outside the date window, re-run with a wider range, e.g. 2026-04-01 2026-04-20)`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
