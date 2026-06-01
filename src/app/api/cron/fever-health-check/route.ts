import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { fetchFeverOrders } from '@/lib/fever';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface DayDelta {
  day: string;
  fever_count: number;
  supabase_count: number;
  missing_ids: string[]; // in Fever, not in Supabase
  extra_ids: string[];   // in Supabase, not in Fever
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

/**
 * Compare Fever vs Supabase order counts for a single UTC calendar day.
 * Returns null when both sides agree (no delta). Otherwise returns the
 * delta with capped id lists (avoid logging unbounded jsonb).
 */
async function compareDay(day: string): Promise<DayDelta | null> {
  const next = isoDay(addDays(new Date(day), 1));

  const { orders: feverOrders } = await fetchFeverOrders({
    dateFrom: day,
    dateTo: next,
  });
  const feverIds = new Set(feverOrders.map((o) => o.feverOrderId));

  const { data: rows } = await supabase
    .from('fever_orders')
    .select('fever_order_id')
    .gte('order_created_at', day)
    .lt('order_created_at', next);
  const supabaseIds = new Set((rows ?? []).map((r) => r.fever_order_id as string));

  const missing: string[] = [];
  for (const id of feverIds) if (!supabaseIds.has(id)) missing.push(id);
  const extra: string[] = [];
  for (const id of supabaseIds) if (!feverIds.has(id)) extra.push(id);

  if (missing.length === 0 && extra.length === 0) return null;

  // Cap at first 100 ids per day; the full count is preserved in the
  // *_count fields. Pat (downstream consumer) caps its post at first 20.
  return {
    day,
    fever_count: feverIds.size,
    supabase_count: supabaseIds.size,
    missing_ids: missing.slice(0, 100),
    extra_ids: extra.slice(0, 100),
  };
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.FEVER_USERNAME || !process.env.FEVER_PASSWORD) {
    return NextResponse.json(
      { error: 'Fever credentials not configured', configured: false },
      { status: 503 },
    );
  }

  // Insert run-log row up front so a fatal failure mid-check still leaves
  // breadcrumbs in fever_sync_runs.
  let runLogId: number | null = null;
  {
    const { data: runRow, error: runInsertError } = await supabase
      .from('fever_sync_runs')
      .insert({
        started_at: new Date().toISOString(),
        kind: 'health-check',
      })
      .select('id')
      .single();
    if (runInsertError) {
      console.error('[Fever Health Check] Failed to insert run-log row:', runInsertError);
    } else {
      runLogId = runRow?.id ?? null;
    }
  }

  try {
    const today = new Date();
    const deltas: DayDelta[] = [];

    // Standard daily window: previous 7 UTC calendar days (offset 1..7).
    // offset=1 is yesterday; we never check "today" because the day is
    // still in flight.
    for (let offset = 1; offset <= 7; offset++) {
      const day = isoDay(addDays(today, -offset));
      const delta = await compareDay(day);
      if (delta) deltas.push(delta);
    }

    // Weekly deep check: every Sunday (UTC), additionally compare days
    // 8..90 to catch slow-developing drift the 7-day window would miss.
    // Heavier (83 extra Fever calls) but only runs once a week.
    const isSundayUtc = today.getUTCDay() === 0;
    if (isSundayUtc) {
      for (let offset = 8; offset <= 90; offset++) {
        const day = isoDay(addDays(today, -offset));
        const delta = await compareDay(day);
        if (delta) deltas.push(delta);
      }
    }

    const reconciliation = { deltas };

    if (runLogId !== null) {
      const { error: runUpdateError } = await supabase
        .from('fever_sync_runs')
        .update({
          finished_at: new Date().toISOString(),
          reconciliation: deltas.length > 0 ? reconciliation : { deltas: [] },
          errors: [],
        })
        .eq('id', runLogId);
      if (runUpdateError) {
        console.error('[Fever Health Check] Failed to update run-log row:', runUpdateError);
      }
    }

    return NextResponse.json({
      checked_days: isSundayUtc ? 90 : 7,
      deep_check: isSundayUtc,
      deltas,
      runId: runLogId,
    });
  } catch (error) {
    console.error('[Fever Health Check] Error:', error);
    if (runLogId !== null) {
      await supabase
        .from('fever_sync_runs')
        .update({
          finished_at: new Date().toISOString(),
          errors: [{ index: 0, message: `fatal: ${String(error)}` }],
        })
        .eq('id', runLogId);
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
