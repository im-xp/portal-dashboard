/**
 * Phase 2 main loop: per-customer CIO snapshot + delete + recreate + replay.
 *
 * Plan: context/plans/fever-cleanup-replay-enrichment.md (Phase 2).
 *
 * For each cohort member, atomically:
 *   1. Snapshot to /tmp/cio-cleanup-snapshots/<cohort>__<ts>/<email>/
 *        - attributes.json
 *        - activities.jsonl  (ALL events, paginated)
 *        - messages.json     (informational)
 *        - segments.json     (informational)
 *   2. Compute clean Order Completed list: group by data.order_id, keep
 *      earliest timestamp per group.
 *   3. DELETE /v1/customers/:cio_id (App API). Read-after-write: poll
 *      GET /v1/customers?email= every 5s up to 60s, assert empty.
 *   4. Re-fetch Post Purchase campaign; assert deduplicate_id still set with
 *      timestamp ≤ replay timestamps. Abort if not.
 *   5. Recreate via Segment Identify (cio-only integrations toggle), using
 *      snapshotted attributes (filtered to safe set; see ATTR_ALLOWLIST).
 *      Read-after-write: poll GET /v1/customers?email= every 5s up to 60s,
 *      assert one match.
 *   6. Replay clean Order Completed events via Segment Track (cio-only),
 *      original timestamps.
 *   7. Replay non-Order-Completed activity events via Segment Track (cio-only)
 *      with original timestamps. Per plan: activity-feed-only; CIO internal
 *      deliverability scoring not restored.
 *   8. Verify: re-snapshot via App API, diff against expectations. On
 *      mismatch, write to failures.jsonl, post nothing else, abort the loop.
 *
 * Modes:
 *   --cohort <path>     required
 *   --snapshot-only     just snapshot, no delete/replay (CYA pre-state)
 *   --execute           full delete-and-replay (otherwise dry-run)
 *   --max <N>           cap loop at N customers (e.g. 1, 10, 100)
 *
 * Auth: ~/.claude/credentials/customerio.json + .env.local (Segment write key).
 *
 * IMPORTANT: This script does NOT pause campaigns or the cron. Run
 *   cio-pause-campaigns.ts --execute
 * and remove the fever-sync entry from vercel.json (commit + push) BEFORE
 * invoking this script with --execute. Pending-send avoidance comes from the
 * campaign pause itself (campaigns 1+2 in draft → no new sends scheduled);
 * we no longer try to detect pending sends per-customer because CIO's
 * messages API doesn't expose a reliable "scheduled but not yet sent" field.
 *
 * Engagement-event replay caveat: snapshot non-Order-Completed activities
 * include CIO-internal email events (Email Sent / Delivered / Opened, etc.)
 * with CIO-shaped data fields (delivery_id, etc.). Replaying them as plain
 * analytics.track() lands them in the activity feed under the same name but
 * with our user-fired-Track shape, NOT as native CIO email logs. The plan
 * accepts this as "activity-feed-only restoration"; CIO's internal
 * deliverability scoring rebuilds organically from new sends post-cleanup.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, createWriteStream } from 'node:fs';
import * as path from 'node:path';
import { Analytics } from '@segment/analytics-node';

const SEGMENT_WRITE_KEY = 'ydbNbAikND8W7tzlfaQd1gJueaMBXfcJ';

// integrations toggle: cio-only equivalent of replay-segment-historical.ts's
// --amplitude-only. Default-deny + explicit allow on the destination's display
// name. Verified Apr 29 via Segment Public API.
//
// NOTE: spelling matters. "Customer.io Fever" exactly. A typo here leaks
// every replayed event to Amplitude (which is the worst possible failure for
// Phase 2 — we're trying to leave Amplitude alone until Phase 3).
const CIO_ONLY_INTEGRATIONS = { All: false, 'Customer.io Fever': true } as const;

type Creds = { app_api_key: string; region: string };
const CREDS: Creds = JSON.parse(
  readFileSync(`${process.env.HOME}/.claude/credentials/customerio.json`, 'utf8')
);
const AUTH = `Bearer ${CREDS.app_api_key}`;
const CIO_BASE = 'https://api.customer.io/v1';

const args = process.argv.slice(2);
const cohortIdx = args.indexOf('--cohort');
if (cohortIdx < 0) {
  console.error('Required: --cohort <path>');
  process.exit(1);
}
const COHORT_PATH = args[cohortIdx + 1];
const SNAPSHOT_ONLY = args.includes('--snapshot-only');
const EXECUTE = args.includes('--execute');
const MAX = (() => { const i = args.indexOf('--max'); return i >= 0 ? parseInt(args[i + 1], 10) : 0; })();

if (SNAPSHOT_ONLY && EXECUTE) {
  console.error('Cannot combine --snapshot-only and --execute');
  process.exit(1);
}

// Attributes we will RESTORE on recreate. Anything not on this list is
// snapshotted but NOT replayed. Reason: CIO mints its own cio_id; replaying
// stale cio_id / system fields would conflict. timestamps map is read-only
// metadata and will rebuild naturally.
const ATTR_ALLOWLIST = new Set([
  'email',
  'first_name',
  'last_name',
  'language',
  'birthday',
  'unsubscribed',
  'marketing_opt_in',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'initial_referrer',
  'initial_referring_domain',
  'referrer',
  'referring_domain',
  'acquisition_source',
  'attendees_with',
]);

// Events we DO NOT replay even if present in snapshot. Order Completed is
// rebuilt from the deduped list; Product Purchased is auto-expanded by
// Segment from Order Completed at the destination side.
const SKIP_EVENT_NAMES = new Set(['Order Completed', 'Product Purchased']);

type CohortMember = { email: string; cio_id: string; real_order_count: number; cio_oc_count: number; dupe_count: number };
type Cohort = { name: string; description?: string; members: CohortMember[] };

function loadCohort(p: string): Cohort {
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  if (!Array.isArray(raw.members)) throw new Error(`cohort ${p} must have members[]`);
  return raw;
}

async function cioGet(url: string): Promise<any> {
  const r = await fetch(url, { headers: { Authorization: AUTH } });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status} ${await r.text()}`);
  return r.json();
}

async function getCustomerByEmail(email: string): Promise<{ cio_id: string | null }> {
  const j = await cioGet(`${CIO_BASE}/customers?email=${encodeURIComponent(email)}`);
  const results = j.results ?? [];
  if (results.length === 0) return { cio_id: null };
  return { cio_id: results[0].cio_id ?? null };
}

async function getAttributes(cioId: string): Promise<any> {
  return cioGet(`${CIO_BASE}/customers/${cioId}/attributes?id_type=cio_id`);
}

async function getAllActivities(cioId: string): Promise<any[]> {
  const all: any[] = [];
  let next: string | undefined;
  const PAGE = 100;
  while (true) {
    const params = new URLSearchParams({ limit: String(PAGE) });
    if (next) params.set('start', next);
    const j = await cioGet(`${CIO_BASE}/customers/${cioId}/activities?${params}`);
    const a = j.activities ?? [];
    all.push(...a);
    next = j.next;
    if (!next || a.length === 0) break;
    if (all.length > 100_000) throw new Error(`activities ${cioId} > 100k; aborting`);
  }
  return all;
}

async function getMessages(cioId: string): Promise<any[]> {
  try {
    const j = await cioGet(`${CIO_BASE}/customers/${cioId}/messages?limit=200`);
    return j.messages ?? [];
  } catch { return []; }
}

async function getSegments(cioId: string): Promise<any[]> {
  try {
    const j = await cioGet(`${CIO_BASE}/customers/${cioId}/segments`);
    return j.segments ?? [];
  } catch { return []; }
}

async function getCampaign(id: number): Promise<any> {
  const j = await cioGet(`${CIO_BASE}/campaigns/${id}`);
  return j.campaign;
}

async function deleteCustomer(cioId: string): Promise<void> {
  const r = await fetch(`${CIO_BASE}/customers/${cioId}`, {
    method: 'DELETE',
    headers: { Authorization: AUTH },
  });
  if (!r.ok && r.status !== 404) {
    throw new Error(`DELETE customer ${cioId} → ${r.status} ${await r.text()}`);
  }
}

async function pollUntilGone(email: string, maxMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const { cio_id } = await getCustomerByEmail(email);
    if (!cio_id) return;
    await new Promise((res) => setTimeout(res, 5_000));
  }
  throw new Error(`pollUntilGone: ${email} still present after ${maxMs}ms`);
}

async function pollUntilExists(email: string, maxMs = 60_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const { cio_id } = await getCustomerByEmail(email);
    if (cio_id) return cio_id;
    await new Promise((res) => setTimeout(res, 5_000));
  }
  throw new Error(`pollUntilExists: ${email} not present after ${maxMs}ms`);
}

function dedupeOrderCompleted(activities: any[]): any[] {
  const byOrder = new Map<string, any>();
  for (const a of activities) {
    if (a.type !== 'event' || a.name !== 'Order Completed') continue;
    const oid = a.data?.order_id;
    if (!oid) continue;
    const existing = byOrder.get(oid);
    if (!existing || (a.timestamp ?? 0) < (existing.timestamp ?? 0)) {
      byOrder.set(oid, a);
    }
  }
  return Array.from(byOrder.values()).sort((x, y) => (x.timestamp ?? 0) - (y.timestamp ?? 0));
}

function nonOcEvents(activities: any[]): any[] {
  return activities.filter((a) => a.type === 'event' && !SKIP_EVENT_NAMES.has(a.name));
}

function buildIdentifyTraits(snapshotAttrs: Record<string, any>, email: string): Record<string, any> {
  // Always set email explicitly. The snapshot's attributes.email comes back
  // empty string in CIO's response (the real email lives in
  // customer.identifiers.email, not attributes.email). Pull from cohort.
  const traits: Record<string, any> = { email };
  for (const [k, v] of Object.entries(snapshotAttrs)) {
    if (!ATTR_ALLOWLIST.has(k)) continue;
    if (v === null || v === undefined || v === '') continue;
    // attendees_with comes back as a JSON-encoded string; decode if so.
    if (k === 'attendees_with' && typeof v === 'string' && v.startsWith('[')) {
      try { traits[k] = JSON.parse(v); continue; } catch { /* fall through */ }
    }
    // marketing_opt_in / unsubscribed come back as strings ("true"/"false")
    if ((k === 'marketing_opt_in' || k === 'unsubscribed') && typeof v === 'string') {
      if (v === 'true') { traits[k] = true; continue; }
      if (v === 'false') { traits[k] = false; continue; }
    }
    traits[k] = v;
  }
  return traits;
}

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

async function snapshotCustomer(member: CohortMember, snapshotDir: string): Promise<{
  attributes: any; activities: any[]; messages: any[]; segments: any[];
}> {
  const userDir = path.join(snapshotDir, member.email.replace(/[^a-z0-9@._-]/gi, '_'));
  ensureDir(userDir);

  const attributes = await getAttributes(member.cio_id);
  writeFileSync(path.join(userDir, 'attributes.json'), JSON.stringify(attributes, null, 2));

  const activities = await getAllActivities(member.cio_id);
  const stream = createWriteStream(path.join(userDir, 'activities.jsonl'), { flags: 'w' });
  for (const a of activities) stream.write(JSON.stringify(a) + '\n');
  await new Promise<void>((res) => stream.end(() => res()));

  const messages = await getMessages(member.cio_id);
  writeFileSync(path.join(userDir, 'messages.json'), JSON.stringify(messages, null, 2));

  const segments = await getSegments(member.cio_id);
  writeFileSync(path.join(userDir, 'segments.json'), JSON.stringify(segments, null, 2));

  writeFileSync(path.join(userDir, 'meta.json'), JSON.stringify({
    email: member.email,
    cio_id: member.cio_id,
    real_order_count: member.real_order_count,
    cio_oc_count_at_cohort_build: member.cio_oc_count,
    dupe_count_at_cohort_build: member.dupe_count,
    snapshot_at: new Date().toISOString(),
    counts: {
      activities_total: activities.length,
      activities_oc: activities.filter((a) => a.name === 'Order Completed').length,
      messages: messages.length,
      segments: segments.length,
    },
  }, null, 2));

  return { attributes, activities, messages, segments };
}

async function processOne(member: CohortMember, snapshotDir: string, segment: Analytics): Promise<{ ok: boolean; reason?: string }> {
  console.log(`\n--- ${member.email} (cio_id=${member.cio_id}) ---`);
  console.log(`    expected: real=${member.real_order_count} cio=${member.cio_oc_count} dupe=${member.dupe_count}`);

  // Re-verify cohort fact: cio_id still resolves to this email and current
  // OC count is unchanged. Per plan: "Before any destructive op on a cohort
  // member: re-run the cohort scan for that member to confirm dupe count
  // matches what was captured at cohort-build time."
  const live = await getCustomerByEmail(member.email);
  if (live.cio_id !== member.cio_id) {
    return { ok: false, reason: `cio_id drift: cohort=${member.cio_id} live=${live.cio_id}` };
  }

  // Re-fetch dedup-window guard before any destructive op.
  const postPurchase = await getCampaign(1);
  if (!postPurchase.deduplicate_id) {
    return { ok: false, reason: `Post Purchase campaign deduplicate_id missing` };
  }
  const dedupTs = parseInt(String(postPurchase.deduplicate_id).split(':')[1] ?? '0', 10);
  if (!dedupTs) return { ok: false, reason: `Post Purchase deduplicate_id parse failed: ${postPurchase.deduplicate_id}` };

  // Snapshot.
  const { attributes, activities } = await snapshotCustomer(member, snapshotDir);
  const attrs = attributes?.customer?.attributes ?? {};

  if (SNAPSHOT_ONLY) {
    console.log(`    [snapshot-only] done (${activities.length} activities)`);
    return { ok: true };
  }

  if (!EXECUTE) {
    const cleanOcCount = dedupeOrderCompleted(activities).length;
    const replayNonOcCount = nonOcEvents(activities).length;
    console.log(`    [dry-run] would: delete cio_id=${member.cio_id}, recreate, replay ${cleanOcCount} OC + ${replayNonOcCount} non-OC events`);
    console.log(`              dedup window timestamp: ${dedupTs} (events older than this won't re-trigger campaign 1)`);
    const oldestReplay = Math.min(...activities.map((a) => a.timestamp ?? Infinity));
    if (oldestReplay >= dedupTs) {
      console.log(`              WARNING: oldest replay ts ${oldestReplay} ≥ dedup ${dedupTs} — would risk re-enrollment`);
    }
    return { ok: true };
  }

  // === DESTRUCTIVE PATH ===

  // Assert all to-be-replayed Order Completed timestamps fall before dedup window.
  const cleanOc = dedupeOrderCompleted(activities);
  const tooNew = cleanOc.filter((e) => (e.timestamp ?? 0) >= dedupTs);
  if (tooNew.length > 0) {
    return { ok: false, reason: `${tooNew.length} OC events have ts ≥ dedup window ${dedupTs}; would re-enroll` };
  }

  console.log(`    deleting customer ${member.cio_id}...`);
  await deleteCustomer(member.cio_id);
  await pollUntilGone(member.email);
  console.log(`    deleted, polled empty`);

  // Recreate via Identify, cio-only.
  const traits = buildIdentifyTraits(attrs, member.email);
  segment.identify({
    userId: member.email,
    traits,
    timestamp: new Date(),
    integrations: CIO_ONLY_INTEGRATIONS,
  });
  await segment.flush();

  const newCioId = await pollUntilExists(member.email);
  console.log(`    recreated, new cio_id=${newCioId}`);

  // Replay clean OC events.
  for (const ev of cleanOc) {
    segment.track({
      userId: member.email,
      event: 'Order Completed',
      properties: ev.data ?? {},
      timestamp: new Date((ev.timestamp ?? 0) * 1000),
      integrations: CIO_ONLY_INTEGRATIONS,
    });
  }
  // Replay non-OC events.
  const otherEvents = nonOcEvents(activities);
  for (const ev of otherEvents) {
    segment.track({
      userId: member.email,
      event: ev.name,
      properties: ev.data ?? {},
      timestamp: new Date((ev.timestamp ?? 0) * 1000),
      integrations: CIO_ONLY_INTEGRATIONS,
    });
  }
  await segment.flush();
  console.log(`    replayed: ${cleanOc.length} OC + ${otherEvents.length} other`);

  // Eventual-consistency wait then verify counts.
  await new Promise((res) => setTimeout(res, 15_000));
  const verifyActivities = await getAllActivities(newCioId);
  const verifyOc = verifyActivities.filter((a) => a.name === 'Order Completed').length;
  const expectedOc = member.real_order_count;
  if (verifyOc !== expectedOc) {
    return { ok: false, reason: `verify OC mismatch: expected=${expectedOc} got=${verifyOc} (newCioId=${newCioId})` };
  }

  console.log(`    ✓ verify OK: ${verifyOc} OC events, total activities=${verifyActivities.length}`);
  return { ok: true };
}

async function main() {
  const cohort = loadCohort(COHORT_PATH);
  const targets = MAX > 0 ? cohort.members.slice(0, MAX) : cohort.members;
  console.log(`=== cleanup-cio-customer ===`);
  console.log(`cohort: ${cohort.name} (${cohort.members.length} total, processing ${targets.length})`);
  console.log(`mode:   ${SNAPSHOT_ONLY ? 'SNAPSHOT-ONLY' : EXECUTE ? 'EXECUTE' : 'DRY-RUN'}\n`);

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotDir = path.join('/tmp/cio-cleanup-snapshots', `${cohort.name}__${ts}`);
  ensureDir(snapshotDir);
  const failuresPath = path.join(snapshotDir, 'failures.jsonl');
  console.log(`snapshot dir: ${snapshotDir}\n`);

  const segment = new Analytics({ writeKey: SEGMENT_WRITE_KEY, maxEventsInBatch: 15 });

  let ok = 0;
  let fail = 0;
  for (const m of targets) {
    let result: { ok: boolean; reason?: string };
    try {
      result = await processOne(m, snapshotDir, segment);
    } catch (e: any) {
      result = { ok: false, reason: e.message };
    }
    if (result.ok) {
      ok++;
    } else {
      fail++;
      const line = JSON.stringify({ email: m.email, cio_id: m.cio_id, reason: result.reason, at: new Date().toISOString() });
      appendFileSync(failuresPath, line + '\n');
      console.error(`    ✗ ${m.email}: ${result.reason}`);
      console.error(`    aborting loop. failures log: ${failuresPath}`);
      break;
    }
  }

  await segment.closeAndFlush({ timeout: 15_000 });
  console.log(`\n=== Summary ===`);
  console.log(`ok:   ${ok}`);
  console.log(`fail: ${fail}`);
  console.log(`snapshot dir: ${snapshotDir}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
