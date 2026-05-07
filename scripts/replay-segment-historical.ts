/**
 * Historical replay: sends Fever orders through Segment.
 * Uses original timestamps to preserve event ordering.
 *
 * Identify (first-touch, once per buyer) carries:
 *   - basic buyer traits
 *   - initial_referrer + initial_referring_domain (dual-write of utm_referring_domain;
 *     see context/plans/fever-cleanup-replay-enrichment.md for rationale)
 *   - acquisition_source (booking question "How did you find out about this event?")
 *   - attendees_with (booking question "Who are you planning to attend with?")
 *
 * Track Order Completed carries:
 *   - context.campaign.{name, source, medium, content, term} from utm_*
 *   - properties.acquisition_source per-event
 *
 * Flags:
 *   --dry-run            iterate orders, print stats, send nothing
 *   --amplitude-only     route Segment events to Amplitude only (skip Customer.io
 *                        destination via integrations toggle). Use during cleanup
 *                        runs to keep CIO state stable.
 *   --cohort <path>      JSON file shaped { "emails": [...] }; only orders whose
 *                        buyer_email is in the list will be replayed.
 *   --identify-only      Phase 1a: send only Identify (no Order Completed Track).
 *                        Identifies use CURRENT timestamp (not the order's), so
 *                        Amplitude treats the trait update as "now" rather than
 *                        a backdated history revision. Pair with --amplitude-only
 *                        to enrich Amplitude user properties without touching
 *                        CIO or adding to existing event-stream pollution.
 *
 * Usage:
 *   npx tsx scripts/replay-segment-historical.ts
 *   npx tsx scripts/replay-segment-historical.ts --dry-run
 *   npx tsx scripts/replay-segment-historical.ts --amplitude-only --cohort /tmp/cohort.json
 *   npx tsx scripts/replay-segment-historical.ts --identify-only --amplitude-only --cohort /tmp/cohort.json
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { Analytics } from '@segment/analytics-node';

const SEGMENT_WRITE_KEY = 'ydbNbAikND8W7tzlfaQd1gJueaMBXfcJ';
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const AMPLITUDE_ONLY = args.includes('--amplitude-only');
const IDENTIFY_ONLY = args.includes('--identify-only');
const COHORT_PATH = (() => {
  const i = args.indexOf('--cohort');
  return i >= 0 ? args[i + 1] : undefined;
})();
const BATCH_SIZE = 100;

// integrations toggle: when --amplitude-only, route Segment events to the
// Amplitude Fever destination only and skip everything else (including
// Customer.io Fever). Default-deny via All: false, then explicit allow.
//
// The destination names below are the display names in the IMXP Segment
// workspace, verified Apr 29 via the Segment Public API (see plan doc). The
// Fever Pipeline source has exactly two enabled destinations:
//   - "Customer.io Fever" (slug actions-customerio) — blocked here
//   - "Amplitude Fever"   (slug actions-amplitude)  — allowed here
// If a destination is added/renamed, this toggle needs to be updated.
const INTEGRATIONS = AMPLITUDE_ONLY
  ? { All: false, 'Amplitude Fever': true }
  : undefined;

function loadCohort(path: string): Set<string> {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const emails: string[] = Array.isArray(raw) ? raw : raw.emails;
  if (!Array.isArray(emails) || emails.length === 0) {
    throw new Error(`Cohort file ${path} must be { emails: [...] } or [...] with at least one email`);
  }
  return new Set(emails.map(e => e.toLowerCase()));
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function createSegmentClient(): Analytics {
  return new Analytics({ writeKey: SEGMENT_WRITE_KEY, maxEventsInBatch: 15 });
}

type BookingQuestion = { question?: string; answers?: string[] };

function getBookingAnswers(bq: unknown, questionText: string): string[] | undefined {
  if (!Array.isArray(bq)) return undefined;
  const match = (bq as BookingQuestion[]).find(q => q?.question === questionText);
  if (!match || !Array.isArray(match.answers) || match.answers.length === 0) return undefined;
  return match.answers;
}

// Segment Node SDK types Campaign with required name/source/medium, but the wire
// format is partial-tolerant — all UTM fields are optional. Cast at the boundary.
function buildCampaign(order: any): import('@segment/analytics-core').Campaign | undefined {
  const c: Record<string, string> = {};
  if (order.utm_source)   c.source  = order.utm_source;
  if (order.utm_medium)   c.medium  = order.utm_medium;
  if (order.utm_campaign) c.name    = order.utm_campaign;
  if (order.utm_content)  c.content = order.utm_content;
  if (order.utm_term)     c.term    = order.utm_term;
  if (Object.keys(c).length === 0) return undefined;
  return c as unknown as import('@segment/analytics-core').Campaign;
}

async function main() {
  if (DRY_RUN) console.log('=== DRY RUN (no events will be sent) ===');
  if (AMPLITUDE_ONLY) console.log('=== AMPLITUDE-ONLY mode: Customer.io destination skipped ===');
  if (IDENTIFY_ONLY) console.log('=== IDENTIFY-ONLY mode: skipping Order Completed Track, identify timestamp = now ===');
  if (COHORT_PATH) console.log(`=== COHORT mode: filtering to ${COHORT_PATH} ===`);
  console.log();

  const cohort = COHORT_PATH ? loadCohort(COHORT_PATH) : undefined;
  if (cohort) console.log(`Cohort size: ${cohort.size} emails`);

  let client = DRY_RUN ? null : createSegmentClient();

  let countQuery = supabase
    .from('fever_orders')
    .select('*', { count: 'exact', head: true })
    .not('buyer_email', 'is', null);
  if (cohort) countQuery = countQuery.in('buyer_email', Array.from(cohort));
  const { count } = await countQuery;

  console.log(`Total orders to replay: ${count}`);

  let offset = 0;
  let sent = 0;
  let skipped = 0;
  let errors = 0;
  const seenEmails = new Set<string>();

  while (offset < (count ?? 0)) {
    let q = supabase
      .from('fever_orders')
      .select('*')
      .not('buyer_email', 'is', null)
      .order('order_created_at', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);
    if (cohort) q = q.in('buyer_email', Array.from(cohort));
    const { data: orders, error } = await q;

    if (error) {
      console.error(`Error fetching orders at offset ${offset}:`, error.message);
      errors++;
      break;
    }

    if (!orders || orders.length === 0) break;

    const orderIds = orders.map((o: any) => o.fever_order_id);
    const { data: allItems } = await supabase
      .from('fever_order_items')
      .select('*')
      .in('fever_order_id', orderIds);

    const itemsByOrder = new Map<string, any[]>();
    for (const item of (allItems ?? [])) {
      const list = itemsByOrder.get(item.fever_order_id) ?? [];
      list.push(item);
      itemsByOrder.set(item.fever_order_id, list);
    }

    for (const order of orders) {
      const userId = order.buyer_email;
      const items = itemsByOrder.get(order.fever_order_id) ?? [];
      const activeItems = items.filter((i: any) => i.status === 'ACTIVE' || i.status === 'purchased');

      if (activeItems.length === 0) {
        skipped++;
        continue;
      }

      const ts = order.order_created_at ? new Date(order.order_created_at) : undefined;

      if (!DRY_RUN && client) {
        const hdyhau = getBookingAnswers(order.booking_questions, 'How did you find out about this event?')?.[0];
        const attendeesWith = getBookingAnswers(order.booking_questions, 'Who are you planning to attend with?');
        const campaign = buildCampaign(order);

        if (!seenEmails.has(userId)) {
          // First-touch identify: capture user's first observed UTMs/HDYHAU.
          // initial_referrer dual-write (per Jameson, Apr 29): Amplitude channel
          // classifier rules key off initial_referrer with (contains) operators
          // expecting domain strings. initial_referring_domain populated for
          // future tools and for any implementation that captures real URLs.
          //
          // Timestamp policy:
          //   --identify-only (Phase 1a) → use NOW. Backdating an identify call
          //     to a months-old order timestamp risks Amplitude treating it as
          //     a historical user-property revision. Phase 1a wants the update
          //     to be unambiguously "now".
          //   default (Phase 1b delete + replay) → use the order's timestamp,
          //     since we're reconstructing user history end-to-end.
          const identifyTimestamp = IDENTIFY_ONLY ? new Date() : ts;
          // marketing_opt_in intentionally NOT sent: Supabase has the at-purchase
          // value, but users may have unsubscribed since via CIO. Sending the
          // stale Supabase value could re-opt-in unsubscribed users (compliance
          // risk). CIO/Amplitude already have the correct current value from
          // their own flows.
          //
          // utm_* sent as identify traits (in addition to context.campaign on
          // track calls) so they land as user properties even on identify-only
          // runs. Per Jameson's Apr 23 spec: "send all the UTMs from the Fever
          // orders table with the Order Completed/Identify calls from Fever".
          client.identify({
            userId,
            traits: {
              email: order.buyer_email,
              first_name: order.buyer_first_name,
              last_name: order.buyer_last_name,
              birthday: order.buyer_dob,
              language: order.buyer_language,
              ...(order.utm_source   ? { utm_source:   order.utm_source }   : {}),
              ...(order.utm_medium   ? { utm_medium:   order.utm_medium }   : {}),
              ...(order.utm_campaign ? { utm_campaign: order.utm_campaign } : {}),
              ...(order.utm_content  ? { utm_content:  order.utm_content }  : {}),
              ...(order.utm_term     ? { utm_term:     order.utm_term }     : {}),
              ...(order.utm_referring_domain ? {
                initial_referrer: order.utm_referring_domain,
                initial_referring_domain: order.utm_referring_domain,
              } : {}),
              ...(hdyhau ? { acquisition_source: hdyhau } : {}),
              ...(attendeesWith ? { attendees_with: attendeesWith } : {}),
            },
            timestamp: identifyTimestamp,
            ...(INTEGRATIONS ? { integrations: INTEGRATIONS } : {}),
          });
          seenEmails.add(userId);
        }

        if (IDENTIFY_ONLY) {
          sent++;
          continue;
        }

        const revenue = activeItems.reduce((sum: number, i: any) => sum + (i.unitary_price ?? 0), 0);
        const discount = activeItems.reduce((sum: number, i: any) => sum + (i.discount ?? 0), 0);
        const surcharge = activeItems.reduce((sum: number, i: any) => sum + (i.surcharge ?? 0), 0);
        const total = revenue + surcharge + (order.surcharge ?? 0) - discount;

        const products = activeItems.map((item: any) => ({
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
            ...(hdyhau ? { acquisition_source: hdyhau } : {}),
          },
          ...(campaign ? { context: { campaign } } : {}),
          timestamp: ts,
          ...(INTEGRATIONS ? { integrations: INTEGRATIONS } : {}),
        });
      }

      sent++;
    }

    offset += orders.length;

    // Flush and recreate client every batch to avoid buffer buildup
    if (!DRY_RUN && client) {
      await client.closeAndFlush({ timeout: 10000 });
      client = createSegmentClient();
    }

    const pct = Math.round((offset / (count ?? 1)) * 100);
    console.log(`  ${offset}/${count} orders processed (${pct}%) | ${sent} sent, ${skipped} skipped, ${seenEmails.size} unique buyers`);
  }

  // Final flush for any remaining events
  if (!DRY_RUN && client) {
    console.log('\nFinal flush...');
    await client.closeAndFlush({ timeout: 15000 });
  }

  console.log(`\nDone.`);
  console.log(`  Orders sent: ${sent}`);
  console.log(`  Orders skipped (no active items): ${skipped}`);
  console.log(`  Unique buyers (MTUs): ${seenEmails.size}`);
  if (errors > 0) console.log(`  Errors: ${errors}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
