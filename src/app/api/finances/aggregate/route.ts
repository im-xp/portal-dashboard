import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getDashboardData, getApplicationPopupMap } from '@/lib/nocodb';
import type { StripeAccountKey } from '@/lib/stripe';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Canonical financials aggregate consumed by mvp/portal-viz's /financials page.
// This endpoint is the single source of truth: EdgeOS approved payments (NocoDB),
// Fever purchased items net of discount (Supabase), and Stripe succeeded charges
// (Supabase) with EdgeOS dedup. Bearer-auth via INTERNAL_API_SECRET so server-side
// callers can hit it without a user session.

interface FeverItemRow {
  fever_order_id: string;
  unitary_price: number | null;
  surcharge: number | null;
  discount: number | null;
  purchase_date: string | null;
}

interface FeverOrderRow {
  fever_order_id: string;
  order_created_at: string | null;
  plan_name: string | null;
  buyer_first_name: string | null;
  buyer_last_name: string | null;
}

interface StripeChargeRow {
  id: string;
  account_key: StripeAccountKey;
  amount_cents: number;
  amount_refunded_cents: number;
  created_at: string;
}

// Same scoping as /api/stripe — Portal dedups against popups 1/2/3 of EdgeOS;
// Iceland Stripe is dedicated and not recorded in EdgeOS, so no dedup.
const STRIPE_DEDUP_SCOPE: Record<StripeAccountKey, number[]> = {
  portal: [1, 2, 3],
  iceland: [],
};

const CATEGORY_LABELS: Record<string, string> = {
  lodging: 'Lodging',
  month: 'Portal Pass',
  week: 'Week Pass',
  day: 'Day Pass',
  workshop: 'Workshops',
  food: 'Food & Bev',
  ticket: 'Eclipse Ticket',
  stripe: 'Stripe Direct',
  other: 'Other',
};

function labelForCategory(key: string): string {
  return CATEGORY_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

interface NormalizedTxn {
  id: string;
  source: 'edgeos' | 'fever' | 'stripe';
  memberId: string;
  amount: number;
  status: string | null;
  category: string;
  label: string;
  createdAt: string;
}

async function fetchAllFeverItems(): Promise<FeverItemRow[]> {
  if (!supabase) return [];
  const PAGE_SIZE = 1000;
  const out: FeverItemRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('fever_order_items')
      .select('fever_order_id,unitary_price,surcharge,discount,purchase_date')
      .eq('status', 'purchased')
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`supabase fever_order_items: ${error.message}`);
    const batch = (data ?? []) as FeverItemRow[];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return out;
}

async function fetchAllFeverOrders(): Promise<FeverOrderRow[]> {
  if (!supabase) return [];
  const PAGE_SIZE = 1000;
  const out: FeverOrderRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('fever_orders')
      .select('fever_order_id,order_created_at,plan_name,buyer_first_name,buyer_last_name')
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`supabase fever_orders: ${error.message}`);
    const batch = (data ?? []) as FeverOrderRow[];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return out;
}

async function fetchAllStripeCharges(): Promise<StripeChargeRow[]> {
  if (!supabase) return [];
  const PAGE_SIZE = 1000;
  const out: StripeChargeRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('stripe_charges')
      .select('id,account_key,amount_cents,amount_refunded_cents,created_at')
      .eq('status', 'succeeded')
      .eq('refunded', false)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`supabase stripe_charges: ${error.message}`);
    const batch = (data ?? []) as StripeChargeRow[];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return out;
}

export async function GET(request: NextRequest) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'INTERNAL_API_SECRET not configured' },
      { status: 503 },
    );
  }
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // NocoDB is rate-limited on concurrent calls. getDashboardData() is
    // serialized + cached internally; pull EdgeOS data through that.
    // getApplicationPopupMap() is a small separate call used only for Stripe
    // dedup — if it fails we still return aggregate without dedup.
    const [dashboard, feverOrders, feverItems, charges] = await Promise.all([
      getDashboardData(),
      fetchAllFeverOrders(),
      fetchAllFeverItems(),
      fetchAllStripeCharges(),
    ]);
    const popupByAppId = await getApplicationPopupMap().catch(() => new Map<number, number>());

    const payments = dashboard.payments; // PaymentWithProducts[] — paymentProducts already joined

    const txns: NormalizedTxn[] = [];
    const categoryMap = new Map<string, { key: string; label: string; amount: number; count: number }>();
    const buyerKeys = new Set<string>();

    // -- EdgeOS (NocoDB) --
    // (amount, date) index per popup for Stripe dedup against EdgeOS approved payments.
    const edgeosIndexByPopup = new Map<number, Set<string>>();

    let edgeosRevenue = 0;
    for (const p of payments) {
      if (p.status !== 'approved') continue;
      const amount = Number(p.amount ?? 0);
      if (!amount) continue;
      const createdAt = p.created_at;
      if (!createdAt) continue;

      edgeosRevenue += amount;
      buyerKeys.add(`edgeos:${p.application_id ?? 'unknown'}`);

      const lineItems = p.paymentProducts ?? [];
      const primaryCategory = lineItems[0]?.product_category || 'other';
      const label =
        lineItems.length > 0
          ? lineItems
              .map((li) => `${li.product_name}${li.quantity > 1 ? ` x${li.quantity}` : ''}`)
              .join(' + ')
          : 'EdgeOS Purchase';

      txns.push({
        id: `edgeos-${p.id}`,
        source: 'edgeos',
        memberId: String(p.application_id ?? ''),
        amount,
        status: p.status,
        category: primaryCategory,
        label,
        createdAt,
      });

      // Build dedup index (matches /api/stripe logic — list price × qty totals, by popup)
      const popup = popupByAppId.get(p.application_id);
      if (popup !== undefined) {
        const amountCents = Math.round(amount * 100);
        const key = `${amountCents}|${dayKey(createdAt)}`;
        let idx = edgeosIndexByPopup.get(popup);
        if (!idx) {
          idx = new Set();
          edgeosIndexByPopup.set(popup, idx);
        }
        idx.add(key);
      }

      if (lineItems.length > 0) {
        for (const li of lineItems) {
          const key = li.product_category || 'other';
          const slice = categoryMap.get(key) ?? {
            key,
            label: labelForCategory(key),
            amount: 0,
            count: 0,
          };
          const qty = Number(li.quantity ?? 1) || 1;
          // Use list price × qty for category breakdown so category totals reflect
          // catalog sales (matches mvp's prior behavior). Headline `revenue` still
          // uses payment.amount (the net-of-discount actual charge).
          slice.amount += Number(li.product_price ?? 0) * qty;
          slice.count += qty;
          categoryMap.set(key, slice);
        }
      }
    }

    // -- Fever (Supabase) — net of discount, status='purchased' only --
    const itemsByOrder = new Map<string, FeverItemRow[]>();
    for (const it of feverItems) {
      if (!it.fever_order_id) continue;
      const list = itemsByOrder.get(it.fever_order_id) ?? [];
      list.push(it);
      itemsByOrder.set(it.fever_order_id, list);
    }

    let feverRevenue = 0;
    let ticketCount = 0;
    for (const order of feverOrders) {
      const items = itemsByOrder.get(order.fever_order_id) ?? [];
      if (items.length === 0) continue;
      const orderTotal = items.reduce(
        (sum, i) =>
          sum +
          Number(i.unitary_price ?? 0) +
          Number(i.surcharge ?? 0) -
          Number(i.discount ?? 0),
        0,
      );
      if (orderTotal <= 0) continue;

      const ts = order.order_created_at ?? items[0]?.purchase_date ?? null;
      if (!ts) continue;

      feverRevenue += orderTotal;
      ticketCount += items.length;

      const buyerName =
        `${order.buyer_first_name ?? ''} ${order.buyer_last_name ?? ''}`.trim().toLowerCase();
      buyerKeys.add(`fever:${buyerName || order.fever_order_id}`);

      const label = order.plan_name
        ? `${order.plan_name}${items.length > 1 ? ` x${items.length}` : ''}`
        : `Eclipse Ticket${items.length > 1 ? ` x${items.length}` : ''}`;

      txns.push({
        id: `fever-${order.fever_order_id}`,
        source: 'fever',
        memberId: '',
        amount: orderTotal,
        status: 'purchased',
        category: 'ticket',
        label,
        createdAt: ts,
      });

      const slice = categoryMap.get('ticket') ?? {
        key: 'ticket',
        label: labelForCategory('ticket'),
        amount: 0,
        count: 0,
      };
      slice.amount += orderTotal;
      slice.count += items.length;
      categoryMap.set('ticket', slice);
    }

    // -- Stripe (Supabase) — succeeded & not refunded, deduped vs EdgeOS for Portal --
    let stripeRevenue = 0;
    for (const c of charges) {
      const amount = (c.amount_cents - (c.amount_refunded_cents || 0)) / 100;
      if (amount <= 0) continue;

      const scopedPopups = STRIPE_DEDUP_SCOPE[c.account_key] ?? [];
      const dKey = `${c.amount_cents}|${dayKey(c.created_at)}`;
      const matched = scopedPopups.some((popup) => edgeosIndexByPopup.get(popup)?.has(dKey));
      if (matched) continue; // already counted as EdgeOS revenue

      stripeRevenue += amount;
      buyerKeys.add(`stripe:${c.id}`);

      txns.push({
        id: `stripe-${c.id}`,
        source: 'stripe',
        memberId: '',
        amount,
        status: 'succeeded',
        category: 'stripe',
        label: `Stripe Direct (${c.account_key})`,
        createdAt: c.created_at,
      });

      const slice = categoryMap.get('stripe') ?? {
        key: 'stripe',
        label: labelForCategory('stripe'),
        amount: 0,
        count: 0,
      };
      slice.amount += amount;
      slice.count += 1;
      categoryMap.set('stripe', slice);
    }

    // -- Daily series --
    const dailyMap = new Map<string, { date: string; amount: number; count: number }>();
    for (const t of txns) {
      const k = dayKey(t.createdAt);
      const day = dailyMap.get(k) ?? { date: k, amount: 0, count: 0 };
      day.amount += t.amount;
      day.count += 1;
      dailyMap.set(k, day);
    }
    const sortedDaily = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    const filledDaily: { date: string; amount: number; count: number }[] = [];
    if (sortedDaily.length > 0) {
      const start = new Date(sortedDaily[0].date + 'T00:00:00Z');
      const end = new Date(sortedDaily[sortedDaily.length - 1].date + 'T00:00:00Z');
      const byDate = new Map(sortedDaily.map((d) => [d.date, d]));
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const k = d.toISOString().slice(0, 10);
        filledDaily.push(byDate.get(k) ?? { date: k, amount: 0, count: 0 });
      }
    }

    // -- Trend (last 7 days vs prior 7) --
    const recent = [...txns].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const anchor = recent.length > 0 ? new Date(recent[0].createdAt) : new Date();
    const last7Start = new Date(anchor.getTime() - 7 * 86400_000);
    const prev7Start = new Date(anchor.getTime() - 14 * 86400_000);
    let last7dRevenue = 0;
    let prev7dRevenue = 0;
    for (const t of txns) {
      const d = new Date(t.createdAt);
      if (d >= last7Start) last7dRevenue += t.amount;
      else if (d >= prev7Start) prev7dRevenue += t.amount;
    }
    const deltaPct =
      prev7dRevenue > 0 ? ((last7dRevenue - prev7dRevenue) / prev7dRevenue) * 100 : null;

    const categories = [...categoryMap.values()].sort((a, b) => b.amount - a.amount);
    const revenue = edgeosRevenue + feverRevenue + stripeRevenue;
    const transactions = txns.length;
    const aov = transactions > 0 ? revenue / transactions : 0;

    const payload = {
      generatedAt: new Date().toISOString(),
      totals: {
        revenue,
        edgeosRevenue,
        feverRevenue,
        stripeRevenue,
        transactions,
        tickets: ticketCount,
        payingMembers: buyerKeys.size,
        aov,
      },
      trend: { last7dRevenue, prev7dRevenue, deltaPct },
      daily: filledDaily,
      categories,
      recent: recent.slice(0, 8),
    };

    const response = NextResponse.json(payload);
    response.headers.set('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return response;
  } catch (err) {
    console.error('[API] finances/aggregate error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'aggregate failed' },
      { status: 500 },
    );
  }
}
