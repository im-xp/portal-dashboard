/**
 * Verify /api/stripe numbers against the baseline from the plan.
 *
 * Dedup is per-Stripe-account, scoped to the popup_city_ids that
 * each Stripe account actually services:
 *  - Portal (acct_1ST3U3): legacy IMXP account, services all popups (1,2,3)
 *  - Iceland (acct_1SUU6n): dedicated account, EdgeOS does NOT track it
 *
 * Without the per-account scope, Portal's $5 application-fee records
 * collide with Iceland's $5 charges on the same day and produce false
 * "matches" that deflate Iceland net.
 *
 * Usage: npx tsx scripts/verify-stripe.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { supabase } from '../src/lib/supabase';
import { getPayments, getApplicationPopupMap } from '../src/lib/nocodb';

interface ChargeRow {
  id: string;
  account_key: 'portal' | 'iceland';
  amount_cents: number;
  created_at: string;
  amount_refunded_cents: number | null;
}

const DEDUP_SCOPE: Record<'portal' | 'iceland', number[]> = {
  portal: [1, 2, 3],
  iceland: [],
};

function dateKey(iso: string): string {
  return iso.slice(0, 10);
}

async function main() {
  const [{ data: charges, error }, payments, popupByAppId] = await Promise.all([
    supabase
      .from('stripe_charges')
      .select('id, account_key, amount_cents, created_at, amount_refunded_cents')
      .eq('status', 'succeeded')
      .eq('refunded', false),
    getPayments(),
    getApplicationPopupMap(),
  ]);

  if (error) throw error;
  if (!charges) throw new Error('no charges returned');

  const approved = payments.filter((p) => p.status === 'approved');

  console.log(`Charges (succeeded, not refunded): ${charges.length}`);
  console.log(`EdgeOS approved payments: ${approved.length}`);
  console.log(`Applications resolved to popup: ${popupByAppId.size}`);

  const indexByPopup = new Map<number, Set<string>>();
  let unresolved = 0;
  for (const p of approved) {
    const popup = popupByAppId.get(p.application_id);
    if (popup === undefined) {
      unresolved++;
      continue;
    }
    const amountCents = Math.round(p.amount * 100);
    const key = `${amountCents}|${dateKey(p.created_at)}`;
    let idx = indexByPopup.get(popup);
    if (!idx) {
      idx = new Set();
      indexByPopup.set(popup, idx);
    }
    idx.add(key);
  }
  if (unresolved > 0) console.log(`  (${unresolved} payments had unresolved application popup)`);

  const summary = {
    portal: { gross: 0, net: 0, matched: 0, grossCount: 0, netCount: 0, matchedCount: 0 },
    iceland: { gross: 0, net: 0, matched: 0, grossCount: 0, netCount: 0, matchedCount: 0 },
  };

  for (const c of charges as ChargeRow[]) {
    const s = summary[c.account_key];
    if (!s) continue;
    const amount = (c.amount_cents - (c.amount_refunded_cents || 0)) / 100;
    s.gross += amount;
    s.grossCount += 1;

    const key = `${c.amount_cents}|${dateKey(c.created_at)}`;
    const popups = DEDUP_SCOPE[c.account_key];
    const matched = popups.some((popup) => indexByPopup.get(popup)?.has(key));
    if (matched) {
      s.matched += amount;
      s.matchedCount += 1;
    } else {
      s.net += amount;
      s.netCount += 1;
    }
  }

  const fmt = (n: number) => `$${n.toFixed(2)}`;

  console.log('\n--- Per-account ---');
  for (const key of ['portal', 'iceland'] as const) {
    const s = summary[key];
    console.log(
      `${key.padEnd(8)} gross=${fmt(s.gross)} (${s.grossCount})  ` +
        `matched=${fmt(s.matched)} (${s.matchedCount})  ` +
        `net=${fmt(s.net)} (${s.netCount})`
    );
  }

  const combinedNet = summary.portal.net + summary.iceland.net;
  console.log(`\nCombined net: ${fmt(combinedNet)}`);

  console.log('\n--- Baseline (2026-04-22 plan) ---');
  console.log('portal   gross=$69676.58 (60)   matched=$47534.00 (17)   net=$22142.58 (43)');
  console.log('iceland  gross=$71672.00 (250)  matched=$0.00 (0)         net=$71672.00 (250)');
  console.log('Combined net: $93814.58');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
