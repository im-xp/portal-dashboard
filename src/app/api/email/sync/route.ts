import { NextResponse } from 'next/server';
import { supabase, generateTicketKey } from '@/lib/supabase';
import { logActivity } from '@/lib/activity';

export const dynamic = 'force-dynamic';
import {
  listMessages,
  getMessageFull,
  getHeader,
  parseEmailAddress,
  parseEmailAddresses,
  isNoiseMessage,
  isInternalSender,
  isForwardedEmail,
  extractForwardedSender,
  getMessageDirection,
  stripQuotedContent,
} from '@/lib/gmail';
import { summarizeEmail } from '@/lib/gemini';

const SUPPORT_EMAIL = process.env.GMAIL_SUPPORT_ADDRESS || 'theportalsupport@icelandeclipse.com';

async function runSync() {
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

    // Build query - get messages from last 30 days or since last sync
    const query = 'newer_than:30d';
    
    console.log(`[Gmail Sync] Starting sync with query: ${query}`);

    // List messages
    const listResponse = await listMessages(query, 500);
    const messageRefs = listResponse.messages || [];

    console.log(`[Gmail Sync] Found ${messageRefs.length} messages`);

    // Batch deduplication - one query instead of N sequential checks
    const allIds = messageRefs.map(r => r.id);
    const { data: existingMessages } = await supabase
      .from('email_messages')
      .select('gmail_message_id')
      .in('gmail_message_id', allIds);
    const existingSet = new Set(existingMessages?.map(e => e.gmail_message_id) || []);

    const newMessageRefs = messageRefs.filter(r => !existingSet.has(r.id));
    console.log(`[Gmail Sync] ${newMessageRefs.length} new messages to process`);

    // Fetch all new messages in batches to avoid Gmail rate limits
    // Then sort chronologically (oldest first) to ensure correct ticket updates
    const BATCH_SIZE = 10;
    const fullMessages = [];
    for (let i = 0; i < newMessageRefs.length; i += BATCH_SIZE) {
      const batch = newMessageRefs.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(ref => getMessageFull(ref.id))
      );
      fullMessages.push(...batchResults);
    }
    fullMessages.sort((a, b) => {
      const tsA = a.internalDate ? parseInt(a.internalDate) : 0;
      const tsB = b.internalDate ? parseInt(b.internalDate) : 0;
      return tsA - tsB;
    });

    // Split messages by direction - process inbounds first to ensure tickets exist
    const inboundMessages = fullMessages.filter(m => {
      const from = parseEmailAddress(getHeader(m, 'From'));
      return from && !isInternalSender(from);
    });
    const outboundMessages = fullMessages.filter(m => {
      const from = parseEmailAddress(getHeader(m, 'From'));
      return from && isInternalSender(from);
    });

    // Process inbound messages first (creates tickets)
    for (const message of inboundMessages) {
      try {
        stats.messagesProcessed++;

        // Extract headers
        const fromHeader = getHeader(message, 'From');
        const toHeader = getHeader(message, 'To');
        const ccHeader = getHeader(message, 'Cc');
        const subject = getHeader(message, 'Subject');
        const messageIdHeader = getHeader(message, 'Message-ID');
        
        const fromEmail = parseEmailAddress(fromHeader);
        if (!fromEmail) {
          stats.errors.push(`No from email for message ${message.id}`);
          continue;
        }

        const toEmails = parseEmailAddresses(toHeader);
        const ccEmails = parseEmailAddresses(ccHeader);
        const isNoise = isNoiseMessage(message);
        const direction = getMessageDirection(fromEmail);
        const internalTs = message.internalDate 
          ? new Date(parseInt(message.internalDate)).toISOString()
          : new Date().toISOString();

        // Strip quoted content from body before storing
        const strippedBody = message.body ? stripQuotedContent(message.body) : null;

        // Insert message with stripped body
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
            body: strippedBody,
            internal_ts: internalTs,
            direction,
            is_noise: isNoise,
            message_id: messageIdHeader,
          });

        if (insertError) {
          stats.errors.push(`Insert error for ${message.id}: ${insertError.message}`);
          continue;
        }

        stats.messagesInserted++;

        // Skip noise messages for ticket creation
        if (isNoise) continue;

        // Create/update ticket based on direction
        if (direction === 'inbound') {
          // Determine customer email - handle forwarded emails from internal senders
          let customerEmail = fromEmail;
          let isForward = false;
          
          if (isInternalSender(fromEmail)) {
            // Check if this is a forwarded email
            if (isForwardedEmail(subject || '')) {
              // Extract original sender from email body (already fetched)
              if (message.body) {
                const originalSender = extractForwardedSender(message.body);
                if (originalSender) {
                  customerEmail = originalSender;
                  isForward = true;
                  console.log(`[Sync] Forwarded email detected: ${fromEmail} -> original sender: ${customerEmail}`);
                } else {
                  console.log(`[Sync] Skipping internal forward - couldn't extract original sender: ${subject}`);
                  continue;
                }
              } else {
                console.log(`[Sync] Skipping internal forward - no body: ${subject}`);
                continue;
              }
            } else {
              // Internal sender, not a forward - skip
              continue;
            }
          }
          
          const ticketKey = generateTicketKey(message.threadId, customerEmail);

          // Check for direct ticket match
          let { data: existingTicket } = await supabase
            .from('email_tickets')
            .select('*')
            .eq('ticket_key', ticketKey)
            .single();

          // If not found, check thread_ticket_mapping for linked threads
          if (!existingTicket) {
            const { data: mapping } = await supabase
              .from('thread_ticket_mapping')
              .select('ticket_key')
              .eq('gmail_thread_id', message.threadId)
              .single();

            if (mapping) {
              const { data: mappedTicket } = await supabase
                .from('email_tickets')
                .select('*')
                .eq('ticket_key', mapping.ticket_key)
                .single();

              if (mappedTicket) {
                existingTicket = mappedTicket;
                // Update ticket's thread ID to current thread for reply routing
                if (mappedTicket.gmail_thread_id !== message.threadId) {
                  await supabase
                    .from('email_tickets')
                    .update({ gmail_thread_id: message.threadId })
                    .eq('ticket_key', mapping.ticket_key);
                }
                console.log(`[Sync] Thread ${message.threadId} mapped to ticket ${mapping.ticket_key}`);
              }
            }
          }

          // Fallback: check for recent awaiting_customer ticket for this customer
          // This handles cases where Gmail assigns different thread IDs to our outbound and their reply
          if (!existingTicket) {
            const { data: awaitingTicket } = await supabase
              .from('email_tickets')
              .select('*')
              .eq('customer_email', customerEmail)
              .eq('status', 'awaiting_customer_response')
              .order('last_outbound_ts', { ascending: false })
              .limit(1)
              .single();

            if (awaitingTicket) {
              existingTicket = awaitingTicket;
              // Create mapping and update ticket's thread ID to current thread
              await supabase.from('thread_ticket_mapping').upsert(
                { gmail_thread_id: message.threadId, ticket_key: awaitingTicket.ticket_key },
                { onConflict: 'gmail_thread_id' }
              );
              await supabase
                .from('email_tickets')
                .update({ gmail_thread_id: message.threadId })
                .eq('ticket_key', awaitingTicket.ticket_key);
              console.log(`[Sync] Fallback: linked thread ${message.threadId} to awaiting ticket ${awaitingTicket.ticket_key}`);
            }
          }

          if (existingTicket) {
            // Update existing ticket - generate new summary if we don't have one
            let summary = existingTicket.summary;
            if (!summary && message.body) {
              try {
                summary = await summarizeEmail(message.body, subject || '', customerEmail);
              } catch (e) {
                console.warn('[Sync] Failed to generate summary:', e);
              }
            }

            // Check if this is a follow-up (customer responding after we responded)
            const isFollowup = existingTicket.last_outbound_ts !== null;
            const newResponseCount = isFollowup 
              ? (existingTicket.response_count || 0) + 1 
              : (existingTicket.response_count || 0);

            const { error: updateError } = await supabase
              .from('email_tickets')
              .update({
                subject: isForward ? subject?.replace(/^Fwd:\s*/i, '') : subject,
                last_inbound_ts: internalTs,
                // Customer responded - set status back to awaiting_response
                status: 'awaiting_team_response',
                // Mark as follow-up if we had already responded
                is_followup: isFollowup,
                response_count: newResponseCount,
                ...(summary && !existingTicket.summary ? { summary } : {}),
              })
              .eq('ticket_key', existingTicket.ticket_key);

            if (!updateError) {
              stats.ticketsUpdated++;
              await logActivity(existingTicket.ticket_key, 'customer_replied', customerEmail);
            }
          } else {
            // Create new ticket with AI summary
            let summary: string | null = null;
            if (message.body) {
              try {
                summary = await summarizeEmail(message.body, subject || '', customerEmail);
              } catch (e) {
                console.warn('[Sync] Failed to generate summary:', e);
              }
            }

            const { error: createError } = await supabase
              .from('email_tickets')
              .insert({
                ticket_key: ticketKey,
                gmail_thread_id: message.threadId,
                customer_email: customerEmail,
                subject: isForward ? subject?.replace(/^Fwd:\s*/i, '') : subject,
                last_inbound_ts: internalTs,
                summary,
              });

            if (!createError) {
              stats.ticketsCreated++;
              await logActivity(ticketKey, 'created', customerEmail, { subject });
            }
          }
        } else {
          // Outbound: only update tickets where customer was a recipient
          const outboundRecipients = new Set([
            ...toEmails.map(e => e.toLowerCase()),
            ...ccEmails.map(e => e.toLowerCase()),
          ]);

          // Get all tickets linked to this thread
          const { data: threadTickets } = await supabase
            .from('email_tickets')
            .select('ticket_key, customer_email, claimed_by, responded_by, last_inbound_ts, last_outbound_ts')
            .eq('gmail_thread_id', message.threadId);

          // Also check thread_ticket_mapping for tickets with different primary thread
          const { data: mappedTickets } = await supabase
            .from('thread_ticket_mapping')
            .select('ticket_key')
            .eq('gmail_thread_id', message.threadId);

          const mappedTicketKeys = mappedTickets?.map(m => m.ticket_key) || [];

          let additionalTickets: typeof threadTickets = [];
          if (mappedTicketKeys.length > 0) {
            const { data: mapped } = await supabase
              .from('email_tickets')
              .select('ticket_key, customer_email, claimed_by, responded_by, last_inbound_ts, last_outbound_ts')
              .in('ticket_key', mappedTicketKeys);
            additionalTickets = mapped || [];
          }

          // Combine and dedupe tickets
          const allTickets = [...(threadTickets || []), ...additionalTickets];
          const seenKeys = new Set<string>();
          const uniqueTickets = allTickets.filter(t => {
            if (seenKeys.has(t.ticket_key)) return false;
            seenKeys.add(t.ticket_key);
            return true;
          });

          const outboundTs = new Date(internalTs);

          for (const currentTicket of uniqueTickets) {
            // Only update if this customer was actually a recipient
            if (!outboundRecipients.has(currentTicket.customer_email.toLowerCase())) continue;

            const lastInboundTs = currentTicket.last_inbound_ts ? new Date(currentTicket.last_inbound_ts) : null;
            const lastOutboundTs = currentTicket.last_outbound_ts ? new Date(currentTicket.last_outbound_ts) : null;

            // Skip if this outbound is older than what we've already recorded
            if (lastOutboundTs && outboundTs <= lastOutboundTs) continue;

            // Only treat as "response" if this outbound is AFTER the customer's message
            const isResponseToCustomer = lastInboundTs && outboundTs > lastInboundTs;

            if (isResponseToCustomer) {
              const responder = currentTicket.claimed_by || currentTicket.responded_by || 'team';

              const { error: updateError } = await supabase
                .from('email_tickets')
                .update({
                  last_outbound_ts: internalTs,
                  responded_by: responder !== 'team' ? responder : null,
                  responded_at: internalTs,
                  status: 'awaiting_customer_response',
                })
                .eq('ticket_key', currentTicket.ticket_key);

              if (!updateError) {
                stats.ticketsUpdated++;
                await logActivity(currentTicket.ticket_key, 'responded', responder, {
                  detected_from: 'gmail_sync',
                  message_ts: internalTs
                });
              }
            } else {
              // Initiating outbound - just track the timestamp, don't change status
              await supabase
                .from('email_tickets')
                .update({ last_outbound_ts: internalTs })
                .eq('ticket_key', currentTicket.ticket_key);
            }
          }
        }
      } catch (msgError) {
        stats.errors.push(`Error processing ${message.id}: ${String(msgError)}`);
      }
    }

    // Process outbound messages second (updates tickets)
    for (const message of outboundMessages) {
      try {
        stats.messagesProcessed++;

        const fromHeader = getHeader(message, 'From');
        const toHeader = getHeader(message, 'To');
        const ccHeader = getHeader(message, 'Cc');
        const subject = getHeader(message, 'Subject');
        const messageIdHeader = getHeader(message, 'Message-ID');

        const fromEmail = parseEmailAddress(fromHeader);
        if (!fromEmail) {
          stats.errors.push(`No from email for message ${message.id}`);
          continue;
        }

        const toEmails = parseEmailAddresses(toHeader);
        const ccEmails = parseEmailAddresses(ccHeader);
        const isNoise = isNoiseMessage(message);
        const internalTs = message.internalDate
          ? new Date(parseInt(message.internalDate)).toISOString()
          : new Date().toISOString();

        const strippedBody = message.body ? stripQuotedContent(message.body) : null;

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
            body: strippedBody,
            internal_ts: internalTs,
            direction: 'outbound',
            is_noise: isNoise,
            message_id: messageIdHeader,
          });

        if (insertError) {
          stats.errors.push(`Insert error for ${message.id}: ${insertError.message}`);
          continue;
        }

        stats.messagesInserted++;

        if (isNoise) continue;

        // Outbound: update tickets where customer was a recipient
        const outboundRecipients = new Set([
          ...toEmails.map(e => e.toLowerCase()),
          ...ccEmails.map(e => e.toLowerCase()),
        ]);

        const { data: threadTickets } = await supabase
          .from('email_tickets')
          .select('ticket_key, customer_email, claimed_by, responded_by, last_inbound_ts, last_outbound_ts')
          .eq('gmail_thread_id', message.threadId);

        const { data: mappedTickets } = await supabase
          .from('thread_ticket_mapping')
          .select('ticket_key')
          .eq('gmail_thread_id', message.threadId);

        const mappedTicketKeys = mappedTickets?.map(m => m.ticket_key) || [];

        let additionalTickets: typeof threadTickets = [];
        if (mappedTicketKeys.length > 0) {
          const { data: mapped } = await supabase
            .from('email_tickets')
            .select('ticket_key, customer_email, claimed_by, responded_by, last_inbound_ts, last_outbound_ts')
            .in('ticket_key', mappedTicketKeys);
          additionalTickets = mapped || [];
        }

        const allTickets = [...(threadTickets || []), ...additionalTickets];
        const seenKeys = new Set<string>();
        const uniqueTickets = allTickets.filter(t => {
          if (seenKeys.has(t.ticket_key)) return false;
          seenKeys.add(t.ticket_key);
          return true;
        });

        const outboundTs = new Date(internalTs);

        for (const currentTicket of uniqueTickets) {
          if (!outboundRecipients.has(currentTicket.customer_email.toLowerCase())) continue;

          const lastInboundTs = currentTicket.last_inbound_ts ? new Date(currentTicket.last_inbound_ts) : null;
          const lastOutboundTs = currentTicket.last_outbound_ts ? new Date(currentTicket.last_outbound_ts) : null;

          if (lastOutboundTs && outboundTs <= lastOutboundTs) continue;

          const isResponseToCustomer = lastInboundTs && outboundTs > lastInboundTs;

          if (isResponseToCustomer) {
            const responder = currentTicket.claimed_by || currentTicket.responded_by || 'team';

            const { error: updateError } = await supabase
              .from('email_tickets')
              .update({
                last_outbound_ts: internalTs,
                responded_by: responder !== 'team' ? responder : null,
                responded_at: internalTs,
                status: 'awaiting_customer_response',
              })
              .eq('ticket_key', currentTicket.ticket_key);

            if (!updateError) {
              stats.ticketsUpdated++;
              await logActivity(currentTicket.ticket_key, 'responded', responder, {
                detected_from: 'gmail_sync',
                message_ts: internalTs
              });
            }
          } else {
            await supabase
              .from('email_tickets')
              .update({ last_outbound_ts: internalTs })
              .eq('ticket_key', currentTicket.ticket_key);
          }
        }
      } catch (msgError) {
        stats.errors.push(`Error processing ${message.id}: ${String(msgError)}`);
      }
    }

    // Reconcile status and is_followup based on timestamps (handles out-of-order processing)
    // Tickets where we've responded but status wasn't updated
    await supabase
      .from('email_tickets')
      .update({ status: 'awaiting_customer_response' })
      .eq('needs_response', false)
      .eq('status', 'awaiting_team_response');

    // Tickets where customer responded but status shows awaiting customer
    await supabase
      .from('email_tickets')
      .update({ status: 'awaiting_team_response' })
      .eq('needs_response', true)
      .eq('status', 'awaiting_customer_response');

    // Tickets where customer replied after we responded = follow-up
    await supabase
      .from('email_tickets')
      .update({ is_followup: true })
      .eq('needs_response', true)
      .not('last_outbound_ts', 'is', null)
      .eq('is_followup', false);

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  if (searchParams.get('status') === 'true') {
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

  return runSync();
}

export async function POST() {
  return runSync();
}

