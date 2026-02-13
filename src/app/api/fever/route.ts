import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import type { FeverMetrics, FeverSyncState } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dashboard.icelandeclipse.com';
    const res = await fetch(`${baseUrl}/api/cron/fever-sync?manual=true`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.CRON_SECRET}` },
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text }, { status: res.status });
    }
    return NextResponse.json(await res.json());
  } catch (error) {
    console.error('[API] Fever sync trigger error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'metrics';

  try {
    if (type === 'sync-state') {
      const syncState = await getFeverSyncState();
      return NextResponse.json(syncState);
    }

    if (type === 'debug') {
      const debug = await getDebugInfo();
      return NextResponse.json(debug);
    }

    const metrics = await getFeverMetrics();
    return NextResponse.json(metrics);
  } catch (error) {
    console.error('[API] Fever data error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

async function getDebugInfo() {
  // Get true count from DB
  const { count: totalCount } = await supabase
    .from('fever_order_items')
    .select('*', { count: 'exact', head: true });

  const { count: purchasedCount } = await supabase
    .from('fever_order_items')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'purchased');

  // Paginate to get all items with price details
  const PAGE_SIZE = 1000;
  const allItems: Array<{ status: string; unitary_price: number; discount: number; surcharge: number }> = [];
  let offset = 0;
  while (true) {
    const { data: items } = await supabase
      .from('fever_order_items')
      .select('status, unitary_price, discount, surcharge')
      .range(offset, offset + PAGE_SIZE - 1);
    if (!items || items.length === 0) break;
    allItems.push(...items.map(i => ({
      status: i.status || 'null',
      unitary_price: i.unitary_price || 0,
      discount: i.discount || 0,
      surcharge: i.surcharge || 0,
    })));
    if (items.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  // Also check order-level surcharges
  const { data: orders } = await supabase
    .from('fever_orders')
    .select('surcharge')
    .limit(5000);

  const orderSurchargeTotal = (orders || []).reduce((sum, o) => sum + (o.surcharge || 0), 0);

  const byStatus: Record<string, { count: number; revenue: number; discounts: number; surcharges: number }> = {};
  for (const item of allItems) {
    if (!byStatus[item.status]) {
      byStatus[item.status] = { count: 0, revenue: 0, discounts: 0, surcharges: 0 };
    }
    byStatus[item.status].count += 1;
    byStatus[item.status].revenue += item.unitary_price;
    byStatus[item.status].discounts += item.discount;
    byStatus[item.status].surcharges += item.surcharge;
  }

  const purchasedData = byStatus['purchased'] || { revenue: 0, discounts: 0, surcharges: 0 };

  return {
    byStatus,
    queriedItems: allItems.length,
    totalInDb: totalCount,
    purchasedInDb: purchasedCount,
    orderSurchargeTotal,
    calculation: {
      unitaryPriceTotal: purchasedData.revenue,
      itemDiscounts: purchasedData.discounts,
      itemSurcharges: purchasedData.surcharges,
      orderSurcharges: orderSurchargeTotal,
      possibleTotal: purchasedData.revenue - purchasedData.discounts + purchasedData.surcharges + orderSurchargeTotal,
    }
  };
}

async function getFeverSyncState(): Promise<FeverSyncState> {
  const { data: syncState } = await supabase
    .from('fever_sync_state')
    .select('last_sync_at, last_order_created_at')
    .eq('id', 1)
    .single();

  const { count: orderCount } = await supabase
    .from('fever_orders')
    .select('*', { count: 'exact', head: true });

  const { count: itemCount } = await supabase
    .from('fever_order_items')
    .select('*', { count: 'exact', head: true });

  return {
    lastSyncAt: syncState?.last_sync_at || null,
    lastOrderCreatedAt: syncState?.last_order_created_at || null,
    orderCount: orderCount || 0,
    itemCount: itemCount || 0,
  };
}

interface FeverItemRow {
  fever_order_id: string;
  unitary_price: number | null;
  surcharge: number | null;
  discount: number | null;
  fever_orders: { plan_id: string; plan_name: string };
}

async function getFeverMetrics(): Promise<FeverMetrics> {
  // Paginate to fetch all purchased items (Supabase default limit is 1000)
  const PAGE_SIZE = 1000;
  const allItems: FeverItemRow[] = [];

  let offset = 0;
  while (true) {
    const { data: items, error } = await supabase
      .from('fever_order_items')
      .select(`
        fever_order_id,
        unitary_price,
        surcharge,
        discount,
        fever_orders!inner (
          plan_id,
          plan_name
        )
      `)
      .eq('status', 'purchased')
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error('[Fever] Query error:', error);
      break;
    }

    if (!items || items.length === 0) break;

    // Supabase returns joined table as object when using !inner
    for (const item of items) {
      const order = item.fever_orders as unknown as { plan_id: string; plan_name: string };
      allItems.push({
        fever_order_id: item.fever_order_id,
        unitary_price: item.unitary_price,
        surcharge: item.surcharge,
        discount: item.discount,
        fever_orders: order,
      });
    }

    if (items.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const emptyBreakdown = {
    ticketsAndAddonsRevenue: 0,
    surcharge: 0,
    totalGrossRevenue: 0,
    discount: 0,
    userPayment: 0,
  };

  if (allItems.length === 0) {
    return {
      totalRevenue: 0,
      orderCount: 0,
      ticketCount: 0,
      revenueByPlan: {},
      breakdown: emptyBreakdown,
    };
  }

  const orderIds = new Set<string>();
  const revenueByPlan: Record<string, { revenue: number; count: number; planName: string }> = {};

  // Breakdown totals
  let ticketsAndAddonsRevenue = 0;
  let totalSurcharge = 0;
  let totalDiscount = 0;

  for (const item of allItems) {
    orderIds.add(item.fever_order_id);

    const unitaryPrice = item.unitary_price || 0;
    const surcharge = item.surcharge || 0;
    const discount = item.discount || 0;

    ticketsAndAddonsRevenue += unitaryPrice;
    totalSurcharge += surcharge;
    totalDiscount += discount;

    // Per-plan revenue uses user payment formula
    const itemRevenue = unitaryPrice + surcharge - discount;
    const planId = item.fever_orders?.plan_id || 'unknown';
    const planName = item.fever_orders?.plan_name || 'Unknown Plan';

    if (!revenueByPlan[planId]) {
      revenueByPlan[planId] = { revenue: 0, count: 0, planName };
    }
    revenueByPlan[planId].revenue += itemRevenue;
    revenueByPlan[planId].count += 1;
  }

  // Calculate breakdown matching Fever's dashboard
  const totalGrossRevenue = ticketsAndAddonsRevenue + totalSurcharge;
  const userPayment = totalGrossRevenue - totalDiscount;

  return {
    totalRevenue: userPayment,  // Main display value
    orderCount: orderIds.size,
    ticketCount: allItems.length,
    revenueByPlan,
    breakdown: {
      ticketsAndAddonsRevenue,
      surcharge: totalSurcharge,
      totalGrossRevenue,
      discount: totalDiscount,
      userPayment,
    },
  };
}
