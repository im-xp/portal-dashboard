/**
 * Phase 1 Amplitude user delete + snapshot.
 *
 * Reads a cohort JSON ({ emails: [...] }) and either:
 *   - Snapshots each user's current Amplitude state (default).
 *   - Submits a user-level delete request via /api/2/deletions/users.
 *
 * The snapshot is best-effort CYA: a record of what was in Amplitude
 * before we deleted, in case we need to answer "what did this user
 * have?" later. Amplitude does not support restoring deleted user
 * data — the snapshot is not a rollback mechanism.
 *
 * Plan: see context/plans/fever-cleanup-replay-enrichment.md
 *
 * Usage:
 *   npx tsx scripts/cleanup-amplitude-delete.ts --cohort scripts/cohorts/n1-mckenzie.json
 *     # default: snapshot only, no delete
 *   npx tsx scripts/cleanup-amplitude-delete.ts --cohort ... --delete
 *     # dry-run delete (prints what it would do)
 *   npx tsx scripts/cleanup-amplitude-delete.ts --cohort ... --delete --execute
 *     # actually delete
 *   npx tsx scripts/cleanup-amplitude-delete.ts --cohort ... --delete --execute --wait
 *     # delete and poll status until DONE (max 1h)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import * as path from 'node:path';

type Creds = { api_key: string; secret_key: string };
const CREDS: Creds = JSON.parse(readFileSync(`${process.env.HOME}/.claude/credentials/amplitude.json`, 'utf8'));
const AUTH = Buffer.from(`${CREDS.api_key}:${CREDS.secret_key}`).toString('base64');

const args = process.argv.slice(2);
const cohortIdx = args.indexOf('--cohort');
if (cohortIdx < 0) {
  console.error('Required: --cohort <path-to-json>');
  process.exit(1);
}
const COHORT_PATH = args[cohortIdx + 1];
const DELETE_MODE = args.includes('--delete');
const EXECUTE = args.includes('--execute');
const WAIT = args.includes('--wait');
const REQUESTER = (() => {
  const i = args.indexOf('--requester');
  return i >= 0 ? args[i + 1] : 'jon@im-xp.com';
})();

const SNAPSHOT_DIR = '/tmp/amp-cleanup-snapshots';
const DELETE_LOG_DIR = '/tmp/amp-cleanup-deletions';

type Cohort = { name?: string; description?: string; emails: string[] };

function loadCohort(p: string): Cohort {
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  if (Array.isArray(raw)) return { emails: raw };
  if (!Array.isArray(raw.emails)) throw new Error('Cohort must have emails: [...]');
  return raw;
}

async function userSearch(email: string): Promise<any> {
  const url = `https://amplitude.com/api/2/usersearch?user=${encodeURIComponent(email)}`;
  const resp = await fetch(url, { headers: { Authorization: `Basic ${AUTH}` } });
  if (!resp.ok) throw new Error(`usersearch ${email} → ${resp.status} ${await resp.text()}`);
  return resp.json();
}

async function userActivity(amplitudeId: number, offset = 0, limit = 1000): Promise<any> {
  const url = `https://amplitude.com/api/2/useractivity?user=${amplitudeId}&offset=${offset}&limit=${limit}`;
  const resp = await fetch(url, { headers: { Authorization: `Basic ${AUTH}` } });
  if (!resp.ok) throw new Error(`useractivity ${amplitudeId} → ${resp.status} ${await resp.text()}`);
  return resp.json();
}

async function snapshot(cohort: Cohort) {
  if (!existsSync(SNAPSHOT_DIR)) mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const cohortName = cohort.name ?? 'cohort';
  const summaryPath = path.join(SNAPSHOT_DIR, `${cohortName}__${ts}.json`);
  const eventsPath = path.join(SNAPSHOT_DIR, `${cohortName}__${ts}.events.jsonl`);
  const eventsStream = require('node:fs').createWriteStream(eventsPath, { flags: 'w' });

  const result: any[] = [];
  let totalEvents = 0;
  for (const email of cohort.emails) {
    process.stdout.write(`[snapshot] ${email}... `);
    let search;
    try { search = await userSearch(email); }
    catch (e: any) { console.log(`search FAILED: ${e.message}`); result.push({ email, error: e.message }); continue; }

    const matches = search.matches ?? [];
    const userRecord: any = { email, type: search.type, matches: matches.length, users: [] };

    for (const m of matches) {
      const userBlock: any = { user_id: m.user_id, amplitude_id: m.amplitude_id };
      // Pull events page by page until empty.
      const events: any[] = [];
      let offset = 0;
      const PAGE = 1000;
      while (true) {
        let act;
        try { act = await userActivity(m.amplitude_id, offset, PAGE); }
        catch (e: any) { userBlock.activity_error = e.message; break; }
        const evs = act.events ?? [];
        events.push(...evs);
        if (evs.length < PAGE) break;
        offset += PAGE;
        if (offset > 50000) { userBlock.truncated_at = offset; break; } // safety
      }
      userBlock.event_count = events.length;
      // Tally by event_type and Order Completed by order_id
      const byType: Record<string, number> = {};
      const ocByOrder: Record<string, number> = {};
      let revenueSum = 0;
      for (const ev of events) {
        byType[ev.event_type] = (byType[ev.event_type] ?? 0) + 1;
        if (ev.event_type === 'Order Completed') {
          const oid = ev.event_properties?.order_id ?? '(none)';
          ocByOrder[oid] = (ocByOrder[oid] ?? 0) + 1;
          revenueSum += Number(ev.event_properties?.revenue ?? 0);
        }
        // Tag each event with the source email so the restore script knows whose
        // events these are without re-querying.
        eventsStream.write(JSON.stringify({ ...ev, _snapshot_email: email }) + '\n');
      }
      totalEvents += events.length;
      userBlock.by_event_type = byType;
      userBlock.order_completed_by_order_id = ocByOrder;
      userBlock.order_completed_revenue_sum = revenueSum;
      userBlock.user_properties = m.user_properties;
      userRecord.users.push(userBlock);
    }
    console.log(`${matches.length} matches, ${userRecord.users.reduce((s: number, u: any) => s + (u.event_count ?? 0), 0)} events`);
    result.push(userRecord);
  }

  await new Promise<void>(res => eventsStream.end(() => res()));

  writeFileSync(summaryPath, JSON.stringify({
    cohort,
    snapshotted_at: new Date().toISOString(),
    summary_path: summaryPath,
    events_path: eventsPath,
    total_events: totalEvents,
    users: result,
  }, null, 2));
  console.log(`\n[snapshot] summary: ${summaryPath}`);
  console.log(`[snapshot] events:  ${eventsPath} (${totalEvents} events)`);
  return { summaryPath, eventsPath };
}

async function deleteUsers(cohort: Cohort) {
  if (!existsSync(DELETE_LOG_DIR)) mkdirSync(DELETE_LOG_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const cohortName = cohort.name ?? 'cohort';
  const logPath = path.join(DELETE_LOG_DIR, `${cohortName}__${ts}.json`);

  console.log(`\n=== DELETE ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'} ===`);
  console.log(`cohort: ${cohortName} (${cohort.emails.length} emails)`);
  console.log(`requester: ${REQUESTER}`);

  // Amplitude limits user_ids to 100 per call.
  const BATCH = 100;
  const log: any = { cohort: cohortName, requester: REQUESTER, executed: EXECUTE, started_at: new Date().toISOString(), batches: [] };

  for (let i = 0; i < cohort.emails.length; i += BATCH) {
    const batch = cohort.emails.slice(i, i + BATCH);
    console.log(`\nbatch ${Math.floor(i / BATCH) + 1}: ${batch.length} users`);
    for (const e of batch.slice(0, 5)) console.log(`  - ${e}`);
    if (batch.length > 5) console.log(`  ... +${batch.length - 5} more`);

    if (!EXECUTE) {
      log.batches.push({ batch_index: Math.floor(i / BATCH), users: batch, dry_run: true });
      continue;
    }

    const body = {
      user_ids: batch,
      requester: REQUESTER,
      ignore_invalid_id: 'True',
      delete_from_org: 'False',
    };
    const resp = await fetch('https://amplitude.com/api/2/deletions/users', {
      method: 'POST',
      headers: { Authorization: `Basic ${AUTH}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    console.log(`  → ${resp.status} ${typeof parsed === 'string' ? parsed.slice(0, 200) : JSON.stringify(parsed).slice(0, 200)}`);
    log.batches.push({ batch_index: Math.floor(i / BATCH), users: batch, status: resp.status, response: parsed });
    if (!resp.ok) {
      log.aborted_at = new Date().toISOString();
      log.error = `Batch failed: HTTP ${resp.status}`;
      break;
    }
  }

  log.finished_at = new Date().toISOString();
  writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log(`\n[delete] wrote ${logPath}`);

  if (EXECUTE && WAIT) {
    await waitForDeletion(cohort.emails);
  }

  return logPath;
}

// Poll /api/2/deletions/users?day=YYYY-MM-DD until every email in the cohort
// shows status DONE (case-insensitive). Returns when complete or throws on
// timeout.
async function waitForDeletion(emails: string[]) {
  const day = new Date().toISOString().slice(0, 10);
  const url = `https://amplitude.com/api/2/deletions/users?day=${day}`;
  const targets = new Set(emails.map(e => e.toLowerCase()));
  console.log(`\n[wait] polling deletion status for ${targets.size} users (day=${day})`);

  const POLL_INTERVAL_MS = 30_000;
  const MAX_WAIT_MS = 60 * 60_000; // 1h hard cap
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT_MS) {
    const resp = await fetch(url, { headers: { Authorization: `Basic ${AUTH}` } });
    if (!resp.ok) {
      console.error(`  [wait] poll failed: ${resp.status}`);
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }
    const data: any = await resp.json();
    // Response shape: { requests: [{ user_ids: [...], status: "...", ... }, ...] }
    // OR (older shape): a direct list. Handle both defensively.
    const requests: any[] = data.requests ?? data.data ?? data ?? [];

    const statusByEmail = new Map<string, string>();
    for (const req of requests) {
      const status = (req.status ?? req.state ?? '').toUpperCase();
      const userIds: string[] = req.user_ids ?? req.userIds ?? [];
      for (const uid of userIds) {
        const lower = uid.toLowerCase();
        if (targets.has(lower)) {
          // Keep the most recent / latest status. Latest in array wins.
          statusByEmail.set(lower, status);
        }
      }
    }

    const counts = { DONE: 0, PENDING: 0, IN_PROGRESS: 0, MISSING: 0, OTHER: 0 };
    for (const e of Array.from(targets)) {
      const s = statusByEmail.get(e);
      if (!s) counts.MISSING++;
      else if (s === 'DONE' || s === 'COMPLETED' || s === 'COMPLETE') counts.DONE++;
      else if (s === 'PENDING' || s === 'QUEUED') counts.PENDING++;
      else if (s === 'IN_PROGRESS' || s === 'PROCESSING') counts.IN_PROGRESS++;
      else counts.OTHER++;
    }

    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`  [wait] +${elapsed}s  done=${counts.DONE}/${targets.size}  pending=${counts.PENDING}  in_progress=${counts.IN_PROGRESS}  missing=${counts.MISSING}  other=${counts.OTHER}`);

    if (counts.DONE === targets.size) {
      console.log(`[wait] all ${targets.size} deletions complete after ${elapsed}s`);
      return;
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`waitForDeletion: timeout after ${MAX_WAIT_MS / 1000}s — manual check required`);
}

async function main() {
  const cohort = loadCohort(COHORT_PATH);
  console.log(`Loaded cohort: ${cohort.name ?? '(unnamed)'} — ${cohort.emails.length} emails`);
  if (cohort.description) console.log(`Description: ${cohort.description}`);

  if (!DELETE_MODE) {
    console.log('\nMode: SNAPSHOT (pass --delete to delete)');
    await snapshot(cohort);
    return;
  }

  await deleteUsers(cohort);
  if (!EXECUTE) {
    console.log('\nDry-run complete. Re-run with --execute to actually delete.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
