import type { FeverMetrics, FeverSyncState } from './types';

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
    const response = await fetch('/api/cron/fever-sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
