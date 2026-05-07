# Fever Cleanup + Enriched Replay

## Context

Follow-on from `fever-cron-dedup-fix.md`. The cron-bug fix stopped *new* duplicates, but Amplitude (and CIO via reverse-ETL) still carries the historical pollution: ~2k Fever buyers with thousands of duplicate `Order Completed` events, inflating revenue from real ~3M to ~62M.

Jameson + Jon aligned in `#ie26-mktg-general` (threads `1776962839.010189` and `1777294778.420899`, Apr 24-29). Jameson said the CIO dupes aren't show stoppers; Jon flagged that cross-system revenue agreement would be valuable; both agreed.

**Plan changed Apr 29 evening (Jon ↔ Claude) after API verification**: Amplitude's user-deletion endpoint has a 3-day staging window followed by an asynchronous batch job that runs within 30 days. There is no fast, controllable path to "delete then replay an hour later" — replaying mid-staging risks the new events getting wiped along with the old ones when the batch eventually runs.

The plan splits into three phases (re-ordered May 7: CIO before Amplitude, after audit established that Amplitude work doesn't unblock Jameson but CIO sequencing was confused):

- **Phase 1a — Identify-only enrichment** ✅ COMPLETE May 1. Fired enriched `identify` calls for all 1,948 Fever buyers via Segment to both Amplitude and CIO. Set `utm_*`, `initial_referrer`, `initial_referring_domain`, `acquisition_source`, `attendees_with`. No deletions. No Order Completed re-fire. Fully reversible.
- **Phase 2 — CIO Order Completed dedupe** (decided May 7, going next). Per-customer delete-and-replay against CIO via App API + Track API, snapshotting and restoring all customer-meaningful state. Cleans the 41k duplicate Order Completed events sitting in CIO so revenue-based segments and CIO-side reporting are accurate. Replays use original (pre-May-6) timestamps so the campaign dedup window blocks any re-enrollment. Approved by Jameson Slack thread `1777294778.420899` May 7 21:55 UTC, with explicit ask to pause campaigns first.
- **Phase 3 — Amplitude delete + replay** (after Phase 2). Delete the ~2k polluted Amplitude users + replay clean Order Completed events from Supabase + restore non-Fever engagement events from snapshot. End state: real $3.29M revenue instead of ~$50M, channel attribution dashboard works without manual cross-checks. Decision point inside this phase: if Amplitude's deletion API actually clears within hours (rather than the documented 30 days), run the full flow; if slow, accept polluted revenue history and rely on dashboard-side cutoff filters going forward.

Why Phase 1a doesn't touch CIO:
- CIO holds unrecoverable state (email engagement: sends, opens, clicks). A wrong move there is worse than the wrong move on Amplitude.
- The Segment `integrations` toggle (`{ All: false, 'Amplitude Fever': true }`) routes the identify calls to Amplitude only and skips Customer.io Fever entirely. Jameson's paused campaigns + 1-msg/day + enroll-once safeguards are defense-in-depth, but the toggle removes the risk entirely.

Why Phase 1a doesn't fire Order Completed:
- Amplitude already has the polluted Order Completed events. Re-firing would *add* a clean event on top of the dupes (making the count one worse), not replace them.
- Channel attribution on user-level dashboards reads from user properties, which Identify alone populates. Order Completed re-fire is only useful as part of the delete + replay pattern in Phase 3.

**Phase 1a success criterion**: Jameson's marketing dashboard (`app.amplitude.com/analytics/im-xp-123062/space/web-analytics/channels?app=798363`) classifies users into Paid Social / Organic Social / Direct etc. correctly for new events from Fever buyers. Channel breakdown stops over-weighting direct traffic.

**Phase 3 decision criterion**: if a single-user deletion completes (status `done`) within hours of submission, the original delete-and-replay flow becomes viable. If it sits in `staging`/`submitted` for days as the docs warn, switch to dashboard-side cutoff filters as the long-term path.

## Field mapping

Sourced from `fever_orders` (Supabase) + `fever_orders.booking_questions` JSONB.

| Supabase column | Segment call | Segment field | Amplitude property |
|---|---|---|---|
| `utm_source` | track | `context.campaign.source` | `utm_source` |
| `utm_medium` | track | `context.campaign.medium` | `utm_medium` |
| `utm_campaign` | track | `context.campaign.name` | `utm_campaign` |
| `utm_content` | track | `context.campaign.content` | `utm_content` |
| `utm_term` | track | `context.campaign.term` | `utm_term` |
| `utm_referring_domain` | identify | `traits.initial_referrer` AND `traits.initial_referring_domain` | both, dual-write |
| BQ `"How did you find out about this event?"` | identify + track | `traits.acquisition_source` / `properties.acquisition_source` | `acquisition_source` |
| BQ `"Who are you planning to attend with?"` | identify | `traits.attendees_with` | `attendees_with` |

**Dual-write rationale on referring_domain**: Jameson's existing Amplitude channel-classifier rules key off `initial_referrer (contains) facebook.com` etc. The Supabase column actually holds domains (`www.icelandeclipse.com`, `m.facebook.com`, `$direct`), not URLs. Sending under both `initial_referrer` (preserves classifier behavior) and `initial_referring_domain` (semantically correct, future-proofs for tools that expect it) covers both cases. Future implementations that capture full URLs can overwrite `initial_referrer` later — `(contains)` matches still work.

**UTM coverage** (informational, on 2,708 fever_orders):
- `utm_source` not null: 1860 (69%)
- `utm_campaign` not null: 1118 (41%)
- `booking_questions` not null: 1945
- HDYHAU answer present: 493

## Source of truth

- Replay: `src/lib/fever.ts` (transform) + `dashboard/scripts/replay-segment-historical.ts` (current bare implementation, no UTMs/BQ).
- Existing Amplitude cleanup attempt: `dashboard/scripts/cleanup-amplitude-fever-dupes.ts` is **insert_id-level and blocked** (Amplitude has no per-event deletion). Superseded by user-level deletion.
- Migrations: `012_fever_orders.sql` (base), `013_fever_utm_validated.sql` (UTM columns, validated_date).

## Work items

### 0. Scope notes

- Replay = ACTIVE order items only (matches existing script: `status === 'ACTIVE' || 'purchased'`). Cancellations are out of scope here; the existing `backfill-segment-cancellations.ts` handles that path separately.
- `Product Purchased` events are NOT explicitly emitted. Amplitude's Segment destination auto-expands a single `Order Completed` (with the `products` array) into one `Product Purchased` per product. Dedup of `Product Purchased` therefore comes for free once `Order Completed` is clean.
- "Plan ID" issue Jameson raised Apr 23 is already resolved (Mitch's Shuttle/Off-Site/ATOMIKA indexing fix, confirmed in-thread Apr 24). Out of scope.

### 1. Edit `dashboard/scripts/replay-segment-historical.ts`

- `identify` traits — add:
  - `initial_referrer` ← `order.utm_referring_domain`
  - `initial_referring_domain` ← `order.utm_referring_domain`
  - `acquisition_source` ← BQ answer where `question === "How did you find out about this event?"` (first answer)
  - `attendees_with` ← BQ answers where `question === "Who are you planning to attend with?"` (joined / array)
- `track('Order Completed')`:
  - Add `context.campaign: { name, source, medium, content, term }` from `utm_*` columns (only set keys with non-null values to avoid `(direct)` overwriting nulls).
  - Add `properties.acquisition_source` (per-event copy of HDYHAU).
- **`--amplitude-only` flag** (done Apr 29). Attaches `integrations: { All: false, 'Amplitude Fever': true }` to every Identify and Track call. Default-deny + explicit allow keyed on the destination's display name. Verified via the Segment Public API: the `Fever Pipeline` source has exactly two enabled destinations connected — `Customer.io Fever` (slug `actions-customerio`) and `Amplitude Fever` (slug `actions-amplitude`) — so allowlisting `Amplitude Fever` cleanly blocks the CIO destination. If destinations are renamed or added on this source, the toggle needs to be updated.
- **`--cohort <path>` flag** (done Apr 29). Filters orders to those with `buyer_email` in the cohort JSON.
- **`--identify-only` flag (Phase 1a, TODO)**. When set, the per-order loop fires Identify with the enriched traits but skips the `Order Completed` Track call. Used for the immediate enrichment-only pass that gives Jameson's channel attribution dashboard working data without touching the existing event history. Pair with `--amplitude-only`.
- **Identify timestamp policy for Phase 1a**: use `new Date()` (current wall clock), NOT `order.order_created_at`. Backdating an Identify to a months-old timestamp risks Amplitude treating it as a historical user-property revision. For Phase 1a we want the property update to be unambiguously "now". Phase 3 (delete + replay) keeps the original-timestamp behavior since it's reconstructing history end-to-end.

### 2. Script: `dashboard/scripts/cleanup-amplitude-delete.ts`

Two modes: snapshot (default) and delete. Inputs: cohort JSON file at `scripts/cohorts/<name>.json` shaped `{ name, description, emails }`.

- **Snapshot mode** (default): for each email in the cohort, hit `/api/2/usersearch` to find amplitude_id, then `/api/2/useractivity` (paginated) to dump every event. Writes two files to `/tmp/amp-cleanup-snapshots/<cohort>__<ts>.{json,events.jsonl}`. The summary JSON has aggregates (counts by event_type, OC by order_id, revenue sum, user_properties); the JSONL has every event with full payload, tagged with `_snapshot_email`. JSONL is the input to the restore step.
- **Delete mode** (`--delete` flag, default still dry-run, requires `--execute` to actually call): `POST https://amplitude.com/api/2/deletions/users` with `{ user_ids, requester, ignore_invalid_id: 'True', delete_from_org: 'False' }`. Batches of 100 (Amplitude limit). Logs to `/tmp/amp-cleanup-deletions/<cohort>__<ts>.json`.
- **Wait flag** (`--wait`, only meaningful with `--execute`): polls `GET https://amplitude.com/api/2/deletions/users?day=YYYY-MM-DD` every 30s until every cohort email shows status `DONE` (case-insensitive against `DONE`/`COMPLETED`/`COMPLETE`). 1h hard cap before throwing. Required between delete and replay so we don't fire new events to a doomed amplitude_id mid-deletion.
- Auth: `~/.claude/credentials/amplitude.json` Basic creds.
- No Customer.io code path (intentional, see Context).

### 3. Script: `dashboard/scripts/restore-amplitude-engagement.ts`

After delete + replay, restore the user's non-Fever Amplitude events from the snapshot JSONL. CIO's Amplitude integration is forward-sync only and will not backfill — without this step, historical email engagement (Email Sent / Delivered / Opened / etc.) under the new amplitude_id is gone.

- Reads the snapshot's `events.jsonl`. Filters out `Order Completed` and `Product Purchased` (the replay regenerates those).
- Re-fires every other event via Amplitude HTTP V2 API (`api2.amplitude.com/2/httpapi`) with original `time` (event_time → unix ms) and original `event_properties` / `user_properties`.
- `insert_id` is set to `restore-<original-$insert_id>` so re-runs are idempotent (Amplitude dedupes on insert_id within 7 days).
- Modes: dry-run (default), `--execute`.

### 4. Cohort selection

Cohort JSON files live at `dashboard/scripts/cohorts/<name>.json`. Hand-crafted for staged rollout.

- `n1-mckenzie.json` — initial pick (Slack reference); turned out to be a light-dupe case (2x), so superseded.
- `n1-lovaliantpoine.json` — heavy-dupe representative (274 OC / 548 PP / $1.2M revenue inflated for one $4.4k order). Used for actual N=1.

### 5. Execution sequence (staged)

Pre-run setup is per-phase. Phase 1a's pre-run (Apr 29 cron pause + Jameson campaign pause) was completed and reversed by May 4–6 (cron resumed commit `bdfd18d` May 4, campaigns re-enabled May 6 22:30 UTC). Phase 2 will repeat both pauses; see its own pre-flight checklist below.

#### Phase 1a — Identify-only enrichment ✅ COMPLETE (May 1, 2026, 20:07 UTC)

**Outcome**: 1,948 unique Fever buyers enriched in both CIO and Amplitude. Channel-attribution-relevant user properties (utm_*, initial_referrer + initial_referring_domain dual-write, acquisition_source from HDYHAU, attendees_with) populated where the buyer's first order in Supabase had source data.

**Scope**:
- 2,728 fever_orders rows iterated, 1,961 unique buyer_emails.
- 98 orders skipped (all items cancelled).
- 1,948 unique buyers identified (= the 1,961 minus ~13 buyers whose only order was fully cancelled).

**Delivery confirmation** (Segment Public API `delivery-overview/successful-delivery`, 20:00–21:00 UTC bucket):
- `Customer.io Fever`: 1,948 successful, 0 failed.
- `Amplitude Fever`: 1,948 successful, 0 failed.

**Spot-checks** (5 random buyers, all confirmed via CIO UI):
- Roman Range (`romanrange@hotmail.com`) — 2 attrs changed at 20:07:29 UTC. acquisition_source + attendees_with set.
- Lisa Lustgarten Payne (`llinbw@aol.com`) — 3 attrs changed. utm_source/initial_referrer/initial_referring_domain set. `marketing_opt_in: false` correctly preserved.
- Sam Smith (`samsmith8@bigpond.com`) — 4 attrs changed. utm_source + utm_medium + dual-write referrer.
- Nishant Patel (`de.nocte@gmail.com`) — 7 attrs changed (most enriched of the sample). Full UTM set including `utm_term=44139` (Hive SMS attribution).
- Anna Gibson (`annarngibson@gmail.com`) — 4 attrs changed. utm_source + utm_medium + dual-write referrer.

Variance per user reflects what each user's first order had populated in Supabase. First-touch model behaving correctly. `marketing_opt_in` deliberately not sent across the entire run; verified preserved on samples that had it set.

**Final runtime command**:
```
cd dashboard
npx tsx scripts/replay-segment-historical.ts --identify-only
```
(No `--cohort` to hit all buyers, no `--amplitude-only` because we want enrichment in both destinations. CIO dupes are unchanged because identify doesn't add events.)

**N=1 prior verification** (Apr 30, evening) used `--cohort scripts/cohorts/n1-lovaliantpoine.json`. Lovaliantpoine + Mckenzie (untouched control) shown to Jameson via CIO links; signed off May 1, 14:02 UTC.

**Per-cohort verification flow that worked**:
1. Snapshot (pre) — `cleanup-amplitude-delete.ts --cohort <path>` captured pre-state.
2. Dry-run — `replay-segment-historical.ts --dry-run --identify-only --cohort <path>`.
3. Execute — `replay-segment-historical.ts --identify-only --cohort <path>`.
4. Verify Segment delivery metrics for the time window.
5. Spot-check CIO profile via browser at `https://fly.customer.io/workspaces/213260/journeys/people/<cio_id>/attributes`. "Recent Attribute Changes" log confirms timestamps and count of changed attrs.

#### Phase 2 — CIO Order Completed dedupe (NOT YET RUN, decided May 7)

Going first, ahead of Phase 3. Triggered by Jon's May 7 review: Jameson's May 4 statement gating campaign re-enable on dedupe completion. Running it directly addresses CIO state; Phase 3 (Amplitude) follows separately for revenue accuracy.

**Approach decided after API audit (May 7)**:

- CIO is event-immutable by design. Per docs and direct API probing, no per-event delete endpoint exists (`DELETE /v1/customers/:id/activities/:id` → 404; `DELETE /v1/customers/:id/events/:id` → 404). Confirmed via [Customer.io community](https://community.customer.io/data-integrations-38/clearing-activity-log-326): *"You can't delete an event."*
- Only mechanism that affects events: delete-the-whole-customer (`DELETE /v1/customers/:cio_id`).
- Therefore: per-customer **delete-and-replay**, with full snapshot/restore of user-meaningful state.

**Cost/benefit posture (resolved May 7)**:

- Audited every segment in workspace 213260: 27 total, 7 reference Order Completed, **all 7 use `times: 1` (boolean "at least once")**. None count, none sum revenue, none use property aggregations. So segment-membership-wise the 41k dupes are inert; the cleanup is for revenue/goal-reporting hygiene + activity-feed cleanliness, not for behavioral impact.
- Campaign 1 (Post Purchase) has `scheduled_start_should_backfill: false` and `deduplicate_id: "1:1778106637"` (May 6 22:30 UTC re-enable timestamp). Replays with original (pre-May-6) Order Completed timestamps fall before the dedup cutoff and do NOT re-trigger journey enrollment.
- Jameson approved (Slack thread `1777294778.420899`, May 7 21:55 UTC), with explicit ask to pause campaigns first.

**Execution kit (everything a fresh Claude needs to start)**:

- **Working directory**: `/Users/jon/src/imxp/iceland/dashboard`. All scripts live under `scripts/`. Run via `npx tsx scripts/<name>.ts`. Existing precedents in the same dir use `dotenv` against `.env.local` — match that pattern.
- **CIO App API credential**: `~/.claude/credentials/customerio.json` field `app_api_key`. Auth: `Authorization: Bearer <app_api_key>`. Base URL: `https://api.customer.io/v1`. Region `us` (per credential file). Workspace ID: `213260`.
- **CIO event-write mechanism (the replay step)**: route via existing Segment infra rather than CIO Track API directly. The `replay-segment-historical.ts` script already supports `--amplitude-only` (skips CIO destination). Add a mirror `--cio-only` flag that sends `integrations: { All: false, 'Customer.io Fever': true }` so the replay lands only in CIO. Segment write key for the Fever Pipeline source is hardcoded in existing scripts: `ydbNbAikND8W7tzlfaQd1gJueaMBXfcJ`. This avoids needing a separate CIO Track API Site ID + Tracking API Key (we don't have those provisioned).
- **CIO destination slug for `integrations`** map: `Customer.io Fever`. Verified Apr 29 via Segment Public API. If destinations are renamed, this needs updating.
- **Supabase access**: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. Existing scripts have the boilerplate. Cohort source = `fever_orders` table.
- **Cron pause mechanism**: edit `dashboard/vercel.json` to remove the `fever-sync` entry, commit, push to main. Vercel picks up on next deploy. Reverse on post-flight. Precedent commits: pause `8254b48` (Apr 29), resume `bdfd18d` (May 4).
- **CIO campaign pause via API**: `PUT https://api.customer.io/v1/campaigns/:id` with body `{ "state": "draft" }` (verify exact field at runtime — the GET shape shows `state`, but the PUT contract may differ). Targets: campaigns `1` (Post Purchase) and `2` (Abandoned Browse). Leave campaign `4` (Utility) running. Reverse on post-flight.
- **Slack progress channel**: `#ie26-mktg-general` channel ID `C0A4RH5C6AW`. Progress updates and approval gates go in thread `1777294778.420899` (the McKenzie investigation thread; Jameson's Phase 2 approval lives there). Use the `slack-imxp` MCP `conversations_add_message` tool with `thread_ts: 1777294778.420899`.
- **CIO spot-check URL pattern**: `https://fly.customer.io/workspaces/213260/journeys/people/<cio_id>/attributes` and `.../activities`.

**Preserved (snapshot via App API → replay via Segment with `--cio-only`)**:

- All customer attributes (utm_*, marketing_opt_in, unsubscribed, language, names, custom fields)
- All activity events (engagement: Sent/Delivered/Opened/Clicked/Bounced; conversions; custom events)
- The earliest real `Order Completed` per `data.order_id` (one event per real Fever order; dupes discarded)
- Devices via `/v1/customers/:cio_id/devices`
- Workspace suppression list state (separate table keyed on email — survives delete automatically)
- Segment memberships (recompute from attrs + events post-recreate; informational snapshot only)

**Unavoidably lost on recreate** (acknowledged, accepted):

- `cio_id` changes — nothing in our infra pins this; we key on email
- CIO-internal computed deliverability/engagement scoring (ML-derived, rebuilds from replayed events over time)
- Frequency cap window state — recent-send history within cap window resets; bounded blast radius (next 24-72h could over-send to a hot user)
- Mid-flight queued deliveries — any email scheduled but not yet sent gets canceled. Mitigation: pre-flight check skips customers with pending sends in the next N hours.

**Pre-flight**:

1. **Pause CIO campaigns** (Jameson asked May 7 to do this via API since he's away from computer):
   - Campaign 1 — Post Purchase Campaign (running, event-triggered on Order Completed) → pause
   - Campaign 2 — Abandoned Browse (running, seg_attr) → pause
   - Campaign 4 — Utility Workflow Move Phone Number Property (running, seg_attr) → leave running (no order/replay touch)
   - Endpoint: `PUT /v1/campaigns/:id` with `state: "draft"` or use `/v1/campaigns/:id/triggers` toggle. Verify exact endpoint at run time.
2. **Pause `fever-sync` cron** by removing its entry from `dashboard/vercel.json` and pushing to main (precedent: commit `8254b48` Apr 29). Restore after.
3. **Identify cohort** (the polluted set): seed = `SELECT DISTINCT buyer_email FROM fever_orders` (~2k rows). Then for each, look up `cio_id` via `GET /v1/customers?email=<email>` and count Order Completed events via `GET /v1/customers/:cio_id/activities?type=event&name=Order%20Completed&limit=1` reading `meta.count` (or paginate to count). Compare to real Fever order count for that buyer (`SELECT COUNT(DISTINCT fever_order_id) FROM fever_orders WHERE buyer_email = ?` filtered to active items). Cohort = buyers where CIO count > real count. Write to `scripts/cohorts/cio-cleanup-full.json` shaped `{ name, description, members: [{email, cio_id, real_order_count, cio_oc_count, dupe_count}, ...] }`. Expect ~1948 (matches Phase 1a cohort, since same population) or fewer if some had no dupes.
4. **Active-deliveries pre-check**: for each cohort member, hit `GET /v1/customers/:cio_id/messages` filtered to scheduled-but-not-yet-sent (state field: queued/scheduled). Skip or defer customers with pending sends in next 6h.

**Per-customer protocol** (atomic, sequential):

1. **Snapshot** to JSONL files in `/tmp/cio-cleanup-snapshots/<cohort>__<ts>/`:
   - `attributes.json` from `GET /v1/customers/:cio_id/attributes?id_type=cio_id`
   - `activities.jsonl` from `GET /v1/customers/:cio_id/activities` (paginated, all event types)
   - `devices.json` from `GET /v1/customers/:cio_id/devices` (if any)
   - `messages.json` from `GET /v1/customers/:cio_id/messages` (informational; not replayable)
2. **Compute clean Order Completed list**: group `activities.jsonl` events where `name == "Order Completed"` by `data.order_id`, keep earliest `timestamp` per group, discard rest.
3. **Delete customer**: `DELETE /v1/customers/:cio_id` via App API (or alternately fire the "Delete Person" semantic Track event).
4. **Wait for delete confirmation** (poll until `GET /v1/customers?email=<email>` returns empty).
5. **Recreate via Identify** (Segment `analytics.identify` with `integrations: { All: false, 'Customer.io Fever': true }`) using the snapshotted attributes — preserves `unsubscribed`, `marketing_opt_in`, all UTM/referrer/HDYHAU traits. Use the buyer's email as the `userId`.
6. **Replay clean Order Completed events** via Segment `analytics.track` with the same cio-only `integrations` toggle, using **original timestamps** (pre-May-6 → blocked by Post Purchase dedup window → no re-enrollment). Original event payload preserved: `data.order_id`, `data.revenue`, `data.total`.
7. **Replay all non-Order-Completed activity events** via Segment `analytics.track` cio-only, with original timestamps. Engagement events (Sent/Delivered/Opened/Clicked) land as activity-feed entries. Note these will be activity-feed-only — they won't update CIO's internal deliverability scoring (acknowledged loss).
8. **Verify** (per-customer):
   - Customer exists: `GET /v1/customers?email=<email>` returns one result with new `cio_id`.
   - Attributes match snapshot: `GET /v1/customers/:cio_id/attributes` — diff against snapshot's `attributes.json`. All keys present, values equal. Special-case: `unsubscribed` and `marketing_opt_in` exact match.
   - Order Completed event count equals the deduplicated count (real_order_count from cohort): `GET /v1/customers/:cio_id/activities?type=event&name=Order%20Completed`. Should equal the customer's `real_order_count` field from cohort, NOT the original `cio_oc_count`.
   - Other-event count: `GET /v1/customers/:cio_id/activities` total ≈ snapshot count − dupe count. Allow small drift since some events are async-emitted.
   - Segment memberships: `GET /v1/customers/:cio_id/segments` should match snapshot list once dynamic segments recompute (may take minutes — recheck if not immediate). Manual-segment memberships need manual re-add (rare).

**Hard gates** — STOP and wait for explicit Jon approval at each. Do NOT auto-advance. Post status to Slack thread `1777294778.420899` (channel `C0A4RH5C6AW`) at each gate with what was done, what's next, and "holding for approval" wording.

**Read-after-write protocol — non-negotiable.** Every state-changing operation must be followed by a read that confirms the state actually changed. API success codes (200/204) are not enough; CIO and Vercel can both return success on no-op or async-pending ops. Specifically:

- After `PUT /v1/campaigns/:id` pause → `GET /v1/campaigns/:id`, assert `state == "draft"`. Repeat per campaign.
- After cron pause commit/push → check Vercel deployment status until the new deployment is live; do NOT proceed while the old (cron-running) deployment is still active.
- Before any destructive op on a cohort member: re-run the cohort scan for that member to confirm dupe count matches what was captured at cohort-build time. If diverged, abort and re-evaluate.
- Before any replay: re-fetch the Post Purchase campaign and assert `deduplicate_id` is still set with timestamp ≤ replay timestamps. If `deduplicate_id` is missing or its window has shifted, abort.
- After `DELETE /v1/customers/:cio_id` → poll `GET /v1/customers?email=<email>` every 5s for up to 60s, assert empty result before proceeding to recreate.
- After Identify (recreate) → poll `GET /v1/customers?email=<email>` every 5s for up to 60s, assert one result with new `cio_id` before firing any replay events.
- After each batch of replay events → spot-check via `GET /v1/customers/:cio_id/activities` that the batch's events appear (eventual consistency: retry up to 30s).
- After full per-customer flow → run the verification block end-to-end. Any mismatch = abort the loop, write to failures log, post to Slack.

**Gate A — Pre-prod-change** (no destructive ops yet):
- Write all three scripts (`cio-pause-campaigns`, `build-cio-cleanup-cohort`, `cleanup-cio-customer`).
- Verify the CIO campaign-pause endpoint shape via docs / a GET-only sanity probe — do NOT call PUT yet.
- Show Jon the diff of `vercel.json` for the cron pause (do NOT push yet).
- Show Jon the dry-run output of `cio-pause-campaigns` (what it would PUT).
- Show Jon the `integrations` map line that scopes replay to CIO only (literal string `Customer.io Fever`; misspelling = leak to Amplitude).
- Hold.

**Gate B — Pre-destructive** (campaigns + cron paused; cohort built; snapshot captured; canary verified):
- After Jon's Gate A OK: push the cron pause commit. Then call `cio-pause-campaigns --execute` to pause campaigns 1 and 2.
- Build the cohort via `build-cio-cleanup-cohort.ts`. Post cohort size + dupe distribution to Slack.
- Fire ONE canary `track` event via the cio-only Segment toggle to a test identifier (NOT a real customer). Verify in Segment delivery-overview that it landed in `Customer.io Fever` ONLY (zero Amplitude Fever delivery for the time bucket).
- Run `cleanup-cio-customer --cohort scripts/cohorts/n1-lovaliantpoine.json --snapshot-only`. Verify snapshot completeness: attribute count, activity event count, devices count, messages count. Post snapshot path + summary to Slack.
- Hold.

**Gate C — Destructive N=1** (lovaliantpoine only):
- After Jon's Gate B OK: run `cleanup-cio-customer --cohort scripts/cohorts/n1-lovaliantpoine.json --execute --max 1`.
- Run all verification queries (see "Verify" step in the per-customer protocol). Compute pre/post diff.
- Post spot-check links (CIO UI URLs for the cleaned customer) + diff summary to Slack.
- Hold.

**Gates D, E, F — N=10, N=100, full ~2k**:
- Each preceded by Jon approval of the previous gate.
- Same status-reporting pattern: cohort size, success count, failure count, sample customer link, "holding for approval".

**Failure handling**: if any cleanup-cio-customer invocation fails on a customer, abort the loop. Do NOT retry. Write the failed customer's snapshot path + failure detail to a failures log AND post to Slack. Manual recovery from snapshot only.

**Post-flight**:

- Resume `fever-sync` cron in `vercel.json`.
- Re-enable CIO campaigns 1 + 2 via API (or notify Jameson to flip in UI).
- Spot-check 5 random cleaned customers in CIO UI: Recent Attribute Changes, Activity Log Order Completed count, segment membership unchanged.

**Scripts (not yet written, write in this order)**:

1. `scripts/cio-pause-campaigns.ts` — first thing executed in pre-flight. Pauses campaigns `1` and `2` via `PUT /v1/campaigns/:id` body `{state: "draft"}`. Idempotent. `--resume` reverses (sets state back to `running`). Read-modify-write pattern: GET current state first, only PUT if state differs, log before/after.
2. `scripts/build-cio-cleanup-cohort.ts` — generates `scripts/cohorts/cio-cleanup-full.json` per the cohort spec above. Reads Supabase + CIO API. Writes JSON. Includes `--dry-run` (count only, no write). Slow-ish (~2k API calls); add basic concurrency (5-10 in flight) and progress logging.
3. `scripts/cleanup-cio-customer.ts` — main per-customer snapshot/delete/recreate/replay loop. Modes: `--cohort <path>` (required), `--snapshot-only` (just snapshot, don't delete — useful for pre-state CYA), `--execute` (full delete-and-replay), `--max <N>` (cap for staged rollout, e.g. `--max 1` for N=1, `--max 10` for N=10), `--skip-active` (default true, drop members with active deliveries in next 6h). Snapshots to `/tmp/cio-cleanup-snapshots/<cohort>__<iso-ts>/`. Delete log to `/tmp/cio-cleanup-deletions/<cohort>__<iso-ts>.jsonl`. Replay via Segment with `integrations: { All: false, 'Customer.io Fever': true }` (the cio-only equivalent of the existing `--amplitude-only` flag). Verification step inline; failures abort the loop and write to a `failures.jsonl` for review.

If the existing `replay-segment-historical.ts` doesn't have a `--cio-only` flag yet, mirror the `--amplitude-only` implementation (the one done Apr 29) — just swap the destination name in the `integrations` map. Or call Segment `analytics-node` directly inside `cleanup-cio-customer.ts` with the toggle inline; that may be cleaner since the per-event payload shape differs from the historical-replay shape.

#### Phase 3 — Amplitude delete + replay (NOT YET RUN, follows Phase 2)

Run after Phase 2 lands cleanly. Amplitude revenue is currently inflated to ~$50M vs. real $3.29M Supabase ground truth (15× pollution overall, 70× in April from cron bug). Goal: accurate Amplitude revenue + clean event history.

1. Submit a small batch deletion (start with one user, e.g. lovaliantpoine again). Use `cleanup-amplitude-delete.ts --cohort <path> --delete --execute --wait`.
2. Observe the time-to-`done`. If under a few hours: original delete + replay flow is viable; expand to staged cohorts using the existing scripts (snapshot → delete + wait → replay → restore engagement → verify).
3. If the deletion sits in `staging` for days as the docs warn: abandon delete + replay. Revenue accuracy comes from dashboard-side cutoff filters (e.g. "events after 2026-04-24 only").

#### Final cleanup (after both phases)

- Restore the `fever-sync` cron entry in `vercel.json` and push.
- Confirm CIO campaigns running, fever-sync cron running, all spot-checks green.

### 6. Verification

#### Phase 1a (identify-only)
- Amplitude user properties populated: `utm_source/medium/campaign/content/term`, `initial_referrer`, `initial_referring_domain`, `acquisition_source`, `attendees_with` where applicable.
- `initial_referrer` not regressed: any user who previously had a URL value (not a bare domain) keeps it.
- Channel classifier (Jameson's config at `app.amplitude.com/data/im-xp-123062/default/properties/main/latest/channel/12400`) classifies the test users into expected channels.
- CIO: **state unchanged**. No new identify events / profile updates for the cohort during the run. The `--amplitude-only` integrations toggle confirmed working.
- Amplitude `Order Completed` event counts unchanged (we didn't re-fire Track).

#### Phase 2 (CIO delete + replay)
- For each cleaned customer: `Order Completed` activity-feed event count = real Fever order count (one event per `data.order_id`).
- Customer attributes preserved bit-for-bit vs. snapshot (utm_*, marketing_opt_in, unsubscribed, language, names, custom fields).
- Suppression list state preserved (workspace-level, survives delete by design).
- Activity feed populated with all non-Order-Completed events from snapshot (engagement, custom). Activity feed event count = (snapshot count) − (dupe Order Completed count).
- Segment memberships at parity with pre-state (recompute automatically; verify on spot-check).
- Campaign 1 (Post Purchase) does NOT re-enroll cleaned customers (verified by dedup window covering replayed pre-May-6 timestamps).
- CIO-internal computed engagement scores reset on recreate (acknowledged loss; rebuilds over time).

#### Phase 3 (Amplitude delete + replay)
- Amplitude: `Order Completed` count = real Fever order count for each user. Revenue sum matches Supabase to the cent.
- Email engagement events (Email Sent / Delivered / Opened / etc.) restored from snapshot — count matches pre-state.
- CIO: state unchanged (this is the Amplitude-only flow via `--amplitude-only` Segment integrations toggle).

## Open items / followups

- **Segment tag on Fever event page**: Fever doesn't expose self-serve script injection per Jameson. He has a thread out with Fever; they're not responding. Mitch told Jameson to drive it. Not blocking this work.
- **Pre-Feb 2026 baseline duplication** (~2.3x from initial sync + Mar 26 replay) is intentionally left alone per `fever-cron-dedup-fix.md` — stable, non-growing, documented. The 2k-user delete in Phase 2 + Phase 3 will absorb that pollution naturally as a side effect on both CIO and Amplitude.

## Slack refs

- Thread `1776962839.010189` — UTM enrichment ask, Segment-tag-on-Fever discussion.
- Thread `1777294778.420899` — McKenzie investigation, CIO cleanup plan, dual-write resolution, May 7 Phase-2 approval.
- Channel: `#ie26-mktg-general` (`C0A4RH5C6AW`).
- Phase 2 approval: Jameson `1778190905.001719` (May 7 21:55 UTC) — "good to go, pause campaigns first."
