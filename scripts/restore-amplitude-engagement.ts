/**
 * Restore non-Fever Amplitude events from a snapshot JSONL after a user-level
 * delete. Use this in Phase 1 cleanup to re-fire historical email engagement
 * events (Sent/Delivered/Opened/Clicked/etc) that were mirrored from CIO into
 * Amplitude, since CIO's Amplitude integration is forward-sync only and won't
 * backfill on its own.
 *
 * What gets restored: any event in the snapshot that ISN'T 'Order Completed'
 * or 'Product Purchased' (those regenerate from Supabase via the replay).
 *
 * Targets the new amplitude_id (assigned after delete + replay) by user_id.
 * Uses Amplitude HTTP V2 API directly (api2.amplitude.com/2/httpapi). Insert_id
 * is derived deterministically from the original so re-runs are idempotent
 * (Amplitude dedupes within 7 days on insert_id).
 *
 * Plan: see context/plans/fever-cleanup-replay-enrichment.md
 *
 * Usage:
 *   npx tsx scripts/restore-amplitude-engagement.ts --events <path-to-jsonl>
 *     # default: dry-run, prints what would be sent
 *   npx tsx scripts/restore-amplitude-engagement.ts --events <path> --execute
 */

import { readFileSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

type Creds = { api_key: string };
const CREDS: Creds = JSON.parse(readFileSync(`${process.env.HOME}/.claude/credentials/amplitude.json`, 'utf8'));

const args = process.argv.slice(2);
const eventsIdx = args.indexOf('--events');
if (eventsIdx < 0) {
  console.error('Required: --events <path-to-jsonl>');
  process.exit(1);
}
const EVENTS_PATH = args[eventsIdx + 1];
const EXECUTE = args.includes('--execute');

// Skip event types our replay regenerates so we don't double-fire.
const SKIP_EVENT_TYPES = new Set(['Order Completed', 'Product Purchased']);

const HTTP_V2 = 'https://api2.amplitude.com/2/httpapi';
const BATCH = 100; // well under HTTP V2's 2000 limit; keeps payload small

function toUnixMs(eventTime: string): number {
  // Amplitude exports give us "YYYY-MM-DD HH:MM:SS.ffffff" interpreted as UTC.
  const isoish = eventTime.replace(' ', 'T') + 'Z';
  const ms = Date.parse(isoish);
  if (Number.isNaN(ms)) throw new Error(`Bad event_time: ${eventTime}`);
  return ms;
}

async function postBatch(events: any[]): Promise<{ status: number; body: string }> {
  const resp = await fetch(HTTP_V2, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: CREDS.api_key, events }),
  });
  return { status: resp.status, body: await resp.text() };
}

async function main() {
  console.log(`=== RESTORE ENGAGEMENT ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'} ===`);
  console.log(`events file: ${EVENTS_PATH}`);

  const rl = createInterface({ input: createReadStream(EVENTS_PATH), crlfDelay: Infinity });
  const queued: any[] = [];
  const skippedByType: Record<string, number> = {};
  let total = 0;
  let restored = 0;

  async function flush() {
    if (queued.length === 0) return;
    if (!EXECUTE) {
      console.log(`  [dry-run] would POST batch of ${queued.length} events`);
      restored += queued.length;
      queued.length = 0;
      return;
    }
    const { status, body } = await postBatch(queued);
    if (status >= 200 && status < 300) {
      console.log(`  [restore] ${queued.length} events → ${status}`);
      restored += queued.length;
    } else {
      console.error(`  [restore] FAILED ${status} ${body.slice(0, 300)}`);
      throw new Error(`HTTP V2 batch failed: ${status}`);
    }
    queued.length = 0;
  }

  for await (const line of rl) {
    if (!line.trim()) continue;
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }
    total++;

    if (SKIP_EVENT_TYPES.has(ev.event_type)) {
      skippedByType[ev.event_type] = (skippedByType[ev.event_type] ?? 0) + 1;
      continue;
    }

    const userId = ev.user_id ?? ev._snapshot_email;
    if (!userId) {
      skippedByType['(no user_id)'] = (skippedByType['(no user_id)'] ?? 0) + 1;
      continue;
    }

    const time = toUnixMs(ev.event_time);
    const originalInsert = ev['$insert_id'] ?? ev.insert_id ?? `${ev.event_type}-${time}`;

    queued.push({
      user_id: userId,
      event_type: ev.event_type,
      time,
      event_properties: ev.event_properties ?? {},
      user_properties: ev.user_properties ?? {},
      insert_id: `restore-${originalInsert}`,
    });

    if (queued.length >= BATCH) await flush();
  }
  await flush();

  console.log();
  console.log(`Total events scanned: ${total}`);
  console.log(`Restored: ${restored}`);
  console.log(`Skipped (replay regenerates these):`);
  for (const [t, n] of Object.entries(skippedByType)) console.log(`  ${n}\t${t}`);

  if (!EXECUTE) console.log(`\nDry-run complete. Re-run with --execute to actually restore.`);
}

main().catch(e => { console.error(e); process.exit(1); });
