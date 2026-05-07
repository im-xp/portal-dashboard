/**
 * Phase 2 pre-flight: build the CIO cleanup cohort.
 *
 * Plan: context/plans/fever-cleanup-replay-enrichment.md (Phase 2 → pre-flight).
 *
 * For every distinct buyer_email in fever_orders:
 *   1. GET /v1/customers?email=<email>            → cio_id (or skip if missing)
 *   2. Count Order Completed events in CIO for that cio_id (paginated activities)
 *   3. Compute real_order_count = COUNT(DISTINCT fever_order_id) WHERE buyer_email
 *      AND fever_order_items.status IN ('ACTIVE','purchased')
 *   4. dupe_count = max(0, cio_oc_count - real_order_count)
 *
 * Output:
 *   scripts/cohorts/cio-cleanup-full.json
 *     {
 *       name, description,
 *       built_at,
 *       members: [
 *         { email, cio_id, real_order_count, cio_oc_count, dupe_count },
 *         ...
 *       ]
 *     }
 *   Members are filtered to dupe_count > 0 (no point cleaning customers who
 *   already have the right count). Buyers with no CIO record are reported
 *   in a `skipped_no_cio` array for traceability but excluded from members.
 *
 * Modes:
 *   default            full run, writes cohort file
 *   --dry-run          probe everything but don't write the cohort file
 *   --limit <N>        stop after N buyers (testing)
 *   --concurrency <N>  parallel CIO API calls (default 8)
 *
 * Auth: ~/.claude/credentials/customerio.json + .env.local (Supabase).
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

type Creds = { app_api_key: string; region: string };
const CREDS: Creds = JSON.parse(
  readFileSync(`${process.env.HOME}/.claude/credentials/customerio.json`, 'utf8')
);
const AUTH = `Bearer ${CREDS.app_api_key}`;
const CIO_BASE = 'https://api.customer.io/v1';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1], 10) : 0; })();
const CONCURRENCY = (() => { const i = args.indexOf('--concurrency'); return i >= 0 ? parseInt(args[i + 1], 10) : 8; })();

const OUT_PATH = 'scripts/cohorts/cio-cleanup-full.json';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type Member = {
  email: string;
  cio_id: string;
  real_order_count: number;
  cio_oc_count: number;
  dupe_count: number;
};

async function lookupCioId(email: string): Promise<string | null> {
  const url = `${CIO_BASE}/customers?email=${encodeURIComponent(email)}`;
  const r = await fetch(url, { headers: { Authorization: AUTH } });
  if (!r.ok) throw new Error(`lookupCioId ${email} → ${r.status} ${await r.text()}`);
  const j = await r.json();
  const results = j.results ?? [];
  if (results.length === 0) return null;
  return results[0].cio_id ?? null;
}

async function countOrderCompleted(cioId: string): Promise<number> {
  let total = 0;
  let next: string | undefined;
  const PAGE = 100;
  while (true) {
    const params = new URLSearchParams({
      type: 'event',
      name: 'Order Completed',
      limit: String(PAGE),
    });
    if (next) params.set('start', next);
    const url = `${CIO_BASE}/customers/${cioId}/activities?${params}`;
    const r = await fetch(url, { headers: { Authorization: AUTH } });
    if (!r.ok) throw new Error(`activities ${cioId} → ${r.status} ${await r.text()}`);
    const j = await r.json();
    const activities = j.activities ?? [];
    total += activities.length;
    next = j.next;
    if (!next || activities.length === 0) break;
    if (total > 50_000) throw new Error(`activities ${cioId} > 50k events; aborting`);
  }
  return total;
}

async function getRealOrderCounts(emails: string[]): Promise<Map<string, number>> {
  // Build via two queries: (1) all orders for the emails, (2) all active items
  // for those orders. Then count distinct fever_order_id per email where the
  // order has at least one active item. Mirrors replay-segment-historical.ts
  // active-only filter exactly.
  const orderIdToEmail = new Map<string, string>();
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('fever_orders')
      .select('fever_order_id, buyer_email')
      .in('buyer_email', emails)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fever_orders fetch: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (row.buyer_email && row.fever_order_id) {
        orderIdToEmail.set(row.fever_order_id, row.buyer_email);
      }
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const orderIds = Array.from(orderIdToEmail.keys());
  const ordersWithActiveItems = new Set<string>();
  for (let i = 0; i < orderIds.length; i += PAGE) {
    const slice = orderIds.slice(i, i + PAGE);
    const { data, error } = await supabase
      .from('fever_order_items')
      .select('fever_order_id, status')
      .in('fever_order_id', slice)
      .in('status', ['ACTIVE', 'purchased']);
    if (error) throw new Error(`fever_order_items fetch: ${error.message}`);
    for (const row of data ?? []) {
      if (row.fever_order_id) ordersWithActiveItems.add(row.fever_order_id);
    }
  }

  const counts = new Map<string, number>();
  for (const oid of ordersWithActiveItems) {
    const email = orderIdToEmail.get(oid);
    if (!email) continue;
    counts.set(email, (counts.get(email) ?? 0) + 1);
  }
  return counts;
}

async function getDistinctBuyerEmails(): Promise<string[]> {
  const PAGE = 1000;
  const all = new Set<string>();
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('fever_orders')
      .select('buyer_email')
      .not('buyer_email', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`distinct emails fetch: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) if (row.buyer_email) all.add(row.buyer_email);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return Array.from(all).sort();
}

async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

async function main() {
  console.log(`=== build-cio-cleanup-cohort ===`);
  console.log(`dry-run: ${DRY_RUN}, limit: ${LIMIT || 'none'}, concurrency: ${CONCURRENCY}\n`);

  const allEmails = await getDistinctBuyerEmails();
  console.log(`Distinct buyer_emails in fever_orders: ${allEmails.length}`);

  const targetEmails = LIMIT > 0 ? allEmails.slice(0, LIMIT) : allEmails;
  console.log(`Will probe: ${targetEmails.length}`);

  console.log(`\nLooking up real_order_count from Supabase...`);
  const realCounts = await getRealOrderCounts(targetEmails);
  console.log(`Got real counts for ${realCounts.size} buyers (others have no active items).`);

  console.log(`\nLooking up CIO state (parallel ${CONCURRENCY})...`);
  let done = 0;
  const probes = await pool(targetEmails, CONCURRENCY, async (email) => {
    try {
      const cioId = await lookupCioId(email);
      if (!cioId) return { email, cio_id: null as string | null, cio_oc_count: 0, error: null as string | null };
      const oc = await countOrderCompleted(cioId);
      done++;
      if (done % 50 === 0) console.log(`  ${done}/${targetEmails.length}...`);
      return { email, cio_id: cioId, cio_oc_count: oc, error: null };
    } catch (e: any) {
      done++;
      return { email, cio_id: null, cio_oc_count: 0, error: e.message };
    }
  });

  const skipped_no_cio: string[] = [];
  const errors: { email: string; error: string }[] = [];
  const members: Member[] = [];

  for (const p of probes) {
    if (p.error) { errors.push({ email: p.email, error: p.error }); continue; }
    if (!p.cio_id) { skipped_no_cio.push(p.email); continue; }
    const real = realCounts.get(p.email) ?? 0;
    const dupe = Math.max(0, p.cio_oc_count - real);
    if (dupe > 0) {
      members.push({
        email: p.email,
        cio_id: p.cio_id,
        real_order_count: real,
        cio_oc_count: p.cio_oc_count,
        dupe_count: dupe,
      });
    }
  }

  members.sort((a, b) => b.dupe_count - a.dupe_count);

  // Distribution buckets for human eyeball.
  const buckets = { '0': 0, '1': 0, '2-5': 0, '6-20': 0, '21-100': 0, '100+': 0 } as Record<string, number>;
  for (const m of members) {
    const d = m.dupe_count;
    if (d === 0) buckets['0']++;
    else if (d === 1) buckets['1']++;
    else if (d <= 5) buckets['2-5']++;
    else if (d <= 20) buckets['6-20']++;
    else if (d <= 100) buckets['21-100']++;
    else buckets['100+']++;
  }

  console.log(`\n=== Cohort summary ===`);
  console.log(`probed:           ${targetEmails.length}`);
  console.log(`skipped_no_cio:   ${skipped_no_cio.length}`);
  console.log(`errors:           ${errors.length}`);
  console.log(`members (dupe>0): ${members.length}`);
  console.log(`dupe_count distribution:`);
  for (const [k, v] of Object.entries(buckets)) console.log(`  ${k.padStart(7)}: ${v}`);
  console.log(`top 5 dupe_count:`);
  for (const m of members.slice(0, 5)) {
    console.log(`  ${m.email.padEnd(40)} cio=${m.cio_oc_count}  real=${m.real_order_count}  dupe=${m.dupe_count}`);
  }

  if (DRY_RUN) {
    console.log(`\n[dry-run] not writing ${OUT_PATH}`);
    return;
  }

  const cohortDir = 'scripts/cohorts';
  if (!existsSync(cohortDir)) mkdirSync(cohortDir, { recursive: true });

  const out = {
    name: 'cio-cleanup-full',
    description: 'Phase 2 CIO Order Completed dedupe cohort. Per buyer: real_order_count from fever_orders active items, cio_oc_count from CIO activities API, dupe_count = max(0, cio - real). Only members with dupe > 0 included.',
    built_at: new Date().toISOString(),
    distribution: buckets,
    skipped_no_cio,
    errors,
    members,
  };

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${OUT_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
