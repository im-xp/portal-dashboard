import { NextRequest, NextResponse } from 'next/server';
import { supabase, type EmailTicket } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filter = searchParams.get('filter') || 'needs_response';
    const limit = parseInt(searchParams.get('limit') || '100');

    let query = supabase
      .from('email_tickets')
      .select('*')
      .order('last_inbound_ts', { ascending: false })
      .limit(limit);

    // Apply filter
    switch (filter) {
      case 'needs_response':
        query = query.eq('needs_response', true);
        break;
      case 'followups':
        // Tickets where customer responded to our response
        query = query.eq('is_followup', true).eq('needs_response', true);
        break;
      case 'claimed':
        query = query.not('claimed_by', 'is', null);
        break;
      case 'unclaimed':
        query = query.is('claimed_by', null).eq('needs_response', true);
        break;
      case 'awaiting_customer':
        // Tickets we've responded to, waiting for customer reply
        query = query.eq('status', 'awaiting_customer');
        break;
      case 'resolved':
        // Manually resolved tickets
        query = query.eq('status', 'resolved');
        break;
      case 'all':
        // No filter
        break;
    }

    const { data: tickets, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Detect mass email threads by checking if thread has outbound from marketing sender
    const MASS_EMAIL_SENDERS = ['hallo@icelandeclipse.com'];
    const threadIds = [...new Set((tickets as EmailTicket[]).map(t => t.gmail_thread_id))];

    const { data: massEmailMessages } = await supabase
      .from('email_messages')
      .select('gmail_thread_id, from_email')
      .in('gmail_thread_id', threadIds)
      .eq('direction', 'outbound')
      .in('from_email', MASS_EMAIL_SENDERS);

    const massEmailThreads = new Set(massEmailMessages?.map(m => m.gmail_thread_id) || []);

    // Add computed fields for UI
    const now = new Date();
    const enrichedTickets = (tickets as EmailTicket[]).map(ticket => {
      const lastInbound = ticket.last_inbound_ts ? new Date(ticket.last_inbound_ts) : null;
      const claimedAt = ticket.claimed_at ? new Date(ticket.claimed_at) : null;
      
      // Calculate age in hours
      const ageHours = lastInbound 
        ? Math.floor((now.getTime() - lastInbound.getTime()) / (1000 * 60 * 60))
        : null;

      // Check if claim is stale (> 24 hours AND still needs response)
      // If it's been responded to, it's not stale even if old
      const isStale = ticket.needs_response && claimedAt 
        ? (now.getTime() - claimedAt.getTime()) > 24 * 60 * 60 * 1000
        : false;

      return {
        ...ticket,
        age_hours: ageHours,
        age_display: formatAge(ageHours),
        is_stale: isStale,
        is_mass_email_thread: massEmailThreads.has(ticket.gmail_thread_id),
      };
    });

    return NextResponse.json({
      tickets: enrichedTickets,
      count: enrichedTickets.length,
      filter,
    });
  } catch (error) {
    console.error('[Tickets API] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

function formatAge(hours: number | null): string {
  if (hours === null) return '-';
  if (hours < 1) return '< 1h';
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

