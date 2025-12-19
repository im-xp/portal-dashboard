import { NextResponse } from 'next/server';
import { supabase, generateTicketKey } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
import {
  listMessages,
  getMessage,
  getHeader,
  parseEmailAddress,
  parseEmailAddresses,
  isNoiseMessage,
  isInternalSender,
  getMessageDirection,
} from '@/lib/gmail';

const SUPPORT_EMAIL = process.env.GMAIL_SUPPORT_ADDRESS || 'theportalsupport@icelandeclipse.com';

export async function POST() {
  try {
    // Check if Gmail is configured
    if (!process.env.GOOGLE_REFRESH_TOKEN) {
      return NextResponse.json(
        { error: 'Gmail not configured', configured: false },
        { status: 503 }
      );
    }

    const stats = {
      messagesProcessed: 0,
      messagesInserted: 0,
      ticketsCreated: 0,
      ticketsUpdated: 0,
      errors: [] as string[],
    };

    // Get sync state
    const { data: syncState } = await supabase
      .from('email_sync_state')
      .select('*')
      .single();

    // Build query - get messages from last 14 days or since last sync
    const query = 'newer_than:14d';
    
    console.log(`[Gmail Sync] Starting sync with query: ${query}`);

    // List messages
    const listResponse = await listMessages(query, 500);
    const messageRefs = listResponse.messages || [];
    
    console.log(`[Gmail Sync] Found ${messageRefs.length} messages`);

    // Process each message
    for (const ref of messageRefs) {
      try {
        // Check if we already have this message
        const { data: existing } = await supabase
          .from('email_messages')
          .select('gmail_message_id')
          .eq('gmail_message_id', ref.id)
          .single();

        if (existing) {
          // Already processed
          continue;
        }

        // Fetch full message
        const message = await getMessage(ref.id);
        stats.messagesProcessed++;

        // Extract headers
        const fromHeader = getHeader(message, 'From');
        const toHeader = getHeader(message, 'To');
        const ccHeader = getHeader(message, 'Cc');
        const subject = getHeader(message, 'Subject');
        
        const fromEmail = parseEmailAddress(fromHeader);
        if (!fromEmail) {
          stats.errors.push(`No from email for message ${ref.id}`);
          continue;
        }

        const toEmails = parseEmailAddresses(toHeader);
        const ccEmails = parseEmailAddresses(ccHeader);
        const isNoise = isNoiseMessage(message);
        const direction = getMessageDirection(fromEmail);
        const internalTs = message.internalDate 
          ? new Date(parseInt(message.internalDate)).toISOString()
          : new Date().toISOString();

        // Insert message
        const { error: insertError } = await supabase
          .from('email_messages')
          .insert({
            gmail_message_id: message.id,
            gmail_thread_id: message.threadId,
            from_email: fromEmail,
            to_emails: toEmails,
            cc_emails: ccEmails,
            subject,
            snippet: message.snippet,
            internal_ts: internalTs,
            direction,
            is_noise: isNoise,
          });

        if (insertError) {
          stats.errors.push(`Insert error for ${ref.id}: ${insertError.message}`);
          continue;
        }

        stats.messagesInserted++;

        // Skip noise messages for ticket creation
        if (isNoise) continue;

        // Skip internal senders (don't create tickets for team emails)
        if (direction === 'inbound' && isInternalSender(fromEmail)) {
          continue;
        }

        // Create/update ticket based on direction
        if (direction === 'inbound') {
          // Inbound: customer email is the sender
          const ticketKey = generateTicketKey(message.threadId, fromEmail);
          
          const { data: existingTicket } = await supabase
            .from('email_tickets')
            .select('*')
            .eq('ticket_key', ticketKey)
            .single();

          if (existingTicket) {
            // Update existing ticket
            const { error: updateError } = await supabase
              .from('email_tickets')
              .update({
                subject,
                last_inbound_ts: internalTs,
              })
              .eq('ticket_key', ticketKey);

            if (!updateError) stats.ticketsUpdated++;
          } else {
            // Create new ticket
            const { error: createError } = await supabase
              .from('email_tickets')
              .insert({
                ticket_key: ticketKey,
                gmail_thread_id: message.threadId,
                customer_email: fromEmail,
                subject,
                last_inbound_ts: internalTs,
              });

            if (!createError) stats.ticketsCreated++;
          }
        } else {
          // Outbound: update all matching tickets for recipients
          for (const recipientEmail of [...toEmails, ...ccEmails]) {
            // Skip if recipient is support email
            if (recipientEmail.toLowerCase() === SUPPORT_EMAIL.toLowerCase()) continue;

            const ticketKey = generateTicketKey(message.threadId, recipientEmail);
            
            const { error: updateError } = await supabase
              .from('email_tickets')
              .update({ last_outbound_ts: internalTs })
              .eq('ticket_key', ticketKey);

            if (!updateError) stats.ticketsUpdated++;
          }
        }
      } catch (msgError) {
        stats.errors.push(`Error processing ${ref.id}: ${String(msgError)}`);
      }
    }

    // Update sync state
    await supabase
      .from('email_sync_state')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', 1);

    console.log(`[Gmail Sync] Complete:`, stats);

    return NextResponse.json({
      success: true,
      stats,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Gmail Sync] Error:', error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Health check / status endpoint
  const { data: syncState } = await supabase
    .from('email_sync_state')
    .select('*')
    .single();

  const { count: ticketCount } = await supabase
    .from('email_tickets')
    .select('*', { count: 'exact', head: true });

  const { count: messageCount } = await supabase
    .from('email_messages')
    .select('*', { count: 'exact', head: true });

  return NextResponse.json({
    status: 'ok',
    configured: !!process.env.GOOGLE_REFRESH_TOKEN,
    lastSyncAt: syncState?.last_sync_at,
    ticketCount,
    messageCount,
  });
}

