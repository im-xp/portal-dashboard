import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

// Create client - will fail at runtime if env vars missing, but won't crash build
export const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey)
  : null as unknown as ReturnType<typeof createClient>;

// Types for our email queue tables
export interface EmailMessage {
  gmail_message_id: string;
  gmail_thread_id: string;
  from_email: string;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  snippet: string | null;
  internal_ts: string;
  direction: 'inbound' | 'outbound';
  is_noise: boolean;
  message_id: string | null; // RFC 2822 Message-ID header for threading
  created_at: string;
}

export interface EmailTicket {
  ticket_key: string;
  gmail_thread_id: string;
  customer_email: string;
  subject: string | null;
  last_inbound_ts: string | null;
  last_outbound_ts: string | null;
  needs_response: boolean;
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
  is_mass_email_thread?: boolean;
}

export interface EmailSyncState {
  id: number;
  last_history_id: string | null;
  last_sync_at: string | null;
  updated_at: string;
}

// Helper to generate ticket key (hash of thread_id + customer_email)
export function generateTicketKey(threadId: string, customerEmail: string): string {
  const normalized = customerEmail.toLowerCase().trim();
  // Simple hash for now - in production might use crypto
  const combined = `${threadId}:${normalized}`;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `${threadId.slice(0, 8)}_${Math.abs(hash).toString(36)}`;
}

