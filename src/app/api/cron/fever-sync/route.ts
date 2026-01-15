import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { fetchFeverOrders, orderToDbRow, itemToDbRow, FeverOrder } from '@/lib/fever';
import { sendSlackMessage, formatFeverOrderNotification } from '@/lib/slack';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://dashboard.icelandeclipse.com';

interface SyncStats {
  ordersProcessed: number;
  ordersInserted: number;
  ordersUpdated: number;
  itemsProcessed: number;
  itemsInserted: number;
  newOrdersNotified: number;
  errors: string[];
}

async function runSync(isManual = false): Promise<NextResponse> {
  const stats: SyncStats = {
    ordersProcessed: 0,
    ordersInserted: 0,
    ordersUpdated: 0,
    itemsProcessed: 0,
    itemsInserted: 0,
    newOrdersNotified: 0,
    errors: [],
  };

  try {
    if (!process.env.FEVER_USERNAME || !process.env.FEVER_PASSWORD) {
      return NextResponse.json(
        { error: 'Fever credentials not configured', configured: false },
        { status: 503 }
      );
    }

    const { data: syncState, error: syncStateError } = await supabase
      .from('fever_sync_state')
      .select('*')
      .eq('id', 1)
      .single();

    if (syncStateError) {
      console.error('[Fever Sync] Failed to read sync state:', syncStateError);
    }

    const dateFrom = isManual ? undefined : syncState?.last_order_created_at?.split('T')[0];

    console.log(`[Fever Sync] Starting ${isManual ? 'manual' : 'incremental'} sync${dateFrom ? ` from ${dateFrom}` : ''}`);

    const { orders, items } = await fetchFeverOrders({ dateFrom });

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

    if (newOrders.length > 0 && process.env.FEVER_SLACK_WEBHOOK_URL) {
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

    let latestOrderCreated = syncState?.last_order_created_at;
    for (const order of orders) {
      if (order.orderCreatedAt) {
        const orderTs = order.orderCreatedAt.toISOString();
        if (!latestOrderCreated || orderTs > latestOrderCreated) {
          latestOrderCreated = orderTs;
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

    console.log('[Fever Sync] Complete:', stats);

    return NextResponse.json({
      success: true,
      stats,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Fever Sync] Error:', error);
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

    return NextResponse.json({
      status: 'ok',
      configured: !!(process.env.FEVER_USERNAME && process.env.FEVER_PASSWORD),
      lastSyncAt: syncState?.last_sync_at,
      lastOrderCreatedAt: syncState?.last_order_created_at,
      orderCount,
      itemCount,
      totalOrdersSynced: syncState?.orders_synced,
      totalItemsSynced: syncState?.items_synced,
    });
  }

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return runSync(false);
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const isManual = searchParams.get('manual') === 'true';

  return runSync(isManual);
}
