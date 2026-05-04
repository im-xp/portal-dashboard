import { Analytics } from '@segment/analytics-node';
import { Campaign } from '@segment/analytics-core';
import { FeverOrder, FeverOrderItem } from './fever';

const WRITE_KEY = process.env.SEGMENT_WRITE_KEY;

let _client: Analytics | null = null;

function getClient(): Analytics | null {
  if (!WRITE_KEY) return null;
  if (!_client) {
    _client = new Analytics({ writeKey: WRITE_KEY, maxEventsInBatch: 15 });
  }
  return _client;
}

function resolveUserId(order: FeverOrder, items: FeverOrderItem[]): string | null {
  if (order.buyerEmail) return order.buyerEmail;
  const ownerEmail = items.find((i) => i.ownerEmail)?.ownerEmail;
  return ownerEmail ?? null;
}

type BookingQuestion = { question?: string; answers?: string[] };

function getBookingAnswers(bq: unknown, questionText: string): string[] | undefined {
  if (!Array.isArray(bq)) return undefined;
  const match = (bq as BookingQuestion[]).find((q) => q?.question === questionText);
  if (!match || !Array.isArray(match.answers) || match.answers.length === 0) return undefined;
  return match.answers;
}

// Segment Node SDK types Campaign with required name/source/medium, but the wire
// format is partial-tolerant. Cast at the boundary. Mirrors the helper in
// scripts/replay-segment-historical.ts; see context/plans/fever-cleanup-replay-enrichment.md.
function buildCampaign(order: FeverOrder): Campaign | undefined {
  const c: Record<string, string> = {};
  if (order.utmSource) c.source = order.utmSource;
  if (order.utmMedium) c.medium = order.utmMedium;
  if (order.utmCampaign) c.name = order.utmCampaign;
  if (order.utmContent) c.content = order.utmContent;
  if (order.utmTerm) c.term = order.utmTerm;
  if (Object.keys(c).length === 0) return undefined;
  return c as unknown as Campaign;
}

/**
 * Pure function: build the identify trait payload for a Fever order.
 *
 * `firstTouchReferringDomain` controls whether `initial_referrer` /
 * `initial_referring_domain` appear in the payload. Pass the value when the
 * caller has determined this order is the buyer's first-observed
 * non-null `utm_referring_domain` (i.e., this IS the canonical first-touch).
 * Pass `null`/`undefined` on every other call so initial_* is omitted from
 * the payload entirely — never overwriting an existing value.
 *
 * `referrer` / `referring_domain` are always written from the CURRENT order
 * (when non-null). With Amplitude/CIO honoring event timestamps, they
 * resolve to last-touch by event time.
 *
 * Per Jameson's May 4 spec: initial_referrer is set once on first observation
 * and never overwritten; subsequent updates land on referrer.
 *
 * Marketing_opt_in intentionally NOT sent: Supabase has the at-purchase
 * value, but users may have unsubscribed via CIO since. Sending the stale
 * value would re-opt-in unsubscribed users (compliance risk).
 *
 * Exported as a pure function so the trait shape can be unit-tested without
 * touching network or mocks. See scripts/test-segment-traits.ts.
 */
export function buildIdentifyTraits(
  order: FeverOrder,
  firstTouchReferringDomain?: string | null
): Record<string, unknown> {
  const hdyhau = getBookingAnswers(order.bookingQuestions, 'How did you find out about this event?')?.[0];
  const attendeesWith = getBookingAnswers(order.bookingQuestions, 'Who are you planning to attend with?');

  return {
    email: order.buyerEmail,
    first_name: order.buyerFirstName,
    last_name: order.buyerLastName,
    birthday: order.buyerDob,
    language: order.buyerLanguage,
    ...(order.utmSource ? { utm_source: order.utmSource } : {}),
    ...(order.utmMedium ? { utm_medium: order.utmMedium } : {}),
    ...(order.utmCampaign ? { utm_campaign: order.utmCampaign } : {}),
    ...(order.utmContent ? { utm_content: order.utmContent } : {}),
    ...(order.utmTerm ? { utm_term: order.utmTerm } : {}),
    ...(firstTouchReferringDomain
      ? {
          initial_referrer: firstTouchReferringDomain,
          initial_referring_domain: firstTouchReferringDomain,
        }
      : {}),
    ...(order.utmReferringDomain
      ? {
          referrer: order.utmReferringDomain,
          referring_domain: order.utmReferringDomain,
        }
      : {}),
    ...(hdyhau ? { acquisition_source: hdyhau } : {}),
    ...(attendeesWith ? { attendees_with: attendeesWith } : {}),
  };
}

/**
 * Fire identify with enriched traits via the configured Segment client.
 * Thin wrapper around buildIdentifyTraits + client.identify.
 *
 * Mirrors the trait set in scripts/replay-segment-historical.ts. Keep both
 * in sync. See context/plans/fever-cleanup-replay-enrichment.md.
 */
export function identifyBuyer(
  order: FeverOrder,
  items: FeverOrderItem[],
  firstTouchReferringDomain?: string | null
): void {
  const client = getClient();
  if (!client) return;

  const userId = resolveUserId(order, items);
  if (!userId) return;

  client.identify({
    userId,
    traits: buildIdentifyTraits(order, firstTouchReferringDomain),
    timestamp: order.orderCreatedAt ?? undefined,
  });
}

export function trackOrderCompleted(order: FeverOrder, items: FeverOrderItem[]): void {
  const client = getClient();
  if (!client) return;

  const userId = resolveUserId(order, items);
  if (!userId) return;

  const purchasedItems = items.filter((i) => i.status === 'ACTIVE' || i.status === 'purchased');

  const revenue = purchasedItems.reduce((sum, i) => sum + (i.unitaryPrice ?? 0), 0);
  const discount = purchasedItems.reduce((sum, i) => sum + (i.discount ?? 0), 0);
  const surcharge = purchasedItems.reduce((sum, i) => sum + (i.surcharge ?? 0), 0);
  const total = revenue + surcharge + (order.surcharge ?? 0) - discount;

  const products = purchasedItems.map((item) => ({
    product_id: item.sessionId,
    sku: item.feverItemId,
    name: item.sessionName,
    category: order.planName,
    price: item.unitaryPrice ?? 0,
    quantity: 1,
    variant: item.sessionIsAddon ? 'addon' : 'ticket',
  }));

  const campaign = buildCampaign(order);
  const hdyhau = getBookingAnswers(order.bookingQuestions, 'How did you find out about this event?')?.[0];

  client.track({
    userId,
    event: 'Order Completed',
    properties: {
      order_id: `fever_${order.feverOrderId}`,
      affiliation: 'Fever',
      total,
      revenue,
      discount,
      coupon: order.couponCode,
      currency: order.currency ?? 'USD',
      products,
      ...(hdyhau ? { acquisition_source: hdyhau } : {}),
    },
    ...(campaign ? { context: { campaign } } : {}),
    timestamp: order.orderCreatedAt ?? undefined,
  });
}

export function trackOrderCancelled(order: FeverOrder, items: FeverOrderItem[]): void {
  const client = getClient();
  if (!client) return;

  const userId = resolveUserId(order, items);
  if (!userId) return;

  const cancelledItems = items.filter((i) => i.status === 'CANCELLED');
  if (cancelledItems.length === 0) return;

  const event = cancelledItems.some((i) => i.cancellationType === 'REFUND')
    ? 'Order Refunded'
    : 'Order Cancelled';

  const products = cancelledItems.map((item) => ({
    product_id: item.sessionId,
    sku: item.feverItemId,
    name: item.sessionName,
    category: order.planName,
    price: item.unitaryPrice ?? 0,
    quantity: 1,
  }));

  client.track({
    userId,
    event,
    properties: {
      order_id: `fever_${order.feverOrderId}`,
      products,
    },
    timestamp: cancelledItems[0].cancellationDate ?? undefined,
  });
}

export async function flushSegment(): Promise<void> {
  const client = getClient();
  if (!client) return;
  try {
    await client.closeAndFlush({ timeout: 5000 });
    _client = null;
  } catch (err) {
    console.error('[Segment] Flush failed:', err);
    _client = null;
  }
}
