import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface OrderRow {
  fever_order_id: string;
  buyer_email: string | null;
  buyer_first_name: string | null;
  buyer_last_name: string | null;
  plan_id: string | null;
  plan_name: string | null;
  [key: string]: unknown;
}

interface ItemRow {
  fever_order_id: string;
  unitary_price: number | null;
  surcharge: number | null;
  status: string | null;
  [key: string]: unknown;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search')?.toLowerCase() || '';
  const status = searchParams.get('status') || '';
  const planId = searchParams.get('plan') || '';

  try {
    // Fetch all orders with pagination (Supabase default limit is 1000)
    const PAGE_SIZE = 1000;
    const allOrders: OrderRow[] = [];
    let orderOffset = 0;

    while (true) {
      let ordersQuery = supabase
        .from('fever_orders')
        .select('*')
        .order('order_created_at', { ascending: false })
        .range(orderOffset, orderOffset + PAGE_SIZE - 1);

      if (planId) {
        ordersQuery = ordersQuery.eq('plan_id', planId);
      }

      const { data: orders, error: ordersError } = await ordersQuery;

      if (ordersError) {
        return NextResponse.json({ error: ordersError.message }, { status: 500 });
      }

      if (!orders || orders.length === 0) break;

      allOrders.push(...(orders as OrderRow[]));
      if (orders.length < PAGE_SIZE) break;
      orderOffset += PAGE_SIZE;
    }

    const orders = allOrders;

    // Fetch all items with pagination
    const allItems: ItemRow[] = [];
    let itemOffset = 0;

    while (true) {
      let itemsQuery = supabase
        .from('fever_order_items')
        .select('*')
        .range(itemOffset, itemOffset + PAGE_SIZE - 1);

      if (status) {
        itemsQuery = itemsQuery.eq('status', status);
      }

      const { data: items, error: itemsError } = await itemsQuery;

      if (itemsError) {
        return NextResponse.json({ error: itemsError.message }, { status: 500 });
      }

      if (!items || items.length === 0) break;

      allItems.push(...(items as ItemRow[]));
      if (items.length < PAGE_SIZE) break;
      itemOffset += PAGE_SIZE;
    }

    const items = allItems;

    // Group items by order_id
    const itemsByOrder = new Map<string, ItemRow[]>();
    for (const item of items || []) {
      const orderId = item.fever_order_id;
      if (!itemsByOrder.has(orderId)) {
        itemsByOrder.set(orderId, []);
      }
      itemsByOrder.get(orderId)!.push(item);
    }

    // Combine orders with their items and compute totals
    let ordersWithItems = (orders || []).map((order) => {
      const orderItems = itemsByOrder.get(order.fever_order_id) || [];
      const totalValue = orderItems.reduce(
        (sum, item) => sum + (item.unitary_price || 0) + (item.surcharge || 0),
        0
      );

      return {
        ...order,
        items: orderItems,
        item_count: orderItems.length,
        total_value: totalValue,
      };
    });

    // Filter by status (only include orders that have items matching status)
    if (status) {
      ordersWithItems = ordersWithItems.filter((o) => o.items.length > 0);
    }

    // Client-side search filter
    if (search) {
      ordersWithItems = ordersWithItems.filter((order) => {
        const buyerEmail = (order.buyer_email || '').toLowerCase();
        const buyerName = `${order.buyer_first_name || ''} ${order.buyer_last_name || ''}`.toLowerCase();
        const orderId = order.fever_order_id.toLowerCase();
        return (
          buyerEmail.includes(search) ||
          buyerName.includes(search) ||
          orderId.includes(search)
        );
      });
    }

    // Get unique plans for filter dropdown
    const plans = [...new Set((orders || []).map((o) => o.plan_name).filter(Boolean))];

    return NextResponse.json({
      orders: ordersWithItems,
      total: ordersWithItems.length,
      plans,
    });
  } catch (error) {
    console.error('[Fever Orders] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
