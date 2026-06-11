import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { fetchFeverOrders, orderToDbRow, itemToDbRow } from '@/lib/fever';

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

async function upsertBatched(table: string, onConflict: string, rows: unknown[]) {
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + 100), { onConflict });
    if (error) throw new Error(`${table} upsert (batch ${i}): ${error.message}`);
  }
}

/**
 * Daily reconciliation. Re-pulls a trailing window from Fever and UPSERTS it,
 * then reports any residual per-day order-presence delta.
 *
 * Why upsert (not just compare): the fever-sync cron is incremental by CREATED
 * date — once an order ages past the watermark it is never re-fetched, so a
 * later cancellation/refund never updates Supabase and its items stay
 * 'purchased' forever. That silently over-counted revenue (~$46k, found
 * 2026-06-11). This job already pays to fetch the window for comparison;
 * writing it back is what turns drift *detection* into *self-healing*.
 *
 * The previous version fetched one search per day (up to 90 on Sundays — far
 * over maxDuration) and only compared order-id presence, so item-level status
 * drift was invisible to it. We now do ONE range search and upsert, which both
 * corrects status drift and fits the time budget.
 */
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
      .insert({ started_at: new Date().toISOString(), kind: 'health-check' })
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
    // Standard daily window: trailing 7 UTC days. Weekly deep check (Sundays):
    // trailing 90 days to catch slower-developing drift. We never include
    // "today" as a delta day (still in flight) but DO fetch through tomorrow so
    // the upsert covers the most recent orders.
    const isSundayUtc = today.getUTCDay() === 0;
    const lookback = isSundayUtc ? 90 : 7;
    const from = isoDay(addDays(today, -lookback));
    const fetchTo = isoDay(addDays(today, 1)); // exclusive upper bound (Fever)
    const deltaTo = isoDay(today);             // exclude in-flight day from deltas

    // ONE range search (not per-day) — fast, and carries current Fever status.
    const { orders, items } = await fetchFeverOrders({ dateFrom: from, dateTo: fetchTo });

    // Self-heal: write current Fever state back.
    await upsertBatched('fever_orders', 'fever_order_id', orders.map(orderToDbRow));
    await upsertBatched('fever_order_items', 'fever_order_id,fever_item_id', items.map(itemToDbRow));

    // Residual per-day order-presence deltas (post-upsert these should be empty;
    // a non-empty delta means an order exists on exactly one side).
    const feverByDay = new Map<string, Set<string>>();
    for (const o of orders) {
      if (!o.orderCreatedAt) continue;
      const day = isoDay(o.orderCreatedAt);
      if (day >= deltaTo) continue; // skip in-flight day
      if (!feverByDay.has(day)) feverByDay.set(day, new Set());
      feverByDay.get(day)!.add(o.feverOrderId);
    }

    // Paginate the Supabase read: a 90-day window can exceed PostgREST's row
    // cap, and a truncated read would surface phantom missing_ids (false
    // reconciliation alarms). Advance by the actual page size and stop only on
    // an empty page, so this is correct regardless of the server's max-rows.
    const sbRows: { fever_order_id: string; order_created_at: string }[] = [];
    for (let pageStart = 0; ; ) {
      const { data, error } = await supabase
        .from('fever_orders')
        .select('fever_order_id, order_created_at')
        .gte('order_created_at', from)
        .lt('order_created_at', deltaTo)
        .order('fever_order_id', { ascending: true })
        .range(pageStart, pageStart + 999);
      if (error) throw new Error(`fever_orders read (page ${pageStart}): ${error.message}`);
      const page = (data ?? []) as { fever_order_id: string; order_created_at: string }[];
      if (page.length === 0) break;
      sbRows.push(...page);
      pageStart += page.length; // advance by actual count; stop only on an empty page
    }
    const sbByDay = new Map<string, Set<string>>();
    for (const r of sbRows) {
      const day = (r.order_created_at as string)?.slice(0, 10);
      if (!day) continue;
      if (!sbByDay.has(day)) sbByDay.set(day, new Set());
      sbByDay.get(day)!.add(r.fever_order_id as string);
    }

    const deltas: DayDelta[] = [];
    const allDays = new Set<string>([...feverByDay.keys(), ...sbByDay.keys()]);
    for (const day of [...allDays].sort()) {
      const fIds = feverByDay.get(day) ?? new Set<string>();
      const sIds = sbByDay.get(day) ?? new Set<string>();
      const missing = [...fIds].filter((id) => !sIds.has(id));
      const extra = [...sIds].filter((id) => !fIds.has(id));
      if (missing.length || extra.length) {
        deltas.push({
          day,
          fever_count: fIds.size,
          supabase_count: sIds.size,
          missing_ids: missing.slice(0, 100),
          extra_ids: extra.slice(0, 100),
        });
      }
    }

    if (runLogId !== null) {
      const { error: runUpdateError } = await supabase
        .from('fever_sync_runs')
        .update({
          finished_at: new Date().toISOString(),
          orders_fetched: orders.length,
          reconciliation: { deltas },
          errors: [],
        })
        .eq('id', runLogId);
      if (runUpdateError) {
        console.error('[Fever Health Check] Failed to update run-log row:', runUpdateError);
      }
    }

    return NextResponse.json({
      window: { from, to: deltaTo },
      deep_check: isSundayUtc,
      orders_reconciled: orders.length,
      items_reconciled: items.length,
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
