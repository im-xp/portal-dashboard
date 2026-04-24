/**
 * Identify + plan deletion of duplicate Fever-sourced events in Amplitude caused
 * by the fever.ts type-leak dedup bug (fixed in commit d1d486c). Produces a
 * deletion plan JSON listing `$insert_id`s to delete.
 *
 * Dedup rule:
 *   - Order Completed: group by (user_id, properties.order_id). Keep earliest.
 *   - Product Purchased: group by (user_id, properties.order_id, properties.sku).
 *     Keep earliest.
 *
 * Scope: Fever-sourced events only (properties.affiliation === "Fever" AND
 * library === "@segment/analytics-node"). EdgeOS, website, CIO reverse-ETL
 * events are untouched.
 *
 * Pre-Feb 2026 baseline ~2.3x duplication (from initial sync + replay script
 * on Mar 26) is intentionally left alone — stable, non-growing, documented.
 *
 * Usage:
 *   npx tsx scripts/cleanup-amplitude-fever-dupes.ts                # analyze last 60d, dry-run
 *   npx tsx scripts/cleanup-amplitude-fever-dupes.ts --days 120     # wider window
 *   npx tsx scripts/cleanup-amplitude-fever-dupes.ts --execute      # BLOCKED until delete endpoint verified
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, createReadStream, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import path from 'node:path';

type Creds = { api_key: string; secret_key: string };
const CREDS: Creds = JSON.parse(readFileSync(`${process.env.HOME}/.claude/credentials/amplitude.json`, 'utf8'));
const AUTH = Buffer.from(`${CREDS.api_key}:${CREDS.secret_key}`).toString('base64');

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const DAYS = parseInt(args[args.indexOf('--days') + 1] || '60', 10);

const END = new Date();
const START = new Date(END.getTime() - DAYS * 24 * 60 * 60 * 1000);

function fmt(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  return `${y}${m}${day}T${h}`;
}

type EventRec = {
  insert_id: string;
  event_type: string;
  user_id: string | null;
  amplitude_id: number;
  event_time: string;
  order_id: string | null;
  sku: string | null;
  library: string | null;
  affiliation: string | null;
};

const WORKDIR = '/tmp/amp_export';
const ZIPPATH = '/tmp/amp_export.zip';

async function downloadExport() {
  const url = `https://amplitude.com/api/2/export?start=${fmt(START)}&end=${fmt(END)}`;
  console.log(`[download] ${url}`);
  const resp = await fetch(url, { headers: { Authorization: `Basic ${AUTH}` } });
  if (!resp.ok) throw new Error(`Export API failed: ${resp.status} ${await resp.text()}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  writeFileSync(ZIPPATH, buf);
  console.log(`[download] saved ${(buf.length / 1024 / 1024).toFixed(1)}MB to ${ZIPPATH}`);
}

function extractZip() {
  if (existsSync(WORKDIR)) rmSync(WORKDIR, { recursive: true });
  mkdirSync(WORKDIR, { recursive: true });
  execSync(`unzip -q -o ${ZIPPATH} -d ${WORKDIR}`);
  const files: string[] = [];
  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.json.gz')) files.push(full);
    }
  }
  walk(WORKDIR);
  console.log(`[extract] ${files.length} .json.gz files`);
  return files;
}

async function parseEvents(files: string[]): Promise<EventRec[]> {
  const out: EventRec[] = [];
  for (const f of files) {
    const rl = createInterface({ input: createReadStream(f).pipe(createGunzip()), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let e: any;
      try { e = JSON.parse(line); } catch { continue; }
      const affiliation = e.event_properties?.affiliation;
      const library = e.library;
      if (affiliation !== 'Fever') continue;
      if (library !== '@segment/analytics-node') continue;
      if (e.event_type !== 'Order Completed' && e.event_type !== 'Product Purchased') continue;
      out.push({
        insert_id: e['$insert_id'] || e.insert_id,
        event_type: e.event_type,
        user_id: e.user_id ?? null,
        amplitude_id: e.amplitude_id,
        event_time: e.event_time,
        order_id: e.event_properties?.order_id ?? null,
        sku: e.event_properties?.sku ?? null,
        library,
        affiliation,
      });
    }
  }
  console.log(`[parse] ${out.length} Fever-sourced OC/PP events`);
  return out;
}

function plan(events: EventRec[]) {
  const buckets = new Map<string, EventRec[]>();
  for (const e of events) {
    if (!e.order_id) continue;
    const key = e.event_type === 'Order Completed'
      ? `OC|${e.user_id ?? e.amplitude_id}|${e.order_id}`
      : `PP|${e.user_id ?? e.amplitude_id}|${e.order_id}|${e.sku ?? ''}`;
    const list = buckets.get(key) ?? [];
    list.push(e);
    buckets.set(key, list);
  }

  const keep: EventRec[] = [];
  const del: EventRec[] = [];
  let ocBuckets = 0, ppBuckets = 0, ocDel = 0, ppDel = 0;
  for (const [key, list] of buckets) {
    list.sort((a, b) => a.event_time.localeCompare(b.event_time));
    keep.push(list[0]);
    for (let i = 1; i < list.length; i++) del.push(list[i]);
    if (key.startsWith('OC|')) { ocBuckets++; ocDel += list.length - 1; }
    else { ppBuckets++; ppDel += list.length - 1; }
  }
  return { buckets, keep, del, stats: { ocBuckets, ppBuckets, ocDel, ppDel } };
}

async function main() {
  console.log(`=== Amplitude Fever dedup analysis ===`);
  console.log(`Window: ${START.toISOString()} → ${END.toISOString()} (${DAYS} days)`);
  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log();

  await downloadExport();
  const files = extractZip();
  const events = await parseEvents(files);
  const { keep, del, stats } = plan(events);

  console.log();
  console.log(`=== Deletion plan ===`);
  console.log(`  Order Completed: ${stats.ocBuckets} unique (user, order). Keep ${stats.ocBuckets}, delete ${stats.ocDel} dupes.`);
  console.log(`  Product Purchased: ${stats.ppBuckets} unique (user, order, sku). Keep ${stats.ppBuckets}, delete ${stats.ppDel} dupes.`);
  console.log(`  Total keep: ${keep.length}`);
  console.log(`  Total delete: ${del.length}`);

  const planPath = '/tmp/amp_deletion_plan.json';
  writeFileSync(planPath, JSON.stringify({
    window: { start: START.toISOString(), end: END.toISOString() },
    stats,
    deleteInsertIds: del.map(e => e.insert_id).filter(Boolean),
    sampleDeleted: del.slice(0, 5),
    sampleKept: keep.slice(0, 5),
  }, null, 2));
  console.log(`  Wrote plan to ${planPath} (${del.map(e => e.insert_id).filter(Boolean).length} insert_ids)`);

  if (!EXECUTE) {
    console.log();
    console.log(`Dry-run complete. Review ${planPath}, then re-run with --execute.`);
    return;
  }

  throw new Error(
    'EXECUTE path not wired yet. Amplitude\'s event deletion endpoint needs verification before we hit it. ' +
    'Candidate endpoints: POST /api/2/deletions/users (user-level, too broad) or the Event Deletion Job via ' +
    'Amplitude dashboard. Confirm with current Amplitude docs + Jameson before executing.'
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
