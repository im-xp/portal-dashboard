import { NextResponse } from 'next/server';
import { fetchTickets } from '@/lib/supabase';
import { sendSlackMessage, formatStaleAlert } from '@/lib/slack';

export const dynamic = 'force-dynamic';

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://portal-dashboard-imxp.vercel.app';

// Track tickets we've already alerted on (in-memory, resets on deploy)
// For production, consider storing this in the database
const alertedTickets = new Set<string>();

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fetch tickets awaiting team response (matches dashboard)
    const { tickets, error } = await fetchTickets('awaiting_team');

    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }

    const staleTickets = tickets.filter((t) => t.is_stale);
    const newlyStale = staleTickets.filter((t) => !alertedTickets.has(t.ticket_key));

    if (newlyStale.length === 0) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'No new stale tickets',
        totalStale: staleTickets.length,
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
      totalStale: staleTickets.length,
    });
  } catch (error) {
    console.error('[Slack Stale Alert] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
