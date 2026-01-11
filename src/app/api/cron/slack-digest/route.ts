import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { sendSlackMessage, formatDigestMessage } from '@/lib/slack';

export const dynamic = 'force-dynamic';

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://dashboard.icelandeclipse.com';

export async function GET(request: Request) {
  // Verify cron secret for security
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fetch tickets that need response
    const { data: tickets, error } = await supabase
      .from('email_tickets')
      .select('*')
      .eq('status', 'awaiting_response')
      .order('last_inbound_ts', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const needsResponse = tickets?.length || 0;
    const staleTickets = tickets?.filter((t) => t.is_stale) || [];
    const unclaimed = tickets?.filter((t) => !t.claimed_by) || [];

    // Skip if no tickets need attention
    if (needsResponse === 0) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'No tickets need response',
      });
    }

    const message = formatDigestMessage({
      needsResponse,
      stale: staleTickets.length,
      unclaimed: unclaimed.length,
      staleTickets: staleTickets.map((t) => ({
        customer_email: t.customer_email,
        subject: t.subject,
        age_display: t.age_display,
      })),
      dashboardUrl: `${DASHBOARD_URL}/email-queue`,
    });

    const sent = await sendSlackMessage(message);

    return NextResponse.json({
      success: sent,
      stats: {
        needsResponse,
        stale: staleTickets.length,
        unclaimed: unclaimed.length,
      },
    });
  } catch (error) {
    console.error('[Slack Digest] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
