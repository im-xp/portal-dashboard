import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { sendSlackMessage, formatStaleAlert } from '@/lib/slack';

export const dynamic = 'force-dynamic';

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://dashboard.icelandeclipse.com';

// Track tickets we've already alerted on (in-memory, resets on deploy)
// For production, consider storing this in the database
const alertedTickets = new Set<string>();

export async function GET(request: Request) {
  // Verify cron secret for security
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fetch stale tickets that need response
    const { data: tickets, error } = await supabase
      .from('email_tickets')
      .select('*')
      .eq('status', 'awaiting_response')
      .eq('is_stale', true)
      .order('last_inbound_ts', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const newlyStale = tickets?.filter((t) => !alertedTickets.has(t.ticket_key)) || [];

    if (newlyStale.length === 0) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'No new stale tickets',
        totalStale: tickets?.length || 0,
      });
    }

    // Alert on each newly stale ticket
    const alerts: { ticketKey: string; sent: boolean }[] = [];

    for (const ticket of newlyStale) {
      const message = formatStaleAlert({
        customer_email: ticket.customer_email,
        subject: ticket.subject,
        claimed_by: ticket.claimed_by,
        age_display: ticket.age_display,
        dashboardUrl: `${DASHBOARD_URL}/email-queue`,
      });

      const sent = await sendSlackMessage(message);
      alerts.push({ ticketKey: ticket.ticket_key, sent });

      if (sent) {
        alertedTickets.add(ticket.ticket_key);
      }
    }

    return NextResponse.json({
      success: true,
      alerts,
      totalStale: tickets?.length || 0,
    });
  } catch (error) {
    console.error('[Slack Stale Alert] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
