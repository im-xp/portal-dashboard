import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export interface ThreadMessage {
  gmail_message_id: string;
  gmail_thread_id: string;
  from_email: string;
  to_emails: string[];
  subject: string | null;
  body: string | null;
  snippet: string | null;
  internal_ts: string;
  direction: 'inbound' | 'outbound';
}

export async function GET(request: NextRequest) {
  const ticketKey = request.nextUrl.searchParams.get('ticket_key');

  if (!ticketKey) {
    return NextResponse.json(
      { error: 'ticket_key is required' },
      { status: 400 }
    );
  }

  // Get ticket to find primary thread
  const { data: ticket, error: ticketError } = await supabase
    .from('email_tickets')
    .select('gmail_thread_id')
    .eq('ticket_key', ticketKey)
    .single();

  if (ticketError || !ticket) {
    return NextResponse.json(
      { error: 'Ticket not found' },
      { status: 404 }
    );
  }

  // Get any additional threads mapped to this ticket
  const { data: mappings } = await supabase
    .from('thread_ticket_mapping')
    .select('gmail_thread_id')
    .eq('ticket_key', ticketKey);

  const allThreadIds = [
    ticket.gmail_thread_id,
    ...(mappings?.map(m => m.gmail_thread_id) || []),
  ];

  // Remove duplicates
  const uniqueThreadIds = [...new Set(allThreadIds)];

  // Fetch all messages from these threads
  const { data: messages, error: messagesError } = await supabase
    .from('email_messages')
    .select('gmail_message_id, gmail_thread_id, from_email, to_emails, subject, body, snippet, internal_ts, direction')
    .in('gmail_thread_id', uniqueThreadIds)
    .eq('is_noise', false)
    .order('internal_ts', { ascending: true });

  if (messagesError) {
    return NextResponse.json({ error: messagesError.message }, { status: 500 });
  }

  return NextResponse.json({ messages: messages || [] });
}
