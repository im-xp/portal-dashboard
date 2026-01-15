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
  is_followup: boolean;
  status: 'awaiting_team_response' | 'awaiting_customer_response' | 'resolved';
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

// Enriched ticket with computed fields
export interface EnrichedTicket extends EmailTicket {
  age_hours: number | null;
  age_display: string;
  is_stale: boolean;
}

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export function enrichTicket(ticket: EmailTicket, now = new Date()): EnrichedTicket {
  const lastInbound = ticket.last_inbound_ts ? new Date(ticket.last_inbound_ts) : null;
  const ageMs = lastInbound ? now.getTime() - lastInbound.getTime() : null;
  const ageHours = ageMs ? Math.floor(ageMs / (1000 * 60 * 60)) : null;
  const isStale = lastInbound ? ageMs! > STALE_THRESHOLD_MS : false;

  return {
    ...ticket,
    age_hours: ageHours,
    age_display: formatAge(ageHours),
    is_stale: isStale,
  };
}

export function enrichTickets(tickets: EmailTicket[]): EnrichedTicket[] {
  const now = new Date();
  return tickets.map((t) => enrichTicket(t, now));
}

function formatAge(hours: number | null): string {
  if (hours === null) return '-';
  if (hours < 1) return '< 1h';
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// Ticket filter types - shared between dashboard and crons
export type TicketFilter =
  | 'needs_response'      // All tickets needing a response
  | 'awaiting_team'       // Followups - customer replied, team needs to respond
  | 'unclaimed'           // Needs response and no one claimed
  | 'claimed'             // Someone claimed it
  | 'awaiting_customer'   // We responded, waiting for customer
  | 'resolved'            // Manually resolved
  | 'all';                // No filter

export async function fetchTickets(
  filter: TicketFilter = 'needs_response',
  options: { limit?: number; orderBy?: string; ascending?: boolean } = {}
): Promise<{ tickets: EnrichedTicket[]; error: string | null }> {
  const { limit = 100, orderBy = 'last_inbound_ts', ascending = true } = options;

  let query = supabase
    .from('email_tickets')
    .select('*')
    .order(orderBy, { ascending })
    .limit(limit);

  switch (filter) {
    case 'needs_response':
      query = query.eq('needs_response', true);
      break;
    case 'awaiting_team':
      query = query.eq('is_followup', true).eq('needs_response', true);
      break;
    case 'unclaimed':
      query = query.is('claimed_by', null).eq('needs_response', true);
      break;
    case 'claimed':
      query = query.not('claimed_by', 'is', null);
      break;
    case 'awaiting_customer':
      query = query.eq('status', 'awaiting_customer_response');
      break;
    case 'resolved':
      query = query.eq('status', 'resolved');
      break;
    case 'all':
      break;
  }

  const { data, error } = await query;

  if (error) {
    return { tickets: [], error: error.message };
  }

  return { tickets: enrichTickets((data || []) as EmailTicket[]), error: null };
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

