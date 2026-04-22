import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getPayments } from '@/lib/nocodb';
import type { StripeAccountKey } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

interface StripeChargeRow {
  id: string;
  account_key: StripeAccountKey;
  amount_cents: number;
  created_at: string;
  status: string;
  refunded: boolean;
  amount_refunded_cents: number;
}

interface AccountSummary {
  label: string;
  netTotal: number;
  netCount: number;
  grossTotal: number;
  grossCount: number;
  edgeosMatchedTotal: number;
  edgeosMatchedCount: number;
}

const ACCOUNT_LABELS: Record<StripeAccountKey, string> = {
  portal: 'The Portal',
  iceland: 'Iceland Eclipse',
};

/**
 * Same-day UTC date string from an ISO timestamp (YYYY-MM-DD).
 */
function dateKey(isoDate: string): string {
  return isoDate.slice(0, 10);
}

function dedupKey(amountCents: number, dateStr: string): string {
  return `${amountCents}|${dateStr}`;
}

async function fetchAllStripeCharges(): Promise<StripeChargeRow[]> {
  const PAGE_SIZE = 1000;
  const all: StripeChargeRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('stripe_charges')
      .select('id, account_key, amount_cents, created_at, status, refunded, amount_refunded_cents')
      .eq('status', 'succeeded')
      .eq('refunded', false)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error('[Stripe] Failed to fetch charges:', error);
      break;
    }
    if (!data || data.length === 0) break;
    all.push(...(data as StripeChargeRow[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return all;
}

export async function GET() {
  try {
    const [charges, payments] = await Promise.all([
      fetchAllStripeCharges(),
      getPayments(),
    ]);

    const approvedPayments = payments.filter((p) => p.status === 'approved');

    const edgeosIndex = new Set<string>();
    for (const p of approvedPayments) {
      const amountCents = Math.round(p.amount * 100);
      edgeosIndex.add(dedupKey(amountCents, dateKey(p.created_at)));
    }

    const summaries: Record<StripeAccountKey, AccountSummary> = {
      portal: {
        label: ACCOUNT_LABELS.portal,
        netTotal: 0,
        netCount: 0,
        grossTotal: 0,
        grossCount: 0,
        edgeosMatchedTotal: 0,
        edgeosMatchedCount: 0,
      },
      iceland: {
        label: ACCOUNT_LABELS.iceland,
        netTotal: 0,
        netCount: 0,
        grossTotal: 0,
        grossCount: 0,
        edgeosMatchedTotal: 0,
        edgeosMatchedCount: 0,
      },
    };

    for (const c of charges) {
      const summary = summaries[c.account_key];
      if (!summary) continue;

      const amountCents = c.amount_cents - (c.amount_refunded_cents || 0);
      const amount = amountCents / 100;

      summary.grossTotal += amount;
      summary.grossCount += 1;

      const key = dedupKey(c.amount_cents, dateKey(c.created_at));
      if (edgeosIndex.has(key)) {
        summary.edgeosMatchedTotal += amount;
        summary.edgeosMatchedCount += 1;
      } else {
        summary.netTotal += amount;
        summary.netCount += 1;
      }
    }

    for (const key of Object.keys(summaries) as StripeAccountKey[]) {
      summaries[key].netTotal = round2(summaries[key].netTotal);
      summaries[key].grossTotal = round2(summaries[key].grossTotal);
      summaries[key].edgeosMatchedTotal = round2(summaries[key].edgeosMatchedTotal);
    }

    const combinedNet = round2(summaries.portal.netTotal + summaries.iceland.netTotal);

    const response = NextResponse.json({
      accounts: summaries,
      combinedNet,
      generatedAt: new Date().toISOString(),
    });

    response.headers.set('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return response;
  } catch (error) {
    console.error('[API] Stripe read error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
