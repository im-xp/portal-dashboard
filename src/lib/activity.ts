import { supabase } from './supabase';

export type ActivityAction =
  | 'created'
  | 'claimed'
  | 'unclaimed'
  | 'responded'
  | 'reopened'
  | 'customer_replied';

export async function logActivity(
  ticketKey: string,
  action: ActivityAction,
  actor?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await supabase
      .from('ticket_activity')
      .insert({
        ticket_key: ticketKey,
        action,
        actor: actor || null,
        metadata: metadata || {},
      });
  } catch (error) {
    console.error('[Activity Log] Failed to log activity:', error);
  }
}
