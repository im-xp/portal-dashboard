import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { fetchFeverOrders, orderToDbRow, itemToDbRow, FeverOrder } from '@/lib/fever';
import { sendSlackMessage, formatFeverOrderNotification } from '@/lib/slack';
import { identifyBuyer, trackOrderCompleted, trackOrderCancelled, flushSegment } from '@/lib/segment';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://dashboard.icelandeclipse.com';

// Earliest date a full re-pull should reach back to (first Fever orders are
// ~Aug 2025). Used as the default date_from for a no-date manual "full sync".
const FEVER_EPOCH = '2025-01-01';

interface SyncStats {
  ordersProcessed: number;
  ordersInserted: number;
  ordersUpdated: number;
  itemsProcessed: number;
  itemsInserted: number;
  newOrdersNotified: number;
  errors: string[];
}

async function runSync(
  isManual = false,
  skipSlack = false,
  skipSegment = false,
  manualDateFrom?: string,
  manualDateTo?: string,
): Promise<NextResponse> {
  const stats: SyncStats = {
    ordersProcessed: 0,
    ordersInserted: 0,
    ordersUpdated: 0,
    itemsProcessed: 0,
    itemsInserted: 0,
    newOrdersNotified: 0,
    errors: [],
  };

  // Per-run log row id (fever_sync_runs). Populated after the env check so
  // we don't write a row for misconfigured runs. Best-effort: a failure to
  // insert is logged but does NOT block the sync.
  let runLogId: number | null = null;
  const runKind: 'incremental' | 'manual' = isManual ? 'manual' : 'incremental';

  try {
    if (!process.env.FEVER_USERNAME || !process.env.FEVER_PASSWORD) {
      return NextResponse.json(
        { error: 'Fever credentials not configured', configured: false },
        { status: 503 }
      );
    }

    {
      const { data: runRow, error: runInsertError } = await supabase
        .from('fever_sync_runs')
        .insert({
          started_at: new Date().toISOString(),
          kind: runKind,
          skipped_segment: skipSegment,
        })
        .select('id')
        .single();
      if (runInsertError) {
        console.error('[Fever Sync] Failed to insert run-log row:', runInsertError);
      } else {
        runLogId = runRow?.id ?? null;
      }
    }

    const { data: syncState, error: syncStateError } = await supabase
      .from('fever_sync_state')
      .select('*')
      .eq('id', 1)
      .single();

    if (syncStateError) {
      console.error('[Fever Sync] Failed to read sync state:', syncStateError);
    }

    // For manual mode, prefer caller-supplied date_from / date_to (targeted
    // backfill window) over the watermark. Bare ?manual=true (no dates) still
    // means "full re-pull" — both dateFrom and dateTo stay undefined and
    // fetchFeverOrders pulls all history.
    let dateFrom: string | undefined;
    let dateTo: string | undefined;
    if (isManual) {
      dateFrom = manualDateFrom;
      dateTo = manualDateTo;
      // Bare manual sync (no dates) means "full re-pull". Fever 422s on an
      // empty search body (it requires a date range), so a no-date "Sync Now"
      // used to fail outright. Default to a wide window covering all history.
      // NOTE: a true full pull of all orders may exceed maxDuration; for large
      // corrections prefer chunked date_from/date_to windows.
      if (!dateFrom && !dateTo) {
        dateFrom = FEVER_EPOCH;
        dateTo = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      }
    } else {
      dateFrom = syncState?.last_order_created_at?.split('T')[0];
      // Fever interprets date_to as an exclusive upper bound (created_date < date_to).
      // Using today's date here silently excluded ALL of today's orders every tick
      // until the day rolled over. Use tomorrow so the current UTC day is included.
      // Empirically verified 2026-06-01: date_to=2026-06-01 returned 0 orders dated
      // 2026-06-01; date_to=2026-06-02 returned all of them.
      const tomorrowUtc = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      dateTo = dateFrom ? tomorrowUtc : undefined;
    }

    console.log(`[Fever Sync] Starting ${isManual ? 'manual' : 'incremental'} sync${dateFrom ? ` from ${dateFrom} to ${dateTo}` : ''}`);

    const { orders, items } = await fetchFeverOrders({ dateFrom, dateTo });

    console.log(`[Fever Sync] Fetched ${orders.length} orders, ${items.length} items`);

    const existingOrderIds = new Set<string>();
    if (orders.length > 0) {
      const orderIds = orders.map((o) => o.feverOrderId);
      const BATCH_SIZE = 500;
      for (let i = 0; i < orderIds.length; i += BATCH_SIZE) {
        const batch = orderIds.slice(i, i + BATCH_SIZE);
        const { data: existing } = await supabase
          .from('fever_orders')
          .select('fever_order_id')
          .in('fever_order_id', batch);
        existing?.forEach((e) => existingOrderIds.add(e.fever_order_id));
      }
    }

    const newOrders: FeverOrder[] = [];
    // Tracks order IDs whose upsert batch succeeded. Used to compute the
    // watermark only over orders that actually made it into Supabase — see
    // the watermark computation below for the rationale.
    const successfullyUpsertedOrderIds = new Set<string>();
    const UPSERT_BATCH = 100;

    for (let i = 0; i < orders.length; i += UPSERT_BATCH) {
      const batch = orders.slice(i, i + UPSERT_BATCH);
      const rows = batch.map(orderToDbRow);

      const { error } = await supabase.from('fever_orders').upsert(rows, {
        onConflict: 'fever_order_id',
      });

      if (error) {
        stats.errors.push(`Order batch ${i}: ${error.message}`);
        continue;
      }

      for (const order of batch) {
        stats.ordersProcessed++;
        successfullyUpsertedOrderIds.add(order.feverOrderId);
        if (!existingOrderIds.has(order.feverOrderId)) {
          stats.ordersInserted++;
          newOrders.push(order);
        } else {
          stats.ordersUpdated++;
        }
      }
    }

    for (let i = 0; i < items.length; i += UPSERT_BATCH) {
      const batch = items.slice(i, i + UPSERT_BATCH);
      const rows = batch.map(itemToDbRow);

      const { error } = await supabase.from('fever_order_items').upsert(rows, {
        onConflict: 'fever_order_id,fever_item_id',
      });

      if (error) {
        stats.errors.push(`Item batch ${i}: ${error.message}`);
        continue;
      }

      stats.itemsProcessed += batch.length;
      stats.itemsInserted += batch.length;
    }

    if (!skipSlack && newOrders.length > 0 && process.env.FEVER_SLACK_WEBHOOK_URL) {
      for (const order of newOrders.slice(0, 10)) {
        const orderItems = items.filter((i) => i.feverOrderId === order.feverOrderId);
        const message = formatFeverOrderNotification({
          orderId: order.feverOrderId,
          buyerEmail: order.buyerEmail || 'Unknown',
          buyerName: [order.buyerFirstName, order.buyerLastName].filter(Boolean).join(' ') || null,
          planName: order.planName || 'Unknown Plan',
          itemCount: orderItems.length,
          totalPrice: orderItems.reduce((sum, i) => sum + (i.unitaryPrice || 0), 0),
          currency: order.currency || 'USD',
          sessionName: orderItems[0]?.sessionName || null,
          sessionStart: orderItems[0]?.sessionStart || null,
          dashboardUrl: `${DASHBOARD_URL}/fever-orders`,
        });

        const sent = await sendSlackMessage(message, process.env.FEVER_SLACK_WEBHOOK_URL);
        if (sent) stats.newOrdersNotified++;
      }

      if (newOrders.length > 10) {
        await sendSlackMessage(
          { text: `... and ${newOrders.length - 10} more new orders` },
          process.env.FEVER_SLACK_WEBHOOK_URL
        );
      }
    }

    if (!skipSegment && process.env.SEGMENT_WRITE_KEY) {
      for (const order of newOrders) {
        const orderItems = items.filter((i) => i.feverOrderId === order.feverOrderId);
        try {
          // Determine whether THIS order is the buyer's first-observed non-null
          // utm_referring_domain. If yes, identifyBuyer writes initial_referrer
          // / initial_referring_domain. If no, those traits are skipped so the
          // existing first-touch value isn't overwritten. Per Jameson, May 4.
          let firstTouchReferringDomain: string | null = null;
          if (order.buyerEmail && order.utmReferringDomain) {
            const { data: earliest } = await supabase
              .from('fever_orders')
              .select('fever_order_id, utm_referring_domain')
              .eq('buyer_email', order.buyerEmail)
              .not('utm_referring_domain', 'is', null)
              .order('order_created_at', { ascending: true })
              .limit(1);
            if (earliest?.[0]?.fever_order_id === order.feverOrderId) {
              firstTouchReferringDomain = order.utmReferringDomain;
            }
          }
          identifyBuyer(order, orderItems, firstTouchReferringDomain);
          trackOrderCompleted(order, orderItems);
        } catch (err) {
          console.error(`[Segment] Failed for order ${order.feverOrderId}:`, err);
        }
      }

      for (const order of orders.filter((o) => existingOrderIds.has(o.feverOrderId))) {
        const orderItems = items.filter((i) => i.feverOrderId === order.feverOrderId);
        const hasCancellations = orderItems.some((i) => i.status === 'CANCELLED');
        if (hasCancellations) {
          try {
            trackOrderCancelled(order, orderItems);
          } catch (err) {
            console.error(`[Segment] Cancel tracking failed for order ${order.feverOrderId}:`, err);
          }
        }
      }

      await flushSegment();
    }

    // Only advance the watermark over orders we actually wrote, and only
    // when ALL batches succeeded. A failed batch leaves a permanent gap if
    // the watermark advances past it (silent 5-27 data loss, 2026-05-27).
    // On any error, hold the watermark so the next tick re-fetches the
    // failed window. last_sync_at always advances so observers can
    // distinguish "errored" from "didn't run."
    const hasErrors = stats.errors.length > 0;
    let latestOrderCreated = syncState?.last_order_created_at;
    if (!hasErrors) {
      for (const order of orders) {
        if (!successfullyUpsertedOrderIds.has(order.feverOrderId)) continue;
        if (order.orderCreatedAt) {
          const orderTs = order.orderCreatedAt.toISOString();
          if (!latestOrderCreated || orderTs > latestOrderCreated) {
            latestOrderCreated = orderTs;
          }
        }
      }
    }

    await supabase
      .from('fever_sync_state')
      .update({
        last_sync_at: new Date().toISOString(),
        last_order_created_at: latestOrderCreated,
        orders_synced: (syncState?.orders_synced || 0) + stats.ordersInserted,
        items_synced: (syncState?.items_synced || 0) + stats.itemsInserted,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1);

    if (runLogId !== null) {
      const { error: runUpdateError } = await supabase
        .from('fever_sync_runs')
        .update({
          finished_at: new Date().toISOString(),
          orders_fetched: orders.length,
          orders_inserted: stats.ordersInserted,
          orders_updated: stats.ordersUpdated,
          errors: stats.errors.map((message, index) => ({ index, message })),
          watermark_advanced_to: hasErrors ? null : latestOrderCreated,
        })
        .eq('id', runLogId);
      if (runUpdateError) {
        console.error('[Fever Sync] Failed to update run-log row:', runUpdateError);
      }
    }

    console.log('[Fever Sync] Complete:', stats);

    return NextResponse.json({
      success: true,
      stats,
      errors_count: stats.errors.length,
      watermark_held: hasErrors,
      runId: runLogId,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Fever Sync] Error:', error);
    if (runLogId !== null) {
      const { error: runUpdateError } = await supabase
        .from('fever_sync_runs')
        .update({
          finished_at: new Date().toISOString(),
          errors: [{ index: 0, message: `fatal: ${String(error)}` }],
          watermark_advanced_to: null,
        })
        .eq('id', runLogId);
      if (runUpdateError) {
        console.error('[Fever Sync] Failed to update run-log row after fatal error:', runUpdateError);
      }
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const { searchParams } = new URL(request.url);

  if (searchParams.get('status') === 'true') {
    const { data: syncState } = await supabase
      .from('fever_sync_state')
      .select('*')
      .eq('id', 1)
      .single();

    const { count: orderCount } = await supabase
      .from('fever_orders')
      .select('*', { count: 'exact', head: true });

    const { count: itemCount } = await supabase
      .from('fever_order_items')
      .select('*', { count: 'exact', head: true });

    // Per-run health: count recent runs with non-empty errors, and the
    // most-recent started_at. Cheap signal Pat can fall back to when the
    // fever_sync_runs read path itself fails.
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentRuns } = await supabase
      .from('fever_sync_runs')
      .select('started_at, errors')
      .gte('started_at', since24h);
    const recent_errors_count = (recentRuns ?? []).filter((r) => {
      const errs = r.errors as unknown;
      return Array.isArray(errs) && errs.length > 0;
    }).length;
    const most_recent_run_at =
      (recentRuns ?? []).reduce<string | null>((acc, r) => {
        if (!r.started_at) return acc;
        if (!acc || r.started_at > acc) return r.started_at;
        return acc;
      }, null);

    return NextResponse.json({
      status: 'ok',
      configured: !!(process.env.FEVER_USERNAME && process.env.FEVER_PASSWORD),
      lastSyncAt: syncState?.last_sync_at,
      lastOrderCreatedAt: syncState?.last_order_created_at,
      orderCount,
      itemCount,
      totalOrdersSynced: syncState?.orders_synced,
      totalItemsSynced: syncState?.items_synced,
      recent_errors_count,
      most_recent_run_at,
    });
  }

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const skipSlack = searchParams.get('skipSlack') === 'true';
  const skipSegment = searchParams.get('skipSegment') === 'true';
  return runSync(false, skipSlack, skipSegment);
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const isManual = searchParams.get('manual') === 'true';
  const skipSlack = searchParams.get('skipSlack') === 'true';
  const skipSegment = searchParams.get('skipSegment') === 'true';

  let manualDateFrom: string | undefined;
  let manualDateTo: string | undefined;
  if (isManual) {
    const dateFromParam = searchParams.get('date_from');
    const dateToParam = searchParams.get('date_to');
    if ((dateFromParam && !dateToParam) || (!dateFromParam && dateToParam)) {
      return NextResponse.json(
        {
          error:
            'date_from and date_to must both be provided together (YYYY-MM-DD). Omit both for a full re-pull.',
        },
        { status: 400 },
      );
    }
    manualDateFrom = dateFromParam || undefined;
    manualDateTo = dateToParam || undefined;
  }

  return runSync(isManual, skipSlack, skipSegment, manualDateFrom, manualDateTo);
}
