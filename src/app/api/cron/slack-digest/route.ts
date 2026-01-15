import { NextResponse } from 'next/server';
import { fetchTickets } from '@/lib/supabase';
import { sendSlackMessage, formatDigestMessage } from '@/lib/slack';

export const dynamic = 'force-dynamic';

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://portal-dashboard-imxp.vercel.app';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fetch both unclaimed and awaiting_team in parallel
    const [unclaimedResult, awaitingTeamResult] = await Promise.all([
      fetchTickets('unclaimed'),
      fetchTickets('awaiting_team'),
    ]);

    if (unclaimedResult.error) {
      return NextResponse.json({ error: unclaimedResult.error }, { status: 500 });
    }
    if (awaitingTeamResult.error) {
      return NextResponse.json({ error: awaitingTeamResult.error }, { status: 500 });
    }

    const unclaimed = unclaimedResult.tickets;
    const awaitingTeam = awaitingTeamResult.tickets;

    // Skip if nothing needs attention
    if (unclaimed.length === 0 && awaitingTeam.length === 0) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'No tickets need attention',
      });
    }

    const unclaimedStale = unclaimed.filter((t) => t.is_stale);
    const awaitingTeamStale = awaitingTeam.filter((t) => t.is_stale);

    // Combine stale tickets for the "oldest" list, prioritizing awaiting team
    const allStale = [...awaitingTeamStale, ...unclaimedStale.filter(
      (t) => !awaitingTeamStale.some((at) => at.ticket_key === t.ticket_key)
    )];

    const message = formatDigestMessage({
      unclaimed: {
        total: unclaimed.length,
        stale: unclaimedStale.length,
      },
      awaitingTeam: {
        total: awaitingTeam.length,
        stale: awaitingTeamStale.length,
      },
      oldestStale: allStale.slice(0, 3).map((t) => ({
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
        unclaimed: unclaimed.length,
        unclaimedStale: unclaimedStale.length,
        awaitingTeam: awaitingTeam.length,
        awaitingTeamStale: awaitingTeamStale.length,
      },
    });
  } catch (error) {
    console.error('[Slack Digest] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
