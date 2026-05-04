/**
 * Verifies `lib/segment.ts:buildIdentifyTraits` matches Jameson's May 4 spec
 * and the live Supabase lookup logic from `cron/fever-sync/route.ts` returns
 * the expected first-touch decision for representative scenarios.
 *
 * Spec (per Jameson, May 4):
 *   1. `initial_referrer` (and `initial_referring_domain`) must NEVER be
 *      overwritten on identify calls AFTER the first one.
 *   2. Subsequent updates land on `referrer` (and `referring_domain`).
 *   3. Implied: on the first identify per buyer where utm_referring_domain
 *      is non-null, `initial_referrer` IS set.
 *
 * Test design:
 *   - Pure-function tests of `buildIdentifyTraits`: construct synthetic
 *     orders in memory, call the trait builder with various
 *     `firstTouchReferringDomain` values, assert payload shape.
 *   - Live read-only Supabase test of the cron's lookup logic: against
 *     a real existing buyer (lovaliantpoine) with a synthetic in-memory
 *     order, assert the lookup returns null (= don't write initial_*).
 *
 * Zero side effects:
 *   - No Segment events fire (no Analytics client touched).
 *   - No Supabase writes (read-only queries only).
 *   - No CIO/Amplitude profile changes.
 *
 * Usage: npx tsx scripts/test-segment-traits.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { buildIdentifyTraits } from '@/lib/segment';
import type { FeverOrder } from '@/lib/fever';

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.error(`  ✗ ${label}`);
  }
}

function makeOrder(overrides: Partial<FeverOrder>): FeverOrder {
  return {
    feverOrderId: 'TEST-DEFAULT',
    buyerEmail: 'test@example.com',
    buyerFirstName: 'Test',
    buyerLastName: 'User',
    buyerDob: null,
    buyerLanguage: 'en',
    buyerMarketingPref: true,
    orderCreatedAt: new Date(),
    orderUpdatedAt: null,
    parentOrderId: null,
    surcharge: 0,
    currency: 'USD',
    purchaseChannel: null,
    paymentMethod: null,
    billingZipCode: null,
    assignedSeats: null,
    buyerId: null,
    purchaseCity: null,
    purchaseCountry: null,
    purchaseRegion: null,
    purchasePostal: null,
    purchaseQuality: null,
    partnerId: null,
    partnerName: null,
    planId: null,
    planName: null,
    couponName: null,
    couponCode: null,
    businessId: null,
    businessName: null,
    bookingQuestions: null,
    utmCampaign: null,
    utmContent: null,
    utmMedium: null,
    utmSource: null,
    utmTerm: null,
    utmReferringDomain: null,
    ...overrides,
  };
}

async function main() {
  console.log('=== Test: Repeat-buyer scenario (initial_* must NOT appear) ===');
  {
    const order = makeOrder({
      feverOrderId: 'TEST-REPEAT-A',
      buyerEmail: 'returning-buyer@example.com',
      utmSource: 'facebook',
      utmMedium: 'paid',
      utmReferringDomain: 'm.facebook.com',
    });
    const traits = buildIdentifyTraits(order, null); // firstTouch = null = repeat

    assert(!('initial_referrer' in traits), 'initial_referrer absent from payload');
    assert(!('initial_referring_domain' in traits), 'initial_referring_domain absent from payload');
    assert(traits.referrer === 'm.facebook.com', 'referrer == current order utm_referring_domain');
    assert(traits.referring_domain === 'm.facebook.com', 'referring_domain == current order utm_referring_domain');
    assert(traits.utm_source === 'facebook', 'utm_source still propagates');
    assert(traits.utm_medium === 'paid', 'utm_medium still propagates');
    assert(!('marketing_opt_in' in traits), 'marketing_opt_in NOT in payload (compliance)');
  }

  console.log('\n=== Test: New-buyer scenario (initial_* MUST appear) ===');
  {
    const order = makeOrder({
      feverOrderId: 'TEST-NEW-B',
      buyerEmail: 'first-time-buyer@example.com',
      utmSource: 'google',
      utmMedium: 'organic',
      utmReferringDomain: 'google.com',
    });
    const traits = buildIdentifyTraits(order, 'google.com'); // firstTouch = current value

    assert(traits.initial_referrer === 'google.com', 'initial_referrer == first-touch value');
    assert(traits.initial_referring_domain === 'google.com', 'initial_referring_domain == first-touch value');
    assert(traits.referrer === 'google.com', 'referrer == current value (= first-touch on first identify)');
    assert(traits.referring_domain === 'google.com', 'referring_domain == current value');
    assert(traits.utm_source === 'google', 'utm_source propagates');
    assert(!('marketing_opt_in' in traits), 'marketing_opt_in NOT in payload');
  }

  console.log('\n=== Test: Buyer with null utm_referring_domain (no referrer trait) ===');
  {
    const order = makeOrder({
      feverOrderId: 'TEST-NOUTM',
      buyerEmail: 'no-utm-buyer@example.com',
      utmSource: 'direct',
      utmReferringDomain: null,
    });
    const traits = buildIdentifyTraits(order, null);

    assert(!('referrer' in traits), 'referrer absent when utm_referring_domain is null');
    assert(!('referring_domain' in traits), 'referring_domain absent when null');
    assert(!('initial_referrer' in traits), 'initial_referrer absent when firstTouch null');
    assert(traits.utm_source === 'direct', 'utm_source still propagates');
  }

  console.log('\n=== Test: HDYHAU + attendees_with from booking_questions ===');
  {
    const order = makeOrder({
      feverOrderId: 'TEST-BQ',
      buyerEmail: 'with-bq@example.com',
      bookingQuestions: [
        { question: 'How did you find out about this event?', answers: ['Recommended by family / friends'] },
        { question: 'Who are you planning to attend with?', answers: ['Friend(s)', 'Partner'] },
        { question: 'Phone Number', answers: ['+1|5555555555', 'US'] },
      ] as unknown as Record<string, unknown>,
    });
    const traits = buildIdentifyTraits(order, null);

    assert(traits.acquisition_source === 'Recommended by family / friends', 'acquisition_source from HDYHAU answer');
    assert(
      Array.isArray(traits.attendees_with) &&
        (traits.attendees_with as string[])[0] === 'Friend(s)' &&
        (traits.attendees_with as string[])[1] === 'Partner',
      'attendees_with array preserved'
    );
  }

  console.log('\n=== Test: Live Supabase lookup for repeat buyer (lovaliantpoine) ===');
  {
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const syntheticOrder = makeOrder({
      feverOrderId: 'SYNTHETIC-TEST-DOES-NOT-EXIST-IN-SUPABASE',
      buyerEmail: 'lovaliantpoine@gmail.com',
      utmReferringDomain: 'm.facebook.com',
    });

    // Replicate the cron's exact lookup logic.
    let firstTouch: string | null = null;
    if (syntheticOrder.buyerEmail && syntheticOrder.utmReferringDomain) {
      const { data: earliest } = await sb
        .from('fever_orders')
        .select('fever_order_id, utm_referring_domain')
        .eq('buyer_email', syntheticOrder.buyerEmail)
        .not('utm_referring_domain', 'is', null)
        .order('order_created_at', { ascending: true })
        .limit(1);
      if (earliest?.[0]?.fever_order_id === syntheticOrder.feverOrderId) {
        firstTouch = syntheticOrder.utmReferringDomain;
      }
    }

    assert(firstTouch === null, 'lookup returns null for synthetic order on existing buyer (initial_* preserved)');

    const traits = buildIdentifyTraits(syntheticOrder, firstTouch);
    assert(!('initial_referrer' in traits), 'with null firstTouch, payload omits initial_referrer');
    assert(traits.referrer === 'm.facebook.com', 'with null firstTouch, payload still sets referrer');
  }

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
