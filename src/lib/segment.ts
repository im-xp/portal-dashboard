import { Analytics } from '@segment/analytics-node';
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

export function identifyBuyer(order: FeverOrder, items: FeverOrderItem[]): void {
  const client = getClient();
  if (!client) return;

  const userId = resolveUserId(order, items);
  if (!userId) return;

  client.identify({
    userId,
    traits: {
      email: order.buyerEmail,
      first_name: order.buyerFirstName,
      last_name: order.buyerLastName,
      birthday: order.buyerDob,
      language: order.buyerLanguage,
      marketing_opt_in: order.buyerMarketingPref,
    },
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
    },
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
