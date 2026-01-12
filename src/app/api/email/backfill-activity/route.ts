import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const stats = {
      created: 0,
      responded: 0,
      skipped: 0,
    };

    // Fetch all tickets
    const { data: tickets, error } = await supabase
      .from('email_tickets')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    for (const ticket of tickets || []) {
      // Check if we already have activity for this ticket
      const { count } = await supabase
        .from('ticket_activity')
        .select('*', { count: 'exact', head: true })
        .eq('ticket_key', ticket.ticket_key);

      if (count && count > 0) {
        stats.skipped++;
        continue;
      }

      // Create "created" activity
      await supabase
        .from('ticket_activity')
        .insert({
          ticket_key: ticket.ticket_key,
          action: 'created',
          actor: ticket.customer_email,
          metadata: { subject: ticket.subject, backfilled: true },
          created_at: ticket.created_at,
        });
      stats.created++;

      // If ticket has responded_by, create "responded" activity
      if (ticket.responded_by && ticket.responded_at) {
        await supabase
          .from('ticket_activity')
          .insert({
            ticket_key: ticket.ticket_key,
            action: 'responded',
            actor: ticket.responded_by,
            metadata: { backfilled: true },
            created_at: ticket.responded_at,
          });
        stats.responded++;
      } else if (ticket.last_outbound_ts) {
        // Has outbound but no responded_by - log as "team"
        await supabase
          .from('ticket_activity')
          .insert({
            ticket_key: ticket.ticket_key,
            action: 'responded',
            actor: 'team',
            metadata: { backfilled: true },
            created_at: ticket.last_outbound_ts,
          });
        stats.responded++;
      }
    }

    return NextResponse.json({
      success: true,
      stats,
      message: `Backfilled ${stats.created} created events, ${stats.responded} responded events. Skipped ${stats.skipped} tickets with existing activity.`,
    });
  } catch (error) {
    console.error('[Backfill Activity] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
