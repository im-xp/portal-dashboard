import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isInternalSender } from '@/lib/gmail';

export const dynamic = 'force-dynamic';

export interface ThreadMessage {
  gmail_message_id: string;
  gmail_thread_id: string;
  from_email: string;
  to_emails: string[];
  cc_emails: string[];
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

  // Get ticket to find primary thread AND customer email
  const { data: ticket, error: ticketError } = await supabase
    .from('email_tickets')
    .select('gmail_thread_id, customer_email')
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
    .select('gmail_message_id, gmail_thread_id, from_email, to_emails, cc_emails, subject, body, snippet, internal_ts, direction')
    .in('gmail_thread_id', uniqueThreadIds)
    .eq('is_noise', false)
    .order('internal_ts', { ascending: true });

  if (messagesError) {
    return NextResponse.json({ error: messagesError.message }, { status: 500 });
  }

  // Filter to only messages relevant to THIS customer's conversation
  // (handles mass email threads where multiple customers replied)
  const customerEmail = ticket.customer_email.toLowerCase();
  const relevantMessages = (messages || []).filter(msg => {
    const fromEmail = msg.from_email.toLowerCase();
    const toEmails = (msg.to_emails || []).map((e: string) => e.toLowerCase());
    const ccEmails = (msg.cc_emails || []).map((e: string) => e.toLowerCase());

    // Include if: customer sent it
    if (fromEmail === customerEmail) {
      return true;
    }

    // Include if: sent TO or CC'd the customer (team reply)
    if (toEmails.includes(customerEmail) || ccEmails.includes(customerEmail)) {
      return true;
    }

    return false;
  });

  return NextResponse.json({ messages: relevantMessages });
}
