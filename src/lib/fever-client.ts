import type { FeverMetrics, FeverSyncState, FeverOrdersResponse } from './types';

export async function getFeverSyncState(): Promise<FeverSyncState> {
  const res = await fetch('/api/fever?type=sync-state');
  if (!res.ok) {
    throw new Error(`Failed to fetch fever sync state: ${res.statusText}`);
  }
  return res.json();
}

export async function getFeverMetrics(): Promise<FeverMetrics> {
  const res = await fetch('/api/fever?type=metrics');
  if (!res.ok) {
    throw new Error(`Failed to fetch fever metrics: ${res.statusText}`);
  }
  return res.json();
}

export async function triggerFeverSync(): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch('/api/fever', { method: 'POST' });
    if (!res.ok) {
      const error = await res.text();
      return { success: false, error };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function getFeverOrders(params?: {
  search?: string;
  status?: string;
  plan?: string;
}): Promise<FeverOrdersResponse> {
  const searchParams = new URLSearchParams();
  if (params?.search) searchParams.set('search', params.search);
  if (params?.status) searchParams.set('status', params.status);
  if (params?.plan) searchParams.set('plan', params.plan);

  const url = `/api/fever/orders${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch fever orders: ${res.statusText}`);
  }
  return res.json();
}
